import * as XLSX from 'xlsx';
import { sumTeacherAlloc } from './balanceHints.js';

function capacityFor(minPeriodStart) {
  const mp = minPeriodStart || 1;
  return (8 - (mp - 1)) * 6;
}

/**
 * Export Teachers page table to Excel.
 * @param {{ teachers, classes, allocs, filename? }} opts
 */
export function exportTeachersExcel({ teachers, classes, allocs, filename }) {
  const ctMap = Object.fromEntries(
    (classes || []).filter((c) => c.class_teacher_id).map((c) => [c.class_teacher_id, c.name]),
  );
  const date = new Date().toISOString().slice(0, 10);

  const header = [
    'Name',
    'Class teacher of',
    'Subjects',
    'Min class level',
    'Max class level',
    'Target',
    'Target mode',
    'Assigned (allocations)',
    'Timetable periods',
    'Starts from',
    'Max capacity',
  ];

  const rows = (teachers || []).map((t) => {
    const fixed = (t.allotted_periods || 0) > 0;
    const assigned = sumTeacherAlloc(t.id, allocs);
    const mp = t.min_period_start || 1;
    return [
      t.name,
      ctMap[t.id] ? `Class ${ctMap[t.id]}` : '',
      (t.subjects || []).join(', '),
      t.min_class_level ?? 1,
      t.max_class_level ?? 10,
      fixed ? t.allotted_periods : assigned,
      fixed ? 'Fixed' : 'Auto',
      assigned,
      t.allocated_periods || 0,
      `P${mp}`,
      capacityFor(mp),
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([
    ['Teachers'],
    [`Exported ${date} · ${rows.length} teacher${rows.length !== 1 ? 's' : ''}`],
    [],
    header,
    ...rows,
  ]);

  ws['!cols'] = [
    { wch: 22 }, { wch: 16 }, { wch: 36 }, { wch: 14 }, { wch: 14 },
    { wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 14 },
  ];
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: header.length - 1 } },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Teachers');
  XLSX.writeFile(wb, filename || `Teachers-${date}.xlsx`);
}
