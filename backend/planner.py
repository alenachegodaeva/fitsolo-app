import json
from pathlib import Path
from typing import Dict, List


def load_exercises() -> List[Dict]:
    path = Path(__file__).parent / "exercises.json"
    return json.loads(path.read_text(encoding="utf-8"))


def filter_exercises(equipment: List[str], injuries: List[str], experience: str) -> List[Dict]:
    order = {"beginner": 1, "intermediate": 2, "advanced": 3}
    max_diff = order.get(experience, 1)
    result = []
    for ex in load_exercises():
        if ex["muscle"] == "cardio":
            continue
        if not any(eq in equipment or eq == "bodyweight" for eq in ex["equipment"]):
            continue
        if set(ex.get("contra", [])) & set(injuries):
            continue
        if order.get(ex["difficulty"], 1) > max_diff + 1:
            continue
        result.append(ex)
    return result


def filter_cardio(equipment: List[str], injuries: List[str]) -> List[Dict]:
    result = []
    for ex in load_exercises():
        if ex["muscle"] != "cardio":
            continue
        if not any(eq in equipment or eq == "bodyweight" for eq in ex["equipment"]):
            continue
        if set(ex.get("contra", [])) & set(injuries):
            continue
        result.append(ex)
    return result


def choose_split(days: int) -> str:
    if days <= 3:
        return "full_body"
    if days == 4:
        return "upper_lower"
    return "push_pull_legs"


def get_params(goal: str, experience: str) -> Dict:
    base = {
        "weight_loss": {"reps": "12-15", "sets": 3, "rest": 45, "cardio_min": 20},
        "muscle_gain": {"reps": "8-12",  "sets": 4, "rest": 90, "cardio_min": 5},
        "strength":    {"reps": "4-6",   "sets": 5, "rest": 150, "cardio_min": 5},
        "endurance":   {"reps": "15-20", "sets": 3, "rest": 30, "cardio_min": 25},
    }[goal]
    if experience == "beginner":
        base["sets"] = max(2, base["sets"] - 1)
    return base


def split_muscles(split: str, day: int) -> List[str]:
    if split == "full_body":
        return ["chest", "back", "legs", "shoulders", "core"]
    if split == "upper_lower":
        return [["chest", "back", "shoulders", "biceps", "triceps"],
                ["legs", "core"]][(day - 1) % 2]
    return [["chest", "shoulders", "triceps"],
            ["back", "biceps", "core"],
            ["legs", "core"]][(day - 1) % 3]


def pick_exercises_by_muscles(pool: List[Dict], muscles: List[str], max_per_muscle: int = 2) -> List[Dict]:
    chosen = []
    for m in muscles:
        count = 0
        for ex in pool:
            if ex["muscle"] == m and count < max_per_muscle:
                chosen.append(ex)
                count += 1
    return chosen[:7]


def warmup() -> Dict:
    return {
        "name": "Разминка: кардио 5 минут + суставная гимнастика",
        "sets": 1, "reps": "5 мин", "rest": 0,
        "video": "", "description": "Лёгкий бег/велотренажёр + круговые движения руками, ногами, корпусом."
    }


def cooldown() -> Dict:
    return {
        "name": "Заминка: растяжка 5-7 минут",
        "sets": 1, "reps": "5-7 мин", "rest": 0,
        "video": "", "description": "Статическая растяжка рабочих мышц, спокойное дыхание."
    }


def generate_plan(user: Dict) -> Dict:
    split = choose_split(user["days_per_week"])
    params = get_params(user["goal"], user["experience"])
    pool = filter_exercises(user["equipment"], user["injuries"], user["experience"])
    cardio_pool = filter_cardio(user["equipment"], user["injuries"])

    week = []
    for day in range(1, user["days_per_week"] + 1):
        muscles = split_muscles(split, day)
        day_ex = pick_exercises_by_muscles(pool, muscles)

        exercises = [warmup()]
        for ex in day_ex:
            exercises.append({
                "name": ex["name"],
                "sets": params["sets"],
                "reps": params["reps"],
                "rest": params["rest"],
                "video": ex.get("video", ""),
                "description": ex.get("description", ""),
            })

        if params["cardio_min"] > 0 and cardio_pool:
            cardio = cardio_pool[day % len(cardio_pool)]
            exercises.append({
                "name": f"Кардио: {cardio['name']}",
                "sets": 1,
                "reps": f"{params['cardio_min']} мин",
                "rest": 0,
                "video": "",
                "description": cardio.get("description", ""),
            })

        exercises.append(cooldown())

        week.append({
            "day": day,
            "focus": ", ".join(muscles),
            "exercises": exercises,
        })

    return {"split": split, "params": params, "week": week}