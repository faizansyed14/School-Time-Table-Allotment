import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { AllocatorRunProvider } from './lib/allocatorRun.jsx';
import { BalanceReminderProvider } from './lib/balanceReminder.jsx';
import Layout      from './components/Layout.jsx';
import Login       from './pages/Login.jsx';
import Dashboard   from './pages/Dashboard.jsx';
import Timetable   from './pages/Timetable.jsx';
import Absences    from './pages/Absences.jsx';
import Curriculum  from './pages/Curriculum.jsx';
import Allocations from './pages/Allocations.jsx';
import Teachers    from './pages/Teachers.jsx';
import Allotment   from './pages/Allotment.jsx';
import Guide       from './pages/Guide.jsx';

function Guard({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--mid)' }}>
      Loading…
    </div>
  );
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Guard><BalanceReminderProvider><AllocatorRunProvider><Layout /></AllocatorRunProvider></BalanceReminderProvider></Guard>}>
            <Route index element={<Navigate to="/guide" replace />} />
            <Route path="guide"       element={<Guide />} />
            <Route path="dashboard"   element={<Dashboard />} />
            <Route path="timetable"   element={<Timetable />} />
            <Route path="absences"    element={<Absences />} />
            <Route path="curriculum"  element={<Curriculum />} />
            <Route path="allocations" element={<Allocations />} />
            <Route path="teachers"    element={<Teachers />} />
            <Route path="allotment"   element={<Allotment />} />
          </Route>
          <Route path="*" element={<Navigate to="/guide" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
