import * as XLSX from 'xlsx';
import { DAYS, PERIODS } from './utils.js';

function sanitizeFilename(name) {
  return String(name || 'export').replace(/[\\/:*?"<>|]/g, '-').trim() || 'export';
}

function cellsFromGrid(gridRows) {
  const cells = {};
  (gridRows || []).forEach((r) => {
    cells[`${r.day}-${r.period}`] = r;
  });
  return cells;
}

function exportWeeklyGridExcel({ title, sheetName, headerRow, buildCell, filename }) {
  const header = ['Period', ...DAYS];
  const body = PERIODS.map((p) => {
    const row = [`P${p}`];
    DAYS.forEach((_, di) => {
      row.push(buildCell(di + 1, p) || '');
    });
    return row;
  });

  const ws = XLSX.utils.aoa_to_sheet([
    [title],
    [],
    headerRow || header,
    ...body,
  ]);
  ws['!cols'] = [{ wch: 10 }, ...DAYS.map(() => ({ wch: 22 }))];
  if (ws['!merges']) ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: DAYS.length } });
  else ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: DAYS.length } }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename);
}

/** Class view: rows = subject + teacher (+ optional sub line). */
export function exportClassTimetableExcel({ className, gridRows, subBySlot, filename }) {
  const cells = cellsFromGrid(gridRows);
  const date = new Date().toISOString().slice(0, 10);
  const safeName = sanitizeFilename(className);

  exportWeeklyGridExcel({
    title: `Class ${className} — Weekly Timetable`,
    sheetName: `Class ${safeName}`,
    buildCell: (day, period) => {
      const cell = cells[`${day}-${period}`];
      if (!cell) return '';
      const lines = [cell.subject, cell.teachers?.name || ''].filter(Boolean);
      if (subBySlot?.[cell.id]) lines.push(`Sub: ${subBySlot[cell.id]}`);
      return lines.join('\n');
    },
    filename: filename || `Class-${safeName}-Timetable-${date}.xlsx`,
  });
}

/** Teacher view: rows = class + subject. */
export function exportTeacherTimetableExcel({ teacherName, gridRows, filename }) {
  const cells = cellsFromGrid(gridRows);
  const date = new Date().toISOString().slice(0, 10);
  const safeName = sanitizeFilename(teacherName);

  exportWeeklyGridExcel({
    title: `${teacherName} — Weekly Timetable`,
    sheetName: safeName.slice(0, 31),
    buildCell: (day, period) => {
      const cell = cells[`${day}-${period}`];
      if (!cell) return '';
      return [cell.classes?.name, cell.subject].filter(Boolean).join('\n');
    },
    filename: filename || `Teacher-${safeName}-Timetable-${date}.xlsx`,
  });
}
