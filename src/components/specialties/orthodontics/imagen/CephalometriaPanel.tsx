"use client";
// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, ola 1, sep-2026). H1/H3/H4.
// Ranura montada dentro de SectionDiagnosis (reemplaza la tarjeta
// decorativa «Próximamente»). Self-fetch: se calla si no hay nada todavía.

import { useEffect, useState, useTransition } from "react";
import { Camera, FileText, Layers2, Sparkles } from "lucide-react";
import { Btn } from "../redesign/atoms/Btn";
import { Pill } from "../redesign/atoms/Pill";
import { listCephalometricAnalyses, type CephalometricAnalysisRow } from "@/app/actions/orthodontics/imagen/listCephalometricAnalyses";
import { saveCephalometricAnalysis } from "@/app/actions/orthodontics/imagen/saveCephalometricAnalysis";
import { CephalometricTracer } from "./CephalometricTracer";
import { CephalometricOverlay } from "./CephalometricOverlay";
import type { CephPoints } from "@/lib/orthodontics/cefalometria/landmarks";
import { CEPH_ANALYSIS_LABELS, evaluateAgainstNorms, type CephAnalysisType, type CephNormSet } from "@/lib/orthodontics/cefalometria/norms";
import { getConfiguredCephAutoTraceProvider } from "@/lib/orthodontics/imagen/integraciones-futuras";
import { isFailure } from "@/app/actions/orthodontics/result";

export interface CephalometriaPanelProps {
  treatmentPlanId: string;
  patientId: string;
}

type Mode = "list" | "upload" | "trace" | "overlay";

export function CephalometriaPanel({ treatmentPlanId, patientId }: CephalometriaPanelProps) {
  const [rows, setRows] = useState<CephalometricAnalysisRow[] | null>(null);
  const [mode, setMode] = useState<Mode>("list");
  const [analysisType, setAnalysisType] = useState<CephAnalysisType>("STEINER");
  const [normSet, setNormSet] = useState<CephNormSet>("STANDARD");
  const [draftPoints, setDraftPoints] = useState<CephPoints>({});
  const [newXrayFileId, setNewXrayFileId] = useState<string | null>(null);
  const [newXrayUrl, setNewXrayUrl] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const aiAvailable = Boolean(getConfiguredCephAutoTraceProvider());

  useEffect(() => {
    listCephalometricAnalyses(treatmentPlanId).then((res) => {
      if (res.ok) setRows(res.data);
    });
  }, [treatmentPlanId]);

  if (rows === null) return null; // primer render server: nada que mostrar mientras carga

  const latest = rows[rows.length - 1] ?? null;

  async function handleFilePicked(file: File, kind: "xray" | "tracing-pdf") {
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("patientId", patientId);
    form.append("kind", kind);
    const res = await fetch("/api/orthodontics/imagen/upload", { method: "POST", body: form });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "No se pudo subir el archivo");
      return;
    }
    if (kind === "xray") {
      setNewXrayFileId(json.fileId);
      setNewXrayUrl(`/api/files/${json.fileId}`); // el visor real firma la URL; placeholder de ruta
      setMode("trace");
    }
  }

  function handleSave() {
    setError(null);
    startSaving(async () => {
      const res = await saveCephalometricAnalysis({
        treatmentPlanId,
        kind: rows!.length === 0 ? "INITIAL" : "PROGRESS",
        analysisType,
        normSet,
        points: draftPoints,
        lateralXrayFileId: newXrayFileId,
      });
      if (isFailure(res)) {
        setError(res.error);
        return;
      }
      const list = await listCephalometricAnalyses(treatmentPlanId);
      if (list.ok) setRows(list.data);
      setMode("list");
      setDraftPoints({});
      setNewXrayFileId(null);
    });
  }

  return (
    <div className="bg-white p-5 dark:bg-slate-900">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">
          Cefalometría
        </h4>
        {!aiAvailable ? (
          <Pill color="slate" size="xs">
            Trazado manual
          </Pill>
        ) : null}
      </div>

      {error ? (
        <div className="mb-3 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 dark:bg-rose-950/30 dark:border-rose-900 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      {mode === "list" ? (
        rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 dark:border-slate-700 py-8 text-center">
            <Sparkles className="w-5 h-5 text-violet-400 mx-auto mb-2" aria-hidden />
            <p className="text-xs text-slate-500 mb-3 dark:text-slate-400">
              Sin trazado cefalométrico todavía.
            </p>
            <div className="flex items-center justify-center gap-2">
              <UploadButton label="Subir radiografía lateral" icon={<Camera className="w-3.5 h-3.5" />} onPick={(f) => handleFilePicked(f, "xray")} />
              <UploadButton label="Guardar PDF del centro radiológico" icon={<FileText className="w-3.5 h-3.5" />} onPick={(f) => handleFilePicked(f, "tracing-pdf")} />
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <select
                value={analysisType}
                onChange={(e) => setAnalysisType(e.target.value as CephAnalysisType)}
                className="text-xs border border-slate-200 rounded-md px-2 py-1 dark:bg-slate-800 dark:border-slate-700"
              >
                {Object.entries(CEPH_ANALYSIS_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                value={normSet}
                onChange={(e) => setNormSet(e.target.value as CephNormSet)}
                className="text-xs border border-slate-200 rounded-md px-2 py-1 dark:bg-slate-800 dark:border-slate-700"
              >
                <option value="STANDARD">Norma clásica</option>
                <option value="MEXICAN">Norma mexicana</option>
              </select>
            </div>

            <ResultsTable row={latest!} analysisType={analysisType} normSet={normSet} />

            <div className="mt-3 flex items-center gap-2">
              <UploadButton label="Nuevo trazado (control)" icon={<Camera className="w-3.5 h-3.5" />} onPick={(f) => handleFilePicked(f, "xray")} />
              {rows.length >= 2 ? (
                <Btn variant="secondary" size="sm" icon={<Layers2 className="w-3.5 h-3.5" />} onClick={() => setMode("overlay")}>
                  Superposición antes/después
                </Btn>
              ) : null}
            </div>
          </div>
        )
      ) : null}

      {mode === "trace" && newXrayUrl ? (
        <div>
          <CephalometricTracer imageUrl={newXrayUrl} onChange={setDraftPoints} />
          <div className="mt-3 flex justify-end gap-2">
            <Btn variant="ghost" size="sm" onClick={() => setMode("list")}>
              Cancelar
            </Btn>
            <Btn size="sm" onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Guardando…" : "Guardar trazado"}
            </Btn>
          </div>
        </div>
      ) : null}

      {mode === "overlay" ? (
        <div>
          <CephalometricOverlay initial={rows[0]} final={rows[rows.length - 1]} />
          <div className="mt-3 flex justify-end">
            <Btn variant="ghost" size="sm" onClick={() => setMode("list")}>
              Cerrar
            </Btn>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ResultsTable({
  row,
  analysisType,
  normSet,
}: {
  row: CephalometricAnalysisRow;
  analysisType: CephAnalysisType;
  normSet: CephNormSet;
}) {
  const evals = evaluateAgainstNorms(row.measurements, analysisType, normSet);
  const colorFor = (interp: string) =>
    interp === "normal"
      ? "text-emerald-600 dark:text-emerald-400"
      : interp === "sin-medida" || interp === "sin-norma"
        ? "text-slate-400"
        : "text-amber-600 dark:text-amber-400";
  return (
    <div className="grid grid-cols-5 gap-2 text-center">
      {evals.map((e) => (
        <div key={e.key} className="rounded-md bg-slate-50 dark:bg-slate-800/60 py-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">{e.key}</div>
          <div className={`text-sm font-semibold ${colorFor(e.interpretation)}`}>
            {e.value !== null ? `${e.value}°` : "—"}
          </div>
          <div className="text-[9px] text-slate-400">{e.norm ? `norma ${e.norm.mean}°` : "sin norma"}</div>
        </div>
      ))}
    </div>
  );
}

function UploadButton({ label, icon, onPick }: { label: string; icon: React.ReactNode; onPick: (f: File) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
      {icon}
      {label}
      <input
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}
