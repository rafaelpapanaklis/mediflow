/**
 * Seguridad admin-auth (auditoría «cloudflare», nº13) — una sesión de checkout de Stripe activa UN periodo
 * del plan, la entregue Stripe las veces que la entregue.
 *
 * `activatePlatformSubscription` extiende DESDE EL FINAL del periodo vigente: si Stripe reentrega el mismo
 * `checkout.session.completed` / `async_payment_succeeded` (entrega «al menos una vez», un 500 después de
 * escribir, un «Resend» del panel de Stripe), cada entrega sumaba otro mes (u otro año) por un solo pago.
 *
 * Ahora la activación se RECLAMA por `session.id` en la tabla `stripe_activaciones_plataforma` (llave
 * primaria = session.id): INSERT … ON CONFLICT DO NOTHING DENTRO de la misma transacción que actualiza la
 * clínica. Dos entregas a la vez: la segunda espera el candado y no inserta nada.
 *
 * ⚠ REQUISITO: sql/stripe-activaciones-plataforma.sql. Sin la tabla NO hay candado y una reentrega suma
 * otro periodo, igual que antes de este arreglo. v1 buscaba además en la bitácora una activación de la
 * misma sesión, pero esa fila nunca existió: el webhook la escribía con `userId = clinicId` y
 * `audit_logs."userId"` tiene FK a `users` (revisión ws1-t8, M1). Se quitó para no dar falsa confianza.
 * Si la comprobación misma falla (base lenta, tabla rara), la activación SIGUE como hoy: una clínica que
 * pagó nunca se queda sin su plan por esto.
 */
import type { Prisma } from "@prisma/client";

/** Lo mínimo de prisma que usa: lo cumplen el cliente real, una transacción y los dobles de las pruebas. */
export interface DbActivacion {
  $queryRaw<T = unknown>(q: TemplateStringsArray | Prisma.Sql, ...v: unknown[]): Promise<T>;
  $transaction<T>(f: (tx: any) => Promise<T>): Promise<T>;
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
    if (!existe) console.warn("[stripe webhook] falta sql/stripe-activaciones-plataforma.sql: una reentrega del mismo checkout suma otro periodo");
    return existe;
  } catch (e) {
    console.warn("[stripe webhook] no se pudo saber si existe la tabla de activaciones; se sigue sin ella:", e instanceof Error ? e.message : e);
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
