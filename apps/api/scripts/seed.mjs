/**
 * Seed trường mẫu THPT Demo + dữ liệu đầy đủ + TKB xếp thật bằng solver-core.
 * Chạy: npm run db:migrate xong rồi `npx tsx scripts/seed.mjs`
 * (tsx cần cài qua workspaces — đã có trong devDependencies của @tkb/api).
 */
import postgres from 'postgres';
import crypto from 'node:crypto';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('Thiếu DATABASE_URL'); process.exit(1); }
const sql = postgres(DATABASE_URL, { prepare: false });

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ'];
const TEN = ['Hùng', 'Mai', 'Sơn', 'Hà', 'Nam', 'Lan', 'Bình', 'Thảo', 'Dũng',
             'Nga', 'Tuấn', 'Yến', 'Long', 'Chi', 'Đạt', 'Vân', 'Phong', 'Hạnh'];

const SUBJECTS = [
  { code: 'TOAN', name: 'Toán', short: 'Toán', color: '#DCEAFB', diff: 5, ppw: 4 },
  { code: 'VAN', name: 'Ngữ văn', short: 'Văn', color: '#FBE0E0', diff: 4, ppw: 4 },
  { code: 'ANH', name: 'Tiếng Anh', short: 'Anh', color: '#D6F0EF', diff: 4, ppw: 3 },
  { code: 'LY', name: 'Vật lí', short: 'Lí', color: '#FCE8D5', diff: 5, ppw: 2 },
  { code: 'HOA', name: 'Hoá học', short: 'Hoá', color: '#E8E0F7', diff: 5, ppw: 2 },
  { code: 'TIN', name: 'Tin học', short: 'Tin', color: '#DDE1F5', diff: 3, ppw: 2 }
];
const DEPARTMENTS = ['Tổ Toán - Tin', 'Tổ Khoa học tự nhiên', 'Tổ Ngữ văn - Ngoại ngữ'];

async function main() {
  // Dọn bản seed cũ (cascade xoá toàn bộ dữ liệu liên quan)
  await sql`DELETE FROM schools WHERE slug = 'thpt-demo'`;
  await sql`DELETE FROM users WHERE email = 'admin@truong.vn'`;

  // Plans
  const [freePlan] = await sql`
    INSERT INTO plans (code, name, price_monthly, price_yearly, max_classes)
    VALUES ('free', 'Miễn phí', 0, 0, 10)
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
    RETURNING id`;

  // Trường + chủ sở hữu
  const [school] = await sql`
    INSERT INTO schools (slug, name, level, province_code)
    VALUES ('thpt-demo', 'Trường THPT Demo', 'high', '79')
    RETURNING id, slug`;
  const [user] = await sql`
    INSERT INTO users (email, password_hash, full_name)
    VALUES ('admin@truong.vn', ${hashPassword('matkhau-8ky-tu')}, 'Quản trị Demo')
    RETURNING id`;
  await sql`INSERT INTO school_members (school_id, user_id, role) VALUES (${school.id}, ${user.id}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (school_id, plan_id, status, trial_ends_at)
    VALUES (${school.id}, ${freePlan.id}, 'trialing', now() + interval '30 days')`;

  // Năm học + học kỳ + khung tiết (5 sáng + 5 chiều)
  const [year] = await sql`
    INSERT INTO school_years (school_id, name, is_active, active_days)
    VALUES (${school.id}, '2026-2027', true, '{1,2,3,4,5,6}')
    RETURNING id`;
  const [semester] = await sql`
    INSERT INTO semesters (school_id, school_year_id, name, ordinal, start_date, end_date)
    VALUES (${school.id}, ${year.id}, 'Học kỳ I', 1, '2026-09-07', '2027-01-15')
    RETURNING id`;
  const periodRows = [];
  let pos = 1;
  const morningStarts = ['07:00', '07:50', '08:40', '09:45', '10:35'];
  const afternoonStarts = ['13:00', '13:50', '14:40', '15:30', '16:20'];
  for (let i = 0; i < 5; i++) {
    periodRows.push({ school_id: school.id, school_year_id: year.id, session: 'morning', ordinal: i + 1,
      name: `Tiết ${i + 1}`, start_time: morningStarts[i], end_time: null,
      day_position: pos++ });
  }
  for (let i = 0; i < 5; i++) {
    periodRows.push({ school_id: school.id, school_year_id: year.id, session: 'afternoon', ordinal: i + 1,
      name: `Tiết ${i + 1} (chiều)`, start_time: afternoonStarts[i], end_time: null,
      day_position: pos++ });
  }
  const periods = await sql`
    INSERT INTO periods ${sql(periodRows)} RETURNING id, session, day_position`;

  // Khối + tổ + môn
  const grades = await sql`
    INSERT INTO grades (school_id, school_year_id, name, ordinal)
    SELECT ${school.id}, ${year.id}, x.name, x.ord
    FROM (VALUES ('Khối 10', 1), ('Khối 11', 2), ('Khối 12', 3)) AS x(name, ord)
    RETURNING id, ordinal`;
  const departments = await sql`
    INSERT INTO departments (school_id, school_year_id, name)
    SELECT ${school.id}, ${year.id}, d FROM unnest(${DEPARTMENTS}::text[]) AS d
    RETURNING id, name`;
  const deptId = (i) => departments[i % departments.length].id;

  const subjects = [];
  for (let i = 0; i < SUBJECTS.length; i++) {
    const s = SUBJECTS[i];
    const [row] = await sql`
      INSERT INTO subjects (school_id, school_year_id, department_id, code, name, short_name,
                            color, difficulty, prefer_double_period)
      VALUES (${school.id}, ${year.id}, ${deptId(i)}, ${s.code}, ${s.name}, ${s.short},
              ${s.color}, ${s.diff}, false)
      RETURNING id, code`;
    subjects.push({ ...row, ...s });
  }
  for (const g of grades) {
    for (const s of subjects) {
      await sql`INSERT INTO subject_grade_configs (school_id, subject_id, grade_id, periods_per_week)
                VALUES (${school.id}, ${s.id}, ${g.id}, ${s.ppw})`;
    }
  }

  // Phòng học
  const rooms = [];
  for (let i = 1; i <= 9; i++) {
    const [r] = await sql`
      INSERT INTO rooms (school_id, school_year_id, code, name)
      VALUES (${school.id}, ${year.id}, ${'A2' + String(i).padStart(2, '0')}, ${'Phòng ' + 'A2' + String(i).padStart(2, '0')})
      RETURNING id`;
    rooms.push(r);
  }

  // Giáo viên: 18 người, mỗi môn 3
  const teachers = [];
  for (let i = 0; i < 18; i++) {
    const si = i % SUBJECTS.length;
    const [t] = await sql`
      INSERT INTO teachers (school_id, school_year_id, code, full_name, short_name,
                            max_periods_per_week)
      VALUES (${school.id}, ${year.id}, ${'GV' + String(i + 1).padStart(3, '0')},
              ${HO[i % HO.length] + ' ' + TEN[i]}, ${'GV.' + TEN[i]}, 19)
      RETURNING id`;
    await sql`INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (${t.id}, ${subjects[si].id})`;
    teachers.push({ id: t.id, subjIdx: si });
  }

  // Lớp: 9 lớp, GVCN lần lượt
  const classes = [];
  for (let i = 0; i < 9; i++) {
    const grade = grades[Math.floor(i / 3)];
    const name = `${9 + grade.ordinal}${'ABC'[i % 3]}1`;
    const [c] = await sql`
      INSERT INTO classes (school_id, school_year_id, grade_id, homeroom_teacher_id,
                           home_room_id, name, main_session)
      VALUES (${school.id}, ${year.id}, ${grade.id}, ${teachers[i].id}, ${rooms[i].id},
              ${name}, 'morning')
      RETURNING id, name`;
    classes.push(c);
  }

  // Phân công: mỗi (lớp × môn) một assignment, GV quay vòng theo chỉ số lớp
  const assignmentRows = [];
  for (let ci = 0; ci < classes.length; ci++) {
    for (let si = 0; si < subjects.length; si++) {
      const teacher = teachers.find((t) => t.subjIdx === si && t.idxOffset !== undefined) ??
                      teachers.filter((t) => t.subjIdx === si)[ci % 3];
      const [a] = await sql`
        INSERT INTO assignments (school_id, school_year_id, semester_id, subject_id,
                                 periods_per_week)
        VALUES (${school.id}, ${year.id}, ${semester.id}, ${subjects[si].id},
                ${subjects[si].ppw})
        RETURNING id`;
      await sql`INSERT INTO assignment_classes (assignment_id, class_id) VALUES (${a.id}, ${classes[ci].id})`;
      await sql`INSERT INTO assignment_teachers (assignment_id, teacher_id) VALUES (${a.id}, ${teacher.id})`;
      assignmentRows.push({
        id: a.id,
        subjectId: subjects[si].id,
        classIndex: ci,
        subjectIndex: si,
        teacherIndex: teachers.findIndex((t) => t.id === teacher.id)
      });
    }
  }

  // Lịch bận mẫu: 6 GV đầu nghỉ cả Thứ Bảy
  const availability = [];
  for (let ti = 0; ti < 6; ti++) {
    for (const p of periods) {
      availability.push({
        ownerType: 'teacher', ownerId: teachers[ti].id,
        dayOfWeek: 6, periodId: p.id, preference: 'busy'
      });
    }
  }

  // Thời khoá biểu + xếp thật bằng solver
  const [tt] = await sql`
    INSERT INTO timetables (school_id, school_year_id, semester_id, name, status)
    VALUES (${school.id}, ${year.id}, ${semester.id}, 'TKB HK I — seed', 'draft')
    RETURNING id`;

  const { solve } = await import('@tkb/solver-core');
  // Mỗi assignment là một (lớp × môn × giáo viên), đúng hợp đồng SolverProblem.
  const lessonMeta = [];
  const lessonAssignment = [];
  for (let aid = 0; aid < assignmentRows.length; aid++) {
    const a = assignmentRows[aid];
    for (let r = 0; r < SUBJECTS[a.subjectIndex].ppw; r++) {
      lessonMeta.push({ assignmentId: a.id });
      lessonAssignment.push(aid);
    }
  }
  const problemInput = {
    days: 6,
    periodsPerDay: periods.length,
    numClasses: classes.length,
    numTeachers: teachers.length,
    numSubjects: subjects.length,
    assignments: assignmentRows.map((a) => ({
      classes: [a.classIndex],
      teachers: [a.teacherIndex],
      subject: a.subjectIndex,
      difficulty: SUBJECTS[a.subjectIndex].diff,
      maxPerDay: 1
    })),
    lessonAssignment
  };

  console.log(`Xếp ${lessonMeta.length} tiết cho ${classes.length} lớp…`);
  const result = solve(problemInput, { timeLimitMs: 2500, seed: 42 });
  if (!result.complete) {
    console.error(`Solver không đặt đủ (${result.placed}/${result.totalLessons}) — kiểm tra dữ liệu seed.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Solver xong: điểm mềm ${result.softScore}`);

  // Ghi lessons + bảng con (bulk)
  const writes = [];
  for (let li = 0; li < result.slots.length; li++) {
    const slot = result.slots[li];
    if (slot < 0) continue;
    const di = Math.floor(slot / 10), rank = slot % 10;
    writes.push({
      timetable_id: tt.id, school_id: school.id,
      assignment_id: lessonMeta[li].assignmentId,
      day_of_week: [1, 2, 3, 4, 5, 6][di],
      period_id: periods[rank].id
    });
  }
  const subjectByAssignment = new Map(assignmentRows.map((a) => [a.id, a.subjectId]));
  for (const w of writes) w.subject_id = subjectByAssignment.get(w.assignment_id);
  await sql`INSERT INTO lessons ${sql(writes)}`;

  const childClasses = [], childTeachers = [];
  const classByAssignment = new Map();
  for (let ci = 0; ci < classes.length; ci++) {
    const base = ci * subjects.length;
    for (let si = 0; si < subjects.length; si++) {
      classByAssignment.set(assignmentRows[base + si].id, classes[ci].id);
    }
  }
  const teacherByAssignment = new Map();
  for (let ci = 0; ci < classes.length; ci++) {
    for (let si = 0; si < subjects.length; si++) {
      const teacher = teachers.filter((t) => t.subjIdx === si)[ci % 3];
      teacherByAssignment.set(assignmentRows[ci * subjects.length + si].id, teacher.id);
    }
  }
  for (const w of writes) {
    childClasses.push({ lesson_id: w.lesson_id ?? null });
  }
  // Cần lesson_id sau bulk insert — truy lại theo (assignment, slot)
  const inserted = await sql`
    SELECT id, assignment_id, day_of_week, period_id FROM lessons WHERE timetable_id = ${tt.id}`;
  const byKey = new Map(inserted.map((l) => [l.assignment_id + ':' + l.day_of_week + ':' + l.period_id, l.id]));
  for (const w of writes) {
    const key = w.assignment_id + ':' + w.day_of_week + ':' + w.period_id;
    const lid = byKey.get(key);
    childClasses.push({ lesson_id: lid, class_id: classByAssignment.get(w.assignment_id) });
    childTeachers.push({ lesson_id: lid, teacher_id: teacherByAssignment.get(w.assignment_id) });
  }
  await sql`INSERT INTO lesson_classes ${sql(childClasses)}`;
  await sql`INSERT INTO lesson_teachers ${sql(childTeachers)}`;

  await sql`UPDATE timetables SET status = 'ready', soft_score = ${result.softScore} WHERE id = ${tt.id}`;

  console.log(`Seed xong:
  trường: ${school.slug} · năm 2026-2027
  đăng nhập: admin@truong.vn / matkhau-8ky-tu
  ${teachers.length} GV · ${classes.length} lớp · ${assignmentRows.length} phân công
  TKB ${tt.id}: ${writes.length}/${lessonMeta.length} tiết, điểm mềm ${result.softScore}`);
}

main()
  .catch((e) => { console.error('Seed thất bại:', e); process.exitCode = 1; })
  .finally(() => sql.end());
