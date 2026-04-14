import { PrismaClient } from "@prisma/client";

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
 */

const globalForPrismaAdmin = globalThis as unknown as {
  prismaAdmin: PrismaClient | undefined;
};

export const prismaAdmin =
  globalForPrismaAdmin.prismaAdmin ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrismaAdmin.prismaAdmin = prismaAdmin;
}
