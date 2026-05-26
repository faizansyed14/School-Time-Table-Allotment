import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';
import { DAYS, PERIODS, todayISO } from '../lib/utils.js';
import { buildMasterMatrix, exportMasterGridExcel } from '../lib/masterGrid.js';
import MasterGridCellEditor from '../components/MasterGridCellEditor.jsx';
import { Calendar, Loader, Download, Pencil } from 'lucide-react';

export default function Timetable() {
  const [tab, setTab]           = useState(0);
  const [classes, setClasses]   = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    Promise.all([api.get('/timetable/classes'), api.get('/teachers')])
      .then(([c, t]) => { setClasses(c || []); setTeachers(t || []); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-header">
        <div><h2>Timetable</h2><p>View the generated weekly timetable</p></div>
      </div>
      <div className="tab-bar">
        {['Class View', 'Teacher View', 'Master Grid'].map((t, i) => (
          <button key={t} className={`tab-btn${tab === i ? ' active' : ''}`} onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--mid)' }}>
          <Loader size={20} className="spinner" style={{ margin: '0 auto 8px', display: 'block' }} /> Loading…
        </div>
      ) : tab === 0 ? <ClassView classes={classes} /> : tab === 1 ? <TeacherView teachers={teachers} /> : <MasterView classes={classes} teachers={teachers} />}
    </div>
  );
}

// ── Class View ────────────────────────────────────────────────
function ClassView({ classes }) {
  const [selected, setSelected] = useState('');
  const [viewDate, setViewDate] = useState(todayISO());
  const [grid, setGrid]         = useState([]);
  const [subBySlot, setSubBySlot] = useState({});
  const [loading, setLoading]   = useState(false);

  async function loadSubsForDate(d) {
    try {
      const absences = await api.get(`/absences?date=${d}`);
      const map = {};
      (absences || []).forEach((a) => {
        (a.substitutions || []).forEach((s) => {
          if (s.timetable_id) map[s.timetable_id] = s.teachers?.name;
        });
      });
      setSubBySlot(map);
    } catch {
      setSubBySlot({});
    }
  }

  async function loadGrid(id) {
    if (!id) return;
    setLoading(true);
    try {
      const [, data] = await Promise.all([
        loadSubsForDate(viewDate),
        api.get(`/timetable?class_id=${id}`),
      ]);
      setGrid(data || []);
    } catch { setGrid([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (selected) loadGrid(selected); }, [selected, viewDate]);

  const cells = {};
  grid.forEach((r) => { cells[`${r.day}-${r.period}`] = r; });

  return (
    <div>
      <div style={{ marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="form-select" style={{ width: 180 }} value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">— Select Class —</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label style={{ fontSize: 12, color: 'var(--mid)', display: 'flex', alignItems: 'center', gap: 6 }}>
          Date
          <input type="date" className="form-input" style={{ width: 150 }} value={viewDate} onChange={(e) => setViewDate(e.target.value)} />
        </label>
        <span style={{ fontSize: 11, color: 'var(--mid)' }}>Green = substitute assigned on Absences</span>
      </div>

      {!selected ? (
        <div className="card"><div className="empty-state"><Calendar size={32} /><h3>Select a class</h3><p>Choose a class to view its timetable.</p></div></div>
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--mid)' }}><Loader size={18} className="spinner" style={{ display: 'block', margin: '0 auto 8px' }} /> Loading…</div>
      ) : grid.length === 0 ? (
        <div className="card"><div className="empty-state"><Calendar size={32} /><h3>No timetable</h3><p>Run Allotment to generate the timetable.</p></div></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 80 }}>Period</th>
                {DAYS.map((d) => <th key={d}>{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {PERIODS.map((p) => (
                <tr key={p}>
                  <td style={{ fontWeight: 600, color: 'var(--mid)', fontSize: 12 }}>P{p}</td>
                  {DAYS.map((_, di) => {
                    const cell = cells[`${di + 1}-${p}`];
                    return (
                      <td key={di} style={{ padding: '8px 10px' }}>
                        {cell ? (
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 12 }}>{cell.subject}</div>
                            <div style={{ fontSize: 11, color: 'var(--mid)' }}>{cell.teachers?.name}</div>
                            {subBySlot[cell.id] && (
                              <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600, marginTop: 2 }}>
                                Sub: {subBySlot[cell.id]}
                              </div>
                            )}
                          </div>
                        ) : <span style={{ color: 'var(--border-2)' }}>—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Teacher View ──────────────────────────────────────────────
function TeacherView({ teachers }) {
  const [selected, setSelected] = useState('');
  const [grid, setGrid]         = useState([]);
  const [loading, setLoading]   = useState(false);

  async function loadGrid(id) {
    if (!id) return;
    setLoading(true);
    try { setGrid(await api.get(`/timetable?teacher_id=${id}`) || []); }
    catch { setGrid([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (selected) loadGrid(selected); }, [selected]);

  const cells = {};
  grid.forEach((r) => { cells[`${r.day}-${r.period}`] = r; });
  const totalPeriods = grid.length;

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <select className="form-select" style={{ width: 220 }} value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">— Select Teacher —</option>
          {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {selected && !loading && <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--mid)' }}>{totalPeriods} periods/week</span>}
      </div>

      {!selected ? (
        <div className="card"><div className="empty-state"><Calendar size={32} /><h3>Select a teacher</h3></div></div>
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--mid)' }}><Loader size={18} className="spinner" style={{ display: 'block', margin: '0 auto 8px' }} /></div>
      ) : grid.length === 0 ? (
        <div className="card"><div className="empty-state"><Calendar size={32} /><h3>No timetable</h3><p>Run Allotment first.</p></div></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 80 }}>Period</th>
                {DAYS.map((d) => <th key={d}>{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {PERIODS.map((p) => (
                <tr key={p}>
                  <td style={{ fontWeight: 600, color: 'var(--mid)', fontSize: 12 }}>P{p}</td>
                  {DAYS.map((_, di) => {
                    const cell = cells[`${di + 1}-${p}`];
                    return (
                      <td key={di} style={{ padding: '8px 10px' }}>
                        {cell ? (
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 12 }}>{cell.classes?.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--mid)' }}>{cell.subject}</div>
                          </div>
                        ) : <span style={{ color: 'var(--border-2)' }}>—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Master Grid (periods × classes, Mon–Sat merged like school sheet) ──
function MasterView({ classes, teachers }) {
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [edit, setEdit] = useState(null);

  const loadAll = useCallback(() => {
    setLoading(true);
    return api.get('/timetable')
      .then((d) => setAll(d || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const classList = [...classes].sort(
    (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0),
  );

  useEffect(() => { loadAll(); }, [loadAll]);

  const matrix = buildMasterMatrix(all, classList);

  function handleExport() {
    setExporting(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      exportMasterGridExcel({
        classes: classList,
        timetableRows: all,
        filename: `Master-Timetable-${date}.xlsx`,
      });
    } catch (e) {
      alert(e.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <p style={{ fontSize: 12, color: 'var(--mid)', margin: 0 }}>
          Rows = periods 1–8 · Columns = classes · <b>Click a cell</b> to edit with subject/teacher dropdowns and day ranges (max 6 days Mon–Sat).
        </p>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleExport}
          disabled={loading || exporting || all.length === 0}
        >
          {exporting ? <><Loader size={13} className="spinner" /> Exporting…</> : <><Download size={13} /> Export Excel</>}
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--mid)' }}><Loader size={18} className="spinner" style={{ display: 'block', margin: '0 auto 8px' }} /></div>
      ) : all.length === 0 ? (
        <div className="card"><div className="empty-state"><Calendar size={32} /><h3>No timetable yet</h3><p>Run Allotment to generate.</p></div></div>
      ) : (
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table className="master-grid-table">
            <thead>
              <tr>
                <th style={{ width: 72, position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 2 }}>Class Period</th>
                {classList.map((c) => (
                  <th key={c.id} style={{ textAlign: 'center', minWidth: 100, fontSize: 12 }}>{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERIODS.map((p) => (
                <tr key={p}>
                  <td style={{ fontWeight: 700, textAlign: 'center', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>{p}</td>
                  {classList.map((c) => {
                    const text = matrix[c.id]?.[p] || '';
                    const lines = text ? text.split('\n') : [];
                    return (
                      <td
                        key={c.id}
                        role="button"
                        tabIndex={0}
                        title="Click to edit this period row"
                        onClick={() => setEdit({
                          classId: c.id,
                          className: c.name,
                          period: p,
                          initialText: text,
                          slotRows: all.filter((r) => r.class_id === c.id && r.period === p),
                        })}
                        onKeyDown={(e) => e.key === 'Enter' && setEdit({
                          classId: c.id,
                          className: c.name,
                          period: p,
                          initialText: text,
                          slotRows: all.filter((r) => r.class_id === c.id && r.period === p),
                        })}
                        style={{
                          padding: '8px 10px',
                          fontSize: 11,
                          verticalAlign: 'middle',
                          textAlign: 'center',
                          cursor: 'pointer',
                          transition: 'background 0.12s',
                        }}
                        className="master-grid-cell"
                      >
                        {lines.length ? (
                          <div style={{ lineHeight: 1.45 }}>
                            {lines.map((line, i) => (
                              <div key={i}>{line}</div>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>
                            <Pencil size={10} style={{ verticalAlign: -1, marginRight: 4 }} />
                            Add…
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <MasterGridCellEditor
          edit={edit}
          teachers={teachers}
          onClose={() => setEdit(null)}
          onSaved={loadAll}
        />
      )}
    </div>
  );
}
