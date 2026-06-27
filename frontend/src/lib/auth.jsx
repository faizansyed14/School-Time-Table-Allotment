import React, { createContext, useContext, useState, useEffect } from 'react';
import { registerSessionClear, clearStoredSession, isTokenExpired } from './session.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    registerSessionClear(() => setUser(null));
    const token = localStorage.getItem('erp_token');
    const name  = localStorage.getItem('erp_username');
    const role  = localStorage.getItem('erp_role') || 'user';
    if (token && name && !isTokenExpired(token)) {
      setUser({ token, username: name, role });
    } else if (token) {
      clearStoredSession();
    }
    setLoading(false);
  }, []);

  function login(token, username, role = 'user') {
    localStorage.setItem('erp_token', token);
    localStorage.setItem('erp_username', username);
    localStorage.setItem('erp_role', role);
    setUser({ token, username, role });
  }

  function logout() {
    localStorage.removeItem('erp_token');
    localStorage.removeItem('erp_username');
    localStorage.removeItem('erp_role');
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
