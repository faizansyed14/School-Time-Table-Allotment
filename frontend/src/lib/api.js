import { checkAuthResponse } from './session.js';

export function getToken() { return localStorage.getItem('erp_token') || ''; }
function token() { return getToken(); }

/** Render static site: VITE_API_URL=https://your-api.onrender.com (no trailing slash) */
export function getApiBase() {
  const fromEnv = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (typeof window !== 'undefined' && window.__ERP_API_URL__) {
    return String(window.__ERP_API_URL__).replace(/\/$/, '');
  }
  return '';
}

/** Full URL for /api/... — use for fetch() outside api.* helpers */
export function apiUrl(path) {
  const p = path.startsWith('/api') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`;
  return `${getApiBase()}${p}`;
}

export function apiConfigError() {
  if (import.meta.env.DEV) return null;
  if (getApiBase()) return null;
  return 'API URL not set. On Render static site add VITE_API_URL (your backend URL) and redeploy.';
}

/** Fetch a fresh captcha (image + id). Called after the password is entered. */
export async function getCaptchaApi() {
  const cfgErr = apiConfigError();
  if (cfgErr) throw new Error(cfgErr);
  const res = await fetch(apiUrl('/auth/captcha'), { method: 'GET' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Could not load captcha (HTTP ${res.status})`);
  return data; // { captcha_id, image }
}

async function postAuth(path, payload, failMsg) {
  const cfgErr = apiConfigError();
  if (cfgErr) throw new Error(cfgErr);

  const url = apiUrl(path);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 90000);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('API timed out (server may be waking up). Wait a minute and try again.');
    }
    throw new Error(`Cannot reach API at ${url}. Check VITE_API_URL and that the backend is live.`);
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${failMsg} (HTTP ${res.status})`);
  return data;
}

/** Step 1 — verify username + password. Returns { challenge, captcha:{captcha_id,image} }. */
export async function verifyPasswordApi(username, password) {
  return postAuth('/auth/password',
    { username: String(username), password: String(password) },
    'Sign in failed');
}

/** Step 2 — verify captcha against the challenge from step 1. Returns { token, username, role }. */
export async function loginApi({ challenge, captcha_id, captcha_text }) {
  return postAuth('/auth/login',
    { challenge: String(challenge || ''), captcha_id: String(captcha_id || ''), captcha_text: String(captcha_text || '') },
    'Login failed');
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
  if (checkAuthResponse(res, { hadAuth: Boolean(token()) })) {
    throw new Error('Session expired — please sign in again');
  }
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
