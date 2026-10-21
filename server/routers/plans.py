"""日计划 CRUD（规格 §13.7）。"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import DailyPlan

router = APIRouter()


class PlanCreate(BaseModel):
    date: str
    start_min: int = Field(ge=0, le=1439)
    end_min: int = Field(ge=1, le=1440)
    title: str
    note: str | None = None
    color: str = "blue"
    quadrant: str = "q2"
    done: int = 0


class PlanPatch(BaseModel):
    date: str | None = None
    start_min: int | None = Field(default=None, ge=0, le=1439)
    end_min: int | None = Field(default=None, ge=1, le=1440)
    title: str | None = None
    note: str | None = None
    color: str | None = None
    quadrant: str | None = None
    done: int | None = None


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _ser(p: DailyPlan) -> dict:
    return {
        "id": p.id,
        "date": p.date,
        "start_min": p.start_min,
        "end_min": p.end_min,
        "title": p.title,
        "note": p.note,
        "color": p.color,
        "quadrant": p.quadrant or "q2",
        "done": p.done or 0,
    }


@router.get("")
def list_plans(from_: str | None = None, to: str | None = None, db: Session = Depends(get_db)):
    q = db.query(DailyPlan)
    if from_:
        q = q.filter(DailyPlan.date >= from_)
    if to:
        q = q.filter(DailyPlan.date <= to)
    items = q.all()
    items.sort(key=lambda p: (p.date, p.start_min))
    return {"items": [_ser(p) for p in items], "total": len(items)}


@router.post("")
def create_plan(body: PlanCreate, db: Session = Depends(get_db)):
    if body.end_min <= body.start_min:
        raise HTTPException(400, "结束时间必须晚于开始时间")
    p = DailyPlan(
        date=body.date,
        start_min=body.start_min,
        end_min=body.end_min,
        title=body.title,
        note=body.note,
        color=body.color,
        quadrant=body.quadrant,
        done=body.done,
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _ser(p)


@router.patch("/{plan_id}")
def update_plan(plan_id: int, body: PlanPatch, db: Session = Depends(get_db)):
    p = db.get(DailyPlan, plan_id)
    if not p:
        raise HTTPException(404, "plan not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(p, k, v)
    if p.end_min <= p.start_min:
        raise HTTPException(400, "结束时间必须晚于开始时间")
    p.updated_at = _now()
    db.commit()
    db.refresh(p)
    return _ser(p)


@router.delete("/{plan_id}")
def delete_plan(plan_id: int, db: Session = Depends(get_db)):
    p = db.get(DailyPlan, plan_id)
    if not p:
        raise HTTPException(404, "plan not found")
    db.delete(p)
    db.commit()
    return {"ok": True}
