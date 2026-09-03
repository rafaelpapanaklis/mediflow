"use client";

// ═══════════════════════════════════════════════════════════════════════
// La pantalla del CRM de ventas: HOY TOCA arriba, embudo abajo.
//
// El orden no es decorativo. Un CRM no se abre para admirar el embudo: se
// abre para saber a quién hay que buscar hoy. Por eso lo primero de la
// página es la lista de seguimientos vencidos y de hoy, con los botones
// para escribirle, marcarle o posponer sin salir de ahí; el tablero viene
// después, para ver cómo va todo.
//
// ── QUIÉN MANDA SOBRE LAS FILAS ────────────────────────────────────────
// La lista llega del servidor y se guarda en estado local para poder
// pintar el cambio ANTES de que conteste la acción (arrastrar una tarjeta
// tiene que sentirse instantáneo). Cada acción termina en router.refresh()
// y el useEffect vuelve a tomar lo que diga el servidor: el estado local
// es un adelanto, nunca la verdad.
//
// Buscar y filtrar se hacen aquí, en el navegador, sobre la lista ya
// cargada — ver el comentario de `crmCoincide` para los dos motivos.
//
// ── EDITAR SE HACE EN SITIO, NO EN OTRA PANTALLA ───────────────────────
// El botón "Editar" de la tarjeta y el de la fila abren el MISMO
// formulario aquí encima. Ir a la ficha para corregir un teléfono costaría
// una navegación de ida y otra de vuelta, y al volver se habrían perdido
// el filtro, la búsqueda, la vista y el scroll — que es todo el contexto
// de trabajo. La ficha sigue siendo el sitio de la bitácora y de lo que se
// mira con calma, y desde aquí se llega con "Ficha".
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  CalendarClock,
  Flame,
  Handshake,
  LayoutGrid,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  Target,
  Trophy,
  Upload,
  X,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import {
  crmCoincide,
  crmDiaRelativo,
  crmEstaFrio,
  crmEtapa,
  crmPrioridad,
  crmResumen,
  crmSemaforo,
  CRM_ETAPAS,
  CRM_FUENTES,
  CRM_VERTICALES,
} from "@/lib/admin/crm/crm-core";
import type { CrmListado, CrmProspectoDTO } from "@/lib/admin/crm/service";
import type { CrmTextoDTO } from "@/lib/admin/crm/textos-core";
import { moverEtapaAccion, programarSeguimientoAccion } from "./actions";
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

type Vista = "tablero" | "lista";
type Orden = "prioridad" | "reciente" | "valor" | "nombre";

/** Valores especiales del filtro de origen; el resto es un affiliateId. */
const ORIGEN_DALECONTROL = "__dalecontrol";
const ORIGEN_AFILIADOS = "__afiliados";

const ORDENES: { id: Orden; label: string }[] = [
  { id: "prioridad", label: "Por atender" },
  { id: "reciente", label: "Más recientes" },
  { id: "valor", label: "Mayor valor" },
  { id: "nombre", label: "Nombre" },
];

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
  const [, startTransition] = useTransition();

  // La verdad la manda el servidor; esto es el adelanto para que arrastrar
  // se sienta instantáneo. Se vuelve a tomar en cada refresco.
  const [filas, setFilas] = useState<CrmProspectoDTO[]>(listado.filas);
  useEffect(() => {
    setFilas(listado.filas);
  }, [listado.filas]);

  // "Ahora" se congela por render de datos: si se recalculara en cada
  // pintado, un prospecto podría cambiar de "hoy" a "vencido" a media
  // interacción. Se refresca cuando llegan datos nuevos.
  const ahora = useMemo(() => new Date(), [listado.filas]);

  const [vista, setVista] = useState<Vista>("tablero");
  const [q, setQ] = useState("");
  const [vertical, setVertical] = useState("");
  const [fuente, setFuente] = useState("");
  const [etapaFiltro, setEtapaFiltro] = useState("");
  const [origen, setOrigen] = useState("");
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [orden, setOrden] = useState<Orden>("prioridad");
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);

  const [creando, setCreando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [perdiendo, setPerdiendo] = useState<CrmProspectoDTO | null>(null);
  const [editando, setEditando] = useState<CrmProspectoDTO | null>(null);
  const [viendoTextos, setViendoTextos] = useState<CrmProspectoDTO | null>(null);

  const resumen = useMemo(() => crmResumen(filas, ahora), [filas, ahora]);

  // Los socios que aparecen en la lista, para poder filtrar por uno. Se
  // sacan de las filas y no de la tabla de afiliados: aquí sólo importan
  // los que efectivamente recomendaron algo.
  const socios = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const p of filas) {
      if (p.affiliateId) mapa.set(p.affiliateId, p.affiliateName ?? "Socio dado de baja");
    }
    return Array.from(mapa.entries()).sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [filas]);

  const deAfiliados = useMemo(() => filas.filter((p) => !!p.affiliateId).length, [filas]);

  /**
   * Recomendaciones de socios que nadie ha tocado todavía. Merecen aviso
   * propio y no un badge más: un socio que recomienda y ve que nunca lo
   * contactamos deja de recomendar, y estas no entran en "hoy toca" porque
   * nacen sin fecha de seguimiento.
   */
  const deSociosSinTocar = useMemo(
    () => filas.filter((p) => !!p.affiliateId && crmEtapa(p.stage).id === "NUEVO"),
    [filas],
  );

  const filtradas = useMemo(() => {
    const lista = filas.filter((p) => {
      if (vertical && p.vertical !== vertical) return false;
      if (fuente && p.source !== fuente) return false;
      if (origen === ORIGEN_DALECONTROL && p.affiliateId) return false;
      if (origen === ORIGEN_AFILIADOS && !p.affiliateId) return false;
      if (origen && origen !== ORIGEN_DALECONTROL && origen !== ORIGEN_AFILIADOS) {
        if (p.affiliateId !== origen) return false;
      }
      if (etapaFiltro && crmEtapa(p.stage).id !== etapaFiltro) return false;
      if (soloPendientes) {
        const s = crmSemaforo(p.nextActionAt, ahora);
        if (s !== "vencido" && s !== "hoy") return false;
      }
      return crmCoincide(p, q);
    });
    const copia = [...lista];
    if (orden === "prioridad") {
      copia.sort((a, b) => crmPrioridad(a, ahora) - crmPrioridad(b, ahora) || a.name.localeCompare(b.name, "es"));
    } else if (orden === "reciente") {
      copia.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } else if (orden === "valor") {
      copia.sort((a, b) => (Number(b.monthlyValue) || 0) - (Number(a.monthlyValue) || 0));
    } else {
      copia.sort((a, b) => a.name.localeCompare(b.name, "es"));
    }
    return copia;
  }, [filas, vertical, fuente, origen, etapaFiltro, soloPendientes, q, orden, ahora]);

  /** Los que hay que buscar hoy: vencidos primero, luego los de hoy. */
  const hoyToca = useMemo(
    () =>
      filas
        .filter((p) => {
          if (crmEtapa(p.stage).terminal) return false;
          const s = crmSemaforo(p.nextActionAt, ahora);
          return s === "vencido" || s === "hoy";
        })
        .sort((a, b) => crmPrioridad(a, ahora) - crmPrioridad(b, ahora)),
    [filas, ahora],
  );

  // ── Filtros ───────────────────────────────────────────────────────────

  /**
   * Los filtros que se despliegan son cuatro selectores; con todos siempre
   * a la vista, la barra era un muro de ocho controles encima de lo que de
   * verdad se viene a leer. Ahora se guardan detrás de un botón que DICE
   * cuántos hay puestos, y los puestos se siguen viendo como fichas: un
   * filtro escondido es la forma más rápida de creer que se perdieron
   * prospectos.
   */
  const activos = useMemo(() => {
    const items: { clave: string; texto: string; limpiar: () => void }[] = [];
    if (vertical) {
      const v = CRM_VERTICALES.find((x) => x.id === vertical);
      items.push({ clave: "vertical", texto: v?.label ?? vertical, limpiar: () => setVertical("") });
    }
    if (fuente) {
      const f = CRM_FUENTES.find((x) => x.id === fuente);
      items.push({ clave: "fuente", texto: f?.label ?? fuente, limpiar: () => setFuente("") });
    }
    if (etapaFiltro) {
      items.push({
        clave: "etapa",
        texto: crmEtapa(etapaFiltro).label,
        limpiar: () => setEtapaFiltro(""),
      });
    }
    if (origen) {
      const texto =
        origen === ORIGEN_DALECONTROL
          ? "Sólo los míos"
          : origen === ORIGEN_AFILIADOS
            ? "De afiliados"
            : socios.find(([id]) => id === origen)?.[1] ?? "Un socio";
      items.push({ clave: "origen", texto, limpiar: () => setOrigen("") });
    }
    return items;
  }, [vertical, fuente, etapaFiltro, origen, socios]);

  function limpiarFiltros() {
    setVertical("");
    setFuente("");
    setEtapaFiltro("");
    setOrigen("");
    setSoloPendientes(false);
    setQ("");
  }

  // ── Mutaciones ────────────────────────────────────────────────────────

  /** Pinta el cambio de etapa YA y devuelve la anterior para poder revertir. */
  function pintarEtapa(id: string, etapa: string): string | null {
    let anterior: string | null = null;
    setFilas((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        anterior = p.stage;
        return { ...p, stage: etapa };
      }),
    );
    return anterior;
  }

  /**
   * EL único camino para cambiar de etapa: lo usan el arrastre del tablero
   * y el selector de la lista. Perder pregunta el motivo antes.
   */
  function mover(id: string, etapa: string, motivoPerdida?: string | null) {
    if (etapa === "PERDIDO" && motivoPerdida === undefined) {
      const p = filas.find((f) => f.id === id);
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
    setFilas((prev) =>
      prev.map((f) => (f.id === p.id ? { ...f, nextActionAt: fecha ? `${fecha}T12:00:00.000Z` : null } : f)),
    );
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
    setFilas((prev) => prev.map((f) => (f.id === p.id ? { ...f, ...p } : f)));
    router.refresh();
  }

  const abrirTextos = textos.length > 0 ? (p: CrmProspectoDTO) => setViendoTextos(p) : undefined;

  const vacio = filas.length === 0;

  return (
    <div>
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

      {vacio ? (
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
              activo={soloPendientes}
              titulo="Ver sólo los que hay que atender"
              onClick={() => {
                setSoloPendientes((v) => !v);
                setVista("lista");
              }}
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
            <KpiCard
              label="En el embudo"
              value={String(resumen.abiertos)}
              icon={Target}
              hint={`${crmFmtMxn(resumen.valorAbierto)} al mes si cerraran todos`}
            />
            <KpiCard
              label="Enfriándose"
              value={String(resumen.frios)}
              icon={Flame}
              tone={resumen.frios > 0 ? "warning" : undefined}
              hint="Abiertos y sin nada anotado en 14 días"
            />
            <KpiBoton
              activo={etapaFiltro === "GANADO"}
              titulo="Ver los que ya cerraron"
              onClick={() => {
                setEtapaFiltro((e) => (e === "GANADO" ? "" : "GANADO"));
                setVista("lista");
                setFiltrosAbiertos(true);
              }}
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
          {deSociosSinTocar.length > 0 && (
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
                  {deSociosSinTocar.length}{" "}
                  {deSociosSinTocar.length === 1 ? "recomendación" : "recomendaciones"} de socios
                </strong>{" "}
                sin contactar todavía —{" "}
                {Array.from(
                  new Set(deSociosSinTocar.map((p) => p.affiliateName ?? "un socio dado de baja")),
                )
                  .slice(0, 3)
                  .join(", ")}
                . Un socio que recomienda y ve que nunca los buscamos deja de recomendar.
              </div>
              <ButtonNew
                size="sm"
                variant="secondary"
                onClick={() => {
                  setOrigen(ORIGEN_AFILIADOS);
                  setEtapaFiltro("NUEVO");
                  setVista("lista");
                  setFiltrosAbiertos(true);
                }}
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
                title={`Hoy toca (${hoyToca.length})`}
                sub="Lo vencido primero. Escribe, marca, edita o posponlo sin salir de aquí."
              >
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {hoyToca.slice(0, 12).map((p) => (
                    <FilaHoy
                      key={p.id}
                      p={p}
                      ahora={ahora}
                      alPosponer={(f) => reprogramar(p, f)}
                      alEditar={setEditando}
                      alTextos={abrirTextos}
                    />
                  ))}
                  {hoyToca.length > 12 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSoloPendientes(true);
                        setVista("lista");
                      }}
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
                      Ver los {hoyToca.length - 12} restantes en la lista →
                    </button>
                  )}
                </div>
              </CardNew>
            </div>
          )}

          {/* ── Barra de trabajo ───────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <div style={{ position: "relative", flex: "1 1 240px", minWidth: 200, maxWidth: 420 }}>
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
                className="input-new"
                style={{ paddingLeft: 30 }}
                placeholder="Buscar por negocio, persona, ciudad, teléfono o nota…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Buscar prospectos"
              />
            </div>

            <select
              className="input-new"
              style={{ width: 150 }}
              value={orden}
              onChange={(e) => setOrden(e.target.value as Orden)}
              aria-label="Ordenar"
            >
              {ORDENES.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setSoloPendientes((v) => !v)}
              style={{
                height: 34,
                padding: "0 12px",
                borderRadius: 8,
                fontSize: 12,
                cursor: "pointer",
                border: `1px solid ${soloPendientes ? "var(--brand)" : "var(--border-soft)"}`,
                background: soloPendientes ? "var(--brand-soft)" : "var(--bg-elev)",
                color: soloPendientes ? "var(--text-1)" : "var(--text-2)",
              }}
              aria-pressed={soloPendientes}
            >
              Sólo pendientes
            </button>

            <button
              type="button"
              onClick={() => setFiltrosAbiertos((v) => !v)}
              aria-expanded={filtrosAbiertos}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 34,
                padding: "0 12px",
                borderRadius: 8,
                fontSize: 12,
                cursor: "pointer",
                border: `1px solid ${activos.length > 0 ? "var(--brand)" : "var(--border-soft)"}`,
                background: activos.length > 0 ? "var(--brand-soft)" : "var(--bg-elev)",
                color: activos.length > 0 ? "var(--text-1)" : "var(--text-2)",
              }}
            >
              <SlidersHorizontal size={13} />
              Filtros
              {activos.length > 0 && ` (${activos.length})`}
            </button>

            <div className="segment-new" style={{ marginLeft: "auto" }}>
              <BotonVista actual={vista} valor="tablero" icono={<LayoutGrid size={13} />} label="Tablero" alElegir={setVista} />
              <BotonVista actual={vista} valor="lista" icono={<List size={13} />} label="Lista" alElegir={setVista} />
            </div>
          </div>

          {/* Los filtros puestos, SIEMPRE a la vista — con el panel abierto
              o cerrado. Uno escondido se lee como prospectos perdidos, y
              además el selector de etapa sólo existe en la vista de lista:
              sin estas fichas, un filtro de etapa puesto desde el tablero
              se quedaría sin forma de quitarse. */}
          {activos.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
              {activos.map((a) => (
                <button
                  key={a.clave}
                  type="button"
                  onClick={a.limpiar}
                  title={`Quitar el filtro «${a.texto}»`}
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
                    background: "var(--bg-elev-2)",
                    color: "var(--text-2)",
                  }}
                >
                  {a.texto}
                  <X size={12} />
                </button>
              ))}
            </div>
          )}

          {filtrosAbiertos && (
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
                marginBottom: 10,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid var(--border-soft)",
                background: "var(--bg-elev-2)",
              }}
            >
              <select
                className="input-new"
                style={{ width: 168 }}
                value={vertical}
                onChange={(e) => setVertical(e.target.value)}
                aria-label="Filtrar por giro"
              >
                <option value="">Todos los giros</option>
                {CRM_VERTICALES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>

              <select
                className="input-new"
                style={{ width: 168 }}
                value={fuente}
                onChange={(e) => setFuente(e.target.value)}
                aria-label="Filtrar por fuente"
              >
                <option value="">Todas las fuentes</option>
                {CRM_FUENTES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>

              {/* La etapa sólo filtra en la LISTA: en el tablero cada etapa
                  ya es una columna, y filtrar por una dejaría siete vacías. */}
              {vista === "lista" && (
                <select
                  className="input-new"
                  style={{ width: 160 }}
                  value={etapaFiltro}
                  onChange={(e) => setEtapaFiltro(e.target.value)}
                  aria-label="Filtrar por etapa"
                >
                  <option value="">Todas las etapas</option>
                  {CRM_ETAPAS.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.label}
                    </option>
                  ))}
                </select>
              )}

              {socios.length > 0 && (
                <select
                  className="input-new"
                  style={{ width: 190 }}
                  value={origen}
                  onChange={(e) => setOrigen(e.target.value)}
                  aria-label="Filtrar por quién lo agregó"
                >
                  <option value="">Lo agregó cualquiera</option>
                  <option value={ORIGEN_DALECONTROL}>Sólo los míos</option>
                  <option value={ORIGEN_AFILIADOS}>De afiliados ({deAfiliados})</option>
                  {socios.map(([id, nombre]) => (
                    <option key={id} value={id}>
                      {nombre}
                    </option>
                  ))}
                </select>
              )}

              {(activos.length > 0 || soloPendientes || q) && (
                <button
                  type="button"
                  onClick={limpiarFiltros}
                  style={{
                    height: 34,
                    padding: "0 12px",
                    borderRadius: 8,
                    fontSize: 12,
                    cursor: "pointer",
                    border: "1px solid var(--border-soft)",
                    background: "transparent",
                    color: "var(--text-3)",
                    marginLeft: "auto",
                  }}
                >
                  Quitar todos
                </button>
              )}
            </div>
          )}

          {/* ── Embudo ─────────────────────────────────────────────── */}
          {vista === "tablero" ? (
            <CrmTablero
              filas={filtradas}
              ahora={ahora}
              mover={(id, etapa) => mover(id, etapa)}
              alVerLista={(etapa) => {
                setEtapaFiltro(etapa);
                setVista("lista");
              }}
              alEditar={setEditando}
              alTextos={abrirTextos}
            />
          ) : (
            <CardNew noPad title={`Prospectos (${filtradas.length})`}>
              <CrmLista
                filas={filtradas}
                ahora={ahora}
                mover={(id, etapa) => mover(id, etapa)}
                alEditar={setEditando}
                alTextos={abrirTextos}
              />
            </CardNew>
          )}

          <p style={{ fontSize: 11.5, color: "var(--text-4)", marginTop: 12, maxWidth: 760 }}>
            {listado.truncado
              ? `Se muestran los ${filas.length} prospectos más recientes de ${listado.total}. `
              : ""}
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

/**
 * Un número que además filtra. Un KPI que sólo se puede mirar obliga a
 * bajar a los selectores a reproducirlo a mano: "hay 7 por atender" y
 * ahora hay que ir a buscarlos. Aquí el número ES el filtro.
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

function BotonVista({
  actual,
  valor,
  icono,
  label,
  alElegir,
}: {
  actual: Vista;
  valor: Vista;
  icono: React.ReactNode;
  label: string;
  alElegir: (v: Vista) => void;
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
          {p.city && <span style={{ fontSize: 11, color: "var(--text-4)" }}>{p.city}</span>}
          {frio && <span style={{ fontSize: 11, color: "var(--warning)" }}>enfriándose</span>}
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
            borderRadius: 12,
            margin: "0 auto 14px",
            display: "grid",
            placeItems: "center",
            background: "var(--brand-soft)",
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
