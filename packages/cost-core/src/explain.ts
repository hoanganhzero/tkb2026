import { TimetableState } from './state.ts';
import { W } from './types.ts';
import type { MoveExplanation, NameResolver, Reason } from './types.ts';

/**
 * explainMove — MỘT nguồn sự thật cho tooltip đèn giao thông (client),
 * toast sau khi thả (client) và delta.violations của PATCH /lessons/:id/move
 * (server). Hai bên không được tự viết lại logic.
 *
 * Yêu cầu: toSlot phải thoả canPlace() (ô hợp lệ về ràng buộc cứng).
 *
 * Bất biến được golden test kiểm chứng: tổng penalty của các lý do BẰNG delta.
 */
export function explainMove(
  state: TimetableState,
  li: number,
  toSlot: number,
  names: NameResolver,
): MoveExplanation {
  if (!state.canPlace(li, toSlot)) {
    throw new Error('explainMove: toSlot phải thoả canPlace()');
  }
  const pr = state.problem;
  const aid = pr.lessonAssignment[li];
  const a = pr.assignments[aid];
  const day = Math.floor(toSlot / state.periodsPerDay);
  const pos = toSlot % state.periodsPerDay;
  const reasons: Reason[] = [];
  let explained = 0;

  /** Đặt tạm tiết vào toSlot để đo lường, xong khôi phục nguyên trạng. */
  const probe = <T,>(fn: () => T): T => {
    const saved = state.slots[li];
    if (saved >= 0) state.unplace(li);
    state.place(li, toSlot);
    try {
      return fn();
    } finally {
      state.unplace(li);
      if (saved >= 0) state.place(li, saved);
    }
  };

  /* S8 — ô hạn chế xếp */
  const maskWord = a.avoidMask ? a.avoidMask[toSlot >>> 5] : undefined;
  if (maskWord !== undefined && (maskWord & (1 << (toSlot & 31))) !== 0) {
    reasons.push({
      code: 'S8',
      text: `Ô ${names.dayName(day)} tiết ${pos + 1} được đánh dấu hạn chế xếp`,
      penalty: W.S8_SLOT_PREFERENCE,
    });
    explained += W.S8_SLOT_PREFERENCE;
  }

  /* Nhóm (lớp, ngày): S4 trùng môn · S5 môn khó muộn · S1 tiết trống lớp */
  for (const c of a.classes) {
    const before = state.unitCDParts(c, day);
    const after = probe(() => state.unitCDParts(c, day));

    if (after.s4 > before.s4) {
      const same = probe(() => state.classSameSubjectDay(c, a.subject, day));
      reasons.push({
        code: 'S4',
        text: `${names.className(c)} sẽ có ${same} tiết ${names.subjectName(a.subject)} trong ${names.dayName(day)}`,
        penalty: after.s4 - before.s4,
      });
      explained += after.s4 - before.s4;
    }
    if (after.s5 > before.s5) {
      reasons.push({
        code: 'S5',
        text: `${names.subjectName(a.subject)} xếp vào tiết ${pos + 1}, muộn trong buổi`,
        penalty: after.s5 - before.s5,
      });
      explained += after.s5 - before.s5;
    }
    if (after.gap > before.gap) {
      reasons.push({
        code: 'S1',
        text: `Tạo tiết trống cho ${names.className(c)} ${names.dayName(day)}`,
        penalty: after.gap - before.gap,
      });
      explained += after.gap - before.gap;
    }
  }

  /* Nhóm (GV, ngày): S6 vượt định mức · S2 tiết trống lịch dạy */
  for (const t of a.teachers) {
    const before = state.unitTDParts(t, day);
    const after = probe(() => state.unitTDParts(t, day));

    if (after.overload > before.overload) {
      reasons.push({
        code: 'S6',
        text: `${names.teacherName(t)} sẽ dạy quá định mức tiết/ngày`,
        penalty: after.overload - before.overload,
      });
      explained += after.overload - before.overload;
    }
    if (after.gap > before.gap) {
      reasons.push({
        code: 'S2',
        text: `Tạo tiết trống trong lịch dạy của ${names.teacherName(t)} ${names.dayName(day)}`,
        penalty: after.gap - before.gap,
      });
      explained += after.gap - before.gap;
    }
  }

  /* S3 — GV đến trường thêm ngày */
  for (const t of a.teachers) {
    const usedBefore = countUsedDays(state, t);
    const [usedAfter, loadAfter] = probe(() => [countUsedDays(state, t), teacherTotal(state, t)]);
    if (usedAfter <= usedBefore) continue;
    const maxPd = pr.teacherMaxPerDay?.[t] ?? 6;
    const fair = Math.max(1, Math.ceil(loadAfter / maxPd));
    const extra = Math.max(0, usedAfter - fair) - Math.max(0, usedBefore - fair);
    if (extra > 0) {
      reasons.push({
        code: 'S3',
        text: `${names.teacherName(t)} phải đến trường thêm vào ${names.dayName(day)}`,
        penalty: W.S3_TEACHER_DAYS * extra,
      });
      explained += W.S3_TEACHER_DAYS * extra;
    }
  }

  /* S9 — môn chưa rải đều trong tuần */
  const csKey = a.classes[0] * pr.numSubjects + a.subject;
  const csBefore = state.unitCS(csKey);
  const csAfter = probe(() => state.unitCS(csKey));
  if (csAfter > csBefore) {
    reasons.push({
      code: 'S9',
      text: `${names.subjectName(a.subject)} chưa được rải đều trong tuần`,
      penalty: csAfter - csBefore,
    });
    explained += csAfter - csBefore;
  }

  /* S12 — tiết đôi bị tách / nối lại */
  const partner = pr.lessonPair?.[li] ?? -1;
  if (partner >= 0) {
    const smaller = Math.min(li, partner);
    const pBefore = state.pairPenalty(smaller);
    const pAfter = probe(() => state.pairPenalty(smaller));
    const d = pAfter - pBefore;
    if (d !== 0) {
      reasons.push({
        code: 'S12',
        text: d > 0
          ? 'Tiết đôi không còn liền kề trong cùng buổi'
          : 'Hai nửa tiết đôi được nối liền lại',
        penalty: d,
      });
      explained += d;
    }
  }

  const delta = state.deltaMove(li, toSlot);
  return { delta, reasons };
}

function countUsedDays(state: TimetableState, t: number): number {
  let used = 0;
  for (let d = 0; d < state.days; d++) if (state.teacherDayCount(t, d) > 0) used++;
  return used;
}

function teacherTotal(state: TimetableState, t: number): number {
  let n = 0;
  for (let d = 0; d < state.days; d++) n += state.teacherDayCount(t, d);
  return n;
}
