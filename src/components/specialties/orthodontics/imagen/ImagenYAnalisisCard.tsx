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
import orto from "../redesign/orto.module.css";

export interface ImagenYAnalisisCardProps {
  treatmentPlanId: string;
  patientId: string;
}

type Tab = "cefalometria" | "fotos" | "modelo3d";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "cefalometria", label: "Trazado", icon: <Ruler size={14} strokeWidth={1.75} aria-hidden /> },
  { id: "fotos", label: "Fotos", icon: <Camera size={14} strokeWidth={1.75} aria-hidden /> },
  { id: "modelo3d", label: "Bolton", icon: <Sparkles size={14} strokeWidth={1.75} aria-hidden /> },
];

export function ImagenYAnalisisCard({ treatmentPlanId, patientId }: ImagenYAnalisisCardProps) {
  const [tab, setTab] = useState<Tab>("cefalometria");

  return (
    <div className="bg-[color:var(--pr-tarjeta)] min-w-0">
      <div className="px-[18px] pt-[16px]">
        <h4 className={`${orto.ceja} mb-[10px]`}>Imagen y análisis</h4>
        <div className={orto.segmento} role="tablist" aria-label="Imagen y análisis">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={[orto.segmentoBoton, tab === t.id ? orto.segmentoActivo : ""]
              .filter(Boolean)
              .join(" ")}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        </div>
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
    // Hallazgo ws1-t4 §7: `/api/files/<id>` no existe — la subida YA
    // devuelve la URL firmada del bucket (ver upload/route.ts, hallazgo
    // ws1-t11), lista para usarse tal cual.
    if (!json.signedUrl) {
      setError("La foto se subió, pero no se pudo generar la vista previa. Recarga la página.");
      return;
    }
    setImageUrl(json.signedUrl);
    setPoints({});
  }

  return (
    <div className="px-[18px] py-[14px]">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <select
          value={view}
          onChange={(e) => {
            setView(e.target.value as "perfil" | "frente");
            setImageUrl(null);
            setPoints({});
          }}
          className={orto.entrada}
          style={{ width: "auto", flex: "1 1 150px" }}
          aria-label="Vista de la foto"
        >
          <option value="perfil">Foto de perfil</option>
          <option value="frente">Foto de frente</option>
        </select>
        <label className={`${orto.boton} ${orto.botonSubir}`}>
          <Camera size={15} strokeWidth={1.75} aria-hidden />
          {imageUrl ? "Cambiar foto" : "Subir foto"}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handlePick(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {error ? (
        <div className={`${orto.aviso} ${orto.avisoPeligro} mb-3`} role="alert">
          {error}
        </div>
      ) : null}

      {imageUrl ? (
        <PhotoLineAnalyzer imageUrl={imageUrl} view={view} initialPoints={points} onChange={setPoints} />
      ) : (
        <div className={orto.vacio}>
          <p className={orto.vacioTitulo}>Sin foto de {view}</p>
          <p className={orto.vacioPista}>Sube una para marcar líneas y ángulos.</p>
        </div>
      )}
    </div>
  );
}
