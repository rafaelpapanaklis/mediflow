"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  Search,
  X,
} from "lucide-react";
import { EduSedeSelector } from "@/components/edu/sedes/sede-selector";
import type { EduCampusOption } from "@/lib/edu/campus-core";
import {
  EDU_APPOINTMENT_STATUSES,
  EDU_APPOINTMENT_STATUS_LABELS,
  EDU_APPOINTMENT_TYPES,
  EDU_APPOINTMENT_TYPE_LABELS,
} from "@/lib/edu/types";
import {
  eduFormatDayLong,
  eduFormatDayShort,
  eduHasAgendaFilters,
  eduShiftDayISO,
  type EduAgendaQuery,
  type EduAppointmentRow,
  type EduChairOption,
  type EduStudentOption,
  type EduSupervisorOption,
} from "@/lib/edu/agenda-core";
import {
  EDU_AGENDA_DENSITIES,
  EDU_AGENDA_DENSITY_HINTS,
  EDU_AGENDA_DENSITY_KEY,
  EDU_AGENDA_DENSITY_LABELS,
  EDU_AGENDA_NARROW_PX,
  eduAgendaConflicto,
  eduAgendaDrop,
  eduAgendaHref,
  eduAgendaLayout,
  eduAgendaLegend,
  eduAgendaSlots,
  parseEduAgendaDensity,
  slotHeightFor,
  type EduAgendaChair,
  type EduAgendaColumn,
  type EduAgendaDensity,
  type EduAgendaDrop,
  type EduAgendaUrlKey,
} from "@/lib/edu/agenda-rejilla";
import {
  EduAgendaDragProvider,
  EduAgendaRejilla,
  type EduAgendaDragState,
} from "@/components/edu/agenda/agenda-rejilla";
import { EduAgendaLista } from "@/components/edu/agenda/agenda-lista";
import {
  EduAgendaAlta,
  EduAgendaConfirmarArrastre,
  EduAgendaDetalle,
} from "@/components/edu/agenda/agenda-modales";

/**
 * /instituto/agenda — LA REJILLA.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ DECIDE ESTA PANTALLA Y QUÉ NO
 *
 * NO decide quién ve qué: eso lo resolvió el servidor con el helper único
 * (visibility.ts) y aquí no hay forma de pedir más filas. NO decide si una
 * cita se puede mover: eso lo dice el endpoint de reagendar, con el horario
 * del sillón, el choque y la sede. Lo que hace es PINTAR y PROPONER.
 *
 * ── EL COLOR ES DE LA ESPECIALIDAD ─────────────────────────────────────
 * En el dental el color es del doctor porque una clínica tiene seis. Aquí
 * hay ciento veinte estudiantes: un color por cabeza no es un código, es
 * ruido. La superficie de la tarjeta es la ESPECIALIDAD y el estado es un
 * punto — dos señales, cada una con su sitio, ninguna encima de la otra.
 * Los chips de arriba son la leyenda Y SON EL FILTRO: no hay dos controles
 * del mismo estado que se puedan contradecir.
 *
 * ── LO QUE SE MIDE ES EL CONTENEDOR, NO LA VENTANA ─────────────────────
 * `@container` y no `@media`. El panel del instituto tiene un cajón de
 * menú que en escritorio es una columna fija: con la ventana en 1024 px, a
 * la agenda le quedan ~800. Medir la ventana pintaría una rejilla de
 * escritorio en un hueco de tableta. El envoltorio `.edu-ag` lleva
 * `container-type: inline-size`, y por eso los tres diálogos se montan
 * FUERA de él — un contenedor de consulta atrapa a sus descendientes
 * `position: fixed`.
 *
 * ── EN EL TELÉFONO ─────────────────────────────────────────────────────
 * Con 32 sillones no hay forma de que la vista de día quepa en 390 px, y
 * encogerla hasta que quepa da columnas de 11 px. Lo que se hace:
 *   · DÍA angosto  → la rejilla pinta UN sillón, con un selector para
 *     moverse entre ellos. Cuál se ve lo sigue diciendo `?sillon=` — no
 *     hay estado nuevo escondido —, y la pantalla avisa de cuántos hay.
 *   · SEMANA angosta → cae a LISTA. Siete columnas en 390 px no se leen de
 *     ninguna manera, y una semana es justo lo que una lista lee bien.
 *   · No se arrastra. En un teléfono el mismo gesto es desplazarse, y una
 *     cita movida por accidente es un paciente con la hora equivocada.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Alto de la fila de encabezados. Se descuenta para calcular el zoom
 *  "todo el día": si no, la última hora quedaría siempre cortada. */
const EDU_AG_CABECERA_PX = 46;
/** Aire por debajo de la rejilla para que no muerda el borde de abajo. */
const EDU_AG_AIRE_PX = 20;

export interface EduAgendaScreenProps {
  rows: EduAppointmentRow[];
  days: string[];
  truncated: boolean;
  maxRows: number;
  query: EduAgendaQuery;
  chairs: EduAgendaChair[];
  students: EduStudentOption[];
  supervisors: EduSupervisorOption[];
  programs: { id: string; name: string }[];
  patients: { id: string; folio: string; name: string }[];
  canManage: boolean;
  todayISO: string;
  /** La zona del INSTITUTO (o de la sede). Solo se usa para el choque. */
  timezone: string;
  sede: {
    options: EduCampusOption[];
    activeId: string | null;
    allLabel: string;
    showPicker: boolean;
  };
}

export function EduAgendaScreen({
  rows,
  days,
  truncated,
  maxRows,
  query,
  chairs,
  students,
  supervisors,
  programs,
  patients,
  canManage,
  todayISO,
  timezone,
  sede,
}: EduAgendaScreenProps) {
  const router = useRouter();
  const [navegando, startNav] = useTransition();
  const [alta, setAlta] = useState<{ chairId: string; startLabel: string } | null>(null);
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [detalle, setDetalle] = useState<EduAppointmentRow | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState(query.q ?? "");

  const esLista = query.mode === "lista";

  // ── Navegación: TODO viaja en la URL ────────────────────────────────
  const ir = useCallback(
    (next: Partial<Record<EduAgendaUrlKey, string>>) => {
      startNav(() => router.replace(eduAgendaHref(query, next), { scroll: false }));
    },
    [query, router],
  );

  const recargar = useCallback(
    (mensaje: string) => {
      setFlash(mensaje);
      startNav(() => router.refresh());
    },
    [router],
  );

  // El buscador escribe en la URL con un respiro, no en cada tecla: cada
  // navegación es una consulta a la base.
  useEffect(() => {
    setBusqueda(query.q ?? "");
  }, [query.q]);

  useEffect(() => {
    const actual = query.q ?? "";
    const limpio = busqueda.trim().replace(/\s+/g, " ");
    if (limpio === actual) return;
    const t = setTimeout(() => ir({ q: limpio }), 450);
    return () => clearTimeout(t);
  }, [busqueda, query.q, ir]);

  // ── Medidas: el ancho decide cuántas columnas, el alto el zoom ───────
  const cajaRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [ancho, setAncho] = useState<number | null>(null);
  const [alto, setAlto] = useState(520);

  useLayoutEffect(() => {
    const caja = cajaRef.current;
    if (!caja) return;
    const anotar = (w: number) => {
      if (w > 0) setAncho((prev) => (prev !== null && Math.abs(prev - w) < 2 ? prev : w));
    };
    // 🔴 UNA MEDIDA DIRECTA, ANTES DEL OBSERVADOR. Un ResizeObserver no
    // entrega su primera llamada hasta el siguiente paso de renderizado, y
    // una pestaña que el navegador no está pintando (en segundo plano, o
    // dentro de un iframe oculto) no da ninguno: sin esta línea, el ancho
    // se quedaba en `null`, `angosto` en false, y un teléfono pintaba las
    // 32 columnas. Con ella, el observador solo se ocupa de los cambios.
    anotar(caja.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => anotar(entries[0]?.contentRect.width ?? 0));
    ro.observe(caja);
    return () => ro.disconnect();
  }, []);

  const medirAlto = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Se mide desde dónde EMPIEZA la rejilla hasta el borde de abajo de la
    // ventana. El resultado no depende del alto propio del elemento, así
    // que no puede realimentarse.
    const arriba = el.getBoundingClientRect().top;
    const disponible = window.innerHeight - arriba - EDU_AG_AIRE_PX;
    const acotado = Math.max(300, Math.min(1100, Math.round(disponible)));
    setAlto((prev) => (Math.abs(prev - acotado) < 5 ? prev : acotado));
  }, []);

  const angosto = ancho !== null && ancho < EDU_AGENDA_NARROW_PX;
  // La semana en un teléfono se lee como lista, no como siete columnas de
  // 50 px. La decisión la toma la pantalla y la DICE (aviso abajo).
  const listaForzada = angosto && query.view === "semana" && !esLista;
  const pintaLista = esLista || listaForzada;

  // Los seis filtros ocupan tres renglones en un teléfono: 110 px de los
  // 800 que tiene la pantalla, antes de que se vea una sola cita. Ahí van
  // plegados y se abren de un toque; en cuanto hay ancho, abiertos.
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(true);
  useEffect(() => {
    setFiltrosAbiertos(!angosto);
  }, [angosto]);

  // Se vuelve a medir cada vez que cambia algo POR ENCIMA de la rejilla: el
  // ancho, la vista, y el desplegable de filtros —que al plegarse le
  // devuelve 110 px de alto y sin esto la rejilla no se enteraba—.
  useLayoutEffect(() => {
    medirAlto();
    window.addEventListener("resize", medirAlto);
    return () => window.removeEventListener("resize", medirAlto);
  }, [medirAlto, esLista, query.view, ancho, filtrosAbiertos]);

  // ── Zoom ────────────────────────────────────────────────────────────
  const [densidad, setDensidad] = useState<EduAgendaDensity>("fit");
  useEffect(() => {
    try {
      const guardada = parseEduAgendaDensity(window.localStorage.getItem(EDU_AGENDA_DENSITY_KEY));
      if (guardada) setDensidad(guardada);
    } catch {
      // Un navegador con el almacenamiento bloqueado se queda con "todo el
      // día", que es el default. No es motivo para romper la agenda.
    }
  }, []);
  const cambiarDensidad = useCallback((d: EduAgendaDensity) => {
    setDensidad(d);
    try {
      window.localStorage.setItem(EDU_AGENDA_DENSITY_KEY, d);
    } catch {
      /* ídem */
    }
  }, []);

  // ── El reparto en columnas ──────────────────────────────────────────
  const layout = useMemo(
    () =>
      eduAgendaLayout({
        rows,
        chairs,
        query,
        days,
        todayISO,
        timezone,
        soloUno: angosto && query.view === "dia",
      }),
    [rows, chairs, query, days, todayISO, timezone, angosto],
  );

  const slots = eduAgendaSlots(layout.window);
  const slotHpx = slotHeightFor(densidad, Math.max(120, alto - EDU_AG_CABECERA_PX), slots);

  // ── Arrastrar ───────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [arrastre, setArrastre] = useState<EduAgendaDragState>({
    overKey: null,
    mode: null,
    id: null,
    label: null,
  });
  const SIN_ARRASTRE: EduAgendaDragState = { overKey: null, mode: null, id: null, label: null };
  const [pendiente, setPendiente] = useState<{
    row: EduAppointmentRow;
    drop: EduAgendaDrop;
    destino: string;
    advertencia: string | null;
  } | null>(null);

  const resolverArrastre = useCallback(
    (event: DragMoveEvent | DragEndEvent) => {
      const { active, over, delta } = event;
      if (!over) return null;
      const id = (active.data.current as { appointmentId?: string } | undefined)?.appointmentId;
      const target = over.data.current as
        | { kind?: string; chairId?: string | null; dayISO?: string | null }
        | undefined;
      if (!id || target?.kind !== "edu-columna") return null;
      const row = rows.find((r) => r.id === id);
      if (!row) return null;
      const drop = eduAgendaDrop({
        row,
        deltaY: delta.y,
        slotHpx,
        window: layout.window,
        target: { chairId: target.chairId ?? null, dayISO: target.dayISO ?? null },
      });
      if (!drop) return null;
      const columna = layout.columns.find((c) => c.key === String(over.id).replace("edu-ag-col:", ""));
      return { row, drop, columna: columna ?? null };
    },
    [rows, slotHpx, layout],
  );

  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      const r = resolverArrastre(event);
      if (!r) {
        setArrastre(SIN_ARRASTRE);
        return;
      }
      const choca = eduAgendaConflicto({ rows, row: r.row, drop: r.drop, timezone });
      setArrastre({
        overKey: r.columna?.key ?? null,
        mode: choca ? "conflict" : "ok",
        id: r.row.id,
        // 🔴 El rótulo que sigue a la tarjeta sale de ESTE `drop`, el mismo
        // que se ejecuta al soltar. Ver EduAgendaDragState.label.
        label: r.drop.startLabel,
      });
    },
    [resolverArrastre, rows, timezone],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setArrastre(SIN_ARRASTRE);
      const r = resolverArrastre(event);
      if (!r || !r.drop.changed) return;
      const choca = eduAgendaConflicto({ rows, row: r.row, drop: r.drop, timezone });
      setFlash(null);
      setPendiente({
        row: r.row,
        drop: r.drop,
        destino: r.columna?.kind === "day" ? r.row.chairName : (r.columna?.title ?? r.row.chairName),
        advertencia: choca
          ? "En ese hueco ya hay una cita del mismo sillón o del mismo estudiante. Si insistes, el servidor la va a rechazar."
          : null,
      });
    },
    [resolverArrastre, rows, timezone],
  );

  // ── Listas de los filtros ───────────────────────────────────────────
  // Se arman con el padrón MÁS quien aparece en las filas que ya están en
  // pantalla. Así el filtro cubre todo lo que se ve —incluido el
  // estudiante dado de baja que todavía tiene citas— sin traer al navegador
  // ni una fila que el servidor no hubiera mandado ya (P1-4 de la
  // auditoría: la lista de estudiantes no viaja a quien no la usa).
  const opcionesAlumno = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of students) m.set(s.id, `${s.matricula} · ${s.name}`);
    for (const r of rows) if (!m.has(r.studentId)) m.set(r.studentId, `${r.studentMatricula} · ${r.studentName}`);
    if (query.studentId && !m.has(query.studentId)) m.set(query.studentId, "Estudiante seleccionado");
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [students, rows, query.studentId]);

  const opcionesDocente = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of supervisors) m.set(s.id, s.isActive ? s.name : `${s.name} (baja)`);
    for (const r of rows) {
      if (r.supervisorUserId && !m.has(r.supervisorUserId)) {
        m.set(r.supervisorUserId, r.supervisorName ?? "Docente");
      }
    }
    if (query.supervisorUserId && !m.has(query.supervisorUserId)) {
      m.set(query.supervisorUserId, "Docente seleccionado");
    }
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [supervisors, rows, query.supervisorUserId]);

  const leyenda = useMemo(() => eduAgendaLegend(programs, rows), [programs, rows]);
  const chairOptions: EduChairOption[] = useMemo(
    () =>
      chairs.map((c) => ({
        id: c.id,
        name: c.name,
        number: c.number,
        isActive: c.isActive,
        campusId: c.campusId,
        campusName: c.campusName,
      })),
    [chairs],
  );

  const hayFiltros = eduHasAgendaFilters(query);
  const sillonesVisibles = chairs.filter(
    (c) => c.isActive || rows.some((r) => r.chairId === c.id),
  );
  const sillonPintado = angosto && query.view === "dia" ? layout.columns[0] : null;

  function abrirDetalle(row: EduAppointmentRow) {
    setFlash(null);
    setDetalle(row);
  }

  function abrirHueco(column: EduAgendaColumn, startLabel: string) {
    if (!column.chairId) return;
    setFlash(null);
    setAlta({ chairId: column.chairId, startLabel });
    setAltaAbierta(true);
  }

  return (
    <>
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}

      <div className="edu-ag" ref={cajaRef}>
        {/* ── Barra: el día, la vista y el zoom ── */}
        <div className="edu-ag__barra">
          <div className="edu-ag__nav">
            <button
              type="button"
              className="edu-iconbtn"
              aria-label={query.view === "semana" ? "Semana anterior" : "Día anterior"}
              onClick={() => ir({ dia: eduShiftDayISO(query.dayISO, query.view === "semana" ? -7 : -1) })}
            >
              <ChevronLeft size={18} />
            </button>
            <span className="edu-ag__fecha">
              {query.view === "semana"
                ? `${eduFormatDayShort(days[0])} – ${eduFormatDayShort(days[days.length - 1])}`
                : eduFormatDayLong(query.dayISO)}
            </span>
            <button
              type="button"
              className="edu-iconbtn"
              aria-label={query.view === "semana" ? "Semana siguiente" : "Día siguiente"}
              onClick={() => ir({ dia: eduShiftDayISO(query.dayISO, query.view === "semana" ? 7 : 1) })}
            >
              <ChevronRight size={18} />
            </button>
            {query.dayISO !== todayISO && (
              <button
                type="button"
                className="edu-btn edu-btn--ghost edu-btn--sm"
                onClick={() => ir({ dia: todayISO })}
              >
                Hoy
              </button>
            )}
          </div>

          <div className="edu-ag__modos">
            <div className="edu-seg" role="group" aria-label="Qué rango se ve">
              <button
                type="button"
                className={`edu-seg__btn ${query.view === "dia" ? "edu-seg__btn--on" : ""}`}
                aria-pressed={query.view === "dia"}
                onClick={() => ir({ vista: "dia" })}
              >
                Día
              </button>
              <button
                type="button"
                className={`edu-seg__btn ${query.view === "semana" ? "edu-seg__btn--on" : ""}`}
                aria-pressed={query.view === "semana"}
                onClick={() => ir({ vista: "semana" })}
              >
                Semana
              </button>
            </div>

            <div className="edu-seg" role="group" aria-label="Cómo se pinta">
              <button
                type="button"
                className={`edu-seg__btn ${!esLista ? "edu-seg__btn--on" : ""}`}
                aria-pressed={!esLista}
                onClick={() => ir({ modo: "rejilla" })}
              >
                Rejilla
              </button>
              <button
                type="button"
                className={`edu-seg__btn ${esLista ? "edu-seg__btn--on" : ""}`}
                aria-pressed={esLista}
                onClick={() => ir({ modo: "lista" })}
              >
                Lista
              </button>
            </div>

            {!pintaLista && (
              <div className="edu-seg" role="group" aria-label="Zoom">
                {EDU_AGENDA_DENSITIES.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`edu-seg__btn ${densidad === d ? "edu-seg__btn--on" : ""}`}
                    aria-pressed={densidad === d}
                    title={EDU_AGENDA_DENSITY_HINTS[d]}
                    onClick={() => cambiarDensidad(d)}
                  >
                    {EDU_AGENDA_DENSITY_LABELS[d]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Una sola fila: la leyenda (que ES el filtro), el contador del
             periodo y el alta. Van juntos porque hablan de lo mismo — al
             encender un chip, el contador de al lado cambia — y porque cada
             fila de barra que se ahorra es alto que se lleva la rejilla. ── */}
        <div className="edu-ag__pie">
          <div className="edu-ag__leyenda" role="group" aria-label="Especialidades. Toca una para filtrar.">
            {leyenda.length > 1 &&
              leyenda.map((p) => {
                const activa = query.programId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`edu-ag__chip ${activa ? "edu-ag__chip--on" : ""} ${p.count === 0 ? "edu-ag__chip--vacio" : ""}`}
                    style={{ "--edu-ag-color": p.color, "--edu-ag-tinta": p.ink } as React.CSSProperties}
                    aria-pressed={activa}
                    onClick={() => ir({ programa: activa ? "" : p.id })}
                  >
                    <span className="edu-ag__chip-punto" aria-hidden="true" />
                    {p.name}
                    <span className="edu-ag__chip-n">{p.count}</span>
                  </button>
                );
              })}
          </div>

          {/* El contador y el alta viajan JUNTOS: si se envuelven por
              separado, el botón se queda solo en un renglón para él. */}
          <span className="edu-ag__pieaccion">
            <span className="edu-count">
              {navegando
                ? "Cargando…"
                : `${rows.length} ${rows.length === 1 ? "cita" : "citas"} ${
                    query.view === "semana" ? "esta semana" : "este día"
                  }${truncated ? ` (se muestran las primeras ${maxRows})` : ""}`}
            </span>
            {canManage && (
              <button
                type="button"
                className="edu-btn edu-btn--primary edu-btn--sm"
                onClick={() => {
                  setFlash(null);
                  setAlta(null);
                  setAltaAbierta(true);
                }}
              >
                <CalendarPlus size={16} />
                Nueva cita
              </button>
            )}
          </span>
        </div>

        {/* ── Filtros ── */}
        <details
          className="edu-ag__filtrocaja"
          open={filtrosAbiertos}
          onToggle={(e) => setFiltrosAbiertos(e.currentTarget.open)}
        >
          <summary className="edu-ag__filtrosum">
            <ListFilter size={15} aria-hidden="true" />
            Filtros
            {hayFiltros ? <span className="edu-ag__filtroson">activos</span> : null}
          </summary>
          <div className="edu-ag__filtros">
          {sede.showPicker && (
            <div className="edu-field">
              <span className="edu-field__label">Sede</span>
              <EduSedeSelector
                options={sede.options}
                activeId={sede.activeId}
                allLabel={sede.allLabel}
                slot="agenda"
              />
            </div>
          )}

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-ag-sillon">
              Sillón
            </label>
            <select
              id="edu-ag-sillon"
              className="edu-input edu-input--sm"
              value={query.chairId ?? ""}
              onChange={(e) => ir({ sillon: e.target.value })}
            >
              <option value="">Todos</option>
              {chairs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {layout.variasSedes ? ` · ${c.campusName}` : ""}
                  {c.isActive ? "" : " (baja)"}
                </option>
              ))}
            </select>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-ag-alumno">
              Estudiante
            </label>
            <select
              id="edu-ag-alumno"
              className="edu-input edu-input--sm"
              value={query.studentId ?? ""}
              onChange={(e) => ir({ alumno: e.target.value })}
            >
              <option value="">Todos</option>
              {opcionesAlumno.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-ag-docente">
              Docente
            </label>
            <select
              id="edu-ag-docente"
              className="edu-input edu-input--sm"
              value={query.supervisorUserId ?? ""}
              onChange={(e) => ir({ docente: e.target.value })}
            >
              <option value="">Todos</option>
              {opcionesDocente.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-ag-tipo">
              Tipo
            </label>
            <select
              id="edu-ag-tipo"
              className="edu-input edu-input--sm"
              value={query.type ?? ""}
              onChange={(e) => ir({ tipo: e.target.value })}
            >
              <option value="">Todos</option>
              {EDU_APPOINTMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EDU_APPOINTMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-ag-estado">
              Estado
            </label>
            <select
              id="edu-ag-estado"
              className="edu-input edu-input--sm"
              value={query.status ?? ""}
              onChange={(e) => ir({ estado: e.target.value })}
            >
              <option value="">Todos</option>
              {EDU_APPOINTMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {EDU_APPOINTMENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="edu-field edu-ag__buscador">
            <label className="edu-field__label" htmlFor="edu-ag-q">
              Paciente
            </label>
            <span className="edu-ag__buscabox">
              <Search size={15} aria-hidden="true" />
              <input
                id="edu-ag-q"
                className="edu-input edu-input--sm"
                type="search"
                placeholder="Nombre o folio"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </span>
          </div>

          {hayFiltros && (
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              onClick={() =>
                ir({
                  sillon: "",
                  programa: "",
                  alumno: "",
                  docente: "",
                  tipo: "",
                  estado: "",
                  q: "",
                })
              }
            >
              <X size={15} />
              Limpiar
            </button>
          )}
          </div>
        </details>

        {/* ── Avisos de lo que la pantalla decidió por su cuenta ── */}
        {listaForzada && (
          <p className="edu-ag__aviso">
            <ListFilter size={14} aria-hidden="true" />
            {/* El texto va DENTRO de un span: el aviso es un contenedor flex
                y sin esto cada trozo suelto (y el <strong>) se vuelve un
                elemento flexible por su cuenta, con lo que la frase sale
                repartida por el renglón en vez de leerse seguida. */}
            <span>
              La semana se está enseñando como lista: siete columnas no se leen en una
              pantalla de este ancho. Cambia a <strong>Día</strong> para ver la rejilla.
            </span>
          </p>
        )}

        {!pintaLista && sillonPintado && (
          <div className="edu-ag__unosillon">
            <button
              type="button"
              className="edu-iconbtn"
              aria-label="Sillón anterior"
              disabled={sillonesVisibles.findIndex((c) => c.id === sillonPintado.chairId) <= 0}
              onClick={() => {
                const i = sillonesVisibles.findIndex((c) => c.id === sillonPintado.chairId);
                if (i > 0) ir({ sillon: sillonesVisibles[i - 1].id });
              }}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="edu-ag__unosillon-txt">
              {sillonPintado.title}
              <small>
                {sillonesVisibles.length > 1
                  ? `${Math.max(1, sillonesVisibles.findIndex((c) => c.id === sillonPintado.chairId) + 1)} de ${sillonesVisibles.length} sillones`
                  : "el único sillón"}
              </small>
            </span>
            <button
              type="button"
              className="edu-iconbtn"
              aria-label="Sillón siguiente"
              disabled={
                sillonesVisibles.findIndex((c) => c.id === sillonPintado.chairId) >=
                sillonesVisibles.length - 1
              }
              onClick={() => {
                const i = sillonesVisibles.findIndex((c) => c.id === sillonPintado.chairId);
                if (i >= 0 && i < sillonesVisibles.length - 1) ir({ sillon: sillonesVisibles[i + 1].id });
              }}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* ── El contenido ── */}
        {layout.columns.length === 0 && !pintaLista ? (
          <div className="edu-empty">
            <p className="edu-empty__title">Todavía no hay sillones</p>
            <p className="edu-empty__detail">
              La agenda se organiza por unidad dental. Da de alta los sillones que tenga la
              clínica en <strong>Sillones</strong> y aquí aparecerán sus columnas.
            </p>
          </div>
        ) : pintaLista ? (
          <EduAgendaLista
            rows={rows}
            variasSedes={layout.variasSedes}
            todayISO={todayISO}
            onOpen={abrirDetalle}
          />
        ) : (
          <EduAgendaDragProvider value={arrastre}>
            <DndContext
              sensors={sensors}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
              onDragCancel={() => setArrastre(SIN_ARRASTRE)}
            >
              <EduAgendaRejilla
                layout={layout}
                vista={query.view}
                canManage={canManage && !angosto}
                slotHpx={slotHpx}
                alto={alto}
                scrollRef={(el) => {
                  scrollRef.current = el;
                }}
                onOpen={abrirDetalle}
                onHueco={abrirHueco}
              />
            </DndContext>
          </EduAgendaDragProvider>
        )}

        {/* El contador de arriba cuenta TODO el periodo; si la rejilla no
            está pintando todas las columnas, la diferencia hay que decirla
            —o parece que se perdieron citas—. Y el porqué es distinto según
            quién dejó fuera las columnas: el filtro, o el ancho. */}
        {!pintaLista && layout.hiddenRows > 0 && (
          <p className="edu-ag__aviso">
            <ListFilter size={14} aria-hidden="true" />
            <span>
              {sillonPintado
                ? `Aquí solo cabe un sillón: las otras ${layout.hiddenRows} ${
                    layout.hiddenRows === 1 ? "cita es" : "citas son"
                  } de los demás. Cámbialo arriba o pásate a Lista para verlas todas.`
                : `Hay ${layout.hiddenRows} ${
                    layout.hiddenRows === 1 ? "cita" : "citas"
                  } fuera del sillón que estás filtrando. Quita el filtro o pásate a Lista.`}
            </span>
          </p>
        )}
      </div>

      {/* 🔴 Los diálogos van FUERA de `.edu-ag`: ese envoltorio lleva
          `container-type` y un contenedor de consulta atrapa dentro de su
          caja a los descendientes `position: fixed`. */}
      {altaAbierta && (
        <EduAgendaAlta
          chairs={chairOptions}
          students={students}
          supervisors={supervisors}
          patients={patients}
          dayISO={query.dayISO}
          slot={alta}
          onClose={() => {
            setAltaAbierta(false);
            setAlta(null);
          }}
          onDone={() => {
            setAltaAbierta(false);
            setAlta(null);
            recargar("La cita quedó agendada.");
          }}
        />
      )}

      {detalle && (
        <EduAgendaDetalle
          row={detalle}
          chairs={chairOptions}
          students={students}
          supervisors={supervisors}
          canManage={canManage}
          onClose={() => setDetalle(null)}
          onDone={(mensaje) => {
            setDetalle(null);
            recargar(mensaje);
          }}
        />
      )}

      {pendiente && (
        <EduAgendaConfirmarArrastre
          row={pendiente.row}
          drop={pendiente.drop}
          destino={pendiente.destino}
          advertencia={pendiente.advertencia}
          onCancel={() => setPendiente(null)}
          onDone={(mensaje) => {
            setPendiente(null);
            recargar(mensaje);
          }}
        />
      )}
    </>
  );
}
