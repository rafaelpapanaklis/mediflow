// Sección B · Expediente clínico — diagnóstico estructurado en collapsibles.

"use client";

import { ClipboardList, Pencil, Layers, Ruler, Target, Fingerprint, Activity, Brain, FileText } from "lucide-react";
import { Collapsible } from "@/components/orthodontics-v2/atoms";
import type { OrthoCaseBundle } from "@/lib/orthodontics-v2/types";

const ANGLE_LABELS: Record<string, string> = {
  I: "Clase I",
  II_DIV1: "Clase II División 1",
  II_DIV2: "Clase II División 2",
  III: "Clase III",
  COMBO: "Combinada",
};

const PROFILE_LABELS: Record<string, string> = {
  CONCAVE: "Cóncavo",
  STRAIGHT: "Recto",
  CONVEX: "Convexo",
};

const PATTERN_LABELS: Record<string, string> = {
  BRACHY: "Braquifacial",
  MESO: "Mesofacial",
  DOLICHO: "Dolicofacial",
};

interface SecExpedienteProps {
  bundle: OrthoCaseBundle;
  onCmd: (cmd: string) => void;
}

export function SecExpediente({ bundle, onCmd }: SecExpedienteProps) {
  const dx = bundle.diagnosis;

  if (!dx) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card px-8 py-14 text-center shadow-sm">
        <ClipboardList className="mx-auto h-9 w-9 text-muted-foreground" />
        <h2 className="mt-3 text-lg font-semibold">Sin diagnóstico capturado</h2>
        <p className="mx-auto mt-1.5 mb-4 max-w-md text-xs text-muted-foreground">
          Captura la clasificación de Angle y los hallazgos clínicos para alimentar el plan de
          tratamiento.
        </p>
        <button
          onClick={() => onCmd("drawer-edit-dx")}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-2 text-xs text-white hover:bg-blue-600"
        >
          <Pencil className="h-3 w-3" /> Capturar diagnóstico
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Expediente clínico ortodóntico</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Diagnóstico estructurado · alimenta plan de tratamiento
          </p>
        </div>
        <button
          onClick={() => onCmd("drawer-edit-dx")}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-1.5 text-xs text-white hover:bg-blue-600"
        >
          <Pencil className="h-3 w-3" /> Editar diagnóstico
        </button>
      </div>

      <Collapsible
        title="Clasificación de Angle"
        Icon={Layers}
        summary={`${ANGLE_LABELS[dx.angleClass] ?? dx.angleClass}`}
      >
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">General</div>
            <div className="mt-0.5 font-medium">{ANGLE_LABELS[dx.angleClass] ?? dx.angleClass}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Resalte</div>
            <div className="mt-0.5 font-mono font-medium">{dx.overjetMm ?? "—"} mm</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Sobremord.</div>
            <div className="mt-0.5 font-mono font-medium">{dx.overbiteMm ?? "—"} mm</div>
          </div>
          {dx.subCaninoR && (
            <div>
              <div className="font-mono text-[10px] uppercase text-muted-foreground">Subcanino R</div>
              <div className="mt-0.5 font-medium">{ANGLE_LABELS[dx.subCaninoR]}</div>
            </div>
          )}
          {dx.subCaninoL && (
            <div>
              <div className="font-mono text-[10px] uppercase text-muted-foreground">Subcanino L</div>
              <div className="mt-0.5 font-medium">{ANGLE_LABELS[dx.subCaninoL]}</div>
            </div>
          )}
        </div>
      </Collapsible>

      <Collapsible
        title="Mordida & apiñamiento"
        Icon={Ruler}
        summary={`Apiñ. max ${dx.crowdingMaxMm ?? "—"}mm · mand ${dx.crowdingMandMm ?? "—"}mm`}
      >
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">
              Mordida abierta
            </div>
            <div className="mt-0.5 font-medium">{dx.openBite}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">
              Mordida cruzada
            </div>
            <div className="mt-0.5 font-medium">{dx.crossBite}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">
              Apiñam. maxilar
            </div>
            <div className="mt-0.5 font-mono font-medium">{dx.crowdingMaxMm ?? "—"} mm</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">
              Apiñam. mand.
            </div>
            <div className="mt-0.5 font-mono font-medium">{dx.crowdingMandMm ?? "—"} mm</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">
              Línea media (mm)
            </div>
            <div className="mt-0.5 font-mono font-medium">{dx.midlineDeviation ?? "—"}</div>
          </div>
        </div>
      </Collapsible>

      <Collapsible
        title="Diastemas"
        Icon={Target}
        summary={`${dx.diastemas.length} diastema${dx.diastemas.length === 1 ? "" : "s"}`}
        defaultOpen={dx.diastemas.length > 0}
      >
        {dx.diastemas.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin diastemas registrados.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {dx.diastemas.map((d, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
              >
                {d.teeth[0]} — {d.teeth[1]} · {d.mm} mm
              </span>
            ))}
          </div>
        )}
      </Collapsible>

      <Collapsible
        title="Perfil & patrón skeletal"
        Icon={Fingerprint}
        summary={`${PROFILE_LABELS[dx.facialProfile]} · ${PATTERN_LABELS[dx.skeletalPattern]}`}
      >
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Perfil</div>
            <div className="mt-0.5 font-medium">{PROFILE_LABELS[dx.facialProfile]}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">
              Patrón skeletal
            </div>
            <div className="mt-0.5 font-medium">{PATTERN_LABELS[dx.skeletalPattern]}</div>
          </div>
          {dx.skeletalIssues.length > 0 && (
            <div className="col-span-2">
              <div className="font-mono text-[10px] uppercase text-muted-foreground">
                Problemas esqueletales
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {dx.skeletalIssues.map((s, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </Collapsible>

      <Collapsible
        title="ATM"
        Icon={Activity}
        summary={`${dx.tmjFindings.noise ? "Ruido" : "Sin ruido"} · ${dx.tmjFindings.pain ? "Con dolor" : "Sin dolor"}`}
      >
        <div className="grid grid-cols-4 gap-3 text-xs">
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Ruidos</div>
            <div className="mt-0.5 font-medium">{dx.tmjFindings.noise ? "Sí" : "No"}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Dolor</div>
            <div className="mt-0.5 font-medium">{dx.tmjFindings.pain ? "Sí" : "No"}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Deflexión</div>
            <div className="mt-0.5 font-mono font-medium">{dx.tmjFindings.deflexionMm ?? "—"} mm</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Apertura</div>
            <div className="mt-0.5 font-mono font-medium">{dx.tmjFindings.openingMm ?? "—"} mm</div>
          </div>
        </div>
      </Collapsible>

      <Collapsible
        title="Hábitos parafuncionales"
        Icon={Brain}
        summary={`${dx.habits.length} hábito${dx.habits.length === 1 ? "" : "s"}`}
      >
        {dx.habits.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin hábitos registrados.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {dx.habits.map((h, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700"
              >
                {h}
              </span>
            ))}
          </div>
        )}
      </Collapsible>

      {dx.narrative && (
        <Collapsible
          title="Resumen narrativo"
          Icon={FileText}
          defaultOpen={false}
          summary="texto del doctor"
        >
          <p className="whitespace-pre-wrap text-xs text-foreground">{dx.narrative}</p>
        </Collapsible>
      )}
    </div>
  );
}
