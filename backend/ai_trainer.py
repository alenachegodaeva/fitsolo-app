import os
import httpx
import uuid
from dotenv import load_dotenv

load_dotenv()

# GigaChat API
GIGACHAT_AUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
GIGACHAT_API_URL = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions"
MODEL = "GigaChat"

SYSTEM_PROMPT = """Ты — персональный фитнес-тренер и нутрициолог FitSolo.
Правила:
- Отвечай кратко и по делу, на русском.
- Учитывай профиль пользователя (пол, возраст, вес, рост, цель, опыт, травмы).
- Если пользователь просит упражнение, которое противопоказано — предупреди.
- Не давай медицинских советов, при боли направляй к врачу.
- Пиши дружелюбно, мотивируй, используй эмодзи умеренно.

Ты также разбираешься в питании:
- Можешь рассчитывать КБЖУ и предлагать меню под цель (похудение/масса/сила).
- Знаешь состав продуктов: калории, белки, жиры, углеводы на 100 г.
- Умеешь советовать, что есть до и после тренировки (за 1.5-2 часа до — углеводы + белок, после — белок + быстрые углеводы).
- Если пользователь спрашивает про меню — предлагай конкретные блюда с примерным КБЖУ.
- Не назначай диеты при медицинских состояниях — направляй к врачу.
"""


async def _get_access_token(client: httpx.AsyncClient) -> str:
    """Получает access_token для GigaChat по authorization key."""
    auth_key = os.getenv("GIGACHAT_AUTH_KEY")
    if not auth_key:
        raise ValueError("Не задан GIGACHAT_AUTH_KEY в .env")

    # ВАЖНО: добавляем RqUID (обязательный заголовок!) и правильный Content-Type
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "RqUID": str(uuid.uuid4()),  # ← это исправление ошибки 400!
        "Authorization": f"Basic {auth_key}",
    }

    # ВАЖНО: scope передаётся как form-data, не как JSON
    data = {"scope": "GIGACHAT_API_PERS"}

    r = await client.post(
        GIGACHAT_AUTH_URL,
        headers=headers,
        data=data,
        timeout=30,
    )

    if r.status_code != 200:
        raise Exception(
            f"GigaChat auth error {r.status_code}: {r.text[:200]}"
        )

    return r.json()["access_token"]


async def ask_ai_trainer(user_message: str, profile: dict, history: list = None) -> str:
    auth_key = os.getenv("GIGACHAT_AUTH_KEY")
    if not auth_key:
        return "⚠️ Не настроен API-ключ GigaChat. Добавь GIGACHAT_AUTH_KEY в файл .env"

    context = (
        f"Профиль: {profile.get('gender')}, {profile.get('age')} лет, "
        f"{profile.get('weight')} кг, рост {profile.get('height')} см. "
        f"Цель: {profile.get('goal')}. Опыт: {profile.get('experience')}. "
        f"Тренировок в неделю: {profile.get('days_per_week')}. "
        f"Травмы/ограничения: {', '.join(profile.get('injuries', [])) or 'нет'}."
    )

    messages = [
    {"role": "system", "content": SYSTEM_PROMPT + "\n\n" + context},
]
    if history:
        messages.extend(history[-6:])
    messages.append({"role": "user", "content": user_message})

    async with httpx.AsyncClient(verify=False, timeout=60) as client:
        try:
            token = await _get_access_token(client)
            r = await client.post(
                GIGACHAT_API_URL,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                json={"model": MODEL, "messages": messages, "temperature": 0.7},
            )
            r.raise_for_status()
            data = r.json()
            return data["choices"][0]["message"]["content"]
        except Exception as e:
            return f"⚠️ Ошибка при обращении к GigaChat: {e}"