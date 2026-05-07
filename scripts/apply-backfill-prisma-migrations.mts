// Aplica scripts/backfill-prisma-migrations.sql en la DB apuntada por
// $env:DATABASE_URL, statement por statement. Idempotente.
//
// Uso:
//   $env:DATABASE_URL = "postgresql://..."
//   npx tsx scripts/apply-backfill-prisma-migrations.mts
//
// Reporta cuántas filas se insertaron (0 si re-corres y todas ya estaban).

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const SQL_FILE = "scripts/backfill-prisma-migrations.sql";

function splitSql(raw: string): string[] {
  // Strip line comments (-- ...) — no comments span statements en el backfill.
  const noComments = raw
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");

  return noComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main() {
  const sql = readFileSync(SQL_FILE, "utf-8");
  const statements = splitSql(sql);

  console.log(`Backfill: ${statements.length} statements en ${SQL_FILE}`);

  const prisma = new PrismaClient();

  let totalInserted = 0;
  let totalSkipped = 0;
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.replace(/\s+/g, " ").slice(0, 80);
    try {
      const result = await prisma.$executeRawUnsafe(stmt);
      // $executeRawUnsafe devuelve filas afectadas para INSERT/UPDATE/DELETE.
      // Para CREATE TABLE/EXTENSION devuelve 0 (no hay filas).
      if (stmt.toUpperCase().startsWith("INSERT")) {
        if (result === 1) totalInserted++;
        else totalSkipped++;
      }
      console.log(`  [${i + 1}/${statements.length}] OK (rows=${result}) :: ${preview}`);
    } catch (e) {
      console.error(`  [${i + 1}/${statements.length}] FAIL :: ${preview}`);
      console.error(e);
      throw e;
    }
  }

  console.log(`\nResultado: ${totalInserted} migraciones insertadas, ${totalSkipped} skipped (ya existían).`);

  // Verificación post-aplicación
  const rows = await prisma.$queryRaw<
    { migration_name: string; finished_at: Date | null; applied_steps_count: number }[]
  >`
    SELECT migration_name, finished_at, applied_steps_count
    FROM _prisma_migrations
    ORDER BY started_at ASC
  `;
  console.log(`\n_prisma_migrations ahora tiene ${rows.length} filas:`);
  for (const r of rows) {
    console.log(`  ${r.migration_name}  finished=${r.finished_at?.toISOString()}  steps=${r.applied_steps_count}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
