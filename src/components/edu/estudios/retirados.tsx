"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { EduRetiradoRow } from "@/lib/edu/estudios-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * «RETIRADOS» — la sección plegada que hace LEGIBLE el motivo (N-16).
 *
 * 🔴 POR QUÉ EXISTE. Retirar un estudio o una foto EXIGE un motivo, lo
 * guarda en `deleteReason`… y hasta hoy no lo leía ninguna pantalla: no
 * había una sola consulta con `deletedAt: { not: null }` fuera del
 * historial del odontograma. Los dos modales prometen con todas sus letras
 * que esa constancia «es lo que contesta la pregunta dentro de un año», y
 * la pregunta solo se podía contestar en Postgres.
 *
 * 🔴 VA PLEGADA, y eso también es la decisión. Lo retirado no es parte del
 * expediente vivo: si se pintara abierto, la galería empezaría por lo que
 * ya no está. Se abre cuando alguien pregunta «¿y la panorámica de ayer?»,
 * que es exactamente cuando hace falta.
 *
 * 🔴 SOLO CON `estudios.upload`. Quien no puede retirar tampoco necesita el
 * registro de quién retiró qué: es el mismo permiso, y quien lo tiene es el
 * que responde por la baja.
 *
 * Se pinta igual para un estudio y para una foto porque las dos bajas son
 * la misma decisión de producto (suave, con autor, con motivo, y el binario
 * se conserva). La forma la fija `EduRetiradoRow`.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduRetiradosProps {
  rows: EduRetiradoRow[];
  /** «Retirados» para estudios, «Retiradas» para fotos. */
  titulo: string;
  /** Qué decir cuando no hay ninguno. */
  vacio: string;
  /** El renglón que explica qué significa estar aquí. */
  detalle: string;
}

export function EduRetirados({ rows, titulo, vacio, detalle }: EduRetiradosProps) {
  const [abierto, setAbierto] = useState(false);
  const n = rows.length;

  return (
    <section className="edu-retirados">
      <button
        type="button"
        className="edu-retirados__head"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
      >
        {abierto ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        <span className="edu-retirados__title">{titulo}</span>
        <span className="edu-count">{n}</span>
      </button>

      {abierto && (
        <div className="edu-retirados__cuerpo">
          <p className="edu-note">{detalle}</p>
          {n === 0 ? (
            <p className="edu-retirados__vacio">{vacio}</p>
          ) : (
            <ul className="edu-retirados__lista">
              {rows.map((r) => (
                <li key={r.id} className="edu-retirados__item">
                  <span className="edu-retirados__que">{r.que}</span>
                  <span className="edu-retirados__meta">
                    {[r.quien ? `Lo retiró ${r.quien}` : "", r.cuando]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {/* El MOTIVO es lo único por lo que existe esta sección:
                      va en su propio renglón y no comprimido en la meta. */}
                  <span className="edu-retirados__motivo">
                    {r.porQue || "Sin motivo registrado (se retiró antes de que fuera obligatorio)."}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
