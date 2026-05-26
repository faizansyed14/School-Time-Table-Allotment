import React from 'react';
import { AlertCircle, CheckCircle } from 'lucide-react';

export default function AllotmentIssues({ allotment, navigate, maxItems = 20 }) {
  if (!allotment) return null;

  const errors = (allotment.issues || []).filter((i) => i.severity === 'error');
  const warnings = (allotment.issues || []).filter((i) => i.severity === 'warning');

  return (
    <div style={{ marginBottom: 12 }}>
      {allotment.ok ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--green)', fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
          <CheckCircle size={16} /> No allocation errors
          {warnings.length > 0 && (
            <span style={{ color: 'var(--mid)', fontWeight: 500 }}>· {warnings.length} warning{warnings.length !== 1 ? 's' : ''}</span>
          )}
        </div>
      ) : (
        <div className="alert alert-red" style={{ marginBottom: 10 }}>
          <AlertCircle size={14} />
          <div>
            <strong>{allotment.error_count} error{allotment.error_count !== 1 ? 's' : ''}</strong>
            {warnings.length > 0 && ` · ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}`}
            {' — cannot fully allocate until fixed'}
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)', marginBottom: 6, textTransform: 'uppercase' }}>
            Unable to allocate / errors
          </div>
          {errors.slice(0, maxItems).map((issue, i) => (
            <IssueRow key={`e-${i}`} issue={issue} navigate={navigate} />
          ))}
          {errors.length > maxItems && (
            <div style={{ fontSize: 11, color: 'var(--mid)', marginTop: 4 }}>+{errors.length - maxItems} more errors</div>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#b45309', marginBottom: 6, textTransform: 'uppercase' }}>
            Warnings
          </div>
          {warnings.slice(0, Math.max(0, maxItems - errors.length)).map((issue, i) => (
            <IssueRow key={`w-${i}`} issue={issue} navigate={navigate} />
          ))}
        </div>
      )}

      {allotment.last_run && !allotment.last_run.success && (
        <div style={{ fontSize: 12, color: 'var(--mid)', marginTop: 8 }}>
          Last timetable run: <strong>{allotment.last_run.solver_status_name || 'failed'}</strong>
        </div>
      )}
    </div>
  );
}

function IssueRow({ issue, navigate }) {
  const isError = issue.severity === 'error';
  return (
    <div
      className={`issue-card ${isError ? 'error' : ''}`}
      style={{ marginBottom: 6, borderColor: isError ? undefined : '#fcd34d', background: isError ? undefined : '#fffbeb' }}
    >
      <span style={{ fontSize: 12, fontWeight: 500 }}>{issue.message}</span>
      {issue.actions?.length > 0 && (
        <div className="issue-actions" style={{ marginTop: 6 }}>
          {issue.actions.map((act, j) => (
            <a
              key={j}
              href={act.link || '#'}
              className="issue-action-btn"
              style={{ fontSize: 11, color: isError ? 'var(--red)' : '#b45309', borderColor: isError ? '#fca5a5' : '#fcd34d' }}
              onClick={(e) => {
                if (act.link && navigate) {
                  e.preventDefault();
                  navigate(act.link);
                }
              }}
            >
              {act.page} → {act.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
