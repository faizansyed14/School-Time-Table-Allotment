import React from 'react';
import { Link } from 'react-router-dom';
import { Loader, X, AlertCircle, CheckCircle, Sparkles } from 'lucide-react';
import { useAllocatorRun } from '../lib/allocatorRun.jsx';

export default function AllocatorRunBanner() {
  const {
    phase,
    isRunning,
    progress,
    secondsRemaining,
    timeLimitSeconds,
    lastRun,
    error,
    showCancelConfirm,
    requestCancel,
    dismissCancelConfirm,
    confirmCancel,
    clearRunState,
  } = useAllocatorRun();

  if (phase === 'idle') return null;

  return (
    <>
      <div className="allocator-run-banner" role="status" aria-live="polite">
        {isRunning && (
          <>
            <div className="allocator-run-banner-main">
              <Loader size={16} className="spinner" />
              <div className="allocator-run-banner-text">
                <strong>Allocator running</strong>
                <span>CP-SAT solving timetable — up to {timeLimitSeconds}s (~{secondsRemaining}s left)</span>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={requestCancel}>
                Cancel
              </button>
            </div>
            <div className="progress-bar-wrap" style={{ marginTop: 8 }}>
              <div
                className="progress-bar-fill"
                style={{ width: `${progress}%`, background: 'var(--blue)', transition: 'width 0.25s ease' }}
              />
            </div>
            <p style={{ fontSize: 11, color: 'var(--mid)', margin: '6px 0 0' }}>
              Estimated progress {progress}% — you can leave this page; the run continues in the background.
            </p>
          </>
        )}

        {phase === 'done' && lastRun?.success && (
          <div className="allocator-run-banner-main">
            <CheckCircle size={16} color="var(--green)" />
            <div className="allocator-run-banner-text">
              <strong>Allocation complete</strong>
              <span>FEASIBLE — {lastRun.filled}/{lastRun.total} slots filled</span>
            </div>
            <Link to="/allotment" className="btn btn-primary btn-sm" onClick={clearRunState}>
              <Sparkles size={12} /> View &amp; apply
            </Link>
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearRunState} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )}

        {(phase === 'error' || (phase === 'done' && !lastRun?.success)) && (
          <div className="allocator-run-banner-main">
            <AlertCircle size={16} color="var(--red)" />
            <div className="allocator-run-banner-text">
              <strong>Allocation failed</strong>
              <span>{error || lastRun?.message || 'Solver did not finish'}</span>
            </div>
            <Link to="/allotment" className="btn btn-outline btn-sm">Allotment</Link>
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearRunState} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )}

        {phase === 'cancelled' && (
          <div className="allocator-run-banner-main">
            <AlertCircle size={16} color="var(--amber)" />
            <div className="allocator-run-banner-text">
              <strong>Allocation cancelled</strong>
              <span>The solver was stopped before completion.</span>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearRunState}>Dismiss</button>
          </div>
        )}
      </div>

      {showCancelConfirm && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && dismissCancelConfirm()}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <h2 className="modal-title">Cancel allocation?</h2>
            <p style={{ fontSize: 13, color: 'var(--mid)' }}>
              The CP-SAT solver will be stopped. You can run it again from Allotment when ready.
            </p>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={dismissCancelConfirm}>
                Keep running
              </button>
              <button type="button" className="btn btn-danger" onClick={confirmCancel}>
                Yes, cancel run
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
