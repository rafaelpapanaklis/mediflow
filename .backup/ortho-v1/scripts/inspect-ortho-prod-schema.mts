// One-off introspector. Lista columnas + FKs de las tablas ortho redesign
// + patient_flow para detectar la deriva contra schema.prisma.
// Uso: npx tsx scripts/inspect-ortho-prod-schema.mts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TABLES = [
  "ortho_wire_steps",
  "ortho_treatment_cards",
  "ortho_card_elastics",
  "ortho_card_ipr_points",
  "ortho_card_broken_brackets",
  "ortho_tads",
  "ortho_aux_mechanics",
  "ortho_phase_transitions",
  "patient_flow_entries",
  "ortho_quote_scenarios",
  "ortho_sign_at_home_packages",
  "ortho_retention_regimens",
  "ortho_retainer_checkups",
  "ortho_nps_schedules",
  "ortho_referral_codes",
  "ortho_photo_sets",
] as const;

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
}

interface FkRow {
  table_name: string;
  constraint_name: string;
  column_name: string;
  foreign_table: string;
  foreign_column: string;
}

async function main() {
  const columns = await prisma.$queryRaw<ColumnRow[]>`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY(${TABLES as unknown as string[]}::text[])
    ORDER BY table_name, ordinal_position
  `;

  const fks = await prisma.$queryRaw<FkRow[]>`
    SELECT
      tc.table_name,
      tc.constraint_name,
      kcu.column_name,
      ccu.table_name  AS foreign_table,
      ccu.column_name AS foreign_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema    = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema    = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema    = 'public'
      AND tc.table_name      = ANY(${TABLES as unknown as string[]}::text[])
    ORDER BY tc.table_name, tc.constraint_name
  `;

  const grouped: Record<string, { columns: ColumnRow[]; fks: FkRow[] }> = {};
  for (const t of TABLES) grouped[t] = { columns: [], fks: [] };
  for (const c of columns) grouped[c.table_name]?.columns.push(c);
  for (const f of fks) grouped[f.table_name]?.fks.push(f);

  for (const t of TABLES) {
    const g = grouped[t]!;
    if (g.columns.length === 0) {
      console.log(`\n=== ${t} :: TABLA NO EXISTE ===`);
      continue;
    }
    console.log(`\n=== ${t} (${g.columns.length} cols, ${g.fks.length} FKs) ===`);
    for (const c of g.columns) {
      console.log(`  col  ${c.column_name.padEnd(28)} ${c.data_type}${c.is_nullable === "YES" ? " NULL" : ""}`);
    }
    for (const f of g.fks) {
      console.log(`  fk   ${f.column_name.padEnd(28)} → ${f.foreign_table}.${f.foreign_column}  (${f.constraint_name})`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
