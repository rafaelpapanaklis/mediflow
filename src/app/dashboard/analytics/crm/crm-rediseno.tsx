"use client";

import { DollarSign, AlertTriangle, TrendingUp, MessageCircle, Users, LineChart as IconoLineas } from "lucide-react";
import { MarcoAnalitica } from "@/components/dashboard/analitica-rediseno/marco";
import { Indicador, Panel, Tabla, Th, Td, Filas, Fila, FiltroPeriodo, Etiqueta, Vacio, Cargando, unir } from "@/components/dashboard/analitica-rediseno/piezas";
import { GraficaLineas } from "@/components/dashboard/analitica-rediseno/graficas";
import s from "@/components/dashboard/analitica-rediseno/analitica.module.css";
import { money, dateShort, waLink, type ValueResp, type ChurnResp, type CohortResp, type ValueRow, type SortKey } from "./crm-client";

/**
 * CRM con el diseño nuevo. Los textos van en español a mano igual que en
 * `CrmClient` (esa pantalla no pasa por i18n hoy); no se añade ninguno.
 */
export function CrmRediseno({
  value,
  churn,
  cohorts,
  loading,
  sortKey,
  setSortKey,
  topSorted,
  chartData,
  milestones,
}: {
  value: ValueResp | null;
  churn: ChurnResp | null;
  cohorts: CohortResp | null;
  loading: boolean;
  sortKey: SortKey;
  setSortKey: (k: SortKey) => void;
  topSorted: ValueRow[];
  chartData: Array<Record<string, number | string | null>>;
  milestones: number[];
}) {
  return (
    <MarcoAnalitica title="CRM" subtitle="Valor de pacientes, riesgo de abandono y retención por cohorte">
      {loading ? (
        <Cargando>Cargando…</Cargando>
      ) : (
        <>
          <div className={s.indicadores}>
            <Indicador
              label="LTV promedio"
              value={money(value?.totals.avgLtv ?? 0)}
              hint="cobrado por paciente"
              icon={<TrendingUp size={16} strokeWidth={1.75} aria-hidden />}
            />
            <Indicador
              label="Ingresos cobrados"
              value={money(value?.totals.paid ?? 0)}
              hint={`${value?.totals.payingPatients ?? 0} pacientes con pagos`}
              icon={<DollarSign size={16} strokeWidth={1.75} aria-hidden />}
              tone="exito"
            />
            <Indicador
              label="Saldo por cobrar"
              value={money(value?.totals.balance ?? 0)}
              hint={`${value?.totals.patients ?? 0} pacientes`}
              icon={<DollarSign size={16} strokeWidth={1.75} aria-hidden />}
              tone={value && value.totals.balance > 0 ? "alerta" : "neutro"}
            />
            <Indicador
              label="En riesgo de abandono"
              value={String(churn?.count ?? 0)}
              hint="requieren contacto"
              icon={<AlertTriangle size={16} strokeWidth={1.75} aria-hidden />}
              tone={churn && churn.count > 0 ? "peligro" : "exito"}
            />
          </div>

          <div className={s.pila}>
            <Panel title="Retención por cohorte (mes de alta)">
              {chartData.length === 0 ? (
                <Vacio icon={IconoLineas} title="Aún no hay suficientes datos de cohortes." peligro={!cohorts} />
              ) : (
                <GraficaLineas
                  data={chartData}
                  xKey="month"
                  series={milestones.map((m) => ({ key: `m${m}`, name: `${m} ${m === 1 ? "mes" : "meses"}` }))}
                  yDomain={[0, 100]}
                  yTicks={[0, 25, 50, 75, 100]}
                  formatY={(v) => `${v}%`}
                  formatValor={(v) => (v == null ? "—" : `${v}%`)}
                />
              )}
            </Panel>

            <div className={s.columnasAnchaEstrecha}>
              <Panel
                title="Top pacientes por valor"
                ajustado
                right={
                  <FiltroPeriodo<SortKey>
                    value={sortKey}
                    onChange={setSortKey}
                    options={[
                      { id: "paid", label: "Pagado" },
                      { id: "invoiced", label: "Facturado" },
                      { id: "balance", label: "Saldo" },
                      { id: "visits", label: "Visitas" },
                    ]}
                  />
                }
              >
                {topSorted.length === 0 ? (
                  <div style={{ padding: 18 }}>
                    <Vacio icon={Users} title="Sin pacientes con facturación todavía." peligro={!value} />
                  </div>
                ) : (
                  <Tabla>
                    <thead>
                      <tr>
                        <Th>Paciente</Th>
                        <Th align="right">Facturado</Th>
                        <Th align="right">Pagado</Th>
                        <Th align="right">Saldo</Th>
                        <Th align="right">Visitas</Th>
                        <Th align="right">Última</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {topSorted.slice(0, 25).map((p) => (
                        <tr key={p.id}>
                          <Td>
                            <strong className={s.fuerte}>{p.name}</strong>
                            <span className={s.celdaSub}>{p.patientNumber}</span>
                          </Td>
                          <Td align="right" cifra tono="neutro">{money(p.invoiced)}</Td>
                          <Td align="right" cifra tono="exito"><strong>{money(p.paid)}</strong></Td>
                          <Td align="right" cifra className={p.balance > 0 ? s.peligro : s.muyApagado}>
                            {p.balance > 0 ? money(p.balance) : "—"}
                          </Td>
                          <Td align="right" cifra tono="neutro">{p.visits}</Td>
                          <Td align="right" cifra tono="neutro">{dateShort(p.lastVisit)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Tabla>
                )}
              </Panel>

              <Panel title={`Riesgo de abandono${churn ? ` (${churn.count})` : ""}`} ajustado>
                {!churn || churn.patients.length === 0 ? (
                  <div style={{ padding: 18 }}>
                    <Vacio icon={Users} title="Ningún paciente en riesgo. 🎉" peligro={!churn} />
                  </div>
                ) : (
                  <Filas>
                    {churn.patients.slice(0, 20).map((p) => {
                      const wa = waLink(p.phone);
                      return (
                        <Fila key={p.id} style={{ alignItems: "flex-start" }}>
                          <div className={s.filaCuerpo}>
                            <span className={s.filaTitulo}>{p.name}</span>
                            <div className={s.etiquetas}>
                              {p.reasons.map((r, i) => (
                                <Etiqueta key={i} tono="peligro">{r}</Etiqueta>
                              ))}
                            </div>
                          </div>
                          {wa ? (
                            <a
                              href={wa}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={unir(s.boton, s.botonChico, s.botonExito)}
                              title="Contactar por WhatsApp"
                            >
                              <MessageCircle size={12} strokeWidth={1.75} aria-hidden /> Contactar
                            </a>
                          ) : (
                            <span className={unir(s.pequeno, s.muyApagado)} style={{ flexShrink: 0 }}>Sin teléfono</span>
                          )}
                        </Fila>
                      );
                    })}
                  </Filas>
                )}
              </Panel>
            </div>
          </div>
        </>
      )}
    </MarcoAnalitica>
  );
}
