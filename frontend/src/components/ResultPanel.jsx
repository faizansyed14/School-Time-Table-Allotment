import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle, CheckCircle, ChevronDown, ChevronUp, Loader, Clock,
} from 'lucide-react';

const PERIODS_PER_CLASS = 48;
const ISSUE_PREVIEW = 6;

function normalizeResult(result) {
  if (!result) return null;
  const success = result.success ?? result.ok ?? false;
  const filled = result.filled ?? result.totalAssigned ?? 0;
  const total = result.total ?? result.totalExpected ?? 0;
  return { ...result, success, filled, total };
}

function buildClassRows(result, classes, teachers) {
  if (!result?.success || !classes?.length) return [];
  const teacherById = Object.fromEntries((teachers || []).map((t) => [t.id, t]));
  const summary = result.class_summary || {};

  return [...classes]
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.name.localeCompare(b.name))
    .map((c) => {
      const s = summary[c.id] || {};
      const periods = s.periods_filled ?? 0;
      const ctPeriods = s.ct_periods ?? 0;
      const ctName = c.class_teacher_id ? teacherById[c.class_teacher_id]?.name || '—' : '—';
      const ok = periods === PERIODS_PER_CLASS && (!c.class_teacher_id || ctPeriods >= 6);
      return { id: c.id, name: c.name, periods, ctName, ctPeriods, ok };
    });
}

function IssuesList({ issues, navigate }) {
  const [expanded, setExpanded] = useState(false);
  if (!issues?.length) return null;

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const ordered = [...errors, ...warnings];
  const shown = expanded ? ordered : ordered.slice(0, ISSUE_PREVIEW);
  const hidden = ordered.length - shown.length;

  return (
    <div style={{ marginTop: 12 }}>
      {shown.map((issue, i) => {
        const isError = issue.severity === 'error';
        return (
          <div
            key={`${issue.type}-${issue.class_name || ''}-${issue.subject || ''}-${i}`}
            className={`issue-card ${isError ? 'error' : ''}`}
            style={{
              marginBottom: 8,
              borderLeft: isError ? undefined : '3px solid var(--amber)',
              background: isError ? undefined : '#fffbeb',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <AlertCircle
                size={14}
                style={{ marginTop: 2, flexShrink: 0, color: isError ? 'var(--red)' : 'var(--amber)' }}
              />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, margin: 0 }}>{issue.message}</p>
                {issue.actions?.[0] && (
                  <div className="issue-actions" style={{ marginTop: 6 }}>
                    <a
                      href={issue.actions[0].link || '#'}
                      className="issue-action-btn"
                      style={{ fontSize: 11 }}
                      onClick={(e) => {
                        if (issue.actions[0].link?.startsWith('/')) {
                          e.preventDefault();
                          navigate(issue.actions[0].link);
                        }
                      }}
                    >
                      {issue.actions[0].page} → {issue.actions[0].label}
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {hidden > 0 && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setExpanded(true)}
          style={{ fontSize: 12 }}
        >
          Show {hidden} more
        </button>
      )}
      {expanded && ordered.length > ISSUE_PREVIEW && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setExpanded(false)}
          style={{ fontSize: 12, marginLeft: 8 }}
        >
          Show less
        </button>
      )}
    </div>
  );
}

function AllocationSummaryTable({ rows, mode }) {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: open ? 10 : 0 }}
      >
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        View allocation summary
      </button>
      {open && (
        <div className="table-wrap">
          <table style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>Class</th>
                <th style={{ textAlign: 'right' }}>Periods</th>
                <th>Class teacher</th>
                <th style={{ textAlign: 'right' }}>CT periods</th>
                <th style={{ textAlign: 'center' }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} style={{ background: i % 2 ? 'var(--bg)' : undefined }}>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td style={{ textAlign: 'right' }}>{r.periods}/{PERIODS_PER_CLASS}</td>
                  <td>{r.ctName}</td>
                  <td style={{ textAlign: 'right' }}>{r.ctPeriods}</td>
                  <td style={{ textAlign: 'center' }}>
                    {r.ok ? <CheckCircle size={14} style={{ color: 'var(--green)' }} /> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {mode === 'full' && (
            <p style={{ fontSize: 11, color: 'var(--mid)', marginTop: 8 }}>
              Full mode: periods filled from timetable grid when available.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TargetChangesSection({ changes }) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  if (!changes?.length) return null;

  const changed = changes.filter((c) => c.delta !== 0 && c.delta != null);
  const unchanged = changes.filter((c) => c.delta === 0 || c.delta == null);
  const visible = showUnchanged ? changes : [...changed, ...unchanged.filter((c) => c.fixed)];

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Target changes</div>
      <p style={{ fontSize: 11, color: 'var(--mid)', margin: '0 0 10px' }}>
        Auto targets were decided by the engine; fixed targets were kept as entered.
      </p>
      <div className="table-wrap">
        <table style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Teacher</th>
              <th style={{ textAlign: 'center' }}>Before</th>
              <th style={{ textAlign: 'center' }}>After</th>
              <th style={{ textAlign: 'center' }}>Δ</th>
              <th style={{ textAlign: 'center' }}>Fixed?</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => {
              const delta = row.delta;
              const deltaColor = delta > 0 ? 'var(--green)' : delta < 0 ? 'var(--amber)' : 'var(--mid)';
              const highlight = delta !== 0 && delta != null;
              return (
                <tr
                  key={row.teacher}
                  style={{ background: highlight ? 'rgba(251, 191, 36, 0.08)' : i % 2 ? 'var(--bg)' : undefined }}
                >
                  <td style={{ fontWeight: 500 }}>{row.teacher}</td>
                  <td style={{ textAlign: 'center', color: 'var(--mid)' }}>
                    {row.before == null ? '—' : `${row.before}p`}
                  </td>
                  <td style={{ textAlign: 'center' }}>{row.after}p</td>
                  <td style={{ textAlign: 'center', fontWeight: 600, color: deltaColor }}>
                    {delta == null ? '—' : (delta > 0 ? `+${delta}` : String(delta))}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {row.fixed ? <span className="badge badge-blue">fixed</span> : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {unchanged.length > 0 && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setShowUnchanged((v) => !v)}
          style={{ marginTop: 8, fontSize: 12 }}
        >
          {showUnchanged ? 'Hide unchanged' : `Show ${unchanged.length} unchanged`}
        </button>
      )}
    </div>
  );
}

export default function ResultPanel({
  result,
  mode = 'full',
  loading = false,
  precheckIssues = [],
  classes = [],
  teachers = [],
  genAt = null,
  children = null,
}) {
  const navigate = useNavigate();
  const normalized = normalizeResult(result);

  const issues = useMemo(() => {
    const fromResult = normalized?.success
      ? (normalized?.issues || [])
      : (normalized?.issues?.length
        ? normalized.issues
        : (normalized?.errors || []).map((e) => ({
          severity: 'error',
          type: 'solver_error',
          message: typeof e === 'string' ? e : (e.message || String(e)),
        })));
    const merged = [...precheckIssues, ...fromResult];
    const seen = new Set();
    return merged.filter((i) => {
      const key = `${i.type}|${i.class_name || ''}|${i.subject || ''}|${i.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [normalized, precheckIssues]);

  const classRows = useMemo(
    () => buildClassRows(normalized, classes, teachers),
    [normalized, classes, teachers],
  );

  if (loading) {
    return (
      <div style={{ fontSize: 13, color: 'var(--mid)' }}>
        <Loader size={14} className="spinner" style={{ verticalAlign: 'middle', marginRight: 8 }} />
        Solving… (a few seconds)
      </div>
    );
  }

  if (!normalized && !precheckIssues.length) return null;

  if (!normalized && precheckIssues.length > 0 && precheckIssues.every((i) => i.severity !== 'error')) {
    return (
      <div>
        <div className="alert alert-green" style={{ marginBottom: 0 }}>
          <CheckCircle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          Curriculum and coverage OK.
        </div>
        <IssuesList issues={precheckIssues} navigate={navigate} />
      </div>
    );
  }

  if (!normalized && precheckIssues.length === 0) {
    return (
      <div className="alert alert-green" style={{ marginBottom: 0 }}>
        <CheckCircle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        Curriculum and coverage OK.
      </div>
    );
  }

  const success = normalized?.success;
  const filled = normalized?.filled ?? 0;
  const total = normalized?.total ?? 0;

  return (
    <div style={{ marginTop: normalized || precheckIssues.length ? 12 : 0 }}>
      <div>
        {success ? (
          <div className="alert alert-green" style={{ marginBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle size={14} />
              <span>
                Complete — {filled}/{total} periods {(mode === 'full' || mode === 'schedule') ? 'placed' : 'allocated'}.
                {normalized.applied && ' Applied to database.'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
              {genAt && <span style={{ opacity: 0.85 }}>{new Date(genAt).toLocaleTimeString('en-IN')}</span>}
              {normalized.elapsed_ms != null && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={10} /> {normalized.elapsed_ms}ms
                </span>
              )}
            </div>
          </div>
        ) : normalized ? (
          <div className="alert alert-red" style={{ marginBottom: 0 }}>
            <AlertCircle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            {normalized.message || 'Solver failed.'}
          </div>
        ) : precheckIssues.some((i) => i.severity === 'error') ? (
          <div className="alert alert-red" style={{ marginBottom: 0 }}>
            <AlertCircle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Fix data issues before running.
          </div>
        ) : null}

        <IssuesList issues={issues} navigate={navigate} />

        {success && (
          <>
            <AllocationSummaryTable rows={classRows} mode={mode} />
            {mode === 'allocate' && <TargetChangesSection changes={normalized.targetChanges} />}
            {children}
          </>
        )}
      </div>
    </div>
  );
}

export { buildClassRows, PERIODS_PER_CLASS };
