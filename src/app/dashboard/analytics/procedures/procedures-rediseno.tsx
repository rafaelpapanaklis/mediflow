"use client";

import { TrendingUp, TrendingDown, Minus, Sparkles, Database } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { MarcoAnalitica } from "@/components/dashboard/analitica-rediseno/marco";
import { Panel, Tabla, Th, Td, Boton, Aviso, Vacio, Cargando, Nota, unir } from "@/components/dashboard/analitica-rediseno/piezas";
import s from "@/components/dashboard/analitica-rediseno/analitica.module.css";
import type { ApiResponse } from "./procedures-client";

export function ProceduresRediseno({
  data,
  loading,
  aiInsight,
  aiLoading,
  requestAiInsight,
}: {
  data: ApiResponse | null;
  loading: boolean;
  aiInsight: string | null;
  aiLoading: boolean;
  requestAiInsight: () => void;
}) {
  const t = useT();
  return (
    <MarcoAnalitica
      title={t("analytics.procedures.title")}
      subtitle={t("analytics.procedures.subtitle")}
      acciones={
        data && !data.insufficientData ? (
          <Boton principal onClick={requestAiInsight} disabled={aiLoading} style={{ cursor: aiLoading ? "wait" : undefined }}>
            <Sparkles size={16} strokeWidth={1.75} aria-hidden />
            {aiLoading ? t("analytics.procedures.analyzing") : t("analytics.procedures.analyzeWithAi")}
          </Boton>
        ) : null
      }
    >
      {loading ? (
        <Cargando>{t("common.loading")}</Cargando>
      ) : !data || data.insufficientData ? (
        <Vacio
          icon={Database}
          title={t("analytics.procedures.collectingData")}
          hint={t("analytics.procedures.collectingDataDetail", { count: data?.sampleSize ?? 0 })}
          peligro={!data}
        />
      ) : (
        <>
          {aiInsight && (
            <Aviso tono="ia" icon={Sparkles}>
              {aiInsight}
            </Aviso>
          )}

          <Panel ajustado>
            <Tabla>
              <thead>
                <tr>
                  <Th>{t("analytics.procedures.colProcedure")}</Th>
                  <Th align="right">{t("analytics.procedures.colPerformed")}</Th>
                  <Th align="right">{t("analytics.procedures.colAvgTime")}</Th>
                  <Th align="right">{t("analytics.procedures.colBenchmark")}</Th>
                  <Th align="right">{t("analytics.procedures.colVariance")}</Th>
                  <Th>{t("analytics.procedures.colFastest")}</Th>
                  <Th>{t("analytics.procedures.colSlowest")}</Th>
                </tr>
              </thead>
              <tbody>
                {data.procedures.map((p) => (
                  <tr key={p.type}>
                    <Td><strong className={s.fuerte}>{p.type}</strong></Td>
                    <Td align="right" cifra>{p.count}</Td>
                    <Td align="right" cifra><strong>{p.avgConsultMin} min</strong></Td>
                    <Td align="right" cifra tono="neutro">{p.benchmark != null ? `${p.benchmark} min` : "—"}</Td>
                    <Td align="right" cifra><Variacion variance={p.variance} /></Td>
                    <Td>
                      {p.fastest ? (
                        <span className={s.apagado}>
                          {p.fastest.name} <span className={unir(s.exito, s.cifra)}>{p.fastest.avgMin}min</span>
                        </span>
                      ) : (
                        <span className={s.muyApagado}>—</span>
                      )}
                    </Td>
                    <Td>
                      {p.slowest ? (
                        <span className={s.apagado}>
                          {p.slowest.name} <span className={unir(s.peligro, s.cifra)}>{p.slowest.avgMin}min</span>
                        </span>
                      ) : (
                        <span className={s.muyApagado}>—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          </Panel>
          <Nota>{t("analytics.procedures.footerNote", { count: data.sampleSize })}</Nota>
        </>
      )}
    </MarcoAnalitica>
  );
}

function Variacion({ variance }: { variance: number | null }) {
  if (variance == null) return <span className={s.muyApagado}>—</span>;
  const Icono = variance === 0 ? Minus : variance > 0 ? TrendingUp : TrendingDown;
  const clase = variance === 0 ? s.apagado : variance > 0 ? s.peligro : s.exito;
  return (
    <span className={clase} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600 }}>
      <Icono size={12} aria-hidden />
      {variance > 0 ? "+" : ""}{variance} min
    </span>
  );
}
