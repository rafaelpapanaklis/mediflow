import { PrismaClient } from "@prisma/client";
import { urlConTopeDeConexiones } from "@/lib/prisma-url";

/**
 * Admin Prisma client — deliberadamente SIN middleware de RLS context.
 *
 * Úsalo SOLO en casos justificados:
 *  - Cron jobs (no tienen sesión de usuario)
 *  - Webhooks de terceros (Stripe, WhatsApp)
 *  - Endpoints públicos con validación por token (portal del paciente, consent forms)
 *  - Operaciones del super admin que necesitan cruzar clínicas
 *
 * NUNCA lo uses en endpoints normales del dashboard — usa el cliente prisma normal.
 *
 * UNA conexión (ws1-t12, incidente del 1-oct-2026): cada cliente de Prisma abre
 * su propio pool por instancia de función, y este se sumaba al de `prisma` con
 * el mismo `connection_limit` de DATABASE_URL. Hoy solo lo usa la analítica,
 * así que va con `connection_limit=1` y `pool_timeout=5`: si la base no da
 * conexión, la consulta falla en 5 s en vez de quedarse esperando los 10 de
 * Prisma. Sus consultas en paralelo (Promise.all de /admin/analytics) van en
 * fila por esa única conexión. Ojo: con una sola conexión, una consulta con
 * `prismaAdmin` DENTRO de un `prismaAdmin.$transaction(async (tx) => …)` se
 * queda esperando a la propia transacción: dentro, siempre `tx`.
 */

const globalForPrismaAdmin = globalThis as unknown as {
  prismaAdmin: PrismaClient | undefined;
};

export const prismaAdmin =
  globalForPrismaAdmin.prismaAdmin ??
  new PrismaClient({
    datasourceUrl: urlConTopeDeConexiones(process.env.DATABASE_URL, { conexiones: 1, esperaSegundos: 5 }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

// Uno por proceso, también en producción: ver la nota de @/lib/prisma (ws1-t12).
globalForPrismaAdmin.prismaAdmin = prismaAdmin;
