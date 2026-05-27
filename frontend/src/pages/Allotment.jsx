import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Play, Check, AlertCircle, Loader, ArrowRight, RefreshCw, CheckCircle, BarChart2, ChevronDown, ChevronUp, Zap, Clock } from 'lucide-react';
import AllotmentSummaryPanel from '../components/AllotmentSummaryPanel.jsx';

export default function Allotment() {
  const [rules, setRules] = useState({ R1: true, R2: true });
  const [lastRun, setLastRun] = useState(null);
  const [genAt, setGenAt] = useState(null);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [validation, setValidation] = useState(null);
  const [allotment, setAllotment] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
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
    setRunning(true);
    setLastRun(null);
    try {
      const result = await api.post('/allocate/run');
      setLastRun(result);
      if (result.success) {
        setShowSummary(true);
        await loadSummary();
      }
      await loadState();
    } catch (e) {
      alert(`Engine error: ${e.message}`);
    } finally {
      setRunning(false);
    }
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

  // Only block the button for REAL data errors (curriculum, capacity etc.)
  // Don't block it for 'timetable_solver_failed' - those are just records of the last failure.
  const dataErrors = criticalIssues.filter(i => 
    !['timetable_solver_failed', 'timetable_partial', 'class_timetable_short', 'timetable_preflight_fatal'].includes(i.type)
  );
  
  const canRun = dataErrors.length === 0 && !running;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Allotment</h2>
          <p>Generate the complete school timetable using the built-in engine.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {lastRun && (
            <button type="button" className="btn btn-outline" onClick={clearLastResult} style={{ color: 'var(--red)' }}>
              <RefreshCw size={14} /> Clear Result
            </button>
          )}
          <button type="button" className="btn btn-outline" onClick={toggleSummary}>
            <BarChart2 size={14} />
            {showSummary ? 'Hide summary' : 'View summary'}
          </button>
        </div>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: criticalIssues.length === dataErrors.length ? 'var(--red)' : 'var(--orange)', fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
                  <AlertCircle size={18} /> {criticalIssues.length} issue{criticalIssues.length !== 1 ? 's' : ''} detected
                </div>
                {/* Show only first 5 errors */}
                {criticalIssues.slice(0, 5).map((issue, i) => {
                  const isResultError = ['timetable_solver_failed', 'timetable_partial', 'class_timetable_short', 'timetable_preflight_fatal'].includes(issue.type);
                  return (
                    <div key={i} className={`issue-card ${isResultError ? 'warning' : 'error'}`} style={{ marginBottom: 6, opacity: isResultError ? 0.8 : 1 }}>
                      <span style={{ fontSize: 12, fontWeight: 500 }}>{issue.message}</span>
                      {issue.actions?.length > 0 && (
                        <div className="issue-actions" style={{ marginTop: 6 }}>
                          {issue.actions.map((act, j) => (
                            <a key={j} href="#" className="issue-action-btn"
                              style={{ fontSize: 11 }}
                              onClick={(e) => { e.preventDefault(); if (act.link) navigate(act.link); }}>
                              {act.page} → {act.label}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Rules (always-on info) */}
        <div className="card">
          <div className="card-header"><span style={{ fontWeight: 600, fontSize: 14 }}>Timetable Rules (Always Active)</span></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <RuleInfo label="R1 — Class Teacher at Period 1" hint="Class teacher teaches the first period of the day in their class, every day." />
            <RuleInfo label="R2 — Diary at Period 8 (Classes 1–2)" hint="Last period = Diary for Classes 1A, 1B, 2A, 2B." />
            <RuleInfo label="R3 — No Teacher Conflicts" hint="A teacher can only be in one class at any given day+period." />
            <RuleInfo label="R4 — Teacher Period Restriction" hint="Each teacher's 'Starts from' setting is respected (set in Teacher page)." />
          </div>
        </div>
      </div>

      {/* Run section */}
      <div className="card">
        <div className="card-header"><span style={{ fontWeight: 600, fontSize: 14 }}>Run Allocator</span></div>
        <div className="card-body">
          {dataErrors.length > 0 ? (
            <div className="alert alert-red" style={{ marginBottom: 14 }}>
              <AlertCircle size={13} /> Fix the {dataErrors.length} critical data errors above to enable generation.
            </div>
          ) : criticalIssues.length > 0 && (
            <div className="alert alert-orange" style={{ marginBottom: 14, fontSize: 13 }}>
              Note: Issues from the previous run are shown above. You can try generating again with different rules or data.
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: lastRun ? 16 : 0, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={runSolver} disabled={!canRun || running} style={{ minWidth: 200 }}>
              {running
                ? <><Loader size={13} className="spinner" /> Generating…</>
                : <><Zap size={13} /> Generate Timetable</>}
            </button>
          </div>

          {running && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--mid)' }}>
              <Loader size={12} className="spinner" style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Engine is running… this takes about 2-5 seconds.
            </div>
          )}

          {/* Result */}
          {lastRun && (
            <div style={{ marginTop: 16 }}>
              {lastRun.success ? (
                <div>
                  <div className="alert alert-green" style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <CheckCircle size={13} />
                      <b>COMPLETE — {lastRun.filled}/{lastRun.total} slots filled</b>
                      {genAt && <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.8 }}>at {new Date(genAt).toLocaleTimeString('en-IN')}</span>}
                    </div>
                    {lastRun.elapsed_ms != null && (
                      <div style={{
                        background: 'rgba(52, 211, 153, 0.2)',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#065f46',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}>
                        <Clock size={10} />
                        {lastRun.elapsed_ms}ms
                      </div>
                    )}
                  </div>

                  {lastRun.warnings?.length > 0 && (
                    <div className="alert alert-amber" style={{ marginBottom: 14 }}>
                      <AlertCircle size={13} />
                      <div>
                        {lastRun.warnings.length} warning(s):
                        <ul style={{ margin: '4px 0 0 16px', fontSize: 12 }}>
                          {lastRun.warnings.slice(0, 10).map((w, i) => <li key={i}>{w.message || w.reason}</li>)}
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
                      <b>{lastRun.solver_status_name || 'Failed'} — {lastRun.filled}/{lastRun.total} slots</b>
                    </span>
                    <button type="button" className="btn btn-outline btn-sm" onClick={clearLastResult} disabled={running}>
                      Clear result
                    </button>
                  </div>
                  {lastRun.message && (
                    <pre style={{ fontSize: 12, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 12, whiteSpace: 'pre-wrap', fontFamily: 'inherit', color: 'var(--dark)' }}>
                      {lastRun.message}
                    </pre>
                  )}
                  {lastRun.errors?.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Issues found:</div>
                      {lastRun.errors.map((e, i) => (
                        <div key={i} className="issue-card error" style={{ marginBottom: 6 }}>
                          <span style={{ fontSize: 12 }}>{e.message}</span>
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

function RuleInfo({ label, hint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <CheckCircle size={14} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 2 }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--mid)', marginTop: 2 }}>{hint}</div>
      </div>
    </div>
  );
}
