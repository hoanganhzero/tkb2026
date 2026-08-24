/**
 * Chuẩn hoá giá trị ô Excel bừa bộn thành dữ liệu sạch (tkb_excel_import.md §3.3).
 */

export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

/** Chuẩn hoá tên cột để tra từ điển đồng nghĩa: thường, bỏ dấu, bỏ ký tự lạ */
export function normalizeKey(s: string): string {
  return stripDiacritics(String(s ?? '')).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Điện thoại: chỉ giữ số, quy +84 về 0. Trả null nếu độ dài bất thường. */
export function normalizePhone(input: string): string | null {
  let d = String(input ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('84')) d = '0' + d.slice(2);
  if (/^0\d{9,10}$/.test(d)) return d;
  // Số ghi thiếu số 0 đầu (912345678)
  if (/^\d{9}$/.test(d)) return '0' + d;
  return null;
}

export interface ParsedName { name: string; gender?: 'Nam' | 'Nữ'; stripped: boolean }

/**
 * Bỏ chức danh dính vào tên. Quy tắc an toàn (§3.3):
 *  - "GV." / "GV " là viết tắt nghề nghiệp -> luôn bỏ
 *  - "Thầy"/"Cô" có thể trúng họ người thật -> chỉ bỏ khi theo sau còn >=2 từ,
 *    đồng thời suy ra giới tính nếu cột đó trống.
 */
export function stripTitle(raw: string, genderHint?: 'Nam' | 'Nữ'): ParsedName {
  let s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  let gender = genderHint;
  let stripped = false;
  const gv = /^(GV\.?|G\.V\.?)\s+/i;
  if (gv.test(s)) { s = s.replace(gv, ''); stripped = true; }
  const tc = s.match(/^(Thầy|Cô)\s+(.+)$/i);
  if (tc) {
    const rest = tc[2].trim();
    if (rest.split(' ').length >= 2) {
      s = rest;
      stripped = true;
      if (!gender) gender = /^cô/i.test(tc[1]) ? 'Nữ' : 'Nam';
    } else if (!gender && /^cô/i.test(tc[1])) {
      gender = 'Nữ';
    }
  }
  if (!gender && genderHint === undefined) {
    // Không tự đoán thêm — giữ nguyên
  }
  return { name: s.trim(), gender, stripped };
}

/** Giới tính: nam/Nam/M/1 -> Nam ; nữ/nu/F/0 -> Nữ ; khác -> undefined */
export function parseGender(raw: string): 'Nam' | 'Nữ' | undefined {
  const k = stripDiacritics(String(raw ?? '')).trim().toLowerCase();
  if (!k) return undefined;
  if (k === 'nam' || k === 'm' || k === '1' || k === 'true') return 'Nam';
  if (k === 'nu' || k === 'f' || k === '0' || k === 'false') return 'Nữ';
  return undefined;
}

/** Có/Không: x, X, có, co, 1, TRUE, ✓ -> true ; không/ko/0/false -> false */
export function parseYesNo(raw: unknown): boolean | undefined {
  const k = stripDiacritics(String(raw ?? '')).trim().toLowerCase();
  if (!k) return undefined;
  if (['x', 'co', '1', 'true', 'v', 'yes', 'y', '\u2713', '\u2714'].includes(k)) return true;
  if (['khong', 'ko', '0', 'false', 'no', 'n'].includes(k)) return false;
  return undefined;
}

/** Số nguyên lẫn đơn vị: "4 tiết", "4t", " 4 ", 4.0 -> 4 ; sai -> undefined */
export function parseIntCell(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  const m = String(raw ?? '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : undefined;
}

const TOTAL_ROW = /^(tong|cong|tongcong|sum|total)$/;
export function isTotalRow(firstCells: string[]): boolean {
  const k = normalizeKey(firstCells[0] ?? '');
  return TOTAL_ROW.test(k);
}

export function isEmptyRow(cells: unknown[]): boolean {
  return cells.every((c) => String(c ?? '').trim() === '');
}

/** Email dạng hợp lệ tối thiểu */
export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s ?? '').trim());
}
