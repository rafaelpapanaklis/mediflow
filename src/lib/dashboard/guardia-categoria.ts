/**
 * WS1-T4 ronda 6 · G7 — guardia de CATEGORÍA para páginas del panel.
 *
 * El menú ya esconde «Ejercicios», «Ortesis», «Fórmulas» y «Paquetes» a las
 * clínicas que no son de ese giro (`shouldShowItem`), pero las páginas seguían
 * abriendo escribiendo la dirección, y sus APIs contestando. Este guardia
 * aplica a la RUTA el mismo criterio que el menú le aplica a la entrada.
 *
 * FUENTE ÚNICA: las categorías salen de `NAV_ITEMS` (sidebar-nav.ts). Aquí no
 * se copia ninguna lista: si mañana una categoría gana «Paquetes» en el menú,
 * gana también la página y su API.
 *
 * Archivo PURO (sin sesión, sin Prisma, sin next/navigation): la categoría la
 * pasa quien llama, y en el servidor la lee SIEMPRE de la sesión. Las
 * funciones que redirigen o contestan 403 viven en `guardia-categoria.server.ts`.
 *
 * ⛔ Un guardia va en CADA page.tsx, no en un layout: los layouts de Next no se
 * re-ejecutan al navegar entre páginas hermanas.
 */
import { NAV_ITEMS } from "@/components/dashboard/sidebar-nav";

/** A dónde se manda a quien abre una página que no es de su giro. */
export const DESTINO_POR_DEFECTO = "/dashboard";

/**
 * Páginas que NO están en el menú de nadie y aun así abren por dirección.
 * Para ellas no hay `categories` que reutilizar, así que la regla se escribe
 * aquí, a mano y con su porqué.
 */
export const RUTAS_FUERA_DEL_MENU: Readonly<
  Record<string, { noPermitidaEn: readonly string[]; destino: string }>
> = {
  // «Reservas legacy»: la pantalla vieja de reservas de recursos. En una
  // clínica dental los sillones y consultorios se llevan en Recursos + Agenda.
  "/dashboard/resource-bookings": { noPermitidaEn: ["DENTAL"], destino: "/dashboard/resources" },
};

/** Quita query, hash y la barra final: «/dashboard/packages/?x=1» → «/dashboard/packages». */
export function normalizarRuta(ruta: string): string {
  const sinQuery = (ruta ?? "").split("?")[0].split("#")[0].trim();
  const sinBarra = sinQuery.length > 1 ? sinQuery.replace(/\/+$/, "") : sinQuery;
  return sinBarra || "/";
}

/** ¿`ruta` es `base` o cuelga de ella? («/dashboard/orthotics» NO cuelga de «/dashboard/ortho».) */
function cuelgaDe(ruta: string, base: string): boolean {
  return ruta === base || ruta.startsWith(`${base}/`);
}

/**
 * Las categorías que el MENÚ declara para la ruta, o `null` si el menú no le
 * pone condición de categoría (o no la conoce). Gana la entrada más específica.
 */
export function categoriasDeLaRuta(ruta: string): readonly string[] | null {
  const r = normalizarRuta(ruta);
  let mejor: { href: string; categories?: readonly string[] } | null = null;
  for (const item of NAV_ITEMS) {
    if (!cuelgaDe(r, item.href)) continue;
    if (!mejor || item.href.length > mejor.href.length) mejor = item;
  }
  if (!mejor || !mejor.categories || mejor.categories.length === 0) return null;
  return mejor.categories;
}

/** La regla escrita a mano que le toca a la ruta, si está fuera del menú. */
function reglaFueraDelMenu(ruta: string) {
  const r = normalizarRuta(ruta);
  for (const base of Object.keys(RUTAS_FUERA_DEL_MENU)) {
    if (cuelgaDe(r, base)) return RUTAS_FUERA_DEL_MENU[base];
  }
  return null;
}

/**
 * ¿Una clínica de esta categoría puede abrir esta página?
 *
 *   · la ruta tiene `categories` en el menú → solo esas categorías.
 *   · la ruta está en RUTAS_FUERA_DEL_MENU  → todas menos las que ahí se niegan.
 *   · cualquier otra ruta                   → sí (este guardia no opina).
 *
 * Sin categoría conocida (`null`/`undefined`) una ruta con condición NO abre:
 * falla cerrado.
 */
export function paginaPermitidaParaCategoria(
  ruta: string,
  categoria: string | null | undefined,
): boolean {
  const delMenu = categoriasDeLaRuta(ruta);
  if (delMenu) return !!categoria && delMenu.includes(categoria);
  const regla = reglaFueraDelMenu(ruta);
  if (regla) return !!categoria && !regla.noPermitidaEn.includes(categoria);
  return true;
}

/** A dónde redirigir cuando la página no está permitida. */
export function destinoSiNoPermitida(ruta: string): string {
  return reglaFueraDelMenu(ruta)?.destino ?? DESTINO_POR_DEFECTO;
}
