"use client";
// Sección H — Post-tratamiento · G11 NPS + Google review + referidos.
//
// 3 cards horizontales:
//   1. PDF antes/después (icon documento, CTA "Generar (al debond)")
//   2. Encuesta NPS (icon star, CTA "Programada", trigger +3d post-debond)
//   3. Programa referidos (icon refresh, código personalizado GABY26 + count)
//
// Triggers automáticos (por server actions):
//   - NPS scheduler: status → "completado" → 3 NPS programadas (3d/6m/12m)
//   - Si NPS ≥ 9 → trigger Google review (M2 Sparkles via WhatsApp)

import { FileText, RefreshCw, Star } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { Card } from "../atoms/Card";
import { Pill } from "../atoms/Pill";

export interface ReferralCodeDTO {
  code: string;
  referralCount: number;
  rewardLabel: string | null;
}

export interface NpsScheduleDTO {
  npsType: "POST_DEBOND_3D" | "POST_DEBOND_6M" | "POST_DEBOND_12M";
  status: "SCHEDULED" | "SENT" | "RESPONDED" | "EXPIRED" | "CANCELLED";
  scheduledAt: string;
  npsScore: number | null;
  googleReviewTriggered: boolean;
}

export interface SectionPostTreatmentProps {
  /** Estado del tratamiento — H solo "activa" cuando completado. */
  treatmentStatus: "no-iniciado" | "en-tratamiento" | "retencion" | "completado";
  /** NPS programadas (puede tener 3 entries: +3d, +6m, +12m). */
  npsSchedules: NpsScheduleDTO[];
  /** Código de referidos del paciente. */
  referralCode: ReferralCodeDTO | null;
  onGeneratePdf?: () => void;
  onConfigureNps?: () => void;
  onCopyReferralCode?: () => void;
}

const NPS_LABEL: Record<NpsScheduleDTO["npsType"], string> = {
  POST_DEBOND_3D: "+3 días",
  POST_DEBOND_6M: "+6 meses",
  POST_DEBOND_12M: "+12 meses",
};

export function SectionPostTreatment(props: SectionPostTreatmentProps) {
  const isActive = props.treatmentStatus === "completado";
  const npsBadgeText =
    props.npsSchedules.length === 0
      ? "Sin programar"
      : `${props.npsSchedules.filter((n) => n.status === "RESPONDED").length}/${props.npsSchedules.length} respondidas`;

  const code = props.referralCode?.code ?? "—";
  const referralCount = props.referralCode?.referralCount ?? 0;

  return (
    <Card
      id="post"
      eyebrow="Sección H · G11 NPS + Google review"
      title="Post-tratamiento"
      action={
        <Pill color={isActive ? "emerald" : "slate"} size="xs">
          {isActive ? "Activa" : "Activa al completar debonding"}
        </Pill>
      }
    >
      <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50 dark:bg-slate-900/40 dark:border-slate-700">
          <div className="flex items-center gap-2 mb-2">
            <FileText
              className="w-4 h-4 text-violet-600 dark:text-violet-300"
              aria-hidden
            />
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              PDF antes/después
            </div>
          </div>
          <div className="text-[11px] text-slate-500 mb-3 dark:text-slate-400">
            Comparativa T0 vs final con branding clínica · listo para imprimir y entregar
            al paciente.
          </div>
          {props.onGeneratePdf ? (
            <Btn
              variant="secondary"
              size="sm"
              className="w-full justify-center"
              disabled={!isActive}
              onClick={props.onGeneratePdf}
            >
              {isActive ? "Generar PDF" : "Generar (al debond)"}
            </Btn>
          ) : null}
        </div>

        <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50 dark:bg-slate-900/40 dark:border-slate-700">
          <div className="flex items-center gap-2 mb-2">
            <Star
              className="w-4 h-4 text-amber-500 dark:text-amber-400"
              aria-hidden
            />
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Encuesta NPS
            </div>
          </div>
          <div className="text-[11px] text-slate-500 mb-3 dark:text-slate-400">
            Envío automático WhatsApp +3 días post-debond. Si NPS ≥ 9 → trigger Google
            review.
          </div>
          <div className="flex items-center justify-between mb-2">
            <Pill
              color={props.npsSchedules.length === 0 ? "slate" : "violet"}
              size="xs"
            >
              {npsBadgeText}
            </Pill>
            {props.npsSchedules.some((n) => n.googleReviewTriggered) ? (
              <Pill color="emerald" size="xs">
                Google review enviada
              </Pill>
            ) : null}
          </div>
          {props.npsSchedules.length > 0 ? (
            <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
              {props.npsSchedules.map((n) => (
                <div key={n.npsType} className="flex justify-between">
                  <span>NPS {NPS_LABEL[n.npsType]}</span>
                  <span className="font-mono">
                    {n.status === "RESPONDED" && n.npsScore != null
                      ? `${n.npsScore}/10`
                      : n.status.toLowerCase()}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {props.onConfigureNps ? (
            <Btn
              variant="secondary"
              size="sm"
              className="w-full justify-center mt-3"
              onClick={props.onConfigureNps}
            >
              Configurar
            </Btn>
          ) : null}
        </div>

        <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50 dark:bg-slate-900/40 dark:border-slate-700">
          <div className="flex items-center gap-2 mb-2">
            <RefreshCw
              className="w-4 h-4 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            />
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Programa referidos
            </div>
          </div>
          <div className="text-[11px] text-slate-500 mb-1 dark:text-slate-400">
            Código personalizado del paciente:
          </div>
          <button
            type="button"
            onClick={props.onCopyReferralCode}
            className="font-mono text-base font-bold text-violet-700 mb-2 hover:underline dark:text-violet-300"
            aria-label={`Copiar código ${code}`}
          >
            {code}
          </button>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {referralCount} referido{referralCount === 1 ? "" : "s"} · placeholder G12
            (Fase 3)
          </div>
          {props.referralCode?.rewardLabel ? (
            <div className="mt-2 text-[10px] text-emerald-700 dark:text-emerald-400">
              Premio configurado: {props.referralCode.rewardLabel}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
