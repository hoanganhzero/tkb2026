# TKB SaaS — Thiết kế chuyển tiếp năm học

> Đi kèm: `tkb_schema.sql`, `tkb_design_spec.md`, `tkb_solver_design.md`.

---

## 1. Vì sao tính năng này quyết định tỉ lệ giữ chân

Vòng đời sử dụng của một trường:

```
Tháng 8/2025   Nhập liệu lần đầu — 4 đến 8 giờ làm việc
Tháng 9/2025   Xếp TKB, dùng cả năm
Tháng 8/2026   ← Điểm quyết định: ở lại hay bỏ đi
```

Nếu đến tháng 8 năm sau người dùng mở phần mềm và thấy một năm học trống rỗng, họ phải nhập lại toàn bộ giáo viên, lớp, môn, phòng, lịch bận. Lúc đó, công sức bỏ ra để tiếp tục dùng phần mềm **bằng đúng** công sức để quay lại Excel — và Excel thì miễn phí, quen tay.

Ngược lại, nếu họ bấm một nút và có ngay 90% dữ liệu, chi phí chuyển đổi trở nên gần bằng không. Đây là điểm mà sản phẩm chuyển từ "một công cụ đã thử" thành "hệ thống của trường".

Có một điểm tinh tế cần nắm: **thứ đáng giá nhất để mang sang không phải là danh sách dữ liệu, mà là các tinh chỉnh.** Danh sách lớp và giáo viên thay đổi hằng năm và cũng dễ nhập lại. Nhưng lịch bận của 90 giáo viên, bộ trọng số ràng buộc, mã màu môn học, khung tiết — những thứ đó mất hàng giờ để tinh chỉnh cho vừa ý và gần như **không đổi** giữa các năm. Thiết kế phải ưu tiên mang chúng sang trọn vẹn.

---

## 2. Cái gì đổi, cái gì không

Phân loại này là nền tảng của toàn bộ thiết kế:

| Nhóm | Đối tượng | Mức thay đổi hằng năm | Xử lý mặc định |
|---|---|---|---|
| **Gần như bất biến** | Khung tiết, phòng học, tổ bộ môn, mã màu môn, ngày học trong tuần | < 5% | Sao chép im lặng, không hỏi |
| **Ổn định** | Danh sách môn, số tiết chuẩn theo khối, luật ràng buộc, lịch bận cố định của GV | 5–15% | Sao chép, hiện tóm tắt để rà soát |
| **Biến động vừa** | Danh sách giáo viên, môn dạy được của GV | 10–20% | Bắt buộc rà soát từng dòng |
| **Biến động mạnh** | Danh sách lớp (thăng cấp, ra trường, tuyển mới) | 100% có logic | Ánh xạ có kiểm duyệt |
| **Phải xây lại** | Phân công giảng dạy | 30–60% | Sinh gợi ý, bắt buộc duyệt |
| **Không mang sang** | Thời khoá biểu, dạy thay, bản công bố, nhật ký | 100% | Bỏ (trừ tuỳ chọn nâng cao ở mục 8) |

---

## 3. Bổ sung cơ sở dữ liệu

Ba thay đổi cần thêm vào schema hiện có.

### 3.1 Cột truy vết nguồn gốc

```sql
ALTER TABLE grades      ADD COLUMN source_id uuid REFERENCES grades(id)      ON DELETE SET NULL;
ALTER TABLE departments ADD COLUMN source_id uuid REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE subjects    ADD COLUMN source_id uuid REFERENCES subjects(id)    ON DELETE SET NULL;
ALTER TABLE rooms       ADD COLUMN source_id uuid REFERENCES rooms(id)       ON DELETE SET NULL;
ALTER TABLE teachers    ADD COLUMN source_id uuid REFERENCES teachers(id)    ON DELETE SET NULL;
ALTER TABLE classes     ADD COLUMN source_id uuid REFERENCES classes(id)     ON DELETE SET NULL;
ALTER TABLE assignments ADD COLUMN source_id uuid REFERENCES assignments(id) ON DELETE SET NULL;
ALTER TABLE periods     ADD COLUMN source_id uuid REFERENCES periods(id)     ON DELETE SET NULL;

CREATE INDEX ON classes  (source_id) WHERE source_id IS NOT NULL;
CREATE INDEX ON teachers (source_id) WHERE source_id IS NOT NULL;
```

`source_id` trỏ tới bản ghi tương ứng ở năm trước. Ba công dụng:

1. **Chạy lại phần thiếu** — nếu người dùng dừng giữa chừng, biết cái gì đã sao chép.
2. **Truy vết lịch sử** — "thầy Hùng dạy Toán 10A1, mà lớp này năm ngoái là 9A1 do cô Mai dạy".
3. **Báo cáo nhiều năm** — nối chuỗi `source_id` để dựng biểu đồ tải giảng dạy của một GV qua 5 năm.

### 3.2 Đánh dấu lịch bận cố định

Đây là chi tiết nhỏ nhưng tạo khác biệt lớn về chất lượng dữ liệu mang sang:

```sql
ALTER TABLE availability_slots
  ADD COLUMN is_recurring boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN availability_slots.is_recurring IS
  'true = ràng buộc lâu dài (nghỉ Thứ Bảy, đi học cao học Thứ Năm) → mang sang năm sau.
   false = tình huống nhất thời của riêng năm học này → không mang sang.';
```

Khi người dùng đặt một ô bận, giao diện hỏi một lần: *"Áp dụng lâu dài hay chỉ năm học này?"*. Nhờ vậy năm sau ta mang sang đúng những gì nên mang, thay vì bê nguyên cả những ràng buộc đã hết hiệu lực.

### 3.3 Bảng theo dõi tiến trình chuyển tiếp

```sql
CREATE TYPE rollover_status AS ENUM ('draft','applying','completed','rolled_back','failed');
CREATE TYPE rollover_action AS ENUM ('copy','promote','create','skip','remap','graduate');

CREATE TABLE rollover_jobs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    source_year_id  uuid NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
    target_year_id  uuid REFERENCES school_years(id) ON DELETE SET NULL,
    status          rollover_status NOT NULL DEFAULT 'draft',
    -- Lựa chọn người dùng đã chốt ở từng bước của trình hướng dẫn
    options         jsonb NOT NULL DEFAULT '{}'::jsonb,
    stats           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {teachers: 88, classes: 45, ...}
    warnings        jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Thời hạn được phép hoàn tác
    undo_expires_at timestamptz,
    created_by      uuid REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    applied_at      timestamptz
);

-- Bảng quyết định cho từng đối tượng — đây là thứ người dùng duyệt trong wizard
CREATE TABLE rollover_mappings (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          uuid NOT NULL REFERENCES rollover_jobs(id) ON DELETE CASCADE,
    entity_type     text NOT NULL,          -- class | teacher | subject | assignment | room
    source_id       uuid,                   -- NULL khi action = 'create'
    target_id       uuid,                   -- điền sau khi áp dụng
    action          rollover_action NOT NULL,
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- tên mới, GV mới...
    is_auto         boolean NOT NULL DEFAULT true,       -- false = người dùng đã sửa tay
    note            text,
    UNIQUE (job_id, entity_type, source_id)
);
CREATE INDEX ON rollover_mappings (job_id, entity_type);
```

**Nguyên tắc:** `rollover_mappings` được sinh tự động ngay khi mở trình hướng dẫn, người dùng chỉ **sửa** những dòng cần sửa. Không bắt họ tạo từ con số không. Cột `is_auto` cho phép hiển thị rõ dòng nào máy đoán và dòng nào người đã xác nhận.

---

## 4. Ánh xạ lớp — phần logic khó nhất

### 4.1 Ba nhóm lớp

Khi chuyển từ năm `Y` sang `Y+1`, mọi lớp rơi vào một trong ba nhóm:

```
Khối 12  →  RA TRƯỜNG        (không tạo bản ghi mới)
Khối 11  →  thăng thành 12
Khối 10  →  thăng thành 11
   ∅     →  TUYỂN MỚI khối 10  (tạo mới, chưa có source_id)
```

Với THCS là khối 6→7→8→9, tiểu học là 1→2→3→4→5. Xác định khối đầu/cuối cấp bằng `grades.ordinal` nhỏ nhất và lớn nhất, không đoán theo tên.

### 4.2 Suy luận tên lớp mới

```ts
function promoteClassName(name: string, fromOrdinal: number, toOrdinal: number): string | null {
  // '10A1' → tiền tố số + phần còn lại
  const m = name.match(/^(\d+)\s*(.*)$/);
  if (m && Number(m[1]) === fromOrdinal) {
    return `${toOrdinal}${m[2]}`;          // '10A1' → '11A1'
  }
  // 'A1', '10/1', 'Lá 1' — không suy được, để người dùng quyết định
  return null;
}
```

Trường hợp suy được, điền sẵn và đánh dấu `is_auto = true`. Trường hợp không suy được (tên lớp kiểu `10/1`, `Chuyên Toán 1`, hoặc trường mầm non), để trống và **bắt buộc** người dùng điền.

### 4.3 Vì sao không được tự động hoá hoàn toàn

Nhiều trường THPT **xáo trộn lớp sau lớp 10** để phân ban theo tổ hợp môn tự chọn (Chương trình GDPT 2018). Lúc đó `10A1` không trở thành `11A1` — học sinh của nó tản ra khắp `11A1`, `11A5`, `11B2`.

Vì lý do này, trình hướng dẫn hiển thị một câu hỏi ở đầu bước ánh xạ lớp:

```
Năm học tới, trường có xáo trộn lại lớp không?

○ Không — giữ nguyên sĩ số lớp, chỉ đổi tên khối
  (10A1 → 11A1, 10A2 → 11A2, …)

○ Có, một phần — chỉ một số khối bị xáo trộn
  Khối bị xáo trộn: [ ☐ 10  ☐ 11 ]

○ Có, toàn bộ — tôi sẽ tự đặt tên và số lượng lớp mỗi khối
```

Với lựa chọn 3, hệ thống **không** cố ánh xạ. Nó chỉ hỏi số lớp mỗi khối rồi tạo mới, và bước phân công giảng dạy sau đó sẽ chuyển sang chế độ "theo khối" (mục 6.2) thay vì "theo lớp".

Đây là kiểu quyết định mà phần mềm không nên đoán thay người dùng. Đoán sai ở bước này khiến toàn bộ phân công giảng dạy sai theo, và họ sẽ mất nhiều thời gian sửa hơn là nhập lại từ đầu.

### 4.4 Bảng ánh xạ trong giao diện

```
┌─ Bước 4/6 · Lớp học ───────────────────────────────────────────────┐
│                                                                     │
│  Khối 12 (14 lớp)                                    ✓ Ra trường    │
│  ────────────────────────────────────────────────────────────────   │
│  Không tạo lớp mới. Phân công của 14 lớp này sẽ không mang sang.    │
│                                                                     │
│  Khối 11 → Khối 12  (15 lớp)                        [Sửa tất cả ▾] │
│  ────────────────────────────────────────────────────────────────   │
│   11A1  →  [12A1    ]  GVCN [T. Nguyễn Văn Hùng ▾]  Sĩ số [42 ]    │
│   11A2  →  [12A2    ]  GVCN [C. Trần Thị Mai   ▾]  Sĩ số [40 ]    │
│   11A3  →  [12A3    ]  GVCN [⚠ T. Lê Sơn (đã nghỉ)▾] Sĩ số [41 ]  │
│   …                                                                 │
│                                                                     │
│  Khối 10 → Khối 11  (16 lớp)                                       │
│  ────────────────────────────────────────────────────────────────   │
│   ⚠ Khối này được đánh dấu xáo trộn. Sẽ tạo lớp mới, không ánh xạ. │
│   Số lớp khối 11 năm tới: [ 16 ]   Đặt tên: [11A1 … 11A16    ]     │
│                                                                     │
│  Khối 10 mới (tuyển sinh)                                          │
│  ────────────────────────────────────────────────────────────────   │
│   Số lớp: [ 16 ]  Đặt tên theo mẫu: [10A#     ]  → 10A1 … 10A16    │
│   Sĩ số dự kiến: [ 42 ]  (sửa lại được sau)                        │
│                                                                     │
│                                    [← Quay lại]  [Tiếp tục →]      │
└─────────────────────────────────────────────────────────────────────┘
```

Dòng có cảnh báo `⚠` (giáo viên chủ nhiệm đã được đánh dấu nghỉ ở bước 3) không chặn việc đi tiếp, nhưng được gom lại ở bước tổng kết.

---

## 5. Xử lý giáo viên

### 5.1 Ba hành động

| Hành động | Ý nghĩa | Xử lý |
|---|---|---|
| **Giữ lại** | Tiếp tục dạy năm sau | Sao chép bản ghi + `teacher_subjects` + lịch bận cố định |
| **Đánh dấu nghỉ** | Nghỉ hưu, chuyển trường, nghỉ thai sản cả năm | Không tạo bản ghi năm mới. Bản ghi năm cũ giữ nguyên để tra cứu lịch sử. |
| **Thêm mới** | GV mới về trường | Tạo bản ghi trống, `source_id = NULL` |

Không có hành động "xoá". Dữ liệu năm cũ là bất biến — báo cáo và thanh tra có thể cần tra lại.

### 5.2 Giao diện bước giáo viên

```
┌─ Bước 3/6 · Giáo viên ─────────────────────────────────────────────┐
│  Tổ: [Tất cả ▾]   🔍 [Tìm tên...        ]     88/92 sẽ mang sang   │
│  ────────────────────────────────────────────────────────────────  │
│  ☑  T. Nguyễn Văn Hùng    Toán           19 tiết/tuần   Tổ Tự nhiên│
│  ☑  C. Trần Thị Mai       Ngữ văn        17 tiết/tuần   Tổ Xã hội  │
│  ☐  T. Lê Văn Sơn         Vật lí         Nghỉ hưu 6/2026  ← bỏ tick│
│  ☑  C. Phạm Thu Hà        Tiếng Anh      18 tiết/tuần   Tổ Ngoại ngữ│
│  …                                                                  │
│  ────────────────────────────────────────────────────────────────  │
│  ☑ Mang theo môn dạy được của từng giáo viên          (92 liên kết)│
│  ☑ Mang theo lịch bận cố định                     (34 GV · 218 ô)  │
│    ☐ Mang theo cả lịch bận tạm thời của năm nay        (61 ô)      │
│  ☑ Mang theo định mức tiết/tuần và tiết/ngày                       │
│                                                                     │
│  [+ Thêm giáo viên mới]                                            │
│                                    [← Quay lại]  [Tiếp tục →]      │
└─────────────────────────────────────────────────────────────────────┘
```

Ô "lịch bận tạm thời" **mặc định tắt** — đây chính là công dụng của cột `is_recurring`. Bê nguyên lịch bận cũ sang là cách nhanh nhất làm cho solver năm sau thất bại vì những ràng buộc đã hết hiệu lực từ lâu.

---

## 6. Phân công giảng dạy — bước có giá trị cao nhất

Đây là bước tốn thời gian nhất khi nhập tay (vài trăm dòng), nên cũng là bước mang lại giá trị lớn nhất khi tự động hoá tốt. Nhưng cũng là bước dễ sai nhất.

### 6.1 Không sao chép phân công, mà sao chép *quan hệ*

Sai lầm dễ mắc: `INSERT INTO assignments SELECT ... FROM assignments WHERE school_year_id = old`. Cách này hỏng vì `periods_per_week` khác nhau theo khối — Toán khối 10 có thể 4 tiết/tuần còn khối 11 là 3 tiết/tuần.

Cách đúng: mang sang **quan hệ giáo viên–lớp–môn**, rồi lấy lại số tiết từ `subject_grade_configs` của năm mới:

```sql
INSERT INTO assignments (school_id, school_year_id, subject_id, periods_per_week,
                         session, double_periods, source_id)
SELECT
    :school_id,
    :new_year,
    sm.new_subject_id,
    COALESCE(sgc.periods_per_week, a.periods_per_week),   -- ưu tiên cấu hình năm mới
    a.session,
    a.double_periods,
    a.id
FROM assignments a
JOIN assignment_classes ac ON ac.assignment_id = a.id
JOIN rollover_mappings  cm ON cm.source_id = ac.class_id
                          AND cm.entity_type = 'class'
                          AND cm.action = 'promote'
JOIN subject_map sm ON sm.old_subject_id = a.subject_id
JOIN classes nc ON nc.id = cm.target_id
LEFT JOIN subject_grade_configs sgc
       ON sgc.subject_id = sm.new_subject_id AND sgc.grade_id = nc.grade_id
WHERE a.school_year_id = :old_year;
```

### 6.2 Hai chế độ mang sang — người dùng phải chọn

Đây là điểm mà mọi trường sẽ có ý kiến, và không có đáp án đúng chung:

**Chế độ A — Giáo viên theo lớp lên**

> Thầy Hùng dạy Toán 10A1 → năm sau dạy Toán 11A1.

Phổ biến khi trường muốn giáo viên theo sát học sinh suốt cấp. Áp dụng được khi ánh xạ lớp là 1–1 (không xáo trộn).

**Chế độ B — Giáo viên giữ khối**

> Thầy Hùng dạy Toán khối 10 → năm sau vẫn dạy Toán khối 10 (lứa học sinh mới).

Phổ biến khi giáo viên chuyên sâu một khối, đặc biệt khối 12 (ôn thi tốt nghiệp) và khối đầu cấp. Áp dụng được cả khi lớp bị xáo trộn.

Nhiều trường dùng **cả hai**: khối 12 theo chế độ B (giữ đội ngũ ôn thi), các khối khác theo chế độ A. Vì vậy trình hướng dẫn cho chọn **mặc định toàn trường + ghi đè theo tổ bộ môn**:

```
Cách phân công năm học mới

Mặc định:  ● Giáo viên theo lớp lên      ○ Giáo viên giữ khối

Ghi đè theo tổ:
   Tổ Tự nhiên     [Theo mặc định ▾]
   Tổ Xã hội       [Theo mặc định ▾]
   Tổ Ngoại ngữ    [Giữ khối       ▾]   ← GV Tiếng Anh chuyên khối 10
   Tổ Thể dục      [Giữ khối       ▾]
```

### 6.3 Xem trước kèm cảnh báo

Không áp dụng ngay. Hiện bảng phân công dự kiến kèm bốn loại cảnh báo:

| Cảnh báo | Ví dụ | Hành động đề xuất |
|---|---|---|
| **Giáo viên đã nghỉ** | 12 phân công trỏ tới thầy Lê Sơn (đã đánh dấu nghỉ) | Gán lại — hiện danh sách GV cùng môn, sắp theo tải tăng dần |
| **Vượt định mức** | Cô Mai: 23 tiết/tuần, định mức 19 | Bỏ bớt hoặc tăng định mức |
| **Lớp thiếu môn** | Lớp 10A1 mới chưa có phân công môn nào | Sao chép từ lớp 10A2, hoặc nhập tay |
| **Môn không còn** | Môn "Giáo dục công dân" khối 10 đã đổi thành "Giáo dục kinh tế và pháp luật" | Ánh xạ môn thủ công |

Cảnh báo loại 1 và 3 chiếm phần lớn thực tế. Với loại 1, giao diện phải cho **gán lại hàng loạt**:

```
⚠ 12 phân công của thầy Lê Văn Sơn (đã nghỉ) cần người thay

  Gán tất cả cho:  [T. Nguyễn Đức Bình (Vật lí, 11/19 tiết) ▾]  [Áp dụng]
  Hoặc gán từng lớp:                                    [Mở bảng chi tiết]
```

---

## 7. Trình tự và tính nguyên tử

### 7.1 Thứ tự sao chép

Bắt buộc theo thứ tự phụ thuộc khoá ngoại:

```
1. school_years  → semesters → periods
2. grades, departments, rooms
3. subjects → subject_grade_configs → room_subjects
4. teachers → teacher_subjects
5. departments.head_teacher_id   (cập nhật sau, vì phụ thuộc teachers)
6. classes → class_sections
7. classes.homeroom_teacher_id, classes.home_room_id   (cập nhật sau)
8. availability_slots (chỉ is_recurring = true), constraints
9. assignments → assignment_classes → assignment_teachers
```

Bước 5 và 7 tách riêng vì có tham chiếu vòng: `departments` cần `teachers`, mà `teachers` lại tham chiếu `departments`. Chèn với giá trị NULL trước, cập nhật sau.

### 7.2 Toàn bộ trong một transaction

```sql
BEGIN;
  SET LOCAL app.current_school_id = :school_id;

  INSERT INTO school_years (...) RETURNING id INTO new_year_id;
  -- ... 9 bước ở trên ...

  UPDATE rollover_jobs
     SET status = 'completed',
         target_year_id = new_year_id,
         applied_at = now(),
         undo_expires_at = now() + interval '14 days',
         stats = :stats
   WHERE id = :job_id;
COMMIT;
```

Với trường 45 lớp, toàn bộ khoảng 3.000 dòng chèn — dưới 2 giây. Không cần chạy nền, không cần hàng đợi. Hiện thanh tiến trình đơn giản là đủ.

**Năm học mới được tạo với `is_active = false`.** Người dùng phải chủ động chuyển sang năm mới. Điều này tránh tình huống họ đang xem dở dữ liệu năm cũ thì màn hình đột ngột đổi ngữ cảnh.

### 7.3 Hoàn tác

Vì mọi thứ gắn với `school_year_id` và các khoá ngoại đều `ON DELETE CASCADE`, hoàn tác chỉ là xoá năm học:

```sql
DELETE FROM school_years WHERE id = :target_year_id;
UPDATE rollover_jobs SET status = 'rolled_back' WHERE id = :job_id;
```

Điều kiện cho phép hoàn tác — kiểm tra trước khi hiện nút:

- Trong vòng 14 ngày kể từ khi áp dụng (`undo_expires_at`)
- Chưa có thời khoá biểu nào ở trạng thái `published`
- Người thực hiện có vai trò `owner` hoặc `admin`

Sau 14 ngày, nút đổi thành "Xoá năm học" với hộp thoại xác nhận bằng cách gõ tên năm học — thao tác phá huỷ thì nên khó thực hiện.

---

## 8. Tuỳ chọn nâng cao: dùng TKB năm trước làm khung

Nhiều trường có thời khoá biểu năm trước đã ổn định và muốn năm mới giống vậy. Đây là tuỳ chọn ẩn dưới mục "Nâng cao", **mặc định tắt**.

Cách hoạt động: sau khi phân công xong, tạo một `timetable` mới và đặt các tiết theo đúng vị trí năm trước, ánh xạ qua `source_id`:

```
Tiết Toán của 10A1 ở Thứ Ba tiết 2 (năm 2025-2026)
  → Tiết Toán của 11A1 ở Thứ Ba tiết 2 (năm 2026-2027)
```

Chỉ đặt được khi cả bốn điều kiện đúng: lớp ánh xạ 1–1, môn ánh xạ được, giáo viên còn tại trường, và ô đó không xung đột. Tiết nào không thoả thì để lại trong kho chưa xếp.

Kết quả điển hình: đặt được 60–75% số tiết. Người dùng bấm "Xếp tự động" để lấp phần còn lại — solver sẽ tôn trọng phần đã đặt nếu họ ghim chúng lại.

**Cảnh báo cần hiện rõ:** khung năm cũ chỉ tốt khi cơ cấu ít thay đổi. Nếu số lớp hoặc số giáo viên đổi trên 20%, khung cũ sẽ tạo ra nhiều xung đột hơn là tiết kiệm. Hệ thống tự tính tỉ lệ này và hiện cảnh báo tương ứng.

---

## 9. Chuyển học kỳ — phiên bản rút gọn

Một số trường có phân công khác nhau giữa hai học kỳ (môn học theo kỳ, giáo viên luân phiên). Đây là bài toán nhỏ hơn nhiều vì cùng năm học, mọi danh mục dùng chung.

Chức năng duy nhất cần: **Sao chép phân công HK I sang HK II**.

```
┌─ Chuẩn bị học kỳ II ───────────────────────────────────┐
│  Học kỳ II bắt đầu từ [__/01/2027]                     │
│                                                         │
│  ● Dùng chung phân công cả năm    ← đa số trường        │
│    Không cần làm gì thêm.                               │
│                                                         │
│  ○ Sao chép phân công HK I sang HK II rồi chỉnh sửa     │
│    Tạo 487 phân công mới cho HK II.                     │
│                                                         │
│  ○ Nhập phân công HK II từ đầu                          │
└─────────────────────────────────────────────────────────┘
```

Lựa chọn đầu là mặc định vì `assignments.semester_id` cho phép NULL — nghĩa là "áp dụng cả năm". Đa số trường phổ thông dùng chung phân công cả năm và chỉ đổi thời khoá biểu, nên đừng bắt họ làm thêm việc.

---

## 10. Trường hợp biên

| Tình huống | Xử lý |
|---|---|
| **Chương trình thay đổi** — môn đổi tên, tách, gộp | Bước 2 có mục "Ánh xạ môn học" hiện danh sách môn năm cũ; môn nào không tìm thấy tương ứng thì để người dùng chọn: giữ nguyên / đổi tên / bỏ |
| **Trường mở thêm khối** (THCS thêm cấp 3) | Khối mới không có nguồn, tạo trống. Trình hướng dẫn có nút "Thêm khối" ở bước 4. |
| **Số lớp khối đầu cấp thay đổi** | Nhập trực tiếp số lớp, mẫu tên có ký tự `#` để sinh hàng loạt |
| **Gộp lớp** (2 lớp cũ → 1 lớp mới do giảm sĩ số) | Ánh xạ nhiều-về-một. Phân công của cả hai lớp cũ dồn về lớp mới → sinh cảnh báo trùng môn, người dùng chọn giữ GV nào. |
| **Tách lớp** (1 lớp cũ → 2 lớp mới) | Ánh xạ một-về-nhiều. Phân công nhân đôi, cảnh báo GV vượt định mức. |
| **Chạy chuyển tiếp hai lần** | Kiểm tra `rollover_jobs` đã có job `completed` với cùng cặp năm → cảnh báo và hỏi có muốn hoàn tác job cũ trước không |
| **Chuyển tiếp giữa năm** (trường muốn tạo bản sao để thử nghiệm) | Cho phép, nhưng năm đích phải là năm học mới hoàn toàn. Không cho ghi đè năm đang hoạt động. |
| **Trường mới, chưa có năm nào** | Không hiện tính năng này. Thay bằng trình nhập liệu ban đầu + mẫu Excel. |

---

## 11. Bảng điều khiển nhắc việc

Tính năng chỉ hữu ích nếu người dùng biết nó tồn tại đúng lúc cần. Từ ngày **1 tháng 6** hằng năm (sau khi năm học kết thúc), hiện thẻ nổi bật trên trang Tổng quan:

```
┌────────────────────────────────────────────────────────┐
│  📅  Chuẩn bị năm học 2026–2027                        │
│                                                        │
│  Mang toàn bộ giáo viên, môn học, phòng và lịch bận    │
│  từ năm 2025–2026 sang. Mất khoảng 10 phút.            │
│                                                        │
│  Bạn sẽ rà soát lại danh sách lớp và phân công         │
│  giảng dạy trước khi áp dụng.                          │
│                                                        │
│                          [Bắt đầu chuẩn bị]  [Để sau]  │
└────────────────────────────────────────────────────────┘
```

Ba chi tiết trong nội dung này đều có chủ đích: nêu rõ **thời gian ước tính** (giảm ngại), nêu rõ **sẽ được rà soát trước khi áp dụng** (giảm sợ mất dữ liệu), và có nút **Để sau** (không ép buộc). Nút "Để sau" ẩn thẻ 14 ngày rồi hiện lại.

Gửi kèm email và tin nhắn Zalo cho tài khoản `owner` vào ngày 1/6 và 1/8.

---

## 12. Kiểm thử

Bộ kiểm thử tự động cần phủ:

```ts
describe('Chuyển tiếp năm học', () => {
  it('sao chép đủ khung tiết, phòng, môn với source_id đúng');
  it('khối cuối cấp không sinh lớp mới');
  it('khối đầu cấp sinh đúng số lớp theo mẫu tên');
  it('lấy periods_per_week từ cấu hình năm mới, không phải năm cũ');
  it('bỏ qua availability_slots có is_recurring = false');
  it('không sao chép phân công của giáo viên đã đánh dấu nghỉ');
  it('sinh cảnh báo khi giáo viên vượt định mức sau khi mang sang');
  it('không sao chép lessons, substitutions, publications');
  it('hoàn tác xoá sạch năm mới, không đụng năm cũ');       // ★
  it('chặn hoàn tác khi đã có thời khoá biểu published');
  it('chế độ giữ khối gán đúng GV cho lứa lớp mới');
  it('gộp lớp nhiều-về-một sinh cảnh báo trùng môn');
  it('toàn bộ thất bại thì không để lại dữ liệu rác');       // ★
});
```

Hai ca đánh dấu `★` là quan trọng nhất. Ca cuối kiểm tra tính nguyên tử của transaction — nếu bước 9 lỗi mà 8 bước trước đã ghi, người dùng sẽ có một năm học nửa vời không sửa được và cũng không xoá được.

---

## 13. Ước lượng công sức

| Hạng mục | Thời gian |
|---|---|
| Migration CSDL + cột `source_id` + bảng `rollover_*` | 1 ngày |
| Logic sao chép danh mục (bước 1–8) | 2 ngày |
| Logic ánh xạ lớp + suy luận tên | 2 ngày |
| Logic phân công (hai chế độ) + phát hiện cảnh báo | 3 ngày |
| Trình hướng dẫn 6 bước (giao diện) | 4 ngày |
| Hoàn tác + kiểm tra điều kiện | 1 ngày |
| Tuỳ chọn dùng TKB năm trước làm khung | 2 ngày |
| Chuyển học kỳ | 1 ngày |
| Thẻ nhắc việc + email/Zalo | 1 ngày |
| Kiểm thử | 2 ngày |

Tổng: khoảng **3,5 tuần**.

**Nếu cần cắt giảm để kịp mùa tháng 8:** bỏ tuỳ chọn dùng TKB năm trước làm khung (2 ngày) và chế độ "giữ khối" (1 ngày) — chỉ làm chế độ "theo lớp lên" là đủ dùng cho đa số trường. Rút còn 2,5 tuần. Nhưng đừng cắt phần **xem trước kèm cảnh báo** ở mục 6.3: sao chép mù không có bước duyệt sẽ tạo ra dữ liệu sai mà người dùng chỉ phát hiện khi solver thất bại, và lúc đó họ không biết vì sao.
