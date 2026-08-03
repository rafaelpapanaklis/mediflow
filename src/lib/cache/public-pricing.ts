/**
 * Invalidación BAJO DEMANDA de las páginas PÚBLICAS con ISR que muestran
 * números editables desde /admin (comisiones de afiliados y precios de plan).
 *
 * EL PROBLEMA QUE RESUELVE: una página con `export const revalidate = N` se
 * sirve desde el caché y sólo se regenera cuando vence el temporizador. Guardar
 * en /admin no la invalidaba, así que /afiliados siguió publicando los montos
 * viejos aunque la BD ya tuviera los nuevos. El `revalidate` de cada página
 * queda como RED DE SEGURIDAD (cambios hechos por SQL directo, sin pasar por el
 * admin); el camino normal es llamar a estos helpers desde el endpoint que
 * guarda.
 *
 * Hermano de `@/lib/blog/revalidate` (superficies públicas del blog) y de
 * `@/lib/cache/revalidate` (pantallas del panel). Igual que el del blog:
 * `revalidatePath` NUNCA puede tumbar el guardado — la config ya está en la BD y
 * el peor caso es esperar el temporizador.
 */
import { revalidatePath } from "next/cache";
import { SPECIALTY_SLUGS } from "@/lib/specialty-data";

/**
 * Superficies que dependen de `affiliate_payout_config` (los 6 montos, el
 * arranque y si el afiliado puede elegir modalidad).
 *
 * Sólo /afiliados: es la única ruta con ISR que lee esa config.
 * /afiliados/registro es `force-dynamic` y /afiliados/(panel)/* pide sesión, así
 * que ninguna se cachea.
 */
const AFFILIATE_PATHS: readonly string[] = ["/afiliados"];

/**
 * Superficies que muestran el PRECIO de los planes (`plan_configs`):
 *
 *  · "/"              → tarjetas de precio de la landing v4 (buildPlanCards).
 *  · "/<especialidad>" → las 17 landings de /[slug] (SpecPricing). Se enumeran
 *    en vez de invalidar el patrón "/[slug]" entero porque esa misma ruta sirve
 *    las landings de clínica, que no muestran precios y no hay por qué
 *    regenerar.
 *  · "/afiliados"     → cada tarjeta de comisión rotula el precio del plan
 *    ("plan de $689/mes"), así que un cambio de precio también la desactualiza.
 *
 * Las 8 páginas de producto (/software-agenda-dental y compañía) NO listan
 * precios: se dejan fuera a propósito.
 */
const PRICING_PATHS: readonly string[] = [
  "/",
  ...SPECIALTY_SLUGS.map((slug) => `/${slug}`),
  ...AFFILIATE_PATHS,
];

/**
 * Revalida un set de rutas. Devuelve false si alguna falló, para que el
 * endpoint pueda decir la verdad en su respuesta en vez de prometer que la
 * página pública ya está al día.
 */
function revalidateAll(paths: readonly string[], scope: string): boolean {
  const seen: Record<string, true> = {};
  let ok = true;
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (seen[p]) continue;
    seen[p] = true;
    try {
      revalidatePath(p);
    } catch (e) {
      // revalidatePath truena fuera de un render/route handler (p.ej. si algún
      // día se llama desde un script o un cron). No debe tumbar la mutación.
      ok = false;
      console.warn(`[cache/public-pricing:${scope}] no se pudo revalidar ${p}:`, e);
    }
  }
  return ok;
}

/** Tras guardar el esquema de comisiones (PUT /api/admin/affiliates/payout-config). */
export function revalidateAffiliateLanding(): boolean {
  return revalidateAll(AFFILIATE_PATHS, "afiliados");
}

/**
 * Tras guardar un plan (PATCH /api/admin/plan-config/[planId]).
 *
 * OJO: `getResolvedPlans()` tiene además una caché EN MEMORIA de 60 s por
 * instancia (`clearPlanConfigCache()` sólo limpia la que atendió el PATCH), así
 * que la regeneración puede leer hasta 60 s de precio viejo si cae en otra
 * instancia. Se refleja igual sin esperar los 10 min del ISR.
 */
export function revalidatePublicPricing(): boolean {
  return revalidateAll(PRICING_PATHS, "precios");
}
