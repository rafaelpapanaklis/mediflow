import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logMutation } from "@/lib/audit";
import { hasPermission } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

function buildVerifyUrl(req: NextRequest, id: string) {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host  = req.headers.get("host") ?? "mediflow.app";
  return `${proto}://${host}/portal/prescription/${id}/verify`;
}

/**
 * NOM-024: vigencia legal de la receta según grupo COFEPRIS.
 * - Grupo I (estupefacientes):  24 horas
 * - Grupo II (psicotrópicos):   30 días
 * - Grupo III (algunos opioides débiles, antidepresivos): 90 días
 * - Grupo IV-VI / sin grupo:    180 días (default seguro)
 */
function expiresForCofeprisGroup(group?: string | null, base: Date = new Date()): Date {
  const out = new Date(base);
  switch ((group ?? "").toUpperCase()) {
    case "I":   out.setHours(out.getHours() + 24); break;
    case "II":  out.setDate(out.getDate() + 30);   break;
    case "III": out.setDate(out.getDate() + 90);   break;
    default:    out.setDate(out.getDate() + 180);  break;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(ctx.role as "DOCTOR" | "ADMIN" | "SUPER_ADMIN" | "RECEPTIONIST" | "READONLY", "prescription.read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const patientId = req.nextUrl.searchParams.get("patientId");
  if (!patientId) return NextResponse.json({ error: "patientId required" }, { status: 400 });

  const list = await prisma.prescription.findMany({
    where: { clinicId: ctx.clinicId, patientId },
    include: {
      doctor: { select: { id: true, firstName: true, lastName: true } },
      items:  { include: { cums: true } },
    },
    orderBy: { issuedAt: "desc" },
  });
  return NextResponse.json(list);
}

interface PrescriptionItemBody {
  cumsKey?: string;
  dosage?: string;
  duration?: string;
  quantity?: string;
  notes?: string;
}

/**
 * POST /api/prescriptions — crea receta NOM-024 completa.
 *
 * Body: {
 *   patientId,                   // requerido
 *   medicalRecordId?,            // opcional — receta standalone si se omite
 *   items: [{ cumsKey, dosage, duration?, quantity?, notes? }],
 *   indications?, cofeprisGroup?, cofeprisFolio?, expiresAt? (override)
 * }
 *
 * La receta puede emitirse standalone (sin consulta asociada) o
 * vinculada a un MedicalRecord existente (flujo "Iniciar consulta").
 *
 * Compat: si llega `medications` (legacy JSON), lo guardamos también para
 * datos históricos. Si no llegan items nuevos pero sí medications, NO
 * permitimos crear: se requiere migrar al formato items con CUMS.
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(ctx.role as "DOCTOR" | "ADMIN" | "SUPER_ADMIN" | "RECEPTIONIST" | "READONLY", "prescription.create")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { medicalRecordId, patientId, items, indications, cofeprisGroup, cofeprisFolio, expiresAt: expiresAtOverride } = body;
  const medicationsLegacy = body.medications;

  if (!patientId) {
    return NextResponse.json({ error: "patientId requerido" }, { status: 400 });
  }

  // Multi-tenant: el paciente debe pertenecer a la clínica del usuario.
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  // Items con FK a CUMS — preferido (NOM-024).
  const itemsArray: PrescriptionItemBody[] = Array.isArray(items) ? items : [];
  if (itemsArray.length === 0) {
    return NextResponse.json({
      error: "items_required",
      detail: "La receta requiere al menos un medicamento con cumsKey + dosage.",
    }, { status: 400 });
  }
  for (const it of itemsArray) {
    if (!it.cumsKey || typeof it.cumsKey !== "string") {
      return NextResponse.json({ error: "item_cumsKey_required" }, { status: 400 });
    }
    if (!it.dosage || typeof it.dosage !== "string" || it.dosage.trim().length === 0) {
      return NextResponse.json({ error: "item_dosage_required" }, { status: 400 });
    }
  }

  // Si la receta viene vinculada a una consulta, validar que pertenece a la
  // clínica del usuario y al mismo paciente. Si es standalone, omitir.
  if (medicalRecordId) {
    const record = await prisma.medicalRecord.findFirst({
      where: { id: medicalRecordId, clinicId: ctx.clinicId, patientId },
      select: { id: true },
    });
    if (!record) return NextResponse.json({ error: "Expediente no encontrado" }, { status: 404 });
  }

  // NOM-024: el médico debe tener cédula profesional registrada.
  const doctor = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { cedulaProfesional: true },
  });
  if (!doctor?.cedulaProfesional) {
    return NextResponse.json({
      error: "doctor_sin_cedula",
      detail: "El doctor debe tener cédula profesional registrada antes de emitir recetas. Configurar en /dashboard/team.",
    }, { status: 422 });
  }

  // Validar que todas las claves CUMS existan en el catálogo.
  const cumsKeys = itemsArray.map((it) => it.cumsKey!).filter(Boolean);
  const foundCums = await prisma.cumsItem.findMany({
    where: { clave: { in: cumsKeys } },
    select: { clave: true },
  });
  const foundSet = new Set(foundCums.map((c) => c.clave));
  const missing = cumsKeys.filter((k) => !foundSet.has(k));
  if (missing.length > 0) {
    return NextResponse.json({ error: "cums_not_found", missing }, { status: 404 });
  }

  const issuedAt = new Date();
  const expiresAt = expiresAtOverride
    ? new Date(expiresAtOverride)
    : expiresForCofeprisGroup(cofeprisGroup, issuedAt);

  const qrCode = randomBytes(16).toString("hex");

  // Transacción atómica: receta + items.
  const created = await prisma.$transaction(async (tx) => {
    const rx = await tx.prescription.create({
      data: {
        medicalRecordId: medicalRecordId ?? null,
        patientId,
        doctorId: ctx.userId,
        clinicId: ctx.clinicId,
        medications: medicationsLegacy ?? itemsArray, // legacy JSON snapshot
        indications: indications ?? null,
        qrCode,
        verifyUrl: "",
        cofeprisGroup: cofeprisGroup ?? null,
        cofeprisFolio: cofeprisFolio ?? null,
        issuedAt,
        expiresAt,
      },
    });
    await tx.prescriptionItem.createMany({
      data: itemsArray.map((it) => ({
        prescriptionId: rx.id,
        cumsKey: it.cumsKey!,
        dosage: it.dosage!.slice(0, 200),
        duration: it.duration?.slice(0, 100) ?? null,
        quantity: it.quantity?.slice(0, 50) ?? null,
        notes: it.notes ?? null,
      })),
    });
    return rx;
  });

  const verifyUrl = buildVerifyUrl(req, created.id);
  const updated = await prisma.prescription.update({
    where: { id: created.id },
    data: { verifyUrl },
    include: { items: { include: { cums: true } } },
  });

  await logMutation({
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "prescription",
    entityId: updated.id,
    action: "create",
    after: {
      patientId: updated.patientId,
      itemsCount: itemsArray.length,
      cofeprisGroup: updated.cofeprisGroup,
      expiresAt: updated.expiresAt,
    },
  });

  revalidatePath("/dashboard/clinical");
  return NextResponse.json(updated, { status: 201 });
}
