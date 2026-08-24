# TKB SaaS — Nhập dữ liệu từ Excel

> Đi kèm: `tkb_schema.sql`, `tkb_api_spec.md`, `tkb_design_spec.md`.

---

## 1. Vì sao đây là cửa ngõ sống-chết

Đường đi của một trường mới:

```
Đăng ký  →  Nhập 92 giáo viên, 45 lớp, 15 môn, 500 dòng phân công  →  Xếp TKB  →  Thấy giá trị
            └────────────── nút thắt ở đây ──────────────┘
```

Nhập tay toàn bộ mất **4–8 giờ**. Không ai bỏ ra 8 giờ để thử một phần mềm chưa chắc dùng được. Họ sẽ nhập vài dòng, thấy còn xa mới xong, rồi đóng tab.

Mục tiêu của thiết kế này: **đưa từ 8 giờ xuống 45 phút**. Không phải bằng cách nhập nhanh hơn, mà bằng cách để họ dùng lại thứ đã có — vì mọi trường đều đã có sẵn danh sách giáo viên và bảng phân công trong Excel.

Ba nguyên tắc rút ra từ đó:

1. **Không bắt sửa file cho khớp mẫu.** Phần mềm phải đọc được file của họ, không phải ngược lại.
2. **Kiểm tra ngay lập tức, không cần tải lên.** Phân tích ở trình duyệt, hiện lỗi trong 2 giây.
3. **Không bao giờ ghi dữ liệu sai.** Có lỗi thì cho sửa tại chỗ hoặc bỏ dòng, nhưng không ghi bừa rồi bảo họ tự dọn.

---

## 2. File mẫu

### 2.1 Một workbook, sáu sheet

Tải tại `GET /templates/import.xlsx?level=high&year=2026-2027`. Sinh động theo cấp học — mẫu THPT khác THCS ở danh sách môn và khối.

| Sheet | Nội dung | Bắt buộc |
|---|---|---|
| `Hướng dẫn` | Cách dùng, ý nghĩa từng cột, ví dụ | — |
| `Giáo viên` | Danh sách GV | ✓ |
| `Lớp` | Danh sách lớp | ✓ |
| `Môn học` | Môn + số tiết chuẩn theo khối | ✓ |
| `Phòng học` | Phòng thường và phòng bộ môn | tuỳ chọn |
| `Phân công` | Ai dạy môn gì lớp nào | ✓ |

Sheet `Hướng dẫn` đặt đầu tiên và có 2–3 dòng mỗi sheet, không phải một trang chữ. Người dùng không đọc hướng dẫn dài.

### 2.2 Sheet `Giáo viên`

| Mã GV | Họ và tên | Giới tính | Tổ bộ môn | Môn dạy | Số tiết tối đa/tuần | Email | Điện thoại |
|---|---|---|---|---|---|---|---|
| GV001 | Nguyễn Văn Hùng | Nam | Tổ Toán - Tin | Toán | 19 | hung.nv@... | 0912... |
| GV002 | Trần Thị Mai | Nữ | Tổ Ngữ văn | Ngữ văn, GDCD | 19 | | |

- **Mã GV** để trống được — hệ thống tự sinh `GV001`, `GV002`. Nhưng khuyến khích điền, vì nó là khoá để nhập lại lần sau mà không tạo trùng.
- **Môn dạy** ngăn cách bằng dấu phẩy. Đây là cột hay bị bỏ qua nhất nhưng lại cần cho việc lọc giáo viên khi phân công.

### 2.3 Sheet `Lớp`

| Tên lớp | Khối | Sĩ số | GVCN | Phòng cố định | Buổi học |
|---|---|---|---|---|---|
| 10A1 | 10 | 42 | Nguyễn Văn Hùng | A201 | Sáng |
| 10A2 | 10 | 41 | GV002 | A202 | Sáng |

Cột **GVCN** nhận cả họ tên lẫn mã giáo viên — người dùng gõ kiểu nào cũng được. **Khối** để trống thì suy từ tên lớp (`10A1` → khối 10).

### 2.4 Sheet `Môn học`

| Mã môn | Tên môn | Tên viết tắt | Tổ bộ môn | Cần phòng bộ môn | Khối 10 | Khối 11 | Khối 12 |
|---|---|---|---|---|---|---|---|
| TOAN | Toán | Toán | Tổ Toán - Tin | Không | 4 | 4 | 4 |
| TIN | Tin học | Tin | Tổ Toán - Tin | Có | 2 | 2 | 1 |

Các cột khối là **động** — sinh theo cấp học của trường. Đây là cách gọn nhất để nhập `subject_grade_configs` mà không cần một sheet riêng.

### 2.5 Sheet `Phân công` — quan trọng nhất

Hai định dạng, hệ thống tự nhận biết:

**Dạng dọc** (mỗi dòng một phân công) — dễ máy đọc:

| Lớp | Môn | Giáo viên | Số tiết/tuần | Ghi chú |
|---|---|---|---|---|
| 10A1 | Toán | Nguyễn Văn Hùng | 4 | |
| 10A1 | Ngữ văn | Trần Thị Mai | 4 | |
| 10A1, 10A2 | Thể dục | Lê Văn Sơn | 2 | Ghép lớp |

**Dạng ma trận** (lớp × môn) — đúng cái các trường đang dùng:

| Lớp \ Môn | Toán | Ngữ văn | Tiếng Anh | Vật lí |
|---|---|---|---|---|
| 10A1 | Nguyễn Văn Hùng | Trần Thị Mai | Phạm Thu Hà | Lê Văn Sơn |
| 10A2 | Nguyễn Văn Hùng | Trần Thị Mai | | Lê Văn Sơn |

Dạng ma trận không có cột số tiết — hệ thống lấy từ sheet `Môn học`. **Đây là định dạng phải hỗ trợ tốt nhất**, vì gần như mọi trường đã có sẵn bảng này.

Nhận biết định dạng: nếu dòng tiêu đề chứa từ khoá `lớp` ở ô đầu và các ô còn lại khớp tên môn → ma trận. Ngược lại → dọc.

### 2.6 Ràng buộc dữ liệu trong file mẫu

Nhúng sẵn `dataValidation` để giảm lỗi từ gốc:

- Cột Giới tính: danh sách thả xuống `Nam / Nữ`
- Cột Khối: danh sách theo cấp học
- Cột Cần phòng bộ môn: `Có / Không`
- Cột Số tiết: số nguyên 0–20
- Dòng tiêu đề: đóng băng, tô nền `#DCE8FB`, khoá không cho sửa

Sheet ẩn `_danhmuc` chứa danh sách giá trị hợp lệ. Không khoá toàn bộ sheet — người dùng cần chèn dòng, thêm cột phụ, ghi chú bên lề.

---

## 3. Đọc file thực tế của trường

Người dùng sẽ tải lên file của chính họ, không phải file mẫu. Phần này quyết định trải nghiệm.

### 3.1 Tìm dòng tiêu đề

File thật thường có 3–8 dòng đầu là quốc hiệu, tên trường, tên bảng, dòng trống. Không giả định tiêu đề ở dòng 1.

```ts
function findHeaderRow(rows: string[][]): number {
  let best = -1, bestScore = 0;
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const score = rows[r].filter(c => matchColumn(c) !== null).length;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore >= 2 ? best : -1;
}
```

Quét 15 dòng đầu, chọn dòng khớp nhiều tên cột nhất. Nếu không dòng nào khớp từ 2 cột trở lên → hỏi người dùng chỉ định dòng tiêu đề.

### 3.2 Ánh xạ cột — khớp mờ

Không so khớp chính xác. Chuẩn hoá rồi đối chiếu từ đồng nghĩa:

```ts
const normalize = (s: string) =>
  s.toLowerCase()
   .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // bỏ dấu tiếng Việt
   .replace(/đ/g, 'd')
   .replace(/[^a-z0-9]/g, '');                          // bỏ dấu cách, gạch, ngoặc
```

| Trường đích | Từ khớp (sau chuẩn hoá) |
|---|---|
| `full_name` | `hovaten`, `hoten`, `tengiaovien`, `giaovien`, `ten`, `hoten gv` |
| `code` | `magv`, `ma`, `magiaovien`, `sott`, `stt` |
| `department` | `tobomon`, `to`, `tochuyenmon`, `bomon` |
| `subjects` | `mondayduoc`, `monday`, `monhoc`, `chuyenmon` |
| `max_periods` | `sotiettoida`, `dinhmuc`, `sotiet`, `sotiettuan` |
| `class_name` | `lop`, `tenlop`, `lophoc` |
| `grade` | `khoi`, `khoilop` |
| `size` | `siso`, `sohocsinh`, `sisohs` |
| `homeroom` | `gvcn`, `chunhiem`, `giaovienchunhiem` |
| `room` | `phong`, `phonghoc`, `tenphong`, `maphong` |
| `periods_per_week` | `sotiettuan`, `tiettuan`, `sotiet`, `tiet` |

Cột không nhận diện được → hiện ở màn hình xem trước để người dùng gán tay bằng danh sách thả xuống. **Luôn cho phép gán tay** — danh sách từ đồng nghĩa không bao giờ đủ.

### 3.3 Chuẩn hoá giá trị

Đây là nơi xử lý sự bừa bộn của dữ liệu thật:

| Vấn đề | Đầu vào | Chuẩn hoá thành |
|---|---|---|
| Chức danh dính vào tên | `Thầy Nguyễn Văn Hùng`, `Cô Mai`, `T. Hùng`, `GV. Sơn` | `Nguyễn Văn Hùng` |
| Dấu cách thừa | `10 A1`, `10  A 1`, `10A1 ` | `10A1` |
| Đơn vị trong ô số | `4 tiết`, `4t`, `4 tiết/tuần` | `4` |
| Số dạng chuỗi | `"4"`, `4.0` | `4` |
| Ô gộp | Ô gộp 3 dòng cho cột Tổ | Điền xuống cả 3 dòng |
| Xuống dòng trong ô | `Toán\nTin` | `Toán, Tin` |
| Giới tính | `nam`, `Nam`, `M`, `1` | `Nam` |
| Có/Không | `x`, `X`, `có`, `1`, `TRUE`, `✓` | `true` |
| Điện thoại | `912345678`, `+84912345678`, `0912.345.678` | `0912345678` |
| Dòng tổng cộng | Dòng có ô đầu là `Tổng`, `Cộng`, `TỔNG CỘNG` | Bỏ qua |
| Dòng trống | Toàn ô rỗng | Bỏ qua, không tính là lỗi |

Quy tắc bỏ chức danh cần cẩn thận: `Thầy` và `Cô` là tiền tố phổ biến nhưng cũng có thể là họ (`Cô Thị Lan` — hiếm nhưng có). Chỉ bỏ khi theo sau còn **ít nhất hai từ**, và ghi nhận vào cột giới tính nếu cột đó trống.

### 3.4 So khớp tên người

Cột GVCN và cột Giáo viên trong sheet Phân công trỏ tới sheet Giáo viên bằng tên. Tên viết không nhất quán là chuyện thường:

```ts
function matchTeacher(input: string, teachers: Teacher[]): Match {
  const key = normalize(stripTitle(input));
  // 1. Khớp chính xác mã
  // 2. Khớp chính xác tên đã chuẩn hoá
  // 3. Khớp tên riêng + họ (bỏ tên đệm): "Nguyễn Hùng" ↔ "Nguyễn Văn Hùng"
  // 4. Khoảng cách Levenshtein ≤ 2 → gợi ý, KHÔNG tự động chấp nhận
  // 5. Không khớp → lỗi
}
```

Bước 4 chỉ **gợi ý**: *"Không tìm thấy 'Nguyễn Văn Hùn'. Ý bạn là 'Nguyễn Văn Hùng'?"* kèm nút Chấp nhận. Tự động sửa tên người là rủi ro — hai giáo viên có thể tên gần giống nhau thật.

**Trường hợp trùng tên hoàn toàn:** trường có hai `Nguyễn Văn Hùng` là chuyện bình thường. Lúc đó bắt buộc phải phân biệt bằng mã GV, và báo lỗi rõ: *"Có 2 giáo viên tên 'Nguyễn Văn Hùng' (GV001 tổ Toán, GV045 tổ Thể dục). Hãy dùng mã giáo viên ở cột này."*

---

## 4. Luật kiểm tra

Ba mức độ. Chỉ mức `error` mới chặn dòng.

### 4.1 Sheet `Giáo viên`

| Luật | Mức | Thông báo |
|---|---|---|
| Họ tên không rỗng | error | `Dòng 12: thiếu họ tên giáo viên` |
| Mã GV không trùng trong file | error | `Dòng 12 và 34: trùng mã GV001` |
| Mã GV không trùng với dữ liệu đã có (chế độ tạo mới) | error | `Mã GV001 đã tồn tại trong hệ thống` |
| Tổ bộ môn tồn tại hoặc sẽ được tạo | warning | `Dòng 12: tổ "Tổ Lý - Hoá" chưa có, sẽ được tạo mới` |
| Môn dạy khớp sheet Môn học | warning | `Dòng 12: không có môn "Toán cao cấp" trong danh sách môn` |
| Định mức tiết trong khoảng 1–30 | warning | `Dòng 12: định mức 45 tiết/tuần có vẻ bất thường` |
| Email đúng định dạng | warning | |
| Trùng họ tên với dòng khác | info | `Có 2 giáo viên cùng tên "Nguyễn Văn Hùng" — nên đặt mã GV để phân biệt` |

### 4.2 Sheet `Lớp`

| Luật | Mức | Thông báo |
|---|---|---|
| Tên lớp không rỗng, không trùng | error | |
| Khối suy được hoặc điền sẵn | error | `Dòng 8: không xác định được khối của lớp "Chuyên Toán 1"` |
| GVCN tồn tại trong sheet Giáo viên | error | `Dòng 8: không tìm thấy giáo viên "Ng. V. Hùng"` |
| Một GV chủ nhiệm tối đa 1 lớp | warning | `Nguyễn Văn Hùng được đặt chủ nhiệm 2 lớp: 10A1, 10A5` |
| Phòng cố định tồn tại | warning | |
| Sĩ số trong khoảng 10–60 | info | |

### 4.3 Sheet `Phân công` — nhiều luật nhất

| Luật | Mức | Thông báo |
|---|---|---|
| Lớp tồn tại | error | `Dòng 45: không có lớp "10A9"` |
| Môn tồn tại | error | |
| Giáo viên tồn tại | error | |
| Số tiết > 0 | error | |
| Không phân công trùng (cùng lớp + cùng môn 2 lần) | error | `Dòng 45 và 78: lớp 10A1 môn Toán bị phân công hai lần` |
| Giáo viên dạy được môn đó | warning | `Dòng 45: Trần Thị Mai không có "Vật lí" trong danh sách môn dạy được` |
| Số tiết khớp cấu hình chuẩn của khối | warning | `Dòng 45: Toán khối 10 chuẩn là 4 tiết, file ghi 3 tiết` |
| **Tổng tiết của lớp ≤ số ô khung tiết** | error | `Lớp 10A1 được phân công 32 tiết nhưng khung chỉ có 30 ô` |
| **Tổng tiết của GV ≤ định mức** | warning | `Trần Thị Mai: 23 tiết, vượt định mức 19 tiết` |
| **Tổng tiết của GV ≤ số ô rảnh** | error | `Nguyễn Văn Hùng cần 24 tiết nhưng chỉ còn 18 ô rảnh sau khi trừ lịch bận` |
| Lớp thiếu môn so với cấu hình khối | warning | `Lớp 10A3 chưa có phân công môn Địa lí` |

Ba luật in đậm là **kiểm tra khả thi sớm** — cùng logic với mục 4.3 của `tkb_solver_design.md`. Bắt được ở đây thì người dùng sửa ngay lúc còn nhớ dữ liệu, thay vì chạy solver 60 giây rồi mới biết thất bại và không hiểu vì sao.

---

## 5. Luồng kỹ thuật

### 5.1 Phân tích ở trình duyệt, ghi ở server

```
Người dùng chọn file
   ↓
[Trình duyệt] SheetJS đọc file, chuẩn hoá, chạy toàn bộ luật kiểm tra
   ↓  (0,5–2 giây, không có yêu cầu mạng nào)
Màn hình xem trước — sửa tại chỗ, gán cột, chấp nhận gợi ý
   ↓
POST /imports/commit  { rows đã chuẩn hoá, dạng JSON }
   ↓
[Server] Kiểm tra lại toàn bộ, ghi trong một transaction
```

**Vì sao kiểm tra hai lần:** phía trình duyệt để có phản hồi tức thì; phía server vì không bao giờ tin dữ liệu từ client. Chia sẻ code kiểm tra qua một package dùng chung để hai bên không bao giờ lệch nhau:

```
packages/import-core/     — chuẩn hoá + luật kiểm tra, thuần TypeScript
  ├── normalize.ts
  ├── columnMap.ts
  ├── rules/
  └── index.ts
apps/web/    → import từ import-core
apps/api/    → import từ import-core
```

Đây là lập luận mạnh nhất cho monorepo trong dự án này. Nếu tách repo, hai bộ luật sẽ trôi khỏi nhau trong vòng ba tháng.

**Chỉ tải file lên server khi cần hỗ trợ.** File Excel gốc lưu vào object storage kèm `import_jobs.file_url` để đội hỗ trợ tra khi người dùng báo lỗi. Việc kiểm tra không cần file đó.

### 5.2 Chế độ ghi

| Chế độ | Hành vi | Dùng khi |
|---|---|---|
| `create` | Chỉ tạo mới. Trùng mã → lỗi. | Nhập lần đầu |
| `upsert` | Khớp theo `code`; có thì cập nhật, không thì tạo. | Bổ sung, sửa hàng loạt |
| `replace` | Xoá hết dữ liệu cùng loại của năm học rồi ghi mới. | Sửa sai toàn bộ, làm lại từ đầu |

`replace` cần xác nhận bằng cách gõ tên năm học, và tự tạo snapshot trước khi xoá.

### 5.3 Thứ tự ghi và tính nguyên tử

Một transaction, theo đúng thứ tự phụ thuộc:

```sql
BEGIN;
  -- 1. departments (tạo mới nếu chưa có)
  -- 2. grades
  -- 3. subjects → subject_grade_configs
  -- 4. rooms
  -- 5. teachers → teacher_subjects
  -- 6. classes (homeroom_teacher_id cập nhật sau)
  -- 7. UPDATE classes SET homeroom_teacher_id
  -- 8. assignments → assignment_classes → assignment_teachers
COMMIT;
```

Với 500 dòng phân công, dùng `INSERT ... SELECT * FROM unnest($1::uuid[], $2::int[], ...)` thay vì 500 câu lệnh riêng — giảm từ ~8 giây xuống dưới 1 giây.

Hỏng bất kỳ đâu → rollback toàn bộ. Không bao giờ để lại tình trạng "đã nhập giáo viên nhưng chưa nhập phân công" mà người dùng không biết.

---

## 6. Màn hình xem trước

Đây là màn hình quyết định người dùng có tin phần mềm hay không.

```
┌─ Nhập dữ liệu từ Excel · Bước 2/3 ──────────────────────────────────────┐
│                                                                          │
│  📄 Phan cong giang day 2026-2027.xlsx                                  │
│                                                                          │
│  ┌──────────┬──────────┬──────────┬───────────┬──────────┐              │
│  │Giáo viên │   Lớp    │ Môn học  │ Phòng học │ Phân công│              │
│  │  92 ✓    │  45 ✓    │  15 ✓    │  bỏ qua   │ 487 ⚠ 12 │  ← tab      │
│  └──────────┴──────────┴──────────┴───────────┴──────────┘              │
│                                                                          │
│  Đang xem: Phân công · 487 dòng · 12 lỗi · 34 cảnh báo                  │
│                                                                          │
│  Ánh xạ cột                                                             │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │ Cột A "Lớp"        → Lớp            ✓ tự nhận                  │     │
│  │ Cột B "Môn"        → Môn học        ✓ tự nhận                  │     │
│  │ Cột C "GV giảng"   → [Giáo viên ▾]  ⚠ đã gán tay               │     │
│  │ Cột D "Số tiết"    → Số tiết/tuần   ✓ tự nhận                  │     │
│  │ Cột E "Ghi chú"    → [Bỏ qua ▾]                                │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                                                          │
│  ⛔ 12 lỗi cần xử lý                          [Ẩn dòng hợp lệ ☑]        │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │ Dòng│ Lớp  │ Môn      │ Giáo viên        │ Tiết│ Vấn đề        │     │
│  ├─────┼──────┼──────────┼──────────────────┼─────┼───────────────┤     │
│  │ 45  │ 10A9 │ Toán     │ Nguyễn Văn Hùng  │  4  │ ⛔ Không có   │     │
│  │     │  ▲   │          │                  │     │ lớp "10A9"    │     │
│  │     │ [10A1 ▾] ← sửa tại chỗ                  │ [Bỏ dòng này] │     │
│  ├─────┼──────┼──────────┼──────────────────┼─────┼───────────────┤     │
│  │ 78  │ 10A1 │ Vật lí   │ Ng. V. Hùn       │  2  │ ⛔ Không tìm  │     │
│  │     │      │          │  ▲               │     │ thấy GV       │     │
│  │     │      │  Ý bạn là "Nguyễn Văn Hùng"? [Đúng] [Chọn khác ▾]│     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                                                          │
│  ⚠ 34 cảnh báo — vẫn nhập được                        [Xem chi tiết ▾]  │
│    • 8 giáo viên vượt định mức tiết                                     │
│    • 21 dòng có số tiết khác cấu hình chuẩn của khối                    │
│    • 5 lớp chưa có phân công môn Địa lí                                 │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │ ⛔ Còn 12 lỗi. Hãy sửa hoặc bỏ những dòng này trước khi nhập.│       │
│  │                          [Bỏ qua 12 dòng lỗi và nhập 475 dòng]│      │
│  └──────────────────────────────────────────────────────────────┘       │
│                                                                          │
│                                  [← Quay lại]  [Nhập 487 dòng] (mờ)     │
└──────────────────────────────────────────────────────────────────────────┘
```

**Sáu chi tiết có chủ đích:**

1. **Tab theo sheet với số đếm ngay trên nhãn** — nhìn một cái biết sheet nào có vấn đề, không phải bấm vào từng cái.
2. **Ánh xạ cột hiện rõ và sửa được**, kể cả những cột đã tự nhận đúng. Người dùng cần thấy phần mềm hiểu file của họ thế nào trước khi tin nó.
3. **Sửa tại chỗ trong bảng lỗi**, không mở hộp thoại. Ô sai biến thành ô nhập liệu ngay tại dòng đó.
4. **Gợi ý kèm nút chấp nhận một chạm** cho lỗi sai chính tả tên — đây là loại lỗi phổ biến nhất và cũng dễ sửa nhất.
5. **Cảnh báo gom nhóm, thu gọn mặc định.** 34 dòng cảnh báo bung ra sẽ che mất 12 lỗi thực sự cần xử lý.
6. **Lối thoát "Bỏ qua dòng lỗi"** đặt ngay cạnh thông báo chặn. Người dùng đang vội — cho họ nhập 475 dòng ngay bây giờ và sửa 12 dòng sau, còn hơn bắt họ dừng lại.

Sau khi ghi xong, không hiện hộp thoại "Thành công" rồi để họ tự tìm đường. Chuyển thẳng tới màn hình tiếp theo trong quy trình:

> **Đã nhập 92 giáo viên, 45 lớp, 15 môn và 487 phân công.**
> Bước tiếp theo: kiểm tra lịch bận của giáo viên, rồi xếp thời khoá biểu.
> `[Đặt lịch bận]` `[Xếp thời khoá biểu ngay]`

---

## 7. Nhập bằng dán trực tiếp

Không phải ai cũng có file. Nhiều người sẽ mở Excel, bôi đen, copy. Hỗ trợ dán vào bảng:

```ts
element.addEventListener('paste', e => {
  const text = e.clipboardData.getData('text/plain');
  const rows = text.split('\n').map(r => r.split('\t'));
  // đưa vào đúng luồng chuẩn hoá + kiểm tra như file
});
```

Excel đặt dữ liệu vào clipboard dưới dạng TSV, nên chỉ cần tách tab và xuống dòng. Chi phí khoảng 30 dòng code, và nó xử lý được trường hợp "tôi chỉ muốn thêm 5 giáo viên mới" — thứ mà tải file lên là quá nặng nề.

Cũng chấp nhận `text/html` từ clipboard khi có, vì nó giữ được thông tin ô gộp.

---

## 8. Xuất ngược để sửa

Cặp đôi của nhập là xuất. Người dùng đã nhập 500 dòng, phát hiện sai 50 dòng — bắt họ sửa từng dòng trên giao diện web là tệ hơn nhiều so với:

```
Xuất Excel  →  sửa hàng loạt trong Excel  →  Nhập lại chế độ upsert
```

Vì vậy mọi bảng danh mục có nút **Xuất Excel** dùng đúng định dạng của file mẫu, với cột `code` đã điền sẵn. Nhập lại ở chế độ `upsert` khớp theo `code` và cập nhật đúng chỗ.

Đây là vòng lặp mà người dùng Excel đã quen và làm rất nhanh. Đừng chống lại nó.

---

## 9. Kiểm thử

Bộ dữ liệu kiểm thử phải là **file thật, bừa bộn**, không phải file sạch tự tạo:

| File | Đặc điểm |
|---|---|
| `sach.xlsx` | Đúng mẫu hoàn toàn — phải nhập không lỗi |
| `co-tieu-de-lech.xlsx` | 6 dòng đầu là quốc hiệu và tên trường |
| `ma-tran.xlsx` | Phân công dạng ma trận lớp × môn |
| `o-gop.xlsx` | Cột Tổ bộ môn gộp nhiều dòng |
| `sai-chinh-ta.xlsx` | 20 tên giáo viên viết sai một ký tự |
| `trung-ten.xlsx` | Hai giáo viên trùng tên hoàn toàn |
| `qua-tai.xlsx` | Một GV được phân công 30 tiết |
| `thieu-cot.xlsx` | Thiếu cột Số tiết |
| `rong.xlsx` | File trống, sheet trống |
| `khong-phai-excel.pdf` | Đổi đuôi file |

```ts
it('không bao giờ ghi dữ liệu khi còn dòng lỗi chưa xử lý');
it('transaction hỏng giữa chừng không để lại dữ liệu rác');       // ★
it('luật kiểm tra ở trình duyệt và ở server cho kết quả giống hệt nhau'); // ★
it('nhập lại cùng file ở chế độ upsert không tạo bản ghi trùng');
it('phát hiện đúng định dạng ma trận và dạng dọc');
```

Hai ca `★` là quan trọng nhất. Ca thứ hai chạy bằng cách đưa cùng một bộ dữ liệu qua cả hai đường và so sánh danh sách lỗi — nếu lệch, nghĩa là package dùng chung đã bị fork ngầm ở đâu đó.

---

## 10. Ước lượng công sức

| Hạng mục | Thời gian |
|---|---|
| Package `import-core`: chuẩn hoá + ánh xạ cột | 2 ngày |
| Luật kiểm tra 5 sheet | 3 ngày |
| Sinh file mẫu `.xlsx` động theo cấp học | 1 ngày |
| Đọc dạng ma trận + phát hiện định dạng | 1,5 ngày |
| Màn hình xem trước + sửa tại chỗ | 4 ngày |
| So khớp tên mờ + gợi ý | 1 ngày |
| Endpoint ghi + tính nguyên tử | 2 ngày |
| Dán trực tiếp | 0,5 ngày |
| Xuất ngược theo định dạng mẫu | 1 ngày |
| Bộ file kiểm thử + kiểm thử | 2 ngày |

Tổng: khoảng **3,5 tuần**.

**Nếu phải cắt:** bỏ dạng ma trận và dán trực tiếp (2 ngày). Nhưng đừng cắt **màn hình xem trước** — nhập mù rồi báo lỗi sau khi đã ghi là cách nhanh nhất phá vỡ niềm tin của một trường vừa mới đăng ký.
