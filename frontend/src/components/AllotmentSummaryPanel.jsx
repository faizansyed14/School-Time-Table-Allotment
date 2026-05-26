import React from 'react';
import { RefreshCw, BarChart2 } from 'lucide-react';
import AllotmentIssues from './AllotmentIssues.jsx';

export default function AllotmentSummaryPanel({ allotment, navigate, onRefresh, loading }) {
  if (!allotment) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ color: 'var(--mid)', fontSize: 13 }}>
          {loading ? 'Loading summary…' : 'No summary data yet. Run the allocator first.'}
        </div>
      </div>
    );
  }

  const isPreview = allotment.summary_source === 'preview';

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <span style={{ fontWeight: 600, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <BarChart2 size={14} /> Allotment Summary
          {isPreview && (
            <span className="badge badge-amber" style={{ fontSize: 10 }}>Preview — not applied to DB</span>
          )}
        </span>
        <span style={{ fontSize: 12, color: 'var(--mid)' }}>
          {allotment.totals.teacher_count} teachers · target {allotment.totals.allotted_sum}p ·
          allocated {allotment.totals.allocation_sum}p · timetable {allotment.totals.timetable_sum}p
          {isPreview && allotment.totals.timetable_db_sum != null && allotment.totals.timetable_db_sum !== allotment.totals.timetable_sum && (
            <span> (DB still {allotment.totals.timetable_db_sum}p until you Apply)</span>
          )}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={12} className={loading ? 'spinner' : ''} />
        </button>
      </div>
      {isPreview && (
        <div className="alert alert-amber" style={{ margin: '0 16px 12px', fontSize: 12 }}>
          Solver finished. This summary reflects the <b>latest run</b>. Click <b>Apply to Timetable</b> below to save it to the database.
        </div>
      )}
      <div className="card-body" style={{ paddingTop: 0 }}>
        <AllotmentIssues allotment={allotment} navigate={navigate} maxItems={15} />
      </div>
      <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Teacher</th>
              <th>Subjects</th>
              <th>Level</th>
              <th>Target</th>
              <th>Allocated</th>
              <th>{isPreview ? 'Timetable (preview)' : 'Timetable'}</th>
              <th>Capacity</th>
              <th>Issues</th>
            </tr>
          </thead>
          <tbody>
            {allotment.teachers.map((t) => {
              const mismatch = t.allotted_periods !== t.allocation_total;
              const ttMismatch = t.allocation_total !== t.allocated_periods;
              return (
                <tr key={t.id} style={t.has_issues ? { background: '#fff7ed' } : undefined}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                      {(t.subjects || []).slice(0, 4).map((s) => (
                        <span key={s} className="badge badge-gray" style={{ fontSize: 10 }}>{s}</span>
                      ))}
                      {(t.subjects || []).length > 4 && (
                        <span className="badge badge-gray" style={{ fontSize: 10 }}>+{t.subjects.length - 4}</span>
                      )}
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--mid)' }}>{t.level_label}</td>
                  <td><span className="badge badge-blue">{t.allotted_periods}p</span></td>
                  <td>
                    <span className={`badge ${mismatch ? 'badge-amber' : 'badge-green'}`}>
                      {t.allocation_total}p
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    <span className={`badge ${ttMismatch ? 'badge-amber' : 'badge-green'}`}>
                      {t.allocated_periods}p
                    </span>
                    {isPreview && t.timetable_db !== t.allocated_periods && (
                      <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 4 }}>was {t.timetable_db}p</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--mid)' }}>{t.capacity}p · from P{t.min_period_start}</td>
                  <td style={{ fontSize: 11, color: t.has_issues ? '#b45309' : 'var(--mid)', maxWidth: 200 }}>
                    {t.issues?.length ? t.issues.join(' ') : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
