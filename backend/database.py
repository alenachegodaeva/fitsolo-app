import os
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, ForeignKey, Text
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime

# Берём DATABASE_URL из переменных окружения (на Render)
# Если её нет — падаем на локальный SQLite (для разработки)
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./fitsolo.db")

# Для SQLite нужен connect_args, для PostgreSQL — нет
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
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


def init_db():
    Base.metadata.create_all(bind=engine)