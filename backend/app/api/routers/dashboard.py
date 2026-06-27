"""Dashboard stats."""
import datetime as dt

from fastapi import APIRouter, Depends

from app.db import database as db
from app.core.security import require_auth

router = APIRouter(dependencies=[Depends(require_auth)])


@router.get("/stats")
async def stats():
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()

    teacher_count = db.query_one("SELECT COUNT(*) AS c FROM teachers")["c"]
    class_count = db.query_one("SELECT COUNT(*) AS c FROM classes")["c"]
    timetable_count = db.query_one("SELECT COUNT(*) AS c FROM timetable")["c"]
    total_periods = db.query_one(
        "SELECT COALESCE(SUM(periods_weekly), 0) AS s FROM subject_allocations"
    )["s"]

    absent_rows = db.query(
        """SELECT a.teacher_id, t.name AS teacher_name
           FROM absences a LEFT JOIN teachers t ON t.id = a.teacher_id
           WHERE a.absent_date = %s""",
        [today],
    )
    absent_today = [
        {"teacher_id": str(r["teacher_id"]), "teacher_name": r["teacher_name"]}
        for r in absent_rows
    ]

    return {
        "teacher_count": teacher_count or 0,
        "class_count": class_count or 0,
        "total_periods": int(total_periods or 0),
        "timetable_slots": timetable_count or 0,
        "absent_today": absent_today,
        "timetable_ready": (timetable_count or 0) > 0,
    }
