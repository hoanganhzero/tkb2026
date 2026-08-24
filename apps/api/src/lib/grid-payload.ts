/** Kiểu payload GET /grid dùng chung — tách khỏi api.ts (web) để server import được */
export interface DictPeriod {
  id: string; session: string; ordinal: number; name: string;
  start: string | null; end: string | null; day_position: number;
}
export interface GridDict {
  days: number[];
  periods: DictPeriod[];
  classes: Array<{ id: string; name: string; gradeId?: string; roomId?: string }>;
  teachers: Array<{ id: string; name: string; short?: string }>;
  subjects: Array<{ id: string; short: string; name: string; color: number }>;
  rooms: Array<{ id: string; code: string }>;
  palette: string[];
}
export interface GridPayload {
  timetable: { id: string; name: string; status: string; version: number; softScore: number | null; hardViolations: number };
  dict: GridDict;
  lessons: {
    count: number;
    id: string[]; slot: number[]; subject: number[]; class: number[];
    teacher: number[]; room: number[]; flags: number[];
  };
}
