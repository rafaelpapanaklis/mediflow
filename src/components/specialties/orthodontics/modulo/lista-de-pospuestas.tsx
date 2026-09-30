"use client";
// Módulo de Ortodoncia — H14 de la revisión final: las alertas pospuestas se
// pueden VER (quién, de qué alerta, hasta cuándo) y DESHACER. Antes solo salía
// «1 pospuesta» sin lista ni forma de quitarla.
import { useEffect, useState, useTransition } from "react";
import { Undo2 } from "lucide-react";
import { deshacerPosposicion } from "@/app/actions/orthodontics/modulo/deshacerPosposicion";
import { isFailure } from "@/app/actions/orthodontics/result";
import type { PospuestaVisible } from "@/lib/orthodontics/alertas-pospuestas";
import { useRefrescarAlertas } from "./refrescar-alertas";
import s from "./modulo.module.css";

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

const llave = (p: PospuestaVisible) => `${p.tipo}-${p.patientId}`;

export function ListaDePospuestas({ pospuestas }: { pospuestas: PospuestaVisible[] }) {
  const refrescar = useRefrescarAlertas();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Las ya deshechas salen de la lista al instante; el servidor confirma con el refresh que sigue.
  const [deshechas, setDeshechas] = useState<ReadonlySet<string>>(new Set());
  // Cuando el servidor ya no la trae, la marca sobra: si se pospone otra vez, vuelve a salir.
  useEffect(() => {
    setDeshechas((antes) => {
      const vivas = new Set([...antes].filter((k) => pospuestas.some((p) => llave(p) === k)));
      return vivas.size === antes.size ? antes : vivas;
    });
  }, [pospuestas]);
  const visibles = pospuestas.filter((p) => !deshechas.has(llave(p)));
  if (visibles.length === 0) return null;
  return (
    <details className={s.detalle} style={{ marginBottom: 12 }}>
      <summary style={{ cursor: "pointer" }}>
        {visibles.length} alerta{visibles.length === 1 ? "" : "s"} pospuesta{visibles.length === 1 ? "" : "s"}: ver y deshacer
      </summary>
      <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
        {visibles.map((p) => (
          <li key={llave(p)} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
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
                  else {
                    setDeshechas((antes) => new Set(antes).add(llave(p)));
                    await refrescar();
                  }
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
