import { create } from 'zustand';
import { TimetableState, explainMove, W } from '@tkb/cost-core';
import type { ProblemInput, Reason } from '@tkb/cost-core';
import { fetchGrid, patchMove, slotKey } from '@/lib/api';
import type { GridPayload } from '@/lib/api';

/**
 * Ba điểm hiệu năng bắt buộc (design spec §16):
 * 1. Lưới KHÔNG nằm trong React state phẳng — Map tra cứu O(1), mỗi LessonCell
 *    subscribe đúng khoá của nó.
 * 2. Đèn giao thông tính MỘT LẦN tại dragstart thành ba Set — dragover chỉ lookup.
 * 3. Ngăn xếp hoàn tác lưu LỆNH (op), không snapshot.
 */

export interface Lesson {
  id: string; slot: number; subject: number; cls: number;
  teacher: number; room: number; flags: number;
}

export interface Lights {
  cls: number;
  ok: Set<number>;
  warn: Set<number>;
  block: Set<number>;
  reasons: Map<number, Reason[]>;
}

interface GridStore {
  payload: GridPayload | null;
  byId: Map<string, Lesson>;
  cell: Map<string, string>;          // `${cls}:${slot}` -> lessonId
  version: number;
  lights: Lights | null;
  holding: string | null;             // lessonId đang "cầm" bằng bàn phím
  selected: string | null;            // slotKey đang chọn
  error: string | null;

  load(id: string): Promise<void>;
  beginDrag(lessonId: string): void;
  endDrag(): void;
  commitMove(lessonId: string, toSlot: number): Promise<void>;
  undo(): Promise<void>;
  select(key: string | null): void;
  pickDrop(): Promise<void>;
}

let probeState: TimetableState | null = null;
const lessonIndexOf = new Map<string, number>();

function buildProblem(payload: GridPayload, byId: Map<string, Lesson>): ProblemInput {
  const lessons = [...byId.values()];
  lessonIndexOf.clear();
  const assignments: import('@tkb/cost-core').AssignmentInput[] = [];
  const lessonAssignment: number[] = [];
  lessons.forEach((l, i) => {
    lessonIndexOf.set(l.id, i);
    assignments.push({
      classes: [l.cls],
      teachers: l.teacher >= 0 ? [l.teacher] : [],
      subject: l.subject,
      difficulty: 1,
      maxPerDay: 1
    });
    lessonAssignment.push(i);
  });
  return {
    days: payload.dict.days.length,
    periodsPerDay: payload.dict.periods.length,
    numClasses: payload.dict.classes.length,
    numTeachers: Math.max(1, payload.dict.teachers.length),
    numSubjects: Math.max(1, payload.dict.subjects.length),
    assignments,
    lessonAssignment
  };
}

function namesOf(payload: GridPayload) {
  return {
    className: (c: number) => payload.dict.classes[c]?.name ?? '?',
    teacherName: (t: number) => payload.dict.teachers[t]?.name ?? '?',
    subjectName: (s: number) => payload.dict.subjects[s]?.name ?? '?',
    dayName: (d: number) => ['Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy','Chủ nhật'][d] ?? '?'
  };
}

export const useGridStore = create<GridStore>((set, get) => ({
  payload: null,
  byId: new Map(),
  cell: new Map(),
  version: 0,
  lights: null,
  holding: null,
  selected: null,
  error: null,

  async load(id) {
    try {
      const payload = await fetchGrid(id);
      const byId = new Map<string, Lesson>();
      const cell = new Map<string, string>();
      for (let i = 0; i < payload.lessons.count; i++) {
        const l: Lesson = {
          id: payload.lessons.id[i],
          slot: payload.lessons.slot[i],
          subject: payload.lessons.subject[i],
          cls: payload.lessons.class[i],
          teacher: payload.lessons.teacher[i],
          room: payload.lessons.room[i],
          flags: payload.lessons.flags[i]
        };
        byId.set(l.id, l);
        if (l.slot >= 0) cell.set(slotKey(l.cls, l.slot), l.id);
      }
      set({ payload, byId, cell, version: payload.timetable.version, error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  /** ★ Tính toàn bộ ma trận đèn MỘT LẦN ngay tại dragstart (§6.4). */
  beginDrag(lessonId) {
    const { payload, byId } = get();
    if (!payload || !byId.has(lessonId)) return;
    probeState = new TimetableState(buildProblem(payload, byId));
    for (const l of byId.values()) {
      const idx = lessonIndexOf.get(l.id)!;
      if (l.slot >= 0) probeState.place(idx, l.slot);
    }
    probeState.recomputeAll();

    const li = lessonIndexOf.get(lessonId)!;
    const cls = byId.get(lessonId)!.cls;
    const names = namesOf(payload);
    const lights: Lights = { cls, ok: new Set(), warn: new Set(), block: new Set(), reasons: new Map() };
    for (let s = 0; s < probeState.S(); s++) {
      if (!probeState.canPlace(li, s)) { lights.block.add(s); continue; }
      const ex = explainMove(probeState, li, s, names);
      if (ex.delta > 0) { lights.warn.add(s); lights.reasons.set(s, ex.reasons); }
      else lights.ok.add(s);
    }
    set({ lights });
  },

  endDrag() {
    probeState = null;
    set({ lights: null, holding: null });
  },

  async commitMove(lessonId, toSlot) {
    const { payload, byId } = get();
    if (!payload || !payload.timetable || !byId.has(lessonId)) return;
    const l = byId.get(lessonId)!;
    const fromSlot = l.slot;

    // Optimistic
    const cell = new Map(get().cell);
    if (fromSlot >= 0) cell.delete(slotKey(l.cls, fromSlot));
    cell.set(slotKey(l.cls, toSlot), lessonId);
    byId.set(lessonId, { ...l, slot: toSlot });
    set({ cell, byId: new Map(byId), lights: null, holding: null });

    // Hoàn tác phía client lưu LỆNH — undoStack nằm trong module scope (điểm 3)
    undoStack.push({ lessonId, from: fromSlot, to: toSlot });

    const res = await patchMove(lessonId, toSlot, payload.dict, get().version);
    if (!res.ok) {
      // Revert
      const c2 = new Map(get().cell);
      c2.delete(slotKey(l.cls, toSlot));
      if (fromSlot >= 0) c2.set(slotKey(l.cls, fromSlot), lessonId);
      byId.set(lessonId, { ...l, slot: fromSlot });
      undoStack.pop();
      set({ cell: c2, byId: new Map(byId), error: res.message });
      return;
    }
    set({ version: res.result.timetable.version });
  },

  async undo() {
    const op = undoStack.pop();
    if (!op) return;
    await get().commitMove(op.lessonId, op.from);
    undoStack.pop(); // commitMove vừa push op ngược lại — bỏ để stack đúng nghĩa hoàn tác
  },

  select(key) { set({ selected: key }); },

  async pickDrop() {
    const { selected, holding, cell } = get();
    if (!selected) return;
    const [c, s] = selected.split(':').map(Number);
    const occupant = cell.get(selected);
    if (!holding && occupant) { set({ holding: occupant }); get().beginDrag(occupant); return; }
    if (holding) {
      await get().commitMove(holding, c === undefined ? Number(s) : s);
    }
  }
}));

interface MoveOp { lessonId: string; from: number; to: number }
const undoStack: MoveOp[] = [];

export function canUndo() { return undoStack.length > 0; }
export const WEIGHTS_REFLECTED = W; // nhắc rằng trọng số đến từ cost-core
