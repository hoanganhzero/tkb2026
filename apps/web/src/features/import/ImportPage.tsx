import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { authHeaders } from '@/lib/api';

/**
 * Nhập giáo viên từ Excel — 3 bước (excel_import §6):
 *   1. Dán TSV / chọn file .xlsx — client parse + tự tìm dòng tiêu đề
 *   2. Xem trước: server validate bằng import-core, hiện lỗi/cảnh báo,
 *      cho tick bỏ dòng lỗi
 *   3. Commit upsert theo mã GV — không commit khi còn error
 */

interface ParsedRow { row: number; values: Record<string, unknown>; excluded?: boolean }
interface Issue { level: 'error'|'warning'|'info'; row: number; message: string }

function parseTsv(text: string): unknown[][] {
  return text.trim().split(/\r?\n/).map((line) => line.split('\t'));
}

async function parseXlsx(file: File): Promise<unknown[][]> {
  // Dynamic import: exceljs (~350KB gzip) chỉ tải khi người dùng thật sự chọn file
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer() as any);
  const ws = wb.worksheets[0];
  const rows: unknown[][] = [];
  ws.eachRow((row) => {
    const vals: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => { vals[col - 1] = cell.value; });
    rows.push(vals);
  });
  return rows;
}

function normalizeKey(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const HEADER_DICT: Record<string, string> = {
  hovaten: 'full_name', hoten: 'full_name', tengiaovien: 'full_name',
  magv: 'code', ma: 'code', sott: 'code', stt: 'code',
  tobomon: 'department', to: 'department',
  mondayduoc: 'subjects', monday: 'subjects',
  sotiettoida: 'max_periods', dinhmuc: 'max_periods', sotiettuan: 'max_periods',
  email: 'email', dienthoai: 'phone', sdt: 'phone',
  gioitinh: 'gender'
};

export default function ImportPage() {
  const { truong: school = '' } = useParams();
  const [step, setStep] = useState(1);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const raw = f.name.endsWith('.csv')
        ? parseTsv(await f.text())
        : await parseXlsx(f);
      extract(raw);
    } catch (ex) {
      setErr('Không đọc được file: ' + String(ex));
    }
  }

  function handlePaste() { extract(parseTsv(pasteText)); }

  function extract(matrix: unknown[][]) {
    try {
      // Tìm dòng tiêu đề: khớp >=2 cột theo từ điển (excel_import §3.1)
      let headerIdx = -1, best = 0;
      for (let r = 0; r < Math.min(matrix.length, 15); r++) {
        const score = matrix[r].filter((c) => HEADER_DICT[normalizeKey(String(c ?? ''))]).length;
        if (score > best) { best = score; headerIdx = r; }
      }
      if (best < 2) throw new Error('Không tìm thấy dòng tiêu đề — hãy dán bảng có cột Họ và tên / Mã GV…');

      const headers = matrix[headerIdx].map((c) => HEADER_DICT[normalizeKey(String(c ?? '')) ?? ''] ?? null);
      const parsed: ParsedRow[] = [];
      for (let r = headerIdx + 1; r < matrix.length; r++) {
        const cells = matrix[r];
        if (cells.every((c) => String(c ?? '').trim() === '')) continue;
        const firstCell = normalizeKey(String(cells[0] ?? ''));
        if (/^(tong|cong|tongcong)$/.test(firstCell)) continue;   // dòng Tổng
        const values: Record<string, unknown> = {};
        headers.forEach((field, ci) => {
          if (field && cells[ci] !== undefined && String(cells[ci] ?? '').trim() !== '') {
            values[field] = cells[ci];
          }
        });
        parsed.push({ row: r + 1, values });
      }
      setRows(parsed);
      setResult(null);
      setStep(2);
      void runValidate(parsed);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    }
  }

  async function resolveYearId(): Promise<string> {
    const res = await fetch(`/v1/schools/${school}/years`, { headers: authHeaders() });
    const b = await res.json();
    const y = (b?.data ?? []).find((x: any) => x.isActive) ?? (b?.data ?? [])[0];
    if (!y?.id) throw new Error('Chưa có năm học.');
    return y.id;
  }

  async function runValidate(list: ParsedRow[]) {
    setBusy(true); setErr(null);
    try {
      const yid = await resolveYearId();
      const res = await fetch(`/v1/schools/${school}/years/${yid}/imports/teachers/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ rows: list.filter((r) => !r.excluded) })
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.error?.message ?? 'Validate thất bại');
      setIssues(b.data ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true); setErr(null);
    try {
      const yid = await resolveYearId();
      const res = await fetch(`/v1/schools/${school}/years/${yid}/imports/teachers/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ mode: 'upsert', rows: rows.filter((r) => !r.excluded) })
      });
      const b = await res.json();
      if (!res.ok || !b.committed) {
        throw new Error(b?.errors?.[0]?.message ?? 'Commit bị chặn do còn lỗi.');
      }
      setResult({ created: b.created, updated: b.updated });
      setStep(3);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');

  return (
    <div className="h-full overflow-auto p-5">
      <ol className="mb-5 flex gap-2 text-xs">
        {['Nguồn dữ liệu', 'Xem trước & sửa', 'Nhập'].map((label, i) => (
          <li key={label}
              className={`rounded-full px-3 py-1 font-semibold ${i + 1 === step ? 'bg-brand-600 text-white' : 'bg-sunken text-ink-2'}`}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {err && <p className="mb-3 max-w-3xl rounded bg-block-bg px-3 py-2 text-[13px] text-block-line">{err}</p>}

      {/* ===== Bước 1 ===== */}
      <section className={`max-w-3xl rounded-lg border border-solid bg-surface p-4 ${step !== 1 && 'hidden'}`}>
        <h2 className="mb-2 text-sm font-bold">Bước 1 · Dán bảng hoặc chọn file</h2>
        <input type="file" accept=".xlsx,.csv" onChange={handleFile}
               className="mb-3 block text-sm" />
        <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)}
                  placeholder={'Mã GV\tHọ và tên\tSố tiết tối đa/tuần\nGV001\tNguyễn Văn Hùng\t19'}
                  className="mb-3 h-40 w-full rounded border border-solid p-2 font-mono text-xs" />
        <button onClick={handlePaste} disabled={!pasteText.trim()}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
          Phân tích dữ liệu dán
        </button>
      </section>

      {/* ===== Bước 2 ===== */}
      <section className={`max-w-4xl rounded-lg border border-solid bg-surface p-4 ${step !== 2 && 'hidden'}`}>
        <h2 className="mb-2 text-sm font-bold">Bước 2 · Kiểm tra trước khi nhập</h2>
        <p className="mb-3 text-[13px] text-ink-2">
          Đã đọc <b>{rows.length}</b> dòng ·{' '}
          <span className="text-block-line">{errors.length} lỗi</span> ·{' '}
          <span className="text-warn-line">{warnings.length} cảnh báo</span>.
          Tick "Bỏ" các dòng lỗi nếu muốn nhập phần còn lại trước.
        </p>

        {issues.length > 0 && (
          <ul className="mb-3 max-h-40 overflow-auto rounded border border-hair bg-app p-2 text-[12px] leading-snug">
            {issues.map((i, k) => (
              <li key={k} className={i.level === 'error' ? 'text-block-line' : i.level === 'warning' ? 'text-warn-line' : 'text-ink-3'}>
                Dòng {i.row}: {i.message}
              </li>
            ))}
          </ul>
        )}

        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-app text-left">
              <th className="border border-hair p-1.5">Bỏ</th>
              <th className="border border-hair p-1.5">Dòng</th>
              <th className="border border-hair p-1.5">Mã GV</th>
              <th className="border border-hair p-1.5">Họ và tên</th>
              <th className="border border-hair p-1.5">Định mức</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, k) => (
              <tr key={k} className={r.excluded ? 'opacity-40' : ''}>
                <td className="border border-hair p-1 text-center">
                  <input type="checkbox" checked={!!r.excluded}
                         onChange={(e) => setRows(rows.map((x, j) => j === k ? { ...x, excluded: e.target.checked } : x))} />
                </td>
                <td className="border border-hair p-1.5 font-data">{r.row}</td>
                <td className="border border-hair p-1.5 font-data">{String(r.values.code ?? '')}</td>
                <td className="border border-hair p-1.5">{String(r.values.full_name ?? '')}</td>
                <td className="border border-hair p-1.5 font-data">{String(r.values.max_periods ?? '')}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 flex gap-2">
          <button onClick={() => setStep(1)} className="rounded border border-solid px-3 py-1.5 text-sm hover:bg-hover">← Quay lại</button>
          <button onClick={() => runValidate(rows)} disabled={busy}
                  className="rounded border border-solid px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-50">
            Kiểm tra lại
          </button>
          <button onClick={commit} disabled={busy}
                  className="ml-auto rounded-md bg-brand-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
            {busy ? 'Đang xử lý…' : `Nhập ${rows.filter((r) => !r.excluded).length} dòng`}
          </button>
        </div>
      </section>

      {/* ===== Bước 3 ===== */}
      <section className={`max-w-3xl rounded-lg border border-solid bg-ok-bg p-5 ${step !== 3 && 'hidden'}`}>
        <h2 className="mb-2 text-base font-bold text-ok-line">Nhập thành công</h2>
        {result && (
          <p className="text-[14px]">
            Tạo mới <b className="font-data">{result.created}</b> giáo viên ·
            cập nhật <b className="font-data">{result.updated}</b>.
          </p>
        )}
        <p className="mt-2 text-[13px] text-ink-2">
          Bước tiếp theo: kiểm tra lịch bận của giáo viên, rồi xếp thời khoá biểu.
        </p>
        <button onClick={() => { setRows([]); setIssues([]); setResult(null); setPasteText(''); setStep(1); }}
                className="mt-3 rounded-md bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">
          Nhập lô khác
        </button>
      </section>
    </div>
  );
}
