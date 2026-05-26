import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { apiUrl } from '../lib/api.js';
import { GraduationCap, Loader } from 'lucide-react';

export default function Login() {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const username = String(fd.get('username') ?? form.username).trim();
    const password = String(fd.get('password') ?? form.password);
    if (!username || !password) {
      setError('Username and password required');
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(apiUrl('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Login failed');
      login(data.token, data.username);
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{ background: 'var(--dark)', borderRadius: 8, padding: 8, display: 'flex' }}>
            <GraduationCap size={18} color="#fff" />
          </div>
          <div>
            <h1>School ERP</h1>
            <p style={{ margin: 0 }}>Sign in to your account</p>
          </div>
        </div>

        {error && <div className="alert alert-red">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Username</label>
            <input
              className="form-input"
              name="username"
              autoComplete="username"
              autoFocus
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              placeholder="admin"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              name="password"
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="••••••••"
            />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 4 }} type="submit" disabled={loading}>
            {loading ? <><Loader size={13} className="spinner" /> Signing in…</> : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
