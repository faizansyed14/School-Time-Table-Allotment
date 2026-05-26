import React, { useMemo } from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';

const TIER_GROUPS = [
  { tier: 'best', label: 'Green — subject + class level match', optClass: 'sub-opt-best' },
  { tier: 'subject', label: 'Yellow — subject matches, level does not', optClass: 'sub-opt-subject' },
  { tier: 'other', label: 'White — other available teachers', optClass: 'sub-opt-other' },
];

function tierHint(t) {
  if (t.match_tier === 'best') return `${t.name} · ${t.level_label}`;
  if (t.match_tier === 'subject') return `${t.name} · ${t.level_label} · level mismatch`;
  return `${t.name} · ${(t.subjects || []).slice(0, 2).join(', ')}`;
}

function SubstituteSelect({ slot, value, onChange, disabled }) {
  const byTier = useMemo(() => {
    const map = { best: [], subject: [], other: [] };
    (slot.available || []).forEach((t) => {
      if (map[t.match_tier]) map[t.match_tier].push(t);
    });
    return map;
  }, [slot.available]);

  const selected = (slot.available || []).find((t) => t.id === value);
  const selectClass = selected
    ? `form-select sub-select sub-select-${selected.match_tier}`
    : 'form-select sub-select';

  return (
    <select
      className={selectClass}
      value={value || ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" className="sub-opt-placeholder">— Select substitute —</option>
      {TIER_GROUPS.map(({ tier, label, optClass }) =>
        byTier[tier].length > 0 ? (
          <optgroup key={tier} label={label}>
            {byTier[tier].map((t) => (
              <option key={t.id} value={t.id} className={optClass}>
                {tierHint(t)}
              </option>
            ))}
          </optgroup>
        ) : null,
      )}
    </select>
  );
}

function ClassDayTimetable({ classInfo, absentTeacherName }) {
  return (
    <div className="class-day-timetable">
      <div className="class-day-timetable-label">
        Full class timetable — {classInfo.class_name} ({classInfo.day_name || 'this day'})
      </div>
      <div className="class-day-timetable-grid">
        {classInfo.periods.map((p) => (
          <div
            key={p.period}
            className={`class-day-period${p.empty ? ' empty' : ''}${p.is_absent_slot ? ' absent-slot' : ''}${p.substitute ? ' has-sub' : ''}`}
          >
            <div className="class-day-period-num">P{p.period}</div>
            {!p.empty && (
              <>
                <div className="class-day-period-subj">{p.subject}</div>
                {p.is_absent_slot ? (
                  <>
                    <div className="class-day-period-teacher absent">{absentTeacherName}</div>
                    {p.substitute ? (
                      <div className="class-day-period-sub">→ {p.substitute.name}</div>
                    ) : (
                      <div className="class-day-period-pending">Needs sub</div>
                    )}
                  </>
                ) : (
                  <div className="class-day-period-teacher">{p.display_teacher}</div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SubstituteAssignPanel({ coverage, absence, onAssign, saving }) {
  const classes = coverage?.classes || [];
  const summary = coverage?.summary;

  if (!coverage) return null;

  return (
    <div>
      <div className="sub-legend">
        <span><span className="sub-legend-swatch best" /> Green — teaches this subject + class level fits</span>
        <span><span className="sub-legend-swatch subject" /> Yellow — teaches subject, level mismatch</span>
        <span><span className="sub-legend-swatch other" /> White — other free teachers</span>
      </div>

      {summary && (
        <div
          className={`alert ${summary.pending === 0 ? 'alert-green' : 'alert-amber'}`}
          style={{ marginBottom: 14, fontSize: 12 }}
        >
          {summary.pending === 0 ? (
            <><CheckCircle size={13} /> All {summary.total_slots} class periods have substitutes assigned.</>
          ) : (
            <><AlertCircle size={13} /> <b>{summary.pending}</b> of {summary.total_slots} periods still need a substitute.</>
          )}
        </div>
      )}

      {classes.length === 0 ? (
        <p style={{ color: 'var(--mid)', fontSize: 13 }}>No classes on this day for the absent teacher.</p>
      ) : (
        classes.map((cls) => {
          const classSlots = (coverage.slots || []).filter((s) => s.class_id === cls.class_id);
          return (
            <div key={cls.class_id} className="sub-class-card">
              <div className="sub-class-card-header">
                <h3>Class {cls.class_name}</h3>
                <span className="badge badge-blue">
                  {classSlots.filter((s) => s.substitute).length}/{classSlots.length} assigned
                </span>
              </div>

              <ClassDayTimetable
                classInfo={{ ...cls, day_name: coverage.day_name }}
                absentTeacherName={absence?.teachers?.name}
              />

              <div className="sub-assign-rows">
                <div className="sub-assign-rows-title">Assign substitutes for this class</div>
                {classSlots.map((slot) => (
                  <div
                    key={slot.id}
                    className={`sub-assign-row${slot.substitute ? ' assigned' : ' pending'}`}
                  >
                    <div className="sub-assign-row-info">
                      <span className="sub-assign-period">Period {slot.period}</span>
                      <span className="sub-assign-meta">{slot.subject} · L{slot.class_level}</span>
                      {slot.substitute && (
                        <span className="badge badge-green" style={{ fontSize: 10 }}>
                          ✓ {slot.substitute.name}
                        </span>
                      )}
                    </div>
                    <div className="sub-assign-row-select">
                      <SubstituteSelect
                        slot={slot}
                        value={slot.substitute?.id || ''}
                        disabled={saving}
                        onChange={(tid) => onAssign(slot, tid)}
                      />
                      {(slot.available || []).length === 0 && (
                        <span style={{ fontSize: 11, color: 'var(--red)' }}>No free teachers</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
