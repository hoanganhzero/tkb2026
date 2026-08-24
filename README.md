# TKB SaaS — Nền tảng xếp thời khoá biểu cho trường phổ thông Việt Nam

SaaS đa trường: biến ~500 dòng phân công giảng dạy thành lưới 45 lớp × không một xung đột,
trong vài giờ thay vì vài ngày. Stack: Node.js monorepo · NestJS · React · PostgreSQL 16 · Redis.

> **Người tiếp theo code**: đọc `docs/analysis/design-review.md` (bất biến đã chốt +
> bẫy đã gặp) và `docs/analysis/gaps-and-roadmap.md` (còn thiếu gì, làm gì tiếp) trước khi viết dòng đầu.

## Bản đồ repo

```
docs/
  design/            13+ tài liệu thiết kế đầy đủ (schema, solver, API, UI, import/export,
                     rollover, hạ tầng, thanh toán & Nghị định 13) — NGUỒN SỰ THẬT nghiệp vụ
  analysis/
    design-review.md     phát hiện review + trạng thái vá + quy ước bắt buộc
    gaps-and-roadmap.md  còn thiếu gì, thứ tự làm, ước lượng theo doc gốc
    session-log.md       nhật ký dựng khung + lỗi test đã bắt + bài học công cụ
apps/
  api/      NestJS — auth, tenant context SET LOCAL + RLS, grid dạng cột (ETag),
            move/swap, error envelope tiếng Việt
  web/      React 18 + Vite + Tailwind — màn hình xếp TKB, đèn giao thông qua cost-core
  worker/   BullMQ bọc solver + phần thuần mapRows/resultToWrites (đã test)
packages/
  cost-core/   hàm chi phí S1–S12 dùng chung worker/API/client (golden tests)
  solver-core/ Pha A greedy+ejection · Pha B SA với M1/M2/Kempe (golden tests)
  import-core/ chuẩn hoá + ánh xạ cột + luật nhập Excel dùng chung (golden tests)
```

## Chạy nhanh

```bash
docker compose up -d          # PostgreSQL 16 + Redis 7
npm install                   # npm workspaces
cp apps/api/.env.example apps/api/.env
npm run db:migrate            # 0001 schema đầy đủ + 0002 rollover
npx tsx apps/api/scripts/seed.mjs    # trường mẫu + TKB xếp thật bởi solver
npm run dev:api               # :4000/v1  (admin@truong.vn / matkhau-8ky-tu)
npm run dev:web               # :5173
```

## Test

```bash
npm run test:all              # 76 golden tests của 4 package + API logic
npx tsc --noEmit -p apps/api && npx tsc --noEmit -p apps/web && npx tsc --noEmit -p apps/worker
cd apps/web && npx vite build
```

## E2E smoke (máy có Docker)

```bash
docker compose up -d
npm run db:migrate
npx tsx apps/api/scripts/seed.mjs        # hoặc để E2E tự sinh qua API

cd apps/api && npx tsx src/main.ts &     # boot API :4000
sleep 8 && cd ..
node e2e/smoke.mjs                       # ~30 assertion toàn chuỗi, exit 0/1
```

Script tự sinh dữ liệu **qua API** (đăng ký trường mới mỗi lần chạy, email ngẫu nhiên)
nên chạy lại được bao nhiêu lần cũng được. CI (GitHub Actions) đã nhúng
Postgres 16 + Redis 7 service containers và chạy E2E này trên mọi push.

## Trạng thái kiểm chứng

| Thành phần | Mức độ | Ghi chú |
|---|---|---|
| `packages/cost-core` | ✅ **5/5** | Ca vàng tính tay từng điểm + bất biến incremental≡full qua 600 move ngẫu nhiên |
| `packages/solver-core` | ✅ **5/5** | 153/153 kín · 0 xung đột cứng sau SA · SA ≤ greedy · deterministic · ghim tuyệt đối · phát hiện bất khả thi |
| `packages/import-core` | ✅ **12/12** | Chuẩn hoá, từ điển cột, tìm header, ma trận Lớp×Môn, matcher 4 tầng, luật §4.3 |
| `packages/rollover-core` | ✅ **7/7** | promoteClassName · graduate/skip-xáo trộn/tuyển mới theo mẫu # · followClass/keepGrade · số tiết lấy từ cấu hình khối MỚI · cảnh báo nghỉ/vượt định mức/thiếu môn |
| `apps/api — locks` | ✅ **6/6** logic thuần + REST typecheck sạch | TTL 60s · heartbeat 20s · takeover owner/admin luôn, scheduler cần im lặng >5 phút · cấp từng phần |
| `apps/api — export/ics` | ✅ **5/5** | VTIMEZONE · RRULE BYDAY ISO · EXDATE trùng weekday · escape/fold · VALARM |
| `apps/worker` | ✅ **9/9** (4 map + 5 persist) | persist đúng thứ tự §12.3: snapshot→delete(chỉ chưa ghim)→unnest bulk→children→update |
| `apps/api — catalog` | ✅ **7/7** schema + CRUD 6 resource typecheck sạch | Whitelist cột chặn ghi đè school_id/year từ body; grade-configs, teacher-subjects, workload; bulk một transaction; unique/FK → 409 tiếng Việt |
| `apps/api — assignments` | ✅ **3/3** pure + REST typecheck sạch | GET matrix (Tổng đỏ/thiếu, hàng Tổng môn, pool sắp tải tăng, ⛓ ghép lớp) · POST bulk planApply create/update_ppw/update_teachers/delete tối thiểu (xoá 1 lớp của ghép chỉ gỡ assignment_classes) · GET validation khung/định mức |
| `apps/api — availability` | ✅ **3/3** logic + REST | validate/dedupe ô bận-rảnh, diffSlots PUT ghi đè tối thiểu op, bulk quét chuột upsert/remove, is_recurring cho rollover |
| `apps/api — snapshots` | ✅ **3/3** logic + REST | buildPayload giữ nguyên lesson id → khôi phục không cần ánh xạ; validate version; restore trong một transaction |
| `apps/api — publish` | ✅ **3/3** logic + REST | chặn khi còn lỗi cứng/archived; slug công khai `school-tkb-year-hkN-rand`; unpublish về ready + tắt is_public |
| `apps/api — conflicts` | ✅ **3/3** pure + route | quét thiếu/thừa tiết + vi phạm ô khai báo bận (hard), cache `timetable_conflicts`; trùng GV/lớp không thể tồn tại nhờ unique index |
| `apps/api — rollover preview` | ✅ typecheck sạch | GET preview dùng rollover-core trên dữ liệu thật; POST apply trả 501 chờ transaction §7.1 |
| `apps/web — availability UI` | ✅ typecheck sạch | lưới 4 trạng thái click-đổi, quick actions (Nghỉ T7/Chỉ sáng/Xoá), cảnh báo cam ô rảnh < 2× tiết, PUT ghi đè |
| `apps/api — rollover apply` | ✅ typecheck sạch | transaction §7.1 đúng thứ tự phụ thuộc; source_id truy vết; chỉ mang availability is_recurring; job completed + undo 14 ngày; chặn target trùng |
| `apps/api — export bảng` | ✅ typecheck sạch | buildTableXlsx dùng chung (định dạng điều kiện đỏ/xanh cột delta) · routes assignments/workload |
| `apps/web — import UI` | ✅ typecheck sạch | 3 bước: paste/file → preview lỗi server → commit upsert; exceljs lazy-load |
| `apps/web — danh mục CRUD` | ✅ typecheck sạch | generic 6 resource qua catalog endpoints; form fields theo resource; xoá có guard IN_USE |
| `apps/web — rollover shell` | ✅ typecheck sạch | wizard shell bước 4–5 hiển thị preview thật (ánh xạ + cảnh báo); nút Áp dụng khoá chờ endpoint apply |
| `apps/api — ws` | ✅ **3/3** lõi transport | SeqBuffer resume/since + resync khi hụt · seq riêng từng kênh · envelope originConnectionId; gateway socket.io wired, kiểm tra thành viên trước subscribe |
| `apps/api — export.xlsx` | ✅ **2/2** + route | ExcelJS timetable_school: Times New Roman, nền màu môn, freeze, A3 fitWidth; từ GridPayload qua adapter thuần |
| `apps/api — imports` | ✅ **3/3** mapper + validate/commit teachers | Server LUÔN kiểm tra lại bằng import-core; không commit khi còn error; upsert theo mã GV |
| `apps/api` tổng thể | ✅ typecheck sạch · boot thật (healthz 200, guard 401) | E2E DB chờ Docker |
| `apps/web` | ✅ typecheck sạch · vite build OK | runtime UI cần API + DB |

Lỗi thật mà test bắt được và đã sửa (chi tiết trong session-log): M2 hoán đổi thiếu
kiểm tra occupancy động trục GV; fullMask sai quy ước bit thấp sinh ô "ma"; fixture nhầm
assignment gộp lớp; ghim bị skip âm thầm; mojibake do patch PowerShell (**lặp lại 2 lần
vì quên bài học của chính mình** — đã ghi thành quy tắc cấm ở session-log mục 9).

## Quy ước bất biến (đọc design-review.md mục C trước khi phá)

1. Ràng buộc cứng ở tầng thấp nhất (DB unique index + định nghĩa phép biến đổi)
2. Một hàm chi phí duy nhất — client và server phải ra cùng kết quả từng byte
3. Incremental === recomputeAll sau mọi phép biến đổi
4. Ba GUC set qua `DbService.tx()` — không raw-query ngoài nó
5. Khuôn lỗi `{error:{code,message,details},requestId}` tiếng Việt
6. Migration chỉ cộng thêm; đóng băng migration tháng 8

## Đưa lên GitHub

Máy chưa có git — cài xong chạy đúng ba lệnh trong `PUSH-LEN-GITHUB.md`.
