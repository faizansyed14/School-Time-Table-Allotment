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

    def _build_greedy_hint_map(self, x: dict) -> tuple[int, dict]:
        """Greedy placement map — used alone on Render when complete."""
        n_units = len(self.units)
        ppd = self.PERIODS_PER_DAY
        hint = {key: 0 for key in x}
        class_slot = {}
        teacher_slot = set()
        day_subj = defaultdict(int)
        placed = 0

        def slot_allowed(u_idx: int, d: int, p: int) -> bool:
            u = self.units[u_idx]
            tid, cid, sid = u["teacher_id"], u["class_id"], u["subject_id"]
            if p < self.min_period.get(tid, 1) - 1:
                return False
            if sid == "S12" and p != ppd - 1:
                return False
            if sid == "S10" and p == ppd - 1:
                return False
            if (cid, d, p) in class_slot:
                return False
            if (tid, d, p) in teacher_slot:
                return False
            if day_subj[(cid, sid, d)] >= 2:
                return False
            if self.rules.get("R2", {}).get("active") and class_level(self.classes, cid) <= 2:
                if sid != "S12" and p == ppd - 1:
                    return False
            return True

        order = list(range(n_units))
        order.sort(key=lambda u: (
            0 if self.units[u]["subject_id"] == "S12" else
            1 if self.units[u]["subject_id"] == "S10" else 2,
            self.units[u]["class_id"],
        ))

        for u_idx in order:
            u = self.units[u_idx]
            sid = u["subject_id"]
            tid = u["teacher_id"]
            min_p = self.min_period.get(tid, 1) - 1
            if sid == "S12":
                candidates = [(d, ppd - 1) for d in range(self.NUM_DAYS)]
            elif sid == "S10":
                candidates = [(d, p) for d in range(self.NUM_DAYS) for p in range(ppd - 1)]
            else:
                candidates = [(d, p) for d in range(self.NUM_DAYS) for p in range(min_p, ppd)]

            for d, p in candidates:
                if not slot_allowed(u_idx, d, p):
                    continue
                key = (u_idx, d, p)
                hint[key] = 1
                class_slot[(u["class_id"], d, p)] = u_idx
                teacher_slot.add((tid, d, p))
                day_subj[(u["class_id"], sid, d)] += 1
                placed += 1
                break

        return placed, hint

    def _apply_hints_to_model(self, model, x: dict, hint: dict) -> None:
        for key, var in x.items():
            if hint.get(key) == 1:
                model.add_hint(var, 1)

    def _improve_greedy_placement(self, hint: dict) -> int:
        """Second pass: place any unit still at 0 using full slot search."""
        ppd = self.PERIODS_PER_DAY
        class_slot = {}
        teacher_slot = set()
        day_subj = defaultdict(int)
        for (u_idx, d, p), v in hint.items():
            if v != 1:
                continue
            u = self.units[u_idx]
            class_slot[(u["class_id"], d, p)] = u_idx
            teacher_slot.add((u["teacher_id"], d, p))
            day_subj[(u["class_id"], u["subject_id"], d)] += 1

        placed = sum(1 for u in range(len(self.units)) if any(hint.get((u, d, p)) == 1
                     for d in range(self.NUM_DAYS) for p in range(ppd)))

        def slot_allowed(u_idx: int, d: int, p: int) -> bool:
            u = self.units[u_idx]
            tid, cid, sid = u["teacher_id"], u["class_id"], u["subject_id"]
            if p < self.min_period.get(tid, 1) - 1:
                return False
            if sid == "S12" and p != ppd - 1:
                return False
            if sid == "S10" and p == ppd - 1:
                return False
            if (cid, d, p) in class_slot:
                return False
            if (tid, d, p) in teacher_slot:
                return False
            if day_subj[(cid, sid, d)] >= 2:
                return False
            if self.rules.get("R2", {}).get("active") and class_level(self.classes, cid) <= 2:
                if sid != "S12" and p == ppd - 1:
                    return False
            return True

        for u_idx in range(len(self.units)):
            if any(hint.get((u_idx, d, p)) == 1 for d in range(self.NUM_DAYS) for p in range(ppd)):
                continue
            placed_u = False
            for d in range(self.NUM_DAYS):
                for p in range(ppd):
                    if not slot_allowed(u_idx, d, p):
                        continue
                    hint[(u_idx, d, p)] = 1
                    u = self.units[u_idx]
                    class_slot[(u["class_id"], d, p)] = u_idx
                    teacher_slot.add((u["teacher_id"], d, p))
                    day_subj[(u["class_id"], u["subject_id"], d)] += 1
                    placed += 1
                    placed_u = True
                    break
                if placed_u:
                    break
        return placed

    def _solution_from_hint(self, hint: dict, pf: dict) -> dict:
        """Build full result when greedy placed every unit (skip slow CP-SAT on Render)."""
        grid = {c: [[[] for _ in range(self.PERIODS_PER_DAY)] for _ in range(self.NUM_DAYS)]
                for c in self.classes}
        t_sum = defaultdict(lambda: {"allocated": 0, "subjects": defaultdict(int), "classes": set()})
        c_sum = {c: {"periods_filled": 0, "subjects": defaultdict(int)} for c in self.classes}

        for u_idx, u in enumerate(self.units):
            for d in range(self.NUM_DAYS):
                for p in range(self.PERIODS_PER_DAY):
                    if hint.get((u_idx, d, p)) != 1:
                        continue
                    c_id, t_id, s_id = u["class_id"], u["teacher_id"], u["subject_id"]
                    grid[c_id][d][p].append({"teacher_id": t_id, "subject_id": s_id})
                    t_sum[t_id]["allocated"] += 1
                    t_sum[t_id]["subjects"][s_id] += 1
                    t_sum[t_id]["classes"].add(c_id)
                    c_sum[c_id]["periods_filled"] += 1
                    c_sum[c_id]["subjects"][s_id] += 1

        filled = sum(1 for c in self.classes for d in range(self.NUM_DAYS)
                     for p in range(self.PERIODS_PER_DAY) if grid[c][d][p])
        total = len(self.classes) * self.NUM_DAYS * self.PERIODS_PER_DAY
        return {
            "success": True,
            "filled": filled,
            "total": total,
            "solver_status_name": "GREEDY",
            "message": "Feasible timetable built with fast greedy placement (Render-friendly).",
            "teacher_summary": {
                k: {"allocated": v["allocated"], "subjects": dict(v["subjects"]), "classes": sorted(v["classes"])}
                for k, v in t_sum.items()
            },
            "class_summary": {
                k: {"periods_filled": v["periods_filled"], "subjects": dict(v["subjects"])}
                for k, v in c_sum.items()
            },
            "grid": grid,
            "preflight_issues": pf,
        }

    def _configure_solver(self, solver: cp_model.CpSolver, time_limit_seconds: int, *, fast: bool = True) -> None:
        solver.parameters.max_time_in_seconds = float(time_limit_seconds)
        workers = max(1, int(os.environ.get("ALLOCATOR_WORKERS", "1")))
        solver.parameters.num_search_workers = workers
        mem_mb = os.environ.get("ALLOCATOR_MAX_MEMORY_MB")
        if mem_mb:
            solver.parameters.max_memory_in_mb = max(128, int(mem_mb))
        # fast=True: first feasible only. fast=False: minimize soft objective (per-class or polish).
        solver.parameters.stop_after_first_solution = fast
        solver.parameters.cp_model_probing_level = 1
        solver.parameters.linearization_level = 1
        solver.parameters.use_lns = True

    def _create_assignment_vars(self, model: cp_model.CpModel) -> dict:
        x = {}
        for u_idx in range(len(self.units)):
            for d in range(self.NUM_DAYS):
                for p in range(self.PERIODS_PER_DAY):
                    x[(u_idx, d, p)] = model.new_bool_var(f"x_{u_idx}_{d}_{p}")
        return x

    def _add_hard_constraints(self, model: cp_model.CpModel, x: dict) -> None:
        for u_idx in range(len(self.units)):
            lits = [x[(u_idx, d, p)] for d in range(self.NUM_DAYS) for p in range(self.PERIODS_PER_DAY)]
            model.add(sum(lits) == 1)

        for c in self.classes:
            for d in range(self.NUM_DAYS):
                for p in range(self.PERIODS_PER_DAY):
                    relevant = [u_idx for u_idx, u in enumerate(self.units) if u["class_id"] == c]
                    if relevant:
                        model.add(sum(x[(u_idx, d, p)] for u_idx in relevant) <= 1)

        for t in self.teachers:
            for d in range(self.NUM_DAYS):
                for p in range(self.PERIODS_PER_DAY):
                    relevant = [u_idx for u_idx, u in enumerate(self.units) if u["teacher_id"] == t]
                    if relevant:
                        model.add(sum(x[(u_idx, d, p)] for u_idx in relevant) <= 1)

        for tid, min_p in self.min_period.items():
            for p_idx in range(0, min_p - 1):
                for u_idx, u in enumerate(self.units):
                    if u["teacher_id"] == tid:
                        for d in range(self.NUM_DAYS):
                            model.add(x[(u_idx, d, p_idx)] == 0)

        for u_idx, u in enumerate(self.units):
            if u["subject_id"] == "S12":
                for d in range(self.NUM_DAYS):
                    for p in range(self.PERIODS_PER_DAY - 1):
                        model.add(x[(u_idx, d, p)] == 0)

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

        if self.rules.get("R6", {}).get("active", False):
            for u_idx, u in enumerate(self.units):
                if u["subject_id"] == "S10":
                    for d in range(self.NUM_DAYS):
                        model.add(x[(u_idx, d, self.PERIODS_PER_DAY - 1)] == 0)

    def _add_soft_objective(self, model: cp_model.CpModel, x: dict) -> None:
        """Original monolithic quality: subject times + spread teachers across days."""
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

    def _polish_schedule(self, hint_map: dict, time_limit_seconds: int, pf: dict) -> dict | None:
        """Phase 2: full optimizer with same soft goals as before (seeded from queue result)."""
        model = cp_model.CpModel()
        x = self._create_assignment_vars(model)
        self._add_hard_constraints(model, x)
        self._add_soft_objective(model, x)
        for key, var in x.items():
            model.add_hint(var, int(hint_map.get(key, 0)))

        solver = cp_model.CpSolver()
        self._configure_solver(solver, time_limit_seconds, fast=False)
        status = solver.solve(model)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None

        sol = self.extract_solution(solver, x)
        sol["solver_status"] = int(status)
        sol["solver_status_name"] = solver.status_name(status)
        sol["preflight_issues"] = pf
        sol["phases"] = ["queue_by_class", "full_polish"]
        return sol

    def _solve_one_class(
        self, c_id: str, unit_indices: list[int], teacher_busy: set, time_limit: float
    ) -> tuple[bool, list[tuple[int, int, int]]]:
        """CP-SAT for a single class (~48 units) — fast on Render free tier."""
        model = cp_model.CpModel()
        x = {}
        n = len(unit_indices)
        for li in range(n):
            for d in range(self.NUM_DAYS):
                for p in range(self.PERIODS_PER_DAY):
                    x[(li, d, p)] = model.new_bool_var(f"x_{c_id}_{li}_{d}_{p}")

        for li in range(n):
            model.add(sum(x[(li, d, p)] for d in range(self.NUM_DAYS) for p in range(self.PERIODS_PER_DAY)) == 1)

        for d in range(self.NUM_DAYS):
            for p in range(self.PERIODS_PER_DAY):
                model.add(sum(x[(li, d, p)] for li in range(n)) <= 1)

        for li in range(n):
            tid = self.units[unit_indices[li]]["teacher_id"]
            for d in range(self.NUM_DAYS):
                for p in range(self.PERIODS_PER_DAY):
                    if (tid, d, p) in teacher_busy:
                        model.add(x[(li, d, p)] == 0)

        for li in range(n):
            u = self.units[unit_indices[li]]
            tid, sid = u["teacher_id"], u["subject_id"]
            min_p = self.min_period.get(tid, 1) - 1
            for p_idx in range(min_p):
                for d in range(self.NUM_DAYS):
                    model.add(x[(li, d, p_idx)] == 0)
            if sid == "S12":
                for d in range(self.NUM_DAYS):
                    for p in range(self.PERIODS_PER_DAY - 1):
                        model.add(x[(li, d, p)] == 0)
            if sid == "S10":
                for d in range(self.NUM_DAYS):
                    model.add(x[(li, d, self.PERIODS_PER_DAY - 1)] == 0)

        if self.rules.get("R5", {}).get("active", True):
            for s in self.subjects:
                for d in range(self.NUM_DAYS):
                    rel = [li for li in range(n) if self.units[unit_indices[li]]["subject_id"] == s]
                    if len(rel) > 2:
                        model.add(sum(x[(li, d, p)] for li in rel for p in range(self.PERIODS_PER_DAY)) <= 2)

        c_info = self.classes[c_id]
        ct_id = c_info.get("class_teacher_id")
        if self.rules.get("R1", {}).get("active", False) and ct_id and self.min_period.get(ct_id, 1) <= 1:
            ct_li = [li for li in range(n) if self.units[unit_indices[li]]["teacher_id"] == ct_id]
            non_ct = [li for li in range(n) if self.units[unit_indices[li]]["teacher_id"] != ct_id]
            if ct_li and non_ct:
                n_enforce = min(len(ct_li), self.NUM_DAYS)
                ct_p1 = []
                for d in range(self.NUM_DAYS):
                    v = model.new_bool_var(f"ct_p1_{c_id}_{d}")
                    ct_p1.append(v)
                    model.add(sum(x[(li, d, 0)] for li in ct_li) >= v)
                    model.add(sum(x[(li, d, 0)] for li in ct_li) <= len(ct_li) * v)
                    for li in non_ct:
                        model.add(x[(li, d, 0)] + v <= 1)
                model.add(sum(ct_p1) >= n_enforce)

        if self.rules.get("R2", {}).get("active", False) and class_level(self.classes, c_id) <= 2:
            diary_li = [li for li in range(n) if self.units[unit_indices[li]]["subject_id"] == "S12"]
            non_diary = [li for li in range(n) if self.units[unit_indices[li]]["subject_id"] != "S12"]
            if diary_li and non_diary:
                for d in range(self.NUM_DAYS):
                    model.add(sum(x[(li, d, self.PERIODS_PER_DAY - 1)] for li in diary_li) >= 1)
                    for li in non_diary:
                        model.add(x[(li, d, self.PERIODS_PER_DAY - 1)] == 0)

        # Same soft goals as monolithic (per class + global teacher-day tracking)
        obj_terms = []
        teachers_in_class = {self.units[unit_indices[li]]["teacher_id"] for li in range(n)}
        for li in range(n):
            u = self.units[unit_indices[li]]
            sid = u["subject_id"]
            if sid in ("S01", "S02", "S03", "S05"):
                for d in range(self.NUM_DAYS):
                    for p in range(5, self.PERIODS_PER_DAY):
                        obj_terms.append(5 * x[(li, d, p)])
            if sid == "S10":
                for d in range(self.NUM_DAYS):
                    for p in range(3):
                        obj_terms.append(10 * x[(li, d, p)])
        teacher_days_used = getattr(self, "_teacher_days_used", set())
        for tid in teachers_in_class:
            for d in range(self.NUM_DAYS):
                rel_li = [li for li in range(n) if self.units[unit_indices[li]]["teacher_id"] == tid]
                if not rel_li:
                    continue
                t_day = model.new_bool_var(f"td_{c_id}_{tid}_{d}")
                day_lits = [x[(li, d, p)] for li in rel_li for p in range(self.PERIODS_PER_DAY)]
                model.add_max_equality(t_day, day_lits)
                if (tid, d) not in teacher_days_used:
                    obj_terms.append(2 * t_day)
        has_soft = bool(obj_terms)
        if has_soft:
            model.minimize(sum(obj_terms))

        solver = cp_model.CpSolver()
        # Small per-class model: optimize soft goals (fast=True only stops at first feasible).
        self._configure_solver(solver, time_limit, fast=not has_soft)
        status = solver.solve(model)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return False, []

        placements = []
        for li in range(n):
            found = False
            for d in range(self.NUM_DAYS):
                for p in range(self.PERIODS_PER_DAY):
                    if solver.value(x[(li, d, p)]) == 1:
                        placements.append((unit_indices[li], d, p))
                        found = True
                        break
                if found:
                    break
        return len(placements) == n, placements

    def _solve_by_class(self, time_limit_seconds: int, pf: dict) -> dict:
        """Queue one class at a time (low RAM) with same soft goals as the old full solver."""
        teacher_busy: set[tuple[str, int, int]] = set()
        self._teacher_days_used: set[tuple[str, int]] = set()
        placements: list[tuple[int, int, int]] = []
        n_classes = max(1, len(self.classes))
        per_class_time = max(20.0, float(time_limit_seconds) / n_classes)

        for c_id in sorted(self.classes.keys()):
            unit_indices = [i for i, u in enumerate(self.units) if u["class_id"] == c_id]
            if not unit_indices:
                continue
            ok, class_placements = self._solve_one_class(c_id, unit_indices, teacher_busy, per_class_time)
            if not ok:
                cname = self.classes[c_id].get("name", c_id)
                return {
                    "success": False,
                    "solver_status_name": "INFEASIBLE",
                    "message": (
                        f"Could not schedule class {cname} with current allocations and rules. "
                        "Check Allocations / Teachers, or temporarily disable R1 on Allotment."
                    ),
                    "preflight_issues": pf,
                    "units_to_place": len(self.units),
                    "classes": len(self.classes),
                    "slots_per_class": self.TOTAL_SLOTS,
                }
            for u_idx, d, p in class_placements:
                placements.append((u_idx, d, p))
                teacher_busy.add((self.units[u_idx]["teacher_id"], d, p))
                self._teacher_days_used.add((self.units[u_idx]["teacher_id"], d))

        hint = {(u_idx, d, p): 0 for u_idx in range(len(self.units))
                for d in range(self.NUM_DAYS) for p in range(self.PERIODS_PER_DAY)}
        for u_idx, d, p in placements:
            hint[(u_idx, d, p)] = 1
        self._phase1_hint = hint
        sol = self._solution_from_hint(hint, pf)
        sol["solver_status_name"] = "FEASIBLE"
        sol["solver_status"] = int(cp_model.FEASIBLE)
        sol["phases"] = ["queue_by_class_optimized"]
        sol["message"] = (
            "Timetable built class-by-class with the same soft rules as before "
            "(core subjects earlier, games placement, teacher day spread)."
        )
        return sol

    def _solve_monolithic(self, time_limit_seconds: int, pf: dict) -> dict:
        greedy_placed = 0
        model = cp_model.CpModel()
        x = self._create_assignment_vars(model)
        self._add_hard_constraints(model, x)
        self._add_soft_objective(model, x)

        greedy_placed, hint_map = self._build_greedy_hint_map(x)
        greedy_placed = self._improve_greedy_placement(hint_map)
        if greedy_placed == len(self.units):
            sol = self._solution_from_hint(hint_map, pf)
            sol["solver_status"] = int(cp_model.FEASIBLE)
            return sol

        self._apply_hints_to_model(model, x, hint_map)

        solver = cp_model.CpSolver()
        self._configure_solver(solver, time_limit_seconds, fast=False)

        status = solver.solve(model)
        status_name = solver.status_name(status)

        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            sol = self.extract_solution(solver, x)
            sol["solver_status"] = int(status)
            sol["solver_status_name"] = status_name
            sol["preflight_issues"] = pf
            sol["phases"] = ["monolithic"]
            return sol

        # Infeasibility — produce actionable advice
        msg = ("INFEASIBLE — The solver could not find any timetable that satisfies "
               "all rules and allocations together. Try:\n"
               "  1. Reduce schedule restrictions on the most-loaded teachers (Teachers page → reduce 'Cannot teach before period')\n"
               "  2. Disable R1 (class teacher at P1) on Allotment page to confirm if R1 is the cause\n"
               "  3. Check that no teacher has been over-restricted (e.g., starts at P5 but has 30+ periods)")
        if status == cp_model.UNKNOWN:
            msg = (
                f"Solver timed out after {time_limit_seconds}s "
                f"(greedy hint placed {greedy_placed}/{len(self.units)} units). "
                "On Render free tier use 180–300s, or run allotment locally once."
            )

        return {
            "success": False,
            "status": int(status),
            "solver_status_name": status_name,
            "message": msg,
            "greedy_hint_placed": greedy_placed,
            "units_to_place": len(self.units),
            "classes": len(self.classes),
            "slots_per_class": self.TOTAL_SLOTS,
            "preflight_issues": pf,
        }

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

        if os.environ.get("ALLOCATOR_MONOLITHIC") == "1":
            return self._solve_monolithic(time_limit_seconds, pf)

        result = self._solve_by_class(time_limit_seconds, pf)
        if not result.get("success"):
            return result
        if result.get("solver_status_name") == "INFEASIBLE":
            return result

        # Optional phase 2 on powerful machines only (slow on Render free tier)
        hint_map = getattr(self, "_phase1_hint", None)
        if hint_map and os.environ.get("ALLOCATOR_FULL_POLISH") == "1":
            polish_sec = int(os.environ.get("ALLOCATOR_POLISH_SEC", "120"))
            polished = self._polish_schedule(hint_map, polish_sec, pf)
            if polished:
                return polished
        return result

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
