import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const timetables = sqliteTable(
  "timetables",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    name: text("name").notNull(),
    assignmentsJson: text("assignments_json").notNull(),
    scheduleJson: text("schedule_json").notNull(),
    unresolvedJson: text("unresolved_json").notNull().default("[]"),
    lessonCount: integer("lesson_count").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("timetables_owner_updated_idx").on(table.ownerEmail, table.updatedAt)],
);

export const schoolProfiles = sqliteTable("school_profiles", {
  ownerEmail: text("owner_email").primaryKey(),
  schoolName: text("school_name").notNull().default("Trường của tôi"),
  schoolYear: text("school_year").notNull().default("2026-2027"),
  campusesJson: text("campuses_json").notNull().default("[]"),
  teachersJson: text("teachers_json").notNull().default("[]"),
  classesJson: text("classes_json").notNull().default("[]"),
  subjectsJson: text("subjects_json").notNull().default("[]"),
  roomsJson: text("rooms_json").notNull().default("[]"),
  gradesJson: text("grades_json").notNull().default("[]"),
  periodsJson: text("periods_json").notNull().default("[]"),
  assignmentsJson: text("assignments_json").notNull().default("[]"),
  homeroomsJson: text("homerooms_json").notNull().default("[]"),
  configJson: text("config_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull(),
});

export const publicShares = sqliteTable(
  "public_shares",
  {
    token: text("token").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    scope: text("scope").notNull(),
    label: text("label").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("public_shares_owner_idx").on(table.ownerEmail)],
);

export const userAccounts = sqliteTable("user_accounts", {
  email: text("email").primaryKey(),
  fullName: text("full_name").notNull(),
  phone: text("phone").notNull().default(""),
  school: text("school").notNull(),
  province: text("province").notNull().default(""),
  role: text("role").notNull().default("user"),
  licenseStatus: text("license_status").notNull().default("trial"),
  licenseKey: text("license_key"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const licenseKeys = sqliteTable(
  "license_keys",
  {
    key: text("key").primaryKey(),
    durationDays: integer("duration_days").notNull().default(365),
    maxActivations: integer("max_activations").notNull().default(1),
    usedCount: integer("used_count").notNull().default(0),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("license_keys_creator_idx").on(table.createdBy)],
);
