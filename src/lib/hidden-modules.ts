// ═══════════════════════════════════════════════════════════════════
// Módulos ocultos TEMPORALMENTE del panel de la clínica.
//
// Proveedores / Mis compras / Laboratorios / Mis órdenes de laboratorio
// están construidos y siguen siendo navegables por URL, pero todavía no
// queremos exponerlos. Esta bandera es el ÚNICO interruptor y apaga:
//   1. Los 4 items del sidebar (shouldShowItem en components/dashboard/sidebar.tsx).
//   2. El FAB de chat flotante del dashboard (app/dashboard/layout.tsx), que
//      SÓLO sirve a esas 2 áreas (pestañas Proveedores + Laboratorios) y por
//      tanto sería la otra puerta visible al área.
//
// Para volver a mostrarlos: poner HIDE_SUPPLY_MODULES en false. No hace falta
// tocar nada más. NO gatea las rutas ni las APIs — es sólo visibilidad de menú.
// ═══════════════════════════════════════════════════════════════════

export const HIDE_SUPPLY_MODULES = true;

/** Ids de NAV_ITEMS que desaparecen mientras HIDE_SUPPLY_MODULES sea true. */
export const SUPPLY_NAV_IDS: readonly string[] = [
  "suppliers",
  "compras",
  "laboratorios",
  "ordenes-laboratorio",
];
