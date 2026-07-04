import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import {
  Users, BookOpen, Calendar, CheckCircle, UserX, ArrowRight,
  Sparkles, ListChecks, BookMarked, Loader, RefreshCw,
  AlertCircle, Clock, LayoutGrid,
} from 'lucide-react';

const EXPECTED_PERIODS = 720; // 15 classes × 48

const QUICK_ACTIONS = [
  { label: 'View Timetable', desc: 'Class, teacher & master grid', path: '/timetable', icon: Calendar, tone: 'blue' },
  { label: 'Allocations', desc: 'Who teaches what', path: '/allocations', icon: ListChecks, tone: 'indigo' },
  { label: 'Run Allotment', desc: 'Generate weekly schedule', path: '/allotment', icon: Sparkles, tone: 'violet' },
  { label: 'Mark Absence', desc: 'Substitutes for today', path: '/absences', icon: UserX, tone: 'amber' },
  { label: 'Curriculum', desc: 'Subjects & class setup', path: '/curriculum', icon: BookOpen, tone: 'green' },
  { label: 'Teachers', desc: 'Staff & workloads', path: '/teachers', icon: Users, tone: 'slate' },
];

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/dashboard/stats');
      setStats(data);
      setLastRefreshed(new Date());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const s = stats || {};
  const todayLabel = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const timetableReady = !!s.timetable_ready;
  const periodsOk = s.total_periods === EXPECTED_PERIODS;
  const allClear = timetableReady && periodsOk && !(s.absent_today?.length);

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <h2>Dashboard</h2>
          <p>School overview — {todayLabel}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={load} disabled={loading} title="Refresh">
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> Refresh
        </button>
      </div>

      {/* Status strip */}
      <div className="dashboard-status-bar">
        {loading ? (
          <span className="dashboard-status-pill neutral">
            <Loader size={12} className="spinner" /> Loading…
          </span>
        ) : allClear ? (
          <span className="dashboard-status-pill ok">
            <CheckCircle size={13} /> All systems ready
          </span>
        ) : (
          <>
            {!timetableReady && (
              <span className="dashboard-status-pill warn">
                <AlertCircle size={13} /> Timetable not generated
              </span>
            )}
            {!periodsOk && s.total_periods != null && (
              <span className="dashboard-status-pill warn">
                <AlertCircle size={13} /> Allocations {s.total_periods}/{EXPECTED_PERIODS} periods
              </span>
            )}
            {s.absent_today?.length > 0 && (
              <span className="dashboard-status-pill err">
                <UserX size={13} /> {s.absent_today.length} absent today
              </span>
            )}
          </>
        )}
      </div>

      {/* KPI row */}
      <div className="dashboard-kpi-grid">
        <KpiCard
          label="Teachers"
          value={loading ? '—' : (s.teacher_count ?? '—')}
          note="Active staff"
          icon={Users}
          tone="indigo"
          loading={loading}
        />
        <KpiCard
          label="Classes"
          value={loading ? '—' : (s.class_count ?? '—')}
          note="All sections"
          icon={LayoutGrid}
          tone="blue"
          loading={loading}
        />
        <KpiCard
          label="Periods / week"
          value={loading ? '—' : (s.total_periods ?? '—')}
          note={periodsOk ? 'Curriculum balanced' : `Target ${EXPECTED_PERIODS}`}
          icon={BookOpen}
          tone={periodsOk ? 'green' : 'amber'}
          loading={loading}
          highlight={!loading && !periodsOk}
        />
        <KpiCard
          label="Timetable"
          value={loading ? '—' : (timetableReady ? 'Ready' : 'Pending')}
          note={timetableReady ? `${s.timetable_slots} slots in DB` : 'Run Allotment to generate'}
          icon={Calendar}
          tone={timetableReady ? 'green' : 'amber'}
          loading={loading}
          valueSmall
        />
      </div>

      <div className="dashboard-layout">
        {/* Main column */}
        <div className="dashboard-main">
          {/* Absent today */}
          <div className="card">
            <div className="card-header">
              <span className="dashboard-card-title">
                <UserX size={15} /> Absent Today
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/absences')}>
                Manage <ArrowRight size={12} />
              </button>
            </div>
            <div className="card-body">
              {loading ? (
                <p className="dashboard-muted">Loading…</p>
              ) : !s.absent_today?.length ? (
                <div className="dashboard-empty-state ok">
                  <CheckCircle size={20} />
                  <div>
                    <strong>All teachers present</strong>
                    <span>No absences recorded for today.</span>
                  </div>
                </div>
              ) : (
                <ul className="dashboard-absence-list">
                  {s.absent_today.map((a) => (
                    <li key={a.teacher_id}>
                      <div className="dashboard-avatar absent">
                        {(a.teacher_name || '?')[0].toUpperCase()}
                      </div>
                      <span className="dashboard-absence-name">{a.teacher_name}</span>
                      <span className="badge badge-red">Absent</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Setup hint when timetable missing */}
          {!loading && !timetableReady && (
            <div className="dashboard-setup-card">
              <div className="setup-icon"><Sparkles size={20} /></div>
              <div className="setup-body">
                <strong>Complete your timetable</strong>
                <p>
                  Allocations are saved, but no weekly grid yet. Go to Allotment and run
                  {' '}<button type="button" className="dashboard-inline-link" onClick={() => navigate('/allotment')}>Auto Allotment</button>
                  {' '}or follow the Setup Guide.
                </p>
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/guide')}>
                <BookMarked size={13} /> Setup Guide
              </button>
            </div>
          )}
        </div>

        {/* Sidebar — quick actions */}
        <aside className="dashboard-sidebar">
          <div className="card">
            <div className="card-header">
              <span className="dashboard-card-title">Quick Actions</span>
            </div>
            <div className="card-body dashboard-actions-grid">
              {QUICK_ACTIONS.map(({ label, desc, path, icon: Icon, tone }) => (
                <button
                  key={path}
                  type="button"
                  className={`dashboard-action-tile tone-${tone}`}
                  onClick={() => navigate(path)}
                >
                  <div className="tile-icon"><Icon size={16} /></div>
                  <div className="tile-text">
                    <span className="tile-label">{label}</span>
                    <span className="tile-desc">{desc}</span>
                  </div>
                  <ArrowRight size={14} className="tile-arrow" />
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-body dashboard-meta">
              <div className="meta-row">
                <Clock size={13} />
                <span>
                  Last refreshed{' '}
                  {lastRefreshed
                    ? lastRefreshed.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                    : '—'}
                </span>
              </div>
              <div className="meta-row">
                <Calendar size={13} />
                <span>{s.timetable_slots ?? 0} timetable slots stored</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function KpiCard({ label, value, note, icon: Icon, tone, loading, highlight, valueSmall }) {
  return (
    <div className={`dashboard-kpi tone-${tone}${highlight ? ' highlight' : ''}`}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <div className="kpi-icon"><Icon size={16} /></div>
      </div>
      <div className={`kpi-value${valueSmall ? ' kpi-value-sm' : ''}`}>
        {loading ? <Loader size={18} className="spinner" /> : value}
      </div>
      <div className="kpi-note">{note}</div>
    </div>
  );
}
