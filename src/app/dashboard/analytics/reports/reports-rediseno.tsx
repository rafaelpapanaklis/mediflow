"use client";

import type { ComponentProps } from "react";
import { useT } from "@/i18n/i18n-provider";
import { MarcoAnalitica } from "@/components/dashboard/analitica-rediseno/marco";
import { ReportsClient } from "../../reports/reports-client";

type Datos = Omit<ComponentProps<typeof ReportsClient>, "rediseno" | "enAnalitica">;

/**
 * Reportes como pestaña de Analítica: el marco de Analítica (las pestañas, el
 * título y el subtítulo) y, dentro, la pantalla de Reportes ENTERA —los dos
 * renglones de indicadores, las cuatro gráficas, la tabla por mes y el uso de
 * sillones—, sin nada detrás de un clic. No se copia ni una cifra: es el mismo
 * componente que pinta `/dashboard/reports`.
 */
export function ReportsRediseno(datos: Datos) {
  const t = useT();
  return (
    <MarcoAnalitica title={t("analytics.reports.pageTitle")} subtitle={t("analytics.reports.pageSubtitle")}>
      <ReportsClient {...datos} rediseno enAnalitica />
    </MarcoAnalitica>
  );
}
