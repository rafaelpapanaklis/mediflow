"use client";
// Periodontics — botón "Nuevo sondaje" para el topbar de la página detalle.
// Llama a createEmptyPeriodontalRecord (action) y refresca la página para
// que el server load capture el nuevo record y monte el periodontograma
// editable.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import toast from "react-hot-toast";
import {
  createEmptyPeriodontalRecord,
  isFailure,
} from "@/app/actions/periodontics";

export interface NewPerioRecordButtonProps {
  patientId: string;
  /** Si true, el label dice "Iniciar primer sondaje" en vez de "Nuevo sondaje". */
  isFirst?: boolean;
}

export function NewPerioRecordButton({ patientId, isFirst }: NewPerioRecordButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy || pending) return;
    setBusy(true);
    try {
      const result = await createEmptyPeriodontalRecord(patientId);
      if (isFailure(result)) {
        // Si la action devolvió existingId (anti-doble-click), abrimos ese.
        if (result.existingId) {
          toast.success("Usando el sondaje creado hace un momento");
          startTransition(() => router.refresh());
          return;
        }
        toast.error(result.error);
        return;
      }
      toast.success("Sondaje creado — captura los sitios desde el periodontograma");
      startTransition(() => router.refresh());
    } catch (e) {
      console.error("[perio] createEmpty failed:", e);
      toast.error("No se pudo crear el sondaje");
    } finally {
      setBusy(false);
    }
  };

  const label = isFirst ? "Iniciar primer sondaje" : "Nuevo sondaje";
  const loading = busy || pending;

  return (
    <button
      type="button"
      className="pedi-btn"
      onClick={handleClick}
      disabled={loading}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "var(--brand, #6366f1)",
        color: "white",
        border: "1px solid var(--brand, #6366f1)",
        opacity: loading ? 0.6 : 1,
        cursor: loading ? "wait" : "pointer",
      }}
    >
      <Plus size={14} aria-hidden /> {loading ? "Creando…" : label}
    </button>
  );
}
