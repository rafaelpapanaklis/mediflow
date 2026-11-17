// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — lectura de «lo que la barbería le paga a
// DaleControl» para /admin/barberias/[id] (ws6-t1). Las cuentas, en
// admin-pagos-core.ts (puro).
//
// Dos lecturas EN PARALELO (y en paralelo con el resto de la ficha, desde
// page.tsx): los últimos cobros y los totales. Las dos resuelven la matriz
// dentro del SQL —una sucursal no tiene cobros: los paga su matriz— para no
// esperar a una lectura previa de la barbería. Usan los índices de
// sql/barber_cobros.sql (barbershop_id, status, period_end) y la llave
// primaria de barber_subscriptions.
//
// Sin sql/barber_cobros.sql: «disponible: false» y la ficha lo dice. Nunca
// lanza por eso; cualquier otro error, sí (la página lo atrapa y sigue).
//
// Sin "server-only" (como cash.ts): las pruebas lo importan con tsx. Solo lo
// llaman la página y las rutas de /admin, que ya validaron la sesión de admin.
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSchemaBehindError } from "@/lib/barber/db-errors";
import {
  PAGOS_EN_FICHA,
  pagosNoDisponibles,
  resumirPagos,
  type FilaPago,
  type FilaTotales,
  type PagosBarberiaDTO,
} from "@/lib/barber/admin-pagos-core";

/** La matriz que paga por esa sede (ella misma si es matriz). */
const RAIZ = (id: string) =>
  Prisma.sql`(SELECT coalesce(s."parentId", s."id") FROM "barber_shops" s WHERE s."id" = ${id})`;

/** null = la barbería no existe. */
export async function cargarPagosBarberia(barbershopId: string): Promise<PagosBarberiaDTO | null> {
  if (!barbershopId) return null;
  const shop = prisma.barbershop.findUnique({ where: { id: barbershopId }, select: { id: true, parentId: true } });
  const filas = prisma.$queryRaw<FilaPago[]>(Prisma.sql`
    SELECT stripe_invoice_id, status, amount_cents, currency, plan_id, billing_interval,
           period_start, period_end, paid_at, failure_code, created_at
      FROM barber_subscription_payments
     WHERE barbershop_id = ${RAIZ(barbershopId)}
     ORDER BY coalesce(paid_at, created_at) DESC, created_at DESC
     LIMIT ${PAGOS_EN_FICHA}
  `);
  const totales = prisma.$queryRaw<FilaTotales[]>(Prisma.sql`
    WITH r AS (SELECT ${RAIZ(barbershopId)} AS id),
    p AS (
      SELECT count(*) FILTER (WHERE status = 'paid')                    AS pagados,
             count(*) FILTER (WHERE status = 'failed')                  AS fallidos,
             sum(amount_cents) FILTER (WHERE status = 'paid')           AS total_cents,
             max(period_end) FILTER (WHERE status = 'paid')             AS pagado_hasta
        FROM barber_subscription_payments, r
       WHERE barbershop_id = r.id
    ),
    u AS (
      SELECT paid_at AS ultimo_pago_at, amount_cents AS ultimo_pago_cents
        FROM barber_subscription_payments, r
       WHERE barbershop_id = r.id AND status = 'paid' AND paid_at IS NOT NULL
       ORDER BY paid_at DESC
       LIMIT 1
    )
    SELECT p.pagados, p.fallidos, p.total_cents, p.pagado_hasta,
           u.ultimo_pago_at, u.ultimo_pago_cents,
           s.price_cents, s.billing_interval AS sub_interval, s.stripe_status,
           s.current_period_end, s.cancel_at_period_end, s.manual_access_at,
           (s.barbershop_id IS NOT NULL) AS tiene_terminos
      FROM p
      LEFT JOIN u ON true
      LEFT JOIN barber_subscriptions s ON s.barbershop_id = (SELECT id FROM r)
  `);

  // Las tres a la vez (las de Prisma no salen hasta que alguien las espera).
  const [s, f, t] = await Promise.allSettled([shop, filas, totales]);
  if (s.status === "rejected") throw s.reason;
  const fila = s.value;
  if (!fila) return null;
  const pagaId = fila.parentId ?? fila.id;
  const esSucursal = fila.parentId !== null;

  for (const r of [f, t]) {
    if (r.status === "rejected") {
      if (isSchemaBehindError(r.reason)) return pagosNoDisponibles(pagaId, esSucursal);
      throw r.reason;
    }
  }
  return resumirPagos({
    pagaId,
    esSucursal,
    filas: (f as PromiseFulfilledResult<FilaPago[]>).value,
    totales: (t as PromiseFulfilledResult<FilaTotales[]>).value[0] ?? null,
  });
}

/**
 * ¿Ese in_… es un cobro registrado de la barbería (o de su matriz)? Lo usa la
 * ruta del recibo antes de pedirle nada a Stripe: el admin solo puede abrir
 * recibos de la ficha que está viendo. false también sin tablas.
 */
export async function esCobroDeBarberia(barbershopId: string, invoiceId: string): Promise<boolean> {
  if (!barbershopId || !/^in_[A-Za-z0-9]+$/.test(invoiceId)) return false;
  try {
    const rows = await prisma.$queryRaw<Array<{ ok: number }>>(Prisma.sql`
      SELECT 1 AS ok FROM barber_subscription_payments
       WHERE stripe_invoice_id = ${invoiceId} AND barbershop_id = ${RAIZ(barbershopId)}
       LIMIT 1
    `);
    return rows.length > 0;
  } catch (e) {
    if (isSchemaBehindError(e)) return false;
    throw e;
  }
}
