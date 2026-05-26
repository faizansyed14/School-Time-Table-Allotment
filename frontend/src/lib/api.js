import { checkAuthResponse } from './session.js';

export function getToken() { return localStorage.getItem('erp_token') || ''; }
function token() { return getToken(); }

/** Set on Render static site: VITE_API_URL=https://your-api.onrender.com (no trailing slash) */
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

/** Full URL for /api/... — use for fetch() outside api.* helpers */
export function apiUrl(path) {
  const p = path.startsWith('/api') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`;
  return `${API_BASE}${p}`;
}

async function request(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(apiUrl(path.startsWith('/') ? path : `/${path}`), opts);
  const data = await res.json().catch(() => ({}));
  if (checkAuthResponse(res)) throw new Error('Session expired — please sign in again');
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  get:    (path)        => request('GET',    path),
  post:   (path, body)  => request('POST',   path, body),
  put:    (path, body)  => request('PUT',    path, body),
  patch:  (path, body)  => request('PATCH',  path, body),
  delete: (path)        => request('DELETE', path),
};
