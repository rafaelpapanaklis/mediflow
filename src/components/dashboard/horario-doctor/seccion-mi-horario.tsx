"use client";

/**
 * Configuración → Horarios y bloqueos → «MI HORARIO» — el doctor pone el suyo.
 *
 * Va ENTRE el horario de la clínica (que él ve en solo lectura, «Lo define la
 * administración de la clínica») y los bloqueos. Es el mismo panel que abre la
 * administración desde Equipo → «Horario», en segunda persona.
 *
 * Una sola pieza para los dos caminos de render de `settings-client.tsx`, con
 * su propio CSS: la misma decisión que `SeccionBloqueos`.
 *
 * Solo se monta para el rol DOCTOR. Quien administra pone los horarios desde
 * Equipo, donde están todos los doctores juntos.
 */

import { useT } from "@/i18n/i18n-provider";
import { PanelHorarioDoctor } from "./panel-horario-doctor";
import type { Dia } from "./tipos";
import s from "./horario-doctor.module.css";

export function SeccionMiHorario({
  doctorId,
  nombre,
  clinica,
  ancha = false,
}: {
  /** El id de quien mira: el doctor, el suyo. Sale de la sesión. */
  doctorId: string;
  nombre: string;
  /** El horario de la clínica (0=Lunes…6=Domingo), o `null` si no tiene. */
  clinica: Dia[] | null;
  /**
   * El ancho de lo que tiene alrededor: en el camino de siempre, la tarjeta de
   * arriba es `max-w-lg` y esta la iguala; en el del rediseño, el horario de la
   * clínica y los bloqueos ocupan la columna, y esta también.
   */
  ancha?: boolean;
}) {
  const t = useT();
  return (
    <section className={`${s.seccion} ${ancha ? s.seccionAncha : ""}`} aria-labelledby="mi-horario-titulo">
      <div className={s.seccionCabecera}>
        <h2 className={s.seccionTitulo} id="mi-horario-titulo">
          {t("settings.horarioDoctor.miHorarioTitulo")}
        </h2>
        <p className={s.seccionSub}>{t("settings.horarioDoctor.miHorarioSub")}</p>
      </div>
      <PanelHorarioDoctor doctorId={doctorId} nombre={nombre} clinica={clinica} modo="propio" />
    </section>
  );
}
