import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../lib/api.js';
import { buildRemindersAfterCurriculumChange } from '../lib/balanceHints.js';
import { useBalanceReminder } from '../lib/balanceReminder.jsx';
import { Plus, Pencil, Trash2, AlertCircle } from 'lucide-react';

const CLASS_COLS = ['1A','1B','2A','2B','3A','3B','4A','4B','5','6A','6B','7','8','9','10'];

export default function Curriculum() {
  const [tab, setTab] = useState(0);
  const [classesRefresh, setClassesRefresh] = useState(0);
  return (
    <div>
      <div className="page-header">
        <h2>Curriculum</h2>
      </div>
      <div className="tab-bar">
        {['Subjects & Periods','Classes'].map((t, i) => (
          <button
            key={t}
            className={`tab-btn${tab === i ? ' active' : ''}`}
            onClick={() => { setTab(i); if (i === 1) setClassesRefresh((n) => n + 1); }}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 0 ? <SubjectsTab /> : <ClassesTab refreshKey={classesRefresh} />}
    </div>
  );
}

// ── Subjects Tab ──────────────────────────────────────────────
function SubjectsTab() {
  const { setReminder } = useBalanceReminder();
  const [subjects, setSubjects] = useState([]);
  const [classes, setClasses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [allocs, setAllocs] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [savedForm, setSavedForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const load = useCallback(() => {
    Promise.all([
      api.get('/subjects'),
      api.get('/classes'),
      api.get('/teachers'),
      api.get('/allocations'),
    ])
      .then(([s, c, t, a]) => {
        setSubjects(s);
        setClasses(c);
        setTeachers(t);
        setAllocs(a);
      })
      .catch(console.error);
  }, []);
  useEffect(() => { load(); }, [load]);

  function openAdd() {
    const f = { name: '' };
    CLASS_COLS.forEach((c) => { f[`periods_${c.toLowerCase()}`] = 0; });
    setForm(f); setError(''); setModal('add');
  }
  function openEdit(s) { setForm({ ...s }); setSavedForm({ ...s }); setError(''); setModal(s); }

  async function handleSave() {
    setError('');
    if (!form.name?.trim()) { setError('Subject name required.'); return; }
    const total = CLASS_COLS.reduce((n, c) => n + (Number(form[`periods_${c.toLowerCase()}`]) || 0), 0);
    setSaving(true);
    try {
      const subjectName = form.name?.trim();
      if (modal === 'add') await api.post('/subjects', form);
      else {
        await api.put(`/subjects/${modal.id}`, form);
        const hint = buildRemindersAfterCurriculumChange({
          subjectName,
          oldForm: savedForm || modal,
          newForm: form,
          classes,
          allocs,
          teachers,
        });
        if (hint) setReminder(hint);
      }
      setModal(null);
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    try { await api.delete(`/subjects/${deleteId}`); setDeleteId(null); load(); }
    catch (e) { alert(e.message); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={openAdd}><Plus size={14} /> Add Subject</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 120 }}>Subject</th>
              {CLASS_COLS.map((c) => <th key={c} style={{ textAlign: 'center', padding: '9px 6px' }}>{c}</th>)}
              <th style={{ textAlign: 'center' }}>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {subjects.map((s) => {
              const total = CLASS_COLS.reduce((n, c) => n + (s[`periods_${c.toLowerCase()}`] || 0), 0);
              return (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  {CLASS_COLS.map((c) => {
                    const v = s[`periods_${c.toLowerCase()}`] || 0;
                    return <td key={c} style={{ textAlign: 'center', color: v ? 'var(--dark)' : 'var(--border-2)', fontSize: 12 }}>{v || '–'}</td>;
                  })}
                  <td style={{ textAlign: 'center', fontWeight: 600 }}>{total}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-xs" onClick={() => openEdit(s)}><Pencil size={11} /></button>
                      <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }} onClick={() => setDeleteId(s.id)}><Trash2 size={11} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal" style={{ maxWidth: 640 }}>
            <h2 className="modal-title">{modal === 'add' ? 'Add Subject' : `Edit: ${modal.name}`}</h2>
            {error && <div className="alert alert-red"><AlertCircle size={13} />{error}</div>}
            <div className="form-group">
              <label className="form-label">Subject Name</label>
              <input className="form-input" value={form.name || ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
            </div>
            <p style={{ fontSize: 12, color: 'var(--mid)', marginBottom: 10 }}>Periods per week for each class (0 = not taught):</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
              {CLASS_COLS.map((c) => {
                const k = `periods_${c.toLowerCase()}`;
                return (
                  <div key={c}>
                    <label className="form-label" style={{ textAlign: 'center', display: 'block' }}>{c}</label>
                    <input className="form-input" type="number" min={0} max={15} style={{ textAlign: 'center' }}
                      value={form[k] || 0} onChange={(e) => setForm((f) => ({ ...f, [k]: Number(e.target.value) }))} />
                  </div>
                );
              })}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setDeleteId(null)}>
          <div className="modal" style={{ maxWidth: 360 }}>
            <h2 className="modal-title">Delete Subject</h2>
            <p style={{ fontSize: 13 }}>This removes the subject from the curriculum. Related allocations will remain but you'll need to update them.</p>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDeleteId(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Classes Tab ───────────────────────────────────────────────
function ClassesTab({ refreshKey }) {
  const location = useLocation();
  const [classes, setClasses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const teacherMap = Object.fromEntries(teachers.map((t) => [t.id, t.name]));

  const load = useCallback(() => {
    Promise.all([api.get('/classes'), api.get('/teachers')])
      .then(([c, t]) => { setClasses(c); setTeachers(t); })
      .catch(console.error);
  }, []);
  useEffect(() => { load(); }, [load, refreshKey, location.pathname]);

  function openEdit(c) { setForm({ ...c, class_teacher_id: c.class_teacher_id || '' }); setError(''); setModal(c); }

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      await api.put(`/classes/${modal.id}`, { class_teacher_id: form.class_teacher_id || null });
      setModal(null); load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--mid)', marginBottom: 12 }}>Set the class teacher for each section. The class teacher is placed at Period 1 when R1 is active.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Class</th><th>Level</th><th>Class Teacher</th><th></th></tr>
          </thead>
          <tbody>
            {classes.map((c) => {
              const ctName = c.class_teacher_id ? teacherMap[c.class_teacher_id] : null;
              return (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td style={{ color: 'var(--mid)' }}>Level {c.class_level}</td>
                  <td>{ctName ? <span className="badge badge-gray">{ctName}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => openEdit(c)}><Pencil size={12} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal" style={{ maxWidth: 380 }}>
            <h2 className="modal-title">Class Teacher — {modal.name}</h2>
            {error && <div className="alert alert-red">{error}</div>}
            <div className="form-group">
              <label className="form-label">Assign Class Teacher</label>
              <select className="form-select" value={form.class_teacher_id || ''} onChange={(e) => setForm((f) => ({ ...f, class_teacher_id: e.target.value }))}>
                <option value="">— None —</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
