/**
 * Scanner G — Backups y disaster recovery.
 *
 *   G.1 PITR de Supabase activo (no hay forma desde el código, pero sí
 *       documentamos el gap si falta nota).
 *   G.2 Runbook de restore (docs/RUNBOOK_RESTORE.md).
 *   G.3 Última fecha conocida de prueba de restore.
 *   G.4 Export periódico fuera de Supabase (cron + S3/GDrive).
 */

import path from "node:path";
import fs from "node:fs/promises";
import type { AuditItem, ScanResult } from "../types";
import { repoRoot, walk, readManyAbs, safeSnippet } from "../fs-helpers";

async function exists(rel: string): Promise<boolean> {
  try { await fs.access(path.join(repoRoot(), rel)); return true; }
  catch { return false; }
}

async function readIfExists(rel: string): Promise<string | null> {
  try { return await fs.readFile(path.join(repoRoot(), rel), "utf-8"); }
  catch { return null; }
}

export async function runBackupScan(): Promise<ScanResult> {
  const t0 = Date.now();
  const items: AuditItem[] = [];

  // G.1 — PITR activo. No podemos chequearlo via SQL (es config Supabase
  // dashboard). Buscamos nota en docs/.
  const pitrDocs =
    (await readIfExists("docs/BACKUPS.md")) ||
    (await readIfExists("docs/INFRA.md")) ||
    (await readIfExists("docs/RUNBOOK.md"));
  const hasPitrNote = pitrDocs && /PITR|point[-\s]?in[-\s]?time/i.test(pitrDocs);
  if (!hasPitrNote) {
    items.push({
      category: "backups",
      severity: "high",
      file: "docs/",
      line: 0,
      title: "PITR de Supabase no documentado",
      description:
        "No se encontró referencia a PITR (Point-in-Time Recovery) en docs/. Sin PITR activo, una corrupción de datos solo se restaura desde el snapshot diario de Supabase y se pierden hasta 24h de transacciones clínicas.",
      suggestion:
        "Activa PITR en Supabase Dashboard → Settings → Database → PITR (requiere plan Pro+). Documenta en docs/BACKUPS.md la frecuencia, retention window y costo. Si el plan free no permite PITR, marca este punto como riesgo aceptado en docs.",
      code_snippet: "",
    });
  }

  // G.2 — runbook de restore
  const runbookCandidates = [
    "docs/RUNBOOK_RESTORE.md", "docs/RESTORE.md",
    "docs/runbook-restore.md", "docs/restore.md",
    "docs/RUNBOOK.md", "docs/BACKUPS.md",
  ];
  let runbookFound: string | null = null;
  for (const c of runbookCandidates) {
    if (await exists(c)) { runbookFound = c; break; }
  }
  if (!runbookFound) {
    items.push({
      category: "backups",
      severity: "medium",
      file: "docs/",
      line: 0,
      title: "Sin runbook de restore",
      description:
        "No existe documentación con pasos para restaurar la DB tras un incidente. En crisis (3 AM, perdida de datos clínicos) nadie sabrá qué hacer.",
      suggestion:
        "Crea docs/RUNBOOK_RESTORE.md con: 1) cómo identificar el snapshot válido más reciente, 2) cómo correr el restore desde Supabase Dashboard, 3) cómo validar integridad post-restore (counts de patients/appointments/invoices), 4) comunicación a clínicas afectadas.",
      code_snippet: "",
    });
  } else {
    // G.3 — última prueba de restore
    const content = await readIfExists(runbookFound);
    if (content) {
      const lastTest = content.match(/last[-\s]?test(ed)?\s*:\s*(\d{4}-\d{2}-\d{2})/i);
      if (lastTest) {
        const days = (Date.now() - new Date(lastTest[2]).getTime()) / 86_400_000;
        if (days > 90) {
          items.push({
            category: "backups",
            severity: "medium",
            file: runbookFound,
            line: 0,
            title: `Última prueba de restore hace ${Math.round(days)} días`,
            description:
              "El runbook indica que la última prueba de restore es de hace más de 90 días. Backups que no se prueban no son backups — pueden estar corruptos o el procedimiento puede haber cambiado y nadie lo sabe.",
            suggestion:
              "Programa un restore drill trimestral: restaurar a un proyecto Supabase staging, validar counts vs prod, actualizar last-tested en el runbook.",
            code_snippet: safeSnippet(lastTest[0]),
          });
        }
      } else {
        items.push({
          category: "backups",
          severity: "medium",
          file: runbookFound,
          line: 0,
          title: "Runbook sin registro de pruebas de restore",
          description:
            "El runbook existe pero no documenta cuándo fue la última prueba. Sin trazabilidad, asume que el procedimiento sigue funcionando — riesgoso.",
          suggestion:
            `Agrega al inicio del runbook un bloque "Last tested: YYYY-MM-DD by <persona>" y mantenlo actualizado.`,
          code_snippet: "",
        });
      }
    }
  }

  // G.4 — export externo (cron + S3/GDrive)
  const cronFiles = await readManyAbs(await walk(path.join(repoRoot(), "src/app/api/cron"), [".ts"]));
  const hasExternalExport = cronFiles.some(f =>
    /\b(s3|aws-sdk|@aws-sdk|googleapis|drive)\b/i.test(f.content) &&
    /backup|export|dump/i.test(f.rel + f.content),
  );
  if (!hasExternalExport) {
    items.push({
      category: "backups",
      severity: "medium",
      file: "src/app/api/cron/",
      line: 0,
      title: "Sin export periódico fuera de Supabase",
      description:
        "Si el proyecto Supabase se elimina por accidente (o suspende por billing), no hay copia externa de los datos clínicos. Los backups internos de Supabase se pierden con el proyecto.",
      suggestion:
        "Crea /api/cron/db-export semanal que dump las tablas críticas (patients, medical_records, prescriptions, invoices, audit_logs) a S3/GDrive cifrado. Documenta el job en BACKUPS.md.",
      code_snippet: "",
    });
  }

  return { items, duration_ms: Date.now() - t0 };
}
