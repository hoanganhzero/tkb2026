import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { authHeaders, listYears, type YearRow } from '@/lib/api';

/**
 * CRUD danh mục chung cho 6 resource — dùng endpoints
 * /schools/:sid/years/:yid/{resource} (catalog module).
 * Cấu hình cột hiển thị/form tối giản theo resource.
 */

type Resource = 'grades' | 'departments' | 'subjects' | 'rooms' | 'teachers' | 'classes';

interface FieldDef {
  key: string; label: string; type?: 'text' | 'number';
  required?: boolean;
}

const CONFIG: Record<Resource, { title: string; fields: FieldDef[] }> = {
  grades: { title: 'Khối lớp', fields: [
    { key: 'name', label: 'Tên', required: true },
    { key: 'ordinal', label: 'Thứ tự', type: 'number', required: true }
  ]},
  departments: { title: 'Tổ bộ môn', fields: [{ key: 'name', label: 'Tên', required: true }] },
  subjects: { title: 'Môn học', fields: [
    { key: 'code', label: 'Mã', required: true },
    { key: 'name', label: 'Tên môn', required: true },
    { key: 'short_name', label: 'Viết tắt', required: true },
    { key: 'difficulty', label: 'Độ khó 1-5', type: 'number' }
  ]},
  rooms: { title: 'Phòng học', fields: [
    { key: 'code', label: 'Mã', required: true },
    { key: 'name', label: 'Tên', required: true }
  ]},
  teachers: { title: 'Giáo viên', fields: [
    { key: 'code', label: 'Mã GV', required: true },
    { key: 'full_name', label: 'Họ và tên', required: true },
    { key: 'max_periods_per_week', label: 'Định mức/tuần', type: 'number' }
  ]},
  classes: { title: 'Lớp học', fields: [
    { key: 'name', label: 'Tên lớp', required: true },
    { key: 'grade_id', label: 'Grade ID (uuid)', required: true },
    { key: 'size', label: 'Sĩ số', type: 'number' }
  ]}
};
const RESOURCES = Object.keys(CONFIG) as Resource[];

export default function DanhMucPage() {
  const { truong: school = '' } = useParams();
  const [year, setYear] = useState<YearRow | null>(null);
  const [resource, setResource] = useState<Resource>('subjects');
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const def = CONFIG[resource];

  useEffect(() => {
    listYears(school).then((ys) => {
      setYear(ys.find((y) => y.isActive) ?? ys[0] ?? null);
    }).catch((e) => setErr(String(e)));
  }, [school]);

  async function reload() {
    if (!year) return;
    setErr(null);
    try {
      const res = await fetch(`/v1/schools/${school}/years/${year.id}/${resource}`, { headers: authHeaders() });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.error?.message ?? 'Lỗi tải danh mục');
      setRows(b.data ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [year, resource]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!year) return;
    setErr(null); setMsg(null);
    const payload: Record<string, unknown> = {};
    for (const f of def.fields) {
      const v = form[f.key];
      if (v === undefined || v === '') continue;
      payload[f.key] = f.type === 'number' ? Number(v) : v;
    }
    const res = await fetch(`/v1/schools/${school}/years/${year.id}/${resource}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload)
    });
    const b = await res.json();
    if (!res.ok) { setErr(b?.error?.message ?? 'Tạo thất bại'); return; }
    setMsg('Đã tạo.');
    setForm({});
    void reload();
  }

  async function remove(id: string) {
    if (!year) return;
    const res = await fetch(`/v1/schools/${school}/years/${year.id}/${resource}/${id}`, {
      method: 'DELETE', headers: authHeaders()
    });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(b?.error?.message ?? 'Xoá thất bại'); return; }
    void reload();
  }

  return (
    <div className="h-full overflow-auto p-5">
      <h2 className="mb-3 text-lg font-extrabold">Danh mục</h2>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={resource}
                onChange={(e) => { setResource(e.target.value as Resource); setForm({}); }}
                className="rounded border border-solid px-2 py-1.5 text-sm">
          {RESOURCES.map((r) => <option key={r} value={r}>{CONFIG[r].title}</option>)}
        </select>
        {year && <span className="font-data text-xs text-ink-2">năm {year.name}</span>}
        <button onClick={() => void reload()}
                className="rounded border border-solid px-2.5 py-1 text-xs hover:bg-hover">Tải lại</button>
      </div>

      {err && <p className="mb-3 rounded bg-block-bg px-3 py-2 text-[13px] text-block-line">{err}</p>}
      {msg && <p className="mb-3 rounded bg-ok-bg px-3 py-2 text-[13px] text-ok-line">{msg}</p>}

      {/* Form tạo */}
      <form onSubmit={create} className="mb-5 flex flex-wrap items-end gap-2 rounded-lg border border-solid bg-surface p-3">
        {def.fields.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-0.5 block text-[11px] font-semibold text-ink-2">{f.label}{f.required && '*'}</span>
            <input
              value={form[f.key] ?? ''}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              type={f.type === 'number' ? 'number' : 'text'}
              className={`w-40 rounded border px-2 py-1.5 text-sm ${f.required && !form[f.key] ? 'border-block-line' : 'border-solid'}`}
            />
          </label>
        ))}
        <button className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">
          + Thêm
        </button>
      </form>

      {/* Bảng danh sách */}
      <table className="w-full max-w-4xl border-collapse bg-surface text-[13px]">
        <thead>
          <tr className="bg-app text-left">
            {def.fields.map((f) => (
              <th key={f.key} className="border border-hair p-1.5 text-xs font-bold">{f.label}</th>
            ))}
            <th className="border border-hair p-1.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-hover">
              {def.fields.map((f) => (
                <td key={f.key} className="border border-hair p-1.5">{String(row[f.key] ?? '')}</td>
              ))}
              <td className="border border-hair p-1 text-center">
                <button onClick={() => remove(row.id)}
                        className="rounded px-1.5 py-0.5 text-xs text-block-line hover:bg-block-bg">Xoá</button>
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={def.fields.length + 1} className="border border-hair p-3 text-center text-ink-3">
              Chưa có dữ liệu — thêm dòng đầu tiên ở form trên hoặc nhập từ Excel.
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
