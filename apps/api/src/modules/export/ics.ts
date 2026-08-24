/**
 * Sinh file .ics phía server — quy tắc từ tkb_export_design.md mục 5:
 * VTIMEZONE bắt buộc · RRULE tuần (không liệt kê từng buổi) · UNTIL = hết học kỳ
 * EXDATE ngày lễ trùng weekday · UID ổn định theo lesson · SUMMARY ngắn ≤18 ký tự
 * gợi ý · fold dòng 73/72 ký tự · escape , ; \
 */

const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export interface IcsEventInput {
  /** Ổn định theo lesson id — đổi chỗ giữ nguyên UID để app lịch cập nhật đúng */
  uidKey: string;
  dayOfWeek: number;          // 1..7 ISO (2=Thứ Ba…)
  start: string;              // 'HH:MM'
  end: string;
  summary: string;
  location?: string;
  description?: string;
}

export interface IcsOptions {
  calName: string;
  semesterStart: Date;        // ngày đầu tiên có thể có tiết
  semesterEnd: Date;          // UNTIL
  holidays?: Date[];          // ngày nghỉ — sinh EXDATE khi trùng weekday
  prodId?: string;
  stampUtc?: Date;
  alarmMinutes?: number;
}

function pad(n: number) { return n < 10 ? '0' + n : '' + n; }
function ymd(d: Date) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); }

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function fold(line: string): string {
  if (line.length <= 73) return line;
  const parts: string[] = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length) { parts.push(' ' + rest.slice(0, 72)); rest = rest.slice(72); }
  return parts.join('\r\n');
}

export function buildIcs(events: IcsEventInput[], o: IcsOptions): string {
  const stamp = o.stampUtc ?? new Date('2026-08-24T00:00:00Z');
  const stampStr = ymd(stamp) + 'T' + pad(stamp.getUTCHours()) + pad(stamp.getUTCMinutes()) + pad(stamp.getUTCSeconds()) + 'Z';

  const out: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:' + (o.prodId ?? '-//TKB Vietnam//Timetable 1.0//VI'),
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeText(o.calName),
    'X-WR-TIMEZONE:Asia/Ho_Chi_Minh',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Ho_Chi_Minh',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0700',
    'TZOFFSETTO:+0700',
    'TZNAME:+07',
    'END:STANDARD',
    'END:VTIMEZONE'
  ];

  // Ngày xuất hiện đầu tiên của từng weekday kể từ semesterStart
  const firstOcc = new Map<number, Date>();
  for (let d = 1; d <= 7; d++) {
    const dt = new Date(o.semesterStart);
    dt.setDate(o.semesterStart.getDate() + ((d - o.semesterStart.getDay() + 7) % 7));
    firstOcc.set(d, dt);
  }

  for (const ev of events) {
    const occ = firstOcc.get(ev.dayOfWeek)!;
    const sh = ev.start.replace(':', '');
    const eh = ev.end.replace(':', '');
    const byday = BYDAY[ev.dayOfWeek - 1];

    out.push('BEGIN:VEVENT');
    out.push(`UID:${ev.uidKey}@tkb.vn`);
    out.push('DTSTAMP:' + stampStr);
    out.push(`DTSTART;TZID=Asia/Ho_Chi_Minh:${ymd(occ)}T${sh}00`);
    out.push(`DTEND;TZID=Asia/Ho_Chi_Minh:${ymd(occ)}T${eh}00`);
    out.push(`RRULE:FREQ=WEEKLY;BYDAY=${byday};UNTIL=${ymd(o.semesterEnd)}T235959Z`);

    if (o.holidays?.length) {
      const exdates = o.holidays
        .filter((h) => h.getDay() === ev.dayOfWeek % 7)
        .map((h) => `${ymd(h)}T${sh}00`);
      if (exdates.length) {
        out.push('EXDATE;TZID=Asia/Ho_Chi_Minh:' + exdates.join(','));
      }
    }

    out.push('SUMMARY:' + escapeText(ev.summary));
    if (ev.location) out.push('LOCATION:' + escapeText(ev.location));
    if (ev.description) out.push(fold('DESCRIPTION:' + escapeText(ev.description)));

    out.push('BEGIN:VALARM');
    out.push(`TRIGGER:-PT${o.alarmMinutes ?? 10}M`);
    out.push('ACTION:DISPLAY');
    out.push('DESCRIPTION:' + escapeText(ev.summary + (ev.location ? ' - ' + ev.location : '')));
    out.push('END:VALARM');
    out.push('END:VEVENT');
  }

  out.push('END:VCALENDAR');
  return out.join('\r\n') + '\r\n';
}
