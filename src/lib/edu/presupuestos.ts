/**
 * DaleControl INSTITUCIONAL — LOS PRESUPUESTOS contra la base.
 *
 * SERVIDOR: importa prisma. Lo puro (estados, aritmética, vigencia, texto
 * canónico) vive en presupuestos-core.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL DOBLE CANDADO — Y AQUÍ EL ALCANCE ES EL DEL DINERO
 *
 *   · PERMISO — `caja.view` para leer, `caja.charge` para armar,
 *     presentar, aceptar a mano y convertir. Ninguna key nueva: un
 *     presupuesto es la antesala de un cobro y quien cobra es quien lo
 *     arma.
 *   · ALCANCE — el del DINERO (`eduVisibility(ctx, "charges")`), NO el de
 *     "patients" y NO el clínico. Esto es dinero, y el reparto del dinero
 *     va al revés que todo lo demás en este vertical: caja y dirección lo
 *     ven ENTERO; DOCENTE y ALUMNO no ven NADA, ni lo suyo.
 *
 *     🔴 Y eso es a propósito, con la razón escrita en visibility.ts: «un
 *     residente que puede consultar cuánto pagó su paciente sabe cuánto
 *     vale su propia lista de espera, y ése es exactamente el incentivo
 *     que la escuela no quiere crear».
 *
 * ⚠️ LA ACEPTACIÓN PÚBLICA (`aceptarEduQuotePorToken`) NO PASA POR NINGÚN
 * PERMISO NI POR NINGÚN ALCANCE, y no es un descuido: al otro lado hay un
 * PACIENTE sin sesión, mirando su teléfono. Lo que la protege es el TOKEN
 * —único en toda la base, largo y aleatorio— y el estado del propio
 * presupuesto. Es el mismo diseño que la carta pública de consentimiento.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { createHash, randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCleanId, eduOptionalText, eduSafeTimeZone } from "@/lib/edu/agenda-core";
import { eduPatientFullName } from "@/lib/edu/pacientes-core";
import { getEduTarifaDePaciente } from "@/lib/edu/tarifas";
import { eduSearchTokens } from "@/lib/edu/padron-core";
import {
  eduScopeIsEmpty,
  eduVisibility,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import {
  EDU_QUOTE_EMPTY_FILTERS,
  EDU_QUOTE_MAX_ROWS,
  EDU_QUOTE_NOTES_MAX,
  eduQuoteEstadoVisible,
  eduQuoteLigaVigente,
  eduQuoteMotivoParaNoAceptar,
  eduQuoteParseItems,
  eduQuoteParsePct,
  eduQuoteParseVigencia,
  eduQuoteParseStatus,
  eduQuoteParseTitulo,
  eduQuotePuedeTransicionar,
  eduQuoteTextoCanonico,
  eduQuoteTotales,
  eduQuoteVencido,
  eduQuoteVigenciaDiaISO,
  eduQuoteVigenciaPorDefecto,
  type EduQuoteEstadoVisible,
  type EduQuoteFilters,
  type EduQuoteRow,
  type EduQuotesPage,
  type EduQuoteStatus,
} from "@/lib/edu/presupuestos-core";
import { eduAudit, type EduAuditActor } from "@/lib/edu/auditoria";
import { EDU_MAX_CHARGE_ITEMS } from "@/lib/edu/dinero-core";
import { createEduCharge } from "@/lib/edu/caja";
import { createEduPaymentPlan } from "@/lib/edu/pagos";

export interface EduQuoteContext extends EduClinicaContext, EduAuditActor {
  /**
   * 🔴 OLA C·fin 2 · LA ZONA DEL INSTITUTO, que hasta ahora no llegaba
   * hasta aquí aunque `getEduContext` la tuviera delante. La vigencia de un
   * presupuesto es una FECHA CIVIL (presupuestos-core.ts) y una fecha civil
   * sin zona no es una fecha: es un instante que se corre treinta horas.
   */
  institution: { timezone: string };
}

/** La zona del instituto, ya saneada. Un `timezone` roto cae en UTC. */
function zonaDe(ctx: EduQuoteContext): string {
  return eduSafeTimeZone(ctx?.institution?.timezone);
}

function requireInstitution(ctx: { institutionId?: string }): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Tu sesión no trae instituto. Vuelve a entrar.", 401);
  }
  return id;
}

/**
 * EL ALCANCE DEL DINERO, en una función para no repetirlo en cada
 * consulta.
 *
 * 🔴 SE PREGUNTA POR EL RECURSO "charges" Y NO POR "patients". Para el
 * dinero, `eduVisibility` solo devuelve `all` (caja y dirección) o `none`
 * (docente y alumno): no hay un "lo mío" recortado, y por eso aquí basta
 * con comprobar que no sea vacío en vez de armar un `where` de filas. La
 * asimetría está escrita en visibility.ts y es deliberada.
 *
 * 🔴 LANZA 403 EN VEZ DE DEVOLVER UNA LISTA VACÍA. Un docente que pide
 * presupuestos tiene que leer POR QUÉ no los ve; una lista vacía le haría
 * creer que su paciente no tiene ninguno.
 */
function asegurarAlcanceDinero(ctx: EduQuoteContext): void {
  if (eduScopeIsEmpty(eduVisibility(ctx, "charges"))) {
    throw new EduPadronError(
      "Tu rol no ve el dinero de la clínica. Los presupuestos los llevan caja y dirección.",
      403,
    );
  }
}

/**
 * El siguiente folio: P-0001, P-0002…
 *
 * Con CUATRO dígitos y ceros a la izquierda, por lo mismo que el folio del
 * cobro: el orden de Postgres es alfabético y sin el relleno "P-9" saldría
 * después de "P-10". Mismo patrón, y con el mismo reintento de tres al
 * insertar (el índice único rebota la carrera).
 */
async function nextEduQuoteFolio(institutionId: string): Promise<string> {
  const last = await prisma.eduQuote.findFirst({
    where: { institutionId, folio: { startsWith: "P-" } },
    orderBy: { folio: "desc" },
    select: { folio: true },
  });
  const m = last?.folio.match(/^P-(\d{1,6})$/);
  const n = m ? Number(m[1]) + 1 : 1;
  return `P-${String(n).padStart(4, "0")}`;
}

const QUOTE_INCLUDE = {
  items: true,
  patient: { select: { firstName: true, lastName: true, folio: true } },
} satisfies Prisma.EduQuoteInclude;

type QuoteConItems = Prisma.EduQuoteGetPayload<{ include: typeof QUOTE_INCLUDE }>;

function aRow(q: QuoteConItems, now: Date, timeZone: string): EduQuoteRow {
  return {
    id: q.id,
    folio: q.folio,
    title: q.title,
    status: q.status as EduQuoteStatus,
    estadoVisible: eduQuoteEstadoVisible(
      { status: q.status as EduQuoteStatus, validUntil: q.validUntil },
      now,
    ),
    patientId: q.patientId,
    patientName: q.patient ? eduPatientFullName(q.patient) : "—",
    patientFolio: q.patient?.folio ?? "—",
    caseId: q.caseId,
    validUntil: q.validUntil?.toISOString() ?? null,
    validUntilDia: eduQuoteVigenciaDiaISO(q.validUntil, timeZone),
    subtotalCents: q.subtotalCents,
    discountPct: q.discountPct === null ? null : Number(q.discountPct),
    discountCents: q.discountCents,
    totalCents: q.totalCents,
    notes: q.notes,
    presentedAt: q.presentedAt?.toISOString() ?? null,
    acceptedAt: q.acceptedAt?.toISOString() ?? null,
    acceptedAtDia: eduQuoteVigenciaDiaISO(q.acceptedAt, timeZone),
    acceptedByName: q.acceptedByName,
    chargeId: q.chargeId,
    treatmentPlanId: q.treatmentPlanId,
    createdByName: q.createdByName,
    createdAt: q.createdAt.toISOString(),
    items: [...q.items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({
        id: i.id,
        name: i.name,
        toothFdi: i.toothFdi,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
        discountCents: i.discountCents,
        lineTotalCents: i.lineTotalCents,
        phase: i.phase,
        notes: i.notes,
      })),
  };
}

/** LOS PRESUPUESTOS de un paciente. */
export async function listEduQuotes(
  ctx: EduQuoteContext,
  patientId: string,
  now: Date = new Date(),
): Promise<EduQuoteRow[]> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(patientId);
  if (!id) throw new EduPadronError("Falta el paciente.", 400);
  asegurarAlcanceDinero(ctx);

  const filas = await prisma.eduQuote.findMany({
    where: { institutionId, patientId: id },
    orderBy: { createdAt: "desc" },
    take: EDU_QUOTE_MAX_ROWS,
    include: QUOTE_INCLUDE,
  });
  const tz = zonaDe(ctx);
  return filas.map((q) => aRow(q, now, tz));
}

// ═══════════════════════════════════════════════════════════════════════
// LA PANTALLA DE CAJA · listar, leer y editar
// ═══════════════════════════════════════════════════════════════════════

/**
 * Re-exports para el llamador: la pantalla lee el tope y las FORMAS de la
 * misma fuente que la consulta.
 *
 * 🔴 Y las formas viven en presupuestos-core.ts, no aquí: los componentes
 * "use client" las necesitan y este archivo importa prisma. Un
 * `import type` se borra al compilar, pero basta con que alguien le quite
 * el `type` para arrastrar el runtime de Prisma al navegador. Si el tipo
 * no vive ahí, no hay de dónde. (Misma decisión, con las mismas palabras,
 * que campus-core.ts.)
 */
export {
  EDU_QUOTE_MAX_ROWS,
  EDU_QUOTE_EMPTY_FILTERS,
  type EduQuoteFilters,
  type EduQuoteRow,
  type EduQuotesPage,
} from "@/lib/edu/presupuestos-core";

/**
 * Lee los filtros de la URL. Vive aquí y no en la pantalla para que el
 * servidor y el cliente lean EXACTAMENTE los mismos parámetros: dos
 * lectores del mismo query string es cómo un selector acaba diciendo una
 * cosa mientras la tabla enseña otra.
 */
export function parseEduQuoteFilters(
  sp: { [k: string]: string | string[] | undefined } | undefined,
): EduQuoteFilters {
  const uno = (k: string): string => {
    const v = sp?.[k];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" ? s.trim() : "";
  };
  return {
    q: uno("q").slice(0, 80),
    status: eduQuoteParseStatus(uno("estado")),
    patientId: eduCleanId(uno("paciente")),
  };
}

/**
 * LOS PRESUPUESTOS DEL INSTITUTO, para la pantalla de Caja.
 *
 * 🔴 El alcance sigue siendo el del DINERO, entero: caja y dirección ven
 * todo, docente y alumno no ven nada (403 con el porqué, no una lista
 * vacía que les haría creer que su paciente no tiene ninguno).
 */
export async function listEduQuotesPanel(
  ctx: EduQuoteContext,
  filters: EduQuoteFilters = EDU_QUOTE_EMPTY_FILTERS,
  now: Date = new Date(),
): Promise<EduQuotesPage> {
  const institutionId = requireInstitution(ctx);
  asegurarAlcanceDinero(ctx);

  const and: Prisma.EduQuoteWhereInput[] = [];
  if (filters.status) and.push({ status: filters.status });
  if (filters.patientId) and.push({ patientId: filters.patientId });
  // El MISMO troceador que el padrón, los pacientes y la caja: si este
  // buscador partiera el término a su manera, "Rodriguez" encontraría
  // cosas distintas aquí que en la lista de pacientes.
  for (const token of eduSearchTokens(filters.q)) {
    and.push({
      OR: [
        { folio: { contains: token, mode: "insensitive" } },
        { title: { contains: token, mode: "insensitive" } },
        { patient: { searchIndex: { contains: token } } },
      ],
    });
  }

  const filas = await prisma.eduQuote.findMany({
    where: { institutionId, ...(and.length > 0 ? { AND: and } : {}) },
    orderBy: { createdAt: "desc" },
    take: EDU_QUOTE_MAX_ROWS + 1,
    include: QUOTE_INCLUDE,
  });

  const tz = zonaDe(ctx);
  return {
    rows: filas.slice(0, EDU_QUOTE_MAX_ROWS).map((q) => aRow(q, now, tz)),
    truncated: filas.length > EDU_QUOTE_MAX_ROWS,
    filters,
  };
}

/** UN presupuesto, entero. */
export async function getEduQuote(
  ctx: EduQuoteContext,
  quoteId: string,
  now: Date = new Date(),
): Promise<EduQuoteRow | null> {
  const institutionId = requireInstitution(ctx);
  asegurarAlcanceDinero(ctx);
  const id = eduCleanId(quoteId);
  if (!id) return null;
  const q = await prisma.eduQuote.findFirst({
    where: { id, institutionId },
    include: QUOTE_INCLUDE,
  });
  return q ? aRow(q, now, zonaDe(ctx)) : null;
}

/**
 * EDITA un presupuesto — 🔴 SOLO MIENTRAS ES BORRADOR.
 *
 * Un PRESENTADO ya tiene su liga en el WhatsApp del paciente y su texto
 * canónico es lo que se va a hashear al aceptar: cambiarle una partida
 * por detrás haría que el paciente aceptara un total distinto del que vio.
 * Para corregir uno presentado se le devuelve a borrador (que le quita la
 * presentación y deja el token quieto) y se edita ahí.
 */
export async function updateEduQuote(
  ctx: EduQuoteContext,
  quoteId: string,
  body: {
    title?: unknown;
    notes?: unknown;
    validUntil?: unknown;
    discountPct?: unknown;
    discountCents?: unknown;
    items?: unknown;
  },
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ id: string; totalCents: number }> {
  const institutionId = requireInstitution(ctx);
  asegurarAlcanceDinero(ctx);

  const id = eduCleanId(quoteId);
  if (!id) throw new EduPadronError("Falta el presupuesto.", 400);

  const q = await prisma.eduQuote.findFirst({
    where: { id, institutionId },
    select: {
      id: true,
      patientId: true,
      status: true,
      title: true,
      totalCents: true,
      discountCents: true,
    },
  });
  if (!q) throw new EduPadronError("Ese presupuesto no existe o no es de tu instituto.", 404);
  if (q.status !== "BORRADOR") {
    throw new EduPadronError(
      `Un presupuesto ${q.status} no se edita: sus partidas están congeladas. Devuélvelo a borrador si tienes que corregirlo.`,
      409,
    );
  }

  const title = eduQuoteParseTitulo(body?.title);
  const notes = eduOptionalText(body?.notes, EDU_QUOTE_NOTES_MAX) ?? null;
  const items = eduQuoteParseItems(body?.items);
  const discountPct = eduQuoteParsePct(body?.discountPct);
  const discountCentsRaw =
    body?.discountCents === undefined || body?.discountCents === null
      ? 0
      : Number.parseInt(String(body.discountCents), 10) || 0;
  const totales = eduQuoteTotales(items, discountPct, discountCentsRaw);

  // 🔴 OLA C·fin 2 · FECHA CIVIL EN LA ZONA DEL INSTITUTO. Ver el bloque
  // de la vigencia en presupuestos-core.ts: `new Date("2026-09-08")` es
  // medianoche UTC, o sea las 18:00 del 7 en México.
  let validUntil: Date | null = null;
  if (body?.validUntil) {
    validUntil = eduQuoteParseVigencia(body.validUntil, zonaDe(ctx));
    if (!validUntil) {
      throw new EduPadronError("La vigencia no se entiende: mándala como 2026-09-30.", 400);
    }
  }

  await prisma.$transaction(async (tx) => {
    // 🔴 El estado en el `where`, como manda la casa: si alguien lo
    // presenta mientras esto se teclea, aquí no se escribe nada y el 409
    // de abajo lo cuenta — en vez de reescribir las partidas de un
    // presupuesto que el paciente ya está mirando.
    const res = await tx.eduQuote.updateMany({
      where: { id: q.id, institutionId, status: "BORRADOR" },
      data: {
        title,
        notes,
        validUntil,
        discountPct,
        subtotalCents: totales.subtotalCents,
        discountCents: totales.discountCents,
        totalCents: totales.totalCents,
      },
    });
    if (res.count === 0) {
      throw new EduPadronError(
        "Alguien presentó o cambió ese presupuesto mientras lo editabas. Actualiza la pantalla.",
        409,
      );
    }
    // Las partidas se REEMPLAZAN enteras y no se van casando una a una:
    // un presupuesto en borrador no tiene nada colgando de sus filas (ni
    // cobro, ni evidencia, ni liga usada), así que la forma sencilla es
    // también la correcta. Va dentro de la MISMA transacción que los
    // totales: si se escribieran por separado, un fallo a la mitad dejaría
    // un total que no es la suma de sus partidas.
    await tx.eduQuoteItem.deleteMany({ where: { institutionId, quoteId: q.id } });
    await tx.eduQuoteItem.createMany({
      data: items.map((i) => ({ ...i, institutionId, quoteId: q.id })),
    });
  });

  await eduAudit(ctx, {
    action: "update",
    entity: "quote",
    entityId: q.id,
    patientId: q.patientId,
    before: { title: q.title, totalCents: q.totalCents },
    after: { title, totalCents: totales.totalCents, partidas: items.length },
    ...meta,
  });

  return { id: q.id, totalCents: totales.totalCents };
}

/**
 * CREA un presupuesto con sus partidas.
 *
 * 🔴 LOS TOTALES LOS CALCULA EL SERVIDOR, SIEMPRE. Lo que manda el cliente
 * son cantidades y precios unitarios; el subtotal, el descuento y el total
 * salen de `eduQuoteTotales`. Un total que llega del navegador es un total
 * que el navegador puede cambiar.
 */
export async function createEduQuote(
  ctx: EduQuoteContext,
  body: {
    patientId?: unknown;
    caseId?: unknown;
    /**
     * 🔴 DESDE UN PLAN DE TRATAMIENTO. Cuando viene, el presupuesto queda
     * COLGADO de ese plan (`EduQuote.treatmentPlanId`, la columna que la
     * C·base dejó puesta y que hasta ahora no escribía nadie) y, si no
     * mandan partidas, se siembra UNA con el nombre del plan y su
     * `totalCents`.
     *
     * ⚠️ Y UNA sola, no `totalSessions`: `EduTreatmentPlan` **no** guarda
     * una lista de procedimientos —tiene nombre, descripción, cuántas
     * sesiones se esperan y un importe total—, así que partirlo en N
     * renglones sería inventarse un desglose que no existe. Quien quiera
     * el detalle manda sus propias partidas y este parámetro solo hace el
     * enlace.
     */
    treatmentPlanId?: unknown;
    title?: unknown;
    notes?: unknown;
    validUntil?: unknown;
    discountPct?: unknown;
    discountCents?: unknown;
    items?: unknown;
  },
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ id: string; folio: string; totalCents: number }> {
  const institutionId = requireInstitution(ctx);
  asegurarAlcanceDinero(ctx);

  const patientId = eduCleanId(body?.patientId);
  if (!patientId) throw new EduPadronError("Falta el paciente del presupuesto.", 400);

  const paciente = await prisma.eduPatient.findFirst({
    where: { id: patientId, institutionId },
    select: { id: true },
  });
  if (!paciente) throw new EduPadronError("Ese paciente no existe o no es de tu instituto.", 404);

  // ── EL PLAN DE TRATAMIENTO del que sale, si sale de uno ─────────────
  // Se resuelve ANTES del título y de las partidas porque los dos pueden
  // salir de él: un presupuesto hecho desde un plan hereda su nombre y su
  // importe si no le mandan otros.
  let treatmentPlanId: string | null = null;
  let plan: { id: string; name: string; totalCents: number; caseId: string | null } | null = null;
  const rawPlan = eduCleanId(body?.treatmentPlanId);
  if (rawPlan) {
    plan = await prisma.eduTreatmentPlan.findFirst({
      where: { id: rawPlan, institutionId, patientId: paciente.id },
      select: { id: true, name: true, totalCents: true, caseId: true },
    });
    if (!plan) {
      throw new EduPadronError("Ese plan de tratamiento no existe o no es de este paciente.", 404);
    }
    treatmentPlanId = plan.id;
  }

  // ── EL CASO del que sale, si sale de uno ────────────────────────────
  // Se resuelve aquí arriba, junto al plan, porque desde la C·2 también
  // puede SEMBRAR la primera partida (ver abajo). El que manden gana; si no
  // mandan ninguno y hay plan, se hereda el del plan — perder ese enlace al
  // presupuestar desde un plan sería tirar un dato que ya se sabía.
  let caseId: string | null = plan?.caseId ?? null;
  let caso: { id: string; procedureId: string | null; procedureName: string | null; programName: string } | null =
    null;
  const rawCase = eduCleanId(body?.caseId);
  if (rawCase) {
    const c = await prisma.eduCase.findFirst({
      where: { id: rawCase, institutionId, patientId: paciente.id },
      select: {
        id: true,
        procedureId: true,
        procedure: { select: { name: true } },
        program: { select: { name: true } },
      },
    });
    if (!c) throw new EduPadronError("Ese caso no existe o no es de este paciente.", 404);
    caseId = c.id;
    caso = {
      id: c.id,
      procedureId: c.procedureId,
      procedureName: c.procedure?.name ?? null,
      programName: c.program.name,
    };
  }

  const title = eduQuoteParseTitulo(body?.title ?? plan?.name ?? caso?.procedureName ?? caso?.programName);
  const notes = eduOptionalText(body?.notes, EDU_QUOTE_NOTES_MAX) ?? null;

  // ═══════════════════════════════════════════════════════════════════
  // LA PRIMERA PARTIDA, CUANDO NO MANDAN NINGUNA.
  //
  // Sin partidas y con PLAN, se siembra una con el nombre del plan y su
  // importe (la C·2 lo dejó así). Sin plan y con CASO —el botón
  // «Presupuestar» de la pantalla del caso, que la ola siguiente añadió—
  // se siembra con el PROCEDIMIENTO PRINCIPAL del caso y su precio.
  //
  // 🔴 Y EL PRECIO SALE DE LA TARIFA DEL PACIENTE, aquí en el servidor,
  // con la MISMA función que usa la pantalla de caja
  // (`getEduTarifaDePaciente`). No se calcula a mano y no se le pide al
  // navegador: la regla (d) de la casa es que el precio tiene una sola
  // fuente, y un segundo sitio que lo resolviera sería un segundo sitio
  // donde equivocarse — o donde cobrar de menos.
  //
  // Si el caso no tiene procedimiento principal, o si ese procedimiento no
  // tiene precio en ninguna lista, se siembra con importe CERO y el nombre
  // que haya: caja lo corrige antes de presentarlo. Cero es visible;
  // inventarse un precio, no.
  //
  // Sin plan y sin caso, `eduQuoteParseItems` sigue exigiendo al menos una:
  // un presupuesto vacío no es un presupuesto.
  // ═══════════════════════════════════════════════════════════════════
  const sinPartidas = !Array.isArray(body?.items) || body.items.length === 0;
  let itemsCrudos: unknown = body?.items;
  if (sinPartidas && plan) {
    itemsCrudos = [{ name: plan.name, quantity: 1, unitPriceCents: plan.totalCents }];
  } else if (sinPartidas && caso) {
    let precio = 0;
    if (caso.procedureId) {
      const tarifa = await getEduTarifaDePaciente(ctx, paciente.id);
      precio = tarifa.prices.find((x) => x.procedureId === caso.procedureId)?.priceCents ?? 0;
    }
    itemsCrudos = [
      {
        procedureId: caso.procedureId ?? undefined,
        name: caso.procedureName ?? caso.programName,
        quantity: 1,
        unitPriceCents: precio,
      },
    ];
  }
  const items = eduQuoteParseItems(itemsCrudos);
  const discountPct = eduQuoteParsePct(body?.discountPct);
  const discountCentsRaw =
    body?.discountCents === undefined || body?.discountCents === null
      ? 0
      : Number.parseInt(String(body.discountCents), 10) || 0;
  const totales = eduQuoteTotales(items, discountPct, discountCentsRaw);

  // 🔴 OLA C·fin 2 · FECHA CIVIL EN LA ZONA DEL INSTITUTO. Ver el bloque
  // de la vigencia en presupuestos-core.ts: `new Date("2026-09-08")` es
  // medianoche UTC, o sea las 18:00 del 7 en México.
  let validUntil: Date | null = null;
  if (body?.validUntil) {
    validUntil = eduQuoteParseVigencia(body.validUntil, zonaDe(ctx));
    if (!validUntil) {
      throw new EduPadronError("La vigencia no se entiende: mándala como 2026-09-30.", 400);
    }
  }

  const createdByName = `${ctx.user.firstName} ${ctx.user.lastName}`.trim().slice(0, 160) || "—";

  // Tres intentos por el folio, como el cobro: si dos personas presupuestan
  // en el mismo segundo, el índice único rebota a la segunda y se
  // recalcula. Sin el reintento, el fallo sale delante del paciente.
  for (let intento = 0; intento < 3; intento++) {
    const folio = await nextEduQuoteFolio(institutionId);
    try {
      const creado = await prisma.$transaction(async (tx) => {
        const q = await tx.eduQuote.create({
          data: {
            institutionId,
            patientId: paciente.id,
            caseId,
            treatmentPlanId,
            folio,
            title,
            notes,
            validUntil,
            discountPct,
            subtotalCents: totales.subtotalCents,
            discountCents: totales.discountCents,
            totalCents: totales.totalCents,
            createdById: ctx.eduUserId,
            createdByName,
          },
          select: { id: true, folio: true },
        });
        await tx.eduQuoteItem.createMany({
          data: items.map((i) => ({ ...i, institutionId, quoteId: q.id })),
        });
        return q;
      });

      await eduAudit(ctx, {
        action: "create",
        entity: "quote",
        entityId: creado.id,
        patientId: paciente.id,
        after: {
          folio: creado.folio,
          title,
          totalCents: totales.totalCents,
          caseId,
          treatmentPlanId,
        },
        ...meta,
      });

      return { id: creado.id, folio: creado.folio, totalCents: totales.totalCents };
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "P2002" && intento < 2) continue;
      throw err;
    }
  }
  throw new EduPadronError("No se pudo asignar folio al presupuesto. Inténtalo otra vez.", 409);
}

/**
 * PRESENTA el presupuesto: le pone su token público y su vigencia.
 *
 * 🔴 EL TOKEN SE GENERA UNA VEZ Y NO SE REGENERA. Regenerarlo dejaría
 * muerto el enlace que el paciente ya tiene en su WhatsApp, y ése es
 * exactamente el enlace por el que va a aceptar.
 *
 * 🔴 32 BYTES DE `randomBytes`, no `Math.random()` ni un cuid. Este token
 * es lo ÚNICO que protege el presupuesto: al otro lado no hay sesión.
 */
export async function presentarEduQuote(
  ctx: EduQuoteContext,
  quoteId: string,
  body: { validUntil?: unknown } = {},
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ id: string; acceptToken: string; validUntil: string | null }> {
  const institutionId = requireInstitution(ctx);
  asegurarAlcanceDinero(ctx);

  const id = eduCleanId(quoteId);
  if (!id) throw new EduPadronError("Falta el presupuesto.", 400);

  const q = await prisma.eduQuote.findFirst({
    where: { id, institutionId },
    select: { id: true, patientId: true, status: true, acceptToken: true, validUntil: true },
  });
  if (!q) throw new EduPadronError("Ese presupuesto no existe o no es de tu instituto.", 404);

  const desde = q.status as EduQuoteStatus;
  if (!eduQuotePuedeTransicionar(desde, "PRESENTADO")) {
    throw new EduPadronError(`Un presupuesto ${desde} no se puede presentar.`, 409);
  }

  const acceptToken = q.acceptToken ?? randomBytes(32).toString("hex").slice(0, 64);
  // 🔴 OLA C·fin 2 · la vigencia es una FECHA CIVIL del instituto, y la de
  // por defecto también: ver presupuestos-core.ts.
  const tz = zonaDe(ctx);
  let validUntil = q.validUntil;
  if (body?.validUntil) {
    validUntil = eduQuoteParseVigencia(body.validUntil, tz);
    if (!validUntil) {
      throw new EduPadronError("La vigencia no se entiende: mándala como 2026-09-30.", 400);
    }
  } else if (!validUntil) {
    validUntil = eduQuoteVigenciaPorDefecto(now, tz);
  }

  const res = await prisma.eduQuote.updateMany({
    where: { id: q.id, institutionId, status: desde },
    data: { status: "PRESENTADO", acceptToken, presentedAt: now, validUntil },
  });
  if (res.count === 0) {
    throw new EduPadronError(
      "Alguien cambió ese presupuesto mientras lo mirabas. Actualiza la pantalla.",
      409,
    );
  }

  await eduAudit(ctx, {
    action: "update",
    entity: "quote",
    entityId: q.id,
    patientId: q.patientId,
    before: { status: desde },
    after: { status: "PRESENTADO", validUntil },
    ...meta,
  });

  return { id: q.id, acceptToken, validUntil: validUntil?.toISOString() ?? null };
}

/** Cambia el estado a mano (rechazar, cancelar, volver a borrador). */
export async function cambiarEstadoEduQuote(
  ctx: EduQuoteContext,
  quoteId: string,
  body: {
    status?: unknown;
    reason?: unknown;
    /**
     * Quién aceptó, cuando `status` es ACEPTADO. Lo teclea el mostrador —
     * es el nombre de la persona que dijo que sí, delante de la caja. Se
     * guarda dentro de `acceptedByName` junto a ante quién se aceptó.
     */
    acceptedByName?: unknown;
  },
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ id: string; status: EduQuoteStatus }> {
  const institutionId = requireInstitution(ctx);
  asegurarAlcanceDinero(ctx);

  const id = eduCleanId(quoteId);
  if (!id) throw new EduPadronError("Falta el presupuesto.", 400);
  const destino = eduQuoteParseStatus(body?.status);
  if (!destino) throw new EduPadronError("Ese estado de presupuesto no existe.", 400);

  const q = await prisma.eduQuote.findFirst({
    where: { id, institutionId },
    select: { id: true, patientId: true, status: true, validUntil: true },
  });
  if (!q) throw new EduPadronError("Ese presupuesto no existe o no es de tu instituto.", 404);

  const desde = q.status as EduQuoteStatus;
  if (!eduQuotePuedeTransicionar(desde, destino)) {
    throw new EduPadronError(
      `Un presupuesto ${desde} no puede pasar a ${destino}. Un aceptado no se des-acepta: se cancela el cobro que generó.`,
      409,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 OLA C·fin · UN VENCIDO NO SE ACEPTA EN EL MOSTRADOR, Y POR ESO
  // TAMPOCO SE COBRA.
  //
  // La liga pública sí lo frenaba (`eduQuoteMotivoParaNoAceptar`) y este
  // camino no: las dos puertas del MISMO documento aplicaban reglas
  // distintas, y la que no validaba es la que emite el cobro.
  //
  // 🔴 Y SE COMPRUEBA **AQUÍ**, NO AL CONVERTIR. `eduQuoteVencido`
  // devuelve `false` en cuanto el estado deja de ser PRESENTADO
  // (presupuestos-core.ts): aceptarlo BORRA la condición de vencido, así
  // que `convertirEduQuote` no puede preguntarlo aunque quiera. Cerrar la
  // aceptación cierra la conversión, que es lo que se quería. Y no se
  // mira la vigencia de un ACEPTADO a propósito: la aceptación ocurrió
  // dentro del plazo y el reloj deja de importar (un aceptado en marzo se
  // puede cobrar en abril; lo que no se puede es aceptar en abril el
  // papel que venció en marzo).
  // ═══════════════════════════════════════════════════════════════════
  if (destino === "ACEPTADO" && eduQuoteVencido({ status: desde, validUntil: q.validUntil }, now)) {
    throw new EduPadronError(
      "Ese presupuesto ya venció: no se puede aceptar ni convertir en cobro con precios caducados. Devuélvelo a borrador, actualiza la vigencia y vuelve a presentárselo al paciente.",
      409,
    );
  }

  const reason = eduOptionalText(body?.reason, 500) ?? null;
  if (destino === "CANCELADO" && !reason) {
    throw new EduPadronError("Cancelar un presupuesto pide un motivo.", 400);
  }

  const data: Prisma.EduQuoteUpdateManyMutationInput = { status: destino };
  if (destino === "RECHAZADO") data.rejectedAt = now;
  if (destino === "CANCELADO") {
    data.cancelledAt = now;
    data.cancelReason = reason;
  }
  // ═══════════════════════════════════════════════════════════════════
  // 🔴 OLA C·fin · «ACEPTAR EN EL MOSTRADOR» DEJA LA MISMA EVIDENCIA QUE
  // LA LIGA PÚBLICA.
  //
  // Hasta aquí esta rama no existía: `acceptedAt`, `acceptedByName`,
  // `acceptedHash`, `acceptedIp` y `acceptedUserAgent` quedaban NULL y
  // solo los escribía el camino público (`aceptarEduQuotePorToken`). El
  // resultado: el detalle no decía quién ni cuándo, el PDF salía SIN la
  // franja de aceptación —`getEduQuotePdfData` exige
  // `status === "ACEPTADO" && acceptedAt`, así que se veía idéntico a uno
  // que nadie ha contestado— y se convertía en cobro igual. El agujero
  // que este archivo dice cerrar se cerraba por la liga y se dejaba
  // abierto por el mostrador, que es por donde entra la mitad de los
  // casos.
  //
  // 🔴 EL HASH ES EL MISMO TEXTO CANÓNICO, con los importes dentro. Sin
  // él, dentro de un año no se puede contestar «¿aceptó ESTE total?» —y
  // media evidencia, para las dos puertas del mismo documento, es dos
  // reglas distintas sobre el mismo papel.
  //
  // ⚠️ LA IP Y EL NAVEGADOR SON LOS DE LA ESCUELA, no los del paciente, y
  // eso es lo correcto: aquí quien pulsa es el mostrador. Por eso el
  // nombre dice SIEMPRE ante quién se aceptó, y no se puede confundir con
  // una aceptación hecha por el paciente desde su teléfono.
  // ═══════════════════════════════════════════════════════════════════
  if (destino === "ACEPTADO") {
    const papel = await prisma.eduQuote.findFirst({
      where: { id: q.id, institutionId },
      select: {
        folio: true,
        title: true,
        totalCents: true,
        validUntil: true,
        items: {
          orderBy: { sortOrder: "asc" },
          select: { name: true, quantity: true, lineTotalCents: true },
        },
      },
    });
    if (!papel) throw new EduPadronError("Ese presupuesto ya no está.", 404);

    const ante = `${ctx.user.firstName} ${ctx.user.lastName}`.trim() || "el mostrador";
    // 🔴 OLA C·fin 2 · Y EL NOMBRE ES OBLIGATORIO, con el MISMO mínimo que
    // la pantalla (3 letras). Era opcional por la API y obligatorio por el
    // formulario: un `PATCH {"status":"ACEPTADO"}` a pelo registraba la
    // aceptación como «el paciente, en el mostrador ante <quien opera>» —
    // una evidencia que no dice quién dijo que sí. La liga pública ya
    // exigía exactamente esto (`aceptarEduQuotePorToken`); las dos puertas
    // del mismo papel no pueden pedir cosas distintas.
    const quien = eduOptionalText(body?.acceptedByName, 80);
    if (!quien || quien.trim().length < 3) {
      throw new EduPadronError(
        "Escribe el nombre completo de quien acepta el presupuesto: es la evidencia de quién dijo que sí.",
        400,
      );
    }
    data.acceptedAt = now;
    data.acceptedByName = `${quien.trim()}, en el mostrador ante ${ante}`.slice(0, 160);
    data.acceptedHash = createHash("sha256")
      .update(eduQuoteTextoCanonico({ ...papel, items: papel.items }))
      .digest("hex");
    data.acceptedIp = meta.ip ?? null;
    data.acceptedUserAgent = meta.userAgent?.slice(0, 300) ?? null;
  }
  if (destino === "BORRADOR") {
    // Vuelve a edición: se le quita la presentación, pero NO el token —
    // el paciente ya lo tiene y volverá a servir cuando se vuelva a
    // presentar.
    data.presentedAt = null;
  }

  const res = await prisma.eduQuote.updateMany({
    where: { id: q.id, institutionId, status: desde },
    data,
  });
  if (res.count === 0) {
    throw new EduPadronError(
      "Alguien cambió ese presupuesto mientras lo mirabas. Actualiza la pantalla.",
      409,
    );
  }

  await eduAudit(ctx, {
    action: "update",
    entity: "quote",
    entityId: q.id,
    patientId: q.patientId,
    before: { status: desde },
    after: {
      status: destino,
      motivo: reason,
      // Quién aceptó y con qué evidencia, para que la bitácora conteste lo
      // mismo que el PDF sin tener que abrir el presupuesto.
      aceptadoPor: destino === "ACEPTADO" ? data.acceptedByName : undefined,
      evidencia: destino === "ACEPTADO" ? data.acceptedHash : undefined,
    },
    ...meta,
  });

  return { id: q.id, status: destino };
}

// ═══════════════════════════════════════════════════════════════════════
// EL PDF
// ═══════════════════════════════════════════════════════════════════════

export interface EduQuotePdfData {
  institutionName: string;
  institutionCity: string | null;
  institutionPhone: string | null;
  institutionEmail: string | null;

  quoteId: string;
  folio: string;
  title: string;
  notes: string | null;

  patientName: string;
  patientFolio: string;

  createdByName: string;
  createdAtLabel: string;
  validUntilLabel: string | null;

  subtotalCents: number;
  discountCents: number;
  discountPctLabel: string | null;
  totalCents: number;

  items: {
    name: string;
    toothFdi: string | null;
    quantity: number;
    unitPriceCents: number;
    discountCents: number;
    lineTotalCents: number;
    phase: number | null;
    notes: string | null;
  }[];

  /** La franja ROJA de arriba: vencido, rechazado o cancelado. */
  avisoMalo: { titulo: string; detalle: string } | null;
  /** La franja VERDE: quién lo aceptó y cuándo. */
  aceptado: string | null;

  fileName: string;
}

/**
 * Los datos del PDF, con el permiso y el alcance ya aplicados.
 *
 * 🔴 UN BORRADOR NO SE IMPRIME. Es la misma puerta que la receta pone
 * sobre una PENDIENTE: un papel con importes que todavía se están
 * editando sale del control de la escuela y vuelve dentro de un mes con
 * un precio que ya no es. Se presenta primero (que es un clic) y de ahí
 * se imprime.
 */
export async function getEduQuotePdfData(
  ctx: EduQuoteContext,
  quoteId: string,
  timeZoneCrudo: string,
  now: Date = new Date(),
): Promise<EduQuotePdfData> {
  const institutionId = requireInstitution(ctx);
  asegurarAlcanceDinero(ctx);

  const id = eduCleanId(quoteId);
  const q = id
    ? await prisma.eduQuote.findFirst({
        where: { id, institutionId },
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          patient: { select: { firstName: true, lastName: true, folio: true } },
          institution: { select: { name: true, city: true, phone: true, email: true } },
        },
      })
    : null;
  if (!q) throw new EduPadronError("Ese presupuesto no existe o no es de tu instituto.", 404);

  if (q.status === "BORRADOR") {
    throw new EduPadronError(
      "Un presupuesto en borrador no se imprime: todavía se está editando y el papel saldría con un total que puede cambiar. Preséntalo y vuelve a intentarlo.",
      409,
    );
  }

  const timeZone = eduSafeTimeZone(timeZoneCrudo);
  const fmt = new Intl.DateTimeFormat("es-MX", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const estado = eduQuoteEstadoVisible(
    { status: q.status as EduQuoteStatus, validUntil: q.validUntil },
    now,
  );

  let avisoMalo: { titulo: string; detalle: string } | null = null;
  if (estado === "VENCIDO") {
    avisoMalo = {
      titulo: "PRESUPUESTO VENCIDO — los precios ya no están garantizados",
      detalle: `Su vigencia terminó el ${q.validUntil ? fmt.format(q.validUntil) : "—"}. Pide uno actualizado antes de agendar el tratamiento.`,
    };
  } else if (estado === "RECHAZADO") {
    avisoMalo = {
      titulo: "PRESUPUESTO RECHAZADO",
      detalle: "Este presupuesto no se aceptó. Se conserva porque la propuesta existió; no se cobra por él.",
    };
  } else if (estado === "CANCELADO") {
    avisoMalo = {
      titulo: "PRESUPUESTO CANCELADO POR LA CLÍNICA",
      detalle: q.cancelReason
        ? `Motivo: ${q.cancelReason}`
        : "La clínica lo retiró. No se cobra por él.",
    };
  }

  return {
    institutionName: q.institution.name,
    institutionCity: q.institution.city,
    institutionPhone: q.institution.phone,
    institutionEmail: q.institution.email,

    quoteId: q.id,
    folio: q.folio,
    title: q.title,
    notes: q.notes,

    patientName: q.patient ? eduPatientFullName(q.patient) : "—",
    patientFolio: q.patient?.folio ?? "—",

    createdByName: q.createdByName,
    createdAtLabel: fmt.format(q.createdAt),
    validUntilLabel: q.validUntil ? fmt.format(q.validUntil) : null,

    subtotalCents: q.subtotalCents,
    discountCents: q.discountCents,
    discountPctLabel: q.discountPct === null ? null : `${Number(q.discountPct)} %`,
    totalCents: q.totalCents,

    items: [...q.items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({
        name: i.name,
        toothFdi: i.toothFdi,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
        discountCents: i.discountCents,
        lineTotalCents: i.lineTotalCents,
        phase: i.phase,
        notes: i.notes,
      })),

    avisoMalo,
    aceptado:
      q.status === "ACEPTADO" && q.acceptedAt
        ? `Lo aceptó ${q.acceptedByName ?? "el paciente"} el ${fmt.format(q.acceptedAt)}.${q.acceptedHash ? ` Evidencia sha256 ${q.acceptedHash.slice(0, 12)}…` : ""}`
        : null,

    fileName: `presupuesto-${q.folio}.pdf`,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 🔴 CONVERTIR UN PRESUPUESTO ACEPTADO EN COBRO (y, si se pide, EN PLAN)
//
// Lo que hace que esto sea difícil no es crear el cobro: es que se pueda
// pulsar dos veces. Por eso la llave de idempotencia NO es una clave que
// mande el cliente sino la COLUMNA `EduQuote.chargeId`: si está llena, ya
// se convirtió, y la segunda llamada devuelve el cobro que ya existe en
// vez de emitir otro. Un presupuesto de $18,000 convertido dos veces son
// dos cobros que hay que cancelar delante del paciente.
//
// 🔴 Y LOS PRECIOS VAN CONGELADOS, no se vuelven a cotizar. Si el
// paciente aceptó una resina a $800 en marzo y hoy el tarifario dice
// $1,200, el cobro tiene que decir $800: es lo que hay firmado, con su
// hash y su IP. Se pasa por `options.lineasCongeladas` de
// `createEduCharge` — un camino que solo existe para esto y que NUNCA
// sale del body de ninguna ruta (ver su comentario en caja.ts).
// ═══════════════════════════════════════════════════════════════════════

export interface EduQuoteConversion {
  chargeId: string;
  chargeFolio: string;
  /** El plan de pagos, si se pidió convertir a meses. */
  planId: string | null;
  /** true = ya estaba convertido y NO se emitió un segundo cobro. */
  duplicado: boolean;
}

export async function convertirEduQuote(
  ctx: EduQuoteContext,
  quoteId: string,
  body: {
    /** "cobro" (por defecto) o "plan" — a meses, sobre el mismo cobro. */
    modo?: unknown;
    /** Solo con modo "plan". Los valida `createEduPaymentPlan`. */
    months?: unknown;
    dueDay?: unknown;
    enganche?: unknown;
  } = {},
  options: { campusId?: string | null; timeZone?: string } = {},
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<EduQuoteConversion> {
  const institutionId = requireInstitution(ctx);
  asegurarAlcanceDinero(ctx);

  const id = eduCleanId(quoteId);
  if (!id) throw new EduPadronError("Falta el presupuesto.", 400);

  const q = await prisma.eduQuote.findFirst({
    where: { id, institutionId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!q) throw new EduPadronError("Ese presupuesto no existe o no es de tu instituto.", 404);

  // 🔴 SOLO UN ACEPTADO SE CONVIERTE. Cobrar un presupuesto que el
  // paciente no aceptó es cobrarle algo que no dijo que sí — y un
  // borrador se sigue editando, así que su total no significa nada
  // todavía.
  if (q.status !== "ACEPTADO") {
    throw new EduPadronError(
      `Un presupuesto ${q.status} no se cobra: solo se convierte uno ACEPTADO. Preséntaselo al paciente y espera su aceptación (o acéptalo a mano desde aquí si te lo dijo en el mostrador).`,
      409,
    );
  }
  if (q.totalCents <= 0) {
    throw new EduPadronError("Ese presupuesto suma cero: no hay nada que cobrar.", 409);
  }
  // ⚠️ LOS DOS TOPES NO SON EL MISMO, y el aviso va ANTES de emitir nada.
  // Un presupuesto admite 60 partidas y un cobro 50 conceptos
  // (`EDU_MAX_CHARGE_ITEMS`): sin esta comprobación, un presupuesto de 55
  // renglones se dejaría armar, presentar y aceptar, y reventaría al
  // convertirlo —con el paciente delante y el papel ya firmado— con un
  // mensaje que habla de conceptos y no de partidas. Los topes se dejan
  // como están (son de dos olas distintas y cambiarlos es decisión de
  // producto); lo que se arregla aquí es enterarse a tiempo.
  if (q.items.length > EDU_MAX_CHARGE_ITEMS) {
    throw new EduPadronError(
      `Ese presupuesto tiene ${q.items.length} partidas y un cobro admite ${EDU_MAX_CHARGE_ITEMS} conceptos. Pártelo en dos presupuestos y convierte cada uno.`,
      409,
    );
  }

  const modo = String(body?.modo ?? "cobro").toLowerCase() === "plan" ? "plan" : "cobro";

  // ── LA IDEMPOTENCIA, ANTES DE TOCAR NADA ────────────────────────────
  let chargeId = q.chargeId;
  let chargeFolio = "";
  let duplicado = false;
  if (chargeId) {
    const previo = await prisma.eduCharge.findFirst({
      where: { id: chargeId, institutionId },
      select: { id: true, folio: true },
    });
    if (previo) {
      chargeFolio = previo.folio;
      duplicado = true;
    } else {
      // La columna apunta a un cobro que ya no está (se borró la fila a
      // mano, o el SetNull de una cascada). No se finge que sigue: se
      // vuelve a convertir, que es lo que la escuela necesita.
      chargeId = null;
    }
  }

  if (!chargeId) {
    // 🔴 EL DESCUENTO GLOBAL SE REPARTE ENTRE LAS PARTIDAS. `EduCharge` no
    // tiene un descuento de cabecera: el suyo es la SUMA de los descuentos
    // de sus líneas (el invariante `subtotal − descuento == total` lo fija
    // una prueba). Se reparte proporcionalmente y el ÚLTIMO renglón se
    // lleva el resto de la división, para que el total del cobro sea el
    // total del presupuesto AL CENTAVO y no "casi".
    const lineas = eduQuoteRepartirDescuento(
      q.items.map((i) => ({
        procedureId: i.procedureId,
        // El nombre va con sus dientes: es lo que el paciente leyó.
        description: (i.toothFdi ? `${i.name} (dientes ${i.toothFdi})` : i.name).slice(0, 160),
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
        discountCents: i.discountCents,
        clientPriceCents: null,
      })),
      q.discountCents,
    );

    const cobro = await createEduCharge(
      ctx,
      {
        patientId: q.patientId,
        caseId: q.caseId ?? undefined,
        notes: `Presupuesto ${q.folio} · ${q.title}`.slice(0, 500),
        // Sin `items`: las líneas van por `lineasCongeladas`.
        items: [],
        // 🔴 OLA C·fin · LA CLAVE DE IDEMPOTENCIA, que faltaba.
        //
        // El sello de `chargeId` va DESPUÉS de emitir (veinte líneas más
        // abajo), así que dos clics simultáneos emitían los dos su cobro
        // con su folio y el segundo recibía un 409 que decía "cancélalo en
        // Caja" — con el paciente delante. `createEduCharge` ya sabe
        // hacerlo bien: el índice único (institutionId, idempotencyKey) de
        // sql/edu-cierre.sql convierte esa carrera en un P2002 que se
        // traduce en "toma el cobro que ganó", y el segundo cobro nunca
        // llega a existir.
        //
        // La clave se DERIVA del presupuesto y no la manda el cliente
        // porque la regla es "un presupuesto, un cobro": es la misma llave
        // que la columna `chargeId`, aplicada un instante antes.
        //
        // 🔴 OLA C·fin 2 · Y YA NO VIAJA POR AQUÍ. `presupuesto-<id>` cabía
        // de sobra en lo que `parseIdempotencyKey` acepta del cliente, y el
        // id del presupuesto está en la URL: quien tuviera `caja.charge`
        // podía crear ANTES un cobro manual con esa misma clave, y la
        // conversión le devolvía ESE cobro como duplicado y le sellaba
        // `chargeId` contra él — un presupuesto convertido en algo que no
        // son sus partidas. La clave la deriva ahora `createEduCharge` de
        // `options.quoteId` (caja.ts), con una forma que el parser del
        // cliente rechaza, así que no hay manera de tecleársela.
      },
      {
        campusId: options.campusId ?? null,
        lineasCongeladas: lineas,
        quoteId: q.id,
        feeScheduleLabel: `Presupuesto ${q.folio}`.slice(0, 80),
      },
      now,
    );
    chargeId = cobro.id;
    chargeFolio = cobro.folio;

    // 🔴 Y SE SELLA LA COLUMNA, con `chargeId: null` en el `where`: si dos
    // clics llegaron a la vez, el segundo escribe CERO filas y su cobro
    // queda huérfano — que es visible y arreglable— en vez de pisar la
    // llave de idempotencia del primero y dejar los DOS cobros vivos sin
    // que nadie lo note.
    const sellado = await prisma.eduQuote.updateMany({
      where: { id: q.id, institutionId, chargeId: null },
      data: { chargeId },
    });
    if (sellado.count === 0) {
      const ganador = await prisma.eduQuote.findFirst({
        where: { id: q.id, institutionId },
        select: { chargeId: true, charge: { select: { folio: true } } },
      });
      throw new EduPadronError(
        `Ese presupuesto se convirtió en el cobro ${ganador?.charge?.folio ?? "—"} mientras lo hacías, así que este segundo cobro (${cobro.folio}) sobra: cancélalo en Caja.`,
        409,
      );
    }

    await eduAudit(ctx, {
      action: "update",
      entity: "quote",
      entityId: q.id,
      patientId: q.patientId,
      before: { chargeId: null },
      after: { chargeId, chargeFolio, totalCents: q.totalCents },
      ...meta,
    });
  }

  let planId: string | null = null;
  if (modo === "plan") {
    // El plan cuelga del COBRO, no del presupuesto: es el mismo camino
    // que "Pagos a meses" de Caja, con su enganche, sus fechas en la zona
    // del instituto y su candado de "un solo plan activo". Aquí no se
    // duplica ni una línea de esa lógica.
    const activo = await prisma.eduPaymentPlan.findFirst({
      where: { institutionId, chargeId, status: "ACTIVO" },
      select: { id: true },
    });
    if (activo) {
      planId = activo.id;
    } else {
      const plan = await createEduPaymentPlan(
        ctx,
        chargeId,
        { months: body?.months, dueDay: body?.dueDay, enganche: body?.enganche },
        // La zona del INSTITUTO: sin ella las fechas del calendario se
        // calcularían en UTC y "cada día 28" podría salir el 27.
        { timeZone: options.timeZone ?? "America/Mexico_City" },
        now,
      );
      planId = plan.id;
    }
  }

  return { chargeId, chargeFolio, planId, duplicado };
}

/**
 * Reparte el descuento GLOBAL del presupuesto entre sus partidas.
 *
 * 🔴 POR QUÉ HAY QUE REPARTIRLO. `EduQuote` tiene UN descuento de
 * cabecera; `EduCharge` no: el suyo es la SUMA de los descuentos de sus
 * líneas, y hay una prueba que fija el invariante
 * `subtotal − descuento == total`. Así que al convertir hay que bajar el
 * descuento a las partidas, y la suma tiene que dar EXACTAMENTE el mismo
 * total que el papel que el paciente firmó. Un centavo de diferencia en
 * un presupuesto aceptado es una discusión en el mostrador.
 *
 * 🔴 CÓMO SE REPARTE, y por qué no es una regla de tres a secas:
 *
 *   1. A cada partida le toca la parte ENTERA de su proporción
 *      (`floor`), calculada con enteros — nada de flotantes en dinero.
 *   2. Lo que sobra por los redondeos (siempre menos de un centavo por
 *      partida) se reparte de a UN centavo, empezando por la partida
 *      cuyo resto quedó más grande. Con empate manda el orden de la
 *      lista, para que dos ejecuciones den lo mismo.
 *   3. ⚠️ Y SALTANDO LAS PARTIDAS QUE YA NO TIENEN SITIO. Una partida no
 *      puede acabar con más descuento que su importe: sin este salto,
 *      tres partidas de $0.07, $0.01 y $0.01 con $0.05 de descuento
 *      global dejaban un centavo sin repartir y el cobro salía un centavo
 *      por encima del presupuesto. Es un caso ridículo y es exactamente
 *      la clase de caso que un día aparece en una conciliación.
 *
 * El reparto en aggregate SIEMPRE cabe: `reparto = min(global, Σbrutos)`,
 * así que el bucle termina con cero centavos sueltos.
 */
export function eduQuoteRepartirDescuento(
  lineas: {
    procedureId: string | null;
    description: string;
    quantity: number;
    unitPriceCents: number;
    discountCents: number;
    clientPriceCents: number | null;
  }[],
  descuentoGlobalCents: number,
): typeof lineas {
  const global = Math.max(0, Math.trunc(descuentoGlobalCents));
  if (global === 0 || lineas.length === 0) return lineas;

  // Lo que a cada partida le queda por descontar: su importe menos el
  // descuento de línea que ya trae.
  const bruto = lineas.map((l) =>
    Math.max(0, l.quantity * l.unitPriceCents - l.discountCents),
  );
  const total = bruto.reduce((a, b) => a + b, 0);
  if (total <= 0) return lineas;

  const reparto = Math.min(global, total);

  // 1 · la parte entera, y el resto de cada división (en enteros).
  const parte = bruto.map((b) => Math.floor((reparto * b) / total));
  const resto = bruto.map((b) => (reparto * b) % total);
  let sobrante = reparto - parte.reduce((a, b) => a + b, 0);

  // 2 · el sobrante, de a un centavo, por resto descendente.
  const orden = bruto
    .map((_, i) => i)
    .sort((a, b) => resto[b] - resto[a] || a - b);
  // 3 · con vueltas: una partida puede llenarse y hay que seguir con la
  //     siguiente. Como el reparto cabe en la suma, esto termina.
  while (sobrante > 0) {
    let repartidoEnLaVuelta = 0;
    for (const i of orden) {
      if (sobrante === 0) break;
      if (parte[i] >= bruto[i]) continue;
      parte[i] += 1;
      sobrante -= 1;
      repartidoEnLaVuelta += 1;
    }
    // Red de seguridad: si una vuelta no reparte nada, no hay sitio en
    // ninguna partida y seguir sería un bucle infinito. No puede pasar
    // (ver arriba), y por eso mismo se corta en vez de confiar.
    if (repartidoEnLaVuelta === 0) break;
  }

  return lineas.map((l, i) => ({ ...l, discountCents: l.discountCents + parte[i] }));
}

// ═══════════════════════════════════════════════════════════════════════
// LA PUERTA PÚBLICA
// ═══════════════════════════════════════════════════════════════════════

/**
 * LEE un presupuesto por su token, SIN sesión. Para la página pública.
 *
 * 🔴 DEVUELVE SOLO LO QUE EL PACIENTE TIENE QUE VER. Ni el `patientId`, ni
 * el `caseId`, ni quién lo hizo, ni el instituto: una URL con token que se
 * comparte por WhatsApp acaba en más manos de las previstas, y lo que sale
 * por aquí es lo que sale del control de la escuela.
 */
export async function getEduQuotePorToken(
  token: string,
  now: Date = new Date(),
): Promise<{
  folio: string;
  title: string;
  estadoVisible: EduQuoteEstadoVisible;
  validUntil: string | null;
  /** El DÍA de la vigencia en la zona del INSTITUTO, que es el que se pinta. */
  validUntilDia: string | null;
  totalCents: number;
  subtotalCents: number;
  discountCents: number;
  items: { name: string; quantity: number; lineTotalCents: number; phase: number | null }[];
  bloqueo: string | null;
} | null> {
  const t = typeof token === "string" ? token.trim() : "";
  if (!t || t.length < 16 || t.length > 64 || !/^[a-f0-9]+$/.test(t)) return null;

  const q = await prisma.eduQuote.findFirst({
    where: { acceptToken: t },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      // 🔴 SOLO LA ZONA, no el instituto. Aquí no hay sesión y lo que sale
      // por esta puerta acaba en un WhatsApp reenviado: la zona hace falta
      // para rotular el día de la vigencia y no dice nada de la escuela.
      institution: { select: { timezone: true } },
    },
  });
  if (!q) return null;

  // 🔴 S-6 · LA LIGA CADUCA Y SE INVALIDA. Un presupuesto cancelado,
  // rechazado, vencido o ya convertido en cobro devuelve exactamente lo
  // mismo que un token inventado: `null`, que arriba es 404. Antes seguía
  // entregando folio, título, partidas e importes y solo cambiaba el texto
  // de la pantalla. La regla vive en el core, la usan las dos puertas
  // públicas, y el 404 no distingue "no existe" de "ya no vale" — decirlo
  // confirmaría que el token es real ante quien recibió la liga reenviada.
  if (!eduQuoteLigaVigente({ ...q, status: q.status as EduQuoteStatus }, now)) return null;

  return {
    folio: q.folio,
    title: q.title,
    estadoVisible: eduQuoteEstadoVisible(
      { status: q.status as EduQuoteStatus, validUntil: q.validUntil },
      now,
    ),
    validUntil: q.validUntil?.toISOString() ?? null,
    validUntilDia: eduQuoteVigenciaDiaISO(q.validUntil, eduSafeTimeZone(q.institution?.timezone)),
    totalCents: q.totalCents,
    subtotalCents: q.subtotalCents,
    discountCents: q.discountCents,
    items: q.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      lineTotalCents: i.lineTotalCents,
      phase: i.phase,
    })),
    bloqueo: eduQuoteMotivoParaNoAceptar(
      { status: q.status as EduQuoteStatus, validUntil: q.validUntil },
      now,
    ),
  };
}

/**
 * ACEPTA por la liga pública, con evidencia.
 *
 * 🔴 EL `where` DEL `updateMany` LLEVA `status: "PRESENTADO"`, y ése es
 * todo el candado contra el doble clic desde un teléfono con mala señal:
 * la segunda petición escribe cero filas y contesta que ya estaba
 * aceptado, en vez de pisar la hora y la evidencia de la primera.
 *
 * 🔴 LA EVIDENCIA ES LA MISMA QUE LA DEL CONSENTIMIENTO: hash del texto
 * canónico que el paciente tenía delante (con los importes dentro), IP y
 * navegador. Sin el hash, dentro de un año no se puede contestar «¿aceptó
 * ESTE total?».
 */
export async function aceptarEduQuotePorToken(
  token: string,
  body: { nombre?: unknown },
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ folio: string; acceptedAt: string }> {
  const t = typeof token === "string" ? token.trim() : "";
  if (!t) throw new EduPadronError("Ese enlace no es válido.", 404);

  const q = await prisma.eduQuote.findFirst({
    where: { acceptToken: t },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!q) throw new EduPadronError("Ese enlace no es válido.", 404);

  // 🔴 S-6 · LA MISMA PUERTA QUE EL GET, y con el MISMO mensaje que un
  // token inexistente: si la liga ya no vale, aquí no se explica por qué.
  if (!eduQuoteLigaVigente({ ...q, status: q.status as EduQuoteStatus }, now)) {
    throw new EduPadronError("Ese enlace no es válido.", 404);
  }

  // Lo que sigue vivo del bloqueo escrito: el ÚNICO caso que la liga deja
  // pasar y no admite aceptación es un ACEPTADO todavía sin cobro, y ahí
  // la frase entera ("ya lo aceptaste, no hace falta otra vez") es la
  // respuesta correcta — el paciente tiene la liga en la mano y acaba de
  // usarla.
  const bloqueo = eduQuoteMotivoParaNoAceptar(
    { status: q.status as EduQuoteStatus, validUntil: q.validUntil },
    now,
  );
  if (bloqueo) throw new EduPadronError(bloqueo, 409);

  const nombre = typeof body?.nombre === "string" ? body.nombre.trim().slice(0, 160) : "";
  if (nombre.length < 3) {
    throw new EduPadronError("Escribe tu nombre completo para aceptar el presupuesto.", 400);
  }

  const texto = eduQuoteTextoCanonico({
    folio: q.folio,
    title: q.title,
    totalCents: q.totalCents,
    items: q.items,
    validUntil: q.validUntil,
  });
  const hash = createHash("sha256").update(texto).digest("hex");

  const res = await prisma.eduQuote.updateMany({
    where: { id: q.id, status: "PRESENTADO" },
    data: {
      status: "ACEPTADO",
      acceptedAt: now,
      acceptedByName: nombre,
      acceptedHash: hash,
      acceptedIp: meta.ip ?? null,
      acceptedUserAgent: meta.userAgent?.slice(0, 300) ?? null,
    },
  });
  if (res.count === 0) {
    throw new EduPadronError("Este presupuesto ya se había aceptado. No hace falta hacerlo otra vez.", 409);
  }

  return { folio: q.folio, acceptedAt: now.toISOString() };
}
