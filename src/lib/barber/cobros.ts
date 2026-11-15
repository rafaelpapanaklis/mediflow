import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isMissingTableError, isSchemaBehindError } from "@/lib/barber/db-errors";
import { BARBER_ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/barber/plan-shared";
import {
  BARBER_COBRO_TZ,
  BARBER_VENCIDA_STATUS,
  barberiaVencida,
  mensualDesdeCentavos,
  pesosDesdeCentavos,
  periodoPagadoVencido,
  corteAplica,
  type BarberCobro,
  type BarberCobroInterval,
  type BarberLedger,
  type BarberSuscripcionTerminos,
} from "@/lib/barber/cobros-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — registro de COBROS (sql/barber_cobros.sql).
 *
 * Todo con SQL parametrizado ($queryRaw / $executeRaw): las dos tablas son
 * nuevas y el código tiene que funcionar ANTES de que se peguen y aunque el
 * cliente Prisma no se haya regenerado. Si la tabla no existe, cada función
 * degrada a «sin registro» (null / no-op) y lo demás sigue como hasta hoy:
 *   · el webhook responde 200 (no tiene dónde guardar; no tiene caso que
 *     Stripe reintente tres días) y lo deja en el log;
 *   · el corte por fecha no aplica (sin cobros no hay «pagado hasta»);
 *   · el admin cae al cálculo de antes, rotulado «a precio de lista».
 * Cualquier OTRO error se lanza: el webhook responde 500 y Stripe reintenta.
 * ═══════════════════════════════════════════════════════════════════════
 */

const ACTIVOS = Array.from(BARBER_ACTIVE_SUBSCRIPTION_STATUSES);

function sinTabla(e: unknown): boolean {
  return isMissingTableError(e) || isSchemaBehindError(e);
}

function fecha(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── Lectura del registro de UNA barbería ─────────────────────────────────

/** null = tablas sin pegar. Un registro con todo null = barbería sin cobros. */
export async function leerRegistroBarber(barbershopId: string): Promise<BarberLedger | null> {
  if (!barbershopId) return null;
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        paid_through: Date | null;
        last_paid: Date | null;
        manual: Date | null;
        stripe_status: string | null;
        stripe_period_end: Date | null;
      }>
    >(Prisma.sql`
      SELECT
        (SELECT max(p.period_end) FROM barber_subscription_payments p
          WHERE p.barbershop_id = ${barbershopId} AND p.status = 'paid') AS paid_through,
        (SELECT max(p.paid_at) FROM barber_subscription_payments p
          WHERE p.barbershop_id = ${barbershopId} AND p.status = 'paid') AS last_paid,
        (SELECT s.manual_access_at FROM barber_subscriptions s
          WHERE s.barbershop_id = ${barbershopId}) AS manual,
        (SELECT s.stripe_status FROM barber_subscriptions s
          WHERE s.barbershop_id = ${barbershopId}) AS stripe_status,
        (SELECT s.current_period_end FROM barber_subscriptions s
          WHERE s.barbershop_id = ${barbershopId}) AS stripe_period_end
    `);
    const r = rows[0];
    return {
      paidThroughAt: fecha(r?.paid_through),
      lastPaidAt: fecha(r?.last_paid),
      manualAccessAt: fecha(r?.manual),
      // Lo último que Stripe dijo (G1, ronda 2): si ya renovó, no se corta.
      stripeStatus: r?.stripe_status ?? null,
      stripePeriodEnd: fecha(r?.stripe_period_end),
    };
  } catch (e) {
    if (sinTabla(e)) return null;
    throw e;
  }
}

// ── Escrituras del webhook ───────────────────────────────────────────────

export type ResultadoCobro = "guardado" | "sin-cambio" | "sin-tabla";

/**
 * Guarda UNA factura (idempotente por stripe_invoice_id). Un evento repetido
 * reescribe la misma fila con los mismos datos; un rechazo que llega DESPUÉS
 * del pago (Stripe no garantiza el orden) no la regresa a 'failed'.
 */
export async function guardarCobroBarber(barbershopId: string, cobro: BarberCobro): Promise<ResultadoCobro> {
  try {
    const n = await prisma.$executeRaw(Prisma.sql`
      INSERT INTO barber_subscription_payments (
        id, barbershop_id, stripe_invoice_id, stripe_subscription_id, status,
        amount_cents, currency, plan_id, billing_interval,
        period_start, period_end, paid_at, failure_code, created_at, updated_at
      ) VALUES (
        ${randomUUID()}, ${barbershopId}, ${cobro.invoiceId}, ${cobro.subscriptionId}, ${cobro.status},
        ${cobro.amountCents}, ${cobro.currency}, ${cobro.planId}, ${cobro.interval},
        ${cobro.periodStart}, ${cobro.periodEnd}, ${cobro.paidAt}, ${cobro.failureCode}, now(), now()
      )
      ON CONFLICT (stripe_invoice_id) DO UPDATE SET
        status                 = EXCLUDED.status,
        amount_cents           = EXCLUDED.amount_cents,
        currency               = EXCLUDED.currency,
        stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, barber_subscription_payments.stripe_subscription_id),
        plan_id                = COALESCE(EXCLUDED.plan_id, barber_subscription_payments.plan_id),
        billing_interval       = COALESCE(EXCLUDED.billing_interval, barber_subscription_payments.billing_interval),
        period_start           = COALESCE(EXCLUDED.period_start, barber_subscription_payments.period_start),
        period_end             = COALESCE(EXCLUDED.period_end, barber_subscription_payments.period_end),
        paid_at                = COALESCE(EXCLUDED.paid_at, barber_subscription_payments.paid_at),
        failure_code           = EXCLUDED.failure_code,
        updated_at             = now()
      WHERE barber_subscription_payments.status <> 'paid' OR EXCLUDED.status = 'paid'
    `);
    return n > 0 ? "guardado" : "sin-cambio";
  } catch (e) {
    if (sinTabla(e)) {
      console.warn(
        "[barber cobros] barber_subscription_payments no existe (falta sql/barber_cobros.sql); cobro NO registrado:",
        JSON.stringify({ barbershopId, invoice: cobro.invoiceId, status: cobro.status, cents: cobro.amountCents }),
      );
      return "sin-tabla";
    }
    throw e;
  }
}

/**
 * Lo que Stripe le cobra HOY (importe y ciclo reales). No toca la marca de
 * reactivación manual: esa solo la pone el admin y la «vence» un cobro nuevo.
 */
export async function guardarTerminosBarber(
  barbershopId: string,
  t: BarberSuscripcionTerminos,
): Promise<ResultadoCobro> {
  try {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO barber_subscriptions (
        barbershop_id, stripe_subscription_id, stripe_status, price_cents, currency,
        billing_interval, plan_id, current_period_end, cancel_at_period_end, updated_at
      ) VALUES (
        ${barbershopId}, ${t.stripeSubscriptionId}, ${t.stripeStatus}, ${t.priceCents}, ${t.currency},
        ${t.interval}, ${t.planId}, ${t.currentPeriodEnd}, ${t.cancelAtPeriodEnd}, now()
      )
      ON CONFLICT (barbershop_id) DO UPDATE SET
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        stripe_status          = EXCLUDED.stripe_status,
        price_cents            = COALESCE(EXCLUDED.price_cents, barber_subscriptions.price_cents),
        currency               = COALESCE(EXCLUDED.currency, barber_subscriptions.currency),
        billing_interval       = COALESCE(EXCLUDED.billing_interval, barber_subscriptions.billing_interval),
        plan_id                = COALESCE(EXCLUDED.plan_id, barber_subscriptions.plan_id),
        current_period_end     = COALESCE(EXCLUDED.current_period_end, barber_subscriptions.current_period_end),
        cancel_at_period_end   = EXCLUDED.cancel_at_period_end,
        updated_at             = now()
    `);
    return "guardado";
  } catch (e) {
    if (sinTabla(e)) return "sin-tabla";
    throw e;
  }
}

/**
 * Reactivación MANUAL desde /admin/barberias: la marca exime a la barbería
 * del corte por fecha (es cortesía) hasta que entre un cobro nuevo. Sin la
 * tabla no hace falta marcar nada: tampoco hay corte que eximir.
 */
export async function marcarReactivacionManualBarber(barbershopId: string, at: Date = new Date()): Promise<void> {
  try {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO barber_subscriptions (barbershop_id, manual_access_at, updated_at)
      VALUES (${barbershopId}, ${at}, now())
      ON CONFLICT (barbershop_id) DO UPDATE SET manual_access_at = EXCLUDED.manual_access_at, updated_at = now()
    `);
  } catch (e) {
    if (sinTabla(e)) return;
    throw e;
  }
}

// ── El corte: suspender lo vencido ───────────────────────────────────────

/**
 * Escribe «past_due» en la matriz y sus sucursales SOLO si siguen con un
 * estado que da acceso. Nunca borra ni toca nada más. Devuelve cuántas filas
 * cambió.
 */
async function suspenderFamilias(rootIds: string[]): Promise<number> {
  if (rootIds.length === 0) return 0;
  return prisma.$executeRaw(Prisma.sql`
    UPDATE barber_shops
       SET "subscriptionStatus" = ${BARBER_VENCIDA_STATUS}, "updatedAt" = now()
     WHERE (id = ANY(${rootIds}::text[]) OR "parentId" = ANY(${rootIds}::text[]))
       AND "subscriptionStatus" = ANY(${ACTIVOS}::text[])
  `);
}

/**
 * Corte AL ENTRAR (candado del panel): si la matriz `rootId` sigue «al
 * corriente» pero su periodo pagado ya venció, la suspende en ese momento
 * (para que lo público —reserva, fila, bot, recordatorios— también se
 * apague) y responde true. Sin registro → false: no se cierra nada.
 */
export async function vencerSiTocaBarber(rootId: string, status: string, now: Date = new Date()): Promise<boolean> {
  if (!BARBER_ACTIVE_SUBSCRIPTION_STATUSES.has(status)) return false;
  const ledger = await leerRegistroBarber(rootId);
  if (!barberiaVencida(ledger, now)) return false;
  await suspenderFamilias([rootId]);
  console.log("[barber cobros] suspendida al entrar: periodo pagado vencido", JSON.stringify({ rootId }));
  return true;
}

/**
 * Corte de TODAS las barberías vencidas (lo llama el cron de barber que ya
 * corre cada 5 min, /api/barber/whatsapp/dispatch, antes de programar
 * recordatorios). Idempotente: lo ya suspendido no se vuelve a tocar.
 */
export async function vencerSuscripcionesBarber(now: Date = new Date()): Promise<{ suspendidas: string[] }> {
  let rows: Array<{
    id: string;
    paid_through: Date | null;
    last_paid: Date | null;
    manual: Date | null;
    stripe_status: string | null;
    stripe_period_end: Date | null;
  }>;
  try {
    rows = await prisma.$queryRaw(Prisma.sql`
      SELECT s.id, agg.paid_through, agg.last_paid, bs.manual_access_at AS manual,
             bs.stripe_status, bs.current_period_end AS stripe_period_end
        FROM barber_shops s
        JOIN (
          SELECT barbershop_id, max(period_end) AS paid_through, max(paid_at) AS last_paid
            FROM barber_subscription_payments
           WHERE status = 'paid'
           GROUP BY barbershop_id
        ) agg ON agg.barbershop_id = s.id
        LEFT JOIN barber_subscriptions bs ON bs.barbershop_id = s.id
       WHERE s."parentId" IS NULL
         AND s."subscriptionStatus" = ANY(${ACTIVOS}::text[])
         AND agg.paid_through < ${now}
    `);
  } catch (e) {
    if (sinTabla(e)) return { suspendidas: [] };
    throw e;
  }
  // La regla vive en un solo sitio (cobros-core): el SQL solo preselecciona.
  const vencidas = rows
    .filter((r) =>
      barberiaVencida(
        {
          paidThroughAt: fecha(r.paid_through),
          lastPaidAt: fecha(r.last_paid),
          manualAccessAt: fecha(r.manual),
          stripeStatus: r.stripe_status,
          stripePeriodEnd: fecha(r.stripe_period_end),
        },
        now,
      ),
    )
    .map((r) => r.id);
  if (vencidas.length > 0) {
    await suspenderFamilias(vencidas);
    console.log("[barber cobros] suspendidas por periodo pagado vencido", JSON.stringify({ vencidas }));
  }
  return { suspendidas: vencidas };
}

// ── Para el admin: cobrado este mes, quién paga y cuánto al mes ──────────

export interface RegistroCobroAdmin {
  /** Tiene un cobro pagado cuyo periodo NO ha vencido (y no es cortesía manual). */
  vigente: boolean;
  /** Pesos al mes que cobra Stripe hoy (anual ÷ 12); null = sin términos guardados. */
  mensual: Prisma.Decimal | null;
  interval: BarberCobroInterval | null;
  /** Lo cobrado en el mes en curso (México), en pesos. */
  cobradoMes: Prisma.Decimal;
}

export interface CobrosAdmin {
  porBarberia: Map<string, RegistroCobroAdmin>;
  /** Total cobrado en el mes en curso (México), todas las barberías. */
  cobradoMes: Prisma.Decimal;
}

/**
 * Una sola consulta con todo lo del admin. null = tablas sin pegar (el admin
 * cae al cálculo de antes, rotulado «a precio de lista»).
 */
export async function cargarCobrosAdmin(now: Date = new Date()): Promise<CobrosAdmin | null> {
  let rows: Array<{
    barbershop_id: string;
    paid_through: Date | null;
    last_paid: Date | null;
    manual: Date | null;
    price_cents: number | null;
    billing_interval: string | null;
    cobrado_mes: bigint | number | null;
  }>;
  try {
    rows = await prisma.$queryRaw(Prisma.sql`
      WITH pagos AS (
        SELECT barbershop_id,
               max(period_end) AS paid_through,
               max(paid_at)    AS last_paid,
               coalesce(sum(amount_cents) FILTER (
                 WHERE date_trunc('month', paid_at AT TIME ZONE ${BARBER_COBRO_TZ})
                     = date_trunc('month', ${now}::timestamptz AT TIME ZONE ${BARBER_COBRO_TZ})
               ), 0) AS cobrado_mes
          FROM barber_subscription_payments
         WHERE status = 'paid'
         GROUP BY barbershop_id
      )
      SELECT coalesce(p.barbershop_id, s.barbershop_id) AS barbershop_id,
             p.paid_through, p.last_paid, s.manual_access_at AS manual,
             s.price_cents, s.billing_interval, p.cobrado_mes
        FROM pagos p
        FULL OUTER JOIN barber_subscriptions s ON s.barbershop_id = p.barbershop_id
    `);
  } catch (e) {
    if (sinTabla(e)) return null;
    throw e;
  }

  const porBarberia = new Map<string, RegistroCobroAdmin>();
  let total = new Prisma.Decimal(0);
  for (const r of rows) {
    const ledger: BarberLedger = {
      paidThroughAt: fecha(r.paid_through),
      lastPaidAt: fecha(r.last_paid),
      manualAccessAt: fecha(r.manual),
    };
    const interval: BarberCobroInterval | null =
      r.billing_interval === "year" ? "year" : r.billing_interval === "month" ? "month" : null;
    const cobradoMes = pesosDesdeCentavos(r.cobrado_mes === null ? 0 : BigInt(r.cobrado_mes));
    total = total.add(cobradoMes);
    porBarberia.set(r.barbershop_id, {
      vigente: corteAplica(ledger) && !periodoPagadoVencido(ledger.paidThroughAt, now),
      mensual: r.price_cents === null ? null : mensualDesdeCentavos(Number(r.price_cents), interval),
      interval,
      cobradoMes,
    });
  }
  return { porBarberia, cobradoMes: total.toDecimalPlaces(2) };
}
