/**
 * DaleControl INSTITUCIONAL — LA CAJA contra la base de datos.
 *
 * SERVIDOR: importa prisma. No lo importe un componente "use client". La
 * aritmética pura vive en dinero-core.ts y la resolución del precio en
 * tarifas.ts; aquí solo hay consultas y escrituras.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * LAS CUATRO REGLAS DE ESTE ARCHIVO
 *
 * 1. 🔴 EL PRECIO NO SE LEE DEL BODY. Toda línea con `procedureId` la
 *    cotiza el servidor (resolveEduChargeLines, en tarifas.ts). Lo que
 *    mande el navegador se descarta y queda registrado en la línea.
 *
 * 2. 🔴 institutionId SIEMPRE del contexto de sesión. Ninguna función de
 *    aquí lo acepta suelto: si algún día ves un `institutionId` en una
 *    firma nueva, es un bug de tenant esperando a que lo llamen con el id
 *    equivocado.
 *
 * 3. 🔴 EL ALCANCE ES EL DE SIEMPRE, el de src/lib/edu/visibility.ts. Para
 *    el dinero es todo o nada: caja y dirección lo ven, docentes y alumnos
 *    NO. Ninguna consulta de aquí arma su propio `where`.
 *
 * 4. 🔴 UN COBRO CANCELADO DEBE CERO. La columna `balanceCents` se pone en
 *    0 al cancelar Y toda suma filtra por estado. Es la lección que costó
 *    un bug en el dental: una factura cancelada con el balance intacto
 *    seguía ofreciendo "Cobrar ahora · $1,800" en cinco pantallas.
 *
 * Los permisos NO se comprueban aquí: eso lo hace el endpoint con
 * `eduApiGuard` antes de llamar. Aquí se comprueba la PERTENENCIA y el
 * ALCANCE, que es lo que un permiso no puede saber.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCleanId, eduOptionalText, eduSafeTimeZone, eduTodayISO } from "@/lib/edu/agenda-core";
import { eduPatientFullName } from "@/lib/edu/pacientes-core";
// Ola 1B: el MISMO troceador que usan el padrón y los pacientes. Si la caja
// partiera el término a su manera, el buscador del mostrador encontraría
// cosas distintas que el de la lista de pacientes.
import { eduSearchTokens } from "@/lib/edu/padron-core";
import { eduUserDisplayName } from "@/lib/edu-auth";
import {
  EDU_CAJA_MAX_ROWS,
  EDU_MAX_CASH_CENTS,
  EDU_MAX_CHARGE_CENTS,
  EDU_MAX_CHARGE_ITEMS,
  eduChargeStatusFor,
  eduChargeTotals,
  eduCorteAgrupar,
  eduCorteMethods,
  eduCorteSpanDays,
  eduLineTotalCents,
  eduMetodosDistintos,
  eduMoney,
  eduPagosFailed,
  eduPagosPideDevolucion,
  eduResolveChargeView,
  parseEduMoneyCentsMax,
  parseEduPagosDivididos,
  type EduCashSessionRow,
  type EduChargeFilters,
  type EduChargeRow,
  type EduChargesPage,
  type EduCorte,
  type EduPagoValidado,
} from "@/lib/edu/dinero-core";
import { eduCampusLabel } from "@/lib/edu/campus-core";
import { eduCorteDesglose, eduCorteDesgloseLeer } from "@/lib/edu/caja-cierre-core";
// La aritmética del folio, compartida con la factura: es la MISMA regla y
// vive en un módulo puro (client-safe, sin prisma) que ya tiene su prueba.
import { eduNextInvoiceFolio } from "@/lib/edu/facturacion-core";
import { eduAudit, type EduAuditActor } from "@/lib/edu/auditoria";
import { eduInstallmentStatus, eduPlanResumen } from "@/lib/edu/pagos-core";
import {
  resolveEduChargeLines,
  type EduLineaCliente,
  type EduLineaResuelta,
} from "@/lib/edu/tarifas";
import {
  eduCaseScopeWhere,
  eduChargeScopeWhere,
  eduPatientScopeWhere,
  eduPaymentScopeWhere,
  eduScopeIsEmpty,
  eduVisibility,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import {
  EDU_CASH_METHOD,
  EDU_PAYMENT_METHODS_COBRABLES,
  EDU_PAYMENT_METHOD_LABELS,
  type EduPaymentMethod,
} from "@/lib/edu/types";

export { EduPadronError as EduCajaError };

/**
 * ═══════════════════════════════════════════════════════════════════════
 * EL CONTEXTO DE LAS ESCRITURAS DE CAJA.
 *
 * Es el `EduClinicaContext` de siempre —el que decide tenant y alcance—
 * MÁS lo que la bitácora necesita para firmar el renglón: el nombre y el
 * rol de quien escribe, CONGELADOS. Se pide en la firma y no se saca de
 * una variable global por la misma razón que el alcance: un actor
 * implícito es el que la siguiente función olvida pasar.
 *
 * Las LECTURAS siguen tomando `EduClinicaContext` a secas: leer no
 * escribe renglón, y estrechar la puerta de una lectura sin necesidad
 * obliga a fabricar un usuario completo para llamarla desde una prueba.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduCajaContext extends EduClinicaContext, EduAuditActor {}

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

/**
 * La puerta del dinero. Devuelve el institutionId o LANZA 403.
 *
 * Se llama al principio de TODA función de este archivo, incluidas las
 * lecturas: un alumno con "caja.view" encendido por error tiene que
 * chocar con esto igual.
 */
function requireDinero(ctx: EduClinicaContext): string {
  const institutionId = requireInstitution(ctx);
  if (eduScopeIsEmpty(eduVisibility(ctx, "charges"))) {
    throw new EduPadronError("Tu rol no ve el dinero de la clínica.", 403);
  }
  return institutionId;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function persona(u: { firstName: string; lastName: string; email: string } | null | undefined): string {
  return u ? eduUserDisplayName(u) : "—";
}

/**
 * El nombre de quien está escribiendo, tal como se CONGELA en la bitácora
 * y en el rastro de las notas.
 *
 * No usa `eduUserDisplayName` porque el contexto de la sesión solo trae
 * nombre y apellido (`EduAuditActor`), no el correo: pedirle el correo
 * aquí obligaría a arrastrar el `EduUser` entero hasta cada escritura.
 */
function nombreDelActor(ctx: EduCajaContext): string {
  return `${ctx.user.firstName} ${ctx.user.lastName}`.trim().slice(0, 160) || "—";
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · LA FORMA DE UN COBRO
// ═══════════════════════════════════════════════════════════════════════

const CHARGE_SELECT = {
  id: true,
  folio: true,
  patientId: true,
  caseId: true,
  feeScheduleLabel: true,
  subtotalCents: true,
  discountCents: true,
  totalCents: true,
  paidCents: true,
  balanceCents: true,
  status: true,
  notes: true,
  chargedAt: true,
  cancelledAt: true,
  cancelReason: true,
  // H-58 · LA SEDE, con nombre. Estaba sellada en la fila y no llegaba al
  // navegador, así que la vista consolidada anunciaba "los cobros de todas
  // tus sedes" en una tabla que no decía de cuál era cada uno.
  campusId: true,
  campus: { select: { name: true, code: true } },
  patient: { select: { firstName: true, lastName: true, folio: true } },
  chargedBy: { select: { firstName: true, lastName: true, email: true } },
  cancelledBy: { select: { firstName: true, lastName: true, email: true } },
  // 🔴 Ola C · DE QUÉ PRESUPUESTO VIENE ESTE COBRO. La columna llena en el
  // presupuesto (`EduQuote.chargeId`) ES la llave de idempotencia de la
  // conversión, así que esta lista tiene 0 o 1 fila; el `take: 1` lo dice
  // en el código y no solo en el esquema. Sin esto, un cobro convertido
  // era indistinguible de uno tecleado a mano, y quien lo mira no podía
  // saber por qué el precio no es el del tarifario de hoy.
  quotes: { select: { id: true, folio: true }, orderBy: { createdAt: "asc" }, take: 1 },
  items: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      procedureId: true,
      description: true,
      quantity: true,
      unitPriceCents: true,
      discountCents: true,
      totalCents: true,
      clientPriceCents: true,
    },
  },
  payments: {
    orderBy: { paidAt: "asc" },
    select: {
      id: true,
      method: true,
      amountCents: true,
      isRefund: true,
      reference: true,
      notes: true,
      paidAt: true,
      // Meses sin intereses DEL BANCO (solo con crédito): el recibo lo
      // dice porque el paciente lo va a preguntar.
      msiMonths: true,
      receivedBy: { select: { firstName: true, lastName: true, email: true } },
      // Si el pago fue de una mensualidad, cuál y de cuántas: "Mensualidad
      // 2 de 3" en el recibo, sin tener que abrir el plan.
      installmentOf: { select: { number: true, plan: { select: { months: true } } } },
    },
  },
  // Pagos a meses: el plan ACTIVO, si hay (a lo sumo uno — lo garantiza la
  // transacción que crea planes). Con esto el recibo puede decir "este
  // cobro se paga a meses" y esconder el pago suelto que el servidor
  // rebotaría de todos modos.
  //
  // 🔴 Y con SU CALENDARIO: sin las mensualidades, la lista de Caja no
  // podía decir ni cuántas van ni cuándo vence la siguiente, y esa era
  // exactamente la queja del mostrador ("no se sabe cada cuándo paga").
  // No se guarda ningún resumen: se deriva aquí, en la lectura.
  paymentPlans: {
    where: { status: "ACTIVO" },
    // Con `take: 1` sin orden, dos planes activos (la carrera de
    // milisegundos que documenta createEduPaymentPlan) darían uno
    // arbitrario y la fila "bailaría" entre recargas. El más reciente es
    // el que alguien acaba de armar.
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      months: true,
      installmentCents: true,
      installments: {
        orderBy: { number: "asc" },
        // El `number` se LEE. Deducirlo del índice del array se apoya en
        // que no haya huecos, y el índice único (planId, number) impide
        // DUPLICADOS, no huecos: el día que hubiera uno, el botón diría
        // "Cobrar la 2 de 3" y mandaría el id de la 3.
        select: { id: true, number: true, amountCents: true, dueDate: true, paymentId: true },
      },
    },
  },
} satisfies Prisma.EduChargeSelect;

type ChargePayload = Prisma.EduChargeGetPayload<{ select: typeof CHARGE_SELECT }>;

/**
 * Lo que hace falta para pintar un cobro y que NO está en la fila: el
 * "hoy" del INSTITUTO (con el que se deriva VENCIDA) y el formateador de
 * INSTANTES en su zona. Los dos se arman UNA vez por lectura y no una por
 * pago: un Intl.DateTimeFormat por celda son trescientos objetos para
 * pintar una lista de cien cobros.
 */
interface ChargeCtx {
  todayISO: string;
  fechaHora: Intl.DateTimeFormat;
}

function chargeCtx(timeZoneCrudo: string | undefined, now: Date = new Date()): ChargeCtx {
  const zona = eduSafeTimeZone(timeZoneCrudo ?? EDU_TIMEZONE_FALLBACK);
  return {
    todayISO: eduTodayISO(zona, now),
    fechaHora: new Intl.DateTimeFormat("es-MX", {
      timeZone: zona,
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  };
}

/**
 * ⚠️ La zona por DEFECTO, para el llamador que todavía no la pasa. No es
 * un adorno: sin ella, `eduSafeTimeZone(undefined)` cae a UTC y a las
 * 23:30 de México una mensualidad que vence mañana ya se pintaría vencida.
 * Es la misma zona con la que nacen los institutos.
 */
const EDU_TIMEZONE_FALLBACK = "America/Mexico_City";

function toChargeRow(c: ChargePayload, ctx: ChargeCtx): EduChargeRow {
  const plan = c.paymentPlans[0] ?? null;
  return {
    id: c.id,
    folio: c.folio,
    patientId: c.patientId,
    patientName: eduPatientFullName(c.patient),
    patientFolio: c.patient.folio,
    caseId: c.caseId,
    feeScheduleLabel: c.feeScheduleLabel,
    subtotalCents: c.subtotalCents,
    discountCents: c.discountCents,
    totalCents: c.totalCents,
    paidCents: c.paidCents,
    balanceCents: c.balanceCents,
    status: c.status,
    notes: c.notes,
    campusId: c.campusId,
    campusLabel: c.campus ? eduCampusLabel(c.campus) : null,
    chargedByName: persona(c.chargedBy),
    chargedAt: c.chargedAt.toISOString(),
    // H-61 · el INSTANTE del cobro, escrito por el servidor en la zona del
    // instituto. El recibo no tenía fecha ni hora: se pintaba una lista de
    // conceptos sin decir cuándo pasó.
    chargedAtLabel: ctx.fechaHora.format(c.chargedAt),
    cancelledAt: iso(c.cancelledAt),
    cancelledByName: c.cancelledBy ? persona(c.cancelledBy) : null,
    cancelReason: c.cancelReason,
    quoteId: c.quotes[0]?.id ?? null,
    quoteFolio: c.quotes[0]?.folio ?? null,
    items: c.items.map((i) => ({
      id: i.id,
      procedureId: i.procedureId,
      description: i.description,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      discountCents: i.discountCents,
      totalCents: i.totalCents,
      clientPriceCents: i.clientPriceCents,
    })),
    payments: c.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amountCents: p.amountCents,
      isRefund: p.isRefund,
      reference: p.reference,
      notes: p.notes,
      paidAt: p.paidAt.toISOString(),
      // 🔴 El instante, escrito AQUÍ y en la zona del instituto. En el
      // cliente pintaría la del navegador y rompería la hidratación.
      paidAtLabel: ctx.fechaHora.format(p.paidAt),
      receivedByName: persona(p.receivedBy),
      msiMonths: p.msiMonths,
      installmentNumber: p.installmentOf?.number ?? null,
      installmentMonths: p.installmentOf?.plan.months ?? null,
    })),
    methods: eduMetodosDistintos(c.payments),
    activePlanId: plan?.id ?? null,
    // 🔴 El plan, DERIVADO en la lectura: el estado de cada mensualidad
    // sale del calendario contra el hoy del INSTITUTO (eduInstallmentStatus)
    // y los números salen de las mensualidades (eduPlanResumen). Los mismos
    // dos helpers que usa la pantalla de Pagos a meses: si se derivara
    // aquí a mano, un día las dos pantallas dirían cosas distintas del
    // mismo plan.
    plan: plan
      ? (() => {
          const filas = plan.installments.map((i) => {
            const dueDateISO = i.dueDate.toISOString().slice(0, 10);
            return {
              id: i.id,
              number: i.number,
              amountCents: i.amountCents,
              dueDateISO,
              status: eduInstallmentStatus(
                { pagada: i.paymentId !== null, dueDateISO },
                ctx.todayISO,
              ),
            };
          });
          const resumen = eduPlanResumen(filas);
          return {
            id: plan.id,
            months: plan.months,
            installmentCents: plan.installmentCents,
            paidCount: resumen.paidCount,
            nextDueISO: resumen.nextDueISO,
            overdueCount: resumen.overdueCount,
            pendingCents: resumen.pendingCents,
            installments: filas,
          };
        })()
      : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LECTURAS
// ═══════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 Ola C · H-09 · EL TURNO ABIERTO **DE ESTA SEDE**.
 *
 * Hasta esta ola el turno era del INSTITUTO: `findFirst({institutionId,
 * closedAt: null})`. Campus Norte abría a las 8:00, a las 8:05 la cajera
 * de Sur recibía «Ya hay un turno de caja abierto», cobraba igual, y cada
 * pago suyo se sellaba con el turno de Norte. Al cerrar, Norte contaba SU
 * cajón y el sistema le exigía el efectivo de las DOS sedes: el corte
 * decía «Faltaron $8,400» todos los días.
 *
 * Ahora hay UN turno abierto POR SEDE, y la resolución es esta —escrita
 * una sola vez porque la usan el cobro, el abono, la devolución, la
 * mensualidad y la pantalla:
 *
 *   1. Con sede: el turno abierto DE ESA SEDE.
 *   2. Si esa sede no tiene turno propio, el turno abierto **SIN SEDE**.
 *      🔴 Y esto NO es un parche: un turno sin sede es «el turno del
 *      instituto», que es lo que son TODOS los que ya existen en la base
 *      y lo que sigue siendo el turno de una escuela de una sola sede.
 *      Mientras uno de ésos siga abierto está recogiendo el dinero de
 *      todo el mundo, y mandar los cobros de Sur a un turno nuevo dejaría
 *      el suyo a medias. Aplicar esta ola no cambia el comportamiento de
 *      ningún turno vivo: ésa es la propiedad que se busca.
 *   3. Sin sede (nadie eligió mostrador, o el instituto no tiene sedes):
 *      el turno sin sede; y si no lo hay y solo queda UNO abierto, ése —
 *      con uno solo no hay ambigüedad que resolver. Con varios, `null`:
 *      inventar cuál es sería sellar el dinero en la caja equivocada.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduOpenCashSession {
  id: string;
  openedAt: Date;
  openingCents: number;
  campusId: string | null;
}

export async function getEduOpenCashSession(
  ctx: EduClinicaContext,
  /**
   * En qué sede está el mostrador. Lo resuelve el endpoint con
   * `eduCampusForCharge` a partir del selector de la barra superior, o lo
   * hereda del cobro que se está pagando. 🔴 NUNCA sale del body: un
   * campusId del navegador metería el dinero en el corte de la otra sede.
   */
  campusId?: string | null,
): Promise<EduOpenCashSession | null> {
  const institutionId = requireDinero(ctx);
  const abiertas = await prisma.eduCashSession.findMany({
    where: { institutionId, closedAt: null },
    orderBy: { openedAt: "desc" },
    select: { id: true, openedAt: true, openingCents: true, campusId: true },
  });
  if (abiertas.length === 0) return null;

  const sinSede = abiertas.find((s) => s.campusId === null) ?? null;
  const sede = typeof campusId === "string" && campusId ? campusId : null;
  if (sede) return abiertas.find((s) => s.campusId === sede) ?? sinSede;
  if (sinSede) return sinSede;
  return abiertas.length === 1 ? abiertas[0] : null;
}

/**
 * Los turnos abiertos EN OTRAS SEDES, para que la pantalla pueda decirlo.
 *
 * «No hay turno abierto» dejó de ser una sola cosa: puede no haberlo aquí
 * y llevar seis horas abierto en el campus de al lado. Sin esta lista,
 * quien abre caja en Sur se entera al cuadrar.
 */
async function otrosTurnosAbiertos(
  institutionId: string,
  exceptoId: string | null,
): Promise<{ id: string; campusLabel: string; openedByName: string; openedAt: string }[]> {
  const filas = await prisma.eduCashSession.findMany({
    where: { institutionId, closedAt: null, ...(exceptoId ? { id: { not: exceptoId } } : {}) },
    orderBy: { openedAt: "desc" },
    take: EDU_MAX_TURNOS_ABIERTOS,
    select: {
      id: true,
      openedAt: true,
      campus: { select: { name: true, code: true } },
      openedBy: { select: { firstName: true, lastName: true, email: true } },
    },
  });
  return filas.map((f) => ({
    id: f.id,
    campusLabel: f.campus ? eduCampusLabel(f.campus) : "Sin sede (turno del instituto)",
    openedByName: persona(f.openedBy),
    openedAt: f.openedAt.toISOString(),
  }));
}

/**
 * Tope de turnos abiertos que se listan. Uno por sede y el tope de sedes
 * es 40 (`EDU_MAX_CAMPUSES`), así que 40 es el techo real; se pide de
 * todos modos para que una base con basura no traiga mil filas a pintar
 * un aviso.
 */
const EDU_MAX_TURNOS_ABIERTOS = 40;

function chargesWhere(
  ctx: EduClinicaContext,
  filters: EduChargeFilters,
  sessionId: string | null,
): Prisma.EduChargeWhereInput {
  const institutionId = requireDinero(ctx);
  // 🔴 Ola 11 · LA SEDE. Aquí NO se deriva de nada: `EduCharge.campusId` se
  // SELLÓ al emitir el cobro (dónde estaba el mostrador). Un cobro sin sede
  // —los de antes de esta ola que el .sql no alcanzara a rellenar— no sale
  // bajo ningún filtro de sede y sí sale en la vista consolidada, que es lo
  // honesto: no se sabe dónde se cobró.
  const where = eduChargeScopeWhere({
    institutionId,
    scope: eduVisibility(ctx, "charges"),
    campusIds: ctx.campusIds,
  });

  const and: Prisma.EduChargeWhereInput[] = [];
  if (filters.status) and.push({ status: filters.status });
  if (filters.patientId) and.push({ patientId: filters.patientId });
  if (filters.soloTurno) {
    // Sin turno abierto, "solo el turno" no puede devolver nada: no hay
    // turno. Se cierra la consulta en vez de enseñar el histórico entero,
    // que es lo contrario de lo que se pidió.
    and.push({ cashSessionId: sessionId ?? "__sin_turno__" });
  }
  // 🔴 Ola 1B: el buscador de cobros mira el índice SIN ACENTOS del
  // paciente, no sus columnas crudas — buscar "Rodriguez" tenía que
  // encontrar el cobro de "Rodríguez" y devolvía cero. El folio DEL COBRO
  // se sigue comparando contra su columna con `mode: "insensitive"`: lo
  // genera el sistema, es ASCII por construcción y no tiene índice propio.
  //
  // Y se parte en palabras como los demás buscadores del vertical, en vez
  // de mandar la frase entera: "maria rodriguez" tiene que encontrar a
  // María Rodríguez aunque el nombre y el apellido estén en dos columnas.
  for (const token of eduSearchTokens(filters.q)) {
    and.push({
      OR: [
        { folio: { contains: token, mode: "insensitive" } },
        { patient: { searchIndex: { contains: token } } },
      ],
    });
  }

  if (and.length > 0) where.AND = and;
  return where;
}

/**
 * La zona del INSTITUTO (`ctx.institution.timezone`), que la pasa la
 * página o el endpoint. Se necesita para dos cosas de la lectura: el
 * "hoy" con el que se deriva si una mensualidad está VENCIDA, y la hora a
 * la que se pintan los instantes de cada pago.
 *
 * Es OPCIONAL para no romper a ningún llamador de golpe; sin ella se cae
 * a la zona con la que nacen los institutos, que es la correcta en el
 * 99 % de los casos y nunca UTC.
 */
export interface EduChargeReadOptions {
  timeZone?: string;
  /**
   * 🔴 Ola C · H-09 · LA SEDE DEL MOSTRADOR, para que «solo el turno
   * abierto» sea el turno DE ESTA SEDE. Sin esto, con Norte y Sur
   * abiertos a la vez, el filtro enseñaría los cobros del turno de la
   * otra — la misma confusión que el hallazgo describe en el arqueo, con
   * otro disfraz. La resuelve el llamador con `eduCampusForCharge`; no
   * sale del body.
   */
  campusId?: string | null;
}

export async function listEduCharges(
  ctx: EduClinicaContext,
  filters: EduChargeFilters,
  options: EduChargeReadOptions = {},
): Promise<EduChargesPage> {
  requireDinero(ctx);
  const sesion = filters.soloTurno
    ? await getEduOpenCashSession(ctx, options.campusId ?? null)
    : null;

  // 🔴 SIN TURNO ABIERTO, EL DEFAULT ENSEÑA EL HISTÓRICO. El fallo que
  // arregla —un cobro recién emitido que desaparecía de la lista— y por
  // qué se decide con una función pura están en eduResolveChargeView
  // (dinero-core.ts). Aquí solo se aplica lo que dijo.
  const applied = eduResolveChargeView(filters, Boolean(sesion));

  const rows = await prisma.eduCharge.findMany({
    where: chargesWhere(ctx, { ...filters, soloTurno: applied.soloTurno }, sesion?.id ?? null),
    orderBy: [{ chargedAt: "desc" }],
    take: EDU_CAJA_MAX_ROWS + 1,
    select: CHARGE_SELECT,
  });

  // 🔴 H-49 · Lo que entró EN EL TURNO sale de los PAGOS del turno, no de
  // la columna `paidCents` de los cobros emitidos en él. Solo se consulta
  // cuando de verdad se está listando un turno: en el histórico la
  // pregunta no tiene respuesta.
  const turnoNetCents =
    applied.soloTurno && sesion
      ? await sumaNetaDelTurno(ctx, sesion.id)
      : null;

  const cctx = chargeCtx(options.timeZone);
  const visibles = rows.slice(0, EDU_CAJA_MAX_ROWS).map((r) => toChargeRow(r, cctx));

  // 🔴 Los cancelados NO suman. Ni al total, ni al pagado, ni al saldo:
  // un cobro anulado no es dinero de la escuela ni deuda del paciente.
  const totals = visibles.reduce(
    (acc, r) => {
      if (r.status === "CANCELLED") return acc;
      acc.totalCents += r.totalCents;
      acc.paidCents += r.paidCents;
      acc.balanceCents += r.balanceCents;
      return acc;
    },
    { totalCents: 0, paidCents: 0, balanceCents: 0 },
  );

  return {
    rows: visibles,
    truncated: rows.length > EDU_CAJA_MAX_ROWS,
    totals,
    turnoNetCents,
    applied,
  };
}

/**
 * H-49 · El neto que entró en un turno: pagos menos devoluciones, todos
 * los métodos. Es exactamente el `netCents` del corte, calculado con la
 * misma fuente (los pagos sellados con ese turno) para que las dos
 * pantallas no puedan discrepar en un peso.
 */
async function sumaNetaDelTurno(ctx: EduClinicaContext, sessionId: string): Promise<number> {
  const institutionId = requireDinero(ctx);
  const pagos = await prisma.eduPayment.findMany({
    where: {
      ...eduPaymentScopeWhere({ institutionId, scope: eduVisibility(ctx, "charges") }),
      cashSessionId: sessionId,
      // 🔴 LA SEDE, igual que las filas de esta misma pantalla. `EduPayment`
      // no guarda sede y `eduPaymentScopeWhere` no la sabe aplicar, así que
      // se recorta por la del COBRO —la única sellada—. Sin esto, la cajera
      // de Norte con su sede puesta veía una tabla de Norte y encima un
      // "Entró en el turno" con el dinero de Sur dentro.
      ...(Array.isArray(ctx.campusIds) ? { charge: { campusId: { in: ctx.campusIds } } } : {}),
    },
    select: { amountCents: true, isRefund: true },
  });
  return pagos.reduce((a, p) => a + (p.isRefund ? -p.amountCents : p.amountCents), 0);
}

/**
 * Un cobro, SI le toca a quien pregunta.
 *
 * El id de la URL no basta: la fila se busca con el `where` del alcance,
 * así que un cobro de otra escuela se ve exactamente igual que uno que no
 * existe.
 *
 * 🔴 OLA C·fin · H-63 — Y ESO INCLUYE LA SEDE. `listEduCharges` recortaba
 * por sede desde la Ola 11 y esta lectura por ID no: la cajera de Norte no
 * veía el cobro de Sur en su tabla, pero con el id en la mano lo abría
 * entero. Recortar la lista y no la puerta es tapar, no cerrar — y
 * facturación ya lo hacía bien (H-69), así que la incoherencia era del
 * propio módulo consigo mismo.
 */
export async function getEduCharge(
  ctx: EduClinicaContext,
  chargeId: string,
  options: EduChargeReadOptions = {},
): Promise<EduChargeRow | null> {
  const institutionId = requireDinero(ctx);
  const id = eduCleanId(chargeId);
  if (!id) return null;

  const c = await prisma.eduCharge.findFirst({
    where: {
      ...eduChargeScopeWhere({
        institutionId,
        scope: eduVisibility(ctx, "charges"),
        campusIds: ctx.campusIds,
      }),
      id,
    },
    select: CHARGE_SELECT,
  });
  return c ? toChargeRow(c, chargeCtx(options.timeZone)) : null;
}

/** Los cobros de UN paciente (la ficha, y el histórico de caja). */
export async function listEduPatientCharges(
  ctx: EduClinicaContext,
  patientId: string,
  options: EduChargeReadOptions = {},
): Promise<EduChargeRow[]> {
  const institutionId = requireDinero(ctx);
  const id = eduCleanId(patientId);
  if (!id) return [];

  const rows = await prisma.eduCharge.findMany({
    where: {
      ...eduChargeScopeWhere({ institutionId, scope: eduVisibility(ctx, "charges") }),
      patientId: id,
    },
    orderBy: [{ chargedAt: "desc" }],
    take: EDU_CAJA_MAX_ROWS,
    select: CHARGE_SELECT,
  });
  const cctx = chargeCtx(options.timeZone);
  return rows.map((r) => toChargeRow(r, cctx));
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · COBRAR
// ═══════════════════════════════════════════════════════════════════════

/**
 * El siguiente folio: C-0001, C-0002…
 *
 * Con CUATRO dígitos y ceros a la izquierda: el orden de Postgres es
 * alfabético y sin el relleno "C-9" saldría después de "C-10", que es
 * justo lo que rompería este cálculo. Mismo patrón que el folio del
 * paciente de la Ola 2.
 *
 * 🔴 OLA C·fin · LAS DOS PREGUNTAS, porque ninguna sola basta.
 *
 * El relleno hace que el orden alfabético coincida con el numérico… HASTA
 * C-9999. A partir de ahí los folios tienen cinco dígitos y, como texto,
 * "C-10000" va ANTES que "C-9999": el "último" se quedaba en C-9999 para
 * siempre, se proponía C-10000, chocaba con el índice único, y el bucle de
 * tres intentos de `createEduCharge` proponía TRES VECES el mismo folio.
 * La caja dejaba de cobrar para toda la escuela, con un mensaje que
 * invitaba a reintentar algo que no se iba a arreglar. Una clínica escolar
 * llega a 10 000 cobros mucho antes que a 10 000 CFDI.
 *
 * El CONTEO no tiene ese techo. Se reusa `eduNextInvoiceFolio` —la función
 * pura que H-68 escribió al lado para la factura, con su prueba— en vez de
 * copiar aquí la aritmética: dos copias de la misma regla son dos sitios
 * donde discrepar. Manda el mayor de los dos, así que el alfabético sigue
 * mandando si alguna vez hubiera huecos.
 */
async function nextEduChargeFolio(institutionId: string): Promise<string> {
  const where = { institutionId, folio: { startsWith: "C-" } };
  const [last, emitidos] = await Promise.all([
    prisma.eduCharge.findFirst({ where, orderBy: { folio: "desc" }, select: { folio: true } }),
    prisma.eduCharge.count({ where }),
  ]);
  return eduNextInvoiceFolio("C", last?.folio ?? null, emitidos);
}

export interface EduPaymentInput {
  method?: unknown;
  amountCents?: unknown;
  reference?: unknown;
  notes?: unknown;
  isRefund?: unknown;
  /** Meses sin intereses DEL BANCO. Solo con tarjeta de crédito. */
  msiMonths?: unknown;
}

/*
 * 🔴 H-06 · LA CLAVE DE IDEMPOTENCIA DEL ABONO PARCIAL.
 *
 * El cobro inicial la tenía desde P2-10 y la mensualidad estaba protegida
 * por el reclamo atómico de `paymentId: null`. El ABONO SUELTO no: el POST
 * llegaba, se escribía, la respuesta se perdía en el wifi del mostrador y
 * la pantalla decía "vuelve a intentarlo" — que es literalmente una
 * instrucción de cobrar dos veces. Los dos abonos de $500 caben en un saldo
 * de $2,000, así que el `updateMany` condicional del tope no los para.
 *
 * ⚠️ CÓMO SE CIERRA SIN UNA COLUMNA NUEVA: la clave se usa como la LLAVE
 * PRIMARIA de la primera fila de EduPayment. `id` ya es un índice único, no
 * hay migración que aplicar, y el segundo POST con la misma clave choca con
 * un P2002 que revienta la transacción ENTERA — con varias formas de pago
 * basta con blindar la primera, porque o entran todas o no entra ninguna.
 * Es el mismo remedio que `EduInstallment.paymentId` le da por accidente a
 * la mensualidad, aquí a propósito.
 *
 * ⚠️ Y POR QUÉ SE VUELVE A LEER CON EL TENANT: `id` es único en TODA la
 * tabla, no por instituto. Si la clave chocara con un pago de otra escuela
 * (o de otro cobro), devolver "duplicado" enseñaría una fila ajena. Se
 * relee con `institutionId` + `chargeId` y, si no es de aquí, se contesta
 * 409 pidiendo otra clave en vez de un dato que no es suyo.
 */

export interface EduChargeInput {
  patientId?: unknown;
  caseId?: unknown;
  items?: unknown;
  notes?: unknown;
  /**
   * 🔴 H-10 · LA LISTA DE PRECIOS QUE ELIGIÓ CAJA, si eligió alguna.
   *
   * Solo se admite una lista ACTIVA con regla MANUAL (un convenio, una
   * campaña, el personal del instituto): eso es exactamente lo que la
   * regla MANUAL significa desde que se escribió, y hasta esta ola no se
   * aplicaba nunca. Las listas de regla automática siguen decidiéndose en
   * el servidor con el dato que el navegador no controla.
   *
   * ⚠️ Esto NO es un precio. El precio de cada línea lo sigue poniendo el
   * servidor leyendo la lista; lo que viaja es CUÁL de las tarifas de la
   * escuela se aplica, y queda congelada en el cobro con su nombre.
   */
  feeScheduleId?: unknown;
  /**
   * Pago inmediato, que es lo normal en un mostrador. Opcional.
   *
   * Las dos formas valen: `payment` (una sola, como siempre) y `payments`
   * (de 1 a 3 formas — efectivo + tarjeta, dos tarjetas…). Las valida la
   * misma función, `parseEduPagosDivididos`, y cada forma acaba en su
   * PROPIA fila de EduPayment: el corte y el CFDI las ven todas.
   */
  payment?: EduPaymentInput;
  payments?: unknown;
  /** P2-10. La clave de idempotencia del cliente: dos POST con la misma
   *  clave son UN cobro. Opcional — un POST sin clave cobra igual. */
  idempotencyKey?: unknown;
}

/**
 * P2-10 · La clave de idempotencia, validada.
 *
 * `undefined`/null/"" = no mandaron (legítimo: los clientes viejos no la
 * traen). Mandarla MAL sí rebota: una clave de tres letras chocaría con la
 * de otro cobro del instituto por puro azar, y el "duplicado" devolvería el
 * cobro de OTRO paciente — silenciarlo sería peor que el doble cobro que
 * esto viene a cerrar. 16 como mínimo porque la pantalla manda un UUID (36)
 * y cualquier cliente serio genera algo de ese tamaño.
 */
function parseIdempotencyKey(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") {
    throw new EduPadronError("La clave de idempotencia no es válida.", 400);
  }
  const v = raw.trim();
  if (v.length < 16 || v.length > 80 || !/^[A-Za-z0-9_-]+$/.test(v)) {
    throw new EduPadronError(
      "La clave de idempotencia no es válida (de 16 a 80 caracteres: letras, números, guion y guion bajo).",
      400,
    );
  }
  return v;
}

/**
 * ¿Puede quien cobra colgar el cobro de ESE caso?
 *
 * CAJA no ve casos (es la línea del contrato de la Ola 2), así que si caja
 * manda un `caseId` se IGNORA en silencio — igual que la Ola 2 ignora el
 * origen para quien no tiene `pacientes.origen`. No es un error del que
 * cobra: la pantalla de caja ni siquiera se lo ofrece.
 */
async function resolverCaso(
  ctx: EduClinicaContext,
  institutionId: string,
  patientId: string,
  raw: unknown,
  now: Date,
): Promise<string | null> {
  if (raw === null || raw === undefined || raw === "") return null;
  const scope = eduVisibility(ctx, "cases");
  if (eduScopeIsEmpty(scope)) return null;

  const id = eduCleanId(raw);
  if (!id) throw new EduPadronError("Ese caso no es válido.", 400);

  const caso = await prisma.eduCase.findFirst({
    where: { ...eduCaseScopeWhere({ institutionId, scope, now }), id },
    select: { id: true, patientId: true },
  });
  if (!caso) throw new EduPadronError("Ese caso no es de este instituto.", 404);
  if (caso.patientId !== patientId) {
    throw new EduPadronError("Ese caso es de otro paciente.");
  }
  return caso.id;
}

/**
 * 🔴 EMITE EL COBRO. El precio lo pone el servidor.
 *
 * Lo que el navegador manda y se USA: qué paciente, qué procedimientos, en
 * qué cantidad, con qué descuento y con qué pago. Lo que manda y se
 * IGNORA: el precio unitario de cualquier línea que traiga `procedureId`.
 *
 * Todo lo que se escribe va en UNA transacción: cobro, líneas y pago. Si
 * se escribieran por separado, un fallo a la mitad dejaría un cobro sin
 * conceptos o un pago sin cobro, que es dinero perdido en la base.
 */
export async function createEduCharge(
  ctx: EduCajaContext,
  input: EduChargeInput,
  options: {
    canRefund?: boolean;
    /**
     * 🔴 Ola 11 · EN QUÉ SEDE SE ESTÁ COBRANDO. Lo resuelve el endpoint con
     * eduCampusForCharge (campus-core.ts) a partir del selector de la barra
     * superior, y NUNCA sale del body: un campusId del navegador podría
     * apuntar el cobro a la sede que quisiera y descuadrar el reporte de
     * las dos.
     *
     * `null` = el instituto todavía no tiene sedes. El cobro sale igual: el
     * dinero no se detiene por una columna de infraestructura.
     */
    campusId?: string | null;
    /**
     * ═════════════════════════════════════════════════════════════════
     * 🔴 Ola C · LAS LÍNEAS **YA CONGELADAS** DE UN PRESUPUESTO ACEPTADO.
     *
     * SOLO EL SERVIDOR, y solo desde `convertirEduQuote` (presupuestos.ts).
     * ⛔ NUNCA sale del body: ninguna ruta la lee de la petición, y por eso
     * no es un agujero en el antifraude del precio.
     *
     * Existe porque re-cotizar aquí sería TRAICIONAR lo que el paciente
     * aceptó: si en marzo firmó una resina a $800 y hoy el tarifario dice
     * $1,200, `resolveEduChargeLines` cobraría $1,200 —ése es su trabajo—
     * y el cobro no cuadraría con el papel que hay firmado. El precio de
     * un presupuesto aceptado ya lo puso el servidor una vez, cuando se
     * armó, y ahí se quedó congelado con su hash de aceptación.
     *
     * La alternativa era mandar las partidas como "líneas libres" (sin
     * `procedureId`), y se descartó: el cobro perdería el enlace con el
     * catálogo y ningún reporte por procedimiento volvería a ver ese
     * dinero.
     * ═════════════════════════════════════════════════════════════════
     */
    lineasCongeladas?: EduLineaResuelta[];
    /** El presupuesto del que viene, para el renglón de bitácora. */
    quoteId?: string | null;
    /**
     * Qué se escribe en `feeScheduleLabel`. Solo lo usa la conversión de
     * un presupuesto ("Presupuesto P-0007"): el recibo tiene que poder
     * decir de dónde salió ese precio, y no salió de una lista.
     */
    feeScheduleLabel?: string | null;
  } = {},
  now: Date = new Date(),
): Promise<{ id: string; folio: string; descartados: number; duplicado: boolean }> {
  const institutionId = requireDinero(ctx);

  // ── 🔴 P2-10 · LA IDEMPOTENCIA, ANTES DE COTIZAR NADA ────────────────
  // Dos peticiones idénticas emitían dos cobros con dos folios, los dos con
  // su pago: el bucle de reintentos de abajo resuelve la colisión de FOLIO,
  // no la duplicación. La pantalla tapaba el doble clic (botón `busy`), pero
  // un reintento de red, un Enter en dos pestañas o cualquier cliente que
  // no sea esa pantalla cobraban dos veces. La subida de estudios ya era
  // idempotente y lo explicaba (estudios.ts); la caja no había heredado la
  // lección.
  //
  // Si la clave ya está guardada, se devuelve el cobro EXISTENTE con
  // `duplicado: true` y no se toca nada — ni el folio, ni el pago, ni una
  // línea. `descartados: 0` porque en ESTA petición no se cotizó nada.
  const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);
  if (idempotencyKey) {
    const previo = await prisma.eduCharge.findFirst({
      where: { institutionId, idempotencyKey },
      select: { id: true, folio: true },
    });
    if (previo) return { ...previo, descartados: 0, duplicado: true };
  }

  // El paciente tiene que estar dentro del alcance de quien cobra. Caja los
  // ve todos, así que en la práctica esto solo cierra el tenant — pero lo
  // cierra con el helper único y no con un `where` a mano.
  const patientId = eduCleanId(input.patientId);
  if (!patientId) throw new EduPadronError("Elige a un paciente.");
  const paciente = await prisma.eduPatient.findFirst({
    where: {
      ...eduPatientScopeWhere({ institutionId, scope: eduVisibility(ctx, "patients"), now }),
      id: patientId,
    },
    select: { id: true },
  });
  if (!paciente) throw new EduPadronError("Ese paciente no es de este instituto.", 404);

  const lineasCliente = Array.isArray(input.items) ? (input.items as EduLineaCliente[]) : [];
  // Un cobro que nace de un presupuesto aceptado trae sus partidas por
  // `options.lineasCongeladas` y no por el body: el "ni un concepto" se
  // pregunta contra las que de verdad van a escribirse.
  const cuantasLineas = options.lineasCongeladas?.length ?? lineasCliente.length;
  if (cuantasLineas === 0) throw new EduPadronError("El cobro no tiene ni un concepto.");
  if (cuantasLineas > EDU_MAX_CHARGE_ITEMS) {
    throw new EduPadronError(
      `Un cobro admite hasta ${EDU_MAX_CHARGE_ITEMS} conceptos. Divídelo en dos.`,
    );
  }

  // ── 🔴 AQUÍ SE COTIZA EN EL SERVIDOR ────────────────────────────────
  // …salvo cuando las líneas vienen CONGELADAS de un presupuesto aceptado
  // (ver `options.lineasCongeladas`, arriba): ahí el precio ya lo puso el
  // servidor cuando se armó el presupuesto, y volver a cotizarlo cobraría
  // algo distinto de lo que el paciente firmó.
  const congeladas = options.lineasCongeladas;
  const { applied, lines, descartados } = congeladas
    ? { applied: null, lines: congeladas, descartados: 0 }
    : await resolveEduChargeLines(
        institutionId,
        patientId,
        lineasCliente,
        undefined,
        // H-10 · la lista elegida a mano. La valida tarifas.ts (activa,
        // MANUAL y de este instituto) y lanza si no cumple.
        { feeScheduleId: input.feeScheduleId },
      );

  const totals = eduChargeTotals(lines);
  if (totals.totalCents > EDU_MAX_CHARGE_CENTS) {
    throw new EduPadronError(
      `El cobro suma más de ${eduMoney(EDU_MAX_CHARGE_CENTS)}. Revisa las cantidades.`,
    );
  }

  const caseId = await resolverCaso(ctx, institutionId, patientId, input.caseId, now);
  // 🔴 H-09 · EL TURNO ES EL DE **ESTA SEDE**. Antes se pedía "el turno
  // abierto del instituto" y por eso el cobro de Sur se sellaba con el
  // turno de Norte y descuadraba su arqueo. La sede es la misma que se
  // sella en la fila del cobro, tres líneas más abajo: si estas dos
  // llegaran a discrepar, el corte diría de una sede dinero de la otra.
  const sesion = await getEduOpenCashSession(ctx, options.campusId ?? null);

  // El pago inmediato, si viene. Una o hasta tres formas; se validan
  // TODAS o ninguna, y `exacto: false` porque un cobro puede quedar
  // abonado en parte (eso es "queda a deber").
  //
  // ⚠️ "No viene pago" son TRES formas y las tres tienen que seguir
  // emitiendo el cobro con saldo (es el "queda a deber" de siempre): sin
  // la clave, con `payment: null` —lo que mandaban los clientes viejos— y
  // con una lista vacía. Solo se valida cuando hay algo que validar.
  const traePago =
    (Array.isArray(input.payments) && input.payments.length > 0) ||
    (input.payment !== undefined && input.payment !== null);
  let pagos: EduPagoValidado[] = [];
  if (traePago) {
    try {
      pagos = leerPagos(input, totals.totalCents, {
        exacto: false,
        canRefund: options.canRefund,
      });
    } catch (err) {
      // ── H-64 · EL MENSAJE CUANDO EL TARIFARIO CAMBIÓ EN MEDIO ────────
      // Si el precio se movió entre abrir el modal y pulsar "Cobrar", lo
      // que la cajera tecleó ya no cabe en el total nuevo y el error
      // hablaba de un "saldo" de un cobro que todavía no existe. La causa
      // real está a la vista: `descartados` cuenta las líneas cuyo precio
      // vino distinto del servidor.
      // ⚠️ Y SOLO ese error. Reescribir cualquier fallo de captura —un
      // cheque sin referencia, un "Otro" sin motivo, el 403 de caja.refund—
      // como "el precio cambió" es cambiar un mensaje que ayuda por uno que
      // miente. Se vuelve a leer con un tope imposible: si con ese tope el
      // cuerpo es válido, lo ÚNICO que falló fue que ya no cabía.
      const conTopeAmplio = parseEduPagosDivididos(input, EDU_MAX_CHARGE_CENTS, {
        exacto: false,
        canRefund: options.canRefund,
      });
      const soloElTope =
        !eduPagosFailed(conTopeAmplio) && conTopeAmplio.sumaCents > totals.totalCents;
      if (soloElTope && descartados > 0 && err instanceof EduPadronError) {
        throw new EduPadronError(
          `El precio de ${descartados} ${descartados === 1 ? "concepto cambió" : "conceptos cambiaron"} mientras armabas este cobro: el total es ahora ${eduMoney(totals.totalCents)}, no el que decía la pantalla. Cierra el diálogo, vuelve a armarlo y cobra con el precio nuevo.`,
          409,
        );
      }
      throw err;
    }
  }
  if (pagos.some((p) => p.isRefund)) {
    throw new EduPadronError("Un cobro no nace con una devolución.");
  }

  const paidCents = pagos.reduce((a, p) => a + p.amountCents, 0);
  const status = eduChargeStatusFor({
    cancelled: false,
    totalCents: totals.totalCents,
    paidCents,
    hasRefund: false,
  });

  const data = {
    institutionId,
    patientId,
    caseId,
    feeScheduleId: applied?.feeScheduleId ?? null,
    // 🔴 El NOMBRE congelado. Si mañana la dirección renombra la lista o la
    // desactiva, el recibo sigue diciendo qué tarifa se aplicó. Un cobro
    // que viene de un presupuesto no aplicó una LISTA sino un papel
    // firmado, y eso es lo que dice aquí (lo pone `convertirEduQuote`).
    feeScheduleLabel: options.feeScheduleLabel ?? applied?.feeScheduleName ?? null,
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    totalCents: totals.totalCents,
    paidCents,
    balanceCents: Math.max(0, totals.totalCents - paidCents),
    status,
    notes: eduOptionalText(input.notes, 500) ?? null,
    chargedByUserId: ctx.eduUserId,
    chargedAt: now,
    cashSessionId: sesion?.id ?? null,
    // 🔴 Ola 11 · LA SEDE, SELLADA. No se deduce del paciente ni del caso
    // ni del sillón: es dónde estaba el mostrador cuando entró el dinero, y
    // por eso no se puede desincronizar de nada.
    campusId: options.campusId ?? null,
    // P2-10. Con esto puesto, el índice único (institutionId,
    // idempotencyKey) convierte la carrera de dos POST simultáneos en un
    // P2002 que abajo se traduce en "devuélvele el que ganó".
    idempotencyKey,
  };

  // Tres intentos por el folio automático: si dos cajas cobran en el mismo
  // segundo, el índice único (institutionId, folio) rebota a la segunda y
  // se recalcula. Sin el reintento, el cobro fallaría con un error que no
  // explica nada delante del paciente.
  for (let intento = 0; intento < 3; intento++) {
    const folio = await nextEduChargeFolio(institutionId);
    try {
      const creado = await prisma.$transaction(async (tx) => {
        const cobro = await tx.eduCharge.create({
          data: { ...data, folio },
          select: { id: true, folio: true },
        });

        await tx.eduChargeItem.createMany({
          data: lines.map((l) => ({
            institutionId,
            chargeId: cobro.id,
            procedureId: l.procedureId,
            description: l.description,
            quantity: l.quantity,
            // 🔴 CONGELADO. Este número no vuelve a tocarse nunca.
            unitPriceCents: l.unitPriceCents,
            discountCents: l.discountCents,
            totalCents: eduLineTotalCents(l),
            clientPriceCents: l.clientPriceCents,
          })),
        });

        // 🔴 UNA FILA POR FORMA DE PAGO, en la MISMA transacción que el
        // cobro. Aquí no hace falta el candado de `eduApplyEduPaymentInTx`
        // (el updateMany condicional): el cobro se está CREANDO en esta
        // misma transacción con su `paidCents` y su `balanceCents` ya
        // calculados, así que no hay una fila previa con la que competir.
        if (pagos.length > 0) {
          await tx.eduPayment.createMany({
            data: pagos.map((p) => ({
              institutionId,
              chargeId: cobro.id,
              method: p.method,
              amountCents: p.amountCents,
              isRefund: false,
              reference: p.reference,
              notes: p.notes,
              msiMonths: p.msiMonths,
              paidAt: now,
              receivedByUserId: ctx.eduUserId,
              cashSessionId: sesion?.id ?? null,
            })),
          });
        }

        return cobro;
      });

      // 🔴 BITÁCORA (NOM-024). El acto por el que entra dinero. Va DESPUÉS
      // de la transacción y no dentro: `eduAudit` nunca lanza, pero meterla
      // en la transacción del cobro le daría la oportunidad de alargarla —
      // y un renglón de auditoría no puede hacer esperar a un pago.
      await eduAudit(ctx, {
        action: "create",
        entity: "charge",
        entityId: creado.id,
        patientId,
        after: {
          folio: creado.folio,
          totalCents: totals.totalCents,
          paidCents,
          campusId: options.campusId ?? null,
          cashSessionId: sesion?.id ?? null,
          quoteId: options.quoteId ?? undefined,
        },
      });

      return { ...creado, descartados, duplicado: false };
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") throw err;

      // P2-10 · ¿Qué índice único rebotó? Prisma lo dice en meta.target
      // (las columnas, o el nombre `map` del índice, según versión). Si fue
      // la CLAVE, otro POST idéntico ganó la carrera hace un instante: se
      // devuelve SU cobro en vez de reintentar — reintentar con otra clave
      // sería exactamente el doble cobro que esto cierra. Si fue el FOLIO,
      // se recalcula y se reintenta, como siempre.
      //
      // ⚠️ La clave se mira ANTES de rendirse por intentos: la colisión de
      // clave puede caer en el TERCER intento (dos choques de folio y
      // después el duplicado), y ahí también hay que contestar el cobro
      // ganador, no un 500.
      const target = String(
        ((err as { meta?: { target?: unknown } })?.meta?.target as unknown) ?? "",
      );
      if (idempotencyKey && /idempotencyKey|idem_key/i.test(target)) {
        const ganador = await prisma.eduCharge.findFirst({
          where: { institutionId, idempotencyKey },
          select: { id: true, folio: true },
        });
        if (ganador) return { ...ganador, descartados: 0, duplicado: true };
        throw err;
      }
      if (intento === 2) throw err;
    }
  }
  throw new EduPadronError("No se pudo asignar un folio de cobro. Intenta de nuevo.", 409);
}

/**
 * 🔴 Las formas de pago de una operación, leídas y validadas por la ÚNICA
 * función que sabe hacerlo (`parseEduPagosDivididos`, en dinero-core, la
 * misma que corre en la pantalla). Aquí solo se traduce su error escrito a
 * un EduPadronError con su status.
 *
 * `parsePago` (una forma, un método) ya no existe: era el sitio donde el
 * mostrador se quedaba sin poder cobrar mitad efectivo y mitad tarjeta.
 */
/**
 * EL CUERPO DE UN PAGO, en la forma que entiende el parser.
 *
 * `addEduPayment` acepta tres: `{payments:[…]}`, `{payment:{…}}` y —el de
 * siempre— el pago EN LA RAÍZ. Las dos primeras pasan tal cual; la tercera
 * se envuelve. Se hace en UNA función porque tanto el tope como la
 * validación tienen que mirar exactamente el mismo cuerpo.
 */
function cuerpoPago(input: EduPaymentInput & { payment?: EduPaymentInput; payments?: unknown }) {
  if (input.payments !== undefined || input.payment !== undefined) return input;
  return { payment: input };
}

function leerPagos(
  raw: unknown,
  objetivoCents: number,
  opts: { exacto: boolean; canRefund?: boolean },
): EduPagoValidado[] {
  const r = parseEduPagosDivididos(raw, objetivoCents, opts);
  if (eduPagosFailed(r)) {
    // 403 solo para el permiso; lo demás es un 400 de captura.
    const status = /caja\.refund/.test(r.error) ? 403 : 400;
    throw new EduPadronError(r.error, status);
  }
  return r.pagos;
}

/**
 * APLICA un pago (o una devolución) dentro de una transacción YA abierta:
 * reclama el tope, crea la fila y recalcula el cobro desde los pagos
 * reales. Es el ÚNICO camino por el que un pago toca `paidCents`.
 *
 * Existe con esta forma porque tiene DOS llamadores que no pueden
 * discrepar en un centavo: `addEduPayment` (el pago suelto del mostrador)
 * y `payEduInstallment` (src/lib/edu/pagos.ts — la mensualidad de un plan,
 * que además engancha la fila y quizá liquida el plan EN LA MISMA
 * transacción). Dos copias de este bloque son dos formas de recalcular un
 * saldo, y esa es exactamente la clase de par que un día no cuadra.
 *
 * Lo que NO hace: permisos, alcance ni validación del monto. Eso es del
 * llamador, ANTES de abrir la transacción.
 */
export interface EduPagoAplicar {
  institutionId: string;
  chargeId: string;
  method: EduPaymentMethod;
  /** Centavos POSITIVOS, ya validados contra su tope por el llamador. */
  amountCents: number;
  isRefund: boolean;
  reference: string | null;
  notes: string | null;
  /** Meses sin intereses DEL BANCO. Solo con CARD_CREDIT; informativo. */
  msiMonths?: number | null;
  /**
   * La mensualidad que esta fila ayuda a cubrir, si el pago es de un plan
   * a meses. Lo pone `payEduInstallment` en TODAS las formas de la
   * operación; la que además la LIQUIDA queda enganchada aparte, en
   * `EduInstallment.paymentId`.
   */
  installmentId?: string | null;
  paidAt: Date;
  receivedByUserId: string;
  /** El turno ABIERTO AL PAGAR (o null): lo consulta el llamador. */
  cashSessionId: string | null;
  /**
   * H-06 · El id DETERMINISTA de esta fila: la clave de idempotencia que
   * mandó el cliente. `undefined` = que Prisma genere su cuid de siempre.
   * Con él puesto, un segundo POST idéntico choca contra la llave primaria
   * y la transacción entera se deshace.
   */
  id?: string;
}

export async function eduApplyEduPaymentInTx(
  tx: Prisma.TransactionClient,
  pago: EduPagoAplicar,
): Promise<{ paymentId: string; status: string; balanceCents: number; paidCents: number }> {
  const { institutionId, chargeId: id } = pago;

  // ── 🔴 P2-10 (la ventana del tope) · EL TOPE SE RECLAMA AQUÍ DENTRO ──
  // El tope que validó el llamador se leyó FUERA de la transacción: dos
  // pagos simultáneos podían pasarlo los dos y dejar `paidCents` por encima
  // del total. Este updateMany condicional lo cierra de verdad: solo pasa
  // si a la fila TODAVÍA le cabe el monto, y el decremento toma el candado
  // de la fila — el segundo pago simultáneo se queda esperando y, cuando
  // el primero confirma, su condición se reevalúa contra el valor ya
  // escrito y rebota si ya no cabe.
  //
  // El decremento es PROVISIONAL a propósito: veinte líneas más abajo el
  // recálculo desde los pagos reales reescribe las dos columnas con la
  // verdad. Lo que este update compra no es el número — es el candado y
  // la condición.
  const cabe = await tx.eduCharge.updateMany({
    where: pago.isRefund
      ? { id, institutionId, status: { not: "CANCELLED" }, paidCents: { gte: pago.amountCents } }
      : { id, institutionId, status: { not: "CANCELLED" }, balanceCents: { gte: pago.amountCents } },
    data: pago.isRefund
      ? { paidCents: { decrement: pago.amountCents } }
      : { balanceCents: { decrement: pago.amountCents } },
  });
  if (cabe.count === 0) {
    throw new EduPadronError(
      pago.isRefund
        ? "Ese cobro cambió mientras devolvías (otro movimiento entró antes). Recarga y revisa lo pagado."
        : "Ese cobro cambió mientras cobrabas (otro pago entró antes). Recarga y revisa el saldo.",
      409,
    );
  }

  const creado = await tx.eduPayment.create({
    data: {
      // H-06: con clave de idempotencia, el id ES la clave (y el índice
      // único de la llave primaria es el candado). Sin ella, el cuid.
      ...(pago.id ? { id: pago.id } : {}),
      institutionId,
      chargeId: id,
      method: pago.method,
      amountCents: pago.amountCents,
      isRefund: pago.isRefund,
      reference: pago.reference,
      notes: pago.notes,
      msiMonths: pago.msiMonths ?? null,
      installmentId: pago.installmentId ?? null,
      paidAt: pago.paidAt,
      receivedByUserId: pago.receivedByUserId,
      cashSessionId: pago.cashSessionId,
    },
    select: { id: true },
  });

  const pagos = await tx.eduPayment.findMany({
    where: { institutionId, chargeId: id },
    select: { amountCents: true, isRefund: true },
  });

  let paidCents = 0;
  let hasRefund = false;
  for (const p of pagos) {
    if (p.isRefund) {
      paidCents -= p.amountCents;
      hasRefund = true;
    } else {
      paidCents += p.amountCents;
    }
  }
  paidCents = Math.max(0, paidCents);

  const actual = await tx.eduCharge.findUniqueOrThrow({
    where: { id },
    select: { totalCents: true },
  });
  const status = eduChargeStatusFor({
    cancelled: false,
    totalCents: actual.totalCents,
    paidCents,
    hasRefund,
  });
  const balanceCents = Math.max(0, actual.totalCents - paidCents);

  await tx.eduCharge.update({
    where: { id },
    data: { paidCents, balanceCents, status },
  });

  return { paymentId: creado.id, status, balanceCents, paidCents };
}

/**
 * Registra un pago o una devolución y recalcula el cobro.
 *
 * 🔴 El recálculo va DENTRO de la transacción y a partir de los pagos
 * REALES, no sumándole el monto nuevo a la columna. Sumar sobre la columna
 * es cómo dos pagos simultáneos acaban contando uno solo: los dos leen
 * 0, los dos escriben 500, y el paciente pagó 1000. Todo eso vive en
 * `eduApplyEduPaymentInTx`, que comparte con el pago de una mensualidad.
 *
 * 🔴 El turno que se estampa es el del PAGO, no el del cobro. Un cobro de
 * ayer que se liquida hoy entra en el corte de HOY, porque el dinero está
 * en la caja de hoy.
 *
 * 🔴 UN COBRO CON PLAN DE PAGOS ACTIVO NO ACEPTA PAGOS SUELTOS. Sus
 * mensualidades son el único camino (pagos.ts): un abono libre encima del
 * plan dejaría el cobro en PAID con mensualidades "pendientes" que ya no
 * se le deben a nadie — dos verdades sobre el mismo dinero. Ni
 * devoluciones: primero se cancela el plan (caja.refund, el mismo permiso)
 * y el cobro vuelve a moverse normal.
 */
export async function addEduPayment(
  ctx: EduCajaContext,
  chargeId: string,
  input: EduPaymentInput & {
    payment?: EduPaymentInput;
    payments?: unknown;
    /** H-06 · la clave de idempotencia del cliente. Opcional. */
    idempotencyKey?: unknown;
  },
  options: {
    canRefund?: boolean;
    /**
     * 🔴 OLA C·fin · EN QUÉ MOSTRADOR SE ESTÁ RECIBIENDO EL DINERO.
     *
     * La resuelve el endpoint con `eduCampusForCharge` sobre el selector
     * de la barra, igual que `createEduCharge`, y JAMÁS sale del body.
     * `null`/ausente = el llamador no sabe dónde está (vista consolidada,
     * instituto sin sedes): entonces se cae a la sede del cobro, que es lo
     * que se hacía siempre.
     */
    campusId?: string | null;
  } = {},
  now: Date = new Date(),
): Promise<{
  id: string;
  ids: string[];
  status: string;
  balanceCents: number;
  /** H-06 · true = esta clave ya se había usado y NO se cobró otra vez. */
  duplicado: boolean;
}> {
  const institutionId = requireDinero(ctx);
  const id = eduCleanId(chargeId);
  if (!id) throw new EduPadronError("Ese cobro no es válido.", 400);

  const cobro = await prisma.eduCharge.findFirst({
    where: {
      // 🔴 OLA C·fin · H-63 — LA SEDE TAMBIÉN AQUÍ. Sin esto, la cajera de
      // Norte no veía el cobro de Sur en su tabla pero, con el id en la
      // mano, podía abonarle, devolverle y dejarlo liquidado.
      ...eduChargeScopeWhere({
        institutionId,
        scope: eduVisibility(ctx, "charges"),
        campusIds: ctx.campusIds,
      }),
      id,
    },
    select: {
      id: true,
      patientId: true,
      totalCents: true,
      paidCents: true,
      balanceCents: true,
      status: true,
      // 🔴 H-09 · LA SEDE DEL COBRO. Es la que decide en qué turno cae el
      // abono o la devolución: el dinero de un cobro y el de sus pagos
      // tienen que caer en el MISMO corte, o el arqueo de una sede
      // enseñaría el abono de la otra. Se hereda del cobro y no del
      // selector porque un abono se aplica a un cobro concreto, que ya
      // tiene sellado dónde nació.
      campusId: true,
    },
  });
  if (!cobro) throw new EduPadronError("Ese cobro no es de este instituto.", 404);
  if (cobro.status === "CANCELLED") {
    throw new EduPadronError("Ese cobro está cancelado: no admite pagos ni devoluciones.", 409);
  }

  // ── 🔴 H-06 · LA IDEMPOTENCIA, ANTES DE TOCAR NADA ──────────────────
  // Misma lección P2-10 que `createEduCharge`: si la clave ya está usada,
  // se devuelve el estado ACTUAL del cobro sin escribir un peso. La
  // relectura lleva el tenant Y el cobro: `id` es único en toda la tabla y
  // una colisión con otra escuela no puede devolver su fila.
  // ⚠️ La relectura lleva SIEMPRE el tenant y el cobro. `id` es único en
  // toda la tabla, no por instituto: preguntar por el id pelado convertiría
  // este endpoint en un oráculo de existencia entre escuelas. Si la clave
  // chocara con la de otra, aquí no se encuentra nada, el insert de abajo
  // revienta con P2002 y ahí se contesta "usa otra clave" sin decir de
  // quién era la que ya estaba.
  const idemKey = parseIdempotencyKey(input.idempotencyKey);
  if (idemKey) {
    const previo = await eduPagoDeLaClave(institutionId, id, idemKey);
    if (previo) {
      return {
        id: previo.id,
        ids: [previo.id],
        status: cobro.status,
        balanceCents: cobro.balanceCents,
        duplicado: true,
      };
    }
  }

  // ¿Es una devolución? El TOPE hay que elegirlo ANTES de validar y no es
  // el mismo: devolver se topa con lo pagado, cobrar con el saldo. Se
  // pregunta con el helper que usa la MISMA precedencia que el parser
  // (`payments` > `payment` > la raíz) — escribirlo a mano aquí es
  // exactamente donde estaba el bug del `??`, que no cae al lado derecho
  // cuando el izquierdo es `false`.
  const esDevolucion = eduPagosPideDevolucion(cuerpoPago(input));
  const tope = esDevolucion
    ? cobro.paidCents
    : Math.max(0, cobro.totalCents - cobro.paidCents);
  if (tope <= 0) {
    throw new EduPadronError(
      esDevolucion ? "Ese cobro no tiene nada pagado que devolver." : "Ese cobro ya está liquidado.",
      409,
    );
  }
  const pagos = leerPagos(cuerpoPago(input), tope, {
    exacto: false,
    canRefund: options.canRefund,
  });
  // El invariante que hace que el tope de arriba sea el correcto. Por
  // construcción no puede fallar (el helper y el parser leen el cuerpo
  // igual); está escrito para que, si algún día uno de los dos cambia, se
  // rompa aquí con un mensaje y no con un tope equivocado en silencio.
  if (pagos.some((p) => p.isRefund) !== esDevolucion) {
    throw new EduPadronError(
      "Ese movimiento mezcla un cobro y una devolución. Mándalos por separado.",
      400,
    );
  }

  // ── 🔴 H-55 · UNA DEVOLUCIÓN PIDE MOTIVO ────────────────────────────
  // Cancelar un cobro ofrece dónde escribir por qué; devolver dinero —el
  // movimiento más delicado del mostrador, el único que SACA dinero del
  // cajón— salía con un "Referencia (opcional)" pensado para la
  // autorización de la terminal y nada más. El servidor ya aceptaba
  // `notes` y nadie las mandaba: ahora se exigen, como el motivo de un
  // "Otro". Va aquí fuera porque es captura, no carrera.
  if (esDevolucion && (!pagos[0].notes || pagos[0].notes.trim().length < 3)) {
    throw new EduPadronError(
      "Escribe por qué se devuelve el dinero (al menos 3 letras). Es el único movimiento del mostrador que saca dinero del cajón: sin explicación, el arqueo no se puede leer.",
      400,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 OLA C·fin · EL PAGO CAE EN EL CAJÓN DONDE ENTRA EL BILLETE.
  //
  // Esto resolvía el turno con `cobro.campusId` —la sede donde NACIÓ el
  // cobro— y lo justificaba con «el dinero de un cobro y el de sus pagos
  // tienen que caer en el MISMO corte». El argumento no se sostiene: el
  // paciente paga $5,000 EN EFECTIVO en Sur un cobro emitido en Norte, y
  // el cajón de Sur cierra con $5,000 de sobra mientras el esperado de
  // Norte pide $5,000 que nadie tiene. El corte compara billetes contados
  // contra billetes esperados, y los billetes están donde se entregaron.
  //
  // Y es lo que este módulo ya prometía por escrito dos veces —«el turno
  // que se estampa es el del PAGO, no el del cobro»—: hasta hoy eso solo
  // era verdad para el CUÁNDO (un cobro de ayer liquidado hoy entra en el
  // corte de hoy) y no para el DÓNDE. Ahora lo es para los dos.
  //
  // Se cae a la sede del cobro cuando el llamador no sabe en qué mostrador
  // está: con la vista consolidada puesta, o con un instituto sin sedes,
  // el comportamiento es exactamente el de antes.
  // ═══════════════════════════════════════════════════════════════════
  const mostrador =
    typeof options.campusId === "string" && options.campusId ? options.campusId : cobro.campusId;
  const sesion = await getEduOpenCashSession(ctx, mostrador);

  // 🔴 H-06 · Y LA CARRERA DE VERDAD, la de dos POST simultáneos. El
  // pre-chequeo de arriba solo atrapa el reintento SECUENCIAL; dos
  // peticiones a la vez pasan las dos y la segunda choca contra la llave
  // primaria. Sin este catch, ese choque sale como un 500 "Intenta de
  // nuevo" — que es exactamente la frase que este hallazgo viene a matar.
  // Es la misma forma que ya tiene `createEduCharge` con su índice único.
  try {
    return await aplicarPagos();
  } catch (err) {
    if (idemKey && (err as { code?: string })?.code === "P2002") {
      const ganador = await eduPagoDeLaClave(institutionId, id, idemKey);
      if (ganador) {
        const actual = await prisma.eduCharge.findFirst({
          where: { id, institutionId },
          select: { status: true, balanceCents: true },
        });
        return {
          id: ganador.id,
          ids: [ganador.id],
          status: actual?.status ?? cobro.status,
          balanceCents: actual?.balanceCents ?? cobro.balanceCents,
          duplicado: true,
        };
      }
      // La clave existe pero no es de este cobro ni de este instituto: se
      // pide otra sin decir nada de la fila ajena.
      throw new EduPadronError(
        "Esa clave de idempotencia ya está usada en otro movimiento. Recarga la pantalla y vuelve a intentarlo.",
        409,
      );
    }
    throw err;
  }

  async function aplicarPagos() {
  const resultado = await prisma.$transaction(async (tx) => {
    // 🔴 El candado del plan, DENTRO de la transacción: un plan creado un
    // instante antes también cuenta. Se pregunta aquí y no en el helper
    // porque el pago de una MENSUALIDAD paga precisamente un cobro con
    // plan activo — para él esto no es un error, es el caso normal.
    const plan = await tx.eduPaymentPlan.findFirst({
      where: { institutionId, chargeId: id, status: "ACTIVO" },
      select: { id: true },
    });
    if (plan) {
      throw new EduPadronError(
        esDevolucion
          ? "Ese cobro tiene un plan de pagos activo. Cancela primero el plan (pide el mismo permiso) y después devuelve el dinero."
          : "Ese cobro se paga a meses: cóbralo por sus mensualidades, en Caja → Pagos a meses. Si el plan ya no va, cancélalo y el saldo vuelve a cobrarse normal.",
        409,
      );
    }

    // ── 🔴 H-47 · UNA DEVOLUCIÓN SALE POR DONDE ENTRÓ EL DINERO ───────
    // El tope general solo mira el TOTAL pagado, así que se devolvía en
    // efectivo lo que había entrado con tarjeta: el cajón cerraba
    // descuadrado y el corte de la terminal también, sin que nada lo
    // dijera. Ahora el monto se topa contra el NETO DE ESE MÉTODO.
    //
    // 🔴 Y VA DENTRO DE LA TRANSACCIÓN, con el candado de la fila tomado
    // ANTES de leer los pagos. Comprobarlo fuera es un check-then-act de
    // manual: dos devoluciones simultáneas de $1,000 por débito sobre un
    // cobro pagado mitad y mitad pasaban las dos y dejaban el débito en
    // −$1,000. El `increment: 0` no mueve un centavo — lo que compra es el
    // candado, igual que el decremento provisional de
    // `eduApplyEduPaymentInTx`.
    //
    // La salida de emergencia es "Otro", que exige motivo escrito (una
    // beca, un vale, una compensación): el movimiento que no sigue el
    // camino del dinero queda EXPLICADO en el corte en vez de mudo.
    if (esDevolucion) {
      const dev = pagos[0];
      await tx.eduCharge.updateMany({
        where: { id, institutionId },
        data: { balanceCents: { increment: 0 } },
      });
      const reales = await tx.eduPayment.findMany({
        where: { institutionId, chargeId: id },
        select: { method: true, amountCents: true, isRefund: true },
      });
      const neto = eduNetoPorMetodo(reales);
      const disponible = neto.get(dev.method) ?? 0;
      if (dev.method !== "OTHER" && disponible <= 0) {
        // Solo se nombran los métodos por los que SÍ se puede devolver: el
        // legado "CARD" tiene dinero dentro y el parser ya no lo acepta,
        // así que mandar ahí a alguien sería un callejón sin salida.
        const conDinero = Array.from(neto.entries())
          .filter(([m, v]) => v > 0 && (EDU_PAYMENT_METHODS_COBRABLES as string[]).includes(m))
          .map(([m, v]) => `${EDU_PAYMENT_METHOD_LABELS[m]} ${eduMoney(v)}`);
        throw new EduPadronError(
          conDinero.length > 0
            ? `Por ${EDU_PAYMENT_METHOD_LABELS[dev.method]} no entró nada en este cobro: se pagó con ${conDinero.join(" y ")}. Devuelve por ahí, o usa "Otro" y escribe por qué sale por otro camino.`
            : `Por ${EDU_PAYMENT_METHOD_LABELS[dev.method]} no entró nada en este cobro, y lo que entró llegó con un método que ya no se puede elegir. Usa "Otro" y escribe en el motivo por dónde sale el dinero.`,
          409,
        );
      }
      if (dev.method !== "OTHER" && dev.amountCents > disponible) {
        throw new EduPadronError(
          `Por ${EDU_PAYMENT_METHOD_LABELS[dev.method]} solo entraron ${eduMoney(disponible)} en este cobro: no se pueden devolver ${eduMoney(dev.amountCents)} por ahí.`,
          409,
        );
      }
    }

    // 🔴 UNA FILA POR FORMA, EN ORDEN Y EN LA MISMA TRANSACCIÓN. Cada
    // llamada reclama SU parte del tope con el updateMany condicional del
    // helper: si la suma pasó la validación de arriba pero otro pago entró
    // en medio, la forma que ya no cabe revienta la transacción ENTERA y
    // no queda medio pago escrito.
    const ids: string[] = [];
    let status = "";
    let balanceCents = 0;
    for (const p of pagos) {
      const aplicado = await eduApplyEduPaymentInTx(tx, {
        // H-06 · solo la PRIMERA fila lleva el id determinista: la
        // transacción es atómica, así que blindar una blinda a todas.
        ...(idemKey && ids.length === 0 ? { id: idemKey } : {}),
        institutionId,
        chargeId: id,
        method: p.method,
        amountCents: p.amountCents,
        isRefund: p.isRefund,
        reference: p.reference,
        notes: p.notes,
        msiMonths: p.msiMonths,
        paidAt: now,
        receivedByUserId: ctx.eduUserId,
        cashSessionId: sesion?.id ?? null,
      });
      ids.push(aplicado.paymentId);
      status = aplicado.status;
      balanceCents = aplicado.balanceCents;
    }

    // `id` = el primero, para no romper a ningún cliente que ya lo lee.
    return { id: ids[0], ids, status, balanceCents, duplicado: false };
  });

  // 🔴 BITÁCORA (NOM-024). Un abono y —sobre todo— una devolución son los
  // dos movimientos por los que sale y entra dinero del cajón: son
  // exactamente lo que una auditoría viene a preguntar. `eduAudit` nunca
  // lanza, así que esto no puede tumbar un pago ya escrito.
  await eduAudit(ctx, {
    action: "update",
    entity: "payment",
    entityId: resultado.id,
    patientId: cobro.patientId,
    before: { balanceCents: cobro.balanceCents, status: cobro.status },
    after: {
      chargeId: id,
      esDevolucion,
      formas: pagos.length,
      montoCents: pagos.reduce((a, x) => a + x.amountCents, 0),
      balanceCents: resultado.balanceCents,
      status: resultado.status,
      motivo: esDevolucion ? pagos[0].notes : undefined,
    },
  });

  return resultado;
  }
}

/**
 * H-06 · El pago que ya lleva esa clave, SI es de este instituto y de este
 * cobro. Nunca pregunta por el `id` pelado: eso diría si la clave existe en
 * otra escuela.
 */
async function eduPagoDeLaClave(
  institutionId: string,
  chargeId: string,
  key: string,
): Promise<{ id: string } | null> {
  return prisma.eduPayment.findFirst({
    where: { id: key, institutionId, chargeId },
    select: { id: true },
  });
}

/**
 * H-47 · Lo que queda NETO por cada método en un cobro: lo cobrado menos
 * lo ya devuelto. Es contra esto —y no contra el total pagado— contra lo
 * que se topa una devolución.
 */
function eduNetoPorMetodo(
  pagos: { method: EduPaymentMethod; amountCents: number; isRefund: boolean }[],
): Map<EduPaymentMethod, number> {
  const neto = new Map<EduPaymentMethod, number>();
  for (const p of pagos) {
    const previo = neto.get(p.method) ?? 0;
    neto.set(p.method, previo + (p.isRefund ? -p.amountCents : p.amountCents));
  }
  return neto;
}

/**
 * Cancela un cobro.
 *
 * 🔴 Exige que NO haya dinero pagado. Cancelar algo cobrado sin devolverlo
 * deja un pago sin cobro al que pertenecer y descuadra el corte del turno
 * en el que entró. Primero se devuelve (con `caja.refund`), después se
 * cancela.
 *
 * 🔴 Y deja `balanceCents` en CERO. Ésta es la línea que el producto
 * dental no tenía: allá una factura cancelada conservaba el balance y
 * cinco pantallas seguían ofreciendo cobrarla.
 */
export async function cancelEduCharge(
  ctx: EduCajaContext,
  chargeId: string,
  input: { reason?: unknown } = {},
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireDinero(ctx);
  const id = eduCleanId(chargeId);
  if (!id) throw new EduPadronError("Ese cobro no es válido.", 400);

  const cobro = await prisma.eduCharge.findFirst({
    where: {
      // 🔴 OLA C·fin · H-63 — ANULAR UN COBRO DE OTRA SEDE TAMPOCO. Es la
      // tercera puerta del mismo hallazgo: leer, abonar y cancelar por id.
      ...eduChargeScopeWhere({
        institutionId,
        scope: eduVisibility(ctx, "charges"),
        campusIds: ctx.campusIds,
      }),
      id,
    },
    select: { id: true, patientId: true, paidCents: true, status: true },
  });
  if (!cobro) throw new EduPadronError("Ese cobro no es de este instituto.", 404);
  if (cobro.status === "CANCELLED") throw new EduPadronError("Ese cobro ya está cancelado.", 409);
  if (cobro.paidCents > 0) {
    throw new EduPadronError(
      `Ese cobro tiene ${eduMoney(cobro.paidCents)} pagados. Devuelve el dinero antes de cancelarlo.`,
      409,
    );
  }

  // Pagos a meses: un cobro con plan ACTIVO no se cancela por encima del
  // plan — quedaría un calendario vivo cobrando mensualidades de un cobro
  // que ya no existe. Primero se cancela el plan (mismo permiso,
  // caja.refund), después el cobro.
  const plan = await prisma.eduPaymentPlan.findFirst({
    where: { institutionId, chargeId: id, status: "ACTIVO" },
    select: { id: true },
  });
  if (plan) {
    throw new EduPadronError(
      "Ese cobro tiene un plan de pagos activo. Cancela primero el plan y después el cobro.",
      409,
    );
  }

  // ── 🔴 H-11 · Y SU CFDI. El espejo ya existía en el otro sentido
  // (facturacion.ts: "no se factura un cobro anulado") y faltaba éste: se
  // cancelaba un cobro de $9,000 sin un peso pagado y su factura seguía
  // TIMBRADA y viva ante el SAT, colgando de algo que ya no cuenta en
  // ninguna suma. La cancelación fiscal es un trámite aparte y va PRIMERO.
  //
  // "Viva" es exactamente `activeChargeId != null` (la definición del
  // índice único de EduInvoice): una factura CANCELADA o FALLIDA lo tiene
  // en NULL y no estorba.
  const facturaViva = await prisma.eduInvoice.findFirst({
    where: { institutionId, activeChargeId: id },
    select: { folio: true, status: true },
  });
  if (facturaViva) {
    throw new EduPadronError(
      facturaViva.status === "STAMPING"
        ? `Ese cobro tiene la factura ${facturaViva.folio} a medias («Timbrando»): no se sabe si el timbre salió. Resuélvela en Facturación antes de cancelar el cobro.`
        : `Ese cobro tiene la factura ${facturaViva.folio} timbrada y viva ante el SAT. Cancela primero el CFDI en Facturación y después el cobro.`,
      409,
    );
  }

  // P2-10 (la misma familia): condicionado a que SIGA sin dinero y sin
  // cancelar. Sin la condición, un pago que entrara entre la lectura de
  // arriba y este update dejaría un cobro CANCELADO con dinero dentro — el
  // pago quedaría sin cobro al que pertenecer y el corte no cuadraría.
  // Y `paymentPlans: none ACTIVO` por lo mismo: la lectura del plan de
  // arriba también fue fuera de la transacción.
  const res = await prisma.eduCharge.updateMany({
    where: {
      id,
      institutionId,
      status: { not: "CANCELLED" },
      paidCents: 0,
      paymentPlans: { none: { status: "ACTIVO" } },
      // H-11: y ninguna factura VIVA. La lectura de arriba también fue
      // fuera de la transacción, así que la condición se repite aquí.
      invoices: { none: { activeChargeId: { not: null } } },
    },
    data: {
      status: "CANCELLED",
      // 🔴 CERO. Un cobro anulado no se le debe a nadie.
      balanceCents: 0,
      cancelledAt: now,
      cancelledByUserId: ctx.eduUserId,
      cancelReason: eduOptionalText(input.reason, 300) ?? null,
    },
  });
  if (res.count === 0) {
    throw new EduPadronError(
      "Ese cobro cambió mientras lo cancelabas (entró un pago, un plan de pagos, una factura, o alguien lo canceló antes). Recarga la pantalla.",
      409,
    );
  }

  // 🔴 BITÁCORA (NOM-024). Anular un cobro es el acto que borra dinero de
  // todas las sumas del instituto: si algo tiene que dejar renglón, es
  // esto.
  await eduAudit(ctx, {
    action: "update",
    entity: "charge",
    entityId: id,
    patientId: cobro.patientId,
    before: { status: cobro.status },
    after: {
      status: "CANCELLED",
      motivo: eduOptionalText(input.reason, 300) ?? null,
    },
  });

  return { id };
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · EL TURNO DE CAJA
//
// 🔴 UN CORTE ES DE TURNO, NO DE DÍA. La ventana va de `openedAt` a
// `closedAt` (o a ahora). Si nadie corta en tres días, la ventana son tres
// días — y la pantalla lo DICE en vez de titular "hoy" unos datos que no
// son de hoy. Es la lección que costó un bug en el dental.
// ═══════════════════════════════════════════════════════════════════════

const SESSION_SELECT = {
  id: true,
  openedAt: true,
  closedAt: true,
  openingCents: true,
  countedCents: true,
  expectedCents: true,
  differenceCents: true,
  notes: true,
  // 🔴 Ola C · H-09 · la SEDE del turno, sellada al abrirlo. `null` = «el
  // turno del instituto» (todos los anteriores a esta ola lo son).
  campusId: true,
  campus: { select: { name: true, code: true } },
  // 🔴 H-53 · el desglose CONGELADO al cerrar. Es lo que hace que un corte
  // se pueda reimprimir dentro de un año exactamente como salió.
  methodBreakdown: true,
  openedBy: { select: { firstName: true, lastName: true, email: true } },
  closedBy: { select: { firstName: true, lastName: true, email: true } },
} satisfies Prisma.EduCashSessionSelect;

type SessionPayload = Prisma.EduCashSessionGetPayload<{ select: typeof SESSION_SELECT }>;

function toSessionRow(s: SessionPayload): EduCashSessionRow {
  return {
    id: s.id,
    openedAt: s.openedAt.toISOString(),
    closedAt: iso(s.closedAt),
    openingCents: s.openingCents,
    countedCents: s.countedCents,
    expectedCents: s.expectedCents,
    differenceCents: s.differenceCents,
    notes: s.notes,
    openedByName: persona(s.openedBy),
    closedByName: s.closedBy ? persona(s.closedBy) : null,
    campusId: s.campusId,
    campusLabel: s.campus ? eduCampusLabel(s.campus) : null,
    // `eduCorteDesgloseLeer` devuelve null para un turno abierto y para uno
    // cerrado ANTES de esta ola. Los dos casos son legítimos y la pantalla
    // los distingue por `closedAt`, no por este null.
    desglose: eduCorteDesgloseLeer(s.methodBreakdown),
  };
}

/**
 * Lo que hay en la caja AHORA, calculado a partir de los pagos del turno.
 *
 * Se calcula y no se lee de una columna: una columna acumulada se
 * desincroniza en cuanto una escritura falla a la mitad, y entonces el
 * corte miente sin que nadie pueda notarlo. Sumar los pagos del turno
 * siempre da la verdad.
 */
async function calcularTurno(
  institutionId: string,
  scope: ReturnType<typeof eduVisibility>,
  sessionId: string,
  openingCents: number,
) {
  const [pagos, cobros] = await Promise.all([
    prisma.eduPayment.findMany({
      where: {
        ...eduPaymentScopeWhere({ institutionId, scope }),
        cashSessionId: sessionId,
      },
      select: {
        method: true,
        amountCents: true,
        isRefund: true,
        // 🔴 H-09 · LA SEDE del pago se DERIVA de su cobro, porque el pago
        // no la guarda y el turno tampoco. Es lo único que se puede decir
        // sin la columna `EduCashSession.campusId`, y se dice con esas
        // palabras en la pantalla.
        charge: { select: { campusId: true, campus: { select: { name: true, code: true } } } },
        // 🔴 H-60 · Quién recibió el dinero. Ya se guardaba desde la Ola 5
        // y no llegaba a ninguna pantalla: con dos cajeras en el mismo
        // turno, el corte no podía decir de quién era el faltante.
        receivedByUserId: true,
        receivedBy: { select: { firstName: true, lastName: true, email: true } },
      },
    }),
    prisma.eduCharge.findMany({
      where: {
        ...eduChargeScopeWhere({ institutionId, scope }),
        cashSessionId: sessionId,
        // 🔴 Los cancelados no cuentan en ninguna suma de dinero.
        status: { not: "CANCELLED" },
      },
      select: { totalCents: true, balanceCents: true },
    }),
  ]);

  const methods = eduCorteMethods(pagos);
  const efectivo = methods.find((m) => m.method === EDU_CASH_METHOD);
  const expectedCashCents = openingCents + (efectivo?.netCents ?? 0);
  const netCents = methods.reduce((a, m) => a + m.netCents, 0);
  const refundedCents = methods.reduce((a, m) => a + m.refundedCents, 0);

  // H-09 / H-60 · los dos desgloses, con la MISMA función de suma.
  const porSede = eduCorteAgrupar(
    pagos.map((p) => ({
      key: p.charge?.campusId ?? "",
      label: p.charge?.campus ? eduCampusLabel(p.charge.campus) : "Sin sede sellada",
      method: p.method,
      amountCents: p.amountCents,
      isRefund: p.isRefund,
    })),
  );
  const porCajero = eduCorteAgrupar(
    pagos.map((p) => ({
      key: p.receivedByUserId,
      label: persona(p.receivedBy),
      method: p.method,
      amountCents: p.amountCents,
      isRefund: p.isRefund,
    })),
  );

  return {
    methods,
    // Con UNA sola sede (o ninguna) el desglose no dice nada que la tabla
    // de arriba no diga ya: se devuelve vacío para que la pantalla no
    // pinte una sección de un solo renglón.
    porSede: porSede.length > 1 ? porSede : [],
    porCajero: porCajero.length > 1 ? porCajero : [],
    expectedCashCents,
    netCents,
    refundedCents,
    chargeCount: cobros.length,
    chargedCents: cobros.reduce((a, c) => a + c.totalCents, 0),
    pendingCents: cobros.reduce((a, c) => a + c.balanceCents, 0),
    // 🔴 H-53 · la FOTO que se congela al cerrar. Se arma aquí, con los
    // mismos pagos con los que se calculó el esperado, para que el
    // desglose guardado y la diferencia guardada no puedan discrepar: dos
    // consultas distintas para dos cifras del mismo papel es exactamente
    // cómo se llega a un corte que no cuadra consigo mismo.
    desglose: eduCorteDesglose(pagos),
  };
}

/**
 * Cuántos turnos cerrados se listan.
 *
 * 🔴 H-53 · ERAN 10 Y AHORA SON 40. «Con dos turnos al día eso cubre
 * cinco días: el corte del 14 de febrero es inalcanzable desde el panel».
 * Con el turno por sede, dos sedes × dos turnos son cuatro al día y los
 * diez cubrían dos días y medio. Cuarenta no es la solución definitiva
 * —eso es paginar— pero es un mes de una sede o dos semanas de dos, y
 * cabe en una consulta sin filtro nuevo.
 */
const EDU_CORTE_CERRADOS = 40;

export async function getEduCorte(
  ctx: EduClinicaContext,
  /**
   * La zona del INSTITUTO (`ctx.institution.timezone`), no la del
   * navegador. Igual que en la agenda de la Ola 2: si el corte contara los
   * días en UTC, un turno de las 20:00 a las 22:00 en México cruzaría de
   * día él solo y la pantalla diría "lleva 2 días abierto".
   */
  timeZoneCrudo: string,
  now: Date = new Date(),
  /**
   * 🔴 Ola C · H-09 · LA SEDE QUE SE ESTÁ MIRANDO, ya resuelta por el
   * endpoint (`eduCampusForCharge` sobre el selector de la barra). Decide
   * de qué turno se pinta el arqueo. `null` = vista consolidada o
   * instituto sin sedes, y entonces vale la regla 3 de
   * `getEduOpenCashSession`.
   */
  donde: { campusId: string | null; campusLabel: string | null; bloqueo: string | null } = {
    campusId: null,
    campusLabel: null,
    bloqueo: null,
  },
): Promise<EduCorte> {
  const institutionId = requireDinero(ctx);
  const scope = eduVisibility(ctx, "charges");
  const timeZone = eduSafeTimeZone(timeZoneCrudo);

  // 🔴 EL TURNO QUE SE PINTA ES EL DE ESTA SEDE, con la MISMA función que
  // usan el cobro y el abono para decidir dónde sellan. Si esta pantalla
  // eligiera el turno por su cuenta, enseñaría el arqueo de un turno
  // distinto de aquel en el que está entrando el dinero — que es
  // exactamente el descuadre que H-09 describe, con otro disfraz.
  const abiertaMin = await getEduOpenCashSession(ctx, donde.campusId);

  const [abierta, cerradas] = await Promise.all([
    abiertaMin
      ? prisma.eduCashSession.findFirst({
          where: { id: abiertaMin.id, institutionId },
          select: SESSION_SELECT,
        })
      : Promise.resolve(null),
    prisma.eduCashSession.findMany({
      where: {
        institutionId,
        closedAt: { not: null },
        // Con una sede elegida se listan los cortes DE ESA SEDE más los
        // del instituto (sin sede), que son los históricos: esconderlos
        // dejaría a Norte sin poder reimprimir nada anterior a esta ola.
        ...(donde.campusId ? { OR: [{ campusId: donde.campusId }, { campusId: null }] } : {}),
      },
      orderBy: { closedAt: "desc" },
      take: EDU_CORTE_CERRADOS,
      select: SESSION_SELECT,
    }),
  ]);

  const previous = cerradas.map(toSessionRow);
  const otrosTurnos = await otrosTurnosAbiertos(institutionId, abierta?.id ?? null);

  if (!abierta) {
    return {
      session: null,
      methods: eduCorteMethods([]),
      expectedCashCents: 0,
      netCents: 0,
      refundedCents: 0,
      chargeCount: 0,
      chargedCents: 0,
      pendingCents: 0,
      spanDays: 1,
      porSede: [],
      porCajero: [],
      previous,
      otrosTurnos,
      campusId: donde.campusId,
      campusLabel: donde.campusLabel,
      abrirBloqueado: donde.bloqueo,
    };
  }

  const cuentas = await calcularTurno(institutionId, scope, abierta.id, abierta.openingCents);
  // El desglose vivo NO viaja como "congelado": lo que se congela se
  // escribe al cerrar. La pantalla lo recalcula de `methods`.
  const { desglose: _vivo, ...visibles } = cuentas;

  return {
    session: toSessionRow(abierta),
    ...visibles,
    spanDays: eduCorteSpanDays(abierta.openedAt, now, timeZone),
    previous,
    otrosTurnos,
    campusId: donde.campusId,
    campusLabel: donde.campusLabel,
    abrirBloqueado: donde.bloqueo,
  };
}

/**
 * Abre el turno **DE UNA SEDE** (H-09).
 *
 * ⚠️ El "un solo turno abierto por sede" lo garantiza la aplicación, no la
 * base: un índice único parcial (WHERE "closedAt" IS NULL) no lo puede
 * expresar sin romper cualquier upsert futuro. La comprobación va DENTRO
 * de la transacción, así que la ventana de carrera es de milisegundos y
 * hace falta que dos personas abran caja en el mismo instante. Está
 * anotado a propósito en vez de fingir que no existe: si algún día pasa,
 * se ve como dos turnos abiertos de la misma sede y se cierra uno.
 *
 * 🔴 DOS CANDADOS Y NO UNO, y el segundo es el que evita el descuadre:
 *
 *   · YA HAY TURNO EN ESTA SEDE → 409, como siempre.
 *   · YA HAY UN TURNO **SIN SEDE** (el del instituto) → 409 TAMBIÉN, con
 *     otro mensaje. Ese turno está recogiendo el dinero de todo el mundo
 *     —así se comportaba el producto hasta esta ola— y abrir uno por sede
 *     encima partiría el mismo cajón en dos cortes que ninguno cuadra.
 *     Primero se cierra el del instituto; a partir de ahí, cada sede el
 *     suyo.
 */
export async function openEduCashSession(
  ctx: EduCajaContext,
  input: { openingCents?: unknown; notes?: unknown } = {},
  now: Date = new Date(),
  options: {
    /**
     * 🔴 EN QUÉ SEDE se abre. Lo resuelve el endpoint con
     * `eduCampusForCharge` (campus-core.ts) a partir del selector de la
     * barra superior, y NUNCA sale del body: un campusId del navegador
     * abriría el turno de la otra sede. `null` = el instituto no tiene
     * sedes, y entonces esto se comporta EXACTAMENTE como antes de la ola.
     */
    campusId?: string | null;
  } = {},
): Promise<{ id: string; campusId: string | null }> {
  const institutionId = requireDinero(ctx);

  const openingCents =
    input.openingCents === undefined || input.openingCents === null || input.openingCents === ""
      ? 0
      : parseEduMoneyCentsMax(input.openingCents, EDU_MAX_CASH_CENTS);
  if (openingCents === null) {
    throw new EduPadronError(
      `El fondo de caja no es una cantidad válida (máximo ${eduMoney(EDU_MAX_CASH_CENTS)}).`,
    );
  }

  const campusId = typeof options.campusId === "string" && options.campusId ? options.campusId : null;
  if (campusId) {
    // La sede tiene que ser de ESTE instituto. El endpoint ya la resuelve
    // desde el alcance, pero el candado de pertenencia se comprueba aquí
    // igual: es la regla 2 del encabezado de este archivo.
    const sede = await prisma.eduCampus.findFirst({
      where: { id: campusId, institutionId },
      select: { id: true },
    });
    if (!sede) throw new EduPadronError("Esa sede no es de tu instituto.", 404);
  }

  const creado = await prisma.$transaction(async (tx) => {
    const abiertas = await tx.eduCashSession.findMany({
      where: { institutionId, closedAt: null },
      select: { id: true, campusId: true },
    });
    const delInstituto = abiertas.find((a) => a.campusId === null);
    if (delInstituto) {
      throw new EduPadronError(
        campusId
          ? "Hay un turno abierto SIN sede: es el turno del instituto entero y está recogiendo lo que cobran todas las sedes. Ciérralo antes de abrir turnos por sede, o los dos cortes saldrán a medias."
          : "Ya hay un turno de caja abierto. Ciérralo antes de abrir otro.",
        409,
      );
    }
    if (campusId && abiertas.some((a) => a.campusId === campusId)) {
      throw new EduPadronError(
        "Esta sede ya tiene un turno de caja abierto. Ciérralo antes de abrir otro.",
        409,
      );
    }
    return tx.eduCashSession.create({
      data: {
        institutionId,
        campusId,
        openedAt: now,
        openingCents,
        notes: eduOptionalText(input.notes, 500) ?? null,
        openedByUserId: ctx.eduUserId,
      },
      select: { id: true, campusId: true },
    });
  });

  await eduAudit(ctx, {
    action: "create",
    entity: "cashSession",
    entityId: creado.id,
    after: { openingCents, campusId },
  });

  return creado;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 H-51 (la parte sana) · CORREGIR EL FONDO DE UN TURNO **ABIERTO**.
 *
 * «Fondo de apertura con "1000" en vez de "100": todo el turno espera $900
 * de más». Hasta hoy no había dónde arreglarlo: el fondo se tecleaba al
 * abrir y el único camino era cerrar el turno con un descuadre falso.
 *
 * Lo que esto NO hace, y es deliberado:
 *   · NO toca un turno CERRADO. `closedAt: null` va en el `where` del
 *     `updateMany`, así que un corte ya firmado —con su esperado y su
 *     diferencia congelados— no se puede reescribir desde ninguna
 *     pantalla. Eso sería falsificar un papel que alguien firmó.
 *   · NO borra el fondo anterior: lo ESCRIBE en las notas del turno, con
 *     quién lo cambió. Un fondo que cambia sin rastro es un fondo que se
 *     puede acomodar al final del día para que el arqueo cuadre.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function setEduCashSessionOpening(
  ctx: EduCajaContext,
  input: { sessionId?: unknown; openingCents?: unknown; reason?: unknown } = {},
  now: Date = new Date(),
): Promise<{ id: string; openingCents: number; anteriorCents: number }> {
  const institutionId = requireDinero(ctx);

  const openingCents = parseEduMoneyCentsMax(input.openingCents, EDU_MAX_CASH_CENTS);
  if (openingCents === null) {
    throw new EduPadronError(
      `El fondo de caja no es una cantidad válida (máximo ${eduMoney(EDU_MAX_CASH_CENTS)}). Si el cajón empezó vacío, escribe 0.`,
    );
  }

  const motivo = eduOptionalText(input.reason, 200);
  if (!motivo || motivo.trim().length < 3) {
    throw new EduPadronError(
      "Escribe por qué se corrige el fondo (al menos 3 letras). Un fondo que cambia sin explicación es un arqueo que no se puede leer.",
      400,
    );
  }

  const id = eduCleanId(input.sessionId);
  const abierta = id
    ? await prisma.eduCashSession.findFirst({
        where: { id, institutionId, closedAt: null },
        select: { id: true, openingCents: true, notes: true },
      })
    : await prisma.eduCashSession.findFirst({
        where: { institutionId, closedAt: null },
        orderBy: { openedAt: "desc" },
        select: { id: true, openingCents: true, notes: true },
      });
  if (!abierta) {
    throw new EduPadronError(
      "No hay ningún turno de caja abierto con ese id. Un turno cerrado no se corrige: su corte ya está congelado.",
      409,
    );
  }
  if (abierta.openingCents === openingCents) {
    throw new EduPadronError("Ese ya es el fondo del turno: no hay nada que corregir.", 409);
  }

  const rastro = `Fondo corregido: ${eduMoney(abierta.openingCents)} → ${eduMoney(openingCents)} por ${nombreDelActor(ctx)}. Motivo: ${motivo}`;
  const notes = [abierta.notes, rastro].filter(Boolean).join("\n").slice(0, 500);

  // El estado en el `where`, como manda la casa: si alguien cierra el
  // turno mientras se teclea la corrección, esto escribe CERO filas y se
  // entera, en vez de mover el fondo de un corte ya congelado.
  const res = await prisma.eduCashSession.updateMany({
    where: { id: abierta.id, institutionId, closedAt: null, openingCents: abierta.openingCents },
    data: { openingCents, notes },
  });
  if (res.count === 0) {
    throw new EduPadronError(
      "Ese turno se cerró (o alguien corrigió el fondo antes) mientras lo editabas. Recarga la pantalla.",
      409,
    );
  }

  await eduAudit(ctx, {
    action: "update",
    entity: "cashSession",
    entityId: abierta.id,
    before: { openingCents: abierta.openingCents },
    after: { openingCents, motivo },
  });

  return { id: abierta.id, openingCents, anteriorCents: abierta.openingCents };
}

/**
 * Cierra el turno y CONGELA el corte.
 *
 * `expectedCents` y `differenceCents` se guardan calculados en este
 * instante y no se vuelven a tocar: si mañana alguien registra un pago con
 * fecha vieja, el corte que se imprimió y se firmó tiene que seguir
 * diciendo lo mismo.
 */
export async function closeEduCashSession(
  ctx: EduCajaContext,
  input: { countedCents?: unknown; notes?: unknown } = {},
  now: Date = new Date(),
  options: {
    /**
     * 🔴 H-09 · QUÉ TURNO se cierra: el de ESTA sede. Se resuelve con la
     * misma función que usan el cobro y el abono para decidir dónde
     * sellan, así que quien cierra cierra el turno en el que está
     * entrando su dinero y no el de la sede de al lado.
     */
    campusId?: string | null;
  } = {},
): Promise<{
  id: string;
  expectedCents: number;
  countedCents: number;
  differenceCents: number;
}> {
  const institutionId = requireDinero(ctx);
  const scope = eduVisibility(ctx, "charges");

  const abiertaMin = await getEduOpenCashSession(ctx, options.campusId);
  const abierta = abiertaMin
    ? await prisma.eduCashSession.findFirst({
        where: { id: abiertaMin.id, institutionId, closedAt: null },
        select: { id: true, openingCents: true, notes: true, campusId: true },
      })
    : null;
  if (!abierta) throw new EduPadronError("No hay ningún turno de caja abierto.", 409);

  const countedCents = parseEduMoneyCentsMax(input.countedCents, EDU_MAX_CASH_CENTS);
  if (countedCents === null) {
    throw new EduPadronError(
      `Lo contado no es una cantidad válida (máximo ${eduMoney(EDU_MAX_CASH_CENTS)}). Si el cajón está vacío, escribe 0.`,
    );
  }

  const cuentas = await calcularTurno(institutionId, scope, abierta.id, abierta.openingCents);
  const expectedCents = cuentas.expectedCashCents;
  const differenceCents = countedCents - expectedCents;

  const extra = eduOptionalText(input.notes, 500);

  // ── 🔴 H-48 · EL ESTADO VA EN EL `where`, no solo en la lectura ─────
  // Era un check-then-act de manual: se leía el turno abierto, se calculaba
  // el esperado y se escribía con `update({where:{id}})` a secas. Dos
  // "Cerrar turno" a la vez ganaba el último SIN AVISO, y el segundo
  // congelaba un esperado calculado sobre un turno que ya estaba cerrado.
  // Con `closedAt: null` en el `where`, el segundo no escribe y se entera.
  // Es el mismo patrón que ya usan recetas, consentimientos y la
  // cancelación de un cobro.
  const cerrada = await prisma.eduCashSession.updateMany({
    where: { id: abierta.id, institutionId, closedAt: null },
    data: {
      closedAt: now,
      closedByUserId: ctx.eduUserId,
      countedCents,
      expectedCents,
      differenceCents,
      // ── 🔴 H-53 · EL DESGLOSE POR MÉTODO, CONGELADO ─────────────────
      // «El desglose por método NO SE GUARDA: se pierde al cerrar», y el
      // propio código prometía la reimpresión (dinero-core.ts:615). Se
      // escribe UNA vez, aquí, con los MISMOS pagos con los que se acaba
      // de calcular `expectedCents`: el papel que alguien firma y la fila
      // que queda en la base dicen lo mismo por construcción. A partir de
      // ahora el corte del 14 de febrero se reimprime LEYENDO esto, no
      // recalculándolo — recalcularlo sería deshacer el congelado que ya
      // protege al esperado y a la diferencia.
      methodBreakdown: cuentas.desglose as unknown as Prisma.InputJsonValue,
      // Las notas del cierre se SUMAN a las de la apertura en vez de
      // pisarlas: las dos son del mismo turno y las dos importan.
      notes: extra
        ? [abierta.notes, extra].filter(Boolean).join("\n").slice(0, 500)
        : abierta.notes,
    },
  });
  if (cerrada.count === 0) {
    throw new EduPadronError(
      "Ese turno ya lo cerró alguien mientras contabas el cajón. Recarga la pantalla: el corte que quedó guardado es el suyo.",
      409,
    );
  }

  await eduAudit(ctx, {
    action: "update",
    entity: "cashSession",
    entityId: abierta.id,
    before: { closedAt: null },
    after: {
      closedAt: now,
      campusId: abierta.campusId,
      expectedCents,
      countedCents,
      differenceCents,
    },
  });

  return { id: abierta.id, expectedCents, countedCents, differenceCents };
}

/**
 * EL CORTE CONGELADO de un turno ya cerrado, para reimprimirlo.
 *
 * 🔴 SE LEE, NO SE RECALCULA. Lo que devuelve es exactamente lo que se
 * guardó al cerrar: el esperado, lo contado, la diferencia y el desglose
 * por método. Un pago registrado después con fecha vieja no puede cambiar
 * un papel que ya se firmó — es la misma decisión que ya protegía a
 * `expectedCents`, extendida al desglose.
 *
 * ⚠️ `desglose: null` en un turno cerrado significa «cerrado ANTES de esta
 * ola»: no hay foto que enseñar y la pantalla lo dice con esas palabras,
 * en vez de pintar ceros que parecen datos.
 */
export async function getEduCorteCerrado(
  ctx: EduClinicaContext,
  sessionId: string,
): Promise<EduCashSessionRow | null> {
  const institutionId = requireDinero(ctx);
  const id = eduCleanId(sessionId);
  if (!id) return null;
  const fila = await prisma.eduCashSession.findFirst({
    where: { id, institutionId, closedAt: { not: null } },
    select: SESSION_SELECT,
  });
  return fila ? toSessionRow(fila) : null;
}
