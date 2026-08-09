"""Solver bridge — Python port of backend/src/lib/solverBridge.js.

The CP-SAT solver (solver.py) is now called in-process instead of being spawned
as a subprocess, but the payload/result shapes are identical to the Node version
so the frontend contract is unchanged.
"""
from app.services import solver as cp_solver
from app.core.config import settings

PERIODS_PER_CLASS = 48


def fixed_target_from_db(allotted_periods):
    try:
        n = float(allotted_periods)
    except (TypeError, ValueError):
        return None
    return int(n) if n > 0 else None


def is_fixed_target(allotted_periods):
    return fixed_target_from_db(allotted_periods) is not None


def before_target_from_db(allotted_periods):
    return fixed_target_from_db(allotted_periods)


def subject_column_for_class(class_name):
    return f"periods_{str(class_name).lower()}"


def build_curriculum(subjects, classes):
    curriculum = {}
    for s in subjects:
        curriculum[s["name"]] = {}
        for cls in classes:
            col = subject_column_for_class(cls["name"])
            if col not in s:
                continue
            p = s[col]
            if p is not None and float(p) > 0:
                curriculum[s["name"]][cls["name"]] = int(p)
    return curriculum


def map_allocations_to_db(raw_allocations, teachers, classes):
    name_to_teacher = {t["name"]: t["id"] for t in teachers}
    name_to_class = {c["name"]: c["id"] for c in classes}
    return [
        {
            "teacher_id": name_to_teacher.get(a["teacher"]),
            "class_id": name_to_class.get(a["class"]),
            "subject": a["subject"],
            "periods_weekly": a["periods"],
        }
        for a in (raw_allocations or [])
    ]


def map_db_allocations_to_solver(db_rows, teachers, classes):
    teacher_by_id = {t["id"]: t for t in teachers}
    class_by_id = {c["id"]: c for c in classes}
    out = []
    for r in db_rows or []:
        if int(r["periods_weekly"]) <= 0:
            continue
        teacher = r.get("teacher_name") or (teacher_by_id.get(r["teacher_id"]) or {}).get("name")
        cls = r.get("class_name") or (class_by_id.get(r["class_id"]) or {}).get("name")
        if teacher and cls:
            out.append({
                "teacher": teacher,
                "class": cls,
                "subject": r["subject"],
                "periods": int(r["periods_weekly"]),
            })
    return out


def build_solver_payload(teachers, classes, subjects, mode="full", allocations=None):
    teacher_by_id = {t["id"]: t for t in teachers}
    payload = {
        "mode": mode,
        "teachers": [
            {
                "name": t["name"],
                "subjects": t.get("subjects") or [],
                "min_class_level": t.get("min_class_level", 1),
                "max_class_level": t.get("max_class_level", 10),
                "min_period_start": t.get("min_period_start", 1),
                "fixed_target": fixed_target_from_db(t.get("allotted_periods")),
            }
            for t in teachers
        ],
        "classes": [
            {
                "name": c["name"],
                "class_level": c["class_level"],
                "class_teacher": (teacher_by_id.get(c["class_teacher_id"]) or {}).get("name")
                if c.get("class_teacher_id") else None,
            }
            for c in classes
        ],
        "curriculum": build_curriculum(subjects, classes),
        "time_limit": settings.SOLVER_TIME_LIMIT,
        "workers": settings.SOLVER_WORKERS,
        "same_period_consistency": settings.SAME_PERIOD_CONSISTENCY,
    }
    if mode == "schedule" and allocations:
        payload["allocations"] = allocations
    return payload


def build_target_changes(teachers, targets, payload_teachers):
    fixed_by_name = {t["name"]: t.get("fixed_target") is not None for t in payload_teachers}
    changes = []
    for t in teachers:
        before = before_target_from_db(t.get("allotted_periods"))
        after = (targets or {}).get(t["name"], 0)
        changes.append({
            "teacher": t["name"],
            "fixed": fixed_by_name.get(t["name"], False),
            "before": before,
            "after": after,
            "delta": None if before is None else after - before,
        })
    changes.sort(key=lambda c: (-abs(c["delta"] or 0), c["teacher"]))
    return changes


def run_solver(payload):
    """Call the CP-SAT solver in-process (identical output shape to subprocess)."""
    return cp_solver.solve(
        payload,
        time_limit=int(payload.get("time_limit", settings.SOLVER_TIME_LIMIT)),
        workers=int(payload.get("workers", settings.SOLVER_WORKERS)),
    )


def build_class_summary_from_allocations(allocations, classes):
    summary = {}
    for cls in classes:
        rows = [a for a in (allocations or []) if a["class_id"] == cls["id"]]
        summary[cls["id"]] = {
            "periods_filled": sum(a["periods_weekly"] for a in rows),
            "ct_periods": sum(
                a["periods_weekly"] for a in rows if a["teacher_id"] == cls.get("class_teacher_id")
            ) if cls.get("class_teacher_id") else 0,
        }
    return summary


def transform_allocate_result(raw, teachers, classes):
    total_expected = len(classes) * PERIODS_PER_CLASS

    if not raw.get("ok"):
        return {
            "success": False,
            "totalAssigned": raw.get("filled", 0),
            "totalExpected": raw.get("total", total_expected),
            "solver_status_name": str(raw.get("phase", "FAILED")).upper(),
            "message": raw.get("message") or "\n".join(raw.get("errors", [])),
            "errors": [{"type": "solver_error", "message": m} for m in raw.get("errors", [])],
            "phase": raw.get("phase"),
            "targets": raw.get("targets"),
        }

    allocations = map_allocations_to_db(raw.get("allocations"), teachers, classes)
    total_assigned = sum(a["periods_weekly"] for a in allocations)
    class_summary = build_class_summary_from_allocations(allocations, classes)

    return {
        "success": True,
        "allocations": allocations,
        "targets": raw.get("targets"),
        "totalAssigned": total_assigned,
        "totalExpected": raw.get("total", total_expected),
        "filled": total_assigned,
        "total": raw.get("total", total_expected),
        "class_summary": class_summary,
        "message": raw.get("message") or f"Allocation complete: {total_assigned}/{total_expected}.",
        "errors": [],
    }


def persist_allocations_and_targets(allocations, targets, name_to_teacher_id, was_fixed_by_name):
    from app.db import database as db

    if not allocations:
        return

    with db.get_cursor() as cur:
        cur.execute(
            "DELETE FROM subject_allocations WHERE teacher_id <> %s",
            ["00000000-0000-0000-0000-000000000000"],
        )

        for a in allocations:
            cur.execute(
                """INSERT INTO subject_allocations (teacher_id, class_id, subject, periods_weekly)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (teacher_id, class_id, subject)
                   DO UPDATE SET periods_weekly = EXCLUDED.periods_weekly""",
                [a["teacher_id"], a["class_id"], a["subject"], a["periods_weekly"]],
            )

        if targets and isinstance(targets, dict):
            for name, target in targets.items():
                tid = name_to_teacher_id.get(name)
                if not tid:
                    continue
                fixed = was_fixed_by_name.get(name) is True
                cur.execute(
                    "UPDATE teachers SET allocated_periods = %s, allotted_periods = %s WHERE id = %s",
                    [target, target if fixed else 0, tid],
                )


def transform_solver_result(raw, teachers, classes):
    name_to_teacher = {t["name"]: t["id"] for t in teachers}
    total_slots = len(classes) * PERIODS_PER_CLASS

    if not raw.get("ok"):
        return {
            "success": False,
            "filled": raw.get("filled", 0),
            "total": raw.get("total", total_slots),
            "solver_status_name": str(raw.get("phase", "FAILED")).upper(),
            "message": raw.get("message") or "\n".join(raw.get("errors", [])),
            "errors": [{"type": "solver_error", "message": m} for m in raw.get("errors", [])],
            "phase": raw.get("phase"),
            "targets": raw.get("targets"),
            "phases": ["cp_sat_schedule"] if raw.get("phase") == "done" else ["cp_sat_two_phase"],
        }

    grid = {}
    teacher_summary = {}
    class_summary = {}

    for cls in classes:
        days = raw["grid"].get(cls["name"], [])
        grid[cls["id"]] = []
        class_filled = 0
        for d in range(len(days)):
            row = []
            day = days[d] or []
            for p in range(len(day)):
                slot = day[p]
                if not slot:
                    row.append([])
                    continue
                tid = name_to_teacher.get(slot["teacher"])
                subject = slot["subject"]
                row.append([{"teacher_id": tid, "subject_id": subject}])
                class_filled += 1
                if tid not in teacher_summary:
                    teacher_summary[tid] = {"allocated": 0, "subjects": {}, "classes": set()}
                teacher_summary[tid]["allocated"] += 1
                teacher_summary[tid]["subjects"][subject] = teacher_summary[tid]["subjects"].get(subject, 0) + 1
                teacher_summary[tid]["classes"].add(cls["id"])
            grid[cls["id"]].append(row)
        class_summary[cls["id"]] = {"periods_filled": class_filled, "subjects": {}}

    serialized_teacher_summary = {
        tid: {
            "allocated": data["allocated"],
            "subjects": data["subjects"],
            "classes": sorted(data["classes"]),
        }
        for tid, data in teacher_summary.items()
    }

    allocations = map_allocations_to_db(raw.get("allocations"), teachers, classes)
    class_summary_alloc = build_class_summary_from_allocations(allocations, classes)
    for cls in classes:
        if cls["id"] in class_summary:
            class_summary_alloc[cls["id"]] = {
                **class_summary_alloc.get(cls["id"], {}),
                "periods_filled": class_summary[cls["id"]]["periods_filled"],
            }

    return {
        "success": True,
        "filled": raw.get("filled"),
        "total": raw.get("total", total_slots),
        "solver_status_name": "OPTIMAL",
        "message": raw.get("message"),
        "grid": grid,
        "teacher_summary": serialized_teacher_summary,
        "class_summary": class_summary_alloc,
        "allocations": allocations,
        "targets": raw.get("targets"),
        "phases": ["cp_sat_schedule"],
        "preflight_issues": {"fatal": [], "warn": []},
        "errors": [],
        "warnings": [],
    }
