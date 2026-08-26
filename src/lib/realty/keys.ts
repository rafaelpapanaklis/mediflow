// ═══════════════════════════════════════════════════════════════════════
// LLAVES — quién trae la llave de qué inmueble, desde cuándo y con qué nota.
//
// El dolor real: en una inmobiliaria con 40 propiedades, "¿quién tiene las
// llaves de la de Providencia?" se contesta hoy en un grupo de WhatsApp, y
// se pierde. RealtyKey es append-only por préstamo: cada entrega es una
// fila, y devolverla es escribir `returnedAt`. Nunca se borra una fila —
// el historial de quién la trajo es el valor.
//
// Mismas reglas duras que visitas.ts:
//  · accountId SIEMPRE del contexto, con guarda anti-undefined.
//  · Recorte por oficina vía el inmueble, CON el OR de los nulos.
//  · Escrituras por updateMany con accountId dentro del where.
//
// ⚠️ RealtyKey NO tiene `updatedAt` (solo `createdAt`). No se le puede
// escribir ese campo aunque el resto de los modelos del vertical lo tengan.
// ═══════════════════════════════════════════════════════════════════════
import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { RealtyContext } from "@/lib/realty-auth";
import { getAccessibleOfficeIds } from "@/lib/realty-auth";
import {
  daysBetween,
  REALTY_KEY_OVERDUE_DAYS,
  type RealtyKeyCardDTO,
} from "@/components/realty/visits/visit-core";

export type RealtyKeyErrorCode = "NOT_FOUND" | "INVALID" | "ALREADY_RETURNED";

export class RealtyKeyError extends Error {
  readonly code: RealtyKeyErrorCode;
  constructor(code: RealtyKeyErrorCode, message: string) {
    super(message);
    this.name = "RealtyKeyError";
    this.code = code;
  }
}

export function keyErrorStatus(code: RealtyKeyErrorCode): number {
  if (code === "NOT_FOUND") return 404;
  if (code === "ALREADY_RETURNED") return 409;
  return 400;
}

function assertRealtyAccountId(accountId: string): string {
  if (!accountId || typeof accountId !== "string") {
    throw new Error("realty/keys: accountId ausente — la consulta habría cruzado cuentas");
  }
  return accountId;
}

/**
 * El where base de las llaves.
 *
 * A diferencia de las visitas, aquí NO se recorta por asesor: el tablero de
 * llaves fuera solo sirve si se ven TODAS. Su gracia es precisamente
 * contestar "quién la trae", y un asesor que solo viera las suyas seguiría
 * preguntando en el grupo de WhatsApp. El permiso `keys.manage` es la
 * puerta; el alcance es la cuenta y sus oficinas.
 */
async function keyScopeWhere(ctx: RealtyContext): Promise<Prisma.RealtyKeyWhereInput> {
  assertRealtyAccountId(ctx.accountId);
  const officeIds = await getAccessibleOfficeIds(ctx);
  return {
    accountId: ctx.accountId,
    property: { OR: [{ officeId: { in: officeIds } }, { officeId: null }] },
  };
}

const KEY_SELECT = {
  id: true,
  propertyId: true,
  holderUserId: true,
  holderNote: true,
  takenAt: true,
  returnedAt: true,
  property: { select: { title: true } },
  holder: { select: { firstName: true, lastName: true } },
} satisfies Prisma.RealtyKeySelect;

type KeyRow = Prisma.RealtyKeyGetPayload<{ select: typeof KEY_SELECT }>;

function toKeyCard(row: KeyRow, now: Date): RealtyKeyCardDTO {
  // Los días se calculan EN EL SERVIDOR: el reloj del navegador puede estar
  // corrido y "18 días fuera" es un dato que la gente usa para reclamar.
  const until = row.returnedAt ?? now;
  const daysOut = daysBetween(row.takenAt, until);
  const holderName = row.holder
    ? `${row.holder.firstName ?? ""} ${row.holder.lastName ?? ""}`.trim() || null
    : null;
  return {
    id: row.id,
    propertyId: row.propertyId,
    propertyTitle: row.property?.title ?? "—",
    holderUserId: row.holderUserId,
    holderName,
    holderNote: row.holderNote,
    takenAt: row.takenAt.toISOString(),
    returnedAt: row.returnedAt ? row.returnedAt.toISOString() : null,
    daysOut,
    overdue: row.returnedAt === null && daysOut >= REALTY_KEY_OVERDUE_DAYS,
  };
}

export interface RealtyKeysBoard {
  /** Las que siguen fuera, la más vieja primero: ésa es la que urge. */
  out: RealtyKeyCardDTO[];
  /** Últimas devoluciones, para el historial. */
  recentlyReturned: RealtyKeyCardDTO[];
  overdueCount: number;
  overdueDays: number;
}

/**
 * El tablero de llaves.
 *
 * Orden de "fuera": takenAt ascendente. La que lleva más tiempo va arriba,
 * que es justo la pregunta ("¿cuál llevo perdida más tiempo?") y no
 * "¿cuál presté al último?".
 */
export async function getKeysBoard(ctx: RealtyContext): Promise<RealtyKeysBoard> {
  const scope = await keyScopeWhere(ctx);
  const now = new Date();

  const [outRows, returnedRows] = await Promise.all([
    prisma.realtyKey.findMany({
      where: { ...scope, returnedAt: null },
      select: KEY_SELECT,
      orderBy: { takenAt: "asc" },
      take: 300,
    }),
    prisma.realtyKey.findMany({
      where: { ...scope, returnedAt: { not: null } },
      select: KEY_SELECT,
      orderBy: { returnedAt: "desc" },
      take: 40,
    }),
  ]);

  const out = outRows.map((r) => toKeyCard(r, now));
  let overdueCount = 0;
  for (let i = 0; i < out.length; i++) if (out[i].overdue) overdueCount++;

  return {
    out,
    recentlyReturned: returnedRows.map((r) => toKeyCard(r, now)),
    overdueCount,
    overdueDays: REALTY_KEY_OVERDUE_DAYS,
  };
}

/** Los inmuebles de la cartera, para el selector de "entregar llave". */
export async function listKeyProperties(
  ctx: RealtyContext,
  search?: string | null,
): Promise<{ id: string; title: string; colonia: string | null; keysOut: number }[]> {
  assertRealtyAccountId(ctx.accountId);
  const officeIds = await getAccessibleOfficeIds(ctx);

  const where: Prisma.RealtyPropertyWhereInput = {
    accountId: ctx.accountId,
    OR: [{ officeId: { in: officeIds } }, { officeId: null }],
  };
  const term = cleanSearch(search);
  if (term) {
    // El OR de arriba es el de las oficinas; el del buscador va en AND
    // aparte o se fusionarían y el filtro de oficina dejaría de aplicar.
    where.AND = [
      {
        OR: [
          { title: { contains: term, mode: "insensitive" } },
          { colonia: { contains: term, mode: "insensitive" } },
          { address: { contains: term, mode: "insensitive" } },
        ],
      },
    ];
  }

  const rows = await prisma.realtyProperty.findMany({
    where,
    select: {
      id: true,
      title: true,
      colonia: true,
      _count: { select: { keys: { where: { returnedAt: null } } } },
    },
    orderBy: { title: "asc" },
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    colonia: r.colonia,
    keysOut: r._count?.keys ?? 0,
  }));
}

/**
 * Quita los comodines de LIKE.
 *
 * 🔴 Prisma NO escapa `%` ni `_` dentro de `contains`: van directos al LIKE
 * de Postgres. Sin esto, buscar "%" empareja con TODA la cartera.
 */
function cleanSearch(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export interface HandOverKeyInput {
  propertyId: string;
  /** Alguien del equipo. null si se le prestó a un tercero (ver holderNote). */
  holderUserId?: string | null;
  /** "Al velador", "al arquitecto de la obra"… */
  holderNote?: string | null;
}

/**
 * Entregar la llave. Cada entrega es una fila NUEVA.
 *
 * Se permite tener varias llaves fuera del mismo inmueble a propósito: hay
 * duplicados, y bloquear la segunda entrega obligaría a mentir ("devuelta")
 * para poder registrar la realidad. El tablero las enseña juntas y quien
 * mire sabe que hay dos afuera.
 */
export async function handOverKey(
  ctx: RealtyContext,
  input: HandOverKeyInput,
): Promise<string> {
  assertRealtyAccountId(ctx.accountId);

  const officeIds = await getAccessibleOfficeIds(ctx);
  const property = await prisma.realtyProperty.findFirst({
    where: {
      id: input.propertyId,
      accountId: ctx.accountId,
      OR: [{ officeId: { in: officeIds } }, { officeId: null }],
    },
    select: { id: true },
  });
  if (!property) throw new RealtyKeyError("INVALID", "Ese inmueble no está en tu cartera");

  let holderUserId: string | null = null;
  if (input.holderUserId) {
    // Misma trampa que en visitas: la FK es global, no compuesta. Sin este
    // check se pintaría el nombre de alguien de otra inmobiliaria.
    const holder = await prisma.realtyUser.findFirst({
      where: { id: input.holderUserId, accountId: ctx.accountId, active: true },
      select: { id: true },
    });
    if (!holder) throw new RealtyKeyError("INVALID", "Esa persona no está en tu equipo");
    holderUserId = holder.id;
  }

  const note = typeof input.holderNote === "string" ? input.holderNote.trim().slice(0, 300) : "";
  if (!holderUserId && !note) {
    throw new RealtyKeyError(
      "INVALID",
      "Di quién se la lleva: alguien del equipo o una nota de a quién se le prestó",
    );
  }

  const row = await prisma.realtyKey.create({
    data: {
      accountId: ctx.accountId,
      propertyId: property.id,
      holderUserId,
      holderNote: note || null,
      takenAt: new Date(),
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Devolver la llave.
 *
 * updateMany y no update: el accountId tiene que entrar al WHERE. Y el
 * `returnedAt: null` del where hace la operación idempotente-segura — dos
 * clics seguidos no reescriben la fecha de devolución con la del segundo
 * clic; el segundo devuelve count 0 y se responde "ya estaba devuelta".
 */
export async function returnKey(ctx: RealtyContext, keyId: string): Promise<RealtyKeyCardDTO> {
  assertRealtyAccountId(ctx.accountId);

  const scope = await keyScopeWhere(ctx);
  const existing = await prisma.realtyKey.findFirst({
    where: { ...scope, id: keyId },
    select: { id: true, returnedAt: true },
  });
  if (!existing) throw new RealtyKeyError("NOT_FOUND", "Esa llave no existe o no es de tu cuenta");
  if (existing.returnedAt) {
    throw new RealtyKeyError("ALREADY_RETURNED", "Esa llave ya estaba devuelta");
  }

  const res = await prisma.realtyKey.updateMany({
    where: { id: keyId, accountId: ctx.accountId, returnedAt: null },
    data: { returnedAt: new Date() },
  });
  if (res.count === 0) throw new RealtyKeyError("ALREADY_RETURNED", "Esa llave ya estaba devuelta");

  const fresh = await prisma.realtyKey.findFirst({
    where: { id: keyId, accountId: ctx.accountId },
    select: KEY_SELECT,
  });
  if (!fresh) throw new RealtyKeyError("NOT_FOUND", "Esa llave ya no existe");
  return toKeyCard(fresh, new Date());
}

/** Añade o corrige la nota de a quién se le prestó, sin cerrar el préstamo. */
export async function updateKeyNote(
  ctx: RealtyContext,
  keyId: string,
  note: string | null,
): Promise<RealtyKeyCardDTO> {
  assertRealtyAccountId(ctx.accountId);
  const scope = await keyScopeWhere(ctx);
  const existing = await prisma.realtyKey.findFirst({
    where: { ...scope, id: keyId },
    select: { id: true, holderUserId: true },
  });
  if (!existing) throw new RealtyKeyError("NOT_FOUND", "Esa llave no existe o no es de tu cuenta");

  const clean = typeof note === "string" ? note.trim().slice(0, 300) : "";
  if (!existing.holderUserId && !clean) {
    throw new RealtyKeyError(
      "INVALID",
      "Esta llave no la trae nadie del equipo: la nota no se puede dejar vacía",
    );
  }

  await prisma.realtyKey.updateMany({
    where: { id: keyId, accountId: ctx.accountId },
    data: { holderNote: clean || null },
  });

  const fresh = await prisma.realtyKey.findFirst({
    where: { id: keyId, accountId: ctx.accountId },
    select: KEY_SELECT,
  });
  if (!fresh) throw new RealtyKeyError("NOT_FOUND", "Esa llave ya no existe");
  return toKeyCard(fresh, new Date());
}

/** Cuántas llaves están fuera y cuántas ya se pasaron. Para el Inicio. */
export async function countKeysOut(
  ctx: RealtyContext,
): Promise<{ out: number; overdue: number }> {
  const scope = await keyScopeWhere(ctx);
  const cutoff = new Date(Date.now() - REALTY_KEY_OVERDUE_DAYS * 86_400_000);
  const [out, overdue] = await Promise.all([
    prisma.realtyKey.count({ where: { ...scope, returnedAt: null } }),
    prisma.realtyKey.count({ where: { ...scope, returnedAt: null, takenAt: { lte: cutoff } } }),
  ]);
  return { out, overdue };
}

export { REALTY_KEY_OVERDUE_DAYS };
