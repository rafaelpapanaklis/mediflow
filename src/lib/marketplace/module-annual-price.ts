// ═══════════════════════════════════════════════════════════════════════════
// Precio anual de un módulo del marketplace — columna cruda "price_mxn_annual"
// en "modules" (sql/marketplace-modulo-ortodoncia-precio.sql), a propósito
// FUERA de prisma/schema.prisma (el modelo "Module" no la declara): así
// cualquier `prisma.module.findMany()`/`findUnique()` ya existente en el
// código sigue funcionando exacto igual, con o sin este SQL pegado — Prisma
// nunca la pide porque no la conoce. Mismo patrón que
// src/lib/invoices/condiciones-pago-db.ts (sonda de existencia + caché).
// ═══════════════════════════════════════════════════════════════════════════

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

let columnaExiste: { existe: boolean; at: number } | null = null;
const TTL_MS = 60_000;

async function probarColumna(db: Db): Promise<boolean> {
  const t = Date.now();
  if (columnaExiste && (columnaExiste.existe || t - columnaExiste.at < TTL_MS)) return columnaExiste.existe;
  try {
    const filas = await db.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'modules' AND column_name = 'price_mxn_annual'
      ) AS existe`;
    columnaExiste = { existe: filas[0]?.existe === true, at: t };
    return columnaExiste.existe;
  } catch (e) {
    console.warn("[marketplace:precio-anual] no se pudo comprobar la columna:", e);
    return false;
  }
}

/** Solo para pruebas: olvida lo que se sabía de la columna. */
export function _olvidarColumnaPrecioAnual(): void {
  columnaExiste = null;
}

/**
 * Precio anual (en pesos MXN enteros) de un módulo, o `null` si el módulo
 * todavía no tiene uno configurado (columna ausente, o valor NULL en esa
 * fila). Nunca lanza: un fallo de lectura se trata igual que "sin precio
 * anual" — la compra anual de ese módulo simplemente no se ofrece.
 */
export async function getModuleAnnualPriceMxn(db: Db, moduleId: string): Promise<number | null> {
  if (!(await probarColumna(db))) return null;
  try {
    const filas = await db.$queryRaw<{ price_mxn_annual: number | null }[]>`
      SELECT "price_mxn_annual" FROM "modules" WHERE "id" = ${moduleId}`;
    return filas[0]?.price_mxn_annual ?? null;
  } catch (e) {
    console.warn("[marketplace:precio-anual] no se pudo leer:", e);
    return null;
  }
}
