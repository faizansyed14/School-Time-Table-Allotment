import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAllocatorRun } from '../lib/allocatorRun.jsx';
import { Play, Check, AlertCircle, Loader, ArrowRight, RefreshCw, CheckCircle, BarChart2, ChevronDown, ChevronUp } from 'lucide-react';
import AllotmentSummaryPanel from '../components/AllotmentSummaryPanel.jsx';

export default function Allotment() {
  const {
    isRunning,
    progress,
    secondsRemaining,
    timeLimitSeconds,
    startRun,
    requestCancel,
    lastRun: ctxLastRun,
    phase,
  } = useAllocatorRun();

  const [rules, setRules]       = useState({ R1: true, R2: true });
  const [lastRun, setLastRun]   = useState(null);
  const [genAt, setGenAt]       = useState(null);
  const [applying, setApplying] = useState(false);
  const [validation, setValidation] = useState(null);
  const [allotment, setAllotment] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [solverSeconds, setSolverSeconds] = useState(
    () => Number(import.meta.env.VITE_ALLOTMENT_TIME_SEC) || (import.meta.env.PROD ? 120 : 90),
  );
  const navigate = useNavigate();

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const summary = await api.get('/teachers/allotment-summary');
      setAllotment(summary);
      return summary;
    } catch (e) {
      console.error(e);
      return null;
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const loadState = useCallback(async () => {
    const [result, val, summary] = await Promise.all([
      api.get('/allocate/result').catch(() => null),
      api.get('/allocations/validate').catch(() => null),
      api.get('/teachers/allotment-summary').catch(() => null),
    ]);
    if (result) { setRules(result.rules || { R1: true, R2: true }); setLastRun(result.lastRun); setGenAt(result.generated_at); }
    setValidation(val);
    setAllotment(summary);
    return summary;
  }, []);

  useEffect(() => { loadState(); }, [loadState]);

  useEffect(() => {
    if (phase === 'done' || phase === 'error') setLastRun(ctxLastRun);
    if (phase === 'cancelled') setLastRun(null);
  }, [phase, ctxLastRun]);

  useEffect(() => {
    if (phase === 'done' && ctxLastRun?.success) {
      setShowSummary(true);
      loadSummary();
    }
  }, [phase, ctxLastRun?.success, loadSummary]);

  async function toggleRule(key) {
    const next = { ...rules, [key]: !rules[key] };
    setRules(next);
    await api.patch('/allocate/rules', { rules: next }).catch(console.error);
  }

  async function clearLastResult() {
    try {
      await api.delete('/allocate/result');
      setLastRun(null);
      setGenAt(null);
      await loadState();
    } catch (e) {
      alert(e.message);
    }
  }

  async function runSolver() {
    setLastRun(null);
    const result = await startRun({ timeLimitSeconds: solverSeconds });
    if (result) {
      setLastRun(result);
      if (result.success) {
        setShowSummary(true);
        await loadSummary();
      }
    }
    await loadState();
  }

  async function applyTimetable() {
    setApplying(true);
    try {
      const r = await api.post('/allocate/apply');
      await loadState();
      setShowSummary(true);
      alert(`Timetable applied: ${r.slots_inserted} slots inserted.`);
      navigate('/timetable');
    } catch (e) { alert(e.message); }
    finally { setApplying(false); }
  }

  async function toggleSummary() {
    const next = !showSummary;
    setShowSummary(next);
    if (next && !allotment) await loadSummary();
  }

  const criticalIssues = (allotment?.issues || validation?.issues || []).filter((i) => i.severity === 'error');
  const canRun = criticalIssues.length === 0 && !isRunning;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Allotment</h2>
          <p>Configure rules and run the CP-SAT timetable solver.</p>
        </div>
        <button type="button" className="btn btn-outline" onClick={toggleSummary}>
          <BarChart2 size={14} />
          {showSummary ? 'Hide allotment summary' : 'View allotment summary'}
          {showSummary ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {!showSummary && lastRun?.success && (
        <div className="alert alert-green" style={{ marginBottom: 16, fontSize: 13 }}>
          <CheckCircle size={14} />
          Run complete — {lastRun.filled}/{lastRun.total} slots.
          <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 10 }} onClick={() => { setShowSummary(true); loadSummary(); }}>
            View allotment summary
          </button>
        </div>
      )}

      {showSummary && (
        <AllotmentSummaryPanel
          allotment={allotment}
          navigate={navigate}
          onRefresh={() => loadSummary()}
          loading={summaryLoading}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Validation status */}
        <div className="card">
          <div className="card-header">
            <span style={{ fontWeight: 600, fontSize: 14 }}>Data Status</span>
            <button className="btn btn-ghost btn-sm" onClick={loadState}><RefreshCw size={12} /></button>
          </div>
          <div className="card-body">
            {!validation ? (
              <div style={{ color: 'var(--mid)', fontSize: 13 }}>Checking…</div>
            ) : validation.ok ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--green)', fontWeight: 600, fontSize: 14 }}>
                <CheckCircle size={18} /> All allocations valid
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--red)', fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
                  <AlertCircle size={18} /> {criticalIssues.length} issue{criticalIssues.length !== 1 ? 's' : ''} to fix
                </div>
                {criticalIssues.slice(0, 5).map((issue, i) => (
                  <div key={i} className="issue-card error" style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 500 }}>{issue.message}</span>
                    {issue.actions?.length > 0 && (
                      <div className="issue-actions" style={{ marginTop: 6 }}>
                        {issue.actions.map((act, j) => (
                          <a key={j} href="#" className="issue-action-btn"
                             style={{ color: 'var(--red)', borderColor: '#fca5a5', fontSize: 11 }}
                             onClick={(e) => { e.preventDefault(); if (act.link) navigate(act.link); }}>
                            {act.page} → {act.label}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <button className="btn btn-outline btn-sm" style={{ marginTop: 6 }} onClick={() => navigate('/allocations')}>
                  Fix in Allocations <ArrowRight size={12} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Rules */}
        <div className="card">
          <div className="card-header"><span style={{ fontWeight: 600, fontSize: 14 }}>Timetable Rules</span></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <RuleRow
              label="R1 — Class Teacher at Period 1"
              hint="Class teacher must teach the first period of the day in their class."
              on={rules.R1}
              onToggle={() => toggleRule('R1')}
            />
            <RuleRow
              label="R2 — Diary at Period 8 (Classes 1–2)"
              hint="Last period of the day must be Diary for Classes 1A, 1B, 2A, 2B."
              on={rules.R2}
              onToggle={() => toggleRule('R2')}
            />
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, fontSize: 12, color: 'var(--mid)' }}>
              <div>R5 — Max 2 same subject per day: <b style={{ color: 'var(--dark)' }}>Always on</b></div>
              <div>R6 — Games not in last period: <b style={{ color: 'var(--dark)' }}>Always on</b></div>
            </div>
          </div>
        </div>
      </div>

      {/* Run section */}
      <div className="card">
        <div className="card-header"><span style={{ fontWeight: 600, fontSize: 14 }}>Run Allocator</span></div>
        <div className="card-body">
          {!canRun && criticalIssues.length > 0 && (
            <div className="alert alert-red" style={{ marginBottom: 14 }}>
              <AlertCircle size={13} /> Fix the {criticalIssues.length} critical issue{criticalIssues.length !== 1 ? 's' : ''} above before running.
            </div>
          )}

          {isRunning && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--mid)', marginBottom: 6 }}>
                <span>Solver running… ~{secondsRemaining}s remaining</span>
                <span>{progress}%</span>
              </div>
              <div className="progress-bar-wrap">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${progress}%`, background: 'var(--blue)', transition: 'width 0.25s ease' }}
                />
              </div>
              <p style={{ fontSize: 11, color: 'var(--mid)', marginTop: 6 }}>
                Up to {timeLimitSeconds}s (queue classes, then optimize — same quality as before). You can switch pages.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: 'var(--mid)', display: 'flex', alignItems: 'center', gap: 8 }}>
              Time limit
              <select
                className="form-input"
                style={{ width: 'auto', padding: '4px 8px' }}
                value={solverSeconds}
                disabled={isRunning}
                onChange={(e) => setSolverSeconds(Number(e.target.value))}
              >
                <option value={90}>90 sec</option>
                <option value={120}>120 sec (recommended on Render)</option>
                <option value={180}>180 sec</option>
                <option value={300}>300 sec (Render)</option>
              </select>
            </label>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: lastRun ? 16 : 0, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={runSolver} disabled={!canRun || isRunning} style={{ minWidth: 180 }}>
              {isRunning
                ? <><Loader size={13} className="spinner" /> Running…</>
                : <><Play size={13} /> Run Allocator</>}
            </button>
            {isRunning && (
              <button type="button" className="btn btn-outline" onClick={requestCancel}>
                Cancel run
              </button>
            )}
          </div>

          {/* Result */}
          {lastRun && (
            <div style={{ marginTop: 16 }}>
              {lastRun.success ? (
                <div>
                  <div className="alert alert-green" style={{ marginBottom: 14 }}>
                    <CheckCircle size={13} />
                    <b>FEASIBLE — {lastRun.filled}/{lastRun.total} slots filled</b>
                    {genAt && <span style={{ marginLeft: 8, fontSize: 11 }}>at {new Date(genAt).toLocaleTimeString('en-IN')}</span>}
                  </div>
                  {lastRun.preflight_issues?.warn?.length > 0 && (
                    <div className="alert alert-amber" style={{ marginBottom: 14 }}>
                      <AlertCircle size={13} />
                      <div>
                        {lastRun.preflight_issues.warn.length} warning(s):
                        <ul style={{ margin: '4px 0 0 16px', fontSize: 12 }}>
                          {lastRun.preflight_issues.warn.map((w, i) => <li key={i}>{w.reason}</li>)}
                        </ul>
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-outline" onClick={() => { setShowSummary(true); loadSummary(); }}>
                      <BarChart2 size={13} /> View allotment summary
                    </button>
                    <button type="button" className="btn btn-primary" onClick={applyTimetable} disabled={applying}>
                      {applying ? <><Loader size={13} className="spinner" /> Applying…</> : <><Check size={13} /> Apply to Timetable</>}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="alert alert-red" style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                    <span>
                      <AlertCircle size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                      <b>{lastRun.solver_status_name || 'Failed'}</b>
                      <span style={{ display: 'block', fontSize: 11, fontWeight: 400, marginTop: 4, opacity: 0.9 }}>
                        Stored from a previous run. Clear it, then run again with 120–180s.
                      </span>
                    </span>
                    <button type="button" className="btn btn-outline btn-sm" onClick={clearLastResult} disabled={isRunning}>
                      Clear result
                    </button>
                  </div>
                  {lastRun.message && (
                    <pre style={{ fontSize: 12, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 12, whiteSpace: 'pre-wrap', fontFamily: 'inherit', color: 'var(--dark)' }}>
                      {lastRun.message}
                    </pre>
                  )}
                  {lastRun.preflight_issues?.fatal?.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      {lastRun.preflight_issues.fatal.map((f, i) => (
                        <div key={i} className="issue-card error" style={{ marginBottom: 6 }}>
                          <span style={{ fontSize: 12 }}>{f.reason}</span>
                          {f.actions?.length > 0 && (
                            <div className="issue-actions" style={{ marginTop: 6 }}>
                              {f.actions.map((act, j) => {
                                const link = act.link || (act.page === 'Teachers' ? '/teachers' : act.page === 'Allocations' ? '/allocations' : null);
                                return (
                                <a key={j} href="#" className="issue-action-btn"
                                   style={{ color: 'var(--red)', borderColor: '#fca5a5', fontSize: 11 }}
                                   onClick={(e) => { e.preventDefault(); if (link) navigate(link); }}>
                                  {act.page} → {act.action}
                                </a>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RuleRow({ label, hint, on, onToggle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--mid)', marginTop: 2 }}>{hint}</div>
      </div>
      <label className="toggle" style={{ flexShrink: 0, marginTop: 2 }}>
        <input type="checkbox" checked={on} onChange={onToggle} />
        <div className="toggle-track" />
        <div className="toggle-thumb" />
      </label>
    </div>
  );
}
