"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import * as XLSX from "xlsx";

type Session = "Sáng" | "Chiều" | "Tối";
type NavKey = "home" | "grades" | "classes" | "periods" | "subjects" | "teachers" | "homeroom" | "assignments" | "curriculum" | "analysis" | "schedule" | "campuses" | "sessions" | "days" | "off" | "fixed" | "limits" | "parallel" | "merge" | "split" | "backup" | "restore" | "reset" | "printClass" | "printTeacher" | "publicClass" | "publicTeacher" | "publicSchool" | "links" | "rooms" | "roomAssign" | "account";
type Grade = { name: string; order: number };
type Period = { name: string; session: Session; order: number; time: string };
type Campus = { code: string; name: string };
type Teacher = { code: string; name: string; shortName: string; subjects: string[]; grades: string[]; campuses: string[]; maxPeriods: number; busy: string[] };
type ClassRow = { name: string; grade: string; campus: string; sessions: Session[]; size: number };
type Subject = { code: string; name: string; shortName: string; grades: string[]; sessions: Session[]; double: boolean; fixed: boolean; maxParallel: number; avoid: string[] };
type Room = { code: string; name: string; type: string };
type Assignment = { className: string; subject: string; teacher: string; periods: number };
type Homeroom = { className: string; teacher: string };
type Config = { enabledSessions: Session[]; enabledDays: number[]; maxMorning: number; maxAfternoon: number; maxEvening: number; offSlots: string[]; fixedLessons: { grades: string[]; subject: string; day: number; period: number }[]; mergedGroups: string[][]; splitGroups: string[][] };
type Profile = { schoolName: string; schoolYear: string; campuses: Campus[]; grades: Grade[]; periods: Period[]; teachers: Teacher[]; classes: ClassRow[]; subjects: Subject[]; rooms: Room[]; assignments: Assignment[]; homerooms: Homeroom[]; config: Config };
type Lesson = Assignment & { day: number; period: number; session: Session; room?: string; locked?: boolean };
type Stored = { id: string; name: string; assignments: Assignment[]; schedule: Lesson[]; unresolved: Assignment[]; lessonCount: number; updatedAt: string };
type Share = { token: string; scope: string; label: string; updatedAt: string };

const DAYS: Record<number, string> = { 2: "Thứ 2", 3: "Thứ 3", 4: "Thứ 4", 5: "Thứ 5", 6: "Thứ 6", 7: "Thứ 7", 8: "Chủ nhật" };
const SESSION_START: Record<Session, number> = { "Sáng": 1, "Chiều": 6, "Tối": 11 };
const DEFAULT_PERIODS: Period[] = [
  ...Array.from({ length: 5 }, (_, i) => ({ name: `Tiết ${i + 1}`, session: "Sáng" as Session, order: i + 1, time: ["7h00-7h45", "7h45-8h30", "8h50-9h35", "9h35-10h20", "10h25-11h10"][i] })),
  ...Array.from({ length: 5 }, (_, i) => ({ name: `Tiết ${i + 1}`, session: "Chiều" as Session, order: i + 6, time: ["13h30-14h15", "14h15-15h00", "15h15-16h00", "16h00-16h45", "16h45-17h30"][i] })),
  ...Array.from({ length: 3 }, (_, i) => ({ name: `Tiết ${i + 1}`, session: "Tối" as Session, order: i + 11, time: ["18h00-18h45", "18h50-19h35", "19h40-20h25"][i] })),
];
const DEFAULT_CONFIG: Config = { enabledSessions: ["Sáng", "Chiều"], enabledDays: [2, 3, 4, 5, 6], maxMorning: 5, maxAfternoon: 5, maxEvening: 3, offSlots: [], fixedLessons: [], mergedGroups: [], splitGroups: [] };
const EMPTY: Profile = { schoolName: "Trường của tôi", schoolYear: "2026-2027", campuses: [], grades: [], periods: DEFAULT_PERIODS, teachers: [], classes: [], subjects: [], rooms: [], assignments: [], homerooms: [], config: DEFAULT_CONFIG };

function normalize(raw: Partial<Profile>): Profile {
  const campusRows = Array.isArray(raw.campuses) ? raw.campuses.map((x, i) => typeof x === "string" ? { code: `CS${i + 1}`, name: x } : x) : [];
  const teachers = (raw.teachers ?? []).map((x) => ({ ...x, shortName: x.shortName || x.name.split(" ").at(-1) || x.name, subjects: x.subjects ?? [], grades: x.grades ?? [], campuses: x.campuses ?? [], maxPeriods: x.maxPeriods || 19, busy: x.busy ?? [] }));
  const classes = (raw.classes ?? []).map((x) => ({ ...x, campus: x.campus || campusRows[0]?.code || "", sessions: x.sessions ?? ["Sáng" as Session], size: x.size || 0 }));
  const subjects = (raw.subjects ?? []).map((x) => ({ ...x, shortName: x.shortName || x.name, grades: x.grades ?? [], sessions: x.sessions ?? ["Sáng" as Session, "Chiều" as Session], double: x.double ?? false, fixed: x.fixed ?? false, maxParallel: x.maxParallel || 99, avoid: x.avoid ?? [] }));
  const config = { ...DEFAULT_CONFIG, ...(raw.config ?? {}) };
  return { ...EMPTY, ...raw, campuses: campusRows, teachers, classes, subjects, grades: raw.grades?.length ? raw.grades : [], periods: raw.periods?.length ? raw.periods : DEFAULT_PERIODS, assignments: raw.assignments ?? [], homerooms: raw.homerooms ?? [], config: { ...config, offSlots: config.offSlots ?? [], fixedLessons: config.fixedLessons ?? [], mergedGroups: config.mergedGroups ?? [], splitGroups: config.splitGroups ?? [] } };
}
function uid(prefix: string) { return `${prefix}${Math.random().toString(36).slice(2, 7).toUpperCase()}`; }
function slotKey(day: number, period: number) { return `${day}-${period}`; }
function sessionOf(period: number): Session { return period <= 5 ? "Sáng" : period <= 10 ? "Chiều" : "Tối"; }

export function placementError(profile: Profile, schedule: Lesson[], candidate: Lesson, ignoreIndex = -1) {
  const key = slotKey(candidate.day, candidate.period);
  const teacher = profile.teachers.find((x) => x.name === candidate.teacher);
  const classRow = profile.classes.find((x) => x.name === candidate.className);
  const subject = profile.subjects.find((x) => x.name === candidate.subject);
  if (!teacher) return "Giáo viên chưa có trong danh mục.";
  if (!classRow) return "Lớp chưa có trong danh mục.";
  if (!subject) return "Môn học chưa có trong danh mục.";
  if (!classRow.sessions.includes(candidate.session)) return `${candidate.className} không học buổi ${candidate.session.toLowerCase()}.`;
  if (!subject.sessions.includes(candidate.session)) return `${candidate.subject} không được cấu hình cho buổi ${candidate.session.toLowerCase()}.`;
  if (profile.config.offSlots.includes(key)) return "Đây là tiết nghỉ chung của toàn trường.";
  if (teacher.busy.includes(key)) return `${candidate.teacher} đã báo bận ở tiết này.`;
  if (subject.avoid.includes(key)) return `${candidate.subject} được cấu hình tránh tiết này.`;
  const occupied = schedule.find((lesson, index) => index !== ignoreIndex && lesson.day === candidate.day && lesson.period === candidate.period && (lesson.className === candidate.className || lesson.teacher === candidate.teacher || (!!candidate.room && lesson.room === candidate.room)));
  if (occupied) {
    if (occupied.teacher === candidate.teacher) return `${candidate.teacher} đang dạy lớp ${occupied.className} ở tiết này.`;
    if (occupied.className === candidate.className) return `${candidate.className} đã có môn ${occupied.subject} ở tiết này.`;
    return `Phòng ${candidate.room} đang được sử dụng ở tiết này.`;
  }
  const parallel = schedule.filter((lesson, index) => index !== ignoreIndex && lesson.day === candidate.day && lesson.period === candidate.period && lesson.subject === candidate.subject).length;
  if (parallel >= subject.maxParallel) return `${candidate.subject} đã đạt giới hạn ${subject.maxParallel} lớp học song song.`;
  const sessionCount = schedule.filter((lesson, index) => index !== ignoreIndex && lesson.teacher === candidate.teacher && lesson.day === candidate.day && lesson.session === candidate.session).length;
  const limit = candidate.session === "Sáng" ? profile.config.maxMorning : candidate.session === "Chiều" ? profile.config.maxAfternoon : profile.config.maxEvening;
  if (sessionCount >= limit) return `${candidate.teacher} đã đạt giới hạn ${limit} tiết trong buổi ${candidate.session.toLowerCase()}.`;
  return "";
}

export function scheduleConflicts(profile: Profile, schedule: Lesson[]) {
  return schedule.flatMap((lesson, index) => {
    const error = placementError(profile, schedule, lesson, index);
    return error ? [{ index, error }] : [];
  });
}

const NAV: { title: string; icon: string; items: { key: NavKey; label: string }[] }[] = [
  { title: "Khai báo", icon: "⊞", items: [{ key: "grades", label: "Khối / Khoa" }, { key: "classes", label: "Lớp học" }, { key: "periods", label: "Tiết học" }, { key: "subjects", label: "Môn học" }, { key: "teachers", label: "Giáo viên" }] },
  { title: "Xếp lịch", icon: "◉", items: [{ key: "homeroom", label: "Giáo viên chủ nhiệm" }, { key: "assignments", label: "Phân công giảng dạy" }, { key: "curriculum", label: "Khối - môn - số tiết" }, { key: "analysis", label: "Phân tích PCCM" }, { key: "schedule", label: "Xếp thời khóa biểu" }] },
  { title: "Thiết lập", icon: "⚙", items: [{ key: "campuses", label: "Cơ sở học tập" }, { key: "sessions", label: "Buổi học" }, { key: "days", label: "Ngày học" }, { key: "off", label: "Tiết nghỉ chung" }, { key: "fixed", label: "Môn cố định" }, { key: "limits", label: "Giới hạn số tiết" }, { key: "parallel", label: "Số lớp song song" }] },
  { title: "Ghép lớp", icon: "◇", items: [{ key: "merge", label: "Chọn lớp ghép" }] },
  { title: "Tách lớp", icon: "◇", items: [{ key: "split", label: "Chọn lớp tách" }] },
  { title: "In thời khóa biểu", icon: "▣", items: [{ key: "printClass", label: "Theo lớp" }, { key: "printTeacher", label: "Theo giáo viên" }] },
  { title: "Công bố lịch", icon: "◉", items: [{ key: "publicClass", label: "Cho học sinh" }, { key: "publicTeacher", label: "Cho giáo viên" }, { key: "publicSchool", label: "Toàn trường" }, { key: "links", label: "Quản lý liên kết" }] },
  { title: "Dữ liệu", icon: "▤", items: [{ key: "backup", label: "Sao lưu Excel" }, { key: "restore", label: "Khôi phục" }, { key: "reset", label: "Năm học mới" }] },
  { title: "Xếp phòng", icon: "⌂", items: [{ key: "rooms", label: "Phòng" }, { key: "roomAssign", label: "Sắp xếp" }] },
  { title: "Tài khoản", icon: "♙", items: [{ key: "account", label: "Thông tin tài khoản" }] },
];

export default function TkbConsole({ user, account }: { user: { name: string; email: string }; account: { role: string; licenseStatus: string; expiresAt: string } }) {
  const [tab, setTab] = useState<NavKey>("home");
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [saved, setSaved] = useState<Stored[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [schedule, setSchedule] = useState<Lesson[]>([]);
  const [unresolved, setUnresolved] = useState<Assignment[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const restoreRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void (async () => {
    const [p, s, publicRes] = await Promise.all([fetch("/api/settings", { cache: "no-store" }), fetch("/api/timetables", { cache: "no-store" }), fetch("/api/public-shares", { cache: "no-store" })]);
    if (p.ok) setProfile(normalize((await p.json()).data));
    if (s.ok) {
      const stored = (await s.json()).data ?? [];
      setSaved(stored);
      if (stored[0]?.schedule?.length) { setSchedule(stored[0].schedule); setUnresolved(stored[0].unresolved ?? []); }
    }
    if (publicRes.ok) setShares((await publicRes.json()).data ?? []);
    setLoading(false);
  })(); }, []);

  async function persist(next = profile, message = "Đã lưu dữ liệu vào tài khoản.") {
    const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    setNotice(res.ok ? message : "Không thể lưu dữ liệu. Hãy kiểm tra lại tên trường và năm học.");
    if (res.ok) setProfile(next);
  }
  function patch<K extends keyof Profile>(key: K, value: Profile[K]) { setProfile((old) => ({ ...old, [key]: value })); }
  function patchConfig(value: Partial<Config>) { setProfile((old) => ({ ...old, config: { ...old.config, ...value } })); }

  function generate() {
    const periods = profile.periods.filter((p) => profile.config.enabledSessions.includes(p.session));
    const slots = profile.config.enabledDays.flatMap((day) => periods.map((p) => ({ day, period: p.order, session: p.session })));
    const rows: Lesson[] = []; const missing: Assignment[] = [];
    const expanded = profile.assignments.flatMap((a) => Array.from({ length: a.periods }, () => ({ ...a, periods: 1 })));
    for (const a of expanded) {
      const fixed = profile.config.fixedLessons.find((x) => x.subject === a.subject && x.grades.includes(profile.classes.find((c) => c.name === a.className)?.grade ?? ""));
      const candidates = fixed ? slots.filter((x) => x.day === fixed.day && x.period === fixed.period) : slots;
      const target = candidates.find((x) => !placementError(profile, rows, { ...a, ...x }));
      if (target) {
        const room = profile.rooms.find((candidate) => !rows.some((l) => l.day === target.day && l.period === target.period && l.room === candidate.code))?.code;
        rows.push({ ...a, ...target, room });
      } else missing.push(a);
    }
    setSchedule(rows); setUnresolved(missing); setSelectedClass(profile.classes[0]?.name ?? "");
    setNotice(missing.length ? `Đã xếp ${rows.length} tiết; còn ${missing.length} tiết cần xử lý.` : `Đã xếp đủ ${rows.length} tiết, không trùng lớp hoặc giáo viên.`);
  }
  async function saveSchedule() {
    const name = `TKB ${profile.schoolYear} – ${new Date().toLocaleDateString("vi-VN")}`;
    const res = await fetch("/api/timetables", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, assignments: profile.assignments, schedule, unresolved }) });
    if (res.ok) { const latest = await fetch("/api/timetables", { cache: "no-store" }); setSaved((await latest.json()).data ?? []); setNotice("Đã lưu phiên bản thời khóa biểu."); }
  }

  const teacherLoad = useMemo(() => profile.teachers.map((t) => ({ ...t, load: profile.assignments.filter((a) => a.teacher === t.name).reduce((s, a) => s + a.periods, 0) })), [profile.teachers, profile.assignments]);
  const activeClass = selectedClass || profile.classes[0]?.name || "";
  const currentSchedule = schedule.length ? schedule : saved[0]?.schedule ?? [];

  async function createShare(scope: "class" | "teacher" | "school", label: string) {
    if (!currentSchedule.length) { setNotice("Hãy xếp hoặc mở một thời khóa biểu trước khi công khai."); return; }
    const snapshot = { schoolName: profile.schoolName, schoolYear: profile.schoolYear, scope, label, schedule: currentSchedule, days: profile.config.enabledDays, periods: profile.periods.filter((p) => profile.config.enabledSessions.includes(p.session)) };
    const res = await fetch("/api/public-shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, label, snapshot }) });
    if (res.ok) { const row = (await res.json()).data as Share; setShares((old) => [row, ...old]); setNotice("Đã tạo liên kết công khai mới."); }
  }

  async function resetAll() {
    if (!confirm("Xóa toàn bộ dữ liệu khai báo và cấu hình? Các phiên bản TKB đã lưu vẫn được giữ lại.")) return;
    await persist(EMPTY, "Đã làm mới dữ liệu khai báo."); setSchedule([]); setUnresolved([]);
  }

  function exportWorkbook() {
    const wb = XLSX.utils.book_new();
    const add = (name: string, rows: unknown[]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
    add("Khoi", profile.grades); add("Lop", profile.classes); add("Tiet", profile.periods); add("Mon", profile.subjects); add("GiaoVien", profile.teachers); add("PhanCong", profile.assignments); add("TKB", schedule);
    XLSX.writeFile(wb, `TKB-${profile.schoolYear}.xlsx`);
  }
  async function importWorkbook(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const wb = XLSX.read(await file.arrayBuffer());
    const rows = <T,>(name: string) => wb.Sheets[name] ? XLSX.utils.sheet_to_json<T>(wb.Sheets[name]) : [];
    const next = normalize({ ...profile, grades: rows<Grade>("Khoi"), classes: rows<ClassRow>("Lop"), periods: rows<Period>("Tiet"), subjects: rows<Subject>("Mon"), teachers: rows<Teacher>("GiaoVien"), assignments: rows<Assignment>("PhanCong") });
    await persist(next, "Đã nhập và lưu dữ liệu từ Excel."); e.target.value = "";
  }

  return <main className="tkb-console">
    <aside className="tkb-side">
      <button className="tkb-logo" onClick={() => setTab("home")} aria-label="Về trang tổng quan"><img className="console-brand-image" src="/edutkb-mark.svg" alt="" /><span className="brand-copy"><strong>EduTKB</strong><small>Thời khóa biểu thông minh</small></span></button>
      {NAV.map((group) => <section key={group.title}><h3><span>{group.icon}</span>{group.title}</h3>{group.items.map((item) => <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}>• {item.label}</button>)}</section>)}
      <button className="excel-link" onClick={exportWorkbook}>⇩ Xuất dữ liệu Excel</button>
    </aside>
    <section className="tkb-main">
      <header className="tkb-top"><div><strong>{profile.schoolName}</strong><small>Năm học {profile.schoolYear}</small></div><div><a className={`license-badge ${account.role==="admin"||account.role==="super_admin"||new Date(account.expiresAt)>new Date()?"valid":"expired"}`} href="/activate">{account.role==="admin"||account.role==="super_admin"?"Quản trị tối cao":account.licenseStatus==="active"?"Bản quyền":"Dùng thử"}{account.role!=="admin"&&account.role!=="super_admin"&&` · ${new Date(account.expiresAt).toLocaleDateString("vi-VN")}`}</a><span>{user.name}</span><a href="/signout-with-chatgpt?return_to=/">Đăng xuất</a></div></header>
      {loading ? <div className="tkb-loading">Đang tải dữ liệu nhà trường…</div> : <>
        {tab === "home" && <Dashboard profile={profile} saved={saved} go={setTab} />}
        {tab === "grades" && <SimpleCatalog title="Khối / Khoa" rows={profile.grades} fields={["name", "order"]} labels={["Tên khối", "Thứ tự"]} onChange={(rows) => patch("grades", rows as Grade[])} onSave={() => persist()} />}
        {tab === "classes" && <Classes profile={profile} setProfile={setProfile} save={() => persist()} />}
        {tab === "periods" && <Periods profile={profile} setProfile={setProfile} save={() => persist()} />}
        {tab === "subjects" && <Subjects profile={profile} setProfile={setProfile} save={() => persist()} />}
        {tab === "teachers" && <Teachers profile={profile} setProfile={setProfile} save={() => persist()} />}
        {tab === "homeroom" && <Homerooms profile={profile} setProfile={setProfile} save={() => persist()} />}
        {tab === "assignments" && <Assignments profile={profile} setProfile={setProfile} save={() => persist()} />}
        {tab === "curriculum" && <Curriculum profile={profile} setProfile={setProfile} save={() => persist()} />}
        {tab === "analysis" && <Analysis rows={teacherLoad} />}
        {tab === "schedule" && <Schedule profile={profile} schedule={schedule} setSchedule={setSchedule} unresolved={unresolved} setUnresolved={setUnresolved} activeClass={activeClass} setClass={setSelectedClass} generate={generate} save={saveSchedule} notify={setNotice} />}
        {tab === "campuses" && <Campuses profile={profile} setProfile={setProfile} save={() => persist()} />}
        {tab === "sessions" && <ChoiceConfig title="Thiết lập buổi học" options={(["Sáng", "Chiều", "Tối"] as Session[]).map((x) => ({ value: x, label: x }))} selected={profile.config.enabledSessions} setSelected={(x) => patchConfig({ enabledSessions: x as Session[] })} save={() => persist()} />}
        {tab === "days" && <ChoiceConfig title="Thiết lập ngày học" options={Object.entries(DAYS).map(([value, label]) => ({ value: Number(value), label }))} selected={profile.config.enabledDays} setSelected={(x) => patchConfig({ enabledDays: x as number[] })} save={() => persist()} />}
        {tab === "off" && <SlotPicker title="Set tiết nghỉ toàn trường" selected={profile.config.offSlots} onChange={(x) => patchConfig({ offSlots: x })} periods={profile.periods} days={profile.config.enabledDays} save={() => persist()} />}
        {tab === "fixed" && <FixedLessons profile={profile} setProfile={setProfile} save={() => persist()} />}
        {tab === "limits" && <Limits profile={profile} setProfile={setProfile} save={() => persist()} />}
        {tab === "parallel" && <Parallel profile={profile} setProfile={setProfile} save={() => persist()} />}
        {tab === "merge" && <Groups title="Ghép lớp" classes={profile.classes} groups={profile.config.mergedGroups} onChange={(x) => patchConfig({ mergedGroups: x })} save={() => persist()} />}
        {tab === "split" && <Groups title="Tách lớp" classes={profile.classes} groups={profile.config.splitGroups} onChange={(x) => patchConfig({ splitGroups: x })} save={() => persist()} />}
        {tab === "backup" && <Backup saved={saved} exportWorkbook={exportWorkbook} restoreRef={restoreRef} importWorkbook={importWorkbook} />}
        {tab === "restore" && <Restore restoreRef={restoreRef} importWorkbook={importWorkbook} />}
        {tab === "reset" && <Reset onReset={resetAll} />}
        {tab === "printClass" && <PrintTimetable mode="class" profile={profile} schedule={currentSchedule} />}
        {tab === "printTeacher" && <PrintTimetable mode="teacher" profile={profile} schedule={currentSchedule} />}
        {tab === "publicClass" && <Publish mode="class" labels={profile.classes.map((x) => x.name)} shares={shares} createShare={createShare} />}
        {tab === "publicTeacher" && <Publish mode="teacher" labels={profile.teachers.map((x) => x.name)} shares={shares} createShare={createShare} />}
        {tab === "publicSchool" && <Publish mode="school" labels={["Toàn trường"]} shares={shares} createShare={createShare} />}
        {tab === "links" && <ShareLinks shares={shares} />}
        {tab === "rooms" && <Rooms profile={profile} setProfile={setProfile} save={() => persist()} />}
        {tab === "roomAssign" && <RoomAssignment profile={profile} schedule={currentSchedule} setSchedule={setSchedule} />}
        {tab === "account" && <Account profile={profile} setProfile={setProfile} user={user} account={account} save={() => persist()} />}
        {notice && <div className="tkb-toast" onClick={() => setNotice("")}>{notice}</div>}
      </>}
    </section>
  </main>;
}

function Page({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) { return <section className="console-page"><div className="page-head"><h1>{title}</h1><div>{actions}</div></div>{children}</section>; }
function Button({ children, onClick, danger = false }: { children: React.ReactNode; onClick?: () => void; danger?: boolean }) { return <button className={danger ? "c-btn danger" : "c-btn"} onClick={onClick}>{children}</button>; }

function Dashboard({ profile, saved, go }: { profile: Profile; saved: Stored[]; go: (x: NavKey) => void }) {
  const steps: [string, NavKey][] = [["Khối", "grades"], ["Lớp", "classes"], ["Tiết", "periods"], ["Môn", "subjects"], ["Giáo viên", "teachers"], ["GVCN", "homeroom"], ["Phân công", "assignments"], ["Set số tiết", "curriculum"], ["Xếp TKB", "schedule"]];
  return <div className="dashboard-page"><div className="school-banner"><div><small>KHÔNG GIAN ĐIỀU PHỐI</small><strong>{profile.schoolName}</strong><p>Năm học {profile.schoolYear}</p></div><button onClick={() => go("schedule")}>Xếp lịch ngay →</button></div><div className="stat-row">{[[profile.grades.length,"Khối"],[profile.classes.length,"Lớp"],[profile.periods.length,"Tiết"],[profile.subjects.length,"Môn"],[profile.teachers.length,"Giáo viên"]].map(([n,l],i) => <article key={l}><span>0{i+1}</span><b>{n}</b><small>{l}</small></article>)}</div><section className="workflow"><div className="section-heading"><small>QUY TRÌNH GỢI Ý</small><h2>9 điểm chạm để có lịch học hoàn chỉnh</h2></div><div>{steps.map(([label,key],i) => <button key={key} onClick={() => go(key)}><i>{String(i+1).padStart(2,"0")}</i><span>{label}</span><b>→</b></button>)}</div></section><section className="welcome-help"><small>BẮT ĐẦU NHANH</small><h2>Điều phối lịch học theo cách của nhà trường</h2><p>Khai báo dữ liệu một lần, kiểm tra tải giảng dạy và tạo lịch sáng, chiều, tối theo các ràng buộc thực tế.</p><div><Button onClick={() => go("assignments")}>Phân công chuyên môn</Button><Button onClick={() => go("schedule")}>Mở bàn xếp lịch</Button></div><em>{saved.length} phương án đã được lưu an toàn</em></section></div>;
}

function SimpleCatalog({ title, rows, fields, labels, onChange, onSave }: { title: string; rows: Record<string, unknown>[]; fields: string[]; labels: string[]; onChange: (x: Record<string, unknown>[]) => void; onSave: () => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const add = () => { if (!String(draft[fields[0]] ?? "").trim()) return; onChange([...rows, Object.fromEntries(fields.map((f) => [f, f === "order" ? Number(draft[f] || rows.length) : draft[f] || ""]))]); setDraft({}); };
  return <Page title={title} actions={<Button onClick={onSave}>Lưu dữ liệu</Button>}><div className="split-admin"><div className="record-list"><div className="record-toolbar"><b>{rows.length} mục</b><span>Sắp xếp</span></div>{rows.map((row,i) => <article key={i}><span>{String(row[fields[0]])}</span><button onClick={() => onChange(rows.filter((_,x) => x !== i))}>×</button></article>)}</div><div className="record-form">{fields.map((f,i) => <label key={f}>{labels[i]}<input value={draft[f] ?? ""} type={f === "order" ? "number" : "text"} onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))} /></label>)}<Button onClick={add}>Thêm</Button></div></div></Page>;
}
function Classes({ profile, setProfile, save }: PanelProps) { const [name,setName]=useState(""); const [grade,setGrade]=useState(profile.grades[0]?.name??""); const [sessions,setSessions]=useState<Session[]>(["Sáng"]); return <Page title="Lớp học" actions={<Button onClick={save}>Lưu</Button>}><div className="split-admin"><div className="record-list">{profile.classes.map((c,i)=><article key={c.name}><span><b>{c.name}</b><small>{c.grade} · {c.sessions.join(", ")}</small></span><button onClick={()=>setProfile({...profile,classes:profile.classes.filter((_,x)=>x!==i)})}>×</button></article>)}</div><div className="record-form"><label>Khối<select value={grade} onChange={e=>setGrade(e.target.value)}>{profile.grades.map(g=><option key={g.name}>{g.name}</option>)}</select></label><label>Tên lớp<input value={name} onChange={e=>setName(e.target.value)} placeholder="10C1, 10C2…" /></label><CheckRow values={(["Sáng","Chiều","Tối"] as Session[])} selected={sessions} onChange={setSessions}/><Button onClick={()=>{if(name.trim()) {setProfile({...profile,classes:[...profile.classes,{name:name.trim(),grade,campus:profile.campuses[0]?.code??"",sessions,size:0}]});setName("");}}}>Thêm lớp</Button></div></div></Page>; }
function Periods({ profile, setProfile, save }: PanelProps) { const [session,setSession]=useState<Session>("Sáng"); const [time,setTime]=useState(""); return <Page title="Tiết học" actions={<Button onClick={save}>Lưu</Button>}><div className="split-admin"><div className="record-list">{profile.periods.map((p,i)=><article key={`${p.session}-${p.order}`}><span><b>{p.name} [{p.session[0]}]</b><small>{p.time}</small></span><button onClick={()=>setProfile({...profile,periods:profile.periods.filter((_,x)=>x!==i)})}>×</button></article>)}</div><div className="record-form"><CheckRow values={(["Sáng","Chiều","Tối"] as Session[])} selected={[session]} onChange={x=>setSession(x.at(-1)??"Sáng")}/><label>Thời gian<input value={time} onChange={e=>setTime(e.target.value)} placeholder="7h00-7h45" /></label><Button onClick={()=>{const count=profile.periods.filter(p=>p.session===session).length;setProfile({...profile,periods:[...profile.periods,{name:`Tiết ${count+1}`,session,order:SESSION_START[session]+count,time}]});setTime("");}}>Thêm tiết</Button></div></div></Page>; }
function Subjects({ profile, setProfile, save }: PanelProps) { const [name,setName]=useState(""); const [shortName,setShortName]=useState(""); return <Page title="Môn học" actions={<Button onClick={save}>Lưu</Button>}><div className="split-admin"><div className="record-list">{profile.subjects.map((s,i)=><article key={s.code}><span><b>{s.name}</b><small>{s.grades.join(", ")} · tối đa {s.maxParallel} lớp/tiết</small></span><button onClick={()=>setProfile({...profile,subjects:profile.subjects.filter((_,x)=>x!==i)})}>×</button></article>)}</div><div className="record-form"><label>Tên môn<input value={name} onChange={e=>setName(e.target.value)} /></label><label>Tên rút gọn<input value={shortName} onChange={e=>setShortName(e.target.value)} /></label><Button onClick={()=>{if(name.trim()) setProfile({...profile,subjects:[...profile.subjects,{code:uid("MH"),name:name.trim(),shortName:shortName||name.trim(),grades:profile.grades.map(g=>g.name),sessions:profile.config.enabledSessions,double:false,fixed:false,maxParallel:99,avoid:[]}]});setName("");setShortName("");}}>Thêm môn</Button></div></div></Page>; }
function Teachers({ profile, setProfile, save }: PanelProps) { const [name,setName]=useState(""); const [shortName,setShortName]=useState(""); return <Page title="Giáo viên" actions={<Button onClick={save}>Lưu</Button>}><div className="split-admin"><div className="record-list teacher-list">{profile.teachers.map((t,i)=><article key={t.code}><span><b>{t.name}</b><small>{t.subjects.join(", ")} · định mức {t.maxPeriods}</small></span><button onClick={()=>setProfile({...profile,teachers:profile.teachers.filter((_,x)=>x!==i)})}>×</button></article>)}</div><div className="record-form"><label>Tên giáo viên<input value={name} onChange={e=>setName(e.target.value)} /></label><label>Tên gọi ngắn<input value={shortName} onChange={e=>setShortName(e.target.value)} /></label><Button onClick={()=>{if(name.trim()) setProfile({...profile,teachers:[...profile.teachers,{code:uid("GV"),name:name.trim(),shortName:shortName||name.trim().split(" ").at(-1)||name,subjects:[],grades:profile.grades.map(g=>g.name),campuses:profile.campuses.map(c=>c.code),maxPeriods:19,busy:[]}]});setName("");setShortName("");}}>Thêm giáo viên</Button></div></div></Page>; }

type PanelProps = { profile: Profile; setProfile: (p: Profile) => void; save: () => void };
function CheckRow<T extends string | number>({ values, selected, onChange }: { values:T[]; selected:T[]; onChange:(x:T[])=>void }) { return <div className="check-row">{values.map(v=><label key={v}><input type="checkbox" checked={selected.includes(v)} onChange={()=>onChange(selected.includes(v)?selected.filter(x=>x!==v):[...selected,v])}/>{v}</label>)}</div>; }

function Homerooms({ profile,setProfile,save }:PanelProps){return <Page title="Phân công giáo viên chủ nhiệm" actions={<Button onClick={save}>Lưu phân công</Button>}><div className="grade-columns">{profile.grades.map(g=><section key={g.name}><h3>{g.name}</h3>{profile.classes.filter(c=>c.grade===g.name).map(c=><label key={c.name}><b>{c.name}</b><select value={profile.homerooms.find(h=>h.className===c.name)?.teacher??""} onChange={e=>setProfile({...profile,homerooms:[...profile.homerooms.filter(h=>h.className!==c.name),...(e.target.value?[{className:c.name,teacher:e.target.value}]:[])]})}><option value="">Chưa phân công</option>{profile.teachers.map(t=><option key={t.code}>{t.name}</option>)}</select></label>)}</section>)}</div></Page>}
function Assignments({profile,setProfile,save}:PanelProps){const [teacher,setTeacher]=useState(profile.teachers[0]?.name??"");const [subject,setSubject]=useState(profile.subjects[0]?.name??"");const [classes,setClasses]=useState<string[]>([]);const [periods,setPeriods]=useState(1);return <Page title="Phân công chuyên môn" actions={<Button onClick={save}>Lưu phân công</Button>}><div className="assign-builder"><label>Giáo viên<select value={teacher} onChange={e=>setTeacher(e.target.value)}>{profile.teachers.map(t=><option key={t.code}>{t.name}</option>)}</select></label><label>Môn<select value={subject} onChange={e=>setSubject(e.target.value)}>{profile.subjects.map(s=><option key={s.code}>{s.name}</option>)}</select></label><label>Số tiết<input type="number" min={1} value={periods} onChange={e=>setPeriods(Number(e.target.value))}/></label><CheckRow values={profile.classes.map(c=>c.name)} selected={classes} onChange={setClasses}/><Button onClick={()=>{const add=classes.map(className=>({className,subject,teacher,periods}));setProfile({...profile,assignments:[...profile.assignments.filter(a=>!(classes.includes(a.className)&&a.subject===subject)),...add]});setClasses([])}}>Ghi phân công</Button></div><div className="data-table"><table><thead><tr><th>Giáo viên</th><th>Môn</th><th>Lớp</th><th>Tiết/tuần</th><th/></tr></thead><tbody>{profile.assignments.map((a,i)=><tr key={`${a.teacher}-${a.className}-${a.subject}`}><td>{a.teacher}</td><td>{a.subject}</td><td>{a.className}</td><td>{a.periods}</td><td><button onClick={()=>setProfile({...profile,assignments:profile.assignments.filter((_,x)=>x!==i)})}>Xóa</button></td></tr>)}</tbody></table></div></Page>}
function Curriculum({profile,setProfile,save}:PanelProps){return <Page title="Số tiết quy định" actions={<Button onClick={save}>Lưu số tiết</Button>}><div className="data-table curriculum"><table><thead><tr><th>Khối</th><th>Môn học</th>{profile.classes.map(c=><th key={c.name}>{c.name}</th>)}</tr></thead><tbody>{profile.subjects.map(s=><tr key={s.code}><td>{s.grades.join(", ")}</td><td><b>{s.name}</b></td>{profile.classes.map(c=>{const a=profile.assignments.find(x=>x.className===c.name&&x.subject===s.name);return <td key={c.name}><input type="number" min={0} value={a?.periods??0} onChange={e=>{const n=Number(e.target.value);const teacher=a?.teacher??"Chưa phân công";setProfile({...profile,assignments:[...profile.assignments.filter(x=>!(x.className===c.name&&x.subject===s.name)),...(n?[{className:c.name,subject:s.name,teacher,periods:n}]:[])]})}}/></td>})}</tr>)}</tbody></table></div></Page>}
function Analysis({rows}:{rows:(Teacher&{load:number})[]}){const overload=rows.filter(r=>r.load>r.maxPeriods);return <Page title="Phân tích phân công chuyên môn"><div className="analysis-stats"><article><b>{rows.length}</b><span>Tổng giáo viên</span></article><article className="red"><b>{overload.length}</b><span>Quá tải</span></article><article className="green"><b>{rows.length-overload.length}</b><span>An toàn</span></article></div>{overload.length>0&&<div className="warning-box">Cảnh báo: Có {overload.length} giáo viên vượt định mức số tiết.</div>}<div className="data-table"><table><thead><tr><th>Giáo viên</th><th>Môn đảm nhiệm</th><th>Tổng tiết</th><th>Định mức</th><th>Tải công suất</th><th>Trạng thái</th></tr></thead><tbody>{rows.map(r=>{const rate=r.maxPeriods?Math.round(r.load/r.maxPeriods*100):0;return <tr key={r.code}><td><b>{r.name}</b></td><td>{r.subjects.join(", ")||"Theo phân công"}</td><td>{r.load}</td><td>{r.maxPeriods}</td><td><div className="loadbar"><i style={{width:`${Math.min(rate,100)}%`}}/><span>{rate}%</span></div></td><td><em className={rate>100?"bad":"good"}>{rate>100?"Quá tải":"An toàn"}</em></td></tr>})}</tbody></table></div></Page>}

function Schedule({profile,schedule,setSchedule,unresolved,setUnresolved,activeClass,setClass,generate,save,notify}:{profile:Profile;schedule:Lesson[];setSchedule:React.Dispatch<React.SetStateAction<Lesson[]>>;unresolved:Assignment[];setUnresolved:React.Dispatch<React.SetStateAction<Assignment[]>>;activeClass:string;setClass:(x:string)=>void;generate:()=>void;save:()=>void;notify:(x:string)=>void}) {
  const periods=profile.periods.filter(p=>profile.config.enabledSessions.includes(p.session));
  const [editor,setEditor]=useState<{index:number|null;draft:Lesson}|null>(null);
  const [over,setOver]=useState("");
  const [autoMode,setAutoMode]=useState<"school"|"class">("school");
  const [selectedPool,setSelectedPool]=useState<Assignment|null>(null);
  const gradeOrder=new Map(profile.grades.map((grade,index)=>[grade.name,grade.order??index]));
  const classRows=[...profile.classes].sort((a,b)=>(gradeOrder.get(a.grade)??999)-(gradeOrder.get(b.grade)??999)||a.name.localeCompare(b.name,"vi",{numeric:true}));
  const classes=classRows.map(x=>x.name);
  const makeDraft=(className:string,day:number,period:number):Lesson=>({className:className||activeClass||classes[0]||"",subject:profile.subjects[0]?.name||"",teacher:profile.teachers[0]?.name||"",periods:1,day,period,session:profile.periods.find(x=>x.order===period)?.session??sessionOf(period),room:""});
  const openCell=(className:string,day:number,period:number)=>{setClass(className);setEditor({index:null,draft:makeDraft(className,day,period)});};
  const edit=(lesson:Lesson,index:number)=>setEditor({index,draft:{...lesson}});
  const commit=()=>{
    if(!editor)return;
    const error=placementError(profile,schedule,editor.draft,editor.index??-1);
    if(error){notify(error);return;}
    if(editor.index===null)setSchedule(old=>[...old,editor.draft]);
    else setSchedule(old=>old.map((x,i)=>i===editor.index?editor.draft:x));
    setEditor(null);notify(editor.index===null?"Đã thêm tiết học.":"Đã cập nhật tiết học.");
  };
  const remove=(index:number)=>{const lesson=schedule[index];setSchedule(old=>old.filter((_,i)=>i!==index));setUnresolved(old=>[...old,{className:lesson.className,subject:lesson.subject,teacher:lesson.teacher,periods:1}]);setEditor(null);notify("Đã chuyển tiết vào kho chưa xếp.");};
  const readDrag=(event:React.DragEvent)=>JSON.parse(event.dataTransfer.getData("application/x-edutkb")||event.dataTransfer.getData("text/plain")) as {kind:"lesson"|"pool";index?:number;assignment?:Assignment};
  const writeDrag=(event:React.DragEvent,payload:{kind:"lesson"|"pool";index?:number;assignment?:Assignment})=>{const data=JSON.stringify(payload);event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("application/x-edutkb",data);event.dataTransfer.setData("text/plain",data);};
  const placeAssignment=(source:Assignment,className:string,day:number,period:number)=>{
    if(source.className!==className){notify(`Tiết này thuộc lớp ${source.className}. Hãy đặt vào bảng của đúng lớp.`);return;}
    const assigned=profile.assignments.find(x=>x.className===source.className&&x.subject===source.subject&&x.teacher===source.teacher);
    const placed=schedule.filter(x=>x.className===source.className&&x.subject===source.subject&&x.teacher===source.teacher).length;
    if(!assigned||placed>=assigned.periods){notify("Môn này đã được xếp đủ số tiết đã phân công.");setSelectedPool(null);return;}
    const session=profile.periods.find(x=>x.order===period)?.session??sessionOf(period);
    const candidate:Lesson={...source,periods:1,day,period,session};
    const error=placementError(profile,schedule,candidate);
    if(error){notify(error);return;}
    setSchedule(old=>[...old,candidate]);
    setUnresolved(old=>{const index=old.findIndex(x=>x.className===source.className&&x.subject===source.subject&&x.teacher===source.teacher);return index<0?old:old.filter((_,i)=>i!==index);});
    setSelectedPool(null);notify("Đã xếp tiết và kiểm tra không có xung đột.");
  };
  const dropAt=(event:React.DragEvent,className:string,day:number,period:number)=>{
    event.preventDefault();setOver("");
    try{
      const payload=readDrag(event);
      const session=profile.periods.find(x=>x.order===period)?.session??sessionOf(period);
      if(payload.kind==="lesson"){
        const index=payload.index??-1;
        if(schedule[index]?.className!==className){notify("Mỗi tiết chỉ được kéo trong đúng lớp đã phân công.");return;}
        const candidate={...schedule[index],day,period,session};
        const error=placementError(profile,schedule,candidate,index);
        if(error){notify(error);return;}
        setSchedule(old=>old.map((x,i)=>i===index?candidate:x));notify("Đã di chuyển tiết học và kiểm tra không có xung đột.");
      }else{
        if(payload.assignment)placeAssignment(payload.assignment,className,day,period);
      }
    }catch{notify("Không đọc được tiết đang kéo.");}
  };
  const unassignDrop=(event:React.DragEvent)=>{
    event.preventDefault();setOver("");
    try{const payload=readDrag(event);if(payload.kind==="lesson"&&payload.index!==undefined)remove(payload.index);}catch{notify("Không đọc được tiết đang kéo.");}
  };
  const audit=()=>{const errors=scheduleConflicts(profile,schedule);notify(errors.length?`Phát hiện ${errors.length} tiết xung đột. ${errors[0].error}`:`Đã kiểm tra ${schedule.length} tiết: không trùng giáo viên, lớp hoặc phòng.`)};
  const placeNext=()=>{
    const source=unresolved[0];if(!source){notify("Kho tiết chưa xếp đang trống.");return;}
    for(const day of profile.config.enabledDays)for(const p of periods){const candidate:Lesson={...source,periods:1,day,period:p.order,session:p.session};if(!placementError(profile,schedule,candidate)){setSchedule(old=>[...old,candidate]);setUnresolved(old=>old.slice(1));notify(`Trợ lý đã tìm được ${DAYS[day]}, ${p.session.toLowerCase()} ${p.name.toLowerCase()}.`);return;}}
    notify("Chưa tìm được ô hợp lệ cho tiết đầu tiên trong kho.");
  };
  const generateClass=(className:string)=>{
    const classRow=profile.classes.find(x=>x.name===className);if(!classRow){notify("Chưa chọn lớp để tự xếp.");return;}
    const classPeriods=periods.filter(x=>classRow.sessions.includes(x.session));
    const slots=profile.config.enabledDays.flatMap(day=>classPeriods.map(period=>({day,period:period.order,session:period.session})));
    const rows=schedule.filter(x=>x.className!==className);const missing=unresolved.filter(x=>x.className!==className);
    const expanded=profile.assignments.filter(x=>x.className===className).flatMap(x=>Array.from({length:x.periods},()=>({...x,periods:1})));
    for(const assignment of expanded){const target=slots.find(slot=>!placementError(profile,rows,{...assignment,...slot}));if(target){const room=profile.rooms.find(candidate=>!rows.some(x=>x.day===target.day&&x.period===target.period&&x.room===candidate.code))?.code;rows.push({...assignment,...target,room});}else missing.push(assignment);}
    setSchedule(rows);setUnresolved(missing);notify(`Đã tự xếp lớp ${className}: ${rows.filter(x=>x.className===className).length} tiết, còn ${missing.filter(x=>x.className===className).length} tiết chưa xếp.`);
  };
  const teacherWishes=profile.teachers.filter(x=>x.busy.length).map(teacher=>({teacher,summary:teacher.busy.slice(0,8).map(key=>{const [day,period]=key.split("-").map(Number);const p=profile.periods.find(x=>x.order===period);return `${DAYS[day]} ${p?.session.toLowerCase()??""} tiết ${p?.name.replace("Tiết ","")??period}`;}).join(", ")}));
  return <Page title="Bàn xếp thời khóa biểu" actions={<><Button onClick={generate}>Tự xếp toàn trường</Button><Button onClick={audit}>Kiểm tra xung đột</Button>{schedule.length>0&&<Button onClick={save}>Lưu phiên bản</Button>}</>}>
    <div className="schedule-toolbar reference-toolbar"><div className="auto-picker"><b>Tự động:</b><label><input type="radio" checked={autoMode==="school"} onChange={()=>setAutoMode("school")}/> Toàn trường</label><label><input type="radio" checked={autoMode==="class"} onChange={()=>setAutoMode("class")}/> Từng lớp</label>{autoMode==="class"&&<select value={activeClass} onChange={e=>setClass(e.target.value)}>{classes.map(x=><option key={x}>{x}</option>)}</select>}<button onClick={()=>autoMode==="school"?generate():generateClass(activeClass)}>Auto</button></div><div className="schedule-summary"><b>{schedule.length}</b> tiết đã xếp <span>·</span> <strong>{unresolved.length}</strong> chưa xếp</div></div>
    <div className="board-help"><span>Kéo môn vàng vào ô trống để xếp</span><span>Kéo tiết sang ô khác để đổi lịch</span><span>Điện thoại: chạm môn rồi chạm ô +</span><span>Nhấp tiết để sửa hoặc xóa</span><span>Mọi thay đổi đều được kiểm tra trùng</span></div>
    <div className="schedule-workspace"><div className="school-drag-board">{classRows.length?classRows.map((classRow,classIndex)=>{const previous=classRows[classIndex-1];const showGrade=!previous||previous.grade!==classRow.grade;const classPeriods=periods.filter(p=>classRow.sessions.includes(p.session));const assignments=profile.assignments.filter(x=>x.className===classRow.name);return <section className="class-schedule reference-class" key={classRow.name}>{showGrade&&<header className="grade-divider"><b>{classRow.grade}</b><span>{classRows.filter(x=>x.grade===classRow.grade).length} lớp</span></header>}<div className="timetable-grid drag-board"><table><thead><tr><th>Lớp</th><th>Buổi</th><th>Tiết</th><th>Thời gian</th>{profile.config.enabledDays.map(d=><th key={d}>{DAYS[d]}</th>)}</tr></thead><tbody>{classPeriods.map((p,rowIndex)=><tr key={p.order} className={`session-${p.session}`}>{rowIndex===0&&<td rowSpan={classPeriods.length} className="class-name-cell"><button onClick={()=>setClass(classRow.name)}>Sửa</button><strong>{classRow.name}</strong><small>{classRow.campus||"Chưa gán cơ sở"}</small><em>{schedule.filter(x=>x.className===classRow.name).length} tiết</em><button className="class-auto" onClick={()=>generateClass(classRow.name)}>Auto</button></td>}{p.order===classPeriods.find(x=>x.session===p.session)?.order&&<td rowSpan={classPeriods.filter(x=>x.session===p.session).length} className="session-name-cell">{p.session}</td>}<td>{p.name}</td><td>{p.time}</td>{profile.config.enabledDays.map(d=>{const index=schedule.findIndex(x=>x.className===classRow.name&&x.day===d&&x.period===p.order);const lesson=index>=0?schedule[index]:null;const cell=`${classRow.name}-${d}-${p.order}`;return <td key={d} className={`drop-cell ${over===cell?"drop-over":""}`} onDragOver={e=>{e.preventDefault();setOver(cell)}} onDragLeave={()=>setOver("")} onDrop={e=>dropAt(e,classRow.name,d,p.order)}>{lesson?<article className="lesson-card" draggable onDragStart={e=>writeDrag(e,{kind:"lesson",index})} onClick={()=>edit(lesson,index)}><b>{lesson.subject}</b><small>{lesson.teacher}</small>{lesson.room&&<em>{lesson.room}</em>}<button aria-label="Xóa tiết" title="Chuyển vào kho chưa xếp" onClick={e=>{e.stopPropagation();remove(index)}}>×</button></article>:<button className="add-lesson" onClick={()=>selectedPool?placeAssignment(selectedPool,classRow.name,d,p.order):openCell(classRow.name,d,p.order)} aria-label={`Thêm tiết ${classRow.name} ${DAYS[d]} ${p.name}`}>+</button>}</td>})}</tr>)}</tbody></table></div><section className={`class-subject-pool ${over===`pool-${classRow.name}`?"drop-over":""}`} onDragOver={e=>{e.preventDefault();setOver(`pool-${classRow.name}`)}} onDragLeave={()=>setOver("")} onDrop={unassignDrop}>{assignments.length?assignments.map((assignment,i)=>{const placed=schedule.filter(x=>x.className===classRow.name&&x.subject===assignment.subject&&x.teacher===assignment.teacher).length;const remaining=Math.max(assignment.periods-placed,0);const selected=selectedPool?.className===assignment.className&&selectedPool.subject===assignment.subject&&selectedPool.teacher===assignment.teacher;return <article key={`${assignment.subject}-${assignment.teacher}-${i}`} draggable={remaining>0} role="button" tabIndex={remaining>0?0:-1} aria-label={`${assignment.subject}, còn ${remaining} tiết chưa xếp`} className={`${remaining>0?"pending":"complete"} ${selected?"selected":""}`} onClick={()=>remaining>0&&setSelectedPool(selected?null:assignment)} onKeyDown={e=>{if(remaining>0&&(e.key==="Enter"||e.key===" ")){e.preventDefault();setSelectedPool(selected?null:assignment)}}} onDragStart={e=>{if(remaining>0)writeDrag(e,{kind:"pool",assignment})}}><b>{assignment.subject} <span>{assignment.periods} tiết</span></b><small>Đã xếp {placed}/{assignment.periods}</small><em>{assignment.teacher}</em></article>}):<p>Chưa có phân công môn học cho lớp này.</p>}</section></section>}):<div className="empty-schedule-classes"><b>Chưa có lớp học</b><span>Hãy khai báo khối và lớp trước khi xếp thời khóa biểu.</span></div>}</div><aside className="schedule-assistant"><section><h3>Chọn môn nhanh</h3>{(["Sáng","Chiều"] as Session[]).map(session=><div className="mini-slot" key={session}><header><span>{session}</span>{profile.config.enabledDays.map(day=><b key={day}>T{day}</b>)}</header>{periods.filter(x=>x.session===session).map(period=><div key={period.order}><span>{period.name.replace("Tiết ","")}</span>{profile.config.enabledDays.map(day=><button key={day} title={`${DAYS[day]} ${period.name}`} onClick={()=>openCell(activeClass||classes[0]||"",day,period.order)}/>)}</div>)}</div>)}</section><section><h3>Nguyện vọng toàn trường</h3>{teacherWishes.length?teacherWishes.map(({teacher,summary})=><article key={teacher.code}><b>{teacher.shortName||teacher.name}</b><p>{summary}</p></article>):<p>Chưa khai báo tiết bận của giáo viên.</p>}</section>{unresolved.length>0&&<button className="assistant-place" onClick={placeNext}>Gợi ý xếp tiết tiếp theo</button>}</aside></div>
    {editor&&<div className="lesson-editor-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)setEditor(null)}}><section className="lesson-editor" role="dialog" aria-modal="true" aria-labelledby="lesson-editor-title"><header><div><small>CHỈNH TRỰC TIẾP TRÊN LƯỚI</small><h2 id="lesson-editor-title">{editor.index===null?"Thêm tiết học":"Sửa tiết học"}</h2></div><button onClick={()=>setEditor(null)} aria-label="Đóng">×</button></header><div className="lesson-editor-grid"><label>Lớp<select value={editor.draft.className} onChange={e=>setEditor({...editor,draft:{...editor.draft,className:e.target.value}})}>{classes.map(x=><option key={x}>{x}</option>)}</select></label><label>Môn học<select value={editor.draft.subject} onChange={e=>setEditor({...editor,draft:{...editor.draft,subject:e.target.value}})}>{profile.subjects.map(x=><option key={x.code}>{x.name}</option>)}</select></label><label>Giáo viên<select value={editor.draft.teacher} onChange={e=>setEditor({...editor,draft:{...editor.draft,teacher:e.target.value}})}>{profile.teachers.map(x=><option key={x.code}>{x.name}</option>)}</select></label><label>Ngày<select value={editor.draft.day} onChange={e=>setEditor({...editor,draft:{...editor.draft,day:Number(e.target.value)}})}>{profile.config.enabledDays.map(x=><option key={x} value={x}>{DAYS[x]}</option>)}</select></label><label>Tiết<select value={editor.draft.period} onChange={e=>{const period=Number(e.target.value);setEditor({...editor,draft:{...editor.draft,period,session:profile.periods.find(x=>x.order===period)?.session??sessionOf(period)}})}}>{periods.map(x=><option key={x.order} value={x.order}>{x.session} · {x.name} · {x.time}</option>)}</select></label><label>Phòng<select value={editor.draft.room??""} onChange={e=>setEditor({...editor,draft:{...editor.draft,room:e.target.value}})}><option value="">Chưa gán</option>{profile.rooms.map(x=><option key={x.code} value={x.code}>{x.code} – {x.name}</option>)}</select></label></div><footer>{editor.index!==null?<button className="editor-delete" onClick={()=>remove(editor.index!)}>Xóa khỏi lịch</button>:<span/>}<div><button className="editor-cancel" onClick={()=>setEditor(null)}>Hủy</button><Button onClick={commit}>Lưu tiết học</Button></div></footer></section></div>}
  </Page>;
}

function Campuses({profile,setProfile,save}:PanelProps){const [name,setName]=useState("");return <Page title="Set cơ sở" actions={<Button onClick={save}>Lưu cơ sở</Button>}><div className="config-card"><h2>Cơ sở trường</h2><div className="check-row">{profile.campuses.map(c=><label key={c.code}>{c.code} – {c.name}<button onClick={()=>setProfile({...profile,campuses:profile.campuses.filter(x=>x.code!==c.code)})}>×</button></label>)}</div><div className="inline-add"><input value={name} onChange={e=>setName(e.target.value)} placeholder="Tên cơ sở / điểm trường"/><Button onClick={()=>{if(name.trim())setProfile({...profile,campuses:[...profile.campuses,{code:`CS${profile.campuses.length+1}`,name:name.trim()}]});setName("")}}>Thêm cơ sở</Button></div></div></Page>}
function ChoiceConfig<T extends string|number>({title,options,selected,setSelected,save}:{title:string;options:{value:T;label:string}[];selected:T[];setSelected:(x:T[])=>void;save:()=>void}) {
  const toggle=(value:T)=>{
    if(selected.includes(value)) { if(selected.length>1)setSelected(selected.filter(x=>x!==value)); }
    else setSelected([...selected,value]);
  };
  return <Page title={title} actions={<Button onClick={save}>Lưu cấu hình</Button>}><section className="choice-config"><header><div><small>PHẠM VI XẾP LỊCH</small><h2>{title.includes("ngày")?"Chọn các ngày tổ chức học":"Chọn các buổi tổ chức học"}</h2></div><strong>{selected.length}/{options.length} đã chọn</strong></header><div className="choice-options">{options.map(option=><label key={String(option.value)} className={selected.includes(option.value)?"selected":""}><input type="checkbox" checked={selected.includes(option.value)} onChange={()=>toggle(option.value)}/><span><b>{option.label}</b><small>{selected.includes(option.value)?"Đang sử dụng":"Không xếp lịch"}</small></span><i>{selected.includes(option.value)?"✓":""}</i></label>)}</div><p>Luôn cần ít nhất một lựa chọn. Thuật toán tự động và bàn kéo–thả chỉ sử dụng phạm vi đang bật.</p></section></Page>;
}
function SlotPicker({title,selected,onChange,periods,days,save}:{title:string;selected:string[];onChange:(x:string[])=>void;periods:Period[];days:number[];save:()=>void}){return <Page title={title} actions={<Button onClick={save}>Lưu cấu hình</Button>}><div className="slot-matrix"><table><thead><tr><th>Tiết</th>{days.map(d=><th key={d}>{DAYS[d]}</th>)}</tr></thead><tbody>{periods.map(p=><tr key={p.order}><td>{p.session} · {p.name}</td>{days.map(d=>{const k=slotKey(d,p.order);return <td key={d}><input type="checkbox" checked={selected.includes(k)} onChange={()=>onChange(selected.includes(k)?selected.filter(x=>x!==k):[...selected,k])}/></td>})}</tr>)}</tbody></table></div></Page>}
function FixedLessons({profile,setProfile,save}:PanelProps){const [subject,setSubject]=useState(profile.subjects[0]?.name??"");const [day,setDay]=useState(2);const [period,setPeriod]=useState(1);const [grades,setGrades]=useState<string[]>([]);return <Page title="Môn cố định" actions={<Button onClick={save}>Lưu cấu hình</Button>}><div className="record-form compact"><CheckRow values={profile.grades.map(g=>g.name)} selected={grades} onChange={setGrades}/><label>Môn<select value={subject} onChange={e=>setSubject(e.target.value)}>{profile.subjects.map(s=><option key={s.code}>{s.name}</option>)}</select></label><label>Thứ<select value={day} onChange={e=>setDay(Number(e.target.value))}>{profile.config.enabledDays.map(d=><option value={d} key={d}>{DAYS[d]}</option>)}</select></label><label>Tiết<select value={period} onChange={e=>setPeriod(Number(e.target.value))}>{profile.periods.map(p=><option value={p.order} key={p.order}>{p.session} · {p.name}</option>)}</select></label><Button onClick={()=>setProfile({...profile,config:{...profile.config,fixedLessons:[...profile.config.fixedLessons,{grades,subject,day,period}]}})}>Xếp cố định</Button></div><div className="chip-list">{profile.config.fixedLessons.map((x,i)=><span key={i}>{x.subject} · {DAYS[x.day]} tiết {x.period}<button onClick={()=>setProfile({...profile,config:{...profile.config,fixedLessons:profile.config.fixedLessons.filter((_,n)=>n!==i)}})}>×</button></span>)}</div></Page>}
function Limits({profile,setProfile,save}:PanelProps){return <Page title="Giới hạn số tiết dạy / buổi" actions={<Button onClick={save}>Lưu giới hạn</Button>}><div className="record-form compact">{([['Buổi sáng','maxMorning'],['Buổi chiều','maxAfternoon'],['Buổi tối','maxEvening']] as const).map(([label,key])=><label key={key}>{label}<input type="number" min={1} value={profile.config[key]} onChange={e=>setProfile({...profile,config:{...profile.config,[key]:Number(e.target.value)}})}/></label>)}</div></Page>}
function Parallel({profile,setProfile,save}:PanelProps){return <Page title="Giới hạn số lớp / tiết" actions={<Button onClick={save}>Lưu giới hạn</Button>}><div className="data-table"><table><thead><tr><th>Môn</th><th>Số lớp tối đa cùng một tiết</th></tr></thead><tbody>{profile.subjects.map((s,i)=><tr key={s.code}><td>{s.name}</td><td><input type="number" min={1} value={s.maxParallel} onChange={e=>setProfile({...profile,subjects:profile.subjects.map((x,n)=>n===i?{...x,maxParallel:Number(e.target.value)}:x)})}/></td></tr>)}</tbody></table></div></Page>}
function Groups({title,classes,groups,onChange,save}:{title:string;classes:ClassRow[];groups:string[][];onChange:(x:string[][])=>void;save:()=>void}){const [selected,setSelected]=useState<string[]>([]);return <Page title={title} actions={<Button onClick={save}>Lưu nhóm lớp</Button>}><div className="config-card"><CheckRow values={classes.map(c=>c.name)} selected={selected} onChange={setSelected}/><Button onClick={()=>{if(selected.length>1){onChange([...groups,selected]);setSelected([])}}}>{title}</Button></div><div className="chip-list">{groups.map((g,i)=><span key={i}>{g.join(" + ")}<button onClick={()=>onChange(groups.filter((_,n)=>n!==i))}>×</button></span>)}</div></Page>}
function Backup({saved,exportWorkbook,restoreRef,importWorkbook}:{saved:Stored[];exportWorkbook:()=>void;restoreRef:React.RefObject<HTMLInputElement|null>;importWorkbook:(e:ChangeEvent<HTMLInputElement>)=>void}){return <Page title="Excel, sao lưu và phiên bản"><div className="backup-actions"><Button onClick={exportWorkbook}>Xuất toàn bộ Excel .xlsx</Button><Button onClick={()=>restoreRef.current?.click()}>Nhập dữ liệu Excel</Button><input hidden ref={restoreRef} type="file" accept=".xlsx,.xls" onChange={importWorkbook}/></div><div className="saved-cards">{saved.map(s=><article key={s.id}><b>{s.name}</b><span>{s.lessonCount} tiết</span><small>{new Date(s.updatedAt).toLocaleString("vi-VN")}</small></article>)}</div></Page>}

function Restore({restoreRef,importWorkbook}:{restoreRef:React.RefObject<HTMLInputElement|null>;importWorkbook:(e:ChangeEvent<HTMLInputElement>)=>void}){return <Page title="Khôi phục dữ liệu TKB"><div className="restore-card"><span>⇧</span><h2>Khôi phục từ tệp Excel</h2><p>Chọn tệp sao lưu .xlsx đã xuất từ hệ thống. Dữ liệu khối, lớp, tiết, môn, giáo viên và phân công sẽ được cập nhật.</p><Button onClick={()=>restoreRef.current?.click()}>Chọn tệp khôi phục</Button><input hidden ref={restoreRef} type="file" accept=".xlsx,.xls" onChange={importWorkbook}/></div></Page>}
function Reset({onReset}:{onReset:()=>void}){return <Page title="Làm mới dữ liệu"><div className="reset-card"><h2>Làm mới năm học</h2><p>Thao tác này xóa dữ liệu khai báo và cấu hình hiện tại để bắt đầu một năm học mới. Các phiên bản TKB đã lưu vẫn được bảo toàn.</p><Button danger onClick={onReset}>Xóa dữ liệu và làm mới</Button></div></Page>}

function PrintTimetable({mode,profile,schedule}:{mode:"class"|"teacher";profile:Profile;schedule:Lesson[]}){
  const labels=mode==="class"?profile.classes.map(x=>x.name):profile.teachers.map(x=>x.name);const [label,setLabel]=useState(labels[0]??"");const periods=profile.periods.filter(p=>profile.config.enabledSessions.includes(p.session));const lessons=schedule.filter(x=>mode==="class"?x.className===label:x.teacher===label);
  return <Page title={mode==="class"?"In TKB học sinh / lớp":"In TKB giáo viên"} actions={<Button onClick={()=>window.print()}>In thời khóa biểu</Button>}><div className="print-controls"><label>Chọn {mode==="class"?"lớp":"giáo viên"}<select value={label} onChange={e=>setLabel(e.target.value)}>{labels.map(x=><option key={x}>{x}</option>)}</select></label></div><section className="print-view"><header><p>{profile.schoolName.toLocaleUpperCase("vi")}</p><h2>THỜI KHÓA BIỂU {label.toLocaleUpperCase("vi")}</h2><span>Năm học {profile.schoolYear}</span></header><TimetableMatrix profile={profile} periods={periods} lessons={lessons} secondary={mode==="class"?"teacher":"class"}/><footer>Ngày in: {new Date().toLocaleDateString("vi-VN")}</footer></section></Page>
}
function TimetableMatrix({profile,periods,lessons,secondary}:{profile:Profile;periods:Period[];lessons:Lesson[];secondary:"teacher"|"class"}){return <div className="timetable-grid report-matrix"><table><thead><tr><th>Buổi</th><th>Tiết</th><th>Thời gian</th>{profile.config.enabledDays.map(d=><th key={d}>{DAYS[d]}</th>)}</tr></thead><tbody>{periods.map(p=><tr key={p.order}><td>{p.session}</td><td>{p.name}</td><td>{p.time}</td>{profile.config.enabledDays.map(d=>{const l=lessons.find(x=>x.day===d&&x.period===p.order);return <td key={d}>{l?<><b>{l.subject}</b><small>{secondary==="teacher"?l.teacher:l.className}</small><em>{l.room??""}</em></>:""}</td>})}</tr>)}</tbody></table></div>}

function Publish({mode,labels,shares,createShare}:{mode:"class"|"teacher"|"school";labels:string[];shares:Share[];createShare:(scope:"class"|"teacher"|"school",label:string)=>void}){const [label,setLabel]=useState(labels[0]??"");const relevant=shares.filter(x=>x.scope===mode);return <Page title={mode==="school"?"Công khai TKB toàn trường":mode==="class"?"Công khai TKB học sinh":"Công khai TKB giáo viên"}><div className="publish-card"><h2>Tạo liên kết xem lịch không cần đăng nhập</h2>{mode!=="school"&&<label>Chọn {mode==="class"?"lớp":"giáo viên"}<select value={label} onChange={e=>setLabel(e.target.value)}>{labels.map(x=><option key={x}>{x}</option>)}</select></label>}<Button onClick={()=>createShare(mode,mode==="school"?"Toàn trường":label)}>Tạo liên kết công khai</Button></div><ShareRows shares={relevant}/></Page>}
function ShareLinks({shares}:{shares:Share[]}){return <Page title="Quản lý liên kết công khai"><div className="link-summary"><b>{shares.length}</b><span>liên kết đang hoạt động</span></div><ShareRows shares={shares}/></Page>}
function ShareRows({shares}:{shares:Share[]}){function copy(token:string){void navigator.clipboard.writeText(`${window.location.origin}/public/${token}`)}return <div className="share-list">{shares.length?shares.map(x=><article key={x.token}><div><b>{x.label}</b><small>{x.scope==="class"?"Học sinh / lớp":x.scope==="teacher"?"Giáo viên":"Toàn trường"} · {new Date(x.updatedAt).toLocaleString("vi-VN")}</small></div><a href={`/public/${x.token}`} target="_blank">Mở</a><button onClick={()=>copy(x.token)}>Sao chép link</button></article>):<p>Chưa có liên kết công khai.</p>}</div>}

function Rooms({profile,setProfile,save}:PanelProps){const [name,setName]=useState("");const [type,setType]=useState("Phòng học");return <Page title="Danh mục phòng học" actions={<Button onClick={save}>Lưu phòng học</Button>}><div className="split-admin"><div className="record-list">{profile.rooms.map((r,i)=><article key={r.code}><span><b>{r.code} · {r.name}</b><small>{r.type}</small></span><button onClick={()=>setProfile({...profile,rooms:profile.rooms.filter((_,x)=>x!==i)})}>×</button></article>)}</div><div className="record-form"><label>Tên phòng<input value={name} onChange={e=>setName(e.target.value)} placeholder="Phòng 101, Phòng máy 1…"/></label><label>Loại phòng<select value={type} onChange={e=>setType(e.target.value)}><option>Phòng học</option><option>Phòng bộ môn</option><option>Phòng máy</option><option>Phòng thí nghiệm</option></select></label><Button onClick={()=>{if(name.trim())setProfile({...profile,rooms:[...profile.rooms,{code:`P${String(profile.rooms.length+1).padStart(3,"0")}`,name:name.trim(),type}]});setName("")}}>Thêm phòng</Button></div></div></Page>}
function RoomAssignment({profile,schedule,setSchedule}:{profile:Profile;schedule:Lesson[];setSchedule:(x:Lesson[])=>void}){const conflicts=schedule.filter((l,i)=>l.room&&schedule.some((x,n)=>n!==i&&x.day===l.day&&x.period===l.period&&x.room===l.room));return <Page title="Sắp xếp phòng học"><div className="room-stats"><article><b>{profile.rooms.length}</b><span>Phòng</span></article><article><b>{schedule.filter(x=>x.room).length}</b><span>Tiết đã gán</span></article><article className={conflicts.length?"badroom":""}><b>{conflicts.length}</b><span>Xung đột</span></article></div><div className="data-table"><table><thead><tr><th>Lớp</th><th>Môn</th><th>Thời gian</th><th>Phòng</th></tr></thead><tbody>{schedule.map((l,i)=><tr key={i}><td>{l.className}</td><td>{l.subject}</td><td>{DAYS[l.day]} · {l.session} · tiết {l.period}</td><td><select value={l.room??""} onChange={e=>setSchedule(schedule.map((x,n)=>n===i?{...x,room:e.target.value}:x))}><option value="">Chưa gán</option>{profile.rooms.map(r=><option key={r.code} value={r.code}>{r.code} – {r.name}</option>)}</select></td></tr>)}</tbody></table></div></Page>}
function Account({profile,setProfile,user,account,save}:{profile:Profile;setProfile:(x:Profile)=>void;user:{name:string;email:string};account:{role:string;licenseStatus:string;expiresAt:string};save:()=>void}){const admin=account.role==="admin"||account.role==="super_admin";return <Page title="Thông tin tài khoản" actions={<Button onClick={save}>Lưu thông tin trường</Button>}><div className="account-page"><div className="account-avatar">{user.name.slice(0,1).toUpperCase()}</div><div><h2>{user.name}</h2><p>{user.email}</p><div className="account-license"><b>{admin?"Tài khoản Quản trị tối cao":account.licenseStatus==="active"?"Bản quyền đã kích hoạt":"Tài khoản dùng thử"}</b>{admin?<span>Toàn quyền quản lý người dùng, kích hoạt và mã bản quyền</span>:<span>Hiệu lực đến {new Date(account.expiresAt).toLocaleDateString("vi-VN")}</span>}<a href="/activate">{admin?"Trung tâm quản trị":"Quản lý bản quyền"}</a></div><label>Tên trường<input value={profile.schoolName} onChange={e=>setProfile({...profile,schoolName:e.target.value})}/></label><label>Năm học<input value={profile.schoolYear} onChange={e=>setProfile({...profile,schoolYear:e.target.value})} placeholder="2026-2027"/></label><a href="/signout-with-chatgpt?return_to=/">Thoát hệ thống</a></div></div></Page>}
