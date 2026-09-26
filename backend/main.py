import json
import os
import shutil
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional

from database import init_db, SessionLocal, User, WorkoutLog, ChatMessage, Meal, ProgressPhoto
from planner import generate_plan
from ai_trainer import ask_ai_trainer
from auth import hash_password, verify_password, create_token, get_user_id_from_token

app = FastAPI(title="FitSolo API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
    allow_credentials=True,
)

@app.middleware("http")
async def add_pwa_headers(request, call_next):
    response = await call_next(request)
    if request.url.path.endswith("sw.js"):
        response.headers["Service-Worker-Allowed"] = "/"
    return response

init_db()

# ===== ПАПКА ДЛЯ ФОТО =====
UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


# ===== ПРОВЕРКА АВТОРИЗАЦИИ =====

def require_auth(authorization: Optional[str]) -> int:
    """Возвращает user_id из токена или бросает 401."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Требуется авторизация")
    token = authorization.replace("Bearer ", "")
    token_user_id = get_user_id_from_token(token)
    if not token_user_id:
        raise HTTPException(401, "Недействительный токен")
    return token_user_id


def check_own(authorization: Optional[str], user_id: int) -> int:
    """Проверяет, что токен валиден и принадлежит user_id."""
    token_user_id = require_auth(authorization)
    if token_user_id != user_id:
        raise HTTPException(403, "Доступ запрещён")
    return token_user_id


# ===== PYDANTIC-МОДЕЛИ =====

class ProfileIn(BaseModel):
    name: str
    gender: str
    age: int
    weight: float
    height: float
    experience: str
    goal: str
    days_per_week: int
    equipment: List[str]
    injuries: List[str] = []


class ChatIn(BaseModel):
    user_id: int
    message: str
    history: Optional[List[dict]] = []


class LogIn(BaseModel):
    user_id: int
    exercise: str
    weight: float
    reps: int
    sets: int
    notes: str = ""


class MealIn(BaseModel):
    user_id: int
    name: str
    grams: float
    calories: float
    protein: float
    fat: float
    carbs: float


class RegisterIn(BaseModel):
    email: str
    password: str
    name: str
    gender: str
    age: int
    weight: float
    height: float
    experience: str
    goal: str
    days_per_week: int
    equipment: List[str]
    injuries: List[str] = []
    link_user_id: Optional[int] = None


class LoginIn(BaseModel):
    email: str
    password: str


# ===== ПРОФИЛЬ =====

@app.post("/api/profile")
def create_profile(p: ProfileIn):
    db = SessionLocal()
    user = User(
        name=p.name, gender=p.gender, age=p.age, weight=p.weight, height=p.height,
        experience=p.experience, goal=p.goal, days_per_week=p.days_per_week,
        equipment=json.dumps(p.equipment), injuries=json.dumps(p.injuries),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    user_id = user.id
    db.close()
    return {"user_id": user_id}


def _get_profile_data(user_id: int):
    """Внутренняя функция: возвращает dict профиля или бросает 404."""
    db = SessionLocal()
    u = db.query(User).get(user_id)
    db.close()
    if not u:
        raise HTTPException(404, "Пользователь не найден")
    return {
        "id": u.id, "name": u.name, "gender": u.gender, "age": u.age,
        "weight": u.weight, "height": u.height, "experience": u.experience,
        "goal": u.goal, "days_per_week": u.days_per_week,
        "equipment": json.loads(u.equipment), "injuries": json.loads(u.injuries),
    }


@app.get("/api/profile/{user_id}")
def get_profile(user_id: int, authorization: Optional[str] = Header(None)):
    check_own(authorization, user_id)
    return _get_profile_data(user_id)


@app.put("/api/profile/{user_id}")
def update_profile(user_id: int, p: ProfileIn, authorization: Optional[str] = Header(None)):
    check_own(authorization, user_id)
    db = SessionLocal()
    user = db.query(User).get(user_id)
    if not user:
        db.close()
        raise HTTPException(404, "Пользователь не найден")

    user.name = p.name
    user.gender = p.gender
    user.age = p.age
    user.weight = p.weight
    user.height = p.height
    user.experience = p.experience
    user.goal = p.goal
    user.days_per_week = p.days_per_week
    user.equipment = json.dumps(p.equipment)
    user.injuries = json.dumps(p.injuries)

    db.commit()
    db.close()
    return {"ok": True}


@app.get("/api/plan/{user_id}")
def get_plan(user_id: int, authorization: Optional[str] = Header(None)):
    check_own(authorization, user_id)
    profile = _get_profile_data(user_id)
    return generate_plan(profile)


# ===== ЧАТ С ТРЕНЕРОМ =====

@app.post("/api/chat")
async def chat(c: ChatIn, authorization: Optional[str] = Header(None)):
    check_own(authorization, c.user_id)
    profile = _get_profile_data(c.user_id)

    db = SessionLocal()
    db_messages = (
        db.query(ChatMessage)
        .filter_by(user_id=c.user_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )
    history = [{"role": m.role, "content": m.content} for m in db_messages][-10:]

    db.add(ChatMessage(user_id=c.user_id, role="user", content=c.message))
    db.commit()
    db.close()

    reply = await ask_ai_trainer(c.message, profile, history)

    db = SessionLocal()
    db.add(ChatMessage(user_id=c.user_id, role="assistant", content=reply))
    db.commit()
    db.close()

    return {"reply": reply}


@app.get("/api/chat/history/{user_id}")
def get_chat_history(user_id: int, authorization: Optional[str] = Header(None)):
    check_own(authorization, user_id)
    db = SessionLocal()
    rows = (
        db.query(ChatMessage)
        .filter_by(user_id=user_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )
    db.close()
    return [
        {"id": r.id, "role": r.role, "content": r.content,
         "date": r.created_at.isoformat()}
        for r in rows
    ]


@app.delete("/api/chat/history/{user_id}")
def clear_chat_history(user_id: int, authorization: Optional[str] = Header(None)):
    check_own(authorization, user_id)
    db = SessionLocal()
    db.query(ChatMessage).filter_by(user_id=user_id).delete()
    db.commit()
    db.close()
    return {"ok": True}


# ===== ДНЕВНИК ТРЕНИРОВОК =====

@app.post("/api/log")
def add_log(l: LogIn, authorization: Optional[str] = Header(None)):
    check_own(authorization, l.user_id)
    db = SessionLocal()
    log = WorkoutLog(
        user_id=l.user_id, exercise=l.exercise,
        weight=l.weight, reps=l.reps, sets=l.sets, notes=l.notes,
    )
    db.add(log)
    db.commit()
    db.close()
    return {"ok": True}


@app.get("/api/logs/{user_id}")
def get_logs(user_id: int, authorization: Optional[str] = Header(None)):
    check_own(authorization, user_id)
    db = SessionLocal()
    rows = db.query(WorkoutLog).filter_by(user_id=user_id).order_by(WorkoutLog.date.desc()).all()
    db.close()
    return [
        {"id": r.id, "exercise": r.exercise, "weight": r.weight, "reps": r.reps,
         "sets": r.sets, "date": r.date.isoformat(), "notes": r.notes}
        for r in rows
    ]


@app.delete("/api/log/{log_id}")
def delete_log(log_id: int, authorization: Optional[str] = Header(None)):
    token_user_id = require_auth(authorization)
    db = SessionLocal()
    log = db.query(WorkoutLog).get(log_id)
    if not log:
        db.close()
        raise HTTPException(404, "Запись не найдена")
    if log.user_id != token_user_id:
        db.close()
        raise HTTPException(403, "Доступ запрещён")
    db.delete(log)
    db.commit()
    db.close()
    return {"ok": True}


@app.get("/api/stats/{user_id}")
def get_stats(user_id: int, authorization: Optional[str] = Header(None)):
    check_own(authorization, user_id)
    db = SessionLocal()
    rows = db.query(WorkoutLog).filter_by(user_id=user_id).order_by(WorkoutLog.date.asc()).all()
    db.close()

    by_exercise = {}
    for r in rows:
        if r.exercise not in by_exercise:
            by_exercise[r.exercise] = []
        by_exercise[r.exercise].append({
            "date": r.date.isoformat(),
            "weight": r.weight,
            "reps": r.reps,
            "sets": r.sets,
        })

    result = []
    for ex_name, history in by_exercise.items():
        max_weight = max(h["weight"] for h in history)
        total_volume = sum(h["weight"] * h["reps"] * h["sets"] for h in history)
        result.append({
            "exercise": ex_name,
            "max_weight": max_weight,
            "total_volume": round(total_volume, 1),
            "sessions": len(history),
            "history": history,
        })

    result.sort(key=lambda x: x["exercise"])
    return result


# ===== ПИТАНИЕ =====

@app.post("/api/meal")
def add_meal(m: MealIn, authorization: Optional[str] = Header(None)):
    check_own(authorization, m.user_id)
    db = SessionLocal()
    meal = Meal(
        user_id=m.user_id, name=m.name, grams=m.grams,
        calories=m.calories, protein=m.protein, fat=m.fat, carbs=m.carbs,
    )
    db.add(meal)
    db.commit()
    db.close()
    return {"ok": True}


@app.get("/api/meals/{user_id}")
def get_meals(user_id: int, authorization: Optional[str] = Header(None)):
    check_own(authorization, user_id)
    db = SessionLocal()
    rows = db.query(Meal).filter_by(user_id=user_id).order_by(Meal.date.desc()).all()
    db.close()
    return [
        {"id": r.id, "name": r.name, "grams": r.grams,
         "calories": r.calories, "protein": r.protein,
         "fat": r.fat, "carbs": r.carbs,
         "date": r.date.isoformat()}
        for r in rows
    ]


@app.delete("/api/meal/{meal_id}")
def delete_meal(meal_id: int, authorization: Optional[str] = Header(None)):
    token_user_id = require_auth(authorization)
    db = SessionLocal()
    meal = db.query(Meal).get(meal_id)
    if not meal:
        db.close()
        raise HTTPException(404, "Запись не найдена")
    if meal.user_id != token_user_id:
        db.close()
        raise HTTPException(403, "Доступ запрещён")
    db.delete(meal)
    db.commit()
    db.close()
    return {"ok": True}


@app.get("/api/nutrition/{user_id}")
def get_nutrition(user_id: int, authorization: Optional[str] = Header(None)):
    check_own(authorization, user_id)
    profile = _get_profile_data(user_id)

    if profile["gender"] == "male":
        bmr = 10 * profile["weight"] + 6.25 * profile["height"] - 5 * profile["age"] + 5
    else:
        bmr = 10 * profile["weight"] + 6.25 * profile["height"] - 5 * profile["age"] - 161

    days = profile["days_per_week"]
    if days <= 2:
        activity = 1.375
    elif days <= 4:
        activity = 1.55
    elif days <= 5:
        activity = 1.725
    else:
        activity = 1.9

    tdee = bmr * activity

    goal = profile["goal"]
    if goal == "weight_loss":
        target_calories = tdee - 400
    elif goal == "muscle_gain":
        target_calories = tdee + 300
    else:
        target_calories = tdee

    protein_g = profile["weight"] * 2.0
    fat_g = profile["weight"] * 1.0
    carbs_g = (target_calories - protein_g * 4 - fat_g * 9) / 4

    return {
        "target_calories": round(target_calories),
        "tdee": round(tdee),
        "bmr": round(bmr),
        "protein": round(protein_g),
        "fat": round(fat_g),
        "carbs": round(carbs_g),
        "goal": goal,
    }


@app.get("/api/meals/history/{user_id}")
def get_meals_history(user_id: int, days: int = 7, authorization: Optional[str] = Header(None)):
    check_own(authorization, user_id)
    db = SessionLocal()
    cutoff = datetime.utcnow() - timedelta(days=days)
    rows = (
        db.query(Meal)
        .filter(Meal.user_id == user_id, Meal.date >= cutoff)
        .order_by(Meal.date.asc())
        .all()
    )
    db.close()

    by_day = {}
    for r in rows:
        day = r.date.date().isoformat()
        if day not in by_day:
            by_day[day] = {
                "date": day, "calories": 0, "protein": 0,
                "fat": 0, "carbs": 0, "meals_count": 0,
            }
        by_day[day]["calories"] += r.calories or 0
        by_day[day]["protein"] += r.protein or 0
        by_day[day]["fat"] += r.fat or 0
        by_day[day]["carbs"] += r.carbs or 0
        by_day[day]["meals_count"] += 1

    result = []
    today = datetime.utcnow().date()
    for i in range(days - 1, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        if d in by_day:
            entry = by_day[d]
            entry["calories"] = round(entry["calories"])
            entry["protein"] = round(entry["protein"], 1)
            entry["fat"] = round(entry["fat"], 1)
            entry["carbs"] = round(entry["carbs"], 1)
            result.append(entry)
        else:
            result.append({
                "date": d, "calories": 0, "protein": 0,
                "fat": 0, "carbs": 0, "meals_count": 0,
            })

    days_with_food = [r for r in result if r["meals_count"] > 0]
    if days_with_food:
        avg = {
            "calories": round(sum(r["calories"] for r in days_with_food) / len(days_with_food)),
            "protein": round(sum(r["protein"] for r in days_with_food) / len(days_with_food), 1),
            "fat": round(sum(r["fat"] for r in days_with_food) / len(days_with_food), 1),
            "carbs": round(sum(r["carbs"] for r in days_with_food) / len(days_with_food), 1),
            "days_tracked": len(days_with_food),
        }
    else:
        avg = {"calories": 0, "protein": 0, "fat": 0, "carbs": 0, "days_tracked": 0}

    return {"days": result, "average": avg}


# ===== БАЗА ПРОДУКТОВ =====

@app.get("/api/foods")
def search_foods(q: str = ""):
    path = Path(__file__).parent / "foods.json"
    foods = json.loads(path.read_text(encoding="utf-8"))

    if q:
        q_lower = q.lower()
        foods = [f for f in foods if q_lower in f["name"].lower()]

    return foods[:30]


# ===== БАЗА УПРАЖНЕНИЙ =====

@app.get("/api/exercises")
def get_exercises(q: str = "", limit: int = 200):
    path = Path(__file__).parent / "exercises.json"
    exercises = json.loads(path.read_text(encoding="utf-8"))

    if q:
        q_lower = q.lower()
        exercises = [e for e in exercises if q_lower in e["name"].lower()]

    return exercises[:limit]


# ===== АВТОРИЗАЦИЯ =====

@app.post("/api/register")
def register(r: RegisterIn):
    db = SessionLocal()

    existing = db.query(User).filter_by(email=r.email.lower()).first()
    if existing:
        db.close()
        raise HTTPException(400, "Этот email уже зарегистрирован")

    if r.link_user_id:
        user = db.query(User).get(r.link_user_id)
        if not user:
            db.close()
            raise HTTPException(404, "Старый профиль не найден")
        user.email = r.email.lower()
        user.password_hash = hash_password(r.password)
        user.name = r.name
        user.gender = r.gender
        user.age = r.age
        user.weight = r.weight
        user.height = r.height
        user.experience = r.experience
        user.goal = r.goal
        user.days_per_week = r.days_per_week
        user.equipment = json.dumps(r.equipment)
        user.injuries = json.dumps(r.injuries)
    else:
        user = User(
            email=r.email.lower(),
            password_hash=hash_password(r.password),
            name=r.name, gender=r.gender, age=r.age,
            weight=r.weight, height=r.height,
            experience=r.experience, goal=r.goal,
            days_per_week=r.days_per_week,
            equipment=json.dumps(r.equipment),
            injuries=json.dumps(r.injuries),
        )
        db.add(user)

    db.commit()
    db.refresh(user)
    user_id = user.id
    db.close()

    return {
        "token": create_token(user_id),
        "user_id": user_id,
    }


@app.post("/api/login")
def login(l: LoginIn):
    db = SessionLocal()
    user = db.query(User).filter_by(email=l.email.lower()).first()
    db.close()

    if not user or not verify_password(l.password, user.password_hash):
        raise HTTPException(401, "Неверный email или пароль")

    return {
        "token": create_token(user.id),
        "user_id": user.id,
    }


@app.get("/api/me")
def get_me(authorization: Optional[str] = Header(None)):
    user_id = require_auth(authorization)
    return _get_profile_data(user_id)


# ===== ДОСТИЖЕНИЯ =====

@app.get("/api/achievements/{user_id}")
def get_achievements(user_id: int, authorization: Optional[str] = Header(None)):
    check_own(authorization, user_id)
    db = SessionLocal()
    user = db.query(User).get(user_id)
    if not user:
        db.close()
        raise HTTPException(404, "Пользователь не найден")

    workouts = db.query(WorkoutLog).filter_by(user_id=user_id).all()
    meals = db.query(Meal).filter_by(user_id=user_id).all()
    db.close()

    active_dates = set()
    for w in workouts:
        if w.date:
            active_dates.add(w.date.date())
    for m in meals:
        if m.date:
            active_dates.add(m.date.date())

    streak = 0
    today = datetime.utcnow().date()
    check_date = today if today in active_dates else today - timedelta(days=1)
    while check_date in active_dates:
        streak += 1
        check_date -= timedelta(days=1)

    total_workouts = len(workouts)
    total_tonnage = 0
    max_weight = 0
    for w in workouts:
        total_tonnage += (w.weight or 0) * (w.reps or 0) * (w.sets or 0)
        if (w.weight or 0) > max_weight:
            max_weight = w.weight or 0
    total_tonnage = round(total_tonnage)

    by_exercise = {}
    for w in workouts:
        by_exercise.setdefault(w.exercise, []).append(w.weight or 0)
    progressed_exercises = 0
    for name, weights in by_exercise.items():
        if is_cardio(name):
            continue
        rises = 0
        for i in range(1, len(weights)):
            if weights[i] > weights[i-1]:
                rises += 1
        if rises >= 2:
            progressed_exercises += 1

    meal_dates = sorted({m.date.date() for m in meals if m.date})
    nutrition_streak = 0
    if meal_dates:
        current = 1
        max_streak = 1
        for i in range(1, len(meal_dates)):
            if meal_dates[i] - meal_dates[i-1] == timedelta(days=1):
                current += 1
                max_streak = max(max_streak, current)
            else:
                current = 1
        nutrition_streak = max_streak

    unique_meal_days = len(set(m.date.date() for m in meals if m.date))

    achievements = [
        {"id": "first_workout", "title": "Первая тренировка", "icon": "🥇",
         "done": total_workouts >= 1, "progress": min(total_workouts, 1), "target": 1},
        {"id": "workouts_10", "title": "10 тренировок", "icon": "💪",
         "done": total_workouts >= 10, "progress": min(total_workouts, 10), "target": 10},
        {"id": "workouts_50", "title": "50 тренировок", "icon": "🏋️",
         "done": total_workouts >= 50, "progress": min(total_workouts, 50), "target": 50},
        {"id": "streak_7", "title": "Серия 7 дней", "icon": "🔥",
         "done": streak >= 7, "progress": min(streak, 7), "target": 7},
        {"id": "streak_30", "title": "Серия 30 дней", "icon": "🔥🔥",
         "done": streak >= 30, "progress": min(streak, 30), "target": 30},
        {"id": "tonnage_100", "title": "100 тонн поднято", "icon": "💯",
         "done": total_tonnage >= 100000, "progress": min(total_tonnage, 100000), "target": 100000},
        {"id": "pr_50kg", "title": "50 кг в подходе", "icon": "🎯",
         "done": max_weight >= 50, "progress": min(round(max_weight), 50), "target": 50},
        {"id": "pr_100kg", "title": "100 кг в подходе", "icon": "🎯🎯",
         "done": max_weight >= 100, "progress": min(round(max_weight), 100), "target": 100},
        {"id": "progress_5", "title": "Прогресс в 5 упражнениях", "icon": "📈",
         "done": progressed_exercises >= 5, "progress": min(progressed_exercises, 5), "target": 5},
        {"id": "nutrition_week", "title": "Неделя питания", "icon": "🍎",
         "done": unique_meal_days >= 7, "progress": min(unique_meal_days, 7), "target": 7},
    ]

    earned_badges = [a["icon"] for a in achievements if a["done"]]

    return {
        "streak": streak,
        "total_workouts": total_workouts,
        "total_tonnage": total_tonnage,
        "max_weight": round(max_weight, 1),
        "progressed_exercises": progressed_exercises,
        "unique_meal_days": unique_meal_days,
        "nutrition_streak": nutrition_streak,
        "earned_count": len(earned_badges),
        "earned_badges": earned_badges,
        "achievements": achievements,
    }


def is_cardio(name: str) -> bool:
    if not name:
        return False
    n = name.lower()
    return n.startswith("кардио") or n.startswith("заминка") or "растяжка" in n


# ===== ФОТО ПРОГРЕССА =====

@app.post("/api/photos/upload")
async def upload_photo(
    authorization: Optional[str] = Header(None),
    user_id: int = Form(...),
    weight: Optional[float] = Form(None),
    note: Optional[str] = Form(None),
    file: UploadFile = File(...),
):
    check_own(authorization, user_id)

    db = SessionLocal()
    user = db.query(User).get(user_id)
    if not user:
        db.close()
        raise HTTPException(404, "Пользователь не найден")

    allowed = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
    ext = Path(file.filename or "").suffix.lower()
    if ext not in allowed:
        db.close()
        raise HTTPException(400, "Допустимы только JPG, PNG, WEBP, HEIC")

    stamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    uniq = uuid.uuid4().hex[:16]
    filename = f"user_{user_id}_{stamp}_{uniq}{ext}"
    dest = UPLOAD_DIR / filename

    try:
        with dest.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        db.close()
        raise HTTPException(500, f"Не удалось сохранить файл: {e}")
    finally:
        file.file.close()

    photo = ProgressPhoto(
        user_id=user_id,
        filename=filename,
        date=datetime.utcnow(),
        weight=weight,
        note=note or None,
        is_pinned=False,
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)
    photo_id = photo.id
    db.close()

    return {
        "ok": True,
        "id": photo_id,
        "filename": filename,
        "url": f"/uploads/{filename}",
    }


@app.get("/api/photos/{user_id}")
def list_photos(user_id: int, authorization: Optional[str] = Header(None)):
    check_own(authorization, user_id)
    db = SessionLocal()
    rows = (
        db.query(ProgressPhoto)
        .filter_by(user_id=user_id)
        .order_by(ProgressPhoto.is_pinned.desc(), ProgressPhoto.date.desc())
        .all()
    )
    db.close()
    return [
        {
            "id": r.id,
            "filename": r.filename,
            "url": f"/uploads/{r.filename}",
            "date": r.date.isoformat(),
            "weight": r.weight,
            "note": r.note,
            "is_pinned": bool(r.is_pinned),
        }
        for r in rows
    ]


@app.get("/api/photos/{user_id}/stats")
def photos_stats(user_id: int, authorization: Optional[str] = Header(None)):
    check_own(authorization, user_id)
    db = SessionLocal()
    rows = (
        db.query(ProgressPhoto)
        .filter_by(user_id=user_id)
        .order_by(ProgressPhoto.date.asc())
        .all()
    )
    db.close()

    if not rows:
        return {
            "count": 0, "first": None, "last": None,
            "weight_diff": None, "last_date": None,
        }

    first = rows[0]
    last = rows[-1]
    weight_diff = None
    if first.weight is not None and last.weight is not None:
        weight_diff = round(last.weight - first.weight, 1)

    return {
        "count": len(rows),
        "first": {
            "id": first.id, "url": f"/uploads/{first.filename}",
            "date": first.date.isoformat(), "weight": first.weight,
            "note": first.note,
        },
        "last": {
            "id": last.id, "url": f"/uploads/{last.filename}",
            "date": last.date.isoformat(), "weight": last.weight,
            "note": last.note,
        },
        "weight_diff": weight_diff,
        "last_date": last.date.isoformat(),
    }


@app.delete("/api/photos/{photo_id}")
def delete_photo(photo_id: int, authorization: Optional[str] = Header(None)):
    token_user_id = require_auth(authorization)
    db = SessionLocal()
    photo = db.query(ProgressPhoto).get(photo_id)
    if not photo:
        db.close()
        raise HTTPException(404, "Фото не найдено")
    if photo.user_id != token_user_id:
        db.close()
        raise HTTPException(403, "Доступ запрещён")

    file_path = UPLOAD_DIR / photo.filename
    if file_path.exists():
        try:
            file_path.unlink()
        except Exception as e:
            print(f"Не удалось удалить файл {file_path}: {e}")

    db.delete(photo)
    db.commit()
    db.close()
    return {"ok": True}


@app.post("/api/photos/{photo_id}/pin")
def pin_photo(photo_id: int, authorization: Optional[str] = Header(None)):
    token_user_id = require_auth(authorization)
    db = SessionLocal()
    photo = db.query(ProgressPhoto).get(photo_id)
    if not photo:
        db.close()
        raise HTTPException(404, "Фото не найдено")
    if photo.user_id != token_user_id:
        db.close()
        raise HTTPException(403, "Доступ запрещён")

    db.query(ProgressPhoto).filter_by(user_id=photo.user_id).update({"is_pinned": False})
    photo.is_pinned = True
    db.commit()
    db.close()
    return {"ok": True}
    # ===== КАЛЕНДАРЬ ТРЕНИРОВОК =====

@app.get("/api/calendar/{user_id}")
def get_calendar(
    user_id: int,
    year: int,
    month: int,
    authorization: Optional[str] = Header(None),
):
    """Возвращает сводку по дням месяца: тренировки / питание / фото / калории."""
    check_own(authorization, user_id)

    # Границы месяца
    start = datetime(year, month, 1)
    if month == 12:
        end = datetime(year + 1, 1, 1)
    else:
        end = datetime(year, month + 1, 1)

    db = SessionLocal()

    workouts = (
        db.query(WorkoutLog)
        .filter(WorkoutLog.user_id == user_id,
                WorkoutLog.date >= start, WorkoutLog.date < end)
        .all()
    )
    meals = (
        db.query(Meal)
        .filter(Meal.user_id == user_id,
                Meal.date >= start, Meal.date < end)
        .all()
    )
    photos = (
        db.query(ProgressPhoto)
        .filter(ProgressPhoto.user_id == user_id,
                ProgressPhoto.date >= start, ProgressPhoto.date < end)
        .all()
    )
    db.close()

    # Собираем словарь по дням
    days = {}

    def ensure(day_key):
        if day_key not in days:
            days[day_key] = {
                "workouts": 0, "meals": 0, "photos": 0, "calories": 0,
            }

    for w in workouts:
        key = w.date.date().isoformat()
        ensure(key)
        days[key]["workouts"] += 1

    for m in meals:
        key = m.date.date().isoformat()
        ensure(key)
        days[key]["meals"] += 1
        days[key]["calories"] += int(round(m.calories or 0))

    for p in photos:
        key = p.date.date().isoformat()
        ensure(key)
        days[key]["photos"] += 1

    return {
        "year": year,
        "month": month,
        "days": days,
    }


@app.get("/api/day/{user_id}")
def get_day(
    user_id: int,
    date: str,  # YYYY-MM-DD
    authorization: Optional[str] = Header(None),
):
    """Возвращает детали одного дня: тренировки, еда, фото."""
    check_own(authorization, user_id)

    try:
        d = datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "Неверный формат даты (ожидается YYYY-MM-DD)")

    start = datetime(d.year, d.month, d.day)
    end = start + timedelta(days=1)

    db = SessionLocal()

    workouts = (
        db.query(WorkoutLog)
        .filter(WorkoutLog.user_id == user_id,
                WorkoutLog.date >= start, WorkoutLog.date < end)
        .order_by(WorkoutLog.date.asc())
        .all()
    )
    meals = (
        db.query(Meal)
        .filter(Meal.user_id == user_id,
                Meal.date >= start, Meal.date < end)
        .order_by(Meal.date.asc())
        .all()
    )
    photos = (
        db.query(ProgressPhoto)
        .filter(ProgressPhoto.user_id == user_id,
                ProgressPhoto.date >= start, ProgressPhoto.date < end)
        .order_by(ProgressPhoto.date.asc())
        .all()
    )
    db.close()

    total_calories = sum(int(round(m.calories or 0)) for m in meals)
    total_protein = round(sum(m.protein or 0 for m in meals), 1)
    total_fat = round(sum(m.fat or 0 for m in meals), 1)
    total_carbs = round(sum(m.carbs or 0 for m in meals), 1)

    return {
        "date": date,
        "workouts": [
            {
                "id": w.id,
                "exercise": w.exercise,
                "weight": w.weight,
                "reps": w.reps,
                "sets": w.sets,
            }
            for w in workouts
        ],
        "meals": [
            {
                "id": m.id,
                "name": m.name,
                "grams": m.grams,
                "calories": m.calories,
                "protein": m.protein,
                "fat": m.fat,
                "carbs": m.carbs,
            }
            for m in meals
        ],
        "nutrition_totals": {
            "calories": total_calories,
            "protein": total_protein,
            "fat": total_fat,
            "carbs": total_carbs,
        },
        "photos": [
            {
                "id": p.id,
                "url": f"/uploads/{p.filename}",
                "weight": p.weight,
                "note": p.note,
            }
            for p in photos
        ],
    }
