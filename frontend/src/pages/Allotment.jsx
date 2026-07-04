import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import {
  Check, Loader, RefreshCw, BarChart2, Zap, Sparkles,
  CheckCircle, AlertCircle, Calendar, Trash2, ListChecks,
} from 'lucide-react';
import AllotmentSummaryPanel from '../components/AllotmentSummaryPanel.jsx';
import ResultPanel from '../components/ResultPanel.jsx';
import Modal from '../components/Modal.jsx';
import LoadingOverlay from '../components/LoadingOverlay.jsx';

export default function Allotment() {
  const [lastRun, setLastRun] = useState(null);
  const [genAt, setGenAt] = useState(null);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [validation, setValidation] = useState(null);
  const [allotment, setAllotment] = useState(null);
  const [classes, setClasses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [runMode, setRunMode] = useState('auto');
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
    const [result, val, summary, cls, tch, subj] = await Promise.all([
      api.get('/allocate/result').catch(() => null),
      api.get('/allocations/validate').catch(() => null),
      api.get('/teachers/allotment-summary').catch(() => null),
      api.get('/timetable/classes').catch(() => []),
      api.get('/teachers').catch(() => []),
      api.get('/subjects').catch(() => []),
    ]);
    if (result) { setLastRun(result.lastRun); setGenAt(result.generated_at); }
    setValidation(val);
    setAllotment(summary);
    setClasses(cls || []);
    setTeachers(tch || []);
    setSubjects(subj || []);
    return summary;
  }, []);

  useEffect(() => { loadState(); }, [loadState]);

  async function clearLastResult() {
    if (!window.confirm('Clear the last run preview?')) return;
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
    setRunMode('schedule');
    setRunning(true);
    setLastRun(null);
    try {
      const result = await api.post('/allocate/run');
      setLastRun(result);
      if (result.success) await loadSummary();
      await loadState();
    } catch (e) {
      setLastRun({ success: false, message: e.message, errors: [{ message: e.message }] });
    } finally {
      setRunning(false);
    }
  }

  async function autoAllot() {
    setRunMode('auto');
    setRunning(true);
    setLastRun(null);
    try {
      const result = await api.post('/allocate/auto');
      setLastRun(result);
      if (result.success) await loadSummary();
      await loadState();
    } catch (e) {
      setLastRun({ success: false, message: e.message, errors: [{ message: e.message }] });
    } finally {
      setRunning(false);
    }
  }

  async function applyTimetable() {
    setApplying(true);
    try {
      const r = await api.post('/allocate/apply');
      await loadState();
      setLastRun((prev) => (prev ? { ...prev, applied: true, slots_inserted: r.slots_inserted } : prev));
      navigate('/timetable');
    } catch (e) { alert(e.message); }
    finally { setApplying(false); }
  }

  async function openSummary() {
    setShowSummary(true);
    if (!allotment) await loadSummary();
  }

  const precheckIssues = validation?.issues || [];
  const precheckErrors = precheckIssues.filter((i) => i.severity === 'error');
  const precheckWarnings = precheckIssues.filter((i) => i.severity === 'warning');
  const canSchedule = precheckErrors.length === 0 && !running;
  const canAuto = precheckErrors.length === 0 && !running;

  const lastSuccess = lastRun?.success;
  const alreadyApplied = lastRun?.applied;

  return (
    <div className="allotment-page">
      <div className="page-header">
        <div>
          <h2>Allotment</h2>
          <p>Build the weekly timetable from your data — one click or step-by-step.</p>
        </div>
      </div>

      <LoadingOverlay
        open={running}
        title={runMode === 'auto' ? 'Running auto allotment…' : 'Scheduling timetable…'}
        message="The solver is placing periods under all rules. This can take up to a minute."
      />

      <Modal
        open={showSummary}
        onClose={() => setShowSummary(false)}
        title="Allotment summary"
        size="xl"
        footer={(
          <>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => loadSummary()} disabled={summaryLoading}>
              <RefreshCw size={13} className={summaryLoading ? 'spinner' : ''} /> Refresh
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowSummary(false)}>Close</button>
          </>
        )}
      >
        <AllotmentSummaryPanel
          allotment={allotment}
          onRefresh={() => loadSummary()}
          loading={summaryLoading}
        />
      </Modal>

      {/* Status strip */}
      <div className="allotment-status-bar">
        {!validation ? (
          <span className="allotment-status-pill neutral"><Loader size={12} className="spinner" /> Checking data…</span>
        ) : precheckErrors.length > 0 ? (
          <span className="allotment-status-pill err">
            <AlertCircle size={13} /> {precheckErrors.length} blocking issue{precheckErrors.length !== 1 ? 's' : ''}
          </span>
        ) : (
          <span className="allotment-status-pill ok">
            <CheckCircle size={13} /> Data ready
          </span>
        )}
        {precheckWarnings.length > 0 && (
          <span className="allotment-status-pill warn">
            <AlertCircle size={13} /> {precheckWarnings.length} warning{precheckWarnings.length !== 1 ? 's' : ''}
          </span>
        )}
        {lastSuccess && (
          <span className="allotment-status-pill ok">
            <CheckCircle size={13} />
            Last run: {lastRun.filled}/{lastRun.total} placed
            {alreadyApplied ? ' · applied' : ' · preview'}
          </span>
        )}
      </div>

      <div className="allotment-layout">
        {/* Main column */}
        <div className="allotment-main">
          {/* Action cards */}
          <div className="allotment-actions">
            <div className="allotment-action-card recommended">
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div className="action-icon"><Sparkles size={18} /></div>
                <div>
                  <h3>Auto Allotment</h3>
                  <p>
                    Generates allocations, schedules the grid, and saves the timetable — all in one step.
                    Best for a fresh start.
                  </p>
                </div>
              </div>
              <button type="button" className="btn btn-primary" onClick={autoAllot} disabled={!canAuto || running}>
                {running && runMode === 'auto'
                  ? <><Loader size={13} className="spinner" /> Working…</>
                  : <><Sparkles size={13} /> Run Auto Allotment</>}
              </button>
            </div>

            <div className="allotment-action-card manual">
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div className="action-icon"><Zap size={18} /></div>
                <div>
                  <h3>Schedule saved plan</h3>
                  <p>
                    Uses allocations from the{' '}
                    <Link to="/allocations" style={{ color: 'var(--primary)', fontWeight: 600 }}>Allocations</Link>
                    {' '}page. Preview first, then apply when ready.
                  </p>
                </div>
              </div>
              <button type="button" className="btn btn-outline" onClick={runSolver} disabled={!canSchedule || running}>
                {running && runMode === 'schedule'
                  ? <><Loader size={13} className="spinner" /> Scheduling…</>
                  : <><Zap size={13} /> Schedule &amp; preview</>}
              </button>
            </div>
          </div>

          {precheckErrors.length > 0 && (
            <div className="alert alert-red" style={{ margin: 0 }}>
              <AlertCircle size={14} />
              Fix blocking issues in the sidebar before running.
            </div>
          )}

          {/* Results */}
          <div className="card">
            <div className="card-header">
              <span style={{ fontWeight: 600, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ListChecks size={14} /> Result
              </span>
              {lastRun && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearLastResult} style={{ color: 'var(--red)' }}>
                  <Trash2 size={12} /> Clear
                </button>
              )}
            </div>
            <div className="card-body">
              {!lastRun && !running && (
                <p style={{ fontSize: 13, color: 'var(--mid)', margin: 0 }}>
                  No run yet. Choose an option above to generate or schedule a timetable.
                </p>
              )}

              <ResultPanel
                result={lastRun}
                mode="schedule"
                loading={running}
                precheckIssues={[]}
                classes={classes}
                teachers={teachers}
                subjects={subjects}
                genAt={genAt}
              />

              {lastSuccess && (
                <div className="allotment-result-bar">
                  {alreadyApplied ? (
                    <>
                      <button type="button" className="btn btn-primary" onClick={() => navigate('/timetable')}>
                        <Calendar size={13} /> Open Timetable
                      </button>
                      <button type="button" className="btn btn-outline" onClick={openSummary}>
                        <BarChart2 size={13} /> Teacher summary
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn btn-primary" onClick={applyTimetable} disabled={applying}>
                        {applying
                          ? <><Loader size={13} className="spinner" /> Applying…</>
                          : <><Check size={13} /> Apply to Timetable</>}
                      </button>
                      <button type="button" className="btn btn-outline" onClick={openSummary}>
                        <BarChart2 size={13} /> Preview summary
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="allotment-sidebar">
          <div className="card">
            <div className="card-header">
              <span style={{ fontWeight: 600, fontSize: 14 }}>Data check</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={loadState} title="Refresh">
                <RefreshCw size={12} />
              </button>
            </div>
            <div className="card-body" style={{ paddingTop: 8 }}>
              {!validation ? (
                <p style={{ fontSize: 13, color: 'var(--mid)', margin: 0 }}>Checking…</p>
              ) : (
                <ResultPanel precheckIssues={precheckIssues} mode="schedule" />
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-body allotment-rules">
              <details open>
                <summary>Timetable rules (R1–R5)</summary>
                <ul>
                  <li><strong>R1</strong> — Class teacher at Period 1 in their class</li>
                  <li><strong>R2</strong> — Diary last period (Classes 1–2)</li>
                  <li><strong>R3</strong> — No teacher double-booked</li>
                  <li><strong>R4</strong> — Teacher &quot;starts from&quot; period</li>
                  <li><strong>R5</strong> — Max 2 same-subject periods per day</li>
                </ul>
              </details>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
