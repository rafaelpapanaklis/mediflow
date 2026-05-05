"use client";
// Implants — drawer de mantenimiento periimplantario. Sondaje + foto +
// pérdida ósea con hint Albrektsson + próximo control. Spec §6.11.
//
// Si BoP+ o supuración → invoca STUB createPeriImplantAssessment +
// banner azul "Hallazgos sugieren mucositis o peri-implantitis".

import { useMemo, useState, useTransition } from "react";
import toast from "react-hot-toast";
import { X, Stethoscope, Activity, AlertTriangle } from "lucide-react";
import { createFollowUp } from "@/app/actions/implants/createFollowUp";
import { createPeriImplantAssessment } from "@/app/actions/implants/createPeriImplantAssessment";
import { isFailure } from "@/app/actions/implants/result";
import { FOLLOWUP_MILESTONE } from "@/lib/validation/implants";
import {
  evaluateAlbrektsson,
  expectedMaxBoneLossMm,
  yearsBetween,
} from "@/lib/implants/albrektsson-success";

const MILESTONE_LABEL: Record<string, string> = {
  M_1_WEEK: "1 semana",
  M_2_WEEKS: "2 semanas",
  M_1_MONTH: "1 mes",
  M_3_MONTHS: "3 meses",
  M_6_MONTHS: "6 meses",
  M_12_MONTHS: "12 meses",
  M_24_MONTHS: "24 meses",
  M_5_YEARS: "5 años",
  M_10_YEARS: "10 años",
  UNSCHEDULED: "Sin programar",
};

export interface MaintenanceDrawerProps {
  open: boolean;
  implantId: string | null;
  /** placedAt del implante — para calcular años y evaluar Albrektsson. */
  placedAt: Date | null;
  onClose: () => void;
  onCreated?: () => void;
}

export function MaintenanceDrawer(props: MaintenanceDrawerProps) {
  const [pending, startTransition] = useTransition();
  const [milestone, setMilestone] =
    useState<(typeof FOLLOWUP_MILESTONE)[number]>("M_6_MONTHS");
  const [performedAt, setPerformedAt] = useState(new Date().toISOString().slice(0, 10));
  const [bop, setBop] = useState(false);
  const [pdMax, setPdMax] = useState<number | "">("");
  const [supp, setSupp] = useState(false);
  const [mobility, setMobility] = useState(false);
  const [occlusionStable, setOcclusionStable] = useState(true);
  const [boneLoss, setBoneLoss] = useState<number | "">("");
  const [radiographFileId, setRadiographFileId] = useState("");
  const [nextControl, setNextControl] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const yearsSince = useMemo(() => {
    if (!props.placedAt || !performedAt) return null;
    return yearsBetween(props.placedAt, new Date(performedAt));
  }, [props.placedAt, performedAt]);

  const expected = yearsSince !== null ? expectedMaxBoneLossMm(yearsSince) : null;
  const albrektssonResult =
    yearsSince !== null && boneLoss !== ""
      ? evaluateAlbrektsson(Number(boneLoss), yearsSince)
      : null;

  const suggestsPerioInflammation = bop || supp;

  if (!props.open || !props.implantId) return null;

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const r = await createFollowUp({
        implantId: props.implantId!,
        milestone,
        performedAt: new Date(performedAt),
        bopPresent: bop,
        pdMaxMm: pdMax !== "" ? Number(pdMax) : undefined,
        suppuration: supp,
        mobility: mobility,
        occlusionStable: occlusionStable,
        radiographicBoneLossMm: boneLoss !== "" ? Number(boneLoss) : undefined,
        meetsAlbrektssonCriteria: albrektssonResult?.meetsCriteria,
        radiographFileId: radiographFileId || undefined,
        nextControlAt: nextControl ? new Date(nextControl) : undefined,
        notes: notes || undefined,
      });
      if (isFailure(r)) {
        setError(r.error);
        return;
      }
      // STUB: si hay signos de inflamación, intenta crear PeriImplantAssessment
      if (suggestsPerioInflammation) {
        await createPeriImplantAssessment({
          implantId: props.implantId!,
          bopPresent: bop,
          pdMaxMm: pdMax !== "" ? Number(pdMax) : undefined,
          suppurationPresent: supp,
          radiographicBoneLossMm: boneLoss !== "" ? Number(boneLoss) : undefined,
          notes,
        });
        toast.success("Control guardado · STUB Perio registrado en audit", {
          icon: "🔬",
        });
      } else {
        toast.success("Control de mantenimiento guardado");
      }
      props.onCreated?.();
      props.onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={props.onClose}>
      <div className="bg-white dark:bg-gray-900 w-full max-w-md h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-blue-600" /> Mantenimiento periimplantario
          </h2>
          <button onClick={props.onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hito de control">
              <select value={milestone} onChange={(e) => setMilestone(e.target.value as typeof milestone)} className={cls}>
                {FOLLOWUP_MILESTONE.map((m) => (
                  <option key={m} value={m}>{MILESTONE_LABEL[m] ?? m}</option>
                ))}
              </select>
            </Field>
            <Field label="Fecha realizado">
              <input type="date" value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} className={cls} />
            </Field>
          </div>

          <div className="rounded-md border border-gray-200 dark:border-gray-800 p-3 space-y-2">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Sondaje rápido</p>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={bop} onChange={(e) => setBop(e.target.checked)} />
              Sangrado al sondaje (BoP+)
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={supp} onChange={(e) => setSupp(e.target.checked)} />
              Supuración
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={mobility} onChange={(e) => setMobility(e.target.checked)} />
              Movilidad clínica
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={occlusionStable} onChange={(e) => setOcclusionStable(e.target.checked)} />
              Oclusión estable
            </label>
            <Field label="PD máx (mm)">
              <input type="number" step="0.1" min="0" max="15" value={pdMax} onChange={(e) => setPdMax(e.target.value === "" ? "" : Number(e.target.value))} className={cls} />
            </Field>
          </div>

          <Field label="Pérdida ósea radiográfica acumulada (mm)">
            <input type="number" step="0.1" min="0" max="15" value={boneLoss} onChange={(e) => setBoneLoss(e.target.value === "" ? "" : Number(e.target.value))} className={cls} />
          </Field>

          {expected !== null && yearsSince !== null && (
            <div className="rounded-md bg-gray-50 dark:bg-gray-800/40 p-2 text-xs text-gray-700 dark:text-gray-300 flex items-start gap-2">
              <Activity className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <div>
                <p>
                  Albrektsson 1986 a {yearsSince.toFixed(1)} años: pérdida
                  esperada máx <strong>{expected.toFixed(2)} mm</strong>.
                </p>
                {albrektssonResult && (
                  <p className={`mt-1 font-medium ${albrektssonResult.meetsCriteria ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
                    {albrektssonResult.meetsCriteria
                      ? "✓ Cumple criterios"
                      : "✗ Excede límite — evaluar peri-implantitis"}
                  </p>
                )}
              </div>
            </div>
          )}

          <Field label="ID radiografía (PatientFile XRAY_PERIAPICAL)">
            <input value={radiographFileId} onChange={(e) => setRadiographFileId(e.target.value)} className={cls} placeholder="opcional" />
          </Field>

          <Field label="Próximo control">
            <input type="date" value={nextControl} onChange={(e) => setNextControl(e.target.value)} className={cls} />
          </Field>

          <Field label="Notas">
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={cls} />
          </Field>

          {suggestsPerioInflammation && (
            <div className="rounded-md bg-blue-50 dark:bg-blue-950/40 p-3 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Hallazgos sugieren mucositis o peri-implantitis.</p>
                <p className="mt-1">
                  Al guardar, se crea registro en módulo Periodoncia
                  (STUB). La integración real se activa cuando ese
                  módulo se mergee a main.
                </p>
              </div>
            </div>
          )}

          {error && <div className="text-xs text-red-600">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-800">
          <button onClick={props.onClose} className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700">Cancelar</button>
          <button disabled={pending} onClick={submit} className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "Guardando…" : "Guardar control"}
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
