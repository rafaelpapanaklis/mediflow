"use client";

import { useMemo } from "react";
import { useT } from "@/i18n/i18n-provider";
import { useAgenda } from "./agenda-provider";
import { legendDoctors } from "@/lib/agenda/doctor-legend";
import styles from "./agenda.module.css";

/**
 * La lista de doctores del filtro, con su color. ÚNICO componente: lo
 * montan tanto el desplegable de la pill "Doctores" de la toolbar como el
 * "+N" de la leyenda de la sub-toolbar.
 *
 * Que sea uno solo es el punto: los dos controles leen y escriben el MISMO
 * `state.filters.doctorIds` y enseñan la MISMA lista, así que no pueden
 * contradecirse. Si mañana la lista cambia (un doctor de baja con citas
 * hoy, por ejemplo), cambia en los dos a la vez.
 *
 * Orden = el del padrón (`legendDoctors`), no el de la tira: aquí no hay
 * que ahorrar ancho y reordenar bajo el cursor al marcar una casilla sería
 * desconcertante.
 */
export function AgendaDoctorOptions({ emptyLabel }: { emptyLabel: string }) {
  const t = useT();
  const { state, setFilters } = useAgenda();

  const doctors = useMemo(
    () =>
      legendDoctors(
        state.doctors,
        state.appointments,
        state.filters.doctorIds,
        t("agenda.pageClient.professionalFallback"),
      ),
    [state.doctors, state.appointments, state.filters.doctorIds, t],
  );

  if (doctors.length === 0) {
    return <div className={styles.filterPanelEmpty}>{emptyLabel}</div>;
  }

  const toggle = (id: string) => {
    const current = state.filters.doctorIds;
    setFilters({
      ...state.filters,
      doctorIds: current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id],
    });
  };

  return (
    <>
      {doctors.map((d) => (
        <button
          key={d.id}
          type="button"
          className={styles.filterPanelOption}
          onClick={() => toggle(d.id)}
        >
          <input type="checkbox" checked={d.selected} readOnly />
          {/* El MISMO chip de la card (.apptDocAvatar): color sólido del
              doctor + iniciales con tinta por luminancia. Reconocerlo en
              la agenda es literalmente reconocer este objeto. */}
          <span
            className={styles.apptDocAvatar}
            style={
              {
                "--mf-doc-color": d.color,
                "--mf-doc-ink": d.ink,
              } as React.CSSProperties
            }
            aria-hidden
          >
            {d.initials}
          </span>
          <span className={styles.docOptName}>{d.fullName}</span>
        </button>
      ))}
    </>
  );
}
