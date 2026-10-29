/**
 * Seguridad admin-auth (auditoría «cloudflare», nº13) — una sesión de checkout de Stripe activa UN periodo
 * del plan, la entregue Stripe las veces que la entregue.
 *
 * `activatePlatformSubscription` extiende DESDE EL FINAL del periodo vigente: si Stripe reentrega el mismo
 * `checkout.session.completed` / `async_payment_succeeded` (entrega «al menos una vez», un 500 después de
 * escribir, un «Resend» del panel de Stripe), cada entrega sumaba otro mes (u otro año) por un solo pago.
 *
 * Ahora la activación se RECLAMA por `session.id`:
 *  · Con `sql/stripe-activaciones-plataforma.sql` aplicado: INSERT … ON CONFLICT DO NOTHING en la tabla
 *    `stripe_activaciones_plataforma` (llave primaria = session.id) DENTRO de la misma transacción que
 *    actualiza la clínica. Dos entregas a la vez: la segunda espera el candado y no inserta nada.
 *  · Sin el SQL (como hoy): se busca en la bitácora una activación de esa misma sesión y, si la hay, no
 *    se vuelve a extender. Es lo que hay sin tabla: no es atómico y depende de que esa fila exista.
 *  · En los dos casos, antes se mira la bitácora: cubre las sesiones activadas antes de pegar el SQL.
 * Si la comprobación misma falla (base lenta, tabla rara), la activación SIGUE como hoy: una clínica que
 * pagó nunca se queda sin su plan por esto.
 */
import type { Prisma } from "@prisma/client";

/** Lo mínimo de prisma que usa: lo cumplen el cliente real, una transacción y los dobles de las pruebas. */
export interface DbActivacion {
  $queryRaw<T = unknown>(q: TemplateStringsArray | Prisma.Sql, ...v: unknown[]): Promise<T>;
  $transaction<T>(f: (tx: any) => Promise<T>): Promise<T>;
  auditLog: { findFirst(args: any): Promise<unknown | null> };
}

export const TABLA_ACTIVACIONES = "stripe_activaciones_plataforma";
/** Sin la tabla, cada cuánto se vuelve a preguntar (para enterarse cuando Rafael pegue el SQL). */
const REPREGUNTA_SIN_TABLA_MS = 5 * 60_000;

/** `hasta`: sin la tabla, cuándo se vuelve a preguntar. */
type EstadoSonda = { existe: boolean; hasta?: number };
const g = globalThis as typeof globalThis & { __sondaActivacionesStripe?: EstadoSonda };

/** Solo pruebas. */
export function _olvidarSondaDeActivaciones(): void {
  delete g.__sondaActivacionesStripe;
}

/** true / false = la base contestó; null = no se pudo saber (no se recuerda). */
async function tablaExiste(db: DbActivacion): Promise<boolean | null> {
  const s = g.__sondaActivacionesStripe;
  if (s?.existe) return true;
  if (s && !s.existe && Date.now() < (s.hasta ?? 0)) return false;
  try {
    const r = await db.$queryRaw<{ existe: boolean }[]>`SELECT to_regclass('public.stripe_activaciones_plataforma') IS NOT NULL AS existe`;
    const existe = r?.[0]?.existe === true;
    g.__sondaActivacionesStripe = existe ? { existe: true } : { existe: false, hasta: Date.now() + REPREGUNTA_SIN_TABLA_MS };
    return existe;
  } catch (e) {
    console.warn("[stripe webhook] no se pudo saber si existe la tabla de activaciones; se sigue sin ella:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** ¿La bitácora ya tiene una activación de ESTA sesión para ESTA clínica? null = no se pudo leer. */
async function yaActivadaEnBitacora(db: DbActivacion, clinicId: string, sessionId: string): Promise<boolean | null> {
  try {
    const fila = await db.auditLog.findFirst({
      where: { clinicId, entityType: "subscription", changes: { path: ["_source", "after", "sessionId"], equals: sessionId } },
      select: { id: true },
    });
    return fila != null;
  } catch (e) {
    console.warn("[stripe webhook] no se pudo leer la bitácora de activaciones:", e instanceof Error ? e.message : e);
    return null;
  }
}

export type ResultadoActivacion<T> = { aplicada: true; valor: T } | { aplicada: false };

/**
 * Corre `aplicar` (la escritura de la clínica) UNA sola vez por `sessionId`. Sin `sessionId` (no debería
 * pasar en un checkout), corre como siempre. `aplicar` recibe la transacción cuando la hay.
 */
export async function aplicarActivacionUnaVez<T>(
  db: DbActivacion,
  args: { clinicId: string; sessionId: string | null | undefined; evento: string },
  aplicar: (tx: any) => Promise<T>,
): Promise<ResultadoActivacion<T>> {
  const { clinicId, sessionId, evento } = args;
  if (!sessionId) return { aplicada: true, valor: await aplicar(db) };

  if ((await yaActivadaEnBitacora(db, clinicId, sessionId)) === true) return { aplicada: false };

  if ((await tablaExiste(db)) !== true) return { aplicada: true, valor: await aplicar(db) };

  return db.$transaction(async (tx) => {
    const nuevas = await tx.$executeRaw`
      INSERT INTO "stripe_activaciones_plataforma" ("sessionId", "clinicId", "evento")
      VALUES (${sessionId}, ${clinicId}, ${evento})
      ON CONFLICT ("sessionId") DO NOTHING`;
    if (Number(nuevas) === 0) return { aplicada: false } as const;
    return { aplicada: true, valor: await aplicar(tx) } as const;
  });
}
