import "server-only";
import { prisma } from "@/lib/prisma";
import { getModuleAnnualPriceMxn } from "./module-annual-price";
import { MODULOS_EN_VENTA, type PrecioModulo } from "./module-price-admin-core";

/**
 * Lectura y guardado del precio de un módulo para /admin/settings → Planes.
 * La validación vive en `./module-price-admin-core` (pura, con tests).
 *
 * El mensual es la columna `price_mxn_monthly` (la conoce Prisma). El anual es
 * la columna cruda `price_mxn_annual`, fuera del schema a propósito (ver
 * module-annual-price.ts): se lee y se escribe con SQL crudo y solo si existe.
 */
export * from "./module-price-admin-core";

export interface ModuloConPrecio extends PrecioModulo {
  key: string;
  name: string;
  isActive: boolean;
  /** La columna del anual existe (el SQL del precio ya se pegó). */
  anualDisponible: boolean;
}

async function columnaAnualExiste(): Promise<boolean> {
  try {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'modules' AND column_name = 'price_mxn_annual'
      ) AS existe`;
    return filas[0]?.existe === true;
  } catch (e) {
    console.warn("[admin/precio-modulo] no se pudo comprobar la columna del anual:", e);
    return false;
  }
}

/** Los módulos que hoy se venden, con su precio. Nunca lanza: sin base, lista vacía. */
export async function leerModulosEnVenta(): Promise<ModuloConPrecio[]> {
  try {
    const [modulos, anualDisponible] = await Promise.all([
      prisma.module.findMany({
        where: { key: { in: [...MODULOS_EN_VENTA] } },
        orderBy: { sortOrder: "asc" },
        select: { id: true, key: true, name: true, isActive: true, priceMxnMonthly: true },
      }),
      columnaAnualExiste(),
    ]);
    const out: ModuloConPrecio[] = [];
    // En fila: son uno o dos módulos y cada lectura es una consulta corta.
    for (const m of modulos) {
      out.push({
        key: m.key,
        name: m.name,
        isActive: m.isActive,
        priceMxnMonthly: m.priceMxnMonthly,
        priceMxnAnnual: anualDisponible ? await getModuleAnnualPriceMxn(prisma, m.id) : null,
        anualDisponible,
      });
    }
    return out;
  } catch (e) {
    console.error("[admin/precio-modulo] no se pudieron leer los módulos en venta:", e);
    return [];
  }
}

export type GuardadoPrecio =
  | { ok: true; antes: PrecioModulo; despues: PrecioModulo; name: string }
  | { ok: false; status: number; error: string };

/** Guarda mensual y anual juntos, o ninguno. */
export async function guardarPrecioModulo(moduleKey: string, precio: PrecioModulo): Promise<GuardadoPrecio> {
  const mod = await prisma.module.findUnique({
    where: { key: moduleKey },
    select: { id: true, name: true, priceMxnMonthly: true },
  });
  if (!mod) return { ok: false, status: 404, error: "Módulo no encontrado" };

  const anualDisponible = await columnaAnualExiste();
  const anualAntes = anualDisponible ? await getModuleAnnualPriceMxn(prisma, mod.id) : null;
  if (!anualDisponible && precio.priceMxnAnnual !== null) {
    return {
      ok: false,
      status: 409,
      error: "Falta pegar sql/marketplace-modulo-ortodoncia-precio.sql: sin él no hay dónde guardar el precio anual. No se cambió nada.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.module.update({ where: { id: mod.id }, data: { priceMxnMonthly: precio.priceMxnMonthly } });
    if (anualDisponible) {
      await tx.$executeRaw`
        UPDATE "modules" SET "price_mxn_annual" = ${precio.priceMxnAnnual} WHERE "id" = ${mod.id}`;
    }
  });

  return {
    ok: true,
    name: mod.name,
    antes: { priceMxnMonthly: mod.priceMxnMonthly, priceMxnAnnual: anualAntes },
    despues: precio,
  };
}
