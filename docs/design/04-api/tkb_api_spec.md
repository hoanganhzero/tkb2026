# TKB SaaS — Đặc tả API & thời gian thực

> Đi kèm: `tkb_schema.sql`, `tkb_design_spec.md`, `tkb_solver_design.md`,
> `tkb_permissions.md`, `tkb_year_rollover_design.md`.

---

## 1. Quy ước chung

### 1.1 Địa chỉ và phiên bản

```
https://api.tkb.vn/v1
wss://api.tkb.vn/v1/ws
```

Phiên bản nằm trong đường dẫn. Thay đổi phá vỡ tương thích → tăng lên `/v2`, giữ `/v1` chạy song song tối thiểu 12 tháng — trường học chỉ nâng cấp vào dịp hè.

Ghi chú quy ước: các endpoint tác động lên một tài nguyên đã có id (ví dụ `PATCH /v1/lessons/:lid/move`, `/jobs/:jid`, `/undo/{token}`) được viết **tuyệt đối**, không lồng dưới `/schools/:sid` — ngữ cảnh trường vẫn xác định bằng `X-School-Id`. Các endpoint tạo mới / liệt kê thì lồng dưới `/schools/:sid/...` như các bảng dưới đây.

### 1.2 Xác thực và ngữ cảnh trường

```http
Authorization: Bearer <access_token>      # JWT, sống 15 phút
X-School-Id: 0f9c...                      # bắt buộc với mọi endpoint trong /schools
```

Access token chứa `sub` (user id) và `schools` (danh sách `{schoolId, role}`). Server đối chiếu `X-School-Id` với danh sách này rồi đặt `SET LOCAL app.current_school_id` cho RLS. Một request không bao giờ chạm dữ liệu của hai trường.

Refresh token là chuỗi ngẫu nhiên lưu băm trong `refresh_tokens`, sống 30 ngày, xoay vòng mỗi lần dùng.

Mật khẩu băm bằng **argon2id** (memory-hard, tham số ≥ 64 MB bộ nhớ). Khi đổi vai trò thành viên hoặc đặt lại mật khẩu, thu hồi toàn bộ refresh token của user đó — access token sống 15 phút nên cửa sổ rủi ro bị chặn ở đó.

### 1.3 Khuôn dạng lỗi

Một khuôn dạng duy nhất cho mọi lỗi:

```json
{
  "error": {
    "code": "TEACHER_OVERLOADED",
    "message": "Cô Trần Thị Mai đã được phân công 23 tiết, vượt định mức 19 tiết.",
    "field": "teacherId",
    "details": { "teacherId": "8a1c...", "assigned": 23, "limit": 19 }
  },
  "requestId": "req_01HX3..."
}
```

Quy tắc: `code` để máy xử lý, viết HOA_GẠCH_DƯỚI, không bao giờ đổi. `message` bằng **tiếng Việt, hiển thị thẳng cho người dùng** — không phải chuỗi kỹ thuật. `details` chứa dữ liệu để giao diện dựng nút hành động.

| Mã HTTP | Dùng khi |
|---|---|
| 400 | Dữ liệu vào sai khuôn dạng |
| 401 | Thiếu hoặc hết hạn token |
| 403 | Không đủ quyền (xem `tkb_permissions.md`) |
| 404 | Không tìm thấy, hoặc không thuộc trường hiện tại |
| 409 | Xung đột trạng thái — trùng lịch, bị khoá, đã publish |
| 422 | Đúng khuôn dạng nhưng vi phạm nghiệp vụ |
| 429 | Vượt giới hạn tần suất |

### 1.4 Phân trang và lọc

Danh mục dùng con trỏ, không dùng `offset` (danh sách thay đổi khi đang duyệt):

```
GET /schools/:sid/teachers?limit=50&cursor=eyJpZCI6...&q=hung&departmentId=...
→ { "data": [...], "nextCursor": "eyJpZCI6...", "total": 92 }
```

Tìm kiếm `q` **bỏ dấu tiếng Việt** ở cả hai phía: gõ `hung` khớp `Hùng`, gõ `nguyen van` khớp `Nguyễn Văn`. Cài bằng cột sinh sẵn:

```sql
ALTER TABLE teachers ADD COLUMN search_key text
  GENERATED ALWAYS AS (lower(unaccent(full_name || ' ' || code))) STORED;
CREATE INDEX ON teachers USING gin (search_key gin_trgm_ops);
```

### 1.5 Idempotency

Mọi `POST` tạo tài nguyên nhận `Idempotency-Key`. Cần thiết vì mạng trường học hay chập chờn và người dùng bấm nút hai lần:

```http
POST /schools/:sid/assignments
Idempotency-Key: 4f2b8c1e-...
```

Lưu `(key, school_id, response)` trong Redis 24 giờ; gửi lại cùng key trả về đúng phản hồi cũ.

---

## 2. Danh mục endpoint

Bảng tóm tắt. Ba endpoint đánh dấu ★ được mô tả kỹ ở mục 3–5.

### Xác thực

| Method | Đường dẫn | Ghi chú |
|---|---|---|
| POST | `/auth/register` | Đăng ký tài khoản + tạo trường đầu tiên |
| POST | `/auth/login` | Trả access + refresh token |
| POST | `/auth/refresh` | Xoay vòng refresh token |
| POST | `/auth/logout` | Thu hồi refresh token |
| GET | `/auth/me` | Thông tin user + danh sách trường và vai trò |
| POST | `/auth/password/forgot` `/reset` | Đặt lại mật khẩu qua email |

### Trường, thành viên, gói dịch vụ

| Method | Đường dẫn |
|---|---|
| GET / PATCH | `/schools/:sid` |
| GET | `/schools/:sid/members` |
| POST | `/schools/:sid/invitations` |
| PATCH / DELETE | `/schools/:sid/members/:uid` |
| GET | `/schools/:sid/subscription` |
| POST | `/schools/:sid/subscription/checkout` |

### Năm học và khung thời gian

| Method | Đường dẫn |
|---|---|
| GET POST | `/schools/:sid/school-years` |
| GET PATCH DELETE | `/schools/:sid/school-years/:yid` |
| POST | `/schools/:sid/school-years/:yid/activate` |
| GET POST PATCH DELETE | `.../semesters`, `.../periods` |
| POST | `/schools/:sid/rollovers` — tạo bản nháp chuyển tiếp năm học |
| GET PATCH | `/schools/:sid/rollovers/:rid` — sửa bảng ánh xạ |
| POST | `/schools/:sid/rollovers/:rid/apply` `/undo` |

### Danh mục

Cùng một khuôn CRUD cho `grades`, `departments`, `subjects`, `rooms`, `teachers`, `classes`:

| Method | Đường dẫn |
|---|---|
| GET POST | `/schools/:sid/years/:yid/{resource}` |
| GET PATCH DELETE | `/schools/:sid/years/:yid/{resource}/:id` |
| POST | `/schools/:sid/years/:yid/{resource}/bulk` — tạo/sửa hàng loạt, dùng cho nhập Excel |

Bổ sung:

| Method | Đường dẫn | Ghi chú |
|---|---|---|
| PUT | `.../subjects/:id/grade-configs` | Đặt số tiết chuẩn theo khối |
| PUT | `.../teachers/:id/subjects` | Môn giáo viên dạy được |
| GET PUT | `.../teachers/:id/availability` | Lưới bận/rảnh, ghi đè toàn bộ |
| GET | `.../teachers/workload` | Tải giảng dạy toàn trường |

### Phân công giảng dạy

| Method | Đường dẫn | Ghi chú |
|---|---|---|
| GET | `.../assignments?classId=&subjectId=&teacherId=` | |
| GET | `.../assignments/matrix` | Ma trận Lớp × Môn cho màn hình phân công |
| POST PATCH DELETE | `.../assignments`, `.../assignments/:id` | |
| POST | `.../assignments/bulk` | Ghi cả ma trận trong một lần |
| POST | `.../assignments/:id/merge-classes` | Ghép lớp |
| POST | `.../assignments/:id/split-class` | Tách lớp thành nhóm |
| GET | `.../assignments/validation` | Danh sách cảnh báo: thiếu môn, vượt định mức |

### Ràng buộc

| Method | Đường dẫn |
|---|---|
| GET POST PATCH DELETE | `.../constraints` |
| GET PUT | `.../availability?ownerType=teacher&ownerId=...` |
| POST | `.../availability/bulk` — quét chuột nhiều ô |

### Thời khoá biểu

| Method | Đường dẫn | Ghi chú |
|---|---|---|
| GET POST | `.../timetables` | |
| GET PATCH DELETE | `.../timetables/:tid` | |
| **GET** | **`.../timetables/:tid/grid`** | ★ mục 3 |
| POST | `.../timetables/:tid/lessons` | Đặt tiết mới từ kho |
| **PATCH** | **`/lessons/:lid/move`** | ★ mục 4 |
| POST | `/lessons/:lid/swap` | Hoán đổi hai tiết |
| PATCH | `/lessons/:lid/pin` | Ghim / bỏ ghim |
| DELETE | `/lessons/:lid` | Gỡ về kho |
| POST | `.../timetables/:tid/lessons/batch` | Nhiều thao tác trong một transaction |
| GET | `.../timetables/:tid/conflicts` | Danh sách lỗi và cảnh báo |
| GET | `.../timetables/:tid/unscheduled` | Kho tiết chưa xếp |
| POST | `.../timetables/:tid/publish` `/unpublish` | |
| GET POST | `.../timetables/:tid/snapshots` | |
| POST | `.../timetables/:tid/snapshots/:snid/restore` | |

### Solver

| Method | Đường dẫn |
|---|---|
| POST | `.../timetables/:tid/solve` — tạo job, trả `jobId` |
| GET | `/jobs/:jid` — trạng thái, dùng khi WebSocket không kết nối được |
| POST | `/jobs/:jid/cancel` |
| POST | `.../timetables/:tid/feasibility` — chẩn đoán trước khi chạy |

### Khoá mềm

| Method | Đường dẫn | Ghi chú |
|---|---|---|
| GET | `.../timetables/:tid/locks` | Ai đang giữ lớp nào |
| POST | `.../timetables/:tid/locks` | Xin khoá — mục 6 |
| POST | `.../timetables/:tid/locks/heartbeat` | Gia hạn |
| DELETE | `.../timetables/:tid/locks` | Trả khoá |

### Nhập, xuất, báo cáo

| Method | Đường dẫn |
|---|---|
| GET | `/templates/import.xlsx` — tải file mẫu |
| POST | `.../imports/validate` — kiểm tra, không ghi |
| POST | `.../imports/commit` — ghi dữ liệu đã duyệt |
| POST | `.../exports` — tạo job xuất file, trả `downloadUrl` khi xong |
| GET | `/public/:slug/timetable` — trang xem công khai, không cần token |
| GET | `/me/timetable.ics` — lịch cá nhân, xác thực bằng token trong URL |

---

## 3. ★ `GET /timetables/:tid/grid`

Endpoint được gọi nhiều nhất và nặng nhất. Mục tiêu: **dưới 300ms từ lúc bấm tới lúc lưới hiện đủ**, kể cả trường 45 lớp trên đường truyền của một trường huyện.

### 3.1 Vì sao JSON thông thường không đạt

Cách viết trực giác:

```json
{ "lessons": [
  { "id": "8a1c...", "classId": "3f2b...", "className": "10A1",
    "teacherId": "9d4e...", "teacherName": "T. Nguyễn Văn Hùng",
    "subjectId": "1a7c...", "subjectName": "Toán", "subjectColor": "#DCEAFB",
    "roomId": "5e8f...", "roomCode": "A201",
    "dayOfWeek": 2, "periodId": "7b3d...", "isPinned": false }
]}
```

Khoảng **310 byte mỗi tiết**. Với 1.300 tiết là **403 KB**, nén gzip còn ~45 KB. Trên đường truyền 3G của trường vùng sâu (~400 Kbps thực tế) mất khoảng 0,9 giây chỉ để tải, chưa kể phân tích cú pháp và dựng DOM.

Vấn đề không phải kích thước tuyệt đối mà là **lặp lại**: tên giáo viên "T. Nguyễn Văn Hùng" xuất hiện 19 lần, mã màu `#DCEAFB` xuất hiện 180 lần.

### 3.2 Thiết kế: từ điển + mảng theo cột

```json
{
  "timetable": {
    "id": "c4a1...", "name": "TKB HK I", "status": "draft",
    "version": 7, "softScore": 214, "hardViolations": 0,
    "updatedAt": "2026-08-22T03:12:44Z"
  },
  "dict": {
    "days": [1,2,3,4,5,6],
    "periods": [
      { "id": "p1", "session": "morning", "ordinal": 1, "name": "Tiết 1",
        "start": "07:00", "end": "07:45", "pos": 0 }
    ],
    "classes":  [ { "id": "c1", "name": "10A1", "gradeId": "g1", "roomId": "r7" } ],
    "teachers": [ { "id": "t1", "name": "T. Nguyễn Văn Hùng", "short": "T.Hùng" } ],
    "subjects": [ { "id": "s1", "short": "Toán", "name": "Toán", "color": 0 } ],
    "rooms":    [ { "id": "r1", "code": "A201" } ],
    "palette":  ["#DCEAFB","#FBE0E0","..."]
  },
  "lessons": {
    "count": 1300,
    "id":      ["8a1c...", "..."],
    "slot":    [12, 3, 27, ...],
    "subject": [0, 4, 1, ...],
    "class":   [0, 0, 1, ...],
    "teacher": [3, 7, 3, ...],
    "room":    [-1, 12, -1, ...],
    "flags":   [0, 1, 0, ...]
  }
}
```

**Bốn quyết định:**

1. **Chỉ số nguyên thay vì UUID** trong phần thân. `class: 0` tra vào `dict.classes[0]`. Từ điển gửi một lần.
2. **Mảng theo cột** thay vì mảng đối tượng — loại bỏ toàn bộ tên khoá lặp lại. `"subject":[0,4,1]` thay vì `[{"subject":0},{"subject":4}]`.
3. **`slot` gộp ngày và tiết**: `slot = dayIndex * P + periodPos`. Một số thay cho hai trường.
4. **`flags` là bitfield**: bit 0 = ghim, bit 1 = có xung đột, bit 2 = tiết đôi (nửa đầu), bit 3 = tiết đôi (nửa sau).

`lessons.id` vẫn phải là UUID vì client cần gọi `PATCH /lessons/:id/move`. Đây là phần chiếm chỗ nhất còn lại.

### 3.3 Kích thước thực tế

| Thành phần | 45 lớp / 1.300 tiết |
|---|---|
| `dict` (45 lớp + 92 GV + 15 môn + 50 phòng + 10 tiết) | 14 KB |
| `lessons.id` (1.300 × 38 byte) | 49 KB |
| 6 mảng số nguyên còn lại | 12 KB |
| **Tổng thô** | **75 KB** |
| **Sau gzip** | **≈ 11 KB** |

Nhanh hơn 4 lần so với cách thông thường, và quan trọng hơn: **thời gian phân tích cú pháp giảm mạnh** vì `JSON.parse` xử lý mảng số nhanh hơn nhiều so với mảng đối tượng có 12 khoá.

**Tối ưu thêm nếu cần:** thêm cột `lessons.ord smallint` (số thứ tự trong một timetable, 0…N-1) vào schema, rồi bỏ hẳn `lessons.id` khỏi phản hồi. Endpoint move đổi thành `PATCH /timetables/:tid/lessons/:ord/move`. Còn lại **26 KB thô / 4 KB nén**. Đáng làm nếu có khách hàng ở vùng mạng yếu.

### 3.4 Bộ nhớ đệm

```http
GET /timetables/c4a1.../grid
If-None-Match: "v7-1755832364"
→ 304 Not Modified
```

`ETag = "v{version}-{updatedAt.epoch}"`. Cột `timetables.version` tăng mỗi lần bất kỳ tiết nào đổi chỗ — cài bằng trigger. Người dùng chuyển tab và quay lại không phải tải lại 75 KB.

### 3.5 Tham số

| Tham số | Tác dụng |
|---|---|
| `?view=class\|teacher\|room` | Chỉ đổi cách sắp xếp gợi ý; dữ liệu như nhau — client tự dựng ba chế độ xem từ một lần tải |
| `?gradeId=` | Chỉ lấy tiết của một khối, dùng khi lọc |
| `?includeConflicts=true` | Kèm mảng `conflicts` thay vì gọi endpoint riêng |
| `?dict=false` | Bỏ từ điển khi client đã có (tải lại sau khi solver chạy) |

---

## 4. ★ `PATCH /lessons/:lid/move`

Endpoint được gọi nhiều nhất theo số lần, và là nơi trải nghiệm kéo-thả sống hay chết.

### 4.1 Yêu cầu

```http
PATCH /v1/lessons/8a1c.../move
Content-Type: application/json

{
  "toSlot": { "dayOfWeek": 3, "periodId": "p2" },
  "roomId": "r12",
  "expectedVersion": 7,
  "dryRun": false,
  "acceptSoftViolations": true
}
```

| Trường | Ý nghĩa |
|---|---|
| `expectedVersion` | Phiên bản timetable client đang giữ. Lệch → 409 `STALE_VERSION`, buộc tải lại. Đây là khoá lạc quan chống ghi đè khi hai người cùng sửa. |
| `dryRun` | Chỉ tính toán, không ghi. Dùng khi client không tự tính được đèn giao thông. |
| `acceptSoftViolations` | `false` → từ chối nếu có vi phạm mềm, trả về danh sách để client hỏi lại người dùng. `true` → cứ đặt và báo về. |

### 4.2 Thành công (200)

```json
{
  "lesson": { "id": "8a1c...", "slot": 17, "roomId": "r12", "isPinned": false },
  "timetable": { "version": 8, "softScore": 189, "hardViolations": 0 },
  "delta": {
    "softScore": -25,
    "improved": true,
    "violations": [
      { "kind": "class_same_subject_day", "penalty": 25,
        "message": "10A1 sẽ có 2 tiết Toán trong Thứ Tư",
        "refs": { "classId": "c1", "dayOfWeek": 3, "subjectId": "s1" } }
    ]
  },
  "undoToken": "und_01HX3..."
}
```

Trường `delta.violations` là **cùng dữ liệu mà giao diện dùng cho tooltip vàng**. Một nguồn sự thật cho cả hai — nếu client tự tính đèn giao thông thì kết quả server phải trùng khớp; lệch nhau là dấu hiệu hàm chi phí hai bên đã trôi khỏi nhau.

`undoToken` dùng cho nút Hoàn tác trên toast, sống 10 phút: `POST /undo/{token}`.

### 4.3 Xung đột (409) — phần quan trọng nhất

Trả **409 kèm mô tả cụ thể**, không bao giờ trả 409 rỗng:

```json
{
  "error": {
    "code": "LESSON_MOVE_BLOCKED",
    "message": "Không đặt được tiết này vào Thứ Tư tiết 2.",
    "conflicts": [
      {
        "kind": "teacher_overlap",
        "severity": "hard",
        "message": "Thầy Nguyễn Văn Hùng đang dạy 11A2 tiết này.",
        "resource": { "type": "teacher", "id": "t3", "name": "T. Nguyễn Văn Hùng" },
        "blockedBy": {
          "lessonId": "9f2e...",
          "classId": "c18", "className": "11A2",
          "subjectShort": "Toán",
          "slot": 17,
          "isPinned": false
        },
        "resolutions": [
          { "kind": "swap", "withLessonId": "9f2e...", "delta": -8,
            "label": "Đổi chỗ với tiết Toán 11A2" },
          { "kind": "move_blocker", "lessonId": "9f2e...", "toSlot": 22, "delta": 4,
            "label": "Chuyển tiết 11A2 sang Thứ Năm tiết 3" }
        ]
      }
    ],
    "suggestions": [
      { "slot": 21, "delta": -18, "label": "Thứ Năm tiết 2" },
      { "slot": 9,  "delta": -12, "label": "Thứ Ba tiết 5" }
    ]
  }
}
```

Ba tầng thông tin, và cả ba đều cần thiết:

1. **`message`** — hiển thị thẳng, người dùng hiểu ngay chuyện gì xảy ra.
2. **`resolutions`** — nút hành động trong toast. Đây là khác biệt giữa "phần mềm nói không" và "phần mềm giúp giải quyết". Người dùng bấm "Đổi chỗ với tiết Toán 11A2" là xong, không phải tự đi tìm.
3. **`suggestions`** — hai ô tốt nhất còn lại, để họ không phải dò thủ công.

`blockedBy.isPinned` quan trọng: nếu tiết cản đường bị ghim thì không đề xuất `move_blocker`, chỉ nêu rõ *"Tiết này đã bị ghim, hãy bỏ ghim trước."*

### 4.4 Các mã lỗi khác

| Mã | HTTP | Tình huống |
|---|---|---|
| `LESSON_MOVE_BLOCKED` | 409 | Vi phạm ràng buộc cứng — có `conflicts` |
| `LESSON_PINNED` | 409 | Tiết bị ghim |
| `SLOT_NOT_ALLOWED` | 409 | Ngoài `allowMask` — GV hoặc lớp báo bận |
| `STALE_VERSION` | 409 | Client giữ phiên bản cũ, kèm `currentVersion` |
| `CLASS_LOCKED` | 409 | Lớp đang bị người khác khoá — kèm `lockedBy` |
| `TIMETABLE_LOCKED` | 409 | Đang chạy solver hoặc đã publish |
| `SOFT_VIOLATIONS_REJECTED` | 422 | `acceptSoftViolations=false` và có vi phạm mềm |

### 4.5 Thao tác hàng loạt

Kéo-thả liên tục sinh nhiều request nhỏ. Cho phép gộp:

```http
POST /timetables/:tid/lessons/batch
{
  "expectedVersion": 7,
  "ops": [
    { "op": "move", "lessonId": "8a1c...", "toSlot": 17 },
    { "op": "swap", "lessonId": "9f2e...", "withLessonId": "3d7a..." },
    { "op": "pin",  "lessonId": "1b5c...", "value": true }
  ],
  "atomic": true
}
```

`atomic: true` → một transaction, hỏng một thao tác là hỏng cả gói. Dùng cho Kempe chain (đổi chỗ dây chuyền 5 tiết phải cùng thành công). `atomic: false` → thực hiện được cái nào hay cái đó, trả về `results[]` từng phần.

### 4.6 Chiến lược ghi cho swap và batch atomic — bắt buộc phải đọc

Ba unique index `lesson_classes_unique` / `lesson_teachers_unique` / `lessons_room_unique`
là **partial unique index — không thể khai báo DEFERRABLE** (PostgreSQL chỉ cho trì
hoãn unique *constraint* tròn trịa, không trì hoãn partial index). Hệ quả: **không
thể UPDATE tuần tự hai nửa của một phép hoán đổi** — nửa đầu sẽ va index ngay lập
tức vì ô đích vẫn đang bị chiếm, dù trạng thái cuối cùng của transaction hợp lệ.
Trigger `sync_lesson_slot` chạy ngay sau từng UPDATE nên xung đột nổ trước cả khi
câu lệnh thứ hai kịp chạy.

Chiến lược bắt buộc khi implement `POST /lessons/:lid/swap` và batch `{ atomic: true }`
có thao tác giao nhau theo ô:

```sql
BEGIN;
  DELETE FROM lessons WHERE id IN ($1, $2);   -- lesson_classes/teachers cascade xoá theo
  INSERT INTO lessons (...) VALUES (...), (...);  -- hai tiết mới, ô thời gian đã đổi chỗ
  -- INSERT lesson_classes / lesson_teachers tương ứng (trigger trg_*_school điền school_id)
COMMIT;
```

Ba hệ lụy phải xử lý kèm theo:

1. **Id thay đổi sau swap.** Phản hồi trả `idMap: { "<oldLessonId>": "<newLessonId>", ... }`
   và WebSocket phát `lessons.bulk` chứa cùng ánh xạ. Client cập nhật state từ phản
   hồi và bỏ id cũ. `undoToken` lưu payload nội dung hai tiết nên hoàn tác không phụ
   thuộc id.
2. **Solver không gặp vấn đề này** vì đường ghi kết quả vốn là DELETE toàn bộ +
   INSERT toàn bộ trong một transaction (`tkb_solver_design.md` mục 12.3).
3. **Hoán đổi chỉ phòng** (`M5`) cũng đi qua cùng đường delete-reinsert, vì
   `lessons_room_unique` cùng ràng buộc non-deferrable.

Đây là loại lỗi chỉ xuất hiện khi có dữ liệu thật — prototype HTML không đụng DB
nên không bao giờ phát hiện được. Đã kiểm chứng bằng integration test với ca
"swap hai tiết cùng lớp trong một transaction".

---

## 5. ★ WebSocket

### 5.1 Kết nối

```
wss://api.tkb.vn/v1/ws?token=<access_token>
→ { "type": "hello", "connectionId": "conn_...", "serverTime": "..." }

→ { "type": "subscribe", "channels": ["timetable:c4a1...", "school:0f9c..."] }
← { "type": "subscribed", "channels": [...], "seq": 4821 }
```

Token qua query string vì trình duyệt không cho đặt header trên WebSocket. Token sống ngắn (15 phút) nên rủi ro lộ qua log chấp nhận được; kết nối tự đóng khi token hết hạn, client mở lại bằng token mới.

### 5.2 Khuôn dạng sự kiện

```json
{ "type": "lesson.moved", "channel": "timetable:c4a1...", "seq": 4822,
  "ts": "2026-08-22T03:14:07.412Z",
  "actor": { "userId": "u9", "name": "Cô Trần Thị Mai" },
  "data": { "lessonId": "8a1c...", "fromSlot": 12, "toSlot": 17,
            "version": 8, "softScore": 189 } }
```

`seq` tăng đơn điệu **trên mỗi kênh**. Client lưu `seq` cuối cùng nhận được; khi kết nối lại:

```json
{ "type": "subscribe", "channels": ["timetable:c4a1..."], "since": 4822 }
```

Server phát lại các sự kiện từ `4823` (giữ 500 sự kiện gần nhất trong Redis Stream). Nếu khoảng cách quá lớn → `{ "type": "resync_required" }`, client gọi lại `GET /grid`. Cơ chế này quan trọng vì Wi-Fi trường học rớt liên tục.

### 5.3 Danh mục sự kiện

**Kênh `timetable:{id}`**

| Sự kiện | Dữ liệu |
|---|---|
| `lesson.moved` | `lessonId, fromSlot, toSlot, version, softScore` |
| `lesson.created` | Đối tượng tiết đầy đủ |
| `lesson.removed` | `lessonId, fromSlot` |
| `lesson.pinned` | `lessonId, isPinned` |
| `lessons.bulk` | `changes[]` — dùng sau khi solver chạy hoặc khôi phục snapshot |
| `timetable.updated` | Đổi tên, đổi trạng thái |
| `timetable.published` | `publicSlug, publishedAt` |
| `lock.acquired` / `lock.released` / `lock.expired` | `classIds[], userId, userName, expiresAt` |
| `presence.sync` | Danh sách người đang mở TKB này |

**Kênh `job:{id}`**

| Sự kiện | Dữ liệu |
|---|---|
| `solver.started` | `algorithm, params` |
| `solver.progress` | Theo cấu trúc ở `tkb_solver_design.md` mục 10 — nhịp 250ms |
| `solver.improved` | `delta[]` các tiết vừa đổi chỗ, tối đa 2 giây một lần |
| `solver.finished` | `placed, total, softScore, elapsedMs` |
| `solver.failed` | `reason, diagnostics[]` |

**Kênh `school:{id}`**

| Sự kiện | Dữ liệu |
|---|---|
| `import.progress` / `import.finished` | Nhập Excel |
| `export.ready` | `downloadUrl, expiresAt` |
| `member.joined` | |

### 5.4 Không phát lại cho chính người gửi

Client gửi `PATCH /lessons/:id/move` đã cập nhật giao diện lạc quan ngay. Nếu WebSocket phát lại sự kiện đó, giao diện sẽ nháy. Giải quyết bằng cách gửi kèm `connectionId`:

```http
PATCH /lessons/8a1c.../move
X-Connection-Id: conn_9f3a...
```

Server đính `originConnectionId` vào sự kiện; client bỏ qua sự kiện có `originConnectionId` trùng của mình. Đơn giản hơn nhiều so với so khớp nội dung.

### 5.5 Đường lui khi WebSocket không dùng được

Một số trường có tường lửa chặn WebSocket. Client tự phát hiện sau 5 giây không kết nối được và chuyển sang hỏi vòng:

```
GET /timetables/:tid/events?since=4822     → mảng sự kiện, nhịp 3 giây
GET /jobs/:jid                             → nhịp 1 giây khi solver đang chạy
```

Trải nghiệm kém hơn nhưng vẫn dùng được. Hiện chỉ báo nhỏ trên thanh trạng thái: *"Đang dùng chế độ đồng bộ chậm"*.

---

## 6. Đồng thời nhiều người — khoá mềm ở cấp lớp

### 6.1 Chọn cách nào

Ba phương án khả dĩ:

| Phương án | Ưu | Nhược |
|---|---|---|
| **Khoá bi quan toàn bảng** | Đơn giản tuyệt đối | Chỉ một người làm việc được. Trường lớn có 2–3 người chia nhau xếp theo khối → chặn nhau vô lý |
| **Hợp nhất lạc quan (CRDT)** | Ai cũng sửa được | Phức tạp cao. Và với TKB nó **sai về nghiệp vụ**: hai người cùng đặt hai tiết vào một ô của cùng giáo viên, hợp nhất kiểu gì cũng ra thời khoá biểu sai |
| **Khoá mềm cấp lớp** ← chọn | Nhiều người làm song song trên các lớp khác nhau. Đúng cách trường thực sự phân công công việc | Cần quản lý vòng đời khoá |

Yếu tố quyết định: ràng buộc của bài toán này là **toàn cục qua giáo viên**, không tách rời theo lớp. Nhưng thực tế công việc thì người ta chia theo khối. Khoá cấp lớp cho phép chia việc, còn ràng buộc giáo viên vẫn được kiểm ở tầng cơ sở dữ liệu bằng unique index — nên không ai tạo ra được lịch sai dù có tranh chấp.

### 6.2 Bảng khoá

DDL chính thức nằm trong `tkb_schema.sql` (mục 7, sau `timetable_conflicts`). Nhắc lại cấu trúc:

```sql
CREATE TABLE timetable_locks (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id     uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    timetable_id  uuid NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
    class_id      uuid REFERENCES classes(id) ON DELETE CASCADE,  -- NULL = khoá cả bảng
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id text,
    acquired_at   timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    UNIQUE (timetable_id, class_id)
);
CREATE INDEX ON timetable_locks (expires_at);
```

`UNIQUE (timetable_id, class_id)` khiến việc giành khoá là nguyên tử ở tầng cơ sở dữ liệu — không cần Redis lock, không cần lo điều kiện đua.

### 6.3 Vòng đời

```
Mở màn hình xếp TKB
  → POST /timetables/:tid/locks  { classIds: ["c1","c2",...] }
     (xin khoá cho các lớp đang hiển thị)

Mỗi 20 giây
  → POST /timetables/:tid/locks/heartbeat     (gia hạn TTL lên 60 giây)

Đổi bộ lọc sang khối khác
  → POST .../locks { classIds: [...] }        (trả khoá cũ, xin khoá mới)

Đóng tab / mất kết nối
  → TTL hết sau 60 giây, dọn dẹp tự động
```

TTL 60 giây với nhịp gia hạn 20 giây: chịu được hai lần mất gói liên tiếp mà không mất khoá, đồng thời người khác chỉ phải chờ tối đa một phút khi đồng nghiệp đóng máy đột ngột.

### 6.4 Khi bị từ chối

```json
409 {
  "error": {
    "code": "CLASSES_LOCKED",
    "message": "Cô Trần Thị Mai đang xếp 3 lớp này.",
    "details": {
      "locked": [
        { "classId": "c1", "className": "10A1",
          "userId": "u9", "userName": "Cô Trần Thị Mai",
          "since": "2026-08-22T02:41:00Z", "expiresAt": "..." }
      ],
      "granted": ["c4","c5","c6"]
    }
  }
}
```

Cấp một phần: xin 6 lớp, được 3 lớp — người dùng làm việc trên 3 lớp đó ngay, không phải chờ. Giao diện hiển thị các lớp bị khoá dưới dạng **chỉ đọc, nền xám nhạt, kèm tên người đang giữ**:

```
  10A1  🔒 Cô Mai   ▓▓ ▓▓ ▒▒ ▓▓ ...      (không kéo được)
  10A4                ▓▓ ▒▒ ▓▓ ░░ ...      (kéo bình thường)
```

### 6.5 Giành lại khoá

Trường hợp thường gặp: người giữ khoá đã đi họp, để máy mở, hoặc quên đóng tab.

```http
POST /timetables/:tid/locks { "classIds": ["c1"], "takeover": true }
```

Điều kiện cho phép:
- Người xin có vai trò `admin` hoặc `owner`, **hoặc**
- Khoá đã "im lặng" quá 5 phút (không có thao tác ghi nào, dù heartbeat vẫn chạy)

Người bị lấy khoá nhận sự kiện `lock.expired` và giao diện chuyển sang chỉ đọc kèm thông báo: *"Thầy Nguyễn Văn An đã tiếp quản lớp 10A1. Các thay đổi của bạn đã được lưu."*

### 6.6 Solver khoá toàn bảng

Khi chạy xếp tự động, job giành khoá với `class_id = NULL`:

```sql
INSERT INTO timetable_locks (timetable_id, class_id, user_id, expires_at)
VALUES ($1, NULL, $2, now() + interval '10 minutes');
```

Xung đột với bất kỳ khoá lớp nào đang tồn tại → từ chối chạy, kèm danh sách người đang giữ. Trong lúc solver chạy, mọi `PATCH /lessons/*` trả 409 `TIMETABLE_LOCKED`. Người xem vẫn thấy lưới cập nhật trực tiếp qua WebSocket — chỉ không sửa được.

### 6.7 Có mặt (presence)

Nhẹ nhàng, chỉ để người dùng biết mình không làm việc một mình:

```json
{ "type": "presence.sync", "data": { "users": [
  { "userId": "u9", "name": "Cô Trần Thị Mai", "color": "#C25454",
    "classIds": ["c1","c2","c3"], "viewing": "class" }
]}}
```

Hiển thị dạng chấm tròn màu cạnh tên lớp trong cột đầu. Không làm con trỏ chuột thời gian thực — công cụ này không phải Figma, và với lưới dày đặc thì con trỏ bay lượn chỉ gây nhiễu.

---

## 7. Giới hạn tần suất

| Nhóm | Giới hạn | Ghi chú |
|---|---|---|
| Đọc chung | 300 req/phút mỗi user | |
| `PATCH /lessons/*` | 240 req/phút | Kéo-thả liên tục vẫn thoải mái |
| `POST .../solve` | 10 job/giờ mỗi trường | Solver ăn trọn một lõi CPU |
| `POST .../exports` | 30/giờ | |
| `POST /auth/login` | 10/15 phút mỗi IP | Chống dò mật khẩu |
| `POST /imports/*` | 20/giờ | |

Vượt giới hạn trả 429 kèm `Retry-After` và thông báo tiếng Việt rõ ràng, không phải chuỗi kỹ thuật.
