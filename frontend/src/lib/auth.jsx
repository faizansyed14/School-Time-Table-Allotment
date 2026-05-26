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
    if (token && name && !isTokenExpired(token)) {
      setUser({ token, username: name });
    } else if (token) {
      clearStoredSession();
    }
    setLoading(false);
  }, []);

  function login(token, username) {
    localStorage.setItem('erp_token', token);
    localStorage.setItem('erp_username', username);
    setUser({ token, username });
  }

  function logout() {
    localStorage.removeItem('erp_token');
    localStorage.removeItem('erp_username');
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
