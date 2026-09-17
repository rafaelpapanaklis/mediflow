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
 * Además, cada cifra dice de dónde sale (una línea bajo el número), la
 * cabecera nombra las fechas exactas del periodo, los gastos se reparten por
 * categoría y «Por doctor» aclara que es lo FACTURADO, no lo cobrado. Todo eso
 * se pinta con lo que YA llega en las dos peticiones de siempre: ni una
 * consulta nueva, ni una cifra de las de antes calculada de otra forma.
 *
 * Las cifras, las fórmulas y los periodos son los mismos de siempre: salen
 * de `usar-finanzas.ts`, que copia la lógica de `finanzas-client.tsx`. La ropa
 * la ponen `finanzas.module.css` (tokens `--m2-*` del menú) y `grafica.tsx`.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import {
  AlertCircle, AlertTriangle, ArrowRight, Banknote, BarChart3, CalendarCheck,
  PiggyBank, Plus, Receipt, RefreshCw, Trash2, TrendingDown, TrendingUp, Users,
  Wallet, X, type LucideIcon,
} from "lucide-react";
import { fmtMXN, fmtMXNdec } from "@/lib/format";
import { CATEGORIAS, PERIODOS, useFinanzas, type Gasto, type PeriodKey } from "./usar-finanzas";
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
const fmtDayYear = (v: string) => asLocalDay(v).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });

// Las fechas exactas del periodo que se está viendo. Salen de la propia serie
// (un punto por día, el primero y el último son los bordes del periodo): no se
// vuelve a calcular ninguna ventana en el navegador.
function rangoDe(serie: { fecha: string }[]): string | null {
  if (serie.length === 0) return null;
  const desde = serie[0].fecha;
  const hasta = serie[serie.length - 1].fecha;
  if (desde.slice(0, 10) === hasta.slice(0, 10)) return fmtDayYear(desde);
  const mismoAnio = desde.slice(0, 4) === hasta.slice(0, 4);
  return `${mismoAnio ? fmtDayShort(desde) : fmtDayYear(desde)} – ${fmtDayYear(hasta)}`;
}

// Parte de un total, en porcentaje entero. Solo para leer proporciones.
const porcentaje = (parte: number, total: number) => (total > 0 ? Math.round((parte / total) * 100) : 0);

const GASTOS_VACIO: Record<PeriodKey, string> = {
  hoy:          "Hoy no has registrado gastos",
  mes:          "Aún no registras gastos este mes",
  mes_anterior: "No registraste gastos el mes anterior",
  custom:       "Sin gastos registrados en estas fechas",
};

// ── Piezas ─────────────────────────────────────────────────────────

type Tono = "normal" | "exito" | "peligro";
const ICONO_TONO: Record<Tono, string> = { normal: "", exito: s.kpiIconoExito, peligro: s.kpiIconoPeligro };
const VALOR_TONO: Record<Tono, string> = { normal: "", exito: s.kpiValorExito, peligro: s.kpiValorPeligro };

function Kpi({ etiqueta, valor, pista, icono: Icono, tono = "normal", tonoValor = "normal", hero }: {
  etiqueta: string;
  valor: string;
  /** De dónde sale la cifra, en una línea: el dueño no tiene que confiar. */
  pista?: ReactNode;
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
      {pista && <p className={s.kpiPista}>{pista}</p>}
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

  const rango = useMemo(() => rangoDe(f.serie), [f.serie]);
  // En qué se va el dinero: los MISMOS gastos de la tabla, sumados por
  // categoría. No es otra consulta ni otra cifra: la suma de estas filas es el
  // total que ya enseña la cabecera de la tarjeta.
  const porCategoria = useMemo(() => {
    const suma = new Map<string, number>();
    for (const g of gastos) suma.set(g.category, (suma.get(g.category) ?? 0) + (g.amount || 0));
    return Array.from(suma, ([categoria, total]) => ({ categoria, total })).sort((a, b) => b.total - a.total);
  }, [gastos]);
  const totalFacturado = useMemo(
    () => (data?.porDoctor ?? []).reduce((t, d) => t + (d.ingresos || 0), 0),
    [data],
  );
  const reembolsos = data?.reembolsos ?? 0;
  const vencido = data?.saldos?.vencido ?? 0;

  return (
    <>
      {/* Cabecera: título, periodo y la única acción de escritura */}
      <div className={s.cabecera}>
        <div>
          <h1 className={s.titulo}>Finanzas</h1>
          <p className={s.subtitulo}>
            El pulso financiero de tu clínica
            {rango && !f.error && <span className={s.rangoFechas}> · {rango}</span>}
          </p>
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
            <Kpi
              etiqueta="Ingresos"
              valor={fmtMXN(data.ingresos)}
              icono={TrendingUp}
              pista={reembolsos > 0
                ? `Lo cobrado, ya restados ${fmtMXN(reembolsos)} de reembolsos`
                : "Lo cobrado en el periodo, menos reembolsos"}
            />
            <Kpi
              etiqueta="Gastos"
              valor={fmtMXN(data.gastos)}
              icono={TrendingDown}
              tono="peligro"
              pista="Los gastos que registraste aquí"
            />
            <Kpi
              etiqueta="Utilidad"
              valor={fmtMXNSigned(data.utilidad)}
              icono={PiggyBank}
              tono={f.utilidadPos ? "exito" : "peligro"}
              tonoValor={f.utilidadPos ? "exito" : "peligro"}
              hero
              pista={data.ingresos > 0
                ? `Ingresos − gastos · te queda el ${porcentaje(data.utilidad, data.ingresos)} %`
                : "Ingresos − gastos"}
            />
            <Kpi
              etiqueta="Ventas"
              valor={(data.ventas ?? 0).toLocaleString("es-MX")}
              icono={Receipt}
              pista="Facturas creadas, sin las canceladas"
            />
            <Kpi
              etiqueta="Citas"
              valor={(data.citas ?? 0).toLocaleString("es-MX")}
              icono={CalendarCheck}
              pista="Agendadas, sin las canceladas"
            />
            <Kpi
              etiqueta="Efectivo recibido"
              valor={fmtMXN(data.efectivo)}
              icono={Banknote}
              tono="exito"
              pista="Cobros en efectivo, sin restar reembolsos"
            />
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
                  titulo={GASTOS_VACIO[f.period]}
                  pista="Agrégalos para ver tu utilidad real."
                />
              ) : (
                <>
                {porCategoria.length > 1 && (
                  <div className={s.categorias} aria-label="Gastos por categoría">
                    {porCategoria.map((c) => (
                      <div key={c.categoria} className={s.categoria}>
                        <span className={s.categoriaNombre}>{c.categoria}</span>
                        <div className={s.barra} aria-hidden>
                          <div
                            className={`${s.barraRelleno} ${s.barraRellenoGastos}`}
                            style={{ width: `${Math.max(2, porcentaje(c.total, porCategoria[0].total))}%` }}
                          />
                        </div>
                        <span className={s.num}>{fmtMXN(c.total)}</span>
                        <span className={s.categoriaParte}>{porcentaje(c.total, f.totalGastos)} %</span>
                      </div>
                    ))}
                  </div>
                )}
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
                </>
              )}
            </Tarjeta>

            <div className={s.apilado}>
              {/* Por doctor */}
              <Tarjeta
                icono={Users}
                titulo="Por doctor"
                sub="Lo facturado en el periodo, no lo cobrado: por eso no suma lo mismo que Ingresos."
              >
                {(data.porDoctor ?? []).length === 0 ? (
                  <Vacio icono={Users} titulo="Sin facturas con doctor asignado en este periodo" />
                ) : (
                  <div>
                    <div className={s.doctorCabecera}>
                      <span>Doctor</span>
                      <span>Facturado</span>
                    </div>
                    {data.porDoctor.map((d) => (
                      <div key={d.doctorId} className={s.doctorFila}>
                        <div className={s.doctorArriba}>
                          <span className={s.doctorNombre}>{d.doctor}</span>
                          <span className={s.num}>
                            {fmtMXN(d.ingresos)}
                            <span className={s.doctorParte}>{porcentaje(d.ingresos || 0, totalFacturado)} %</span>
                          </span>
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
                  <Link href="/dashboard/caja?tab=facturas" className={`${s.saldo} ${s.saldoEnlace}`}>
                    <div className={s.kpiArriba}>
                      <span className={s.kpiEtiqueta}>Por cobrar</span>
                      <span className={s.kpiIcono}>
                        <Wallet size={16} strokeWidth={1.75} aria-hidden />
                      </span>
                    </div>
                    <div className={s.kpiValor}>{fmtMXN(data.saldos?.porCobrar ?? 0)}</div>
                    <p className={s.kpiPista}>Saldo de todas las facturas abiertas</p>
                  </Link>
                  <Link href="/dashboard/caja?tab=facturas" className={`${s.saldo} ${s.saldoEnlace}`}>
                    <div className={s.kpiArriba}>
                      <span className={s.kpiEtiqueta}>Vencido</span>
                      <span className={`${s.kpiIcono} ${vencido > 0 ? s.kpiIconoPeligro : ""}`}>
                        <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
                      </span>
                    </div>
                    {/* En rojo solo si hay algo vencido: un $0 en rojo asusta sin motivo. */}
                    <div className={`${s.kpiValor} ${vencido > 0 ? s.kpiValorPeligro : ""}`}>{fmtMXN(vencido)}</div>
                    <p className={s.kpiPista}>De eso, lo que ya pasó su fecha de pago</p>
                  </Link>
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
