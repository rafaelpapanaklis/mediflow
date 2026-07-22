import { NextRequest, NextResponse } from "next/server";
import { Prisma, PatientStatus, Gender } from "@prisma/client";
import { getAuthContext, buildPatientWhere } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { getPatientVisibility, sharedRecordScope } from "@/lib/branches";
import { patientSchema } from "@/lib/validations";
import { validateCurpRecord } from "@/lib/validators/curp";
import {
  normalizeVisibleUserIds,
  patientVisibilityAnd,
  ensureUserCanSeePatient,
} from "@/lib/patient-visibility";
import { logMutation } from "@/lib/audit";
import { revalidateAfter } from "@/lib/cache/revalidate";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // MULTI-CLÍNICA · FASE 2 — la ficha se puede LEER desde una sede vinculada.
  // Con el flag apagado, clinicIds = [ctx.clinicId] y esto es la query de hoy.
  const visibility = await getPatientVisibility(ctx.clinicId);

  // Use buildPatientWhere so doctors can only see their own patients
  const patient = await prisma.patient.findFirst({
    where: { ...buildPatientWhere(ctx, {}, visibility.clinicIds), id: params.id },
    include: {
      // Citas y facturas SIEMPRE de la sede activa, aunque el paciente venga
      // prestado: cada sucursal agenda y cobra por separado. Para un paciente
      // propio el filtro no cambia nada.
      appointments: { where: { clinicId: ctx.clinicId }, orderBy: { startsAt: "desc" }, include: { doctor: true } },
      // El expediente SÍ viaja: es el contenido clínico que se comparte. El
      // scope explícito es defensa en profundidad — hoy medicalRecord.clinicId
      // SIEMPRE coincide con el del paciente (todos los writers lo validan),
      // así que para un paciente propio es no-op; queda puesto para que el día
      // que exista una escritura sobre paciente prestado esto no se vuelva una
      // fuga transitiva. Además excluye notas privadas de sedes ajenas.
      records:      { where: sharedRecordScope(ctx.clinicId, visibility.clinicIds), orderBy: { visitDate: "desc" }, include: { doctor: true } },
      invoices:     { where: { clinicId: ctx.clinicId }, include: { payments: true } },
    },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  return NextResponse.json({
    ...patient,
    originClinicName:
      patient.clinicId === ctx.clinicId
        ? null
        : visibility.otherClinicNames[patient.clinicId] ?? null,
  });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify patient belongs to clinic first — y que el usuario PUEDA verlo: sin
  // esto, un doctor fuera de la lista podría editar (y así descubrir) a un
  // paciente restringido que ni siquiera aparece en su lista. 404, no 403: un
  // 403 confirmaría que el paciente existe.
  const exists = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId, AND: patientVisibilityAnd(ctx) },
  });
  if (!exists) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  try {
    const body = await req.json();
    const data = patientSchema.parse(body);

    // Visibilidad: SOLO admin la cambia después de creado. patientSchema no
    // incluye el campo (zod lo descarta), así que se lee del body crudo.
    // A un no-admin se le IGNORA en silencio en vez de rechazar el PUT: el
    // modal de edición manda el formulario completo y bloquear todo el guardado
    // por un campo que su UI ni muestra sería un fallo raro de diagnosticar.
    let visibleUserIds: string[] | undefined;
    if (body && Object.prototype.hasOwnProperty.call(body, "visibleUserIds") && ctx.isAdmin) {
      visibleUserIds = await normalizeVisibleUserIds(body.visibleUserIds, {
        userId: ctx.userId,
        role: ctx.role,
        clinicId: ctx.clinicId,
      });
    }

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
        ...(visibleUserIds !== undefined && { visibleUserIds }),
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
  // sesión. clinicId SIEMPRE de la sesión, nunca del body. Y además debe ser
  // VISIBLE para este usuario (mismo criterio que el GET): si no lo ve, para
  // él no existe → 404.
  const exists = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId, AND: patientVisibilityAnd(ctx) },
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
    // Visibilidad: cambiarla después de creado es SOLO de admin. A un no-admin
    // se le ignora el campo (no se rechaza el PATCH entero: el resto del body
    // es legítimo y este handler lo usa la lista para cosas como el toggle VIP).
    if (has("visibleUserIds") && ctx.isAdmin) {
      data.visibleUserIds = await normalizeVisibleUserIds(body.visibleUserIds, {
        userId: ctx.userId,
        role: ctx.role,
        clinicId: ctx.clinicId,
      });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Cuerpo inválido" }, { status: 400 });
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }

  // Auto-inclusión en la MISMA transacción que el update: si le asignamos el
  // paciente a un doctor que NO está en una lista restringida, se agrega. Si no,
  // existiría "el doctor es el titular de un paciente que no puede ver".
  // El orden importa: primero el update (que puede traer una lista NUEVA del
  // admin) y después la auto-inclusión, para que lea la lista ya actualizada.
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.patient.update({ where: { id: params.id }, data });
    const newDoctorId = typeof data.primaryDoctorId === "string" ? data.primaryDoctorId : null;
    const autoIncluded = newDoctorId
      ? await ensureUserCanSeePatient(tx, params.id, newDoctorId, ctx.clinicId)
      : null;
    return autoIncluded ? { ...row, visibleUserIds: autoIncluded } : row;
  });

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
