"use client";

import { Calendar, CheckCircle2, AlertCircle, Clock, Database } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { MarcoAnalitica } from "@/components/dashboard/analitica-rediseno/marco";
import { Indicador, Aviso } from "@/components/dashboard/analitica-rediseno/piezas";
import { Medidor, MedidorCargando } from "@/components/dashboard/analitica-rediseno/graficas";
import s from "@/components/dashboard/analitica-rediseno/analitica.module.css";
import type { OverviewData } from "./overview-client";

/**
 * Resumen con el diseño nuevo. Mismos datos, mismas cifras y el mismo
 * cálculo de tonos que `OverviewClient`; solo cambia la ropa. Se monta
 * únicamente con el interruptor `menu-dos-niveles` encendido.
 */
export function OverviewRediseno({
  data,
  score,
  scoreLoading,
}: {
  data: OverviewData;
  score: { today: number; monthAverage: number } | null;
  scoreLoading: boolean;
}) {
  const t = useT();
  return (
    <MarcoAnalitica title={t("analytics.overview.title")} subtitle={t("analytics.overview.subtitle")}>
      {data.insufficientData && (
        <Aviso
          tono="alerta"
          icon={Database}
          title={t("analytics.overview.collectingData")}
          progreso={data.dataProgress}
          pie={t("analytics.overview.percentOfMinimum", { progress: data.dataProgress })}
        >
          {t("analytics.overview.collectingDataDesc", { count: data.totalAppts })}
        </Aviso>
      )}

      <div className={s.resumen}>
        <div className={s.resumenMedidor}>
          {scoreLoading ? (
            <MedidorCargando>{t("analytics.overview.calculating")}</MedidorCargando>
          ) : (
            <Medidor score={score?.today ?? 0} monthAverage={score?.monthAverage ?? 0} />
          )}
        </div>

        <Indicador
          className={s.resumenTres}
          label={t("analytics.overview.apptsThisMonth")}
          value={data.monthAppts.toLocaleString("es-MX")}
          delta={data.apptsDeltaPct !== 0 ? { pct: data.apptsDeltaPct } : null}
          hint={t("analytics.overview.vsPrevMonth")}
          icon={<Calendar size={16} strokeWidth={1.75} aria-hidden />}
          tone="marca"
        />
        <Indicador
          className={s.resumenTres}
          label={t("analytics.overview.completed")}
          value={data.completedMonth.toLocaleString("es-MX")}
          delta={data.completedDeltaPct !== 0 ? { pct: data.completedDeltaPct } : null}
          hint={t("analytics.overview.vsPrevMonth")}
          icon={<CheckCircle2 size={16} strokeWidth={1.75} aria-hidden />}
          tone="exito"
        />
        <Indicador
          className={s.resumenTres}
          label={t("analytics.overview.noShows")}
          value={`${data.noShowRate.toFixed(1)}%`}
          delta={
            data.noShowDeltaPct !== 0
              ? { pct: data.noShowDeltaPct, absolute: t("analytics.overview.apptsCount", { count: data.noShowMonth }) }
              : null
          }
          hint={t("analytics.overview.ofMonthTotal")}
          icon={<AlertCircle size={16} strokeWidth={1.75} aria-hidden />}
          tone={data.noShowRate > 10 ? "peligro" : data.noShowRate > 5 ? "alerta" : "neutro"}
        />

        <Indicador
          className={s.resumenDos}
          label={t("analytics.overview.avgWaitTime")}
          value={
            data.avgWaitMin != null
              ? t("analytics.overview.minutesValue", { count: Math.round(data.avgWaitMin) })
              : "—"
          }
          hint={data.avgWaitMin == null ? t("analytics.overview.notEnoughDataWait") : t("analytics.overview.monthAverage")}
          icon={<Clock size={16} strokeWidth={1.75} aria-hidden />}
          tone={data.avgWaitMin != null && data.avgWaitMin > 20 ? "alerta" : "neutro"}
        />
        <Indicador
          className={s.resumenDos}
          label={t("analytics.overview.apptsToday")}
          value={data.todayCount.toLocaleString("es-MX")}
          hint={t("analytics.overview.scheduledNotCancelled")}
          icon={<Calendar size={16} strokeWidth={1.75} aria-hidden />}
          tone="marca"
        />
      </div>
    </MarcoAnalitica>
  );
}
