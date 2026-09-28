// Atom: indicador compacto (etiqueta + icono + cifra + nota), con la escala
// de los indicadores compactos del Expediente: cifra de 22 px/700 que no
// parte de renglón.

import type { ReactNode } from "react";
import orto from "../orto.module.css";

type Tone = "violet" | "emerald" | "amber" | "rose" | "sky";

// El idioma del panel no tiene azul «info»: lo informativo va en violeta.
const ICON_TONE: Record<Tone, string> = {
  violet: "",
  emerald: orto.tarjetaIconoExito,
  amber: orto.tarjetaIconoAlerta,
  rose: orto.tarjetaIconoPeligro,
  sky: "",
};

const DELTA_COLOR: Record<"emerald" | "rose" | "amber", string> = {
  emerald: orto.tonoExito,
  rose: orto.tonoPeligro,
  amber: orto.tonoAlerta,
};

export interface KpiTileProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  delta?: ReactNode;
  deltaTone?: "emerald" | "rose" | "amber";
  className?: string;
}

export function KpiTile({
  label,
  value,
  sub,
  icon,
  tone = "violet",
  delta,
  deltaTone = "emerald",
  className = "",
}: KpiTileProps) {
  return (
    <div className={[orto.tarjeta, className].filter(Boolean).join(" ")} style={{ padding: "14px 16px" }}>
      <div className="flex items-center justify-between gap-3">
        <div className={orto.datoEtiqueta}>{label}</div>
        {icon ? (
          <div className={[orto.tarjetaIcono, ICON_TONE[tone]].filter(Boolean).join(" ")} aria-hidden>
            {icon}
          </div>
        ) : null}
      </div>
      <div className={`${orto.datoValor} ${orto.datoValorGrande}`} style={{ marginTop: 8 }}>
        <span>{value}</span>
        {delta ? <span className={`${orto.datoNota} ${DELTA_COLOR[deltaTone]}`}>{delta}</span> : null}
      </div>
      {sub ? <div className={orto.datoSub}>{sub}</div> : null}
    </div>
  );
}
