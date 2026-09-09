import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, server: { middlewareMode: true } });
const { placementError, scheduleConflicts } = await vite.ssrLoadModule("/app/tkb-console.tsx");

after(async () => vite.close());

const profile = {
  schoolName: "Trường kiểm thử", schoolYear: "2026-2027",
  campuses: [], grades: [{ name: "10", order: 1 }], rooms: [{ code: "P1", name: "Phòng 1", type: "Phòng học" }],
  periods: [
    { name: "Tiết 1", session: "Sáng", order: 1, time: "7h00-7h45" },
    { name: "Tiết 2", session: "Sáng", order: 2, time: "7h45-8h30" },
  ],
  teachers: [
    { code: "GV1", name: "Giáo viên A", shortName: "A", subjects: ["Toán"], grades: ["10"], campuses: [], maxPeriods: 19, busy: [] },
    { code: "GV2", name: "Giáo viên B", shortName: "B", subjects: ["Toán"], grades: ["10"], campuses: [], maxPeriods: 19, busy: [] },
  ],
  classes: [
    { name: "10A1", grade: "10", campus: "", sessions: ["Sáng"], size: 30 },
    { name: "10A2", grade: "10", campus: "", sessions: ["Sáng"], size: 30 },
  ],
  subjects: [{ code: "T", name: "Toán", shortName: "T", grades: ["10"], sessions: ["Sáng"], double: false, fixed: false, maxParallel: 2, avoid: [] }],
  assignments: [], homerooms: [],
  config: { enabledSessions: ["Sáng"], enabledDays: [2], maxMorning: 2, maxAfternoon: 5, maxEvening: 3, offSlots: [], fixedLessons: [], mergedGroups: [], splitGroups: [] },
};

const lesson = (overrides = {}) => ({ className: "10A1", subject: "Toán", teacher: "Giáo viên A", periods: 1, day: 2, period: 1, session: "Sáng", room: "P1", ...overrides });

test("rejects a teacher teaching two classes in the same slot", () => {
  const schedule = [lesson()];
  assert.match(placementError(profile, schedule, lesson({ className: "10A2" })), /đang dạy lớp 10A1/);
});

test("allows the same teacher in a different period", () => {
  const schedule = [lesson()];
  assert.equal(placementError(profile, schedule, lesson({ className: "10A2", period: 2 })), "");
});

test("rejects class and room collisions", () => {
  const schedule = [lesson()];
  assert.match(placementError(profile, schedule, lesson({ teacher: "Giáo viên B" })), /10A1 đã có môn/);
  assert.match(placementError(profile, schedule, lesson({ className: "10A2", teacher: "Giáo viên B" })), /Phòng P1/);
});

test("audits a valid schedule without conflicts", () => {
  const schedule = [lesson(), lesson({ className: "10A2", period: 2 })];
  assert.deepEqual(scheduleConflicts(profile, schedule), []);
});
