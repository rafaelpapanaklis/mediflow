import { PrismaClient } from "@prisma/client";
import { getCurrentClinicContext } from "@/lib/clinic-context";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Crea el cliente de Prisma con un extension que aplica automáticamente
 * el contexto de clínica (para futuras policies de RLS).
 *
 * Cómo funciona:
 * 1. Cada operación (findMany, create, update, etc.) pasa por el extension
 * 2. Si hay un clinicContext en AsyncLocalStorage, envuelve la operación en
 *    una transacción que primero setea app.current_clinic_id via set_config
 * 3. PostgreSQL usa esa variable de sesión para aplicar las policies de RLS
 * 4. Si NO hay clinicContext, la operación se ejecuta sin envoltura (modo
 *    "sin RLS" — válido para endpoints que aún no migraron o para endpoints
 *    públicos que no deberían tener clínica activa)
 *
 * Por qué envolvemos en transacción:
 *  - PgBouncer en modo transaction (puerto 6543) reutiliza conexiones entre
 *    clientes, así que cualquier SET de nivel session se pierde.
 *  - set_config('name', 'value', true) con is_local=true solo dura la
 *    transacción actual, así que la query DEBE correr en la misma TX que
 *    el set_config.
 *
 * NOTA IMPORTANTE: Este middleware NO tiene efecto mientras RLS no esté
 * activado en Supabase. Es seguro deployarlo sin activar RLS — solo
 * comienza a hacer algo útil cuando se corren las policies de la Sesión 2.
 */
function createPrismaClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  return base.$extends({
    name: "rls-clinic-context",
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const ctx = getCurrentClinicContext();

          if (!ctx?.clinicId) {
            return query(args);
          }

          return base.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.current_clinic_id', ${ctx.clinicId}, true)`;
            return query(args);
          });
        },
      },
    },
  });
}

// El tipo derivado de $extends no es asignable a PrismaClient "pelado", pero
// todo el código existente importa `prisma` y llama métodos delegados que el
// extension preserva. Casteamos a PrismaClient para mantener compatibilidad
// total con los imports actuales sin tener que tocar ningún archivo.
export const prisma =
  (globalForPrisma.prisma as PrismaClient | undefined) ??
  (createPrismaClient() as unknown as PrismaClient);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
