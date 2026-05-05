"use client";
// Implants — modal COFEPRIS para modificar trazabilidad
// (brand / lotNumber / placedAt). Justificación obligatoria ≥20 chars
// con contador en vivo. Spec §6.13.

import { useState, useTransition } from "react";
import toast from "react-hot-toast";
import { X, ShieldAlert } from "lucide-react";
import { updateImplantTraceability } from "@/app/actions/implants/updateImplantTraceability";
import { isFailure } from "@/app/actions/implants/result";
import { IMPLANT_BRAND } from "@/lib/validation/implants";

type Field = "brand" | "lotNumber" | "placedAt";

export interface BrandUpdateJustificationModalProps {
  open: boolean;
  implantId: string | null;
  current: { brand: string; lotNumber: string; placedAt: Date } | null;
  onClose: () => void;
  onUpdated?: () => void;
}

export function BrandUpdateJustificationModal(props: BrandUpdateJustificationModalProps) {
  const [pending, startTransition] = useTransition();
  const [field, setField] = useState<Field>("lotNumber");
  const [newValue, setNewValue] = useState("");
  const [newBrandCustomName, setNewBrandCustomName] = useState("");
  const [justification, setJustification] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!props.open || !props.implantId || !props.current) return null;

  const justLen = justification.trim().length;
  const justValid = justLen >= 20;

  const currentValue = (() => {
    if (field === "brand") return props.current.brand;
    if (field === "lotNumber") return props.current.lotNumber;
    return new Date(props.current.placedAt).toISOString().slice(0, 16);
  })();

  const submit = () => {
    if (!newValue) {
      setError("Indica el nuevo valor");
      return;
    }
    if (!justValid) {
      setError("Justificación debe tener al menos 20 caracteres");
      return;
    }
    setError(null);
    startTransition(async () => {
      const payload: Parameters<typeof updateImplantTraceability>[0] = {
        implantId: props.implantId!,
        field,
        newValue: field === "placedAt" ? new Date(newValue) : newValue,
        justification: justification.trim(),
      };
      if (field === "brand" && newValue === "OTRO" && newBrandCustomName) {
        payload.newBrandCustomName = newBrandCustomName;
      }
      const r = await updateImplantTraceability(payload);
      if (isFailure(r)) {
        setError(r.error);
        return;
      }
      toast.success("Modificación registrada en audit log COFEPRIS");
      props.onUpdated?.();
      props.onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={props.onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-600" /> Modificar trazabilidad COFEPRIS
          </h2>
          <button onClick={props.onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-800 dark:text-amber-200">
            Los campos brand / lote / fecha de colocación son inmutables por
            defecto (clase III). Esta modificación queda en audit log con tu
            cédula, fecha exacta, valor anterior, nuevo y justificación.
          </div>

          <label className="block">
            <span className="block text-xs font-medium mb-1">Campo a modificar</span>
            <select value={field} onChange={(e) => { setField(e.target.value as Field); setNewValue(""); }} className="w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-2 py-1 text-sm">
              <option value="lotNumber">Lote (lotNumber)</option>
              <option value="brand">Marca (brand)</option>
              <option value="placedAt">Fecha de colocación (placedAt)</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="block text-xs font-medium mb-1">Valor actual</span>
              <div className="rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-2 py-1 text-sm font-mono text-gray-500">
                {currentValue}
              </div>
            </div>
            <div>
              <span className="block text-xs font-medium mb-1">Nuevo valor</span>
              {field === "brand" ? (
                <select value={newValue} onChange={(e) => setNewValue(e.target.value)} className="w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-2 py-1 text-sm">
                  <option value="">— Seleccionar —</option>
                  {IMPLANT_BRAND.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              ) : field === "placedAt" ? (
                <input type="datetime-local" value={newValue} onChange={(e) => setNewValue(e.target.value)} className="w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-2 py-1 text-sm" />
              ) : (
                <input value={newValue} onChange={(e) => setNewValue(e.target.value)} className="w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-2 py-1 text-sm font-mono" />
              )}
            </div>
          </div>

          {field === "brand" && newValue === "OTRO" && (
            <label className="block">
              <span className="block text-xs font-medium mb-1">Nombre marca (OTRO)</span>
              <input value={newBrandCustomName} onChange={(e) => setNewBrandCustomName(e.target.value)} className="w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-2 py-1 text-sm" />
            </label>
          )}

          <label className="block">
            <span className="block text-xs font-medium mb-1">Justificación (≥20 chars)</span>
            <textarea
              rows={3}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              className="w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-2 py-1 text-sm"
              placeholder="Ej: lote correcto del paquete original, ajuste tras inventario y verificación con el factura del proveedor."
            />
            <div className={`text-xs mt-1 ${justValid ? "text-emerald-600" : "text-red-600"}`}>
              {justLen} / 20 caracteres mínimos
            </div>
          </label>
          {error && <div className="text-xs text-red-600">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-800">
          <button onClick={props.onClose} className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700">Cancelar</button>
          <button disabled={pending || !justValid || !newValue} onClick={submit} className="px-3 py-1.5 text-sm rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
            {pending ? "Registrando…" : "Confirmar y auditar"}
          </button>
        </div>
      </div>
    </div>
  );
}
