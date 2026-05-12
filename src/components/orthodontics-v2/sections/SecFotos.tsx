// Sección C · Fotos & Rx — sets timeline + photo grid + compare mode.

"use client";

import { useState } from "react";
import { Camera, UploadCloud, Smartphone, Plus, GitCompare } from "lucide-react";
import { PhotoSetCard, PhotoTile } from "@/components/orthodontics-v2/atoms";
import type { OrthoCaseBundle, PhotoSetVM } from "@/lib/orthodontics-v2/types";

interface SecFotosProps {
  bundle: OrthoCaseBundle;
  onCmd: (cmd: string) => void;
}

const ALL_EXTRA_KINDS = [
  "EXTRA_FRONTAL_REST",
  "EXTRA_FRONTAL_SMILE",
  "EXTRA_LAT34",
  "EXTRA_PROFILE_R",
  "EXTRA_PROFILE_L",
] as const;
const ALL_INTRA_KINDS = [
  "INTRA_FRONT",
  "INTRA_LAT_R",
  "INTRA_LAT_L",
  "INTRA_OCCL_UP",
  "INTRA_OCCL_LO",
  "INTRA_OVERJET",
] as const;
const ALL_RX_KINDS = ["RX_PANO", "RX_CEPH", "STL_UP", "STL_LO", "PDF"] as const;

const KIND_LABEL: Record<string, string> = {
  EXTRA_FRONTAL_REST: "Frontal natural",
  EXTRA_FRONTAL_SMILE: "Frontal sonrisa",
  EXTRA_LAT34: "3/4 derecho",
  EXTRA_PROFILE_R: "Perfil derecho",
  EXTRA_PROFILE_L: "Perfil izquierdo",
  INTRA_FRONT: "Frontal oclusión",
  INTRA_LAT_R: "Lateral derecha",
  INTRA_LAT_L: "Lateral izquierda",
  INTRA_OCCL_UP: "Oclusal superior",
  INTRA_OCCL_LO: "Oclusal inferior",
  INTRA_OVERJET: "Sobremordida",
  RX_PANO: "Panorámica",
  RX_CEPH: "Lateral cráneo",
  STL_UP: "Modelo STL ↑",
  STL_LO: "Modelo STL ↓",
  PDF: "PDF externo",
};

export function SecFotos({ bundle, onCmd }: SecFotosProps) {
  const sets = bundle.photoSets;
  const [activeStage, setActiveStage] = useState<string>(
    sets[0]?.stageCode ?? "T0",
  );

  const activeSet = sets.find((s) => s.stageCode === activeStage);

  if (sets.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card px-8 py-14 text-center shadow-sm">
        <Camera className="mx-auto h-9 w-9 text-muted-foreground" />
        <h2 className="mt-3 text-lg font-semibold">Aún sin fotos · sube tu primer foto-set T0</h2>
        <p className="mx-auto mt-1.5 mb-4 max-w-md text-xs text-muted-foreground">
          Las fotos T0 son la base para comparar después con T1, T2... Sube desde computadora o usa
          tu celular.
        </p>
        <div className="flex justify-center gap-2">
          <button
            onClick={() => onCmd("drawer-upload-photos")}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-2 text-xs text-white hover:bg-blue-600"
          >
            <UploadCloud className="h-3 w-3" /> Subir desde computadora
          </button>
          <button
            onClick={() => onCmd("modal-mobile")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-muted"
          >
            <Smartphone className="h-3 w-3" /> Foto desde celular
          </button>
        </div>
      </div>
    );
  }

  const renderGrid = (
    title: string,
    kinds: readonly string[],
    set: PhotoSetVM | undefined,
  ) => (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          {kinds.length} fotos · {activeStage}
        </span>
      </div>
      <div className={`grid gap-2.5 ${kinds.length >= 6 ? "grid-cols-3 md:grid-cols-6" : "grid-cols-3 md:grid-cols-5"}`}>
        {kinds.map((k) => {
          const photo = set?.photos.find((p) => p.kind === k);
          return (
            <div key={k} className="flex flex-col gap-1">
              <PhotoTile
                photo={photo}
                stage={activeStage}
                empty={!photo}
                onClick={() => onCmd(photo ? `lightbox:${photo.id}` : "drawer-upload-photos")}
              />
              <span className="text-center text-[11px] text-muted-foreground">{KIND_LABEL[k] ?? k}</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {sets.map((s) => (
          <PhotoSetCard
            key={s.id}
            stage={s.stageCode}
            date={new Date(s.capturedAt).toLocaleDateString("es-MX", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
            count={s.photos.length}
            total={ALL_EXTRA_KINDS.length + ALL_INTRA_KINDS.length}
            active={activeStage === s.stageCode}
            onClick={() => setActiveStage(s.stageCode)}
          />
        ))}
        <button
          onClick={() => onCmd("drawer-new-stage")}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-muted"
        >
          <Plus className="h-3 w-3" /> Nueva etapa
        </button>
        <div className="flex-1" />
        <button
          onClick={() => onCmd("modal-compare")}
          disabled={sets.length < 2}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
        >
          <GitCompare className="h-3 w-3" /> Comparar
        </button>
        <button
          onClick={() => onCmd("drawer-upload-photos")}
          className="inline-flex items-center gap-1 rounded-md bg-blue-500 px-2.5 py-1.5 text-xs text-white hover:bg-blue-600"
        >
          <UploadCloud className="h-3 w-3" /> Subir
        </button>
      </div>

      {renderGrid("Extraorales", ALL_EXTRA_KINDS, activeSet)}
      {renderGrid("Intraorales", ALL_INTRA_KINDS, activeSet)}
      {renderGrid("Radiografías y modelos 3D", ALL_RX_KINDS, activeSet)}
    </div>
  );
}
