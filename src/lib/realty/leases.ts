// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES — RENTAS Y COBRANZA. Todo lo que habla con la base
// de datos del arrendamiento vive aquí. SERVER-ONLY.
//
// Las cuentas y el calendario son PUROS y viven aparte:
//   · src/lib/realty/rent-charges.ts → centavos, calendario, semáforo, avisos
//   · src/lib/realty/inpc.ts         → aumento anual y el tope de la CDMX
// Este archivo no re-implementa NADA de eso: lo consume.
//
// ── LAS TRES REGLAS QUE NO SE ROMPEN ───────────────────────────────────
//
// 1. accountId SIEMPRE de la sesión (getRealtyContext), JAMÁS del body ni
//    del query. Y ojo Prisma: un `accountId: undefined` en un where BORRA
//    el filtro y devuelve las filas de TODAS las cuentas. Por eso todas las
//    funciones reciben el ctx entero y nunca un id suelto.
//
// 2. Antes de escribir una fila hija (un cargo, un pago, un inventario) se
//    comprueba que el PADRE es de esta cuenta. Las FK del vertical son de
//    una sola columna: la base NO impide una fila con accountId = A y
//    leaseId de B. La reja es este código.
//
// 3. Dinero en CENTAVOS enteros para calcular y en Decimal para guardar.
//    Nunca un float a media cuenta; el redondeo es del final.
//
// 🔴 SIN FACTURACIÓN. Se emite un RECIBO (RealtyPayment.receiptUrl). Ni
// CFDI, ni timbrado, ni complemento de pago, ni la palabra "factura".
// ═══════════════════════════════════════════════════════════════════════
import "server-only";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { mxTenDigits } from "@/lib/phone-mx";
import { isRealtySubscriptionActive } from "@/lib/realty/plan-shared";
import type { RealtyContext } from "@/lib/realty-auth";
import {
  REALTY_FILES_BUCKET,
  type RealtyChargeStatus,
  type RealtyCurrency,
  type RealtyDepositStatus,
  type RealtyExpenseKind,
  type RealtyIncreaseRule,
  type RealtyInventoryCheckKind,
  type RealtyLeasePartyRole,
  type RealtyLeaseStatus,
  type RealtyMaintenanceStatus,
  type RealtyPaymentMethod,
  type RealtyScreeningStatus,
} from "@/lib/realty/types";
import {
  MAX_GENERATED_CHARGES,
  accumulate,
  addMonthKey,
  agingBucket,
  buildChargeSchedule,
  buildNoticeMessage,
  centsToNumber,
  chargeBalance,
  daysBetween,
  emptyCollectionsTotals,
  expiryWindowFor,
  formatCents,
  formatReceiptFolio,
  folioFromReceiptUrl,
  monthKey,
  monthLabel,
  noticeChannelsFor,
  noticeKey,
  pickReminderStep,
  receiptUrlFor,
  sumCentsBy,
  toCalendarDate,
  toCents,
  todayInTimezone,
  type CollectionsTotals,
  type RealtyAgingKey,
  type RealtyRentNotice,
} from "@/lib/realty/rent-charges";
import {
  applyIncreaseToCents,
  buildIncreaseAckLine,
  isCdmxProperty,
  mergeNotesPreservingAcks,
  needsCapAck,
  parseIncreaseAcks,
  round2,
  suggestIncrease,
  type IncreaseAck,
  type IncreaseSuggestion,
} from "@/lib/realty/inpc";

// ── Error tipado del módulo (las APIs lo mapean a su status). ──────────

export class RealtyLeaseError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.name = "RealtyLeaseError";
    this.status = status;
    this.code = code;
  }
}

/** 404 uniforme: una fila de otra cuenta se ve igual que una que no existe. */
function notFound(what: string): RealtyLeaseError {
  return new RealtyLeaseError(`No encontramos ${what}.`, 404, "NOT_FOUND");
}

// ── Dinero: centavos ⇄ Decimal, sin pasar por un float ──────────────────

/**
 * Centavos enteros → Prisma.Decimal, armando el string a mano.
 * `cents / 100` es una división en punto flotante: para importes grandes
 * puede dar 123456789.98999999. El string es exacto siempre.
 */
export function centsToDecimal(cents: number): Prisma.Decimal {
  const n = Math.round(cents);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const pesos = Math.floor(abs / 100);
  const rest = abs % 100;
  return new Prisma.Decimal(`${sign}${pesos}.${rest < 10 ? "0" : ""}${rest}`);
}

/** Decimal de Prisma (o lo que sea) → centavos enteros. */
export const decimalToCents = toCents;

// ── Archivos: firma de rutas del bucket privado realty-files ───────────

/** Vigencia de las ligas firmadas de fotos. Cinco minutos, como barber. */
export const REALTY_SIGNED_URL_TTL = 300;

let cachedStorage: ReturnType<typeof createAdminClient> | null = null;
function storageAdmin() {
  if (cachedStorage) return cachedStorage;
  cachedStorage = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cachedStorage;
}

/**
 * Firma un lote de rutas en UN round-trip. Las que fallen quedan en "".
 * Una foto que no se pueda firmar NO puede tumbar la pantalla del
 * inventario: la evidencia que sí carga se sigue viendo.
 *
 * Tolera que en `photoUrls` haya ligas absolutas viejas (http…): esas se
 * devuelven tal cual sin pasar por el firmador.
 */
export async function signRealtyPaths(paths: string[]): Promise<string[]> {
  const out: string[] = new Array(paths.length).fill("");
  const toSign: { index: number; path: string }[] = [];
  paths.forEach((p, i) => {
    if (!p) return;
    if (/^https?:\/\//i.test(p) || p.startsWith("data:")) out[i] = p;
    else toSign.push({ index: i, path: p });
  });
  if (toSign.length === 0) return out;
  try {
    const { data, error } = await storageAdmin()
      .storage.from(REALTY_FILES_BUCKET)
      .createSignedUrls(
        toSign.map((t) => t.path),
        REALTY_SIGNED_URL_TTL,
      );
    if (error || !data) {
      console.warn("[realty/leases] no se pudieron firmar las fotos:", error?.message);
      return out;
    }
    data.forEach((row, i) => {
      if (!row.error && row.signedUrl) out[toSign[i].index] = row.signedUrl;
    });
  } catch (e) {
    console.warn("[realty/leases] excepción al firmar fotos:", (e as Error).message);
  }
  return out;
}

// ── Tipos que consumen las pantallas ───────────────────────────────────
// El contrato (types.ts) define los DTO base; estos son las VISTAS que las
// pantallas de rentas y cobranza necesitan y que nadie más usa.

export interface LeasePartyView {
  id: string;
  role: RealtyLeasePartyRole;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  screeningStatus: RealtyScreeningStatus | null;
}

export interface RentChargeView {
  id: string;
  leaseId: string;
  periodMonth: string;
  periodLabel: string;
  dueAt: string;
  amount: number;
  paid: number;
  balance: number;
  status: RealtyChargeStatus;
  daysLate: number;
  aging: RealtyAgingKey;
}

export interface PaymentView {
  id: string;
  chargeId: string | null;
  leaseId: string | null;
  amount: number;
  method: RealtyPaymentMethod;
  paidAt: string;
  reference: string | null;
  /** Folio del recibo YA emitido ("REC-000123"), o "" si no se ha emitido. */
  receiptFolio: string;
  receiptUrl: string | null;
  createdAt: string;
}

export interface DepositView {
  id: string;
  leaseId: string;
  amount: number;
  status: RealtyDepositStatus;
  resolvedAt: string | null;
  note: string | null;
}

export interface LeaseListRow {
  id: string;
  propertyId: string;
  propertyTitle: string;
  propertyCity: string | null;
  propertyState: string | null;
  tenantName: string;
  tenantPhone: string | null;
  startsAt: string;
  endsAt: string;
  rentAmount: number;
  currency: RealtyCurrency;
  paymentDay: number;
  depositAmount: number;
  increaseRule: RealtyIncreaseRule;
  increasePct: number | null;
  status: RealtyLeaseStatus;
  signedDocUrl: string | null;
  createdAt: string;
  /** Días que faltan para que venza. Negativo = ya venció. */
  daysToEnd: number;
  /** 30 | 60 | 90 si está por vencer; null si no. */
  expiryWindow: number | null;
  /** Saldo total pendiente del contrato, en pesos. */
  balance: number;
  /** Cargos con saldo y ya vencidos. */
  overdueCount: number;
  chargeCount: number;
  cdmx: boolean;
}

export interface LeaseDetail extends LeaseListRow {
  notes: string | null;
  parties: LeasePartyView[];
  charges: RentChargeView[];
  payments: PaymentView[];
  deposits: DepositView[];
  increaseAcks: IncreaseAck[];
  totals: CollectionsTotals;
}

export interface CollectionRow extends RentChargeView {
  propertyId: string;
  propertyTitle: string;
  tenantName: string;
  tenantPhone: string | null;
  currency: RealtyCurrency;
  leaseStatus: RealtyLeaseStatus;
}

export interface CollectionsBoard {
  periodMonth: string;
  periodLabel: string;
  today: string;
  rows: CollectionRow[];
  totals: CollectionsTotals;
  currency: RealtyCurrency;
  /** Cuántos avisos saldrían HOY con el calendario escalonado. */
  noticesToday: number;
  planHasWhatsapp: boolean;
}

// ── Selects reutilizados ───────────────────────────────────────────────

const PROPERTY_SELECT = {
  id: true,
  title: true,
  city: true,
  state: true,
} as const;

const PARTY_SELECT = {
  id: true,
  role: true,
  contactId: true,
  screeningStatus: true,
  contact: { select: { id: true, name: true, phone: true, email: true } },
} as const;

const CHARGE_SELECT = {
  id: true,
  leaseId: true,
  periodMonth: true,
  dueAt: true,
  amount: true,
  status: true,
  payments: { select: { id: true, amount: true } },
} as const;

const PAYMENT_SELECT = {
  id: true,
  chargeId: true,
  leaseId: true,
  amount: true,
  method: true,
  paidAt: true,
  reference: true,
  receiptUrl: true,
  createdAt: true,
} as const;

// ── Mapeadores ─────────────────────────────────────────────────────────

function mapParty(row: {
  id: string;
  role: RealtyLeasePartyRole;
  contactId: string;
  screeningStatus: RealtyScreeningStatus | null;
  contact: { name: string; phone: string | null; email: string | null } | null;
}): LeasePartyView {
  return {
    id: row.id,
    role: row.role,
    contactId: row.contactId,
    contactName: row.contact?.name ?? "Sin nombre",
    contactPhone: row.contact?.phone ?? null,
    contactEmail: row.contact?.email ?? null,
    screeningStatus: row.screeningStatus ?? null,
  };
}

function mapCharge(
  row: {
    id: string;
    leaseId: string;
    periodMonth: string;
    dueAt: Date;
    amount: Prisma.Decimal | number | string;
    status: RealtyChargeStatus;
    payments: { amount: Prisma.Decimal | number | string }[];
  },
  today: Date,
): RentChargeView {
  const paidCents = sumCentsBy(row.payments ?? [], (p) => p.amount);
  const bal = chargeBalance({
    amount: row.amount,
    paidCents,
    dueAt: row.dueAt,
    today,
  });
  return {
    id: row.id,
    leaseId: row.leaseId,
    periodMonth: row.periodMonth,
    periodLabel: monthLabel(row.periodMonth),
    dueAt: row.dueAt.toISOString(),
    amount: centsToNumber(bal.amountCents),
    paid: centsToNumber(bal.paidCents),
    balance: centsToNumber(bal.balanceCents),
    status: bal.status,
    daysLate: bal.daysLate,
    aging: agingBucket(bal.balanceCents, bal.daysLate),
  };
}

function mapPayment(row: {
  id: string;
  chargeId: string | null;
  leaseId: string | null;
  amount: Prisma.Decimal | number | string;
  method: RealtyPaymentMethod;
  paidAt: Date;
  reference: string | null;
  receiptUrl: string | null;
  createdAt: Date;
}): PaymentView {
  return {
    id: row.id,
    chargeId: row.chargeId,
    leaseId: row.leaseId,
    amount: centsToNumber(toCents(row.amount)),
    method: row.method,
    paidAt: row.paidAt.toISOString(),
    reference: row.reference,
    receiptFolio: folioFromReceiptUrl(row.receiptUrl),
    receiptUrl: row.receiptUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

/** El inquilino del contrato. AVAL y FIADOR no son a quien se le cobra. */
function tenantOf(parties: LeasePartyView[]): LeasePartyView | null {
  return parties.find((p) => p.role === "INQUILINO") ?? parties[0] ?? null;
}

// ── Lectura: lista de contratos ────────────────────────────────────────

export interface ListLeasesFilters {
  status?: RealtyLeaseStatus | "TODOS";
  propertyId?: string;
  /** Solo los que vencen dentro de N días (30 / 60 / 90). */
  expiringInDays?: number;
  /** Búsqueda por inmueble o inquilino. */
  q?: string;
  take?: number;
}

export async function listLeases(
  ctx: RealtyContext,
  filters: ListLeasesFilters = {},
): Promise<LeaseListRow[]> {
  const today = todayInTimezone(ctx.account.timezone);
  const where: Prisma.RealtyLeaseWhereInput = { accountId: ctx.accountId };

  if (filters.status && filters.status !== "TODOS") where.status = filters.status;
  if (filters.propertyId) where.propertyId = filters.propertyId;
  if (filters.expiringInDays && filters.expiringInDays > 0) {
    const limit = new Date(today.getTime());
    limit.setUTCDate(limit.getUTCDate() + filters.expiringInDays);
    where.endsAt = { gte: today, lte: limit };
    // Un borrador o un contrato ya terminado no "está por vencer".
    where.status = { in: ["ACTIVO", "VENCIDO"] };
  }
  const q = (filters.q ?? "").trim();
  if (q) {
    where.OR = [
      { property: { title: { contains: q, mode: "insensitive" } } },
      { parties: { some: { contact: { name: { contains: q, mode: "insensitive" } } } } },
    ];
  }

  const rows = await prisma.realtyLease.findMany({
    where,
    select: {
      id: true,
      propertyId: true,
      startsAt: true,
      endsAt: true,
      rentAmount: true,
      currency: true,
      paymentDay: true,
      depositAmount: true,
      increaseRule: true,
      increasePct: true,
      status: true,
      signedDocUrl: true,
      createdAt: true,
      property: { select: PROPERTY_SELECT },
      parties: { select: PARTY_SELECT },
      charges: { select: { id: true, dueAt: true, amount: true, payments: { select: { amount: true } } } },
    },
    orderBy: [{ status: "asc" }, { endsAt: "asc" }],
    take: Math.min(500, Math.max(1, filters.take ?? 200)),
  });

  return rows.map((lease) => {
    const parties = (lease.parties ?? []).map(mapParty);
    const tenant = tenantOf(parties);
    let balanceCents = 0;
    let overdueCount = 0;
    for (const ch of lease.charges ?? []) {
      const paidCents = sumCentsBy(ch.payments ?? [], (p) => p.amount);
      const bal = chargeBalance({ amount: ch.amount, paidCents, dueAt: ch.dueAt, today });
      balanceCents += bal.balanceCents;
      if (bal.balanceCents > 0 && bal.daysLate > 0) overdueCount += 1;
    }
    const endCal = toCalendarDate(lease.endsAt);
    return {
      id: lease.id,
      propertyId: lease.propertyId,
      propertyTitle: lease.property?.title ?? "Inmueble",
      propertyCity: lease.property?.city ?? null,
      propertyState: lease.property?.state ?? null,
      tenantName: tenant?.contactName ?? "Sin inquilino capturado",
      tenantPhone: tenant?.contactPhone ?? null,
      startsAt: lease.startsAt.toISOString(),
      endsAt: lease.endsAt.toISOString(),
      rentAmount: centsToNumber(toCents(lease.rentAmount)),
      currency: lease.currency,
      paymentDay: lease.paymentDay,
      depositAmount: centsToNumber(toCents(lease.depositAmount)),
      increaseRule: lease.increaseRule,
      increasePct: lease.increasePct === null ? null : Number(lease.increasePct),
      status: lease.status,
      signedDocUrl: lease.signedDocUrl,
      createdAt: lease.createdAt.toISOString(),
      daysToEnd: endCal ? daysBetween(today, endCal) : 0,
      expiryWindow: expiryWindowFor(lease.endsAt, today),
      balance: centsToNumber(balanceCents),
      overdueCount,
      chargeCount: (lease.charges ?? []).length,
      cdmx: isCdmxProperty({ city: lease.property?.city, state: lease.property?.state }),
    };
  });
}

// ── Lectura: un contrato completo ──────────────────────────────────────

export async function getLeaseDetail(
  ctx: RealtyContext,
  leaseId: string,
): Promise<LeaseDetail | null> {
  if (!leaseId) return null;
  const today = todayInTimezone(ctx.account.timezone);

  const lease = await prisma.realtyLease.findFirst({
    where: { id: leaseId, accountId: ctx.accountId },
    select: {
      id: true,
      propertyId: true,
      startsAt: true,
      endsAt: true,
      rentAmount: true,
      currency: true,
      paymentDay: true,
      depositAmount: true,
      increaseRule: true,
      increasePct: true,
      status: true,
      signedDocUrl: true,
      notes: true,
      createdAt: true,
      property: { select: PROPERTY_SELECT },
      parties: { select: PARTY_SELECT, orderBy: { createdAt: "asc" } },
      charges: { select: CHARGE_SELECT, orderBy: { dueAt: "asc" } },
      payments: { select: PAYMENT_SELECT, orderBy: { paidAt: "desc" } },
      deposits: { select: { id: true, leaseId: true, amount: true, status: true, resolvedAt: true, note: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!lease) return null;

  const parties = (lease.parties ?? []).map(mapParty);
  const tenant = tenantOf(parties);
  const charges = (lease.charges ?? []).map((c) => mapCharge(c, today));

  const totals = emptyCollectionsTotals();
  for (const c of charges) {
    accumulate(totals, {
      amountCents: toCents(c.amount),
      paidCents: toCents(c.paid),
      balanceCents: toCents(c.balance),
      daysLate: c.daysLate,
    });
  }

  const endCal = toCalendarDate(lease.endsAt);
  return {
    id: lease.id,
    propertyId: lease.propertyId,
    propertyTitle: lease.property?.title ?? "Inmueble",
    propertyCity: lease.property?.city ?? null,
    propertyState: lease.property?.state ?? null,
    tenantName: tenant?.contactName ?? "Sin inquilino capturado",
    tenantPhone: tenant?.contactPhone ?? null,
    startsAt: lease.startsAt.toISOString(),
    endsAt: lease.endsAt.toISOString(),
    rentAmount: centsToNumber(toCents(lease.rentAmount)),
    currency: lease.currency,
    paymentDay: lease.paymentDay,
    depositAmount: centsToNumber(toCents(lease.depositAmount)),
    increaseRule: lease.increaseRule,
    increasePct: lease.increasePct === null ? null : Number(lease.increasePct),
    status: lease.status,
    signedDocUrl: lease.signedDocUrl,
    createdAt: lease.createdAt.toISOString(),
    daysToEnd: endCal ? daysBetween(today, endCal) : 0,
    expiryWindow: expiryWindowFor(lease.endsAt, today),
    balance: centsToNumber(totals.balanceCents),
    overdueCount: totals.overdueCount,
    chargeCount: charges.length,
    cdmx: isCdmxProperty({ city: lease.property?.city, state: lease.property?.state }),
    // Las líneas marcadas del tope se enseñan aparte, no en el cuadro de
    // notas: ahí solo va lo que el usuario escribió.
    notes: stripAckForDisplay(lease.notes),
    parties,
    charges,
    payments: (lease.payments ?? []).map(mapPayment),
    deposits: (lease.deposits ?? []).map((d) => ({
      id: d.id,
      leaseId: d.leaseId,
      amount: centsToNumber(toCents(d.amount)),
      status: d.status,
      resolvedAt: d.resolvedAt ? d.resolvedAt.toISOString() : null,
      note: d.note,
    })),
    increaseAcks: parseIncreaseAcks(lease.notes),
    totals,
  };
}

function stripAckForDisplay(notes: string | null): string | null {
  const clean = mergeNotesPreservingAcks(null, notes, []);
  return clean;
}

// ── Alta y edición del contrato ────────────────────────────────────────

export interface LeaseInput {
  propertyId: string;
  startsAt: string;
  endsAt: string;
  rentAmount: number | string;
  currency?: RealtyCurrency;
  paymentDay: number;
  depositAmount?: number | string;
  increaseRule?: RealtyIncreaseRule;
  increasePct?: number | null;
  signedDocUrl?: string | null;
  notes?: string | null;
  /** Inquilino, aval y fiador. Un contrato SIN inquilino no se puede activar. */
  parties?: Array<{
    /** Vacío + newContact = se da de alta a la persona en el mismo acto. */
    contactId?: string;
    role: RealtyLeasePartyRole;
    screeningStatus?: RealtyScreeningStatus | null;
    /**
     * La persona que todavía no está en la libreta. El dueño de diez casas
     * llega con el inquilino ya escogido, no con un contacto capturado la
     * semana pasada: obligarlo a salir a otra pantalla a darlo de alta es
     * justo donde abandona el flujo.
     */
    newContact?: { name?: string; phone?: string; email?: string } | null;
  }>;
}

/**
 * Da de alta a las personas del contrato que llegaron SIN contactId y
 * devuelve las partes ya resueltas. Se hace antes de crear el contrato para
 * que un fallo aquí no deje un contrato a medias.
 *
 * kind INQUILINO para todos los que entran por un contrato (incluido el
 * aval): el catálogo del contrato solo tiene PROSPECTO / PROPIETARIO /
 * INQUILINO, y `kind` es de LISTADO, no de seguridad — así lo dice el
 * schema. El papel real vive en RealtyLeaseParty.role.
 */
async function materializeParties(
  ctx: RealtyContext,
  parties: LeaseInput["parties"],
): Promise<LeaseInput["parties"]> {
  const out: NonNullable<LeaseInput["parties"]> = [];
  for (const p of parties ?? []) {
    const contactId = String(p?.contactId ?? "").trim();
    if (contactId) {
      out.push({ contactId, role: p.role, screeningStatus: p.screeningStatus });
      continue;
    }
    const name = String(p?.newContact?.name ?? "").trim();
    if (!name) continue;
    // El teléfono se guarda NORMALIZADO a 10 dígitos, como manda el schema:
    // guardado como lo escribió la persona, el inbox de WhatsApp nunca logra
    // ligar el hilo entrante con su contacto.
    const phone = mxTenDigits(String(p?.newContact?.phone ?? "")) || null;
    const email = String(p?.newContact?.email ?? "").trim().toLowerCase() || null;
    const created = await prisma.realtyContact.create({
      data: { accountId: ctx.accountId, name: name.slice(0, 160), phone, email, kind: "INQUILINO" },
      select: { id: true },
    });
    out.push({ contactId: created.id, role: p.role, screeningStatus: p.screeningStatus });
  }
  return out;
}

function validateLeaseInput(input: LeaseInput): {
  startsAt: Date;
  endsAt: Date;
  rentCents: number;
  depositCents: number;
  paymentDay: number;
  increaseRule: RealtyIncreaseRule;
  increasePct: number | null;
} {
  const startsAt = toCalendarDate(input.startsAt);
  const endsAt = toCalendarDate(input.endsAt);
  if (!startsAt) throw new RealtyLeaseError("Falta la fecha de inicio del contrato.");
  if (!endsAt) throw new RealtyLeaseError("Falta la fecha de término del contrato.");
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new RealtyLeaseError("El contrato no puede terminar antes de empezar.");
  }

  const rentCents = toCents(input.rentAmount);
  if (rentCents <= 0) throw new RealtyLeaseError("La renta tiene que ser mayor a cero.");

  const depositCents = toCents(input.depositAmount ?? 0);
  if (depositCents < 0) throw new RealtyLeaseError("El depósito no puede ser negativo.");
  // toCents manda a 0 lo que no sabe leer ("1,500", "$12,000"). En la renta
  // eso ya lo caza el "mayor a cero" de arriba, pero un depósito SÍ puede ser
  // legítimamente 0 — así que un texto que no es cero y da 0 centavos se
  // rechaza en vez de guardarse como "sin depósito".
  const depositRaw = String(input.depositAmount ?? "").trim();
  if (depositRaw && depositCents === 0 && !/^[+-]?0*(?:[.,]0*)?$/.test(depositRaw)) {
    throw new RealtyLeaseError(
      "El depósito no se entiende. Escríbelo solo con números y punto decimal (12000.00).",
    );
  }

  const paymentDay = Math.floor(Number(input.paymentDay));
  if (!Number.isFinite(paymentDay) || paymentDay < 1 || paymentDay > 31) {
    throw new RealtyLeaseError("El día de pago tiene que estar entre 1 y 31.");
  }

  const increaseRule: RealtyIncreaseRule =
    input.increaseRule === "INPC" || input.increaseRule === "FIJO" ? input.increaseRule : "NINGUNO";

  let increasePct: number | null = null;
  if (increaseRule === "FIJO") {
    const pct = Number(input.increasePct);
    if (!Number.isFinite(pct)) {
      throw new RealtyLeaseError("Con aumento fijo hay que capturar el porcentaje.");
    }
    if (pct < 0 || pct > 100) {
      throw new RealtyLeaseError("El porcentaje de aumento tiene que estar entre 0 y 100.");
    }
    increasePct = round2(pct);
  }

  // El techo de cargos protege de un dedazo en el año de término: un
  // contrato de 200 años insertaría miles de filas de cobro.
  const plan = buildChargeSchedule({ startsAt, endsAt, paymentDay, rentAmount: 1 });
  if (plan.length > MAX_GENERATED_CHARGES) {
    throw new RealtyLeaseError(
      `Ese contrato dura más de ${Math.floor(MAX_GENERATED_CHARGES / 12)} años. ` +
        "Revisa la fecha de término.",
    );
  }

  return { startsAt, endsAt, rentCents, depositCents, paymentDay, increaseRule, increasePct };
}

/** El inmueble tiene que ser de esta cuenta. Regla 2 del encabezado. */
async function assertOwnProperty(ctx: RealtyContext, propertyId: string) {
  if (!propertyId) throw new RealtyLeaseError("Falta el inmueble del contrato.");
  const prop = await prisma.realtyProperty.findFirst({
    where: { id: propertyId, accountId: ctx.accountId },
    select: { id: true, title: true, city: true, state: true },
  });
  if (!prop) throw notFound("ese inmueble");
  return prop;
}

/** Los contactos tienen que ser de esta cuenta. */
async function assertOwnContacts(ctx: RealtyContext, contactIds: string[]): Promise<void> {
  const ids = Array.from(new Set(contactIds.filter(Boolean)));
  if (ids.length === 0) return;
  const found = await prisma.realtyContact.count({
    where: { id: { in: ids }, accountId: ctx.accountId },
  });
  if (found !== ids.length) throw notFound("alguna de esas personas");
}

export async function createLease(ctx: RealtyContext, input: LeaseInput): Promise<string> {
  const v = validateLeaseInput(input);
  await assertOwnProperty(ctx, input.propertyId);
  const parties = normalizeParties(await materializeParties(ctx, input.parties));
  await assertOwnContacts(ctx, parties.map((p) => p.contactId));

  const lease = await prisma.realtyLease.create({
    data: {
      accountId: ctx.accountId,
      propertyId: input.propertyId,
      startsAt: v.startsAt,
      endsAt: v.endsAt,
      rentAmount: centsToDecimal(v.rentCents),
      currency: input.currency === "USD" ? "USD" : "MXN",
      paymentDay: v.paymentDay,
      depositAmount: centsToDecimal(v.depositCents),
      increaseRule: v.increaseRule,
      increasePct: v.increasePct === null ? null : new Prisma.Decimal(v.increasePct.toFixed(2)),
      status: "BORRADOR",
      signedDocUrl: safeExternalUrl(input.signedDocUrl),
      notes: mergeNotesPreservingAcks(null, input.notes, []),
      parties: {
        create: parties.map((p) => ({
          accountId: ctx.accountId,
          contactId: p.contactId,
          role: p.role,
          screeningStatus: p.screeningStatus,
        })),
      },
    },
    select: { id: true },
  });
  return lease.id;
}

function normalizeParties(
  parties: LeaseInput["parties"],
): Array<{ contactId: string; role: RealtyLeasePartyRole; screeningStatus: RealtyScreeningStatus | null }> {
  const out: Array<{
    contactId: string;
    role: RealtyLeasePartyRole;
    screeningStatus: RealtyScreeningStatus | null;
  }> = [];
  const seen = new Set<string>();
  for (const p of parties ?? []) {
    const contactId = String(p?.contactId ?? "").trim();
    if (!contactId) continue;
    const role: RealtyLeasePartyRole =
      p.role === "AVAL" || p.role === "FIADOR" ? p.role : "INQUILINO";
    // El único de la base es (leaseId, contactId, role): mandar la misma
    // pareja dos veces reventaría con P2002 en vez de con un mensaje claro.
    const key = `${contactId}:${role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const screening: RealtyScreeningStatus | null =
      p.screeningStatus === "APROBADO" ||
      p.screeningStatus === "RECHAZADO" ||
      p.screeningStatus === "PENDIENTE"
        ? p.screeningStatus
        : null;
    out.push({ contactId, role, screeningStatus: screening });
  }
  return out;
}

export async function updateLease(
  ctx: RealtyContext,
  leaseId: string,
  input: LeaseInput,
): Promise<void> {
  const current = await prisma.realtyLease.findFirst({
    where: { id: leaseId, accountId: ctx.accountId },
    select: { id: true, status: true, notes: true },
  });
  if (!current) throw notFound("ese contrato");
  if (current.status === "TERMINADO") {
    throw new RealtyLeaseError(
      "Un contrato terminado ya no se edita. Si hubo un error, crea uno nuevo.",
      409,
      "TERMINATED",
    );
  }

  const v = validateLeaseInput(input);
  await assertOwnProperty(ctx, input.propertyId);
  const parties = normalizeParties(await materializeParties(ctx, input.parties));
  await assertOwnContacts(ctx, parties.map((p) => p.contactId));

  await prisma.$transaction(async (tx) => {
    await tx.realtyLease.update({
      where: { id: leaseId },
      data: {
        propertyId: input.propertyId,
        startsAt: v.startsAt,
        endsAt: v.endsAt,
        rentAmount: centsToDecimal(v.rentCents),
        currency: input.currency === "USD" ? "USD" : "MXN",
        paymentDay: v.paymentDay,
        depositAmount: centsToDecimal(v.depositCents),
        increaseRule: v.increaseRule,
        increasePct: v.increasePct === null ? null : new Prisma.Decimal(v.increasePct.toFixed(2)),
        // Semántica de PATCH: lo que no llega, no se toca. Antes, cualquier
        // guardado que no reenviara la liga BORRABA el contrato firmado.
        signedDocUrl:
          input.signedDocUrl === undefined ? undefined : safeExternalUrl(input.signedDocUrl),
        // Las confirmaciones del tope de la CDMX NO se pierden al editar.
        notes: mergeNotesPreservingAcks(current.notes, input.notes, []),
      },
    });

    if (input.parties) {
      const keep = new Set(parties.map((p) => `${p.contactId}:${p.role}`));
      const existing = await tx.realtyLeaseParty.findMany({
        where: { leaseId, accountId: ctx.accountId },
        select: { id: true, contactId: true, role: true },
      });
      const toDelete = existing
        .filter((e) => !keep.has(`${e.contactId}:${e.role}`))
        .map((e) => e.id);
      if (toDelete.length > 0) {
        await tx.realtyLeaseParty.deleteMany({
          where: { id: { in: toDelete }, accountId: ctx.accountId },
        });
      }
      for (const p of parties) {
        await tx.realtyLeaseParty.upsert({
          where: {
            leaseId_contactId_role: { leaseId, contactId: p.contactId, role: p.role },
          },
          create: {
            accountId: ctx.accountId,
            leaseId,
            contactId: p.contactId,
            role: p.role,
            screeningStatus: p.screeningStatus,
          },
          update: { screeningStatus: p.screeningStatus },
        });
      }
    }
  });
}

/** Borrar SOLO borradores sin nada colgando. Lo demás se TERMINA. */
export async function deleteLease(ctx: RealtyContext, leaseId: string): Promise<void> {
  const lease = await prisma.realtyLease.findFirst({
    where: { id: leaseId, accountId: ctx.accountId },
    select: {
      id: true,
      status: true,
      _count: { select: { payments: true, deposits: true } },
    },
  });
  if (!lease) throw notFound("ese contrato");
  if (lease.status !== "BORRADOR") {
    throw new RealtyLeaseError(
      "Solo se borra un contrato en borrador. Uno activo se termina, para que su historial de cobros no desaparezca.",
      409,
      "NOT_DRAFT",
    );
  }
  if (lease._count.payments > 0 || lease._count.deposits > 0) {
    throw new RealtyLeaseError(
      "Este contrato ya tiene dinero registrado. Términalo en vez de borrarlo.",
      409,
      "HAS_MONEY",
    );
  }
  await prisma.realtyLease.delete({ where: { id: leaseId } });
}

// ── Generación de los cargos ───────────────────────────────────────────

/**
 * Genera los cargos que le faltan al contrato. IDEMPOTENTE: se apoya en el
 * único (leaseId, periodMonth) con skipDuplicates, así que correrlo dos
 * veces NO duplica el cobro del mes — y correrlo después de alargar el
 * contrato solo agrega los meses nuevos.
 *
 * NO toca los cargos que ya existen: si la renta subió, el aumento se
 * aplica con applyIncrease (que reescribe los cargos futuros SIN pagos),
 * no reventando lo ya cobrado.
 */
export async function generateCharges(
  ctx: RealtyContext,
  leaseId: string,
): Promise<{ created: number; total: number }> {
  const lease = await prisma.realtyLease.findFirst({
    where: { id: leaseId, accountId: ctx.accountId },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      paymentDay: true,
      rentAmount: true,
      status: true,
    },
  });
  if (!lease) throw notFound("ese contrato");

  const plan = buildChargeSchedule({
    startsAt: lease.startsAt,
    endsAt: lease.endsAt,
    paymentDay: lease.paymentDay,
    rentAmount: lease.rentAmount,
  });
  if (plan.length === 0) return { created: 0, total: 0 };

  const res = await prisma.realtyRentCharge.createMany({
    data: plan.map((row) => ({
      accountId: ctx.accountId,
      leaseId,
      periodMonth: row.periodMonth,
      dueAt: row.dueAt,
      amount: centsToDecimal(row.amountCents),
    })),
    skipDuplicates: true,
  });

  return { created: res.count, total: plan.length };
}

/**
 * Activar el contrato: pasa a ACTIVO, genera TODOS los cargos del periodo y
 * registra el depósito en garantía como RETENIDO si hay monto y todavía no
 * está registrado. Es el momento en que el contrato empieza a cobrar.
 */
export async function activateLease(
  ctx: RealtyContext,
  leaseId: string,
): Promise<{ charges: number; deposit: boolean }> {
  const lease = await prisma.realtyLease.findFirst({
    where: { id: leaseId, accountId: ctx.accountId },
    select: {
      id: true,
      status: true,
      depositAmount: true,
      parties: { select: { role: true } },
      deposits: { select: { id: true } },
    },
  });
  if (!lease) throw notFound("ese contrato");
  if (lease.status === "TERMINADO") {
    throw new RealtyLeaseError("Ese contrato ya está terminado.", 409, "TERMINATED");
  }
  const hasTenant = (lease.parties ?? []).some((p) => p.role === "INQUILINO");
  if (!hasTenant) {
    throw new RealtyLeaseError(
      "Antes de activar el contrato hay que capturar al inquilino.",
      400,
      "NO_TENANT",
    );
  }

  await prisma.realtyLease.update({ where: { id: leaseId }, data: { status: "ACTIVO" } });
  const gen = await generateCharges(ctx, leaseId);

  let deposit = false;
  const depositCents = toCents(lease.depositAmount);
  if (depositCents > 0 && (lease.deposits ?? []).length === 0) {
    await prisma.realtyDeposit.create({
      data: {
        accountId: ctx.accountId,
        leaseId,
        amount: centsToDecimal(depositCents),
        status: "RETENIDO",
      },
    });
    deposit = true;
  }

  return { charges: gen.created, deposit };
}

/** Terminar el contrato. Los cargos y pagos se quedan: son el historial. */
export async function terminateLease(
  ctx: RealtyContext,
  leaseId: string,
  status: "TERMINADO" | "VENCIDO" = "TERMINADO",
): Promise<void> {
  const lease = await prisma.realtyLease.findFirst({
    where: { id: leaseId, accountId: ctx.accountId },
    select: { id: true },
  });
  if (!lease) throw notFound("ese contrato");
  await prisma.realtyLease.update({ where: { id: leaseId }, data: { status } });
}

// ── El aumento anual y el tope de la CDMX ──────────────────────────────

/**
 * El INPC del año pedido, leído de `realty_calc_params` (la carga otra
 * terminal). Si no está capturado devuelve null y la pantalla lo dice: NO
 * se inventa un número para una cláusula de aumento.
 *
 * Se busca primero el parámetro del estado y, si no hay, el federal ("MX").
 * De varios registros del mismo año se toma el de vigencia más reciente.
 */
export async function getInpcPct(
  year: number,
  stateCode = "MX",
): Promise<{ pct: number; year: number } | null> {
  if (!Number.isFinite(year)) return null;
  try {
    const rows = await prisma.realtyCalcParam.findMany({
      where: { kind: "INPC", year, stateCode: { in: Array.from(new Set([stateCode, "MX"])) } },
      select: { value: true, year: true, stateCode: true, effectiveFrom: true },
      orderBy: [{ effectiveFrom: "desc" }],
    });
    if (rows.length === 0) return null;
    const preferred = rows.find((r) => r.stateCode === stateCode) ?? rows[0];
    const pct = Number(preferred.value);
    if (!Number.isFinite(pct)) return null;
    return { pct: round2(pct), year: preferred.year };
  } catch {
    // La tabla puede no existir todavía en una base sin el SQL aplicado.
    // Degradar con elegancia: la pantalla pide el porcentaje a mano.
    return null;
  }
}

export interface IncreasePreview extends IncreaseSuggestion {
  leaseId: string;
  propertyTitle: string;
  tenantName: string;
  currency: RealtyCurrency;
  currentRent: number;
  suggestedRent: number | null;
  /** Cargos futuros SIN pagos que se reescribirían al aplicar. */
  editableCharges: number;
  /** Cargos que ya tienen abonos y por eso NO se tocan. */
  lockedCharges: number;
  acks: IncreaseAck[];
}

/**
 * El aumento propuesto para un contrato. Lee el INPC del año ANTERIOR al
 * de la fecha de referencia: el tope es "la inflación del año pasado".
 */
export async function previewIncrease(
  ctx: RealtyContext,
  leaseId: string,
  referenceDate?: Date,
  /**
   * Desde qué mes se va a aplicar ("YYYY-MM"). Se usa SOLO para contar los
   * cargos que se van a reescribir, y tiene que ser el MISMO criterio que
   * usa applyIncrease o la pantalla miente: contar por "vence en el futuro"
   * mientras el update filtra por `periodMonth >= fromMonth` se equivoca por
   * uno cada vez que el cargo del mes en curso todavía no ha vencido.
   */
  effectiveFromMonth?: string,
): Promise<IncreasePreview> {
  const today = referenceDate ?? todayInTimezone(ctx.account.timezone);
  const lease = await prisma.realtyLease.findFirst({
    where: { id: leaseId, accountId: ctx.accountId },
    select: {
      id: true,
      rentAmount: true,
      currency: true,
      increaseRule: true,
      increasePct: true,
      notes: true,
      property: { select: { title: true, city: true, state: true } },
      parties: { select: PARTY_SELECT },
      charges: {
        select: { id: true, periodMonth: true, payments: { select: { id: true } } },
      },
    },
  });
  if (!lease) throw notFound("ese contrato");

  const cdmx = isCdmxProperty({ city: lease.property?.city, state: lease.property?.state });
  const inpc = await getInpcPct(today.getUTCFullYear() - 1, cdmx ? "CMX" : "MX");

  const suggestion = suggestIncrease({
    rule: lease.increaseRule,
    fixedPct: lease.increasePct === null ? null : Number(lease.increasePct),
    inpcPct: inpc ? inpc.pct : null,
    inpcYear: inpc ? inpc.year : null,
    currentRent: lease.rentAmount,
    cdmx,
  });

  // El MISMO filtro que applyIncrease: periodMonth >= fromMonth. Por defecto
  // el mes que viene, que es lo primero que ofrece el selector.
  const fromMonth =
    effectiveFromMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(effectiveFromMonth)
      ? effectiveFromMonth
      : addMonthKey(monthKey(today), 1);

  let editableCharges = 0;
  let lockedCharges = 0;
  for (const ch of lease.charges ?? []) {
    if (ch.periodMonth < fromMonth) continue;
    if ((ch.payments ?? []).length > 0) lockedCharges += 1;
    else editableCharges += 1;
  }

  const parties = (lease.parties ?? []).map(mapParty);
  return {
    ...suggestion,
    leaseId: lease.id,
    propertyTitle: lease.property?.title ?? "Inmueble",
    tenantName: tenantOf(parties)?.contactName ?? "Sin inquilino capturado",
    currency: lease.currency,
    currentRent: centsToNumber(suggestion.currentRentCents),
    suggestedRent:
      suggestion.suggestedRentCents === null
        ? null
        : centsToNumber(suggestion.suggestedRentCents),
    editableCharges,
    lockedCharges,
    acks: parseIncreaseAcks(lease.notes),
  };
}

export interface ApplyIncreaseInput {
  /** El porcentaje que el usuario decidió aplicar. */
  pct: number;
  /** Desde qué mes ("YYYY-MM") aplica la renta nueva. */
  effectiveFromMonth: string;
  /**
   * 🔴 La confirmación explícita. Sin esto, un aumento por encima del tope
   * de la CDMX NO se guarda. Queda registrada en las notas del contrato.
   */
  overCapAcknowledged?: boolean;
  overCapReason?: string;
}

export interface ApplyIncreaseResult {
  newRent: number;
  updatedCharges: number;
  skippedCharges: number;
  capPct: number | null;
  overCap: boolean;
}

/**
 * Aplica el aumento: cambia la renta del contrato y REESCRIBE los cargos
 * futuros que todavía no tienen ni un abono. Los cargos ya cobrados (o con
 * pago parcial) no se tocan nunca: cambiar el importe de un cargo que ya
 * recibió dinero convierte un pago completo en un saldo de la nada.
 *
 * Si el inmueble está en la CDMX y el porcentaje pasa el tope, esto TRUENA
 * con 409 salvo que venga `overCapAcknowledged: true` — y entonces deja la
 * huella firmada en las notas del contrato.
 */
export async function applyIncrease(
  ctx: RealtyContext,
  leaseId: string,
  input: ApplyIncreaseInput,
): Promise<ApplyIncreaseResult> {
  const today = todayInTimezone(ctx.account.timezone);
  const pct = Number(input.pct);
  if (!Number.isFinite(pct)) throw new RealtyLeaseError("Captura el porcentaje del aumento.");
  if (pct < -100 || pct > 100) {
    throw new RealtyLeaseError("El porcentaje del aumento tiene que estar entre -100 y 100.");
  }
  const fromMonth = String(input.effectiveFromMonth ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(fromMonth)) {
    throw new RealtyLeaseError("Elige desde qué mes aplica la renta nueva.");
  }

  // 🔴 La reja es de SERVIDOR: `cdmx` y `capPct` se recalculan aquí desde el
  // inmueble y desde realty_calc_params, ignorando por completo lo que venga
  // en el body. Un POST directo no se la salta.
  const preview = await previewIncrease(ctx, leaseId, today, fromMonth);
  const overCap = needsCapAck({ cdmx: preview.cdmx, pct: round2(pct), capPct: preview.capPct });

  if (overCap && input.overCapAcknowledged !== true) {
    // Sin INPC capturado NO se sabe cuál es el tope, y eso NO es lo mismo
    // que no tener tope: se pide la confirmación igual y queda registrada
    // con "tope: sin dato".
    throw new RealtyLeaseError(
      preview.capPct === null
        ? `Este inmueble está en la Ciudad de México, donde el aumento anual no puede pasar ` +
            `de la inflación del año anterior — y ese dato todavía no está capturado, así que ` +
            `no podemos comprobar si ${round2(pct)} % lo rebasa. Si quieres aplicarlo de todos ` +
            `modos, confírmalo: queda registrado en el contrato.`
        : `En la Ciudad de México el aumento anual no puede pasar de la inflación del año ` +
            `anterior. El tope es ${preview.capPct} % y estás capturando ${round2(pct)} %. ` +
            `Si aun así quieres guardarlo, confírmalo: queda registrado en el contrato.`,
      409,
      "OVER_CAP",
    );
  }

  const lease = await prisma.realtyLease.findFirst({
    where: { id: leaseId, accountId: ctx.accountId },
    select: { id: true, rentAmount: true, notes: true },
  });
  if (!lease) throw notFound("ese contrato");

  const newRentCents = applyIncreaseToCents(toCents(lease.rentAmount), pct);

  const ackLines: string[] = [];
  if (overCap) {
    ackLines.push(
      buildIncreaseAckLine({
        date: today.toISOString().slice(0, 10),
        userId: ctx.realtyUserId,
        capPct: preview.capPct,
        appliedPct: round2(pct),
        reason: input.overCapReason ?? "",
      }),
    );
  }

  let updatedCharges = 0;
  let skippedCharges = 0;

  await prisma.$transaction(async (tx) => {
    await tx.realtyLease.update({
      where: { id: leaseId },
      data: {
        rentAmount: centsToDecimal(newRentCents),
        notes: mergeNotesPreservingAcks(lease.notes, stripAckForDisplay(lease.notes), ackLines),
      },
    });

    const charges = await tx.realtyRentCharge.findMany({
      where: { leaseId, accountId: ctx.accountId, periodMonth: { gte: fromMonth } },
      select: { id: true, payments: { select: { id: true } } },
    });
    const editable = charges.filter((c) => (c.payments ?? []).length === 0).map((c) => c.id);
    skippedCharges = charges.length - editable.length;
    if (editable.length > 0) {
      const res = await tx.realtyRentCharge.updateMany({
        where: { id: { in: editable }, accountId: ctx.accountId },
        data: { amount: centsToDecimal(newRentCents) },
      });
      updatedCharges = res.count;
    }
  });

  return {
    newRent: centsToNumber(newRentCents),
    updatedCharges,
    skippedCharges,
    capPct: preview.capPct,
    overCap,
  };
}

// applyPctToCents vivía aquí, duplicando a applyIncreaseToCents de inpc.ts.
// Dos implementaciones del MISMO cálculo de dinero es una que se va a quedar
// atrás: la de aquí ni siquiera tenía el guard de Number.isFinite, así que un
// pct NaN llegaba a centsToDecimal y armaba "NaN.NaN". Ahora hay UNA sola, y
// es la del módulo puro — la misma que usa la pantalla.

// ── El tablero de cobranza ─────────────────────────────────────────────

export async function getCollectionsBoard(
  ctx: RealtyContext,
  opts: { periodMonth?: string; onlyOverdue?: boolean } = {},
): Promise<CollectionsBoard> {
  const today = todayInTimezone(ctx.account.timezone);
  const period =
    opts.periodMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(opts.periodMonth)
      ? opts.periodMonth
      : monthKey(today);

  const rows = await prisma.realtyRentCharge.findMany({
    where: { accountId: ctx.accountId, periodMonth: period },
    select: {
      ...CHARGE_SELECT,
      lease: {
        select: {
          id: true,
          status: true,
          currency: true,
          property: { select: PROPERTY_SELECT },
          parties: { select: PARTY_SELECT },
        },
      },
    },
    orderBy: { dueAt: "asc" },
    take: 1000,
  });

  const totals = emptyCollectionsTotals();
  const out: CollectionRow[] = [];
  let noticesToday = 0;

  for (const row of rows) {
    const view = mapCharge(row, today);
    const parties = (row.lease?.parties ?? []).map(mapParty);
    const tenant = tenantOf(parties);
    accumulate(totals, {
      amountCents: toCents(view.amount),
      paidCents: toCents(view.paid),
      balanceCents: toCents(view.balance),
      daysLate: view.daysLate,
    });
    if (view.balance > 0 && pickReminderStep(row.dueAt, today)) noticesToday += 1;
    if (opts.onlyOverdue && !(view.balance > 0 && view.daysLate > 0)) continue;
    out.push({
      ...view,
      propertyId: row.lease?.property?.id ?? "",
      propertyTitle: row.lease?.property?.title ?? "Inmueble",
      tenantName: tenant?.contactName ?? "Sin inquilino capturado",
      tenantPhone: tenant?.contactPhone ?? null,
      currency: row.lease?.currency ?? "MXN",
      leaseStatus: row.lease?.status ?? "BORRADOR",
    });
  }

  return {
    periodMonth: period,
    periodLabel: monthLabel(period),
    today: today.toISOString(),
    rows: out,
    totals,
    currency: "MXN",
    noticesToday,
    planHasWhatsapp: ctx.plan.features.whatsapp === true,
  };
}

// ── Pagos ──────────────────────────────────────────────────────────────

export interface RegisterPaymentInput {
  chargeId?: string | null;
  /** Para un pago que no es de un cargo (depósito, penalización). */
  leaseId?: string | null;
  amount: number | string;
  method: RealtyPaymentMethod;
  paidAt?: string | null;
  reference?: string | null;
  /** Emitir el recibo en el mismo acto (lo normal desde la caja). */
  emitReceipt?: boolean;
}

export interface RegisterPaymentResult {
  paymentId: string;
  chargeStatus: RealtyChargeStatus | null;
  balance: number;
  receiptFolio: string;
  receiptUrl: string | null;
}

const PAYMENT_METHODS = new Set<RealtyPaymentMethod>(["EFECTIVO", "SPEI", "TARJETA", "OTRO"]);

/**
 * Registra un pago. Admite ABONO PARCIAL: el cargo queda en PARCIAL con su
 * saldo y el semáforo sigue contando los días desde el vencimiento.
 *
 * El estado del cargo se RECALCULA desde la suma de sus pagos, nunca se
 * "adivina" desde el pago que acaba de entrar: con dos abonos simultáneos,
 * sumar solo el último dejaría el cargo en PARCIAL estando ya cubierto.
 */
export async function registerPayment(
  ctx: RealtyContext,
  input: RegisterPaymentInput,
): Promise<RegisterPaymentResult> {
  const amountCents = toCents(input.amount);
  if (amountCents <= 0) throw new RealtyLeaseError("El monto del pago tiene que ser mayor a cero.");
  const method: RealtyPaymentMethod = PAYMENT_METHODS.has(input.method) ? input.method : "EFECTIVO";
  const paidAt = input.paidAt ? toCalendarDate(input.paidAt) : todayInTimezone(ctx.account.timezone);
  if (!paidAt) throw new RealtyLeaseError("La fecha del pago no es válida.");

  const chargeId = (input.chargeId ?? "").trim() || null;
  const leaseIdInput = (input.leaseId ?? "").trim() || null;
  if (!chargeId && !leaseIdInput) {
    throw new RealtyLeaseError("Un pago tiene que ir contra un cargo o contra un contrato.");
  }

  // Regla 2: el cargo / contrato tiene que ser de esta cuenta.
  let leaseId = leaseIdInput;
  if (chargeId) {
    const charge = await prisma.realtyRentCharge.findFirst({
      where: { id: chargeId, accountId: ctx.accountId },
      select: { id: true, leaseId: true, amount: true, dueAt: true },
    });
    if (!charge) throw notFound("ese cargo");
    leaseId = charge.leaseId;
  } else if (leaseId) {
    const lease = await prisma.realtyLease.findFirst({
      where: { id: leaseId, accountId: ctx.accountId },
      select: { id: true },
    });
    if (!lease) throw notFound("ese contrato");
  }

  const payment = await prisma.realtyPayment.create({
    data: {
      accountId: ctx.accountId,
      chargeId,
      leaseId,
      amount: centsToDecimal(amountCents),
      method,
      paidAt,
      reference: (input.reference ?? "").trim() || null,
    },
    select: { id: true },
  });

  let chargeStatus: RealtyChargeStatus | null = null;
  let balance = 0;
  if (chargeId) {
    const recalculated = await recalcChargeStatus(ctx, chargeId);
    chargeStatus = recalculated.status;
    balance = centsToNumber(recalculated.balanceCents);
  }

  let receiptFolio = "";
  let receiptUrl: string | null = null;
  if (input.emitReceipt !== false) {
    const receipt = await emitReceipt(ctx, payment.id);
    receiptFolio = receipt.folio;
    receiptUrl = receipt.url;
  }

  return { paymentId: payment.id, chargeStatus, balance, receiptFolio, receiptUrl };
}

/** Recalcula el estado de un cargo desde la SUMA de sus pagos. */
export async function recalcChargeStatus(
  ctx: RealtyContext,
  chargeId: string,
): Promise<{ status: RealtyChargeStatus; balanceCents: number }> {
  const today = todayInTimezone(ctx.account.timezone);
  const charge = await prisma.realtyRentCharge.findFirst({
    where: { id: chargeId, accountId: ctx.accountId },
    select: { id: true, amount: true, dueAt: true, payments: { select: { amount: true } } },
  });
  if (!charge) throw notFound("ese cargo");

  const paidCents = sumCentsBy(charge.payments ?? [], (p) => p.amount);
  const bal = chargeBalance({
    amount: charge.amount,
    paidCents,
    dueAt: charge.dueAt,
    today,
  });
  await prisma.realtyRentCharge.update({
    where: { id: chargeId },
    data: { status: bal.status },
  });
  return { status: bal.status, balanceCents: bal.balanceCents };
}

/**
 * Cancela un pago mal capturado y recalcula el cargo.
 *
 * 🔴 UN PAGO CON RECIBO YA EMITIDO NO SE BORRA. Dos motivos, y el segundo es
 * el que de verdad muerde:
 *
 *  1. Ese recibo ya se le entregó a alguien. Un documento de dinero que
 *     desaparece de la base sin dejar rastro es justo lo que no puede pasar
 *     en cobranza.
 *  2. 🔴 EL FOLIO SE REUTILIZARÍA. El siguiente folio sale de un MAX sobre
 *     las filas VIVAS: si se borra el pago del folio más alto, el MAX BAJA y
 *     el siguiente recibo sale con un número YA ENTREGADO. Es la misma
 *     patología del `count + 1` que este módulo evita, en el caso más
 *     probable de todos — el último capturado es justo el que se corrige.
 *     El schema no tiene columna de folio ni único sobre receiptUrl (es de
 *     la Ola 0 y no se toca), así que la reja es esta.
 *
 * Un pago SIN recibo se borra sin problema: no hay folio que reutilizar.
 * Para corregir uno que ya lo tiene, se registra el movimiento que lo
 * compensa — que además es lo que deja el rastro correcto.
 */
export async function deletePayment(ctx: RealtyContext, paymentId: string): Promise<void> {
  const payment = await prisma.realtyPayment.findFirst({
    where: { id: paymentId, accountId: ctx.accountId },
    select: { id: true, chargeId: true, receiptUrl: true },
  });
  if (!payment) throw notFound("ese pago");

  const folio = folioFromReceiptUrl(payment.receiptUrl);
  if (folio) {
    throw new RealtyLeaseError(
      `Este pago ya tiene el recibo ${folio} emitido y por eso no se borra: ese folio ya ` +
        "salió a nombre de alguien. Registra el movimiento que lo corrige.",
      409,
      "RECEIPT_ISSUED",
    );
  }

  await prisma.realtyPayment.delete({ where: { id: paymentId } });
  if (payment.chargeId) {
    // El cargo puede haberse ido con el pago solo si alguien borró el
    // contrato entero; en ese caso no hay nada que recalcular.
    try {
      await recalcChargeStatus(ctx, payment.chargeId);
    } catch {
      /* el cargo ya no existe: nada que hacer */
    }
  }
}

// ── El folio del recibo ────────────────────────────────────────────────
//
// 🔴 SIEMPRE del MÁXIMO EMITIDO, NUNCA de un count + 1. Con un pago
// borrado, el count apunta a un folio ya emitido y salen dos recibos con el
// mismo número; en este repo ya costó caro (ver next-invoice-number.ts).
//
// El MAX se hace EN SQL sobre el último bloque de dígitos de receiptUrl,
// que es el mismo patrón que el folio de factura del dental. Comparar como
// texto pondría REC-000009 por encima de REC-000010 en cuanto el número
// creciera de ancho; el CAST a BIGINT compara como número.
//
// La carrera se cierra con un candado de transacción de Postgres por
// CUENTA: dos recibos simultáneos de la misma cuenta se forman en fila,
// y los de cuentas distintas no se estorban.

/** Clave de candado por cuenta (dos int4, como barber). */
export function accountLockKey(accountId: string): [number, number] {
  const hash = (seed: number): number => {
    let h = seed;
    for (let i = 0; i < accountId.length; i++) {
      h ^= accountId.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h | 0;
  };
  return [hash(0x811c9dc5 | 0), hash(0x9e3779b9 | 0)];
}

/**
 * Emite (o devuelve) el folio del recibo de un pago. IDEMPOTENTE: si el
 * pago ya tiene recibo, regresa el mismo — nunca se emiten dos folios para
 * el mismo pago.
 */
export async function emitReceipt(
  ctx: RealtyContext,
  paymentId: string,
): Promise<{ folio: string; url: string }> {
  const payment = await prisma.realtyPayment.findFirst({
    where: { id: paymentId, accountId: ctx.accountId },
    select: { id: true, receiptUrl: true },
  });
  if (!payment) throw notFound("ese pago");

  const existing = folioFromReceiptUrl(payment.receiptUrl);
  if (existing) return { folio: existing, url: payment.receiptUrl as string };

  const key = accountLockKey(ctx.accountId);

  return prisma.$transaction(async (tx) => {
    // Candado por cuenta: se libera solo al cerrar la transacción.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key[0]}::int4, ${key[1]}::int4)`;

    // Por si otro proceso emitió el recibo mientras esperábamos el candado.
    const fresh = await tx.realtyPayment.findFirst({
      where: { id: paymentId, accountId: ctx.accountId },
      select: { receiptUrl: true },
    });
    const already = folioFromReceiptUrl(fresh?.receiptUrl);
    if (already) return { folio: already, url: fresh!.receiptUrl as string };

    const rows = await tx.$queryRaw<{ max: bigint | number | null }[]>`
      SELECT MAX(CAST(digits AS BIGINT)) AS max
      FROM (
        SELECT substring("receiptUrl" from '([0-9]+)[^0-9]*$') AS digits
        FROM "realty_payments"
        WHERE "accountId" = ${ctx.accountId} AND "receiptUrl" IS NOT NULL
      ) s
      WHERE digits IS NOT NULL AND length(digits) <= 12
    `;
    const raw = rows[0]?.max ?? null;
    const max = raw === null ? 0 : Number(raw);
    const next = (Number.isSafeInteger(max) ? max : 0) + 1;

    const folio = formatReceiptFolio(next);
    const url = receiptUrlFor(folio);
    await tx.realtyPayment.update({ where: { id: paymentId }, data: { receiptUrl: url } });
    return { folio, url };
  });
}

/** El pago detrás de un folio de recibo, dentro de la cuenta de la sesión. */
export async function findPaymentByFolio(ctx: RealtyContext, folio: string) {
  const clean = String(folio ?? "").trim();
  if (!clean) return null;
  return prisma.realtyPayment.findFirst({
    where: { accountId: ctx.accountId, receiptUrl: receiptUrlFor(clean) },
    select: {
      ...PAYMENT_SELECT,
      charge: { select: { periodMonth: true, dueAt: true, amount: true } },
      lease: {
        select: {
          id: true,
          currency: true,
          rentAmount: true,
          property: { select: { title: true, address: true, colonia: true, city: true, state: true } },
          parties: { select: PARTY_SELECT },
        },
      },
    },
  });
}

// ── Estado de cuenta ───────────────────────────────────────────────────

export interface StatementLine {
  date: string;
  concept: string;
  periodMonth: string | null;
  chargeCents: number;
  paymentCents: number;
  balanceCents: number;
  reference: string | null;
  receiptFolio: string;
}

export interface Statement {
  scope: "CONTRATO" | "INMUEBLE";
  title: string;
  subtitle: string;
  currency: RealtyCurrency;
  lines: StatementLine[];
  chargedCents: number;
  paidCents: number;
  balanceCents: number;
  generatedAt: string;
}

/**
 * Estado de cuenta de un contrato: cargos y pagos en orden, con saldo
 * corriente. Es lo que se le manda al inquilino cuando pregunta "¿cuánto
 * debo?" y lo que el dueño imprime para su carpeta.
 */
export async function getLeaseStatement(
  ctx: RealtyContext,
  leaseId: string,
): Promise<Statement> {
  const lease = await prisma.realtyLease.findFirst({
    where: { id: leaseId, accountId: ctx.accountId },
    select: {
      id: true,
      currency: true,
      property: { select: { title: true } },
      parties: { select: PARTY_SELECT },
      charges: { select: { id: true, periodMonth: true, dueAt: true, amount: true }, orderBy: { dueAt: "asc" } },
      payments: { select: PAYMENT_SELECT, orderBy: { paidAt: "asc" } },
    },
  });
  if (!lease) throw notFound("ese contrato");

  const parties = (lease.parties ?? []).map(mapParty);
  const chargeById = new Map(lease.charges.map((c) => [c.id, c]));

  const events: Array<{ at: number; line: Omit<StatementLine, "balanceCents"> }> = [];
  for (const c of lease.charges) {
    events.push({
      at: c.dueAt.getTime(),
      line: {
        date: c.dueAt.toISOString(),
        concept: `Renta de ${monthLabel(c.periodMonth)}`,
        periodMonth: c.periodMonth,
        chargeCents: toCents(c.amount),
        paymentCents: 0,
        reference: null,
        receiptFolio: "",
      },
    });
  }
  for (const p of lease.payments) {
    const ch = p.chargeId ? chargeById.get(p.chargeId) : null;
    events.push({
      at: p.paidAt.getTime(),
      line: {
        date: p.paidAt.toISOString(),
        concept: ch ? `Pago de ${monthLabel(ch.periodMonth)}` : "Pago",
        periodMonth: ch ? ch.periodMonth : null,
        chargeCents: 0,
        paymentCents: toCents(p.amount),
        reference: p.reference,
        receiptFolio: folioFromReceiptUrl(p.receiptUrl),
      },
    });
  }
  // Un cargo y su pago el mismo día: primero el cargo, para que el saldo
  // corriente nunca se vea en negativo por un renglón.
  events.sort((a, b) => a.at - b.at || b.line.chargeCents - a.line.chargeCents);

  let running = 0;
  let chargedCents = 0;
  let paidCents = 0;
  const lines: StatementLine[] = events.map((e) => {
    running += e.line.chargeCents - e.line.paymentCents;
    chargedCents += e.line.chargeCents;
    paidCents += e.line.paymentCents;
    return { ...e.line, balanceCents: running };
  });

  return {
    scope: "CONTRATO",
    title: lease.property?.title ?? "Inmueble",
    subtitle: tenantOf(parties)?.contactName ?? "Sin inquilino capturado",
    currency: lease.currency,
    lines,
    chargedCents,
    paidCents,
    balanceCents: chargedCents - paidCents,
    generatedAt: new Date().toISOString(),
  };
}

/** Estado de cuenta de un INMUEBLE: todos sus contratos, en una sola hoja. */
export async function getPropertyStatement(
  ctx: RealtyContext,
  propertyId: string,
): Promise<Statement> {
  const property = await prisma.realtyProperty.findFirst({
    where: { id: propertyId, accountId: ctx.accountId },
    select: { id: true, title: true, city: true, colonia: true },
  });
  if (!property) throw notFound("ese inmueble");

  const leases = await prisma.realtyLease.findMany({
    where: { accountId: ctx.accountId, propertyId },
    select: { id: true },
    orderBy: { startsAt: "asc" },
  });

  const parts = await Promise.all(leases.map((l) => getLeaseStatement(ctx, l.id)));
  const lines = parts.flatMap((p) => p.lines).sort((a, b) => a.date.localeCompare(b.date));

  let running = 0;
  let chargedCents = 0;
  let paidCents = 0;
  const merged: StatementLine[] = lines.map((l) => {
    running += l.chargeCents - l.paymentCents;
    chargedCents += l.chargeCents;
    paidCents += l.paymentCents;
    return { ...l, balanceCents: running };
  });

  return {
    scope: "INMUEBLE",
    title: property.title,
    subtitle: [property.colonia, property.city].filter(Boolean).join(", ") || "Sin ubicación capturada",
    currency: parts[0]?.currency ?? "MXN",
    lines: merged,
    chargedCents,
    paidCents,
    balanceCents: chargedCents - paidCents,
    generatedAt: new Date().toISOString(),
  };
}

/** El estado de cuenta como CSV (lo que se exporta y se abre en Excel). */
export function statementToCsv(statement: Statement): string {
  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const money = (cents: number) => (cents / 100).toFixed(2);
  const rows: string[] = [];
  rows.push(["Fecha", "Concepto", "Periodo", "Cargo", "Pago", "Saldo", "Referencia", "Recibo"].map(esc).join(","));
  for (const l of statement.lines) {
    rows.push(
      [
        l.date.slice(0, 10),
        l.concept,
        l.periodMonth ?? "",
        money(l.chargeCents),
        money(l.paymentCents),
        money(l.balanceCents),
        l.reference ?? "",
        l.receiptFolio,
      ]
        .map(esc)
        .join(","),
    );
  }
  rows.push("");
  rows.push([esc("Total cargado"), esc(money(statement.chargedCents))].join(","));
  rows.push([esc("Total pagado"), esc(money(statement.paidCents))].join(","));
  rows.push([esc("Saldo"), esc(money(statement.balanceCents))].join(","));
  // BOM para que Excel en Windows lea los acentos.
  return `﻿${rows.join("\r\n")}\r\n`;
}

// ── Depósito en garantía ───────────────────────────────────────────────

export interface ResolveDepositInput {
  status: RealtyDepositStatus;
  note?: string | null;
  /** Cuando se APLICA parcialmente, el monto que se retuvo. */
  amount?: number | string | null;
}

/**
 * Resolver el depósito: devolverlo, aplicarlo o dejarlo retenido, SIEMPRE
 * con una nota. Es la conversación más áspera del final de un contrato y
 * lo único que la vuelve manejable es que quede escrito.
 */
export async function resolveDeposit(
  ctx: RealtyContext,
  depositId: string,
  input: ResolveDepositInput,
  /**
   * El contrato desde el que se está resolviendo. Se exige que el depósito
   * sea SUYO: sin esto, alguien parado en la ficha del contrato A podía
   * resolver el depósito del contrato B de la misma cuenta, y la nota
   * obligatoria quedaba escrita en el depósito equivocado.
   */
  leaseId?: string,
): Promise<void> {
  const deposit = await prisma.realtyDeposit.findFirst({
    where: { id: depositId, accountId: ctx.accountId, ...(leaseId ? { leaseId } : {}) },
    select: { id: true, amount: true },
  });
  if (!deposit) throw notFound("ese depósito");

  const status: RealtyDepositStatus =
    input.status === "DEVUELTO" || input.status === "APLICADO" ? input.status : "RETENIDO";
  const note = (input.note ?? "").trim();
  if (status !== "RETENIDO" && !note) {
    throw new RealtyLeaseError(
      "Escribe por qué se devuelve o se aplica el depósito. Sin nota, esa decisión no se puede defender después.",
    );
  }

  const data: Prisma.RealtyDepositUpdateInput = {
    status,
    note: note || null,
    resolvedAt: status === "RETENIDO" ? null : new Date(),
  };
  if (input.amount !== null && input.amount !== undefined && String(input.amount) !== "") {
    const cents = toCents(input.amount);
    if (cents < 0) throw new RealtyLeaseError("El monto del depósito no puede ser negativo.");
    data.amount = centsToDecimal(cents);
  }

  await prisma.realtyDeposit.update({ where: { id: depositId }, data });
}

/** Registrar el depósito a mano (contrato viejo que se está capturando). */
export async function createDeposit(
  ctx: RealtyContext,
  leaseId: string,
  amount: number | string,
): Promise<string> {
  const lease = await prisma.realtyLease.findFirst({
    where: { id: leaseId, accountId: ctx.accountId },
    select: { id: true },
  });
  if (!lease) throw notFound("ese contrato");
  const cents = toCents(amount);
  if (cents <= 0) throw new RealtyLeaseError("El depósito tiene que ser mayor a cero.");
  const row = await prisma.realtyDeposit.create({
    data: { accountId: ctx.accountId, leaseId, amount: centsToDecimal(cents), status: "RETENIDO" },
    select: { id: true },
  });
  return row.id;
}

// ── Mantenimiento ──────────────────────────────────────────────────────

export interface MaintenanceView {
  id: string;
  propertyId: string;
  propertyTitle: string;
  leaseId: string | null;
  reportedBy: string | null;
  description: string;
  photoUrls: string[];
  status: RealtyMaintenanceStatus;
  vendorName: string | null;
  cost: number | null;
  resolvedAt: string | null;
  createdAt: string;
  /** Días abiertos. Lo que mide si la administración responde o no. */
  daysOpen: number;
}

export async function listMaintenance(
  ctx: RealtyContext,
  filters: { status?: RealtyMaintenanceStatus | "TODOS"; propertyId?: string; leaseId?: string } = {},
): Promise<MaintenanceView[]> {
  const today = todayInTimezone(ctx.account.timezone);
  const where: Prisma.RealtyMaintenanceWhereInput = { accountId: ctx.accountId };
  if (filters.status && filters.status !== "TODOS") where.status = filters.status;
  if (filters.propertyId) where.propertyId = filters.propertyId;
  if (filters.leaseId) where.leaseId = filters.leaseId;

  const rows = await prisma.realtyMaintenance.findMany({
    where,
    select: {
      id: true,
      propertyId: true,
      leaseId: true,
      reportedBy: true,
      description: true,
      photoUrls: true,
      status: true,
      vendorName: true,
      cost: true,
      resolvedAt: true,
      createdAt: true,
      property: { select: { title: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 300,
  });

  // Las fotos viven en el bucket PRIVADO: se firman todas en un round-trip.
  const flat: string[] = [];
  const spans: Array<[number, number]> = [];
  for (const r of rows) {
    const start = flat.length;
    for (const u of r.photoUrls ?? []) flat.push(u);
    spans.push([start, flat.length]);
  }
  const signed = await signRealtyPaths(flat);

  return rows.map((r, i) => {
    const end = r.resolvedAt ? toCalendarDate(r.resolvedAt) : today;
    const start = toCalendarDate(r.createdAt);
    return {
      id: r.id,
      propertyId: r.propertyId,
      propertyTitle: r.property?.title ?? "Inmueble",
      leaseId: r.leaseId,
      reportedBy: r.reportedBy,
      description: r.description,
      photoUrls: signed.slice(spans[i][0], spans[i][1]).filter(Boolean),
      status: r.status,
      vendorName: r.vendorName,
      cost: r.cost === null ? null : centsToNumber(toCents(r.cost)),
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      daysOpen: start && end ? Math.max(0, daysBetween(start, end)) : 0,
    };
  });
}

export interface MaintenanceInput {
  propertyId: string;
  leaseId?: string | null;
  reportedBy?: string | null;
  description: string;
  photoUrls?: string[];
}

export async function createMaintenance(
  ctx: RealtyContext,
  input: MaintenanceInput,
): Promise<string> {
  await assertOwnProperty(ctx, input.propertyId);
  const description = String(input.description ?? "").trim();
  if (!description) throw new RealtyLeaseError("Describe qué está fallando.");

  let leaseId: string | null = (input.leaseId ?? "").trim() || null;
  if (leaseId) {
    const lease = await prisma.realtyLease.findFirst({
      where: { id: leaseId, accountId: ctx.accountId, propertyId: input.propertyId },
      select: { id: true },
    });
    if (!lease) leaseId = null; // un contrato ajeno simplemente no se liga
  }

  const row = await prisma.realtyMaintenance.create({
    data: {
      accountId: ctx.accountId,
      propertyId: input.propertyId,
      leaseId,
      reportedBy: (input.reportedBy ?? "").trim() || null,
      description: description.slice(0, 4000),
      // Solo rutas que ESTE servidor generó para ESTA cuenta (ver keepOwnEvidencePaths).
      photoUrls: keepOwnEvidencePaths(ctx, "mantenimiento", input.photoUrls, 12),
      status: "ABIERTO",
    },
    select: { id: true },
  });
  return row.id;
}

export interface MaintenanceUpdate {
  status?: RealtyMaintenanceStatus;
  vendorName?: string | null;
  cost?: number | string | null;
  resolvedAt?: string | null;
  /** Al resolver con costo, crear el gasto del inmueble de una vez. */
  createExpense?: boolean;
}

/**
 * Avanza un mantenimiento. Al RESOLVER con costo puede crear el gasto del
 * inmueble en el mismo acto: es lo que hace que la rentabilidad real del
 * inmueble no dependa de que alguien se acuerde de capturarlo aparte.
 */
export async function updateMaintenance(
  ctx: RealtyContext,
  id: string,
  input: MaintenanceUpdate,
): Promise<{ expenseId: string | null }> {
  const row = await prisma.realtyMaintenance.findFirst({
    where: { id, accountId: ctx.accountId },
    select: { id: true, propertyId: true, status: true, cost: true, description: true },
  });
  if (!row) throw notFound("ese mantenimiento");

  const status: RealtyMaintenanceStatus =
    input.status === "ABIERTO" || input.status === "EN_PROCESO" || input.status === "RESUELTO"
      ? input.status
      : row.status;

  const costCents =
    input.cost === null || input.cost === undefined || String(input.cost) === ""
      ? null
      : toCents(input.cost);
  if (costCents !== null && costCents < 0) {
    throw new RealtyLeaseError("El costo no puede ser negativo.");
  }

  let resolvedAt: Date | null = null;
  if (status === "RESUELTO") {
    resolvedAt = input.resolvedAt ? toCalendarDate(input.resolvedAt) : new Date();
    if (!resolvedAt) resolvedAt = new Date();
  }

  await prisma.realtyMaintenance.update({
    where: { id },
    data: {
      status,
      vendorName:
        input.vendorName === undefined ? undefined : (input.vendorName ?? "").trim() || null,
        // `undefined` NO toca la columna; `null` la borra. Solo se borra si
      // quien llama mandó cost explícitamente en null: mover una incidencia
      // de RESUELTO a EN_PROCESO sin reenviar el costo ya no lo pierde.
      cost:
        input.cost === undefined
          ? undefined
          : costCents === null
            ? null
            : centsToDecimal(costCents),
      resolvedAt,
    },
  });

  let expenseId: string | null = null;
  if (status === "RESUELTO" && input.createExpense && costCents !== null && costCents > 0) {
    const expense = await prisma.realtyExpense.create({
      data: {
        accountId: ctx.accountId,
        propertyId: row.propertyId,
        kind: "REPARACION",
        amount: centsToDecimal(costCents),
        paidAt: resolvedAt ?? new Date(),
        note: `Mantenimiento: ${row.description.slice(0, 200)}`,
      },
      select: { id: true },
    });
    expenseId = expense.id;
  }

  return { expenseId };
}

// ── Gastos del inmueble ────────────────────────────────────────────────

export interface ExpenseView {
  id: string;
  propertyId: string;
  propertyTitle: string;
  kind: RealtyExpenseKind;
  amount: number;
  paidAt: string;
  note: string | null;
  receiptUrl: string | null;
}

export async function listExpenses(
  ctx: RealtyContext,
  filters: { propertyId?: string; from?: string; to?: string; kind?: RealtyExpenseKind } = {},
): Promise<{ rows: ExpenseView[]; totalCents: number; byKind: Record<string, number> }> {
  const where: Prisma.RealtyExpenseWhereInput = { accountId: ctx.accountId };
  if (filters.propertyId) where.propertyId = filters.propertyId;
  if (filters.kind) where.kind = filters.kind;
  const from = filters.from ? toCalendarDate(filters.from) : null;
  const to = filters.to ? toCalendarDate(filters.to) : null;
  if (from || to) {
    where.paidAt = {};
    if (from) (where.paidAt as Prisma.DateTimeFilter).gte = from;
    if (to) (where.paidAt as Prisma.DateTimeFilter).lte = to;
  }

  const rows = await prisma.realtyExpense.findMany({
    where,
    select: {
      id: true,
      propertyId: true,
      kind: true,
      amount: true,
      paidAt: true,
      note: true,
      receiptUrl: true,
      property: { select: { title: true } },
    },
    orderBy: { paidAt: "desc" },
    take: 500,
  });

  const byKind: Record<string, number> = {};
  let totalCents = 0;
  const out = rows.map((r) => {
    const cents = toCents(r.amount);
    totalCents += cents;
    byKind[r.kind] = (byKind[r.kind] ?? 0) + cents;
    return {
      id: r.id,
      propertyId: r.propertyId,
      propertyTitle: r.property?.title ?? "Inmueble",
      kind: r.kind,
      amount: centsToNumber(cents),
      paidAt: r.paidAt.toISOString(),
      note: r.note,
      receiptUrl: r.receiptUrl,
    };
  });

  return { rows: out, totalCents, byKind };
}

export interface ExpenseInput {
  propertyId: string;
  kind: RealtyExpenseKind;
  amount: number | string;
  paidAt: string;
  note?: string | null;
  receiptUrl?: string | null;
}

const EXPENSE_KINDS = new Set<RealtyExpenseKind>([
  "PREDIAL",
  "AGUA",
  "MANTENIMIENTO",
  "REPARACION",
  "OTRO",
]);

export async function createExpense(ctx: RealtyContext, input: ExpenseInput): Promise<string> {
  await assertOwnProperty(ctx, input.propertyId);
  const cents = toCents(input.amount);
  if (cents <= 0) throw new RealtyLeaseError("El monto del gasto tiene que ser mayor a cero.");
  const paidAt = toCalendarDate(input.paidAt);
  if (!paidAt) throw new RealtyLeaseError("Captura la fecha del gasto.");

  const row = await prisma.realtyExpense.create({
    data: {
      accountId: ctx.accountId,
      propertyId: input.propertyId,
      kind: EXPENSE_KINDS.has(input.kind) ? input.kind : "OTRO",
      amount: centsToDecimal(cents),
      paidAt,
      note: (input.note ?? "").trim() || null,
      // Acaba en un href del panel: solo http(s), nunca javascript:.
      receiptUrl: safeExternalUrl(input.receiptUrl),
    },
    select: { id: true },
  });
  return row.id;
}

export async function deleteExpense(ctx: RealtyContext, id: string): Promise<void> {
  const row = await prisma.realtyExpense.findFirst({
    where: { id, accountId: ctx.accountId },
    select: { id: true },
  });
  if (!row) throw notFound("ese gasto");
  await prisma.realtyExpense.delete({ where: { id } });
}

// ── Inventario de entrada y de salida ──────────────────────────────────

export interface InventoryItemView {
  id: string;
  checkId: string;
  room: string;
  item: string;
  condition: string;
  photoUrls: string[];
  /** Las rutas crudas del bucket (para volver a firmarlas o borrarlas). */
  photoPaths: string[];
}

export interface InventoryCheckView {
  id: string;
  leaseId: string;
  kind: RealtyInventoryCheckKind;
  performedAt: string;
  signedBy: string | null;
  notes: string | null;
  items: InventoryItemView[];
}

/** Los cuartos que se recorren. Sugerencia, no reja: se puede escribir otro. */
export const REALTY_INVENTORY_ROOMS = [
  "Entrada",
  "Sala",
  "Comedor",
  "Cocina",
  "Recámara principal",
  "Recámara 2",
  "Recámara 3",
  "Baño principal",
  "Baño 2",
  "Área de lavado",
  "Cochera",
  "Patio o jardín",
  "Azotea",
] as const;

/** Los conceptos que se revisan cuarto por cuarto. */
export const REALTY_INVENTORY_ITEMS = [
  "Muros",
  "Pisos",
  "Plafón o techo",
  "Ventanas",
  "Puertas",
  "Clósets",
  "Muebles de cocina",
  "Muebles de baño",
  "Instalación eléctrica",
  "Instalación hidráulica",
  "Instalación de gas",
  "Llaves y cerraduras",
  "Persianas o cortinas",
  "Limpieza general",
] as const;

/** El estado en el que se recibe o se entrega cada concepto. */
export const REALTY_INVENTORY_CONDITIONS = [
  { key: "NUEVO", label: "Nuevo", tone: "success" },
  { key: "BUENO", label: "Buen estado", tone: "success" },
  { key: "USO", label: "Con uso normal", tone: "neutral" },
  { key: "DANADO", label: "Dañado", tone: "warning" },
  { key: "FALTANTE", label: "Falta o no sirve", tone: "danger" },
] as const;

export type RealtyInventoryConditionKey =
  (typeof REALTY_INVENTORY_CONDITIONS)[number]["key"];

export function inventoryConditionRank(condition: string): number {
  const i = REALTY_INVENTORY_CONDITIONS.findIndex((c) => c.key === condition);
  return i < 0 ? 2 : i;
}

export async function listInventoryChecks(
  ctx: RealtyContext,
  leaseId: string,
): Promise<InventoryCheckView[]> {
  const lease = await prisma.realtyLease.findFirst({
    where: { id: leaseId, accountId: ctx.accountId },
    select: { id: true },
  });
  if (!lease) throw notFound("ese contrato");

  const checks = await prisma.realtyInventoryCheck.findMany({
    where: { leaseId, accountId: ctx.accountId },
    select: {
      id: true,
      leaseId: true,
      kind: true,
      performedAt: true,
      signedBy: true,
      notes: true,
      items: {
        select: { id: true, checkId: true, room: true, item: true, condition: true, photoUrls: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ kind: "asc" }, { performedAt: "asc" }],
  });

  const flat: string[] = [];
  const spans: Array<[number, number]> = [];
  for (const c of checks) {
    for (const it of c.items) {
      const start = flat.length;
      for (const u of it.photoUrls ?? []) flat.push(u);
      spans.push([start, flat.length]);
    }
  }
  const signed = await signRealtyPaths(flat);

  let cursor = 0;
  return checks.map((c) => ({
    id: c.id,
    leaseId: c.leaseId,
    kind: c.kind,
    performedAt: c.performedAt.toISOString(),
    signedBy: c.signedBy,
    notes: c.notes,
    items: c.items.map((it) => {
      const [a, b] = spans[cursor++];
      return {
        id: it.id,
        checkId: it.checkId,
        room: it.room,
        item: it.item,
        condition: it.condition,
        photoPaths: it.photoUrls ?? [],
        photoUrls: signed.slice(a, b),
      };
    }),
  }));
}

export interface InventoryCheckInput {
  kind: RealtyInventoryCheckKind;
  performedAt?: string | null;
  signedBy?: string | null;
  notes?: string | null;
  items: Array<{
    id?: string;
    room: string;
    item: string;
    condition: string;
    photoUrls?: string[];
  }>;
}

/**
 * Crea o reemplaza un recorrido. Se guarda COMPLETO de una vez (el recorrido
 * es un acto: se camina la casa y se firma), y volver a guardar reemplaza
 * los renglones — no acumula duplicados de un doble clic.
 */
export async function upsertInventoryCheck(
  ctx: RealtyContext,
  leaseId: string,
  input: InventoryCheckInput,
  checkId?: string,
): Promise<string> {
  const lease = await prisma.realtyLease.findFirst({
    where: { id: leaseId, accountId: ctx.accountId },
    select: { id: true },
  });
  if (!lease) throw notFound("ese contrato");

  const kind: RealtyInventoryCheckKind = input.kind === "SALIDA" ? "SALIDA" : "ENTRADA";
  const performedAt = input.performedAt ? toCalendarDate(input.performedAt) : new Date();
  const items = (input.items ?? [])
    .map((it) => ({
      room: String(it.room ?? "").trim().slice(0, 120),
      item: String(it.item ?? "").trim().slice(0, 160),
      condition: String(it.condition ?? "USO").trim().slice(0, 40),
      photoUrls: keepOwnEvidencePaths(ctx, "inventario", it.photoUrls, 8),
    }))
    .filter((it) => it.room && it.item);

  if (items.length === 0) {
    throw new RealtyLeaseError("Un recorrido sin ningún concepto no sirve como evidencia.");
  }

  return prisma.$transaction(async (tx) => {
    let id = checkId ?? "";
    if (id) {
      const existing = await tx.realtyInventoryCheck.findFirst({
        where: { id, accountId: ctx.accountId, leaseId },
        select: { id: true },
      });
      if (!existing) throw notFound("ese recorrido");
      await tx.realtyInventoryCheck.update({
        where: { id },
        data: {
          kind,
          performedAt: performedAt ?? new Date(),
          signedBy: (input.signedBy ?? "").trim() || null,
          notes: (input.notes ?? "").trim() || null,
        },
      });
      await tx.realtyInventoryItem.deleteMany({ where: { checkId: id, accountId: ctx.accountId } });
    } else {
      const created = await tx.realtyInventoryCheck.create({
        data: {
          accountId: ctx.accountId,
          leaseId,
          kind,
          performedAt: performedAt ?? new Date(),
          signedBy: (input.signedBy ?? "").trim() || null,
          notes: (input.notes ?? "").trim() || null,
        },
        select: { id: true },
      });
      id = created.id;
    }

    await tx.realtyInventoryItem.createMany({
      data: items.map((it) => ({
        accountId: ctx.accountId,
        checkId: id,
        room: it.room,
        item: it.item,
        condition: it.condition,
        photoUrls: it.photoUrls,
      })),
    });

    return id;
  });
}

export interface InventoryComparisonRow {
  room: string;
  item: string;
  entrada: InventoryItemView | null;
  salida: InventoryItemView | null;
  /** PEOR = se deterioró; IGUAL; MEJOR; SOLO_ENTRADA; SOLO_SALIDA. */
  verdict: "PEOR" | "IGUAL" | "MEJOR" | "SOLO_ENTRADA" | "SOLO_SALIDA";
}

export interface InventoryComparison {
  entrada: InventoryCheckView | null;
  salida: InventoryCheckView | null;
  rows: InventoryComparisonRow[];
  worse: number;
  same: number;
  missing: number;
}

/**
 * ENTRADA contra SALIDA, lado a lado. Esta es LA pelea del final de todo
 * contrato: sin esta pantalla, la discusión del depósito es la palabra de
 * uno contra la del otro. Con ella, es una tabla con fotos fechadas.
 *
 * Se toma el recorrido de entrada MÁS ANTIGUO (el de la entrega) y el de
 * salida MÁS RECIENTE (el definitivo).
 */
export async function compareInventory(
  ctx: RealtyContext,
  leaseId: string,
): Promise<InventoryComparison> {
  const checks = await listInventoryChecks(ctx, leaseId);
  const entradas = checks.filter((c) => c.kind === "ENTRADA");
  const salidas = checks.filter((c) => c.kind === "SALIDA");
  const entrada = entradas[0] ?? null;
  const salida = salidas.length > 0 ? salidas[salidas.length - 1] : null;

  const key = (room: string, item: string) =>
    `${room.trim().toLowerCase()}|${item.trim().toLowerCase()}`;

  const map = new Map<string, InventoryComparisonRow>();
  for (const it of entrada?.items ?? []) {
    map.set(key(it.room, it.item), {
      room: it.room,
      item: it.item,
      entrada: it,
      salida: null,
      verdict: "SOLO_ENTRADA",
    });
  }
  for (const it of salida?.items ?? []) {
    const k = key(it.room, it.item);
    const row = map.get(k);
    if (row) {
      row.salida = it;
      const before = inventoryConditionRank(row.entrada!.condition);
      const after = inventoryConditionRank(it.condition);
      row.verdict = after > before ? "PEOR" : after < before ? "MEJOR" : "IGUAL";
    } else {
      map.set(k, { room: it.room, item: it.item, entrada: null, salida: it, verdict: "SOLO_SALIDA" });
    }
  }

  const rows = Array.from(map.values()).sort(
    (a, b) => a.room.localeCompare(b.room, "es") || a.item.localeCompare(b.item, "es"),
  );

  return {
    entrada,
    salida,
    rows,
    worse: rows.filter((r) => r.verdict === "PEOR").length,
    same: rows.filter((r) => r.verdict === "IGUAL").length,
    missing: rows.filter((r) => r.verdict === "SOLO_ENTRADA").length,
  };
}

// ── Cupo de almacenamiento (las fotos cuentan contra el plan) ──────────

export interface StorageState {
  usedBytes: number;
  quotaBytes: number;
  /** -1 = sin límite. */
  unlimited: boolean;
  pct: number;
  full: boolean;
}

export async function getStorageState(ctx: RealtyContext): Promise<StorageState> {
  const account = await prisma.realtyAccount.findFirst({
    where: { id: ctx.accountId },
    select: { storageUsedBytes: true },
  });
  // 🔴 BigInt: JSON.stringify revienta con un BigInt sin convertir.
  const usedBytes = Number(account?.storageUsedBytes ?? 0);
  const quotaMb = ctx.plan.storageQuotaMb;
  const unlimited = quotaMb < 0;
  const quotaBytes = unlimited ? Number.MAX_SAFE_INTEGER : quotaMb * 1024 * 1024;
  const pct = unlimited ? 0 : Math.min(100, Math.round((usedBytes / Math.max(1, quotaBytes)) * 100));
  return { usedBytes, quotaBytes: unlimited ? -1 : quotaBytes, unlimited, pct, full: !unlimited && usedBytes >= quotaBytes };
}

/** Suma (o resta) bytes al consumo de la cuenta. Nunca baja de cero. */
export async function addStorageBytes(ctx: RealtyContext, bytes: number): Promise<void> {
  if (!bytes) return;
  try {
    if (bytes > 0) {
      await prisma.realtyAccount.update({
        where: { id: ctx.accountId },
        data: { storageUsedBytes: { increment: BigInt(Math.round(bytes)) } },
      });
    } else {
      // Un decrement por debajo de cero dejaría el consumo negativo y el
      // porcentaje del plan en un número absurdo.
      const row = await prisma.realtyAccount.findFirst({
        where: { id: ctx.accountId },
        select: { storageUsedBytes: true },
      });
      const current = Number(row?.storageUsedBytes ?? 0);
      const next = Math.max(0, current + Math.round(bytes));
      await prisma.realtyAccount.update({
        where: { id: ctx.accountId },
        data: { storageUsedBytes: BigInt(next) },
      });
    }
  } catch (e) {
    console.warn("[realty/leases] no se pudo actualizar el consumo de espacio:", (e as Error).message);
  }
}

/**
 * Sube una foto de evidencia (inventario o mantenimiento) al bucket
 * PRIVADO y devuelve la RUTA (no una URL): las ligas se firman al leer.
 */
export async function saveEvidencePhoto(
  ctx: RealtyContext,
  args: { scope: "inventario" | "mantenimiento"; ownerId: string; mime: string; body: Uint8Array },
): Promise<{ path: string; bytes: number }> {
  const ext = args.mime === "image/png" ? "png" : args.mime === "image/webp" ? "webp" : "jpg";
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `${args.scope}/${ctx.accountId}/${args.ownerId}/${Date.now()}-${rand}.${ext}`;

  const { error } = await storageAdmin()
    .storage.from(REALTY_FILES_BUCKET)
    .upload(path, args.body, { contentType: args.mime, upsert: false });
  if (error) {
    console.warn("[realty/leases] falló la subida de la foto:", error.message);
    throw new RealtyLeaseError("No se pudo guardar la foto. Inténtalo otra vez.", 500, "UPLOAD");
  }

  await addStorageBytes(ctx, args.body.byteLength);
  return { path, bytes: args.body.byteLength };
}

/**
 * 🔴 Recorta una lista de `photoUrls` que llegó del REQUEST a las rutas que
 * de verdad son de esta cuenta.
 *
 * Sin esto, `photoUrls` era texto libre que acababa en dos sitios peligrosos:
 *
 *  1. `signRealtyPaths`, que firma con la llave de servicio LO QUE SE LE DÉ.
 *     Mandar la ruta de una foto de OTRA cuenta y volver a leer devolvía una
 *     URL firmada válida de un objeto ajeno: el bucket es privado, pero la
 *     reja la pone la app, y la app estaba firmando a ciegas.
 *  2. Un `<img src>` del panel. Una `https://evil.tld/px.gif` guardada aquí
 *     se pinta cada vez que alguien del equipo abre la ficha, y le manda a un
 *     tercero la IP, el navegador y el `Referer` con el id del contrato.
 *
 * La ruta la construye SIEMPRE el servidor (saveEvidencePhoto), y siempre
 * empieza por `<scope>/<accountId>/`. Cualquier otra cosa se tira en
 * silencio: es una ruta que este código nunca pudo haber generado.
 */
export function keepOwnEvidencePaths(
  ctx: RealtyContext,
  scope: "inventario" | "mantenimiento",
  paths: unknown,
  max: number,
): string[] {
  if (!Array.isArray(paths)) return [];
  const prefix = `${scope}/${ctx.accountId}/`;
  const out: string[] = [];
  for (const raw of paths) {
    if (typeof raw !== "string") continue;
    const p = raw.trim();
    // Sin "..": una ruta con salto de directorio podría escaparse del
    // prefijo aunque empiece bien.
    if (!p.startsWith(prefix) || p.includes("..")) continue;
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Una liga que va a acabar en un `href`. Solo http(s): sin esto, un
 * `javascript:…` guardado por alguien del equipo corre con la sesión del
 * que le dé clic (React 18 avisa en consola pero PINTA el atributo).
 */
export function safeExternalUrl(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw.slice(0, 2000);
}

/** Tipo real por firma de bytes: el Content-Type del multipart se puede mentir. */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "image/png";
  }
  const riff = String.fromCharCode(b[0], b[1], b[2], b[3]);
  const webp = String.fromCharCode(b[8], b[9], b[10], b[11]);
  if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  return null;
}

/** Techo del servidor. El navegador ya comprime antes de subir. */
export const EVIDENCE_MAX_BYTES = 4 * 1024 * 1024;

// ── La cola de avisos (el contrato con T6) ─────────────────────────────

/**
 * Arma la lista de avisos que TOCAN HOY para una cuenta. No manda nada: el
 * envío lo hace T6 (WhatsApp) y el correo sale por el stub de abajo.
 *
 * Sale UN aviso por cargo con saldo cuyo vencimiento cae exactamente en uno
 * de los cuatro escalones (−5, 0, +3, +8). Que sea exacto es lo que evita
 * que un cargo viejo genere un aviso cada día para siempre.
 */
export async function buildRentNoticeQueue(args: {
  accountId: string;
  accountName: string;
  timezone: string | null;
  planHasWhatsapp: boolean;
  today?: Date;
  /** Tope por cuenta y corrida, para que un backlog no reviente el cron. */
  limit?: number;
}): Promise<RealtyRentNotice[]> {
  if (!args.accountId) return [];
  const today = args.today ?? todayInTimezone(args.timezone);
  const channels = noticeChannelsFor(args.planHasWhatsapp);

  // Solo hay avisos en una ventana estrecha alrededor de hoy: −5 a +8 días.
  const from = new Date(today.getTime());
  from.setUTCDate(from.getUTCDate() - 8);
  const to = new Date(today.getTime());
  to.setUTCDate(to.getUTCDate() + 5);

  const charges = await prisma.realtyRentCharge.findMany({
    where: {
      accountId: args.accountId,
      dueAt: { gte: from, lte: to },
      status: { in: ["PENDIENTE", "PARCIAL", "VENCIDO"] },
      lease: { status: "ACTIVO" },
    },
    select: {
      id: true,
      leaseId: true,
      periodMonth: true,
      dueAt: true,
      amount: true,
      payments: { select: { amount: true } },
      lease: {
        select: {
          id: true,
          currency: true,
          propertyId: true,
          property: { select: { id: true, title: true } },
          parties: { select: PARTY_SELECT },
        },
      },
    },
    orderBy: { dueAt: "asc" },
    take: Math.min(2000, Math.max(1, args.limit ?? 500)),
  });

  const out: RealtyRentNotice[] = [];
  for (const ch of charges) {
    const step = pickReminderStep(ch.dueAt, today);
    if (!step) continue;

    const paidCents = sumCentsBy(ch.payments ?? [], (p) => p.amount);
    const bal = chargeBalance({
      amount: ch.amount,
      paidCents,
      dueAt: ch.dueAt,
      today,
    });
    if (bal.balanceCents <= 0) continue;

    const parties = (ch.lease?.parties ?? []).map(mapParty);
    const tenant = tenantOf(parties);
    const currency: RealtyCurrency = ch.lease?.currency ?? "MXN";
    const periodLabel = monthLabel(ch.periodMonth);
    const propertyTitle = ch.lease?.property?.title ?? "el inmueble";

    out.push({
      key: noticeKey(ch.id, step.key),
      accountId: args.accountId,
      leaseId: ch.leaseId,
      chargeId: ch.id,
      propertyId: ch.lease?.property?.id ?? ch.lease?.propertyId ?? "",
      propertyTitle,
      contactId: tenant?.contactId ?? null,
      contactName: tenant?.contactName ?? "",
      contactPhone: tenant?.contactPhone ?? null,
      contactEmail: tenant?.contactEmail ?? null,
      step: step.key,
      tone: step.tone,
      periodMonth: ch.periodMonth,
      periodLabel,
      dueAt: ch.dueAt.toISOString(),
      daysLate: bal.daysLate,
      balanceCents: bal.balanceCents,
      currency,
      channels,
      message: buildNoticeMessage({
        step: step.key,
        contactName: tenant?.contactName ?? "",
        propertyTitle,
        periodLabel,
        dueAt: ch.dueAt,
        balanceCents: bal.balanceCents,
        currency,
        landlordName: args.accountName,
        isPartial: bal.paidCents > 0,
      }),
    });
  }

  return out;
}

/**
 * 🔴 STUB TIPADO PARA T6. Esta terminal NO manda WhatsApp: deja la cola
 * armada y esta firma. T6 sustituye el cuerpo por el envío real (y solo el
 * cuerpo: la firma es la frontera entre las dos olas).
 *
 * Hoy hace lo que SÍ le toca a T4:
 *   · correo, cuando el aviso lleva el canal CORREO (plan PROPIETARIO);
 *   · registro en el log estructurado, que es el "pendiente en el panel"
 *     mientras la bandeja no exista.
 * El canal WHATSAPP se devuelve como "pendiente" sin tocar nada del
 * módulo compartido de WhatsApp.
 */
export async function deliverRentNotice(notice: RealtyRentNotice): Promise<{
  delivered: RealtyRentNotice["channels"];
  pending: RealtyRentNotice["channels"];
}> {
  const delivered: RealtyRentNotice["channels"] = [];
  const pending: RealtyRentNotice["channels"] = [];

  for (const channel of notice.channels) {
    if (channel === "CORREO") {
      if (!notice.contactEmail) {
        pending.push(channel);
        continue;
      }
      try {
        const { sendEmail } = await import("@/lib/email");
        const subject =
          notice.daysLate > 0
            ? `Saldo pendiente de la renta — ${notice.periodLabel}`
            : `Recordatorio de pago de renta — ${notice.periodLabel}`;
        const res = await sendEmail({
          to: notice.contactEmail,
          subject,
          html: `<p>${escapeHtml(notice.message).replace(/\n/g, "<br/>")}</p>`,
          text: notice.message,
        });
        if (res.delivered) delivered.push(channel);
        else pending.push(channel);
      } catch (e) {
        console.warn("[realty/leases] no se pudo mandar el correo del aviso:", (e as Error).message);
        pending.push(channel);
      }
      continue;
    }
    if (channel === "PANEL") {
      // El pendiente del panel se calcula en vivo desde los cargos con
      // saldo (getCollectionsBoard). No hay nada que escribir.
      delivered.push(channel);
      continue;
    }
    // WHATSAPP → T6.
    pending.push(channel);
  }

  return { delivered, pending };
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── El barrido diario (lo que corre el cron) ───────────────────────────

export interface RentSweepSummary {
  accounts: number;
  chargesCreated: number;
  chargesMarkedOverdue: number;
  leasesExpired: number;
  notices: number;
  noticesDelivered: number;
  noticesPending: number;
  errors: Array<{ accountId: string; reason: string }>;
}

/**
 * Una pasada por TODAS las cuentas activas (o por una sola, para el botón
 * del panel). Hace tres cosas, en este orden:
 *
 *   1. Genera los cargos que falten de los contratos ACTIVOS (idempotente).
 *   2. Marca VENCIDO lo que ya venció sin ningún abono, y VENCIDO el
 *      contrato cuya fecha de término ya pasó.
 *   3. Arma la cola de avisos del día y la entrega por los canales del plan.
 *
 * Una cuenta que truene NO frena a las demás: try/catch por cuenta.
 */
export async function runRentSweep(only?: string): Promise<RentSweepSummary> {
  const summary: RentSweepSummary = {
    accounts: 0,
    chargesCreated: 0,
    chargesMarkedOverdue: 0,
    leasesExpired: 0,
    notices: 0,
    noticesDelivered: 0,
    noticesPending: 0,
    errors: [],
  };

  const accounts = await prisma.realtyAccount.findMany({
    where: { isActive: true, ...(only ? { id: only } : {}) },
    select: { id: true, name: true, timezone: true, plan: true, subscriptionStatus: true },
    take: 500,
  });

  const { getRealtyPlan } = await import("@/lib/realty/plans");

  for (const account of accounts) {
    try {
      const today = todayInTimezone(account.timezone);
      const plan = await getRealtyPlan(account.plan);

      // Sin la feature de rentas, esta cuenta no tiene nada que barrer.
      if (plan.features.rentals !== true) continue;

      // 🔴 Y sin suscripción al corriente, tampoco. `subscriptionStatus` se
      // seleccionaba y no se leía: una cuenta en past_due o canceled seguía
      // generando cargos y —peor— MANDANDO CORREOS DE COBRANZA a sus
      // inquilinos desde la infraestructura de la plataforma. Eso es cobrar
      // en nombre de quien nos dejó de pagar, con nuestro dominio.
      if (!isRealtySubscriptionActive(account)) continue;

      // 1. Cargos que falten de los contratos ACTIVOS.
      const active = await prisma.realtyLease.findMany({
        where: { accountId: account.id, status: "ACTIVO" },
        select: { id: true, startsAt: true, endsAt: true, paymentDay: true, rentAmount: true },
        take: 1000,
      });
      for (const lease of active) {
        const plan2 = buildChargeSchedule({
          startsAt: lease.startsAt,
          endsAt: lease.endsAt,
          paymentDay: lease.paymentDay,
          rentAmount: lease.rentAmount,
        });
        if (plan2.length === 0) continue;
        const res = await prisma.realtyRentCharge.createMany({
          data: plan2.map((r) => ({
            accountId: account.id,
            leaseId: lease.id,
            periodMonth: r.periodMonth,
            dueAt: r.dueAt,
            amount: centsToDecimal(r.amountCents),
          })),
          skipDuplicates: true,
        });
        summary.chargesCreated += res.count;
      }

      // 2a. Cargos vencidos SIN abonos → VENCIDO.
      //     Los que tienen abono se quedan en PARCIAL a propósito (ver la
      //     nota de prioridad en rent-charges.ts).
      const overdue = await prisma.realtyRentCharge.updateMany({
        where: {
          accountId: account.id,
          status: "PENDIENTE",
          dueAt: { lt: today },
          payments: { none: {} },
        },
        data: { status: "VENCIDO" },
      });
      summary.chargesMarkedOverdue += overdue.count;

      // 2b. Contratos cuya fecha de término ya pasó → VENCIDO (no
      //     TERMINADO: terminar es una decisión de una persona, con su
      //     depósito resuelto y su inventario de salida).
      const expired = await prisma.realtyLease.updateMany({
        where: { accountId: account.id, status: "ACTIVO", endsAt: { lt: today } },
        data: { status: "VENCIDO" },
      });
      summary.leasesExpired += expired.count;

      // 3. Los avisos del día.
      const notices = await buildRentNoticeQueue({
        accountId: account.id,
        accountName: account.name,
        timezone: account.timezone,
        planHasWhatsapp: plan.features.whatsapp === true,
        today,
      });
      summary.notices += notices.length;
      for (const notice of notices) {
        const res = await deliverRentNotice(notice);
        summary.noticesDelivered += res.delivered.length;
        summary.noticesPending += res.pending.length;
      }

      summary.accounts += 1;
    } catch (e) {
      summary.errors.push({
        accountId: account.id,
        reason: e instanceof Error ? e.message : "error desconocido",
      });
      continue;
    }
  }

  return summary;
}

// ── Respuestas estándar de las APIs del área ──────────────────────────
//
// Barber tiene su barberApiError en lib/barber/branches.ts; inmuebles no
// tenía ninguno. Vive aquí (y no en un archivo de la carpeta de rutas)
// para que las cuatro áreas — contratos, pagos, mantenimiento y gastos —
// devuelvan EXACTAMENTE el mismo cuerpo de error.

/** 401 del vertical: no hay sesión de inmobiliaria. */
export function realtyUnauthorized(): NextResponse {
  return NextResponse.json({ error: "No autorizado" }, { status: 401 });
}

/** 403 del vertical: hay sesión pero le falta el permiso. */
export function realtyForbidden(permission?: string): NextResponse {
  return NextResponse.json(
    { error: "No tienes permiso para esta acción.", permission: permission ?? null },
    { status: 403 },
  );
}

/**
 * Traduce un error a su respuesta. RealtyLeaseError trae su status y su
 * mensaje EN ESPAÑOL, escrito para que lo lea el dueño de las casas — no un
 * "Internal error" que no le dice qué hacer. Lo demás es un 500 con el
 * detalle solo en el log del servidor.
 */
export function realtyApiError(err: unknown, tag: string): NextResponse {
  if (err instanceof RealtyLeaseError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  const known = err as { code?: string } | null;
  if (known?.code === "P2002") {
    return NextResponse.json(
      { error: "Ese dato ya estaba registrado.", code: "DUPLICATE" },
      { status: 409 },
    );
  }
  if (known?.code === "P2003") {
    return NextResponse.json(
      {
        error:
          "No se puede borrar: hay dinero o documentos ligados a este registro. Términalo en vez de borrarlo.",
        code: "FK",
      },
      { status: 409 },
    );
  }
  console.error(`[realty/${tag}]`, err);
  return NextResponse.json({ error: "Algo falló de nuestro lado. Inténtalo otra vez." }, { status: 500 });
}

/** Cuerpo JSON tolerante: un body vacío no debe tronar con SyntaxError. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Reexports que las pantallas y las APIs consumen desde un solo sitio.
export { formatCents, monthLabel, todayInTimezone };
