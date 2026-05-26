#!/usr/bin/env python3
"""
auto_generate_allocations.py — auto-build subject_allocations from existing DB state.

Reads teachers, classes, subjects from a JSON snapshot.
Solves CP-SAT to produce the subject_allocations rows.

Usage:
    python3 auto_generate_allocations.py --in input.json --out output.json
"""
from __future__ import annotations
import argparse, json, sys
from collections import defaultdict
from pathlib import Path
from ortools.sat.python import cp_model

CLASS_COL_MAP = {
    "1A": "periods_1a", "1B": "periods_1b",
    "2A": "periods_2a", "2B": "periods_2b",
    "3A": "periods_3a", "3B": "periods_3b",
    "4A": "periods_4a", "4B": "periods_4b",
    "5":  "periods_5",  "6A": "periods_6a", "6B": "periods_6b",
    "7":  "periods_7",  "8":  "periods_8",
    "9":  "periods_9",  "10": "periods_10",
}
PERIODS_PER_CLASS = 48
TARGET_CT_PERIODS = 6
DIARY_SUBJECT = "Diary"


def build_required(subjects, classes):
    required = {}
    class_by_name = {c["name"]: c for c in classes}
    for s in subjects:
        for cname, col in CLASS_COL_MAP.items():
            v = s.get(col)
            if not v or v <= 0: continue
            c = class_by_name.get(cname)
            if not c: continue
            required[(c["id"], s["name"])] = int(v)
    return required


def validate(data, required):
    errors, warnings = [], []
    teachers, classes = data["teachers"], data["classes"]
    teacher_by_id = {t["id"]: t for t in teachers}

    by_class = defaultdict(int)
    for (cid, sname), v in required.items():
        by_class[cid] += v
    for c in classes:
        tot = by_class.get(c["id"], 0)
        if tot != PERIODS_PER_CLASS:
            errors.append(
                f"Class {c['name']} requires {tot} periods/week (must equal {PERIODS_PER_CLASS}). "
                f"Fix on Curriculum page → adjust subject requirements for Class {c['name']}."
            )

    tot_t = sum(t.get("allotted_periods") or 0 for t in teachers)
    tot_r = sum(required.values())
    if tot_t != tot_r:
        errors.append(
            f"Teacher workload sum ({tot_t}) ≠ total class demand ({tot_r}). "
            f"Difference {abs(tot_t - tot_r)} periods. "
            f"Adjust teacher 'allotted periods' on Teachers page, or class subject requirements on Curriculum."
        )

    class_by_id = {c["id"]: c for c in classes}
    for (cid, sname), need in required.items():
        c = class_by_id[cid]
        level = c["class_level"]
        eligible = [
            t for t in teachers
            if sname in (t.get("subjects") or [])
            and (t.get("min_class_level") or 1) <= level <= (t.get("max_class_level") or 10)
        ]
        if not eligible:
            errors.append(
                f"No teacher can teach {sname} to Class {c['name']} (level {level}). "
                f"Fix on Teachers page: add {sname} to a teacher's subjects, OR widen their class range to include level {level}."
            )

    for c in classes:
        ct_id = c.get("class_teacher_id")
        if not ct_id or ct_id not in teacher_by_id: continue
        ct = teacher_by_id[ct_id]
        level = c["class_level"]
        if not ((ct.get("min_class_level") or 1) <= level <= (ct.get("max_class_level") or 10)):
            errors.append(
                f"Class {c['name']} class teacher {ct['name']} cannot teach at level {level}. "
                f"Widen their class range on Teachers page."
            )
            continue
        max_p = sum(required.get((c["id"], s), 0) for s in (ct.get("subjects") or []))
        if max_p < TARGET_CT_PERIODS:
            warnings.append(
                f"Class {c['name']} class teacher {ct['name']} can teach at most {max_p} period(s) here "
                f"(needs ≥{TARGET_CT_PERIODS} for R1). "
                f"Fix: on Curriculum, increase a subject they teach for Class {c['name']}; "
                f"OR change Class {c['name']}'s class teacher to someone with more subjects in this class."
            )

    # 5. Per-teacher: target must not exceed max possible (sum of their subjects in eligible classes)
    for t in teachers:
        target = t.get("allotted_periods") or 0
        if target == 0: continue
        max_possible = 0
        for c in classes:
            if not ((t.get("min_class_level") or 1) <= c["class_level"] <= (t.get("max_class_level") or 10)): continue
            for s in (t.get("subjects") or []):
                max_possible += required.get((c["id"], s), 0)
        if max_possible < target:
            errors.append(
                f"{t['name']}: workload target is {target} but the maximum they can possibly teach is {max_possible} "
                f"(sum of their subjects' requirements in classes within their range). "
                f"Difference: {target - max_possible} period(s). "
                f"Fix on Teachers page: either lower their workload to {max_possible}, "
                f"OR add another subject to their subjects[], "
                f"OR widen their class range, "
                f"OR (on Curriculum) increase the requirement for a subject they teach."
            )

    return errors, warnings


def solve(data, required):
    teachers = data["teachers"]
    classes = data["classes"]
    teacher_by_id = {t["id"]: t for t in teachers}
    class_by_id = {c["id"]: c for c in classes}

    cands = {}
    for (cid, sname), need in required.items():
        c = class_by_id[cid]
        for t in teachers:
            if sname not in (t.get("subjects") or []): continue
            if not ((t.get("min_class_level") or 1) <= c["class_level"] <= (t.get("max_class_level") or 10)): continue
            cands[(t["id"], cid, sname)] = need

    model = cp_model.CpModel()
    x = {k: model.new_int_var(0, ub, "") for k, ub in cands.items()}
    used = {k: model.new_bool_var("") for k in cands}
    for k in cands:
        model.add(x[k] >= 1).only_enforce_if(used[k])
        model.add(x[k] == 0).only_enforce_if(used[k].Not())

    for (cid, sname), need in required.items():
        keys = [k for k in cands if k[1] == cid and k[2] == sname]
        contribs = [x[k] for k in keys]
        if contribs:
            model.add(sum(contribs) == need)

    # Diary (period 8): class teacher teaches Diary in their class (2A→Neha, 2B→Sujata)
    for cid, c in class_by_id.items():
        need = required.get((cid, DIARY_SUBJECT))
        if not need:
            continue
        ct_id = c.get("class_teacher_id")
        if not ct_id or ct_id not in teacher_by_id:
            continue
        ct = teacher_by_id[ct_id]
        if DIARY_SUBJECT not in (ct.get("subjects") or []):
            continue
        k_ct = (ct_id, cid, DIARY_SUBJECT)
        if k_ct not in cands:
            continue
        for k in cands:
            if k[1] == cid and k[2] == DIARY_SUBJECT and k[0] != ct_id:
                model.add(used[k] == 0)

    for t in teachers:
        target = t.get("allotted_periods") or 0
        contribs = [x[k] for k in cands if k[0] == t["id"]]
        if target == 0:
            for v in contribs:
                model.add(v == 0)
        elif contribs:
            model.add(sum(contribs) == target)

    # Soft: reward class teacher coverage (up to 6 periods each)
    ct_reward_vars = []
    for c in classes:
        ct_id = c.get("class_teacher_id")
        if not ct_id or ct_id not in teacher_by_id: continue
        ct_contribs = [x[k] for k in cands if k[0] == ct_id and k[1] == c["id"]]
        if not ct_contribs: continue
        max_possible = sum(min(required.get((c["id"], k[2]), 0), cands[k]) for k in cands if k[0] == ct_id and k[1] == c["id"])
        cap = min(TARGET_CT_PERIODS, max_possible)
        if cap == 0: continue
        ct_periods = model.new_int_var(0, cap, "")
        model.add(ct_periods <= sum(ct_contribs))
        ct_reward_vars.append(ct_periods)

    # Objective: minimize splits, maximize CT coverage
    obj = sum(used.values())
    if ct_reward_vars:
        obj = obj - 100 * sum(ct_reward_vars)
    model.minimize(obj)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 60.0
    solver.parameters.num_search_workers = 8
    status = solver.solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None, f"Solver could not find any valid assignment (status={solver.status_name(status)})."

    allocs = []
    for k, var in x.items():
        v = int(solver.value(var))
        if v > 0:
            allocs.append({
                "teacher_id": k[0],
                "class_id": k[1],
                "subject": k[2],
                "periods_weekly": v,
            })
    return allocs, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    with open(args.inp) as f:
        data = json.load(f)

    required = build_required(data["subjects"], data["classes"])
    errors, warnings = validate(data, required)

    if errors:
        out = {"success": False, "errors": errors, "warnings": warnings, "allocations": []}
        Path(args.out).write_text(json.dumps(out, indent=2))
        print("Validation failed.")
        sys.exit(0)

    allocs, err = solve(data, required)
    if err:
        out = {"success": False, "errors": [err], "warnings": warnings, "allocations": []}
        Path(args.out).write_text(json.dumps(out, indent=2))
        print(err)
        sys.exit(0)

    by_t = defaultdict(int)
    for a in allocs:
        by_t[a["teacher_id"]] += a["periods_weekly"]

    teacher_by_id = {t["id"]: t for t in data["teachers"]}
    for tid, total in by_t.items():
        target = teacher_by_id.get(tid, {}).get("allotted_periods") or 0
        if total != target:
            warnings.append(f"{teacher_by_id[tid].get('name', tid)}: actual {total}, target {target}")

    out = {
        "success": True,
        "errors": [],
        "warnings": warnings,
        "allocations": allocs,
        "stats": {
            "teachers": len(data["teachers"]),
            "classes": len(data["classes"]),
            "allocations": len(allocs),
            "total_periods": sum(a["periods_weekly"] for a in allocs),
        },
    }
    Path(args.out).write_text(json.dumps(out, indent=2))
    print(f"Generated {len(allocs)} allocations")


if __name__ == "__main__":
    main()
