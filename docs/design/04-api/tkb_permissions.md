# TKB SaaS — Ma trận phân quyền

> Đi kèm: `tkb_api_spec.md`, `tkb_schema.sql`.

---

## 1. Năm vai trò

Vai trò lưu ở `school_members.role`. Một người có thể mang vai trò khác nhau ở các trường khác nhau.

| Vai trò | Ai trong thực tế | Mô tả một câu |
|---|---|---|
| `owner` | Hiệu trưởng, hoặc người đăng ký tài khoản | Toàn quyền, kể cả thanh toán và xoá trường |
| `admin` | Hiệu phó phụ trách chuyên môn | Toàn quyền nghiệp vụ, không chạm thanh toán |
| `scheduler` | Tổ trưởng chuyên môn, thư ký hội đồng | Xếp và sửa thời khoá biểu, không sửa danh mục gốc |
| `teacher` | Giáo viên | Chỉ xem phần liên quan đến mình |
| `viewer` | Ban giám hiệu trường khác, thanh tra, phụ huynh được cấp quyền | Chỉ xem thời khoá biểu đã công bố |

**Nguyên tắc phân tách:** `owner` và `admin` khác nhau đúng ở nhóm thanh toán và quản lý thành viên. `admin` và `scheduler` khác nhau ở chỗ `scheduler` **không được sửa danh mục** (giáo viên, lớp, môn, khung tiết) — vì sửa danh mục có thể phá vỡ thời khoá biểu của người khác, còn xếp lịch thì không.

---

## 2. Ma trận đầy đủ

Ký hiệu: **✓** toàn quyền · **R** chỉ đọc · **⊘** không có quyền · **①②③…** có điều kiện, xem mục 3.

### 2.1 Trường và thành viên

| # | Hành động | owner | admin | scheduler | teacher | viewer |
|---|---|:--:|:--:|:--:|:--:|:--:|
| 1 | Xem thông tin trường | ✓ | ✓ | ✓ | R | R |
| 2 | Sửa thông tin trường (tên, logo, địa chỉ) | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| 3 | Xoá trường | ✓ ① | ⊘ | ⊘ | ⊘ | ⊘ |
| 4 | Xem danh sách thành viên | ✓ | ✓ | R | ⊘ | ⊘ |
| 5 | Mời thành viên mới | ✓ | ✓ ② | ⊘ | ⊘ | ⊘ |
| 6 | Đổi vai trò thành viên | ✓ | ✓ ② | ⊘ | ⊘ | ⊘ |
| 7 | Gỡ thành viên | ✓ | ✓ ② | ⊘ | ⊘ | ⊘ |
| 8 | Chuyển quyền `owner` | ✓ ③ | ⊘ | ⊘ | ⊘ | ⊘ |
| 9 | Xem nhật ký hoạt động | ✓ | ✓ | R ④ | ⊘ | ⊘ |

### 2.2 Thanh toán

| # | Hành động | owner | admin | scheduler | teacher | viewer |
|---|---|:--:|:--:|:--:|:--:|:--:|
| 10 | Xem gói dịch vụ hiện tại | ✓ | R | ⊘ | ⊘ | ⊘ |
| 11 | Nâng cấp / hạ cấp gói | ✓ | ⊘ | ⊘ | ⊘ | ⊘ |
| 12 | Xem và tải hoá đơn | ✓ | ⊘ | ⊘ | ⊘ | ⊘ |
| 13 | Huỷ đăng ký | ✓ | ⊘ | ⊘ | ⊘ | ⊘ |

### 2.3 Năm học và cấu hình khung

| # | Hành động | owner | admin | scheduler | teacher | viewer |
|---|---|:--:|:--:|:--:|:--:|:--:|
| 14 | Tạo năm học mới | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| 15 | Sửa / xoá năm học | ✓ | ✓ ⑤ | ⊘ | ⊘ | ⊘ |
| 16 | Kích hoạt năm học | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| 17 | Sửa học kỳ | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| 18 | Sửa khung tiết (giờ vào lớp, số tiết/buổi) | ✓ | ✓ | ⊘ | R | ⊘ |
| 19 | Sửa ngày học trong tuần | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| 20 | Chạy chuyển tiếp năm học | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| 21 | Hoàn tác chuyển tiếp năm học | ✓ | ✓ ⑥ | ⊘ | ⊘ | ⊘ |

### 2.4 Danh mục

| # | Hành động | owner | admin | scheduler | teacher | viewer |
|---|---|:--:|:--:|:--:|:--:|:--:|
| 22 | Xem khối, lớp | ✓ | ✓ | ✓ | R | ⊘ |
| 23 | Thêm / sửa / xoá lớp | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| 24 | Xem môn học | ✓ | ✓ | ✓ | R | ⊘ |
| 25 | Thêm / sửa / xoá môn, đổi màu, đặt số tiết chuẩn | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| 26 | Xem danh sách giáo viên | ✓ | ✓ | ✓ | R ⑦ | ⊘ |
| 27 | Thêm / sửa / xoá giáo viên | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| 28 | Sửa định mức tiết của giáo viên | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| 29 | Gán môn dạy được cho giáo viên | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| 30 | Xem / sửa phòng học | ✓ | ✓ | R | ⊘ | ⊘ |
| 31 | Xem / sửa tổ bộ môn | ✓ | ✓ | R | R | ⊘ |
| 32 | Cấp tài khoản đăng nhập cho giáo viên | ✓ | ✓ | ⊘ | ⊘ | ⊘ |

### 2.5 Phân công giảng dạy

| # | Hành động | owner | admin | scheduler | teacher | viewer |
|---|---|:--:|:--:|:--:|:--:|:--:|
| 33 | Xem bảng phân công toàn trường | ✓ | ✓ | ✓ | R ⑧ | ⊘ |
| 34 | Thêm / sửa / xoá phân công | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| 35 | Ghép lớp / tách lớp | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| 36 | Nhập phân công từ Excel | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| 37 | Xem cảnh báo phân công (thiếu môn, vượt định mức) | ✓ | ✓ | ✓ | ⊘ | ⊘ |

### 2.6 Ràng buộc

| # | Hành động | owner | admin | scheduler | teacher | viewer |
|---|---|:--:|:--:|:--:|:--:|:--:|
| 38 | Xem lịch bận của mọi giáo viên | ✓ | ✓ | ✓ | ⊘ | ⊘ |
| 39 | Sửa lịch bận của bất kỳ giáo viên | ✓ | ✓ | ✓ | ⊘ | ⊘ |
| 40 | Xem lịch bận của chính mình | — | — | — | ✓ ⑨ | ⊘ |
| 41 | **Đề xuất** sửa lịch bận của chính mình | — | — | — | ✓ ⑩ | ⊘ |
| 42 | Duyệt đề xuất lịch bận của giáo viên | ✓ | ✓ | ✓ | ⊘ | ⊘ |
| 43 | Sửa luật ràng buộc và trọng số | ✓ | ✓ | ✓ | ⊘ | ⊘ |

### 2.7 Thời khoá biểu

| # | Hành động | owner | admin | scheduler | teacher | viewer |
|---|---|:--:|:--:|:--:|:--:|:--:|
| 44 | Tạo bản thời khoá biểu mới | ✓ | ✓ | ✓ | ⊘ | ⊘ |
| 45 | Xem bản nháp | ✓ | ✓ | ✓ | ⊘ | ⊘ |
| 46 | Xem bản đã công bố | ✓ | ✓ | ✓ | R ⑪ | R ⑪ |
| 47 | Kéo-thả, đặt, gỡ tiết | ✓ | ✓ | ✓ ⑫ | ⊘ | ⊘ |
| 48 | Ghim / bỏ ghim tiết | ✓ | ✓ | ✓ ⑫ | ⊘ | ⊘ |
| 49 | Chạy xếp tự động | ✓ | ✓ | ✓ ⑬ | ⊘ | ⊘ |
| 50 | Dừng job xếp tự động | ✓ | ✓ | ✓ ⑭ | ⊘ | ⊘ |
| 51 | Xoá toàn bộ tiết đã xếp | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| 52 | Tạo snapshot | ✓ | ✓ | ✓ | ⊘ | ⊘ |
| 53 | Khôi phục từ snapshot | ✓ | ✓ | ✓ ⑫ | ⊘ | ⊘ |
| 54 | **Công bố** thời khoá biểu | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| 55 | Gỡ công bố | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| 56 | Xoá bản thời khoá biểu | ✓ | ✓ ⑮ | ⊘ | ⊘ | ⊘ |
| 57 | Giành lại khoá lớp của người khác | ✓ | ✓ | ⊘ ⑯ | ⊘ | ⊘ |

Công bố (54) là ranh giới quyền quan trọng nhất. `scheduler` xếp được nhưng **không tự công bố** — phải có người ở cấp ban giám hiệu duyệt. Đây là phản ánh đúng quy trình hành chính ở trường phổ thông: thời khoá biểu là văn bản có chữ ký hiệu trưởng.

### 2.8 Vận hành theo ngày

| # | Hành động | owner | admin | scheduler | teacher | viewer |
|---|---|:--:|:--:|:--:|:--:|:--:|
| 58 | Xem lịch dạy thay | ✓ | ✓ | ✓ | R ⑰ | ⊘ |
| 59 | Tạo lịch dạy thay | ✓ | ✓ | ✓ | ⊘ | ⊘ |
| 60 | Huỷ tiết theo ngày | ✓ | ✓ | ✓ | ⊘ | ⊘ |
| 61 | Báo nghỉ (đề xuất) | — | — | — | ✓ | ⊘ |

### 2.9 Báo cáo, nhập, xuất

| # | Hành động | owner | admin | scheduler | teacher | viewer |
|---|---|:--:|:--:|:--:|:--:|:--:|
| 62 | Xem báo cáo tải giảng dạy toàn trường | ✓ | ✓ | ✓ | ⊘ | ⊘ |
| 63 | Xem thống kê tiết trống, sử dụng phòng | ✓ | ✓ | ✓ | ⊘ | ⊘ |
| 64 | Xuất Excel / PDF toàn trường | ✓ | ✓ | ✓ | ⊘ | R ⑱ |
| 65 | Xuất thời khoá biểu của riêng mình | — | — | — | ✓ | ⊘ |
| 66 | Tải file `.ics` cá nhân | ✓ | ✓ | ✓ | ✓ | ⊘ |
| 67 | Nhập dữ liệu từ Excel | ✓ | ✓ | ⊘ | ⊘ | ⊘ |
| 68 | Quản lý trang công khai (bật/tắt, đổi mã truy cập) | ✓ | ✓ | ⊘ | ⊘ | ⊘ |

---

## 3. Các điều kiện

| # | Điều kiện |
|---|---|
| ① | Chỉ xoá được khi không còn thời khoá biểu ở trạng thái `published`. Yêu cầu gõ đúng tên trường để xác nhận. |
| ② | `admin` không thao tác được lên tài khoản có vai trò `owner`, và không nâng ai lên `owner`. |
| ③ | Chuyển quyền `owner` cho một thành viên đang hoạt động. Người chuyển tự động xuống `admin`. Trường luôn phải có đúng một `owner`. |
| ④ | `scheduler` chỉ xem được nhật ký của chính mình. |
| ⑤ | Không xoá được năm học đang `is_active`, hoặc năm có thời khoá biểu đã công bố. |
| ⑥ | Trong 14 ngày kể từ khi áp dụng, và chưa có thời khoá biểu nào được công bố ở năm mới. |
| ⑦ | Giáo viên chỉ thấy họ tên, tổ bộ môn, môn dạy của đồng nghiệp. **Không** thấy số điện thoại, email, định mức tiết, lịch bận. |
| ⑧ | Chỉ thấy phân công của chính mình và của lớp mình chủ nhiệm. |
| ⑨ | Chỉ lịch bận của chính mình. |
| ⑩ | Chỉ khi trường bật `settings.allowTeacherAvailabilityRequest`. Ghi vào bảng đề xuất, **không ghi thẳng** vào `availability_slots`. |
| ⑪ | Xem chi tiết ở mục 4 — phạm vi bị giới hạn theo dòng. |
| ⑫ | Chỉ với các lớp mà người đó đang giữ khoá mềm. |
| ⑬ | Không chạy được khi có người khác đang giữ khoá lớp. |
| ⑭ | `scheduler` chỉ dừng được job do chính mình khởi tạo. |
| ⑮ | Không xoá được bản đang hoặc đã từng ở trạng thái `published` — chỉ chuyển sang `archived`. |
| ⑯ | `scheduler` chỉ giành lại được khoá đã im lặng quá 5 phút. |
| ⑰ | Chỉ các tiết liên quan tới mình: mình dạy thay, hoặc người khác dạy thay cho mình. |
| ⑱ | `viewer` chỉ xuất được bản đã công bố, và chỉ định dạng PDF. |

---

## 4. Phạm vi theo dòng của vai trò `teacher`

Đây là phần dễ sai nhất, vì phân quyền cấp hành động không đủ — cùng một hành động "xem thời khoá biểu" cho ra tập dữ liệu khác nhau tuỳ người.

### 4.1 Quy tắc

Giáo viên `t` (đã liên kết `teachers.user_id = current_user`) được xem một tiết học khi thoả **ít nhất một** điều kiện:

1. Tiết đó do chính `t` dạy — `lesson_teachers.teacher_id = t`
2. Tiết đó thuộc lớp mà `t` chủ nhiệm — `classes.homeroom_teacher_id = t`
3. Thời khoá biểu đã ở trạng thái `published` **và** trường bật `settings.teacherSeeAllPublished`

Điều kiện 3 mặc định **bật**. Hầu hết trường muốn giáo viên xem được thời khoá biểu toàn trường sau khi công bố — để biết tìm đồng nghiệp ở đâu, phòng nào trống. Nhưng vẫn cho tắt, vì một số trường coi đây là thông tin nội bộ ban giám hiệu.

Trong mọi trường hợp, giáo viên **không bao giờ** thấy bản nháp.

### 4.2 Cài đặt bằng SQL

Hai bẫy PostgreSQL khi viết policy này:

1. **Policy permissive mặc định OR với nhau.** Nếu để `teacher_scope` là policy thường, nó bị OR-che bởi `tenant_isolation` (cho phép toàn bộ trường) — giáo viên vẫn thấy tất cả. Phải dùng `AS RESTRICTIVE` để AND vào kết quả.
2. **Đệ quy policy.** Hàm kiểm tra đọc lại `lesson_teachers` từ bên trong policy của chính bảng đó sẽ đệ quy vô hạn. Tách thành hàm `SECURITY DEFINER` và **không FORCE RLS** ở các bảng con (`lesson_classes`, `lesson_teachers`) — hàm chạy với quyền chủ bảng nên thoát RLS, còn app kết nối bằng `app_role` thì vẫn bị ràng buộc bình thường.

Toàn bộ khối dưới đây đã cài đặt trong `tkb_schema.sql` mục 12; chép ra đây để đọc liền mạch:

```sql
CREATE OR REPLACE FUNCTION current_app_user_id() RETURNS uuid AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION current_teacher_id() RETURNS uuid AS $$
    SELECT t.id FROM teachers t
    JOIN school_years y ON y.id = t.school_year_id
    WHERE t.user_id = current_app_user_id()
      AND t.school_id = current_school_id()
      AND y.is_active
    LIMIT 1;
$$ LANGUAGE sql STABLE;

-- SECURITY DEFINER + bảng con không FORCE RLS: tránh đệ quy policy.
CREATE OR REPLACE FUNCTION teacher_can_see_lesson(p_lesson_id uuid, p_timetable_id uuid)
RETURNS boolean AS $$
    SELECT COALESCE(current_setting('app.current_role', true), '') <> 'teacher'
        OR EXISTS (SELECT 1 FROM lesson_teachers lt
                    WHERE lt.lesson_id = p_lesson_id
                      AND lt.teacher_id = current_teacher_id())
        OR EXISTS (SELECT 1 FROM lesson_classes lc
                    JOIN classes c ON c.id = lc.class_id
                    WHERE lc.lesson_id = p_lesson_id
                      AND c.homeroom_teacher_id = current_teacher_id())
        OR ((SELECT status FROM timetables WHERE id = p_timetable_id) = 'published'
            AND (SELECT (settings->>'teacherSeeAllPublished')::boolean FROM schools
                 WHERE id = current_school_id()) IS NOT FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE POLICY teacher_scope ON lessons
    AS RESTRICTIVE FOR SELECT
    USING (teacher_can_see_lesson(lessons.id, lessons.timetable_id));
```

Đặt luật ở tầng cơ sở dữ liệu thay vì chỉ ở tầng ứng dụng. Lý do: sẽ có lúc ai đó viết một endpoint báo cáo mới và quên lọc — RLS bắt được, còn `if (role === 'teacher')` rải rác trong code thì không.

### 4.3 Che thông tin cá nhân đồng nghiệp

Điều kiện ⑦ ở trên cần một khung nhìn riêng, vì `teachers` chứa số điện thoại và email:

```sql
CREATE VIEW v_teachers_public AS
SELECT id, school_id, school_year_id, department_id, code,
       full_name, short_name, is_active,
       CASE WHEN id = current_teacher_id() THEN email END AS email,
       CASE WHEN id = current_teacher_id() THEN phone END AS phone,
       CASE WHEN id = current_teacher_id() THEN max_periods_per_week END AS max_periods_per_week
FROM teachers;
```

Endpoint `GET /teachers` trả từ khung nhìn này khi vai trò là `teacher`. Đây cũng là yêu cầu của Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân — số điện thoại giáo viên là dữ liệu cá nhân, không chia sẻ rộng hơn mức cần thiết.

---

## 5. Cài đặt ở tầng ứng dụng

### 5.1 Khai báo quyền

Không rải `if (role === ...)` khắp nơi. Khai báo một bảng duy nhất:

```ts
export const PERMISSIONS = {
  'school.update':        ['owner','admin'],
  'school.delete':        ['owner'],
  'member.invite':        ['owner','admin'],
  'billing.manage':       ['owner'],
  'catalog.write':        ['owner','admin'],
  'assignment.write':     ['owner','admin'],
  'constraint.write':     ['owner','admin','scheduler'],
  'timetable.read.draft': ['owner','admin','scheduler'],
  'lesson.write':         ['owner','admin','scheduler'],
  'timetable.publish':    ['owner','admin'],
  'solver.run':           ['owner','admin','scheduler'],
  'import.run':           ['owner','admin'],
  'report.read':          ['owner','admin','scheduler'],
  'self.read':            ['owner','admin','scheduler','teacher'],
  // ...
} as const;

export type Permission = keyof typeof PERMISSIONS;
```

```ts
@Permissions('lesson.write')
@UseGuards(AuthGuard, SchoolGuard, PermissionGuard, ClassLockGuard)
@Patch('lessons/:id/move')
async move(...) {}
```

`ClassLockGuard` kiểm tra riêng điều kiện ⑫ — khoá mềm không phải quyền, nó là trạng thái tạm thời, nên tách thành guard riêng để thông báo lỗi khác nhau (403 "không đủ quyền" vs 409 "đang bị khoá").

### 5.2 Đồng bộ với giao diện

Access token chứa vai trò; client tính sẵn tập quyền và ẩn các nút không dùng được. **Nhưng ẩn nút không phải là bảo mật** — mọi endpoint vẫn kiểm tra độc lập ở server. Client ẩn nút để giao diện gọn, không phải để chặn.

```ts
// React
const can = usePermissions();
{can('timetable.publish') && <button>Công bố</button>}
```

### 5.3 Kiểm thử

Bộ kiểm thử tối thiểu — mỗi vai trò × mỗi nhóm endpoint:

```ts
describe('Phân quyền', () => {
  for (const role of ['owner','admin','scheduler','teacher','viewer']) {
    it(`${role}: chỉ gọi được đúng các endpoint được phép`);
  }
  it('teacher không thấy tiết của lớp khác khi TKB còn là bản nháp');
  it('teacher chủ nhiệm thấy toàn bộ tiết của lớp mình');
  it('teacher không thấy số điện thoại đồng nghiệp');
  it('admin không đổi được vai trò của owner');
  it('trường luôn còn đúng một owner sau mọi thao tác');   // ★
  it('scheduler không công bố được thời khoá biểu');
  it('scheduler không sửa được tiết của lớp đang bị người khác khoá');
  it('viewer chỉ tải được PDF của bản đã công bố');
});
```

Ca đánh dấu ★ quan trọng nhất: nếu `owner` duy nhất tự hạ vai trò hoặc tự gỡ mình khỏi trường, trường đó sẽ mất quyền quản trị vĩnh viễn và chỉ có đội hỗ trợ can thiệp thủ công mới sửa được. Chặn ở cả tầng ứng dụng lẫn ràng buộc cơ sở dữ liệu:

```sql
CREATE OR REPLACE FUNCTION guard_last_owner() RETURNS trigger AS $$
BEGIN
  IF (SELECT COUNT(*) FROM school_members
       WHERE school_id = COALESCE(OLD.school_id, NEW.school_id)
         AND role = 'owner' AND status = 'active') = 0 THEN
    RAISE EXCEPTION 'Trường phải luôn có ít nhất một chủ sở hữu';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_guard_last_owner
  AFTER UPDATE OR DELETE ON school_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_last_owner();
```

`DEFERRABLE INITIALLY DEFERRED` cho phép thao tác chuyển quyền `owner` (hạ người cũ, nâng người mới trong cùng transaction) chạy được, chỉ kiểm tra ở thời điểm commit.
