import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useGridStore, canUndo } from './useGridStore';
import { slotKey } from '@/lib/api';

const DAY_NAMES = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/**
 * Màn hình xếp TKB — trái tim sản phẩm (design spec §6).
 * v1 khung: chế độ "theo lớp", HTML5 drag (sẽ thay bằng @dnd-kit/core),
 * đèn giao thông 3 màu tính tại dragstart qua @tkb/cost-core,
 * hoàn tác Ctrl+Z theo lệnh.
 */
export default function GridPage() {
  const { id = 'demo' } = useParams();
  const {
    payload, byId, cell, lights, error, load,
    beginDrag, endDrag, commitMove, undo, select, selected
  } = useGridStore();

  const [, forceTick] = useState(0);
  useEffect(() => { void load(id); }, [id, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (canUndo()) void undo().then(() => forceTick((t) => t + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  if (error) {
    return <div className="m-4 rounded-md bg-block-bg px-4 py-3 text-sm text-block-line">{error}</div>;
  }
  if (!payload) return <div className="p-4 text-sm text-ink-2">Đang tải lưới…</div>;

  const dict = payload.dict;
  const P = dict.periods.length;
  const days = Math.min(dict.days.length, 6);

  function onDrop(e: DragEvent, cls: number, slot: number) {
    e.preventDefault();
    const lessonId = e.dataTransfer.getData('text/lesson');
    if (!lessonId) { endDrag(); return; }
    const target = cell.get(slotKey(cls, slot));
    if (target && target !== lessonId) {
      // Hoán đổi chưa có ở khung đầu — API spec §4.6 yêu cầu delete-reinsert
      endDrag();
      alert('Hoán đổi hai tiết sẽ được bổ sung sau khi có endpoint swap (api spec §4.6).');
      return;
    }
    void commitMove(lessonId, slot).then(() => forceTick((t) => t + 1));
    endDrag();
  }

  function lightClass(cls: number, slot: number): string {
    if (!lights || lights.cls !== cls) return '';
    if (lights.block.has(slot)) return 'bg-block-bg cursor-not-allowed';
    if (lights.warn.has(slot)) return 'bg-warn-bg';
    if (lights.ok.has(slot)) return 'bg-ok-bg';
    return '';
  }

  let placedCount = 0;
  for (const l of byId.values()) if (l.slot >= 0) placedCount++;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-11 flex-none items-center gap-2 border-b border-solid bg-surface px-3">
        <span className="text-xs font-semibold text-ink-3">Xem theo</span>
        <span className="rounded bg-sunken px-2.5 py-1 text-[13px] font-semibold">Lớp</span>
        <span className="mx-2 h-5 w-px bg-solid" />
        <button onClick={() => { if (canUndo()) void undo().then(() => forceTick((t) => t + 1)); }}
                disabled={!canUndo()}
                className="rounded border border-solid px-2.5 py-1 text-[13px] font-medium hover:bg-hover disabled:opacity-40">
          ↶ Hoàn tác
        </button>
        <span className="ml-auto font-data text-xs text-ink-2">
          Đã xếp <b>{placedCount}/{byId.size}</b> · phiên bản <b>v{payload.timetable.version}</b>
        </span>
      </div>

      {error && (
        <div className="border-b border-solid bg-block-bg px-4 py-2 text-[13px] text-block-line">{error}</div>
      )}

      {/* Lưới */}
      <div className="min-h-0 flex-1 overflow-auto bg-surface" tabIndex={0}>
        <table className="w-max border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 w-24 border-b border-r border-solid bg-surface" />
              {Array.from({ length: days }, (_, d) => (
                <th key={d} colSpan={P}
                    className={`sticky top-0 z-10 h-11 border-b border-solid bg-surface px-2 text-left text-xs font-bold ${d > 0 ? 'border-l' : ''}`}>
                  {DAY_NAMES[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dict.classes.map((c, ci) => (
              <tr key={c.id}>
                <th className="sticky left-0 z-10 h-[46px] border-b border-r border-solid bg-surface px-2 text-left align-middle">
                  <b className="block text-[13px] leading-tight">{c.name}</b>
                  <small className="font-data text-[10.5px] text-ink-3">{placedInRow(ci, byId)}/26</small>
                </th>
                {Array.from({ length: days * P }, (_, s) => {
                  const lessonId = cell.get(slotKey(ci, s));
                  const lesson = lessonId ? byId.get(lessonId)! : null;
                  const subj = lesson ? dict.subjects[lesson.subject] : null;
                  const isDraggingSource = lights && lesson && lesson.slot === s && lights.cls === ci;
                  return (
                    <td key={s}
                        className={`h-[46px] w-[92px] border-b border-hair align-top ${(s % P) === P - 1 ? 'border-r-2 border-r-strong' : 'border-r border-hair'} ${lightClass(ci, s)} ${selected === slotKey(ci, s) ? 'outline outline-2 outline-brand-600' : ''}`}
                        onClick={() => select(slotKey(ci, s))}
                        onDragOver={(e) => { if (lights) e.preventDefault(); }}
                        onDrop={(e) => onDrop(e, ci, s)}
                    >
                      {lesson && subj ? (
                        <div draggable={!isDraggingSource}
                             onDragStart={(e) => {
                               e.dataTransfer.setData('text/lesson', lesson.id);
                               e.dataTransfer.effectAllowed = 'move';
                               beginDrag(lesson.id);
                             }}
                             onDragEnd={() => endDrag()}
                             className={`relative m-px h-[calc(100%-2px)] overflow-hidden rounded pr-1 pl-2 leading-tight ${isDraggingSource ? 'opacity-30' : ''}`}
                             style={{ background: dict.palette[subj.color] ?? '#EEE' }}>
                          <i className="absolute inset-y-0 left-0 w-[3px]"
                             style={{ background: 'rgba(0,0,0,.35)' }} />
                          <b className="block truncate text-cell font-semibold">{subj.short}</b>
                          <span className="block truncate text-[10.5px] leading-tight text-ink-2">
                            {dict.teachers[lesson.teacher]?.short ?? ''}
                          </span>
                          {(lesson.flags & 1) !== 0 && (
                            <span title="Đã ghim" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-pin" />
                          )}
                        </div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tooltip lý do cho ô vàng khi đang kéo */}
      {lights && lights.reasons.size > 0 && (
        <div className="max-h-32 flex-none overflow-auto border-t border-solid bg-warn-bg px-4 py-2 text-[12px] leading-snug text-ink">
          {[...lights.reasons.entries()].slice(0, 3).map(([slot, rs]) => (
            <div key={slot}>
              {rs.map((r, k) => <span key={k}>{k > 0 && ' · '}{r.text} (+{r.penalty})</span>)}
            </div>
          ))}
        </div>
      )}

      {/* Thanh trạng thái */}
      <div className="flex h-8 flex-none items-center gap-4 border-t border-solid bg-surface px-3 text-xs text-ink-2">
        <span>Chế độ xem: Lớp</span>
        <span>Kéo tiết để đổi chỗ — xanh đặt được, vàng mất điểm, đỏ bị chặn</span>
        <span className="ml-auto font-data">Ctrl+Z hoàn tác</span>
      </div>
    </div>
  );
}

function placedInRow(ci: number, byId: Map<string, { cls: number; slot: number }>): number {
  let n = 0;
  for (const l of byId.values()) if (l.cls === ci && l.slot >= 0) n++;
  return n;
}
