"use client";
// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, ola 1, sep-2026).
// Ranura que reemplaza la tarjeta decorativa «Cefalometría · Próximamente»
// de SectionDiagnosis.tsx (ver REPORTE-ws1-t8.md, «Arquitectura»). Agrupa
// H1/H3/H4 (cefalometría), H5 (fotos con líneas) y H9/H10 (modelo 3D ·
// Bolton) en pestañas — un solo hueco en el grid 2×2 de Diagnóstico.

import { useEffect, useState } from "react";
import { Camera, Loader2, Ruler, Save, Sparkles } from "lucide-react";
import { CephalometriaPanel } from "./CephalometriaPanel";
import { BoltonPanel } from "./BoltonPanel";
import { PhotoLineAnalyzer } from "./PhotoLineAnalyzer";
import type { FacialPoints } from "@/lib/orthodontics/fotos/landmarks";
import type { Size } from "@/lib/orthodontics/fotos/image-coords";
import { getFacialAnalysis, type FacialAnalysisView } from "@/app/actions/orthodontics/imagen/getFacialAnalysis";
import { saveFacialAnalysis } from "@/app/actions/orthodontics/imagen/saveFacialAnalysis";
import { isFailure } from "@/app/actions/orthodontics/result";
import type { ArchivoDelPaciente } from "@/app/actions/orthodontics/imagen/archivosDelPaciente";
import { ElegirArchivoDelPaciente } from "./ElegirArchivoDelPaciente";
import { Btn } from "../redesign/atoms/Btn";
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
      {tab === "fotos" ? <FacialAnalysisTab treatmentPlanId={treatmentPlanId} patientId={patientId} /> : null}
      {tab === "modelo3d" ? <BoltonPanel patientId={patientId} treatmentPlanId={treatmentPlanId} /> : null}
    </div>
  );
}

function FacialAnalysisTab({ treatmentPlanId, patientId }: { treatmentPlanId: string; patientId: string }) {
  const [view, setView] = useState<FacialAnalysisView>("PERFIL");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [photoFileId, setPhotoFileId] = useState<string | null>(null);
  const [points, setPoints] = useState<FacialPoints>({});
  const [imageSize, setImageSize] = useState<Size | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState(false);
  const [dirty, setDirty] = useState(false);
  // H13: usar una foto que ya está en el expediente en vez de subirla otra vez.
  const [eligiendo, setEligiendo] = useState(false);

  // Reabre el análisis ya guardado de esta vista, si lo hay (H19: "que el
  // análisis se pueda volver a abrir").
  useEffect(() => {
    let cancelled = false;
    setCargando(true);
    setError(null);
    getFacialAnalysis(treatmentPlanId, view).then((res) => {
      if (cancelled) return;
      setCargando(false);
      if (isFailure(res)) {
        setImageUrl(null);
        setPhotoFileId(null);
        setPoints({});
        return;
      }
      if (res.data && res.data.photoFileUrl) {
        setImageUrl(res.data.photoFileUrl);
        setPhotoFileId(res.data.photoFileId);
        setPoints(res.data.points);
        setImageSize(
          res.data.imageWidth && res.data.imageHeight
            ? { width: res.data.imageWidth, height: res.data.imageHeight }
            : null,
        );
      } else {
        setImageUrl(null);
        setPhotoFileId(null);
        setPoints({});
        setImageSize(null);
      }
      setDirty(false);
    });
    return () => {
      cancelled = true;
    };
  }, [treatmentPlanId, view]);

  async function handlePick(file: File) {
    setError(null);
    setGuardadoOk(false);
    const form = new FormData();
    form.append("file", file);
    form.append("patientId", patientId);
    form.append("kind", view === "PERFIL" ? "facial-perfil" : "facial-frente");
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
    setPhotoFileId(json.fileId ?? null);
    setPoints({});
    setImageSize(null);
    setDirty(true);
  }

  function usarExistente(a: ArchivoDelPaciente) {
    if (!a.thumbUrl) {
      setError("No se pudo generar la vista previa de esa foto. Elige otra o súbela de nuevo.");
      return;
    }
    setError(null);
    setGuardadoOk(false);
    setImageUrl(a.thumbUrl);
    setPhotoFileId(a.id);
    setPoints({});
    setImageSize(null);
    setDirty(true);
    setEligiendo(false);
  }

  async function handleGuardar() {
    if (!imageSize) return;
    setError(null);
    setGuardando(true);
    try {
      const res = await saveFacialAnalysis({
        treatmentPlanId,
        view,
        points,
        imageWidth: imageSize.width,
        imageHeight: imageSize.height,
        photoFileId,
      });
      if (isFailure(res)) {
        setError(res.error);
        return;
      }
      setDirty(false);
      setGuardadoOk(true);
    } catch {
      setError("No se pudo guardar el análisis. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="px-[18px] py-[14px]">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <select
          value={view}
          onChange={(e) => setView(e.target.value as FacialAnalysisView)}
          className={orto.entrada}
          style={{ width: "auto", flex: "1 1 150px" }}
          aria-label="Vista de la foto"
          disabled={guardando}
        >
          <option value="PERFIL">Foto de perfil</option>
          <option value="FRENTE">Foto de frente</option>
        </select>
        <label className={`${orto.boton} ${orto.botonSubir}`} aria-disabled={guardando}>
          <Camera size={15} strokeWidth={1.75} aria-hidden />
          {imageUrl ? "Cambiar foto" : "Subir foto"}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={guardando}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handlePick(f);
              e.target.value = "";
            }}
          />
        </label>
        <button type="button" className={orto.boton} disabled={guardando} onClick={() => setEligiendo((v) => !v)}>
          Usar una foto ya subida
        </button>
      </div>
      {eligiendo ? (
        <ElegirArchivoDelPaciente
          patientId={patientId}
          tipo="imagen"
          titulo="Fotos del expediente (perfil o frente)"
          onElegir={usarExistente}
          onCerrar={() => setEligiendo(false)}
        />
      ) : null}

      {error ? (
        <div className={`${orto.aviso} ${orto.avisoPeligro} mb-3`} role="alert">
          {error}
        </div>
      ) : null}

      {cargando ? (
        <div className={orto.vacioLinea} style={{ minHeight: 44 }} role="status">
          Cargando…
        </div>
      ) : imageUrl ? (
        <>
          <PhotoLineAnalyzer
            imageUrl={imageUrl}
            view={view === "PERFIL" ? "perfil" : "frente"}
            initialPoints={points}
            onChange={(next, size) => {
              setPoints(next);
              setImageSize(size);
              setDirty(true);
              setGuardadoOk(false);
            }}
          />
          {Object.keys(points).length > 0 ? (
            <div className="mt-3 flex items-center gap-2">
              <Btn
                variant="primary"
                size="sm"
                icon={
                  guardando ? (
                    <Loader2 size={14} strokeWidth={1.75} className="animate-spin" aria-hidden />
                  ) : (
                    <Save size={14} strokeWidth={1.75} aria-hidden />
                  )
                }
                onClick={handleGuardar}
                disabled={guardando || !dirty || !imageSize}
              >
                {guardando ? "Guardando…" : dirty ? "Guardar análisis" : "Guardado"}
              </Btn>
              {guardadoOk && !dirty ? (
                <span className="text-xs text-[color:var(--pr-exito)]">Guardado en el caso.</span>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <div className={orto.vacio}>
          <p className={orto.vacioTitulo}>Sin foto de {view === "PERFIL" ? "perfil" : "frente"}</p>
          <p className={orto.vacioPista}>Sube una para marcar líneas y ángulos.</p>
        </div>
      )}
    </div>
  );
}
