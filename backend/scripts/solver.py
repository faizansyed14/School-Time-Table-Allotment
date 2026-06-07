#!/usr/bin/env python3
"""
Production school-timetable solver — TWO phases, both via CP-SAT (deterministic, complete).

Reads JSON on stdin:
  { "teachers":[{name,subjects[],min_class_level,max_class_level,min_period_start,
                 fixed_target(optional int)}],
    "classes":[{name,class_level,class_teacher}],
    "curriculum":{subject:{class:periods}} }

Writes JSON on stdout:
  { "ok":bool, "phase":"allocate|schedule", "allocations":[...], "targets":{...},
    "grid":{class:[[{teacher,subject}|null]*8]*6}, "filled":int, "message":str,
    "errors":[...] }

Phase A (mode allocate|full): decide targets + allocation rows.
Phase B (mode schedule|full): place periods into grid from saved allocations (schedule skips A).
"""
import sys, json
from ortools.sat.python import cp_model

NUM_DAYS, PPD = 6, 8
MAX_TARGET = 44
TARGET_CT = 6
SEED = 42

def cap_for(mp, fixed=None):
    if fixed is not None: return fixed
    return min(MAX_TARGET, (PPD - (mp - 1)) * NUM_DAYS)

def validate_saved_allocations(allocations, required, eligible, teachers, classes):
    errors = []
    actual = {}
    for a in allocations:
        c, s, t = a["class"], a["subject"], a["teacher"]
        p = int(a["periods"])
        if p <= 0:
            continue
        if c not in classes:
            errors.append(f"Unknown class {c}.")
            continue
        if t not in teachers:
            errors.append(f"Unknown teacher {t}.")
            continue
        if t not in eligible(c, s):
            errors.append(f"{t} cannot teach {s} to class {c} (level {classes[c]['class_level']}).")
        actual[(c, s)] = actual.get((c, s), 0) + p
    for (c, s), need in required.items():
        got = actual.get((c, s), 0)
        if got != need:
            errors.append(f"Class {c} {s}: allocated {got}, curriculum requires {need}.")
    by_class = {}
    for (c, _s), p in actual.items():
        by_class[c] = by_class.get(c, 0) + p
    for c in classes:
        total = by_class.get(c, 0)
        if total != PPD * NUM_DAYS:
            errors.append(f"Class {c} allocations sum to {total} (must be {PPD * NUM_DAYS}).")
    return errors

def run_phase_b(allocations, targets, teachers, classes, CT, LVL, mp, time_limit, workers):
    units = []
    for a in allocations:
        for _ in range(a["periods"]):
            units.append((a["teacher"], a["class"], a["subject"]))
    M = cp_model.CpModel(); X = {}
    for i,(t,c,s) in enumerate(units):
        for d in range(NUM_DAYS):
            for p in range(PPD): X[(i,d,p)] = M.new_bool_var("")
    for i in range(len(units)):
        M.add(sum(X[(i,d,p)] for d in range(NUM_DAYS) for p in range(PPD)) == 1)
    byc = {}
    for i,(t,c,s) in enumerate(units): byc.setdefault(c,[]).append(i)
    for c,idx in byc.items():
        for d in range(NUM_DAYS):
            for p in range(PPD): M.add(sum(X[(i,d,p)] for i in idx) <= 1)
    byt = {}
    for i,(t,c,s) in enumerate(units): byt.setdefault(t,[]).append(i)
    for t,idx in byt.items():
        for d in range(NUM_DAYS):
            for p in range(PPD): M.add(sum(X[(i,d,p)] for i in idx) <= 1)   # R3
    for i,(t,c,s) in enumerate(units):                                      # R4
        for p in range(mp[t]-1):
            for d in range(NUM_DAYS): M.add(X[(i,d,p)] == 0)
    for c,idx in byc.items():                                              # R2
        if LVL[c] <= 2:
            for i in idx:
                if units[i][2] == "Diary":
                    for d in range(NUM_DAYS):
                        for p in range(PPD-1): M.add(X[(i,d,p)] == 0)
                else:
                    for d in range(NUM_DAYS): M.add(X[(i,d,PPD-1)] == 0)
    for c,idx in byc.items():                                              # R1
        ctt = CT[c]
        if not ctt or mp[ctt] > 1: continue
        cti = [i for i in idx if units[i][0] == ctt]
        if not cti: continue
        for d in range(min(len(cti), NUM_DAYS)):
            M.add(sum(X[(i,d,0)] for i in cti) == 1)
    for c,idx in byc.items():                                              # R5
        subs = {}
        for i in idx: subs.setdefault(units[i][2], []).append(i)
        for s,si in subs.items():
            if len(si) > 2:
                for d in range(NUM_DAYS):
                    M.add(sum(X[(i,d,p)] for i in si for p in range(PPD)) <= 2)
    s2 = cp_model.CpSolver()
    s2.parameters.max_time_in_seconds = time_limit
    s2.parameters.num_search_workers = workers
    s2.parameters.random_seed = SEED
    st2 = s2.solve(M)
    if st2 not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"ok": False, "phase": "schedule", "allocations": allocations, "targets": targets,
                "errors": [f"Timetable {s2.status_name(st2)}"],
                "message": "Saved allocation valid but timetable infeasible under R1-R5."}
    grid = {c: [[None]*PPD for _ in range(NUM_DAYS)] for c in classes}
    for i,(t,c,s) in enumerate(units):
        for d in range(NUM_DAYS):
            for p in range(PPD):
                if s2.value(X[(i,d,p)]) == 1:
                    grid[c][d][p] = {"teacher": t, "subject": s}
    filled = sum(1 for c in classes for d in range(NUM_DAYS) for p in range(PPD) if grid[c][d][p])
    return {"ok": True, "phase": "done", "allocations": allocations, "targets": targets,
            "grid": grid, "filled": filled, "total": len(classes)*NUM_DAYS*PPD,
            "message": f"Timetable complete: {filled}/{len(classes)*NUM_DAYS*PPD} ({s2.status_name(st2)})."}

def solve(data, time_limit=60, workers=8):
    mode = data.get("mode", "full")
    teachers = {t["name"]: t for t in data["teachers"]}
    classes  = {c["name"]: c for c in data["classes"]}
    CT = {c["name"]: c.get("class_teacher") for c in data["classes"]}
    LVL = {c["name"]: c["class_level"] for c in data["classes"]}
    curric = data["curriculum"]
    mp = {n: t.get("min_period_start", 1) for n, t in teachers.items()}

    required = {}
    for s, cm in curric.items():
        for c, p in cm.items():
            if c in classes and p and p > 0:
                required[(c, s)] = int(p)

    def eligible(c, s):
        lvl = LVL[c]
        return [n for n, t in teachers.items()
                if s in t["subjects"] and t["min_class_level"] <= lvl <= t["max_class_level"]]

    # ---------- coverage pre-check ----------
    errors = []
    for (c, s) in required:
        if not eligible(c, s):
            errors.append(f"No teacher can teach {s} to class {c} (level {LVL[c]}).")
    # class totals must equal 48
    by_class = {}
    for (c, s), p in required.items(): by_class[c] = by_class.get(c, 0) + p
    for c in classes:
        if by_class.get(c, 0) != PPD * NUM_DAYS:
            errors.append(f"Class {c} curriculum sums to {by_class.get(c,0)} (must be {PPD*NUM_DAYS}).")
    if errors:
        return {"ok": False, "phase": "validate", "errors": errors,
                "message": "Fix curriculum/teacher coverage first."}

    if mode == "schedule":
        incoming = data.get("allocations") or []
        if not incoming:
            return {"ok": False, "phase": "schedule", "errors": ["No saved allocations to schedule."],
                    "message": "Generate or enter allocations first (Allocations page)."}
        allocations = [{"teacher": a["teacher"], "class": a["class"], "subject": a["subject"],
                        "periods": int(a["periods"])} for a in incoming if int(a.get("periods", 0)) > 0]
        sched_errors = validate_saved_allocations(allocations, required, eligible, teachers, classes)
        if sched_errors:
            return {"ok": False, "phase": "schedule", "errors": sched_errors,
                    "message": "Saved allocations do not match curriculum. Fix on Allocations page."}
        targets = {}
        for a in allocations:
            targets[a["teacher"]] = targets.get(a["teacher"], 0) + a["periods"]
        return run_phase_b(allocations, targets, teachers, classes, CT, LVL, mp, time_limit, workers)

    # ================= PHASE A: ALLOCATION =================
    m = cp_model.CpModel()
    cand = {}
    for (c, s), need in required.items():
        for t in eligible(c, s):
            cand[(t, c, s)] = need
    x = {k: m.new_int_var(0, ub, "") for k, ub in cand.items()}
    used = {k: m.new_bool_var("") for k in cand}
    for k in cand:
        m.add(x[k] >= 1).only_enforce_if(used[k])
        m.add(x[k] == 0).only_enforce_if(used[k].Not())
    for (c, s), need in required.items():
        ks = [k for k in cand if k[1] == c and k[2] == s]
        if ks: m.add(sum(x[k] for k in ks) == need)
    # Diary -> CT only (levels<=2)
    for c in classes:
        if LVL[c] <= 2 and (c, "Diary") in required:
            ctt = CT[c]
            if ctt and "Diary" in teachers.get(ctt, {}).get("subjects", []):
                for k in cand:
                    if k[1] == c and k[2] == "Diary" and k[0] != ctt:
                        m.add(used[k] == 0)
    # per-teacher totals + caps
    tot = {}
    for t in teachers:
        contribs = [x[k] for k in cand if k[0] == t]
        fixed = teachers[t].get("fixed_target")
        ub = cap_for(mp[t], fixed)
        # leave scheduling slack for late-start teachers (mp>1) when not fixed
        if fixed is None and mp[t] > 1:
            ub = min(ub, (PPD - (mp[t]-1)) * NUM_DAYS - 3)
        v = m.new_int_var(0, ub, "")
        m.add(v == (sum(contribs) if contribs else 0))
        tot[t] = v
        if fixed is not None:
            m.add(v == fixed)
    m.add(sum(tot[t] for t in teachers) == sum(required.values()))
    # CT >= 6 in own class
    for c in classes:
        ctt = CT[c]
        if not ctt: continue
        cc = [x[k] for k in cand if k[0] == ctt and k[1] == c]
        if not cc: continue
        maxposs = sum(min(required.get((c, k[2]), 0), cand[k]) for k in cand if k[0] == ctt and k[1] == c)
        capv = min(TARGET_CT, maxposs)
        if capv > 0: m.add(sum(cc) >= capv)
    # objective: minimize splits, then balance (min max free load)
    nsplit = sum(used.values())
    maxload = m.new_int_var(0, MAX_TARGET, "")
    for t in teachers:
        if teachers[t].get("fixed_target") is None:
            m.add(maxload >= tot[t])
    m.minimize(nsplit * 10 + maxload)

    s1 = cp_model.CpSolver()
    s1.parameters.max_time_in_seconds = time_limit
    s1.parameters.num_search_workers = workers
    s1.parameters.random_seed = SEED
    st1 = s1.solve(m)
    if st1 not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"ok": False, "phase": "allocate", "errors": [f"Allocation {s1.status_name(st1)}"],
                "message": "Could not find a valid allocation. Check fixed targets vs capacity."}
    allocations = []
    targets = {t: int(s1.value(tot[t])) for t in teachers}
    for k, v in x.items():
        val = int(s1.value(v))
        if val > 0:
            allocations.append({"teacher": k[0], "class": k[1], "subject": k[2], "periods": val})

    total_assigned = sum(a["periods"] for a in allocations)
    if mode == "allocate":
        return {
            "ok": True,
            "phase": "allocate",
            "allocations": allocations,
            "targets": targets,
            "filled": total_assigned,
            "total": sum(required.values()),
            "message": f"Allocation complete: {total_assigned}/{sum(required.values())} ({s1.status_name(st1)}).",
        }

    return run_phase_b(allocations, targets, teachers, classes, CT, LVL, mp, time_limit, workers)

if __name__ == "__main__":
    data = json.load(sys.stdin)
    out = solve(data, time_limit=int(data.get("time_limit", 60)), workers=int(data.get("workers", 8)))
    print(json.dumps(out))
