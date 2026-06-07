import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { SUBJECT_OPTIONS } from '../lib/utils.js';
import { buildRemindersAfterTeacherAllocFieldsChange, sumTeacherAlloc } from '../lib/balanceHints.js';
import { useBalanceReminder } from '../lib/balanceReminder.jsx';
import { Plus, Pencil, Trash2, Search, AlertCircle, GraduationCap } from 'lucide-react';

const EMPTY = {
  name: '', subjects: [], min_class_level: 1, max_class_level: 10,
  targetInput: '', min_period_start: 1,
};

function targetInputFromDb(allottedPeriods) {
  const n = Number(allottedPeriods);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
}

function targetForApi(targetInput) {
  const trimmed = String(targetInput ?? '').trim();
  if (!trimmed) return 0;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default function Teachers() {
  const [teachers, setTeachers]     = useState([]);
  const [classes, setClasses]       = useState([]);
  const [search, setSearch]         = useState('');
  const [modal, setModal]           = useState(null);
  const [form, setForm]             = useState(EMPTY);
  const [savedForm, setSavedForm]   = useState(null);
  const [classTeacherOf, setClassTeacherOf] = useState(''); // class id this teacher is CT of
  const [error, setError]           = useState('');
  const [saving, setSaving]         = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const navigate = useNavigate();
  const { setReminder } = useBalanceReminder();
  const [allocs, setAllocs] = useState([]);

  const load = useCallback(() => {
    Promise.all([api.get('/teachers'), api.get('/classes'), api.get('/allocations')])
      .then(([t, c, a]) => { setTeachers(t || []); setClasses(c || []); setAllocs(a || []); })
      .catch(console.error);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Map: teacher_id → class they are CT of
  const ctMap = Object.fromEntries(
    classes.filter((c) => c.class_teacher_id).map((c) => [c.class_teacher_id, c])
  );

  function openAdd() {
    setForm(EMPTY); setClassTeacherOf(''); setError(''); setModal('add');
  }
  function openEdit(t) {
    const f = {
      name: t.name, subjects: t.subjects || [],
      min_class_level: t.min_class_level || 1,
      max_class_level: t.max_class_level || 10,
      targetInput: targetInputFromDb(t.allotted_periods),
      min_period_start: t.min_period_start || 1,
    };
    setForm(f);
    setSavedForm(f);
    const currentCT = classes.find((c) => c.class_teacher_id === t.id);
    setClassTeacherOf(currentCT?.id || '');
    setError('');
    setModal(t);
  }

  async function handleSave() {
    setError('');
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    try {
      const body = {
        ...form,
        allotted_periods: targetForApi(form.targetInput),
      };
      delete body.targetInput;
      let savedTeacher;
      if (modal === 'add') {
        savedTeacher = await api.post('/teachers', body);
      } else {
        savedTeacher = await api.put(`/teachers/${modal.id}`, body);
      }

      // Handle class teacher assignment
      const teacherId = savedTeacher.id;
      const prevCT = modal !== 'add' ? classes.find((c) => c.class_teacher_id === modal.id) : null;

      // Unassign from old class if changed
      if (prevCT && prevCT.id !== classTeacherOf) {
        await api.put(`/classes/${prevCT.id}`, { class_teacher_id: null });
      }
      // Assign to new class (same field as Curriculum → Classes)
      if (classTeacherOf) {
        await api.put(`/classes/${classTeacherOf}`, { class_teacher_id: teacherId });
      }

      if (modal !== 'add') {
        const hint = buildRemindersAfterTeacherAllocFieldsChange({
          teacher: savedTeacher,
          oldForm: savedForm ? { ...savedForm, allotted_periods: targetForApi(savedForm.targetInput) } : null,
          newForm: { ...form, allotted_periods: targetForApi(form.targetInput) },
          allocs,
          classes,
        });
        if (hint) setReminder(hint);
        else if (targetForApi(form.targetInput) !== sumTeacherAlloc(savedTeacher.id, allocs)) {
          setReminder({
            source: 'teachers',
            title: 'Teacher saved — check workload',
            items: [{
              page: 'Allocations',
              link: `/allocations?teacher=${savedTeacher.id}`,
              text: `**${savedTeacher.name}**: target **${targetForApi(form.targetInput) || 'Auto'}** — allocations currently sum to **${sumTeacherAlloc(savedTeacher.id, allocs)}**p.`,
            }, {
              page: 'Allotment',
              link: '/allotment',
              text: 'Then re-run **Allotment** and Apply.',
            }],
          });
        }
      }

      load();
      setModal(null);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    try {
      // Unassign CT if needed
      const ctClass = classes.find((c) => c.class_teacher_id === deleteConfirm.id);
      if (ctClass) await api.put(`/classes/${ctClass.id}`, { class_teacher_id: null });
      await api.delete(`/teachers/${deleteConfirm.id}`);
      setDeleteConfirm(null);
      load();
    } catch (e) { alert(e.message); }
  }

  function toggleSubject(s) {
    setForm((f) => ({
      ...f,
      subjects: f.subjects.includes(s) ? f.subjects.filter((x) => x !== s) : [...f.subjects, s],
    }));
  }

  const capacity = (8 - ((form.min_period_start || 1) - 1)) * 6;
  const targetNum = targetForApi(form.targetInput);
  const filtered = teachers.filter((t) => !search || t.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Teachers</h2>
          <p>{teachers.length} teachers · {classes.filter(c => c.class_teacher_id).length} class teachers assigned</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}><Plus size={14} /> Add Teacher</button>
      </div>

      <div className="toolbar">
        <div className="search-wrap">
          <Search size={13} />
          <input className="search-input" placeholder="Search teachers…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Class Teacher of</th>
              <th>Subjects</th>
              <th>Class Range</th>
              <th>Target</th>
              <th>Starts from</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--mid)', padding: 32 }}>No teachers found.</td></tr>
            )}
            {filtered.map((t) => {
              const ctClass = ctMap[t.id];
              return (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td>
                    {ctClass
                      ? <span className="badge badge-blue" style={{ gap: 4 }}>
                          <GraduationCap size={10} /> Class {ctClass.name}
                        </span>
                      : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {(t.subjects || []).map((s) => (
                        <span key={s} className="badge badge-gray">{s}</span>
                      ))}
                    </div>
                  </td>
                  <td style={{ color: 'var(--mid)' }}>{t.min_class_level}–{t.max_class_level}</td>
                  <td>
                    {(t.allotted_periods || 0) > 0 ? (
                      <span className="badge badge-blue">{t.allotted_periods}p fixed</span>
                    ) : (
                      <span className="badge badge-gray" title={t.allocated_periods ? `Last run: ${t.allocated_periods}p` : undefined}>
                        Auto{t.allocated_periods ? ` (${t.allocated_periods}p)` : ''}
                      </span>
                    )}
                  </td>
                  <td style={{ color: 'var(--mid)', fontSize: 12 }}>P{t.min_period_start || 1}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(t)}><Pencil size={12} /></button>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => setDeleteConfirm(t)}><Trash2 size={12} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Modal */}
      {modal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div className="modal" style={{ maxWidth: 540 }}>
            <h2 className="modal-title">{modal === 'add' ? 'Add Teacher' : `Edit — ${modal.name}`}</h2>
            {error && <div className="alert alert-red"><AlertCircle size={13} />{error}</div>}

            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input className="form-input" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Priya Sharma" autoFocus />
            </div>

            {/* Class Teacher Assignment */}
            <div className="form-group" style={{ padding: '12px', background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <GraduationCap size={13} /> Class Teacher of
              </label>
              <select className="form-select" value={classTeacherOf}
                onChange={(e) => setClassTeacherOf(e.target.value)}>
                <option value="">— Not a class teacher —</option>
                {classes.map((c) => {
                  const currentCT = c.class_teacher_id && c.class_teacher_id !== (modal !== 'add' ? modal.id : undefined);
                  const ctName = currentCT ? teachers.find(t => t.id === c.class_teacher_id)?.name : null;
                  return (
                    <option key={c.id} value={c.id} disabled={!!ctName}>
                      Class {c.name}{ctName ? ` (taken by ${ctName})` : ''}
                    </option>
                  );
                })}
              </select>
              <p className="form-hint">The class teacher is placed at Period 1 when Rule R1 is active.</p>
            </div>

            <div className="form-row" style={{ marginTop: 12 }}>
              <div className="form-group">
                <label className="form-label">Min class level</label>
                <input className="form-input" type="number" min={1} max={10} value={form.min_class_level}
                  onChange={(e) => setForm((f) => ({ ...f, min_class_level: Number(e.target.value) }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Max class level</label>
                <input className="form-input" type="number" min={1} max={10} value={form.max_class_level}
                  onChange={(e) => setForm((f) => ({ ...f, max_class_level: Number(e.target.value) }))} />
              </div>
              <div className="form-group">
                <label className="form-label">
                  Workload target
                  <span style={{ fontWeight: 400, color: 'var(--mid)', marginLeft: 6 }}>(blank = Auto)</span>
                </label>
                <input
                  className="form-input"
                  type="number"
                  min={0}
                  max={288}
                  value={form.targetInput}
                  placeholder="Auto — solver decides"
                  onChange={(e) => setForm((f) => ({ ...f, targetInput: e.target.value }))}
                />
                <p className="form-hint">
                  Enter a number to pin this teacher&apos;s weekly load; leave blank for CP-SAT to balance.
                </p>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Cannot teach before period</label>
              <select className="form-select" value={form.min_period_start}
                onChange={(e) => setForm((f) => ({ ...f, min_period_start: Number(e.target.value) }))}>
                <option value={1}>P1 — no restriction</option>
                <option value={2}>P2 — cannot teach P1</option>
                <option value={3}>P3 — cannot teach P1–P2</option>
                <option value={4}>P4 — cannot teach P1–P3</option>
                <option value={5}>P5 — after break</option>
                <option value={6}>P6</option>
                <option value={7}>P7</option>
                <option value={8}>P8 — last period only</option>
              </select>
              <p className="form-hint">
                Capacity: <strong>{capacity} periods/week</strong>
                {targetNum > capacity && (
                  <span style={{ color: 'var(--red)', marginLeft: 8 }}>⚠ Target exceeds capacity!</span>
                )}
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">Subjects they can teach</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {SUBJECT_OPTIONS.map((s) => (
                  <button key={s} type="button"
                    className={`badge ${form.subjects.includes(s) ? 'badge-blue' : 'badge-gray'}`}
                    style={{ cursor: 'pointer', border: 'none', padding: '4px 10px' }}
                    onClick={() => toggleSubject(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : modal === 'add' ? 'Add Teacher' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setDeleteConfirm(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <h2 className="modal-title">Delete Teacher</h2>
            <p style={{ fontSize: 13, marginBottom: 12 }}>Delete <strong>{deleteConfirm.name}</strong>?</p>
            <div className="alert alert-red">
              <AlertCircle size={14} />
              <div>
                <strong>This also deletes all their subject allocations.</strong><br />
                The affected classes will go short of periods.<br /><br />
                <strong>Safe approach:</strong> Go to Allocations → Swap Teacher first, then delete.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete}>Delete Anyway</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
