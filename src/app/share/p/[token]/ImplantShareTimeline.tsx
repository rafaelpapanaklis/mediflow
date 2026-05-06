"use client";

/**
 * Timeline visual de fases implantológicas para presentación al paciente.
 * Sin métricas crudas (BoP, ISQ) — lenguaje accesible.
 */
import * as React from "react";
import {
  Compass,
  Stethoscope,
  Heart,
  Scissors,
  Crown,
  Activity,
  Check,
} from "lucide-react";

interface FollowUp {
  milestone: string;
  performedAt: string | null;
  meetsAlbrektssonCriteria: boolean | null;
}

export interface ImplantShareData {
  toothFdi: number;
  brand: string;
  modelName: string;
  diameterMm: string;
  lengthMm: string;
  placedAt: string;
  currentStatus: string;
  protocol: string;
  surgicalAt: string | null;
  healingStartedAt: string | null;
  healingCompletedAt: string | null;
  healingExpectedWeeks: number | null;
  secondStageAt: string | null;
  prosthesisDeliveredAt: string | null;
  followUps: FollowUp[];
}

interface PhaseDef {
  key: string;
  label: string;
  description: string;
  icon: typeof Compass;
  date: string | null;
  isComplete: boolean;
}

function fmt(iso: string | null): string {
  if (!iso) return "Pendiente";
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export default function ImplantShareTimeline({
  implant,
}: {
  implant: ImplantShareData;
}) {
  const phases: PhaseDef[] = [
    {
      key: "planning",
      label: "Planificación",
      description: "Definimos juntos el implante ideal para tu caso.",
      icon: Compass,
      date: implant.placedAt,
      isComplete: true,
    },
    {
      key: "surgery",
      label: "Colocación",
      description: "Cirugía guiada y mínimamente invasiva.",
      icon: Stethoscope,
      date: implant.surgicalAt,
      isComplete: !!implant.surgicalAt,
    },
    {
      key: "healing",
      label: "Cicatrización",
      description: implant.healingExpectedWeeks
        ? `Tu hueso integra el implante. Aproximadamente ${implant.healingExpectedWeeks} semanas.`
        : "Tu hueso integra el implante.",
      icon: Heart,
      date: implant.healingStartedAt,
      isComplete: !!implant.healingCompletedAt,
    },
    {
      key: "second_stage",
      label: "Segunda fase",
      description: "Pequeño descubrimiento si tu protocolo lo requiere.",
      icon: Scissors,
      date: implant.secondStageAt,
      isComplete: !!implant.secondStageAt,
    },
    {
      key: "prosthetic",
      label: "Tu corona",
      description: "Entrega de la corona definitiva.",
      icon: Crown,
      date: implant.prosthesisDeliveredAt,
      isComplete: !!implant.prosthesisDeliveredAt,
    },
    {
      key: "follow_up",
      label: "Controles",
      description:
        implant.followUps.length > 0
          ? `${implant.followUps.length} control(es) realizados.`
          : "Visitas periódicas para mantenerlo saludable.",
      icon: Activity,
      date: implant.followUps[0]?.performedAt ?? null,
      isComplete: implant.followUps.some((f) => f.performedAt),
    },
  ];

  return (
    <section>
      <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-1 text-base font-semibold">Tu implante</h2>
        <p className="text-sm">
          Diente {implant.toothFdi} · {implant.brand}{" "}
          {implant.diameterMm}×{implant.lengthMm} mm
        </p>
        <p className="text-xs text-[var(--color-muted-fg)]">
          Colocado el {fmt(implant.placedAt)}
        </p>
      </div>

      <ol className="relative space-y-6 border-l border-[var(--border)] pl-6">
        {phases.map((p) => {
          const Icon = p.icon;
          return (
            <li key={p.key} className="relative">
              <span
                aria-hidden
                className={`absolute -left-[34px] flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                  p.isComplete
                    ? "border-[var(--color-success-fg)] bg-[var(--color-success-fg)] text-[var(--color-success-bg)]"
                    : "border-[var(--border)] bg-[var(--background)] text-[var(--color-muted-fg)]"
                }`}
              >
                {p.isComplete ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Icon className="h-3 w-3" />
                )}
              </span>
              <div
                className={`rounded-lg border p-4 ${
                  p.isComplete
                    ? "border-[var(--border)] bg-[var(--card)]"
                    : "border-dashed border-[var(--border)] bg-[var(--background)]"
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{p.label}</h3>
                  <span className="text-xs text-[var(--color-muted-fg)]">
                    {fmt(p.date)}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-muted-fg)]">
                  {p.description}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
