"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

/** Diagnóstico codificado CIE-10 — misma forma que consume Cie10Selector. */
export interface CodedDiagnosis {
  id: string;
  cie10Code: string;
  isPrimary: boolean;
  note: string | null;
  cie10?: { code: string; description: string; chapter: string };
}

/** Payload que emite Cie10Selector.onAdd (description solo lo usa el modo local). */
export interface AddDxInput {
  cie10Code: string;
  isPrimary: boolean;
  note?: string;
  description?: string;
}

/**
 * Maneja los diagnósticos CIE-10 *codificados* de una consulta (NOM-024 §6.3 /
 * NOM-004) contra el catálogo real `Cie10Code`, para que queden codificados (no
 * texto libre) y fluyan al CDA (`MedicalRecordDiagnosis` → `diagnoses_v2`).
 *
 * Dos modos según `recordId`:
 * - **recordId = null (consulta nueva):** el expediente aún no existe, así que
 *   los dx se acumulan en estado LOCAL. Tras crear el record con el POST normal,
 *   se llama a `flush(newRecordId)` para persistirlos contra el endpoint ya
 *   existente `POST /api/medical-records/[id]/diagnoses`.
 * - **recordId definido (edición):** el expediente ya existe; add/remove pegan en
 *   vivo al endpoint (igual que note-detail-modal) y `flush` es no-op.
 *
 * NO toca rutas /api ni el schema: reutiliza los endpoints existentes.
 */
export function useCodedDiagnoses(recordId: string | null) {
  const [dxs, setDxs] = useState<CodedDiagnosis[]>([]);

  // Modo edición: cargar los dx ya persistidos del expediente.
  useEffect(() => {
    if (!recordId) return;
    let cancelled = false;
    fetch(`/api/medical-records/${recordId}/diagnoses`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.diagnoses) setDxs(d.diagnoses); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [recordId]);

  const reload = useCallback(async () => {
    if (!recordId) return;
    const res = await fetch(`/api/medical-records/${recordId}/diagnoses`);
    if (res.ok) {
      const d = await res.json();
      setDxs(d.diagnoses ?? []);
    }
  }, [recordId]);

  const onAdd = useCallback(async (input: AddDxInput) => {
    if (recordId) {
      // Vivo: persistir y recargar (la descripción viene del catálogo en el GET).
      const res = await fetch(`/api/medical-records/${recordId}/diagnoses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cie10Code: input.cie10Code, isPrimary: input.isPrimary, note: input.note }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error ?? "No se pudo agregar el diagnóstico");
        return;
      }
      await reload();
      return;
    }
    // Local: acumular en estado. Maneja también "marcar primario" sobre uno ya agregado.
    setDxs((prev) => {
      const existing = prev.find((d) => d.cie10Code === input.cie10Code);
      if (existing) {
        return input.isPrimary
          ? prev.map((d) => ({ ...d, isPrimary: d.cie10Code === input.cie10Code }))
          : prev;
      }
      const cleared = input.isPrimary ? prev.map((d) => ({ ...d, isPrimary: false })) : prev;
      return [
        ...cleared,
        {
          id: `pending-${input.cie10Code}`,
          cie10Code: input.cie10Code,
          isPrimary: input.isPrimary,
          note: input.note ?? null,
          cie10: { code: input.cie10Code, description: input.description ?? "", chapter: "" },
        },
      ];
    });
  }, [recordId, reload]);

  const onRemove = useCallback(async (dxId: string) => {
    if (recordId) {
      const res = await fetch(`/api/medical-records/${recordId}/diagnoses/${dxId}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("No se pudo quitar el diagnóstico");
        return;
      }
    }
    setDxs((prev) => prev.filter((d) => d.id !== dxId));
  }, [recordId]);

  /**
   * Persiste los dx locales en un expediente recién creado (modo consulta nueva).
   * Devuelve cuántos se guardaron. Secuencial: el endpoint des-marca primarios
   * anteriores al recibir isPrimary=true, así que el orden preserva el primario.
   */
  const flush = useCallback(async (newRecordId: string): Promise<number> => {
    let saved = 0;
    for (const dx of dxs) {
      try {
        const res = await fetch(`/api/medical-records/${newRecordId}/diagnoses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cie10Code: dx.cie10Code, isPrimary: dx.isPrimary, note: dx.note ?? undefined }),
        });
        if (res.ok) saved++;
      } catch {
        /* se reporta arriba comparando saved vs dxs.length */
      }
    }
    return saved;
  }, [dxs]);

  /** Resumen legible "CODE - desc; CODE - desc" para continuidad de display/assessment. */
  const summary = dxs
    .map((d) => `${d.cie10Code}${d.cie10?.description ? ` - ${d.cie10.description}` : ""}`)
    .join("; ");

  return { dxs, onAdd, onRemove, flush, summary };
}
