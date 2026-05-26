import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ListChecks } from 'lucide-react';

const STORAGE_KEY = 'erp_balance_reminder';
const BalanceReminderContext = createContext(null);

function loadStored() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function BalanceReminderProvider({ children }) {
  const [reminder, setReminderState] = useState(loadStored);

  const setReminder = useCallback((r) => {
    setReminderState(r);
    if (r) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(r));
    else sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  const clearReminder = useCallback(() => setReminder(null), [setReminder]);

  return (
    <BalanceReminderContext.Provider value={{ reminder, setReminder, clearReminder }}>
      {children}
    </BalanceReminderContext.Provider>
  );
}

export function useBalanceReminder() {
  const ctx = useContext(BalanceReminderContext);
  if (!ctx) throw new Error('useBalanceReminder requires BalanceReminderProvider');
  return ctx;
}

export function BalanceReminderBanner() {
  const { reminder, clearReminder } = useBalanceReminder();
  const navigate = useNavigate();
  if (!reminder?.items?.length) return null;

  return (
    <div className="balance-reminder-banner" role="status">
      <div className="balance-reminder-header">
        <ListChecks size={16} />
        <div>
          <strong>{reminder.title}</strong>
          <span className="balance-reminder-sub">Same change must be reflected in Curriculum, Teachers, and Allocations (48p per class, 720p school-wide).</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clearReminder} aria-label="Dismiss checklist">
          <X size={14} />
        </button>
      </div>
      <ol className="balance-reminder-list">
        {reminder.items.map((item, i) => (
          <li key={`${item.page}-${i}`}>
            <span dangerouslySetInnerHTML={{ __html: formatBold(item.text) }} />
            {item.link && (
              <button
                type="button"
                className="balance-reminder-link"
                onClick={() => navigate(item.link)}
              >
                Open {item.page} →
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function formatBold(text) {
  return text.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}
