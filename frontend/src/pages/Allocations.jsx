import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { SUBJECT_OPTIONS } from '../lib/utils.js';
import { buildRemindersAfterAllocationChange } from '../lib/balanceHints.js';
import { useBalanceReminder } from '../lib/balanceReminder.jsx';
import {
  Plus, Pencil, Trash2, Search, AlertCircle, CheckCircle,
  ArrowRightLeft, Users, BookOpen, ChevronDown, ChevronRight,
  Sparkles, Loader, Info, BarChart2, Zap,
} from 'lucide-react';
import ResultPanel from '../components/ResultPanel.jsx';

const PERIODS_PER_CLASS = 48;
const EMPTY = { teacher_id: '', class_id: '', subject: '', periods_weekly: '' };

export default function Allocations() {
  const [tab, setTab]             = useState(0); // 0=Summary, 1=Browse
  const [allocs, setAllocs]       = useState([]);
  const [teachers, setTeachers]   = useState([]);
  const [classes, setClasses]     = useState([]);
  const [validation, setValidation] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [groupBy, setGroupBy]     = useState('class');
  const [collapsed, setCollapsed] = useState({});
  const [modal, setModal]         = useState(null);
  const [form, setForm]           = useState(EMPTY);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [deleteRow, setDeleteRow] = useState(null);
  const [swapModal, setSwapModal] = useState(false);
  const [swapFrom, setSwapFrom]   = useState('');
  const [swapTo, setSwapTo]       = useState('');
  const [autoModal, setAutoModal] = useState(false);
  const [autoResult, setAutoResult] = useState(null);
  const [autoLoading, setAutoLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const { setReminder } = useBalanceReminder();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, t, c, v] = await Promise.all([
        api.get('/allocations'),
        api.get('/teachers'),
        api.get('/timetable/classes'),
        api.get('/allocations/validate').catch(() => null),
      ]);
      setAllocs(a || []);
      setTeachers(t || []);
      setClasses(c || []);
      setValidation(v);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Derived: teacher & class lookup maps
  const teacherMap = useMemo(() => Object.fromEntries(teachers.map((t) => [t.id, t])), [teachers]);
  const classMap   = useMemo(() => Object.fromEntries(classes.map((c) => [c.id, c])), [classes]);

  const precheckIssues = validation?.issues || [];
  const errorCount = precheckIssues.filter((i) => i.severity === 'error').length;
  const warningCount = precheckIssues.filter((i) => i.severity === 'warning').length;
  const classSummary = useMemo(() => {
    return classes.map((c) => {
      const rows = allocs.filter((a) => a.class_id === c.id);
      const total = rows.reduce((n, r) => n + r.periods_weekly, 0);
      const uniqueTeachers = [...new Set(rows.map((r) => r.teacher_id))].length;
      const subjectTotals = {};
      rows.forEach((r) => {
        subjectTotals[r.subject] = (subjectTotals[r.subject] || 0) + r.periods_weekly;
      });
      const subjects = Object.entries(subjectTotals)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, periods]) => ({ name, periods }));
      const ctId = c.class_teacher_id;
      const ctAlloc = ctId ? rows.filter((r) => r.teacher_id === ctId).reduce((n, r) => n + r.periods_weekly, 0) : 0;
      return { ...c, total, uniqueTeachers, subjects, ctAlloc, rows };
    });
  }, [classes, allocs]);

  // Teacher summary
  const teacherSummary = useMemo(() => {
    return teachers.map((t) => {
      const rows = allocs.filter((a) => a.teacher_id === t.id);
      const total = rows.reduce((n, r) => n + r.periods_weekly, 0);
      const diff  = total - (t.allotted_periods || 0);
      return { ...t, total, diff, rows };
    });
  }, [teachers, allocs]);

  // Summary stats per class
  function openAdd(preset = {}) { setForm({ ...EMPTY, ...preset }); setError(''); setModal('add'); }
  function openEdit(row) {
    setForm({ teacher_id: row.teacher_id, class_id: row.class_id, subject: row.subject, periods_weekly: row.periods_weekly });
    setError(''); setModal(row);
  }

  async function handleSave() {
    setError('');
    if (!form.teacher_id || !form.class_id || !form.subject || !form.periods_weekly) { setError('All fields required.'); return; }
    if (Number(form.periods_weekly) <= 0) { setError('Periods must be > 0.'); return; }
    setSaving(true);
    try {
      const newPeriods = Number(form.periods_weekly);
      const change = modal === 'add'
        ? { type: 'add', teacher_id: form.teacher_id, class_id: form.class_id, subject: form.subject, oldPeriods: 0, newPeriods }
        : { type: 'edit', teacher_id: form.teacher_id, class_id: form.class_id, subject: form.subject, oldPeriods: modal.periods_weekly, newPeriods };

      if (modal === 'add') {
        await api.post('/allocations', { ...form, periods_weekly: newPeriods });
      } else {
        await api.put(`/allocations/${form.teacher_id}/${form.class_id}/${encodeURIComponent(form.subject)}`, { periods_weekly: newPeriods });
      }
      setReminder(buildRemindersAfterAllocationChange({ change, teachers, classes, allocs }));
      setModal(null);
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    try {
      const change = {
        type: 'delete',
        teacher_id: deleteRow.teacher_id,
        class_id: deleteRow.class_id,
        subject: deleteRow.subject,
        oldPeriods: deleteRow.periods_weekly,
        newPeriods: 0,
      };
      await api.delete(`/allocations/${deleteRow.teacher_id}/${deleteRow.class_id}/${encodeURIComponent(deleteRow.subject)}`);
      setReminder(buildRemindersAfterAllocationChange({ change, teachers, classes, allocs }));
      setDeleteRow(null);
      load();
    } catch (e) { alert(e.message); }
  }

  async function handleSwap() {
    if (!swapFrom || !swapTo || swapFrom === swapTo) return;
    const fromName = teacherMap[swapFrom]?.name;
    const toName   = teacherMap[swapTo]?.name;
    if (!window.confirm(`Re-assign ALL allocations from "${fromName}" to "${toName}"?`)) return;
    try {
      const r = await api.post('/allocations/swap-teacher', { from_teacher_id: swapFrom, to_teacher_id: swapTo });
      alert(`Swapped ${r.swapped} allocations.`);
      setSwapModal(false); setSwapFrom(''); setSwapTo(''); load();
    } catch (e) { alert(e.message); }
  }

  async function runAutoGenerate(apply) {
    setAutoLoading(true);
    try {
      const r = await api.post(`/allocations/auto-generate?apply=${apply ? '1' : '0'}`);
      setAutoResult(r);
      if (apply && r.success) load();
    } catch (e) { setAutoResult({ success: false, error: e.message }); }
    finally { setAutoLoading(false); }
  }

  const totalPeriods = allocs.reduce((n, r) => n + r.periods_weekly, 0);
  const schoolTotal = classes.length * PERIODS_PER_CLASS;

  // ── grouped for Browse tab ─────────────────────────────────
  const grouped = useMemo(() => {
    const lc = search.toLowerCase();
    const filterCls = searchParams.get('class');
    const filterTch = searchParams.get('teacher');
    let filtered = allocs.filter((a) =>
      !search ||
      (a.teacher_name || '').toLowerCase().includes(lc) ||
      (a.class_name   || '').toLowerCase().includes(lc) ||
      (a.subject      || '').toLowerCase().includes(lc)
    );
    if (filterCls) filtered = filtered.filter((a) => a.class_id === filterCls);
    if (filterTch) filtered = filtered.filter((a) => a.teacher_id === filterTch);

    if (groupBy === 'teacher') {
      const map = {};
      teachers.forEach((t) => { map[t.id] = { key: t.id, name: t.name, target: t.allotted_periods || 0, rows: [] }; });
      filtered.forEach((a) => {
        if (!map[a.teacher_id]) map[a.teacher_id] = { key: a.teacher_id, name: a.teacher_name || a.teacher_id, target: 0, rows: [] };
        map[a.teacher_id].rows.push(a);
      });
      return Object.values(map).filter((g) => g.rows.length > 0).sort((a, b) => a.name.localeCompare(b.name));
    }
    const map = {};
    classes.forEach((c) => { map[c.id] = { key: c.id, name: c.name, level: c.class_level, rows: [] }; });
    filtered.forEach((a) => {
      if (!map[a.class_id]) map[a.class_id] = { key: a.class_id, name: a.class_name || a.class_id, level: a.class_level, rows: [] };
      map[a.class_id].rows.push(a);
    });
    return Object.values(map)
      .filter((g) => g.rows.length > 0)
      .map((g) => ({
        ...g,
        classTotal: allocs.filter((a) => a.class_id === g.key).reduce((n, r) => n + r.periods_weekly, 0),
      }))
      .sort((a, b) => (a.level || 0) - (b.level || 0) || a.name.localeCompare(b.name));
  }, [allocs, teachers, classes, groupBy, search, searchParams]);

  const TABS = ['Summary', 'Browse'];

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Allocations</h2>
          <p>{allocs.length} rows · {totalPeriods}/{schoolTotal || '…'} periods assigned</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={() => { setAutoResult(null); setAutoModal(true); }}>
            <Sparkles size={13} /> Auto-Generate
          </button>
          <button className="btn btn-outline" onClick={() => setSwapModal(true)}>
            <ArrowRightLeft size={13} /> Swap Teacher
          </button>
          <button className="btn btn-primary" onClick={() => openAdd()}>
            <Plus size={14} /> Add Row
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <StatusPill color={errorCount ? 'red' : 'green'} icon={errorCount ? AlertCircle : CheckCircle}
          label={errorCount ? `${errorCount} error${errorCount !== 1 ? 's' : ''}` : 'No errors'} />
        {warningCount > 0 && <StatusPill color="amber" icon={AlertCircle} label={`${warningCount} warning${warningCount !== 1 ? 's' : ''}`} />}
        <StatusPill color="blue" icon={BarChart2} label={`${totalPeriods}/${schoolTotal || '…'} periods`} />
        <StatusPill color={schoolTotal > 0 && totalPeriods === schoolTotal ? 'green' : 'gray'} icon={CheckCircle}
          label={schoolTotal > 0 && totalPeriods === schoolTotal ? 'All classes balanced' : `${Math.max(0, schoolTotal - totalPeriods)} periods missing`} />
      </div>

      <div className="alert alert-amber" style={{ marginBottom: 12, fontSize: 12 }}>
        <Info size={13} style={{ flexShrink: 0 }} />
        <span>
          <b>Balance rule:</b> Rows must match <b>Curriculum</b> (periods per class per subject).
          Each class = {PERIODS_PER_CLASS}p. Auto targets are decided by CP-SAT at generate time.
        </span>
      </div>

      <div className="tab-bar">
        {TABS.map((t, i) => (
          <button key={t} className={`tab-btn${tab === i ? ' active' : ''}`} onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--mid)' }}>
          <Loader size={20} className="spinner" style={{ margin: '0 auto 8px', display: 'block' }} />Loading…
        </div>
      ) : tab === 0 ? (
        <SummaryTab classSummary={classSummary} teacherSummary={teacherSummary} teacherMap={teacherMap} onEdit={openAdd} />
      ) : (
        <BrowseTab
          grouped={grouped} groupBy={groupBy} setGroupBy={setGroupBy}
          search={search} setSearch={setSearch}
          collapsed={collapsed} setCollapsed={setCollapsed}
          openAdd={openAdd} openEdit={openEdit} setDeleteRow={setDeleteRow}
          allocs={allocs} totalPeriods={totalPeriods}
        />
      )}

      {/* Modals */}
      {modal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <h2 className="modal-title">{modal === 'add' ? 'Add Allocation' : 'Edit Allocation'}</h2>
            {error && <div className="alert alert-red"><AlertCircle size={13} />{error}</div>}
            <div className="form-group">
              <label className="form-label">Teacher</label>
              <select className="form-select" value={form.teacher_id}
                onChange={(e) => setForm((f) => ({ ...f, teacher_id: e.target.value }))}
                disabled={modal !== 'add'}>
                <option value="">— select —</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name} (target {t.allotted_periods || 0})</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label">Class</label>
                <select className="form-select" value={form.class_id}
                  onChange={(e) => setForm((f) => ({ ...f, class_id: e.target.value }))}
                  disabled={modal !== 'add'}>
                  <option value="">— select —</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label">Subject</label>
                <select className="form-select" value={form.subject}
                  onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                  disabled={modal !== 'add'}>
                  <option value="">— select —</option>
                  {SUBJECT_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group" style={{ marginTop: 12 }}>
              <label className="form-label">Periods per week</label>
              <input className="form-input" type="number" min={1} max={12} value={form.periods_weekly}
                onChange={(e) => setForm((f) => ({ ...f, periods_weekly: e.target.value }))} />
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : modal === 'add' ? 'Add' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteRow && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setDeleteRow(null)}>
          <div className="modal" style={{ maxWidth: 360 }}>
            <h2 className="modal-title">Remove Allocation</h2>
            <p style={{ fontSize: 13 }}>
              Remove <b>{deleteRow.teacher_name}</b> teaching <b>{deleteRow.subject}</b> in <b>{deleteRow.class_name}</b> ({deleteRow.periods_weekly}p/week)?
            </p>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDeleteRow(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {swapModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setSwapModal(false)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <h2 className="modal-title">Swap Teacher</h2>
            <p style={{ fontSize: 12, color: 'var(--mid)', marginBottom: 14 }}>
              Re-assign all allocations from one teacher to another. Use when a teacher leaves and is replaced.
            </p>
            <div className="form-group">
              <label className="form-label">From (teacher leaving)</label>
              <select className="form-select" value={swapFrom} onChange={(e) => setSwapFrom(e.target.value)}>
                <option value="">— select —</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">To (replacement)</label>
              <select className="form-select" value={swapTo} onChange={(e) => setSwapTo(e.target.value)}>
                <option value="">— select —</option>
                {teachers.filter((t) => t.id !== swapFrom).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setSwapModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSwap}>Swap All Allocations</button>
            </div>
          </div>
        </div>
      )}

      {autoModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setAutoModal(false)}>
          <div className="modal" style={{ maxWidth: 640 }}>
            <h2 className="modal-title">Auto-Generate Allocations</h2>
            <p style={{ fontSize: 13, color: 'var(--mid)', marginBottom: 10 }}>
              Uses the same CP-SAT engine as <b>Allotment</b> (Phase A only). Reads live
              <b> Curriculum</b>, <b>Teachers</b> (subjects, levels, pinned targets), and <b>Classes</b> (class teachers).
              Blank teacher target = Auto (solver decides). Pinned number = fixed.
            </p>
            <p style={{ fontSize: 12, color: 'var(--mid)', marginBottom: 10 }}>
              Prerequisites: each class curriculum = {PERIODS_PER_CLASS} periods, class teachers assigned, subject coverage OK.
              Run <b>Preview</b> first.
            </p>
            <div className="alert alert-amber" style={{ marginBottom: 14 }}>
              <Zap size={13} style={{ marginRight: 5 }} /> <b>Apply</b> will delete all existing allocations and replace them.
            </div>

            {!autoResult && !autoLoading && (
              <button className="btn btn-outline" onClick={() => runAutoGenerate(false)} disabled={autoLoading}>
                Preview (no database changes)
              </button>
            )}

            <ResultPanel
              result={autoResult}
              mode="allocate"
              loading={autoLoading}
              classes={classes}
              teachers={teachers}
            >
              {autoResult?.success && !autoResult.applied && (
                <button
                  className="btn btn-primary"
                  style={{ marginTop: 10 }}
                  onClick={() => runAutoGenerate(true)}
                  disabled={autoLoading}
                >
                  {autoLoading ? 'Applying…' : 'Apply to database'}
                </button>
              )}
            </ResultPanel>

            <div className="modal-footer">
              {autoResult && !autoResult.applied && (
                <button className="btn btn-ghost btn-sm" onClick={() => setAutoResult(null)}>Try again</button>
              )}
              <button className="btn btn-outline" onClick={() => setAutoModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Summary Tab ───────────────────────────────────────────────
function SummaryTab({ classSummary, teacherSummary, teacherMap, onEdit }) {
  const [view, setView] = useState('class');
  return (
    <div>
      <div style={{ display: 'inline-flex', border: '1px solid var(--border-2)', borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
        {[['class', 'By Class'], ['teacher', 'By Teacher']].map(([val, lbl]) => (
          <button key={val} onClick={() => setView(val)}
            style={{ padding: '6px 16px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                     background: view === val ? 'var(--dark)' : 'transparent',
                     color: view === val ? '#fff' : 'var(--mid)' }}>
            {lbl}
          </button>
        ))}
      </div>

      {view === 'class' ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Class</th>
                <th>Class Teacher</th>
                <th style={{ textAlign: 'center' }}>CT Periods in Class</th>
                <th style={{ textAlign: 'center' }}>Total Periods</th>
                <th style={{ textAlign: 'center' }}>Teachers</th>
                <th>Subjects Covered</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {classSummary.map((c) => {
                const ctName = c.class_teacher_id ? teacherMap[c.class_teacher_id]?.name : null;
                const ok     = c.total === 48;
                const over   = c.total > 48;
                const ctOk   = !c.class_teacher_id || c.ctAlloc >= 6;
                return (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 700 }}>{c.name}</td>
                    <td>{ctName ? <span className="badge badge-gray">{ctName}</span> : <span style={{ color: 'var(--muted)' }}>Not set</span>}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`badge ${ctOk ? 'badge-green' : 'badge-red'}`}>
                        {c.class_teacher_id ? `${c.ctAlloc}p` : '—'}
                      </span>
                      {!ctOk && <span style={{ fontSize: 10, color: 'var(--red)', marginLeft: 4 }}>needs ≥6</span>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`badge ${ok ? 'badge-green' : over ? 'badge-red' : 'badge-amber'}`}>
                        {c.total}/48
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', color: 'var(--mid)' }}>{c.uniqueTeachers}</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {c.subjects.map((s) => (
                          <span key={s.name} className="badge badge-gray" style={{ fontSize: 10 }}>
                            {s.name} {s.periods}p
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-xs" onClick={() => onEdit({ class_id: c.id })}>
                        <Plus size={11} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Teacher</th>
                <th style={{ textAlign: 'center' }}>Target</th>
                <th style={{ textAlign: 'center' }}>Assigned</th>
                <th style={{ textAlign: 'center' }}>Diff</th>
                <th>Classes</th>
              </tr>
            </thead>
            <tbody>
              {teacherSummary.map((t) => {
                const ok   = t.diff === 0;
                const over = t.diff > 0;
                return (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.name}</td>
                    <td style={{ textAlign: 'center', color: 'var(--mid)' }}>{t.allotted_periods || 0}</td>
                    <td style={{ textAlign: 'center' }}>{t.total}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`badge ${ok ? 'badge-green' : over ? 'badge-red' : 'badge-amber'}`}>
                        {t.diff === 0 ? '✓' : t.diff > 0 ? `+${t.diff}` : t.diff}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {[...new Set(t.rows.map((r) => r.class_name))].map((cn) => (
                          <span key={cn} className="badge badge-gray" style={{ fontSize: 10 }}>{cn}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Browse Tab ────────────────────────────────────────────────
function BrowseTab({ grouped, groupBy, setGroupBy, search, setSearch, collapsed, setCollapsed, openAdd, openEdit, setDeleteRow, allocs, totalPeriods }) {
  return (
    <div>
      <div className="toolbar">
        <div className="search-wrap">
          <Search size={13} />
          <input className="search-input" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ display: 'inline-flex', border: '1px solid var(--border-2)', borderRadius: 6, overflow: 'hidden' }}>
          {[['class', BookOpen, 'By Class'], ['teacher', Users, 'By Teacher']].map(([val, Icon, lbl]) => (
            <button key={val} type="button" onClick={() => setGroupBy(val)}
              style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5,
                       border: 'none', cursor: 'pointer',
                       background: groupBy === val ? 'var(--dark)' : 'transparent',
                       color: groupBy === val ? '#fff' : 'var(--mid)' }}>
              <Icon size={12} /> {lbl}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: 'var(--mid)' }}>{allocs.length} rows · {totalPeriods} periods</span>
      </div>

      {grouped.length === 0 ? (
        <div className="card"><div className="empty-state"><AlertCircle size={32} /><h3>No allocations</h3><p>Add rows or use Auto-Generate.</p></div></div>
      ) : grouped.map((group) => {
        const visibleTotal = group.rows.reduce((n, r) => n + r.periods_weekly, 0);
        const classTotal = group.classTotal ?? visibleTotal;
        const total  = groupBy === 'class' ? classTotal : visibleTotal;
        const target = groupBy === 'class' ? 48 : (group.target || 0);
        const filteredSubset = groupBy === 'class' && visibleTotal !== classTotal;
        const ok     = target > 0 && total === target;
        const over   = total > target && target > 0;
        const statusColor = ok ? 'var(--green)' : over ? 'var(--red)' : 'var(--amber)';
        const isOpen = !collapsed[group.key];
        return (
          <div key={group.key} className="group-card">
            <div className="group-header" onClick={() => setCollapsed((p) => ({ ...p, [group.key]: !p[group.key] }))}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <b style={{ fontSize: 14 }}>{group.name}</b>
                {groupBy === 'class' && <span style={{ fontSize: 11, color: 'var(--mid)' }}>Level {group.level}</span>}
                {groupBy === 'teacher' && group.target > 0 && <span style={{ fontSize: 11, color: 'var(--mid)' }}>target {group.target}</span>}
                {filteredSubset && (
                  <span style={{ fontSize: 11, color: 'var(--mid)' }}>
                    showing {visibleTotal}p for this teacher · class total {classTotal}/48
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: statusColor,
                               background: ok ? 'var(--green-bg)' : over ? 'var(--red-bg)' : 'var(--amber-bg)',
                               padding: '2px 8px', borderRadius: 10 }}>
                  {total}{target > 0 ? ` / ${target}` : ''} periods
                </span>
                <button type="button" className="btn btn-ghost btn-xs"
                  onClick={(e) => { e.stopPropagation(); openAdd(groupBy === 'teacher' ? { teacher_id: group.key } : { class_id: group.key }); }}>
                  <Plus size={12} />
                </button>
              </div>
            </div>
            {isOpen && (
              group.rows.length === 0
                ? <div style={{ padding: '12px 16px', color: 'var(--mid)', fontSize: 12 }}>No allocations. Click + to add.</div>
                : <div className="group-items">
                    {group.rows.map((row) => (
                      <div key={`${row.teacher_id}-${row.class_id}-${row.subject}`} className="alloc-chip">
                        <div className="alloc-chip-name">{groupBy === 'teacher' ? row.class_name : row.teacher_name}</div>
                        <div className="alloc-chip-sub">
                          <span className="alloc-chip-label">{row.subject}</span>
                          <span className="alloc-chip-count">{row.periods_weekly}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                          <button className="btn btn-ghost btn-xs" onClick={() => openEdit(row)}><Pencil size={10} /></button>
                          <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }} onClick={() => setDeleteRow(row)}><Trash2 size={10} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── StatusPill ────────────────────────────────────────────────
function StatusPill({ color, icon: Icon, label }) {
  const colors = {
    red:   { bg: 'var(--red-bg)',   text: 'var(--red)',   border: '#fca5a5' },
    green: { bg: 'var(--green-bg)', text: 'var(--green)', border: '#6ee7b7' },
    amber: { bg: 'var(--amber-bg)', text: 'var(--amber)', border: '#fcd34d' },
    blue:  { bg: 'var(--blue-bg)',  text: 'var(--blue)',  border: '#bfdbfe' },
    gray:  { bg: 'var(--bg)',       text: 'var(--mid)',   border: 'var(--border)' },
  };
  const c = colors[color] || colors.gray;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px',
                  borderRadius: 20, background: c.bg, border: `1px solid ${c.border}`,
                  fontSize: 12, fontWeight: 600, color: c.text }}>
      <Icon size={12} /> {label}
    </div>
  );
}
