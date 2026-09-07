"use client";

// ═══════════════════════════════════════════════════════════════════════
// El tablero: una columna por etapa, las tarjetas se arrastran.
//
// Aquí SÓLO se arrastra y se pinta. Quién mueve de verdad es el padre
// (crm-client), que es el mismo que atiende el selector de etapa de la
// lista y de la ficha: así el cambio pasa siempre por el mismo camino —
// pintado optimista, acción, y reversión si el servidor dice que no.
//
// ── POR QUÉ LAS COLUMNAS SE PLIEGAN ────────────────────────────────────
// Antes cada columna medía 258 px FIJOS. Ocho columnas × 258 + huecos =
// más de 2.000 px dentro de un contenedor que en un portátil de 1440
// mide 1.182: se veían cuatro. "Ya es cliente" y "Perdido" no se veían
// nunca sin arrastrar una barra horizontal que además no se anuncia de
// ninguna forma. En el móvil se veía una columna y media.
//
// La salida no es letra más chica ni desplazarse más rápido: es que una
// columna tenga DOS tamaños.
//
//   · DESPLEGADA — elástica entre CRM_COL_ANCHO_MIN y ..._MAX, con sus
//     tarjetas. Se reparte lo que sobra con sus hermanas desplegadas.
//   · PLEGADA — una tira de 40 px que sigue diciendo su NOMBRE y su
//     NÚMERO. Eso es lo que hace que el embudo se siga leyendo entero:
//     un embudo se lee por sus cuentas, no por sus tarjetas.
//
// Cuántas caben desplegadas es aritmética y vive en crm-core
// (`crmCupoColumnas`), con sus pruebas. Cuáles se pliegan también
// (`crmColumnasDesplegadas`): primero las vacías —no esconden nada—,
// después las que cierran el prospecto, y por último el embudo de
// derecha a izquierda.
//
// Y por debajo de CRM_TABLERO_VERTICAL el tablero deja de ser columnas y
// pasa a ser un ACORDEÓN vertical. No es maquillaje responsive: en 390 px
// no caben ni dos columnas legibles, así que en horizontal el móvil
// siempre sería desplazamiento a ciegas. En vertical las ocho etapas
// caben en una pantalla como ocho filas con su nombre y su número.
//
// ── LO QUE SE MIDE, Y QUÉ PASA ANTES DE PODER MEDIR ────────────────────
// El ancho se mide con ResizeObserver sobre el contenedor de verdad, no
// con `window.innerWidth`: lo que manda es lo que queda después de la
// barra lateral de /admin, y eso sólo lo sabe el propio elemento. La
// PRIMERA pintada (la del servidor) no puede medir nada, así que usa
// CRM_TABLERO_ANCHO_SUPUESTO — el ancho de un portátil normal. Servidor y
// cliente pintan lo mismo en esa primera vuelta, así que no hay desajuste
// de hidratación; en cuanto el navegador mide, manda la medida.
//
// ── MOVER DE ETAPA: DOS CAMINOS, NO UNO ────────────────────────────────
// Arrastrar no puede ser el ÚNICO camino: no funciona con teclado ni bien
// en móvil, y hasta ahora la única salida por teclado del tablero era
// irse a la vista de lista. Ahora cada tarjeta trae el MISMO selector de
// etapa que la lista (`CrmEtapaSelect`), que pasa por el mismo `mover`.
//
// ── EL TABLERO NO PAGINA, Y POR ESO DICE LO QUE NO ENSEÑA ──────────────
// Repartir por columna necesita el conjunto, así que aquí no hay páginas:
// hay un tope (CRM_TABLERO_MAX) y, en cuanto se pasa, la pantalla lo dice
// con los números exactos y manda a la lista, que sí llega a todas. Las
// cuentas de cada columna vienen de la BASE (`totales`), no de contar las
// tarjetas pintadas: si salieran de las tarjetas, una columna con 400
// diría "12" y el embudo mentiría justo cuando más importa. Eso vale
// igual —y sobre todo— para una columna plegada.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import {
  crmColumnasDesplegadas,
  crmEtapa,
  crmTableroOrientacion,
  CRM_ETAPAS,
  CRM_TABLERO_ANCHO_SUPUESTO,
  type CrmTableroOrientacion,
} from "@/lib/admin/crm/crm-core";
import type { CrmProspectoDTO } from "@/lib/admin/crm/service";
import { CrmTarjeta, crmFmtMxn } from "./crm-ui";
import estilos from "./crm.module.css";

/** Tope de tarjetas pintadas por columna: cientos de nodos traban el arrastre. */
const TOPE_POR_COLUMNA = 60;

/**
 * El color del tono de la etapa. Sirve para la línea de acento de cada
 * columna: sin ella las ocho columnas son ocho cajas grises iguales y hay
 * que leer el encabezado para saber dónde está uno. Es el MISMO tono que
 * ya usa la insignia de la etapa (CrmEtapaBadge), para que el color diga
 * lo mismo en el tablero, en la lista y en la ficha.
 *
 * `neutral` NO usa --border-strong: sobre el fondo de la columna daba
 * 1,56:1 y era invisible, justo en "Sin contactar", que es la columna más
 * llena. Va al token del CRM, que está medido (ver crm.module.css).
 */
const COLOR_TONO: Record<string, string> = {
  neutral: "var(--crm-acento-neutral)",
  info: "var(--info)",
  brand: "var(--brand)",
  warning: "var(--warning)",
  success: "var(--success)",
  danger: "var(--danger)",
};

export function CrmTablero({
  filas,
  ahora,
  totales,
  mover,
  alVerLista,
  alEditar,
  alTextos,
}: {
  filas: CrmProspectoDTO[];
  ahora: Date;
  /**
   * Cuántos hay DE VERDAD en cada etapa con los filtros puestos, contado
   * en la base. Las tarjetas que llegan pueden ser menos (ver el tope de
   * arriba); el número de la columna sale siempre de aquí.
   */
  totales: Record<string, number>;
  mover: (id: string, etapa: string) => void;
  alVerLista: (etapa: string) => void;
  /** Abre el formulario EN SITIO, sin salir del tablero (ver crm-client). */
  alEditar: (p: CrmProspectoDTO) => void;
  alTextos?: (p: CrmProspectoDTO) => void;
}) {
  const [sobre, setSobre] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState<string | null>(null);

  const porEtapa = useMemo(() => {
    const mapa = new Map<string, CrmProspectoDTO[]>();
    for (const e of CRM_ETAPAS) mapa.set(e.id, []);
    for (const f of filas) {
      const id = crmEtapa(f.stage).id;
      // Una etapa que ya no está en el catálogo (edición a mano en la base)
      // se queda con su propia columna al final en vez de perder la fila.
      if (!mapa.has(id)) mapa.set(id, []);
      mapa.get(id)!.push(f);
    }
    return mapa;
  }, [filas]);

  // Las del catálogo, y detrás las huérfanas que hayan aparecido — tanto
  // en las tarjetas que llegaron como en las cuentas de la base, porque
  // una etapa fuera de catálogo puede tener 300 filas y ninguna en esta
  // tanda de tarjetas.
  const columnas = useMemo(() => {
    const conocidas = CRM_ETAPAS.map((e) => e.id);
    const extra = Array.from(
      new Set([...porEtapa.keys(), ...Object.keys(totales ?? {})]),
    ).filter((k) => conocidas.indexOf(k as any) === -1);
    return [...conocidas, ...extra];
  }, [porEtapa, totales]);

  // ── Cuánto sitio hay de verdad ───────────────────────────────────────
  const caja = useRef<HTMLDivElement | null>(null);
  const [ancho, setAncho] = useState(0);
  useEffect(() => {
    const el = caja.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entradas) => {
      const w = entradas[0]?.contentRect?.width ?? 0;
      // Redondeado: sin esto un reflujo de medio píxel dispara un render.
      setAncho((prev) => (Math.abs(prev - w) < 1 ? prev : Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const anchoUtil = ancho > 0 ? ancho : CRM_TABLERO_ANCHO_SUPUESTO;
  const orientacion: CrmTableroOrientacion =
    ancho > 0 ? crmTableroOrientacion(ancho) : "horizontal";

  /**
   * Lo que se abrió o cerró A MANO. `null` = automático, que es lo normal
   * y lo que hace que el tablero quepa solo.
   *
   * Vive en estado y no en la URL a propósito. La URL es para lo que
   * ESCONDE filas —los filtros— y para lo que se comparte; esto no
   * esconde nada (una columna plegada sigue diciendo su número) y no hay
   * quien mande "mira mi tablero con la tercera columna cerrada". A
   * cambio, plegar una columna es instantáneo: si viajara en la
   * querystring, cada clic sería una navegación y otra consulta a la
   * base, y la página es `force-dynamic`. Sobrevive a router.refresh() y
   * a cambiar de filtro, que es cuando de verdad estorbaría perderlo.
   */
  const [elegidas, setElegidas] = useState<string[] | null>(null);

  const desplegadas = useMemo(
    () =>
      new Set(
        crmColumnasDesplegadas({
          columnas,
          totales: totales ?? {},
          ancho: anchoUtil,
          orientacion,
          elegidas,
        }),
      ),
    [columnas, totales, anchoUtil, orientacion, elegidas],
  );

  const alternar = useCallback(
    (etapaId: string) => {
      setElegidas((previas) => {
        const siguiente = new Set(desplegadas);
        if (siguiente.has(etapaId)) {
          // Nunca se quedan las ocho plegadas: un tablero sin una sola
          // tarjeta a la vista no es un tablero y no hay de dónde
          // arrastrar. Se devuelve lo de antes TAL CUAL —y no el reparto
          // de ahora— para que un clic que no hace nada tampoco deje el
          // tablero en modo manual con su botón de "Ajustar solo".
          if (siguiente.size <= 1) return previas;
          siguiente.delete(etapaId);
        } else {
          siguiente.add(etapaId);
        }
        return columnas.filter((c) => siguiente.has(c));
      });
    },
    [columnas, desplegadas],
  );

  function soltar(etapa: string, id: string | null) {
    setSobre(null);
    setArrastrando(null);
    if (!id) return;
    const p = filas.find((f) => f.id === id);
    if (!p || crmEtapa(p.stage).id === etapa) return;
    mover(id, etapa);
  }

  return (
    <div>
      {elegidas !== null && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <button
            type="button"
            onClick={() => setElegidas(null)}
            title="Volver a que el tablero decida solo qué columnas caben desplegadas"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              height: 26,
              padding: "0 10px",
              borderRadius: 99,
              border: "1px solid var(--border-soft)",
              background: "transparent",
              color: "var(--text-3)",
              fontSize: 11.5,
              cursor: "pointer",
            }}
          >
            <RotateCcw size={12} aria-hidden />
            Ajustar solo
          </button>
        </div>
      )}

      {/* Apilando las columnas, el embudo dejaba de verse de un vistazo:
          las siete etapas de abajo quedaban detrás de las tarjetas de la
          abierta — medido en el banco de pruebas, 4.800 px de
          desplazamiento hasta la segunda. Esta tira pone las OCHO cuentas
          arriba del todo y sirve de atajo para saltar a una etapa. En
          horizontal no se pinta: allí las ocho columnas ya están a la
          vista y sería decir lo mismo dos veces. */}
      {orientacion === "vertical" && (
        // `role="list"`: Safari deja de exponer una lista en cuanto se le
        // quitan las viñetas, y ésta es la única cosa de la pantalla que
        // resume el embudo entero en el móvil.
        <ul role="list" className={estilos.tira} aria-label="El embudo entero, de un vistazo">
          {columnas.map((etapaId) => {
            const etapa = crmEtapa(etapaId);
            const total = totales?.[etapaId] ?? 0;
            const abierta = desplegadas.has(etapaId);
            return (
              <li key={etapaId} className={estilos.tiraItem}>
                <button
                  type="button"
                  className={`${estilos.tiraChip} ${abierta ? estilos.tiraChipAbierta : ""}`}
                  aria-label={`${etapa.label}: ${total} ${total === 1 ? "prospecto" : "prospectos"}. ${
                    abierta ? "Ir a sus tarjetas" : "Desplegar sus tarjetas"
                  }`}
                  onClick={() => {
                    if (!abierta) alternar(etapaId);
                    // Al siguiente pintado ya existe el cuerpo desplegado.
                    requestAnimationFrame(() => {
                      document
                        .getElementById(`crm-col-${etapaId}`)
                        ?.scrollIntoView({ block: "center" });
                    });
                  }}
                >
                  <span
                    aria-hidden
                    className={estilos.tiraPunto}
                    style={{
                      background: COLOR_TONO[etapa.tono] ?? COLOR_TONO.neutral,
                      opacity: etapa.terminal ? 0.55 : 1,
                    }}
                  />
                  <span className={estilos.tiraNombre}>{etapa.label}</span>
                  <span className={`mono ${estilos.tiraCuenta}`}>{total}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div
        ref={caja}
        className={`${estilos.tablero} ${
          orientacion === "vertical" ? estilos.tableroV : estilos.tableroH
        } scrollbar-thin`}
      >
        {columnas.map((etapaId) => {
          const etapa = crmEtapa(etapaId);
          const lista = porEtapa.get(etapaId) ?? [];
          // El total manda sobre lo pintado. Si por lo que sea no llegó
          // (una etapa huérfana sin cuenta), se cae a lo que hay: nunca a 0.
          const total = totales?.[etapaId] ?? lista.length;
          const pintadas = Math.min(lista.length, TOPE_POR_COLUMNA);
          const faltan = Math.max(0, total - pintadas);
          const abierta = desplegadas.has(etapaId);
          const activa = sobre === etapaId;
          const cuerpoId = `crm-col-${etapaId}`;

          // El dinero de la columna se suma sobre las tarjetas QUE
          // LLEGARON, así que en cuanto falta alguna sería un número más
          // chico que la verdad presentado como si fuera la verdad. Se
          // enseña sólo cuando no falta ninguna; si falta, manda la ayuda
          // de la etapa, que siempre es cierta.
          const valor =
            faltan === 0 ? lista.reduce((s, p) => s + (Number(p.monthlyValue) || 0), 0) : 0;

          return (
            <section
              key={etapaId}
              // El nombre accesible de la región. Sin esto un <section> no
              // se expone como región y quien navega con teclado o con
              // lector recorría cientos de enlaces sin saber NUNCA en qué
              // etapa estaba. El número va dentro del nombre a propósito:
              // es la mitad de la información de la columna.
              aria-label={`${etapa.label} — ${total} ${total === 1 ? "prospecto" : "prospectos"}`}
              className={`${estilos.col} ${abierta ? "" : estilos.colPlegada} ${
                activa ? estilos.colActiva : ""
              }`}
              // Una columna PLEGADA sigue siendo destino de arrastre: si
              // no, para mandar algo a "Perdido" habría que abrirla antes.
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (sobre !== etapaId) setSobre(etapaId);
              }}
              onDragLeave={() => setSobre((s) => (s === etapaId ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                soltar(etapaId, e.dataTransfer.getData("text/plain") || arrastrando);
              }}
            >
              <h3 style={{ margin: 0, font: "inherit", fontWeight: "inherit" }}>
                <button
                  type="button"
                  className={estilos.cabecera}
                  aria-expanded={abierta}
                  aria-controls={cuerpoId}
                  // SÓLO cuando está plegada. Ahí el único texto del
                  // botón es el NÚMERO —la etiqueta va en vertical y
                  // `aria-hidden`—, y un `title` no cuenta como nombre
                  // accesible cuando el botón ya tiene contenido: sin esto
                  // se oye "30, botón, contraído" y no hay forma de saber
                  // qué etapa se va a abrir.
                  //
                  // Desplegada NO se pone: el botón ya dice su etapa, su
                  // número y su tercera línea —el importe mensual, o la
                  // ayuda de la etapa—, y un `aria-label` los TAPARÍA. El
                  // importe no está en ningún otro sitio de la pantalla.
                  aria-label={
                    abierta
                      ? undefined
                      : `Desplegar ${etapa.label} — ${total} ${
                          total === 1 ? "prospecto" : "prospectos"
                        }`
                  }
                  onClick={() => alternar(etapaId)}
                  title={
                    abierta
                      ? `Plegar "${etapa.label}" — su número se sigue viendo`
                      : `Desplegar "${etapa.label}" y ver sus tarjetas`
                  }
                >
                  <div
                    aria-hidden
                    className={estilos.acento}
                    style={{
                      background: COLOR_TONO[etapa.tono] ?? COLOR_TONO.neutral,
                      opacity: etapa.terminal ? 0.55 : 1,
                    }}
                  />

                  {abierta ? (
                    <>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: "var(--text-1)",
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {etapa.label}
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                          <Cuenta total={total} />
                          {orientacion === "vertical" ? (
                            <ChevronDown size={13} aria-hidden style={{ color: "var(--text-3)" }} />
                          ) : (
                            <ChevronLeft size={13} aria-hidden style={{ color: "var(--text-3)" }} />
                          )}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 10.5,
                          color: "var(--crm-text-sec)",
                          marginTop: 3,
                          lineHeight: 1.3,
                        }}
                      >
                        {valor > 0 ? `${crmFmtMxn(valor)} al mes` : etapa.ayuda}
                      </div>
                    </>
                  ) : (
                    // Plegada. Lo que se conserva es exactamente lo que
                    // hace falta para leer el embudo: el tono, el número y
                    // el nombre. En horizontal el nombre va en vertical
                    // para que quepa en 40 px; en el acordeón, en su fila.
                    <div
                      style={
                        orientacion === "vertical"
                          ? {
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                            }
                          : { display: "flex", flexDirection: "column", alignItems: "center" }
                      }
                    >
                      {orientacion === "vertical" ? (
                        <>
                          <span
                            style={{
                              fontSize: 11.5,
                              fontWeight: 700,
                              color: "var(--text-1)",
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {etapa.label}
                          </span>
                          <span
                            style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}
                          >
                            <Cuenta total={total} />
                            <ChevronRight size={13} aria-hidden style={{ color: "var(--text-3)" }} />
                          </span>
                        </>
                      ) : (
                        <>
                          <Cuenta total={total} />
                          <span className={estilos.tiraTexto} aria-hidden>
                            {etapa.label}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </button>
              </h3>

              {/* role="list": Safari deja de exponer una lista en cuanto se
                  le quitan las viñetas, y sin él el lector no dice cuántas
                  tarjetas hay en la etapa. `hidden` (y no un display en
                  línea) para que plegar de verdad las saque del árbol. */}
              <ul id={cuerpoId} role="list" className={estilos.cuerpo} hidden={!abierta}>
                {abierta && lista.length === 0 && total === 0 && (
                  <li
                    style={{
                      border: "1px dashed var(--border-soft)",
                      borderRadius: 9,
                      padding: "14px 8px",
                      textAlign: "center",
                      fontSize: 11,
                      color: "var(--crm-text-sec)",
                    }}
                  >
                    Arrastra aquí
                  </li>
                )}
                {abierta &&
                  lista.slice(0, TOPE_POR_COLUMNA).map((p) => (
                    <li key={p.id}>
                      <CrmTarjeta
                        p={p}
                        ahora={ahora}
                        arrastrable
                        alArrastrar={setArrastrando}
                        alEditar={alEditar}
                        alTextos={alTextos}
                        mover={mover}
                      />
                    </li>
                  ))}
                {abierta && faltan > 0 && (
                  <li>
                    <button
                      type="button"
                      onClick={() => alVerLista(etapaId)}
                      title={`Ver los ${total} de "${etapa.label}" en la lista, que sí llega a todos`}
                      style={{
                        width: "100%",
                        border: "1px dashed var(--border-soft)",
                        background: "transparent",
                        borderRadius: 9,
                        padding: "10px 8px",
                        fontSize: 11.5,
                        color: "var(--text-2)",
                        cursor: "pointer",
                      }}
                    >
                      y {faltan} más — verlos en la lista
                    </button>
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** El número de la columna. Se pinta igual esté plegada o desplegada. */
function Cuenta({ total }: { total: number }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: "var(--text-2)",
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        borderRadius: 99,
        padding: "1px 7px",
      }}
    >
      {total}
    </span>
  );
}
