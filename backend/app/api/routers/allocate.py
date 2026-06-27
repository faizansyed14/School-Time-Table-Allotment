"""Allotment — schedule allocations into a timetable grid (CP-SAT Phase B) and apply.

Endpoints:
  POST /run    — schedule the saved allocations (Phase B) and store the preview.
  POST /auto    — ONE-CLICK: generate allocations (Phase A) + schedule + apply. Falls
                  back to scheduling the existing saved allocations if a freshly
                  generated allocation can't be scheduled under the hard rules.
  POST /apply   — write the stored preview grid into the timetable.
  GET  /result, PATCH /rules, DELETE /result, GET /status, POST /cancel.
"""
import datetime as dt
import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from psycopg2.extras import Json

from app.core.security import require_auth
from app.db import database as db
from app.services import solver_bridge as sb
from app.services.allocation_issues import (build_allocation_issues, build_allocation_plan_issues,
                                            build_precheck_issues)
from app.services.util import to_jsonable

router = APIRouter(dependencies=[Depends(require_auth)])

ZERO_UUID = "00000000-0000-0000-0000-000000000000"

SUBJECT_ID_TO_NAME = {
    "S01": "English", "S02": "Hindi", "S03": "Maths", "S04": "S.St", "S05": "Science",
    "S06": "G.K.", "S07": "Drawing", "S08": "Computer", "S09": "Sanskrit", "S10": "Games",
    "S11": "Library", "S12": "Diary",
}


def _jsonb(value):
    return Json(value, dumps=lambda o: json.dumps(to_jsonable(o)))


def persist_last_run(last_run):
    existing = db.query_one("SELECT report FROM allocation_reports WHERE id = 1")
    prev = (existing or {}).get("report") or {}
    report = {**prev, "lastRun": to_jsonable(last_run)}
    db.execute(
        """INSERT INTO allocation_reports (id, report, generated_at)
           VALUES (1, %s, %s)
           ON CONFLICT (id) DO UPDATE SET report = EXCLUDED.report,
                                          generated_at = EXCLUDED.generated_at""",
        [_jsonb(report), dt.datetime.now(dt.timezone.utc)],
    )


def _load_domain():
    subjects = db.query("SELECT * FROM subjects ORDER BY name")
    classes = db.query(
        "SELECT id, name, class_level, class_teacher_id FROM classes ORDER BY display_order")
    teachers = db.query(
        """SELECT id, name, subjects, min_class_level, max_class_level,
                  allotted_periods, min_period_start FROM teachers""")
    db_allocs = db.query(
        """SELECT sa.teacher_id, sa.class_id, sa.subject, sa.periods_weekly,
                  t.name AS teacher_name, c.name AS class_name
           FROM subject_allocations sa
           LEFT JOIN teachers t ON t.id = sa.teacher_id
           LEFT JOIN classes c ON c.id = sa.class_id""")
    return subjects, classes, teachers, db_allocs


def _schedule_saved(subjects, classes, teachers, db_allocs, start):
    """Phase B: schedule the given saved allocations into a grid. Returns a result dict."""
    plan_issues = build_allocation_plan_issues(subjects, classes, teachers, db_allocs)
    plan_errors = [i for i in plan_issues if i["severity"] == "error"]
    if plan_errors:
        return {
            "success": False, "ok": False, "phase": "schedule",
            "message": plan_errors[0]["message"],
            "errors": [{"type": i["type"], "message": i["message"]} for i in plan_errors],
            "issues": plan_issues, "filled": 0, "total": len(classes) * 48,
        }

    solver_allocations = sb.map_db_allocations_to_solver(db_allocs, teachers, classes)
    payload = sb.build_solver_payload(
        teachers, classes, subjects, mode="schedule", allocations=solver_allocations)

    raw = sb.run_solver(payload)
    result = sb.transform_solver_result(raw, teachers, classes)
    result["mode"] = "schedule"
    result["phase"] = raw.get("phase", "schedule")

    if result["success"]:
        result["issues"] = [i for i in build_precheck_issues(subjects, classes, teachers)
                            if i["severity"] == "warning"]
    else:
        result["issues"] = build_allocation_issues(
            subjects, classes, teachers, last_run=result)["issues"]

    elapsed_ms = int((dt.datetime.now() - start).total_seconds() * 1000)
    result["elapsed_ms"] = elapsed_ms
    if result["success"]:
        result["message"] = f"{result['message']} ({elapsed_ms}ms)"
    return result


@router.post("/run")
async def run():
    start = dt.datetime.now()
    try:
        subjects, classes, teachers, db_allocs = _load_domain()
        result = _schedule_saved(subjects, classes, teachers, db_allocs, start)
        result = to_jsonable(result)
        persist_last_run(result)
        return result
    except Exception as e:
        error_result = {
            "success": False, "error": str(e), "solver_status_name": "ENGINE_ERROR",
            "message": str(e), "filled": 0, "total": 0,
        }
        try:
            persist_last_run(error_result)
        except Exception:
            pass
        return JSONResponse(status_code=500, content=error_result)


@router.post("/auto")
async def auto_allotment():
    """One-click: generate allocations (Phase A) + schedule (Phase B) + apply.

    1. Generate a fresh allocation and try to schedule it.
    2. If that schedule is infeasible, fall back to scheduling the existing saved
       allocations (so a single click still produces a timetable when possible).
    Replaces the two-step "Auto Generate Allocations" → "Run Allotment" flow.
    """
    start = dt.datetime.now()
    try:
        subjects, classes, teachers, db_allocs = _load_domain()

        precheck = build_precheck_issues(subjects, classes, teachers)
        precheck_errors = [i for i in precheck if i["severity"] == "error"]
        if precheck_errors:
            return {
                "success": False, "ok": False, "phase": "validate",
                "message": precheck_errors[0]["message"],
                "errors": [{"type": i["type"], "message": i["message"]} for i in precheck_errors],
                "issues": precheck, "filled": 0, "total": len(classes) * 48,
            }

        was_fixed_by_name = {t["name"]: sb.is_fixed_target(t["allotted_periods"]) for t in teachers}
        name_to_teacher_id = {t["name"]: t["id"] for t in teachers}

        # ── Attempt 1: full generate + schedule ──────────────────────────
        payload = sb.build_solver_payload(teachers, classes, subjects, mode="full")
        raw = sb.run_solver(payload)
        result = sb.transform_solver_result(raw, teachers, classes)
        result["mode"] = "full"
        result["phase"] = raw.get("phase", "done")

        if result["success"]:
            sb.persist_allocations_and_targets(
                result["allocations"], result["targets"], name_to_teacher_id, was_fixed_by_name)
            result["allotment_source"] = "generated"
        else:
            # ── Attempt 2: schedule the existing saved allocations ───────
            fallback = _schedule_saved(subjects, classes, teachers, db_allocs, start)
            if fallback["success"]:
                fallback["allotment_source"] = "existing_allocations"
                fallback["message"] = (
                    "Auto-generated allocation couldn't be scheduled under the rules, "
                    "so your saved allocations were scheduled instead. "
                    + str(fallback.get("message", ""))
                )
                result = fallback
            else:
                # Neither worked — surface the clearer message.
                result["issues"] = build_allocation_issues(
                    subjects, classes, teachers, last_run=result)["issues"]
                result = to_jsonable(result)
                persist_last_run(result)
                return result

        result["issues"] = [i for i in precheck if i["severity"] == "warning"]
        elapsed_ms = int((dt.datetime.now() - start).total_seconds() * 1000)
        result["elapsed_ms"] = elapsed_ms
        result["message"] = f"{result.get('message', '')} (auto, {elapsed_ms}ms)".strip()

        result = to_jsonable(result)
        persist_last_run(result)
        inserted = _apply_result_to_timetable(result)
        result["applied"] = True
        result["slots_inserted"] = inserted
        return result
    except Exception as e:
        error_result = {
            "success": False, "error": str(e), "solver_status_name": "ENGINE_ERROR",
            "message": str(e), "filled": 0, "total": 0,
        }
        try:
            persist_last_run(error_result)
        except Exception:
            pass
        return JSONResponse(status_code=500, content=error_result)


@router.get("/result")
async def get_result():
    data = db.query_one("SELECT * FROM allocation_reports WHERE id = 1")
    if not data:
        return {"rules": {"R1": True, "R2": True}, "lastRun": None}
    report = data.get("report") or {}
    rules = {"R1": True, "R2": True, **(report.get("rules") or {})}
    gen = data.get("generated_at")
    return {
        "rules": rules,
        "lastRun": report.get("lastRun"),
        "generated_at": gen.isoformat() if hasattr(gen, "isoformat") else gen,
    }


@router.patch("/rules")
async def patch_rules(request: Request):
    body = await request.json() or {}
    existing = db.query_one("SELECT report FROM allocation_reports WHERE id = 1")
    current = (existing or {}).get("report") or {}
    updated = {**current, "rules": {"R1": True, "R2": True, **(body.get("rules") or {})}}
    db.execute(
        """INSERT INTO allocation_reports (id, report) VALUES (1, %s)
           ON CONFLICT (id) DO UPDATE SET report = EXCLUDED.report""",
        [_jsonb(updated)])
    return {"rules": updated["rules"]}


@router.delete("/result")
async def delete_result():
    existing = db.query_one("SELECT report FROM allocation_reports WHERE id = 1")
    prev = (existing or {}).get("report") or {}
    rest = {k: v for k, v in prev.items() if k != "lastRun"}
    report = {**rest, "rules": {"R1": True, "R2": True}}
    db.execute(
        """INSERT INTO allocation_reports (id, report, generated_at) VALUES (1, %s, %s)
           ON CONFLICT (id) DO UPDATE SET report = EXCLUDED.report,
                                          generated_at = EXCLUDED.generated_at""",
        [_jsonb(report), dt.datetime.now(dt.timezone.utc)])
    return {"cleared": True}


@router.get("/status")
async def status():
    return {"running": False}


@router.post("/cancel")
async def cancel():
    return {"cancelled": False, "message": "CP-SAT solver runs synchronously."}


def _apply_result_to_timetable(result) -> int:
    """Write a successful solver result's grid into the timetable. Returns rows inserted."""
    grid = result["grid"]
    rows = []
    for class_id, days in grid.items():
        for d in range(len(days)):
            for p in range(len(days[d])):
                slot = days[d][p]
                if not slot:
                    continue
                entry = slot[0]
                subject_name = entry.get("subject_id") or entry.get("subject")
                if subject_name and subject_name.startswith("S") and subject_name in SUBJECT_ID_TO_NAME:
                    subject_name = SUBJECT_ID_TO_NAME[subject_name]
                rows.append({
                    "class_id": class_id,
                    "teacher_id": entry.get("teacher_id"),
                    "day": d + 1,
                    "period": p + 1,
                    "subject": subject_name,
                })

    db.execute("DELETE FROM timetable WHERE id <> %s", [ZERO_UUID])
    for r in rows:
        db.execute(
            """INSERT INTO timetable (class_id, teacher_id, day, period, subject)
               VALUES (%s, %s, %s, %s, %s)""",
            [r["class_id"], r["teacher_id"], r["day"], r["period"], r["subject"]])

    if result.get("teacher_summary"):
        for tid, data in result["teacher_summary"].items():
            db.execute("UPDATE teachers SET allocated_periods = %s WHERE id = %s",
                       [data.get("allocated", 0), tid])
    return len(rows)


@router.post("/apply")
async def apply():
    try:
        stored = db.query_one("SELECT report FROM allocation_reports WHERE id = 1")
        result = ((stored or {}).get("report") or {}).get("lastRun")
        if not result or not result.get("success"):
            return JSONResponse(status_code=400, content={"error": "No successful run to apply"})
        inserted = _apply_result_to_timetable(result)
        return {"success": True, "slots_inserted": inserted}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
