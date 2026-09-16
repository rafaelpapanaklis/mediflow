"use client";

import { AlertCircle, Sparkles, RefreshCw } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { MarcoAnalitica } from "@/components/dashboard/analitica-rediseno/marco";
import { Indicador, Panel, Filas, Fila, Boton, Aviso, Vacio, Cargando, unir } from "@/components/dashboard/analitica-rediseno/piezas";
import s from "@/components/dashboard/analitica-rediseno/analitica.module.css";
import { DAY_KEYS, type ApiResponse } from "./no-shows-client";

export function NoShowsRediseno({
  data,
  loading,
  aiInsight,
  aiLoading,
  requestAiInsight,
  refreshingPredId,
  refreshPrediction,
}: {
  data: ApiResponse | null;
  loading: boolean;
  aiInsight: string | null;
  aiLoading: boolean;
  requestAiInsight: () => void;
  refreshingPredId: string | null;
  refreshPrediction: (appointmentId: string) => void;
}) {
  const t = useT();
  const peorDia = data ? [...data.byDayOfWeek].sort((a, b) => b.rate - a.rate)[0] : undefined;
  const peorHora = data ? [...data.byHour].sort((a, b) => b.rate - a.rate)[0] : undefined;

  return (
    <MarcoAnalitica
      title={t("analytics.noShows.title")}
      subtitle={t("analytics.noShows.subtitle")}
      acciones={
        data && data.total > 0 ? (
          <Boton principal onClick={requestAiInsight} disabled={aiLoading} style={{ cursor: aiLoading ? "wait" : undefined }}>
            <Sparkles size={16} strokeWidth={1.75} aria-hidden />
            {aiLoading ? t("analytics.noShows.analyzing") : t("analytics.noShows.analyzeWithAi")}
          </Boton>
        ) : null
      }
    >
      {loading ? (
        <Cargando>{t("common.loading")}</Cargando>
      ) : !data || data.total === 0 ? (
        <Vacio icon={AlertCircle} title={t("analytics.noShows.noAppointments")} peligro={!data} />
      ) : (
        <div className={s.pila}>
          {aiInsight && (
            <Aviso tono="ia" icon={Sparkles}>
              {aiInsight}
            </Aviso>
          )}

          <div className={s.indicadores}>
            <Indicador
              label={t("analytics.noShows.rateLabel")}
              value={`${data.rate}%`}
              hint={t("analytics.noShows.rateHint", { count: data.noShowCount, total: data.total })}
              icon={<AlertCircle size={16} strokeWidth={1.75} aria-hidden />}
              tone={data.rate > 10 ? "peligro" : data.rate > 5 ? "alerta" : "exito"}
            />
            <Indicador
              label={t("analytics.noShows.worstDayLabel")}
              value={peorDia && peorDia.total > 0 ? t(DAY_KEYS[peorDia.dayIdx]!) : "—"}
              hint={peorDia ? t("analytics.noShows.worstHint", { rate: peorDia.rate, count: peorDia.count }) : ""}
            />
            <Indicador
              label={t("analytics.noShows.worstHourLabel")}
              value={peorHora && peorHora.total > 0 ? `${peorHora.hour}:00` : "—"}
              hint={peorHora ? t("analytics.noShows.worstHint", { rate: peorHora.rate, count: peorHora.count }) : ""}
            />
          </div>

          {data.upcomingHighRisk.length > 0 && (
            <Panel title={t("analytics.noShows.upcomingHighRisk")} ajustado>
              <Filas>
                {data.upcomingHighRisk.map((u) => (
                  <Fila key={u.appointmentId}>
                    <div className={unir(s.filaCifra, u.probability >= 0.75 ? s.peligro : s.alerta)}>
                      {Math.round(u.probability * 100)}%
                    </div>
                    <div className={s.filaCuerpo}>
                      <span className={s.filaTitulo}>{u.patient}</span>
                      <span className={s.filaSub}>
                        {new Date(u.startsAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })} · {u.type} ·{" "}
                        {t("analytics.noShows.doctorPrefix")} {u.doctor}
                      </span>
                      {u.factors.slice(0, 2).map((f, i) => (
                        <div key={i} className={s.filaDetalle}>• {f.reason}</div>
                      ))}
                    </div>
                    <Boton
                      chico
                      onClick={() => refreshPrediction(u.appointmentId)}
                      disabled={refreshingPredId === u.appointmentId}
                      title={t("analytics.noShows.recalculateWithAi")}
                    >
                      <RefreshCw
                        size={12}
                        strokeWidth={1.75}
                        aria-hidden
                        className={refreshingPredId === u.appointmentId ? s.girando : undefined}
                      />
                      {refreshingPredId === u.appointmentId ? "…" : t("analytics.noShows.refresh")}
                    </Boton>
                  </Fila>
                ))}
              </Filas>
            </Panel>
          )}

          {data.topPatients.length > 0 && (
            <Panel title={t("analytics.noShows.topPatientsTitle")} ajustado>
              <Filas>
                {data.topPatients.map((p) => (
                  <Fila key={p.id}>
                    <div className={s.filaCuerpo}>
                      <span className={s.filaTitulo} style={{ fontWeight: 500 }}>{p.name}</span>
                    </div>
                    <span className={unir(s.filaCifraChica, s.peligro)}>
                      {t("analytics.noShows.noShowCount", { count: p.count })}
                    </span>
                  </Fila>
                ))}
              </Filas>
            </Panel>
          )}
        </div>
      )}
    </MarcoAnalitica>
  );
}
