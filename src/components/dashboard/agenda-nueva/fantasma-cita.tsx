"use client";

/**
 * La sombra de la cita que se está arrastrando: dónde caería si se suelta
 * ahora, con la hora de destino escrita encima.
 *
 * La coloca la columna de destino con la MISMA aritmética que una tarjeta
 * (`topDeCita`/`altoDeCita`), así que la sombra cae exactamente donde quedará
 * la cita. Si ahí choca con otra cita del mismo doctor o de la misma unidad,
 * se pinta en rojo y lo dice: soltarla ahí no hará nada.
 *
 * No captura el ratón: el soltar lo recibe la columna de debajo.
 */

import type { PlannedReschedule } from "@/lib/agenda/reschedule-flow";
import { altoDeCita, minutosEnTz, topDeCita } from "@/lib/agenda-nueva/geometria";
import { formatTimeInTz } from "@/lib/agenda/date-ranges";
import { rangoDePlan } from "@/lib/agenda-nueva/interacciones";
import s from "./agenda-nueva.module.css";

export interface FantasmaCitaProps {
  plan: PlannedReschedule;
  timezone: string;
  minutoInicio: number;
  left: string;
  width: string;
  /** En Semana los carriles son estrechos: solo cabe la hora. */
  compacta?: boolean;
}

export function FantasmaCita({ plan, timezone, minutoInicio, left, width, compacta = false }: FantasmaCitaProps) {
  const inicioMin = minutosEnTz(plan.newStartsAt, timezone);
  const duracionMin = Math.max(
    5,
    (new Date(plan.newEndsAt).getTime() - new Date(plan.newStartsAt).getTime()) / 60_000,
  );
  const rango = rangoDePlan(plan, timezone);

  return (
    <div
      className={`${s.fantasma} ${plan.overlap ? s.fantasmaChoca : ""} ${compacta ? s.fantasmaCompacta : ""}`}
      style={{
        top: topDeCita(inicioMin, minutoInicio),
        height: altoDeCita(duracionMin),
        left,
        width,
      }}
      role="status"
      aria-live="polite"
    >
      {/* En un carril de Semana el rango entero no cabe: basta la hora de inicio. */}
      <span className={s.fantasmaHora} title={rango}>
        {compacta ? formatTimeInTz(plan.newStartsAt, timezone) : rango}
      </span>
      {!compacta && (
        <span className={s.fantasmaTexto}>
          {plan.overlap ? "Choca con otra cita del doctor o de la unidad" : plan.original.patient.name}
        </span>
      )}
    </div>
  );
}
