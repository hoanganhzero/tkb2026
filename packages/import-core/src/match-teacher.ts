/**
 * So khớp tên giáo viên (excel_import §3.4):
 *   1. Mã GV chính xác -> 2. Tên đã chuẩn hoá chính xác
 *   3. Tên riêng + họ khớp -> 4. Levenshtein <=2 CHỈ GỢI Ý, không tự nhận
 *   Trùng tên hoàn toàn -> 'ambiguous' bắt buộc dùng mã.
 */
import { normalizeKey } from './normalize.ts';

export interface TeacherRef { code: string; name: string }

export type TeacherMatch =
  | { kind: 'code'; teacher: TeacherRef }
  | { kind: 'exact'; teacher: TeacherRef }
  | { kind: 'partial'; teacher: TeacherRef }
  | { kind: 'suggest'; suggestion: TeacherRef; distance: number }
  | { kind: 'ambiguous'; candidates: TeacherRef[] }
  | { kind: 'none' };

export interface TeacherMatcher {
  match(input: string): TeacherMatch;
}

export function buildTeacherMatcher(teachers: TeacherRef[]): TeacherMatcher {
  const byCode = new Map<string, TeacherRef>();
  const byName = new Map<string, TeacherRef[]>();
  for (const t of teachers) {
    if (t.code) byCode.set(normalizeKey(t.code), t);
    const k = normalizeKey(t.name);
    const arr = byName.get(k) ?? [];
    arr.push(t);
    byName.set(k, arr);
  }

  function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    let prev = new Array<number>(n + 1);
    let cur = new Array<number>(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }

  return {
    match(raw: string): TeacherMatch {
      const input = String(raw ?? '').trim();
      if (!input) return { kind: 'none' };
      const key = normalizeKey(input);

      // 1. Mã GV
      const byC = byCode.get(key);
      if (byC) return { kind: 'code', teacher: byC };

      // 2. Tên chính xác
      const exact = byName.get(key);
      if (exact && exact.length === 1) return { kind: 'exact', teacher: exact[0] };
      if (exact && exact.length > 1) return { kind: 'ambiguous', candidates: exact };

      // 3. Họ + tên cuối: "Nguyễn Hùng" khớp "Nguyễn Văn Hùng"
      const tokens = key.split(' ').filter(Boolean);
      if (tokens.length >= 2) {
        const first = tokens[0], last = tokens[tokens.length - 1];
        const hits = teachers.filter((t) => {
          const tk = normalizeKey(t.name).split(' ').filter(Boolean);
          return tk.length >= 2 && tk[0] === first && tk[tk.length - 1] === last;
        });
        const unique = [...new Map(hits.map((t) => [t.code, t])).values()];
        if (unique.length === 1) return { kind: 'partial', teacher: unique[0] };
        if (unique.length > 1) return { kind: 'ambiguous', candidates: unique };
      }

      // 4. Gợi ý sai chính tả — KHÔNG tự động chấp nhận
      let best: TeacherRef | null = null, bestD = Infinity;
      for (const t of teachers) {
        const d = levenshtein(key, normalizeKey(t.name));
        if (d < bestD) { bestD = d; best = t; }
      }
      if (best && bestD <= 2) return { kind: 'suggest', suggestion: best, distance: bestD };
      return { kind: 'none' };
    }
  };
}
