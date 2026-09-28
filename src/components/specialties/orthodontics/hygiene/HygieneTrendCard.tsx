"use client";
// Orthodontics — Ola 1 (ws1-t4, Control y agenda, sep-2026), C8 del documento de alcance:
// "gráfica de higiene y cooperación (placa, encía, manchas blancas, uso de elásticos) en el caso, y
// un aviso (en el panel, no WhatsApp) si empeora en los últimos controles".
//
// Archivo NUEVO, carpeta nueva (`hygiene/`) — a propósito, para no competir con quien más edite
// `redesign/sections/` en esta misma Ola 1. Recibe `treatmentCards` ya cargadas por el padre (la
// ficha ya las trae para `SectionTreatmentCards`); no hace fetch propio.

import { AlertTriangle, Sparkles } from "lucide-react";
import { Card } from "../redesign/atoms/Card";
import { Pill } from "../redesign/atoms/Pill";
import { fmtDateShort } from "../redesign/atoms/format";
import orto from "../redesign/orto.module.css";
import {
  buildHygieneTrend,
  detectHygieneWorsening,
} from "@/lib/orthodontics/redesign/hygiene-trend";
import type { TreatmentCardDTO } from "../redesign/types";

export interface HygieneTrendCardProps {
  treatmentCards: TreatmentCardDTO[];
}

export function HygieneTrendCard({ treatmentCards }: HygieneTrendCardProps) {
  const trend = buildHygieneTrend(treatmentCards);
  // Sin controles firmados todavía: nada que graficar (caso recién abierto).
  if (trend.length === 0) return null;

  const alert = detectHygieneWorsening(trend);
  const points = trend.slice(-12); // últimos 12 controles — suficiente para ver tendencia sin apretar

  return (
    <Card
      icon={<Sparkles size={15} strokeWidth={1.75} />}
      title="Higiene y cooperación"
      eyebrow="Placa y encías en los últimos controles"
      accent={alert.worsening ? "rose" : "emerald"}
    >
      <div className={`${orto.tarjetaCuerpo} flex flex-col gap-3`}>
        {alert.worsening ? (
          <div className={`${orto.aviso} ${orto.avisoPeligro}`} style={{ alignItems: "flex-start", justifyContent: "flex-start" }}>
            <AlertTriangle size={16} strokeWidth={1.75} className="flex-shrink-0 mt-[1px]" aria-hidden />
            <div className={orto.avisoTexto}>
              <div className="font-semibold">Empeoró en los últimos controles</div>
              <ul className="list-disc list-inside mt-0.5">
                {alert.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        <div className="flex items-end gap-2 h-20">
          {points.map((p) => (
            <div
              key={p.cardId}
              className="flex-1 flex flex-col items-center justify-end gap-1"
              title={`Control ${p.cardNumber} · ${fmtDateShort(p.visitDate)} · placa ${p.plaquePct ?? "—"}%`}
            >
              <div
                className={`w-full max-w-[28px] rounded-[4px] ${plaqueBarColor(p.plaquePct)}`}
                style={{ height: `${Math.max(4, p.plaquePct ?? 0)}%` }}
                aria-hidden
              />
              <span className="text-[11px] text-[color:var(--pr-texto-3)] whitespace-nowrap">
                {fmtDateShort(p.visitDate)}
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[color:var(--pr-texto-3)]">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-[3px] bg-[color:var(--pr-exito)]" aria-hidden /> Placa
            baja
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-[3px] bg-[color:var(--pr-alerta)]" aria-hidden /> Media
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-[3px] bg-[color:var(--pr-peligro)]" aria-hidden /> Alta
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {points.map((p) => (
            <Pill key={p.cardId} color={gingivitisColor(p.gingivitis)} size="xs">
              #{p.cardNumber} · {p.gingivitis ? gingivitisText(p.gingivitis) : "sin dato"}
              {p.whiteSpots ? " · manchas" : ""}
              {p.hadElastics ? " · elásticos" : ""}
            </Pill>
          ))}
        </div>
      </div>
    </Card>
  );
}

function plaqueBarColor(plaquePct: number | null): string {
  if (plaquePct == null) return "bg-[color:var(--pr-borde)]";
  if (plaquePct < 25) return "bg-[color:var(--pr-exito)]";
  if (plaquePct < 50) return "bg-[color:var(--pr-alerta)]";
  return "bg-[color:var(--pr-peligro)]";
}

function gingivitisColor(g: TreatmentCardDTO["hygiene"]["gingivitis"]): "emerald" | "amber" | "rose" | "slate" {
  if (g === "AUSENTE") return "emerald";
  if (g === "LEVE") return "amber";
  if (g === "MODERADA" || g === "SEVERA") return "rose";
  return "slate";
}

function gingivitisText(g: NonNullable<TreatmentCardDTO["hygiene"]["gingivitis"]>): string {
  const labels: Record<string, string> = {
    AUSENTE: "ausente",
    LEVE: "leve",
    MODERADA: "moderada",
    SEVERA: "severa",
  };
  return labels[g] ?? g;
}
