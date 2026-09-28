"use client";
// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, ola 1, sep-2026).
// Ranura que reemplaza la tarjeta decorativa «Cefalometría · Próximamente»
// de SectionDiagnosis.tsx (ver REPORTE-ws1-t8.md, «Arquitectura»). Agrupa
// H1/H3/H4 (cefalometría), H5 (fotos con líneas) y H9/H10 (modelo 3D ·
// Bolton) en pestañas — un solo hueco en el grid 2×2 de Diagnóstico.

import { useState } from "react";
import { Camera, Ruler, Sparkles } from "lucide-react";
import { CephalometriaPanel } from "./CephalometriaPanel";
import { BoltonPanel } from "./BoltonPanel";
import { PhotoLineAnalyzer } from "./PhotoLineAnalyzer";
import type { FacialPoints } from "@/lib/orthodontics/fotos/landmarks";

export interface ImagenYAnalisisCardProps {
  treatmentPlanId: string;
  patientId: string;
}

type Tab = "cefalometria" | "fotos" | "modelo3d";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "cefalometria", label: "Cefalometría", icon: <Ruler className="w-3.5 h-3.5" /> },
  { id: "fotos", label: "Fotos con líneas", icon: <Camera className="w-3.5 h-3.5" /> },
  { id: "modelo3d", label: "Modelo 3D · Bolton", icon: <Sparkles className="w-3.5 h-3.5" /> },
];

export function ImagenYAnalisisCard({ treatmentPlanId, patientId }: ImagenYAnalisisCardProps) {
  const [tab, setTab] = useState<Tab>("cefalometria");

  return (
    <div>
      <div className="flex items-center gap-1 px-5 pt-4 border-b border-slate-100 dark:border-slate-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-t-md border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? "border-violet-500 text-violet-700 dark:text-violet-300"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === "cefalometria" ? <CephalometriaPanel treatmentPlanId={treatmentPlanId} patientId={patientId} /> : null}
      {tab === "fotos" ? <FacialAnalysisTab patientId={patientId} /> : null}
      {tab === "modelo3d" ? <BoltonPanel patientId={patientId} /> : null}
    </div>
  );
}

function FacialAnalysisTab({ patientId }: { patientId: string }) {
  const [view, setView] = useState<"perfil" | "frente">("perfil");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [points, setPoints] = useState<FacialPoints>({});
  const [error, setError] = useState<string | null>(null);

  async function handlePick(file: File) {
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("patientId", patientId);
    form.append("kind", view === "perfil" ? "facial-perfil" : "facial-frente");
    const res = await fetch("/api/orthodontics/imagen/upload", { method: "POST", body: form });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "No se pudo subir la foto");
      return;
    }
    setImageUrl(`/api/files/${json.fileId}`);
    setPoints({});
  }

  return (
    <div className="bg-white p-5 dark:bg-slate-900">
      <div className="flex items-center gap-2 mb-3">
        <select
          value={view}
          onChange={(e) => {
            setView(e.target.value as "perfil" | "frente");
            setImageUrl(null);
            setPoints({});
          }}
          className="text-xs border border-slate-200 rounded-md px-2 py-1 dark:bg-slate-800 dark:border-slate-700"
        >
          <option value="perfil">Foto de perfil</option>
          <option value="frente">Foto de frente</option>
        </select>
        <label className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
          <Camera className="w-3.5 h-3.5" />
          {imageUrl ? "Cambiar foto" : "Subir foto"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handlePick(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {error ? (
        <div className="mb-3 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 dark:bg-rose-950/30 dark:border-rose-900 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      {imageUrl ? (
        <PhotoLineAnalyzer imageUrl={imageUrl} view={view} initialPoints={points} onChange={setPoints} />
      ) : (
        <div className="rounded-md border border-dashed border-slate-200 dark:border-slate-700 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
          Sube una foto de {view} para marcar líneas y ángulos.
        </div>
      )}
    </div>
  );
}
