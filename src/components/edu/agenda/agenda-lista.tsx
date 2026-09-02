"use client";

import { useMemo } from "react";
import { eduFormatDayShort, type EduAppointmentRow } from "@/lib/edu/agenda-core";
import {
  EDU_AGENDA_STATUS_TONE,
  eduProgramColor,
  eduRowStartMinute,
} from "@/lib/edu/agenda-rejilla";
import {
  EDU_APPOINTMENT_STATUS_LABELS,
  EDU_APPOINTMENT_TYPE_LABELS,
} from "@/lib/edu/types";
import { EDU_AG_TAG_BY_STATUS } from "@/components/edu/agenda/agenda-modales";

/**
 * LA LISTA: lo mismo, en renglones.
 *
 * Existe para lo que en una rejilla no cabe o no se lee:
 *  · el teléfono, donde 32 columnas no entran de ninguna manera;
 *  · una semana entera, donde la rejilla enseña la FORMA del día pero no
 *    deja leer treinta nombres seguidos;
 *  · y quien navega con teclado o lector de pantalla, que aquí tiene el
 *    mismo contenido en orden de lectura, sin posiciones absolutas.
 *
 * Va ordenada por día y hora —no por sillón—, porque en lista la pregunta
 * es "qué sigue" y no "qué hay en el 12".
 */
export function EduAgendaLista({
  rows,
  variasSedes,
  todayISO,
  onOpen,
}: {
  rows: EduAppointmentRow[];
  variasSedes: boolean;
  todayISO: string;
  onOpen: (row: EduAppointmentRow) => void;
}) {
  const grupos = useMemo(() => {
    const porDia = new Map<string, EduAppointmentRow[]>();
    for (const r of rows) {
      const lista = porDia.get(r.dayISO) ?? [];
      lista.push(r);
      porDia.set(r.dayISO, lista);
    }
    return Array.from(porDia.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dayISO, filas]) => ({
        dayISO,
        filas: [...filas].sort(
          (a, b) => eduRowStartMinute(a) - eduRowStartMinute(b) || a.chairNumber - b.chairNumber,
        ),
      }));
  }, [rows]);

  if (grupos.length === 0) {
    return (
      <div className="edu-empty">
        <p className="edu-empty__title">No hay citas que enseñar</p>
        <p className="edu-empty__detail">
          Con los filtros que están puestos no queda ninguna. Quítalos o cambia de día.
        </p>
      </div>
    );
  }

  return (
    <div className="edu-ag__lista">
      {grupos.map((g) => (
        <section key={g.dayISO} className="edu-ag__listadia">
          <h3 className="edu-ag__listatit">
            {eduFormatDayShort(g.dayISO)}
            {g.dayISO === todayISO ? " · Hoy" : ""}
            <span className="edu-ag__listacount">
              {g.filas.length} {g.filas.length === 1 ? "cita" : "citas"}
            </span>
          </h3>
          {g.filas.map((r) => {
            const color = eduProgramColor(r.studentProgramId, r.studentProgramName);
            return (
              <button
                key={r.id}
                type="button"
                className={`edu-ag__renglon edu-ag__renglon--${EDU_AGENDA_STATUS_TONE[r.status]}`}
                style={{ "--edu-ag-color": color.color } as React.CSSProperties}
                onClick={() => onOpen(r)}
              >
                <span className="edu-ag__renglon-hora">
                  {r.startLabel}
                  <small>{r.endLabel}</small>
                </span>
                <span className="edu-ag__renglon-cuerpo">
                  <span className="edu-ag__renglon-nombre">{r.patientName}</span>
                  <span className="edu-ag__renglon-meta">
                    {r.studentMatricula} · {r.studentProgramName} · {r.chairName}
                    {variasSedes ? ` · ${r.chairCampusName}` : ""}
                  </span>
                </span>
                <span className="edu-ag__renglon-tags">
                  <span className="edu-tag edu-tag--muted">
                    {EDU_APPOINTMENT_TYPE_LABELS[r.type]}
                  </span>
                  <span className={`edu-tag ${EDU_AG_TAG_BY_STATUS[r.status]}`}>
                    {EDU_APPOINTMENT_STATUS_LABELS[r.status]}
                  </span>
                </span>
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}
