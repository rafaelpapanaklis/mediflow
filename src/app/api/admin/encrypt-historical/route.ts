import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptField, isEnvelope } from "@/lib/crypto/envelope";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/admin/encrypt-historical?dryRun=true&entity=medicalRecord&limit=50
 *
 * Sweep de cifrado para datos históricos en texto plano. Idempotente:
 * solo cifra rows cuyos campos NO tengan ya el prefijo "v1:".
 *
 * Solo SUPER_ADMIN. Ejecuta de a batches con limit (default 50).
 *
 * Por defecto dryRun=true (solo cuenta sin escribir).
 *
 * Multi-tenant: NO filtramos por clinicId — el SUPER_ADMIN sweep cubre
 * todas las clínicas. Los datos cifrados siguen perteneciendo a su clinic
 * vía el clinicId existente en cada row, no se cruzan.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "forbidden_super_admin_only" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const dryRun = sp.get("dryRun") !== "false"; // default true
  const entity = sp.get("entity") ?? "medicalRecord";
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50), 1), 500);

  const stats = { scanned: 0, encrypted: 0, skipped: 0, errors: 0 };

  if (entity === "medicalRecord") {
    const records = await prisma.medicalRecord.findMany({
      take: limit,
      select: { id: true, subjective: true, objective: true, assessment: true, plan: true },
    });
    for (const r of records) {
      stats.scanned++;
      const update: { subjective?: string | null; objective?: string | null; assessment?: string | null; plan?: string | null } = {};
      let needsUpdate = false;
      if (r.subjective && !isEnvelope(r.subjective)) { update.subjective = encryptField(r.subjective); needsUpdate = true; }
      if (r.objective  && !isEnvelope(r.objective))  { update.objective  = encryptField(r.objective);  needsUpdate = true; }
      if (r.assessment && !isEnvelope(r.assessment)) { update.assessment = encryptField(r.assessment); needsUpdate = true; }
      if (r.plan       && !isEnvelope(r.plan))       { update.plan       = encryptField(r.plan);       needsUpdate = true; }
      if (!needsUpdate) { stats.skipped++; continue; }
      if (!dryRun) {
        try {
          await prisma.medicalRecord.update({ where: { id: r.id }, data: update });
          stats.encrypted++;
        } catch (e) {
          stats.errors++;
          console.error("encrypt-historical medicalRecord", r.id, e);
        }
      } else {
        stats.encrypted++; // dryRun: cuenta como "se cifraría"
      }
    }
  } else if (entity === "prescription") {
    const rxs = await prisma.prescription.findMany({
      take: limit,
      select: { id: true, indications: true },
    });
    for (const rx of rxs) {
      stats.scanned++;
      if (!rx.indications || isEnvelope(rx.indications)) { stats.skipped++; continue; }
      if (!dryRun) {
        try {
          await prisma.prescription.update({
            where: { id: rx.id },
            data: { indications: encryptField(rx.indications) },
          });
          stats.encrypted++;
        } catch (e) {
          stats.errors++;
          console.error("encrypt-historical prescription", rx.id, e);
        }
      } else {
        stats.encrypted++;
      }
    }
  } else if (entity === "patient") {
    const patients = await prisma.patient.findMany({
      take: limit,
      select: { id: true, notes: true },
    });
    for (const p of patients) {
      stats.scanned++;
      if (!p.notes || isEnvelope(p.notes)) { stats.skipped++; continue; }
      if (!dryRun) {
        try {
          await prisma.patient.update({
            where: { id: p.id },
            data: { notes: encryptField(p.notes) },
          });
          stats.encrypted++;
        } catch (e) {
          stats.errors++;
          console.error("encrypt-historical patient", p.id, e);
        }
      } else {
        stats.encrypted++;
      }
    }
  } else {
    return NextResponse.json({ error: "invalid_entity", supported: ["medicalRecord", "prescription", "patient"] }, { status: 400 });
  }

  return NextResponse.json({
    entity,
    dryRun,
    limit,
    ...stats,
    note: dryRun
      ? "Dry run — no se modificó nada. Pasar ?dryRun=false para ejecutar."
      : "Sweep ejecutado. Repetir hasta scanned===skipped (todo cifrado).",
  });
}
