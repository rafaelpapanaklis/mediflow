"use client";
// Implants — modal de remoción. NO BORRA — cambia status a REMOVED
// con motivo ≥20 chars. Spec §1.10, §6.14.

import { useState, useTransition } from "react";
import toast from "react-hot-toast";
import { X, ShieldAlert } from "lucide-react";
import { removeImplant } from "@/app/actions/implants/removeImplant";
import { isFailure } from "@/app/actions/implants/result";

export interface RemoveImplantModalProps {
  open: boolean;
  implantId: string | null;
  onClose: () => void;
  onRemoved?: () => void;
}

export function RemoveImplantModal(props: RemoveImplantModalProps) {
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!props.open || !props.implantId) return null;

  const len = reason.trim().length;
  const valid = len >= 20;

  const submit = () => {
    if (!valid) {
      setError("Motivo debe tener al menos 20 caracteres");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await removeImplant({
        implantId: props.implantId!,
        removalReason: reason.trim(),
      });
      if (isFailure(r)) {
        setError(r.error);
        return;
      }
      toast.success("Implante removido — trazabilidad COFEPRIS preservada");
      props.onRemoved?.();
      props.onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={props.onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-red-600" /> Remover implante
          </h2>
          <button onClick={props.onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="rounded-md bg-red-50 dark:bg-red-950/40 p-3 text-xs text-red-800 dark:text-red-200">
            El implante NO se borra. Cambia su estado a REMOVED y queda en
            historial. La trazabilidad COFEPRIS se preserva por 10 años.
          </div>
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Motivo de remoción</span>
            <textarea
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-2 py-1 text-sm"
              placeholder="Ej: fracaso de osteointegración tras 6 meses de cicatrización…"
            />
            <div className={`text-xs mt-1 ${valid ? "text-emerald-600" : "text-red-600"}`}>
              {len} / 20 caracteres mínimos
            </div>
          </label>
          {error && <div className="text-xs text-red-600">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-800">
          <button onClick={props.onClose} className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700">Cancelar</button>
          <button disabled={pending || !valid} onClick={submit} className="px-3 py-1.5 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
            {pending ? "Removiendo…" : "Remover implante"}
          </button>
        </div>
      </div>
    </div>
  );
}
