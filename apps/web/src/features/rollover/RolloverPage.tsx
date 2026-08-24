import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { rolloverPreview, listYears, type RolloverPreview, type YearRow } from '@/lib/api';

/**
 * Wizard chuyển tiếp năm học — shell 6 bước (rollover doc).
 * Bước 4 (Lớp) + 5 (Phân công) hiển thị PREVIEW thật từ API; nút Áp dụng
 * đang khoá chờ POST /apply (gaps #7 — transaction 9 bước).
 */

const STEPS = ['Năm học', 'Danh mục', 'Giáo viên', 'Lớp', 'Phân công', 'Tổng kết'];

export default function RolloverPage() {
  const { truong: school = '' } = useParams();
  const [step, setStep] = useState(3); // hiện tập trung bước Lớp/Phân công
  void setStep; // wizard đầy đủ sẽ điều hướng step
  const [years, setYears] = useState<YearRow[]>([]);
  const [fromYearId, setFromYearId] = useState('');
  const [shuffleGrades, setShuffleGrades] = useState('');
  const [intakeCount, setIntakeCount] = useState(16);
  const [intakePattern, setIntakePattern] = useState('10A#');
  const [mode, setMode] = useState<'followClass' | 'keepGrade'>('followClass');
  const [preview, setPreview] = useState<RolloverPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadedYears, setLoadedYears] = useState(false);

  if (!loadedYears) {
    setLoadedYears(true);
    listYears(school).then((ys) => {
      setYears(ys);
      const active = ys.find((y) => y.isActive) ?? ys[0];
      if (active) setFromYearId(active.id);
    }).catch((e) => setErr(String(e)));
  }

  async function runPreview() {
    setLoading(true); setErr(null);
    try {
      const r = await rolloverPreview(school, {
        fromYearId, shuffleGrades, intakeCount, intakePattern, mode
      });
      setPreview(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const counts = preview
    ? preview.mappings.reduce((acc, m) => { acc[m.action] = (acc[m.action] ?? 0) + 1; return acc; },
        {} as Record<string, number>)
    : null;
  const warnKinds = preview
    ? preview.warnings.reduce((acc, w) => { acc[w.kind] = (acc[w.kind] ?? 0) + 1; return acc; },
        {} as Record<string, number>)
    : null;

  return (
    <div className="flex h-full flex-col overflow-auto p-5">
      {/* Step indicator */}
      <ol className="mb-5 flex gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li key={label}
              className={`rounded-full px-3 py-1 font-semibold ${i === step ? 'bg-brand-600 text-white' : 'bg-sunken text-ink-2'}`}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      <h2 className="mb-1 text-lg font-extrabold">Chuẩn bị năm học mới</h2>
      <p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-ink-2">
        Mang khung tiết, môn, phòng, giáo viên và lịch bận cố định sang năm mới.
        Bạn sẽ rà soát bảng ánh xạ lớp và phân công trước khi áp dụng.
        Mất khoảng 10 phút.
      </p>

      <div className="grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-solid bg-surface p-4">
          <h3 className="mb-2 text-sm font-bold">Tuỳ chọn</h3>
          <label className="mb-1 block text-xs font-semibold">Năm học nguồn</label>
          <select value={fromYearId} onChange={(e) => setFromYearId(e.target.value)}
                  className="mb-3 w-full rounded border border-solid px-2 py-1.5 text-sm">
            {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>

          <label className="mb-1 block text-xs font-semibold">Khối xáo trộn lớp (CSV số)</label>
          <input value={shuffleGrades} onChange={(e) => setShuffleGrades(e.target.value)}
                 placeholder="VD: 10"
                 className="mb-3 w-full rounded border border-solid px-2 py-1.5 font-data text-sm" />

          <div className="mb-3 grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-semibold">Số lớp tuyển mới</label>
              <input type="number" min={1} max={30} value={intakeCount}
                     onChange={(e) => setIntakeCount(Number(e.target.value))}
                     className="w-full rounded border border-solid px-2 py-1.5 font-data text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Mẫu tên (# = số)</label>
              <input value={intakePattern} onChange={(e) => setIntakePattern(e.target.value)}
                     className="w-full rounded border border-solid px-2 py-1.5 font-data text-sm" />
            </div>
          </div>

          <label className="mb-1 block text-xs font-semibold">Cách mang phân công</label>
          <div className="flex gap-2 text-sm">
            <label className="flex items-center gap-1">
              <input type="radio" checked={mode === 'followClass'}
                     onChange={() => setMode('followClass')} /> GV theo lớp lên
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={mode === 'keepGrade'}
                     onChange={() => setMode('keepGrade')} /> GV giữ khối
            </label>
          </div>

          <button onClick={runPreview} disabled={!fromYearId || loading}
                  className="mt-4 w-full rounded-md bg-brand-600 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
            {loading ? 'Đang tính…' : 'Xem trước ánh xạ'}
          </button>
        </div>

        <div className="rounded-lg border border-solid bg-surface p-4">
          <h3 className="mb-2 text-sm font-bold">Kết quả xem trước</h3>
          {!preview && <p className="text-[13px] text-ink-3">Chưa chạy xem trước.</p>}
          {preview && (
            <>
              <p className="mb-2 text-[13px]">
                Nguồn: <b>{preview.sourceYear}</b> · khối {preview.span.first}–{preview.span.last}
              </p>
              <ul className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 font-data text-[12px]">
                <li>promote: {counts?.promote ?? 0}</li>
                <li>graduate: {counts?.graduate ?? 0}</li>
                <li>create: {counts?.create ?? 0}</li>
                <li>skip (xáo trộn): {counts?.skip ?? 0}</li>
              </ul>

              <h4 className="mb-1 text-xs font-bold">Phân công sẽ mang sang ({mode === 'followClass' ? 'theo lớp lên' : 'giữ khối'})</h4>
              <p className="mb-2 font-data text-[12px] text-ink-2">{preview.assignments.items.length} phân công</p>

              <h4 className="mb-1 text-xs font-bold">
                Cảnh báo {warnKinds ? `(${Object.values(warnKinds).reduce((a, b) => a + b, 0)})` : ''}
              </h4>
              {Object.keys(warnKinds ?? {}).length === 0 && <p className="text-[12px] text-ok-line">Không có cảnh báo.</p>}
              <ul className="mb-2 list-inside list-disc text-[12px] text-warn-line">
                {Object.entries(warnKinds ?? {}).map(([k, n]) => <li key={k}>{k}: {n}</li>)}
              </ul>

              <button disabled title="Cần POST /apply — gaps #7"
                      className="mt-2 w-full cursor-not-allowed rounded-md bg-brand-600 py-2 text-sm font-bold text-white opacity-50">
                Áp dụng chuyển tiếp (chờ endpoint)
              </button>
            </>
          )}
        </div>
      </div>

      {err && <p className="mt-3 max-w-4xl rounded bg-block-bg px-3 py-2 text-[13px] text-block-line">{err}</p>}
    </div>
  );
}
