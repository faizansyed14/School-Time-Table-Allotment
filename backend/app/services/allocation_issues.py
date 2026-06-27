"""Allocation issue checks — Python port of backend/src/lib/allocationIssues.js."""

PERIODS_PER_CLASS = 48


def subject_column_for_class(class_name):
    return f"periods_{str(class_name).lower()}"


def eligible_teachers(teachers, class_level, subject_name):
    out = []
    for t in teachers or []:
        subs = t.get("subjects") or []
        min_l = t.get("min_class_level", 1)
        max_l = t.get("max_class_level", 10)
        if subject_name in subs and min_l <= class_level <= max_l:
            out.append(t)
    return out


def _dedupe(issues):
    seen = set()
    out = []
    for i in issues:
        key = f"{i.get('type')}|{i.get('class_name', '')}|{i.get('subject', '')}|{i.get('message')}"
        if key in seen:
            continue
        seen.add(key)
        out.append(i)
    return out


def _sort(issues):
    rank = {"error": 0, "warning": 1, "info": 2}
    return sorted(
        issues,
        key=lambda i: (
            rank.get(i.get("severity"), 9),
            i.get("class_name") or "",
            i.get("message") or "",
        ),
    )


def build_precheck_issues(subjects, classes, teachers):
    issues = []
    for cls in classes or []:
        col = subject_column_for_class(cls["name"])
        curriculum_total = 0
        for s in subjects or []:
            p = s.get(col)
            if p is None or float(p) <= 0:
                continue
            periods = int(p)
            curriculum_total += periods
            if len(eligible_teachers(teachers, cls["class_level"], s["name"])) == 0:
                issues.append({
                    "severity": "error",
                    "type": "no_subject_teacher",
                    "class_name": cls["name"],
                    "subject": s["name"],
                    "message": f"No teacher can teach {s['name']} to class {cls['name']} (level {cls['class_level']}).",
                    "actions": [
                        {"page": "Teachers", "label": "Add subject to a teacher", "link": "/teachers"},
                        {"page": "Curriculum", "label": "Review curriculum", "link": "/curriculum"},
                    ],
                })

        if curriculum_total != PERIODS_PER_CLASS:
            issues.append({
                "severity": "error",
                "type": "curriculum_not_48",
                "class_name": cls["name"],
                "message": f"Class {cls['name']} curriculum sums to {curriculum_total} (must be {PERIODS_PER_CLASS}).",
                "actions": [{"page": "Curriculum", "label": f"Fix Class {cls['name']}", "link": "/curriculum"}],
            })

        if not cls.get("class_teacher_id"):
            issues.append({
                "severity": "warning",
                "type": "no_class_teacher",
                "class_name": cls["name"],
                "message": f"Class {cls['name']} has no class teacher assigned (R1 will be skipped).",
                "actions": [{"page": "Teachers", "label": "Assign class teacher", "link": "/teachers"}],
            })

    return issues


def build_allocation_plan_issues(subjects, classes, teachers, allocations):
    issues = []
    teacher_by_id = {t["id"]: t for t in (teachers or [])}
    class_by_id = {c["id"]: c for c in (classes or [])}

    if not allocations:
        issues.append({
            "severity": "error",
            "type": "no_saved_allocations",
            "message": "No saved allocations. Auto-generate or enter rows on the Allocations page first.",
            "actions": [{"page": "Allocations", "label": "Open Allocations", "link": "/allocations"}],
        })
        return issues

    expected = {}
    for cls in classes or []:
        col = subject_column_for_class(cls["name"])
        expected[cls["name"]] = {"total": 0, "subjects": {}}
        for s in subjects or []:
            p = s.get(col)
            if p is not None and float(p) > 0:
                expected[cls["name"]]["subjects"][s["name"]] = int(p)
                expected[cls["name"]]["total"] += int(p)

    actual = {}
    for row in allocations:
        cls = class_by_id.get(row["class_id"])
        tch = teacher_by_id.get(row["teacher_id"])
        if not cls or not tch:
            continue
        cname = cls["name"]
        periods = int(row["periods_weekly"])
        actual.setdefault(cname, {"total": 0, "subjects": {}})
        actual[cname]["subjects"][row["subject"]] = actual[cname]["subjects"].get(row["subject"], 0) + periods
        actual[cname]["total"] += periods

        if not any(t["id"] == row["teacher_id"]
                   for t in eligible_teachers(teachers, cls["class_level"], row["subject"])):
            issues.append({
                "severity": "error",
                "type": "allocation_ineligible",
                "class_name": cname,
                "subject": row["subject"],
                "message": f"{tch['name']} cannot teach {row['subject']} to class {cname} (level {cls['class_level']}).",
                "actions": [{"page": "Allocations", "label": "Fix allocation row", "link": "/allocations"}],
            })

    for cls in classes or []:
        cname = cls["name"]
        got = (actual.get(cname) or {}).get("total", 0)
        if got != PERIODS_PER_CLASS:
            issues.append({
                "severity": "error",
                "type": "allocation_not_48",
                "class_name": cname,
                "message": f"Class {cname} allocations sum to {got} (must be {PERIODS_PER_CLASS}).",
                "actions": [{"page": "Allocations", "label": f"Fix Class {cname}", "link": "/allocations"}],
            })
        for sub, need in (expected.get(cname) or {}).get("subjects", {}).items():
            have = (actual.get(cname) or {}).get("subjects", {}).get(sub, 0)
            if have != need:
                issues.append({
                    "severity": "error",
                    "type": "allocation_subject_mismatch",
                    "class_name": cname,
                    "subject": sub,
                    "message": f"Class {cname} {sub}: allocated {have}, curriculum requires {need}.",
                    "actions": [{"page": "Allocations", "label": "Fix allocations", "link": "/allocations"}],
                })

    return issues


def _build_solver_issues(last_run):
    if not last_run or last_run.get("success"):
        return []
    issues = []
    for e in last_run.get("errors", []) or []:
        message = e if isinstance(e, str) else (e.get("message") if isinstance(e, dict) else str(e))
        if not message:
            continue
        issues.append({
            "severity": "error",
            "type": "solver_error",
            "message": message,
            "actions": [{"page": "Allotment", "label": "Open Allotment", "link": "/allotment"}],
        })

    msg = last_run.get("message")
    if msg and not any((e.get("message") if isinstance(e, dict) else e) == msg
                       for e in (last_run.get("errors", []) or [])):
        issues.append({
            "severity": "error",
            "type": "solver_error",
            "message": msg,
            "actions": [{"page": "Allotment", "label": "Open Allotment", "link": "/allotment"}],
        })
    return issues


def build_allocation_issues(subjects, classes, teachers, last_run=None, plan_issues=None):
    issues = _sort(_dedupe(
        build_precheck_issues(subjects, classes, teachers)
        + (plan_issues or [])
        + _build_solver_issues(last_run)
    ))
    errors = [i for i in issues if i["severity"] == "error"]
    return {
        "ok": len(errors) == 0,
        "error_count": len(errors),
        "warning_count": len([i for i in issues if i["severity"] == "warning"]),
        "info_count": 0,
        "issues": issues,
    }
