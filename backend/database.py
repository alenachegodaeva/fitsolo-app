import os
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./fitsolo.db")

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, index=True, nullable=True)
    password_hash = Column(String, nullable=True)
    name = Column(String)
    gender = Column(String)
    age = Column(Integer)
    weight = Column(Float)
    height = Column(Float)
    experience = Column(String)
    goal = Column(String)
    days_per_week = Column(Integer)
    equipment = Column(String)
    injuries = Column(String)
    role = Column(String, default="self")
    created_at = Column(DateTime, default=datetime.utcnow)


class WorkoutLog(Base):
    __tablename__ = "workout_logs"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    date = Column(DateTime, default=datetime.utcnow)
    exercise = Column(String)
    weight = Column(Float)
    reps = Column(Integer)
    sets = Column(Integer)
    notes = Column(Text)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    role = Column(String)
    content = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


class Meal(Base):
    __tablename__ = "meals"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    date = Column(DateTime, default=datetime.utcnow)
    name = Column(String)
    grams = Column(Float)
    calories = Column(Float)
    protein = Column(Float)
    fat = Column(Float)
    carbs = Column(Float)


class ProgressPhoto(Base):
    __tablename__ = "progress_photos"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    filename = Column(String, nullable=False)      # имя файла в uploads/
    date = Column(DateTime, default=datetime.utcnow)
    weight = Column(Float, nullable=True)          # вес на момент фото
    note = Column(Text, nullable=True)             # заметка
    is_pinned = Column(Boolean, default=False)     # закреплённое (главное) фото


class Achievement(Base):
    __tablename__ = "achievements"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    achievement_id = Column(String, nullable=False)  # "first_workout", "workouts_10", ...
    earned_at = Column(DateTime, default=datetime.utcnow)


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    endpoint = Column(Text, nullable=False, unique=True)
    p256dh = Column(String, nullable=False)
    auth = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class Recipe(Base):
    __tablename__ = "recipes"
    id = Column(Integer, primary_key=True)
    slug = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    category = Column(String, index=True, nullable=False)
    tags = Column(Text)                # JSON-строка
    time_min = Column(Integer)
    servings = Column(Integer, default=1)
    ingredients = Column(Text)          # JSON-строка
    calories = Column(Float)
    protein = Column(Float)
    fat = Column(Float)
    carbs = Column(Float)
    steps = Column(Text)                # JSON-строка
    photo_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
class PushLog(Base):
    __tablename__ = "push_logs"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    job_name = Column(String, nullable=False)   # "morning" / "missed" / "evening"
    sent_at = Column(DateTime, default=datetime.utcnow, index=True)
    
class Client(Base):
    __tablename__ = "clients"
    id = Column(Integer, primary_key=True)
    trainer_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # если клиент зарегистрирован
    name = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    goal = Column(String, nullable=True)      # "похудение" / "масса" / "сила"
    age = Column(Integer, nullable=True)
    height = Column(Float, nullable=True)
    weight = Column(Float, nullable=True)
    notes = Column(Text, nullable=True)       # общая заметка
    status = Column(String, default="active") # "active" / "archived"
    created_at = Column(DateTime, default=datetime.utcnow)


class ClientNote(Base):
    __tablename__ = "client_notes"
    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"), index=True, nullable=False)
    date = Column(DateTime, default=datetime.utcnow)
    text = Column(Text, nullable=False)


class ClientMeasurement(Base):
    __tablename__ = "client_measurements"
    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"), index=True, nullable=False)
    date = Column(DateTime, default=datetime.utcnow)
    weight = Column(Float, nullable=True)
    chest = Column(Float, nullable=True)   # грудь
    waist = Column(Float, nullable=True)   # талия
    hips = Column(Float, nullable=True)    # бёдра
    arm = Column(Float, nullable=True)     # рука
    leg = Column(Float, nullable=True)     # нога
    note = Column(Text, nullable=True)

def init_db():
    Base.metadata.create_all(bind=engine)