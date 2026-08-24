-- =============================================================================
--  TKB SaaS — Schema PostgreSQL cho hệ thống xếp thời khóa biểu đa trường
--  Target: PostgreSQL 15+
--  Quy ước:
--    - Mọi bảng thuộc phạm vi trường đều mang school_id (phục vụ RLS + index)
--    - PK dùng uuid (gen_random_uuid), timestamps dùng timestamptz
--    - day_of_week: 1 = Thứ Hai ... 7 = Chủ Nhật (chuẩn ISO)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;


-- =============================================================================
--  0. ENUM TYPES
-- =============================================================================

CREATE TYPE school_level      AS ENUM ('primary','secondary','high','vocational','college','other');
CREATE TYPE member_role       AS ENUM ('owner','admin','scheduler','teacher','viewer');
CREATE TYPE account_status    AS ENUM ('invited','active','disabled');
CREATE TYPE session_kind      AS ENUM ('morning','afternoon','evening');
CREATE TYPE room_kind         AS ENUM ('standard','lab','computer','gym','art','music','hall','other');
CREATE TYPE slot_preference   AS ENUM ('available','busy','preferred','avoid');
CREATE TYPE constraint_scope  AS ENUM ('global','teacher','class','subject','room','assignment');
CREATE TYPE constraint_hardness AS ENUM ('hard','soft');
CREATE TYPE timetable_status  AS ENUM ('draft','scheduling','ready','published','archived');
CREATE TYPE job_status        AS ENUM ('queued','running','succeeded','failed','cancelled');
CREATE TYPE conflict_kind     AS ENUM ('teacher_overlap','class_overlap','room_overlap',
                                       'missing_periods','excess_periods','constraint_violation');
CREATE TYPE subscription_status AS ENUM ('trialing','active','past_due','cancelled','expired');
CREATE TYPE import_status     AS ENUM ('pending','processing','succeeded','failed');


-- =============================================================================
--  0.5 HÀM NGỮ CẢNH PHIÊN
--     Đặt sớm vì các policy RLS ở phần sau tham chiếu ngay khi CREATE.
--     Hợp đồng đầy đủ xem mục 12.
-- =============================================================================

CREATE OR REPLACE FUNCTION current_school_id() RETURNS uuid AS $$
    SELECT NULLIF(current_setting('app.current_school_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION current_app_user_id() RETURNS uuid AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;


-- =============================================================================
--  1. TENANCY — Trường, người dùng, phân quyền
-- =============================================================================

-- Mỗi "school" là một tenant. Dữ liệu cách ly bằng school_id + RLS.
CREATE TABLE schools (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            citext UNIQUE NOT NULL,              -- dùng cho URL công khai: /tkb/thpt-le-quy-don
    name            text NOT NULL,
    level           school_level NOT NULL DEFAULT 'secondary',
    province_code   text,
    district_code   text,
    address         text,
    phone           text,
    email           citext,
    logo_url        text,
    timezone        text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    locale          text NOT NULL DEFAULT 'vi',
    status          account_status NOT NULL DEFAULT 'active',
    settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

-- Tài khoản toàn cục. Một người có thể thuộc nhiều trường (GV thỉnh giảng, cụm trường).
CREATE TABLE users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           citext UNIQUE,
    phone           text UNIQUE,
    password_hash   text,
    full_name       text NOT NULL,
    avatar_url      text,
    status          account_status NOT NULL DEFAULT 'active',
    email_verified_at timestamptz,
    last_login_at   timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_identity_chk CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE school_members (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            member_role NOT NULL DEFAULT 'viewer',
    status          account_status NOT NULL DEFAULT 'active',
    invited_by      uuid REFERENCES users(id),
    joined_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (school_id, user_id)
);
CREATE INDEX ON school_members (user_id);

CREATE TABLE invitations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    email           citext NOT NULL,
    role            member_role NOT NULL DEFAULT 'teacher',
    token_hash      text NOT NULL UNIQUE,
    expires_at      timestamptz NOT NULL,
    accepted_at     timestamptz,
    created_by      uuid REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      text NOT NULL UNIQUE,
    user_agent      text,
    ip              inet,
    expires_at      timestamptz NOT NULL,
    revoked_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON refresh_tokens (user_id) WHERE revoked_at IS NULL;


-- =============================================================================
--  2. BILLING — Gói dịch vụ SaaS
-- =============================================================================

CREATE TABLE plans (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text UNIQUE NOT NULL,          -- free / pro / enterprise
    name            text NOT NULL,
    price_monthly   numeric(12,0) NOT NULL DEFAULT 0,   -- VND
    price_yearly    numeric(12,0) NOT NULL DEFAULT 0,
    max_classes     int,                           -- NULL = không giới hạn
    max_teachers    int,
    max_school_years int,
    features        jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active       boolean NOT NULL DEFAULT true,
    sort_order      int NOT NULL DEFAULT 0
);

CREATE TABLE subscriptions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    plan_id         uuid NOT NULL REFERENCES plans(id),
    status          subscription_status NOT NULL DEFAULT 'trialing',
    trial_ends_at   timestamptz,
    current_period_start timestamptz NOT NULL DEFAULT now(),
    current_period_end   timestamptz,
    cancel_at_period_end boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON subscriptions (school_id) WHERE status IN ('trialing','active','past_due');

CREATE TABLE invoices (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
    code            text UNIQUE NOT NULL,
    amount          numeric(12,0) NOT NULL,
    currency        text NOT NULL DEFAULT 'VND',
    paid_at         timestamptz,
    payment_ref     text,
    meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);


-- =============================================================================
--  3. NĂM HỌC & KHUNG THỜI GIAN
-- =============================================================================

CREATE TABLE school_years (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name            text NOT NULL,                 -- '2025-2026'
    start_date      date,
    end_date        date,
    is_active       boolean NOT NULL DEFAULT false,
    -- Các thứ trong tuần có học, ví dụ '{1,2,3,4,5,6}' = Thứ 2..Thứ 7
    active_days     smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (school_id, name)
);
CREATE UNIQUE INDEX ON school_years (school_id) WHERE is_active;

CREATE TABLE semesters (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    school_year_id  uuid NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
    name            text NOT NULL,                 -- 'Học kỳ I'
    ordinal         smallint NOT NULL,
    start_date      date,
    end_date        date,
    UNIQUE (school_year_id, ordinal)
);

-- Khung tiết học: Tiết 1 sáng, Tiết 2 sáng, ..., Tiết 1 chiều...
CREATE TABLE periods (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    school_year_id  uuid NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
    session         session_kind NOT NULL,
    ordinal         smallint NOT NULL,             -- số thứ tự trong buổi: 1..5
    name            text NOT NULL,                 -- 'Tiết 1'
    start_time      time,
    end_time        time,
    -- vị trí tuyệt đối trong ngày, dùng để sắp xếp & tính "tiết liền kề"
    day_position    smallint NOT NULL,
    UNIQUE (school_year_id, session, ordinal),
    UNIQUE (school_year_id, day_position)
);

-- Ngày nghỉ lễ — nguồn cho EXDATE trong xuất .ics (tkb_export_design.md mục 5)
-- và cho thống kê tiết thực dạy. school_id NULL = lễ quốc gia, áp dụng mọi trường;
-- trường tự thêm ngày nghỉ riêng của mình bằng bản ghi có school_id.
CREATE TABLE holidays (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id    uuid REFERENCES schools(id) ON DELETE CASCADE,
    name         text NOT NULL,                    -- 'Quốc khánh 2/9'
    holiday_date date NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
-- COALESCE trong index: Postgres coi hai giá trị NULL là khác nhau, nếu không
-- sẽ cho phép trùng ngày lễ quốc gia vô hạn lần
CREATE UNIQUE INDEX holidays_scope_date_uniq
    ON holidays (COALESCE(school_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 holiday_date);
CREATE INDEX ON holidays (holiday_date);

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON holidays
    USING (school_id IS NULL OR school_id = current_school_id())
    WITH CHECK (school_id = current_school_id());


-- =============================================================================
--  4. DANH MỤC — Khối, môn, lớp, giáo viên, phòng
-- =============================================================================

CREATE TABLE grades (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    school_year_id  uuid NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
    name            text NOT NULL,                 -- 'Khối 10'
    ordinal         smallint NOT NULL,
    UNIQUE (school_year_id, name)
);

CREATE TABLE departments (                          -- Tổ bộ môn
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    school_year_id  uuid NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
    name            text NOT NULL,                 -- 'Tổ Tự nhiên'
    head_teacher_id uuid,                          -- FK thêm sau khi có bảng teachers
    UNIQUE (school_year_id, name)
);

CREATE TABLE subjects (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    school_year_id  uuid NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
    department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
    code            text NOT NULL,                 -- 'TOAN'
    name            text NOT NULL,                 -- 'Toán học'
    short_name      text NOT NULL,                 -- 'Toán' (hiển thị trong ô lưới)
    color           text DEFAULT '#94a3b8',
    -- "độ khó": dùng để ưu tiên xếp vào tiết đầu buổi (ràng buộc mềm)
    difficulty      smallint NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
    needs_special_room boolean NOT NULL DEFAULT false,
    prefer_double_period boolean NOT NULL DEFAULT false,  -- ưu tiên xếp tiết đôi
    is_active       boolean NOT NULL DEFAULT true,
    sort_order      int NOT NULL DEFAULT 0,
    UNIQUE (school_year_id, code)
);

-- Số tiết chuẩn của một môn theo từng khối (VD: Toán khối 10 = 4 tiết/tuần)
CREATE TABLE subject_grade_configs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    subject_id      uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    grade_id        uuid NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
    periods_per_week smallint NOT NULL DEFAULT 0,
    UNIQUE (subject_id, grade_id)
);

CREATE TABLE rooms (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    school_year_id  uuid NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
    code            text NOT NULL,                 -- 'P.A201'
    name            text NOT NULL,
    kind            room_kind NOT NULL DEFAULT 'standard',
    capacity        smallint,
    building        text,
    floor           smallint,
    is_active       boolean NOT NULL DEFAULT true,
    UNIQUE (school_year_id, code)
);

-- Phòng bộ môn phục vụ những môn nào (phòng Lab có thể dùng cho Lý + Hóa)
CREATE TABLE room_subjects (
    room_id         uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    subject_id      uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    PRIMARY KEY (room_id, subject_id)
);

CREATE TABLE teachers (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    school_year_id  uuid NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
    user_id         uuid REFERENCES users(id) ON DELETE SET NULL,  -- NULL nếu chưa cấp tài khoản
    department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
    code            text NOT NULL,                 -- mã GV, dùng khi import Excel
    full_name       text NOT NULL,
    short_name      text,                          -- 'T.Hùng' hiển thị trong ô lưới
    gender          text,
    email           citext,
    phone           text,
    -- Giới hạn tải giảng dạy
    max_periods_per_week smallint,
    max_periods_per_day  smallint NOT NULL DEFAULT 8,
    max_days_per_week    smallint,                 -- muốn dồn tiết vào ít ngày
    is_active       boolean NOT NULL DEFAULT true,
    note            text,
    UNIQUE (school_year_id, code)
);
CREATE INDEX ON teachers (school_year_id) WHERE is_active;

ALTER TABLE departments
    ADD CONSTRAINT departments_head_fk
    FOREIGN KEY (head_teacher_id) REFERENCES teachers(id) ON DELETE SET NULL;

CREATE TABLE teacher_subjects (
    teacher_id      uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    subject_id      uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    is_primary      boolean NOT NULL DEFAULT true,
    PRIMARY KEY (teacher_id, subject_id)
);

CREATE TABLE classes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    school_year_id  uuid NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
    grade_id        uuid NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
    homeroom_teacher_id uuid REFERENCES teachers(id) ON DELETE SET NULL,
    home_room_id    uuid REFERENCES rooms(id) ON DELETE SET NULL,   -- phòng học cố định
    name            text NOT NULL,                 -- '10A1'
    size            smallint,
    -- Buổi học chính. Lớp học 2 buổi thì bật has_second_session.
    main_session    session_kind NOT NULL DEFAULT 'morning',
    has_second_session boolean NOT NULL DEFAULT false,
    max_periods_per_day smallint NOT NULL DEFAULT 5,
    sort_order      int NOT NULL DEFAULT 0,
    is_active       boolean NOT NULL DEFAULT true,
    UNIQUE (school_year_id, name)
);

-- Lớp con / nhóm — phục vụ TÁCH LỚP (một lớp chia 2 nhóm học 2 môn khác nhau
-- cùng một tiết, VD: Nhóm 1 học Tin, Nhóm 2 học Thể dục).
CREATE TABLE class_sections (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id        uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    name            text NOT NULL,                 -- 'Nhóm 1'
    size            smallint,
    UNIQUE (class_id, name)
);


-- =============================================================================
--  5. PHÂN CÔNG GIẢNG DẠY (assignments)
--     Đây là "đơn vị cần xếp". Mỗi assignment sinh ra N tiết cần đặt vào lưới.
--     Thiết kế con many-to-many để hỗ trợ đồng thời:
--       • Ghép lớp   → nhiều class trong assignment_classes
--       • Tách lớp   → assignment_classes trỏ tới class_section
--       • Nhiều GV   → nhiều dòng trong assignment_teachers
-- =============================================================================

CREATE TABLE assignments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    school_year_id  uuid NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
    semester_id     uuid REFERENCES semesters(id) ON DELETE CASCADE,  -- NULL = cả năm
    subject_id      uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    periods_per_week smallint NOT NULL CHECK (periods_per_week >= 0),
    -- Ràng buộc buổi: NULL = xếp buổi nào cũng được (lớp học 2 buổi)
    session         session_kind,
    required_room_id uuid REFERENCES rooms(id) ON DELETE SET NULL,
    -- Số cặp tiết đôi cần xếp (VD 4 tiết/tuần, double_periods=1 → 1 tiết đôi + 2 tiết đơn)
    double_periods  smallint NOT NULL DEFAULT 0,
    priority        smallint NOT NULL DEFAULT 0,   -- xếp trước nếu cao (môn khó bố trí)
    note            text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON assignments (school_year_id, subject_id);

CREATE TABLE assignment_classes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id   uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    class_id        uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    section_id      uuid REFERENCES class_sections(id) ON DELETE CASCADE,
    UNIQUE (assignment_id, class_id, section_id)
);
CREATE INDEX ON assignment_classes (class_id);

CREATE TABLE assignment_teachers (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id   uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    teacher_id      uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    is_primary      boolean NOT NULL DEFAULT true,
    -- Khi 2 GV chia nhau số tiết theo tuần chẵn/lẻ hoặc chia tiết
    periods_share   smallint,
    UNIQUE (assignment_id, teacher_id)
);
CREATE INDEX ON assignment_teachers (teacher_id);


-- =============================================================================
--  6. RÀNG BUỘC
--     6a. availability_slots — lưới bận/rảnh (GV nghỉ Thứ 7, phòng bảo trì...)
--         Đây là thứ UI kéo-thả "set nghỉ" ghi vào.
--     6b. constraints — luật dạng tham số, có phân loại cứng/mềm + trọng số
-- =============================================================================

CREATE TABLE availability_slots (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    school_year_id  uuid NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
    owner_type      constraint_scope NOT NULL CHECK (owner_type IN ('teacher','class','room')),
    owner_id        uuid NOT NULL,
    day_of_week     smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    period_id       uuid NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
    preference      slot_preference NOT NULL DEFAULT 'busy',
    reason          text,
    UNIQUE (owner_type, owner_id, day_of_week, period_id)
);
CREATE INDEX ON availability_slots (school_year_id, owner_type, owner_id);

-- Registry các loại luật xếp — trước đây kind là text tự do, dễ sinh typo
-- lệch giữa các môi trường. Thêm loại mới = INSERT một dòng, không cần migration.
CREATE TABLE constraint_kinds (
    kind        text PRIMARY KEY,
    description text NOT NULL,
    params_hint jsonb NOT NULL DEFAULT '{}'::jsonb   -- gợi ý cấu trúc params cho UI
);
INSERT INTO constraint_kinds (kind, description) VALUES
 ('max_periods_per_day',  'Số tiết tối đa của một đối tượng trong ngày'),
 ('no_gap',               'Không có tiết trống giữa hai tiết học trong buổi'),
 ('min_days_between',     'Khoảng cách tối thiểu giữa hai tiết cùng môn'),
 ('forbid_period',        'Cấm xếp vào ô thời gian cụ thể'),
 ('prefer_early',         'Ưu tiên tiết đầu buổi'),
 ('consecutive_limit',    'Giới hạn số tiết liên tiếp'),
 ('same_room_all_week',   'Một lớp dùng đúng một phòng cả tuần'),
 ('not_last_period',      'Không xếp vào tiết cuối buổi'),
 ('max_days_per_week',    'Số ngày đến trường tối đa trong tuần'),
 ('period_preference',    'Danh sách ô ưu tiên/tránh — mã V1–V3 trong tkb_solver_design.md');

CREATE TABLE constraints (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    school_year_id  uuid NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
    scope           constraint_scope NOT NULL,
    scope_id        uuid,                          -- NULL khi scope = 'global'
    -- kind ví dụ: max_periods_per_day | no_gap | min_days_between |
    --             forbid_period | prefer_early | consecutive_limit |
    --             same_room_all_week | not_last_period | max_days_per_week
    kind            text NOT NULL,
    hardness        constraint_hardness NOT NULL DEFAULT 'soft',
    weight          smallint NOT NULL DEFAULT 10 CHECK (weight BETWEEN 1 AND 100),
    params          jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON constraints (school_year_id, scope, scope_id) WHERE is_active;

ALTER TABLE constraints
    ADD CONSTRAINT constraints_kind_fk FOREIGN KEY (kind) REFERENCES constraint_kinds(kind);


-- =============================================================================
--  7. THỜI KHÓA BIỂU & TIẾT ĐÃ XẾP
--     Tách 3 bảng để RÀNG BUỘC CỨNG được DB tự bảo vệ:
--       lessons          = một tiết học vật lý (1 ô thời gian + 1 phòng)
--       lesson_classes   = các lớp/nhóm ngồi trong tiết đó  → chặn trùng lớp
--       lesson_teachers  = các GV đứng lớp tiết đó          → chặn trùng GV
--     Ghép lớp = 1 lesson có nhiều lesson_classes → hoàn toàn hợp lệ.
-- =============================================================================

CREATE TABLE timetables (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    school_year_id  uuid NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
    semester_id     uuid REFERENCES semesters(id) ON DELETE SET NULL,
    name            text NOT NULL,                 -- 'TKB HK1 - áp dụng 09/09'
    version         int NOT NULL DEFAULT 1,
    status          timetable_status NOT NULL DEFAULT 'draft',
    effective_from  date,
    effective_to    date,
    -- Điểm phạt tổng của các ràng buộc mềm; càng thấp càng tốt
    soft_score      int,
    hard_violations int NOT NULL DEFAULT 0,
    is_locked       boolean NOT NULL DEFAULT false,
    created_by      uuid REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON timetables (school_year_id, status);

CREATE TABLE lessons (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    timetable_id    uuid NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
    assignment_id   uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    subject_id      uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE, -- denormalize
    day_of_week     smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    period_id       uuid NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
    room_id         uuid REFERENCES rooms(id) ON DELETE SET NULL,
    -- Ghim: người dùng cố định tiết này, thuật toán auto không được đụng vào
    is_pinned       boolean NOT NULL DEFAULT false,
    -- Nhóm 2 lessons thành tiết đôi liên tiếp
    double_group_id uuid,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON lessons (timetable_id, day_of_week, period_id);
CREATE INDEX ON lessons (assignment_id);
-- Ràng buộc cứng: một phòng chỉ 1 tiết tại 1 ô thời gian
CREATE UNIQUE INDEX lessons_room_unique
    ON lessons (timetable_id, room_id, day_of_week, period_id)
    WHERE room_id IS NOT NULL;

CREATE TABLE lesson_classes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id       uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    -- Denormalize để RLS tự bảo vệ bảng con mà không phụ thuộc JOIN qua lessons.
    -- Trigger trg_*_school điền từ bản ghi cha khi INSERT (mục 7).
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    class_id        uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    section_id      uuid REFERENCES class_sections(id) ON DELETE CASCADE,
    -- Cột denormalize, được trigger đồng bộ từ lessons — cho phép DB tự chặn trùng
    timetable_id    uuid NOT NULL,
    day_of_week     smallint NOT NULL,
    period_id       uuid NOT NULL,
    section_key     uuid GENERATED ALWAYS AS
                      (COALESCE(section_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED
);
-- Ràng buộc cứng: một lớp (hoặc nhóm) không học 2 môn cùng lúc
CREATE UNIQUE INDEX lesson_classes_unique
    ON lesson_classes (timetable_id, class_id, section_key, day_of_week, period_id);
CREATE INDEX ON lesson_classes (lesson_id);

CREATE TABLE lesson_teachers (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id       uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,  -- như lesson_classes
    teacher_id      uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    timetable_id    uuid NOT NULL,
    day_of_week     smallint NOT NULL,
    period_id       uuid NOT NULL
);
-- Ràng buộc cứng: một GV không dạy 2 nơi cùng lúc
CREATE UNIQUE INDEX lesson_teachers_unique
    ON lesson_teachers (timetable_id, teacher_id, day_of_week, period_id);
CREATE INDEX ON lesson_teachers (lesson_id);

-- Trigger đồng bộ cột denormalize khi kéo-thả đổi ô thời gian của lesson
CREATE OR REPLACE FUNCTION sync_lesson_slot() RETURNS trigger AS $$
BEGIN
    UPDATE lesson_classes
       SET day_of_week = NEW.day_of_week, period_id = NEW.period_id,
           timetable_id = NEW.timetable_id
     WHERE lesson_id = NEW.id;
    UPDATE lesson_teachers
       SET day_of_week = NEW.day_of_week, period_id = NEW.period_id,
           timetable_id = NEW.timetable_id
     WHERE lesson_id = NEW.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_lesson_slot
    AFTER UPDATE OF day_of_week, period_id, timetable_id ON lessons
    FOR EACH ROW EXECUTE FUNCTION sync_lesson_slot();

-- Điền school_id từ bản ghi cha khi chèn vào bảng con: app không thể quên,
-- và giá trị luôn khớp cha nên policy RLS ở mục 12 không thể bị lách.
CREATE OR REPLACE FUNCTION derive_school_id_from_parent() RETURNS trigger AS $$
DECLARE pid uuid;
BEGIN
    IF TG_ARGV[0] = 'lessons' THEN
        SELECT school_id INTO pid FROM lessons WHERE id = NEW.lesson_id;
    ELSE
        SELECT school_id INTO pid FROM timetables WHERE id = NEW.timetable_id;
    END IF;
    IF pid IS NULL THEN
        RAISE EXCEPTION '%: không tìm thấy bản ghi cha (%)', TG_TABLE_NAME, TG_ARGV[0];
    END IF;
    NEW.school_id := pid;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lc_school BEFORE INSERT ON lesson_classes
    FOR EACH ROW EXECUTE FUNCTION derive_school_id_from_parent('lessons');
CREATE TRIGGER trg_lt_school BEFORE INSERT ON lesson_teachers
    FOR EACH ROW EXECUTE FUNCTION derive_school_id_from_parent('lessons');
-- Hai trigger cho timetable_conflicts / timetable_snapshots đặt sau khi
-- các bảng này được tạo (xem cuối mục 8) — CREATE TRIGGER cần bảng tồn tại.

-- Mọi thay đổi của lessons làm tăng version của timetable — nền cho ETag
-- (tkb_api_spec.md mục 3.4) và khoá lạc quan expectedVersion (mục 4.1).
-- Tách 3 trigger vì transition table: OLD TABLE chỉ hợp lệ với UPDATE/DELETE,
-- NEW TABLE chỉ hợp lệ với INSERT/UPDATE.
CREATE OR REPLACE FUNCTION bump_timetable_version() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE timetables SET version = version + 1, updated_at = now()
         WHERE id IN (SELECT DISTINCT timetable_id FROM new_t);
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE timetables SET version = version + 1, updated_at = now()
         WHERE id IN (SELECT DISTINCT timetable_id FROM old_t);
    ELSE
        UPDATE timetables SET version = version + 1, updated_at = now()
         WHERE id IN (SELECT DISTINCT timetable_id FROM new_t
                      UNION
                      SELECT DISTINCT timetable_id FROM old_t);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bump_ver_ins AFTER INSERT ON lessons
    REFERENCING NEW TABLE AS new_t
    FOR EACH STATEMENT EXECUTE FUNCTION bump_timetable_version();
CREATE TRIGGER trg_bump_ver_upd AFTER UPDATE ON lessons
    REFERENCING OLD TABLE AS old_t NEW TABLE AS new_t
    FOR EACH STATEMENT EXECUTE FUNCTION bump_timetable_version();
CREATE TRIGGER trg_bump_ver_del AFTER DELETE ON lessons
    REFERENCING OLD TABLE AS old_t
    FOR EACH STATEMENT EXECUTE FUNCTION bump_timetable_version();

-- Kết quả kiểm tra, cache lại để hiển thị bảng "Danh sách lỗi"
CREATE TABLE timetable_conflicts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    timetable_id    uuid NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,  -- cho RLS, trg_tconf_school điền
    kind            conflict_kind NOT NULL,
    severity        constraint_hardness NOT NULL,
    subject_ref     jsonb NOT NULL,                -- {teacher_id, class_id, day, period_id...}
    message         text NOT NULL,
    penalty         int NOT NULL DEFAULT 0,
    detected_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON timetable_conflicts (timetable_id, severity);

-- Khoá mềm cấp lớp khi nhiều người xếp cùng lúc — vòng đời, takeover, API xem
-- tkb_api_spec.md mục 6. UNIQUE (timetable_id, class_id) khiến việc giành khoá
-- là nguyên tử ở tầng CSDL: không cần khoá Redis, không lo điều kiện đua.
CREATE TABLE timetable_locks (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id     uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    timetable_id  uuid NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
    class_id      uuid REFERENCES classes(id) ON DELETE CASCADE,  -- NULL = khoá cả bảng (solver)
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id text,
    acquired_at   timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    UNIQUE (timetable_id, class_id)
);
CREATE INDEX ON timetable_locks (expires_at);


-- =============================================================================
--  8. SOLVER — Job xếp tự động chạy nền + snapshot để undo/rollback
-- =============================================================================

CREATE TABLE scheduling_jobs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    timetable_id    uuid NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
    algorithm       text NOT NULL DEFAULT 'simulated_annealing', -- greedy | sa | tabu | cp_sat
    params          jsonb NOT NULL DEFAULT '{}'::jsonb,          -- {time_limit_s, seed, scope}
    status          job_status NOT NULL DEFAULT 'queued',
    progress        smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    best_soft_score int,
    hard_violations int,
    log             text,
    error           text,
    requested_by    uuid REFERENCES users(id),
    queued_at       timestamptz NOT NULL DEFAULT now(),
    started_at      timestamptz,
    finished_at     timestamptz
);
CREATE INDEX ON scheduling_jobs (timetable_id, status);
CREATE INDEX ON scheduling_jobs (status) WHERE status IN ('queued','running');

CREATE TABLE timetable_snapshots (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    timetable_id    uuid NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,  -- cho RLS
    label           text,
    -- Toàn bộ lessons + quan hệ, nén dạng JSON để khôi phục nhanh
    payload         jsonb NOT NULL,
    soft_score      int,
    created_by      uuid REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON timetable_snapshots (timetable_id, created_at DESC);

-- Nối tiếp khối trigger ở mục 7: điền school_id cho hai bảng kết quả
CREATE TRIGGER trg_tconf_school BEFORE INSERT ON timetable_conflicts
    FOR EACH ROW EXECUTE FUNCTION derive_school_id_from_parent('timetables');
CREATE TRIGGER trg_tsnap_school BEFORE INSERT ON timetable_snapshots
    FOR EACH ROW EXECUTE FUNCTION derive_school_id_from_parent('timetables');


-- =============================================================================
--  9. VẬN HÀNH — Dạy thay, nghỉ đột xuất, công bố
-- =============================================================================

CREATE TABLE substitutions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    lesson_id       uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    on_date         date NOT NULL,
    original_teacher_id  uuid REFERENCES teachers(id) ON DELETE SET NULL,
    substitute_teacher_id uuid REFERENCES teachers(id) ON DELETE SET NULL,
    new_room_id     uuid REFERENCES rooms(id) ON DELETE SET NULL,
    is_cancelled    boolean NOT NULL DEFAULT false,
    reason          text,
    created_by      uuid REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (lesson_id, on_date)
);
CREATE INDEX ON substitutions (school_id, on_date);

CREATE TABLE publications (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    timetable_id    uuid NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
    public_slug     citext UNIQUE NOT NULL,         -- /p/thpt-abc-hk1
    is_public       boolean NOT NULL DEFAULT true,
    access_code     text,                           -- nếu muốn giới hạn bằng mã
    published_at    timestamptz NOT NULL DEFAULT now(),
    published_by    uuid REFERENCES users(id)
);


-- =============================================================================
--  10. HỖ TRỢ — Import Excel, audit log
-- =============================================================================

CREATE TABLE import_jobs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    school_year_id  uuid REFERENCES school_years(id) ON DELETE CASCADE,
    target          text NOT NULL,                  -- teachers | classes | subjects | assignments
    file_url        text NOT NULL,
    status          import_status NOT NULL DEFAULT 'pending',
    total_rows      int,
    success_rows    int,
    errors          jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by      uuid REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
    id              bigserial PRIMARY KEY,
    school_id       uuid REFERENCES schools(id) ON DELETE CASCADE,
    user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
    action          text NOT NULL,                  -- lesson.move | timetable.publish
    entity_type     text,
    entity_id       uuid,
    before          jsonb,
    after           jsonb,
    ip              inet,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_logs (school_id, created_at DESC);


-- =============================================================================
--  11. VIEWS TIỆN DỤNG
-- =============================================================================

-- Tiến độ xếp: mỗi phân công đã xếp được bao nhiêu / cần bao nhiêu tiết
CREATE VIEW v_assignment_progress AS
SELECT a.id                AS assignment_id,
       a.school_id,
       a.school_year_id,
       a.subject_id,
       a.periods_per_week  AS required,
       COUNT(l.id)         AS scheduled,
       a.periods_per_week - COUNT(l.id) AS remaining,
       l.timetable_id
FROM assignments a
LEFT JOIN lessons l ON l.assignment_id = a.id
GROUP BY a.id, l.timetable_id;

-- Lưới TKB phẳng, dùng cho API GET /timetables/:id/grid
CREATE VIEW v_timetable_grid AS
SELECT l.timetable_id,
       l.id            AS lesson_id,
       l.day_of_week,
       p.session,
       p.ordinal       AS period_ordinal,
       p.day_position,
       c.id            AS class_id,
       c.name          AS class_name,
       cs.name         AS section_name,
       s.short_name    AS subject_name,
       s.color         AS subject_color,
       t.short_name    AS teacher_name,
       t.id            AS teacher_id,
       r.code          AS room_code,
       l.is_pinned
FROM lessons l
JOIN periods p        ON p.id = l.period_id
JOIN lesson_classes lc ON lc.lesson_id = l.id
JOIN classes c        ON c.id = lc.class_id
LEFT JOIN class_sections cs ON cs.id = lc.section_id
JOIN subjects s       ON s.id = l.subject_id
LEFT JOIN lesson_teachers lt ON lt.lesson_id = l.id
LEFT JOIN teachers t  ON t.id = lt.teacher_id
LEFT JOIN rooms r     ON r.id = l.room_id;

-- Tải giảng dạy của giáo viên (kiểm tra vượt định mức)
CREATE VIEW v_teacher_workload AS
SELECT t.id AS teacher_id, t.school_year_id, t.full_name,
       t.max_periods_per_week,
       COALESCE(SUM(a.periods_per_week), 0) AS assigned_periods
FROM teachers t
LEFT JOIN assignment_teachers at ON at.teacher_id = t.id
LEFT JOIN assignments a ON a.id = at.assignment_id
GROUP BY t.id;


-- =============================================================================
--  12. ROW LEVEL SECURITY — Cách ly dữ liệu giữa các trường
--     Hợp đồng ngữ cảnh phiên — app PHẢI set đầu mỗi transaction:
--       SET LOCAL app.current_school_id = '<uuid>';    -- bắt buộc
--       SET LOCAL app.current_user_id   = '<uuid>';    -- dùng bởi current_teacher_id()
--       SET LOCAL app.current_role      = 'teacher';   -- bật phạm vi theo dòng của GV
--     PgBouncer mode transaction giữ được cả ba (SET LOCAL sống trong 1 transaction).
-- =============================================================================

-- Vai trò nhóm của ứng dụng; các role đăng nhập thật INHERIT từ đây.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_role') THEN
        CREATE ROLE app_role NOLOGIN;
    END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role;

-- Phạm vi theo dòng của giáo viên — đặc tả đầy đủ: tkb_permissions.md mục 4.
-- SECURITY DEFINER + các bảng con KHÔNG FORCE RLS (khối 12b): tránh đệ quy
-- vô hạn khi policy của lesson_teachers đọc lại chính lesson_teachers.
CREATE OR REPLACE FUNCTION current_teacher_id() RETURNS uuid AS $$
    SELECT t.id FROM teachers t
    JOIN school_years y ON y.id = t.school_year_id
    WHERE t.user_id = current_app_user_id()
      AND t.school_id = current_school_id()
      AND y.is_active
    LIMIT 1;
$$ LANGUAGE sql STABLE;

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
            AND (SELECT (settings->>'teacherSeeAllPublished')::boolean
                   FROM schools WHERE id = current_school_id()) IS NOT FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- 12a. Bảng mang school_id riêng: cách ly thuần túy.
DO $$
DECLARE tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'school_years','semesters','periods','grades','departments','subjects',
        'subject_grade_configs','rooms','teachers','classes','class_sections',
        'assignments','availability_slots','constraints','timetables','lessons',
        'scheduling_jobs','substitutions','publications','import_jobs','audit_logs',
        'invoices','subscriptions'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING (school_id = current_school_id())
             WITH CHECK (school_id = current_school_id())', tbl);
    END LOOP;
END $$;

-- 12b. Bảng con của lessons và bảng kết quả: ENABLE nhưng KHÔNG FORCE.
-- Lý do: teacher_can_see_lesson() là SECURITY DEFINER (chạy với quyền chủ bảng)
-- cần đọc lesson_teachers/lesson_classes từ bên trong policy mà không đệ quy.
-- App kết nối bằng app_role (không phải chủ bảng) nên RLS vẫn hiệu lực bình thường.
DO $$
DECLARE tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'lesson_classes','lesson_teachers','timetable_conflicts','timetable_snapshots'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING (school_id = current_school_id())
             WITH CHECK (school_id = current_school_id())', tbl);
    END LOOP;
END $$;

-- ★ AS RESTRICTIVE là bắt buộc: hai policy permissive mặc định OR với nhau,
-- nếu để teacher_scope là policy thường thì tenant_isolation (cho phép toàn bộ
-- trường) sẽ che mất giới hạn của giáo viên. Restrictive AND vào kết quả.
CREATE POLICY teacher_scope ON lessons
    AS RESTRICTIVE FOR SELECT
    USING (teacher_can_see_lesson(lessons.id, lessons.timetable_id));

-- Chặn luôn việc sửa tiết ngoài phạm vi — lớp phòng thủ thứ hai sau PermissionGuard.
CREATE POLICY teacher_scope_write ON lessons
    AS RESTRICTIVE FOR UPDATE
    USING (teacher_can_see_lesson(lessons.id, lessons.timetable_id))
    WITH CHECK (teacher_can_see_lesson(lessons.id, lessons.timetable_id));

CREATE POLICY teacher_scope ON lesson_classes
    AS RESTRICTIVE FOR SELECT
    USING (teacher_can_see_lesson(lesson_id, timetable_id));

CREATE POLICY teacher_scope ON lesson_teachers
    AS RESTRICTIVE FOR SELECT
    USING (teacher_can_see_lesson(lesson_id, timetable_id));

-- 12c. Thành viên trường: thêm nhánh đọc dòng của chính mình — GET /auth/me
-- liệt kê các trường của user TRƯỚC khi người dùng chọn ngữ cảnh trường.
ALTER TABLE school_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_members
    USING (school_id = current_school_id() OR user_id = current_app_user_id())
    WITH CHECK (school_id = current_school_id());

-- 12d. Lời mời: KHÔNG FORCE — find_invitation() chạy SECURITY DEFINER để tra cứu
-- theo token TRƯỚC khi biết school_id (luồng chấp nhận lời mời chưa có ngữ cảnh).
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations
    USING (school_id = current_school_id())
    WITH CHECK (school_id = current_school_id());

CREATE OR REPLACE FUNCTION find_invitation(p_token_hash text) RETURNS invitations AS $$
    SELECT * FROM invitations
     WHERE token_hash = p_token_hash AND accepted_at IS NULL AND expires_at > now()
     LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
