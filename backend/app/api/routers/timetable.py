"""Timetable — read grid, master-cell editing, single-cell edit, delete all."""
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.db import database as db
from app.core.security import require_auth

router = APIRouter(dependencies=[Depends(require_auth)])

ZERO_UUID = "00000000-0000-0000-0000-000000000000"


def _shape_row(r):
    """Match the Supabase nested-join shape used by the frontend."""
    return {
        "id": str(r["id"]),
        "class_id": str(r["class_id"]) if r.get("class_id") else None,
        "teacher_id": str(r["teacher_id"]) if r.get("teacher_id") else None,
        "day": r["day"],
        "period": r["period"],
        "subject": r["subject"],
        "classes": {"name": r.get("class_name"), "class_level": r.get("class_level")}
        if r.get("class_name") is not None else None,
        "teachers": {"name": r.get("teacher_name")} if r.get("teacher_name") is not None else None,
    }


@router.get("/classes")
async def timetable_classes():
    rows = db.query(
        """SELECT id, name, class_level, section, display_order, class_teacher_id
           FROM classes ORDER BY display_order"""
    )
    return rows


@router.get("/")
async def get_timetable(class_id: str | None = None, teacher_id: str | None = None):
    where, params = [], []
    if class_id:
        where.append("t.class_id = %s")
        params.append(class_id)
    if teacher_id:
        where.append("t.teacher_id = %s")
        params.append(teacher_id)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    rows = db.query(
        f"""SELECT t.id, t.class_id, t.teacher_id, t.day, t.period, t.subject,
                   c.name AS class_name, c.class_level, te.name AS teacher_name
            FROM timetable t
            LEFT JOIN classes c ON c.id = t.class_id
            LEFT JOIN teachers te ON te.id = t.teacher_id
            {clause}
            ORDER BY t.day, t.period""",
        params,
    )
    return [_shape_row(r) for r in rows]


@router.put("/master-cell")
async def master_cell(request: Request):
    body = await request.json() or {}
    class_id = body.get("class_id")
    period_num = body.get("period")
    try:
        period_num = int(period_num)
    except (TypeError, ValueError):
        period_num = 0
    segments = body.get("segments")

    if not class_id or not period_num or period_num < 1 or period_num > 8:
        return JSONResponse(status_code=400, content={"error": "class_id and period (1–8) required"})
    if not isinstance(segments, list) or len(segments) == 0:
        return JSONResponse(status_code=400, content={"error": "segments array required"})

    covered = set()
    for s in segments:
        try:
            start, end = int(s.get("dayStart")), int(s.get("dayEnd"))
        except (TypeError, ValueError):
            start, end = 0, 0
        if not s.get("teacher_id") or not s.get("subject") or not start or not end \
                or start > end or start < 1 or end > 6:
            return JSONResponse(status_code=400, content={
                "error": "Each segment needs dayStart, dayEnd (1–6), subject, teacher_id"})
        for d in range(start, end + 1):
            if d in covered:
                return JSONResponse(status_code=400, content={"error": f"Overlapping day {d} in segments"})
            covered.add(d)
    for d in range(1, 7):
        if d not in covered:
            return JSONResponse(status_code=400, content={
                "error": f"Day {d} not covered — use lines like 1-3 Maths (Name) and 4-6 English (Name)"})

    try:
        existing = db.query(
            "SELECT id, day, teacher_id FROM timetable WHERE class_id = %s AND period = %s",
            [class_id, period_num],
        )
        by_day = {r["day"]: r for r in existing}

        for d in range(1, 7):
            seg = next((s for s in segments if int(s["dayStart"]) <= d <= int(s["dayEnd"])), None)
            if not seg:
                continue

            clash = db.query_one(
                """SELECT t.id, c.name AS class_name
                   FROM timetable t LEFT JOIN classes c ON c.id = t.class_id
                   WHERE t.teacher_id = %s AND t.day = %s AND t.period = %s AND t.class_id <> %s
                   LIMIT 1""",
                [seg["teacher_id"], d, period_num, class_id],
            )
            if clash:
                cn = clash.get("class_name") or "another class"
                tname = db.query_one("SELECT name FROM teachers WHERE id = %s", [seg["teacher_id"]])
                return JSONResponse(status_code=400, content={
                    "error": f"{(tname or {}).get('name') or 'Teacher'} is already teaching {cn} "
                             f"on day {d} period {period_num}"})

            row = by_day.get(d)
            if row:
                db.execute(
                    "UPDATE timetable SET teacher_id = %s, subject = %s WHERE id = %s",
                    [seg["teacher_id"], seg["subject"], row["id"]],
                )
            else:
                db.execute(
                    """INSERT INTO timetable (class_id, day, period, teacher_id, subject)
                       VALUES (%s, %s, %s, %s, %s)""",
                    [class_id, d, period_num, seg["teacher_id"], seg["subject"]],
                )

        updated = db.query(
            """SELECT t.id, t.class_id, t.teacher_id, t.day, t.period, t.subject,
                      c.name AS class_name, c.class_level, te.name AS teacher_name
               FROM timetable t
               LEFT JOIN classes c ON c.id = t.class_id
               LEFT JOIN teachers te ON te.id = t.teacher_id
               WHERE t.class_id = %s AND t.period = %s
               ORDER BY t.day""",
            [class_id, period_num],
        )
        return {"success": True, "rows": [_shape_row(r) for r in updated]}
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})


@router.delete("/all")
async def delete_all():
    try:
        db.execute("DELETE FROM timetable WHERE id <> %s", [ZERO_UUID])
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return {"success": True}


@router.put("/{row_id}")
async def update_cell(row_id: str, request: Request):
    body = await request.json()
    try:
        row = db.execute_returning(
            "UPDATE timetable SET teacher_id = %s, subject = %s WHERE id = %s RETURNING *",
            [body.get("teacher_id"), body.get("subject"), row_id],
        )
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    if not row:
        return JSONResponse(status_code=400, content={"error": "Row not found"})
    teacher = None
    if row.get("teacher_id"):
        teacher = db.query_one("SELECT name FROM teachers WHERE id = %s", [row["teacher_id"]])
    out = {
        "id": str(row["id"]),
        "class_id": str(row["class_id"]) if row.get("class_id") else None,
        "teacher_id": str(row["teacher_id"]) if row.get("teacher_id") else None,
        "day": row["day"],
        "period": row["period"],
        "subject": row["subject"],
        "teachers": {"name": teacher["name"]} if teacher else None,
    }
    return out
