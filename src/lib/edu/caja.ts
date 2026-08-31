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
import { eduCleanId, eduOptionalText, eduSafeTimeZone } from "@/lib/edu/agenda-core";
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
  eduCorteMethods,
  eduCorteSpanDays,
  eduLineTotalCents,
  eduMoney,
  eduResolveChargeView,
  parseEduMoneyCentsMax,
  parseEduPaymentMethod,
  type EduCashSessionRow,
  type EduChargeFilters,
  type EduChargeRow,
  type EduChargesPage,
  type EduCorte,
} from "@/lib/edu/dinero-core";
import { resolveEduChargeLines, type EduLineaCliente } from "@/lib/edu/tarifas";
import {
  eduCaseScopeWhere,
  eduChargeScopeWhere,
  eduPatientScopeWhere,
  eduPaymentScopeWhere,
  eduScopeIsEmpty,
  eduVisibility,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import { EDU_CASH_METHOD, type EduPaymentMethod } from "@/lib/edu/types";

export { EduPadronError as EduCajaError };

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
  patient: { select: { firstName: true, lastName: true, folio: true } },
  chargedBy: { select: { firstName: true, lastName: true, email: true } },
  cancelledBy: { select: { firstName: true, lastName: true, email: true } },
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
      receivedBy: { select: { firstName: true, lastName: true, email: true } },
    },
  },
  // Pagos a meses: el plan ACTIVO, si hay (a lo sumo uno — lo garantiza la
  // transacción que crea planes). Con esto el recibo puede decir "este
  // cobro se paga a meses" y esconder el pago suelto que el servidor
  // rebotaría de todos modos.
  paymentPlans: {
    where: { status: "ACTIVO" },
    take: 1,
    select: { id: true },
  },
} satisfies Prisma.EduChargeSelect;

type ChargePayload = Prisma.EduChargeGetPayload<{ select: typeof CHARGE_SELECT }>;

function toChargeRow(c: ChargePayload): EduChargeRow {
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
    chargedByName: persona(c.chargedBy),
    chargedAt: c.chargedAt.toISOString(),
    cancelledAt: iso(c.cancelledAt),
    cancelledByName: c.cancelledBy ? persona(c.cancelledBy) : null,
    cancelReason: c.cancelReason,
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
      receivedByName: persona(p.receivedBy),
    })),
    activePlanId: c.paymentPlans[0]?.id ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LECTURAS
// ═══════════════════════════════════════════════════════════════════════

/** El turno abierto del instituto, si hay. */
export async function getEduOpenCashSession(
  ctx: EduClinicaContext,
): Promise<{ id: string; openedAt: Date; openingCents: number } | null> {
  const institutionId = requireDinero(ctx);
  return prisma.eduCashSession.findFirst({
    where: { institutionId, closedAt: null },
    orderBy: { openedAt: "desc" },
    select: { id: true, openedAt: true, openingCents: true },
  });
}

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

export async function listEduCharges(
  ctx: EduClinicaContext,
  filters: EduChargeFilters,
): Promise<EduChargesPage> {
  requireDinero(ctx);
  const sesion = filters.soloTurno ? await getEduOpenCashSession(ctx) : null;

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

  const visibles = rows.slice(0, EDU_CAJA_MAX_ROWS).map(toChargeRow);

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

  return { rows: visibles, truncated: rows.length > EDU_CAJA_MAX_ROWS, totals, applied };
}

/**
 * Un cobro, SI le toca a quien pregunta.
 *
 * El id de la URL no basta: la fila se busca con el `where` del alcance,
 * así que un cobro de otra escuela se ve exactamente igual que uno que no
 * existe.
 */
export async function getEduCharge(
  ctx: EduClinicaContext,
  chargeId: string,
): Promise<EduChargeRow | null> {
  const institutionId = requireDinero(ctx);
  const id = eduCleanId(chargeId);
  if (!id) return null;

  const c = await prisma.eduCharge.findFirst({
    where: {
      ...eduChargeScopeWhere({ institutionId, scope: eduVisibility(ctx, "charges") }),
      id,
    },
    select: CHARGE_SELECT,
  });
  return c ? toChargeRow(c) : null;
}

/** Los cobros de UN paciente (la ficha, y el histórico de caja). */
export async function listEduPatientCharges(
  ctx: EduClinicaContext,
  patientId: string,
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
  return rows.map(toChargeRow);
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
 */
async function nextEduChargeFolio(institutionId: string): Promise<string> {
  const last = await prisma.eduCharge.findFirst({
    where: { institutionId, folio: { startsWith: "C-" } },
    orderBy: { folio: "desc" },
    select: { folio: true },
  });
  const m = last?.folio.match(/^C-(\d{1,6})$/);
  const n = m ? Number(m[1]) + 1 : 1;
  return `C-${String(n).padStart(4, "0")}`;
}

export interface EduPaymentInput {
  method?: unknown;
  amountCents?: unknown;
  reference?: unknown;
  notes?: unknown;
  isRefund?: unknown;
}

export interface EduChargeInput {
  patientId?: unknown;
  caseId?: unknown;
  items?: unknown;
  notes?: unknown;
  /** Pago inmediato, que es lo normal en un mostrador. Opcional. */
  payment?: EduPaymentInput;
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
  ctx: EduClinicaContext,
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
  if (lineasCliente.length === 0) throw new EduPadronError("El cobro no tiene ni un concepto.");
  if (lineasCliente.length > EDU_MAX_CHARGE_ITEMS) {
    throw new EduPadronError(
      `Un cobro admite hasta ${EDU_MAX_CHARGE_ITEMS} conceptos. Divídelo en dos.`,
    );
  }

  // ── 🔴 AQUÍ SE COTIZA EN EL SERVIDOR ────────────────────────────────
  const { applied, lines, descartados } = await resolveEduChargeLines(
    institutionId,
    patientId,
    lineasCliente,
  );

  const totals = eduChargeTotals(lines);
  if (totals.totalCents > EDU_MAX_CHARGE_CENTS) {
    throw new EduPadronError(
      `El cobro suma más de ${eduMoney(EDU_MAX_CHARGE_CENTS)}. Revisa las cantidades.`,
    );
  }

  const caseId = await resolverCaso(ctx, institutionId, patientId, input.caseId, now);
  const sesion = await getEduOpenCashSession(ctx);

  // El pago inmediato, si viene.
  const pago = input.payment ? parsePago(input.payment, totals.totalCents, options.canRefund) : null;
  if (pago?.isRefund) {
    throw new EduPadronError("Un cobro no nace con una devolución.");
  }

  const paidCents = pago?.amountCents ?? 0;
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
    // desactiva, el recibo sigue diciendo qué tarifa se aplicó.
    feeScheduleLabel: applied?.feeScheduleName ?? null,
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

        if (pago) {
          await tx.eduPayment.create({
            data: {
              institutionId,
              chargeId: cobro.id,
              method: pago.method,
              amountCents: pago.amountCents,
              isRefund: false,
              reference: pago.reference,
              notes: pago.notes,
              paidAt: now,
              receivedByUserId: ctx.eduUserId,
              cashSessionId: sesion?.id ?? null,
            },
          });
        }

        return cobro;
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

interface PagoValidado {
  method: EduPaymentMethod;
  amountCents: number;
  isRefund: boolean;
  reference: string | null;
  notes: string | null;
}

function parsePago(input: EduPaymentInput, maxCents: number, canRefund?: boolean): PagoValidado {
  const method = input.method === undefined ? EDU_CASH_METHOD : parseEduPaymentMethod(input.method);
  if (!method) throw new EduPadronError("Ese método de pago no existe.");

  const amountCents = parseEduMoneyCentsMax(input.amountCents, EDU_MAX_CHARGE_CENTS);
  if (amountCents === null) throw new EduPadronError("Ese monto no es una cantidad válida.");
  if (amountCents <= 0) throw new EduPadronError("El monto tiene que ser mayor que cero.");

  const isRefund = Boolean(input.isRefund);
  if (isRefund && !canRefund) {
    throw new EduPadronError("Tu cuenta no puede devolver dinero (permiso caja.refund).", 403);
  }
  if (amountCents > maxCents) {
    throw new EduPadronError(
      isRefund
        ? `No puedes devolver ${eduMoney(amountCents)}: el paciente solo ha pagado ${eduMoney(maxCents)}.`
        : `No puedes cobrar ${eduMoney(amountCents)}: el saldo es ${eduMoney(maxCents)}.`,
    );
  }

  return {
    method,
    amountCents,
    isRefund,
    reference: eduOptionalText(input.reference, 80) ?? null,
    notes: eduOptionalText(input.notes, 300) ?? null,
  };
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
  paidAt: Date;
  receivedByUserId: string;
  /** El turno ABIERTO AL PAGAR (o null): lo consulta el llamador. */
  cashSessionId: string | null;
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
      institutionId,
      chargeId: id,
      method: pago.method,
      amountCents: pago.amountCents,
      isRefund: pago.isRefund,
      reference: pago.reference,
      notes: pago.notes,
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
  ctx: EduClinicaContext,
  chargeId: string,
  input: EduPaymentInput,
  options: { canRefund?: boolean } = {},
  now: Date = new Date(),
): Promise<{ id: string; status: string; balanceCents: number }> {
  const institutionId = requireDinero(ctx);
  const id = eduCleanId(chargeId);
  if (!id) throw new EduPadronError("Ese cobro no es válido.", 400);

  const cobro = await prisma.eduCharge.findFirst({
    where: {
      ...eduChargeScopeWhere({ institutionId, scope: eduVisibility(ctx, "charges") }),
      id,
    },
    select: { id: true, totalCents: true, paidCents: true, status: true },
  });
  if (!cobro) throw new EduPadronError("Ese cobro no es de este instituto.", 404);
  if (cobro.status === "CANCELLED") {
    throw new EduPadronError("Ese cobro está cancelado: no admite pagos ni devoluciones.", 409);
  }

  const esDevolucion = Boolean(input.isRefund);
  const tope = esDevolucion
    ? cobro.paidCents
    : Math.max(0, cobro.totalCents - cobro.paidCents);
  if (tope <= 0) {
    throw new EduPadronError(
      esDevolucion ? "Ese cobro no tiene nada pagado que devolver." : "Ese cobro ya está liquidado.",
      409,
    );
  }
  const pago = parsePago(input, tope, options.canRefund);

  const sesion = await getEduOpenCashSession(ctx);

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
        pago.isRefund
          ? "Ese cobro tiene un plan de pagos activo. Cancela primero el plan (pide el mismo permiso) y después devuelve el dinero."
          : "Ese cobro se paga a meses: cóbralo por sus mensualidades, en Caja → Pagos a meses. Si el plan ya no va, cancélalo y el saldo vuelve a cobrarse normal.",
        409,
      );
    }

    const aplicado = await eduApplyEduPaymentInTx(tx, {
      institutionId,
      chargeId: id,
      method: pago.method,
      amountCents: pago.amountCents,
      isRefund: pago.isRefund,
      reference: pago.reference,
      notes: pago.notes,
      paidAt: now,
      receivedByUserId: ctx.eduUserId,
      cashSessionId: sesion?.id ?? null,
    });

    return { id: aplicado.paymentId, status: aplicado.status, balanceCents: aplicado.balanceCents };
  });

  return resultado;
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
  ctx: EduClinicaContext,
  chargeId: string,
  input: { reason?: unknown } = {},
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireDinero(ctx);
  const id = eduCleanId(chargeId);
  if (!id) throw new EduPadronError("Ese cobro no es válido.", 400);

  const cobro = await prisma.eduCharge.findFirst({
    where: {
      ...eduChargeScopeWhere({ institutionId, scope: eduVisibility(ctx, "charges") }),
      id,
    },
    select: { id: true, paidCents: true, status: true },
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
      "Ese cobro cambió mientras lo cancelabas (entró un pago, un plan de pagos, o alguien lo canceló antes). Recarga la pantalla.",
      409,
    );
  }
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
      select: { method: true, amountCents: true, isRefund: true },
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

  return {
    methods,
    expectedCashCents,
    netCents,
    refundedCents,
    chargeCount: cobros.length,
    chargedCents: cobros.reduce((a, c) => a + c.totalCents, 0),
    pendingCents: cobros.reduce((a, c) => a + c.balanceCents, 0),
  };
}

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
): Promise<EduCorte> {
  const institutionId = requireDinero(ctx);
  const scope = eduVisibility(ctx, "charges");
  const timeZone = eduSafeTimeZone(timeZoneCrudo);

  const [abierta, cerradas] = await Promise.all([
    prisma.eduCashSession.findFirst({
      where: { institutionId, closedAt: null },
      orderBy: { openedAt: "desc" },
      select: SESSION_SELECT,
    }),
    prisma.eduCashSession.findMany({
      where: { institutionId, closedAt: { not: null } },
      orderBy: { closedAt: "desc" },
      take: 10,
      select: SESSION_SELECT,
    }),
  ]);

  const previous = cerradas.map(toSessionRow);

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
      previous,
    };
  }

  const cuentas = await calcularTurno(institutionId, scope, abierta.id, abierta.openingCents);

  return {
    session: toSessionRow(abierta),
    ...cuentas,
    spanDays: eduCorteSpanDays(abierta.openedAt, now, timeZone),
    previous,
  };
}

/**
 * Abre el turno.
 *
 * ⚠️ El "solo un turno abierto" lo garantiza la aplicación, no la base: un
 * índice único parcial (WHERE "closedAt" IS NULL) no lo puede expresar sin
 * romper cualquier upsert futuro. La comprobación va DENTRO de la
 * transacción, así que la ventana de carrera es de milisegundos y hace
 * falta que dos personas abran caja en el mismo instante. Está anotado a
 * propósito en vez de fingir que no existe: si algún día pasa, se ve como
 * dos turnos abiertos y se cierra uno.
 */
export async function openEduCashSession(
  ctx: EduClinicaContext,
  input: { openingCents?: unknown; notes?: unknown } = {},
  now: Date = new Date(),
): Promise<{ id: string }> {
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

  const creado = await prisma.$transaction(async (tx) => {
    const abierta = await tx.eduCashSession.findFirst({
      where: { institutionId, closedAt: null },
      select: { id: true },
    });
    if (abierta) {
      throw new EduPadronError("Ya hay un turno de caja abierto. Ciérralo antes de abrir otro.", 409);
    }
    return tx.eduCashSession.create({
      data: {
        institutionId,
        openedAt: now,
        openingCents,
        notes: eduOptionalText(input.notes, 500) ?? null,
        openedByUserId: ctx.eduUserId,
      },
      select: { id: true },
    });
  });

  return creado;
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
  ctx: EduClinicaContext,
  input: { countedCents?: unknown; notes?: unknown } = {},
  now: Date = new Date(),
): Promise<{ id: string; expectedCents: number; countedCents: number; differenceCents: number }> {
  const institutionId = requireDinero(ctx);
  const scope = eduVisibility(ctx, "charges");

  const abierta = await prisma.eduCashSession.findFirst({
    where: { institutionId, closedAt: null },
    orderBy: { openedAt: "desc" },
    select: { id: true, openingCents: true, notes: true },
  });
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

  await prisma.eduCashSession.update({
    where: { id: abierta.id },
    data: {
      closedAt: now,
      closedByUserId: ctx.eduUserId,
      countedCents,
      expectedCents,
      differenceCents,
      // Las notas del cierre se SUMAN a las de la apertura en vez de
      // pisarlas: las dos son del mismo turno y las dos importan.
      notes: extra
        ? [abierta.notes, extra].filter(Boolean).join("\n").slice(0, 500)
        : abierta.notes,
    },
  });

  return { id: abierta.id, expectedCents, countedCents, differenceCents };
}
