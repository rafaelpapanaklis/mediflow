"use client";
// Implants — drawer para registrar complicación. Spec §6.12.
// Al guardar cambia currentStatus → COMPLICATION (lo hace la action).

import { useState, useTransition } from "react";
import toast from "react-hot-toast";
import { X, AlertTriangle } from "lucide-react";
import { createComplication } from "@/app/actions/implants/createComplication";
import { isFailure } from "@/app/actions/implants/result";
import { COMPLICATION_TYPE, SEVERITY } from "@/lib/validation/implants";
import { COMPLICATION_GROUPS, isBiologicalComplication } from "@/lib/types/implants";
import type { ImplantComplicationType } from "@prisma/client";

const GROUP_LABELS = {
  biologicas: "Biológicas",
  mecanicas: "Mecánicas",
  quirurgicas: "Quirúrgicas",
  otras: "Otras",
} as const;

export interface ComplicationDrawerProps {
  open: boolean;
  implantId: string | null;
  onClose: () => void;
  onCreated?: () => void;
}

export function ComplicationDrawer(props: ComplicationDrawerProps) {
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<ImplantComplicationType>("PERI_IMPLANT_MUCOSITIS");
  const [severity, setSeverity] = useState<(typeof SEVERITY)[number]>("moderada");
  const [description, setDescription] = useState("");
  const [bop, setBop] = useState(false);
  const [pdMax, setPdMax] = useState<number | "">("");
  const [supp, setSupp] = useState(false);
  const [boneLoss, setBoneLoss] = useState<number | "">("");
  const [plan, setPlan] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!props.open || !props.implantId) return null;

  const isBiological = isBiologicalComplication(type);

  const submit = () => {
    if (description.trim().length < 10) {
      setError("Describe la complicación con al menos 10 caracteres");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await createComplication({
        implantId: props.implantId!,
        detectedAt: new Date(),
        type,
        severity,
        description: description.trim(),
        bopAtDiagnosis: isBiological ? bop : undefined,
        pdMaxAtDiagnosisMm: isBiological && pdMax !== "" ? Number(pdMax) : undefined,
        suppurationAtDiagnosis: isBiological ? supp : undefined,
        radiographicBoneLossMm: isBiological && boneLoss !== "" ? Number(boneLoss) : undefined,
        treatmentPlan: plan || undefined,
      });
      if (isFailure(r)) {
        setError(r.error);
        return;
      }
      toast.success("Complicación registrada — implante en estado COMPLICATION");
      props.onCreated?.();
      props.onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={props.onClose}>
      <div className="bg-white dark:bg-gray-900 w-full max-w-md h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-600" /> Registrar complicación
          </h2>
          <button onClick={props.onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <label className="block">
            <span className="block text-xs font-medium mb-1">Tipo</span>
            <select value={type} onChange={(e) => setType(e.target.value as ImplantComplicationType)} className="w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-2 py-1">
              {(Object.keys(COMPLICATION_GROUPS) as Array<keyof typeof COMPLICATION_GROUPS>).map((g) => (
                <optgroup key={g} label={GROUP_LABELS[g]}>
                  {COMPLICATION_GROUPS[g].map((t) => <option key={t} value={t}>{t}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium mb-1">Severidad</span>
            <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)} className="w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-2 py-1">
              {SEVERITY.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium mb-1">Descripción</span>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-2 py-1" />
          </label>

          {isBiological && (
            <div className="rounded-md border border-gray-200 dark:border-gray-800 p-3 space-y-2">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Hallazgos clínicos</p>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={bop} onChange={(e) => setBop(e.target.checked)} />
                Sangrado al sondaje (BoP+)
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={supp} onChange={(e) => setSupp(e.target.checked)} />
                Supuración
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="block text-[10px] mb-1">PD máx (mm)</span>
                  <input type="number" step="0.1" value={pdMax} onChange={(e) => setPdMax(e.target.value === "" ? "" : Number(e.target.value))} className="w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-2 py-1 text-xs" />
                </label>
                <label className="block">
                  <span className="block text-[10px] mb-1">Pérdida ósea (mm)</span>
                  <input type="number" step="0.1" value={boneLoss} onChange={(e) => setBoneLoss(e.target.value === "" ? "" : Number(e.target.value))} className="w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-2 py-1 text-xs" />
                </label>
              </div>
            </div>
          )}

          <label className="block">
            <span className="block text-xs font-medium mb-1">Plan de tratamiento</span>
            <textarea rows={2} value={plan} onChange={(e) => setPlan(e.target.value)} className="w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-2 py-1" />
          </label>
          {error && <div className="text-xs text-red-600">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-800">
          <button onClick={props.onClose} className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700">Cancelar</button>
          <button disabled={pending} onClick={submit} className="px-3 py-1.5 text-sm rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50">
            {pending ? "Guardando…" : "Registrar complicación"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Re-exporta los enums para uso del wrapper si lo necesita.
export { COMPLICATION_TYPE };
