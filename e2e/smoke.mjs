/**
 * E2E SMOKE — chuỗi đầy đủ trên máy có Docker.
 *
 *   docker compose up -d
 *   npm run db:migrate
 *   npx tsx apps/api/src/main.ts        (terminal khác)
 *   node e2e/smoke.mjs                  (script này)
 *
 * Tự sinh dữ liệu qua API (không phụ thuộc seed): đăng ký trường mới →
 * năm học → khung tiết → khối/môn/GV/lớp → phân công → TKB → đặt tiết →
 * move → locks → availability → conflicts → snapshot restore → publish
 * → export xlsx → rollover preview/apply. Thoát 0 = pass, 1 = fail.
 */

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4000';
const rand = Math.random().toString(36).slice(2, 8);

let token = '';
let schoolId = '';
let passed = 0;
const failures = [];

function ok(cond, label) {
  if (cond) { passed++; console.log(`  \u2714 ${label}`); }
  else { failures.push(label); console.error(`  \u2716 ${label}`); }
}

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(schoolId ? { 'X-School-Id': schoolId } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* binary */ }
  return { status: res.status, json };
}

async function waitHealth(timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(BASE + '/v1/healthz');
      if (r.ok) return true;
    } catch { /* chua len */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  console.log(`E2E smoke @ ${BASE}`);

  ok(await waitHealth(), 'healthz phan hoi');

  // 1. dang ky truong moi
  const reg = await req('POST', '/v1/auth/register', {
    fullName: 'E2E Admin', email: `e2e-${rand}@test.vn`,
    password: 'matkhau-8ky-tu', schoolName: `THPT E2E ${rand}`,
  });
  token = reg.json?.accessToken || '';
  schoolId = reg.json?.school?.id || '';
  ok(!!token && !!schoolId, 'register tra token + school');

  // 2. nam hoc + khung tiet
  const year = await req('POST', `/v1/schools/${schoolId}/years`, {
    name: '2026-2027', activeDays: [1, 2, 3, 4, 5, 6]
  });
  const yid = year.json?.id;
  ok(year.status < 300 && !!yid, 'tao nam hoc');

  const periods = [];
  const times = ['07:00', '07:50', '08:40'];
  for (let i = 0; i < 3; i++) {
    periods.push({ session: 'morning', ordinal: i + 1, name: `Tiet ${i + 1}`,
      startTime: times[i], dayPosition: i + 1 });
  }
  const per = await req('POST', `/v1/schools/${schoolId}/years/${yid}/periods/bulk`, { slots: periods });
  ok(per.status < 300, 'bulk khung tiet');
  const periodList = per.json?.data || [];
  ok(periodList.length === 3, 'du 3 tiet');

  // 3. danh muc
  const grade = await req('POST', `/v1/schools/${schoolId}/years/${yid}/grades`,
    { name: 'Khoi 10', ordinal: 10 });
  const gid = grade.json?.id;
  ok(grade.status < 300 && !!gid, 'tao khoi 10');

  const subj = await req('POST', `/v1/schools/${schoolId}/years/${yid}/subjects`,
    { code: 'TOAN', name: 'Toan hoc', short_name: 'Toan', difficulty: 5 });
  const subjId = subj.json?.id;
  ok(subj.status < 300 && !!subjId, 'tao mon Toan');

  await req('PUT', `/v1/schools/${schoolId}/years/${yid}/subjects/${subjId}/grade-configs`,
    [{ gradeOrdinal: 10, periodsPerWeek: 4 }]);

  const t1 = await req('POST', `/v1/schools/${schoolId}/years/${yid}/teachers`,
    { code: `GV${rand}1`, full_name: 'Nguyen Van Hung', max_periods_per_week: 20 });
  const tid1 = t1.json?.id;
  ok(t1.status < 300 && !!tid1, 'tao GV 1');

  await req('PUT', `/v1/schools/${schoolId}/years/${yid}/teachers/${tid1}/subjects`, [subjId]);

  const cls = await req('POST', `/v1/schools/${schoolId}/years/${yid}/classes`,
    { name: '10A1', grade_id: gid, size: 42 });
  const cid = cls.json?.id;
  ok(cls.status < 300 && !!cid, 'tao lop 10A1');

  // 4. phan cong
  const bulk = await req('POST',
    `/v1/schools/${schoolId}/years/${yid}/assignments/bulk`,
    { items: [{ classId: cid, subjectId: subjId, periodsPerWeek: 4, teacherIds: [tid1] }] });
  const asgId = bulk.json?.data?.[0]?.id;
  ok(bulk.status < 300 && !!asgId, 'bulk tao 1 phan cong');

  const matrix = await req('GET',
    `/v1/schools/${schoolId}/years/${yid}/assignments/matrix`);
  ok((matrix.json?.cells?.length) === 1, 'matrix co dung 1 o');
  ok(matrix.json?.totals?.byClass?.[0]?.assigned === 4, 'Tong lop = 4 tiet');

  // 5. TKB + dat tiet
  const tt = await req('POST', `/v1/schools/${schoolId}/timetables`, { name: 'TKB E2E' });
  const ttId = tt.json?.id;
  ok(tt.status < 300 && !!ttId, 'tao TKB draft');

  const placed = [];
  for (let slot = 0; slot < 4; slot++) {
    const dow = Math.floor(slot / 3) + 1;
    const pIdx = slot % 3;
    const r = await req('POST', '/v1/lessons/place', {
      timetableId: ttId, assignmentId: asgId,
      dayOfWeek: dow, periodId: periodList[pIdx].id
    });
    if (r.status < 300 && r.json?.lesson?.id) placed.push(r.json.lesson.id);
  }
  ok(placed.length === 4, `dat du 4 tiet (${placed.length})`);

  const grid = await req('GET', `/v1/schools/${schoolId}/timetables/${ttId}/grid`);
  ok(grid.json?.lessons?.count === 4, 'grid dem 4 tiet');
  const versionBefore = grid.json?.timetable?.version || 0;

  // 6. move + chan trung
  const mv = await req('PATCH', `/v1/lessons/${placed[0]}/move`,
    { toSlot: { dayOfWeek: 2, periodId: periodList[2].id }, expectedVersion: versionBefore });
  ok(mv.status < 300, 'move hop le');

  const blocked = await req('PATCH', `/v1/lessons/${placed[1]}/move`,
    { toSlot: { dayOfWeek: 1, periodId: periodList[0].id } });
  ok(blocked.status === 409, `move vao o da co -> 409 (nhan ${blocked.status})`);

  // 7. locks
  const lk = await req('POST', `/v1/schools/${schoolId}/timetables/${ttId}/locks`,
    { classIds: [cid] });
  ok((lk.json?.granted || []).includes(cid), 'lock acquire granted');

  // 8. availability busy -> place bi chan SLOT_NOT_ALLOWED
  const av = await req('PUT',
    `/v1/schools/${schoolId}/years/${yid}/availability?ownerType=teacher&ownerId=${tid1}`,
    { slots: [{ dayOfWeek: 3, periodId: periodList[0].id, preference: 'busy' }] });
  ok(av.status < 300, 'PUT availability busy T4 p1');
  const avPlace = await req('POST', '/v1/lessons/place', {
    timetableId: ttId, assignmentId: asgId,
    dayOfWeek: 3, periodId: periodList[0].id
  });
  ok(avPlace.status === 409, `place vao o ban -> 409 (nhan ${avPlace.status})`);

  // 9. conflicts
  const cf = await req('GET', `/v1/schools/${schoolId}/timetables/${ttId}/conflicts`);
  ok(Array.isArray(cf.json?.data), 'conflicts tra mang');
  ok(!cf.json.data.some((c) => c.severity === 'hard'), 'khong con conflict hard');

  // 10. snapshots create + restore
  const snap = await req('POST', `/v1/schools/${schoolId}/timetables/${ttId}/snapshots`,
    { label: 'e2e' });
  const snapId = snap.json?.id;
  ok(snap.status < 300 && !!snapId, 'tao snapshot');

  const rs = await req('POST',
    `/v1/schools/${schoolId}/timetables/${ttId}/snapshots/${snapId}/restore`);
  ok(rs.status < 300, 'khoi phuc snapshot');

  // 11. publish + unpublish
  const pub = await req('POST', `/v1/schools/${schoolId}/timetables/${ttId}/publish`);
  ok(pub.status < 300 && !!pub.json?.publicSlug, 'publish sinh slug cong khai');
  const unpub = await req('POST', `/v1/schools/${schoolId}/timetables/${ttId}/unpublish`);
  ok(unpub.status < 300, 'unpublish ve ready');

  // 12. export xlsx
  const exp = await fetch(`${BASE}/v1/schools/${schoolId}/timetables/${ttId}/export.xlsx`,
    { headers: { Authorization: `Bearer ${token}`, 'X-School-Id': schoolId } });
  ok(exp.ok, `export.xlsx ${exp.status}`);
  ok((exp.headers.get('content-type') || '').includes('spreadsheet'), 'content-type xlsx');
  const ab = await exp.arrayBuffer();
  ok(ab.byteLength > 1000, `file xlsx ${ab.byteLength} bytes > 1KB`);

  // 13. rollover preview + apply
  const rv = await req('GET',
    `/v1/schools/${schoolId}/rollover/preview?fromYearId=${yid}&mode=followClass`);
  ok(rv.status < 300, 'rollover preview chay');
  ok((rv.json?.mappings?.length || 0) > 0, 'preview co mappings');

  const apply = await req('POST', `/v1/schools/${schoolId}/rollover/apply`, {
    fromYearId: yid, targetYearName: '2027-2028', mode: 'followClass'
  });
  ok(apply.status < 300, `apply thanh cong (${apply.json?.targetYearId ? 'co target' : 'thieu'})`);
  ok(!!apply.json?.jobId, 'ghi job completed + undo 14 ngay');

  const yearsAfter = await req('GET', `/v1/schools/${schoolId}/years`);
  ok((yearsAfter.json?.data || []).some((y) => y.name === '2027-2028'), 'nam 2027-2028 xuat hien');

  console.log(`\n===== KET QUA: ${passed} pass - ${failures.length} fail =====`);
  if (failures.length) {
    failures.forEach((f) => console.error('FAIL:', f));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => { console.error('E2E crash:', e); failures.push(String(e)); process.exit(1); })
  .finally(() => { if (failures.length) process.exit(1); });
