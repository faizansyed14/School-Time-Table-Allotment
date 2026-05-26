#!/usr/bin/env python3
"""
CP-SAT timetable allocator v8 — dynamic, diagnostic, action-driven.

Improvements over previous version:
- Pre-flight returns ACTIONABLE recommendations: what to add/remove/change and WHERE.
- forbidden_periods now driven by teacher.min_period_start (1..8): teacher cannot
  be placed in periods earlier than min_period_start.
- Detailed feasibility analysis when INFEASIBLE (teacher load vs capacity).
- Same JSON output schema so frontend remains compatible.
"""
from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict
from pathlib import Path

from ortools.sat.python import cp_model


def load_seed(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def class_level(classes: dict, c_id: str) -> int:
    c = classes[c_id]
    return int(c.get("level", c.get("class_level", 10)))


def teacher_min_period(t: dict) -> int:
    """Return the earliest period this teacher can teach (1..8)."""
    # 1) explicit min_period_start on teacher
    if t.get("min_period_start") is not None:
        try:
            v = int(t["min_period_start"])
            return max(1, min(8, v))
        except (ValueError, TypeError):
            pass
    # 2) derived from forbidden_periods list (legacy support)
    fp = t.get("forbidden_periods") or []
    if fp:
        try:
            return max(int(p) for p in fp) + 1
        except (ValueError, TypeError):
            pass
    return 1


def preflight(seed: dict) -> dict:
    """Detailed validation with actionable fix suggestions."""
    fatal, warn = [], []
    teachers = {t["id"]: t for t in seed["teachers"]}
    classes = {c["id"]: c for c in seed["classes"]}
    allocations = seed["allocations"]
    PERIODS_PER_CLASS = 48
    NUM_DAYS, PERIODS_PER_DAY = 6, 8

    # Build name lookups
    t_name = {tid: t.get("name", tid) for tid, t in teachers.items()}
    c_name = {cid: classes[cid].get("name", cid) for cid in classes}

    # 1. References
    for a in allocations:
        if a["teacher_id"] not in teachers:
            fatal.append({
                "type": "unknown_teacher",
                "teacher_id": a["teacher_id"],
                "class_id": a["class_id"],
                "subject_id": a["subject_id"],
                "where": "Allocations page",
                "reason": (f"An allocation references teacher ID {a['teacher_id']} "
                           f"which doesn't exist. The teacher may have been deleted. "
                           f"Fix: remove this allocation row OR re-create that teacher in Teachers page."),
                "actions": [
                    {"page": "Allocations", "action": "Delete this allocation row"},
                    {"page": "Teachers", "action": f"Re-create teacher {a['teacher_id']}"},
                ],
            })
        if a["class_id"] not in classes:
            fatal.append({
                "type": "unknown_class",
                "class_id": a["class_id"],
                "where": "Allocations page",
                "reason": f"Allocation references class {a['class_id']} not in classes list.",
                "actions": [
                    {"page": "Allocations", "action": "Delete this allocation row"},
                    {"page": "Curriculum", "action": f"Re-create class {a['class_id']}"},
                ],
            })

    # 2. Per-class totals
    per_class = defaultdict(int)
    per_class_subject = defaultdict(int)
    for a in allocations:
        per_class[a["class_id"]] += int(a["periods"])
        per_class_subject[(a["class_id"], a["subject_id"])] += int(a["periods"])

    for c_id in classes:
        total = per_class.get(c_id, 0)
        cn = c_name[c_id]
        if total < PERIODS_PER_CLASS:
            short = PERIODS_PER_CLASS - total
            fatal.append({
                "type": "class_short",
                "class_id": c_id,
                "class_name": cn,
                "current": total,
                "required": PERIODS_PER_CLASS,
                "missing": short,
                "where": "Allocations page",
                "reason": (f"Class {cn} has only {total}/48 periods allocated. "
                           f"You need {short} more period(s)."),
                "actions": [
                    {"page": "Allocations", "action": f"Add {short} more period(s) to Class {cn} — open the class card and click +"},
                    {"page": "Curriculum", "action": f"Or reduce a subject's required periods for Class {cn}"},
                ],
            })
        elif total > PERIODS_PER_CLASS:
            excess = total - PERIODS_PER_CLASS
            fatal.append({
                "type": "class_excess",
                "class_id": c_id,
                "class_name": cn,
                "current": total,
                "required": PERIODS_PER_CLASS,
                "excess": excess,
                "where": "Allocations page",
                "reason": (f"Class {cn} has {total} periods allocated, exceeds 48 by {excess}. "
                           f"A class can fit at most 48 periods per week (6 days × 8 periods)."),
                "actions": [
                    {"page": "Allocations", "action": f"Remove or reduce {excess} period(s) from Class {cn}"},
                ],
            })

    # 3. Per-teacher capacity vs allocation
    per_teacher = defaultdict(int)
    for a in allocations:
        per_teacher[a["teacher_id"]] += int(a["periods"])

    for tid, total in per_teacher.items():
        if tid not in teachers:
            continue
        t = teachers[tid]
        name = t.get("name", tid)
        # Capacity = 48 - forbidden slots (min_period_start - 1) * 6 days
        min_p = teacher_min_period(t)
        capacity = (PERIODS_PER_DAY - (min_p - 1)) * NUM_DAYS
        # Declared workload target
        declared = t.get("total_periods") or t.get("allotted_periods")

        if total > capacity:
            fatal.append({
                "type": "teacher_capacity_exceeded",
                "teacher_id": tid,
                "teacher_name": name,
                "allocated": total,
                "capacity": capacity,
                "min_period": min_p,
                "where": "Teachers page",
                "reason": (f"{name} has {total} periods allocated but can only fit {capacity} "
                           f"(periods {min_p}–8 × 6 days). "
                           f"Reduce schedule restriction OR reduce allocation."),
                "actions": [
                    {"page": "Teachers", "action": f"Reduce {name}'s 'Cannot teach before period' (currently {min_p}) so capacity grows"},
                    {"page": "Allocations", "action": f"Reduce {name}'s allocations by at least {total - capacity} period(s)"},
                ],
            })
        elif total > 48:
            fatal.append({
                "type": "teacher_overload",
                "teacher_id": tid,
                "teacher_name": name,
                "allocated": total,
                "where": "Teachers / Allocations page",
                "reason": (f"{name} has {total} periods allocated, exceeds 48 = 6 days × 8 periods. "
                           f"A teacher cannot exceed the school day."),
                "actions": [
                    {"page": "Allocations", "action": f"Reduce {name}'s allocations by {total - 48} period(s)"},
                ],
            })

        if declared and declared != total:
            warn.append({
                "type": "teacher_workload_mismatch",
                "teacher_id": tid,
                "teacher_name": name,
                "declared": declared,
                "allocated": total,
                "where": "Teachers / Allocations page",
                "reason": (f"{name} workload target is {declared} but actual allocations sum to {total}. "
                           f"Update target on Teachers page or adjust allocations to match."),
                "actions": [
                    {"page": "Teachers", "action": f"Edit {name} → set workload to {total}"},
                    {"page": "Allocations", "action": f"Adjust {name}'s allocations to total {declared}"},
                ],
            })

    # 4. Diary (S12) at P8 — one teacher cannot cover two classes on the same period/day
    diary_by_teacher = defaultdict(lambda: {"total": 0, "classes": set()})
    for a in allocations:
        if a["subject_id"] != "S12":
            continue
        tid = a["teacher_id"]
        n = int(a["periods"])
        diary_by_teacher[tid]["total"] += n
        diary_by_teacher[tid]["classes"].add(a["class_id"])

    for tid, info in diary_by_teacher.items():
        if tid not in teachers:
            continue
        name = t_name[tid]
        class_list = sorted(info["classes"], key=lambda cid: c_name.get(cid, cid))
        class_labels = ", ".join(c_name.get(cid, cid) for cid in class_list)
        if info["total"] > NUM_DAYS:
            fatal.append({
                "type": "diary_teacher_overload",
                "teacher_id": tid,
                "teacher_name": name,
                "diary_periods": info["total"],
                "max_days": NUM_DAYS,
                "where": "Allocations page",
                "reason": (f"{name} is assigned {info['total']} Diary periods but can only teach "
                           f"{NUM_DAYS} (one P8 slot per day). Diary must be period 8."),
                "actions": [
                    {"page": "Allocations", "action": f"Move some Diary periods away from {name} (Classes: {class_labels})"},
                    {"page": "Teachers", "action": f"Or assign Diary in each class to a different teacher"},
                ],
            })
        elif len(info["classes"]) > 1:
            fatal.append({
                "type": "diary_teacher_multi_class",
                "teacher_id": tid,
                "teacher_name": name,
                "classes": class_labels,
                "where": "Allocations page",
                "reason": (f"{name} teaches Diary in multiple classes ({class_labels}). "
                           f"At period 8 they cannot be in two classes on the same day. "
                           f"Each class needs its own Diary teacher (e.g. Class 2B → class teacher Sujata)."),
                "actions": [
                    {"page": "Allocations", "action": f"Reassign Diary in all but one class away from {name}"},
                    {"page": "Curriculum", "action": "Match seeds: 2A Diary → Neha, 2B Diary → Sujata"},
                ],
            })

    # 5. Subjects without teachers (class has Sxx but nobody teaches it)
    teacher_subjects = defaultdict(set)
    for a in allocations:
        teacher_subjects[(a["class_id"], a["subject_id"])].add(a["teacher_id"])

    # 6. Class teacher coverage
    ct_periods_in_class = defaultdict(int)
    for a in allocations:
        c_id = a["class_id"]
        c = classes.get(c_id)
        if c and c.get("class_teacher_id") == a["teacher_id"]:
            ct_periods_in_class[c_id] += int(a["periods"])

    for c_id, c in classes.items():
        if not c.get("class_teacher_id"):
            warn.append({
                "type": "no_class_teacher",
                "class_id": c_id,
                "class_name": c_name[c_id],
                "where": "Curriculum / Classes",
                "reason": f"Class {c_name[c_id]} has no class teacher assigned. R1 (CT at P1) will be skipped for this class.",
                "actions": [
                    {"page": "Curriculum", "action": f"Set a class teacher for Class {c_name[c_id]}"},
                ],
            })
            continue
        ct_id = c["class_teacher_id"]
        ct_name = teachers.get(ct_id, {}).get("name", "Class teacher")
        n = ct_periods_in_class.get(c_id, 0)
        if 0 < n < NUM_DAYS:
            warn.append({
                "type": "ct_periods_low",
                "class_id": c_id,
                "class_name": c_name[c_id],
                "where": "Allocations page",
                "reason": (f"Class {c_name[c_id]} class teacher {ct_name} has only {n} period(s) in this class "
                           f"(needs ≥{NUM_DAYS} for R1 on every weekday). "
                           f"Sat P1 may be assigned to another teacher."),
                "actions": [
                    {"page": "Allocations", "action": f"Add at least {NUM_DAYS - n} more period(s) for {ct_name} in Class {c_name[c_id]}"},
                    {"page": "Teachers", "action": f"Or change Class {c_name[c_id]} class teacher"},
                ],
            })

    return {"fatal": fatal, "warn": warn}


class TimetableCPSolver:
    def __init__(self, seed_data: dict):
        self.data = seed_data
        self.teachers = {t["id"]: t for t in seed_data["teachers"]}
        self.classes = {c["id"]: c for c in seed_data["classes"]}
        self.subjects = {s["id"]: s for s in seed_data["subjects"]}
        self.rules = {r["id"]: r for r in seed_data.get("rules", [])}
        self.NUM_DAYS = 6
        self.PERIODS_PER_DAY = 8
        self.TOTAL_SLOTS = self.NUM_DAYS * self.PERIODS_PER_DAY

        # min_period_start per teacher (1-indexed)
        self.min_period = {}
        for tid, t in self.teachers.items():
            self.min_period[tid] = teacher_min_period(t)

        # Expand allocations to unit demands
        self.units = []
        for a in seed_data["allocations"]:
            for _ in range(int(a["periods"])):
                self.units.append({
                    "teacher_id": a["teacher_id"],
                    "class_id": a["class_id"],
                    "subject_id": a["subject_id"],
                })

    def _diary_class_ids(self):
        return [c_id for c_id in self.classes if class_level(self.classes, c_id) <= 2]

    def solve(self, time_limit_seconds: int = 90) -> dict:
        pf = preflight(self.data)
        if pf["fatal"]:
            top = pf["fatal"][0]
            hint = top.get("reason", "")
            if top.get("type", "").startswith("diary_"):
                hint = (hint + " Run database/patches/03_fix_diary_2b.sql in Supabase if Class 2B "
                        "Diary was wrongly assigned to Neha.")
            return {
                "success": False,
                "solver_status_name": "PRE_FLIGHT_FAILED",
                "message": "Cannot run solver: data has fatal issues. Fix the items below first. " + hint,
                "preflight_issues": pf,
                "units_to_place": len(self.units),
                "classes": len(self.classes),
                "slots_per_class": self.TOTAL_SLOTS,
            }

        model = cp_model.CpModel()
        x = {}
        for u_idx in range(len(self.units)):
            for d in range(self.NUM_DAYS):
                for p in range(self.PERIODS_PER_DAY):
                    x[(u_idx, d, p)] = model.new_bool_var(f"x_{u_idx}_{d}_{p}")

        # Each unit placed exactly once
        for u_idx in range(len(self.units)):
            lits = [x[(u_idx, d, p)] for d in range(self.NUM_DAYS) for p in range(self.PERIODS_PER_DAY)]
            model.add(sum(lits) == 1)

        # At most one demand per class slot
        for c in self.classes:
            for d in range(self.NUM_DAYS):
                for p in range(self.PERIODS_PER_DAY):
                    relevant = [u_idx for u_idx, u in enumerate(self.units) if u["class_id"] == c]
                    if relevant:
                        model.add(sum(x[(u_idx, d, p)] for u_idx in relevant) <= 1)

        # Teacher uniqueness
        for t in self.teachers:
            for d in range(self.NUM_DAYS):
                for p in range(self.PERIODS_PER_DAY):
                    relevant = [u_idx for u_idx, u in enumerate(self.units) if u["teacher_id"] == t]
                    if relevant:
                        model.add(sum(x[(u_idx, d, p)] for u_idx in relevant) <= 1)

        # min_period_start: teacher cannot be placed in periods earlier than their start period
        for tid, min_p in self.min_period.items():
            forbidden_zero_indexed = list(range(0, min_p - 1))  # periods 1..(min_p-1) forbidden
            for p_idx in forbidden_zero_indexed:
                for u_idx, u in enumerate(self.units):
                    if u["teacher_id"] == tid:
                        for d in range(self.NUM_DAYS):
                            model.add(x[(u_idx, d, p_idx)] == 0)

        # Diary always in last period
        for u_idx, u in enumerate(self.units):
            if u["subject_id"] == "S12":
                for d in range(self.NUM_DAYS):
                    for p in range(self.PERIODS_PER_DAY - 1):
                        model.add(x[(u_idx, d, p)] == 0)

        # R5: max 2 same-subject per day
        if self.rules.get("R5", {}).get("active", True):
            for c in self.classes:
                for s in self.subjects:
                    for d in range(self.NUM_DAYS):
                        relevant = [
                            u_idx for u_idx, u in enumerate(self.units)
                            if u["class_id"] == c and u["subject_id"] == s
                        ]
                        if len(relevant) > 2:
                            model.add(
                                sum(x[(u_idx, d, p)] for u_idx in relevant for p in range(self.PERIODS_PER_DAY)) <= 2
                            )

        # R1: P1 = class teacher (best-effort)
        if self.rules.get("R1", {}).get("active", False):
            for c_id, c_info in self.classes.items():
                ct_id = c_info.get("class_teacher_id")
                if not ct_id:
                    continue
                all_rel = [u_idx for u_idx, u in enumerate(self.units) if u["class_id"] == c_id]
                ct_units = [u_idx for u_idx in all_rel if self.units[u_idx]["teacher_id"] == ct_id]
                non_ct = [u_idx for u_idx in all_rel if self.units[u_idx]["teacher_id"] != ct_id]
                if not ct_units or not non_ct:
                    continue
                # If CT cannot teach P1 (min_period > 1), skip R1 for this CT
                if self.min_period.get(ct_id, 1) > 1:
                    continue
                n_enforce = min(len(ct_units), self.NUM_DAYS)
                ct_p1 = []
                for d in range(self.NUM_DAYS):
                    v = model.new_bool_var(f"ct_p1_{c_id}_{d}")
                    ct_p1.append(v)
                    ct_sum_p1 = sum(x[(u_idx, d, 0)] for u_idx in ct_units)
                    model.add(ct_sum_p1 >= v)
                    model.add(ct_sum_p1 <= len(ct_units) * v)
                    for u_idx in non_ct:
                        model.add(x[(u_idx, d, 0)] + v <= 1)
                model.add(sum(ct_p1) >= n_enforce)

        # R2: P8 = Diary for classes ≤ level 2
        if self.rules.get("R2", {}).get("active", False):
            for c_id in self._diary_class_ids():
                all_rel = [u_idx for u_idx, u in enumerate(self.units) if u["class_id"] == c_id]
                diary = [u_idx for u_idx in all_rel if self.units[u_idx]["subject_id"] == "S12"]
                non_diary = [u_idx for u_idx in all_rel if self.units[u_idx]["subject_id"] != "S12"]
                if diary and non_diary:
                    for d in range(self.NUM_DAYS):
                        model.add(sum(x[(u_idx, d, self.PERIODS_PER_DAY - 1)] for u_idx in diary) >= 1)
                        for u_idx in non_diary:
                            model.add(x[(u_idx, d, self.PERIODS_PER_DAY - 1)] == 0)

        # R6: Games not in last period
        if self.rules.get("R6", {}).get("active", False):
            for u_idx, u in enumerate(self.units):
                if u["subject_id"] == "S10":
                    for d in range(self.NUM_DAYS):
                        model.add(x[(u_idx, d, self.PERIODS_PER_DAY - 1)] == 0)

        # Soft objective
        obj_terms = []
        for u_idx, u in enumerate(self.units):
            if u["subject_id"] in ("S01", "S02", "S03", "S05"):
                for d in range(self.NUM_DAYS):
                    for p in range(5, self.PERIODS_PER_DAY):
                        obj_terms.append(5 * x[(u_idx, d, p)])
            if u["subject_id"] == "S10":
                for d in range(self.NUM_DAYS):
                    for p in range(3):
                        obj_terms.append(10 * x[(u_idx, d, p)])
        for t in self.teachers:
            for d in range(self.NUM_DAYS):
                t_day = model.new_bool_var(f"t_{t}_d_{d}")
                relevant = [u_idx for u_idx, u in enumerate(self.units) if u["teacher_id"] == t]
                if relevant:
                    day_lits = [x[(u_idx, d, p)] for u_idx in relevant for p in range(self.PERIODS_PER_DAY)]
                    model.add_max_equality(t_day, day_lits)
                    obj_terms.append(2 * t_day)
        if obj_terms:
            model.minimize(sum(obj_terms))

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = float(time_limit_seconds)
        # Render free tier = 512MB RAM; 8 workers often OOM-kills the whole service.
        workers = max(1, int(os.environ.get("ALLOCATOR_WORKERS", "1")))
        solver.parameters.num_search_workers = workers
        mem_mb = os.environ.get("ALLOCATOR_MAX_MEMORY_MB")
        if mem_mb:
            solver.parameters.max_memory_in_mb = max(128, int(mem_mb))

        status = solver.solve(model)
        status_name = solver.status_name(status)

        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            sol = self.extract_solution(solver, x)
            sol["solver_status"] = int(status)
            sol["solver_status_name"] = status_name
            sol["preflight_issues"] = pf
            return sol

        # Infeasibility — produce actionable advice
        msg = ("INFEASIBLE — The solver could not find any timetable that satisfies "
               "all rules and allocations together. Try:\n"
               "  1. Reduce schedule restrictions on the most-loaded teachers (Teachers page → reduce 'Cannot teach before period')\n"
               "  2. Disable R1 (class teacher at P1) on Allotment page to confirm if R1 is the cause\n"
               "  3. Check that no teacher has been over-restricted (e.g., starts at P5 but has 30+ periods)")
        if status == cp_model.UNKNOWN:
            msg = "Solver timed out. Try increasing time-limit or reducing constraints."

        return {
            "success": False,
            "status": int(status),
            "solver_status_name": status_name,
            "message": msg,
            "units_to_place": len(self.units),
            "classes": len(self.classes),
            "slots_per_class": self.TOTAL_SLOTS,
            "preflight_issues": pf,
        }

    def extract_solution(self, solver, x):
        grid = {c: [[[] for _ in range(self.PERIODS_PER_DAY)] for _ in range(self.NUM_DAYS)]
                for c in self.classes}
        t_sum = defaultdict(lambda: {"allocated": 0, "subjects": defaultdict(int), "classes": set()})
        c_sum = {c: {"periods_filled": 0, "subjects": defaultdict(int)} for c in self.classes}

        for u_idx, u in enumerate(self.units):
            for d in range(self.NUM_DAYS):
                for p in range(self.PERIODS_PER_DAY):
                    if solver.value(x[(u_idx, d, p)]) == 1:
                        c_id, t_id, s_id = u["class_id"], u["teacher_id"], u["subject_id"]
                        grid[c_id][d][p].append({"teacher_id": t_id, "subject_id": s_id})
                        t_sum[t_id]["allocated"] += 1
                        t_sum[t_id]["subjects"][s_id] += 1
                        t_sum[t_id]["classes"].add(c_id)
                        c_sum[c_id]["periods_filled"] += 1
                        c_sum[c_id]["subjects"][s_id] += 1

        filled = sum(1 for c in self.classes for d in range(self.NUM_DAYS) for p in range(self.PERIODS_PER_DAY) if grid[c][d][p])
        total = len(self.classes) * self.NUM_DAYS * self.PERIODS_PER_DAY

        return {
            "success": True,
            "filled": filled,
            "total": total,
            "teacher_summary": {
                k: {"allocated": v["allocated"], "subjects": dict(v["subjects"]), "classes": sorted(v["classes"])}
                for k, v in t_sum.items()
            },
            "class_summary": {
                k: {"periods_filled": v["periods_filled"], "subjects": dict(v["subjects"])}
                for k, v in c_sum.items()
            },
            "grid": grid,
        }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--time-limit", type=int, default=90)
    args = ap.parse_args()
    data = load_seed(args.input)
    solver = TimetableCPSolver(data)
    result = solver.solve(time_limit_seconds=args.time_limit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print("Wrote", args.output, "success=" + str(result.get("success")))


if __name__ == "__main__":
    main()
