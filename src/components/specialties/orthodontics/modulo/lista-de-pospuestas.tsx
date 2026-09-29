"use client";
// Módulo de Ortodoncia — H14 de la revisión final: las alertas pospuestas se
// pueden VER (quién, de qué alerta, hasta cuándo) y DESHACER. Antes solo salía
// «1 pospuesta» sin lista ni forma de quitarla.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { deshacerPosposicion } from "@/app/actions/orthodontics/modulo/deshacerPosposicion";
import { isFailure } from "@/app/actions/orthodontics/result";
import type { PospuestaVisible } from "@/lib/orthodontics/alertas-pospuestas";
import s from "./modulo.module.css";

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export function ListaDePospuestas({ pospuestas }: { pospuestas: PospuestaVisible[] }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (pospuestas.length === 0) return null;
  return (
    <details className={s.detalle} style={{ marginBottom: 12 }}>
      <summary style={{ cursor: "pointer" }}>
        {pospuestas.length} alerta{pospuestas.length === 1 ? "" : "s"} pospuesta{pospuestas.length === 1 ? "" : "s"}: ver y deshacer
      </summary>
      <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
        {pospuestas.map((p) => (
          <li key={`${p.tipo}-${p.patientId}`} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>
              <strong>{p.patientName}</strong> · {p.etiqueta} · vuelve el {fechaCorta(p.hasta)}
            </span>
            <button
              type="button"
              className={`${s.boton} ${s.botonPeq}`}
              disabled={pendiente}
              aria-label={`Deshacer la posposición de ${p.etiqueta} de ${p.patientName}`}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const r = await deshacerPosposicion({ patientId: p.patientId, tipo: p.tipo });
                  if (isFailure(r)) setError(r.error);
                  else router.refresh();
                })
              }
            >
              <Undo2 size={14} strokeWidth={1.9} aria-hidden />
              Deshacer
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <div role="alert" className={`${s.detalle} ${s.detallePeligro}`}>
          {error}
        </div>
      ) : null}
    </details>
  );
}
