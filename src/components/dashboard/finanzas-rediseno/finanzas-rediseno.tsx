"use client";

/**
 * «Finanzas» con el diseño nuevo — donde el dueño mira si la clínica gana
 * dinero. Lo que hay en la pantalla de siempre está aquí, entero y en el mismo
 * orden: los seis indicadores, «Ingresos vs Gastos», los gastos del periodo,
 * los ingresos por doctor y los saldos. Lo que cambia es que ya no hay cuatro
 * pestañas: todo se ve de una vez, sin un clic de más, y «Registrar gasto»
 * está arriba, a un clic desde que carga la pantalla (hoy son dos: la pestaña
 * y luego el botón).
 *
 * Las cifras, las fórmulas y los periodos son los mismos de siempre: salen
 * de `usar-finanzas.ts`, que copia la lógica de `finanzas-client.tsx`. La ropa
 * la ponen `finanzas.module.css` (tokens `--m2-*` del menú) y `grafica.tsx`.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  AlertCircle, AlertTriangle, ArrowRight, Banknote, BarChart3, CalendarCheck,
  PiggyBank, Plus, Receipt, RefreshCw, Trash2, TrendingDown, TrendingUp, Users,
  Wallet, X, type LucideIcon,
} from "lucide-react";
import { fmtMXN, fmtMXNdec } from "@/lib/format";
import { CATEGORIAS, PERIODOS, useFinanzas, type Gasto } from "./usar-finanzas";
import s from "./finanzas.module.css";

// recharts pesa ~95 kB: fuera del bundle inicial, como en «Hoy».
const GraficaFinanzas = dynamic(
  () => import("./grafica").then((m) => m.GraficaFinanzas),
  { ssr: false, loading: () => <div className={`${s.esqueleto} ${s.esqueletoGrafica}`} aria-hidden /> },
);

// ── Helpers de formato (los mismos que la pantalla de siempre) ─────
// Utilidad puede ser negativa: "−$1,200" en vez de "$-1,200".
const fmtMXNSigned = (n: number) => (n < 0 ? "−" : "") + fmtMXN(Math.abs(n ?? 0));
const asLocalDay = (v: string) => new Date(v.slice(0, 10) + "T12:00:00");
const fmtDayShort = (v: string) => asLocalDay(v).toLocaleDateString("es-MX", { day: "numeric", month: "short" });

// ── Piezas ─────────────────────────────────────────────────────────

type Tono = "normal" | "exito" | "peligro";
const ICONO_TONO: Record<Tono, string> = { normal: "", exito: s.kpiIconoExito, peligro: s.kpiIconoPeligro };
const VALOR_TONO: Record<Tono, string> = { normal: "", exito: s.kpiValorExito, peligro: s.kpiValorPeligro };

function Kpi({ etiqueta, valor, icono: Icono, tono = "normal", tonoValor = "normal", hero }: {
  etiqueta: string;
  valor: string;
  icono: LucideIcon;
  tono?: Tono;
  tonoValor?: Tono;
  /** El indicador que manda (Utilidad): ícono lleno. */
  hero?: boolean;
}) {
  return (
    <div className={`${s.kpi} ${hero ? s.kpiHero : ""}`}>
      <div className={s.kpiArriba}>
        <span className={s.kpiEtiqueta}>{etiqueta}</span>
        <span className={`${s.kpiIcono} ${ICONO_TONO[tono]}`}>
          <Icono size={16} strokeWidth={1.75} aria-hidden />
        </span>
      </div>
      <div className={`${s.kpiValor} ${VALOR_TONO[tonoValor]}`}>{valor}</div>
    </div>
  );
}

function Tarjeta({ icono: Icono, titulo, sub, accion, tabla, children }: {
  icono: LucideIcon;
  titulo: string;
  sub?: string;
  accion?: ReactNode;
  /** El cuerpo es una tabla (sin aire lateral). */
  tabla?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={s.tarjeta}>
      <header className={s.tarjetaCabeza}>
        <span className={s.tarjetaIcono}>
          <Icono size={15} strokeWidth={1.75} aria-hidden />
        </span>
        <div className={s.tarjetaTextos}>
          <h2 className={s.tarjetaTitulo}>{titulo}</h2>
          {sub && <p className={s.tarjetaSub}>{sub}</p>}
        </div>
        {accion && <div className={s.tarjetaAccion}>{accion}</div>}
      </header>
      <div className={tabla ? s.tarjetaTabla : s.tarjetaCuerpo}>{children}</div>
    </section>
  );
}

function Vacio({ icono: Icono, titulo, pista, tono, acciones, alto, suelto }: {
  icono: LucideIcon;
  titulo: string;
  pista?: string;
  tono?: "peligro";
  acciones?: ReactNode;
  /** Ocupa el alto de la gráfica. */
  alto?: boolean;
  /** Va suelto en la página, no dentro de una tarjeta. */
  suelto?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`${s.vacio} ${alto ? s.vacioAlto : ""} ${suelto ? s.vacioSuelto : ""}`}
    >
      <span className={`${s.vacioIcono} ${tono === "peligro" ? s.vacioIconoPeligro : ""}`}>
        <Icono size={17} strokeWidth={1.75} aria-hidden />
      </span>
      <span className={s.vacioTitulo}>{titulo}</span>
      {pista && <span className={s.vacioPista}>{pista}</span>}
      {acciones && <div className={s.vacioAcciones}>{acciones}</div>}
    </div>
  );
}

// Silueta de la primera carga: seis indicadores, la gráfica y unas filas.
function Esqueletos() {
  return (
    <div className={s.esqueletos} aria-hidden>
      <div className={s.kpis}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={`${s.esqueleto} ${s.esqueletoKpi}`} />
        ))}
      </div>
      <div className={`${s.esqueleto} ${s.esqueletoGrafica}`} />
      <div className={`${s.esqueleto} ${s.esqueletoFila}`} />
      <div className={`${s.esqueleto} ${s.esqueletoFila}`} />
    </div>
  );
}

// ── Pantalla ───────────────────────────────────────────────────────

export function FinanzasRediseno() {
  const f = useFinanzas();
  const { data, gastos } = f;
  // Tras la primera carga, cambiar de periodo no vacía la pantalla: lo de
  // antes se queda atenuado con un aviso encima hasta que llega lo nuevo.
  const actualizando = f.loading && data !== null && !f.error;

  return (
    <>
      {/* Cabecera: título, periodo y la única acción de escritura */}
      <div className={s.cabecera}>
        <div>
          <h1 className={s.titulo}>Finanzas</h1>
          <p className={s.subtitulo}>El pulso financiero de tu clínica</p>
        </div>
        <div className={s.acciones}>
          <div role="tablist" aria-label="Periodo" className={s.segmentado}>
            {PERIODOS.map((p) => {
              const activo = f.period === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={activo}
                  className={`${s.segmento} ${activo ? s.segmentoActivo : ""}`}
                  onClick={() => f.selectPeriod(p.key)}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <button type="button" className={`${s.boton} ${s.botonPrincipal}`} onClick={f.openModal}>
            <Plus size={16} strokeWidth={1.75} aria-hidden />
            Registrar gasto
          </button>
        </div>
      </div>

      {/* Rango personalizado */}
      {f.period === "custom" && (
        <div className={s.rango}>
          <div className={`${s.campo} ${s.campoFecha}`}>
            <label className={s.campoEtiqueta} htmlFor="fin-from">De</label>
            <input
              id="fin-from"
              type="date"
              className={s.campoEntrada}
              value={f.customFrom}
              max={f.customTo || undefined}
              onChange={(e) => f.setCustomFrom(e.target.value)}
            />
          </div>
          <div className={`${s.campo} ${s.campoFecha}`}>
            <label className={s.campoEtiqueta} htmlFor="fin-to">Hasta</label>
            <input
              id="fin-to"
              type="date"
              className={s.campoEntrada}
              value={f.customTo}
              min={f.customFrom || undefined}
              onChange={(e) => f.setCustomTo(e.target.value)}
            />
          </div>
          <button
            type="button"
            className={`${s.boton} ${s.botonPrincipal}`}
            disabled={!f.customValid}
            onClick={f.applyCustom}
          >
            Aplicar
          </button>
        </div>
      )}

      {/* Error */}
      {f.error && !f.loading && (
        <Vacio
          icono={AlertCircle}
          tono="peligro"
          titulo="No pudimos cargar tus finanzas."
          suelto
          acciones={
            <button type="button" className={s.boton} onClick={f.reintentar}>
              <RefreshCw size={15} strokeWidth={1.75} aria-hidden />
              Reintentar
            </button>
          }
        />
      )}

      {/* Primera carga */}
      {f.loading && data === null && !f.error && <Esqueletos />}

      {/* Contenido */}
      {!f.error && data && (
        <div className={`${s.contenido} ${actualizando ? s.contenidoCargando : ""}`} aria-busy={actualizando}>
          {actualizando && (
            <div aria-hidden className={s.actualizando}>
              <span className={s.actualizandoTexto}>Actualizando…</span>
            </div>
          )}

          {/* Indicadores */}
          <div className={s.kpis}>
            <Kpi etiqueta="Ingresos" valor={fmtMXN(data.ingresos)} icono={TrendingUp} />
            <Kpi etiqueta="Gastos" valor={fmtMXN(data.gastos)} icono={TrendingDown} tono="peligro" />
            <Kpi
              etiqueta="Utilidad"
              valor={fmtMXNSigned(data.utilidad)}
              icono={PiggyBank}
              tono={f.utilidadPos ? "exito" : "peligro"}
              tonoValor={f.utilidadPos ? "exito" : "peligro"}
              hero
            />
            <Kpi etiqueta="Ventas" valor={(data.ventas ?? 0).toLocaleString("es-MX")} icono={Receipt} />
            <Kpi etiqueta="Citas" valor={(data.citas ?? 0).toLocaleString("es-MX")} icono={CalendarCheck} />
            <Kpi etiqueta="Efectivo recibido" valor={fmtMXN(data.efectivo)} icono={Banknote} tono="exito" />
          </div>

          {/* Ingresos vs Gastos */}
          <Tarjeta
            icono={BarChart3}
            titulo="Ingresos vs Gastos"
            accion={
              <div className={s.leyenda} aria-hidden>
                <span className={s.leyendaItem}>
                  <span className={s.leyendaPunto} /> Ingresos
                </span>
                <span className={s.leyendaItem}>
                  <span className={`${s.leyendaPunto} ${s.leyendaPuntoGastos}`} /> Gastos
                </span>
              </div>
            }
          >
            <div className={s.grafica}>
              {f.hasMovs ? (
                <GraficaFinanzas serie={f.serie} />
              ) : (
                <Vacio icono={BarChart3} titulo="Sin movimientos en este periodo" alto />
              )}
            </div>
          </Tarjeta>

          <div className={s.rejillaPrincipal}>
            {/* Gastos */}
            <Tarjeta
              icono={Wallet}
              titulo="Gastos"
              sub={gastos.length > 0
                ? `${gastos.length} ${gastos.length === 1 ? "gasto" : "gastos"} · ${fmtMXN(f.totalGastos)}`
                : undefined}
              tabla={gastos.length > 0}
            >
              {gastos.length === 0 ? (
                <Vacio
                  icono={Wallet}
                  titulo="Aún no registras gastos este mes"
                  pista="Agrégalos para ver tu utilidad real."
                />
              ) : (
                <div className={s.tablaCaja}>
                  <table className={s.tabla}>
                    <thead>
                      <tr>
                        <th scope="col">Fecha</th>
                        <th scope="col">Categoría</th>
                        <th scope="col">Nota</th>
                        <th scope="col" className={s.num}>Importe</th>
                        <th scope="col" className={s.celdaAccion}>
                          <span className="sr-only">Acciones</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {gastos.map((g: Gasto) => (
                        <tr key={g.id}>
                          <td className={s.celdaFecha}>{fmtDayShort(g.date)}</td>
                          <td><span className={s.chip}>{g.category}</span></td>
                          <td className={s.celdaNota}>{g.note || ""}</td>
                          <td className={`${s.num} ${s.numPeligro}`}>{fmtMXNdec(g.amount)}</td>
                          <td className={s.celdaAccion}>
                            <button
                              type="button"
                              className={`${s.botonIcono} ${s.botonIconoPeligro}`}
                              aria-label="Eliminar gasto"
                              title="Eliminar gasto"
                              disabled={f.deletingId === g.id}
                              onClick={() => f.deleteGasto(g.id)}
                            >
                              <Trash2 size={15} strokeWidth={1.75} aria-hidden />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Tarjeta>

            <div className={s.apilado}>
              {/* Por doctor */}
              <Tarjeta icono={Users} titulo="Por doctor">
                {(data.porDoctor ?? []).length === 0 ? (
                  <Vacio icono={Users} titulo="Sin facturas con doctor asignado en este periodo" />
                ) : (
                  <div>
                    <div className={s.doctorCabecera}>
                      <span>Doctor</span>
                      <span>Ingresos generados</span>
                    </div>
                    {data.porDoctor.map((d) => (
                      <div key={d.doctorId} className={s.doctorFila}>
                        <div className={s.doctorArriba}>
                          <span className={s.doctorNombre}>{d.doctor}</span>
                          <span className={s.num}>{fmtMXN(d.ingresos)}</span>
                        </div>
                        <div className={s.barra} aria-hidden>
                          <div
                            className={s.barraRelleno}
                            style={{
                              width: `${f.maxDoctor > 0 ? Math.max(2, Math.round(((d.ingresos || 0) / f.maxDoctor) * 100)) : 0}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Tarjeta>

              {/* Saldos */}
              <Tarjeta icono={Wallet} titulo="Saldos" sub="Saldos totales de la clínica — no dependen del periodo.">
                <div className={s.saldos}>
                  <div className={s.saldo}>
                    <div className={s.kpiArriba}>
                      <span className={s.kpiEtiqueta}>Por cobrar</span>
                      <span className={s.kpiIcono}>
                        <Wallet size={16} strokeWidth={1.75} aria-hidden />
                      </span>
                    </div>
                    <div className={s.kpiValor}>{fmtMXN(data.saldos?.porCobrar ?? 0)}</div>
                  </div>
                  <div className={s.saldo}>
                    <div className={s.kpiArriba}>
                      <span className={s.kpiEtiqueta}>Vencido</span>
                      <span className={`${s.kpiIcono} ${s.kpiIconoPeligro}`}>
                        <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
                      </span>
                    </div>
                    <div className={`${s.kpiValor} ${s.kpiValorPeligro}`}>{fmtMXN(data.saldos?.vencido ?? 0)}</div>
                  </div>
                </div>
                <Link href="/dashboard/caja?tab=facturas" className={s.enlaceInterno}>
                  Ver facturas en Caja <ArrowRight size={14} strokeWidth={2} aria-hidden />
                </Link>
              </Tarjeta>
            </div>
          </div>
        </div>
      )}

      {/* Diálogo: Registrar gasto */}
      {f.showModal && (
        <div className={s.velo} onClick={f.closeModal}>
          <div
            className={s.dialogo}
            role="dialog"
            aria-modal="true"
            aria-labelledby="gasto-titulo"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={s.dialogoCabeza}>
              <h2 id="gasto-titulo" className={s.dialogoTitulo}>Registrar gasto</h2>
              <button type="button" className={s.botonIcono} aria-label="Cerrar" onClick={f.closeModal}>
                <X size={16} strokeWidth={1.75} aria-hidden />
              </button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); f.saveGasto(); }}>
              <div className={s.dialogoCuerpo}>
                <div className={s.campo}>
                  <label className={s.campoEtiqueta} htmlFor="gasto-cat">
                    Categoría <span className={s.campoObligatorio}>*</span>
                  </label>
                  <select
                    id="gasto-cat"
                    className={s.campoEntrada}
                    value={f.mCategoria}
                    onChange={(e) => f.setMCategoria(e.target.value)}
                  >
                    {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className={s.campo}>
                  <label className={s.campoEtiqueta} htmlFor="gasto-monto">
                    Monto <span className={s.campoObligatorio}>*</span>
                  </label>
                  <input
                    id="gasto-monto"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    className={s.campoEntrada}
                    placeholder="0.00"
                    autoFocus
                    value={f.mMonto}
                    onChange={(e) => f.setMMonto(e.target.value)}
                  />
                </div>
                <div className={s.campo}>
                  <label className={s.campoEtiqueta} htmlFor="gasto-fecha">Fecha</label>
                  <input
                    id="gasto-fecha"
                    type="date"
                    className={s.campoEntrada}
                    value={f.mFecha}
                    onChange={(e) => f.setMFecha(e.target.value)}
                  />
                </div>
                <div className={s.campo}>
                  <label className={s.campoEtiqueta} htmlFor="gasto-nota">Nota (opcional)</label>
                  <input
                    id="gasto-nota"
                    className={s.campoEntrada}
                    placeholder="Ej. compra de guantes"
                    value={f.mNota}
                    onChange={(e) => f.setMNota(e.target.value)}
                  />
                </div>
              </div>
              <div className={s.dialogoPie}>
                <button type="button" className={`${s.boton} ${s.botonSuave}`} onClick={f.closeModal}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={`${s.boton} ${s.botonPrincipal}`}
                  disabled={!f.montoValid || f.saving}
                >
                  {f.saving ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
