import React, { useMemo, useState } from 'react';
import {
  segmentsFromTimetableRows,
  getCoverageInfo,
  segmentsToApiPayload,
  DAY_NAMES,
  DAY_NUMBERS,
} from '../lib/masterGrid.js';
import { SUBJECT_OPTIONS } from '../lib/utils.js';
import { api } from '../lib/api.js';
import { Loader, Plus, Trash2, AlertCircle } from 'lucide-react';

const EMPTY_BLOCK = { dayStart: 1, dayEnd: 1, subject: '', teacher_id: '' };

function firstUncoveredDay(segments) {
  const info = getCoverageInfo(segments);
  return info.missing[0] ?? 1;
}

export default function MasterGridCellEditor({ edit, teachers, onClose, onSaved }) {
  const [segments, setSegments] = useState(() =>
    segmentsFromTimetableRows(edit.slotRows || []),
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const coverage = useMemo(() => getCoverageInfo(segments), [segments]);
  const sortedTeachers = useMemo(
    () => [...(teachers || [])].sort((a, b) => a.name.localeCompare(b.name)),
    [teachers],
  );

  function updateBlock(index, patch) {
    setSegments((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    setError('');
  }

  function addBlock() {
    const d = firstUncoveredDay(segments);
    setSegments((prev) => [...prev, { ...EMPTY_BLOCK, dayStart: d, dayEnd: d }]);
  }

  function removeBlock(index) {
    setSegments((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      const payload = segmentsToApiPayload(segments);
      await api.put('/timetable/master-cell', {
        class_id: edit.classId,
        period: edit.period,
        segments: payload,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const canSave = coverage.isComplete && segments.every((s) => s.subject && s.teacher_id);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">
          Edit — Class {edit.className} · Period {edit.period}
        </h2>

        <div className="alert alert-amber" style={{ marginBottom: 12, fontSize: 12 }}>
          <AlertCircle size={13} />
          <span>
            School week = <b>6 days only</b> (1 Mon … 6 Sat). All 6 days must be filled, with no overlaps.
            You are covering <b>{coverage.coveredCount}/6</b> days.
          </span>
        </div>

        {coverage.overlap && (
          <div className="alert alert-red" style={{ marginBottom: 10, fontSize: 12 }}>
            Some day ranges overlap — adjust From/To so each day 1–6 is used once.
          </div>
        )}
        {coverage.missing.length > 0 && !coverage.overlap && (
          <div className="alert alert-amber" style={{ marginBottom: 10, fontSize: 12 }}>
            Still missing: {coverage.missingLabels.join(', ')} (day {coverage.missing.join(', ')})
          </div>
        )}
        {coverage.isComplete && (
          <div className="alert alert-green" style={{ marginBottom: 10, fontSize: 12 }}>
            All 6 days covered: {coverage.coveredLabels.join(', ')}
          </div>
        )}

        {error && <div className="alert alert-red" style={{ marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 360, overflowY: 'auto' }}>
          {segments.map((block, index) => (
            <div
              key={index}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 12,
                background: 'var(--bg)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>Block {index + 1}</span>
                {segments.length > 1 && (
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => removeBlock(index)}>
                    <Trash2 size={12} /> Remove
                  </button>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">From day</label>
                  <select
                    className="form-select"
                    value={block.dayStart}
                    onChange={(e) => {
                      const dayStart = Number(e.target.value);
                      const dayEnd = Math.max(dayStart, Number(block.dayEnd));
                      updateBlock(index, { dayStart, dayEnd });
                    }}
                  >
                    {DAY_NUMBERS.map((d) => (
                      <option key={d} value={d}>{d} — {DAY_NAMES[d - 1]}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">To day</label>
                  <select
                    className="form-select"
                    value={block.dayEnd}
                    onChange={(e) => {
                      const dayEnd = Number(e.target.value);
                      const dayStart = Math.min(Number(block.dayStart), dayEnd);
                      updateBlock(index, { dayStart, dayEnd });
                    }}
                  >
                    {DAY_NUMBERS.filter((d) => d >= (block.dayStart || 1)).map((d) => (
                      <option key={d} value={d}>{d} — {DAY_NAMES[d - 1]}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Subject</label>
                  <select
                    className="form-select"
                    value={block.subject}
                    onChange={(e) => updateBlock(index, { subject: e.target.value })}
                  >
                    <option value="">— Select —</option>
                    {SUBJECT_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Teacher</label>
                  <select
                    className="form-select"
                    value={block.teacher_id}
                    onChange={(e) => updateBlock(index, { teacher_id: e.target.value })}
                  >
                    <option value="">— Select —</option>
                    {sortedTeachers.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <p style={{ fontSize: 11, color: 'var(--mid)', margin: '8px 0 0' }}>
                {block.dayStart === block.dayEnd
                  ? `${DAY_NAMES[block.dayStart - 1]} only`
                  : `${DAY_NAMES[block.dayStart - 1]} – ${DAY_NAMES[block.dayEnd - 1]} (${block.dayEnd - block.dayStart + 1} day(s))`}
                {block.subject && block.teacher_id
                  ? ` · ${block.subject} · ${sortedTeachers.find((t) => t.id === block.teacher_id)?.name}`
                  : ''}
              </p>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-outline btn-sm"
          style={{ marginTop: 10 }}
          onClick={addBlock}
          disabled={coverage.isComplete}
        >
          <Plus size={12} /> Add another block
        </button>
        {coverage.isComplete && (
          <p style={{ fontSize: 11, color: 'var(--mid)', marginTop: 6 }}>
            All 6 days are assigned. Remove a block or widen a range before adding more.
          </p>
        )}

        <div className="modal-footer">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || !canSave}
            title={!canSave ? 'Fill all blocks and cover days 1–6 with no gaps' : ''}
          >
            {saving ? <><Loader size={13} className="spinner" /> Saving…</> : 'Save to database'}
          </button>
        </div>
      </div>
    </div>
  );
}
