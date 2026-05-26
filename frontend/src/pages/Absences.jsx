import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';
import { todayISO, fmtDate } from '../lib/utils.js';
import { Plus, Trash2, UserX, AlertCircle, CheckCircle, ChevronDown, ChevronRight } from 'lucide-react';
import AllotmentIssues from '../components/AllotmentIssues.jsx';
import SubstituteAssignPanel from '../components/SubstituteAssignPanel.jsx';

export default function Absences() {
  const [absences, setAbsences] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [allotment, setAllotment] = useState(null);
  const [date, setDate] = useState(todayISO());
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ teacher_id: '', absent_date: todayISO(), reason: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [subModal, setSubModal] = useState(null);
  const [subCoverage, setSubCoverage] = useState(null);
  const [subLoading, setSubLoading] = useState(false);
  const [subSaving, setSubSaving] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedCoverage, setExpandedCoverage] = useState(null);

  const load = useCallback(() => {
    Promise.all([
      api.get(`/absences?date=${date}`),
      api.get('/teachers'),
      api.get('/teachers/allotment-summary').catch(() => null),
    ])
      .then(([a, t, summary]) => {
        setAbsences(a || []);
        setTeachers(t || []);
        setAllotment(summary);
      })
      .catch(console.error);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  async function fetchCoverage(absence) {
    return api.get(
      `/absences/substitute-coverage?teacher_id=${absence.teacher_id}&date=${absence.absent_date}&absence_id=${absence.id}`,
    );
  }

  async function handleMarkAbsent() {
    setError('');
    if (!form.teacher_id) { setError('Select a teacher.'); return; }
    setSaving(true);
    try {
      await api.post('/absences', form);
      setModal(false);
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!window.confirm('Remove this absence record?')) return;
    try { await api.delete(`/absences/${id}`); load(); }
    catch (e) { alert(e.message); }
  }

  async function openSubstitute(absence) {
    setSubModal(absence);
    setSubCoverage(null);
    setSubLoading(true);
    try {
      setSubCoverage(await fetchCoverage(absence));
    } catch (e) {
      alert(e.message);
      setSubModal(null);
    } finally {
      setSubLoading(false);
    }
  }

  async function toggleExpand(absence) {
    if (expandedId === absence.id) {
      setExpandedId(null);
      setExpandedCoverage(null);
      return;
    }
    setExpandedId(absence.id);
    setExpandedCoverage(null);
    try {
      setExpandedCoverage(await fetchCoverage(absence));
    } catch (e) {
      alert(e.message);
      setExpandedId(null);
    }
  }

  async function assignSub(slot, sub_teacher_id, absence = subModal) {
    if (!sub_teacher_id || !absence) return;
    setSubSaving(true);
    try {
      await api.post(`/absences/${absence.id}/substitute`, {
        timetable_id: slot.id,
        substitute_teacher_id: sub_teacher_id,
      });
      const [freshAbsences, coverage] = await Promise.all([
        api.get(`/absences?date=${date}`),
        fetchCoverage(absence),
      ]);
      setAbsences(freshAbsences || []);
      if (subModal) {
        setSubCoverage(coverage);
        const updated = (freshAbsences || []).find((a) => a.id === absence.id);
        if (updated) setSubModal(updated);
      }
      if (expandedId === absence.id) setExpandedCoverage(coverage);
    } catch (e) { alert(e.message); }
    finally { setSubSaving(false); }
  }

  const alreadyAbsent = new Set(absences.map((a) => a.teacher_id));

  return (
    <div>
      <div className="page-header">
        <div><h2>Absences</h2><p>Mark absent teachers and assign substitutes by class.</p></div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="date" className="form-input" style={{ width: 160 }} value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="btn btn-primary" onClick={() => { setForm({ teacher_id: '', absent_date: date, reason: '' }); setError(''); setModal(true); }}>
            <Plus size={14} /> Mark Absent
          </button>
        </div>
      </div>

      {allotment && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <span style={{ fontWeight: 600, fontSize: 14 }}>Allotment Summary</span>
          </div>
          <div className="card-body">
            <AllotmentIssues allotment={allotment} maxItems={8} />
          </div>
        </div>
      )}

      {absences.length === 0 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--green)', fontWeight: 600, fontSize: 14 }}>
            <CheckCircle size={18} /> All teachers present on {fmtDate(date)}
          </div>
        </div>
      ) : (
        <div className="alert alert-amber" style={{ marginBottom: 16 }}>
          <UserX size={14} /> {absences.length} teacher{absences.length !== 1 ? 's' : ''} absent on {fmtDate(date)}
        </div>
      )}

      {absences.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 16 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Teacher &amp; substitutes</th>
                <th>Date</th>
                <th>Reason</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {absences.map((a) => (
                <React.Fragment key={a.id}>
                  <tr>
                    <td>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleExpand(a)} title="Expand class timetables">
                        {expandedId === a.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{a.teachers?.name}</div>
                      {(a.substitutions || []).length > 0 && expandedId !== a.id && (
                        <div className="absence-sub-list" style={{ marginTop: 4 }}>
                          {(a.substitutions || []).map((s, i) => (
                            <div key={i}>Sub: <b>{s.teachers?.name}</b></div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={{ color: 'var(--mid)' }}>{fmtDate(a.absent_date)}</td>
                    <td style={{ color: 'var(--mid)', fontSize: 12 }}>{a.reason || '—'}</td>
                    <td>
                      {(a.substitutions || []).length > 0 ? (
                        <span className="badge badge-green">{a.substitutions.length} assigned</span>
                      ) : (
                        <span className="badge badge-amber">Assign subs</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-primary btn-sm" onClick={() => openSubstitute(a)}>Assign</button>
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => handleDelete(a.id)}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === a.id && (
                    <tr>
                      <td colSpan={6} style={{ background: 'var(--bg)', padding: 16 }}>
                        {!expandedCoverage ? (
                          <div style={{ color: 'var(--mid)', fontSize: 13 }}>Loading…</div>
                        ) : (
                          <SubstituteAssignPanel
                            coverage={expandedCoverage}
                            absence={a}
                            onAssign={(slot, tid) => assignSub(slot, tid, a)}
                            saving={subSaving}
                          />
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModal(false)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <h2 className="modal-title">Mark Teacher Absent</h2>
            {error && <div className="alert alert-red"><AlertCircle size={13} />{error}</div>}
            <div className="form-group">
              <label className="form-label">Teacher</label>
              <select className="form-select" value={form.teacher_id} onChange={(e) => setForm((f) => ({ ...f, teacher_id: e.target.value }))}>
                <option value="">— select —</option>
                {teachers.filter((t) => !alreadyAbsent.has(t.id)).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Date</label>
              <input type="date" className="form-input" value={form.absent_date} onChange={(e) => setForm((f) => ({ ...f, absent_date: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Reason (optional)</label>
              <input className="form-input" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Sick leave" />
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleMarkAbsent} disabled={saving}>{saving ? 'Saving…' : 'Mark Absent'}</button>
            </div>
          </div>
        </div>
      )}

      {subModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setSubModal(null)}>
          <div className="modal" style={{ maxWidth: 920, maxHeight: '92vh', overflow: 'auto', width: '95vw' }}>
            <h2 className="modal-title">Assign substitutes — {subModal.teachers?.name}</h2>
            <p style={{ fontSize: 12, color: 'var(--mid)', marginBottom: 14 }}>
              {subCoverage?.day_name || '…'} · {fmtDate(subModal.absent_date)}. Each class below needs a sub for the highlighted periods.
            </p>
            {subLoading ? (
              <div style={{ color: 'var(--mid)', marginBottom: 16 }}>Loading classes and available teachers…</div>
            ) : (
              <SubstituteAssignPanel
                coverage={subCoverage}
                absence={subModal}
                onAssign={assignSub}
                saving={subSaving}
              />
            )}
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setSubModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
