#!/usr/bin/env node
// Escanea src/app/api/**/route.ts y flaguea queries Prisma a tablas tenant-scoped
// que no incluyan clinicId en su WHERE. Excluye admin/cron/webhook/public por diseño.
//
// Uso: node scripts/audit-clinic-scoping.mjs
// Exit code 0 = clean, 1 = findings.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const API_ROOT = "src/app/api";
const TENANT_MODELS = [
  "patient", "appointment", "medicalRecord", "invoice", "payment", "paymentPlan",
  "planPayment", "treatmentPlan", "treatmentSession", "prescription", "consentForm",
  "periodontalRecord", "patientFile", "xrayAnalysis", "beforeAfterPhoto",
  "servicePackage", "packageRedemption", "formulaRecord", "bodyMapAnnotation",
  "walkInQueue", "resourceBooking", "procedureCatalog", "inventoryItem",
  "inventoryHistory", "whatsAppReminder", "cfdiRecord", "auditLog",
  "clinicSchedule", "subscriptionInvoice",
];
const EXCLUDED_DIRS = [
  "admin", "cron", "webhooks", "public", "auth", "portal", "consent",
  "stripe", "whatsapp", "google", "teleconsulta", "prescriptions/[id]/verify",
  "clinic-landing", "check-slug", "google-reviews", "announcements/active",
];
const METHODS = ["findFirst", "findUnique", "findMany", "update", "updateMany", "delete", "deleteMany", "count", "aggregate"];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...walk(path));
    else if (name === "route.ts") out.push(path);
  }
  return out;
}

function isExcluded(file) {
  const rel = file.replace(/\\/g, "/");
  return EXCLUDED_DIRS.some(ex => rel.includes(`/api/${ex}`));
}

const findings = [];

for (const file of walk(API_ROOT)) {
  if (isExcluded(file)) continue;
  const src = readFileSync(file, "utf8");
  for (const model of TENANT_MODELS) {
    for (const method of METHODS) {
      const pattern = new RegExp(`prisma\\.${model}\\.${method}\\s*\\(`, "g");
      let m;
      while ((m = pattern.exec(src)) !== null) {
        const startIdx = m.index;
        // find matching close paren
        let depth = 0, end = startIdx + m[0].length - 1;
        for (let i = end; i < src.length; i++) {
          if (src[i] === "(") depth++;
          else if (src[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
        }
        const block = src.slice(startIdx, end + 1);
        const line = src.slice(0, startIdx).split("\n").length;
        // Heuristic: check if "clinicId" appears inside the call block,
        // or si usa un helper que ya lo incluye (buildPatientWhere, buildAppointmentWhere, buildRecordWhere)
        const hasClinicId = block.includes("clinicId");
        const hasHelper = /build(Patient|Appointment|Record|Invoice)Where\(/.test(block);
        if (!hasClinicId && !hasHelper) {
          findings.push({ file: file.replace(/\\/g, "/"), line, model, method, snippet: block.slice(0, 120).replace(/\s+/g, " ") });
        }
      }
    }
  }
}

if (findings.length === 0) {
  console.log("✅ Clean — 0 queries sin clinicId en rutas tenant-scoped.");
  process.exit(0);
}

console.log(`⚠️  ${findings.length} hallazgos:\n`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line} — prisma.${f.model}.${f.method}()`);
  console.log(`    ${f.snippet}...\n`);
}
console.log("NOTA: muchas de estas son 'guard-then-act' (findFirst con clinicId,");
console.log("luego update sin clinicId). Son seguras hoy pero frágiles. Para ");
console.log("robustez, convertir a updateMany/deleteMany con clinicId en WHERE.");
process.exit(1);
