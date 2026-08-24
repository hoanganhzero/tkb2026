import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  listYears, listPeriods, listTeachers, fetchWorkload,
  getAvailability, putAvailability,
  type AvSlot, type PeriodRow, type TeacherListRow
} from '@/lib/api';

/**
 * Lưới bận/rảnh giáo viên — design spec §8.
 * 4 trạng thái ô (rảnh/bận/ưu tiên/hạn chế) · quét nhanh theo mẫu ·
 * cảnh báo cam khi ô rảnh < 2× số tiết phải dạy · PUT ghi đè toàn bộ.
 */

const PREF_ORDER = ['available', 'busy', 'preferred', 'avoid'] as const;
type Pref = typeof PREF_ORDER[number];
const PREF_STYLE: Record<Pref, string> = {
  available: 'bg-surface',
  busy: 'bg-block-bg text-block-line',
  preferred: 'bg-ok-bg text-ok-line',
  avoid: 'bg-warn-bg text-warn-line',
};
const PREF_LABEL: Record<Pref, string> = {
  available: 'Rảnh', busy: 'Bận', preferred: 'Ưu tiên', avoid: 'Hạn chế',
};
const DAY_NAMES = ['', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Sáu', 'Chủ nhật'];

export default function AvailabilityPage() {
  const { truong: school = '' } = useParams();
  const [yearId, setYearId] = useState('');
  const [teachers, setTeachers] = useState<TeacherListRow[]>([]);
  const [teacherId, setTeacherId] = useState('');
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [grid, setGrid] = useState<Map<string, Pref>>(new Map());
  const [assigned, setAssigned] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const years = await listYears(school);
        const y = years.find((x) => x.isActive) ?? years[0];
        if (!y) throw new Error('Chưa có năm học — hãy tạo năm học trước.');
        setYearId(y.id);
        if (y.activeDays?.length) setDays(y.activeDays);

        const [ps, ts] = await Promise.all([
          listPeriods(school, y.id),
          listTeachers(school, y.id)
        ]);
        setPeriods(ps);
        setTeachers(ts);
        if (ts[0]) setTeacherId(ts[0].id);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [school]);

  useEffect(() => {
    if (!yearId || !teacherId) return;
    (async () => {
      try {
        const slots = await getAvailability(school, yearId, teacherId);
        const m = new Map<string, Pref>();
        for (const s of slots) m.set(`${s.dayOfWeek}|${s.periodId}`, s.preference as Pref);
        setGrid(m);
        const wl = await fetchWorkload(school, yearId).catch(() => []);
        const me = wl.find((w) => w.teacher_id === teacherId);
        setAssigned(me ? Number(me.assigned) : null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [school, yearId, teacherId]);

  const keyOf = (d: number, p: PeriodRow) => `${d}|${p.id}`;
  const prefAt = (d: number, p: PeriodRow): Pref =>
    grid.get(keyOf(d, p)) ?? 'available';

  function cycle(d: number, p: PeriodRow) {
    const k = keyOf(d, p);
    const cur = prefAt(d, p);
    const next = PREF_ORDER[(PREF_ORDER.indexOf(cur) + 1) % PREF_ORDER.length];
    const g = new Map(grid);
    if (next === 'available') g.delete(k); else g.set(k, next);
    setGrid(g);
  }

  function applyQuick(kind: 'sat' | 'morningOnly' | 'clear') {
    const g = new Map(grid);
    for (const d of days) {
      for (const p of periods) {
        const isSat = d === 6;
        const isAfternoon = p.session === 'afternoon';
        let target: Pref = 'available';
        if (kind === 'sat' && isSat) target = 'busy';
        if (kind === 'morningOnly' && isAfternoon) target = 'busy';
        const k = `${d}|${p.id}`;
        if (target === 'available') g.delete(k); else g.set(k, target);
      }
    }
    setGrid(g);
  }

  async function save() {
    setBusy(true); setErr(null);
    try {
      const slots: AvSlot[] = [];
      for (const [k, pref] of grid) {
        if (pref === 'available') continue;
        const [dow, pid] = k.split('|');
        slots.push({ dayOfWeek: Number(dow), periodId: pid, preference: pref });
      }
      await putAvailability(school, yearId, teacherId, slots);
      setMsg('Đã lưu lịch bận.');
      setTimeout(() => setMsg(null), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const [busySaving, setBusy] = useState(false);

  const morning = periods.filter((p) => p.session === 'morning');
  const afternoon = periods.filter((p) => p.session === 'afternoon');
  const totalCells = days.length * periods.length;
  const busyCount = [...grid.values()].filter((v) => v === 'busy').length;
  const freeSlots = totalCells - busyCount;

  return (
    <div className="flex h-full flex-col overflow-auto p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-[15px] font-bold">Lịch bận giáo viên</h2>
        <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}
                className="rounded-md border border-solid px-2 py-1.5 text-sm">
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>{t.shortName || t.fullName}</option>
          ))}
        </select>
        <span className="text-xs text-ink-2">
          Đang bận <b className="font-data">{busyCount}/{totalCells}</b> ô
          {assigned !== null && (
            freeSlots < assigned * 2
              ? <span className="ml-2 font-semibold text-warn-line">⚠ còn {freeSlots} ô rảnh cho {assigned} tiết — nguy cơ không xếp đủ</span>
              : <span> · cần {assigned} tiết</span>
          )}
        </span>
        <button onClick={() => applyQuick('sat')}
                className="rounded border border-solid px-2.5 py-1 text-xs hover:bg-hover">Nghỉ Thứ Bảy</button>
        <button onClick={() => applyQuick('morningOnly')}
                className="rounded border border-solid px-2.5 py-1 text-xs hover:bg-hover">Chỉ dạy buổi sáng</button>
        <button onClick={() => applyQuick('clear')}
                className="rounded border border-solid px-2.5 py-1 text-xs hover:bg-hover">Xoá hết</button>
        <button onClick={save} disabled={busySaving || !teacherId}
                className="ml-auto rounded-md bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {busySaving ? 'Đang lưu…' : 'Lưu lịch bận'}
        </button>
      </div>

      {msg && <p className="mb-2 rounded bg-ok-bg px-3 py-1.5 text-[13px] text-ok-line">{msg}</p>}
      {err && <p className="mb-2 rounded bg-block-bg px-3 py-1.5 text-[13px] text-block-line">{err}</p>}

      <table className="border-collapse bg-surface text-[13px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 w-28 border-b border-r border-solid bg-surface" />
            {days.map((d) => (
              <th key={d} className="h-9 border-b border-solid bg-surface px-2 text-left text-xs font-bold">
                {DAY_NAMES[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[['Sáng', morning], ['Chiều', afternoon]].map(([label, list]) => (
            (list as PeriodRow[]).map((p, idx) => (
              <tr key={p.id}>
                {idx === 0 && (
                  <th rowSpan={(list as PeriodRow[]).length}
                      className="sticky left-0 z-10 border-r border-solid bg-surface px-2 text-right align-middle text-[11px] font-bold uppercase tracking-wide text-ink-3">
                    {label as string}
                  </th>
                )}
                {days.map((d) => {
                  const pref = prefAt(d, p);
                  return (
                    <td key={keyOf(d, p)} onClick={() => cycle(d, p)}
                        title={`${DAY_NAMES[d]} ${p.name}: ${PREF_LABEL[pref]} (click để đổi)`}
                        className={`h-10 w-24 cursor-pointer select-none border-b border-hair pl-2 text-[11px] font-semibold ${PREF_STYLE[pref]} ${(d === days[days.length - 1]) ? 'border-r-2 border-r-strong' : ''}`}>
                      {pref !== 'available' ? PREF_LABEL[pref] : ''}
                    </td>
                  );
                })}
              </tr>
            ))
          ))}
        </tbody>
      </table>

      <p className="mt-3 text-xs text-ink-3">
        Click từng ô để đổi: Rảnh → Bận → Ưu tiên → Hạn chế. Ô "Bận" chặn cứng bộ xếp lịch;
        "Ưu tiên/Hạn chế" chỉ ảnh hưởng điểm mềm.
      </p>
    </div>
  );
}
