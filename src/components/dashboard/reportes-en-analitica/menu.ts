// Reportes SALE del menú lateral NUEVO (interruptor `menu-dos-niveles`) porque
// pasa a ser una pestaña de Analítica (ws1-t3). Rafael: «necesito eliminar
// "reportes" pero porque lo vas a juntar con "analytics"».
//
// Esto QUITA DEL MENÚ; no borra nada. `/dashboard/reports`, su código y el menú
// de siempre (bandera apagada) siguen exactamente igual. Mismo mecanismo que
// Marketplace (`presupuestos-en-facturacion/menu.ts`, el PR 339): la opción
// «Reportes» de `sidebar-nav.ts` declara `moduleKey: "reports"`, y el filtro de
// siempre (`shouldShowItem`) la esconde si el menú no recibe esa llave. Así no
// se toca ni `sidebar-nav.ts` ni `menu-dos-niveles/**`.
//
// ⚠️ Solo sale si ESA persona puede abrir Analítica. Reportes pide
// `reports.view` y el módulo `reports`; Analítica pide ser administrador,
// `analytics.view` y el módulo `analytics`. Una clínica cuyo plan trae Reportes
// pero no Analytics, o alguien con `reports.view` concedido a mano sin ser
// administrador, se quedaría sin forma de llegar a sus reportes: a ellos
// Reportes les sigue saliendo en el menú, como hoy. Nadie pierde un dato que ve.
//
// Sin React ni Next a propósito: lo prueban los tests en node.

import { NAV_ITEMS, shouldShowItem, type ClinicCategory, type SidebarUser } from "@/components/dashboard/sidebar-nav";

/** La llave de módulo de la opción «Reportes» del menú. */
export const MODULO_REPORTES = "reports";

/** ¿Le sale Analítica en el menú a esta persona? El filtro de siempre, sin copiar sus reglas. */
export function puedeAbrirAnalitica(
  user: SidebarUser,
  category: ClinicCategory,
  clinicModuleKeys: readonly string[] | null | undefined,
): boolean {
  const analitica = NAV_ITEMS.find((i) => i.id === "analytics");
  return Boolean(analitica) && shouldShowItem(analitica!, user, category, [...(clinicModuleKeys ?? [])]);
}

/**
 * Las llaves de módulo que debe recibir el menú NUEVO: las mismas, sin
 * `reports` cuando la persona llega a Reportes por la pestaña de Analítica.
 */
export function modulosSinReportes(
  clinicModuleKeys: readonly string[] | null | undefined,
  user: SidebarUser,
  category: ClinicCategory,
): string[] {
  const llaves = [...(clinicModuleKeys ?? [])];
  if (!puedeAbrirAnalitica(user, category, llaves)) return llaves;
  return llaves.filter((k) => k !== MODULO_REPORTES);
}
