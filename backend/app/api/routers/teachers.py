"""Teachers CRUD + allotment summary."""
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.db import database as db
from app.core.security import require_auth

router = APIRouter(dependencies=[Depends(require_auth)])

TEACHER_SELECT = ("id, name, subjects, min_class_level, max_class_level, "
                  "allotted_periods, allocated_periods, min_period_start")
TEACHER_FIELDS = ["name", "subjects", "min_class_level", "max_class_level",
                  "allotted_periods", "min_period_start"]


@router.get("/allotment-summary")
async def allotment_summary():
    teachers = db.query(
        """SELECT id, name, subjects, min_class_level, max_class_level,
                  allotted_periods, allocated_periods, min_period_start
           FROM teachers ORDER BY name"""
    )
    allocs = db.query(
        "SELECT teacher_id, class_id, subject, periods_weekly FROM subject_allocations"
    )
    report = db.query_one(
        "SELECT report, generated_at FROM allocation_reports WHERE id = 1"
    )

    last_run = ((report or {}).get("report") or {}).get("lastRun")
    use_run_preview = bool(last_run and last_run.get("success") and last_run.get("teacher_summary"))

    alloc_by_teacher = {}
    for a in allocs:
        tid = str(a["teacher_id"])
        alloc_by_teacher[tid] = alloc_by_teacher.get(tid, 0) + a["periods_weekly"]

    out_teachers = []
    for t in teachers:
        tid = str(t["id"])
        min_p = t["min_period_start"] or 1
        allocation_total = alloc_by_teacher.get(tid, 0)
        timetable_db = t["allocated_periods"] or 0
        preview = None
        if use_run_preview:
            preview = (last_run["teacher_summary"].get(tid) or {}).get("allocated", 0)
        timetable_periods = preview if preview is not None else timetable_db
        target_label = t["allotted_periods"] if (t["allotted_periods"] or 0) > 0 else "Auto"
        out_teachers.append({
            "id": tid,
            "name": t["name"],
            "subjects": t["subjects"] or [],
            "min_class_level": t["min_class_level"],
            "max_class_level": t["max_class_level"],
            "level_label": f"L{t['min_class_level']}–L{t['max_class_level']}",
            "allotted_periods": t["allotted_periods"] or 0,
            "target_label": target_label,
            "allocation_total": allocation_total,
            "allocated_periods": timetable_periods,
            "timetable_db": timetable_db,
            "timetable_source": "preview" if preview is not None else "database",
            "min_period_start": min_p,
            "capacity": (8 - (min_p - 1)) * 6,
        })

    last_run_out = None
    if last_run:
        gen = (report or {}).get("generated_at")
        last_run_out = {
            "success": last_run.get("success"),
            "filled": last_run.get("filled"),
            "total": last_run.get("total"),
            "solver_status_name": last_run.get("solver_status_name"),
            "generated_at": gen.isoformat() if hasattr(gen, "isoformat") else gen,
        }

    return {
        "summary_source": "preview" if use_run_preview else "database",
        "totals": {
            "teacher_count": len(out_teachers),
            "allotted_sum": sum(t["allotted_periods"] for t in out_teachers),
            "allocation_sum": sum(t["allocation_total"] for t in out_teachers),
            "timetable_sum": sum(t["allocated_periods"] for t in out_teachers),
            "timetable_db_sum": sum(t["timetable_db"] or 0 for t in out_teachers),
        },
        "teachers": out_teachers,
        "last_run": last_run_out,
    }


@router.get("")
async def list_teachers():
    return db.query(f"SELECT {TEACHER_SELECT} FROM teachers ORDER BY name")


@router.post("")
async def create_teacher(request: Request):
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        return JSONResponse(status_code=400, content={"error": "name required"})
    try:
        row = db.execute_returning(
            f"""INSERT INTO teachers
                (name, subjects, min_class_level, max_class_level, allotted_periods, min_period_start)
                VALUES (%s, %s, %s, %s, %s, %s) RETURNING {TEACHER_SELECT}""",
            [
                name,
                body.get("subjects") or [],
                body.get("min_class_level", 1),
                body.get("max_class_level", 10),
                body.get("allotted_periods", 0),
                body.get("min_period_start", 1),
            ],
        )
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return JSONResponse(status_code=201, content=_jsonify(row))


@router.put("/{teacher_id}")
async def update_teacher(teacher_id: str, request: Request):
    body = await request.json()
    sets, params = [], []
    for k in TEACHER_FIELDS:
        if k in body:
            sets.append(f"{k} = %s")
            params.append(body[k])
    if not sets:
        return JSONResponse(status_code=400, content={"error": "Nothing to update"})
    params.append(teacher_id)
    try:
        row = db.execute_returning(
            f"UPDATE teachers SET {', '.join(sets)} WHERE id = %s RETURNING {TEACHER_SELECT}",
            params,
        )
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    if not row:
        return JSONResponse(status_code=400, content={"error": "Teacher not found"})
    return _jsonify(row)


@router.delete("/{teacher_id}")
async def delete_teacher(teacher_id: str):
    try:
        db.execute("DELETE FROM teachers WHERE id = %s", [teacher_id])
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return {"success": True}


def _jsonify(row):
    if row and row.get("id") is not None:
        row = {**row, "id": str(row["id"])}
    return row
