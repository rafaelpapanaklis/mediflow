import type { ChairStatus } from "@/lib/floor-plan/element-types";

/**
 * LAS PALABRAS DEL PISO — los tres estados y sus llaves de traducción.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * Viven aquí, y no dentro de `src/components/floor-plan/`, porque la capa
 * compartida NO conoce ni una palabra del negocio: todo texto le entra por
 * prop, y por eso la puede montar también el vertical institucional (que
 * dice "sede" donde el dental dice "sucursal"). Este archivo es el lado
 * dental de ese contrato.
 *
 * Lo leen las DOS pantallas que pintan este piso —el editor del panel y el
 * televisor de recepción de /live/[slug]— para que los contadores y la
 * leyenda digan lo mismo en las dos. El televisor no cuelga del
 * I18nProvider, así que resuelve estas mismas llaves con el respaldo de
 * `public-live-t.ts`: si añades una, añádela también allí.
 */
export const ESTADOS: ChairStatus[] = ["libre", "proximo", "ocupado"];

/** "3 libres" — el plural que acompaña al número en los contadores. */
export const COUNT_KEY: Record<ChairStatus, string> = {
  libre: "pages.clinicLayout.statusCountFree",
  proximo: "pages.clinicLayout.statusCountUpcoming",
  ocupado: "pages.clinicLayout.statusCountOccupied",
};

/** Qué significa el estado, en una frase. Va en el `title`. */
export const DETAIL_KEY: Record<ChairStatus, string> = {
  libre: "pages.clinicLayout.statusDetailFree",
  proximo: "pages.clinicLayout.statusDetailUpcoming",
  ocupado: "pages.clinicLayout.statusDetailOccupied",
};

/** El nombre del estado, en singular: "Libre", "Próximo", "Ocupado". */
export const LABEL_KEY: Record<ChairStatus, string> = {
  libre: "pages.clinicLayout.legendFree",
  proximo: "pages.clinicLayout.legendUpcoming",
  ocupado: "pages.clinicLayout.legendOccupied",
};
