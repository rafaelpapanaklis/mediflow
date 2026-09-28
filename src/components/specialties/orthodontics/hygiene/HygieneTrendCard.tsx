"use client";
// Orthodontics — Ola 1 (ws1-t4, Control y agenda, sep-2026), C8 del documento de alcance:
// "gráfica de higiene y cooperación (placa, encía, manchas blancas, uso de elásticos) en el caso, y
// un aviso (en el panel, no WhatsApp) si empeora en los últimos controles".
//
// Archivo NUEVO, carpeta nueva (`hygiene/`) — a propósito, para no competir con quien más edite
// `redesign/sections/` en esta misma Ola 1. Recibe `treatmentCards` ya cargadas por el padre (la
// ficha ya las trae para `SectionTreatmentCards`); no hace fetch propio.

import { AlertTriangle } from "lucide-react";
import { Card } from "../redesign/atoms/Card";
import { Pill } from "../redesign/atoms/Pill";
import { fmtDateShort } from "../redesign/atoms/format";
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
      eyebrow="Últimos controles"
      title="Higiene y cooperación"
      accent={alert.worsening ? "rose" : "emerald"}
    >
      <div className="px-6 py-4 space-y-3">
        {alert.worsening ? (
          <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-300">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden />
            <div>
              <div className="font-medium">Empeoró en los últimos controles</div>
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
              title={`Cita #${p.cardNumber} · ${fmtDateShort(p.visitDate)}`}
            >
              <div
                className={`w-full rounded-sm ${plaqueBarColor(p.plaquePct)}`}
                style={{ height: `${Math.max(4, p.plaquePct ?? 0)}%` }}
                aria-hidden
              />
              <span className="text-[9px] text-slate-400 dark:text-slate-500">
                {fmtDateShort(p.visitDate)}
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-400" aria-hidden /> Placa
            baja
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400" aria-hidden /> Media
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-400" aria-hidden /> Alta
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
  if (plaquePct == null) return "bg-slate-200 dark:bg-slate-700";
  if (plaquePct < 25) return "bg-emerald-400";
  if (plaquePct < 50) return "bg-amber-400";
  return "bg-rose-400";
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
