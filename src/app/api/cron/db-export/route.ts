import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createCipheriv, randomBytes } from "crypto";
import { env } from "@/env";
import { BUCKETS } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/db-export
 *
 * Vercel cron schedule: domingo 10:00 UTC (4:00 CDMX).
 * Dump semanal de las tablas críticas para tener backup independiente
 * de PITR de Supabase. Cifrado con AES-256-GCM y subido a un prefijo
 * privado del bucket patient-files.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}.
 *
 * Tablas exportadas: patients, medical_records, prescriptions, invoices,
 * audit_logs, doctor_signature_certs (solo metadata — los blobs cer/key
 * ya están cifrados en columnas), arco_requests.
 *
 * Las prescripciones y registros médicos pueden contener envelope-cifrado
 * a nivel app — el dump preserva esos valores cifrados como están, así
 * que el dump per se está doblemente protegido.
 *
 * Salida: backups/{YYYY-MM-DD}.json.enc dentro del bucket privado.
 * Retención: 90 días (otro cron limpia los más viejos).
 */
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

  const startedAt = new Date();
  try {
    const [
      patients, medicalRecords, prescriptions, invoices,
      auditLogs, certs, arco,
    ] = await Promise.all([
      prisma.patient.findMany(),
      prisma.medicalRecord.findMany(),
      prisma.prescription.findMany({ include: { items: true } }),
      prisma.invoice.findMany({ include: { payments: true } }),
      prisma.auditLog.findMany({
        where: { createdAt: { gte: new Date(startedAt.getTime() - 7 * 24 * 60 * 60 * 1000) } },
      }),
      // Excluimos los blobs cer/key (ya cifrados, agregan MB sin valor en
      // el dump). Sólo metadata para auditoría.
      prisma.doctorSignatureCert.findMany({
        select: {
          id: true, userId: true, cerSerial: true, cerIssuer: true,
          validFrom: true, validUntil: true, rfc: true, isActive: true,
          createdAt: true,
        },
      }),
      prisma.arcoRequest.findMany(),
    ]);

    const payload = JSON.stringify({
      schemaVersion: "1.0",
      exportedAt:    startedAt.toISOString(),
      counts: {
        patients:        patients.length,
        medicalRecords:  medicalRecords.length,
        prescriptions:   prescriptions.length,
        invoices:        invoices.length,
        auditLogs:       auditLogs.length,
        certs:           certs.length,
        arco:            arco.length,
      },
      tables: {
        patients,
        medical_records:        medicalRecords,
        prescriptions,
        invoices,
        audit_logs:             auditLogs,
        doctor_signature_certs: certs,
        arco_requests:          arco,
      },
    });

    // Cifrado AES-256-GCM. La clave maestra se extiende vía
    // primeros 32 bytes (hex → 64 chars).
    const key = Buffer.from(env.DATA_ENCRYPTION_KEY.slice(0, 64), "hex");
    if (key.length !== 32) {
      return NextResponse.json({ error: "DATA_ENCRYPTION_KEY no es 32 bytes hex" }, { status: 503 });
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Formato persistido: header JSON pequeño + ciphertext binario.
    const header = Buffer.from(JSON.stringify({
      v: 1,
      alg: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      exportedAt: startedAt.toISOString(),
    }) + "\n", "utf8");
    const blob = Buffer.concat([header, ct]);

    const ymd = startedAt.toISOString().slice(0, 10);
    const path = `db-backups/${ymd}_${startedAt.getTime()}.json.enc`;

    const supabase = createAdmin(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } },
    );
    const { error: upErr } = await supabase.storage
      .from(BUCKETS.PATIENT_FILES)
      .upload(path, blob, { contentType: "application/octet-stream", upsert: false });

    if (upErr) {
      throw new Error(`upload_failed: ${upErr.message}`);
    }

    // Retención del dump: borrar > 90 días. Best-effort.
    try {
      const { data: list } = await supabase.storage
        .from(BUCKETS.PATIENT_FILES)
        .list("db-backups", { limit: 1000 });
      const cutoff = startedAt.getTime() - 90 * 24 * 60 * 60 * 1000;
      const stale = (list ?? []).filter((f) => {
        const m = f.name.match(/_(\d+)\.json\.enc$/);
        const ts = m ? Number(m[1]) : 0;
        return ts > 0 && ts < cutoff;
      }).map((f) => `db-backups/${f.name}`);
      if (stale.length > 0) {
        await supabase.storage.from(BUCKETS.PATIENT_FILES).remove(stale);
      }
    } catch (e) {
      console.warn("[cron.db-export] retention sweep failed (non-fatal):", (e as Error).message);
    }

    const summary = {
      ok: true,
      path,
      sizeBytes: blob.length,
      counts: {
        patients: patients.length,
        medicalRecords: medicalRecords.length,
        prescriptions: prescriptions.length,
        invoices: invoices.length,
        auditLogs: auditLogs.length,
        certs: certs.length,
        arco: arco.length,
      },
      durationMs: Date.now() - startedAt.getTime(),
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
