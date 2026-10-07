"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, RefreshCw, AlertTriangle, Building2 } from "lucide-react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import {
  PERIODOS,
  participacionPct,
  type FilaSedeReporte,
  type Periodo,
  type ReporteConsolidado,
} from "@/lib/sedes/reporte-consolidado-core";
import s from "./reporte-sedes.module.css";

/**
 * Reporte consolidado de sedes (ws1-t10, auditoría BEVADENT · M6). Habla el
 * idioma visual del menú de dos niveles (`CLASES_MENU` → tokens `--m2-*`),
 * igual que Finanzas, Hoy y la Agenda. Textos es/en aquí mismo: los
 * diccionarios los editan otras pantallas a la vez y esta es una pantalla
 * nueva, cerrada en sí misma.
 */
const TEXTOS = {
  es: {
    volver: "Sucursales",
    titulo: "Reporte de sedes",
    subtitulo: "Todas tus sucursales, con las mismas cifras que Finanzas y Reportes.",
    periodos: { "este-mes": "Este mes", "mes-pasado": "Mes pasado", "30-dias": "30 días", "este-anio": "Este año", personalizado: "Personalizado" } as Record<Periodo, string>,
    desde: "Desde",
    hasta: "Hasta",
    aplicar: "Aplicar",
    exportar: "Exportar CSV",
    actualizando: "Actualizando…",
    kpis: {
      ingresos: "Ingresos netos",
      citas: "Citas agendadas",
      pacientes: "Pacientes nuevos",
      noShow: "No-shows",
      ocupacion: "Ocupación",
      ticket: "Ticket promedio",
    },
    pistas: {
      ingresos: "Cobros menos reembolsos, todas las sedes",
      citas: "{atendidas} atendidas",
      noShow: "{tasa} de las agendadas",
      ocupacion: "Minutos agendados ÷ horario por profesional",
      ticket: "{cobros} cobros",
      pacientes: "Fichas nuevas en el periodo",
    },
    comparativa: "Comparativa por sede",
    columnas: { sede: "Sede", ingresos: "Ingresos netos", parte: "Parte", citas: "Citas", atendidas: "Atendidas", noShows: "No-shows", nuevos: "Nuevos", ocupacion: "Ocupación", ticket: "Ticket" },
    activa: "Activa",
    suspendida: "Suspendida",
    fallo: "No se pudo leer esta sede: sus cifras no entran en los totales.",
    total: "Total",
    unaSede: "Solo tienes una sede. Cuando abras otra, aquí verás la comparativa.",
    sinSedes: "No hay sedes que mostrar.",
    error: "No se pudo cargar el reporte. Inténtalo de nuevo.",
    sinSillones: "Sin horario en Ajustes o sin profesionales que reciban citas: la ocupación no se calcula.",
    generado: "Generado {fecha}",
  },
  en: {
    volver: "Locations",
    titulo: "Locations report",
    subtitulo: "All your locations, with the same figures as Finance and Reports.",
    periodos: { "este-mes": "This month", "mes-pasado": "Last month", "30-dias": "30 days", "este-anio": "This year", personalizado: "Custom" } as Record<Periodo, string>,
    desde: "From",
    hasta: "To",
    aplicar: "Apply",
    exportar: "Export CSV",
    actualizando: "Updating…",
    kpis: { ingresos: "Net revenue", citas: "Booked appointments", pacientes: "New patients", noShow: "No-shows", ocupacion: "Occupancy", ticket: "Average ticket" },
    pistas: {
      ingresos: "Payments minus refunds, all locations",
      citas: "{atendidas} attended",
      noShow: "{tasa} of booked",
      ocupacion: "Booked minutes ÷ hours per professional",
      ticket: "{cobros} payments",
      pacientes: "New records in the period",
    },
    comparativa: "By location",
    columnas: { sede: "Location", ingresos: "Net revenue", parte: "Share", citas: "Appts", atendidas: "Attended", noShows: "No-shows", nuevos: "New", ocupacion: "Occupancy", ticket: "Ticket" },
    activa: "Current",
    suspendida: "Suspended",
    fallo: "Could not read this location: its figures are not in the totals.",
    total: "Total",
    unaSede: "You only have one location. Once you open another, the comparison shows here.",
    sinSedes: "No locations to show.",
    error: "Could not load the report. Please try again.",
    sinSillones: "No hours in Settings or nobody takes appointments: occupancy is not computed.",
    generado: "Generated {fecha}",
  },
} as const;

type Textos = (typeof TEXTOS)["es"];

interface Props {
  inicial: ReporteConsolidado;
  hoyISO: string;
  locale: string;
}

export function ReporteSedesClient({ inicial, hoyISO, locale }: Props) {
  const tx: Textos = locale.startsWith("en") ? (TEXTOS.en as unknown as Textos) : TEXTOS.es;
  const lang = locale.startsWith("en") ? "en-US" : "es-MX";
  const [reporte, setReporte] = useState<ReporteConsolidado>(inicial);
  const [periodo, setPeriodo] = useState<Periodo>(inicial.periodo);
  const [desde, setDesde] = useState(inicial.desdeISO);
  const [hasta, setHasta] = useState(inicial.hastaISO);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const peticion = useRef(0);
  // La hora de «Generado» se pinta en el navegador (zona y formato del
  // visitante): calcularla en el servidor daba un texto distinto al hidratar.
  const [generadoTexto, setGeneradoTexto] = useState("");
  useEffect(() => {
    setGeneradoTexto(new Date(reporte.generadoEn).toLocaleString(lang));
  }, [reporte.generadoEn, lang]);

  const pesos = useMemo(() => new Intl.NumberFormat(lang, { style: "currency", currency: "MXN", maximumFractionDigits: 0 }), [lang]);
  const entero = useMemo(() => new Intl.NumberFormat(lang), [lang]);
  const fecha = useMemo(() => new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }), [lang]);
  const pct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString(lang, { maximumFractionDigits: 1 })} %`);
  const dia = (isoDia: string) => fecha.format(new Date(`${isoDia}T00:00:00Z`));

  const cargar = useCallback(async (p: Periodo, d: string, h: string) => {
    const n = ++peticion.current;
    setCargando(true);
    setError(null);
    try {
      const q = new URLSearchParams({ periodo: p });
      if (p === "personalizado") { q.set("desde", d); q.set("hasta", h); }
      const res = await fetch(`/api/sedes/reporte?${q.toString()}`, { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const datos = (await res.json()) as ReporteConsolidado;
      if (n !== peticion.current) return;
      setReporte(datos);
      setDesde(datos.desdeISO);
      setHasta(datos.hastaISO);
    } catch {
      if (n === peticion.current) setError(tx.error);
    } finally {
      if (n === peticion.current) setCargando(false);
    }
  }, [tx.error]);

  // Los periodos fijos se cargan al elegirlos; el personalizado espera a «Aplicar».
  useEffect(() => {
    if (periodo === inicial.periodo && reporte === inicial) return;
    if (periodo !== "personalizado") void cargar(periodo, desde, hasta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo]);

  const t = reporte.totales;
  const sedes = reporte.sedes;
  const csvHref = `/api/sedes/reporte?${new URLSearchParams(
    periodo === "personalizado" ? { periodo, desde, hasta, formato: "csv" } : { periodo, formato: "csv" },
  ).toString()}`;
  const fallidas = sedes.filter((x) => x.fallo);

  return (
    <div className={`${CLASES_MENU} ${s.raiz}`} data-testid="reporte-sedes">
      <Link href="/dashboard/settings/sucursales" className={s.volver}>
        <ArrowLeft size={14} aria-hidden /> {tx.volver}
      </Link>

      <header className={s.cabecera}>
        <div>
          <h1 className={s.titulo}>{tx.titulo}</h1>
          <p className={s.subtitulo}>
            {tx.subtitulo} <span className={s.rangoFechas}>{dia(reporte.desdeISO)} – {dia(reporte.hastaISO)}</span>
          </p>
        </div>
        <div className={s.acciones}>
          <div className={s.segmentado} role="tablist" aria-label="Periodo">
            {PERIODOS.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={periodo === p}
                className={`${s.segmento} ${periodo === p ? s.segmentoActivo : ""}`}
                onClick={() => setPeriodo(p)}
              >
                {tx.periodos[p]}
              </button>
            ))}
          </div>
          <a className={s.boton} href={csvHref} download>
            <Download size={14} aria-hidden /> {tx.exportar}
          </a>
        </div>
      </header>

      {periodo === "personalizado" && (
        <form
          className={s.rango}
          onSubmit={(e) => { e.preventDefault(); void cargar("personalizado", desde, hasta); }}
        >
          <label className={s.campo}>
            <span className={s.campoEtiqueta}>{tx.desde}</span>
            <input className={s.campoEntrada} type="date" value={desde} max={hoyISO} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label className={s.campo}>
            <span className={s.campoEtiqueta}>{tx.hasta}</span>
            <input className={s.campoEntrada} type="date" value={hasta} max={hoyISO} min={desde} onChange={(e) => setHasta(e.target.value)} />
          </label>
          <button type="submit" className={`${s.boton} ${s.botonPrincipal}`} disabled={cargando}>{tx.aplicar}</button>
        </form>
      )}

      {error && (
        <p className={s.aviso} role="alert">
          <AlertTriangle size={14} aria-hidden /> {error}
          <button type="button" className={s.enlace} onClick={() => void cargar(periodo, desde, hasta)}><RefreshCw size={12} aria-hidden /> ↻</button>
        </p>
      )}

      <section className={s.kpis} aria-busy={cargando}>
        <Kpi etiqueta={tx.kpis.ingresos} valor={pesos.format(t.ingresosNeto)} pista={tx.pistas.ingresos} hero />
        <Kpi etiqueta={tx.kpis.citas} valor={entero.format(t.citasAgendadas)} pista={tx.pistas.citas.replace("{atendidas}", entero.format(t.citasAtendidas))} />
        <Kpi etiqueta={tx.kpis.pacientes} valor={entero.format(t.pacientesNuevos)} pista={tx.pistas.pacientes} />
        <Kpi etiqueta={tx.kpis.noShow} valor={entero.format(t.noShows)} pista={tx.pistas.noShow.replace("{tasa}", pct(t.tasaNoShowPct))} peligro={t.noShows > 0} />
        <Kpi etiqueta={tx.kpis.ocupacion} valor={pct(t.ocupacionPct)} pista={tx.pistas.ocupacion} />
        <Kpi etiqueta={tx.kpis.ticket} valor={t.ticketPromedio === null ? "—" : pesos.format(t.ticketPromedio)} pista={tx.pistas.ticket.replace("{cobros}", entero.format(t.numeroDeCobros))} />
      </section>

      <section className={s.tarjeta} aria-busy={cargando}>
        <div className={s.tarjetaCabeza}>
          <h2 className={s.tarjetaTitulo}><Building2 size={15} aria-hidden /> {tx.comparativa}</h2>
          {cargando && <span className={s.actualizando}>{tx.actualizando}</span>}
        </div>

        {sedes.length === 0 ? (
          <p className={s.vacio}>{tx.sinSedes}</p>
        ) : (
          <>
            {sedes.length === 1 && <p className={s.notaPie}>{tx.unaSede}</p>}
            <div className={s.tablaEnvoltura}>
              <table className={s.tabla}>
                <thead>
                  <tr>
                    <th scope="col" className={s.celdaSede}>{tx.columnas.sede}</th>
                    <th scope="col" className={s.num}>{tx.columnas.ingresos}</th>
                    <th scope="col" className={s.celdaParte}>{tx.columnas.parte}</th>
                    <th scope="col" className={s.num}>{tx.columnas.citas}</th>
                    <th scope="col" className={s.num}>{tx.columnas.atendidas}</th>
                    <th scope="col" className={s.num}>{tx.columnas.noShows}</th>
                    <th scope="col" className={s.num}>{tx.columnas.nuevos}</th>
                    <th scope="col" className={s.num}>{tx.columnas.ocupacion}</th>
                    <th scope="col" className={s.num}>{tx.columnas.ticket}</th>
                  </tr>
                </thead>
                <tbody>
                  {sedes.map((sede) => (
                    <FilaSede key={sede.clinicId} sede={sede} parte={participacionPct(sede, t)} tx={tx} pesos={pesos} entero={entero} pct={pct} />
                  ))}
                </tbody>
                {sedes.length > 1 && (
                  <tfoot>
                    <tr className={s.filaTotal}>
                      <th scope="row" className={s.celdaSede}>{tx.total}</th>
                      <td className={s.num}>{pesos.format(t.ingresosNeto)}</td>
                      <td className={s.celdaParte}>{t.ingresosNeto > 0 ? "100 %" : "—"}</td>
                      <td className={s.num}>{entero.format(t.citasAgendadas)}</td>
                      <td className={s.num}>{entero.format(t.citasAtendidas)}</td>
                      <td className={`${s.num} ${t.noShows > 0 ? s.numPeligro : ""}`}>{entero.format(t.noShows)} <small>({pct(t.tasaNoShowPct)})</small></td>
                      <td className={s.num}>{entero.format(t.pacientesNuevos)}</td>
                      <td className={s.num}>{pct(t.ocupacionPct)}</td>
                      <td className={s.num}>{t.ticketPromedio === null ? "—" : pesos.format(t.ticketPromedio)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {fallidas.length > 0 && (
              <p className={s.aviso} role="status">
                <AlertTriangle size={14} aria-hidden /> {fallidas.map((f) => f.nombre).join(", ")}: {tx.fallo}
              </p>
            )}
            {sedes.some((x) => !x.fallo && x.ocupacion.pct === null) && (
              <p className={s.notaPie}>{sedes.filter((x) => !x.fallo && x.ocupacion.pct === null).map((x) => x.nombre).join(", ")}: {tx.sinSillones}</p>
            )}
          </>
        )}
        {generadoTexto && <p className={s.notaPie}>{tx.generado.replace("{fecha}", generadoTexto)}</p>}
      </section>
    </div>
  );
}

function Kpi({ etiqueta, valor, pista, hero, peligro }: { etiqueta: string; valor: string; pista?: string; hero?: boolean; peligro?: boolean }) {
  return (
    <article className={`${s.kpi} ${hero ? s.kpiHero : ""}`}>
      <span className={s.kpiEtiqueta}>{etiqueta}</span>
      <span className={`${s.kpiValor} ${peligro ? s.kpiValorPeligro : ""}`}>{valor}</span>
      {pista && <span className={s.kpiPista}>{pista}</span>}
    </article>
  );
}

function FilaSede({
  sede, parte, tx, pesos, entero, pct,
}: {
  sede: FilaSedeReporte;
  parte: number | null;
  tx: Textos;
  pesos: Intl.NumberFormat;
  entero: Intl.NumberFormat;
  pct: (v: number | null) => string;
}) {
  if (sede.fallo) {
    return (
      <tr className={s.filaFallida}>
        <th scope="row" className={s.celdaSede}>
          <span className={s.nombreSede}>{sede.nombre}</span>
          {sede.esActiva && <span className={s.chip}>{tx.activa}</span>}
        </th>
        <td className={s.num} colSpan={8}>—</td>
      </tr>
    );
  }
  return (
    <tr>
      <th scope="row" className={s.celdaSede}>
        <span className={s.nombreSede}>{sede.nombre}</span>
        {sede.esActiva && <span className={s.chip}>{tx.activa}</span>}
        {sede.suspendida && <span className={`${s.chip} ${s.chipPeligro}`}>{tx.suspendida}</span>}
      </th>
      <td className={s.num}>{pesos.format(sede.ingresos.neto)}</td>
      <td className={s.celdaParte}>
        <span className={s.barra} aria-hidden>
          <span className={s.barraRelleno} style={{ width: `${Math.max(0, Math.min(100, parte ?? 0))}%` }} />
        </span>
        <span className={s.parteTexto}>{parte === null ? "—" : `${parte.toLocaleString(undefined, { maximumFractionDigits: 1 })} %`}</span>
      </td>
      <td className={s.num}>{entero.format(sede.citas.agendadas)}</td>
      <td className={s.num}>{entero.format(sede.citas.atendidas)}</td>
      <td className={`${s.num} ${sede.citas.noShows > 0 ? s.numPeligro : ""}`}>
        {entero.format(sede.citas.noShows)} <small>({pct(sede.citas.tasaNoShowPct)})</small>
      </td>
      <td className={s.num}>{entero.format(sede.pacientesNuevos)}</td>
      <td className={s.num}>{pct(sede.ocupacion.pct)}</td>
      <td className={s.num}>{sede.ticketPromedio === null ? "—" : pesos.format(sede.ticketPromedio)}</td>
    </tr>
  );
}
