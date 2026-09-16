"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Target, ThumbsUp, Zap, AlertTriangle, ArrowRight } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { useTokensGrafica, type TokensGrafica } from "./raiz";
import { unir } from "./piezas";
import s from "./analitica.module.css";

/* ═══ Gráfica de líneas (recharts, rehecha con tokens) ════════════════
   Los colores de serie, ejes, rejilla y tooltip van en props de JS, así que
   se leen de los tokens del menú con `useTokensGrafica` en vez de copiarlos
   como hex. Hasta que hay lectura no se pinta: un frame en blanco es mejor
   que un frame con el color del tema equivocado. */

export interface SerieLineas {
  key: string;
  name: string;
}

export function GraficaLineas({
  data,
  xKey,
  series,
  height = 280,
  yDomain = [0, 100],
  yTicks,
  formatY = (v) => String(v),
  formatValor = (v) => (v == null ? "—" : String(v)),
}: {
  data: Array<Record<string, number | string | null>>;
  xKey: string;
  series: SerieLineas[];
  height?: number;
  yDomain?: [number, number];
  yTicks?: number[];
  formatY?: (v: number) => string;
  formatValor?: (v: number | null) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tokens = useTokensGrafica(ref);
  const colores = tokens ? paletaSeries(tokens) : [];

  return (
    <div ref={ref} className={s.grafica}>
      <div style={{ width: "100%", height }}>
        {tokens && (
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              {/* Solo horizontales: la rejilla vertical compite con las series. */}
              <CartesianGrid vertical={false} stroke={tokens.borde} strokeDasharray="2 6" />
              <XAxis
                dataKey={xKey}
                stroke={tokens.texto3}
                tick={{ fontSize: 11, fill: tokens.texto3, fontFamily: "inherit" }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={18}
                tickMargin={8}
              />
              <YAxis
                stroke={tokens.texto3}
                tick={{ fontSize: 11, fill: tokens.texto3, fontFamily: "inherit" }}
                axisLine={false}
                tickLine={false}
                width={40}
                domain={yDomain}
                ticks={yTicks}
                tickFormatter={formatY}
              />
              <Tooltip
                contentStyle={{
                  background: tokens.tarjeta,
                  border: `1px solid ${tokens.borde}`,
                  borderRadius: 10,
                  fontSize: 12,
                  fontFamily: "inherit",
                  color: tokens.texto,
                  boxShadow: "0 6px 20px -4px rgba(15, 10, 30, 0.18)",
                  padding: "8px 10px",
                }}
                labelStyle={{ color: tokens.texto3, fontSize: 11, marginBottom: 2 }}
                itemStyle={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
                cursor={{ stroke: tokens.activo, strokeOpacity: 0.35, strokeDasharray: "3 3" }}
                formatter={(v: unknown, name: unknown) => [formatValor(v as number | null), String(name)]}
              />
              {series.map((serie, i) => (
                <Line
                  key={serie.key}
                  type="monotone"
                  dataKey={serie.key}
                  name={serie.name}
                  stroke={colores[i % colores.length]}
                  strokeWidth={2}
                  dot={{ r: 2.5, strokeWidth: 0, fill: colores[i % colores.length] }}
                  activeDot={{ r: 4.5, stroke: tokens.tarjeta, strokeWidth: 2 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      {tokens && (
        <div className={s.leyenda}>
          {series.map((serie, i) => (
            <span key={serie.key} className={s.leyendaItem}>
              <i className={s.leyendaPunto} style={{ background: colores[i % colores.length] }} aria-hidden />
              {serie.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Orden de las series: el violeta del menú primero, luego azul, verde, ámbar. */
function paletaSeries(t: TokensGrafica): string[] {
  return [t.activo, t.azul, t.exito, t.alerta];
}

/* ═══ Mapa de calor día × hora ════════════════════════════════════════
   Cuadrícula CSS, sin librería. Mismos umbrales que hoy (<30, <50, <70,
   <100, ≥100 = sobrecupo) para no cambiar lo que significa cada celda; los
   tonos salen de los semánticos globales, en claro y en oscuro. */

export interface CeldaCalor {
  value: number;
  count?: number;
  label?: string;
}

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function claseCalor(value: number): string {
  if (value === 0) return s.calor0;
  if (value < 30) return s.calor1;
  if (value < 50) return s.calor2;
  if (value < 70) return s.calor3;
  if (value < 100) return s.calor4;
  return s.calor5;
}

export function MapaCalor({ data, hours, dias = DIAS }: { data: CeldaCalor[][]; hours: number[]; dias?: string[] }) {
  const t = useT();
  const [hover, setHover] = useState<{ day: number; hour: number; cell: CeldaCalor; x: number; y: number } | null>(null);
  const columnas = `42px repeat(${hours.length}, minmax(0, 1fr))`;

  return (
    <div className={s.calor}>
      <div className={s.calorFila} style={{ gridTemplateColumns: columnas }}>
        <div />
        {hours.map((h) => (
          <div key={h} className={s.calorHora}>
            {h.toString().padStart(2, "0")}
          </div>
        ))}
      </div>
      {data.map((fila, dia) => (
        <div key={dia} className={s.calorFila} style={{ gridTemplateColumns: columnas }}>
          <div className={s.calorDia}>{dias[dia]}</div>
          {fila.map((celda, i) => (
            <button
              key={i}
              type="button"
              className={unir(s.calorCelda, claseCalor(celda.value))}
              onMouseEnter={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setHover({ day: dia, hour: hours[i]!, cell: celda, x: r.left + r.width / 2, y: r.top - 8 });
              }}
              onMouseLeave={() => setHover(null)}
              onFocus={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setHover({ day: dia, hour: hours[i]!, cell: celda, x: r.left + r.width / 2, y: r.top - 8 });
              }}
              onBlur={() => setHover(null)}
              aria-label={t("analytics.heatmap.cellAria", { day: dias[dia]!, hour: hours[i]!, value: celda.value })}
            />
          ))}
        </div>
      ))}

      <div className={s.calorLeyenda}>
        <span>{t("analytics.heatmap.occupancyLegend")}</span>
        {[
          { label: "<30%", clase: s.calor1 },
          { label: "30-70%", clase: s.calor3 },
          { label: "70-100%", clase: s.calor4 },
          { label: ">100%", clase: s.calor5 },
        ].map((l) => (
          <span key={l.label} className={s.calorMuestra}>
            <i className={l.clase} aria-hidden />
            {l.label}
          </span>
        ))}
      </div>

      {hover && (
        <div role="tooltip" className={s.calorTooltip} style={{ left: hover.x, top: hover.y }}>
          <strong>
            {dias[hover.day]} · {hover.hour.toString().padStart(2, "0")}:00
          </strong>
          <small>
            {t("analytics.heatmap.tooltipOccupancy", { value: hover.cell.value })}
            {hover.cell.count != null && ` · ${t("analytics.heatmap.tooltipAppointments", { count: hover.cell.count })}`}
          </small>
          {hover.cell.label && <small>{hover.cell.label}</small>}
        </div>
      )}
    </div>
  );
}

/* ═══ Medidor 0–100 (eficiencia operativa) ════════════════════════════
   El arco toma el color con `var()` en el atributo `stroke`, que el panel ya
   usa en su gráfica de ingresos; así sigue al tema sin leer nada en JS. */

export function Medidor({ score, monthAverage, label }: { score: number; monthAverage?: number; label?: string }) {
  const t = useT();
  const etiqueta = label ?? t("analytics.efficiencyGauge.label");
  const seguro = Math.max(0, Math.min(100, score));
  const tono = tonoMedidor(seguro);
  const delta = monthAverage != null ? Math.round(seguro - monthAverage) : null;

  const cx = 120, cy = 120, r = 95;
  const inicio = 180, fin = 360;
  const relleno = inicio + (fin - inicio) * (seguro / 100);

  return (
    <div className={s.medidor}>
      <div className={s.medidorEtiqueta}>{etiqueta}</div>
      <div className={s.medidorArco}>
        <svg viewBox="0 0 240 140" aria-hidden>
          <path d={arco(cx, cy, r, inicio, fin)} fill="none" stroke="var(--m2-borde)" strokeWidth={14} strokeLinecap="round" />
          <path d={arco(cx, cy, r, inicio, relleno)} fill="none" stroke={tono.color} strokeWidth={14} strokeLinecap="round" />
        </svg>
        <div className={s.medidorCentro}>
          <div className={s.medidorValor}>{seguro}</div>
          <div className={s.medidorDe}>{t("analytics.efficiencyGauge.outOf", { max: 100 })}</div>
        </div>
      </div>
      <div className={s.medidorMensaje}>
        <tono.Icono size={16} strokeWidth={1.75} aria-hidden style={{ color: tono.color, flexShrink: 0 }} />
        <span>{mensajeMedidor(t, seguro, delta)}</span>
      </div>
    </div>
  );
}

export function MedidorCargando({ children }: { children: ReactNode }) {
  return <div className={s.medidorCargando}>{children}</div>;
}

function tonoMedidor(score: number) {
  // Mismos cortes que hoy (85 / 70 / 50); el verde-lima de 70–84 no existe en
  // el lenguaje aprobado y cae en el verde de éxito.
  if (score >= 85) return { color: "var(--success-strong)", Icono: Target };
  if (score >= 70) return { color: "var(--success)", Icono: ThumbsUp };
  if (score >= 50) return { color: "var(--warning-strong)", Icono: Zap };
  return { color: "var(--danger)", Icono: AlertTriangle };
}

function mensajeMedidor(
  t: (key: string, vars?: Record<string, unknown>) => string,
  score: number,
  delta: number | null,
): string {
  if (delta != null && delta >= 5) return t("analytics.efficiencyGauge.aboveAverage", { delta });
  if (delta != null && delta <= -5) return t("analytics.efficiencyGauge.belowAverage", { delta });
  if (score >= 85) return t("analytics.efficiencyGauge.msgExcellent");
  if (score >= 70) return t("analytics.efficiencyGauge.msgGood");
  if (score >= 50) return t("analytics.efficiencyGauge.msgImprove");
  return t("analytics.efficiencyGauge.msgUnderused");
}

function arco(cx: number, cy: number, r: number, desde: number, hasta: number): string {
  const a = polar(cx, cy, r, hasta);
  const b = polar(cx, cy, r, desde);
  const grande = hasta - desde <= 180 ? 0 : 1;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${grande} 0 ${b.x} ${b.y}`;
}

function polar(cx: number, cy: number, r: number, grados: number) {
  const rad = ((grados - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/* ═══ Embudo (recorrido del paciente) ═════════════════════════════════ */

export interface PasoEmbudo {
  id: string;
  label: string;
  count: number;
}

export function Embudo({
  funnel,
  dropOffs,
  totalAppts,
}: {
  funnel: PasoEmbudo[];
  dropOffs: { cancelled: number; noShow: number };
  totalAppts: number;
}) {
  const t = useT();
  const max = totalAppts || 1;
  return (
    <div className={s.embudo}>
      {funnel.map((paso, idx) => {
        const pct = Math.round((paso.count / max) * 100);
        const ancho = Math.max(10, (paso.count / max) * 100);
        const primero = idx === 0;
        const ultimo = idx === funnel.length - 1;
        const cancelados = primero && dropOffs.cancelled > 0 ? dropOffs.cancelled : 0;
        const faltas = primero && dropOffs.noShow > 0 ? dropOffs.noShow : 0;
        return (
          <div key={paso.id} className={s.embudoPaso}>
            <div className={s.embudoLinea}>
              <div className={s.embudoBarra} style={{ width: `${ancho}%`, flex: `0 1 ${ancho}%` }}>
                {paso.label}
              </div>
              <div className={s.embudoCuenta}>
                <div className={s.embudoNumero}>{paso.count.toLocaleString("es-MX")}</div>
                <div className={s.embudoPct}>{t("analytics.journeyClient.pctOfTotal", { pct })}</div>
              </div>
            </div>
            {!ultimo && (cancelados > 0 || faltas > 0) && (
              <div className={s.embudoCaidas}>
                {cancelados > 0 && (
                  <span className={unir(s.etiqueta, s.etiquetaNeutra)}>
                    ↳ {t("analytics.journeyClient.cancelled")}: {cancelados} ({Math.round((cancelados / max) * 100)}%)
                  </span>
                )}
                {faltas > 0 && (
                  <span className={unir(s.etiqueta, s.etiquetaPeligro)}>
                    ↳ {t("analytics.journeyClient.noShow")}: {faltas} ({Math.round((faltas / max) * 100)}%)
                  </span>
                )}
              </div>
            )}
            {!ultimo && (
              <div className={s.embudoFlecha}>
                <ArrowRight size={14} strokeWidth={1.75} aria-hidden style={{ transform: "rotate(90deg)" }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
