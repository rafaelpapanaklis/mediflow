import { NextRequest, NextResponse } from "next/server";
import { Prisma, PatientStatus, Gender } from "@prisma/client";
import { getAuthContext, buildPatientWhere } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { patientSchema } from "@/lib/validations";
import { validateCurpRecord } from "@/lib/validators/curp";
import { logMutation } from "@/lib/audit";
import { revalidateAfter } from "@/lib/cache/revalidate";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Use buildPatientWhere so doctors can only see their own patients
  const patient = await prisma.patient.findFirst({
    where: { ...buildPatientWhere(ctx), id: params.id },
    include: {
      appointments: { orderBy: { startsAt: "desc" }, include: { doctor: true } },
      records:      { orderBy: { visitDate: "desc" }, include: { doctor: true } },
      invoices:     { include: { payments: true } },
    },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  return NextResponse.json(patient);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify patient belongs to clinic first
  const exists = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!exists) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  try {
    const body = await req.json();
    const data = patientSchema.parse(body);

    // NOM-024 — validar coherencia curp/curpStatus/passportNo si vienen.
    if (data.curpStatus !== undefined) {
      const check = validateCurpRecord({
        curp: data.curp ?? null,
        curpStatus: data.curpStatus,
        passportNo: data.passportNo ?? null,
      });
      if (check.ok === false) return NextResponse.json({ error: check.error }, { status: 400 });
    }

    await prisma.patient.update({
      where: { id: params.id },
      data: {
        ...data,
        dob:    data.dob    ? new Date(data.dob) : undefined,
        email:  data.email  || undefined,
        gender: (data.gender ?? "OTHER") as any,
        curp:   data.curp ? data.curp.toUpperCase().trim() : data.curp,
      },
    });
    const updated = await prisma.patient.findUnique({ where: { id: params.id } });

    await logMutation({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "patient",
      entityId: params.id,
      action: "update",
      before: exists as any,
      after: updated as any,
    });

    revalidateAfter("patients");
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

/**
 * PATCH — actualización PARCIAL. Solo toca los campos enviados, contra una
 * whitelist segura. Lo usa la lista de pacientes para el toggle de etiquetas
 * (VIP), cambiar status, reasignar doctor, etc. El PUT exige el formulario
 * completo; sin este handler esas acciones caían en 405 y fallaban en silencio.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Scope multi-tenant: el paciente DEBE pertenecer a la clínica de la
  // sesión. clinicId SIEMPRE de la sesión, nunca del body.
  const exists = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!exists) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    const raw = await req.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error();
    body = raw as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  // Whitelist de campos editables vía PATCH. NO incluye clinicId, id,
  // patientNumber, portalToken ni CURP. Los datos fiscales del receptor CFDI
  // (rfcPaciente/razonSocialPac/regimenFiscalPac/cpPaciente) SÍ se aceptan aquí:
  // se guardan al timbrar una factura para reusarlos la próxima vez.
  const data: Prisma.PatientUncheckedUpdateInput = {};
  const set = (k: string, v: unknown) => { (data as Record<string, unknown>)[k] = v; };

  try {
    for (const k of ["email", "phone", "bloodType", "address", "notes", "familyHistory", "personalNonPathologicalHistory", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelation"] as const) {
      if (!has(k)) continue;
      const v = body[k];
      if (v !== null && typeof v !== "string") throw new Error(`Campo ${k} inválido`);
      set(k, v === null || v === "" ? null : v);
    }
    // Datos fiscales del receptor CFDI (nullable). Se normalizan con trim.
    for (const k of ["rfcPaciente", "razonSocialPac", "regimenFiscalPac", "cpPaciente"] as const) {
      if (!has(k)) continue;
      const v = body[k];
      if (v !== null && typeof v !== "string") throw new Error(`Campo ${k} inválido`);
      const trimmed = typeof v === "string" ? v.trim() : v;
      set(k, trimmed === null || trimmed === "" ? null : trimmed);
    }
    for (const k of ["firstName", "lastName"] as const) {
      if (!has(k)) continue;
      const v = body[k];
      if (typeof v !== "string" || !v.trim()) throw new Error(`Campo ${k} inválido`);
      set(k, v.trim());
    }
    for (const k of ["tags", "allergies", "chronicConditions", "currentMedications"] as const) {
      if (!has(k)) continue;
      const v = body[k];
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`Campo ${k} inválido`);
      set(k, v);
    }
    if (has("isChild")) {
      if (typeof body.isChild !== "boolean") throw new Error("isChild inválido");
      data.isChild = body.isChild;
    }
    if (has("dob")) {
      if (body.dob === null || body.dob === "") {
        data.dob = null;
      } else {
        const d = new Date(body.dob as string);
        if (isNaN(d.getTime())) throw new Error("dob inválido");
        data.dob = d;
      }
    }
    if (has("gender")) {
      if (!["MALE", "FEMALE", "OTHER"].includes(body.gender as string)) throw new Error("gender inválido");
      data.gender = body.gender as Gender;
    }
    if (has("status")) {
      if (!["ACTIVE", "INACTIVE", "ARCHIVED"].includes(body.status as string)) throw new Error("status inválido");
      // Archivar es admin-only, igual que el handler DELETE.
      if (body.status === "ARCHIVED" && !ctx.isAdmin) {
        return NextResponse.json({ error: "Solo administradores pueden archivar pacientes" }, { status: 403 });
      }
      data.status = body.status as PatientStatus;
    }
    if (has("primaryDoctorId")) {
      const pid = body.primaryDoctorId;
      if (pid === null || pid === "") {
        data.primaryDoctorId = null;
      } else if (typeof pid === "string") {
        // El doctor asignado debe pertenecer a la misma clínica (multi-tenant).
        const doc = await prisma.user.findFirst({
          where: { id: pid, clinicId: ctx.clinicId, isActive: true },
          select: { id: true },
        });
        if (!doc) throw new Error("Doctor inválido");
        data.primaryDoctorId = pid;
      } else {
        throw new Error("primaryDoctorId inválido");
      }
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Cuerpo inválido" }, { status: 400 });
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }

  const updated = await prisma.patient.update({ where: { id: params.id }, data });

  await logMutation({
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "patient",
    entityId: params.id,
    action: "update",
    before: exists as any,
    after: updated as any,
  });

  revalidateAfter("patients");
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only admins can archive patients
  if (!ctx.isAdmin) return NextResponse.json({ error: "Solo administradores pueden archivar pacientes" }, { status: 403 });

  // Capturamos before para audit log
  const beforeArchive = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { firstName: true, lastName: true, status: true },
  });

  await prisma.patient.updateMany({
    where: { id: params.id, clinicId: ctx.clinicId },
    data:  { status: "ARCHIVED" },
  });

  if (beforeArchive) {
    await logMutation({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "patient",
      entityId: params.id,
      action: "delete",
      before: beforeArchive as any,
    });
  }

  revalidateAfter("patients");
  return NextResponse.json({ success: true });
}
