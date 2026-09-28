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
//
// ws1-t5 (ronda 6): las encuestas se SIEMBRAN pero ningún proceso las envía,
// y Referidos no tiene de dónde sacar un código. La sección ya no promete el
// envío ni pinta tarjetas vacías: qué se enseña lo decide
// `vistaDePostratamiento` (lib/orthodontics/redesign/postratamiento.ts, con
// test). Nada se borra; el día que el envío se conecte, las tarjetas vuelven
// solas en cuanto haya una encuesta enviada o un código.

import { FileText, RefreshCw, Star } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { Card } from "../atoms/Card";
import { Pill } from "../atoms/Pill";
import orto from "../orto.module.css";
import { vistaDePostratamiento } from "@/lib/orthodontics/redesign/postratamiento";

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

// Clases literales: Tailwind solo genera las que ve escritas.
const COLUMNAS: Record<1 | 2 | 3, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
};

export function SectionPostTreatment(props: SectionPostTreatmentProps) {
  const isActive = props.treatmentStatus === "completado";
  const vista = vistaDePostratamiento({
    encuestas: props.npsSchedules,
    codigoDeReferidos: props.referralCode?.code,
  });

  const code = props.referralCode?.code ?? "—";
  const referralCount = props.referralCode?.referralCount ?? 0;

  return (
    <Card
      id="post"
      icon={<Star size={15} strokeWidth={1.75} />}
      title="Post-tratamiento"
      eyebrow={vista.subtitulo}
      action={
        <Pill color={isActive ? "emerald" : "slate"}>
          {isActive ? "Activa" : "Al terminar el tratamiento"}
        </Pill>
      }
    >
      <div className={`px-[18px] py-[16px] grid grid-cols-1 ${COLUMNAS[vista.tarjetas]} gap-3`}>
        <div className={orto.caja} style={{ padding: "14px" }}>
          <div className="flex items-center gap-2 mb-2">
            <FileText
              className="w-4 h-4 text-[color:var(--orto-violeta)]"
              aria-hidden
            />
            <div className="text-[13px] font-semibold text-[color:var(--pr-texto)]">
              PDF antes/después
            </div>
          </div>
          <div className="text-xs text-[color:var(--pr-texto-3)] mb-3">
            Comparativa del inicio contra el final, con los datos de la clínica, lista para
            imprimir y entregar al paciente.
          </div>
          {props.onGeneratePdf ? (
            <Btn
              variant="secondary"
              size="sm"
              className="w-full"
              disabled={!isActive}
              onClick={props.onGeneratePdf}
            >
              {isActive ? "Generar PDF" : "Disponible al terminar"}
            </Btn>
          ) : null}
        </div>

        {vista.encuesta.visible ? (
          <div className={orto.caja} style={{ padding: "14px" }}>
            <div className="flex items-center gap-2 mb-2">
              <Star
                className="w-4 h-4 text-[color:var(--orto-violeta)]"
                aria-hidden
              />
              <div className="text-[13px] font-semibold text-[color:var(--pr-texto)]">
                Encuesta de satisfacción
              </div>
            </div>
            <div className="text-xs text-[color:var(--pr-texto-3)] mb-3">
              Lo que respondió el paciente después de retirar los brackets.
            </div>
            <div className="flex items-center justify-between mb-2">
              <Pill color="violet" size="xs">
                {vista.encuesta.resumen}
              </Pill>
              {vista.encuesta.resenaPedida ? (
                <Pill color="emerald" size="xs">
                  Reseña de Google pedida
                </Pill>
              ) : null}
            </div>
            <div className="space-y-1 text-[11px] text-[color:var(--pr-texto-2)]">
              {vista.encuesta.filas.map((fila) => (
                <div key={fila.clave} className="flex justify-between">
                  <span>{fila.etiqueta}</span>
                  <span className="tabular-nums">{fila.estado}</span>
                </div>
              ))}
            </div>
            {props.onConfigureNps ? (
              <Btn
                variant="secondary"
                size="sm"
                className="w-full mt-3"
                onClick={props.onConfigureNps}
              >
                Configurar
              </Btn>
            ) : null}
          </div>
        ) : null}

        {vista.referidos.visible ? (
          <div className={orto.caja} style={{ padding: "14px" }}>
            <div className="flex items-center gap-2 mb-2">
              <RefreshCw
                className="w-4 h-4 text-[color:var(--orto-violeta)]"
                aria-hidden
              />
              <div className="text-[13px] font-semibold text-[color:var(--pr-texto)]">
                Referidos
              </div>
            </div>
            <div className="text-xs text-[color:var(--pr-texto-3)] mb-1">
              Código del paciente
            </div>
            {props.onCopyReferralCode ? (
              <button
                type="button"
                onClick={props.onCopyReferralCode}
                className="tabular-nums text-[15px] font-bold text-[color:var(--orto-violeta)] mb-2 hover:underline"
                aria-label={`Copiar código ${code}`}
              >
                {code}
              </button>
            ) : (
              // Sin acción de copiar no se pinta un botón que no hace nada.
              <div className="tabular-nums text-[15px] font-bold text-[color:var(--orto-violeta)] mb-2">
                {code}
              </div>
            )}
            <div className="text-[11px] text-[color:var(--pr-texto-3)]">
              {referralCount} referido{referralCount === 1 ? "" : "s"}
            </div>
            {props.referralCode?.rewardLabel ? (
              <div className="mt-2 text-[11px] text-[color:var(--pr-exito)]">
                Premio configurado: {props.referralCode.rewardLabel}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
