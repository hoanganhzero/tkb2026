import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { publicShares } from "../../../db/schema";

export const dynamic = "force-dynamic";
const DAYS: Record<number, string> = { 2: "Thứ 2", 3: "Thứ 3", 4: "Thứ 4", 5: "Thứ 5", 6: "Thứ 6", 7: "Thứ 7", 8: "Chủ nhật" };

type Lesson = { className: string; subject: string; teacher: string; day: number; period: number; session: string; room?: string };
type Snapshot = { schoolName: string; schoolYear: string; scope: string; label: string; schedule: Lesson[]; days: number[]; periods: { order: number; name: string; session: string; time: string }[] };

export default async function PublicSchedule({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [row] = await getDb().select().from(publicShares).where(eq(publicShares.token, token)).limit(1);
  if (!row) return <main className="public-tkb"><section><h1>Liên kết không tồn tại</h1><p>Vui lòng liên hệ nhà trường để nhận liên kết mới.</p></section></main>;
  const data = JSON.parse(row.snapshotJson) as Snapshot;
  const lessons = data.schedule.filter((x) => data.scope === "school" || (data.scope === "teacher" ? x.teacher === data.label : x.className === data.label));
  return <main className="public-tkb"><header><p>{data.schoolName}</p><h1>THỜI KHÓA BIỂU {data.label}</h1><span>Năm học {data.schoolYear} · Cập nhật {new Date(row.updatedAt).toLocaleString("vi-VN")}</span></header><div className="public-table"><table><thead><tr><th>Buổi</th><th>Tiết</th><th>Thời gian</th>{data.days.map((day) => <th key={day}>{DAYS[day]}</th>)}</tr></thead><tbody>{data.periods.map((period) => <tr key={period.order}><td>{period.session}</td><td>{period.name}</td><td>{period.time}</td>{data.days.map((day) => { const lesson = lessons.find((x) => x.day === day && x.period === period.order); return <td key={day}>{lesson ? <><b>{lesson.subject}</b><small>{data.scope === "teacher" ? lesson.className : lesson.teacher}</small><em>{lesson.room ?? ""}</em></> : ""}</td>; })}</tr>)}</tbody></table></div><footer>EduTKB · Lịch công khai của nhà trường</footer></main>;
}
