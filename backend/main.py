import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

from database import init_db, SessionLocal, User, WorkoutLog, ChatMessage, Meal
import os 
from planner import generate_plan
from ai_trainer import ask_ai_trainer

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


@app.get("/api/profile/{user_id}")
def get_profile(user_id: int):
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


@app.get("/api/plan/{user_id}")
def get_plan(user_id: int):
    profile = get_profile(user_id)
    return generate_plan(profile)


# ===== ЧАТ С ТРЕНЕРОМ =====

@app.post("/api/chat")
async def chat(c: ChatIn):
    profile = get_profile(c.user_id)

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
def get_chat_history(user_id: int):
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
def clear_chat_history(user_id: int):
    db = SessionLocal()
    db.query(ChatMessage).filter_by(user_id=user_id).delete()
    db.commit()
    db.close()
    return {"ok": True}


# ===== ДНЕВНИК ТРЕНИРОВОК =====

@app.post("/api/log")
def add_log(l: LogIn):
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
def get_logs(user_id: int):
    db = SessionLocal()
    rows = db.query(WorkoutLog).filter_by(user_id=user_id).order_by(WorkoutLog.date.desc()).all()
    db.close()
    return [
        {"id": r.id, "exercise": r.exercise, "weight": r.weight, "reps": r.reps,
         "sets": r.sets, "date": r.date.isoformat(), "notes": r.notes}
        for r in rows
    ]


@app.delete("/api/log/{log_id}")
def delete_log(log_id: int):
    db = SessionLocal()
    log = db.query(WorkoutLog).get(log_id)
    if not log:
        db.close()
        raise HTTPException(404, "Запись не найдена")
    db.delete(log)
    db.commit()
    db.close()
    return {"ok": True}


@app.get("/api/stats/{user_id}")
def get_stats(user_id: int):
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
def add_meal(m: MealIn):
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
def get_meals(user_id: int):
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
def delete_meal(meal_id: int):
    db = SessionLocal()
    meal = db.query(Meal).get(meal_id)
    if not meal:
        db.close()
        raise HTTPException(404, "Запись не найдена")
    db.delete(meal)
    db.commit()
    db.close()
    return {"ok": True}


@app.get("/api/nutrition/{user_id}")
def get_nutrition(user_id: int):
    profile = get_profile(user_id)

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




# ===== БАЗА ПРОДУКТОВ =====

@app.get("/api/foods")
def search_foods(q: str = ""):
    """Поиск продуктов по названию. Если q пустой — вернуть первые 30."""
    import json as _json
    from pathlib import Path

    path = Path(__file__).parent / "foods.json"
    foods = _json.loads(path.read_text(encoding="utf-8"))

    if q:
        q_lower = q.lower()
        foods = [f for f in foods if q_lower in f["name"].lower()]

    return foods[:30]



# ===== БАЗА УПРАЖНЕНИЙ =====

@app.get("/api/exercises")
def get_exercises(q: str = "", limit: int = 200):
    """Поиск упражнений по названию. Если q пустой — вернуть первые N."""
    from pathlib import Path

    path = Path(__file__).parent / "exercises.json"
    exercises = json.loads(path.read_text(encoding="utf-8"))

    if q:
        q_lower = q.lower()
        exercises = [e for e in exercises if q_lower in e["name"].lower()]

    return exercises[:limit]
   

@app.get("/api/meals/history/{user_id}")
def get_meals_history(user_id: int, days: int = 7):
    """Возвращает приёмы пищи за последние N дней, сгруппированные по датам."""
    from datetime import datetime, timedelta

    db = SessionLocal()
    cutoff = datetime.utcnow() - timedelta(days=days)
    rows = (
        db.query(Meal)
        .filter(Meal.user_id == user_id, Meal.date >= cutoff)
        .order_by(Meal.date.asc())
        .all()
    )
    db.close()

    # Группируем по дате (YYYY-MM-DD)
    by_day = {}
    for r in rows:
        day = r.date.date().isoformat()
        if day not in by_day:
            by_day[day] = {
                "date": day,
                "calories": 0,
                "protein": 0,
                "fat": 0,
                "carbs": 0,
                "meals_count": 0,
            }
        by_day[day]["calories"] += r.calories or 0
        by_day[day]["protein"] += r.protein or 0
        by_day[day]["fat"] += r.fat or 0
        by_day[day]["carbs"] += r.carbs or 0
        by_day[day]["meals_count"] += 1

    # Заполняем пропущенные дни нулями
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

    # Средние значения по дням, где что-то ели
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


