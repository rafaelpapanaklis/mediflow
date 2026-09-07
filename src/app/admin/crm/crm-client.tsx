"use client";

// ═══════════════════════════════════════════════════════════════════════
// La pantalla del CRM de ventas: HOY TOCA arriba, embudo abajo.
//
// El orden no es decorativo. Un CRM no se abre para admirar el embudo: se
// abre para saber a quién hay que buscar hoy. Por eso lo primero de la
// página es la lista de seguimientos vencidos y de hoy, con los botones
// para escribirle, marcarle o posponer sin salir de ahí; el tablero (o la
// lista, según el tamaño de la libreta) viene después, para ver cómo va
// todo.
//
// ── QUIÉN MANDA SOBRE LAS FILAS ────────────────────────────────────────
// El SERVIDOR. Filtra, ordena y pagina en la base y manda UNA página; ver
// el comentario largo de `crmListar`. Antes llegaban hasta 2.000 filas
// enteras y la pantalla las cribaba en el navegador: eso ponía un techo
// silencioso a los 2.000 prospectos y metía la libreta completa dentro
// del HTML de cada carga.
//
// Aquí sólo queda un espejo local de esa página, y sirve para UNA cosa:
// pintar el cambio ANTES de que conteste la acción, porque arrastrar una
// tarjeta tiene que sentirse instantáneo. Cada acción termina en
// router.refresh() y el useEffect vuelve a tomar lo que diga el servidor:
// el estado local es un adelanto, nunca la verdad.
//
// ── LOS FILTROS VIVEN EN LA URL ────────────────────────────────────────
// Ni uno en useState. Se leen en page.tsx (servidor) y se escriben con
// router.push, así que la vista se guarda en marcadores, se manda por
// WhatsApp, aguanta una recarga y el botón de atrás deshace el último
// filtro. La mecánica fina está en crm-filtros.tsx.
//
// ── EDITAR SE HACE EN SITIO, NO EN OTRA PANTALLA ───────────────────────
// El botón "Editar" de la tarjeta y el de la fila abren el MISMO
// formulario aquí encima. Ir a la ficha para corregir un teléfono costaría
// una navegación de ida y otra de vuelta, y al volver se habrían perdido
// el filtro, la búsqueda, la vista y el scroll — que es todo el contexto
// de trabajo. La ficha sigue siendo el sitio de la bitácora y de lo que se
// mira con calma, y desde aquí se llega con "Ficha".
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  CalendarClock,
  DatabaseZap,
  Flame,
  Handshake,
  Plus,
  SearchX,
  Target,
  Trophy,
  Upload,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import {
  crmDiaRelativo,
  crmEstaFrio,
  crmEtapa,
  crmFiltrosAQuery,
  crmFiltrosCon,
  crmFiltrosLimpios,
  crmHayFiltros,
  crmSemaforo,
  crmVistaARecordar,
  CRM_ORIGEN_AFILIADOS,
  type CrmFiltros,
  type CrmOrden,
} from "@/lib/admin/crm/crm-core";
import type { CrmListado, CrmProspectoDTO } from "@/lib/admin/crm/service";
import type { CrmTextoDTO } from "@/lib/admin/crm/textos-core";
import { moverEtapaAccion, programarSeguimientoAccion } from "./actions";
import { CrmBarraFiltros, CrmPaginacion } from "./crm-filtros";
import { CrmFormulario, type CrmClinicaLite } from "./crm-form";
import { CrmImportar } from "./crm-importar";
import { CrmLista } from "./crm-lista";
import { CrmTablero } from "./crm-tablero";
import { CrmTabs } from "./crm-tabs";
import { CrmTextosModal } from "./crm-textos-panel";
import {
  CrmAccionesContacto,
  CrmAccionesFila,
  CrmAvatar,
  CrmMotivoPerdida,
  CrmSemaforoChip,
  CrmVerticalChip,
  crmFmtMxn,
} from "./crm-ui";
import { crmGuardarVista, crmLeerVistaGuardada } from "./crm-vista-guardada";
import estilos from "./crm.module.css";

const RUTA = "/admin/crm";

/** Ancla del bloque de resultados, para volver a él al cambiar de página. */
const ANCLA_RESULTADOS = "crm-resultados";

export function CrmClient({
  listado,
  clinicas,
  textos,
}: {
  listado: CrmListado;
  /** Las cuentas de /admin/clinics, para vincular un prospecto ganado. */
  clinicas: CrmClinicaLite[];
  /** "Mis textos". Vacío si no hay ninguno o si falta aplicar su SQL. */
  textos: CrmTextoDTO[];
}) {
  const router = useRouter();
  const [cargando, startTransition] = useTransition();

  const {
    filtros,
    vista,
    total,
    totalGeneral,
    totalPaginas,
    resumen,
    socios,
    recomendacionesSinTocar,
    escaneoTruncado,
    tableroTruncado,
    bitacoraNoDisponible,
  } = listado;

  // Espejo local de la página que mandó el servidor, sólo para el pintado
  // optimista. Se vuelve a tomar en cada respuesta.
  const [filas, setFilas] = useState<CrmProspectoDTO[]>(listado.filas);
  useEffect(() => {
    setFilas(listado.filas);
  }, [listado.filas]);

  const [hoyToca, setHoyToca] = useState<CrmProspectoDTO[]>(listado.hoyToca);
  useEffect(() => {
    setHoyToca(listado.hoyToca);
  }, [listado.hoyToca]);

  // Las cuentas por etapa también se pintan por adelantado. Son las que
  // salen en la cabecera de cada columna del tablero y las que deciden el
  // "y N más": si se quedaran con el número del servidor mientras la
  // tarjeta ya se movió, la columna diría 8 sobre 7 tarjetas y ofrecería
  // ver "1 más" que no existe.
  const [porEtapa, setPorEtapa] = useState<Record<string, number>>(listado.porEtapa);
  useEffect(() => {
    setPorEtapa(listado.porEtapa);
  }, [listado.porEtapa]);

  // Y el total de "hay que atenderlos", por lo mismo: es la cifra de la
  // cabecera de "Hoy toca" y la del botón de ver el resto.
  const [pendientes, setPendientes] = useState(listado.resumen.vencidos + listado.resumen.paraHoy);
  useEffect(() => {
    setPendientes(listado.resumen.vencidos + listado.resumen.paraHoy);
  }, [listado.resumen.vencidos, listado.resumen.paraHoy]);

  // "Ahora" se congela por render de datos: si se recalculara en cada
  // pintado, un prospecto podría cambiar de "hoy" a "vencido" a media
  // interacción. Se refresca cuando llegan datos nuevos.
  const ahora = useMemo(() => new Date(), [listado.filas]);

  const [creando, setCreando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [perdiendo, setPerdiendo] = useState<CrmProspectoDTO | null>(null);
  const [editando, setEditando] = useState<CrmProspectoDTO | null>(null);
  const [viendoTextos, setViendoTextos] = useState<CrmProspectoDTO | null>(null);

  // ── Navegación ────────────────────────────────────────────────────────

  /** Al cambiar de página se vuelve al principio de los resultados. */
  const volverAResultados = useRef(false);
  useEffect(() => {
    if (!volverAResultados.current) return;
    volverAResultados.current = false;
    document.getElementById(ANCLA_RESULTADOS)?.scrollIntoView({ block: "start" });
  }, [listado.filas]);

  /**
   * El ÚNICO camino para cambiar lo que se está viendo. `push` deja
   * entrada en el historial (el botón de atrás deshace ese filtro);
   * `reemplazar` es para el tecleo de la búsqueda, que si no dejaría una
   * entrada por letra.
   *
   * `scroll: false` en los dos: saltar al principio de la página cada vez
   * que se toca un selector marea. Quien sí quiere volver arriba —cambiar
   * de página— lo pide con la bandera de aquí al lado.
   */
  const navegar = useCallback(
    (siguiente: CrmFiltros, opciones?: { reemplazar?: boolean }) => {
      const url = `${RUTA}${crmFiltrosAQuery(siguiente)}`;
      startTransition(() => {
        if (opciones?.reemplazar) router.replace(url, { scroll: false });
        else router.push(url, { scroll: false });
      });
    },
    [router],
  );

  const irAPagina = useCallback(
    (siguiente: CrmFiltros) => {
      volverAResultados.current = true;
      navegar(siguiente);
    },
    [navegar],
  );

  const conFiltros = useCallback(
    (cambios: Partial<CrmFiltros>) => navegar(crmFiltrosCon(filtros, cambios)),
    [filtros, navegar],
  );

  // ── La vista elegida se recuerda ──────────────────────────────────────
  //
  // Al ABRIR: si la URL no dice vista y hay una guardada de la última vez,
  // se escribe en la URL. Se escribe, y no se pinta y calla, para que la
  // barra de direcciones siga diciendo la verdad y para que `f.vista`
  // siga siendo la única fuente. `replace` y no `push`: recordar una
  // preferencia no es un paso del historial que el botón de atrás tenga
  // que deshacer.
  //
  // La página se conserva a mano en vez de pasar por `crmFiltrosCon`, que
  // vuelve a la 1 ante cualquier cambio que no sea de página: abrir un
  // enlace con `?pag=3` no puede llevarte a la 1 por haber recordado una
  // vista.
  //
  // Depende de `filtros.vista` y NO se dispara una sola vez al montar.
  // Este componente no se vuelve a montar entre navegaciones —es la misma
  // ruta—, así que con un disparo único pasaba esto: abres, se recuerda el
  // tablero; pulsas un KPI, que salta a la lista; vuelves a "CRM de
  // ventas" desde el menú, que es `/admin/crm` pelado... y como el efecto
  // ya había corrido, abría en lista. La preferencia sólo volvía
  // recargando la página entera.
  //
  // No cicla: en cuanto el `replace` mete la vista en la URL,
  // `crmVistaARecordar` devuelve `null` y no hay segundo viaje.
  useEffect(() => {
    const aplicar = crmVistaARecordar(filtros, crmLeerVistaGuardada());
    if (!aplicar) return;
    router.replace(`${RUTA}${crmFiltrosAQuery({ ...filtros, vista: aplicar })}`, { scroll: false });
    // `filtros` entero se lee a propósito dentro del efecto: lo que decide
    // si hay que hacer algo es su `vista`, y el resto sólo se usa para
    // reconstruir la URL del render en el que eso cambió.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros.vista]);

  // Al ELEGIR: se guarda lo que se pulsa en el CONMUTADOR de vista, y
  // sólo eso. No vale mirar `filtros.vista`: ahí acaba también la vista
  // que trae un enlace que alguien te manda (`?vista=lista`) y la que
  // ponen los KPI al saltar a la lista, y ninguna de las dos es una
  // elección tuya. Si se guardara cualquiera de ellas, abrir el enlace de
  // un compañero te cambiaría la vista con la que abres cada mañana —
  // que es justo la molestia que esto viene a quitar.

  // ── Mutaciones ────────────────────────────────────────────────────────

  /** Pinta el cambio de etapa YA (en la página y en "hoy toca") y devuelve
   *  la etapa anterior para poder revertir. */
  function pintarEtapa(id: string, etapa: string): string | null {
    let anterior: string | null = null;
    const cambiar = (p: CrmProspectoDTO) => {
      if (p.id !== id) return p;
      anterior = p.stage;
      return { ...p, stage: etapa };
    };
    setFilas((prev) => prev.map(cambiar));
    setHoyToca((prev) => prev.map(cambiar));
    if (anterior && anterior !== etapa) {
      const desde: string = anterior;
      setPorEtapa((prev) => ({
        ...prev,
        [desde]: Math.max(0, (prev[desde] ?? 0) - 1),
        [etapa]: (prev[etapa] ?? 0) + 1,
      }));
    }
    return anterior;
  }

  /**
   * EL único camino para cambiar de etapa: lo usan el arrastre del tablero
   * y el selector de la lista. Perder pregunta el motivo antes.
   */
  function mover(id: string, etapa: string, motivoPerdida?: string | null) {
    if (etapa === "PERDIDO" && motivoPerdida === undefined) {
      const p = filas.find((f) => f.id === id) ?? hoyToca.find((f) => f.id === id);
      if (p) {
        setPerdiendo(p);
        return;
      }
    }
    const anterior = pintarEtapa(id, etapa);
    startTransition(async () => {
      const r = await moverEtapaAccion(id, etapa, { motivoPerdida: motivoPerdida ?? null });
      if (!r.ok) {
        if (anterior) pintarEtapa(id, anterior);
        toast.error(r.error ?? "No se pudo mover.");
        return;
      }
      toast.success(`Movido a ${crmEtapa(etapa).label}.`);
      router.refresh();
    });
  }

  function reprogramar(p: CrmProspectoDTO, fecha: string | null) {
    const nuevaFecha = fecha ? `${fecha}T12:00:00.000Z` : null;
    const pintar = (f: CrmProspectoDTO) =>
      f.id === p.id ? { ...f, nextActionAt: nuevaFecha } : f;
    setFilas((prev) => prev.map(pintar));

    // Posponer o dar por hecho saca la fila de "Hoy toca" AL INSTANTE. Si
    // sólo se repintara, se quedaría ahí diciendo "En 7 días" debajo de un
    // encabezado que sigue contándola, hasta que volviera el servidor —
    // que es justo el momento en que uno duda de si el botón funcionó.
    const sigueTocando =
      nuevaFecha !== null && ["vencido", "hoy"].includes(crmSemaforo(nuevaFecha, ahora));
    setHoyToca((prev) => {
      const estaba = prev.some((f) => f.id === p.id);
      if (estaba && !sigueTocando) {
        setPendientes((n) => Math.max(0, n - 1));
        return prev.filter((f) => f.id !== p.id);
      }
      return prev.map(pintar);
    });
    startTransition(async () => {
      const r = await programarSeguimientoAccion(p.id, fecha, p.nextActionNote);
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo reprogramar.");
        router.refresh();
        return;
      }
      toast.success(fecha ? "Listo, queda para después." : "Se quitó el próximo paso.");
      router.refresh();
    });
  }

  /**
   * Lo guardado se pinta ANTES de que vuelva el servidor, igual que el
   * arrastre: si sólo se llamara a router.refresh(), la tarjeta se quedaría
   * con el nombre viejo el tiempo que tarde la recarga y parecería que no
   * se guardó.
   */
  function guardado(p: CrmProspectoDTO) {
    const pintar = (f: CrmProspectoDTO) => (f.id === p.id ? { ...f, ...p } : f);
    setFilas((prev) => prev.map(pintar));
    setHoyToca((prev) => prev.map(pintar));
    router.refresh();
  }

  const abrirTextos = textos.length > 0 ? (p: CrmProspectoDTO) => setViendoTextos(p) : undefined;

  // Libreta vacía de verdad = ni un prospecto en la base. No es lo mismo
  // que "el filtro no encontró nada", y se dicen cosas distintas.
  const libretaVacia = totalGeneral === 0;
  const hayFiltros = crmHayFiltros(filtros);

  return (
    // `estilos.raiz` no pinta nada por sí solo: declara los tres tokens de
    // color del CRM (ver crm.module.css) para todo lo que cuelga de aquí,
    // modales incluidos.
    <div className={estilos.raiz}>
      {/* ── Encabezado ─────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "var(--text-1)" }}>
            CRM de ventas
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-3)", maxWidth: 720 }}>
            A quién le queremos vender. No son clientes — los que ya contrataron viven en{" "}
            <Link href="/admin/clinics" style={{ color: "var(--text-2)" }}>
              Clínicas
            </Link>
            .
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <ButtonNew variant="secondary" icon={<Upload size={13} />} onClick={() => setImportando(true)}>
            Importar
          </ButtonNew>
          <ButtonNew variant="primary" icon={<Plus size={13} />} onClick={() => setCreando(true)}>
            Nuevo prospecto
          </ButtonNew>
        </div>
      </div>

      <CrmTabs activo="prospectos" />

      {libretaVacia ? (
        <VacioInicial alCrear={() => setCreando(true)} alImportar={() => setImportando(true)} />
      ) : (
        <>
          {/* ── Los cuatro números, que además FILTRAN ──────────────── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
              gap: 12,
              marginBottom: 18,
            }}
          >
            <KpiBoton
              activo={filtros.estado === "pendientes"}
              titulo="Ver sólo los que hay que atender"
              onClick={() =>
                conFiltros(
                  filtros.estado === "pendientes"
                    ? { estado: "" }
                    : { estado: "pendientes", etapa: "", orden: "prioridad", vista: "lista" },
                )
              }
            >
              <KpiCard
                label="Por atender"
                value={String(resumen.vencidos + resumen.paraHoy)}
                icon={CalendarClock}
                hero
                tone={resumen.vencidos > 0 ? "danger" : undefined}
                hint={
                  resumen.vencidos > 0
                    ? `${resumen.vencidos} ${resumen.vencidos === 1 ? "vencido" : "vencidos"} y ${resumen.paraHoy} para hoy`
                    : "Seguimientos con fecha de hoy"
                }
              />
            </KpiBoton>
            <KpiBoton
              activo={filtros.estado === "abiertos"}
              titulo="Ver todo lo que sigue vivo"
              onClick={() =>
                conFiltros(
                  filtros.estado === "abiertos"
                    ? { estado: "" }
                    : { estado: "abiertos", etapa: "" },
                )
              }
            >
              <KpiCard
                label="En el embudo"
                value={String(resumen.abiertos)}
                icon={Target}
                hint={`${crmFmtMxn(resumen.valorAbierto)} al mes si cerraran todos`}
              />
            </KpiBoton>
            <KpiBoton
              activo={filtros.estado === "frios"}
              titulo="Ver los que se están enfriando"
              onClick={() =>
                conFiltros(
                  filtros.estado === "frios"
                    ? { estado: "" }
                    : { estado: "frios", etapa: "", orden: "sin-contacto", vista: "lista" },
                )
              }
            >
              <KpiCard
                label="Enfriándose"
                value={String(resumen.frios)}
                icon={Flame}
                tone={resumen.frios > 0 ? "warning" : undefined}
                hint="Abiertos y sin nada anotado en 14 días"
              />
            </KpiBoton>
            <KpiBoton
              activo={filtros.etapa === "GANADO"}
              titulo="Ver los que ya cerraron"
              onClick={() =>
                conFiltros(
                  filtros.etapa === "GANADO"
                    ? { etapa: "" }
                    : { etapa: "GANADO", estado: "", orden: "reciente", vista: "lista" },
                )
              }
            >
              <KpiCard
                label="Ya son clientes"
                value={String(resumen.ganados)}
                icon={Trophy}
                hint={resumen.perdidos > 0 ? `${resumen.perdidos} perdidos` : "Ganados desde que existe la lista"}
              />
            </KpiBoton>
          </div>

          {/* ── Lo que mandaron los socios y nadie ha tocado ─────────── */}
          {recomendacionesSinTocar.total > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 18,
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid var(--border-soft)",
                background: "var(--brand-soft)",
              }}
            >
              <Handshake size={16} style={{ color: "var(--brand)", flexShrink: 0 }} />
              <div style={{ flex: "1 1 320px", minWidth: 0, fontSize: 12.5, color: "var(--text-2)" }}>
                <strong style={{ color: "var(--text-1)" }}>
                  {recomendacionesSinTocar.total}{" "}
                  {recomendacionesSinTocar.total === 1 ? "recomendación" : "recomendaciones"} de socios
                </strong>{" "}
                sin contactar todavía
                {recomendacionesSinTocar.socios.length > 0 && (
                  <> — {recomendacionesSinTocar.socios.join(", ")}</>
                )}
                . Un socio que recomienda y ve que nunca los buscamos deja de recomendar.
              </div>
              <ButtonNew
                size="sm"
                variant="secondary"
                onClick={() =>
                  conFiltros({ origen: CRM_ORIGEN_AFILIADOS, etapa: "NUEVO", vista: "lista" })
                }
              >
                Verlas
              </ButtonNew>
            </div>
          )}

          {/* ── Hoy toca ───────────────────────────────────────────── */}
          {hoyToca.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <CardNew
                noPad
                title={`Hoy toca (${pendientes})`}
                sub="Lo vencido primero. Escribe, marca, edita o posponlo sin salir de aquí."
              >
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {hoyToca.map((p) => (
                    <FilaHoy
                      key={p.id}
                      p={p}
                      ahora={ahora}
                      alPosponer={(f) => reprogramar(p, f)}
                      alEditar={setEditando}
                      alTextos={abrirTextos}
                    />
                  ))}
                  {pendientes > hoyToca.length && (
                    <button
                      type="button"
                      onClick={() =>
                        conFiltros({ estado: "pendientes", vista: "lista", orden: "prioridad" })
                      }
                      style={{
                        border: "none",
                        borderTop: "1px solid var(--border-soft)",
                        background: "transparent",
                        padding: "10px 14px",
                        fontSize: 12,
                        color: "var(--text-2)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      Ver los {pendientes - hoyToca.length} restantes en la lista →
                    </button>
                  )}
                </div>
              </CardNew>
            </div>
          )}

          {/* ── Barra de trabajo ───────────────────────────────────── */}
          <div id={ANCLA_RESULTADOS} style={{ scrollMarginTop: 16 }}>
            <CrmBarraFiltros
              filtros={filtros}
              vista={vista}
              socios={socios}
              total={total}
              totalGeneral={totalGeneral}
              cargando={cargando}
              alCambiar={navegar}
              alElegirVista={crmGuardarVista}
            />
          </div>

          {/* Media migración aplicada: está `crm_prospects` pero no
              `crm_activities`. Antes esto no se veía por ninguna parte —
              todas las filas decían "sin bitácora" como si se hubiera
              comprobado, y el FaltaElSql de page.tsx sólo salta cuando
              falla la tabla principal. */}
          {bitacoraNoDisponible && (
            <Aviso>
              <DatabaseZap
                size={14}
                aria-hidden
                style={{ verticalAlign: "-2px", marginRight: 6, color: "var(--warning)" }}
              />
              No se pudo leer la bitácora, así que <strong>no se sabe</strong> cuántas anotaciones
              tiene cada prospecto — donde antes salía un número ahora sale «—». Lo más probable es
              que falte terminar de aplicar <code>sql/crm-dalecontrol.sql</code>: crea{" "}
              <strong className="mono">dos</strong> tablas, <code>crm_prospects</code> y{" "}
              <code>crm_activities</code>, y ésta es la segunda. Todo lo demás del CRM funciona
              igual; el detalle del error está en los logs del servidor.
            </Aviso>
          )}

          {/* Nunca se esconden filas en silencio: si la búsqueda tuvo que
              cortar el barrido, se dice con los dos números y con qué
              hacer para verlo todo. */}
          {escaneoTruncado && (
            <Aviso>
              La búsqueda revisó los primeros{" "}
              <strong className="mono">{escaneoTruncado.escaneados.toLocaleString("es-MX")}</strong>{" "}
              prospectos —según el orden que tienes puesto— de los{" "}
              <strong className="mono">{escaneoTruncado.de.toLocaleString("es-MX")}</strong> que
              cumplen los demás filtros, así que podría faltar alguno más abajo. Añade un giro, una
              fuente, una etapa o una situación antes de buscar: esos filtros sí los resuelve la
              base entera, sin tope.
            </Aviso>
          )}

          {tableroTruncado && (
            <Aviso>
              El tablero está pintando{" "}
              <strong className="mono">{tableroTruncado.pintadas.toLocaleString("es-MX")}</strong> de{" "}
              <strong className="mono">{tableroTruncado.de.toLocaleString("es-MX")}</strong>{" "}
              prospectos: repartir por columna no se puede paginar. Los números de cada columna sí
              son los de verdad.{" "}
              <button type="button" onClick={() => conFiltros({ vista: "lista" })} style={ESTILO_ENLACE}>
                Cámbiate a la lista
              </button>{" "}
              para llegar a todos.
            </Aviso>
          )}

          {/* ── Embudo ─────────────────────────────────────────────── */}
          {vista === "tablero" ? (
            total === 0 ? (
              <CardNew noPad>
                <SinResultados
                  hayFiltros={hayFiltros}
                  q={filtros.q}
                  alLimpiar={() => navegar(crmFiltrosLimpios(filtros))}
                  alCrear={() => setCreando(true)}
                />
              </CardNew>
            ) : (
              <CrmTablero
                filas={filas}
                ahora={ahora}
                totales={porEtapa}
                mover={(id, etapa) => mover(id, etapa)}
                alVerLista={(etapa) => conFiltros({ etapa, vista: "lista" })}
                alEditar={setEditando}
                alTextos={abrirTextos}
              />
            )
          ) : (
            <CardNew noPad title={tituloLista(total, totalGeneral, hayFiltros)}>
              <CrmLista
                filas={filas}
                ahora={ahora}
                orden={filtros.orden}
                mover={(id, etapa) => mover(id, etapa)}
                alOrdenar={(orden: CrmOrden) => conFiltros({ orden })}
                alProgramar={reprogramar}
                alEditar={setEditando}
                alTextos={abrirTextos}
                vacio={
                  <SinResultados
                    hayFiltros={hayFiltros}
                    q={filtros.q}
                    alLimpiar={() => navegar(crmFiltrosLimpios(filtros))}
                    alCrear={() => setCreando(true)}
                  />
                }
              />
              {total > 0 && (
                <CrmPaginacion
                  filtros={filtros}
                  total={total}
                  totalPaginas={totalPaginas}
                  porPagina={filtros.porPagina}
                  alCambiar={irAPagina}
                />
              )}
            </CardNew>
          )}

          <p style={{ fontSize: 11.5, color: "var(--crm-text-sec)", marginTop: 12, maxWidth: 760 }}>
            Los botones de WhatsApp y llamar abren la app en este equipo y dejan la constancia en
            la bitácora del prospecto: DaleControl no manda nada por su cuenta desde aquí.
          </p>
        </>
      )}

      {creando && (
        <CrmFormulario
          clinicas={clinicas}
          alCerrar={() => setCreando(false)}
          alGuardar={() => router.refresh()}
        />
      )}
      {editando && (
        <CrmFormulario
          prospecto={editando}
          clinicas={clinicas}
          alCerrar={() => setEditando(null)}
          alGuardar={guardado}
        />
      )}
      {viendoTextos && (
        <CrmTextosModal
          textos={textos}
          prospecto={viendoTextos}
          alCerrar={() => setViendoTextos(null)}
        />
      )}
      {importando && <CrmImportar alCerrar={() => setImportando(false)} />}
      {perdiendo && (
        <CrmMotivoPerdida
          nombre={perdiendo.name}
          alCerrar={() => setPerdiendo(null)}
          alConfirmar={(motivo) => {
            const id = perdiendo.id;
            setPerdiendo(null);
            mover(id, "PERDIDO", motivo);
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════

const ESTILO_ENLACE: React.CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 0,
  font: "inherit",
  color: "var(--brand)",
  textDecoration: "underline",
  cursor: "pointer",
};

/** El título de la tarjeta de la lista dice SIEMPRE los dos números. */
function tituloLista(total: number, totalGeneral: number, hayFiltros: boolean): string {
  const fmt = (n: number) => n.toLocaleString("es-MX");
  if (!hayFiltros) return `Prospectos (${fmt(total)})`;
  return `Prospectos — ${fmt(total)} de ${fmt(totalGeneral)}`;
}

/** Un aviso de que algo no se está enseñando entero. Nunca en silencio. */
function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      style={{
        marginBottom: 12,
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid var(--warning-border-strong)",
        background: "var(--warning-soft)",
        color: "var(--text-2)",
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Lo que se ve cuando el filtro no encuentra nada. NO dice "no hay nada":
 * dice qué se buscó y qué hacer ahora, porque el 99 % de las veces es un
 * filtro que se quedó puesto y no un prospecto que se perdió.
 */
function SinResultados({
  hayFiltros,
  q,
  alLimpiar,
  alCrear,
}: {
  hayFiltros: boolean;
  q: string;
  alLimpiar: () => void;
  alCrear: () => void;
}) {
  return (
    <div style={{ padding: "44px 20px", textAlign: "center", maxWidth: 460, margin: "0 auto" }}>
      <div
        style={{
          width: 46,
          height: 46,
          borderRadius: 14,
          margin: "0 auto 14px",
          display: "grid",
          placeItems: "center",
          background: "var(--brand-softer)",
          border: "1px solid var(--border-brand)",
          color: "var(--brand)",
        }}
      >
        <SearchX size={20} />
      </div>
      <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: "var(--text-1)" }}>
        {q.trim() ? `Nada coincide con «${q.trim()}»` : "Ningún prospecto cumple estos filtros"}
      </h2>
      <p style={{ fontSize: 13, color: "var(--text-3)", margin: "8px 0 18px", lineHeight: 1.55 }}>
        {hayFiltros
          ? "Los prospectos siguen ahí: lo que no encuentra nada es la combinación de filtros que hay puesta. Quítalos y vuelve a empezar, o cambia sólo uno."
          : "La libreta tiene prospectos, pero ninguno cabe en esta página. Vuelve a la primera."}
      </p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        <ButtonNew variant="primary" onClick={alLimpiar}>
          Quitar todos los filtros
        </ButtonNew>
        <ButtonNew variant="secondary" icon={<Plus size={13} />} onClick={alCrear}>
          Dar de alta uno nuevo
        </ButtonNew>
      </div>
    </div>
  );
}

/**
 * Un número que además filtra. Un KPI que sólo se puede mirar obliga a
 * bajar a los selectores a reproducirlo a mano: "hay 7 por atender" y
 * ahora hay que ir a buscarlos. Aquí el número ES el filtro.
 *
 * ENCENDERLO deja la pantalla como conviene para eso: la vista de lista,
 * el orden que tiene sentido para ese número, y el OTRO eje de filtro
 * limpio. Eso último no es un detalle — "En el embudo" filtra por
 * situación (abiertos) y "Ya son clientes" por etapa (ganados), y
 * encender los dos daba una lista vacía POR CONSTRUCCIÓN, con las dos
 * tarjetas encendidas enseñando números que no se podían ver.
 *
 * APAGARLO sólo quita su filtro y no toca nada más: un botón que al
 * apagarse te reordena la lista se siente estropeado aunque haga lo que
 * dice.
 *
 * Va como <div role="button"> y no como <button>: dentro vive la tarjeta
 * entera del KPI, con sus divs, y un <div> dentro de un <button> es HTML
 * inválido — React lo avisa en consola y algunos navegadores reacomodan el
 * árbol al hidratar. Con role, tabIndex y el manejo de Enter/Espacio se
 * comporta igual para el teclado y para el lector de pantalla.
 */
function KpiBoton({
  activo,
  titulo,
  onClick,
  children,
}: {
  activo: boolean;
  titulo: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={activo}
      title={titulo}
      className="crm-kpi-boton"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        // `display: grid` + `height: 100%`: sin esto la tarjeta envuelta se
        // queda con su alto de contenido mientras las hermanas SIN envolver
        // se estiran al alto de la fila, y quedan dos KPIs más bajos que
        // los otros dos. `.kpi` no trae alto propio.
        display: "grid",
        height: "100%",
        cursor: "pointer",
        borderRadius: "var(--radius-lg)",
        outline: activo ? "1px solid var(--brand)" : "none",
        outlineOffset: 1,
      }}
    >
      {children}
    </div>
  );
}

/** Una fila de "hoy toca": lo que se necesita para actuar, y nada más. */
function FilaHoy({
  p,
  ahora,
  alPosponer,
  alEditar,
  alTextos,
}: {
  p: CrmProspectoDTO;
  ahora: Date;
  alPosponer: (fecha: string | null) => void;
  alEditar: (p: CrmProspectoDTO) => void;
  alTextos?: (p: CrmProspectoDTO) => void;
}) {
  const frio = crmEstaFrio(p, ahora);
  const estado = crmSemaforo(p.nextActionAt, ahora);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px 10px 11px",
        borderTop: "1px solid var(--border-soft)",
        flexWrap: "wrap",
        // La barra de la izquierda dice de un vistazo qué está vencido y
        // qué es de hoy, sin tener que leer el chip de cada fila.
        borderLeft: `3px solid ${estado === "vencido" ? "var(--danger)" : "var(--warning)"}`,
      }}
    >
      <CrmAvatar name={p.name} vertical={p.vertical} size={30} />
      <div style={{ minWidth: 180, flex: "1 1 220px" }}>
        <Link
          href={`/admin/crm/${p.id}`}
          className="crm-tarjeta-nombre"
          style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 12.5, textDecoration: "none" }}
        >
          {p.name}
        </Link>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
          <CrmVerticalChip vertical={p.vertical} />
          {p.city && <span style={{ fontSize: 11, color: "var(--crm-text-sec)" }}>{p.city}</span>}
          {frio && (
            <span style={{ fontSize: 11, color: "var(--crm-warning-text)", fontWeight: 600 }}>
              enfriándose
            </span>
          )}
        </div>
      </div>

      <div style={{ flex: "1 1 240px", minWidth: 200 }}>
        <CrmSemaforoChip fecha={p.nextActionAt} nota={p.nextActionNote} ahora={ahora} />
      </div>

      <CrmAccionesContacto p={p} soloIconos />

      <div style={{ display: "flex", gap: 4 }}>
        <BotonPosponer label="Mañana" onClick={() => alPosponer(crmDiaRelativo(1, ahora))} />
        <BotonPosponer label="+3 d" onClick={() => alPosponer(crmDiaRelativo(3, ahora))} />
        <BotonPosponer label="+1 sem" onClick={() => alPosponer(crmDiaRelativo(7, ahora))} />
        <BotonPosponer label="Listo" onClick={() => alPosponer(null)} />
      </div>

      <CrmAccionesFila p={p} alEditar={alEditar} alTextos={alTextos} />
    </div>
  );
}

function BotonPosponer({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 28,
        padding: "0 9px",
        borderRadius: 7,
        border: "1px solid var(--border-soft)",
        background: "var(--bg-elev-2)",
        color: "var(--text-3)",
        fontSize: 11,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
      title={label === "Listo" ? "Quitarle el próximo paso" : `Posponer a ${label}`}
    >
      {label}
    </button>
  );
}

/** Lo que se ve el primer día, cuando la libreta está vacía. */
function VacioInicial({ alCrear, alImportar }: { alCrear: () => void; alImportar: () => void }) {
  return (
    <CardNew>
      <div style={{ padding: "36px 20px", textAlign: "center", maxWidth: 620, margin: "0 auto" }}>
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 14,
            margin: "0 auto 14px",
            display: "grid",
            placeItems: "center",
            background: "var(--brand-softer)",
            border: "1px solid var(--border-brand)",
            color: "var(--brand)",
          }}
        >
          <Target size={22} />
        </div>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "var(--text-1)" }}>
          Todavía no hay ningún prospecto
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-3)", margin: "8px 0 18px", lineHeight: 1.55 }}>
          Empieza por las clínicas dentales que ya tienes vistas. Puedes darlas de alta una por
          una, o pegar una lista completa —de una hoja de cálculo o de una búsqueda en Google
          Maps— y darlas de alta todas de golpe.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <ButtonNew variant="primary" icon={<Plus size={13} />} onClick={alCrear}>
            Agregar el primero
          </ButtonNew>
          <ButtonNew variant="secondary" icon={<Upload size={13} />} onClick={alImportar}>
            Pegar una lista
          </ButtonNew>
        </div>
      </div>
    </CardNew>
  );
}
