import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { logAudit } from "@/lib/audit";
import { distinctPhaseCount } from "@/lib/quotes/compute";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { casosDesdePresupuestos } from "@/lib/quotes/ortodoncia.server";
import { conceptosGenerales } from "@/lib/quotes/ortodoncia";
import { aceptacionDelPresupuesto } from "@/lib/quotes/cargos.server";
import { aceptacionImplicita, netoDeConceptos } from "@/lib/quotes/aceptacion";
import { RECIBE_CITAS_WHERE } from "@/lib/agenda/roles-que-atienden";
import { cuerpoDoctorNoRecibeCitasDe } from "@/lib/agenda/roles-que-atienden-db";
import { doctorDelPlan, FRASE_ELEGIR_DOCTOR_DEL_PLAN } from "@/lib/quotes/doctor-del-plan";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

/**
 * POST /api/quotes/[id]/treatment-plan — crea un plan de tratamiento ACTIVE a
 * partir de un presupuesto ACEPTADO. totalCost = total; sesiones = nº de fases.
 * Idempotente: si ya se generó (y sigue existiendo), devuelve el mismo plan.
 *
 * Presupuesto de ORTODONCIA en una sede con el módulo (ws1-t5): NO crea un
 * plan general. Responde `{ casoOrtodoncia }` con a dónde ir para abrir (o
 * ver) el caso de ortodoncia del paciente. El caso lo abre el asistente de
 * alta de la ficha, con sus propios permisos; aquí no se escribe nada.
 *
 * Presupuesto MIXTO (tratamiento de ortodoncia + «Resina 16», «Extracción
 * 18»…): con `?general=1` crea el plan general SOLO con los conceptos que no
 * son de ortodoncia (su coste y sus fases). El tratamiento sigue yendo al caso.
 *
 * Costo (revisión final de ws1-t2): aceptado en parte, o solo «el resto» de un
 * mixto, el plan cuesta lo ACEPTADO con su parte del descuento global, no la
 * suma de precios de lista. Doctor: el que cumple «quién atiende» de la Agenda
 * (doctor-del-plan.ts); si nadie, 409 `{ elegirDoctor, doctores }` y la tarjeta
 * pide elegir y reenvía con `{ doctorId }`.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Crea un TreatmentPlan ACTIVE del paciente (coste total y nº de sesiones):
  // es exactamente lo que protege "treatments.edit" — "Crear y editar planes
  // de tratamiento". Se elige esa key y NO una billing.*: aquí no nace factura
  // ni se quema folio, y recepción (que tiene treatments.edit por default)
  // sigue pudiendo abrir el plan de un presupuesto aceptado, como hasta ahora.
  const deniedPerm = denyIfMissingPermission(ctx, "treatments.edit");
  if (deniedPerm) return deniedPerm;

  const quote = await prisma.quote.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    include: {
      items: {
        select: { id: true, phase: true, name: true, toothFdi: true, quantity: true, unitPrice: true, discount: true, lineTotal: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!quote) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });

  // Visibilidad por paciente (barrido Ola 3): el resto de /quotes/** asserta;
  // crear el plan de tratamiento del paciente restringido exige poder verlo.
  // 404 ANTES del chequeo de status para no filtrar el estado del presupuesto.
  if (quote.patientId) {
    const visDenied = await assertPatientVisible(quote.patientId, {
      userId: ctx.userId,
      role: ctx.role,
      clinicId: ctx.clinicId,
    });
    if (visDenied) return visDenied;
  }

  if (quote.status !== "ACCEPTED") {
    return NextResponse.json(
      { error: "Solo se crea un plan desde un presupuesto aceptado" },
      { status: 409 },
    );
  }

  if (quote.treatmentPlanId) {
    const existing = await prisma.treatmentPlan.findFirst({
      where: { id: quote.treatmentPlanId, clinicId: ctx.clinicId },
      select: { id: true, name: true },
    });
    if (existing) {
      return NextResponse.json({ treatmentPlanId: existing.id, name: existing.name, already: true });
    }
  }

  // Solo lo que el paciente ACEPTÓ (ws1-t6): de un presupuesto aceptado en
  // parte, el plan lleva esos conceptos y su costo, no el presupuesto entero.
  const acc = await aceptacionDelPresupuesto(ctx.clinicId, quote.id, quote.items);
  const aceptados = acc.aceptados;
  const parcial = aceptados.length < quote.items.length;

  // De ortodoncia y con el módulo: se ofrece el caso, no un plan general.
  const caso = (await casosDesdePresupuestos(ctx, [{ ...quote, items: aceptados }])).get(quote.id);
  const soloElResto = !!caso?.conPlanGeneral && req.nextUrl.searchParams.get("general") === "1";
  if (caso && !soloElResto) {
    // Sin el permiso del módulo tampoco se crea el plan general: se dice
    // quién abre el caso.
    if (!caso.href) return NextResponse.json({ error: caso.aviso, casoOrtodoncia: caso }, { status: 409 });
    return NextResponse.json({ casoOrtodoncia: caso });
  }

  // El doctor del plan: el elegido en la tarjeta, o quien hizo el presupuesto,
  // o el de cabecera del paciente — el primero que atiende en la Agenda.
  let elegido: string | null = null;
  try {
    const cuerpo = await req.json();
    if (cuerpo && typeof cuerpo.doctorId === "string" && cuerpo.doctorId) elegido = cuerpo.doctorId;
  } catch {
    // Sin cuerpo: «Crear plan» de siempre.
  }
  const paciente = elegido
    ? null
    : await prisma.patient.findFirst({ where: { id: quote.patientId, clinicId: ctx.clinicId }, select: { primaryDoctorId: true } });
  const candidatos = elegido ? [elegido] : [quote.createdById, paciente?.primaryDoctorId];
  const ids = candidatos.filter((x): x is string => !!x);
  const atienden = ids.length
    ? (await prisma.user.findMany({
        where: { id: { in: ids }, clinicId: ctx.clinicId, ...RECIBE_CITAS_WHERE },
        select: { id: true },
      })).map((u) => u.id)
    : [];
  const doctorId = doctorDelPlan(candidatos, atienden);
  if (!doctorId) {
    if (elegido) {
      const { reason } = await cuerpoDoctorNoRecibeCitasDe(ctx.clinicId, elegido);
      return NextResponse.json({ error: reason }, { status: 400 });
    }
    const lista = await prisma.user.findMany({
      where: { clinicId: ctx.clinicId, ...RECIBE_CITAS_WHERE },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
    return NextResponse.json(
      {
        error: FRASE_ELEGIR_DOCTOR_DEL_PLAN,
        elegirDoctor: true,
        doctores: lista.map((u) => ({ id: u.id, nombre: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() })),
      },
      { status: 409 },
    );
  }
  // Mixto: el plan general solo lleva lo que no es de ortodoncia.
  const items = soloElResto ? conceptosGenerales(aceptados) : aceptados;
  const totalSessions = distinctPhaseCount(items.map((i) => ({ phase: i.phase == null ? null : Number(i.phase) })));
  const sessionIntervalDays = 30;
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + totalSessions * sessionIntervalDays * 24 * 60 * 60 * 1000);
  const nextExpectedDate = new Date(startDate.getTime() + sessionIntervalDays * 24 * 60 * 60 * 1000);

  const plan = await prisma.treatmentPlan.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: quote.patientId,
      doctorId,
      name: quote.title.slice(0, 160),
      description: `Generado desde presupuesto ${quote.folio}`,
      totalSessions,
      sessionIntervalDays,
      // Lo aceptado con su parte del descuento global (no la suma de lineTotal).
      totalCost: soloElResto || parcial
        ? netoDeConceptos(acc.renglones ?? aceptacionImplicita(quote), items.map((i) => i.id))
        : Number(quote.total) || 0,
      status: "ACTIVE",
      startDate,
      endDate,
      nextExpectedDate,
    },
    select: { id: true, name: true },
  });

  await prisma.quote.update({ where: { id: quote.id }, data: { treatmentPlanId: plan.id } });

  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "treatment",
    entityId: plan.id,
    action: "create",
    changes: { fromQuote: { before: null, after: quote.folio } },
  });

  return NextResponse.json({ treatmentPlanId: plan.id, name: plan.name }, { status: 201 });
}
