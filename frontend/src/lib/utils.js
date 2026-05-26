export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

export const SUBJECT_OPTIONS = [
  'English', 'Hindi', 'Maths', 'E.V.S', 'S.St', 'Science',
  'G.K.', 'Drawing', 'Computer', 'Sanskrit', 'Games', 'Library', 'I.T.', 'Diary',
];

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function clsx(...args) {
  return args.filter(Boolean).join(' ');
}
