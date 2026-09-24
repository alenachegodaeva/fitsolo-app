from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, ForeignKey, Text
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime

engine = create_engine("sqlite:///./fitsolo.db", connect_args={"check_same_thread": False})
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
    