"use client";

import { Star, FileDown, Stethoscope } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { MarcoAnalitica } from "@/components/dashboard/analitica-rediseno/marco";
import { Panel, Tabla, Th, Td, FiltroPeriodo, Boton, Vacio, Cargando, Nota } from "@/components/dashboard/analitica-rediseno/piezas";
import s from "@/components/dashboard/analitica-rediseno/analitica.module.css";
import { PRESETS, type ApiResponse } from "./doctors-client";

export function DoctorsRediseno({
  preset,
  setPreset,
  data,
  loading,
  generatingPayroll,
  generatePayroll,
}: {
  preset: string;
  setPreset: (v: string) => void;
  data: ApiResponse | null;
  loading: boolean;
  generatingPayroll: boolean;
  generatePayroll: () => void;
}) {
  const t = useT();
  return (
    <MarcoAnalitica
      title={t("analytics.doctors.title")}
      subtitle={t("analytics.doctors.subtitle")}
      acciones={
        <>
          <FiltroPeriodo value={preset} onChange={setPreset} options={PRESETS.map((p) => ({ id: p.id, label: t(p.labelKey) }))} />
          <Boton
            onClick={generatePayroll}
            disabled={!data || data.doctors.length === 0 || generatingPayroll}
            style={{ cursor: generatingPayroll ? "wait" : undefined }}
          >
            <FileDown size={16} strokeWidth={1.75} aria-hidden />
            {generatingPayroll ? t("analytics.doctors.generating") : t("analytics.doctors.exportPayroll")}
          </Boton>
        </>
      }
    >
      {loading ? (
        <Cargando>{t("common.loading")}</Cargando>
      ) : !data || data.doctors.length === 0 ? (
        <Vacio icon={Stethoscope} title={t("analytics.doctors.noDataTitle")} hint={t("analytics.doctors.noDataDesc")} peligro={!data} />
      ) : (
        <Panel ajustado>
          <Tabla>
            <thead>
              <tr>
                <Th>{t("analytics.doctors.colDoctor")}</Th>
                <Th align="right">{t("analytics.doctors.colAppts")}</Th>
                <Th align="right">{t("analytics.doctors.colCompleted")}</Th>
                <Th align="right">{t("analytics.doctors.colPerDay")}</Th>
                <Th align="right">{t("analytics.doctors.colNoShows")}</Th>
                <Th align="right">{t("analytics.doctors.colAvgTime")}</Th>
                <Th align="right">{t("analytics.doctors.colSatisfaction")}</Th>
                <Th align="right">{t("analytics.doctors.colRevenue")}</Th>
              </tr>
            </thead>
            <tbody>
              {data.doctors.map((d) => (
                <tr key={d.id}>
                  <Td>
                    <div className={s.celdaNombre}>
                      <span aria-hidden className={s.puntoColor} style={{ background: d.color }} />
                      <strong className={s.fuerte}>{d.name}</strong>
                      <span className={`${s.pequeno} ${s.apagado}`}>{d.role}</span>
                    </div>
                  </Td>
                  <Td align="right" cifra>{d.apptsTotal}</Td>
                  <Td align="right" cifra><strong>{d.apptsCompleted}</strong></Td>
                  <Td align="right" cifra tono="neutro">{d.apptsPerDay}</Td>
                  <Td align="right" cifra tono={d.noShowRate > 10 ? "peligro" : "neutro"}>
                    {d.apptsNoShow} <span className={s.pequeno}>({d.noShowRate}%)</span>
                  </Td>
                  <Td align="right" cifra>
                    {d.avgConsultMin != null ? t("analytics.doctors.minutes", { count: d.avgConsultMin }) : "—"}
                  </Td>
                  <Td align="right" cifra>
                    {d.avgSatisfaction != null ? (
                      <span className={s.alerta} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontWeight: 600 }}>
                        <Star size={11} fill="currentColor" aria-hidden />
                        {d.avgSatisfaction.toFixed(1)}
                        <span className={`${s.pequeno} ${s.muyApagado}`} style={{ fontWeight: 500 }}>({d.satisfactionCount})</span>
                      </span>
                    ) : (
                      <span className={s.muyApagado}>—</span>
                    )}
                  </Td>
                  <Td align="right" cifra>
                    <strong>${d.revenueGenerated.toLocaleString("es-MX", { maximumFractionDigits: 0 })}</strong>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        </Panel>
      )}
      <Nota>{t("analytics.doctors.footerNote")}</Nota>
    </MarcoAnalitica>
  );
}
