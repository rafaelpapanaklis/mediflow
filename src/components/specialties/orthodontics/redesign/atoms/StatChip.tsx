// Atom: dato de resumen (etiqueta corta + valor + nota). Lo usan el resumen
// del tratamiento y los encabezados de sección. El valor mide 15 px/650 —lo
// mismo que las métricas de la cabecera del paciente— porque casi siempre es
// TEXTO («MBT .022», «NiTi 0.014»), no una cifra suelta: a 24 px partía en
// dos renglones en cuanto la columna se estrechaba.

import type { ReactNode } from "react";
import orto from "../orto.module.css";

type DeltaColor = "emerald" | "rose" | "amber";

const DELTA: Record<DeltaColor, string> = {
  emerald: orto.tonoExito,
  rose: orto.tonoPeligro,
  amber: orto.tonoAlerta,
};

export interface StatChipProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  delta?: ReactNode;
  deltaColor?: DeltaColor;
  className?: string;
}

export function StatChip({
  label,
  value,
  sub,
  delta,
  deltaColor = "emerald",
  className = "",
}: StatChipProps) {
  return (
    <div className={[orto.dato, className].filter(Boolean).join(" ")}>
      <div className={orto.datoEtiqueta}>{label}</div>
      <div className={orto.datoValor}>
        <span>{value}</span>
        {delta ? <span className={`${orto.datoNota} ${DELTA[deltaColor]}`}>{delta}</span> : null}
      </div>
      {sub ? <div className={orto.datoSub}>{sub}</div> : null}
    </div>
  );
}
