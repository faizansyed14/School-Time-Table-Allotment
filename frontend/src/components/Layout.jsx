import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import {
  LayoutDashboard, Calendar, UserX, BookOpen,
  ListChecks, Users, Sparkles, LogOut, GraduationCap, BookMarked, Loader,
} from 'lucide-react';
import { useAllocatorRun } from '../lib/allocatorRun.jsx';
import AllocatorRunBanner from './AllocatorRunBanner.jsx';
import { BalanceReminderBanner } from '../lib/balanceReminder.jsx';

const NAV = [
  { section: 'Daily', items: [
    { to: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/timetable',   icon: Calendar,        label: 'Timetable' },
    { to: '/absences',    icon: UserX,            label: 'Absences' },
  ]},
  { section: 'Setup', items: [
    { to: '/guide',       icon: BookMarked,  label: 'Setup Guide' },
    { to: '/curriculum',  icon: BookOpen,    label: 'Curriculum' },
    { to: '/allocations', icon: ListChecks,  label: 'Allocations' },
    { to: '/teachers',    icon: Users,       label: 'Teachers' },
    { to: '/allotment',   icon: Sparkles,    label: 'Allotment' },
  ]},
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { isRunning } = useAllocatorRun();
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-mark">
            <GraduationCap size={16} color="var(--dark)" />
            <h1>School ERP</h1>
          </div>
          <p>Admin Portal</p>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(({ section, items }) => (
            <React.Fragment key={section}>
              <div className="nav-section">{section}</div>
              {items.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                >
                  <Icon size={14} />
                  {label}
                  {to === '/allotment' && isRunning && (
                    <Loader size={10} className="spinner" style={{ marginLeft: 'auto' }} />
                  )}
                </NavLink>
              ))}
            </React.Fragment>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            className="nav-item"
            style={{ color: 'var(--muted)', fontSize: 12 }}
            onClick={() => { logout(); navigate('/login'); }}
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </aside>

      <div className="main-wrap">
        <header className="topbar">
          <div className="topbar-left">
            <GraduationCap size={15} />
            <span style={{ fontWeight: 600 }}>School ERP</span>
          </div>
          <div className="topbar-right">
            <span style={{ fontSize: 12, color: 'var(--mid)' }}>{today}</span>
            <span className="badge badge-gray">{user?.username}</span>
          </div>
        </header>
        <AllocatorRunBanner />
        <BalanceReminderBanner />
        <div className="page-body">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
