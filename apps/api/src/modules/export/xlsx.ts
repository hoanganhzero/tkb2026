import ExcelJS from 'exceljs';
import type { GridPayload } from '../../lib/grid-payload.js';

/**
 * Xuất Excel `timetable_school` / `timetable_class` — tkb_export_design.md §3.
 * Font Times New Roman (máy trường Office cũ), nền màu môn + viền trái đậm,
 * đóng băng tiêu đề, pageSetup A3 ngang fitToWidth cho bản dán bảng tin.
 */

export interface XlsxCell { text: string; sub?: string; bg?: string | null; ln?: string | null }
export interface XlsxGridInput {
  title: string;
  school: string;
  appliedFrom?: string;
  days: string[];
  periodLabels: string[];
  rows: Array<{ label: string; sublabel?: string; cells: Array<XlsxCell | null> }>;
}

const argb = (hex?: string | null) =>
  hex ? ('FF' + hex.replace('#', '').toUpperCase()) : undefined;

/** Đổi payload cột của GET /grid thành input builder — thuần, test được */
export function fromGridPayload(
  p: GridPayload,
  o: { school: string; appliedFrom?: string },
): XlsxGridInput {
  const P = p.dict.periods.length;
  const dayCount = Math.min(p.dict.days.length, 6);
  const rows = p.dict.classes.map((c, ci) => {
    const cells: Array<XlsxCell | null> = [];
    for (let s = 0; s < dayCount * P; s++) {
      // tìm lesson của lớp này ở slot s
      let found: number | null = null;
      for (let i = 0; i < p.lessons.count; i++) {
        if (p.lessons.class[i] === ci && p.lessons.slot[i] === s && p.lessons.flags[i] >= 0) { found = i; break; }
      }
      if (found === null) { cells.push(null); continue; }
      const subj = p.dict.subjects[p.lessons.subject[found]];
      const tea = p.dict.teachers[p.lessons.teacher[found]];
      cells.push({
        text: subj?.short ?? '',
        sub: tea?.short ?? '',
        bg: subj ? p.dict.palette[subj.color] : null,
        ln: null,
      });
    }
    return { label: c.name, sublabel: undefined, cells };
  });

  return {
    title: `THỜI KHÓA BIỂU — ${p.timetable.name}`,
    school: o.school,
    appliedFrom: o.appliedFrom,
    days: p.dict.days.map((d) => ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'CN'][(d - 1) % 7]),
    periodLabels: p.dict.periods.map((_, i) => String((i % P) + 1)),
    rows,
  };
}

export async function buildTimetableSchoolXlsx(input: XlsxGridInput): Promise<Buffer> {  const wb = new ExcelJS.Workbook();
  wb.creator = 'TKB Vietnam';
  const ws = wb.addWorksheet('TKB', {
    views: [{ state: 'frozen', ySplit: 6 }],
    pageSetup: { paperSize: 8 /*A3*/, orientation: 'landscape', fitToPage: true, fitToWidth: 1 } as any,
  });

  const P = input.periodLabels.length;
  const totalCols = 1 + input.days.length * P;
  ws.columns = [{ width: 10 }, ...Array.from({ length: totalCols - 1 }, () => ({ width: 9.5 }))];

  // Tiêu đề thể thức
  ws.mergeCells(1, 1, 1, totalCols);
  ws.getCell(1, 1).value = input.title;
  ws.getCell(1, 1).font = { name: 'Times New Roman', size: 14, bold: true };
  ws.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' };

  ws.mergeCells(2, 1, 2, totalCols);
  ws.getCell(2, 1).value = input.school;
  ws.getCell(2, 1).font = { name: 'Times New Roman', size: 12 };

  if (input.appliedFrom) {
    ws.mergeCells(3, 1, 3, totalCols);
    ws.getCell(3, 1).value = `Áp dụng từ ${input.appliedFrom}`;
    ws.getCell(3, 1).font = { name: 'Times New Roman', size: 11, italic: true };
    ws.getCell(3, 1).alignment = { horizontal: 'center' };
  }

  // Hàng ngày + hàng tiết
  const dayRowIdx = 5, perRowIdx = 6, dataStart = 7;
  ws.getRow(dayRowIdx).getCell(1).value = 'LỚP';
  ws.getRow(perRowIdx).getCell(1).value = '';
  for (let d = 0; d < input.days.length; d++) {
    const c0 = 2 + d * P;
    ws.mergeCells(dayRowIdx, c0, dayRowIdx, c0 + P - 1);
    const dh = ws.getRow(dayRowIdx).getCell(c0);
    dh.value = input.days[d].toUpperCase();
    dh.alignment = { horizontal: 'center' };
    dh.font = { bold: true };
    for (let p = 0; p < P; p++) {
      const ph = ws.getRow(perRowIdx).getCell(c0 + p);
      ph.value = Number(input.periodLabels[p] ?? p + 1);
      ph.font = { size: 9 };
      ph.alignment = { horizontal: 'center' };
    }
  }

  // Dữ liệu
  input.rows.forEach((r, ri) => {
    const row = ws.getRow(dataStart + ri);
    row.getCell(1).value = r.label;
    r.cells.forEach((cell, idx) => {
      const target = row.getCell(2 + idx);
      if (!cell) return;
      target.value = cell.sub ? `${cell.text}\n${cell.sub}` : cell.text;
      target.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      target.font = { name: 'Times New Roman', size: 10, bold: !cell.sub };
      const fill = argb(cell.bg);
      if (fill) target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      const ln = argb(cell.ln ?? '#8A93A3');
      if (ln) target.border = { left: { style: 'medium', color: { argb: ln } } };
    });
    void row;
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

/* ================= Báo cáo dạng bảng (assignments · workload · …) ================= */

export interface XlsxTableInput {
  title: string;
  school: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  /** Cột số có định dạng có điều kiện: >0 tô đỏ (vượt định mức), <0 xanh */
  deltaColIndex?: number;
}

export async function buildTableXlsx(input: XlsxTableInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TKB Vietnam';
  const ws = wb.addWorksheet('Báo cáo', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { paperSize: 9 /*A4*/, orientation: 'portrait', fitToWidth: 1 } as any,
  });

  ws.columns = input.headers.map((h) => ({ width: Math.max(10, h.length + 4) }));

  ws.mergeCells(1, 1, 1, input.headers.length);
  ws.getCell(1, 1).value = input.title;
  ws.getCell(1, 1).font = { name: 'Times New Roman', size: 13, bold: true };

  ws.mergeCells(2, 1, 2, input.headers.length);
  ws.getCell(2, 1).value = input.school;
  ws.getCell(2, 1).font = { name: 'Times New Roman', size: 11 };

  const headerRow = ws.getRow(4);
  input.headers.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
    headerRow.getCell(i + 1).font = { name: 'Times New Roman', size: 10, bold: true };
    headerRow.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid',
      fgColor: { argb: 'FFDCE8FB' } };
  });

  input.rows.forEach((r, ri) => {
    const row = ws.getRow(5 + ri);
    r.forEach((v, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = v;
      cell.font = { name: 'Times New Roman', size: 10 };
      if (input.deltaColIndex !== undefined && ci === input.deltaColIndex && typeof v === 'number') {
        if (v > 0) cell.font = { color: { argb: 'FFC43D3D' }, size: 10, bold: true };
        else if (v < 0) cell.font = { color: { argb: 'FF2F9E68' }, size: 10 };
      }
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
