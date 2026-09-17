/**
 * Las pestañas de Analítica: las NUEVE de `analytics-layout.tsx` (el marco de
 * hoy), en el mismo orden y con las mismas etiquetas y rutas, y al final
 * Reportes, que solo existe en el marco nuevo (Rafael: «agrega una pestaña de
 * Reportes en analytics»). Va la última para que las nueve de siempre no se
 * muevan de sitio. Sin JSX ni íconos a propósito: así el test la compara
 * contra el marco viejo sin montar React.
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
  // Reportes: la pantalla `/dashboard/reports` entera, como pestaña. El marco
  // de hoy (bandera apagada) no la lleva: allí Reportes sigue en el menú.
  { id: "reports",    labelKey: "analytics.layout.tabReports",    href: "/dashboard/analytics/reports" },
];

/** ¿Es esta la pestaña de la ruta actual? Misma regla que el marco de hoy. */
export function pestanaActiva(href: string, pathname: string | null | undefined): boolean {
  return href === "/dashboard/analytics" ? pathname === href : Boolean(pathname?.startsWith(href));
}
