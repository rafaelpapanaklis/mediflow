"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { eduRequest } from "@/components/edu/edu-http";

/**
 * EL PROCEDIMIENTO PRINCIPAL DE UN CASO, en la ficha del paciente.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 SIN ESTO, LOS REQUISITOS NO CUENTAN.
 *
 * Un requisito del plan de estudios dice "tres endodoncias
 * unirradiculares"; para saber si un caso es una de ellas hace falta que
 * alguien lo diga. Es el único dato que la Ola 6 le pide al piso clínico,
 * y por eso se pone AQUÍ —donde ya se está mirando el caso— y no en una
 * pantalla aparte que nadie abriría.
 *
 * 🔴 LO PONE EL DOCENTE (permiso "casos.assign"), NO EL ALUMNO. Y no es
 * un descuido de permisos: clasificar el caso es lo que decide si cuenta
 * para un requisito del propio alumno. Dejarle marcar sus casos sería
 * dejarle firmar su propio avance.
 *
 * ⚠️ Un caso SIN procedimiento no cuenta para ningún requisito que pida
 * uno, y esta pantalla lo DICE. Contarlo "por si acaso" es cómo se gradúa
 * alguien que no hizo lo que dice que hizo; esconderlo es cómo se pasa un
 * semestre creyendo que no se avanza.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduCasoProcedimientoProps {
  caseId: string;
  procedureId: string | null;
  procedureName: string | null;
  procedures: { id: string; name: string; category: string | null }[];
  canEdit: boolean;
  /** Un caso cerrado ya no se reclasifica: lo que contó, contó. */
  cerrado: boolean;
}

export function EduCasoProcedimiento({
  caseId,
  procedureId,
  procedureName,
  procedures,
  canEdit,
  cerrado,
}: EduCasoProcedimientoProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [valor, setValor] = useState(procedureId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(next: string) {
    const previo = valor;
    setValor(next);
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/casos/${caseId}`, {
        method: "PATCH",
        body: { procedureId: next || null },
      });
      startNav(() => router.refresh());
    } catch (err) {
      setValor(previo);
      setError(err instanceof Error ? err.message : "No se pudo guardar el procedimiento.");
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit || cerrado) {
    return (
      <p className="edu-estudio__meta">
        Procedimiento:{" "}
        {procedureName ?? (
          <span className="edu-sin">
            sin capturar — este caso no cuenta para los requisitos que piden uno
          </span>
        )}
      </p>
    );
  }

  return (
    <div className="edu-field">
      <label className="edu-field__label" htmlFor={`edu-caso-proc-${caseId}`}>
        Procedimiento principal
      </label>
      <select
        id={`edu-caso-proc-${caseId}`}
        className="edu-input edu-input--sm"
        value={valor}
        onChange={(e) => guardar(e.target.value)}
        disabled={busy}
      >
        <option value="">Sin capturar</option>
        {procedures.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.category ? ` · ${p.category}` : ""}
          </option>
        ))}
      </select>
      <p className="edu-field__hint">
        {valor
          ? "Es lo que hace que este caso cuente para un requisito del plan de estudios."
          : "Sin procedimiento, este caso no cuenta para ningún requisito que pida uno."}
      </p>
      {error && (
        <p className="edu-note" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
