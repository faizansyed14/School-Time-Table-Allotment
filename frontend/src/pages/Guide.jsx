import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import {
  BookOpen, Users, ListChecks, Sparkles, Play, Check,
  ChevronRight, AlertCircle, CheckCircle, Circle, ArrowRight,
  GraduationCap, Calendar, UserX,
} from 'lucide-react';

const STEPS = [
  {
    id: 1, icon: BookOpen, title: 'Add Subjects & Period Requirements',
    path: '/curriculum', pathLabel: 'Go to Curriculum',
    check: async () => {
      const d = await api.get('/subjects');
      return d.length > 0 ? { ok: true, note: `${d.length} subjects configured` } : { ok: false, note: 'No subjects yet' };
    },
    desc: 'Define every subject taught in the school and how many periods per week each class gets.',
    steps: [
      'Go to Curriculum → Subjects & Periods tab',
      'Click "Add Subject" for each subject (English, Hindi, Maths, etc.)',
      'For each subject, enter the number of periods/week for each class (e.g. English = 9 for Class 1A)',
      'Each class column must total 48 across all subjects (8 periods × 6 days)',
    ],
    tip: 'Classes 1–2 need Diary periods. Classes 1–4 need E.V.S instead of S.St.',
    warning: null,
  },
  {
    id: 2, icon: Users, title: 'Add Teachers',
    path: '/teachers', pathLabel: 'Go to Teachers',
    check: async () => {
      const d = await api.get('/teachers');
      return d.length > 0 ? { ok: true, note: `${d.length} teachers added` } : { ok: false, note: 'No teachers yet' };
    },
    desc: 'Add every teacher with their subject expertise, class range, and weekly workload target.',
    steps: [
      'Go to Teachers → click "Add Teacher"',
      'Enter their full name',
      'Select "Class Teacher of" if they are a class teacher (e.g. Deepika → Class 1A)',
      'Set Min/Max class level (e.g. Deepika teaches only Classes 1–5)',
      'Set Workload target = total periods/week they should teach',
      'Set "Cannot teach before period" for part-time or late-arrival teachers',
      'Tick all subjects they can teach',
    ],
    tip: 'The sum of all teacher workload targets must equal 720 (15 classes × 48 periods). Check this before running auto-generate.',
    warning: 'Each class teacher must teach subjects in their class that total ≥ 6 periods (one per day for R1). Example: if Shahina is CT of Class 8 and only teaches Drawing (2p) + Computer (3p) = 5p, R1 will run best-effort.',
  },
  {
    id: 3, icon: GraduationCap, title: 'Assign Class Teachers',
    path: '/curriculum', pathLabel: 'Go to Curriculum → Classes',
    check: async () => {
      const d = await api.get('/classes');
      const assigned = d.filter(c => c.class_teacher_id).length;
      return assigned === d.length
        ? { ok: true, note: `All ${d.length} classes have a class teacher` }
        : { ok: assigned > 0, note: `${assigned}/${d.length} classes have a class teacher` };
    },
    desc: 'Each class needs a class teacher. They will be placed at Period 1 every day (Rule R1).',
    steps: [
      'Option A: While adding a teacher, select "Class Teacher of" in the Teacher modal',
      'Option B: Go to Curriculum → Classes tab → click edit on any class → assign teacher',
      'Every class should have exactly one class teacher',
    ],
    tip: null,
    warning: null,
  },
  {
    id: 4, icon: ListChecks, title: 'Set Subject Allocations',
    path: '/allocations', pathLabel: 'Go to Allocations',
    check: async () => {
      const [allocs, val] = await Promise.all([api.get('/allocations'), api.get('/allocations/validate').catch(() => null)]);
      if (allocs.length === 0) return { ok: false, note: 'No allocations yet' };
      const errors = val?.issues?.filter(i => i.severity === 'error') || [];
      return errors.length === 0
        ? { ok: true, note: `${allocs.length} rows, all valid` }
        : { ok: false, note: `${allocs.length} rows but ${errors.length} error(s)` };
    },
    desc: 'Define exactly which teacher teaches which subject to which class, and how many times per week.',
    steps: [
      'Option A (recommended): Click "Auto-Generate" → Preview → Apply',
      '  The system reads your teachers + curriculum and solves the optimal assignment',
      'Option B (manual): Click "Add Row" for each teacher–class–subject combination',
      'Each class must total exactly 48 periods',
      'Each teacher must hit their allotted_periods target',
      'Go to Issues tab to see and fix any errors',
    ],
    tip: 'Auto-Generate catches data errors before solving — it will tell you exactly what to fix if it fails.',
    warning: 'Common issues: teacher workload sum ≠ 720, teacher subject list incomplete, CT max periods < 6 in their class.',
  },
  {
    id: 5, icon: Play, title: 'Run Allotment (Generate Timetable)',
    path: '/allotment', pathLabel: 'Go to Allotment',
    check: async () => {
      const d = await api.get('/timetable').catch(() => []);
      return d.length > 0 ? { ok: true, note: `${d.length} timetable slots filled` } : { ok: false, note: 'Timetable not generated yet' };
    },
    desc: 'The CP-SAT solver reads your allocations and builds a conflict-free weekly timetable.',
    steps: [
      'Go to Allotment page',
      'Toggle R1 (class teacher at P1) and R2 (Diary at P8 for classes 1–2) as needed',
      'Fix any errors shown in the Data Status card',
      'Click "Run Allocator" — takes up to 90 seconds',
      'When FEASIBLE appears, click "Apply to Timetable"',
      'Go to Timetable page to view the result',
    ],
    tip: 'If the solver returns INFEASIBLE, go to Allocations → Issues tab. The most common cause is a teacher scheduled beyond their capacity (min_period_start too late).',
    warning: null,
  },
  {
    id: 6, icon: Calendar, title: 'View & Use the Timetable',
    path: '/timetable', pathLabel: 'Go to Timetable',
    check: async () => {
      const d = await api.get('/timetable').catch(() => []);
      return d.length >= 720 ? { ok: true, note: 'Timetable fully filled' } : { ok: d.length > 0, note: d.length > 0 ? 'Partially filled' : 'Empty' };
    },
    desc: 'View the generated timetable by class, by teacher, or as a full master grid.',
    steps: [
      'Class View: select any class to see their 6-day × 8-period schedule',
      'Teacher View: select any teacher to see their weekly schedule',
      'Master Grid: see all classes on one day at a glance',
    ],
    tip: null,
    warning: null,
  },
  {
    id: 7, icon: UserX, title: 'Daily: Mark Absences',
    path: '/absences', pathLabel: 'Go to Absences',
    check: async () => ({ ok: true, note: 'Available anytime' }),
    desc: 'Each morning, mark absent teachers and assign period-by-period substitutes from the available teachers.',
    steps: [
      'Go to Absences → select today\'s date',
      'Click "Mark Absent" → select teacher → save',
      'Click "Assign Subs" next to the absent teacher',
      'For each period they have today, select a substitute from available teachers',
    ],
    tip: 'Available substitutes list automatically excludes other absent teachers for that date.',
    warning: null,
  },
];

export default function Guide() {
  const [status, setStatus] = useState({});
  const [loadingStep, setLoadingStep] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    async function checkAll() {
      const results = {};
      for (const step of STEPS) {
        try {
          results[step.id] = await step.check();
        } catch {
          results[step.id] = { ok: false, note: 'Could not check' };
        }
      }
      setStatus(results);
    }
    checkAll();
  }, []);

  const completedCount = Object.values(status).filter((s) => s?.ok).length;
  const totalSteps     = STEPS.length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Setup Guide</h2>
          <p>Follow these steps to get your timetable running from scratch.</p>
        </div>
        <span className="badge badge-blue" style={{ fontSize: 13, padding: '5px 12px' }}>
          {completedCount}/{totalSteps} steps done
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--mid)', marginBottom: 6 }}>
          <span>Overall progress</span>
          <span>{Math.round((completedCount / totalSteps) * 100)}%</span>
        </div>
        <div className="progress-bar-wrap">
          <div className="progress-bar-fill" style={{ width: `${(completedCount / totalSteps) * 100}%`, background: 'var(--dark)' }} />
        </div>
      </div>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {STEPS.map((step, idx) => {
          const s = status[step.id];
          const isOk = s?.ok;
          const isPrev = idx === 0 || status[STEPS[idx - 1].id]?.ok;
          return (
            <StepCard
              key={step.id}
              step={step}
              status={s}
              isOk={isOk}
              isAccessible={isPrev}
              onGo={() => navigate(step.path)}
            />
          );
        })}
      </div>

      {/* Quick reference */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <span style={{ fontWeight: 600, fontSize: 14 }}>Quick Reference — Common Issues</span>
        </div>
        <div className="card-body">
          <table style={{ fontSize: 12, width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', color: 'var(--mid)' }}>Symptom</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', color: 'var(--mid)' }}>Cause</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', color: 'var(--mid)' }}>Fix</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Auto-generate fails: workload mismatch', 'Teacher targets sum ≠ 720', 'Teachers page → adjust allotted_periods so they sum to 720'],
                ['Auto-generate: no teacher for subject X', 'No teacher has that subject in their subjects list', 'Teachers page → add subject to teacher'],
                ['Auto-generate: CT cannot reach 6 periods', 'Class teacher only teaches subjects worth < 6 periods in that class', 'Curriculum → increase one of their subjects\' period count, OR change the class teacher'],
                ['Solver returns INFEASIBLE', 'Teacher scheduled beyond capacity (min_period_start too late)', 'Teachers page → lower the "cannot teach before" period'],
                ['P1 mismatch warning', 'Timetable has non-CT at period 1', 'Enable R1 in Allotment → re-run solver'],
                ['Class shows 47/48 periods', 'One subject period count is wrong', 'Curriculum → Subjects tab → fix that class column'],
                ['Timetable empty after apply', 'CP run not applied yet', 'Allotment → Run → click Apply to Timetable'],
              ].map(([symptom, cause, fix], i) => (
                <tr key={i}>
                  <td style={{ padding: '8px', borderBottom: '1px solid var(--border)', fontWeight: 600, color: 'var(--red)', verticalAlign: 'top' }}>{symptom}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid var(--border)', color: 'var(--mid)', verticalAlign: 'top' }}>{cause}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }}>{fix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StepCard({ step, status, isOk, isAccessible, onGo }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = step.icon;

  return (
    <div className="card" style={{ borderLeft: `3px solid ${isOk ? 'var(--green)' : 'var(--border)'}` }}>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          {/* Status icon */}
          <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                        background: isOk ? 'var(--green-bg)' : 'var(--bg)',
                        border: `1px solid ${isOk ? '#6ee7b7' : 'var(--border-2)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {isOk
              ? <CheckCircle size={16} color="var(--green)" />
              : <Icon size={14} color="var(--muted)" />}
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Step {step.id}</span>
              {status && (
                <span className={`badge ${isOk ? 'badge-green' : 'badge-amber'}`} style={{ fontSize: 10 }}>
                  {status.note}
                </span>
              )}
            </div>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px', color: 'var(--dark)' }}>{step.title}</h3>
            <p style={{ fontSize: 13, color: 'var(--mid)', margin: 0 }}>{step.desc}</p>

            {expanded && (
              <div style={{ marginTop: 14 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--dark)', marginBottom: 8 }}>How to do this:</p>
                <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {step.steps.map((s, i) => (
                    <li key={i} style={{ fontSize: 12, color: s.startsWith('  ') ? 'var(--mid)' : 'var(--dark)' }}>{s.trim()}</li>
                  ))}
                </ol>
                {step.tip && (
                  <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--blue-bg)', borderRadius: 5, fontSize: 12, color: 'var(--blue)', display: 'flex', gap: 6 }}>
                    <span style={{ fontWeight: 700 }}>💡</span> {step.tip}
                  </div>
                )}
                {step.warning && (
                  <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--amber-bg)', borderRadius: 5, fontSize: 12, color: 'var(--amber)', display: 'flex', gap: 6 }}>
                    <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> {step.warning}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Hide' : 'How?'}
              <ChevronRight size={12} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
            </button>
            <button className="btn btn-outline btn-sm" onClick={onGo}>
              {step.pathLabel} <ArrowRight size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
