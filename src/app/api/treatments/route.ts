import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { relatedPatientVisibilityAnd, assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { RECIBE_CITAS_WHERE } from "@/lib/agenda/roles-que-atienden";
import { cuerpoDoctorNoRecibeCitasDe } from "@/lib/agenda/roles-que-atienden-db";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { logMutation } from "@/lib/audit";
import { CODIGO_PLAN_SIN_COSTO, faltaConfirmarSinCosto } from "@/lib/treatments/plan-sin-costo";
import { aPesos, comoNueva, conProcedimientosValidos, filaDto, leerFilas, totalCentavos, type FilaDelPlan } from "@/lib/treatments/items";
import { procedimientosDeLaClinica, repoFilas, tablaDeFilasExiste } from "@/lib/treatments/items-db";
import { cuerpoDeErrorDeFila } from "@/lib/treatments/errores";
import { presupuestoDesdeElPlan, type ResultadoPresentar } from "@/lib/treatments/presentar.server";
import { avisoDeFilasRepetidas } from "@/lib/treatments/ya-en-planes.server";

// GET /api/treatments — list all treatment plans for clinic (role-filtered)
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // EQ-07: "Ver planes de tratamiento" existía en el modal y no lo leía nadie.
  // Lo tienen los 5 roles por default, así que hoy no cambia a nadie; lo que
  // cambia es que apagarlo empieza a hacer algo.
  const deniedPerm = denyIfMissingPermission(ctx, "treatments.view");
  if (deniedPerm) return deniedPerm;

  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get("patientId");
  const status    = searchParams.get("status"); // ACTIVE | COMPLETED | ABANDONED | PAUSED
  // v17 (decisión 4 de Rafael): la ficha y «Hoy en el sillón» piden los planes del paciente de TODOS sus
  // doctores (`todosLosDoctores=1`, solo con `patientId`) para enseñar sus procedimientos con «Hecho»: el
  // doctor ya ve esos planes en la ficha (nombre, costo y cuenta); faltaba su lista de procedimientos. Sin
  // el parámetro, el doctor sigue viendo solo los suyos.
  const deTodosLosDoctores = !!patientId && searchParams.get("todosLosDoctores") === "1";
  // ws1-t12 v20 (B1 de t1): `?status=` ya no va al `where` de Prisma — en la base real `treatment_plans.status` es
  // TEXT y Prisma manda el parámetro como enum `TreatmentStatus` (42883). Los planes de ese estado se eligen con
  // `"status"::text` (vale con la columna TEXT o enum) y entran como `id: { in }`; la paginación sigue exacta.
  // v22 (t5 de la v21, m2): `patientId=` vacío es «sin paciente», igual que en el `where` de abajo (`|| null`).
  if (status && !["ACTIVE", "COMPLETED", "ABANDONED", "PAUSED"].includes(status)) {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }
  const idsConEstado = status
    ? (await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "treatment_plans"
         WHERE "clinicId" = ${ctx.clinicId} AND "status"::text = ${status}
           AND (${patientId || null}::text IS NULL OR "patientId" = ${patientId || null})`).map((r) => r.id)
    : null;
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "200"), 1), 500);
  const skip  = Math.max(parseInt(searchParams.get("skip") ?? "0"), 0);

  const treatments = await prisma.treatmentPlan.findMany({
    where: {
      clinicId:  ctx.clinicId,
      ...(patientId ? { patientId } : {}),
      ...(ctx.isDoctor && !deTodosLosDoctores ? { doctorId: ctx.userId } : {}),
      ...(idsConEstado ? { id: { in: idsConEstado } } : {}),
      // Visibilidad por paciente. Va como filtro de RELACIÓN (no un assert)
      // porque `patientId` es opcional: sin él, esto listaba los planes de TODA
      // la clínica, restringidos incluidos.
      AND: relatedPatientVisibilityAnd({
        userId: ctx.userId,
        role: ctx.role,
        clinicId: ctx.clinicId,
      }),
    },
    include: {
      patient:  { select: { id: true, firstName: true, lastName: true, phone: true } },
      doctor:   { select: { id: true, firstName: true, lastName: true, color: true } },
      sessions: { orderBy: { sessionNumber: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip,
  });

  // ws1-t12 · P2: las filas de cada plan (una consulta para todos). Sin la tabla, `items: []` y el
  // plan se lee de su texto como siempre.
  const filasPorPlan = await repoFilas.leerDePlanes(ctx.clinicId, treatments.map((t) => t.id));

  return NextResponse.json(treatments.map(t => ({
    ...t,
    items:           (filasPorPlan.get(t.id) ?? []).map(filaDto),
    startDate:       t.startDate instanceof Date ? t.startDate.toISOString() : t.startDate,
    endDate:         t.endDate instanceof Date ? t.endDate.toISOString() : t.endDate,
    nextExpectedDate:t.nextExpectedDate instanceof Date ? t.nextExpectedDate.toISOString() : t.nextExpectedDate,
    createdAt:       t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
    updatedAt:       t.updatedAt instanceof Date ? t.updatedAt.toISOString() : t.updatedAt,
  })));
}

// POST /api/treatments — create a new treatment plan
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // EQ-07: "Crear y editar planes de tratamiento". Antes cualquier sesión
  // creaba planes (solo-lectura incluido); el default lo tienen SA/ADMIN/
  // DOCTOR/RECEPTIONIST, que son quienes de verdad los arman.
  const deniedPerm = denyIfMissingPermission(ctx, "treatments.edit");
  if (deniedPerm) return deniedPerm;

  const body = await req.json();
  const { patientId, doctorId, name, description, totalSessions, sessionIntervalDays, totalCost } = body;

  // ws1-t12 · P2: los procedimientos como FILAS (`items`). Se validan antes de tocar nada: una fila
  // mala no deja un plan a medias. Sin la tabla (SQL sin pegar) se ignoran y el plan se guarda como
  // hoy, con su texto en `description` (la ventana lo sigue mandando).
  let filasNuevas: ReturnType<typeof comoNueva>[] = [];
  if (body.items !== undefined) {
    const lectura = leerFilas(body.items);
    if (!lectura.ok) return NextResponse.json(cuerpoDeErrorDeFila(lectura.codigo!, lectura.indice), { status: 400 });
    filasNuevas = lectura.filas!.map(comoNueva);
  }
  // Sin costo escrito, el plan con filas cuesta lo que suman (nada de teclearlo dos veces).
  const costoDelPlan = totalCost ?? (filasNuevas.length ? aPesos(totalCentavos(filasNuevas.map((f) => ({ ...f, estado: "pendiente" as const })))) : undefined);

  if (!patientId || !name) {
    return NextResponse.json({ error: "patientId y nombre son requeridos" }, { status: 400 });
  }

  // Verify patient belongs to clinic
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  // Visibilidad: la respuesta incluye patient (include → nombre) en el eco. Sin
  // este assert, un usuario excluido crea un plan y recibe el nombre del paciente
  // restringido. El GET ya filtra vía relatedPatientVisibilityAnd; el POST faltaba.
  const denied = await assertPatientVisible(patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (denied) return denied;

  // Doctors can only create plans for themselves
  const assignedDoctorId = ctx.isDoctor ? ctx.userId : (doctorId ?? ctx.userId);

  // ws1-t10: el doctor elegido llega del navegador. Tiene que ser de ESTA
  // clínica y poder atender (la misma regla que la Agenda: rol que atiende,
  // activo y «Aparece en la agenda»). Antes se guardaba cualquier id, también el
  // de recepción o el de otra clínica.
  if (!ctx.isDoctor && typeof doctorId === "string" && doctorId) {
    const atiende = await prisma.user.findFirst({
      where: { id: doctorId, clinicId: ctx.clinicId, ...RECIBE_CITAS_WHERE },
      select: { id: true },
    });
    if (!atiende) {
      // Esta API contesta la frase en `error` (la pantalla la enseña tal cual) y el código en `code`.
      const { reason, motivo } = await cuerpoDoctorNoRecibeCitasDe(ctx.clinicId, doctorId);
      return NextResponse.json({ error: reason, code: "doctor_not_found", motivo }, { status: 404 });
    }
  }

  // ws1-t2 (F15): un plan en $0 no se crea sin confirmarlo (la pantalla pregunta antes y manda
  // `confirmarSinCosto: true`). Va DESPUÉS de validar paciente y doctor: el aviso solo sale cuando
  // lo demás ya está bien, y no dice nada de un paciente ajeno.
  if (faltaConfirmarSinCosto({ ...body, totalCost: costoDelPlan })) {
    return NextResponse.json(
      {
        error: "El plan va en $0: ningún procedimiento trae precio. Escribe el costo o confirma que va sin costo.",
        code: CODIGO_PLAN_SIN_COSTO,
      },
      { status: 409 },
    );
  }

  const sessions = Number(totalSessions ?? 1);
  const interval = Number(sessionIntervalDays ?? 30);

  // Calculate expected end date
  const startDate = new Date();
  const endDate   = new Date(startDate.getTime() + sessions * interval * 24 * 60 * 60 * 1000);
  // First expected session = today + interval
  const nextExpectedDate = new Date(startDate.getTime() + interval * 24 * 60 * 60 * 1000);

  const conFilas = filasNuevas.length > 0 && (await tablaDeFilasExiste());
  if (conFilas) {
    const validos = await procedimientosDeLaClinica(ctx.clinicId, filasNuevas.map((f) => f.procedureId));
    filasNuevas = conProcedimientosValidos(filasNuevas, validos);
  }

  const datosDelPlan = {
    clinicId:            ctx.clinicId,
    patientId,
    doctorId:            assignedDoctorId,
    name:                name.trim(),
    description:         description?.trim() ?? null,
    totalSessions:       sessions,
    sessionIntervalDays: interval,
    totalCost:           Number(costoDelPlan ?? 0),
    startDate,
    endDate,
    nextExpectedDate,
  };
  const incluir = {
    patient: { select: { id: true, firstName: true, lastName: true } },
    doctor:  { select: { id: true, firstName: true, lastName: true } },
    sessions: true,
  } as const;

  // Plan y filas juntos o nada (una transacción).
  let filas: FilaDelPlan[] = [];
  const plan = conFilas
    ? await prisma.$transaction(async (tx) => {
        const p = await tx.treatmentPlan.create({ data: datosDelPlan, include: incluir });
        filas = await repoFilas.insertar(tx, { clinicId: ctx.clinicId, planId: p.id, userId: ctx.userId, filas: filasNuevas });
        return p;
      })
    : await prisma.treatmentPlan.create({ data: datosDelPlan, include: incluir });

  // NOM-024 §6.3.5 — bitácora de creación del plan de tratamiento.
  // clinicId/userId SIEMPRE de sesión (getAuthContext), nunca del body.
  await logMutation({
    req,
    clinicId:   ctx.clinicId,
    userId:     ctx.userId,
    entityType: "treatment",
    entityId:   plan.id,
    action:     "create",
    after:      {
      patientId: plan.patientId, doctorId: plan.doctorId, name: plan.name, totalSessions: plan.totalSessions, totalCost: Number(plan.totalCost),
      ...(filas.length ? { procedimientos: filas.map((f) => f.nombre), filas: filas.length } : {}),
    },
  });

  // ws1-t12 · P4 «Guardar y presentar»: en el mismo clic, el presupuesto del plan (sus filas) y su
  // liga de firma. Pide las llaves de crear y presentar un presupuesto; sin ellas, o si falla, el
  // plan YA quedó guardado y la respuesta dice por qué no se presentó.
  let presupuesto: ResultadoPresentar | null = null;
  let presupuestoError: string | null = null;
  if (body.presentar === true) {
    if (denyIfMissingPermission(ctx, "billing.create") || denyIfMissingPermission(ctx, "billing.edit")) {
      presupuestoError = "sin_permiso";
    } else {
      try {
        presupuesto = await presupuestoDesdeElPlan({ clinicId: ctx.clinicId, userId: ctx.userId, plan, presentar: true });
        if (presupuesto.error) presupuestoError = presupuesto.error.mensaje || "no_presentado";
      } catch (e) {
        console.error("[plan:presentar] no se pudo generar el presupuesto del plan:", e);
        presupuestoError = "no_presentado";
      }
    }
  }

  // Filas que ya están en OTRO plan del paciente (ws1-t6 v3): no se rechaza (rehacer un trabajo es
  // válido), se avisa; la ventana lo dice. La pantalla ya no las ofrece; esto cubre lo que no pase por ella.
  const yaEnOtrosPlanes = conFilas ? await avisoDeFilasRepetidas(ctx.clinicId, patientId, filas, plan.id) : [];

  revalidateAfter("treatments");
  return NextResponse.json({
    ...plan,
    ...(yaEnOtrosPlanes.length ? { yaEnOtrosPlanes } : {}),
    ...(body.presentar === true ? { presupuesto: presupuesto?.quote ?? null, presupuestoError } : {}),
    startDate:       plan.startDate.toISOString(),
    endDate:         plan.endDate?.toISOString() ?? null,
    nextExpectedDate:plan.nextExpectedDate?.toISOString() ?? null,
    createdAt:       plan.createdAt.toISOString(),
    updatedAt:       plan.updatedAt.toISOString(),
    items:           filas.map(filaDto),
    // ¿Se guardaron como filas? false = sin la tabla: el plan quedó como texto, como hoy.
    filasGuardadas:  conFilas,
  }, { status: 201 });
}
