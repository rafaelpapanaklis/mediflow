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
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { getPatientDeleteBlockers } from "@/lib/patient-deletion";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // MULTI-CLÍNICA · FASE 2 — la ficha se puede LEER desde una sede vinculada.
  // Con el flag apagado, clinicIds = [ctx.clinicId] y esto es la query de hoy.
  const visibility = await getPatientVisibility(ctx.clinicId);

  // El doctor de cada cita/nota va con `select` MÍNIMO, nunca `doctor: true`:
  // la fila completa de User carga totpSecret, recoveryCodes, cajaPinHash,
  // googleRefreshToken y stripeAccountId, y aquí se serializaba al navegador
  // repetida por CADA cita y CADA nota del paciente (P1-9).
  const doctorPublic = { select: { id: true, firstName: true, lastName: true } } as const;

  // Use buildPatientWhere so doctors can only see their own patients
  const patient = await prisma.patient.findFirst({
    where: { ...buildPatientWhere(ctx, {}, visibility.clinicIds), id: params.id },
    include: {
      // Citas y facturas SIEMPRE de la sede activa, aunque el paciente venga
      // prestado: cada sucursal agenda y cobra por separado. Para un paciente
      // propio el filtro no cambia nada.
      appointments: { where: { clinicId: ctx.clinicId }, orderBy: { startsAt: "desc" }, include: { doctor: doctorPublic } },
      // El expediente SÍ viaja: es el contenido clínico que se comparte. El
      // scope explícito es defensa en profundidad — hoy medicalRecord.clinicId
      // SIEMPRE coincide con el del paciente (todos los writers lo validan),
      // así que para un paciente propio es no-op; queda puesto para que el día
      // que exista una escritura sobre paciente prestado esto no se vuelva una
      // fuga transitiva. Además excluye notas privadas de sedes ajenas.
      records:      { where: sharedRecordScope(ctx.clinicId, visibility.clinicIds), orderBy: { visitDate: "desc" }, include: { doctor: doctorPublic } },
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
      // Archivar exige "patients.delete", igual que el handler DELETE. Antes era
      // `ctx.isAdmin` a secas: el permiso del modal de equipo existía pero no
      // mandaba (no se le podía conceder a una recepcionista ni retirar a un
      // admin). Por default ADMIN/SUPER_ADMIN lo tienen, así que el archivado
      // masivo de la lista de pacientes sigue funcionando igual que hoy.
      if (body.status === "ARCHIVED") {
        const deniedArchive = denyIfMissingPermission(ctx, "patients.delete");
        if (deniedArchive) return deniedArchive;
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

/**
 * DELETE — DOS modos, ambos detrás del permiso "patients.delete":
 *
 *   DELETE /api/patients/:id              → ARCHIVA (status = ARCHIVED).
 *                                           Comportamiento histórico, intacto.
 *   DELETE /api/patients/:id?mode=hard    → BORRADO DEFINITIVO de la fila.
 *
 * El borrado definitivo solo procede si el paciente no tiene nada que obligue a
 * conservarlo (facturas/pagos/CFDI + historia clínica —notas, recetas,
 * consentimientos, archivos, radiografías, odontograma— + las 5 tablas con
 * `onDelete: Restrict`, ver @/lib/patient-deletion). Si lo tiene responde 409 con
 * `{ blocked: true, reasons: [{ type, count }] }` para que la UI lo explique en
 * español y ofrezca archivar.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Permiso granular, NO `ctx.isAdmin`: así el toggle "Archivar/eliminar
  // pacientes" del modal de equipo manda de verdad sobre quién puede hacerlo.
  const denied = denyIfMissingPermission(ctx, "patients.delete");
  if (denied) return denied;

  const hardDelete = req.nextUrl.searchParams.get("mode") === "hard";

  // Scope multi-tenant + visibilidad por paciente, mismo criterio que PUT/PATCH:
  // si no es de esta clínica, o este usuario no lo puede ver, para él no existe
  // → 404. Nunca 403 con datos: un 403 confirmaría que el paciente existe.
  const before = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId, AND: patientVisibilityAnd(ctx) },
    select: { id: true, firstName: true, lastName: true, patientNumber: true, status: true },
  });
  if (!before) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  // ── Modo ARCHIVAR (default) ────────────────────────────────────────────
  if (!hardDelete) {
    await prisma.patient.updateMany({
      where: { id: params.id, clinicId: ctx.clinicId },
      data:  { status: "ARCHIVED" },
    });

    await logMutation({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "patient",
      entityId: params.id,
      action: "delete",
      before: before as any,
    });

    revalidateAfter("patients");
    return NextResponse.json({ success: true, archived: true });
  }

  // ── Modo BORRADO DEFINITIVO ────────────────────────────────────────────
  const reasons = await getPatientDeleteBlockers(params.id, ctx.clinicId);
  if (reasons.length > 0) {
    return NextResponse.json({ blocked: true, reasons }, { status: 409 });
  }

  // La bitácora se escribe ANTES del DELETE, a propósito. AuditLog cuelga de
  // clinicId/userId (entityId es un string suelto, sin FK al paciente), así que
  // la fila sobrevive al borrado; pero el snapshot `before` solo se puede leer
  // mientras el paciente exista. Contrapartida asumida: si el DELETE de abajo
  // falla por una FK que el precheck no vio, queda un registro de intento.
  // Preferimos un log de más a un borrado sin rastro (conservación NOM-024).
  await logMutation({
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "patient",
    entityId: params.id,
    action: "delete",
    before: { ...before, hardDelete: true } as any,
  });

  try {
    // El borrado va en transacción: el `deleteMany` repite el scope de clínica
    // (defensa en profundidad) y las filas hijas las arrastra la BD en cascada
    // — el schema no declara relationMode, así que las FK son reales. Las 5
    // tablas con Restrict revientan aquí si el precheck se quedó corto.
    // timeout holgado: sin facturas el expediente igual puede traer cientos de
    // citas/notas/fotos colgando, y la cascada las borra todas en el mismo statement.
    await prisma.$transaction(
      async (tx) => {
        await tx.patient.deleteMany({ where: { id: params.id, clinicId: ctx.clinicId } });
      },
      { timeout: 20000 },
    );
  } catch (err: any) {
    // P2003 = foreign key constraint, P2014 = relación requerida. Algo quedó
    // colgando que el precheck no cubre: se responde como bloqueo (409) para
    // que la UI lo explique, en vez de un 500 sin sentido para el usuario.
    if (err?.code === "P2003" || err?.code === "P2014") {
      return NextResponse.json(
        { blocked: true, reasons: [{ type: "related", count: 0 }] },
        { status: 409 },
      );
    }
    throw err;
  }

  revalidateAfter("patients");
  return NextResponse.json({ success: true, deleted: true });
}
