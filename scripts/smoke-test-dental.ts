#!/usr/bin/env -S npx tsx
// Smoke test post-go-live del sprint dental.
// Valida que las migraciones aplicaron, los módulos están en marketplace
// y los crons responden. NO escribe nada — solo lectura + HTTP HEAD/GET.
//
// Uso:
//   npx tsx scripts/smoke-test-dental.ts
//
// Variables de entorno requeridas:
//   DATABASE_URL          → conexión a Postgres (lectura)
//   NEXT_PUBLIC_APP_URL   → e.g. https://mediflow.app (para test del cron)
//   CRON_SECRET           → para el endpoint /api/cron/whatsapp-queue
//
// Exit code: 0 si todos los checks verde, 1 si alguno rojo.

import { PrismaClient } from "@prisma/client";

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const prisma = new PrismaClient();
const results: CheckResult[] = [];

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  const icon = ok ? "✅" : "❌";
  const tail = detail ? ` — ${detail}` : "";
  // eslint-disable-next-line no-console
  console.log(`${icon} ${name}${tail}`);
}

// ─── 1. Tablas de cada módulo existen ─────────────────────────────────
const TABLES_BY_MODULE: Record<string, string[]> = {
  endodontics: [
    "endodontic_diagnoses",
    "vitality_tests",
    "endodontic_treatments",
    "root_canals",
    "intracanal_medications",
    "endodontic_follow_ups",
    "endodontic_retreatment_info",
    "apical_surgeries",
  ],
  periodontics: [
    "periodontal_records",
    "periodontal_classifications",
    "gingival_recessions",
    "periodontal_treatment_plans",
    "srp_sessions",
    "periodontal_reevaluations",
    "periodontal_risk_assessments",
    "periodontal_surgeries",
    "peri_implant_assessments",
  ],
  orthodontics: [
    "orthodontic_diagnoses",
    "orthodontic_treatment_plans",
    "orthodontic_phases",
    "ortho_payment_plans",
    "ortho_installments",
    "ortho_photo_sets",
    "orthodontic_control_appointments",
    "orthodontic_digital_records",
    "orthodontic_consents",
  ],
  implants: [
    "implants",
    "implant_surgical_records",
    "implant_healing_phases",
    "implant_second_stage_surgeries",
    "implant_prosthetic_phases",
    "implant_complications",
    "implant_follow_ups",
    "implant_consents",
    "implant_passports",
  ],
  pediatrics: [
    "pediatric_records",
    "ped_endodontic_treatments",
  ],
};

async function checkTablesExist() {
  const allTables = Object.values(TABLES_BY_MODULE).flat();
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const existing = new Set(rows.map((r) => r.tablename));

  for (const [module, tables] of Object.entries(TABLES_BY_MODULE)) {
    const missing = tables.filter((t) => !existing.has(t));
    record(
      `Tablas módulo ${module} (${tables.length})`,
      missing.length === 0,
      missing.length > 0 ? `faltan: ${missing.join(", ")}` : undefined,
    );
  }
}

// ─── 2. Marketplace seed con los 5 módulos ───────────────────────────
async function checkMarketplaceModules() {
  const expectedKeys = [
    "endodontics",
    "periodontics",
    "orthodontics",
    "implants",
    "pediatric-dentistry",
  ];
  const modules = await prisma.module.findMany({
    where: { key: { in: expectedKeys } },
    select: { key: true, isActive: true, priceMxnMonthly: true },
  });
  const foundKeys = new Set(modules.map((m) => m.key));
  for (const key of expectedKeys) {
    const module = modules.find((m) => m.key === key);
    if (!foundKeys.has(key)) {
      record(`Marketplace.module[${key}]`, false, "no existe — corre npm run db:seed");
    } else if (!module?.isActive) {
      record(`Marketplace.module[${key}]`, false, "isActive=false");
    } else if (!module.priceMxnMonthly || module.priceMxnMonthly <= 0) {
      record(`Marketplace.module[${key}]`, false, "priceMxnMonthly <= 0");
    } else {
      record(
        `Marketplace.module[${key}]`,
        true,
        `${module.priceMxnMonthly} MXN/mes`,
      );
    }
  }
}

// ─── 3. ClinicModule activo en al menos una clínica ──────────────────
async function checkClinicModuleActive() {
  for (const key of [
    "endodontics",
    "periodontics",
    "orthodontics",
    "implants",
    "pediatric-dentistry",
  ]) {
    const count = await prisma.clinicModule.count({
      where: {
        module: { key },
        status: "ACTIVE",
        currentPeriodEnd: { gt: new Date() },
      },
    });
    record(
      `Hay ≥1 clínica con ${key} activo`,
      count > 0,
      count === 0
        ? "ninguna clínica activó este módulo todavía"
        : `${count} clínica(s)`,
    );
  }
}

// ─── 4. FK PeriImplantAssessment → Implant ───────────────────────────
async function checkPeriImplantFk() {
  const rows = await prisma.$queryRaw<Array<{ constraint_name: string }>>`
    SELECT constraint_name
    FROM information_schema.table_constraints
    WHERE table_name = 'peri_implant_assessments'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name = 'peri_implant_assessments_implantId_fkey'
  `;
  record(
    "FK peri_implant_assessments_implantId_fkey",
    rows.length > 0,
    rows.length === 0
      ? "migración 20260505100000_dental_cross_modules no aplicada"
      : undefined,
  );
}

// ─── 5. WhatsAppReminder.payload column ──────────────────────────────
async function checkPayloadColumn() {
  const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'whatsapp_reminders' AND column_name = 'payload'
  `;
  record(
    "WhatsAppReminder.payload column",
    rows.length > 0,
    rows.length === 0 ? "migración A2 no aplicada" : undefined,
  );
}

// ─── 6. XrayAnalysis mode + measurements ─────────────────────────────
async function checkXrayAnalysisMode() {
  const enumExists = await prisma.$queryRaw<Array<{ typname: string }>>`
    SELECT typname FROM pg_type WHERE typname = 'XrayAnalysisMode'
  `;
  record(
    "Enum XrayAnalysisMode",
    enumExists.length > 0,
    enumExists.length === 0 ? "migración A2 no aplicada" : undefined,
  );

  const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'xray_analyses' AND column_name IN ('mode', 'measurements')
  `;
  record(
    "xray_analyses.mode + measurements columns",
    cols.length === 2,
    cols.length !== 2
      ? `solo encontradas: ${cols.map((c) => c.column_name).join(", ") || "ninguna"}`
      : undefined,
  );
}

// ─── 7. Cron WhatsApp queue endpoint responde ────────────────────────
async function checkCronEndpoint() {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;
  if (!url) {
    record("Cron /api/cron/whatsapp-queue", false, "NEXT_PUBLIC_APP_URL no definido");
    return;
  }
  if (!secret) {
    record("Cron /api/cron/whatsapp-queue", false, "CRON_SECRET no definido");
    return;
  }
  try {
    const res = await fetch(`${url}/api/cron/whatsapp-queue`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (res.status === 200) {
      const json = (await res.json()) as { picked?: number };
      record(
        "Cron /api/cron/whatsapp-queue",
        true,
        `picked=${json.picked ?? 0}`,
      );
    } else {
      record(
        "Cron /api/cron/whatsapp-queue",
        false,
        `HTTP ${res.status}`,
      );
    }
  } catch (e) {
    record(
      "Cron /api/cron/whatsapp-queue",
      false,
      e instanceof Error ? e.message : "fetch failed",
    );
  }
}

// ─── 8. Cron orto payment status responde ────────────────────────────
async function checkOrthoCron() {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;
  if (!url || !secret) {
    record("Cron /api/cron/orthodontics/recalculate-payment-status", false, "vars no definidas");
    return;
  }
  try {
    const res = await fetch(
      `${url}/api/cron/orthodontics/recalculate-payment-status`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    record(
      "Cron /api/cron/orthodontics/recalculate-payment-status",
      res.status === 200,
      res.status !== 200 ? `HTTP ${res.status}` : undefined,
    );
  } catch (e) {
    record(
      "Cron /api/cron/orthodontics/recalculate-payment-status",
      false,
      e instanceof Error ? e.message : "fetch failed",
    );
  }
}

// ─── 9. RLS deny-all habilitado en tablas nuevas ─────────────────────
async function checkRlsEnabled() {
  const sensitiveTables = [
    "endodontic_diagnoses",
    "endodontic_treatments",
    "implants",
    "peri_implant_assessments",
    "orthodontic_treatment_plans",
    "ortho_payment_plans",
  ];
  const rows = await prisma.$queryRaw<Array<{ tablename: string; rowsecurity: boolean }>>`
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename = ANY(${sensitiveTables})
  `;
  const map = new Map(rows.map((r) => [r.tablename, r.rowsecurity]));
  for (const t of sensitiveTables) {
    const enabled = map.get(t) ?? false;
    record(
      `RLS habilitada en ${t}`,
      enabled,
      enabled ? undefined : "RLS no habilitada — riesgo cross-tenant",
    );
  }
}

// ─── Main ──────────────────────────────────────────────────────────────
async function main() {
  // eslint-disable-next-line no-console
  console.log("🦷 MediFlow — smoke test sprint dental\n");
  await checkTablesExist();
  // eslint-disable-next-line no-console
  console.log("");
  await checkMarketplaceModules();
  // eslint-disable-next-line no-console
  console.log("");
  await checkClinicModuleActive();
  // eslint-disable-next-line no-console
  console.log("");
  await checkPeriImplantFk();
  await checkPayloadColumn();
  await checkXrayAnalysisMode();
  // eslint-disable-next-line no-console
  console.log("");
  await checkRlsEnabled();
  // eslint-disable-next-line no-console
  console.log("");
  await checkCronEndpoint();
  await checkOrthoCron();

  const failed = results.filter((r) => !r.ok);
  // eslint-disable-next-line no-console
  console.log(`\n${"─".repeat(60)}`);
  // eslint-disable-next-line no-console
  console.log(
    `Resumen: ${results.length - failed.length}/${results.length} verde${
      failed.length > 0 ? ` · ${failed.length} ROJO` : ""
    }`,
  );
  if (failed.length > 0) {
    // eslint-disable-next-line no-console
    console.log("\nFallaron:");
    for (const f of failed) {
      // eslint-disable-next-line no-console
      console.log(`  ❌ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    }
  }
  await prisma.$disconnect();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(async (e) => {
  // eslint-disable-next-line no-console
  console.error("Smoke test crashed:", e);
  await prisma.$disconnect();
  process.exit(2);
});
