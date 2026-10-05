import json
import os
import shutil
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pywebpush import webpush, WebPushException
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from pydantic import BaseModel
from typing import List, Optional

from database import init_db, SessionLocal, User, WorkoutLog, ChatMessage, Meal, ProgressPhoto, Achievement, PushSubscription, Recipe, PushLog, Client, ClientNote, ClientMeasurement
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

def check_trainer_owns_client(authorization: Optional[str], client_id: int) -> tuple:
    """Проверяет, что токен валиден И что user-тренер владеет клиентом.
    Возвращает (trainer_id, client). Или 403, если клиент чужой."""
    trainer_id = require_auth(authorization)
    db = SessionLocal()
    try:
        client = db.query(Client).get(client_id)
        if not client:
            raise HTTPException(404, "Клиент не найден")
        if client.trainer_id != trainer_id:
            raise HTTPException(403, "Это не ваш клиент")
        return trainer_id, client
    finally:
        db.close()


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
    role: Optional[str] = "self"


class LoginIn(BaseModel):
    email: str
    password: str

class ClientIn(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    goal: Optional[str] = None
    age: Optional[int] = None
    height: Optional[float] = None
    weight: Optional[float] = None
    notes: Optional[str] = None
    status: Optional[str] = "active"


class ClientNoteIn(BaseModel):
    text: str


class ClientMeasurementIn(BaseModel):
    weight: Optional[float] = None
    chest: Optional[float] = None
    waist: Optional[float] = None
    hips: Optional[float] = None
    arm: Optional[float] = None
    leg: Optional[float] = None
    note: Optional[str] = None


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
        "role": u.role or "self",
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
# ===== ГРУППЫ МЫШЦ =====

MUSCLE_LABELS = {
    "chest":     ("Грудь",       False),
    "back":      ("Спина",       False),
    "shoulders": ("Плечи",       False),
    "biceps":    ("Бицепс",      False),
    "triceps":   ("Трицепс",     False),
    "legs":      ("Ноги",        False),
    "core":      ("Пресс / Кор", False),
    "cardio":    ("Кардио",      True),
}


def load_exercises_raw() -> list:
    """Читает exercises.json целиком."""
    path = Path(__file__).parent / "exercises.json"
    return json.loads(path.read_text(encoding="utf-8"))


def load_exercise_muscle_map() -> dict:
    """Возвращает {название упражнения: muscle_id}."""
    return {e["name"]: e.get("muscle", "other") for e in load_exercises_raw()}


@app.get("/api/muscle-groups/{user_id}")
def get_muscle_groups(
    user_id: int,
    days: int = 30,
    authorization: Optional[str] = Header(None),
):
    """Аналитика по группам мышц: тоннаж, %, статус, рекомендации."""
    check_own(authorization, user_id)

    db = SessionLocal()
    cutoff = datetime.utcnow() - timedelta(days=days) if days > 0 else None
    q = db.query(WorkoutLog).filter(WorkoutLog.user_id == user_id)
    if cutoff:
        q = q.filter(WorkoutLog.date >= cutoff)
    logs = q.all()
    db.close()

    muscle_map = load_exercise_muscle_map()

    groups = {}
    total_tonnage_silovoy = 0.0

    for log in logs:
        muscle = muscle_map.get(log.exercise, "other")
        if muscle not in MUSCLE_LABELS:
            continue

        is_cardio = MUSCLE_LABELS[muscle][1]

        g = groups.setdefault(muscle, {
            "exercises_count": 0,
            "unique": set(),
            "tonnage": 0.0,
            "last_date": None,
        })
        g["exercises_count"] += 1
        g["unique"].add(log.exercise)

        if not is_cardio:
            tonnage = (log.weight or 0) * (log.reps or 0) * (log.sets or 0)
            g["tonnage"] += tonnage
            total_tonnage_silovoy += tonnage

        if log.date and (g["last_date"] is None or log.date > g["last_date"]):
            g["last_date"] = log.date

    silovye = [m for m, (_, is_c) in MUSCLE_LABELS.items() if not is_c]
    n_silovykh = len(silovye)
    avg_percent = round(100 / n_silovykh, 2) if n_silovykh else 0

    result_groups = []
    recommendations = []

    for muscle_id, (label, is_cardio) in MUSCLE_LABELS.items():
        g = groups.get(muscle_id)

        if not g:
            entry = {
                "muscle_group": muscle_id,
                "label": label,
                "is_cardio": is_cardio,
                "exercises_count": 0,
                "unique_exercises": 0,
                "tonnage": 0,
                "last_date": None,
                "percent": 0 if not is_cardio else None,
                "status": "under" if not is_cardio else None,
            }
        else:
            if is_cardio:
                percent = None
                status = None
            else:
                percent = (
                    round(g["tonnage"] / total_tonnage_silovoy * 100, 2)
                    if total_tonnage_silovoy > 0 else 0
                )
                if percent < avg_percent * 0.5:
                    status = "under"
                elif percent > avg_percent * 1.8:
                    status = "over"
                else:
                    status = "norm"

            entry = {
                "muscle_group": muscle_id,
                "label": label,
                "is_cardio": is_cardio,
                "exercises_count": g["exercises_count"],
                "unique_exercises": len(g["unique"]),
                "tonnage": round(g["tonnage"], 1),
                "last_date": g["last_date"].date().isoformat() if g["last_date"] else None,
                "percent": percent,
                "status": status,
            }

        result_groups.append(entry)

        if entry["status"] == "under":
            all_ex = [e for e in load_exercises_raw() if e.get("muscle") == muscle_id]
            all_ex.sort(
                key=lambda e: {"beginner": 0, "intermediate": 1, "advanced": 2}
                .get(e.get("difficulty"), 1)
            )
            top3 = [e["name"] for e in all_ex[:3]]
            recommendations.append({
                "muscle_group": muscle_id,
                "label": label,
                "text": f"{label} отстаёт: {entry['percent']}% объёма против {avg_percent}% в среднем",
                "exercises": top3,
            })

    result_groups.sort(key=lambda x: (x["is_cardio"], -(x["percent"] or 0)))

    return {
        "period_days": days,
        "total_tonnage": round(total_tonnage_silovoy, 1),
        "avg_percent": avg_percent,
        "groups": result_groups,
        "recommendations": recommendations,
    }

    # ===== ТРЕНЕР: КЛИЕНТЫ =====

@app.get("/api/trainer/clients")
def list_clients(
    status: Optional[str] = None,
    authorization: Optional[str] = Header(None),
):
    """Список клиентов текущего тренера. Параметр status: active / archived."""
    trainer_id = require_auth(authorization)
    db = SessionLocal()
    try:
        q = db.query(Client).filter(Client.trainer_id == trainer_id)
        if status:
            q = q.filter(Client.status == status)
        rows = q.order_by(Client.status.asc(), Client.name.asc()).all()

        result = []
        for c in rows:
            # Последняя тренировка (для отображения в списке)
            last_note = (
                db.query(ClientNote)
                .filter(ClientNote.client_id == c.id)
                .order_by(ClientNote.date.desc())
                .first()
            )
            result.append({
                "id": c.id,
                "name": c.name,
                "phone": c.phone,
                "email": c.email,
                "goal": c.goal,
                "age": c.age,
                "height": c.height,
                "weight": c.weight,
                "status": c.status,
                "notes": c.notes,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "last_note_date": last_note.date.isoformat() if last_note else None,
                "last_note_text": last_note.text if last_note else None,
            })
        return result
    finally:
        db.close()


@app.post("/api/trainer/clients")
def create_client(
    data: ClientIn,
    authorization: Optional[str] = Header(None),
):
    """Создаёт нового клиента. Привязан к текущему тренеру."""
    trainer_id = require_auth(authorization)
    db = SessionLocal()
    try:
        client = Client(
            trainer_id=trainer_id,
            name=data.name,
            phone=data.phone,
            email=data.email,
            goal=data.goal,
            age=data.age,
            height=data.height,
            weight=data.weight,
            notes=data.notes,
            status=data.status or "active",
        )
        db.add(client)
        db.commit()
        db.refresh(client)
        return {"ok": True, "id": client.id}
    finally:
        db.close()


@app.get("/api/trainer/clients/{client_id}")
def get_client(
    client_id: int,
    authorization: Optional[str] = Header(None),
):
    """Карточка клиента с заметками и замерами."""
    _, client = check_trainer_owns_client(authorization, client_id)
    db = SessionLocal()
    try:
        notes = (
            db.query(ClientNote)
            .filter(ClientNote.client_id == client_id)
            .order_by(ClientNote.date.desc())
            .all()
        )
        measurements = (
            db.query(ClientMeasurement)
            .filter(ClientMeasurement.client_id == client_id)
            .order_by(ClientMeasurement.date.desc())
            .all()
        )
        return {
            "id": client.id,
            "name": client.name,
            "phone": client.phone,
            "email": client.email,
            "goal": client.goal,
            "age": client.age,
            "height": client.height,
            "weight": client.weight,
            "notes": client.notes,
            "status": client.status,
            "created_at": client.created_at.isoformat() if client.created_at else None,
            "notes_list": [
                {"id": n.id, "date": n.date.isoformat(), "text": n.text}
                for n in notes
            ],
            "measurements": [
                {
                    "id": m.id,
                    "date": m.date.isoformat(),
                    "weight": m.weight,
                    "chest": m.chest,
                    "waist": m.waist,
                    "hips": m.hips,
                    "arm": m.arm,
                    "leg": m.leg,
                    "note": m.note,
                }
                for m in measurements
            ],
        }
    finally:
        db.close()


@app.put("/api/trainer/clients/{client_id}")
def update_client(
    client_id: int,
    data: ClientIn,
    authorization: Optional[str] = Header(None),
):
    """Обновляет карточку клиента."""
    _, client = check_trainer_owns_client(authorization, client_id)
    db = SessionLocal()
    try:
        client.name = data.name
        client.phone = data.phone
        client.email = data.email
        client.goal = data.goal
        client.age = data.age
        client.height = data.height
        client.weight = data.weight
        client.notes = data.notes
        if data.status:
            client.status = data.status
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@app.delete("/api/trainer/clients/{client_id}")
def delete_client(
    client_id: int,
    authorization: Optional[str] = Header(None),
):
    """Удаляет клиента вместе с его заметками и замерами."""
    _, client = check_trainer_owns_client(authorization, client_id)
    db = SessionLocal()
    try:
        db.query(ClientNote).filter(ClientNote.client_id == client_id).delete()
        db.query(ClientMeasurement).filter(ClientMeasurement.client_id == client_id).delete()
        db.delete(client)
        db.commit()
        return {"ok": True}
    finally:
        db.close()


# ===== ТРЕНЕР: ЗАМЕТКИ =====

@app.get("/api/trainer/clients/{client_id}/notes")
def list_notes(
    client_id: int,
    authorization: Optional[str] = Header(None),
):
    check_trainer_owns_client(authorization, client_id)
    db = SessionLocal()
    try:
        rows = (
            db.query(ClientNote)
            .filter(ClientNote.client_id == client_id)
            .order_by(ClientNote.date.desc())
            .all()
        )
        return [
            {"id": n.id, "date": n.date.isoformat(), "text": n.text}
            for n in rows
        ]
    finally:
        db.close()


@app.post("/api/trainer/clients/{client_id}/notes")
def add_note(
    client_id: int,
    data: ClientNoteIn,
    authorization: Optional[str] = Header(None),
):
    check_trainer_owns_client(authorization, client_id)
    db = SessionLocal()
    try:
        note = ClientNote(client_id=client_id, text=data.text)
        db.add(note)
        db.commit()
        db.refresh(note)
        return {"ok": True, "id": note.id, "date": note.date.isoformat()}
    finally:
        db.close()


@app.delete("/api/trainer/notes/{note_id}")
def delete_note(
    note_id: int,
    authorization: Optional[str] = Header(None),
):
    trainer_id = require_auth(authorization)
    db = SessionLocal()
    try:
        note = db.query(ClientNote).get(note_id)
        if not note:
            raise HTTPException(404, "Заметка не найдена")
        client = db.query(Client).get(note.client_id)
        if not client or client.trainer_id != trainer_id:
            raise HTTPException(403, "Доступ запрещён")
        db.delete(note)
        db.commit()
        return {"ok": True}
    finally:
        db.close()


# ===== ТРЕНЕР: ЗАМЕРЫ =====

@app.get("/api/trainer/clients/{client_id}/measurements")
def list_measurements(
    client_id: int,
    authorization: Optional[str] = Header(None),
):
    check_trainer_owns_client(authorization, client_id)
    db = SessionLocal()
    try:
        rows = (
            db.query(ClientMeasurement)
            .filter(ClientMeasurement.client_id == client_id)
            .order_by(ClientMeasurement.date.desc())
            .all()
        )
        return [
            {
                "id": m.id,
                "date": m.date.isoformat(),
                "weight": m.weight,
                "chest": m.chest,
                "waist": m.waist,
                "hips": m.hips,
                "arm": m.arm,
                "leg": m.leg,
                "note": m.note,
            }
            for m in rows
        ]
    finally:
        db.close()


@app.post("/api/trainer/clients/{client_id}/measurements")
def add_measurement(
    client_id: int,
    data: ClientMeasurementIn,
    authorization: Optional[str] = Header(None),
):
    check_trainer_owns_client(authorization, client_id)
    db = SessionLocal()
    try:
        m = ClientMeasurement(
            client_id=client_id,
            weight=data.weight,
            chest=data.chest,
            waist=data.waist,
            hips=data.hips,
            arm=data.arm,
            leg=data.leg,
            note=data.note,
        )
        db.add(m)
        db.commit()
        db.refresh(m)
        return {"ok": True, "id": m.id, "date": m.date.isoformat()}
    finally:
        db.close()


@app.delete("/api/trainer/measurements/{measurement_id}")
def delete_measurement(
    measurement_id: int,
    authorization: Optional[str] = Header(None),
):
    trainer_id = require_auth(authorization)
    db = SessionLocal()
    try:
        m = db.query(ClientMeasurement).get(measurement_id)
        if not m:
            raise HTTPException(404, "Замер не найден")
        client = db.query(Client).get(m.client_id)
        if not client or client.trainer_id != trainer_id:
            raise HTTPException(403, "Доступ запрещён")
        db.delete(m)
        db.commit()
        return {"ok": True}
    finally:
        db.close()



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
        user.role = r.role or "self" 
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
            role=r.role or "self",
        )
        db.add(user)

    db.commit()
    db.refresh(user)
    user_id = user.id
    db.close()

    return {
        "token": create_token(user_id),
        "user_id": user_id,
        "role": user.role or "self",
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
    # === ЗАПИСЬ НОВЫХ ДОСТИЖЕНИЙ В БД ===
    # Открываем свежую сессию, т.к. db уже закрыта
    db2 = SessionLocal()
    existing = {
        row.achievement_id
        for row in db2.query(Achievement).filter_by(user_id=user_id).all()
    }
    newly_earned = []
    for a in achievements:
        if a["done"] and a["id"] not in existing:
            db2.add(Achievement(
                user_id=user_id,
                achievement_id=a["id"],
                earned_at=datetime.utcnow(),
            ))
            newly_earned.append(a["id"])
    if newly_earned:
        db2.commit()
    db2.close()
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

    # ===== ДАТЫ ДОСТИЖЕНИЙ =====

@app.get("/api/achievements/dates/{user_id}")
def get_achievement_dates(user_id: int, authorization: Optional[str] = Header(None)):
    """Возвращает словарь { "2026-09-26": ["first_workout", "workouts_10"] } — 
    дни, когда были получены достижения."""
    check_own(authorization, user_id)
    db = SessionLocal()
    rows = db.query(Achievement).filter_by(user_id=user_id).all()
    db.close()

    by_day = {}
    for r in rows:
        key = r.earned_at.date().isoformat()
        if key not in by_day:
            by_day[key] = []
        by_day[key].append(r.achievement_id)

    return by_day

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


# ===== PUSH-УВЕДОМЛЕНИЯ =====

VAPID_PRIVATE_KEY_PATH = Path(__file__).parent / "private_key.pem"
VAPID_PUBLIC_KEY_PATH = Path(__file__).parent / "public_key.pem"
VAPID_CLAIM_EMAIL = "mailto:alena@fitsolo.app"


def _load_vapid_public_key() -> str:
    """Читает публичный VAPID-ключ из файла, возвращает base64url-строку."""
    import base64
    from cryptography.hazmat.primitives.serialization import (
        load_pem_public_key, Encoding, PublicFormat,
    )
    with open(VAPID_PUBLIC_KEY_PATH, "rb") as f:
        pub = load_pem_public_key(f.read())
    raw = pub.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def send_push(user_id: int, title: str, body: str, url: str = "/"):
    """Отправляет push всем подпискам юзера. Возвращает (sent, failed)."""
    db = SessionLocal()
    subs = db.query(PushSubscription).filter_by(user_id=user_id).all()
    db.close()

    if not subs:
        return 0, 0

    sent = 0
    failed = 0
    dead_endpoints = []

    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {
                        "p256dh": sub.p256dh,
                        "auth": sub.auth,
                    },
                },
                data=json.dumps({
                    "title": title,
                    "body": body,
                    "url": url,
                }),
                vapid_private_key=str(VAPID_PRIVATE_KEY_PATH),
                vapid_claims={"sub": VAPID_CLAIM_EMAIL},
            )
            sent += 1
        except WebPushException as e:
            failed += 1
            # 404/410 = подписка мертва, удаляем
            if e.response is not None and e.response.status_code in (404, 410):
                dead_endpoints.append(sub.endpoint)
            else:
                print(f"Push error для {sub.endpoint[:40]}...: {e}")
        except Exception as e:
            failed += 1
            print(f"Push unknown error: {e}")

    # Чистим мёртвые подписки
    if dead_endpoints:
        db = SessionLocal()
        db.query(PushSubscription).filter(
            PushSubscription.endpoint.in_(dead_endpoints)
        ).delete(synchronize_session=False)
        db.commit()
        db.close()

    return sent, failed


@app.get("/api/push/public-key")
def get_push_public_key():
    """Публичный VAPID-ключ для фронта. Не требует авторизации."""
    try:
        key = _load_vapid_public_key()
        return {"public_key": key}
    except Exception as e:
        raise HTTPException(500, f"VAPID key error: {e}")


class PushSubscribeIn(BaseModel):
    user_id: int
    endpoint: str
    p256dh: str
    auth: str


@app.post("/api/push/subscribe")
def push_subscribe(
    data: PushSubscribeIn,
    authorization: Optional[str] = Header(None),
):
    """Сохраняет подписку. Если endpoint уже есть — обновляет."""
    check_own(authorization, data.user_id)

    db = SessionLocal()
    try:
        existing = db.query(PushSubscription).filter_by(
            endpoint=data.endpoint
        ).first()

        if existing:
            existing.user_id = data.user_id
            existing.p256dh = data.p256dh
            existing.auth = data.auth
        else:
            db.add(PushSubscription(
                user_id=data.user_id,
                endpoint=data.endpoint,
                p256dh=data.p256dh,
                auth=data.auth,
            ))
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@app.post("/api/push/unsubscribe")
def push_unsubscribe(
    data: PushSubscribeIn,
    authorization: Optional[str] = Header(None),
):
    """Удаляет подписку по endpoint."""
    check_own(authorization, data.user_id)

    db = SessionLocal()
    try:
        db.query(PushSubscription).filter_by(
            endpoint=data.endpoint
        ).delete(synchronize_session=False)
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@app.post("/api/push/test/{user_id}")
def push_test(
    user_id: int,
    authorization: Optional[str] = Header(None),
):
    """Тестовый push — для отладки. Отправит уведомление самому себе."""
    check_own(authorization, user_id)

    sent, failed = send_push(
        user_id,
        title="🏋️ FitSolo",
        body="Это тестовое уведомление. Если видишь его — push работает!",
        url="/",
    )

    return {"sent": sent, "failed": failed}


# ===== РЕЦЕПТЫ =====

def seed_recipes_if_empty():
    """Загружает recipes_seed.json в БД, если таблица пуста."""
    db = SessionLocal()
    try:
        count = db.query(Recipe).count()
        if count > 0:
            print(f"Рецепты уже загружены: {count}")
            return

        seed_path = Path(__file__).parent / "recipes_seed.json"
        if not seed_path.exists():
            print("recipes_seed.json не найден — пропускаю")
            return

        data = json.loads(seed_path.read_text(encoding="utf-8"))
        for r in data:
            db.add(Recipe(
                slug=r["slug"],
                name=r["name"],
                category=r["category"],
                tags=json.dumps(r.get("tags", []), ensure_ascii=False),
                time_min=r.get("time_min"),
                servings=r.get("servings", 1),
                ingredients=json.dumps(r.get("ingredients", []), ensure_ascii=False),
                calories=r.get("calories"),
                protein=r.get("protein"),
                fat=r.get("fat"),
                carbs=r.get("carbs"),
                steps=json.dumps(r.get("steps", []), ensure_ascii=False),
                photo_url=r.get("photo_url"),
            ))
        db.commit()
        print(f"Загружено {len(data)} рецептов")
    except Exception as e:
        print(f"Ошибка загрузки рецептов: {e}")
        db.rollback()
    finally:
        db.close()


def _recipe_to_dict(r: Recipe) -> dict:
    """Преобразует модель Recipe в dict с распарсенными JSON-полями."""
    return {
        "id": r.id,
        "slug": r.slug,
        "name": r.name,
        "category": r.category,
        "tags": json.loads(r.tags or "[]"),
        "time_min": r.time_min,
        "servings": r.servings,
        "ingredients": json.loads(r.ingredients or "[]"),
        "calories": r.calories,
        "protein": r.protein,
        "fat": r.fat,
        "carbs": r.carbs,
        "steps": json.loads(r.steps or "[]"),
        "photo_url": r.photo_url,
    }


@app.get("/api/recipes")
def get_recipes(
    q: str = "",
    category: str = "",
    tag: str = "",
    max_cal: int = 0,
    limit: int = 200,
):
    """Список рецептов с фильтрами. Не требует авторизации."""
    db = SessionLocal()
    try:
        query = db.query(Recipe)

        if category:
            query = query.filter(Recipe.category == category)

        if max_cal > 0:
            query = query.filter(Recipe.calories <= max_cal)

        # Фильтры по q и tag — на Python, потому что tags — JSON-строка
        rows = query.order_by(Recipe.name.asc()).all()

        if q:
            q_lower = q.lower()
            rows = [r for r in rows if q_lower in r.name.lower()]

        if tag:
            rows = [r for r in rows if tag in json.loads(r.tags or "[]")]

        return [_recipe_to_dict(r) for r in rows[:limit]]
    finally:
        db.close()


@app.get("/api/recipes/{slug}")
def get_recipe(slug: str):
    """Один рецепт по slug. Не требует авторизации."""
    db = SessionLocal()
    try:
        r = db.query(Recipe).filter_by(slug=slug).first()
        if not r:
            raise HTTPException(404, "Рецепт не найден")
        return _recipe_to_dict(r)
    finally:
        db.close()


# ===== ДЖОБЫ PUSH-УВЕДОМЛЕНИЙ =====

MSK = ZoneInfo("Europe/Moscow")


def _already_sent_today(user_id: int, job_name: str) -> bool:
    """Проверяет, отправляли ли сегодня этот тип push юзеру."""
    db = SessionLocal()
    try:
        today_start = datetime.now(MSK).replace(hour=0, minute=0, second=0, microsecond=0)
        today_start_utc = today_start.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
        exists = db.query(PushLog).filter(
            PushLog.user_id == user_id,
            PushLog.job_name == job_name,
            PushLog.sent_at >= today_start_utc,
        ).first()
        return exists is not None
    finally:
        db.close()


def _log_push_sent(user_id: int, job_name: str):
    """Пишет факт отправки в PushLog."""
    db = SessionLocal()
    try:
        db.add(PushLog(user_id=user_id, job_name=job_name))
        db.commit()
    finally:
        db.close()


def _has_workout_today(user_id: int) -> bool:
    """Была ли тренировка сегодня."""
    db = SessionLocal()
    try:
        today_start = datetime.now(MSK).replace(hour=0, minute=0, second=0, microsecond=0)
        today_start_utc = today_start.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
        count = db.query(WorkoutLog).filter(
            WorkoutLog.user_id == user_id,
            WorkoutLog.date >= today_start_utc,
        ).count()
        return count > 0
    finally:
        db.close()


def _has_workout_last_n_days(user_id: int, days: int) -> bool:
    """Была ли тренировка за последние N дней (включая сегодня)."""
    db = SessionLocal()
    try:
        cutoff = datetime.utcnow() - timedelta(days=days)
        count = db.query(WorkoutLog).filter(
            WorkoutLog.user_id == user_id,
            WorkoutLog.date >= cutoff,
        ).count()
        return count > 0
    finally:
        db.close()


def _has_meal_today(user_id: int) -> bool:
    """Добавлял ли юзер еду сегодня."""
    db = SessionLocal()
    try:
        today_start = datetime.now(MSK).replace(hour=0, minute=0, second=0, microsecond=0)
        today_start_utc = today_start.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
        count = db.query(Meal).filter(
            Meal.user_id == user_id,
            Meal.date >= today_start_utc,
        ).count()
        return count > 0
    finally:
        db.close()


def job_morning():
    """9:00 МСК — напоминание о тренировке. Кому: кто не тренировался 2+ дня."""
    print("[scheduler] job_morning старт")
    db = SessionLocal()
    try:
        user_ids = [row[0] for row in db.query(PushSubscription.user_id).distinct().all()]
    finally:
        db.close()

    sent = 0
    for uid in user_ids:
        # Уже отправляли сегодня?
        if _already_sent_today(uid, "morning"):
            continue
        # Тренировка сегодня уже была?
        if _has_workout_today(uid):
            continue
        # Тренировался последние 2 дня? Если да — не спамим
        if _has_workout_last_n_days(uid, 2):
            continue

        ok, failed = send_push(
            uid,
            title="🏋️ FitSolo",
            body="Доброе утро! Пора на тренировку 💪",
            url="/",
        )
        if ok > 0:
            _log_push_sent(uid, "morning")
            sent += 1
    print(f"[scheduler] job_morning отправлено: {sent}")


def job_missed():
    """11:00 МСК — возврат пропавших. Кому: кто не тренировался 3+ дня."""
    print("[scheduler] job_missed старт")
    db = SessionLocal()
    try:
        user_ids = [row[0] for row in db.query(PushSubscription.user_id).distinct().all()]
    finally:
        db.close()

    sent = 0
    for uid in user_ids:
        if _already_sent_today(uid, "missed"):
            continue
        # Уже отправляли утреннее?
        if _already_sent_today(uid, "morning"):
            continue
        # Тренировался последние 3 дня? Если да — не «пропал»
        if _has_workout_last_n_days(uid, 3):
            continue

        ok, failed = send_push(
            uid,
            title="🏋️ FitSolo",
            body="Ты пропал! Возвращайся, streak ждёт 🔥",
            url="/",
        )
        if ok > 0:
            _log_push_sent(uid, "missed")
            sent += 1
    print(f"[scheduler] job_missed отправлено: {sent}")


def job_evening():
    """20:00 МСК — напоминание о питании. Кому: кто не записывал еду сегодня."""
    print("[scheduler] job_evening старт")
    db = SessionLocal()
    try:
        user_ids = [row[0] for row in db.query(PushSubscription.user_id).distinct().all()]
    finally:
        db.close()

    sent = 0
    for uid in user_ids:
        if _already_sent_today(uid, "evening"):
            continue
        # Уже записал еду сегодня?
        if _has_meal_today(uid):
            continue

        ok, failed = send_push(
            uid,
            title="🍎 FitSolo",
            body="Что ел сегодня? Запиши в дневник 🍎",
            url="/",
        )
        if ok > 0:
            _log_push_sent(uid, "evening")
            sent += 1
    print(f"[scheduler] job_evening отправлено: {sent}")


# ===== ЭНДПОИНТ ДЛЯ РУЧНОГО ТЕСТА =====

@app.post("/api/push/scheduled/run-now/{job_name}")
def run_scheduled_job_now(
    job_name: str,
    authorization: Optional[str] = Header(None),
):
    """Запускает джоб вручную. job_name: morning / missed / evening."""
    require_auth(authorization)

    jobs = {
        "morning": job_morning,
        "missed": job_missed,
        "evening": job_evening,
    }
    if job_name not in jobs:
        raise HTTPException(400, f"Неизвестный джоб: {job_name}. Доступны: morning, missed, evening")

    jobs[job_name]()
    return {"ok": True, "job": job_name}


# ===== APSCHEDULER =====

scheduler = BackgroundScheduler(timezone="Europe/Moscow")


def start_scheduler():
    """Запускает фоновые джобы."""
    scheduler.add_job(
        job_morning,
        CronTrigger(hour=9, minute=0, timezone="Europe/Moscow"),
        id="morning",
        replace_existing=True,
    )
    scheduler.add_job(
        job_missed,
        CronTrigger(hour=11, minute=0, timezone="Europe/Moscow"),
        id="missed",
        replace_existing=True,
    )
    scheduler.add_job(
        job_evening,
        CronTrigger(hour=20, minute=0, timezone="Europe/Moscow"),
        id="evening",
        replace_existing=True,
    )
    scheduler.start()
    print("[scheduler] Запущен. Джобы: 9:00 (morning), 11:00 (missed), 20:00 (evening) МСК")


# Вызываем сид рецептов ПОСЛЕ определения всех функций
seed_recipes_if_empty()

# Запускаем scheduler
start_scheduler()