import "server-only";
/* ═══════════════════════════════════════════════════════════════════════
   DaleControl INMUEBLES — PROGRAMA DE SOCIOS.

   Espejo del de barber: quien recomienda gana comisión CUANDO LA CUENTA
   REFERIDA PAGA — no cuando se registra. Un programa que paga por registros
   se llena de cuentas fantasma en una semana.

   ── LAS CUATRO REGLAS QUE SOSTIENEN EL DINERO ────────────────────────
   1. EL MONTO NO ESTÁ EN EL CÓDIGO. Vive en `realty_affiliate_config`, una
      sola fila editable desde el admin. Cambiar la comisión es un UPDATE,
      no un redeploy.
   2. UNA CUENTA, UN PADRINO. `realty_affiliate_referrals` es único por
      cuenta referida: el segundo socio que llegue NO se la roba.
   3. LA REENTREGA NO DEVENGA DOS VECES. `sourceRef` es único, y además se
      comprueba (socio, referida, mes) antes de insertar — porque el
      webhook de Stripe reentrega y el barrido también corre.
   4. NADIE SE REFIERE A SÍ MISMO. Se bloquea en la atribución, no en la UI.

   ── LO QUE NO SE INVENTÓ ─────────────────────────────────────────────
   🔴 El pago al socio NO se dispara desde aquí. Las comisiones nacen
   PENDIENTE y alguien de DaleControl las APRUEBA y las marca PAGADA. No hay
   transferencia automática y no se finge que la haya: `payoutInfo` es texto
   libre (CLABE, nombre del banco) y el pago se hace por fuera. Mismo estado
   que barber, y dicho en el reporte para que nadie lo descubra tarde.
   ═══════════════════════════════════════════════════════════════════════ */
import { createHash, randomInt } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRealtyPlan } from "@/lib/realty/plans";
import { isRealtySubscriptionActive } from "@/lib/realty/plan-shared";
import { isMissingRealtyGrowthTable } from "@/lib/realty/bot/core";
import { newGrowthId, realtyGrowthStorageReady } from "@/lib/realty/bot/growth-db";
import {
  REALTY_AFFILIATE_ALPHABET,
  REALTY_AFFILIATE_CODE_LEN,
  isRealtyAffiliateCode,
  type RealtyAffiliateCommissionDTO,
  type RealtyAffiliateConfigDTO,
  type RealtyAffiliateReferralDTO,
  type RealtyAffiliateSummaryDTO,
  type RealtyCommissionStatus,
} from "@/components/realty/growth/growth-shared";

export class RealtyAffiliateError extends Error {
  readonly code: "NOT_FOUND" | "INVALID" | "STORAGE" | "STATE";
  constructor(code: "NOT_FOUND" | "INVALID" | "STORAGE" | "STATE", message: string) {
    super(message);
    this.name = "RealtyAffiliateError";
    this.code = code;
  }
}

function toNumber(v: unknown): number {
  if (typeof v === "bigint") return Number(v);
  if (v && typeof v === "object" && typeof (v as { toNumber?: unknown }).toNumber === "function") {
    // Prisma.Decimal — NUMERIC(5,2) vuelve como Decimal, no como number.
    return Number((v as { toNumber(): number }).toNumber());
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Centavos → pesos con 2 decimales, para enseñarlo. */
export function centsToMxn(cents: number): number {
  return Math.round(toNumber(cents)) / 100;
}

/* ═══════════════════════════════════════════════════════════════════════
   1. CONFIGURACIÓN DE PLATAFORMA
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Los defaults de esta constante son el ÚNICO lugar del código con números
 * del programa, y solo se usan cuando la tabla todavía no existe (antes de
 * correr sql/realty_growth.sql). En cuanto la fila existe, manda la fila.
 */
export const FALLBACK_REALTY_AFFILIATE_CONFIG: RealtyAffiliateConfigDTO = {
  enabled: true,
  commissionPct: 20,
  commissionMonths: 12,
  cookieDays: 60,
  payoutMinMxn: 500,
  terms: null,
};

export async function getRealtyAffiliateConfig(): Promise<RealtyAffiliateConfigDTO> {
  try {
    const rows = await prisma.$queryRaw<
      {
        enabled: boolean;
        commissionPct: unknown;
        commissionMonths: number;
        cookieDays: number;
        payoutMinCents: number;
        terms: string | null;
      }[]
    >(
      Prisma.sql`SELECT enabled, "commissionPct", "commissionMonths", "cookieDays",
                        "payoutMinCents", terms
                 FROM realty_affiliate_config WHERE id = 'default' LIMIT 1`,
    );
    const r = rows?.[0];
    if (!r) return { ...FALLBACK_REALTY_AFFILIATE_CONFIG };
    return {
      enabled: r.enabled === true,
      commissionPct: toNumber(r.commissionPct),
      commissionMonths: Math.trunc(toNumber(r.commissionMonths)),
      cookieDays: Math.trunc(toNumber(r.cookieDays)),
      payoutMinMxn: centsToMxn(r.payoutMinCents),
      terms: r.terms ?? null,
    };
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/affiliates] no se pudo leer la configuración:", err);
    }
    return { ...FALLBACK_REALTY_AFFILIATE_CONFIG };
  }
}

export interface RealtyAffiliateConfigPatch {
  enabled?: boolean;
  commissionPct?: number;
  commissionMonths?: number;
  cookieDays?: number;
  payoutMinMxn?: number;
  terms?: string | null;
}

/**
 * Guarda la configuración. LISTA BLANCA de campos, nunca un spread del
 * body, y cada número acotado: un 900 % de comisión escrito por error en el
 * admin es dinero que el sistema promete y nadie puede pagar.
 */
export async function saveRealtyAffiliateConfig(
  patch: RealtyAffiliateConfigPatch,
): Promise<RealtyAffiliateConfigDTO> {
  if (!(await realtyGrowthStorageReady())) {
    throw new RealtyAffiliateError("STORAGE", "Falta aplicar sql/realty_growth.sql en la base.");
  }
  const current = await getRealtyAffiliateConfig();

  const clamp = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };

  const enabled = typeof patch.enabled === "boolean" ? patch.enabled : current.enabled;
  // Dos decimales: 12.5 % es un número real de un programa de socios.
  const commissionPct =
    patch.commissionPct === undefined
      ? current.commissionPct
      : Math.round(clamp(patch.commissionPct, 0, 100, current.commissionPct) * 100) / 100;
  // -1 = mientras siga pagando. Cualquier otro negativo cae al default.
  const rawMonths =
    patch.commissionMonths === undefined ? current.commissionMonths : Number(patch.commissionMonths);
  const commissionMonths =
    rawMonths === -1 ? -1 : Math.trunc(clamp(rawMonths, 0, 120, current.commissionMonths));
  const cookieDays = Math.trunc(
    clamp(patch.cookieDays ?? current.cookieDays, 1, 365, current.cookieDays),
  );
  const payoutMinCents = Math.round(
    clamp(patch.payoutMinMxn ?? current.payoutMinMxn, 0, 100_000, current.payoutMinMxn) * 100,
  );
  const terms =
    patch.terms === undefined
      ? current.terms
      : String(patch.terms ?? "").trim().slice(0, 4000) || null;

  await prisma.$executeRaw(
    Prisma.sql`INSERT INTO realty_affiliate_config
                 (id, enabled, "commissionPct", "commissionMonths", "cookieDays",
                  "payoutMinCents", terms, "updatedAt")
               VALUES ('default', ${enabled}, ${commissionPct}, ${commissionMonths},
                       ${cookieDays}, ${payoutMinCents}, ${terms}, CURRENT_TIMESTAMP)
               ON CONFLICT (id) DO UPDATE SET
                 enabled = EXCLUDED.enabled,
                 "commissionPct" = EXCLUDED."commissionPct",
                 "commissionMonths" = EXCLUDED."commissionMonths",
                 "cookieDays" = EXCLUDED."cookieDays",
                 "payoutMinCents" = EXCLUDED."payoutMinCents",
                 terms = EXCLUDED.terms,
                 "updatedAt" = CURRENT_TIMESTAMP`,
  );

  return getRealtyAffiliateConfig();
}

/* ═══════════════════════════════════════════════════════════════════════
   2. EL SOCIO Y SU CÓDIGO
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Código de 8 caracteres SIN ambigüedades visuales (sin I, O, 0, 1). Se
 * genera con `randomInt` (CSPRNG) y no con Math.random: un código adivinable
 * es una comisión que se le puede robar a alguien.
 */
function generateAffiliateCode(): string {
  let out = "";
  for (let i = 0; i < REALTY_AFFILIATE_CODE_LEN; i++) {
    out += REALTY_AFFILIATE_ALPHABET[randomInt(REALTY_AFFILIATE_ALPHABET.length)];
  }
  return out;
}

/** La liga que el socio comparte. Pasa por /api/realty/affiliates/r/<code>. */
export function realtyAffiliateLink(code: string): string | null {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/api/realty/affiliates/r/${code}`;
}

export interface RealtyAffiliateRow {
  id: string;
  accountId: string;
  code: string;
  status: "ACTIVO" | "SUSPENDIDO";
  payoutInfo: string | null;
}

export async function getRealtyAffiliate(accountId: string): Promise<RealtyAffiliateRow | null> {
  try {
    const rows = await prisma.$queryRaw<RealtyAffiliateRow[]>(
      Prisma.sql`SELECT id, "accountId", code, status, "payoutInfo"
                 FROM realty_affiliates WHERE "accountId" = ${accountId} LIMIT 1`,
    );
    return rows?.[0] ?? null;
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/affiliates] no se pudo leer el socio:", err);
    }
    return null;
  }
}

/**
 * Da de alta a la cuenta como socia (o devuelve la que ya era). Reintenta si
 * el código chocó: el alfabeto tiene 32^8 ≈ 1.1 billones de combinaciones,
 * así que tres intentos sobran, pero "sobran" no es "no puede pasar".
 */
export async function ensureRealtyAffiliate(accountId: string): Promise<RealtyAffiliateRow> {
  if (!(await realtyGrowthStorageReady())) {
    throw new RealtyAffiliateError("STORAGE", "Falta aplicar sql/realty_growth.sql en la base.");
  }
  const existing = await getRealtyAffiliate(accountId);
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateAffiliateCode();
    try {
      await prisma.$executeRaw(
        Prisma.sql`INSERT INTO realty_affiliates (id,"accountId",code,status,"createdAt","updatedAt")
                   VALUES (${newGrowthId()}, ${accountId}, ${code}, 'ACTIVO',
                           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                   ON CONFLICT ("accountId") DO NOTHING`,
      );
      const row = await getRealtyAffiliate(accountId);
      if (row) return row;
    } catch (err) {
      // Choque de `code` (el otro único). Se reintenta con otro código.
      if (isMissingRealtyGrowthTable(err)) throw err;
    }
  }
  throw new RealtyAffiliateError("STATE", "No se pudo generar tu código. Inténtalo otra vez.");
}

export async function saveRealtyAffiliatePayoutInfo(
  accountId: string,
  payoutInfo: string,
): Promise<boolean> {
  const clean = String(payoutInfo ?? "").trim().slice(0, 400);
  const n = await prisma.$executeRaw(
    Prisma.sql`UPDATE realty_affiliates
               SET "payoutInfo" = ${clean || null}, "updatedAt" = CURRENT_TIMESTAMP
               WHERE "accountId" = ${accountId}`,
  );
  return toNumber(n) > 0;
}

/* ═══════════════════════════════════════════════════════════════════════
   3. ATRIBUCIÓN — del clic a la cuenta referida
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * La IP se guarda HASHEADA y nunca en claro. Sirve para una sola cosa
 * legítima —ver si cien clics vienen del mismo sitio— y guardarla en claro
 * convertiría la tabla en un registro de navegación de gente que ni siquiera
 * es cliente.
 */
export function hashIp(ip: string | null | undefined): string | null {
  const raw = String(ip ?? "").trim();
  if (!raw) return null;
  const salt = process.env.REALTY_AFF_IP_SALT || process.env.CRON_SECRET || "dc-realty";
  return createHash("sha256").update(`${salt}:${raw}`).digest("hex").slice(0, 32);
}

/**
 * Bots que no deben contar como visita. Es una heurística deliberadamente
 * corta: marcar de más infla el "no contó" y marcar de menos infla el
 * embudo. Lo que importa es que el clic SE GUARDA igual, con `isBot` — el
 * dato no se tira, se etiqueta.
 */
const BOT_UA = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|slackbot|bingpreview|headless|curl|wget|python-requests|axios|monitor|pingdom|uptime/i;

export function looksLikeBot(userAgent: string | null | undefined): boolean {
  const ua = String(userAgent ?? "");
  if (!ua.trim()) return true; // sin user-agent no es una persona con navegador
  return BOT_UA.test(ua);
}

export interface RealtyClickResult {
  ok: boolean;
  /** El código EXISTE y está activo. false = la liga no sirve. */
  known: boolean;
  isBot: boolean;
}

/**
 * Registra el clic. El único (code, vid, día) hace que F5 no infle el
 * contador: el mismo visitante, el mismo día, el mismo socio, cuenta UNA vez.
 *
 * NUNCA lanza: un fallo aquí no puede impedir que el visitante llegue a la
 * página de registro. Perder un clic es un dato; perder un registro es un
 * cliente.
 */
export async function recordRealtyAffiliateClick(args: {
  code: string;
  vid: string;
  ip: string | null;
  userAgent: string | null;
  now?: Date;
}): Promise<RealtyClickResult> {
  const code = String(args.code ?? "").trim().toUpperCase();
  const out: RealtyClickResult = { ok: false, known: false, isBot: looksLikeBot(args.userAgent) };
  if (!isRealtyAffiliateCode(code)) return out;

  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM realty_affiliates
                 WHERE code = ${code} AND status = 'ACTIVO' LIMIT 1`,
    );
    if (!rows?.[0]) return out;
    out.known = true;

    const day = (args.now ?? new Date()).toISOString().slice(0, 10);
    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO realty_affiliate_clicks
                   (id, code, vid, day, "ipHash", "userAgent", "isBot", "landedAt")
                 VALUES (${newGrowthId()}, ${code}, ${String(args.vid ?? "").slice(0, 64)},
                         ${day}::date, ${hashIp(args.ip)},
                         ${String(args.userAgent ?? "").slice(0, 300) || null},
                         ${out.isBot}, CURRENT_TIMESTAMP)
                 ON CONFLICT (code, vid, day) DO NOTHING`,
    );
    out.ok = true;
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/affiliates] no se pudo registrar el clic:", err);
    }
  }
  return out;
}

export type RealtyAttributionOutcome =
  | "attributed"
  | "alreadyAttributed"
  | "selfReferral"
  | "unknownCode"
  | "disabled"
  | "storageMissing";

/**
 * Cuelga una cuenta recién creada de su padrino.
 *
 * 🔴 IDEMPOTENTE Y DE UNA SOLA VEZ. El único de la tabla es por cuenta
 * REFERIDA: si ya tiene padrino, esta llamada devuelve `alreadyAttributed` y
 * no cambia nada. Se puede llamar en cada carga del panel sin miedo — es
 * exactamente como está pensada para engancharse.
 */
export async function attributeRealtyReferral(args: {
  code: string;
  referredAccountId: string;
}): Promise<RealtyAttributionOutcome> {
  const code = String(args.code ?? "").trim().toUpperCase();
  if (!isRealtyAffiliateCode(code)) return "unknownCode";
  if (!(await realtyGrowthStorageReady())) return "storageMissing";

  const config = await getRealtyAffiliateConfig();
  if (!config.enabled) return "disabled";

  try {
    const rows = await prisma.$queryRaw<{ id: string; accountId: string }[]>(
      Prisma.sql`SELECT id, "accountId" FROM realty_affiliates
                 WHERE code = ${code} AND status = 'ACTIVO' LIMIT 1`,
    );
    const affiliate = rows?.[0];
    if (!affiliate) return "unknownCode";
    // Nadie se refiere a sí mismo. Se bloquea aquí y no en la pantalla.
    if (affiliate.accountId === args.referredAccountId) return "selfReferral";

    const n = await prisma.$executeRaw(
      Prisma.sql`INSERT INTO realty_affiliate_referrals
                   (id,"affiliateId","referredAccountId","attributedAt","createdAt")
                 VALUES (${newGrowthId()}, ${affiliate.id}, ${args.referredAccountId},
                         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                 ON CONFLICT ("referredAccountId") DO NOTHING`,
    );
    return toNumber(n) > 0 ? "attributed" : "alreadyAttributed";
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/affiliates] no se pudo atribuir:", err);
    }
    return "storageMissing";
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   4. LA COMISIÓN — nace cuando la referida PAGA
   ═══════════════════════════════════════════════════════════════════════ */

export interface AccrueCommissionResult {
  created: boolean;
  reason:
    | "ok"
    | "sinPadrino"
    | "programaApagado"
    | "yaDevengada"
    | "mesesAgotados"
    | "montoCero"
    | "storageMissing";
  commissionId: string | null;
  amountCents: number;
}

/** "YYYY-MM" de una fecha, en UTC. El mes de cobro no depende de la zona. */
export function periodMonthOf(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/**
 * ⭐ EL PUNTO ÚNICO donde nace una comisión.
 *
 * Se llama con lo que la cuenta referida PAGÓ. `sourceRef` es el id de la
 * factura de Stripe cuando existe: es único en la base, así que la
 * reentrega del webhook no devenga dos veces. Cuando no hay factura (el
 * barrido mensual), se manda un `sourceRef` derivado del mes — y además se
 * comprueba (socio, referida, mes) antes de insertar, porque los dos
 * caminos pueden coincidir en el mismo mes.
 */
export async function accrueRealtyAffiliateCommission(args: {
  referredAccountId: string;
  baseCents: number;
  periodMonth?: string;
  sourceRef?: string | null;
  currency?: string;
}): Promise<AccrueCommissionResult> {
  const out: AccrueCommissionResult = {
    created: false,
    reason: "storageMissing",
    commissionId: null,
    amountCents: 0,
  };
  if (!(await realtyGrowthStorageReady())) return out;

  const config = await getRealtyAffiliateConfig();
  if (!config.enabled) return { ...out, reason: "programaApagado" };

  const periodMonth = args.periodMonth ?? periodMonthOf(new Date());

  try {
    const refs = await prisma.$queryRaw<{ id: string; affiliateId: string; firstPaidAt: Date | null }[]>(
      Prisma.sql`SELECT r.id, r."affiliateId", r."firstPaidAt"
                 FROM realty_affiliate_referrals r
                 JOIN realty_affiliates a ON a.id = r."affiliateId"
                 WHERE r."referredAccountId" = ${args.referredAccountId}
                   AND a.status = 'ACTIVO'
                 LIMIT 1`,
    );
    const referral = refs?.[0];
    if (!referral) return { ...out, reason: "sinPadrino" };

    // ¿Cuántos meses lleva cobrados? -1 = sin tope.
    if (config.commissionMonths !== -1) {
      const counted = await prisma.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT COUNT(*)::bigint AS n FROM realty_affiliate_commissions
                   WHERE "affiliateId" = ${referral.affiliateId}
                     AND "referredAccountId" = ${args.referredAccountId}
                     AND status <> 'CANCELADA'`,
      );
      if (toNumber(counted?.[0]?.n) >= config.commissionMonths) {
        return { ...out, reason: "mesesAgotados" };
      }
    }

    // Ya devengada este mes por el OTRO camino (webhook vs barrido).
    const dup = await prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM realty_affiliate_commissions
                 WHERE "affiliateId" = ${referral.affiliateId}
                   AND "referredAccountId" = ${args.referredAccountId}
                   AND "periodMonth" = ${periodMonth}
                   AND status <> 'CANCELADA'
                 LIMIT 1`,
    );
    if (dup?.[0]) return { ...out, reason: "yaDevengada" };

    const baseCents = Math.max(0, Math.round(toNumber(args.baseCents)));
    const amountCents = Math.round((baseCents * config.commissionPct) / 100);
    if (amountCents <= 0) return { ...out, reason: "montoCero" };

    const id = newGrowthId();
    const inserted = await prisma.$executeRaw(
      Prisma.sql`INSERT INTO realty_affiliate_commissions
                   (id,"affiliateId","referredAccountId","amountCents",currency,"baseCents",
                    "commissionPct","periodMonth",status,"sourceRef","createdAt","updatedAt")
                 VALUES (${id}, ${referral.affiliateId}, ${args.referredAccountId},
                         ${amountCents}, ${args.currency ?? "MXN"}, ${baseCents},
                         ${config.commissionPct}, ${periodMonth}, 'PENDIENTE',
                         ${args.sourceRef ?? `auto:${referral.id}:${periodMonth}`},
                         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                 ON CONFLICT ("sourceRef") DO NOTHING`,
    );
    if (toNumber(inserted) <= 0) return { ...out, reason: "yaDevengada" };

    // La primera comisión marca la fecha del primer pago de la referida.
    if (!referral.firstPaidAt) {
      await prisma.$executeRaw(
        Prisma.sql`UPDATE realty_affiliate_referrals
                   SET "firstPaidAt" = CURRENT_TIMESTAMP
                   WHERE id = ${referral.id} AND "firstPaidAt" IS NULL`,
      );
    }

    return { created: true, reason: "ok", commissionId: id, amountCents };
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/affiliates] no se pudo devengar la comisión:", err);
    }
    return out;
  }
}

export interface RealtyAffiliateSweepResult {
  referrals: number;
  accrued: number;
  amountMxn: number;
}

/**
 * BARRIDO MENSUAL — la red de seguridad.
 *
 * 🔴 POR QUÉ EXISTE: el punto correcto para devengar es el webhook de
 * Stripe del vertical (`src/app/api/realty/stripe/**`), que es de OTRA
 * terminal y no se toca desde aquí. Mientras esa línea no exista, este
 * barrido devenga una comisión al mes por cada cuenta referida que está AL
 * CORRIENTE, usando el precio de su plan como base.
 *
 * Es una APROXIMACIÓN honesta, y por eso la comisión nace PENDIENTE: nadie
 * cobra sin que una persona la apruebe. El día que el webhook llame a
 * `accrueRealtyAffiliateCommission` con la factura real, este barrido deja
 * de encontrar trabajo solo (comprueba el mes antes de insertar).
 */
export async function sweepRealtyAffiliateCommissions(
  now = new Date(),
): Promise<RealtyAffiliateSweepResult> {
  const out: RealtyAffiliateSweepResult = { referrals: 0, accrued: 0, amountMxn: 0 };
  if (!(await realtyGrowthStorageReady())) return out;

  const config = await getRealtyAffiliateConfig();
  if (!config.enabled) return out;

  let rows: { referredAccountId: string }[] = [];
  try {
    rows = await prisma.$queryRaw<{ referredAccountId: string }[]>(
      Prisma.sql`SELECT r."referredAccountId"
                 FROM realty_affiliate_referrals r
                 JOIN realty_affiliates a ON a.id = r."affiliateId"
                 WHERE a.status = 'ACTIVO'`,
    );
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/affiliates] barrido: no se pudo listar referidas:", err);
    }
    return out;
  }

  const periodMonth = periodMonthOf(now);
  out.referrals = rows.length;

  for (const row of rows) {
    const account = await prisma.realtyAccount.findUnique({
      where: { id: row.referredAccountId },
      select: { id: true, plan: true, subscriptionStatus: true, isActive: true },
    });
    // Solo devenga quien está pagando. `isRealtySubscriptionActive` es el
    // punto único del vertical: no se copia aquí la lista de estados.
    if (!account || !account.isActive) continue;
    if (!isRealtySubscriptionActive({ subscriptionStatus: account.subscriptionStatus })) continue;

    const plan = await getRealtyPlan(account.plan);
    const baseCents = Math.round(toNumber(plan.priceMonthly) * 100);
    const res = await accrueRealtyAffiliateCommission({
      referredAccountId: account.id,
      baseCents,
      periodMonth,
    });
    if (res.created) {
      out.accrued += 1;
      out.amountMxn += centsToMxn(res.amountCents);
    }
  }

  out.amountMxn = Math.round(out.amountMxn * 100) / 100;
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════
   5. LO QUE VE EL SOCIO
   ═══════════════════════════════════════════════════════════════════════ */

const EMPTY_SUMMARY_FUNNEL = { clicks: 0, referrals: 0, paying: 0 };

/**
 * Todo el panel del socio en una llamada.
 *
 * Si la tabla no existe todavía, devuelve `storageReady: false` con la
 * configuración de respaldo y la pantalla dice qué falta — nunca truena.
 */
export async function getRealtyAffiliateSummary(
  accountId: string,
): Promise<RealtyAffiliateSummaryDTO> {
  const config = await getRealtyAffiliateConfig();
  const storageReady = await realtyGrowthStorageReady();

  const base: RealtyAffiliateSummaryDTO = {
    code: null,
    link: null,
    status: null,
    config,
    storageReady,
    funnel: { ...EMPTY_SUMMARY_FUNNEL },
    earnings: { pendingMxn: 0, availableMxn: 0, paidMxn: 0, totalMxn: 0 },
    referrals: [],
    commissions: [],
    payoutInfo: null,
  };
  if (!storageReady) return base;

  const affiliate = await getRealtyAffiliate(accountId);
  if (!affiliate) return base;

  base.code = affiliate.code;
  base.link = realtyAffiliateLink(affiliate.code);
  base.status = affiliate.status;
  base.payoutInfo = affiliate.payoutInfo;

  try {
    // Clics de PERSONAS. Los de bot se guardaron etiquetados y no se cuentan
    // en el embudo: inflar el numerador hace que el socio crea que su liga
    // funciona cuando lo que la visitó fue un rastreador.
    const clicks = await prisma.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT COUNT(*)::bigint AS n FROM realty_affiliate_clicks
                 WHERE code = ${affiliate.code} AND "isBot" = false`,
    );
    base.funnel.clicks = toNumber(clicks?.[0]?.n);

    const referralRows = await prisma.$queryRaw<
      {
        id: string;
        referredAccountId: string;
        attributedAt: Date;
        firstPaidAt: Date | null;
        accountName: string;
        plan: string;
        subscriptionStatus: string;
        isActive: boolean;
        earnedCents: bigint | null;
      }[]
    >(
      Prisma.sql`SELECT r.id, r."referredAccountId", r."attributedAt", r."firstPaidAt",
                        acc.name AS "accountName", acc.plan::text AS plan,
                        acc."subscriptionStatus", acc."isActive",
                        (SELECT COALESCE(SUM(c."amountCents"), 0)::bigint
                           FROM realty_affiliate_commissions c
                          WHERE c."referredAccountId" = r."referredAccountId"
                            AND c."affiliateId" = r."affiliateId"
                            AND c.status <> 'CANCELADA') AS "earnedCents"
                   FROM realty_affiliate_referrals r
                   JOIN realty_accounts acc ON acc.id = r."referredAccountId"
                  WHERE r."affiliateId" = ${affiliate.id}
                  ORDER BY r."attributedAt" DESC
                  LIMIT 200`,
    );

    base.funnel.referrals = referralRows.length;

    const plans = new Map<string, string>();
    base.referrals = await Promise.all(
      referralRows.map(async (r): Promise<RealtyAffiliateReferralDTO> => {
        if (!plans.has(r.plan)) {
          const p = await getRealtyPlan(r.plan);
          plans.set(r.plan, p?.name ?? r.plan);
        }
        const paying =
          r.isActive && isRealtySubscriptionActive({ subscriptionStatus: r.subscriptionStatus });
        if (paying) base.funnel.paying += 1;
        return {
          id: r.id,
          // 🔴 SOLO EL NOMBRE. El socio no ve el correo, el teléfono ni el
          // id de Stripe de la cuenta que refirió: refirió a alguien, no lo
          // compró. Ampliar esto es una fuga, no una mejora.
          accountName: r.accountName,
          planName: plans.get(r.plan) ?? null,
          status: paying ? "PAGANDO" : r.firstPaidAt ? "SE_FUE" : "REGISTRADA",
          attributedAt: toIso(r.attributedAt) ?? new Date(0).toISOString(),
          firstPaidAt: toIso(r.firstPaidAt),
          earnedMxn: centsToMxn(toNumber(r.earnedCents)),
        };
      }),
    );

    const commissionRows = await prisma.$queryRaw<
      {
        id: string;
        amountCents: number;
        baseCents: number;
        commissionPct: unknown;
        periodMonth: string;
        status: string;
        paidAt: Date | null;
        createdAt: Date;
        accountName: string;
      }[]
    >(
      Prisma.sql`SELECT c.id, c."amountCents", c."baseCents", c."commissionPct",
                        c."periodMonth", c.status, c."paidAt", c."createdAt",
                        acc.name AS "accountName"
                   FROM realty_affiliate_commissions c
                   JOIN realty_accounts acc ON acc.id = c."referredAccountId"
                  WHERE c."affiliateId" = ${affiliate.id}
                  ORDER BY c."createdAt" DESC
                  LIMIT 200`,
    );

    base.commissions = commissionRows.map(
      (c): RealtyAffiliateCommissionDTO => ({
        id: c.id,
        referredAccountName: c.accountName,
        amountMxn: centsToMxn(toNumber(c.amountCents)),
        baseMxn: centsToMxn(toNumber(c.baseCents)),
        commissionPct: toNumber(c.commissionPct),
        periodMonth: c.periodMonth,
        status: (c.status as RealtyCommissionStatus) ?? "PENDIENTE",
        paidAt: toIso(c.paidAt),
        createdAt: toIso(c.createdAt) ?? new Date(0).toISOString(),
      }),
    );

    for (const c of base.commissions) {
      if (c.status === "PENDIENTE") base.earnings.pendingMxn += c.amountMxn;
      else if (c.status === "APROBADA") base.earnings.availableMxn += c.amountMxn;
      else if (c.status === "PAGADA") base.earnings.paidMxn += c.amountMxn;
    }
    const round2 = (n: number) => Math.round(n * 100) / 100;
    base.earnings.pendingMxn = round2(base.earnings.pendingMxn);
    base.earnings.availableMxn = round2(base.earnings.availableMxn);
    base.earnings.paidMxn = round2(base.earnings.paidMxn);
    base.earnings.totalMxn = round2(
      base.earnings.pendingMxn + base.earnings.availableMxn + base.earnings.paidMxn,
    );
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/affiliates] no se pudo armar el resumen:", err);
    }
  }

  return base;
}

/* ═══════════════════════════════════════════════════════════════════════
   6. LO QUE VE EL ADMIN DE DALECONTROL
   ═══════════════════════════════════════════════════════════════════════ */

export interface AdminRealtyCommissionRow {
  id: string;
  affiliateCode: string;
  affiliateAccountName: string;
  referredAccountName: string;
  amountMxn: number;
  baseMxn: number;
  commissionPct: number;
  periodMonth: string;
  status: RealtyCommissionStatus;
  payoutInfo: string | null;
  paidAt: string | null;
  createdAt: string;
}

export async function listRealtyCommissionsForAdmin(
  filter: { status?: RealtyCommissionStatus | "TODAS"; limit?: number } = {},
): Promise<AdminRealtyCommissionRow[]> {
  if (!(await realtyGrowthStorageReady())) return [];
  const limit = Math.min(500, Math.max(1, Math.floor(filter.limit ?? 200)));
  const status = filter.status && filter.status !== "TODAS" ? filter.status : null;

  try {
    const rows = await prisma.$queryRaw<
      {
        id: string;
        code: string;
        affiliateAccountName: string;
        referredAccountName: string;
        amountCents: number;
        baseCents: number;
        commissionPct: unknown;
        periodMonth: string;
        status: string;
        payoutInfo: string | null;
        paidAt: Date | null;
        createdAt: Date;
      }[]
    >(
      Prisma.sql`SELECT c.id, a.code, aff.name AS "affiliateAccountName",
                        ref.name AS "referredAccountName", c."amountCents", c."baseCents",
                        c."commissionPct", c."periodMonth", c.status, a."payoutInfo",
                        c."paidAt", c."createdAt"
                   FROM realty_affiliate_commissions c
                   JOIN realty_affiliates a   ON a.id  = c."affiliateId"
                   JOIN realty_accounts   aff ON aff.id = a."accountId"
                   JOIN realty_accounts   ref ON ref.id = c."referredAccountId"
                  WHERE (${status}::text IS NULL OR c.status = ${status})
                  ORDER BY c."createdAt" DESC
                  LIMIT ${limit}`,
    );
    return rows.map((r) => ({
      id: r.id,
      affiliateCode: r.code,
      affiliateAccountName: r.affiliateAccountName,
      referredAccountName: r.referredAccountName,
      amountMxn: centsToMxn(toNumber(r.amountCents)),
      baseMxn: centsToMxn(toNumber(r.baseCents)),
      commissionPct: toNumber(r.commissionPct),
      periodMonth: r.periodMonth,
      status: (r.status as RealtyCommissionStatus) ?? "PENDIENTE",
      payoutInfo: r.payoutInfo,
      paidAt: toIso(r.paidAt),
      createdAt: toIso(r.createdAt) ?? new Date(0).toISOString(),
    }));
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/affiliates] no se pudieron listar las comisiones:", err);
    }
    return [];
  }
}

/**
 * Cambia el estado de un lote de comisiones. Las transiciones permitidas son
 * las del CHECK de la base, y el orden importa:
 *   PENDIENTE → APROBADA → PAGADA, y CANCELADA desde cualquiera menos PAGADA.
 *
 * 🔴 De PAGADA no se sale. Marcar como pagada es decir "ya le transferí";
 * dejar que eso se deshaga con un clic es la forma más fácil de pagar dos
 * veces o de borrar la evidencia de que se pagó.
 */
export async function setRealtyCommissionStatus(args: {
  ids: string[];
  status: RealtyCommissionStatus;
}): Promise<number> {
  const ids = (args.ids ?? []).map((s) => String(s)).filter(Boolean).slice(0, 500);
  if (ids.length === 0) return 0;

  const allowedFrom: Record<RealtyCommissionStatus, string[]> = {
    PENDIENTE: ["APROBADA"],
    APROBADA: ["PENDIENTE"],
    PAGADA: ["APROBADA"],
    CANCELADA: ["PENDIENTE", "APROBADA"],
  };
  const from = allowedFrom[args.status];
  if (!from) throw new RealtyAffiliateError("INVALID", "Estado no válido.");

  const paidAt = args.status === "PAGADA" ? new Date() : null;
  const n = await prisma.$executeRaw(
    Prisma.sql`UPDATE realty_affiliate_commissions
               SET status = ${args.status},
                   "paidAt" = ${paidAt},
                   "updatedAt" = CURRENT_TIMESTAMP
               WHERE id IN (${Prisma.join(ids)})
                 AND status IN (${Prisma.join(from)})`,
  );
  return toNumber(n);
}

/**
 * Cancela las comisiones de una cuenta que se fue o pidió reembolso. Se usa
 * desde el admin; no se dispara sola con un `payment_failed` (un cobro que
 * falla y se reintenta al día siguiente NO es un reembolso — la misma
 * lección que costó suspender cuentas de más en el dental).
 */
export async function cancelRealtyCommissionsForAccount(
  referredAccountId: string,
  periodMonth?: string,
): Promise<number> {
  const n = await prisma.$executeRaw(
    Prisma.sql`UPDATE realty_affiliate_commissions
               SET status = 'CANCELADA', "updatedAt" = CURRENT_TIMESTAMP
               WHERE "referredAccountId" = ${referredAccountId}
                 AND status IN ('PENDIENTE', 'APROBADA')
                 AND (${periodMonth ?? null}::text IS NULL OR "periodMonth" = ${periodMonth ?? null})`,
  );
  return toNumber(n);
}
