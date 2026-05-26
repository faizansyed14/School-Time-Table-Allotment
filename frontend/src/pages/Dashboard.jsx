import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { todayISO } from '../lib/utils.js';
import { Users, BookOpen, Calendar, CheckCircle, UserX, ArrowRight } from 'lucide-react';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/dashboard/stats').then(setStats).catch(console.error);
  }, []);

  const s = stats || {};

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Dashboard</h2>
          <p>Overview for {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Teachers" value={s.teacher_count ?? '—'} icon={Users} note="Active staff" />
        <StatCard label="Classes" value={s.class_count ?? '—'} icon={BookOpen} note="All sections" />
        <StatCard label="Periods / week" value={s.total_periods ?? '—'} icon={Calendar} note="Subject allocations" />
        <StatCard
          label="Timetable"
          value={s.timetable_ready ? 'Ready' : 'Not generated'}
          icon={CheckCircle}
          note={s.timetable_slots ? `${s.timetable_slots} slots filled` : 'Run Allotment to generate'}
          valueStyle={{ fontSize: 18, color: s.timetable_ready ? 'var(--green)' : 'var(--amber)' }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Absent Today */}
        <div className="card">
          <div className="card-header">
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              <UserX size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              Absent Today
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/absences')}>
              Manage <ArrowRight size={12} />
            </button>
          </div>
          <div className="card-body">
            {!s.absent_today?.length ? (
              <div style={{ color: 'var(--mid)', fontSize: 13 }}>All teachers present today.</div>
            ) : (
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {s.absent_today.map((a) => (
                  <li key={a.teacher_id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--red-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--red)' }}>
                      {(a.teacher_name || '?')[0].toUpperCase()}
                    </div>
                    <span>{a.teacher_name}</span>
                    <span className="badge badge-red">Absent</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Quick links */}
        <div className="card">
          <div className="card-header">
            <span style={{ fontWeight: 600, fontSize: 14 }}>Quick Actions</span>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'View Timetable',     path: '/timetable'   },
              { label: 'Manage Allocations', path: '/allocations' },
              { label: 'Run Allotment',      path: '/allotment'   },
              { label: 'Mark Absence',       path: '/absences'    },
            ].map(({ label, path }) => (
              <button key={path} className="btn btn-outline" style={{ justifyContent: 'space-between' }} onClick={() => navigate(path)}>
                {label} <ArrowRight size={13} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, note, valueStyle }) {
  return (
    <div className="stat-card">
      <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Icon size={12} /> {label}
      </div>
      <div className="stat-value" style={valueStyle}>{value}</div>
      <div className="stat-sub">{note}</div>
    </div>
  );
}
