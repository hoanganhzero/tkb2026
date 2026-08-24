# Nhật ký dựng khung — cái gì đã làm, lỗi gì đã bắt

> Ghi lại theo trình tự để người sau hiểu TẠI SAO code đang như vậy.
> Kèm bài học vận hành công cụ (mục 6) — đừng lặp lại.

## 1. Vá tài liệu thiết kế theo review

Sửa trực tiếp `docs/design/` trước khi code: RLS bổ sung `school_id` cho 4 bảng con
+ trigger điền từ cha; hợp nhất `timetable_locks`/`holidays`/`constraint_kinds`;
trigger bump version (3 trigger vì transition table); role + GRANT; phát hiện và vá
2 bẫy PostgreSQL trong chính bản vá: policy permissive OR che mất teacher_scope
(→ AS RESTRICTIVE) và đệ quy policy đọc lại bảng con (→ SECURITY DEFINER, bỏ FORCE bảng con).

## 2. Bộ web tĩnh công khai (4 trang, ngoài repo app)

`tkb_landing.html`, `tkb_cong_khai.html` (xem TKB + in ND30 + .ics thật),
`tkb_auth.html`. Hero landing chạy solver thu nhỏ thật trong trình duyệt.
Bắt được lỗi stale-state giữa các lần chạy solver demo → retry-loop reset sạch.

## 3. cost-core — hàm chi phí chia sẻ

Typed arrays, đơn vị chi phí per (class|teacher, day) + weekly units, `move()` tăng dần,
`explainMove()` quy kết penalty ĐÚNG TỪNG MÃ ràng buộc (bất biến sum(reasons)==delta).
Golden test: ca vàng tính tay từng điểm (118 → 93 → 68 → 553 qua 3 bước) +
random walk 600 bước so `incremental === recomputeAll()` mỗi 50 bước.

**Lỗi tự gõ phải sửa ngay**: bản nháp explain.ts từng chứa placeholder hack truy cập
private (`state['clsOcc' as never]`) — viết lại sạch bằng API công khai
(`lessonAtClass`, `unitCDParts`). Bài học: không bao giờ để "code cho chạy" sót trong deliverable.

## 4. API NestJS

Auth scrypt+JWT HS256 tự viết (argon2id là TODO trước production), middleware ALS set
3 GUC, error envelope tiếng Việt, GET grid dạng từ điển+mảng-cột với ETag/304,
PATCH move kiểm tra xung đột cứng phía server. Boot thật: healthz 200, guard 401 đúng khuôn.

## 5. Web React

Store Zustand đúng 3 điểm hiệu năng §16 (Map O(1), đèn giao thông tính một lần tại
dragstart qua cost-core, undo lưu lệnh). Build vite thành công nhúng cost-core qua alias.

## 6. solver-core — nơi test bắt nhiều lỗi giá trị nhất

Thứ tự sự kiện khi dựng:

1. Fixture nhầm **assignment gộp lớp** (classes:[0,3,6] nhận 3×ppw tiết = ba lớp HỌC CHUNG)
   với ý định "ba lớp học riêng chung GV" → Pha A chỉ đặt 84/153. Fix fixture sinh
   assignment per-(class,subject).
2. Ghim bị **bỏ qua âm thầm** khi ô trúng lịch bận tĩnh ngẫu nhiên → ghim ghi đè mask
   (ý định người dùng thắng), chỉ skip khi occupancy thật conflict.
3. SA tạo **5 xung đột cứng**: viết vòng SA có giám sát quét occ mỗi vòng → bắt hiện trường
   tại iter 8: M2 hoán đổi chỉ kiểm mask tĩnh chéo, thiếu canPlace động trục GIÁO VIÊN
   (a's teacher bận ở s2 qua lớp khác). Vá: unplace(b) rồi canPlace đầy đủ cả hai chiều
   trước khi áp; không thoả → trả nguyên trạng + null.
4. Kempe áp tuần tự bằng move() **ghi đè occupancy thành viên chưa di chuyển**
   (unplace(Y) xoá dấu X vừa đặt) → đổi sang snapshot apply + recomputeAll một lần.
5. Worker map: mask không trim bit thừa + `fullMask` dịch trái sai quy ước bit thấp
   → ô "ma" ≥ S → ejection đọc clsOcc OOB trả undefined → crash trong unplace.
   Sửa chuẩn: word cuối `(1<<used)-1`, KHÔNG shift.

Kết quả cuối: 153/153 kín, 0 hard violation, SA ≤ greedy, deterministic seed,
ghim tuyệt đối, progress events hai pha, phát hiện bất khả thi đúng.

**Mẫu test đáng giữ**: vòng SA có giám sát (scan violation mỗi N bước, in kind/delta/
accept của candidate gây lỗi) — tái dùng mỗi khi thêm phép biến đổi mới.

## 7. worker + swap + seed

- swap endpoint delete-reinsert trả idMap (§4.6) — typecheck sạch, E2E chờ DB
- db-map.ts tách phần thuần: mapRowsToProblem/resultToWrites — 4 test round-trip
  bắt thêm bug trim mask (mục 6.5)
- seed.mjs sinh trường Demo + gọi solver thật ghi lessons bulk

## 8. import-core

12 test phủ §2–§4: chuẩn hoá (stripTitle hai-từ, phone 3 dạng), từ điển cột khớp
chính xác + chứa dài nhất ("Số tiết tối đa/tuần"), findHeaderRow lội quốc hiệu,
detectMatrixLayout xử lý "Lớp \ Môn", matcher 4 tầng (trùng tên → ambiguous),
rules 3 mức đủ các luật §4.3 gồm khả thi sớm.

## 9. Bài học vận hành công cụ (áp dụng ngay cho session sau)

1. **KHÔNG patch file UTF-8 tiếng Việt bằng PowerShell pipes** (`Get-Content | -replace |
   Set-Content -Encoding UTF8`) — PS5.1 đọc ANSI ghi UTF-8 → mojibake toàn bộ dấu.
   Đã hỏng auth.service.ts + db-map.ts và phải viết lại. Luôn dùng Edit tool hoặc node script.
2. Regex patch nhiều dòng cùng lúc dễ chèn literal `\`n` — sửa một chỗ một edit.
3. `npm` trên máy này bị ExecutionPolicy chặn .ps1 — dùng `npm.cmd`.
4. tsx phải chạy với cwd = thư mục workspace để nhận tsconfig (decorators).
5. Node 24 chạy thẳng TS erasable-syntax — các package core giữ nguyên ràng buộc này
   (không enum/namespace/parameter-properties) để test không cần build.

## 10. Đợt bổ sung: rollover-core · locks · ICS server · worker persist

Bốn mảnh logic thuần mới, nâng tổng lên 48 test:

- **rollover-core (7)**: promoteClassName tha thứ khoảng trắng thừa ('10 A1' vẫn suy
  được — khớp tinh thần chuẩn hoá §3.3); mapClasses tách bạch graduate/skip-xáo trộn/
  promote/tạo-mới-theo-mẫu `#`; mapAssignments hai chế độ followClass/keepGrade,
  **số tiết LUÔN lấy từ cấu hình khối MỚI** (§6.1), ghi đè theo tổ qua deptOverrides,
  đủ 4 loại cảnh báo §6.3.
- **locks (6 + REST)**: evaluateAcquire thuần — TTL/heartbeat/silent-5-phút/takeover
  theo vai trò; cấp từng phần. Controller map CSDL ↔ LockRow, chặn khi solver giữ
  khoá toàn bảng. Bẫy type: `ctx.userId` narrow mất trong closure → phải gán const
  trước khi vào tx.
- **export/ics (5)**: builder server-side chuẩn hoá từ bản demo trang công khai;
  test phủ VTIMEZONE/BYDAY ISO/EXDATE-chỉ-trùng-weekday/escape/fold 73-72/VALARM.
- **worker persist (5)**: buildPersistStatements trả mảng statement đúng thứ tự
  §12.3 với unnest bulk; test khẳng định DELETE chỉ dọn tiết chưa ghim và KHÔNG
  đụng version (trigger lo). persistResult(tx,input) gọi trong DbService.tx.

**Sự cố lặp lại**: lần thứ hai dùng PowerShell pipes sửa file UTF-8 tiếng Việt
(persist.ts) dù đã ghi bài học ở mục 9 — lại mojibake và phải viết lại toàn file.
Quy tắc nay là TUYỆT ĐỐI, không ngoại lệ: sửa file bằng Edit tool; nếu cần biến đổi
hàng loạt thì viết script Node đọc/ghi UTF-8 rõ ràng.

Trạng thái chốt đợt: **48/48 test · tsc sạch api/web/worker**. Còn lại chủ yếu là
lớp vận hành cần DB/Redis thật và diện UI — xem gaps-and-roadmap.md đã cập nhật.
