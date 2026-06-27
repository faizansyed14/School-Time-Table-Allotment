"""Subject allocations CRUD + validation + CP-SAT auto-generate (Phase A)."""
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.db import database as db
from app.services import solver_bridge as sb
from app.services.allocation_issues import (build_allocation_issues, build_allocation_plan_issues,
                                 build_precheck_issues)
from app.core.security import require_auth

router = APIRouter(dependencies=[Depends(require_auth)])

ZERO_UUID = "00000000-0000-0000-0000-000000000000"


@router.get("/validate")
async def validate():
    subjects = db.query("SELECT * FROM subjects")
    classes = db.query(
        "SELECT id, name, class_level, class_teacher_id FROM classes ORDER BY display_order")
    teachers = db.query(
        """SELECT id, name, subjects, min_class_level, max_class_level,
                  allotted_periods, min_period_start FROM teachers""")
    report = db.query_one("SELECT report FROM allocation_reports WHERE id = 1")
    allocs = db.query(
        "SELECT teacher_id, class_id, subject, periods_weekly FROM subject_allocations")

    last_run = ((report or {}).get("report") or {}).get("lastRun")
    plan_issues = build_allocation_plan_issues(subjects, classes, teachers, allocs)
    result = build_allocation_issues(subjects, classes, teachers,
                                     last_run=last_run, plan_issues=plan_issues)
    return result


@router.post("/swap-teacher")
async def swap_teacher(request: Request):
    body = await request.json() or {}
    from_id = body.get("from_teacher_id")
    to_id = body.get("to_teacher_id")
    if not from_id or not to_id:
        return JSONResponse(status_code=400,
                            content={"error": "from_teacher_id and to_teacher_id required"})
    rows = db.query(
        "SELECT class_id, subject, periods_weekly FROM subject_allocations WHERE teacher_id = %s",
        [from_id])
    if not rows:
        return {"success": True, "swapped": 0}
    try:
        for r in rows:
            db.execute(
                """INSERT INTO subject_allocations (teacher_id, class_id, subject, periods_weekly)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (teacher_id, class_id, subject)
                   DO UPDATE SET periods_weekly = EXCLUDED.periods_weekly""",
                [to_id, r["class_id"], r["subject"], r["periods_weekly"]])
        db.execute("DELETE FROM subject_allocations WHERE teacher_id = %s", [from_id])
        db.execute("UPDATE classes SET class_teacher_id = %s WHERE class_teacher_id = %s",
                   [to_id, from_id])
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return {"success": True, "swapped": len(rows)}


@router.post("/auto-generate")
async def auto_generate(apply: str | None = None):
    do_apply = apply == "1"
    try:
        teachers = db.query(
            """SELECT id, name, subjects, min_class_level, max_class_level,
                      allotted_periods, min_period_start FROM teachers""")
        classes = db.query(
            "SELECT id, name, class_level, class_teacher_id FROM classes ORDER BY display_order")
        subjects = db.query("SELECT * FROM subjects")

        was_fixed_by_name = {t["name"]: sb.is_fixed_target(t["allotted_periods"]) for t in teachers}
        name_to_teacher_id = {t["name"]: t["id"] for t in teachers}
        payload = sb.build_solver_payload(teachers, classes, subjects, mode="allocate")

        raw = sb.run_solver(payload)
        result = sb.transform_allocate_result(raw, teachers, classes)
        target_changes = sb.build_target_changes(teachers, raw.get("targets"), payload["teachers"])
        precheck_issues = build_precheck_issues(subjects, classes, teachers)

        if not result["success"]:
            issues = build_allocation_issues(
                subjects, classes, teachers,
                last_run={"success": False, "message": result["message"],
                          "errors": result.get("errors")},
            )["issues"]
            return {
                "success": False, "ok": False,
                "errors": [e["message"] for e in result.get("errors", [])] or [result["message"]],
                "message": result["message"],
                "issues": issues,
                "targetChanges": target_changes,
            }

        if do_apply:
            sb.persist_allocations_and_targets(
                result["allocations"], result["targets"],
                name_to_teacher_id, was_fixed_by_name)

        return {
            "success": True, "ok": True, "applied": do_apply,
            "count": len(result["allocations"]),
            "totalAssigned": result["totalAssigned"],
            "totalExpected": result["totalExpected"],
            "filled": result["filled"], "total": result["total"],
            "message": result["message"],
            "class_summary": _jsonify_keys(result["class_summary"]),
            "allocations": None if do_apply else _jsonify_allocs(result["allocations"]),
            "targets": result["targets"],
            "targetChanges": target_changes,
            "issues": [i for i in precheck_issues if i["severity"] == "warning"],
        }
    except Exception as e:
        return JSONResponse(status_code=500,
                            content={"success": False, "error": str(e), "errors": [str(e)]})


@router.get("")
async def list_allocations(teacher_id: str | None = None, class_id: str | None = None):
    where, params = [], []
    if teacher_id:
        where.append("sa.teacher_id = %s")
        params.append(teacher_id)
    if class_id:
        where.append("sa.class_id = %s")
        params.append(class_id)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    rows = db.query(
        f"""SELECT sa.teacher_id, sa.class_id, sa.subject, sa.periods_weekly,
                   t.name AS teacher_name, c.name AS class_name, c.class_level
            FROM subject_allocations sa
            LEFT JOIN teachers t ON t.id = sa.teacher_id
            LEFT JOIN classes c ON c.id = sa.class_id
            {clause}
            ORDER BY sa.class_id, sa.subject""",
        params,
    )
    return [{
        "teacher_id": str(r["teacher_id"]),
        "teacher_name": r.get("teacher_name"),
        "class_id": str(r["class_id"]),
        "class_name": r.get("class_name"),
        "class_level": r.get("class_level"),
        "subject": r["subject"],
        "periods_weekly": r["periods_weekly"],
    } for r in rows]


@router.post("")
async def create_allocations(request: Request):
    body = await request.json()
    items = body if isinstance(body, list) else [body]
    for it in items:
        if not it.get("teacher_id") or not it.get("class_id") or not it.get("subject") \
                or not it.get("periods_weekly"):
            return JSONResponse(status_code=400, content={
                "error": "teacher_id, class_id, subject, periods_weekly all required"})
    try:
        out = []
        for it in items:
            row = db.execute_returning(
                """INSERT INTO subject_allocations (teacher_id, class_id, subject, periods_weekly)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (teacher_id, class_id, subject)
                   DO UPDATE SET periods_weekly = EXCLUDED.periods_weekly
                   RETURNING teacher_id, class_id, subject, periods_weekly""",
                [it["teacher_id"], it["class_id"], it["subject"], int(it["periods_weekly"])])
            out.append({
                "teacher_id": str(row["teacher_id"]),
                "class_id": str(row["class_id"]),
                "subject": row["subject"],
                "periods_weekly": row["periods_weekly"],
            })
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return JSONResponse(status_code=201, content=out)


@router.put("/{teacher_id}/{class_id}/{subject}")
async def update_allocation(teacher_id: str, class_id: str, subject: str, request: Request):
    body = await request.json()
    try:
        row = db.execute_returning(
            """UPDATE subject_allocations SET periods_weekly = %s
               WHERE teacher_id = %s AND class_id = %s AND subject = %s
               RETURNING teacher_id, class_id, subject, periods_weekly""",
            [int(body.get("periods_weekly")), teacher_id, class_id, subject])
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    if not row:
        return JSONResponse(status_code=400, content={"error": "Allocation not found"})
    return {
        "teacher_id": str(row["teacher_id"]),
        "class_id": str(row["class_id"]),
        "subject": row["subject"],
        "periods_weekly": row["periods_weekly"],
    }


@router.delete("/{teacher_id}/{class_id}/{subject}")
async def delete_allocation(teacher_id: str, class_id: str, subject: str):
    try:
        db.execute(
            "DELETE FROM subject_allocations WHERE teacher_id = %s AND class_id = %s AND subject = %s",
            [teacher_id, class_id, subject])
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return {"success": True}


def _jsonify_keys(d):
    return {str(k): v for k, v in (d or {}).items()}


def _jsonify_allocs(allocs):
    return [{
        "teacher_id": str(a["teacher_id"]) if a["teacher_id"] else None,
        "class_id": str(a["class_id"]) if a["class_id"] else None,
        "subject": a["subject"],
        "periods_weekly": a["periods_weekly"],
    } for a in (allocs or [])]
