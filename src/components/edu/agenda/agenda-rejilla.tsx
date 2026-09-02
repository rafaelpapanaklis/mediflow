"use client";

import { createContext, useContext, useMemo, useRef } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  CARD_TWO_ROW_MIN_PX,
  EDU_AGENDA_SLOT_MINUTES,
  EDU_AGENDA_STATUS_TONE,
  eduAgendaLanes,
  eduAgendaRowIsClosed,
  eduAgendaSlots,
  eduProgramColor,
  eduRowPlacement,
  showHalfHourLabels,
  type EduAgendaColumn,
  type EduAgendaLayout,
} from "@/lib/edu/agenda-rejilla";
import { eduMinutesToLabel, type EduAppointmentRow } from "@/lib/edu/agenda-core";
import {
  EDU_APPOINTMENT_STATUS_LABELS,
  EDU_APPOINTMENT_TYPE_LABELS,
} from "@/lib/edu/types";

/**
 * LA REJILLA: eje de horas a la izquierda, una columna por sillón (o por
 * día en la vista de semana) y las citas colocadas a su hora.
 *
 * ── LO QUE HACE QUE ESTO SE LEA ────────────────────────────────────────
 * · UN SOLO contenedor con desplazamiento. La primera columna (las horas)
 *   se queda pegada con `position: sticky; left: 0` y la fila de
 *   encabezados con `top: 0`. Con dos contenedores anidados —uno para el
 *   alto y otro para el ancho— el `sticky` del eje se resuelve contra el
 *   contenedor de dentro, que nunca se desplaza en horizontal, y el eje se
 *   va con las columnas. Con 32 sillones eso es la diferencia entre una
 *   agenda y una hoja de cálculo sin cabecera.
 * · Y ese contenedor tiene ALTURA ACOTADA (`--edu-ag-alto`, que la
 *   pantalla mide). Un `sticky top` dentro de una caja que crece sin
 *   límite no se pega nunca: no hay contra qué.
 *
 * 🔴 AQUÍ NO SE FORMATEA NINGUNA HORA CON ZONAS. Las etiquetas de las
 * tarjetas vienen del servidor y las del eje salen de un entero.
 */

// ── El estado del arrastre, para pintar el hueco de destino ────────────
export type EduAgendaDropMode = "ok" | "conflict";

export interface EduAgendaDragState {
  /** La columna sobre la que está el dedo. */
  overKey: string | null;
  mode: EduAgendaDropMode | null;
  /** La cita que se está arrastrando. */
  id: string | null;
  /**
   * 🔴 LA HORA QUE VA A QUEDAR, calculada por el MISMO `eduAgendaDrop` que
   * ejecuta el soltar. La tarjeta la pinta tal cual en vez de volver a
   * calcularla con su `transform`, y no es una simplificación: cuando el
   * arrastre llega al borde, dnd-kit DESPLAZA la rejilla sola, y ese
   * desplazamiento entra en el `delta` del soltar pero NO en el `transform`
   * de la tarjeta. Con dos cuentas, el rótulo decía 11:30 y la cita se
   * guardaba a las 13:15 — el peor fallo posible en una agenda: el que
   * promete una cosa y hace otra.
   */
  label: string | null;
}

const DragCtx = createContext<EduAgendaDragState>({
  overKey: null,
  mode: null,
  id: null,
  label: null,
});

export const EduAgendaDragProvider = DragCtx.Provider;

// ═══════════════════════════════════════════════════════════════════════
// El eje de horas
// ═══════════════════════════════════════════════════════════════════════

function EjeHoras({
  window,
  slotHpx,
}: {
  window: { dayStart: number; dayEnd: number };
  slotHpx: number;
}) {
  const slotsPorHora = 60 / EDU_AGENDA_SLOT_MINUTES;
  const horas: number[] = [];
  for (let h = window.dayStart; h <= window.dayEnd; h++) horas.push(h);
  // Las medias horas solo cuando les queda aire de verdad (≥28 px entre
  // rótulos). Con la jornada ajustada a pantalla se apilarían.
  const conMedias = showHalfHourLabels(EDU_AGENDA_SLOT_MINUTES, slotHpx);

  return (
    <div className="edu-ag__eje" aria-hidden="true">
      {horas.map((h, i) => {
        // 🔴 LAS DOS PUNTAS NO SE CENTRAN EN SU LÍNEA. Un rótulo centrado
        // sobresale media línea por arriba y media por abajo: en el primero
        // esa mitad cae DEBAJO de la fila de encabezados (sticky y opaca) y
        // del "08:00" se veía media raya; en el último cae por fuera del
        // contenedor, que además la contaba como contenido y dejaba dos
        // píxeles de desplazamiento en el preset que promete que no hay.
        // El primero se apoya en su línea y el último se ancla al fondo con
        // `bottom` —no con `top` + transform— para no desbordar ni un píxel.
        const primera = i === 0;
        const ultima = i === horas.length - 1;
        return (
          <span
            key={h}
            className={[
              "edu-ag__hora",
              primera ? "edu-ag__hora--primera" : "",
              ultima ? "edu-ag__hora--ultima" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={
              ultima
                ? { bottom: 0 }
                : { top: `calc(${(h - window.dayStart) * slotsPorHora} * var(--edu-ag-slot-h))` }
            }
          >
            {eduMinutesToLabel(h * 60)}
          </span>
        );
      })}
      {conMedias &&
        horas.slice(0, -1).map((h) => (
          <span
            key={`${h}-media`}
            className="edu-ag__media"
            style={{
              top: `calc(${(h - window.dayStart) * slotsPorHora + slotsPorHora / 2} * var(--edu-ag-slot-h))`,
            }}
          >
            {eduMinutesToLabel(h * 60 + 30)}
          </span>
        ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Una tarjeta
// ═══════════════════════════════════════════════════════════════════════

function Tarjeta({
  row,
  lane,
  laneCount,
  window,
  slotHpx,
  vista,
  variasSedes,
  draggable,
  onOpen,
}: {
  row: EduAppointmentRow;
  lane: number;
  laneCount: number;
  window: { dayStart: number; dayEnd: number };
  slotHpx: number;
  vista: "dia" | "semana";
  variasSedes: boolean;
  draggable: boolean;
  onOpen: (row: EduAppointmentRow) => void;
}) {
  const color = useMemo(
    () => eduProgramColor(row.studentProgramId, row.studentProgramName),
    [row.studentProgramId, row.studentProgramName],
  );
  const sitio = eduRowPlacement(row, window);
  const drag = useContext(DragCtx);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `edu-ag-cita:${row.id}`,
    data: { kind: "edu-cita", appointmentId: row.id },
    disabled: !draggable,
  });

  // La hora que va a quedar la calcula la pantalla con `eduAgendaDrop` —el
  // mismo que ejecuta el soltar— y llega por contexto. Ver la nota de
  // `EduAgendaDragState.label`.
  const preview = isDragging && drag.id === row.id ? drag.label : null;

  const altoPx = sitio.spanSlots * slotHpx;
  const dosRenglones = altoPx >= CARD_TWO_ROW_MIN_PX;
  const cerrada = eduAgendaRowIsClosed(row.status);

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={[
        "edu-ag__cita",
        `edu-ag__cita--${EDU_AGENDA_STATUS_TONE[row.status]}`,
        // Tamizaje y control se siguen distinguiendo: el tamizaje es lo que
        // ABRE el caso y el control es una revisión sin tratamiento nuevo.
        row.type === "TAMIZAJE" ? "edu-ag__cita--tamizaje" : "",
        row.type === "CONTROL" ? "edu-ag__cita--control" : "",
        isDragging ? "edu-ag__cita--arrastrando" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        {
          "--edu-ag-color": color.color,
          "--edu-ag-tinta": color.ink,
          "--edu-ag-carril": lane,
          "--edu-ag-carriles": laneCount,
          top: `calc(${sitio.topSlots} * var(--edu-ag-slot-h))`,
          height: `calc(${sitio.spanSlots} * var(--edu-ag-slot-h) - 2px)`,
          transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        } as React.CSSProperties
      }
      onClick={() => {
        if (isDragging) return;
        onOpen(row);
      }}
      title={`${row.startLabel}–${row.endLabel} · ${row.patientName} · ${row.studentMatricula} · ${row.studentProgramName} · ${row.chairName} · ${EDU_APPOINTMENT_STATUS_LABELS[row.status]}`}
      {...listeners}
      {...attributes}
    >
      <span className="edu-ag__cita-fila">
        <span className="edu-ag__cita-hora">{preview ?? row.startLabel}</span>
        <span className="edu-ag__cita-nombre">{row.patientName}</span>
        <span
          className="edu-ag__cita-punto"
          aria-hidden="true"
          title={EDU_APPOINTMENT_STATUS_LABELS[row.status]}
        />
      </span>
      {dosRenglones && (
        <span className="edu-ag__cita-fila edu-ag__cita-fila--2">
          <span className="edu-ag__cita-chip" aria-hidden="true">
            {color.initials}
          </span>
          <span className="edu-ag__cita-meta">
            {row.studentMatricula} · {row.studentProgramName}
            {vista === "semana" ? ` · ${row.chairName}` : ""}
            {vista === "semana" && variasSedes ? ` · ${row.chairCampusName}` : ""}
          </span>
        </span>
      )}
      <span className="edu-sr-only">
        {EDU_APPOINTMENT_TYPE_LABELS[row.type]} · {EDU_APPOINTMENT_STATUS_LABELS[row.status]}
        {cerrada ? " · cerrada, no se mueve" : ""}
        {sitio.clipped ? " · termina después de la medianoche" : ""}
      </span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Una columna
// ═══════════════════════════════════════════════════════════════════════

function Columna({
  column,
  layout,
  vista,
  canManage,
  slotHpx,
  onOpen,
  onHueco,
}: {
  column: EduAgendaColumn;
  layout: EduAgendaLayout;
  vista: "dia" | "semana";
  canManage: boolean;
  slotHpx: number;
  onOpen: (row: EduAppointmentRow) => void;
  onHueco: (column: EduAgendaColumn, startLabel: string) => void;
}) {
  const drag = useContext(DragCtx);
  const ref = useRef<HTMLDivElement | null>(null);
  const carriles = useMemo(() => eduAgendaLanes(column.rows), [column.rows]);
  const slots = eduAgendaSlots(layout.window);

  const { setNodeRef, isOver } = useDroppable({
    id: `edu-ag-col:${column.key}`,
    data: { kind: "edu-columna", chairId: column.chairId, dayISO: column.dayISO },
    // Un sillón que ya no existe ("Otros sillones") no puede recibir citas:
    // no hay a qué sillón mandarlas.
    disabled: column.chairId === null && column.kind === "chair",
  });

  const bandas: number[] = [];
  for (let h = 1; h < layout.window.dayEnd - layout.window.dayStart; h++) bandas.push(h);

  const resalte =
    isOver && drag.overKey === column.key
      ? drag.mode === "conflict"
        ? "edu-ag__col--choca"
        : "edu-ag__col--cabe"
      : "";

  return (
    <div
      ref={(el) => {
        ref.current = el;
        setNodeRef(el);
      }}
      className={`edu-ag__col ${resalte}`}
      style={{ height: `calc(${slots} * var(--edu-ag-slot-h))` }}
      onClick={(e) => {
        // Tocar un hueco vacío propone agendar ahí. Sobre una tarjeta no:
        // eso abre la cita.
        if (!canManage || column.chairId === null) return;
        if ((e.target as HTMLElement).closest(".edu-ag__cita")) return;
        const caja = ref.current?.getBoundingClientRect();
        if (!caja || caja.height <= 0) return;
        const renglon = Math.floor(((e.clientY - caja.top) / caja.height) * slots);
        const minuto =
          layout.window.dayStart * 60 +
          Math.max(0, Math.min(slots - 1, renglon)) * EDU_AGENDA_SLOT_MINUTES;
        onHueco(column, eduMinutesToLabel(minuto));
      }}
    >
      {bandas.map((h) => (
        <div
          key={h}
          className="edu-ag__banda"
          aria-hidden="true"
          style={{ top: `calc(${(h * 60) / EDU_AGENDA_SLOT_MINUTES} * var(--edu-ag-slot-h))` }}
        />
      ))}
      {column.rows.map((row) => {
        const carril = carriles.get(row.id) ?? { lane: 0, laneCount: 1 };
        return (
          <Tarjeta
            key={row.id}
            row={row}
            lane={carril.lane}
            laneCount={carril.laneCount}
            window={layout.window}
            slotHpx={slotHpx}
            vista={vista}
            variasSedes={layout.variasSedes}
            // Una cita cerrada no se arrastra: el servidor la rebota con un
            // 409 y arrastrarla solo enseñaría un error evitable.
            draggable={canManage && !eduAgendaRowIsClosed(row.status)}
            onOpen={onOpen}
          />
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// La rejilla entera
// ═══════════════════════════════════════════════════════════════════════

export function EduAgendaRejilla({
  layout,
  vista,
  canManage,
  slotHpx,
  alto,
  scrollRef,
  onOpen,
  onHueco,
}: {
  layout: EduAgendaLayout;
  vista: "dia" | "semana";
  canManage: boolean;
  slotHpx: number;
  /**
   * Alto acotado del contenedor. Sin él, el encabezado sticky no pega.
   *
   * `null` = todavía no se ha medido (el render del servidor, o el primer
   * cuadro). Entonces NO se escribe la variable y manda el respaldo del
   * CSS, que se calcula contra el alto de la ventana: un número fijo aquí
   * sería un respaldo que falla callado.
   */
  alto: number | null;
  scrollRef: (el: HTMLDivElement | null) => void;
  onOpen: (row: EduAppointmentRow) => void;
  onHueco: (column: EduAgendaColumn, startLabel: string) => void;
}) {
  const slots = eduAgendaSlots(layout.window);

  return (
    <div
      ref={scrollRef}
      className="edu-ag__scroll"
      style={
        {
          "--edu-ag-slot-h": `${slotHpx}px`,
          ...(alto === null ? null : { "--edu-ag-alto": `${alto}px` }),
        } as React.CSSProperties
      }
    >
      <div
        className="edu-ag__grid"
        aria-label={
          vista === "semana"
            ? "Rejilla de la semana. Cada tarjeta es una cita."
            : "Rejilla del día por sillón. Cada tarjeta es una cita."
        }
      >
        {/* 🔴 DOS FILAS, y no una rejilla CSS. En CSS grid el bloque
            contenedor de un hijo es su ÁREA, así que un `sticky left: 0`
            puesto en la primera columna no tiene sitio a donde correrse y
            el eje de horas se va con las columnas en cuanto hay
            desplazamiento horizontal. En una FILA flex el bloque
            contenedor es la fila entera —mide todo el ancho del
            contenido— y ahí el eje sí se queda pegado. */}
        <div className="edu-ag__fila edu-ag__fila--cab">
          <div className="edu-ag__esquina" aria-hidden="true" />
          {layout.columns.map((c) => (
            <div key={`h-${c.key}`} className="edu-ag__cabecera">
              <span className="edu-ag__cabecera-tit" title={c.title}>
                {c.title}
              </span>
              <span className="edu-ag__cabecera-sub">
                {c.sub ? `${c.sub} · ` : ""}
                {c.rows.length} {c.rows.length === 1 ? "cita" : "citas"}
              </span>
            </div>
          ))}
        </div>

        <div className="edu-ag__fila">
          <div
            className="edu-ag__ejewrap"
            style={{ height: `calc(${slots} * var(--edu-ag-slot-h))` }}
          >
            <EjeHoras window={layout.window} slotHpx={slotHpx} />
          </div>
          {layout.columns.map((c) => (
            <Columna
              key={c.key}
              column={c}
              layout={layout}
              vista={vista}
              canManage={canManage}
              slotHpx={slotHpx}
              onOpen={onOpen}
              onHueco={onHueco}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
