"use client";

// ═══════════════════════════════════════════════════════════════════════
// LA BARRA DE TRABAJO: buscar, filtrar, ordenar y cambiar de vista.
//
// ── POR QUÉ YA NO SE PLIEGA ────────────────────────────────────────────
// Antes los cuatro selectores vivían detrás de un botón "Filtros (2)". La
// intención era buena —ocho controles encima de lo que se viene a leer son
// un muro— pero el efecto fue el contrario: un filtro que hay que abrir
// para descubrir es un filtro que no se usa, y uno puesto que no se ve es
// la forma más rápida de creer que se perdieron prospectos. Ahora se ven
// todos, y lo que baja el ruido es otra cosa: son controles de 34 px en
// una sola fila que envuelve, con el número de resultados SIEMPRE debajo.
//
// ── TODO VIVE EN LA URL ────────────────────────────────────────────────
// Ningún filtro se guarda en useState. Lo que se elige se escribe en la
// querystring y la página se vuelve a pedir al servidor ya filtrada. Eso
// da gratis las cuatro cosas que a una libreta de ventas le hacen falta:
// la vista se guarda en marcadores, se manda por WhatsApp, sobrevive a
// recargar y el botón de atrás deshace el último filtro en vez de salirse
// de la pantalla.
//
// La ÚNICA excepción es la caja de buscar, y está explicada en su sitio:
// lo que se teclea se pinta al instante desde estado local, y sólo viaja
// a la URL 350 ms después de la última tecla.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { LayoutGrid, List, Search, X } from "lucide-react";
import { useDebouncedValue } from "@/hooks/use-command-palette";
import {
  crmFiltrosActivos,
  crmFiltrosCon,
  crmFiltrosLimpios,
  crmHayFiltros,
  crmNumerosDePagina,
  crmRangoTexto,
  CRM_ESTADOS,
  CRM_ETAPAS,
  CRM_FUENTES,
  CRM_ORDENES,
  CRM_ORIGEN_AFILIADOS,
  CRM_ORIGEN_DALECONTROL,
  CRM_VERTICALES,
  type CrmFiltros,
  type CrmOrden,
  type CrmVista,
} from "@/lib/admin/crm/crm-core";
import type { CrmSocioListado } from "@/lib/admin/crm/service";

/** Milisegundos desde la última tecla hasta que la búsqueda viaja a la URL. */
const ESPERA_TECLEO = 350;

const ANCHO_SELECT = 172;

export function CrmBarraFiltros({
  filtros,
  vista,
  socios,
  total,
  totalGeneral,
  cargando,
  alCambiar,
}: {
  filtros: CrmFiltros;
  /** La vista que se está pintando de verdad (puede venir del tamaño). */
  vista: CrmVista;
  socios: CrmSocioListado[];
  total: number;
  totalGeneral: number;
  /** Hay una navegación en curso: se avisa sin bloquear el tecleo. */
  cargando: boolean;
  alCambiar: (siguiente: CrmFiltros, opciones?: { reemplazar?: boolean }) => void;
}) {
  // ── La caja de buscar ────────────────────────────────────────────────
  // Lo tecleado se guarda AQUÍ y se pinta al instante; a la URL sólo va
  // cuando pasan 350 ms sin teclear. Si cada tecla navegara, cada letra
  // sería un viaje al servidor y el cursor daría tumbos.
  const [texto, setTexto] = useState(filtros.q);
  const tecleado = useDebouncedValue(texto, ESPERA_TECLEO);
  const caja = useRef<HTMLInputElement>(null);
  const ultimoEnviado = useRef(filtros.q);

  useEffect(() => {
    if (tecleado === ultimoEnviado.current) return;
    ultimoEnviado.current = tecleado;
    // `reemplazar`: teclear no debe dejar una entrada en el historial por
    // letra, o el botón de atrás tardaría veinte clics en salir.
    alCambiar(crmFiltrosCon(filtros, { q: tecleado }), { reemplazar: true });
    // Sólo depende de lo tecleado: meter `filtros` aquí volvería a
    // navegar en cuanto el servidor conteste, en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tecleado]);

  /**
   * El camino de vuelta: la URL cambió por algo que NO fue teclear (el
   * botón de atrás, "Quitar todos", la ficha de «Buscando»). Se copia a
   * la caja sólo si NADIE está escribiendo en ella — si se copiara
   * siempre, una respuesta del servidor que va una letra por detrás
   * borraría la letra recién tecleada.
   */
  useEffect(() => {
    if (caja.current && caja.current === document.activeElement) return;
    ultimoEnviado.current = filtros.q;
    setTexto(filtros.q);
  }, [filtros.q]);

  function limpiarBusqueda() {
    setTexto("");
    ultimoEnviado.current = "";
    alCambiar(crmFiltrosCon(filtros, { q: "" }), { reemplazar: true });
    caja.current?.focus();
  }

  function poner(cambios: Partial<CrmFiltros>) {
    alCambiar(crmFiltrosCon(filtros, cambios));
  }

  const activos = crmFiltrosActivos(
    filtros,
    socios.map((s) => ({ id: s.id, nombre: s.nombre })),
  );
  const hayFiltros = crmHayFiltros(filtros);

  return (
    <div style={{ marginBottom: 12 }}>
      {/* ── Fila de controles ─────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 240px", minWidth: 180, maxWidth: 400 }}>
          <Search
            size={13}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-4)",
              pointerEvents: "none",
            }}
          />
          <input
            ref={caja}
            className="input-new"
            style={{ paddingLeft: 30, paddingRight: texto ? 30 : 12 }}
            placeholder="Negocio, contacto, teléfono, correo…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            aria-label="Buscar prospectos"
          />
          {texto && (
            <button
              type="button"
              onClick={limpiarBusqueda}
              aria-label="Borrar la búsqueda"
              title="Borrar la búsqueda"
              style={{
                position: "absolute",
                right: 6,
                top: "50%",
                transform: "translateY(-50%)",
                height: 22,
                width: 22,
                display: "grid",
                placeItems: "center",
                borderRadius: 6,
                border: "none",
                background: "transparent",
                color: "var(--text-3)",
                cursor: "pointer",
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>

        <Selector
          ancho={190}
          etiqueta="Filtrar por situación"
          valor={filtros.estado}
          alElegir={(v) => poner({ estado: v as CrmFiltros["estado"] })}
          opciones={CRM_ESTADOS.map((e) => ({
            valor: e.id,
            texto: e.id === "" ? "Cualquier situación" : e.label,
            titulo: e.ayuda,
          }))}
        />

        <Selector
          ancho={ANCHO_SELECT}
          etiqueta="Filtrar por giro"
          valor={filtros.vertical}
          alElegir={(v) => poner({ vertical: v })}
          opciones={[
            { valor: "", texto: "Todos los giros" },
            ...CRM_VERTICALES.map((v) => ({ valor: v.id, texto: v.label })),
          ]}
        />

        <Selector
          ancho={ANCHO_SELECT}
          etiqueta="Filtrar por fuente"
          valor={filtros.fuente}
          alElegir={(v) => poner({ fuente: v })}
          opciones={[
            { valor: "", texto: "Todas las fuentes" },
            ...CRM_FUENTES.map((f) => ({ valor: f.id, texto: f.label })),
          ]}
        />

        {/* La etapa sólo filtra en la LISTA: en el tablero cada etapa ya es
            una columna, y elegir una dejaría siete vacías. Si venía puesta
            desde la lista, la ficha de abajo la sigue enseñando y la sigue
            pudiendo quitar. */}
        {vista === "lista" && (
          <Selector
            ancho={ANCHO_SELECT}
            etiqueta="Filtrar por etapa"
            valor={filtros.etapa}
            alElegir={(v) => poner({ etapa: v })}
            opciones={[
              { valor: "", texto: "Todas las etapas" },
              ...CRM_ETAPAS.map((e) => ({ valor: e.id, texto: e.label, titulo: e.ayuda })),
            ]}
          />
        )}

        {socios.length > 0 && (
          <Selector
            ancho={196}
            etiqueta="Filtrar por quién lo trajo"
            valor={filtros.origen}
            alElegir={(v) => poner({ origen: v })}
            opciones={[
              { valor: "", texto: "Lo trajo cualquiera" },
              { valor: CRM_ORIGEN_DALECONTROL, texto: "Los que agregué yo" },
              { valor: CRM_ORIGEN_AFILIADOS, texto: "Recomendados por socios" },
              ...socios.map((s) => ({ valor: s.id, texto: `${s.nombre} (${s.cuantos})` })),
            ]}
          />
        )}

        <Selector
          ancho={186}
          etiqueta="Ordenar"
          valor={filtros.orden}
          alElegir={(v) => poner({ orden: v as CrmOrden })}
          opciones={CRM_ORDENES.map((o) => ({
            valor: o.id,
            texto: o.label,
            titulo: o.ayuda,
          }))}
        />

        <div className="segment-new" style={{ marginLeft: "auto", flexShrink: 0 }}>
          <BotonVista
            actual={vista}
            valor="tablero"
            icono={<LayoutGrid size={13} />}
            label="Tablero"
            alElegir={(v) => poner({ vista: v })}
          />
          <BotonVista
            actual={vista}
            valor="lista"
            icono={<List size={13} />}
            label="Lista"
            alElegir={(v) => poner({ vista: v })}
          />
        </div>
      </div>

      {/* ── Fichas de lo que está puesto + el número, SIEMPRE ──────── */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          marginTop: 10,
          minHeight: 26,
        }}
      >
        <span
          style={{ fontSize: 12, color: "var(--text-3)", whiteSpace: "nowrap" }}
          aria-live="polite"
        >
          <strong className="mono" style={{ color: "var(--text-1)", fontWeight: 700 }}>
            {total.toLocaleString("es-MX")}
          </strong>
          {total === totalGeneral ? (
            <> {total === 1 ? "prospecto" : "prospectos"}</>
          ) : (
            <>
              {" "}
              de {totalGeneral.toLocaleString("es-MX")}{" "}
              {totalGeneral === 1 ? "prospecto" : "prospectos"}
            </>
          )}
        </span>

        {cargando && (
          <span style={{ fontSize: 11.5, color: "var(--text-4)" }} aria-hidden>
            actualizando…
          </span>
        )}

        {activos.map((a) => (
          <button
            key={a.clave}
            type="button"
            onClick={() => poner({ [a.clave]: "" } as Partial<CrmFiltros>)}
            title={`Quitar el filtro de ${a.etiqueta.toLowerCase()}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              height: 26,
              padding: "0 6px 0 10px",
              borderRadius: 99,
              fontSize: 11.5,
              cursor: "pointer",
              border: "1px solid var(--border-soft)",
              background: "var(--brand-soft)",
              color: "var(--text-2)",
              maxWidth: 280,
            }}
          >
            <span style={{ color: "var(--text-4)" }}>{a.etiqueta}:</span>
            <span
              style={{
                color: "var(--text-1)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {a.texto}
            </span>
            <X size={12} />
          </button>
        ))}

        {hayFiltros && (
          <button
            type="button"
            onClick={() => alCambiar(crmFiltrosLimpios(filtros))}
            style={{
              height: 26,
              padding: "0 10px",
              borderRadius: 99,
              fontSize: 11.5,
              cursor: "pointer",
              border: "1px solid var(--border-soft)",
              background: "transparent",
              color: "var(--text-3)",
            }}
          >
            Quitar todos
          </button>
        )}
      </div>
    </div>
  );
}

/** Un `<select>` del panel, con su etiqueta accesible y su ancho fijo. */
function Selector({
  ancho,
  etiqueta,
  valor,
  opciones,
  alElegir,
}: {
  ancho: number;
  etiqueta: string;
  valor: string;
  opciones: { valor: string; texto: string; titulo?: string }[];
  alElegir: (v: string) => void;
}) {
  // Un filtro puesto se distingue del vacío sin tener que leerlo: el
  // borde de marca es la misma señal que usan las fichas de abajo.
  const puesto = valor !== "";
  return (
    <select
      className="input-new"
      style={{
        // `0 1 <ancho>` y no `width` fijo: en el escritorio se quedan en
        // su ancho natural, y en un móvil de 390 px pueden encogerse para
        // que entren DOS por línea. Con ancho fijo y flexShrink: 0 caía
        // uno por renglón y siete selectores empujaban la lista fuera de
        // la pantalla — que es justo la queja de la que salió esta tarea.
        flex: `0 1 ${ancho}px`,
        minWidth: 138,
        maxWidth: "100%",
        borderColor: puesto ? "var(--brand)" : undefined,
        background: puesto ? "var(--brand-soft)" : undefined,
      }}
      value={valor}
      onChange={(e) => alElegir(e.target.value)}
      aria-label={etiqueta}
      title={etiqueta}
    >
      {opciones.map((o) => (
        <option key={o.valor} value={o.valor} title={o.titulo}>
          {o.texto}
        </option>
      ))}
    </select>
  );
}

function BotonVista({
  actual,
  valor,
  icono,
  label,
  alElegir,
}: {
  actual: CrmVista;
  valor: CrmVista;
  icono: React.ReactNode;
  label: string;
  alElegir: (v: CrmVista) => void;
}) {
  const activo = actual === valor;
  return (
    <button
      type="button"
      onClick={() => alElegir(valor)}
      aria-pressed={activo}
      className={`segment-new__btn${activo ? " segment-new__btn--active" : ""}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      {icono}
      {label}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════

/**
 * El pie de la lista. Usa las clases `.pagination` que ya existen en
 * globals.css (las estrenó /dashboard/auditoria) en vez de inventar otro
 * paginador: es el mismo panel.
 *
 * Se pintan como mucho siete botones de página, con la primera y la
 * última siempre presentes. Un paginador de 40 números no se usa: se usa
 * "siguiente", y para saltar lejos, el filtro.
 */
export function CrmPaginacion({
  filtros,
  total,
  totalPaginas,
  porPagina,
  alCambiar,
}: {
  filtros: CrmFiltros;
  total: number;
  totalPaginas: number;
  porPagina: number;
  alCambiar: (siguiente: CrmFiltros) => void;
}) {
  const pagina = Math.min(Math.max(1, filtros.pagina), totalPaginas);
  const irA = (p: number) => alCambiar(crmFiltrosCon(filtros, { pagina: p }));

  return (
    <div className="pagination">
      <span className="pagination__info">
        Mostrando <span className="mono">{crmRangoTexto(pagina, porPagina, total)}</span>
      </span>

      {totalPaginas > 1 && (
        <div className="pagination__pages">
          <button
            type="button"
            className="pagination__btn"
            onClick={() => irA(pagina - 1)}
            disabled={pagina <= 1}
            aria-label="Página anterior"
          >
            ‹
          </button>
          {crmNumerosDePagina(pagina, totalPaginas).map((n, i) =>
            n === null ? (
              <span
                key={`hueco-${i}`}
                style={{ color: "var(--text-4)", fontSize: 11, padding: "0 2px" }}
                aria-hidden
              >
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                className={`pagination__btn${n === pagina ? " pagination__btn--active" : ""}`}
                onClick={() => irA(n)}
                aria-current={n === pagina ? "page" : undefined}
                aria-label={`Página ${n}`}
              >
                {n}
              </button>
            ),
          )}
          <button
            type="button"
            className="pagination__btn"
            onClick={() => irA(pagina + 1)}
            disabled={pagina >= totalPaginas}
            aria-label="Página siguiente"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
