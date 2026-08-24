/**
 * Migration runner tối giản — áp dụng các file .sql theo thứ tự tên,
 * ghi lại vào bảng _migrations, mỗi file một transaction.
 * Chạy: npm run db:migrate  (từ apps/api hoặc root)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'db', 'migrations');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Thiếu DATABASE_URL (xem .env.example)');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { prepare: false });

async function main() {
  await sql`CREATE TABLE IF NOT EXISTS _migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;

  const applied = new Set(
    (await sql`SELECT filename FROM _migrations`).map((r) => r.filename)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (!files.length) {
    console.log('Không có migration nào.');
    return;
  }

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`= ${file} (đã áp dụng)`);
      continue;
    }
    const body = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const t0 = Date.now();
    await sql.begin(async (tx) => {
      // Migration chứa CREATE POLICY/DO block — chạy như một script nguyên vẹn
      await tx.unsafe(body);
      await tx`INSERT INTO _migrations (filename) VALUES (${file})`;
    });
    console.log(`+ ${file} (${Date.now() - t0}ms)`);
  }
  console.log('Xong.');
}

main()
  .catch((e) => { console.error('Migration thất bại:', e.message); process.exitCode = 1; })
  .finally(() => sql.end());
