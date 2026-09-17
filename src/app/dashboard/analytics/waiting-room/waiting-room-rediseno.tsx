"use client";

import { Clock, AlertTriangle } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { MarcoAnalitica } from "@/components/dashboard/analitica-rediseno/marco";
import { Indicador, Panel, Tabla, Th, Td, Filas, Fila, Vacio, Cargando, Nota, unir } from "@/components/dashboard/analitica-rediseno/piezas";
import { MapaCalor } from "@/components/dashboard/analitica-rediseno/graficas";
import s from "@/components/dashboard/analitica-rediseno/analitica.module.css";
import type { ApiResponse } from "./waiting-room-client";

export function WaitingRoomRediseno({ data, loading }: { data: ApiResponse | null; loading: boolean }) {
  const t = useT();
  return (
    <MarcoAnalitica title={t("analytics.waitingRoom.title")} subtitle={t("analytics.waitingRoom.subtitle")}>
      {loading ? (
        <Cargando>{t("common.loading")}</Cargando>
      ) : !data || data.sampleSize === 0 ? (
        <Vacio icon={Clock} title={t("analytics.waitingRoom.emptyTitle")} hint={t("analytics.waitingRoom.emptyHint")} peligro={!data} />
      ) : (
        <div className={s.pila}>
          {data.longWaits.length > 0 && (
            <div className={unir(s.aviso, s.avisoPeligro, s.avisoLista)} role="alert">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className={unir(s.avisoCabeza, s.peligro)}>
                  <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
                  {t("analytics.waitingRoom.alertBanner", { count: data.longWaits.length, threshold: data.threshold })}
                </div>
                <Filas>
                  {data.longWaits.map((w) => (
                    <Fila key={w.appointmentId}>
                      <div className={unir(s.filaCifra, s.peligro)}>{w.waitedMin}m</div>
                      <div className={s.filaCuerpo}>
                        <span className={s.filaTitulo}>{w.patient}</span>
                        <span className={s.filaSub}>
                          {w.type} · {t("analytics.waitingRoom.doctorPrefix")} {w.doctor}
                        </span>
                      </div>
                    </Fila>
                  ))}
                </Filas>
              </div>
            </div>
          )}

          <div className={s.indicadores}>
            <Indicador
              label={t("analytics.waitingRoom.kpiAvgLabel")}
              value={`${data.overallAvg} min`}
              hint={t("analytics.waitingRoom.kpiAvgHint", { count: data.sampleSize })}
              icon={<Clock size={16} strokeWidth={1.75} aria-hidden />}
              tone={data.overallAvg > data.threshold ? "alerta" : "neutro"}
            />
            <Indicador
              label={t("analytics.waitingRoom.kpiMedianLabel")}
              value={`${data.overallMedian} min`}
              hint={t("analytics.waitingRoom.kpiMedianHint")}
              icon={<Clock size={16} strokeWidth={1.75} aria-hidden />}
            />
            <Indicador
              label={t("analytics.waitingRoom.kpiAlertsLabel")}
              value={String(data.longWaits.length)}
              hint={t("analytics.waitingRoom.kpiAlertsHint", { threshold: data.threshold })}
              icon={<AlertTriangle size={16} strokeWidth={1.75} aria-hidden />}
              tone={data.longWaits.length > 0 ? "peligro" : "exito"}
            />
          </div>

          <Panel title={t("analytics.waitingRoom.heatmapTitle")}>
            <MapaCalor
              data={data.heatmap.map((row) =>
                row.map(({ value, count }) => ({
                  // Igual que hoy: minutos normalizados a 0-100 con el umbral como «rojo».
                  value: Math.round((value / Math.max(1, data.threshold)) * 70),
                  count,
                  label: `${value} min`,
                })),
              )}
              hours={data.hours}
            />
            <Nota>{t("analytics.waitingRoom.heatmapCaption", { threshold: data.threshold })}</Nota>
          </Panel>

          <Panel title={t("analytics.waitingRoom.tableTitle")} ajustado>
            <Tabla>
              <thead>
                <tr>
                  <Th>{t("analytics.waitingRoom.colHour")}</Th>
                  <Th align="right">{t("analytics.waitingRoom.colAvg")}</Th>
                  <Th align="right">{t("analytics.waitingRoom.colAppts")}</Th>
                  <Th align="right">{t("analytics.waitingRoom.colLongWaits")}</Th>
                </tr>
              </thead>
              <tbody>
                {data.byHour.map((h) => (
                  <tr key={h.hour}>
                    <Td cifra>{h.hour}:00</Td>
                    <Td align="right" cifra tono={h.avgMin > data.threshold ? "peligro" : undefined}>
                      <strong>{h.avgMin} min</strong>
                    </Td>
                    <Td align="right" cifra tono="neutro">{h.count}</Td>
                    <Td align="right" cifra tono={h.longWaits > 0 ? "alerta" : "neutro"}>{h.longWaits}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          </Panel>
        </div>
      )}
    </MarcoAnalitica>
  );
}
