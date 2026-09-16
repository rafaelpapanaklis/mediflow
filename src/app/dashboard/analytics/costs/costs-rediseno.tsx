"use client";

import { Pencil, Sparkles, DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { MarcoAnalitica } from "@/components/dashboard/analitica-rediseno/marco";
import { Indicador, Panel, Tabla, Th, Td, Boton, Aviso, Vacio, Cargando, Nota, unir } from "@/components/dashboard/analitica-rediseno/piezas";
import s from "@/components/dashboard/analitica-rediseno/analitica.module.css";
import { fmtMXN, type ApiResponse, type ResourceRow } from "./costs-client";

export function CostsRediseno({
  month,
  setMonth,
  data,
  loading,
  aiInsight,
  aiLoading,
  requestAiInsight,
  onEdit,
}: {
  month: string;
  setMonth: (v: string) => void;
  data: ApiResponse | null;
  loading: boolean;
  aiInsight: string | null;
  aiLoading: boolean;
  requestAiInsight: () => void;
  onEdit: (r: ResourceRow) => void;
}) {
  const t = useT();
  return (
    <MarcoAnalitica
      title={t("analytics.costs.title")}
      subtitle={t("analytics.costs.subtitle")}
      acciones={
        <>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={s.campo} style={{ minWidth: 0 }} />
          {data && data.resources.length > 0 && (
            <Boton principal onClick={requestAiInsight} disabled={aiLoading} style={{ cursor: aiLoading ? "wait" : undefined }}>
              <Sparkles size={16} strokeWidth={1.75} aria-hidden />
              {aiLoading ? t("analytics.costs.analyzing") : t("analytics.costs.analyzeWithAi")}
            </Boton>
          )}
        </>
      }
    >
      {loading ? (
        <Cargando>{t("common.loading")}</Cargando>
      ) : !data || data.resources.length === 0 ? (
        <Vacio icon={DollarSign} title={t("analytics.costs.noChairs")} peligro={!data} />
      ) : (
        <>
          {aiInsight && (
            <Aviso tono="ia" icon={Sparkles}>
              {aiInsight}
            </Aviso>
          )}

          <div className={s.indicadores}>
            <Indicador
              label={t("analytics.costs.revenue")}
              value={fmtMXN(data.totals.revenue)}
              tone="marca"
              valorConTono
              icon={<DollarSign size={16} strokeWidth={1.75} aria-hidden />}
            />
            <Indicador
              label={t("analytics.costs.costs")}
              value={fmtMXN(data.totals.cost)}
              tone="alerta"
              valorConTono
              icon={<TrendingDown size={16} strokeWidth={1.75} aria-hidden />}
            />
            <Indicador
              label={t("analytics.costs.margin")}
              value={fmtMXN(data.totals.margin)}
              tone={data.totals.margin >= 0 ? "exito" : "peligro"}
              valorConTono
              icon={<TrendingUp size={16} strokeWidth={1.75} aria-hidden />}
            />
          </div>

          <Panel ajustado>
            <Tabla>
              <thead>
                <tr>
                  <Th>{t("analytics.costs.colChair")}</Th>
                  <Th align="right">{t("analytics.costs.colRent")}</Th>
                  <Th align="right">{t("analytics.costs.colOps")}</Th>
                  <Th align="right">{t("analytics.costs.colTotalCost")}</Th>
                  <Th align="right">{t("analytics.costs.revenue")}</Th>
                  <Th align="right">{t("analytics.costs.margin")}</Th>
                  <Th align="right">{t("analytics.costs.colMarginPct")}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.resources.map((r) => (
                  <tr key={r.resourceId} className={r.margin < 0 ? s.filaResaltada : undefined}>
                    <Td>
                      <strong className={s.fuerte}>{r.name}</strong>
                      {!r.configured && (
                        <span className={unir(s.pequeno, s.muyApagado)} style={{ marginLeft: 8, fontStyle: "italic" }}>
                          {t("analytics.costs.noCosts")}
                        </span>
                      )}
                    </Td>
                    <Td align="right" cifra className={r.configured ? undefined : s.muyApagado}>{fmtMXN(r.monthlyRent)}</Td>
                    <Td align="right" cifra className={r.configured ? undefined : s.muyApagado}>{fmtMXN(r.monthlyOps)}</Td>
                    <Td align="right" cifra>{fmtMXN(r.totalCost)}</Td>
                    <Td align="right" cifra><strong>{fmtMXN(r.revenue)}</strong></Td>
                    <Td align="right" cifra tono={r.margin >= 0 ? "exito" : "peligro"}><strong>{fmtMXN(r.margin)}</strong></Td>
                    <Td
                      align="right"
                      cifra
                      className={
                        r.marginPct == null ? s.muyApagado :
                        r.marginPct >= 30 ? s.exito :
                        r.marginPct >= 0 ? s.alerta : s.peligro
                      }
                    >
                      {r.marginPct != null ? `${r.marginPct}%` : "—"}
                    </Td>
                    <Td align="right">
                      <Boton
                        chico
                        className={s.botonIcono}
                        onClick={() => onEdit(r)}
                        title={t("analytics.costs.editCosts")}
                        aria-label={t("analytics.costs.editCostsOf", { name: r.name })}
                      >
                        <Pencil size={12} strokeWidth={1.75} aria-hidden />
                      </Boton>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          </Panel>
          <Nota>{t("analytics.costs.footerNote")}</Nota>
        </>
      )}
    </MarcoAnalitica>
  );
}
