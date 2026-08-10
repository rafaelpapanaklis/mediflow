/**
 * Afiliados — PROGRESO del "Bono por Clínicas Activas".
 *
 * Fuente ÚNICA del conteo que decide un hito. La usan el panel del afiliado
 * (su progreso personal) y /api/admin/affiliates/metrics (cuántos afiliados van
 * por cada escalón). Si cada superficie contara a su manera, el afiliado vería
 * un número y Rafael otro — y el que reclama es el afiliado.
 *
 * QUÉ CUENTA (y por qué NO es el número bruto de clínicas):
 * los términos publicados en /terminos-afiliados dicen "Una clínica cuenta como
 * activa cuando lleva al menos 3 mensualidades pagadas y su suscripción sigue
 * vigente". Contar altas —o incluso activas sin ese filtro— pintaría "50 de 50"
 * a alguien que todavía no cobra el bono: reclamo garantizado. Aquí se
 * implementa la cláusula tal cual, y además se devuelve el total de activas
 * para poder EXPLICAR la diferencia en pantalla en vez de esconderla.
 *
 * Este módulo NO paga nada: los bonos se siguen entregando a mano. Solo
 * muestra el avance.
 *
 * DEGRADACIÓN (lesson_ortho_schema_drift): cualquier fallo de BD devuelve
 * ceros. Nunca lanza — un panel sin este bloque es preferible a un 500.
 */
import { prisma } from "@/lib/prisma";
import { activeClinicWhere } from "./stats";
// Fuente única de qué factura es un prorrateo. Se importa del motor de
// comisiones en vez de repetir la cadena: si allá cambia, aquí cambia solo.
import { PRORATION_NOTE_PREFIX } from "./payout";
// El predicado "esta clínica califica" vive en un módulo PURO desde que los
// bonos por red lo necesitaron en sitios client-safe. Se re-exporta aquí para
// que los callers históricos sigan importándolo de este archivo.
import { MIN_PAID_INVOICES, clinicQualifies } from "./qualifying-clinic";

export { MIN_PAID_INVOICES, clinicQualifies };

export interface MilestoneProgress {
  /** Clínicas activas CON al menos MIN_PAID_INVOICES cobros pagados. Este es el número del bono. */
  qualifying: number;
  /** Clínicas activas (suscritas o en prueba vigente), sin el filtro de mensualidades. */
  active: number;
  /** Activas que aún no llegan a las mensualidades exigidas (active − qualifying). */
  shortOfPayments: number;
  /** Copia de MIN_PAID_INVOICES para que la UI no lo escriba a mano. */
  minPaidInvoices: number;
}

/** Estado neutro: lo que se devuelve si la BD falla o el afiliado no tiene clínicas. */
export const EMPTY_MILESTONE_PROGRESS: MilestoneProgress = {
  qualifying: 0,
  active: 0,
  shortOfPayments: 0,
  minPaidInvoices: MIN_PAID_INVOICES,
};

/**
 * MENSUALIDADES pagadas por clínica, en UNA sola query agregada (nada de un
 * count por clínica: eso serían N+1 viajes por afiliado). Un `in` vacío ni
 * siquiera toca la BD. Cualquier error degrada a mapa vacío → nadie califica,
 * pero la página carga.
 *
 * ⚠️ Los PRORRATEOS no cuentan. Un cambio de plan a mitad de ciclo genera una
 * factura pagada que NO es una mensualidad; contarla pintaría "ya califica" a
 * una clínica que al verificar el bono no calificaría — exactamente el reclamo
 * que este módulo existe para evitar. Se excluyen con el MISMO criterio que ya
 * usa getInvoiceNo() del motor de comisiones (PRORATION_NOTE_PREFIX), para que
 * "mensualidad" signifique lo mismo en las dos partes del sistema.
 *
 * La rama `{ notes: null }` es obligatoria: en Postgres un `NOT LIKE` descarta
 * las filas con NULL, así que sin ella las facturas sin nota —la mayoría— se
 * caerían del conteo y nadie llegaría nunca a un hito.
 */
export async function paidInvoiceCountByClinic(clinicIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!clinicIds || clinicIds.length === 0) return map;
  try {
    const groups = await prisma.subscriptionInvoice.groupBy({
      by: ["clinicId"],
      where: {
        clinicId: { in: clinicIds },
        status: "paid",
        OR: [{ notes: null }, { notes: { not: { startsWith: PRORATION_NOTE_PREFIX } } }],
      },
      _count: { _all: true },
    });
    for (const g of groups) {
      // `_count` puede llegar como bigint según el driver: Number() lo normaliza.
      map.set(g.clinicId, Number(g._count._all));
    }
  } catch {
    // Tabla/columna ausente o error de BD → nadie califica (map vacío).
  }
  return map;
}

/**
 * Progreso de UN afiliado hacia el bono. `affiliateId` SIEMPRE de la sesión
 * (getAffiliateContext), jamás del request.
 *
 * Dos queries fijas, sin importar cuántas clínicas tenga:
 *  1. sus clínicas activas (solo los ids — privacidad: nada de nombres ni planes),
 *  2. los cobros pagados de esas clínicas, agregados por clínica.
 *
 * No se cachea: son dos lecturas pequeñas por carga del panel y un número
 * congelado en un progreso personal se siente roto ("ya di de alta la clínica y
 * sigue en 4"). Si algún día pesa, `unstable_cache` con tag por afiliado.
 */
export async function getMilestoneProgress(affiliateId: string): Promise<MilestoneProgress> {
  if (!affiliateId) return { ...EMPTY_MILESTONE_PROGRESS };
  try {
    const now = new Date();
    // activeClinicWhere() devuelve { OR: [...] }: va dentro de AND para no
    // pisar el filtro de affiliateId al combinarlos.
    const clinics = await prisma.clinic.findMany({
      where: { AND: [{ affiliateId }, activeClinicWhere(now)] },
      select: { id: true },
    });

    const active = clinics.length;
    if (active === 0) return { ...EMPTY_MILESTONE_PROGRESS };

    // Sin dedupe con Set: `findMany` ya devuelve ids únicos (son PK) y el
    // target de TS del repo no permite spread de iterables.
    const ids = clinics.map((c) => c.id);
    const paidByClinic = await paidInvoiceCountByClinic(ids);

    let qualifying = 0;
    for (const id of ids) if (clinicQualifies(paidByClinic.get(id))) qualifying += 1;

    return {
      qualifying,
      active,
      shortOfPayments: Math.max(0, active - qualifying),
      minPaidInvoices: MIN_PAID_INVOICES,
    };
  } catch {
    return { ...EMPTY_MILESTONE_PROGRESS };
  }
}
