import React from 'react';
import { Loader } from 'lucide-react';

/** Full-screen blocking overlay shown during long operations (e.g. allotment). */
export default function LoadingOverlay({ open, title = 'Working…', message }) {
  if (!open) return null;
  return (
    <div className="loading-overlay" role="alert" aria-busy="true">
      <div className="loading-card">
        <div className="loading-spinner"><Loader size={30} className="spinner" /></div>
        <div className="loading-title">{title}</div>
        {message && <div className="loading-message">{message}</div>}
        <div className="loading-bar"><div className="loading-bar-fill" /></div>
      </div>
    </div>
  );
}
