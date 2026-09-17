// ═══════════════════════════════════════════════════════════════════════════
// MARKETPLACE OCULTO, POR AHORA (ws1-t6). Rafael: «sí, oculta marketplace por
// ahora». OCULTAR, no borrar: la ruta `/dashboard/marketplace` sigue viva y
// quien la escriba a mano la ve. Aquí solo se decide A DÓNDE se manda a la
// gente que antes aterrizaba ahí sin haberlo pedido.
//
// PARA DESHACERLO: `MARKETPLACE_OCULTO = false`. Es la única línea. Con eso
// todos los sitios que pasan por aquí vuelven a mandar a Marketplace, tal cual.
//
// Solo aplica al camino NUEVO (bandera `menu-dos-niveles` encendida). Con la
// bandera apagada cada sitio devuelve, letra por letra, el destino de siempre.
//
// Archivo puro (sin Prisma, sin `server-only`) para que la prueba lo importe.
// ═══════════════════════════════════════════════════════════════════════════

export const MARKETPLACE_OCULTO = true;

/** La pantalla que se esconde. No se borra: aquí queda escrita para el camino viejo. */
export const RUTA_MARKETPLACE = "/dashboard/marketplace";

/**
 * A dónde va ahora quien antes caía en Marketplace. Es el mismo destino que ya
 * usan `trial-banner.tsx` y el aviso de prueba del menú: la pestaña donde la
 * clínica ve su plan.
 */
export const RUTA_PLANES = "/dashboard/settings?tab=subscription";

/** ¿Se esconde Marketplace para esta carga? Solo en el camino nuevo. */
export function seOcultaMarketplace(rediseno: boolean): boolean {
  return MARKETPLACE_OCULTO && rediseno;
}

/** El destino de siempre cuando un módulo de especialidad venció. */
export function destinoViejoModuloVencido(moduleKey: string): string {
  return `${RUTA_MARKETPLACE}?expired=${moduleKey}`;
}

/** Módulo vencido: camino nuevo → Planes; bandera apagada → lo de siempre. */
export function destinoModuloVencidoSegun(rediseno: boolean, moduleKey: string): string {
  return seOcultaMarketplace(rediseno) ? RUTA_PLANES : destinoViejoModuloVencido(moduleKey);
}
