// Diagnóstico del estado de _prisma_migrations en prod vs prisma/migrations local.
//
// Uso:
//   $env:DATABASE_URL = "postgresql://..."
//   npx tsx scripts/diagnose-prisma-migrations.mts
//
// Reporta:
//   1. Si la tabla _prisma_migrations existe (y su contenido si la tiene).
//   2. Tabla con cada migración local y su status: applied | pending | partial | drop_only.
//   3. Checksum SHA-256 (formato Prisma) de cada migration.sql.
//
// Heurística de status: parsea CREATE TABLE / CREATE TYPE ... AS ENUM /
// ALTER TABLE ... ADD COLUMN / ALTER TYPE ... ADD VALUE de cada migration.sql,
// y verifica contra information_schema/pg_catalog. Una migración con solo
// DROPs / triggers se marca drop_only (requiere chequeo manual).

import { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

const MIGRATIONS_DIR = "prisma/migrations";

interface MigrationArtifacts {
  tables: string[];
  enums: string[];
  columns: { table: string; column: string }[];
  enumValues: { type: string; value: string }[];
}

function parseMigrationSql(sql: string): MigrationArtifacts {
  const tables = Array.from(
    sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/gi)
  ).map((m) => m[1]);

  const enums = Array.from(
    sql.matchAll(/CREATE\s+TYPE\s+"([^"]+)"\s+AS\s+ENUM/gi)
  ).map((m) => m[1]);

  // ALTER TABLE "..."   ...   ADD COLUMN [IF NOT EXISTS] "..."
  // [^;]*? limita el alcance al statement actual (heurístico — falla con DO $$ blocks
  // que tienen ; internos, pero raras veces declaran columnas dentro).
  const columns = Array.from(
    sql.matchAll(
      /ALTER\s+TABLE\s+(?:ONLY\s+)?"([^"]+)"[^;]*?ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/gi
    )
  ).map((m) => ({ table: m[1], column: m[2] }));

  const enumValues = Array.from(
    sql.matchAll(
      /ALTER\s+TYPE\s+"([^"]+)"[^;]*?ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/gi
    )
  ).map((m) => ({ type: m[1], value: m[2] }));

  return { tables, enums, columns, enumValues };
}

interface PrismaMigrationRow {
  id: string;
  checksum: string;
  finished_at: Date | null;
  migration_name: string;
  rolled_back_at: Date | null;
  started_at: Date;
  applied_steps_count: number;
}

async function main() {
  const prisma = new PrismaClient();

  const tableExistsResult = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
    ) AS exists
  `;
  const prismaTableExists = Boolean(tableExistsResult[0]?.exists);

  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  STEP 1 — _prisma_migrations table");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`Exists in prod: ${prismaTableExists}`);

  if (prismaTableExists) {
    const rows = await prisma.$queryRaw<PrismaMigrationRow[]>`
      SELECT id, checksum, migration_name, started_at, finished_at,
             applied_steps_count, rolled_back_at
      FROM _prisma_migrations
      ORDER BY started_at ASC
    `;
    console.log(`Rows registered: ${rows.length}`);
    for (const r of rows) {
      const finished = r.finished_at ? r.finished_at.toISOString() : "NULL";
      const rolled = r.rolled_back_at ? r.rolled_back_at.toISOString() : "no";
      console.log(
        `  ${r.migration_name.padEnd(60)} finished=${finished}  rolled_back=${rolled}  steps=${r.applied_steps_count}`
      );
    }
  }

  // Local migrations
  const migDirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log(`  STEP 2 — ${migDirs.length} migraciones locales en prisma/migrations`);
  console.log("═══════════════════════════════════════════════════════════════════");

  // Snapshot de prod
  const tablesInProd = (
    await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
    `
  ).map((r) => r.table_name);

  const columnsInProd = await prisma.$queryRaw<
    { table_name: string; column_name: string }[]
  >`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
  `;

  const enumsInProd = await prisma.$queryRaw<{ typname: string }[]>`
    SELECT t.typname FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public' AND t.typtype = 'e'
  `;

  const enumValuesInProd = await prisma.$queryRaw<
    { typname: string; enumlabel: string }[]
  >`
    SELECT t.typname, e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public'
  `;

  const tableSet = new Set(tablesInProd);
  const enumSet = new Set(enumsInProd.map((e) => e.typname));
  const columnSet = new Set(
    columnsInProd.map((c) => `${c.table_name}.${c.column_name}`)
  );
  const enumValueSet = new Set(
    enumValuesInProd.map((e) => `${e.typname}::${e.enumlabel}`)
  );

  console.log(
    `Snapshot prod: ${tablesInProd.length} tablas, ${enumSet.size} enums, ${columnsInProd.length} columnas, ${enumValuesInProd.length} enum values`
  );
  console.log();

  console.log("| # | Migration | Status | Detalle |");
  console.log("|---|-----------|--------|---------|");

  const summary: Record<string, number> = {
    applied: 0,
    pending: 0,
    partial: 0,
    drop_only: 0,
    no_sql: 0,
  };

  let i = 1;
  for (const dir of migDirs) {
    const sqlPath = join(MIGRATIONS_DIR, dir, "migration.sql");
    if (!existsSync(sqlPath)) {
      console.log(`| ${i++} | ${dir} | no_sql | migration.sql no existe |`);
      summary.no_sql++;
      continue;
    }

    const sql = readFileSync(sqlPath, "utf-8");
    const arts = parseMigrationSql(sql);
    const checks: string[] = [];
    let missing = 0;
    let total = 0;

    for (const t of arts.tables) {
      total++;
      if (!tableSet.has(t)) {
        missing++;
        checks.push(`tabla:${t}`);
      }
    }
    for (const e of arts.enums) {
      total++;
      if (!enumSet.has(e)) {
        missing++;
        checks.push(`enum:${e}`);
      }
    }
    for (const c of arts.columns) {
      total++;
      if (!columnSet.has(`${c.table}.${c.column}`)) {
        missing++;
        checks.push(`col:${c.table}.${c.column}`);
      }
    }
    for (const v of arts.enumValues) {
      total++;
      if (!enumValueSet.has(`${v.type}::${v.value}`)) {
        missing++;
        checks.push(`enumValue:${v.type}::${v.value}`);
      }
    }

    let status: string;
    let detalle: string;
    if (total === 0) {
      // No CREATE artifacts — probably DROP-only or trigger-only migration
      const hasDrop = /DROP\s+(TABLE|TYPE|COLUMN|INDEX|TRIGGER|FUNCTION)/i.test(sql);
      if (hasDrop) {
        status = "drop_only";
        const dropMatch = sql.match(/DROP\s+\w+\s+(?:IF\s+EXISTS\s+)?[^;]*/i);
        detalle = `solo DROPs — chequear manualmente. Ejemplo: ${dropMatch?.[0]?.slice(0, 60) ?? "?"}`;
      } else {
        status = "drop_only";
        detalle = "sin CREATE/ADD detectables — chequear manualmente";
      }
      summary.drop_only++;
    } else if (missing === 0) {
      status = "applied";
      detalle = `${total}/${total} artifacts presentes`;
      summary.applied++;
    } else if (missing === total) {
      status = "pending";
      detalle = `0/${total} (faltan: ${checks.slice(0, 3).join(", ")}${checks.length > 3 ? "..." : ""})`;
      summary.pending++;
    } else {
      status = "partial";
      detalle = `${total - missing}/${total} (faltan: ${checks.slice(0, 3).join(", ")}${checks.length > 3 ? "..." : ""})`;
      summary.partial++;
    }

    console.log(`| ${i++} | ${dir} | ${status} | ${detalle} |`);
  }

  console.log("\nResumen:");
  for (const [k, v] of Object.entries(summary)) {
    if (v > 0) console.log(`  ${k}: ${v}`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log("  STEP 3 — Checksums SHA-256 (formato Prisma)");
  console.log("═══════════════════════════════════════════════════════════════════");
  for (const dir of migDirs) {
    const sqlPath = join(MIGRATIONS_DIR, dir, "migration.sql");
    if (!existsSync(sqlPath)) continue;
    const sql = readFileSync(sqlPath);
    const checksum = createHash("sha256").update(sql).digest("hex");
    console.log(`  ${checksum}  ${dir}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
