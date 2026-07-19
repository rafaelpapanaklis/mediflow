import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { logMutation } from "@/lib/audit";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { round2 } from "@/lib/quotes/compute";
import {
  EMPTY_NOTE_ERROR,
  isClinicalNoteEmpty,
  normalizeNoteStatus,
} from "@/lib/clinical/note-validation";

export const dynamic = "force-dynamic";

// NOM-004: misma validación de payload que /api/clinical-notes para no aceptar
// expedientes sin paciente. specialtyData se sanea aparte (status/signedAt).
const CreateSchema = z.object({
  patientId: z.string().min(1),
  subjective: z.string().nullable().optional(),
  objective: z.string().nullable().optional(),
  assessment: z.string().nullable().optional(),
  plan: z.string().nullable().optional(),
  diagnoses: z.any().optional(),
  vitals: z.record(z.any()).nullable().optional(),
  specialtyData: z.record(z.any()).nullable().optional(),
  autoInvoice: z.boolean().optional(),
});

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  if (activeClinicId) {
    const u = await prisma.user.findFirst({ where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true }, include: { clinic: true } });
    if (u) return u;
  }
  return prisma.user.findFirst({ where: { supabaseId: user.id, isActive: true }, include: { clinic: true }, orderBy: { createdAt: "asc" } });
}

export async function GET(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // NOM-004 PERMISOS-CONSISTENCIA: leer el expediente requiere permiso explícito
  // (igual que /api/records GET); antes solo pedía sesión.
  const denied = denyIfMissingPermission(dbUser, "medicalRecord.view");
  if (denied) return denied;
  const patientId = req.nextUrl.searchParams.get("patientId");
  if (!patientId) return NextResponse.json({ error: "patientId required" }, { status: 400 });
  const records = await prisma.medicalRecord.findMany({
    where: { clinicId: dbUser.clinicId, patientId },
    include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { visitDate: "desc" },
  });
  return NextResponse.json(records);
}

export async function POST(req: NextRequest) {
  const dbUser = await getDbUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // NOM-004 PERMISOS-CONSISTENCIA: mismo permiso que /api/clinical-notes para
  // crear/firmar notas. Antes esta ruta solo exigía sesión.
  const denied = denyIfMissingPermission(dbUser, "medicalRecord.edit");
  if (denied) return denied;

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Verify patient belongs to this clinic
  const patient = await prisma.patient.findFirst({
    where: { id: data.patientId, clinicId: dbUser.clinicId },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  // NOM-004 INALTERABILIDAD: la nota nace SIEMPRE con status y el cliente no
  // puede forjar la firma. Strippeamos status/signedAt del payload — el servidor
  // decide el status y sella signedAt. (Antes nacía sin status y aceptaba
  // status/signedAt arbitrarios del cliente vía specialtyData.)
  const incomingSpec = (data.specialtyData ?? {}) as Record<string, unknown>;
  const { status: _ignoredStatus, signedAt: _ignoredSignedAt, ...cleanSpec } = incomingSpec;
  const status = normalizeNoteStatus(incomingSpec.status);

  // NOM-004 CAMPOS-OBLIGATORIOS: no permitir que una nota NAZCA firmada vacía.
  if (
    status === "SIGNED" &&
    isClinicalNoteEmpty({
      subjective: data.subjective,
      objective: data.objective,
      assessment: data.assessment,
      plan: data.plan,
      specialtyData: cleanSpec,
    })
  ) {
    return NextResponse.json({ error: EMPTY_NOTE_ERROR }, { status: 422 });
  }

  const finalSpec = {
    ...cleanSpec,
    status,
    ...(status === "SIGNED" ? { signedAt: new Date().toISOString() } : {}),
  };

  const record = await prisma.medicalRecord.create({
    data: { clinicId: dbUser.clinicId, patientId: data.patientId, doctorId: dbUser.id,
      visitDate: new Date(), subjective: data.subjective ?? null, objective: data.objective ?? null,
      assessment: data.assessment ?? null, plan: data.plan ?? null, diagnoses: data.diagnoses,
      vitals: data.vitals ?? undefined, specialtyData: finalSpec },
    include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
  });

  // NOM-004 AUDITORIA: la creación del expediente (y, si nace firmada, la firma)
  // deja rastro. clinicId SIEMPRE de la sesión (multi-tenant).
  await logMutation({
    req,
    clinicId: dbUser.clinicId,
    userId: dbUser.id,
    entityType: "record",
    entityId: record.id,
    action: "create",
    after: {
      patientId: record.patientId,
      doctorId: record.doctorId,
      status,
      subjective: record.subjective,
      objective: record.objective,
      assessment: record.assessment,
      plan: record.plan,
    },
  });

  // ── Auto-create draft invoice from procedures (if any had prices) ──────────
  let draftInvoice = null;
  if (data.autoInvoice && Array.isArray((cleanSpec as any).procedures) && (cleanSpec as any).procedures.length > 0) {
    try {
      const procedures = (cleanSpec as any).procedures as Array<{ id?: string; name: string; price: number; quantity: number }>;
      const validProcs = procedures.filter(p => p.name && typeof p.price === "number" && p.price > 0);

      if (validProcs.length > 0) {
        const items = validProcs.map(p => ({
          description: p.name,
          quantity: p.quantity || 1,
          unitPrice: p.price,
          total: round2((p.quantity || 1) * p.price),
        }));
        const subtotal = round2(items.reduce((s, i) => s + i.total, 0));

        // Generate invoice number (clinic-scoped)
        const lastInvoice = await prisma.invoice.findFirst({
          where: { clinicId: dbUser.clinicId },
          orderBy: { createdAt: "desc" },
          select: { invoiceNumber: true },
        });
        const lastNum = lastInvoice?.invoiceNumber ? parseInt(lastInvoice.invoiceNumber.replace(/\D/g, "")) || 0 : 0;
        const invoiceNumber = `MF-${String(lastNum + 1).padStart(4, "0")}`;

        draftInvoice = await prisma.invoice.create({
          data: {
            clinicId: dbUser.clinicId,
            patientId: data.patientId,
            invoiceNumber,
            items: items as any,
            subtotal,
            discount: 0,
            total: subtotal,
            paid: 0,
            balance: subtotal,
            status: "DRAFT",
            notes: `Auto-generada desde expediente clínico del ${new Date().toLocaleDateString("es-MX")}`,
          },
        });
      }
    } catch (err) {
      console.error("Error creating draft invoice:", err);
      // Don't fail the clinical record creation if invoice fails
    }
  }

  revalidatePath("/dashboard/clinical");
  revalidatePath("/dashboard/patients");
  revalidatePath("/dashboard/billing");
  return NextResponse.json({ ...record, draftInvoice }, { status: 201 });
}
