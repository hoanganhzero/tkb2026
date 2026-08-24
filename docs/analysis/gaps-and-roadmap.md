# Còn thiếu & lộ trình code tiếp

> Checklist đầy đủ những gì CHƯA có, đối chiếu tài liệu thiết kế trong `docs/design/`.
> Ước lượng lấy từ chính các doc (đã ghi nguồn). Sắp theo thứ tự khuyến nghị thực hiện.

## Trạng thái tổng quan (cập nhật lúc đóng gói)

| Khối | Xong | Còn lại |
|---|---|---|
| Schema DB (30+ bảng, RLS, trigger) | ✅ 0001 + 0002 | Migration tiếp theo chỉ cộng thêm |
| Hàm chi phí + Solver thuật toán | ✅ cost-core + solver-core (14 test) | Worker persistence SQL, CP-SAT fallback |
| API auth/grid/move/swap | ✅ khung + logic chính | CRUD danh mục, phân công, ràng buộc, publish… |
| Web màn hình xếp | ✅ khung grid + đèn giao thông | Toàn bộ màn hình còn lại |
| Import Excel luật | ✅ import-core (12 test) | UI preview + endpoints validate/commit |
| E2E với DB thật | ⏳ | Cần máy có Docker |

---

## 1. E2E smoke — script ✅ + CI service containers ✅; cần máy có Docker để CHẠY LẦN ĐẦU

`e2e/smoke.mjs`: ~30 assertion toàn chuỗi (register→years→periods→catalog→
assignments→timetable→place×4→move/409→locks→availability 409→conflicts→
snapshot/restore→publish/unpublish→export xlsx bytes→rollover preview+apply).
Tự sinh dữ liệu qua API, email ngẫu nhiên nên chạy lại được. CI đã nhúng
postgres:16 + redis:7 services và chạy smoke trên mọi push — merge đầu tiên
sẽ là lần chạy E2E thật đầu tiên.

## 2. Hoàn thiện API theo `04-api/tkb_api_spec.md` mục 2

- ✅ **CRUD danh mục 6 resource** (`apps/api/src/modules/catalog/`): list/get/create/
  patch/delete/bulk một transaction + `subjects/:id/grade-configs` +
  `teachers/:id/subjects` + `teachers/workload`; whitelist cột chặn ghi đè
  school_id/year; unique/FK map sang 409 tiếng Việt (schema tests 7/7)
- ✅ **Assignments matrix** (`apps/api/src/modules/assignments/`): `GET matrix`
  payload đầy đủ cho màn hình §7 · `POST bulk` planApply tối thiểu-op
  (create/update_ppw/update_teachers/delete; xoá 1 lớp của ghép chỉ gỡ
  assignment_classes) · `GET validation` khung + định mức — 3/3 pure tests
- [ ] availability ✅ (`modules/availability/`: GET/PUT ghi đè diff tối thiểu + bulk quét chuột, 3/3 test) — còn UI lưới §8
- [ ] conflicts endpoint — quét xung đột cache vào `timetable_conflicts` (chưa làm)
- ✅ snapshots create/list/restore (`modules/snapshots/`, payload giữ nguyên id — 3/3 test)
- ✅ publish/unpublish + slug công khai (`modules/publish/` — 3/3 test); trang `/public/:slug/timetable` server-side chưa làm
- [ ] Idempotency-Key middleware (Redis INSET NX, TTL 24h) — §1.5
- [ ] Rate limit middleware theo bảng §7
- [ ] undoToken: lưu op vào Redis TTL 10 phút + `POST /undo/:token`

## 3. Worker hoàn chỉnh (thuật toán + persist đã xong; còn vỏ vận hành)

Thuật toán XONG trong `@tkb/solver-core`; persist statements XONG + test trong
`apps/worker/src/persist.ts` (`persistResult(tx, input)` — gọi trong DbService.tx).
Còn lại:

- [ ] Nối worker.ts: load problem từ DB bằng mapRowsToProblem → runSolveJob → persistResult trong một transaction
- [ ] Progress: Redis pub/sub channel `job:{id}` → WebSocket gateway phát `solver.progress/improved/finished` (api spec §5.3)
- [ ] Khi solver chạy: INSERT `timetable_locks(class_id=NULL)` chặn toàn bảng (§6.6) — REST locks đã có sẵn điều kiện full-lock
- [ ] CP-SAT service dự phòng (Python/FastAPI, solver spec §5.3) — để sau cùng

## 4. WebSocket gateway — lõi transport ✅ (3/3 test); còn bridge Redis + presence

- ✅ Logic khoá thuần + REST acquire/heartbeat/release/takeover — `apps/api/src/modules/locks/` (6/6 test)
- [ ] NestJS WS gateway (socket.io) kênh `timetable:{id}` / `job:{id}` / `school:{id}`, seq tăng mỗi kênh + resume `since:` từ Redis Stream 500 sự kiện
- [ ] `X-Connection-Id` đã có trong ctx — đính `originConnectionId` bỏ echo cho chính người gửi (§5.4)
- [ ] Fallback polling `/events?since=` khi WS bị tường lửa chặn (§5.5)
- [ ] Presence.sync nhẹ nhàng (§6.7)

## 5. Nhập Excel — luật ✅ · server validate/commit teachers ✅ · **UI 3 bước giáo viên ✅**; còn các sheet khác

- [ ] Server routes `/imports/validate|commit` gọi thẳng import-core (package chia sẻ — KHÔNG fork luật)
- [ ] Sinh file mẫu `.xlsx` động theo cấp học (SheetJS client-side; server chỉ lưu bản gốc 90 ngày)
- [ ] UI preview 3 bước theo §6: tab sheet + đếm lỗi, ánh xạ cột gán tay, sửa tại chỗ, "Bỏ qua dòng lỗi"
- [ ] Ghi transaction đúng thứ tự phụ thuộc §5.3, bulk `unnest()`

## 6. Xuất file — xlsx timetable_school ✅ (2 test) + route; còn 6 loại báo cáo + PDF ND30 + webcal server

- [ ] ICS đã có demo ở trang công khai — port sang server với token thu hồi được + webcal
- [ ] ExcelJS 7 loại báo cáo; Puppeteer PDF thể thức ND30; mono mode viền trái nhóm môn

## 7. Chuyển tiếp năm học — preview ✅ · **POST /apply §7.1 ✅** (transaction, source_id, is_recurring, job 14 ngày) · còn wizard hoàn thiện + undo endpoint

- ✅ Migration 0002 (source_id, is_recurring, rollover_jobs/mappings)
- ✅ `packages/rollover-core` 7/7 test: promoteClassName · mapClasses
  (graduate/skip-xáo trộn/tuyển mới theo mẫu #) · mapAssignments hai chế độ
  followClass/keepGrade + ghi đè tổ · ppw lấy từ cấu hình khối MỚI · 4 loại cảnh báo §6.3
- [ ] Wizard 6 bước UI đọc rollover-core; áp dụng trong transaction theo thứ tự §7.1;
      hoàn tác = xoá năm mới trong 14 ngày (§7.3)

## 8. Web UI — ✅ thêm Lịch bận + Chuyển tiếp shell; còn danh mục, phân công ma trận, kiểm tra, in ấn, dạy thay

- [ ] Thay HTML5 drag bằng @dnd-kit/core; kho chưa-xếp panel phải + badge ⚠
- [ ] Hoán đổi UI nhận `idMap` từ swap endpoint (client đang chặn với alert TODO)
- [ ] Bàn phím đủ bộ §6.6 (hiện mới Ctrl+Z); Ctrl+K palette
- [ ] Các trang: danh mục, phân công ma trận (kéo dọc nhân bản), lịch bận quét chuột, kiểm tra, in ấn, dạy thay, người dùng, cài đặt
- [ ] Mobile read-only view + `.ics` button (có sẵn logic ở trang công khai demo)

## 9. Hạ tầng/vận hành theo `06-van-hanh` (5 tuần, làm trước khách đầu tiên)

- [ ] CI workflow đã dựng khung `.github/workflows/ci.yml` — bổ sung **solver score gate** (chặn merge nếu điểm tệ >10% trên fixture)
- [ ] pgBackRest + PITR + diễn tập khôi phục tự động tháng một lần
- [ ] Grafana dashboard "Sức khoẻ mùa vụ" + metric `import_error_rate{rule}` / `solver_soft_score_per_100_lessons`
- [ ] Sentry self-host + Plausible (tránh chuyển dữ liệu cá nhân ra ngoài — ND13 §C3.7)

## 10. Thanh toán + Zalo + Nghị định 13 — CHƯA BẮT ĐẦU (7 tuần kỹ thuật + thủ tục hành chính)

Toàn bộ PHẦN A/B/C của `06-van-hanh/tkb_payment_compliance.md` chưa code.
**Khởi động thủ tục hành chính NGAY**: xác thực Zalo OA (2–3 tuần), hợp đồng VNPay/MoMo, luật sư ND13.

## Nợ kỹ thuật nhỏ (gọn, tranh thủ làm sớm)

- [ ] argon2id thay scrypt (`password.util.ts`) trước production
- [ ] Kempe xét trục phòng khi assignment có required_room
- [ ] S7/S9 trong cost-core là xấp xỉ v1 — hiệu chỉnh khi có TKB thật của 3–5 trường (**việc quan trọng nhất toàn dự án** — README bundle)
- [ ] Đặt LICENSE (hiện chưa có)
