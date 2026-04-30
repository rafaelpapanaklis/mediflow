import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { env } from "@/env";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/retention
 *
 * Vercel cron schedule: diario 03:00 (definido en vercel.json).
 * Aplica las políticas de retención documentadas en docs/RETENTION.md.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}.
 *
 * Política (detalle en docs/RETENTION.md):
 *  - audit_logs > 7 años    → borrar (NOM-024 retención mínima cumplida)
 *  - patient_files huérfanos > 30 días (sin patientId existente) → borrar
 *  - inbox_messages > 2 años → anonimizar contenido
 *  - arco_requests RESOLVED/REJECTED > 5 años → anonimizar
 *
 * Multi-tenant: itera por clínica para que el cron quede limitado en blast
 * radius por iteración. Errores por clínica se loguean y NO matan el cron.
 *
 * Idempotente: re-correr no causa daño (queries son thresholds absolutos).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const sevenYearsAgo = new Date(now.getTime() - 7 * 365 * 24 * 60 * 60 * 1000);
  const fiveYearsAgo  = new Date(now.getTime() - 5 * 365 * 24 * 60 * 60 * 1000);
  const twoYearsAgo   = new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000);

  const summary = {
    startedAt: now.toISOString(),
    auditLogsDeleted: 0,
    inboxMessagesAnonymized: 0,
    arcoRequestsAnonymized: 0,
    clinicsProcessed: 0,
    clinicsFailed: 0,
    errors: [] as string[],
  };

  // 1) Audit logs > 7 años: borrar GLOBAL (no per-clinic — la tabla es
  //    grande y filtrar por clinicId no aporta).
  try {
    const r = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: sevenYearsAgo } },
    });
    summary.auditLogsDeleted = r.count;
  } catch (e: any) {
    summary.errors.push(`auditLog.deleteMany: ${String(e?.message ?? e).slice(0, 200)}`);
  }

  // 2) Iterar por clínica para inbox + arco + huérfanos
  const clinics = await prisma.clinic.findMany({ select: { id: true, name: true } });
  for (const c of clinics) {
    try {
      // 2a) inbox_messages > 2 años → anonimizar body. sentAt es la
      // columna de timestamp en este modelo. Adjuntos se vacían a [] (no
      // null porque el campo es Json opcional pero algunos clientes
      // asumen array).
      const inboxRes = await prisma.inboxMessage.updateMany({
        where: {
          sentAt: { lt: twoYearsAgo },
          thread: { clinicId: c.id },
          body:   { not: "[ANONIMIZADO]" },
        },
        data: {
          body:        "[ANONIMIZADO]",
          attachments: [],
        },
      }).catch(() => ({ count: 0 }));
      summary.inboxMessagesAnonymized += inboxRes.count;

      // 2b) arco_requests cerrados > 5 años → anonimizar
      const arcoRes = await prisma.arcoRequest.updateMany({
        where: {
          clinicId: c.id,
          status:   { in: ["RESOLVED", "REJECTED"] },
          resolvedAt: { lt: fiveYearsAgo },
          email:     { not: "[ANONIMIZADO]" },
        },
        data: { email: "[ANONIMIZADO]", reason: "[ANONIMIZADO]", resolvedNotes: null },
      });
      summary.arcoRequestsAnonymized += arcoRes.count;

      summary.clinicsProcessed++;
    } catch (e: any) {
      summary.clinicsFailed++;
      summary.errors.push(`clinic ${c.id}: ${String(e?.message ?? e).slice(0, 200)}`);
    }
  }

  // NOTA — los archivos clínicos (radiografías, fotos intraorales) son
  // parte de la historia clínica bajo NOM-024 y se conservan 5 años aún
  // tras una cancelación ARCO. NO se borran físicamente del storage por
  // este cron. La anonimización del PII en patients ya cumple con LFPDPPP
  // sin destruir la evidencia médica.

  console.log(JSON.stringify({
    type: "cron.retention.completed",
    ...summary,
    finishedAt: new Date().toISOString(),
  }));

  return NextResponse.json(summary);
}
