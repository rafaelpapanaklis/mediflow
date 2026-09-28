import "server-only";
import { prisma } from "@/lib/prisma";
import {
  suscripcionesConBajaProgramada,
  whereBitacoraBajas,
  type FilaModulo,
} from "./modulos-core";

/**
 * Carga de los módulos contratados para /admin. La aritmética y las reglas
 * viven en `./modulos-core` (puro, con tests); aquí solo está lo que toca la
 * base.
 *
 * /admin es la vista del dueño de la plataforma: estas consultas son
 * deliberadamente CROSS-TENANT (no llevan clinicId cuando se pide el roster
 * entero) y lo que las protege es el gate de sesión del layout de /admin.
 */
export * from "./modulos-core";

export interface ModulosCargados {
  filas: FilaModulo[];
  /** `false` si no se pudo leer: la pantalla lo dice en vez de enseñar «sin módulos». */
  medido: boolean;
}

/**
 * De estas suscripciones de Stripe, las que tienen la baja al fin del periodo
 * pedida (por la clínica o desde /admin) y no deshecha. Sale de la bitácora:
 * `clinic_modules` no tiene columna para eso. Nunca lanza: sin bitácora no se
 * sabe si la baja está pedida y el módulo se enseña como activo.
 */
export async function loadBajasProgramadas(stripeSubscriptionIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(stripeSubscriptionIds.filter(Boolean)));
  if (ids.length === 0) return new Set();
  try {
    // Sin `take`: antes se leían las últimas 500 filas de TODA la bitácora de
    // estas suscripciones y, con mucho movimiento, la marca de la baja se caía
    // del corte (salía «Activo»). Ahora sólo se piden las filas de pedir o
    // deshacer la baja, y de ésas la más reciente de cada suscripción.
    const bitacora = await prisma.auditLog.findMany({
      where: whereBitacoraBajas(ids),
      orderBy: { createdAt: "desc" },
      distinct: ["entityId"],
      select: { entityId: true, createdAt: true, changes: true },
    });
    return suscripcionesConBajaProgramada(bitacora);
  } catch (e) {
    console.error("[admin/modulos] no se pudo leer la bitácora de bajas:", e);
    return new Set();
  }
}

/**
 * Todas las filas de `clinic_modules` (o las de una clínica), con la baja
 * programada ya resuelta desde la bitácora. Dos consultas, en fila. Nunca
 * lanza: si algo falla devuelve `medido: false` y la página se pinta igual.
 */
export async function loadModulosContratados(clinicId?: string): Promise<ModulosCargados> {
  try {
    const crudas = await prisma.clinicModule.findMany({
      where: clinicId ? { clinicId } : undefined,
      select: {
        clinicId: true,
        status: true,
        paymentMethod: true,
        billingCycle: true,
        pricePaidMxn: true,
        currentPeriodEnd: true,
        stripeSubscriptionId: true,
        module: { select: { key: true, name: true } },
      },
    });

    // La baja al fin del periodo solo puede estar pedida en una suscripción viva.
    const suscripciones = crudas
      .filter((c) => c.stripeSubscriptionId && c.status === "active")
      .map((c) => c.stripeSubscriptionId as string);

    const conBaja = await loadBajasProgramadas(suscripciones);

    return {
      medido: true,
      filas: crudas.map((c) => ({
        clinicId: c.clinicId,
        moduleKey: c.module.key,
        moduleName: c.module.name,
        status: c.status,
        paymentMethod: c.paymentMethod,
        billingCycle: c.billingCycle,
        pricePaidMxn: c.pricePaidMxn,
        currentPeriodEnd: c.currentPeriodEnd,
        tieneSuscripcionStripe: !!c.stripeSubscriptionId,
        bajaProgramada: !!c.stripeSubscriptionId && conBaja.has(c.stripeSubscriptionId),
      })),
    };
  } catch (e) {
    console.error("[admin/modulos] no se pudieron cargar los módulos contratados:", e);
    return { medido: false, filas: [] };
  }
}
