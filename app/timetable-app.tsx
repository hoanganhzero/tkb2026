"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

type Tab = "dashboard" | "data" | "assignments" | "create" | "settings" | "saved" | "reports";
type ViewMode = "class" | "teacher" | "room";
type Assignment = { className: string; subject: string; teacher: string; periods: number };
type Lesson = Assignment & { day: number; period: number; session: string; room?: string; locked?: boolean };
type Stored = { id: string; name: string; assignments: Assignment[]; schedule: Lesson[]; unresolved: Assignment[]; lessonCount: number; updatedAt: string };
type Teacher = { code: string; name: string; subject: string; maxPeriods: number; priority?: boolean };
type ClassRow = { name: string; grade: string; campus: string; size: number; homeroomTeacher?: string };
type Subject = { code: string; name: string; periods: number; maxParallel?: number };
type Room = { code: string; name: string; type: string };
type Profile = { schoolName: string; schoolYear: string; campuses: string[]; teachers: Teacher[]; classes: ClassRow[]; subjects: Subject[]; rooms: Room[] };
type BusySlot = { teacher: string; day: number; period: number };

const SAMPLE = `10A1 | Toán | Nguyễn Văn Hùng | 4
10A1 | Ngữ văn | Trần Thị Lan | 4
10A1 | Tiếng Anh | Lê Minh Anh | 3
10A2 | Toán | Nguyễn Văn Hùng | 4
10A2 | Ngữ văn | Trần Thị Lan | 4
10A2 | Vật lí | Phạm Quốc Bảo | 2`;
const TEACHERS_SAMPLE = `GV01 | Nguyễn Văn Hùng | Toán | 19 | Ưu tiên
GV02 | Trần Thị Lan | Ngữ văn | 19 |
GV03 | Lê Minh Anh | Tiếng Anh | 19 |
GV04 | Phạm Quốc Bảo | Vật lí | 19 |`;
const CLASSES_SAMPLE = `10A1 | 10 | Cơ sở chính | 42 | Nguyễn Văn Hùng
10A2 | 10 | Cơ sở chính | 40 | Trần Thị Lan`;
const SUBJECTS_SAMPLE = `TOAN | Toán | 4 | 99
VAN | Ngữ văn | 4 | 99
ANH | Tiếng Anh | 3 | 99
LY | Vật lí | 2 | 2`;
const ROOMS_SAMPLE = `P101 | Phòng 101 | Phòng học
LAB01 | Phòng thí nghiệm | Phòng bộ môn`;
const DAYS = [2, 3, 4, 5, 6, 7];
const DAY_NAMES: Record<number, string> = { 2: "Thứ 2", 3: "Thứ 3", 4: "Thứ 4", 5: "Thứ 5", 6: "Thứ 6", 7: "Thứ 7" };
const SESSION_INFO = [
  { key: "Sáng", count: 5, start: 1 },
  { key: "Chiều", count: 4, start: 6 },
  { key: "Tối", count: 3, start: 10 },
];
const EMPTY_PROFILE: Profile = { schoolName: "Trường của tôi", schoolYear: "2026-2027", campuses: ["Cơ sở chính"], teachers: [], classes: [], subjects: [], rooms: [] };

function parseAssignments(raw: string): { rows: Assignment[]; errors: string[] } {
  const rows: Assignment[] = []; const errors: string[] = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const parts = line.split("|").map((x) => x.trim()); const periods = Number(parts[3]);
    if (parts.length !== 4 || !parts[0] || !parts[1] || !parts[2] || !Number.isInteger(periods) || periods < 1 || periods > 20) errors.push(`Dòng ${index + 1} chưa đúng định dạng.`);
    else rows.push({ className: parts[0], subject: parts[1], teacher: parts[2], periods });
  });
  return { rows, errors };
}

function parseBusy(raw: string): BusySlot[] {
  return raw.split(/\r?\n/).flatMap((line) => {
    const [teacher, dayRaw, periodRaw] = line.split("|").map((x) => x.trim());
    const day = Number(dayRaw?.replace(/\D/g, "")); const period = Number(periodRaw?.replace(/\D/g, ""));
    return teacher && DAYS.includes(day) && period > 0 ? [{ teacher, day, period }] : [];
  });
}

function splitRows<T>(raw: string, map: (parts: string[]) => T | null): T[] {
  return raw.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    const value = map(line.split("|").map((x) => x.trim())); return value ? [value] : [];
  });
}

function resourceTokens(value: string) { return value.split(/[+,;]/).map((item) => item.trim()).filter(Boolean); }
function overlaps(left: string, right: string) { const rightTokens = new Set(resourceTokens(right).map((item) => item.toLocaleLowerCase("vi"))); return resourceTokens(left).some((item) => rightTokens.has(item.toLocaleLowerCase("vi"))); }

function buildSchedule(assignments: Assignment[], enabled: string[], busy: BusySlot[], rooms: Room[], subjects: Subject[], teachers: Teacher[]) {
  const slots = DAYS.flatMap((day) => SESSION_INFO.filter((s) => enabled.includes(s.key)).flatMap((s) => Array.from({ length: s.count }, (_, i) => ({ day, period: s.start + i, session: s.key }))));
  const schedule: Lesson[] = []; const unresolved: Assignment[] = [];
  const sorted = [...assignments].sort((a, b) => b.periods - a.periods || a.teacher.localeCompare(b.teacher, "vi"));
  for (const assignment of sorted) {
    for (let n = 0; n < assignment.periods; n++) {
      const subjectDays = new Set(schedule.filter((l) => l.className === assignment.className && l.subject === assignment.subject).map((l) => l.day));
      const maxParallel = subjects.find((subject) => subject.name === assignment.subject || subject.code === assignment.subject)?.maxParallel ?? 99;
      const free = (slot: { day: number; period: number }) =>
        !busy.some((b) => overlaps(b.teacher, assignment.teacher) && b.day === slot.day && b.period === slot.period) &&
        schedule.filter((l) => l.day === slot.day && l.period === slot.period && l.subject === assignment.subject).length < maxParallel &&
        !schedule.some((l) => l.day === slot.day && l.period === slot.period && (overlaps(l.className, assignment.className) || overlaps(l.teacher, assignment.teacher)));
      const ranked = slots.filter(free).sort((a, b) => {
        const score = (slot: { day: number; period: number }) =>
          (subjectDays.has(slot.day) ? 30 : 0) +
          schedule.filter((l) => l.className === assignment.className && l.day === slot.day).length * 3 +
          schedule.filter((l) => overlaps(l.teacher, assignment.teacher) && l.day === slot.day).length * 2 +
          (teachers.some((teacher) => teacher.priority && overlaps(teacher.name, assignment.teacher)) ? slot.period / 5 : slot.period / 100);
        return score(a) - score(b);
      });
      const target = ranked[0];
      const room = target && rooms.length
        ? rooms.find((candidate) => !schedule.some((l) => l.day === target.day && l.period === target.period && l.room === candidate.code))?.code ?? ""
        : "";
      if (target) schedule.push({ ...assignment, ...target, room });
      else unresolved.push({ ...assignment, periods: 1 });
    }
  }
  return { schedule, unresolved };
}

function textOfTeachers(rows: Teacher[]) { return rows.map((x) => `${x.code} | ${x.name} | ${x.subject} | ${x.maxPeriods} | ${x.priority ? "Ưu tiên" : ""}`).join("\n"); }
function textOfClasses(rows: ClassRow[]) { return rows.map((x) => `${x.name} | ${x.grade} | ${x.campus} | ${x.size} | ${x.homeroomTeacher ?? ""}`).join("\n"); }
function textOfSubjects(rows: Subject[]) { return rows.map((x) => `${x.code} | ${x.name} | ${x.periods} | ${x.maxParallel ?? 99}`).join("\n"); }
function textOfRooms(rows: Room[]) { return rows.map((x) => `${x.code} | ${x.name} | ${x.type}`).join("\n"); }
function safeFileName(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function escapeIcs(value: string) { return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n"); }
function lessonDate(day: number, period: number) {
  const base = new Date(); const delta = (day - (base.getDay() || 7) + 7) % 7 || 7;
  base.setDate(base.getDate() + delta);
  const hour = period <= 5 ? 6 + period : period <= 9 ? 7 + period : 8 + period;
  base.setHours(hour, 0, 0, 0); return base;
}
function icsDate(value: Date) { return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }

export default function TimetableApp({ user }: { user: { name: string; email: string } }) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [schoolName, setSchoolName] = useState(EMPTY_PROFILE.schoolName);
  const [schoolYear, setSchoolYear] = useState(EMPTY_PROFILE.schoolYear);
  const [campusesRaw, setCampusesRaw] = useState("Cơ sở chính");
  const [teachersRaw, setTeachersRaw] = useState(TEACHERS_SAMPLE);
  const [classesRaw, setClassesRaw] = useState(CLASSES_SAMPLE);
  const [subjectsRaw, setSubjectsRaw] = useState(SUBJECTS_SAMPLE);
  const [roomsRaw, setRoomsRaw] = useState(ROOMS_SAMPLE);
  const [name, setName] = useState("TKB học kỳ I – 2026–2027");
  const [raw, setRaw] = useState(SAMPLE);
  const [busyRaw, setBusyRaw] = useState("");
  const [assignmentClass, setAssignmentClass] = useState("");
  const [assignmentSubject, setAssignmentSubject] = useState("");
  const [assignmentTeacher, setAssignmentTeacher] = useState("");
  const [assignmentPeriods, setAssignmentPeriods] = useState(2);
  const [enabled, setEnabled] = useState(["Sáng", "Chiều"]);
  const [schedule, setSchedule] = useState<Lesson[]>([]);
  const [unresolved, setUnresolved] = useState<Assignment[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("class");
  const [selectedResource, setSelectedResource] = useState("");
  const [saved, setSaved] = useState<Stored[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const importRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseAssignments(raw), [raw]);
  const classes = useMemo(() => [...new Set(schedule.flatMap((x) => resourceTokens(x.className)))].sort(), [schedule]);
  const resources = useMemo(() => [...new Set(schedule.flatMap((x) => viewMode === "class" ? resourceTokens(x.className) : viewMode === "teacher" ? resourceTokens(x.teacher) : [x.room || "Chưa gán phòng"]))].sort(), [schedule, viewMode]);
  const activeResource = selectedResource || (viewMode === "class" ? selectedClass : "") || resources[0] || "";
  const visibleLessons = useMemo(() => schedule.map((lesson, index) => ({ lesson, index })).filter(({ lesson }) =>
    viewMode === "class" ? resourceTokens(lesson.className).includes(activeResource) : viewMode === "teacher" ? resourceTokens(lesson.teacher).includes(activeResource) : (lesson.room || "Chưa gán phòng") === activeResource
  ).sort((a, b) => a.lesson.day - b.lesson.day || a.lesson.period - b.lesson.period), [schedule, viewMode, activeResource]);
  const titles: Record<Tab, string> = { dashboard: "Tổng quan", data: "1. Khai báo dữ liệu", assignments: "2. Phân công giảng dạy", create: "3. Xếp thời khóa biểu", settings: "4. Cấu hình và ràng buộc", saved: "5. Sao lưu và khôi phục", reports: "6. In ấn và báo cáo" };

  async function loadAll() {
    setLoading(true);
    const [savedRes, profileRes] = await Promise.all([fetch("/api/timetables", { cache: "no-store" }), fetch("/api/settings", { cache: "no-store" })]);
    if (savedRes.ok) setSaved((await savedRes.json()).data ?? []);
    if (profileRes.ok) {
      const next = (await profileRes.json()).data as Profile; setProfile(next);
      setSchoolName(next.schoolName); setSchoolYear(next.schoolYear); setCampusesRaw(next.campuses.join("\n") || "Cơ sở chính");
      setTeachersRaw(textOfTeachers(next.teachers) || TEACHERS_SAMPLE); setClassesRaw(textOfClasses(next.classes) || CLASSES_SAMPLE);
      setSubjectsRaw(textOfSubjects(next.subjects) || SUBJECTS_SAMPLE); setRoomsRaw(textOfRooms(next.rooms) || ROOMS_SAMPLE);
    }
    setLoading(false);
  }
  useEffect(() => { void loadAll(); }, []);

  function readProfileDraft(): Profile {
    return {
      schoolName: schoolName.trim(), schoolYear: schoolYear.trim(), campuses: campusesRaw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
      teachers: splitRows(teachersRaw, (p) => p.length >= 4 && p[0] && p[1] ? { code: p[0], name: p[1], subject: p[2], maxPeriods: Number(p[3]) || 19, priority: /ưu tiên|uu tien|yes|1/i.test(p[4] ?? "") } : null),
      classes: splitRows(classesRaw, (p) => p.length >= 4 && p[0] ? { name: p[0], grade: p[1], campus: p[2], size: Number(p[3]) || 0, homeroomTeacher: p[4] || "" } : null),
      subjects: splitRows(subjectsRaw, (p) => p.length >= 3 && p[0] && p[1] ? { code: p[0], name: p[1], periods: Number(p[2]) || 0, maxParallel: Math.max(1, Number(p[3]) || 99) } : null),
      rooms: splitRows(roomsRaw, (p) => p.length >= 3 && p[0] ? { code: p[0], name: p[1], type: p[2] } : null),
    };
  }

  async function saveProfile() {
    const next = readProfileDraft();
    const response = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    if (response.ok) { setProfile(next); setNotice("Đã lưu toàn bộ dữ liệu nhà trường."); }
    else setNotice("Tên trường hoặc năm học chưa hợp lệ.");
  }

  function generate() {
    if (parsed.errors.length || !parsed.rows.length || !enabled.length) { setNotice(parsed.errors[0] ?? "Hãy chọn ít nhất một buổi học."); return; }
    const draft = readProfileDraft();
    const result = buildSchedule(parsed.rows, enabled, parseBusy(busyRaw), draft.rooms, draft.subjects, draft.teachers);
    setSchedule(result.schedule); setUnresolved(result.unresolved); setSelectedClass(""); setSelectedResource("");
    setNotice(result.unresolved.length ? `Đã xếp ${result.schedule.length} tiết; còn ${result.unresolved.length} tiết chưa có chỗ.` : `Đã xếp đủ ${result.schedule.length} tiết, không trùng lớp hoặc giáo viên.`);
  }

  function moveLesson(index: number, field: "day" | "period", value: number) {
    const current = schedule[index]; const next = { ...current, [field]: value };
    const session = SESSION_INFO.find((s) => value >= s.start && value < s.start + s.count)?.key ?? current.session; next.session = session;
    const busy = parseBusy(busyRaw).some((slot) => overlaps(slot.teacher, next.teacher) && slot.day === next.day && slot.period === next.period);
    const clash = schedule.find((l, i) => i !== index && l.day === next.day && l.period === next.period && (overlaps(l.className, next.className) || overlaps(l.teacher, next.teacher) || (!!l.room && l.room === next.room)));
    if (busy || clash) { setNotice(busy ? "Không thể di chuyển: giáo viên đã khai báo bận ở ô này." : `Không thể di chuyển: trùng ${clash && overlaps(clash.className, next.className) ? "lớp" : clash && overlaps(clash.teacher, next.teacher) ? "giáo viên" : "phòng học"}.`); return; }
    setSchedule((old) => old.map((l, i) => i === index ? next : l)); setNotice("Đã di chuyển tiết học và kiểm tra không có xung đột.");
  }

  async function save() {
    if (!schedule.length) { setNotice("Hãy tạo thời khóa biểu trước khi lưu."); return; }
    const response = await fetch("/api/timetables", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, assignments: parsed.rows, schedule, unresolved }) });
    setNotice(response.ok ? "Đã lưu thời khóa biểu vào tài khoản ChatGPT của thầy." : "Chưa thể lưu, vui lòng thử lại.");
    if (response.ok) { const latest = await fetch("/api/timetables", { cache: "no-store" }); if (latest.ok) setSaved((await latest.json()).data ?? []); }
  }

  function openStored(item: Stored) {
    setName(item.name); setRaw(item.assignments.map((a) => `${a.className} | ${a.subject} | ${a.teacher} | ${a.periods}`).join("\n"));
    setSchedule(item.schedule); setUnresolved(item.unresolved); setSelectedResource(""); setTab("create"); setNotice("Đã mở thời khóa biểu đã lưu.");
  }
  async function remove(id: string) { if (!confirm("Xóa thời khóa biểu này?")) return; await fetch(`/api/timetables/${id}`, { method: "DELETE" }); setSaved((old) => old.filter((x) => x.id !== id)); }

  function placeUnresolved(index: number) {
    const assignment = unresolved[index];
    const slots = DAYS.flatMap((day) => SESSION_INFO.filter((s) => enabled.includes(s.key)).flatMap((s) => Array.from({ length: s.count }, (_, offset) => ({ day, period: s.start + offset, session: s.key }))));
    const busy = parseBusy(busyRaw);
    const target = slots.find((slot) =>
      !busy.some((b) => overlaps(b.teacher, assignment.teacher) && b.day === slot.day && b.period === slot.period) &&
      !schedule.some((l) => l.day === slot.day && l.period === slot.period && (overlaps(l.className, assignment.className) || overlaps(l.teacher, assignment.teacher)))
    );
    if (!target) { setNotice("Chưa tìm được ô trống phù hợp. Hãy mở thêm buổi học hoặc điều chỉnh lịch bận."); return; }
    const room = profile.rooms.find((candidate) => !schedule.some((l) => l.day === target.day && l.period === target.period && l.room === candidate.code))?.code ?? "";
    setSchedule((old) => [...old, { ...assignment, ...target, room }]);
    setUnresolved((old) => old.filter((_, itemIndex) => itemIndex !== index));
    setNotice("Đã xếp thêm một tiết từ kho chưa xếp.");
  }

  function trafficStatus(lesson: Lesson) {
    const sameSubjectToday = schedule.filter((item) => item.className === lesson.className && item.subject === lesson.subject && item.day === lesson.day).length;
    if (sameSubjectToday > 1) return { level: "amber", label: "Hợp lệ, nhưng môn đang lặp trong ngày" };
    return { level: "green", label: "Ô hợp lệ, không xung đột" };
  }

  function toggleLock(index: number) {
    setSchedule((old) => old.map((lesson, itemIndex) => itemIndex === index ? { ...lesson, locked: !lesson.locked } : lesson));
  }

  function optimizeLesson(index: number) {
    const lesson = schedule[index]; if (lesson.locked) { setNotice("Tiết đang được ghim. Hãy bỏ ghim trước khi tối ưu."); return; }
    const slots = DAYS.flatMap((day) => SESSION_INFO.filter((session) => enabled.includes(session.key)).flatMap((session) => Array.from({ length: session.count }, (_, offset) => ({ day, period: session.start + offset, session: session.key }))));
    const target = slots.filter((slot) => slot.day !== lesson.day || slot.period !== lesson.period).find((slot) =>
      !parseBusy(busyRaw).some((busy) => overlaps(busy.teacher, lesson.teacher) && busy.day === slot.day && busy.period === slot.period) &&
      !schedule.some((item, itemIndex) => itemIndex !== index && item.day === slot.day && item.period === slot.period && (overlaps(item.className, lesson.className) || overlaps(item.teacher, lesson.teacher) || (!!item.room && item.room === lesson.room))) &&
      !schedule.some((item) => item.className === lesson.className && item.subject === lesson.subject && item.day === slot.day)
    );
    if (!target) { setNotice("Trợ lý chưa tìm được ô tốt hơn cho tiết này."); return; }
    setSchedule((old) => old.map((item, itemIndex) => itemIndex === index ? { ...item, ...target } : item)); setNotice(`Trợ lý đã chuyển tiết sang ${DAY_NAMES[target.day]}, tiết ${target.period}.`);
  }

  function addAssignment() {
    if (!assignmentClass.trim() || !assignmentSubject.trim() || !assignmentTeacher.trim() || assignmentPeriods < 1) { setNotice("Hãy chọn đủ lớp, môn, giáo viên và số tiết."); return; }
    const next: Assignment = { className: assignmentClass.trim(), subject: assignmentSubject.trim(), teacher: assignmentTeacher.trim(), periods: assignmentPeriods };
    const rows = parsed.rows.filter((item) => !(item.className === next.className && item.subject === next.subject));
    setRaw([...rows, next].map((item) => `${item.className} | ${item.subject} | ${item.teacher} | ${item.periods}`).join("\n"));
    setNotice("Đã cập nhật phân công giảng dạy.");
  }

  function removeAssignment(index: number) {
    setRaw(parsed.rows.filter((_, rowIndex) => rowIndex !== index).map((item) => `${item.className} | ${item.subject} | ${item.teacher} | ${item.periods}`).join("\n"));
  }

  async function backupExcel() {
    const XLSX = await import("xlsx"); const draft = readProfileDraft(); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ schoolName: draft.schoolName, schoolYear: draft.schoolYear, enabledSessions: enabled.join(", "), timetableName: name }]), "CauHinh");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(draft.campuses.map((name) => ({ name }))), "DiemTruong");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(draft.teachers), "GiaoVien");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(draft.classes), "LopHoc");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(draft.subjects), "MonHoc");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(draft.rooms), "PhongHoc");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(parsed.rows), "PhanCong");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(parseBusy(busyRaw)), "LichBan");
    const savedRows = saved.flatMap((item) => item.schedule.map((lesson) => ({ timetableName: item.name, ...lesson })));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(savedRows), "TKBDaLuu");
    XLSX.writeFile(wb, `Sao-luu-TKB-${safeFileName(draft.schoolYear)}.xlsx`);
  }

  async function restoreExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const XLSX = await import("xlsx"); const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = <T,>(sheetName: string) => wb.Sheets[sheetName] ? XLSX.utils.sheet_to_json<T>(wb.Sheets[sheetName]) : [];
      const config = rows<Record<string, unknown>>("CauHinh")[0] ?? {};
      const next: Profile = {
        schoolName: String(config.schoolName ?? schoolName), schoolYear: String(config.schoolYear ?? schoolYear),
        campuses: rows<{ name: string }>("DiemTruong").map((item) => item.name).filter(Boolean),
        teachers: rows<Teacher>("GiaoVien"), classes: rows<ClassRow>("LopHoc"), subjects: rows<Subject>("MonHoc"), rooms: rows<Room>("PhongHoc"),
      };
      const response = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      if (!response.ok) throw new Error("restore profile");
      const assignments = rows<Assignment>("PhanCong"); const busy = rows<BusySlot>("LichBan");
      const timetableRows = rows<Lesson & { timetableName: string }>("TKBDaLuu");
      setProfile(next); setSchoolName(next.schoolName); setSchoolYear(next.schoolYear); setCampusesRaw(next.campuses.join("\n")); setTeachersRaw(textOfTeachers(next.teachers)); setClassesRaw(textOfClasses(next.classes)); setSubjectsRaw(textOfSubjects(next.subjects)); setRoomsRaw(textOfRooms(next.rooms));
      if (assignments.length) setRaw(assignments.map((item) => `${item.className} | ${item.subject} | ${item.teacher} | ${item.periods}`).join("\n"));
      if (busy.length) setBusyRaw(busy.map((item) => `${item.teacher} | Thứ ${item.day} | Tiết ${item.period}`).join("\n"));
      const sessionText = String(config.enabledSessions ?? ""); if (sessionText) setEnabled(SESSION_INFO.map((item) => item.key).filter((item) => sessionText.includes(item)));
      const groups = new Map<string, Lesson[]>(); timetableRows.forEach((item) => { const group = groups.get(item.timetableName) ?? []; const { timetableName: _ignored, ...lesson } = item; group.push(lesson); groups.set(item.timetableName, group); });
      for (const [timetableName, lessons] of groups) {
        const restoredAssignments = [...new Map(lessons.map((lesson) => [`${lesson.className}|${lesson.subject}|${lesson.teacher}`, { className: lesson.className, subject: lesson.subject, teacher: lesson.teacher, periods: lessons.filter((item) => item.className === lesson.className && item.subject === lesson.subject && item.teacher === lesson.teacher).length }])).values()];
        await fetch("/api/timetables", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `${timetableName} (khôi phục)`, assignments: restoredAssignments, schedule: lessons, unresolved: [] }) });
      }
      if (groups.size) { const latest = await fetch("/api/timetables", { cache: "no-store" }); if (latest.ok) setSaved((await latest.json()).data ?? []); }
      setNotice("Đã khôi phục dữ liệu từ tệp Excel sao lưu.");
    } catch { setNotice("Không thể khôi phục. Hãy chọn đúng tệp Sao-lưu-TKB do hệ thống tạo."); }
    event.target.value = "";
  }

  async function exportCurrentXlsx() {
    if (!schedule.length) return;
    const XLSX = await import("xlsx"); const wb = XLSX.utils.book_new();
    const rows = schedule.slice().sort((a, b) => a.className.localeCompare(b.className, "vi") || a.day - b.day || a.period - b.period).map((l) => ({ Lớp: l.className, Thứ: DAY_NAMES[l.day], Buổi: l.session, Tiết: l.period, Môn: l.subject, "Giáo viên": l.teacher, Phòng: l.room ?? "" }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "ToanTruong");
    classes.forEach((className) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.filter((row) => row.Lớp === className)), className.slice(0, 31)));
    const load = [...new Set(schedule.map((x) => x.teacher))].map((teacher) => ({ "Giáo viên": teacher, "Số tiết": schedule.filter((x) => x.teacher === teacher).length }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(load), "TaiGiangDay");
    XLSX.writeFile(wb, `${safeFileName(name) || "thoi-khoa-bieu"}.xlsx`);
  }

  function exportCurrentIcs() {
    if (!visibleLessons.length) return;
    const events = visibleLessons.map(({ lesson }, index) => {
      const start = lessonDate(lesson.day, lesson.period); const end = new Date(start.getTime() + 45 * 60 * 1000);
      return ["BEGIN:VEVENT", `UID:${Date.now()}-${index}@tkb2026`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`, `SUMMARY:${escapeIcs(`${lesson.subject} - ${lesson.className}`)}`, `DESCRIPTION:${escapeIcs(`Giáo viên: ${lesson.teacher}`)}`, `LOCATION:${escapeIcs(lesson.room || "")}`, "RRULE:FREQ=WEEKLY;COUNT=18", "END:VEVENT"].join("\r\n");
    }).join("\r\n");
    const content = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Lich Viet 360//VI\r\nCALSCALE:GREGORIAN\r\n${events}\r\nEND:VCALENDAR`;
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type: "text/calendar;charset=utf-8" })); link.download = `${safeFileName(activeResource || name) || "lich-day"}.ics`; link.click(); URL.revokeObjectURL(link.href);
  }

  async function exportDataTemplate() {
    const XLSX = await import("xlsx"); const draft = readProfileDraft(); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(draft.teachers.length ? draft.teachers : [{ code: "GV01", name: "Nguyễn Văn A", subject: "Toán", maxPeriods: 19 }]), "GiaoVien");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(draft.classes.length ? draft.classes : [{ name: "10A1", grade: "10", campus: "Cơ sở chính", size: 40 }]), "LopHoc");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(draft.subjects.length ? draft.subjects : [{ code: "TOAN", name: "Toán", periods: 4 }]), "MonHoc");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(draft.rooms.length ? draft.rooms : [{ code: "P101", name: "Phòng 101", type: "Phòng học" }]), "PhongHoc");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(parsed.rows.length ? parsed.rows : [{ className: "10A1", subject: "Toán", teacher: "Nguyễn Văn A", periods: 4 }]), "PhanCong");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(parseBusy(busyRaw).length ? parseBusy(busyRaw) : [{ teacher: "Nguyễn Văn A", day: 3, period: 1 }]), "LichBan");
    XLSX.writeFile(wb, `Du-lieu-TKB-${schoolYear}.xlsx`);
  }

  async function importExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const XLSX = await import("xlsx"); const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = (name: string) => wb.Sheets[wb.SheetNames.find((x) => x.toLocaleLowerCase("vi").includes(name)) ?? ""];
      const teachers = sheet("giaovien") ? XLSX.utils.sheet_to_json<Teacher>(sheet("giaovien")) : [];
      const classRows = sheet("lophoc") ? XLSX.utils.sheet_to_json<ClassRow>(sheet("lophoc")) : [];
      const subjects = sheet("monhoc") ? XLSX.utils.sheet_to_json<Subject>(sheet("monhoc")) : [];
      const rooms = sheet("phonghoc") ? XLSX.utils.sheet_to_json<Room>(sheet("phonghoc")) : [];
      const assignments = sheet("phancong") ? XLSX.utils.sheet_to_json<Assignment>(sheet("phancong")) : [];
      const busy = sheet("lichban") ? XLSX.utils.sheet_to_json<BusySlot>(sheet("lichban")) : [];
      if (teachers.length) setTeachersRaw(textOfTeachers(teachers)); if (classRows.length) setClassesRaw(textOfClasses(classRows)); if (subjects.length) setSubjectsRaw(textOfSubjects(subjects)); if (rooms.length) setRoomsRaw(textOfRooms(rooms));
      if (assignments.length) setRaw(assignments.map((row) => `${row.className} | ${row.subject} | ${row.teacher} | ${row.periods}`).join("\n"));
      if (busy.length) setBusyRaw(busy.map((row) => `${row.teacher} | Thứ ${row.day} | Tiết ${row.period}`).join("\n"));
      setNotice(`Đã đọc ${teachers.length} GV, ${classRows.length} lớp, ${subjects.length} môn, ${rooms.length} phòng, ${assignments.length} phân công và ${busy.length} ô bận.`);
    } catch { setNotice("Không đọc được tệp Excel. Hãy dùng đúng tệp mẫu của hệ thống."); }
    event.target.value = "";
  }

  const allLessons = saved.flatMap((x) => x.schedule);
  const teacherNames = [...new Set(allLessons.flatMap((x) => resourceTokens(x.teacher)))];
  const teacherLoad = teacherNames.map((teacher) => ({ teacher, periods: allLessons.filter((x) => resourceTokens(x.teacher).includes(teacher)).length })).sort((a, b) => b.periods - a.periods);
  const printLessons = schedule.length ? schedule : saved[0]?.schedule ?? [];
  const totalClasses = profile.classes.length || new Set(parsed.rows.flatMap((x) => resourceTokens(x.className))).size;
  const totalTeachers = profile.teachers.length || new Set(parsed.rows.flatMap((x) => resourceTokens(x.teacher))).size;

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img className="brand-image" src="/edutkb-mark.svg" alt="" /><div><strong>EduTKB</strong><small>Thời khóa biểu thông minh</small></div></div>
      <nav>
        <button className={tab === "dashboard" ? "active" : ""} onClick={() => setTab("dashboard")}><span>⌂</span> Tổng quan</button>
        <button className={tab === "data" ? "active" : ""} onClick={() => setTab("data")}><span>1</span> Khai báo</button>
        <button className={tab === "assignments" ? "active" : ""} onClick={() => setTab("assignments")}><span>2</span> Phân công</button>
        <button className={tab === "create" ? "active" : ""} onClick={() => setTab("create")}><span>3</span> Xếp TKB</button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><span>4</span> Cấu hình</button>
        <button className={tab === "saved" ? "active" : ""} onClick={() => setTab("saved")}><span>5</span> Sao lưu <b>{saved.length}</b></button>
        <button className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")}><span>6</span> In ấn</button>
      </nav>
      <div className="account"><span>{user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.email}</small></div></div>
    </aside>

    <section className="workspace">
      <header><div><p>{profile.schoolName.toLocaleUpperCase("vi")}</p><h1>{titles[tab]}</h1></div><div className="header-actions"><span>{profile.schoolYear}</span><a href="/signout-with-chatgpt?return_to=/">Đăng xuất</a></div></header>
      {loading ? <div className="page-loading">Đang tải dữ liệu…</div> : null}

      {!loading && tab === "dashboard" && <>
        <section className="metrics dashboard-metrics">
          <article><span className="metric-icon teal">⌂</span><div><small>LỚP HỌC</small><strong>{totalClasses}</strong><p>{profile.campuses.length} điểm trường</p></div></article>
          <article><span className="metric-icon violet">♙</span><div><small>GIÁO VIÊN</small><strong>{totalTeachers}</strong><p>đang quản lý</p></div></article>
          <article><span className="metric-icon blue">▣</span><div><small>THỜI KHÓA BIỂU</small><strong>{saved.length}</strong><p>đã lưu</p></div></article>
          <article><span className="metric-icon green">✓</span><div><small>TIẾT ĐÃ XẾP</small><strong>{saved.reduce((s, x) => s + x.lessonCount, 0)}</strong><p>trên mọi TKB</p></div></article>
        </section>
        <div className="dashboard-grid">
          <section className="panel welcome-card"><div><p>NĂM HỌC {profile.schoolYear}</p><h2>Sẵn sàng tạo thời khóa biểu mới</h2><span>Nhập dữ liệu giáo viên, lớp, môn học và phân công để hệ thống tự động xếp lịch không trùng.</span><button className="primary" onClick={() => setTab("create")}>✦ Bắt đầu xếp lịch</button></div><div className="calendar-art"><b>{new Date().getDate()}</b><span>THÁNG {new Date().getMonth() + 1}</span></div></section>
          <section className="panel quick-panel"><div className="panel-title"><div><span>⚡</span><h2>Quy trình 6 bước</h2></div></div><button onClick={() => setTab("data")}><b>1</b><span><strong>Khai báo dữ liệu</strong><small>Khối, lớp, môn, giáo viên, phòng</small></span></button><button onClick={() => setTab("assignments")}><b>2</b><span><strong>Phân công giảng dạy</strong><small>Giáo viên × môn × lớp</small></span></button><button onClick={() => setTab("create")}><b>3</b><span><strong>Xếp và tinh chỉnh TKB</strong><small>Tự động, ghim và xử lý xung đột</small></span></button></section>
        </div>
        <section className="panel recent-panel"><div className="panel-title"><div><span>▣</span><h2>Thời khóa biểu gần đây</h2></div><button className="link-button" onClick={() => setTab("saved")}>Xem tất cả</button></div>{saved.length ? <div className="saved-list compact">{saved.slice(0, 3).map((item) => <article key={item.id}><div className="file-icon">TKB</div><div className="file-info"><h3>{item.name}</h3><p>{item.lessonCount} tiết · {new Date(item.updatedAt).toLocaleDateString("vi-VN")}</p></div><span className={item.unresolved.length ? "badge warn" : "badge"}>{item.unresolved.length ? "Cần xử lý" : "Hoàn chỉnh"}</span><button onClick={() => openStored(item)}>Mở</button></article>)}</div> : <div className="mini-empty">Chưa có thời khóa biểu nào được lưu.</div>}</section>
      </>}

      {!loading && tab === "data" && <section className="data-page">
        <div className="data-toolbar"><div><button onClick={exportDataTemplate}>⇩ Tải mẫu Excel</button><button onClick={() => importRef.current?.click()}>⇧ Nhập Excel</button><input ref={importRef} type="file" accept=".xlsx,.xls" hidden onChange={importExcel} /></div><button className="primary" onClick={saveProfile}>✓ Lưu dữ liệu</button></div>
        {notice && <div className="notice">{notice}</div>}
        <section className="panel school-card"><div className="panel-title"><div><span>⌂</span><h2>Thông tin nhà trường</h2></div></div><div className="form-grid"><label>Tên trường<input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} /></label><label>Năm học<input value={schoolYear} onChange={(e) => setSchoolYear(e.target.value)} placeholder="2026-2027" /></label><label className="wide">Điểm trường / phân hiệu (mỗi dòng một tên)<textarea value={campusesRaw} onChange={(e) => setCampusesRaw(e.target.value)} /></label></div></section>
        <div className="catalog-grid">
          <CatalogEditor icon="♙" title="Giáo viên" hint="Mã | Họ tên | Môn | Định mức | Ưu tiên" value={teachersRaw} setValue={setTeachersRaw} count={readProfileDraft().teachers.length} />
          <CatalogEditor icon="⌂" title="Lớp học" hint="Tên lớp | Khối | Điểm trường | Sĩ số | GVCN" value={classesRaw} setValue={setClassesRaw} count={readProfileDraft().classes.length} />
          <CatalogEditor icon="▤" title="Môn học" hint="Mã | Tên môn | Số tiết/tuần | Số lớp tối đa cùng tiết" value={subjectsRaw} setValue={setSubjectsRaw} count={readProfileDraft().subjects.length} />
          <CatalogEditor icon="▦" title="Phòng học" hint="Mã | Tên phòng | Loại phòng" value={roomsRaw} setValue={setRoomsRaw} count={readProfileDraft().rooms.length} />
        </div>
      </section>}

      {!loading && tab === "assignments" && <section className="module-page">
        <div className="module-grid">
          <section className="panel module-card"><div className="panel-title"><div><span>+</span><h2>Thêm hoặc cập nhật phân công</h2></div></div>
            <div className="assignment-form">
              <label>Lớp / nhóm lớp<select value={assignmentClass} onChange={(e) => setAssignmentClass(e.target.value)}><option value="">Chọn lớp</option>{readProfileDraft().classes.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>
              <label>Môn học<select value={assignmentSubject} onChange={(e) => setAssignmentSubject(e.target.value)}><option value="">Chọn môn</option>{readProfileDraft().subjects.map((item) => <option key={item.code} value={item.name}>{item.name}</option>)}</select></label>
              <label>Giáo viên<select value={assignmentTeacher} onChange={(e) => setAssignmentTeacher(e.target.value)}><option value="">Chọn giáo viên</option>{readProfileDraft().teachers.map((item) => <option key={item.code} value={item.name}>{item.name}</option>)}</select></label>
              <label>Số tiết/tuần<input type="number" min={1} max={20} value={assignmentPeriods} onChange={(e) => setAssignmentPeriods(Number(e.target.value))} /></label>
            </div><button className="primary module-action" onClick={addAssignment}>✓ Ghi phân công</button>
            <div className="advanced-note"><strong>Ghép lớp, tách lớp và đồng giảng</strong><p>Dùng dấu “+” trong tên lớp hoặc giáo viên, ví dụ: <b>10A1+10A2 | GDQP | Nguyễn Văn A+Trần Văn B | 2</b>.</p></div>
          </section>
          <section className="panel module-card"><div className="panel-title"><div><span>▤</span><h2>Nhập nhanh nhiều phân công</h2></div><b>{parsed.rows.length} dòng</b></div><small>Lớp | Môn | Giáo viên | Số tiết</small><textarea className="bulk-editor" value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} />{parsed.errors.length > 0 && <p className="error-text">{parsed.errors.join(" ")}</p>}</section>
        </div>
        <section className="panel assignment-list"><div className="panel-title"><div><span>✓</span><h2>Ma trận phân công hiện tại</h2></div><button className="primary small" onClick={() => setTab("create")}>Tiếp tục xếp TKB →</button></div>
          <div className="report-table"><table><thead><tr><th>Lớp</th><th>Môn học</th><th>Giáo viên</th><th>Tiết/tuần</th><th>Loại</th><th /></tr></thead><tbody>{parsed.rows.map((item, index) => <tr key={`${item.className}-${item.subject}-${index}`}><td><strong>{item.className}</strong></td><td>{item.subject}</td><td>{item.teacher}</td><td>{item.periods}</td><td>{resourceTokens(item.className).length > 1 ? "Ghép lớp" : resourceTokens(item.teacher).length > 1 ? "Đồng giảng" : "Thông thường"}</td><td><button className="danger-inline" onClick={() => removeAssignment(index)}>Xóa</button></td></tr>)}</tbody></table></div>
        </section>
      </section>}

      {!loading && tab === "create" && <>
        <section className="metrics">
          <article><span className="metric-icon blue">▤</span><div><small>PHÂN CÔNG</small><strong>{parsed.rows.length}</strong><p>dòng hợp lệ</p></div></article>
          <article><span className="metric-icon teal">⌂</span><div><small>LỚP HỌC</small><strong>{new Set(parsed.rows.flatMap((x) => resourceTokens(x.className))).size}</strong><p>lớp cần xếp</p></div></article>
          <article><span className="metric-icon violet">♙</span><div><small>GIÁO VIÊN</small><strong>{new Set(parsed.rows.flatMap((x) => resourceTokens(x.teacher))).size}</strong><p>giáo viên</p></div></article>
          <article><span className={`metric-icon ${unresolved.length ? "orange" : "green"}`}>{unresolved.length ? "!" : "✓"}</span><div><small>TRẠNG THÁI</small><strong>{schedule.length ? (unresolved.length ? "Cần xử lý" : "Sẵn sàng") : "Chưa xếp"}</strong><p>{schedule.length} tiết đã xếp</p></div></article>
        </section>
        <div className="content-grid">
          <section className="panel setup-panel"><div className="panel-title"><div><span>✦</span><h2>Điều khiển xếp lịch</h2></div><button className="link-button" onClick={() => setTab("assignments")}>Sửa phân công</button></div>
            <label>Tên thời khóa biểu<input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <div className="run-summary"><article><b>{parsed.rows.length}</b><span>phân công</span></article><article><b>{parseBusy(busyRaw).length}</b><span>ô giáo viên bận</span></article><article><b>{parsed.rows.reduce((sum, item) => sum + item.periods, 0)}</b><span>tiết cần xếp</span></article></div>
            {parsed.errors.length > 0 && <p className="error-text">{parsed.errors.join(" ")}</p>}
            <div className="sessions"><span>Buổi học</span>{SESSION_INFO.map((s) => <label key={s.key}><input type="checkbox" checked={enabled.includes(s.key)} onChange={() => setEnabled((old) => old.includes(s.key) ? old.filter((x) => x !== s.key) : [...old, s.key])} />{s.key} <small>{s.count} tiết</small></label>)}</div>
            <button className="primary" onClick={generate}>✦ Xếp thời khóa biểu tự động</button>{notice && <div className={`notice ${unresolved.length ? "warn" : ""}`}>{notice}</div>}
          </section>
          <section className="panel preview-panel">
            <div className="panel-title preview-title"><div><span>2</span><h2>Kết quả và chỉnh sửa</h2></div>{schedule.length > 0 && <div className="view-controls"><div className="segmented">{(["class", "teacher", "room"] as ViewMode[]).map((mode) => <button key={mode} className={viewMode === mode ? "active" : ""} onClick={() => { setViewMode(mode); setSelectedResource(""); }}>{mode === "class" ? "Theo lớp" : mode === "teacher" ? "Theo GV" : "Theo phòng"}</button>)}</div><select value={activeResource} onChange={(e) => { setSelectedResource(e.target.value); if (viewMode === "class") setSelectedClass(e.target.value); }}>{resources.map((resource) => <option key={resource}>{resource}</option>)}</select></div>}</div>
            {!schedule.length ? <div className="empty"><div>▦</div><h3>Chưa có thời khóa biểu</h3><p>Nhập phân công và nhấn “Xếp thời khóa biểu tự động”.</p></div> : <>
              <div className="traffic-legend"><span><i className="green" /> Hợp lệ</span><span><i className="amber" /> Hợp lệ nhưng nên cân đối</span><b>{activeResource}: {visibleLessons.length} tiết</b></div>
              <div className="table-wrap"><table><thead><tr><th>Đánh giá</th><th>Thứ</th><th>Buổi</th><th>Tiết</th><th>Lớp</th><th>Môn học</th><th>Giáo viên</th><th>Phòng</th><th>Trợ lý</th></tr></thead><tbody>{visibleLessons.map(({ lesson: l, index }) => { const status = trafficStatus(l); return <tr key={`${l.className}-${l.teacher}-${index}`} className={l.locked ? "locked-row" : ""}><td><span className={`traffic-dot ${status.level}`} title={status.label} aria-label={status.label} /></td><td><select value={l.day} disabled={l.locked} onChange={(e) => moveLesson(index, "day", Number(e.target.value))}>{DAYS.map((d) => <option value={d} key={d}>{DAY_NAMES[d]}</option>)}</select></td><td><span className={`session ${l.session.toLowerCase()}`}>{l.session}</span></td><td><select value={l.period} disabled={l.locked} onChange={(e) => moveLesson(index, "period", Number(e.target.value))}>{SESSION_INFO.filter((s) => enabled.includes(s.key)).flatMap((s) => Array.from({ length: s.count }, (_, i) => s.start + i)).map((p) => <option value={p} key={p}>{p}</option>)}</select></td><td>{l.className}</td><td><strong>{l.subject}</strong></td><td>{l.teacher}</td><td>{l.room || "—"}</td><td><div className="lesson-tools"><button className="lock-button" onClick={() => toggleLock(index)} title={l.locked ? "Bỏ ghim" : "Ghim tiết này"}>{l.locked ? "●" : "○"}</button><button className="lock-button" onClick={() => optimizeLesson(index)} title="Tìm ô tốt hơn">↻</button></div></td></tr>; })}</tbody></table></div>
              {unresolved.length > 0 && <div className="unresolved-pool"><div><strong>Kho tiết chưa xếp</strong><span>{unresolved.length} tiết cần xử lý</span></div>{unresolved.map((item, index) => <article key={`${item.className}-${item.subject}-${index}`}><span><b>{item.className} · {item.subject}</b><small>{item.teacher}</small></span><button onClick={() => placeUnresolved(index)}>Tìm ô trống</button></article>)}</div>}
            </>}
            {schedule.length > 0 && <div className="actions"><button onClick={exportCurrentIcs}>⇩ Xuất lịch ICS</button><button onClick={exportCurrentXlsx}>⇩ Xuất Excel .xlsx</button><button className="primary" onClick={save}>✓ Lưu thời khóa biểu</button></div>}
          </section>
        </div>
      </>}

      {!loading && tab === "settings" && <section className="module-page">
        <div className="module-grid">
          <section className="panel module-card"><div className="panel-title"><div><span>◷</span><h2>Khung tiết học</h2></div></div><p className="module-help">Chọn các buổi được phép xếp. Hệ thống sử dụng 5 tiết sáng, 4 tiết chiều và 3 tiết tối.</p><div className="session-cards">{SESSION_INFO.map((session) => <label key={session.key} className={enabled.includes(session.key) ? "enabled" : ""}><input type="checkbox" checked={enabled.includes(session.key)} onChange={() => setEnabled((old) => old.includes(session.key) ? old.filter((item) => item !== session.key) : [...old, session.key])} /><b>{session.key}</b><span>{session.count} tiết/ngày</span></label>)}</div></section>
          <section className="panel module-card"><div className="panel-title"><div><span>♙</span><h2>Nguyện vọng giáo viên</h2></div><b>{parseBusy(busyRaw).length} ô bận</b></div><small>Giáo viên | Thứ | Tiết</small><textarea className="bulk-editor constraints-editor" value={busyRaw} onChange={(e) => setBusyRaw(e.target.value)} placeholder="Nguyễn Văn Hùng | Thứ 3 | Tiết 1" /></section>
        </div>
        <section className="panel rules-card"><div className="panel-title"><div><span>⚙</span><h2>Ràng buộc đang áp dụng</h2></div></div><div className="rules-grid"><article><b>Không trùng giáo viên</b><span>Kể cả các tiết đồng giảng</span></article><article><b>Không trùng lớp</b><span>Kể cả nhóm lớp ghép/tách</span></article><article><b>Không trùng phòng</b><span>Mỗi phòng chỉ phục vụ một lớp/tiết</span></article><article><b>Giới hạn môn song song</b><span>Theo cột cuối danh mục môn học</span></article><article><b>Ưu tiên giáo viên</b><span>Giảm tiết muộn cho giáo viên ưu tiên</span></article><article><b>Phân bổ môn trong tuần</b><span>Hạn chế lặp môn cùng một ngày</span></article></div><button className="primary module-action" onClick={saveProfile}>✓ Lưu toàn bộ cấu hình</button>{notice && <div className="notice">{notice}</div>}</section>
      </section>}

      {!loading && tab === "saved" && <section className="module-page"><div className="backup-toolbar"><button className="primary" onClick={backupExcel}>⇩ Sao lưu toàn bộ bằng Excel</button><button onClick={() => restoreRef.current?.click()}>⇧ Khôi phục từ Excel</button><input ref={restoreRef} type="file" accept=".xlsx" hidden onChange={restoreExcel} /><span>Sao lưu gồm dữ liệu trường, phân công, lịch bận và các TKB đã lưu.</span></div>{notice && <div className="notice">{notice}</div>}<section className="panel saved-panel"><div className="panel-title"><div><span>▣</span><h2>Các phiên bản thời khóa biểu</h2></div><button className="primary small" onClick={() => setTab("create")}>+ Tạo mới</button></div>{!saved.length ? <div className="empty"><div>▤</div><h3>Chưa có thời khóa biểu đã lưu</h3><p>Tạo lịch đầu tiên để dữ liệu xuất hiện tại đây.</p></div> : <div className="saved-list">{saved.map((item) => <article key={item.id}><div className="file-icon">TKB</div><div className="file-info"><h3>{item.name}</h3><p>{item.lessonCount} tiết · Cập nhật {new Date(item.updatedAt).toLocaleString("vi-VN")}</p></div><span className={item.unresolved.length ? "badge warn" : "badge"}>{item.unresolved.length ? `${item.unresolved.length} chưa xếp` : "Hoàn chỉnh"}</span><button onClick={() => openStored(item)}>Mở</button><button className="danger" onClick={() => remove(item.id)}>Xóa</button></article>)}</div>}</section></section>}

      {!loading && tab === "reports" && <section className="reports-page">
        <div className="print-toolbar"><div><button className="primary" onClick={() => window.print()}>🖨 In thời khóa biểu</button><button onClick={exportCurrentXlsx} disabled={!schedule.length}>⇩ Excel toàn trường</button><button onClick={exportCurrentIcs} disabled={!visibleLessons.length}>⇩ Lịch giáo viên/lớp</button></div><span>Chọn “Mở” một TKB đã lưu trước khi in hoặc xuất.</span></div>
        <section className="metrics dashboard-metrics"><article><span className="metric-icon blue">▣</span><div><small>SỐ TKB</small><strong>{saved.length}</strong><p>phiên bản đã lưu</p></div></article><article><span className="metric-icon teal">▤</span><div><small>TỔNG TIẾT</small><strong>{allLessons.length}</strong><p>đã thống kê</p></div></article><article><span className="metric-icon violet">♙</span><div><small>GIÁO VIÊN</small><strong>{teacherLoad.length}</strong><p>có lịch dạy</p></div></article><article><span className="metric-icon green">✓</span><div><small>HOÀN CHỈNH</small><strong>{saved.filter((x) => !x.unresolved.length).length}</strong><p>không còn tiết trống</p></div></article></section>
        <div className="report-grid"><section className="panel report-card"><div className="panel-title"><div><span>♙</span><h2>Tải giảng dạy giáo viên</h2></div></div>{teacherLoad.length ? <div className="load-list">{teacherLoad.slice(0, 15).map((x) => <div key={x.teacher}><span>{x.teacher}</span><div><i style={{ width: `${Math.min(100, x.periods / Math.max(1, teacherLoad[0].periods) * 100)}%` }} /></div><b>{x.periods} tiết</b></div>)}</div> : <div className="mini-empty">Chưa có dữ liệu để thống kê.</div>}</section><section className="panel report-card"><div className="panel-title"><div><span>⌂</span><h2>Thống kê theo lớp</h2></div></div><div className="report-table"><table><thead><tr><th>Lớp</th><th>Số tiết</th><th>Môn</th></tr></thead><tbody>{[...new Set(allLessons.map((x) => x.className))].sort().map((className) => <tr key={className}><td><strong>{className}</strong></td><td>{allLessons.filter((x) => x.className === className).length}</td><td>{new Set(allLessons.filter((x) => x.className === className).map((x) => x.subject)).size}</td></tr>)}</tbody></table></div></section></div>
        <section className="panel printable-timetable"><div className="print-heading"><p>{profile.schoolName.toLocaleUpperCase("vi")}</p><h2>{name}</h2><span>Năm học {profile.schoolYear}</span></div>{printLessons.length ? <div className="report-table"><table><thead><tr><th>Lớp</th><th>Thứ</th><th>Buổi</th><th>Tiết</th><th>Môn</th><th>Giáo viên</th><th>Phòng</th></tr></thead><tbody>{printLessons.slice().sort((a, b) => a.className.localeCompare(b.className, "vi") || a.day - b.day || a.period - b.period).map((lesson, index) => <tr key={`${lesson.className}-${lesson.day}-${lesson.period}-${index}`}><td><strong>{lesson.className}</strong></td><td>{DAY_NAMES[lesson.day]}</td><td>{lesson.session}</td><td>{lesson.period}</td><td>{lesson.subject}</td><td>{lesson.teacher}</td><td>{lesson.room || "—"}</td></tr>)}</tbody></table></div> : <div className="mini-empty">Hãy mở hoặc tạo một thời khóa biểu để in.</div>}</section>
      </section>}
      <footer>EduTKB · Dữ liệu được lưu riêng theo tài khoản ChatGPT · {profile.schoolName}</footer>
    </section>
  </main>;
}

function CatalogEditor({ icon, title, hint, value, setValue, count }: { icon: string; title: string; hint: string; value: string; setValue: (value: string) => void; count: number }) {
  return <section className="panel catalog-card"><div className="panel-title"><div><span>{icon}</span><h2>{title}</h2></div><b>{count}</b></div><small>{hint}</small><textarea value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} /></section>;
}
