"""Absences + substitute coverage."""
import datetime as dt

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.db import database as db
from app.core.security import require_auth

router = APIRouter(dependencies=[Depends(require_auth)])

DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]


def date_to_school_day(date_str: str) -> int:
    d = dt.date.fromisoformat(date_str)
    dow = d.isoweekday()  # Mon=1 .. Sun=7
    return 6 if dow == 7 else dow


def teacher_can_cover(teacher, subject, class_level):
    subjects = teacher.get("subjects") or []
    teaches_subject = subject in subjects
    in_range = (class_level >= (teacher.get("min_class_level") or 1)
                and class_level <= (teacher.get("max_class_level") or 10))
    min_p = teacher.get("min_period_start") or 1
    return teaches_subject, in_range, min_p


def substitute_match_tier(teacher, slot, class_level):
    teaches_subject, in_range, min_p = teacher_can_cover(teacher, slot["subject"], class_level)
    if slot["period"] < min_p:
        return "none"
    if teaches_subject and in_range:
        return "best"
    if teaches_subject and not in_range:
        return "subject"
    return "other"


@router.get("/substitute-coverage")
async def substitute_coverage(teacher_id: str | None = None, date: str | None = None,
                              absence_id: str | None = None):
    if not teacher_id or not date:
        return JSONResponse(status_code=400, content={"error": "teacher_id and date required"})

    day = date_to_school_day(date)

    slots_rows = db.query(
        """SELECT t.id, t.day, t.period, t.subject, t.class_id,
                  c.name AS class_name, c.class_level
           FROM timetable t LEFT JOIN classes c ON c.id = t.class_id
           WHERE t.teacher_id = %s AND t.day = %s ORDER BY t.period""",
        [teacher_id, day],
    )
    absent_rows = db.query("SELECT teacher_id FROM absences WHERE absent_date = %s", [date])
    day_timetable = db.query("SELECT teacher_id, period FROM timetable WHERE day = %s", [day])
    teachers = db.query(
        """SELECT id, name, subjects, min_class_level, max_class_level, min_period_start
           FROM teachers ORDER BY name"""
    )
    subs_rows = []
    if absence_id:
        subs_rows = db.query(
            """SELECT s.timetable_id, s.substitute_teacher_id, te.name AS sub_name
               FROM substitutions s LEFT JOIN teachers te ON te.id = s.substitute_teacher_id
               WHERE s.absence_id = %s""",
            [absence_id],
        )

    absent_ids = {str(a["teacher_id"]) for a in absent_rows}
    absent_ids.add(str(teacher_id))

    busy_by_period = {p: set() for p in range(1, 9)}
    for row in day_timetable:
        if row["teacher_id"] and row["period"]:
            busy_by_period[row["period"]].add(str(row["teacher_id"]))

    pool = [t for t in teachers if str(t["id"]) not in absent_ids]
    sub_by_timetable = {
        str(s["timetable_id"]): {"id": str(s["substitute_teacher_id"]), "name": s.get("sub_name") or ""}
        for s in subs_rows
    }

    slots = []
    for slot in slots_rows:
        class_level = slot["class_level"] if slot["class_level"] is not None else 1
        busy_here = busy_by_period.get(slot["period"], set())
        available = []
        for t in pool:
            if str(t["id"]) in busy_here:
                continue
            teaches_subject, in_range, min_p = teacher_can_cover(t, slot["subject"], class_level)
            period_ok = slot["period"] >= min_p
            tier = substitute_match_tier(t, slot, class_level)
            if tier == "none":
                continue
            available.append({
                "id": str(t["id"]),
                "name": t["name"],
                "subjects": t["subjects"] or [],
                "min_class_level": t["min_class_level"],
                "max_class_level": t["max_class_level"],
                "level_label": f"L{t['min_class_level']}–L{t['max_class_level']}",
                "teaches_subject": teaches_subject,
                "in_class_range": in_range,
                "period_ok": period_ok,
                "match_tier": tier,
                "match_label": "Subject + level match" if tier == "best"
                else "Subject match, level mismatch" if tier == "subject"
                else "Other (different subject)",
                "recommended": tier == "best",
            })

        order = {"best": 0, "subject": 1, "other": 2}
        available.sort(key=lambda a: (order[a["match_tier"]], a["name"]))

        slots.append({
            "id": str(slot["id"]),
            "day": slot["day"],
            "period": slot["period"],
            "subject": slot["subject"],
            "class_id": str(slot["class_id"]) if slot["class_id"] else None,
            "class_name": slot.get("class_name") or "",
            "class_level": class_level,
            "available": available,
            "available_count": len(available),
            "recommended_count": len([t for t in available if t["match_tier"] == "best"]),
            "substitute": sub_by_timetable.get(str(slot["id"])),
            "needs_substitute": True,
        })

    class_ids = list({s["class_id"] for s in slots if s["class_id"]})
    class_timetables = {}
    if class_ids:
        class_rows = db.query(
            """SELECT t.id, t.class_id, t.period, t.subject, t.teacher_id,
                      te.name AS teacher_name, c.name AS class_name, c.class_level
               FROM timetable t
               LEFT JOIN teachers te ON te.id = t.teacher_id
               LEFT JOIN classes c ON c.id = t.class_id
               WHERE t.day = %s AND t.class_id = ANY(%s::uuid[]) ORDER BY t.period""",
            [day, class_ids],
        )
        absent_slot_ids = {s["id"] for s in slots}
        for cid in class_ids:
            rows = [r for r in class_rows if str(r["class_id"]) == cid]
            first = rows[0] if rows else None
            periods = []
            for i in range(8):
                p = i + 1
                row = next((r for r in rows if r["period"] == p), None)
                if not row:
                    periods.append({"period": p, "empty": True})
                    continue
                rid = str(row["id"])
                is_absent_slot = rid in absent_slot_ids
                sub = sub_by_timetable.get(rid)
                periods.append({
                    "period": p,
                    "timetable_id": rid,
                    "subject": row["subject"],
                    "teacher_id": str(row["teacher_id"]) if row["teacher_id"] else None,
                    "teacher_name": row.get("teacher_name") or "—",
                    "is_absent_slot": is_absent_slot,
                    "substitute": sub,
                    "display_teacher": (sub or {}).get("name") or row.get("teacher_name") or "—",
                })
            class_timetables[cid] = {
                "class_id": cid,
                "class_name": (first or {}).get("class_name") or "",
                "class_level": (first or {}).get("class_level") if first else 1,
                "periods": periods,
            }

    classes = sorted(
        [class_timetables[cid] for cid in class_ids if cid in class_timetables],
        key=lambda c: c["class_name"],
    )

    return {
        "date": date,
        "day": day,
        "day_name": DAY_NAMES[day - 1],
        "slots": slots,
        "classes": classes,
        "summary": {
            "total_slots": len(slots),
            "assigned": len([s for s in slots if s["substitute"]]),
            "pending": len([s for s in slots if not s["substitute"]]),
        },
    }


@router.get("/available-substitutes")
async def available_substitutes(teacher_id: str | None = None, date: str | None = None):
    if not teacher_id or not date:
        return JSONResponse(status_code=400, content={"error": "teacher_id and date required"})
    absent_ids = db.query("SELECT teacher_id FROM absences WHERE absent_date = %s", [date])
    excluded = {str(teacher_id)} | {str(a["teacher_id"]) for a in absent_ids}
    teachers = db.query(
        """SELECT id, name, subjects, min_class_level, max_class_level,
                  allotted_periods, allocated_periods FROM teachers ORDER BY name"""
    )
    out = []
    for t in teachers:
        if str(t["id"]) in excluded:
            continue
        out.append({
            "id": str(t["id"]),
            "name": t["name"],
            "subjects": t["subjects"] or [],
            "min_class_level": t["min_class_level"],
            "max_class_level": t["max_class_level"],
            "allotted_periods": t["allotted_periods"],
            "allocated_periods": t["allocated_periods"],
            "level_label": f"L{t['min_class_level']}–L{t['max_class_level']}",
        })
    return out


@router.get("")
async def list_absences(date: str | None = None):
    where, params = [], []
    if date:
        where.append("a.absent_date = %s")
        params.append(date)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    absences = db.query(
        f"""SELECT a.id, a.teacher_id, a.absent_date, a.reason, a.created_at,
                   t.name AS teacher_name
            FROM absences a LEFT JOIN teachers t ON t.id = a.teacher_id
            {clause} ORDER BY a.absent_date DESC""",
        params,
    )
    absence_ids = [a["id"] for a in absences]
    subs_by_absence = {}
    if absence_ids:
        subs = db.query(
            """SELECT s.absence_id, s.substitute_teacher_id, s.timetable_id, te.name AS sub_name
               FROM substitutions s LEFT JOIN teachers te ON te.id = s.substitute_teacher_id
               WHERE s.absence_id = ANY(%s::uuid[])""",
            [absence_ids],
        )
        for s in subs:
            subs_by_absence.setdefault(str(s["absence_id"]), []).append({
                "substitute_teacher_id": str(s["substitute_teacher_id"]),
                "timetable_id": str(s["timetable_id"]),
                "teachers": {"name": s.get("sub_name")},
            })

    out = []
    for a in absences:
        out.append({
            "id": str(a["id"]),
            "teacher_id": str(a["teacher_id"]) if a["teacher_id"] else None,
            "absent_date": a["absent_date"].isoformat() if hasattr(a["absent_date"], "isoformat") else a["absent_date"],
            "reason": a["reason"],
            "teachers": {"id": str(a["teacher_id"]) if a["teacher_id"] else None, "name": a.get("teacher_name")},
            "substitutions": subs_by_absence.get(str(a["id"]), []),
        })
    return out


@router.post("")
async def mark_absent(request: Request):
    body = await request.json()
    teacher_id = body.get("teacher_id")
    absent_date = body.get("absent_date")
    reason = body.get("reason")
    if not teacher_id or not absent_date:
        return JSONResponse(status_code=400, content={"error": "teacher_id and absent_date required"})
    try:
        row = db.execute_returning(
            """INSERT INTO absences (teacher_id, absent_date, reason)
               VALUES (%s, %s, %s)
               ON CONFLICT (teacher_id, absent_date)
               DO UPDATE SET reason = EXCLUDED.reason
               RETURNING id, teacher_id, absent_date, reason""",
            [teacher_id, absent_date, reason],
        )
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    teacher = db.query_one("SELECT name FROM teachers WHERE id = %s", [teacher_id])
    out = {
        "id": str(row["id"]),
        "teacher_id": str(row["teacher_id"]),
        "absent_date": row["absent_date"].isoformat() if hasattr(row["absent_date"], "isoformat") else row["absent_date"],
        "reason": row["reason"],
        "teachers": {"name": (teacher or {}).get("name")},
    }
    return JSONResponse(status_code=201, content=out)


@router.delete("/{absence_id}")
async def delete_absence(absence_id: str):
    try:
        db.execute("DELETE FROM absences WHERE id = %s", [absence_id])
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return {"success": True}


@router.post("/{absence_id}/substitute")
async def assign_substitute(absence_id: str, request: Request):
    body = await request.json()
    timetable_id = body.get("timetable_id")
    substitute_teacher_id = body.get("substitute_teacher_id")
    if not timetable_id or not substitute_teacher_id:
        return JSONResponse(status_code=400,
                            content={"error": "timetable_id and substitute_teacher_id required"})
    try:
        row = db.execute_returning(
            """INSERT INTO substitutions (absence_id, timetable_id, substitute_teacher_id)
               VALUES (%s, %s, %s)
               ON CONFLICT (absence_id, timetable_id)
               DO UPDATE SET substitute_teacher_id = EXCLUDED.substitute_teacher_id
               RETURNING id, absence_id, timetable_id, substitute_teacher_id""",
            [absence_id, timetable_id, substitute_teacher_id],
        )
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    out = {k: (str(v) if v is not None else None) for k, v in row.items()}
    return JSONResponse(status_code=201, content=out)
