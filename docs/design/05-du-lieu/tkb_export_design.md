# TKB SaaS — Xuất file: Excel, PDF, ICS

> Đi kèm: `tkb_schema.sql`, `tkb_design_spec.md`, `tkb_api_spec.md`.

---

## 1. Vì sao xuất file quan trọng hơn ta nghĩ

Ở trường phổ thông Việt Nam, thời khoá biểu tồn tại ở ba dạng vật lý, và cả ba đều bắt buộc:

| Dạng | Người dùng | Yêu cầu |
|---|---|---|
| **Bản in dán bảng tin** | Học sinh, phụ huynh | Khổ A3 hoặc A2, chữ đủ lớn đọc từ xa 2 mét |
| **Bản in lưu hồ sơ** | Văn thư, thanh tra | A4, có chữ ký hiệu trưởng, đúng thể thức văn bản |
| **File Excel** | Người xếp lịch, tổ trưởng | Sửa được, tô màu được, gửi qua Zalo được |

Điều này khác với phần mềm phương Tây, nơi lịch học sống trên màn hình. Ở đây, **thời khoá biểu là văn bản hành chính có hiệu lực** — nó được ký, đóng dấu, lưu hồ sơ, và là căn cứ để tính tiền dạy thừa giờ.

Hệ quả thiết kế: xuất file không phải tính năng phụ. Một phần mềm xếp TKB tốt nhưng in ra xấu sẽ thua một phần mềm xếp kém hơn nhưng in đúng thể thức.

---

## 2. Kiến trúc xuất file

```
POST /schools/:sid/exports
{
  "kind": "timetable_class",
  "timetableId": "c4a1...",
  "format": "xlsx",
  "options": { "scope": "all", "showTeacher": true, "showRoom": false }
}
→ 202 { "jobId": "exp_01HX...", "estimatedMs": 3000 }

WebSocket: { "type": "export.ready", "data": {
  "jobId": "exp_01HX...",
  "downloadUrl": "https://files.tkb.vn/...?sig=...",
  "expiresAt": "2026-08-22T05:14:00Z",
  "sizeBytes": 184320
}}
```

Chạy nền vì PDF 45 trang qua Puppeteer mất 5–15 giây. URL tải là link ký sẵn, sống 1 giờ, không cần token.

**Trường hợp nhanh** (một lớp, một giáo viên) trả thẳng luồng byte, không qua job:

```
GET /timetables/:tid/export.xlsx?kind=timetable_class&classId=c1
```

Ngưỡng: dưới 2 giây thì trả trực tiếp, trên thì tạo job.

---

## 3. Xuất Excel

Dùng **ExcelJS** (không dùng SheetJS phía server — bản miễn phí không ghi được định dạng ô đầy đủ).

### 3.1 Danh mục loại báo cáo

| Mã | Tên | Cấu trúc |
|---|---|---|
| `timetable_school` | TKB toàn trường | 1 sheet, hàng = lớp, cột = tiết |
| `timetable_class` | TKB theo lớp | Mỗi lớp một sheet, hàng = tiết, cột = thứ |
| `timetable_teacher` | TKB giáo viên | Mỗi GV một sheet, hoặc gộp một sheet có phân trang |
| `timetable_room` | Lịch sử dụng phòng | Hàng = phòng, cột = tiết |
| `assignments` | Bảng phân công giảng dạy | Ma trận lớp × môn |
| `workload` | Thống kê tải giảng dạy | Hàng = GV, cột = chỉ số |
| `free_periods` | Thống kê tiết trống | Hàng = lớp/GV, cột = ngày |

### 3.2 Bố cục `timetable_school`

```
   A         B    C    D    E    F   G    H    I  ...
1  ┌─────────────────────────────────────────────────────┐
2  │        THỜI KHÓA BIỂU — HỌC KỲ I, NĂM HỌC 2026-2027 │  gộp A2:AE2
3  │        Trường THPT Nguyễn Đình Chiểu                │  gộp A3:AE3
4  │        Áp dụng từ ngày 05/09/2026                   │  gộp A4:AE4
5  ├───────┬──────────────────┬──────────────────┬───────┤
6  │       │    THỨ HAI       │     THỨ BA       │  ...  │  gộp mỗi thứ 5 cột
7  │  LỚP  │ 1 │ 2 │ 3 │ 4 │5 │ 1 │ 2 │ 3 │ 4 │5│  ...  │
8  ├───────┼───┼───┼───┼───┼──┼───┼───┼───┼───┼─┼───────┤
9  │ 10A1  │Toán│Văn│Anh│Lý│Sinh│...                     │
10 │       │T.Hùng│C.Mai│...  │  ← dòng phụ tên GV (tuỳ chọn)
```

**Tham số kỹ thuật:**

```ts
sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 7 }];   // đóng băng tiêu đề
sheet.getColumn(1).width = 10;                                // cột LỚP
for (let c = 2; c <= 1 + D * P; c++) sheet.getColumn(c).width = 9.5;

sheet.pageSetup = {
  paperSize: 8,                    // A3
  orientation: 'landscape',
  fitToPage: true, fitToWidth: 1, fitToHeight: 0,
  margins: { left: .3, right: .3, top: .4, bottom: .4, header: .2, footer: .2 },
  printTitlesRow: '6:7',           // lặp tiêu đề mọi trang
  printTitlesColumn: 'A:A',
};
```

**Ô môn học** dùng nền màu nhạt của môn + viền trái đậm:

```ts
cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEAFB' } };
cell.border = {
  left:   { style: 'medium', color: { argb: 'FF2F6FBF' } },
  right:  { style: 'thin',   color: { argb: 'FFE3E7EE' } },
  top:    { style: 'thin',   color: { argb: 'FFE3E7EE' } },
  bottom: { style: 'thin',   color: { argb: 'FFE3E7EE' } },
};
cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
cell.font = { name: 'Times New Roman', size: 10, bold: true };
```

Dùng **Times New Roman** trong file Excel, không phải Be Vietnam Pro — vì file này sẽ được mở trên máy trường học chạy Windows với Office bản cũ, và Times New Roman là font duy nhất chắc chắn có sẵn với bộ dấu tiếng Việt đầy đủ.

**Ranh giới buổi:** cột cuối của mỗi thứ dùng viền phải `medium` màu `FF8A93A3` để mắt phân biệt được các ngày khi in đen trắng.

### 3.3 Bố cục `timetable_class` — mỗi lớp một sheet

Đây là dạng các trường in ra dán ở cửa lớp. Xoay ngược trục cho vừa khổ dọc:

```
        A          B         C        D        E        F        G
1   ┌──────────────────────────────────────────────────────────┐
2   │              THỜI KHÓA BIỂU LỚP 10A1                     │
3   │        Học kỳ I · Năm học 2026-2027 · GVCN: Nguyễn Văn Hùng│
4   ├──────┬──────────┬─────────┬─────────┬─────────┬──────────┤
5   │ Tiết │ Thứ Hai  │ Thứ Ba  │ Thứ Tư  │ Thứ Năm │ Thứ Sáu  │ Thứ Bảy
6   ├──────┼──────────┼─────────┼─────────┼─────────┼──────────┤
7   │  1   │ Chào cờ  │  Toán   │  Văn    │  Anh    │  Lý      │
8   │07:00 │          │ T.Hùng  │ C.Mai   │ C.Hà    │ T.Sơn    │
9   ├──────┼──────────┼─────────┼─────────┼─────────┼──────────┤
10  │  2   │  Toán    │  ...
```

Cột giờ vào lớp (`07:00`) là chi tiết nhỏ nhưng học sinh lớp 10 mới vào trường rất cần. Bật/tắt bằng tuỳ chọn `showTime`.

Tên sheet đặt bằng tên lớp (`10A1`), sắp theo khối. Excel giới hạn tên sheet 31 ký tự và cấm `: \ / ? * [ ]` — cần lọc.

### 3.4 `assignments` — ma trận phân công

Xuất đúng định dạng mà `tkb_excel_import.md` mục 2.5 đọc được. Đây là ràng buộc bắt buộc: **xuất ra phải nhập lại được**. Vòng lặp xuất → sửa hàng loạt trong Excel → nhập lại là cách người dùng Excel làm việc nhanh nhất.

Thêm hai vùng ở cuối:
- Cột cuối bên phải: tổng tiết mỗi lớp, kèm định dạng có điều kiện tô đỏ khi thiếu/thừa
- Hàng cuối: tổng tiết mỗi môn toàn trường

### 3.5 `workload` — thống kê tải giảng dạy

| Mã GV | Họ tên | Tổ | Môn | Số lớp | Tiết/tuần | Định mức | Chênh lệch | Số ngày đến trường | Tiết trống |
|---|---|---|---|---|---|---|---|---|---|
| GV001 | Nguyễn Văn Hùng | Toán - Tin | Toán | 4 | 16 | 19 | −3 | 5 | 2 |

Định dạng có điều kiện trên cột Chênh lệch: đỏ nếu dương (vượt định mức), xanh nếu âm. Đây là bảng ban giám hiệu dùng để tính tiền thừa giờ, nên phải chính xác và dễ đọc.

---

## 4. Xuất PDF

### 4.1 Công nghệ

Puppeteer dựng từ HTML — cùng thành phần React đang hiển thị trên màn hình, chỉ đổi stylesheet. Ưu điểm: một nguồn bố cục, không phải bảo trì hai bản.

```ts
const page = await browser.newPage();
await page.goto(`${INTERNAL_URL}/print/${timetableId}?token=${signed}`, { waitUntil: 'networkidle0' });
await page.emulateMediaType('print');
const pdf = await page.pdf({
  format: 'A4', landscape: true, printBackground: true,
  margin: { top: '15mm', right: '10mm', bottom: '15mm', left: '20mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: FOOTER_HTML,
});
```

Lề trái 20mm theo quy định thể thức văn bản hành chính (chừa chỗ đóng ghim hồ sơ), lề phải 10mm, trên dưới 15mm.

### 4.2 Thể thức văn bản hành chính

Bản in lưu hồ sơ phải theo **Nghị định 30/2020/NĐ-CP về công tác văn thư**. Với thời khoá biểu — là bảng biểu ban hành kèm quyết định hoặc thông báo — bố cục như sau:

```
┌────────────────────────────────────────────────────────────────────┐
│  SỞ GIÁO DỤC VÀ ĐÀO TẠO          CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM│
│      TỈNH BẾN TRE                    Độc lập - Tự do - Hạnh phúc   │
│  TRƯỜNG THPT NGUYỄN ĐÌNH CHIỂU    ─────────────────────────────    │
│  ─────────────────────────                                         │
│                                    Bến Tre, ngày 22 tháng 8 năm 2026│
│                                                                     │
│                        THỜI KHÓA BIỂU                               │
│              Học kỳ I — Năm học 2026 - 2027                        │
│                (Áp dụng từ ngày 05/9/2026)                         │
│                                                                     │
│  ┌──────┬────────────────────┬────────────────────┬──────────┐    │
│  │      │      THỨ HAI       │      THỨ BA        │   ...     │    │
│  │ LỚP  │  1  2  3  4  5     │  1  2  3  4  5     │           │    │
│  ├──────┼────────────────────┼────────────────────┼──────────┤    │
│  │ 10A1 │ ...                                                 │    │
│                                                                     │
│                                        HIỆU TRƯỞNG                 │
│                                   (Ký tên, đóng dấu)               │
│                                                                     │
│                                                                     │
│                                   Nguyễn Văn A                     │
└────────────────────────────────────────────────────────────────────┘
```

**Chi tiết thể thức cần đúng:**

| Thành phần | Quy cách |
|---|---|
| Tên cơ quan chủ quản | Times New Roman, 12, in hoa, **không đậm** |
| Tên trường | Times New Roman, 12, in hoa, **đậm**, có gạch ngang ngắn bên dưới |
| Quốc hiệu | Times New Roman, 12, in hoa, đậm |
| Tiêu ngữ | Times New Roman, 13, đậm, các chữ đầu viết hoa, gạch nối giữa các cụm |
| Địa danh, ngày tháng | Times New Roman, 13, **nghiêng** |
| Tên loại văn bản | Times New Roman, 13–14, in hoa, đậm, canh giữa |
| Trích yếu | Times New Roman, 13–14, đậm |
| Nội dung bảng | Times New Roman, 9–11 tuỳ mật độ |
| Chức vụ người ký | Times New Roman, 13–14, in hoa, đậm |
| Họ tên người ký | Times New Roman, 13–14, đậm |

Chừa **tối thiểu 25mm** giữa dòng "(Ký tên, đóng dấu)" và họ tên người ký — đủ chỗ đóng dấu tròn đường kính 36mm.

Các thông tin trường, tên hiệu trưởng, cơ quan chủ quản lấy từ `schools.settings.officialHeader`, cấu hình một lần ở màn hình Cài đặt.

### 4.3 Khổ giấy theo mục đích

| Loại | Khổ | Hướng | Cỡ chữ bảng | Dùng để |
|---|---|---|---|---|
| Toàn trường (45 lớp) | A3 | Ngang | 9 | Dán phòng hội đồng |
| Toàn trường (≤ 24 lớp) | A4 | Ngang | 10 | Lưu hồ sơ |
| Một lớp | A4 | Dọc | 12 | Dán cửa lớp |
| Một giáo viên | A4 | Dọc | 12 | Phát cho GV |
| Bảng tin học sinh | A2 | Ngang | 14 | Dán bảng tin sân trường |

Hệ thống tự chọn khổ theo số lớp và cảnh báo nếu người dùng chọn khổ quá nhỏ: *"45 lớp trên khổ A4 sẽ cho chữ cỡ 6, rất khó đọc. Nên dùng A3."*

### 4.4 Xử lý ngắt trang

Với chế độ mỗi lớp một trang, dùng CSS:

```css
.class-page { break-after: page; }
.class-page:last-child { break-after: auto; }
thead { display: table-header-group; }   /* lặp tiêu đề khi bảng tràn trang */
tr { break-inside: avoid; }
```

`display: table-header-group` là chi tiết dễ quên — thiếu nó, bảng tràn sang trang 2 sẽ mất dòng tiêu đề Thứ/Tiết và trang đó vô nghĩa.

### 4.5 In đen trắng

Phần lớn máy in trường học là laser đen trắng. Nền màu môn học biến thành các sắc xám gần giống nhau, không phân biệt được.

Giải pháp: tuỳ chọn `colorMode: 'mono'` bỏ hẳn nền màu, thay bằng **viền trái với độ dày khác nhau** theo nhóm môn:

| Nhóm môn | Viền trái |
|---|---|
| Khoa học tự nhiên | Nét liền, 2pt |
| Khoa học xã hội | Nét đứt, 1.5pt |
| Ngoại ngữ | Nét chấm, 1.5pt |
| Năng khiếu, thể chất | Nét liền, 0.5pt |

Không hoàn hảo nhưng đủ để mắt phân nhóm. Mặc định bật `mono` khi người dùng chọn khổ A4 — vì A4 gần như luôn là bản lưu hồ sơ in đen trắng.

---

## 5. Xuất file lịch `.ics`

### 5.1 Vì sao đáng làm

Giáo viên dùng điện thoại. Một file `.ics` đưa toàn bộ lịch dạy vào ứng dụng Lịch của máy, có thông báo trước 10 phút, hoạt động cả khi không có mạng. Chi phí triển khai khoảng một ngày, giá trị cảm nhận rất cao.

### 5.2 Địa chỉ đăng ký

Hai kiểu, nên hỗ trợ cả hai:

```
GET /me/timetable.ics?token=<long_lived_signed_token>     # tải một lần
webcal://api.tkb.vn/v1/me/timetable.ics?token=...          # đăng ký, tự cập nhật
```

Kiểu `webcal://` tốt hơn nhiều: khi ban giám hiệu đổi thời khoá biểu hoặc xếp dạy thay, lịch trên máy giáo viên tự cập nhật trong vài giờ. Token là chuỗi ký riêng cho mục đích này, chỉ đọc, thu hồi được từ trang cá nhân.

### 5.3 Cấu trúc

```ics
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//TKB Vietnam//Timetable 1.0//VI
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:TKB - T. Nguyễn Văn Hùng - HK I 2026-2027
X-WR-TIMEZONE:Asia/Ho_Chi_Minh
REFRESH-INTERVAL;VALUE=DURATION:PT6H
X-PUBLISHED-TTL:PT6H

BEGIN:VTIMEZONE
TZID:Asia/Ho_Chi_Minh
BEGIN:STANDARD
DTSTART:19700101T000000
TZOFFSETFROM:+0700
TZOFFSETTO:+0700
TZNAME:+07
END:STANDARD
END:VTIMEZONE

BEGIN:VEVENT
UID:lesson-8a1c4f2b@tkb.vn
DTSTAMP:20260822T031200Z
DTSTART;TZID=Asia/Ho_Chi_Minh:20260908T070000
DTEND;TZID=Asia/Ho_Chi_Minh:20260908T074500
RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20270115T235959Z
EXDATE;TZID=Asia/Ho_Chi_Minh:20260902T070000,20270101T070000
SUMMARY:Toán - 10A1
LOCATION:Phòng A201
DESCRIPTION:Tiết 2 · Lớp 10A1 · Môn Toán\nGiáo viên: T. Nguyễn Văn Hùng
CATEGORIES:Toán
BEGIN:VALARM
TRIGGER:-PT10M
ACTION:DISPLAY
DESCRIPTION:Toán - 10A1 - Phòng A201
END:VALARM
END:VEVENT
END:VCALENDAR
```

**Sáu điểm cần đúng:**

1. **Khối `VTIMEZONE` phải có.** Việt Nam không đổi giờ theo mùa nên nội dung đơn giản, nhưng thiếu nó thì một số ứng dụng lịch diễn giải giờ sai lệch 7 tiếng.
2. **`RRULE` lặp tuần** thay vì sinh riêng từng buổi. Một học kỳ 18 tuần × 19 tiết = 342 sự kiện nếu liệt kê hết; dùng `RRULE` còn 19. File nhẹ hơn 18 lần và cập nhật nhanh hơn.
3. **`UNTIL` là ngày kết thúc học kỳ**, lấy từ `semesters.end_date`.
4. **`EXDATE` cho ngày nghỉ lễ** — Quốc khánh 2/9, Tết Dương lịch, Tết Nguyên đán. Bảng `holidays` đã có trong `tkb_schema.sql` (mục 3): ngày lễ quốc gia dùng chung bản ghi `school_id = NULL`, trường tự thêm ngày nghỉ riêng của mình khi cần.
5. **`UID` ổn định** dựa trên `lesson_id`. Khi tiết đổi chỗ, cùng `UID` với `DTSTART` mới → ứng dụng lịch cập nhật đúng sự kiện thay vì tạo bản trùng.
6. **`SUMMARY` ngắn.** Trên màn hình điện thoại, ô lịch chỉ hiện được khoảng 18 ký tự. `Toán - 10A1` vừa; `Toán học lớp 10A1 - Phòng A201` bị cắt cụt.

### 5.4 Dạy thay và tiết nghỉ

Bảng `substitutions` ánh xạ sang `.ics` như sau:

- **Tiết bị huỷ** (`is_cancelled = true`): thêm `EXDATE` cho ngày đó
- **Dạy thay**: thêm `EXDATE` vào lịch của GV gốc, đồng thời sinh một `VEVENT` đơn lẻ (không `RRULE`) trong lịch của GV dạy thay, `SUMMARY` có tiền tố `[Dạy thay]`
- **Đổi phòng**: `EXDATE` cho sự kiện lặp + một `VEVENT` đơn lẻ với phòng mới

### 5.5 Bốn loại lịch

| Đường dẫn | Nội dung |
|---|---|
| `/me/timetable.ics` | Lịch dạy của giáo viên đang đăng nhập |
| `/classes/:cid/timetable.ics?token=` | Lịch học một lớp — dành cho GVCN và phụ huynh |
| `/public/:slug/classes/:cid.ics` | Bản công khai, nếu trường bật |
| `/rooms/:rid/timetable.ics?token=` | Lịch sử dụng phòng — dành cho quản lý cơ sở vật chất |

---

## 6. Quy ước đặt tên file

Tên file xuất ra sẽ nằm trong thư mục Downloads của người dùng cùng hàng chục file khác. Đặt tên để họ tìm lại được:

```
TKB_ToanTruong_THPT-Nguyen-Dinh-Chieu_HK1_2026-2027_20260822.xlsx
TKB_Lop-10A1_HK1_2026-2027_20260822.pdf
TKB_GV-Nguyen-Van-Hung_HK1_2026-2027_20260822.pdf
PhanCong_THPT-Nguyen-Dinh-Chieu_2026-2027_20260822.xlsx
```

Quy tắc: **bỏ dấu tiếng Việt** trong tên file (một số máy in mạng và hệ thống file cũ vẫn xử lý kém UTF-8), dấu gạch dưới ngăn nhóm thông tin, gạch ngang trong nội bộ một nhóm, ngày xuất ở cuối theo `YYYYMMDD` để sắp xếp theo tên là ra thứ tự thời gian.

---

## 7. Kiểm thử

| Ca | Cách kiểm |
|---|---|
| Excel mở được trên Office 2010 | Mở thủ công trên máy ảo Windows |
| Không mất dấu tiếng Việt khi in PDF | So sánh ảnh chụp trang với bản mẫu |
| Bảng tràn trang giữ được dòng tiêu đề | Xuất trường 45 lớp khổ A4, kiểm trang 2 |
| `.ics` nhập được vào Google Calendar, Apple Calendar, Outlook | Kiểm thủ công cả ba |
| `.ics` giữ đúng múi giờ +07 | Đối chiếu giờ hiển thị |
| Xuất `assignments` nhập lại được | Vòng lặp xuất → nhập, so sánh dữ liệu trước sau ★ |
| In đen trắng phân biệt được nhóm môn | In thử trên máy laser |
| Tên file không có ký tự cấm | Kiểm regex |

Ca `★` là ràng buộc quan trọng nhất của mục 3.4 — nếu file xuất ra không nhập lại được, cả vòng lặp làm việc bằng Excel của người dùng bị đứt.

---

## 8. Ước lượng công sức

| Hạng mục | Thời gian |
|---|---|
| Hạ tầng job xuất file + lưu trữ + link ký sẵn | 2 ngày |
| 7 loại báo cáo Excel | 4 ngày |
| Trang in HTML + CSS print | 2 ngày |
| Khối thể thức văn bản hành chính + cấu hình | 1,5 ngày |
| Dịch vụ Puppeteer + xử lý khổ giấy | 2 ngày |
| Chế độ in đen trắng | 1 ngày |
| Sinh `.ics` + `webcal` + token thu hồi được | 1,5 ngày |
| Bảng ngày nghỉ lễ + `EXDATE` | 1 ngày |
| Kiểm thử thủ công đa nền tảng | 2 ngày |

Tổng: khoảng **3,5 tuần**.

**Ưu tiên nếu phải cắt:** làm trước `timetable_class` (Excel + PDF A4) và `assignments` (Excel) — hai thứ này phủ 80% nhu cầu thực tế. `.ics` để sau nhưng đừng bỏ hẳn: nó rẻ và là thứ giáo viên khoe với đồng nghiệp, tạo lan truyền tự nhiên trong trường.
