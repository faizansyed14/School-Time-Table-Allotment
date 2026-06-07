import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Check, Loader, RefreshCw, BarChart2, Zap } from 'lucide-react';
import AllotmentSummaryPanel from '../components/AllotmentSummaryPanel.jsx';
import ResultPanel from '../components/ResultPanel.jsx';

export default function Allotment() {
  const [lastRun, setLastRun] = useState(null);
  const [genAt, setGenAt] = useState(null);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [validation, setValidation] = useState(null);
  const [allotment, setAllotment] = useState(null);
  const [classes, setClasses] = useState([]);
  const [teachers, setTeachers] = useState([]);
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
    const [result, val, summary, cls, tch] = await Promise.all([
      api.get('/allocate/result').catch(() => null),
      api.get('/allocations/validate').catch(() => null),
      api.get('/teachers/allotment-summary').catch(() => null),
      api.get('/timetable/classes').catch(() => []),
      api.get('/teachers').catch(() => []),
    ]);
    if (result) { setLastRun(result.lastRun); setGenAt(result.generated_at); }
    setValidation(val);
    setAllotment(summary);
    setClasses(cls || []);
    setTeachers(tch || []);
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

  const precheckIssues = validation?.issues || [];
  const precheckErrors = precheckIssues.filter((i) => i.severity === 'error');
  const canRun = precheckErrors.length === 0 && !running;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Allotment</h2>
          <p>Schedule saved allocations into the weekly grid (Phase B — R1–R5). Generate or edit the plan on Allocations first.</p>
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

      {showSummary && (
        <AllotmentSummaryPanel
          allotment={allotment}
          onRefresh={() => loadSummary()}
          loading={summaryLoading}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header">
            <span style={{ fontWeight: 600, fontSize: 14 }}>Data pre-check</span>
            <button className="btn btn-ghost btn-sm" onClick={loadState}><RefreshCw size={12} /></button>
          </div>
          <div className="card-body" style={{ paddingTop: 8 }}>
            {!validation ? (
              <p style={{ fontSize: 13, color: 'var(--mid)' }}>Checking…</p>
            ) : (
              <ResultPanel precheckIssues={precheckIssues} mode="schedule" />
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span style={{ fontWeight: 600, fontSize: 14 }}>Timetable Rules (Always Active)</span></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <RuleInfo label="R1 — Class Teacher at Period 1" hint="Class teacher teaches P1 in their class, every day." />
            <RuleInfo label="R2 — Diary at Period 8 (Classes 1–2)" hint="Last period = Diary for Classes 1A, 1B, 2A, 2B." />
            <RuleInfo label="R3 — No Teacher Conflicts" hint="One teacher, one class per slot." />
            <RuleInfo label="R4 — Teacher Period Restriction" hint="Respects each teacher's 'Starts from' setting." />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span style={{ fontWeight: 600, fontSize: 14 }}>Schedule Timetable</span></div>
        <div className="card-body">
          {precheckErrors.length > 0 && (
            <p style={{ fontSize: 13, color: 'var(--red)', marginBottom: 12 }}>
              Fix {precheckErrors.length} issue{precheckErrors.length !== 1 ? 's' : ''} above (curriculum, coverage, or saved allocations) before scheduling.
            </p>
          )}

          <button className="btn btn-primary" onClick={runSolver} disabled={!canRun || running} style={{ minWidth: 200 }}>
            {running
              ? <><Loader size={13} className="spinner" /> Scheduling…</>
              : <><Zap size={13} /> Schedule Timetable</>}
          </button>

          <ResultPanel
            result={lastRun}
            mode="schedule"
            loading={running}
            precheckIssues={[]}
            classes={classes}
            teachers={teachers}
            genAt={genAt}
          >
            {lastRun?.success && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
                <button type="button" className="btn btn-outline" onClick={() => { setShowSummary(true); loadSummary(); }}>
                  <BarChart2 size={13} /> Teacher summary
                </button>
                <button type="button" className="btn btn-primary" onClick={applyTimetable} disabled={applying}>
                  {applying ? <><Loader size={13} className="spinner" /> Applying…</> : <><Check size={13} /> Apply to Timetable</>}
                </button>
              </div>
            )}
          </ResultPanel>
        </div>
      </div>
    </div>
  );
}

function RuleInfo({ label, hint }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--mid)', marginTop: 2 }}>{hint}</div>
    </div>
  );
}
