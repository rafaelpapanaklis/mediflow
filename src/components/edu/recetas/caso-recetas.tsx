import Link from "next/link";
import type { EduRecetaRow } from "@/lib/edu/recetas-core";
import { EDU_PRESCRIPTION_STATUS_LABELS } from "@/lib/edu/types";

/**
 * LAS RECETAS DE UN CASO, dentro de su tarjeta (pestaña Casos).
 *
 * Componente de SERVIDOR y solo lectura, a propósito: la tarjeta del caso
 * ya carga autorizaciones y procedimiento, y aquí solo hace falta ver EN
 * QUÉ VAN. Proponer, editar, mandar y anular viven en la pestaña Recetas,
 * que es a donde lleva el enlace — dos sitios con el mismo formulario son
 * dos sitios donde arreglar el mismo bug.
 */
export interface EduCasoRecetasProps {
  patientId: string;
  rows: EduRecetaRow[];
}

const TAG_POR_ESTADO: Record<string, string> = {
  BORRADOR: "edu-tag--muted",
  PENDIENTE: "edu-tag--info",
  EXPEDIDA: "edu-tag--ok",
  RECHAZADA: "edu-tag--danger",
  ANULADA: "edu-tag--danger",
};

export function EduCasoRecetas({ patientId, rows }: EduCasoRecetasProps) {
  if (rows.length === 0) return null;

  return (
    <div className="edu-caso-recetas">
      <p className="edu-caso-recetas__title">
        {rows.length === 1 ? "1 receta" : `${rows.length} recetas`} ·{" "}
        <Link href={`/instituto/pacientes/${patientId}/recetas`} className="edu-auth-card__link">
          Abrir la pestaña Recetas
        </Link>
      </p>
      <ul className="edu-caso-recetas__list">
        {rows.slice(0, 5).map((r) => (
          <li key={r.id} className="edu-caso-recetas__item">
            <span className={`edu-tag ${TAG_POR_ESTADO[r.status] ?? "edu-tag--muted"}`}>
              {EDU_PRESCRIPTION_STATUS_LABELS[r.status]}
            </span>
            <span className="edu-caso-recetas__meta">
              {r.createdAtLabel} ·{" "}
              {r.items
                .slice(0, 3)
                .map((it) => it.drug)
                .join(", ")}
              {r.items.length > 3 ? "…" : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
