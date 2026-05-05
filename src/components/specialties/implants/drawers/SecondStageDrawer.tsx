"use client";
// Implants — drawer de 2ª cirugía (descubrimiento). Spec §6, §7.4.
// Solo aplica a protocolo TWO_STAGE — la verificación final está en
// la action createSecondStageSurgery.

import { useState, useTransition } from "react";
import toast from "react-hot-toast";
import { X, Scissors } from "lucide-react";
import { createSecondStageSurgery } from "@/app/actions/implants/createSecondStageSurgery";
import { isFailure } from "@/app/actions/implants/result";

export interface SecondStageDrawerProps {
  open: boolean;
  implantId: string | null;
  onClose: () => void;
  onCreated?: () => void;
}

export function SecondStageDrawer(props: SecondStageDrawerProps) {
  const [pending, startTransition] = useTransition();
  const [performedAt, setPerformedAt] = useState(new Date().toISOString().slice(0, 16));
  const [technique, setTechnique] = useState("Punzonado con bisturí circular");
  const [healingLot, setHealingLot] = useState("");
  const [healingDiam, setHealingDiam] = useState<number | "">(4.5);
  const [healingHeight, setHealingHeight] = useState<number | "">(4);
  const [isqAtUncovering, setIsqAtUncovering] = useState<number | "">("");
  const [durationMinutes, setDurationMinutes] = useState<number | "">(45);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!props.open || !props.implantId) return null;

  const submit = () => {
    setError(null);
    if (!healingLot.trim()) {
      setError("El lote del pilar de cicatrización es obligatorio (COFEPRIS)");
      return;
    }
    if (!healingDiam || !healingHeight || !durationMinutes) {
      setError("Completa diámetro, altura y duración");
      return;
    }
    startTransition(async () => {
      const r = await createSecondStageSurgery({
        implantId: props.implantId!,
        performedAt: new Date(performedAt),
        technique,
        healingAbutmentLot: healingLot.trim(),
        healingAbutmentDiameterMm: Number(healingDiam),
        healingAbutmentHeightMm: Number(healingHeight),
        isqAtUncovering: isqAtUncovering !== "" ? Number(isqAtUncovering) : undefined,
        durationMinutes: Number(durationMinutes),
        notes: notes || undefined,
      });
      if (isFailure(r)) {
        setError(r.error);
        return;
      }
      toast.success("2ª cirugía guardada — implante UNCOVERED");
      props.onCreated?.();
      props.onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={props.onClose}>
      <div className="bg-white dark:bg-gray-900 w-full max-w-md h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <Scissors className="h-4 w-4 text-blue-600" /> 2ª cirugía (descubrimiento)
          </h2>
          <button onClick={props.onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <div className="rounded-md bg-blue-50 dark:bg-blue-950/40 p-3 text-xs text-blue-900 dark:text-blue-200">
            Solo aplica a implantes con protocolo <strong>TWO_STAGE</strong>.
            Al guardar, el implante pasa a estado UNCOVERED.
          </div>

          <Field label="Fecha y hora">
            <input type="datetime-local" value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} className={cls} />
          </Field>

          <Field label="Técnica">
            <select value={technique} onChange={(e) => setTechnique(e.target.value)} className={cls}>
              <option>Punzonado con bisturí circular</option>
              <option>Incisión crestal</option>
              <option>Reposicionamiento de tejido conectivo</option>
              <option>Otra</option>
            </select>
          </Field>

          <div className="rounded-md border border-amber-200 dark:border-amber-900 p-3 space-y-2">
            <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
              Pilar de cicatrización (CRÍTICO COFEPRIS)
            </p>
            <Field label="Lote">
              <input value={healingLot} onChange={(e) => setHealingLot(e.target.value)} className={cls + " font-mono"} placeholder="ej. HA-22334-R" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Diámetro (mm)">
                <input type="number" step="0.1" min="3" max="8" value={healingDiam} onChange={(e) => setHealingDiam(e.target.value === "" ? "" : Number(e.target.value))} className={cls} />
              </Field>
              <Field label="Altura (mm)">
                <input type="number" step="0.1" min="1" max="15" value={healingHeight} onChange={(e) => setHealingHeight(e.target.value === "" ? "" : Number(e.target.value))} className={cls} />
              </Field>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="ISQ al descubrimiento">
              <input type="number" min="0" max="100" value={isqAtUncovering} onChange={(e) => setIsqAtUncovering(e.target.value === "" ? "" : Number(e.target.value))} className={cls} />
            </Field>
            <Field label="Duración (min)">
              <input type="number" min="5" max="180" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value === "" ? "" : Number(e.target.value))} className={cls} />
            </Field>
          </div>

          <Field label="Notas">
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={cls} />
          </Field>

          {error && <div className="text-xs text-red-600">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-800">
          <button onClick={props.onClose} className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700">Cancelar</button>
          <button disabled={pending} onClick={submit} className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "Guardando…" : "Guardar 2ª cirugía"}
          </button>
        </div>
      </div>
    </div>
  );
}

const cls = "w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-2 py-1 text-sm";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</span>
      {children}
    </label>
  );
}
