"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, History, Loader2 } from "lucide-react";
import { isAbortError } from "@/lib/fetch-safe";
import { useT } from "@/i18n/i18n-provider";
import { CATEGORIAS_MOVIMIENTO } from "@/lib/movimientos-paciente/catalogo";
import type { PaginaDeMovimientos, MovimientoVista } from "@/lib/movimientos-paciente/consultar-tipos";
import { RaizRediseno } from "./raiz";
import s from "./rediseno.module.css";
import m from "./movimientos.module.css";

/**
 * Movimientos del paciente (ws1-t12).
 *
 *  · `MovimientosRecientes` — el bloque «Movimientos recientes» del Resumen:
 *    los últimos 12 y un botón «Ver completo».
 *  · `MovimientosCompleto` — la pestaña «Movimientos Completo» (Archivos):
 *    todo desde que se creó el paciente, paginado, con filtro por tipo y
 *    fechas y descarga en CSV / PDF.
 *
 * El texto de cada movimiento ya llega redactado —y enmascarado por permiso—
 * desde `GET /api/patients/[id]/movimientos`; aquí solo se pinta.
 */

const RECIENTES = 12;
const POR_PAGINA = 25;

const CLASE_PUNTO: Record<string, string> = {
  citas: m.puntoCitas,
  perfil: m.puntoPerfil,
  expediente: m.puntoExpediente,
  archivos: m.puntoArchivos,
  dinero: m.puntoDinero,
};

const formatoFecha = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function fechaLegible(iso: string): string {
  try {
    return formatoFecha.format(new Date(iso));
  } catch {
    return iso;
  }
}

interface Consulta {
  page: number;
  pageSize: number;
  categoria: string;
  desde: string;
  hasta: string;
}

function urlDe(patientId: string, q: Consulta, formato?: "csv" | "pdf"): string {
  const p = new URLSearchParams();
  p.set("page", String(q.page));
  p.set("pageSize", String(q.pageSize));
  if (q.categoria) p.set("categoria", q.categoria);
  if (q.desde) p.set("desde", q.desde);
  if (q.hasta) p.set("hasta", q.hasta);
  if (formato) p.set("formato", formato);
  return `/api/patients/${patientId}/movimientos?${p.toString()}`;
}

function useMovimientos(patientId: string, q: Consulta) {
  const [datos, setDatos] = useState<PaginaDeMovimientos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setCargando(true);
    setError(null);
    fetch(urlDe(patientId, q), { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) {
          const cuerpo = await r.json().catch(() => ({}));
          throw new Error(cuerpo.error ?? "movimientos_failed");
        }
        return r.json() as Promise<PaginaDeMovimientos>;
      })
      .then((d) => {
        setDatos(d);
        setCargando(false);
      })
      .catch((e) => {
        if (isAbortError(e)) return;
        setError(String(e.message ?? e));
        setCargando(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, q.page, q.pageSize, q.categoria, q.desde, q.hasta]);

  return { datos, cargando, error };
}

function Fila({ mov, mostrarTipo }: { mov: MovimientoVista; mostrarTipo: boolean }) {
  const t = useT();
  return (
    <li className={m.fila}>
      <span className={`${m.punto} ${CLASE_PUNTO[mov.categoria] ?? ""}`} aria-hidden />
      <span className={m.cuerpo}>
        <span className={`${m.texto} ${mov.oculto ? m.textoOculto : ""}`}>{mov.texto}</span>
        <span className={m.sub}>
          {mov.actor} · {fechaLegible(mov.fecha)}
        </span>
      </span>
      {mostrarTipo && (
        <span className={`${s.etiqueta} ${s.etiquetaNeutra} ${m.tipo}`}>
          {t(`pacientesRediseno.movimientos.categorias.${mov.categoria}`)}
        </span>
      )}
    </li>
  );
}

function ListaDeMovimientos({ items, mostrarTipo }: { items: MovimientoVista[]; mostrarTipo: boolean }) {
  return (
    <ol className={m.lista} style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {items.map((mov) => (
        <Fila key={mov.id} mov={mov} mostrarTipo={mostrarTipo} />
      ))}
    </ol>
  );
}

function EstadoCarga({ cargando, error }: { cargando: boolean; error: string | null }) {
  const t = useT();
  if (cargando) {
    return (
      <div className={m.cargando} role="status">
        <Loader2 size={14} className={m.girar} aria-hidden /> {t("pacientesRediseno.movimientos.cargando")}
      </div>
    );
  }
  if (error) {
    return <div className={m.error}>{t("pacientesRediseno.movimientos.errorCargar")}</div>;
  }
  return null;
}

function Vacio({ filtrado }: { filtrado: boolean }) {
  const t = useT();
  return (
    <div className={s.vacio}>
      <span className={s.vacioIcono}>
        <History size={18} strokeWidth={1.75} aria-hidden />
      </span>
      <span className={s.vacioTitulo}>
        {t(filtrado ? "pacientesRediseno.movimientos.vacioFiltro" : "pacientesRediseno.movimientos.vacio")}
      </span>
      {!filtrado && <span className={s.vacioPista}>{t("pacientesRediseno.movimientos.vacioPista")}</span>}
    </div>
  );
}

const SIN_FILTROS: { categoria: string; desde: string; hasta: string } = { categoria: "", desde: "", hasta: "" };

/** La vista del bloque «Movimientos recientes» (pura: recibe los datos ya cargados). */
export function VistaMovimientosRecientes({
  datos,
  cargando,
  error,
  onVerCompleto,
}: {
  datos: PaginaDeMovimientos | null;
  cargando: boolean;
  error: string | null;
  onVerCompleto: () => void;
}) {
  const t = useT();
  return (
    <div>
      <EstadoCarga cargando={cargando} error={error} />
      {!cargando && !error && datos && datos.items.length === 0 && <Vacio filtrado={false} />}
      {!cargando && !error && datos && datos.items.length > 0 && (
        <>
          <ListaDeMovimientos items={datos.items} mostrarTipo />
          <div className={m.pie}>
            <button type="button" className={s.boton} onClick={onVerCompleto}>
              {t("pacientesRediseno.movimientos.verCompleto")}
              {datos.total > datos.items.length ? ` (${datos.total})` : ""}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function MovimientosRecientes({
  patientId,
  onVerCompleto,
}: {
  patientId: string;
  onVerCompleto: () => void;
}) {
  const consulta = useMemo<Consulta>(() => ({ page: 1, pageSize: RECIENTES, ...SIN_FILTROS }), []);
  const { datos, cargando, error } = useMovimientos(patientId, consulta);
  return <VistaMovimientosRecientes datos={datos} cargando={cargando} error={error} onVerCompleto={onVerCompleto} />;
}

export interface FiltrosMovimientos {
  categoria: string;
  desde: string;
  hasta: string;
}

/** La pantalla «Movimientos Completo» (pura: recibe datos, filtros y acciones). */
export function VistaMovimientosCompleto({
  datos,
  cargando,
  error,
  filtros,
  onCambiarFiltros,
  onPagina,
  urlCsv,
  urlPdf,
}: {
  datos: PaginaDeMovimientos | null;
  cargando: boolean;
  error: string | null;
  filtros: FiltrosMovimientos;
  onCambiarFiltros: (parcial: Partial<FiltrosMovimientos>) => void;
  onPagina: (pagina: number) => void;
  urlCsv: string;
  urlPdf: string;
}) {
  const t = useT();
  const hayFiltro = !!(filtros.categoria || filtros.desde || filtros.hasta);
  return (
    <RaizRediseno>
      <div className={s.columna}>
        <header className={s.pantallaCabeza}>
          <div>
            <h1 className={s.pantallaTitulo}>{t("pacientesRediseno.movimientos.titulo")}</h1>
            <p className={s.pantallaSub}>{t("pacientesRediseno.movimientos.subtitulo")}</p>
          </div>
        </header>

        <section className={s.tarjeta}>
          <div className={m.filtros}>
            <label className={`${m.campo} ${m.campoTipo}`}>
              {t("pacientesRediseno.movimientos.tipo")}
              <select
                className={m.control}
                value={filtros.categoria}
                onChange={(e) => onCambiarFiltros({ categoria: e.target.value })}
              >
                <option value="">{t("pacientesRediseno.movimientos.todos")}</option>
                {CATEGORIAS_MOVIMIENTO.map((c) => (
                  <option key={c} value={c}>
                    {t(`pacientesRediseno.movimientos.categorias.${c}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className={m.campo}>
              {t("pacientesRediseno.movimientos.desde")}
              <input
                type="date"
                className={m.control}
                value={filtros.desde}
                max={filtros.hasta || undefined}
                onChange={(e) => onCambiarFiltros({ desde: e.target.value })}
              />
            </label>
            <label className={m.campo}>
              {t("pacientesRediseno.movimientos.hasta")}
              <input
                type="date"
                className={m.control}
                value={filtros.hasta}
                min={filtros.desde || undefined}
                onChange={(e) => onCambiarFiltros({ hasta: e.target.value })}
              />
            </label>
            {hayFiltro && (
              <button type="button" className={s.boton} onClick={() => onCambiarFiltros(SIN_FILTROS)}>
                {t("pacientesRediseno.movimientos.limpiar")}
              </button>
            )}
            <div className={m.descargas}>
              <a className={s.boton} href={urlCsv} download>
                <FileSpreadsheet size={14} strokeWidth={1.75} aria-hidden />
                {t("pacientesRediseno.movimientos.csv")}
              </a>
              <a className={s.boton} href={urlPdf} download>
                <FileDown size={14} strokeWidth={1.75} aria-hidden />
                {t("pacientesRediseno.movimientos.pdf")}
              </a>
            </div>
          </div>

          {datos?.degradado && <div className={m.aviso}>{t("pacientesRediseno.movimientos.degradado")}</div>}
          <EstadoCarga cargando={cargando} error={error} />
          {!cargando && !error && datos && datos.items.length === 0 && <Vacio filtrado={hayFiltro} />}
          {!cargando && !error && datos && datos.items.length > 0 && (
            <>
              <ListaDeMovimientos items={datos.items} mostrarTipo />
              <nav className={m.paginacion} aria-label={t("pacientesRediseno.movimientos.paginacion")}>
                <span className={m.numeros}>{t("pacientesRediseno.movimientos.total", { total: datos.total })}</span>
                <span className={m.paginacionBotones}>
                  <button
                    type="button"
                    className={s.boton}
                    disabled={datos.page <= 1}
                    onClick={() => onPagina(Math.max(1, datos.page - 1))}
                    aria-label={t("pacientesRediseno.movimientos.anterior")}
                  >
                    <ChevronLeft size={16} aria-hidden />
                  </button>
                  <span className={m.numeros}>
                    {t("pacientesRediseno.movimientos.pagina", { pagina: datos.page, paginas: datos.paginas })}
                  </span>
                  <button
                    type="button"
                    className={s.boton}
                    disabled={datos.page >= datos.paginas}
                    onClick={() => onPagina(datos.page + 1)}
                    aria-label={t("pacientesRediseno.movimientos.siguiente")}
                  >
                    <ChevronRight size={16} aria-hidden />
                  </button>
                </span>
              </nav>
            </>
          )}
        </section>
      </div>
    </RaizRediseno>
  );
}

export function MovimientosCompleto({ patientId }: { patientId: string }) {
  const [page, setPage] = useState(1);
  const [filtros, setFiltros] = useState<FiltrosMovimientos>(SIN_FILTROS);
  const consulta = useMemo<Consulta>(() => ({ page, pageSize: POR_PAGINA, ...filtros }), [page, filtros]);
  const { datos, cargando, error } = useMovimientos(patientId, consulta);

  return (
    <VistaMovimientosCompleto
      datos={datos}
      cargando={cargando}
      error={error}
      filtros={filtros}
      onCambiarFiltros={(parcial) => {
        setFiltros((f) => ({ ...f, ...parcial }));
        setPage(1);
      }}
      onPagina={setPage}
      urlCsv={urlDe(patientId, consulta, "csv")}
      urlPdf={urlDe(patientId, consulta, "pdf")}
    />
  );
}
