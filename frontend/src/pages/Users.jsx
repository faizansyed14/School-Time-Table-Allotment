import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Plus, Pencil, Trash2, ShieldAlert } from 'lucide-react';

const ROLES = ['admin', 'user'];

export default function Users() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [modal, setModal] = useState(null); // 'add' | userObject
  const [form, setForm] = useState({ username: '', password: '', role: 'user' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const load = useCallback(() => {
    api.get('/users').then(setUsers).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (user?.role !== 'admin') {
    return (
      <div className="page-header">
        <div className="alert alert-red" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ShieldAlert size={16} /> Admin access required.
        </div>
      </div>
    );
  }

  function openAdd() {
    setForm({ username: '', password: '', role: 'user' });
    setError(''); setModal('add');
  }
  function openEdit(u) {
    setForm({ username: u.username, password: '', role: u.role });
    setError(''); setModal(u);
  }

  async function handleSave() {
    setError(''); setSaving(true);
    try {
      if (modal === 'add') {
        await api.post('/users', form);
      } else {
        const payload = { username: form.username, role: form.role };
        if (form.password) payload.password = form.password;
        await api.put(`/users/${modal.id}`, payload);
      }
      setModal(null);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    try {
      await api.delete(`/users/${id}`);
      setDeleteId(null);
      load();
    } catch (e) {
      setError(e.message);
      setDeleteId(null);
    }
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Users</h2>
        <button className="btn btn-primary" onClick={openAdd}>
          <Plus size={14} /> Add User
        </button>
      </div>

      {error && !modal && <div className="alert alert-red">{error}</div>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th style={{ width: 120 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>
                  <span className={`badge ${u.role === 'admin' ? 'badge-gray' : 'badge-gray'}`}>{u.role}</span>
                </td>
                <td>
                  <button className="btn btn-sm" onClick={() => openEdit(u)} title="Edit">
                    <Pencil size={13} />
                  </button>
                  {u.id !== user.id && u.username !== user.username && (
                    <button
                      className="btn btn-sm"
                      style={{ marginLeft: 6 }}
                      onClick={() => setDeleteId(u.id)}
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={3} style={{ color: 'var(--muted)' }}>No users yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{modal === 'add' ? 'Add User' : `Edit ${modal.username}`}</h3>
            {error && <div className="alert alert-red">{error}</div>}
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                className="form-input"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="username"
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                Password {modal !== 'add' && <span style={{ color: 'var(--muted)' }}>(leave blank to keep)</span>}
              </label>
              <input
                className="form-input"
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Role</label>
              <select
                className="form-input"
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              >
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete user?</h3>
            <p>This action cannot be undone.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => setDeleteId(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => handleDelete(deleteId)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
