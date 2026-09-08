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
import { eduCleanId, eduOptionalText } from "@/lib/edu/agenda-core";
import {
  eduScopeIsEmpty,
  eduVisibility,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import {
  EDU_QUOTE_MAX_ROWS,
  EDU_QUOTE_NOTES_MAX,
  eduQuoteEstadoVisible,
  eduQuoteMotivoParaNoAceptar,
  eduQuoteParseItems,
  eduQuoteParsePct,
  eduQuoteParseStatus,
  eduQuoteParseTitulo,
  eduQuotePuedeTransicionar,
  eduQuoteTextoCanonico,
  eduQuoteTotales,
  eduQuoteVigenciaPorDefecto,
  type EduQuoteEstadoVisible,
  type EduQuoteStatus,
} from "@/lib/edu/presupuestos-core";
import { eduAudit, type EduAuditActor } from "@/lib/edu/auditoria";

export interface EduQuoteContext extends EduClinicaContext, EduAuditActor {}

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

export interface EduQuoteRow {
  id: string;
  folio: string;
  title: string;
  status: EduQuoteStatus;
  estadoVisible: EduQuoteEstadoVisible;
  patientId: string;
  caseId: string | null;
  validUntil: string | null;
  subtotalCents: number;
  discountPct: number | null;
  discountCents: number;
  totalCents: number;
  notes: string | null;
  presentedAt: string | null;
  acceptedAt: string | null;
  acceptedByName: string | null;
  chargeId: string | null;
  treatmentPlanId: string | null;
  createdByName: string;
  createdAt: string;
  items: {
    id: string;
    name: string;
    toothFdi: string | null;
    quantity: number;
    unitPriceCents: number;
    discountCents: number;
    lineTotalCents: number;
    phase: number | null;
    notes: string | null;
  }[];
}

type QuoteConItems = Prisma.EduQuoteGetPayload<{ include: { items: true } }>;

function aRow(q: QuoteConItems, now: Date): EduQuoteRow {
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
    caseId: q.caseId,
    validUntil: q.validUntil?.toISOString() ?? null,
    subtotalCents: q.subtotalCents,
    discountPct: q.discountPct === null ? null : Number(q.discountPct),
    discountCents: q.discountCents,
    totalCents: q.totalCents,
    notes: q.notes,
    presentedAt: q.presentedAt?.toISOString() ?? null,
    acceptedAt: q.acceptedAt?.toISOString() ?? null,
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
    include: { items: true },
  });
  return filas.map((q) => aRow(q, now));
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

  const title = eduQuoteParseTitulo(body?.title);
  const notes = eduOptionalText(body?.notes, EDU_QUOTE_NOTES_MAX) ?? null;
  const items = eduQuoteParseItems(body?.items);
  const discountPct = eduQuoteParsePct(body?.discountPct);
  const discountCentsRaw =
    body?.discountCents === undefined || body?.discountCents === null
      ? 0
      : Number.parseInt(String(body.discountCents), 10) || 0;
  const totales = eduQuoteTotales(items, discountPct, discountCentsRaw);

  let validUntil: Date | null = null;
  if (body?.validUntil) {
    const d = new Date(String(body.validUntil));
    if (Number.isNaN(d.getTime())) throw new EduPadronError("La vigencia no se entiende.", 400);
    validUntil = d;
  }

  let caseId: string | null = null;
  const rawCase = eduCleanId(body?.caseId);
  if (rawCase) {
    const caso = await prisma.eduCase.findFirst({
      where: { id: rawCase, institutionId, patientId: paciente.id },
      select: { id: true },
    });
    if (!caso) throw new EduPadronError("Ese caso no existe o no es de este paciente.", 404);
    caseId = caso.id;
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
        after: { folio: creado.folio, title, totalCents: totales.totalCents },
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
  let validUntil = q.validUntil;
  if (body?.validUntil) {
    const d = new Date(String(body.validUntil));
    if (Number.isNaN(d.getTime())) throw new EduPadronError("La vigencia no se entiende.", 400);
    validUntil = d;
  } else if (!validUntil) {
    validUntil = eduQuoteVigenciaPorDefecto(now);
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
  body: { status?: unknown; reason?: unknown },
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
    select: { id: true, patientId: true, status: true },
  });
  if (!q) throw new EduPadronError("Ese presupuesto no existe o no es de tu instituto.", 404);

  const desde = q.status as EduQuoteStatus;
  if (!eduQuotePuedeTransicionar(desde, destino)) {
    throw new EduPadronError(
      `Un presupuesto ${desde} no puede pasar a ${destino}. Un aceptado no se des-acepta: se cancela el cobro que generó.`,
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
    after: { status: destino, motivo: reason },
    ...meta,
  });

  return { id: q.id, status: destino };
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
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!q) return null;

  return {
    folio: q.folio,
    title: q.title,
    estadoVisible: eduQuoteEstadoVisible(
      { status: q.status as EduQuoteStatus, validUntil: q.validUntil },
      now,
    ),
    validUntil: q.validUntil?.toISOString() ?? null,
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
