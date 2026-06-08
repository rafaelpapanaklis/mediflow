import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createCipheriv, randomBytes } from "crypto";
import { env } from "@/env";
import { BUCKETS } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/db-export
 *
 * Vercel cron schedule: domingo 10:00 UTC (4:00 CDMX).
 * Dump semanal de las tablas críticas para tener backup independiente del
 * PITR de Supabase. Cifrado con AES-256-GCM y subido a un prefijo privado del
 * bucket patient-files.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}.
 *
 * ─── ESCALA (v2) ────────────────────────────────────────────────────────────
 * Antes cargaba TODA la base en memoria (findMany sin filtro ni take de todas
 * las clínicas) y cifraba un único string gigante → OOM al crecer. Ahora:
 *   • Exporta UNA clínica a la vez, iterando las clínicas con cursor/paginado.
 *   • Dentro de cada clínica, pagina cada tabla por cursor (BATCH filas) y
 *     transmite las filas por la cifra (cipher.update por batch). Nunca hay en
 *     RAM más de un batch de texto plano; sólo se acumula el ciphertext de UNA
 *     clínica (acotado al tamaño de esa clínica, no de toda la base).
 *   • Escribe un archivo por clínica en NDJSON cifrado.
 *
 * Layout:
 *   db-backups/{YYYY-MM-DD}/{clinicId}.ndjson.enc   → una por clínica
 *   db-backups/{YYYY-MM-DD}/__global.ndjson.enc     → filas sin clínica (ARCO
 *                                                     públicas, clinicId null)
 *   db-backups/{YYYY-MM-DD}/__manifest.json         → resumen + sentinela de
 *                                                     "corrida completa"
 *
 * Cada .ndjson.enc conserva el MISMO sobre que v1: línea header JSON
 * {v,alg,iv,tag} + ciphertext AES-256-GCM. Así la receta de descifrado de
 * docs/BACKUPS.md funciona sin cambios, por archivo. El texto plano ahora es
 * NDJSON: una línea por fila, {"t":"<tabla>","d":{<fila>}}.
 *
 * Reanudable: si la corrida agota el presupuesto de tiempo, deja los archivos
 * ya subidos y responde complete:false. La siguiente corrida lista la carpeta
 * del día y OMITE las clínicas ya exportadas. El __manifest.json sólo se
 * escribe al terminar completa (idempotencia/sentinela).
 *
 * Tablas: patients, medical_records, prescriptions (+items), invoices
 * (+payments), audit_logs (últimos 7 días), doctor_signature_certs (sólo
 * metadata; multi-tenant vía user.clinicId), arco_requests.
 *
 * Retención: 90 días (borra carpetas de fecha viejas y dumps planos v1 legacy).
 */

const BATCH = 1000; // filas por página (cursor) por tabla
const TIME_BUDGET_MS = 240_000; // headroom dentro de maxDuration=300s
const SCHEMA_VERSION = "2.0";
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function getAdminSupabase() {
  return createAdmin(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
}
type Supa = ReturnType<typeof getAdminSupabase>;
type Row = { id: string };
type RowFetcher = { table: string; fetch: (cursor: string | null) => Promise<Row[]> };

/** Página de cursor uniforme sobre `id` (todas las tablas tienen id String).
 *  Forma única (no unión) para que Prisma acepte el spread; cursor/skip en
 *  `undefined` se ignoran en runtime (equivale a no paginar desde cursor). */
function page(cursor: string | null) {
  return {
    take: BATCH,
    orderBy: { id: "asc" as const },
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : undefined,
  };
}

/** Fetchers por tabla de UNA clínica. include/select preservados del dump v1. */
function clinicFetchers(clinicId: string, auditSince: Date): RowFetcher[] {
  return [
    { table: "patients", fetch: (c) => prisma.patient.findMany({ where: { clinicId }, ...page(c) }) },
    { table: "medical_records", fetch: (c) => prisma.medicalRecord.findMany({ where: { clinicId }, ...page(c) }) },
    { table: "prescriptions", fetch: (c) => prisma.prescription.findMany({ where: { clinicId }, include: { items: true }, ...page(c) }) },
    { table: "invoices", fetch: (c) => prisma.invoice.findMany({ where: { clinicId }, include: { payments: true }, ...page(c) }) },
    { table: "audit_logs", fetch: (c) => prisma.auditLog.findMany({ where: { clinicId, createdAt: { gte: auditSince } }, ...page(c) }) },
    {
      // Sólo metadata (los blobs cer/key ya están cifrados y abultan sin valor).
      // No tiene clinicId propio → scope multi-tenant vía la relación user.
      table: "doctor_signature_certs",
      fetch: (c) =>
        prisma.doctorSignatureCert.findMany({
          where: { user: { clinicId } },
          select: {
            id: true, userId: true, cerSerial: true, cerIssuer: true,
            validFrom: true, validUntil: true, rfc: true, isActive: true, createdAt: true,
          },
          ...page(c),
        }),
    },
    { table: "arco_requests", fetch: (c) => prisma.arcoRequest.findMany({ where: { clinicId }, ...page(c) }) },
  ];
}

/** Filas no atadas a una clínica. Sólo ARCO públicas (clinicId null): las demás
 *  tablas críticas tienen clinicId obligatorio → ya cubiertas por clínica. */
function globalFetchers(): RowFetcher[] {
  return [
    { table: "arco_requests", fetch: (c) => prisma.arcoRequest.findMany({ where: { clinicId: null }, ...page(c) }) },
  ];
}

/**
 * Exporta un grupo (una clínica o el global) a un blob cifrado, transmitiendo
 * por la cifra. Pico de RAM ≈ un batch de texto plano + el ciphertext del grupo
 * (acotado al tamaño de esa clínica, nunca de toda la base).
 */
async function exportGroupToBlob(
  fetchers: RowFetcher[],
  key: Buffer,
  meta: Record<string, unknown>,
): Promise<{ blob: Buffer; counts: Record<string, number> }> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct: Buffer[] = [];
  const counts: Record<string, number> = {};

  for (const f of fetchers) {
    counts[f.table] = 0;
    let cursor: string | null = null;
    for (;;) {
      const batch = await f.fetch(cursor);
      if (batch.length === 0) break;
      // Serializa el batch a NDJSON y ciffra de una sola pasada (menos overhead
      // que una update por fila). El texto plano del batch se libera al salir.
      let text = "";
      for (const row of batch) text += JSON.stringify({ t: f.table, d: row }) + "\n";
      ct.push(cipher.update(text, "utf8"));
      counts[f.table] += batch.length;
      if (batch.length < BATCH) break;
      cursor = batch[batch.length - 1].id;
    }
  }

  ct.push(cipher.final());
  const tag = cipher.getAuthTag();
  const header = Buffer.from(
    JSON.stringify({
      v: 1,
      alg: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      schemaVersion: SCHEMA_VERSION,
      ...meta,
    }) + "\n",
    "utf8",
  );
  return { blob: Buffer.concat([header, ...ct]), counts };
}

/** Lista (paginado) los nombres de archivo bajo un prefijo del bucket. */
async function listFolder(supabase: Supa, prefix: string): Promise<string[]> {
  const names: string[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage
      .from(BUCKETS.PATIENT_FILES)
      .list(prefix, { limit: 1000, offset });
    if (error || !data || data.length === 0) break;
    for (const e of data) names.push(e.name);
    if (data.length < 1000) break;
    offset += data.length;
  }
  return names;
}

/** Borra backups > 90 días: carpetas de fecha v2 y dumps planos v1 legacy. */
async function sweepRetention(supabase: Supa, nowMs: number): Promise<number> {
  const cutoff = nowMs - RETENTION_MS;
  const top = await listFolder(supabase, "db-backups");
  const toRemove: string[] = [];
  for (const name of top) {
    const flat = name.match(/_(\d+)\.json\.enc$/); // v1: {date}_{ts}.json.enc
    if (flat) {
      if (Number(flat[1]) < cutoff) toRemove.push(`db-backups/${name}`);
      continue;
    }
    const dm = name.match(/^(\d{4})-(\d{2})-(\d{2})$/); // v2: carpeta YYYY-MM-DD
    if (dm) {
      const folderMs = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]));
      if (folderMs < cutoff) {
        const inner = await listFolder(supabase, `db-backups/${name}`);
        for (const f of inner) toRemove.push(`db-backups/${name}/${f}`);
      }
    }
  }
  for (let i = 0; i < toRemove.length; i += 100) {
    await supabase.storage.from(BUCKETS.PATIENT_FILES).remove(toRemove.slice(i, i + 100));
  }
  return toRemove.length;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!env.DATA_ENCRYPTION_KEY || env.DATA_ENCRYPTION_KEY.length < 32) {
    return NextResponse.json(
      { error: "DATA_ENCRYPTION_KEY no configurada (requiere 32 bytes hex)" },
      { status: 503 },
    );
  }
  const key = Buffer.from(env.DATA_ENCRYPTION_KEY.slice(0, 64), "hex");
  if (key.length !== 32) {
    return NextResponse.json({ error: "DATA_ENCRYPTION_KEY no es 32 bytes hex" }, { status: 503 });
  }

  const startedAt = new Date();
  const deadline = startedAt.getTime() + TIME_BUDGET_MS;
  const ymd = startedAt.toISOString().slice(0, 10);
  const folder = `db-backups/${ymd}`;
  const auditSince = new Date(startedAt.getTime() - 7 * 24 * 60 * 60 * 1000);

  const supabase = getAdminSupabase();

  try {
    // Reanudación: ¿qué hay ya en la carpeta de hoy?
    const existing = await listFolder(supabase, folder);
    if (existing.includes("__manifest.json")) {
      return NextResponse.json({ ok: true, complete: true, alreadyComplete: true, folder });
    }
    const doneClinics = new Set(
      existing
        .filter((n) => n.endsWith(".ndjson.enc") && !n.startsWith("__"))
        .map((n) => n.replace(/\.ndjson\.enc$/, "")),
    );
    const globalDone = existing.includes("__global.ndjson.enc");

    const rowsByTable: Record<string, number> = {};
    const perClinicCounts: Record<string, Record<string, number>> = {};
    let clinicsSeen = 0;
    let exported = 0;
    let skipped = 0;
    let partial = false;
    let clinicCursor: string | null = null;

    outer: for (;;) {
      const clinics = await prisma.clinic.findMany({ select: { id: true }, ...page(clinicCursor) });
      if (clinics.length === 0) break;

      for (const c of clinics) {
        clinicsSeen++;
        if (doneClinics.has(c.id)) {
          skipped++;
          continue;
        }
        if (Date.now() >= deadline) {
          partial = true;
          break outer;
        }

        const { blob, counts } = await exportGroupToBlob(
          clinicFetchers(c.id, auditSince),
          key,
          { scope: "clinic", clinicId: c.id, exportedAt: startedAt.toISOString() },
        );
        const up = await supabase.storage
          .from(BUCKETS.PATIENT_FILES)
          .upload(`${folder}/${c.id}.ndjson.enc`, blob, {
            contentType: "application/octet-stream",
            upsert: false,
          });
        // upsert:false → si ya existe (carrera con otra corrida), lo tratamos
        // como hecho en vez de fallar la corrida entera.
        if (up.error && !/exist|duplicate/i.test(up.error.message)) {
          throw new Error(`upload_failed(${c.id}): ${up.error.message}`);
        }
        exported++;
        perClinicCounts[c.id] = counts;
        for (const [t, n] of Object.entries(counts)) rowsByTable[t] = (rowsByTable[t] ?? 0) + n;
      }

      if (clinics.length < BATCH) break;
      clinicCursor = clinics[clinics.length - 1].id;
    }

    // Global (filas sin clínica) sólo cuando ya recorrimos todas las clínicas.
    if (!partial && !globalDone) {
      const { blob, counts } = await exportGroupToBlob(globalFetchers(), key, {
        scope: "global",
        exportedAt: startedAt.toISOString(),
      });
      const up = await supabase.storage
        .from(BUCKETS.PATIENT_FILES)
        .upload(`${folder}/__global.ndjson.enc`, blob, {
          contentType: "application/octet-stream",
          upsert: true,
        });
      if (up.error) throw new Error(`upload_failed(__global): ${up.error.message}`);
      for (const [t, n] of Object.entries(counts)) rowsByTable[`global:${t}`] = n;
    }

    let removed = 0;
    if (!partial) {
      // __manifest.json = sentinela de "corrida completa" (idempotencia/restore).
      const manifest = {
        schemaVersion: SCHEMA_VERSION,
        format:
          'per-clinic NDJSON; AES-256-GCM por archivo (línea header JSON {v,alg,iv,tag} + ciphertext). Texto plano = NDJSON {"t":"<tabla>","d":{<fila>}}.',
        exportedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        tables: [
          "patients", "medical_records", "prescriptions", "invoices",
          "audit_logs", "doctor_signature_certs", "arco_requests",
        ],
        clinicsExportedThisRun: exported,
        clinicsSkippedAlreadyDone: skipped,
        rowsByTable,
        perClinicCounts,
      };
      const mUp = await supabase.storage
        .from(BUCKETS.PATIENT_FILES)
        .upload(`${folder}/__manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), {
          contentType: "application/json",
          upsert: true,
        });
      if (mUp.error) throw new Error(`upload_failed(__manifest): ${mUp.error.message}`);

      try {
        removed = await sweepRetention(supabase, startedAt.getTime());
      } catch (e) {
        console.warn("[cron.db-export] retention sweep failed (non-fatal):", (e as Error).message);
      }
    }

    const summary = {
      ok: true,
      complete: !partial,
      folder,
      clinicsSeen,
      clinicsExportedThisRun: exported,
      clinicsSkippedAlreadyDone: skipped,
      rowsByTable,
      retentionRemoved: removed,
      durationMs: Date.now() - startedAt.getTime(),
      ...(partial
        ? { note: "Presupuesto de tiempo agotado; progreso guardado. La próxima corrida reanuda y omite las clínicas ya exportadas." }
        : {}),
    };
    console.log(JSON.stringify({ type: "cron.db-export.completed", ...summary }));
    return NextResponse.json(summary);
  } catch (err: any) {
    console.error("[cron.db-export] failed:", err);
    return NextResponse.json(
      { error: "export_failed", detail: String(err?.message ?? err).slice(0, 300) },
      { status: 500 },
    );
  }
}
