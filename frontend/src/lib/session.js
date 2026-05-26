let onSessionCleared = null;

/** AuthProvider registers this so 401 clears React state and Guard redirects. */
export function registerSessionClear(fn) {
  onSessionCleared = fn;
}

export function clearStoredSession() {
  localStorage.removeItem('erp_token');
  localStorage.removeItem('erp_username');
}

export function isTokenExpired(token) {
  if (!token) return true;
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(b64));
    return !exp || exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

export function handleUnauthorized() {
  clearStoredSession();
  if (onSessionCleared) onSessionCleared();
  else window.location.replace('/login');
}

/**
 * Expired/invalid Bearer token on protected routes — clear session and redirect.
 * @param {boolean} hadAuth — pass false for login (401 = bad password, not session expiry)
 * @returns {boolean}
 */
export function checkAuthResponse(res, { hadAuth = true } = {}) {
  if (res.status !== 401) return false;
  if (hadAuth) handleUnauthorized();
  return true;
}
