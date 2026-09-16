/**
 * Las NUEVE pestañas de Analítica, en el mismo orden, con las mismas etiquetas
 * y rutas que `analytics-layout.tsx` (el marco de hoy). Ni una más ni una
 * menos: lo que hay en la pantalla hoy es la lista completa de lo que puede
 * haber mañana. Sin JSX ni íconos a propósito: así el test la compara contra el
 * marco viejo sin montar React.
 */
export const PESTANAS: ReadonlyArray<{ id: string; labelKey: string; href: string }> = [
  { id: "overview",   labelKey: "analytics.layout.tabOverview",   href: "/dashboard/analytics" },
  { id: "occupancy",  labelKey: "analytics.layout.tabOccupancy",  href: "/dashboard/analytics/occupancy" },
  { id: "doctors",    labelKey: "analytics.layout.tabDoctors",    href: "/dashboard/analytics/doctors" },
  { id: "procedures", labelKey: "analytics.layout.tabProcedures", href: "/dashboard/analytics/procedures" },
  { id: "no-shows",   labelKey: "analytics.layout.tabNoShows",    href: "/dashboard/analytics/no-shows" },
  { id: "waiting",    labelKey: "analytics.layout.tabWaiting",    href: "/dashboard/analytics/waiting-room" },
  { id: "costs",      labelKey: "analytics.layout.tabCosts",      href: "/dashboard/analytics/costs" },
  { id: "journey",    labelKey: "analytics.layout.tabJourney",    href: "/dashboard/analytics/journey" },
  // "CRM" no existe como llave en el diccionario a propósito (igual que hoy):
  // el motor i18n devuelve la propia llave y "CRM" es idéntico en es/en.
  { id: "crm",        labelKey: "CRM",                            href: "/dashboard/analytics/crm" },
];

/** ¿Es esta la pestaña de la ruta actual? Misma regla que el marco de hoy. */
export function pestanaActiva(href: string, pathname: string | null | undefined): boolean {
  return href === "/dashboard/analytics" ? pathname === href : Boolean(pathname?.startsWith(href));
}
