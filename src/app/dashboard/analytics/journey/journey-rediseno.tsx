"use client";

import { AlertTriangle, Clock, Route } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { MarcoAnalitica } from "@/components/dashboard/analitica-rediseno/marco";
import { Panel, Filas, Fila, FiltroPeriodo, Aviso, Vacio, Cargando, Nota, unir } from "@/components/dashboard/analitica-rediseno/piezas";
import { Embudo } from "@/components/dashboard/analitica-rediseno/graficas";
import s from "@/components/dashboard/analitica-rediseno/analitica.module.css";
import { PRESETS, type ApiResponse } from "./journey-client";

export function JourneyRediseno({
  preset,
  setPreset,
  data,
  loading,
}: {
  preset: string;
  setPreset: (v: string) => void;
  data: ApiResponse | null;
  loading: boolean;
}) {
  const t = useT();
  return (
    <MarcoAnalitica
      title={t("analytics.journeyClient.title")}
      subtitle={t("analytics.journeyClient.subtitle")}
      acciones={
        <FiltroPeriodo value={preset} onChange={setPreset} options={PRESETS.map((p) => ({ id: p.id, label: t(p.labelKey) }))} />
      }
    >
      {loading ? (
        <Cargando>{t("analytics.journeyClient.loadingFlow")}</Cargando>
      ) : !data || data.totalAppts === 0 ? (
        <Vacio icon={Route} title={t("analytics.journeyClient.noAppointments")} peligro={!data} />
      ) : (
        <>
          {data.bottleneck && data.bottleneck.sample > 0 && (
            <Aviso
              tono={data.bottleneck.avgMin > 30 ? "peligro" : "alerta"}
              icon={AlertTriangle}
              title={
                <>
                  {t("analytics.journeyClient.bottleneckLabel", { label: data.bottleneck.label })}
                  {" — "}
                  <span style={{ fontWeight: 500 }}>{t("analytics.journeyClient.avgMinSuffix", { avgMin: data.bottleneck.avgMin })}</span>
                </>
              }
              pie={t("analytics.journeyClient.bottleneckMeasured", {
                from: data.bottleneck.from,
                to: data.bottleneck.to,
                sample: data.bottleneck.sample,
              })}
            />
          )}

          <div className={s.pila}>
            <Panel title={t("analytics.journeyClient.appointmentsFunnel")}>
              <Embudo funnel={data.funnel} dropOffs={data.dropOffs} totalAppts={data.totalAppts} />
            </Panel>

            <Panel title={t("analytics.journeyClient.avgTimePerStage")} ajustado>
              <Filas>
                {data.stages.map((st) => (
                  <Fila key={st.id} className={data.bottleneck?.id === st.id ? s.filaAlerta : undefined}>
                    <div className={s.filaCuerpo}>
                      <span className={s.filaTitulo}>{st.label}</span>
                      <span className={s.filaSub}>{st.from} → {st.to}</span>
                    </div>
                    <span className={unir(s.filaCifraChica, s.apagado)} style={{ fontWeight: 500 }}>n={st.sample}</span>
                    <span
                      className={unir(
                        s.filaCifra,
                        st.sample === 0 ? s.muyApagado : st.avgMin > 30 ? s.peligro : st.avgMin > 15 ? s.alerta : s.exito,
                      )}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 }}
                    >
                      <Clock size={13} strokeWidth={1.75} aria-hidden />
                      {st.sample > 0 ? `${st.avgMin} min` : "—"}
                    </span>
                  </Fila>
                ))}
              </Filas>
            </Panel>
          </div>
          <Nota>{t("analytics.journeyClient.timingNote")}</Nota>
        </>
      )}
    </MarcoAnalitica>
  );
}
