# Phân tích thiết kế & các quyết định đã chốt

> Tổng hợp toàn bộ phát hiện review + quyết định kiến trúc trong quá trình dựng khung.
> Mỗi mục ghi rõ **trạng thái**: ✅ Đã vá trong schema/code · 📐 Đã thiết kế (có spec) · ⏳ Còn mở.
> Người tiếp theo đọc file này trước khi code để không phá vỡ các bất biến đã chốt.

---

## A. Các phát hiện từ review thiết kế ban đầu

| # | Mức | Vấn đề | Trạng thái |
|---|---|---|---|
| 1 | P0 | `lesson_classes` / `lesson_teachers` / `timetable_conflicts` / `timetable_snapshots` không có `school_id`, nằm ngoài RLS → lộ dữ liệu chéo trường nếu query trực tiếp | ✅ Thêm cột + trigger `derive_school_id_from_parent` điền từ bản ghi cha; RLS đầy đủ (0001, mục 12b) |
| 2 | P0.5 | Hai policy permissive mặc định **OR** với nhau → `teacher_scope` thường sẽ bị `tenant_isolation` che mất; hàm kiểm tra đọc lại bảng con từ trong policy gây **đệ quy vô hạn** | ✅ Dùng `AS RESTRICTIVE` + `teacher_can_see_lesson()` là SECURITY DEFINER, bảng con bỏ FORCE (schema mục 12) |
| 3 | P1 | Hoán đổi hai tiết va partial unique index **không deferrable được** — UPDATE tuần tự nổ ngay dù trạng thái cuối hợp lệ | 📐✅ Thiết kế delete-reinsert (API spec §4.6) + endpoint `POST /lessons/:lid/swap` đã implement trong `apps/api` |
| 4 | P1 | Hàm chi phí nhân bản 3 nơi (worker/API/client) chắc chắn trôi khỏi nhau | ✅ `packages/cost-core` — một nguồn, golden test chặn merge khi lệch |
| 5 | P1 | Schema phân tán: `timetable_locks` ở API doc, ETag giả định trigger version chưa tồn tại, thiếu `holidays`, thiếu roles/grants, GUC contract không đầy đủ | ✅ Hợp nhất vào 0001: `timetable_locks`, `trg_bump_ver_*` (3 trigger transition table), `holidays`, role `app_role` + GRANT, hợp đồng 3 GUC ghi ở mục 12 |
| 6 | P2 | `constraints.kind` là text tự do → typo lệch môi trường | ✅ Bảng registry `constraint_kinds` + FK |
| 7 | P2 | Kempe chain chưa xét xung đột PHÒNG | ⏳ Chấp nhận v1 (lớp dùng home_room); ghi rõ giới hạn — xem gaps.md |
| 8 | P3 | Cell width spec 104px vs prototype 92px; API path trộn kiểu lồng/tuyệt đối | 📐 Quy ước path ghi §1.1 API spec; cell width để UI phase quyết |

## B. Bẫy PostgreSQL / Node đã gặp và xử lý

| Bẫy | Chi tiết | Cách chặn |
|---|---|---|
| Policy permissive OR nhau | Policy thường bị policy khác "che" mất giới hạn | `AS RESTRICTIVE` cho mọi policy phạm vi theo dòng |
| Đệ quy RLS | Policy của `lesson_teachers` đọc lại chính nó | SECURITY DEFINER + bảng con KHÔNG FORCE |
| Partial unique non-deferrable | Swap tuần tự nổ unique violation giữa transaction | Delete-reinsert một lần (§4.6), solver ghi bằng DELETE-all+INSERT-all |
| PgBouncer mode transaction | Prepared statement của client gãy khi có tải | postgres.js `prepare:false` ngay từ đầu (`db.service.ts`) |
| Transition table | OLD/NEW table không hợp với mọi event type | Tách 3 trigger INSERT/UPDATE/DELETE riêng |
| Bitmask convention | `fullMask` dịch trái sai → sinh ô "ma" index ≥ S, ejection đọc occ vượt biên | Bit thấp chuẩn `1 << (s & 31)`; trim word cuối bằng `(1<<used)-1`; golden test bắt lại |
| Occupancy động vs mask tĩnh | M2 hoán đổi chỉ kiểm tra mask tĩnh → trùng GV sau ~8 bước SA | Kiểm tra `canPlace` ĐẦY ĐỦ sau khi dọn ô đích, trước khi áp |
| Stale slot qua các lần chạy solver | `.slot` cũ còn sót khi tiết thất bại → nhiễu dữ liệu | Reset trạng thái trước mỗi vòng retry |
| Ghim vs lịch bận tĩnh | Ghim bị bỏ qua âm thầm khi ô trúng mask bận | Ghim ghi đè mask (ý định tường minh người dùng); chỉ bỏ khi xung đột occupancy thật |
| tsx + decorators | Chạy tsx từ root không nhận tsconfig workspace → decorators tắt | Luôn chạy qua `npm run dev -w @tkb/api` (cwd đúng) |
| postgres.js generic | `sql.begin<T>` suy kiểu `UnwrapPromiseArray` | Cast `as T` tại return |
| **PowerShell patch UTF-8** | `Get-Content | -replace | Set-Content -Encoding UTF8` đọc ANSI ghi UTF-8 → **mỏ tiếng Việt thành mojibake** | CẤM patch VN files bằng PS pipes — luôn dùng Edit/write tool; sau này dùng git/bash |

## C. Quy ước bắt buộc khi code tiếp

1. **Ràng buộc cứng ở tầng thấp nhất**: DB unique index + định nghĩa phép biến đổi solver. Không bao giờ chỉ dựa vào check ứng dụng.
2. **Một hàm chi phí duy nhất**: mọi tính điểm/phạt/explain đi qua `@tkb/cost-core`. Client và server phải ra cùng kết quả từng byte — có golden test.
3. **Incremental === full**: sau mọi phép biến đổi, `state.total` phải bằng `recomputeAll()`. Test random-walk đang chạy; giữ nguyên pattern khi thêm ràng buộc mới.
4. **SET LOCAL ba GUC** đầu mỗi transaction: `current_school_id`, `current_user_id`, `current_role` — qua `DbService.tx()`, không tự raw-query ngoài nó.
5. **Khuôn lỗi duy nhất** `{error:{code,message,details},requestId}` message tiếng Việt — throw `ApiError`.
6. **Migration cộng thêm**, chia 4 lần phát hành khi đổi breaking (hạ tầng §7.3). Đóng băng migration tháng 8.
