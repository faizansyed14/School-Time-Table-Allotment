import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, getToken } from './api.js';

const AllocatorRunContext = createContext(null);

function elapsedProgress(startedAt, limitSec) {
  const elapsed = (Date.now() - startedAt) / 1000;
  return Math.min(99, Math.round((elapsed / limitSec) * 100));
}

function secondsLeft(startedAt, limitSec) {
  const left = limitSec - (Date.now() - startedAt) / 1000;
  return Math.max(0, Math.ceil(left));
}

export function AllocatorRunProvider({ children }) {
  const [phase, setPhase] = useState('idle'); // idle | running | done | cancelled | error
  const [startedAt, setStartedAt] = useState(null);
  const [timeLimitSeconds, setTimeLimitSeconds] = useState(90);
  const [progress, setProgress] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(90);
  const [lastRun, setLastRun] = useState(null);
  const [error, setError] = useState(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const abortRef = useRef(null);
  const pollRef = useRef(null);

  const isRunning = phase === 'running';

  const tickProgress = useCallback(() => {
    if (!startedAt) return;
    setProgress(elapsedProgress(startedAt, timeLimitSeconds));
    setSecondsRemaining(secondsLeft(startedAt, timeLimitSeconds));
  }, [startedAt, timeLimitSeconds]);

  useEffect(() => {
    if (!isRunning || !startedAt) return;
    tickProgress();
    const id = setInterval(tickProgress, 250);
    return () => clearInterval(id);
  }, [isRunning, startedAt, timeLimitSeconds, tickProgress]);

  const finishFromResult = useCallback((result, err, cancelled) => {
    if (cancelled) {
      setPhase('cancelled');
      setError('Allocation cancelled');
      setLastRun(null);
    } else if (err) {
      setPhase('error');
      setError(err);
      setLastRun(result?.success === false ? result : null);
    } else {
      setPhase('done');
      setError(null);
      setLastRun(result);
      setProgress(100);
    }
    abortRef.current = null;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const syncServerRunning = useCallback(async () => {
    try {
      const st = await api.get('/allocate/status');
      if (!st.running) return false;
      const start = st.startedAt || Date.now() - (st.elapsedMs || 0);
      const limit = st.timeLimitSeconds || 90;
      setPhase('running');
      setStartedAt(start);
      setTimeLimitSeconds(limit);
      setLastRun(null);
      setError(null);
      if (!pollRef.current) {
        pollRef.current = setInterval(async () => {
          const s = await api.get('/allocate/status').catch(() => ({ running: false }));
          if (!s.running) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            const data = await api.get('/allocate/result').catch(() => null);
            const run = data?.lastRun;
            if (run) finishFromResult(run, run.success ? null : run.error || 'Run failed', false);
            else finishFromResult(null, null, false);
          }
        }, 2000);
      }
      return true;
    } catch {
      return false;
    }
  }, [finishFromResult]);

  useEffect(() => {
    if (phase === 'idle') syncServerRunning();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startRun = useCallback(async (opts = {}) => {
    if (phase === 'running') return null;
    const limit = opts.timeLimitSeconds ?? 90;
    const ac = new AbortController();
    abortRef.current = ac;
    const start = Date.now();
    setPhase('running');
    setStartedAt(start);
    setTimeLimitSeconds(limit);
    setProgress(0);
    setSecondsRemaining(limit);
    setLastRun(null);
    setError(null);
    setShowCancelConfirm(false);

    try {
      const res = await fetch('/api/allocate/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ timeLimitSeconds: limit }),
        signal: ac.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) throw new Error(data.error || 'Allocator already running');
      if (res.status === 499 || data.cancelled) {
        finishFromResult(null, null, true);
        return null;
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      finishFromResult(data, null, false);
      return data;
    } catch (e) {
      if (e.name === 'AbortError') {
        await api.post('/allocate/cancel').catch(() => {});
        finishFromResult(null, null, true);
        return null;
      }
      finishFromResult(null, e.message, false);
      return null;
    }
  }, [phase, finishFromResult]);

  const requestCancel = useCallback(() => {
    if (phase === 'running') setShowCancelConfirm(true);
  }, [phase]);

  const dismissCancelConfirm = useCallback(() => setShowCancelConfirm(false), []);

  const confirmCancel = useCallback(async () => {
    setShowCancelConfirm(false);
    abortRef.current?.abort();
    await api.post('/allocate/cancel').catch(() => {});
    finishFromResult(null, null, true);
  }, [finishFromResult]);

  const clearRunState = useCallback(() => {
    setPhase('idle');
    setLastRun(null);
    setError(null);
    setProgress(0);
  }, []);

  const value = {
    phase,
    isRunning,
    progress,
    secondsRemaining,
    timeLimitSeconds,
    lastRun,
    error,
    showCancelConfirm,
    startRun,
    requestCancel,
    dismissCancelConfirm,
    confirmCancel,
    clearRunState,
  };

  return (
    <AllocatorRunContext.Provider value={value}>
      {children}
    </AllocatorRunContext.Provider>
  );
}

export function useAllocatorRun() {
  const ctx = useContext(AllocatorRunContext);
  if (!ctx) throw new Error('useAllocatorRun must be used within AllocatorRunProvider');
  return ctx;
}
