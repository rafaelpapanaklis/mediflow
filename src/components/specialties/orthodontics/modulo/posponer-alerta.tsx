"use client";
// Módulo de Ortodoncia — «Posponer 7 días» de una alerta (fila 22 de la
// revisión de uso, ws1-t4 ronda 6). La fila se va de la lista y vuelve sola a
// los 7 días si el caso sigue igual. Si no se pudo, lo dice ahí mismo.
import { useState, useTransition } from "react";
import { AlarmClockOff } from "lucide-react";
import { posponerAlerta } from "@/app/actions/orthodontics/modulo/posponerAlerta";
import { isFailure } from "@/app/actions/orthodontics/result";
import { DIAS_DE_POSPOSICION, type TipoPosponible } from "@/lib/orthodontics/alertas-pospuestas";
import { useRefrescarAlertas } from "./refrescar-alertas";
import s from "./modulo.module.css";

export function PosponerAlertaBoton({
  patientId,
  patientName,
  tipo,
}: {
  patientId: string;
  patientName: string;
  tipo: TipoPosponible;
}) {
  const refrescar = useRefrescarAlertas();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={`${s.boton} ${s.botonPeq}`}
        aria-label={`Posponer ${DIAS_DE_POSPOSICION} días la alerta de ${patientName}`}
        disabled={pendiente}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const r = await posponerAlerta({ patientId, tipo });
            if (isFailure(r)) setError(r.error);
            else await refrescar();
          })
        }
      >
        <AlarmClockOff size={14} strokeWidth={1.9} aria-hidden />
        {pendiente ? "Posponiendo…" : `Posponer ${DIAS_DE_POSPOSICION} días`}
      </button>
      {error ? (
        <span role="alert" className={`${s.detalle} ${s.detallePeligro}`}>
          {error}
        </span>
      ) : null}
    </>
  );
}
