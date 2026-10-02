"use client";
// Atom: TimelineRow — fila que se pulsa, una por control registrado. Número
// de control, fecha, fase y mes; debajo, lo que se hizo (arco, elásticos,
// IPR / brackets, higiene) y el plan anotado para la siguiente visita.

import { Camera, ChevronRight } from "lucide-react";
import type { TreatmentCardDTO } from "../types";
import { ELASTIC_CLASS_LABELS, GINGIVITIS_LABELS, PHASE_LABELS } from "../types";
import { fmtDate, clinicalSeverityColor } from "./format";
import { Pill } from "./Pill";
import { progresoDeControles, textoControlQueSigue } from "@/lib/orthodontics/plan-detalle";
import { textoDelMes } from "@/lib/orthodontics/mes-de-tratamiento";
import { textoDeArcoConArcada } from "@/lib/orthodontics/material-de-arco";
import orto from "../orto.module.css";

export interface TimelineRowProps {
  card: TreatmentCardDTO;
  /** ws1-t10: los controles que prevé el plan del caso («Control 3 de 18»). Sin él, «Control 3». */
  controlesPrevistos?: number | null;
  isLast?: boolean;
  onClick?: () => void;
}

export function TimelineRow({ card, controlesPrevistos, onClick }: TimelineRowProps) {
  const textoControl = textoControlQueSigue(progresoDeControles(card.cardNumber - 1, controlesPrevistos ?? null));
  const wireFromLabel = card.wireFrom ? wireLabel(card.wireFrom) : "—";
  const wireToLabel = card.wireTo ? wireLabel(card.wireTo) : null;
  const wireChange = wireToLabel != null && wireFromLabel !== wireToLabel;

  const elasticsSummary =
    card.elastics.length === 0
      ? "—"
      : card.elastics
          .map((e) => `${ELASTIC_CLASS_LABELS[e.elasticClass]} ${e.config}`)
          .join(" · ");

  const iprDone = card.iprPoints.filter((p) => p.done).length;
  const broken = card.brokenBrackets.length;

  const plaque = card.hygiene.plaquePct;
  const plaqueColor = plaque != null ? clinicalSeverityColor(plaque) : "emerald";
  const plaqueTone =
    plaqueColor === "emerald"
      ? orto.tonoExito
      : plaqueColor === "amber"
        ? orto.tonoAlerta
        : orto.tonoPeligro;

  return (
    <button
      type="button"
      onClick={onClick}
      className={orto.listaFila}
      aria-label={`${textoControl} del ${fmtDate(card.visitDate)} — ${PHASE_LABELS[card.phaseKey]}`}
    >
      <span className={orto.numero} aria-hidden>
        {card.cardNumber}
      </span>
      <span className="flex-1 min-w-0 block">
        <span className="flex items-center gap-x-2 gap-y-1 flex-wrap">
          <span className="text-[13.5px] font-semibold">{fmtDate(card.visitDate)}</span>
          <Pill color="violet" size="xs">
            {PHASE_LABELS[card.phaseKey]}
          </Pill>
          <span className={`${orto.tonoApagado} text-xs`}>
            {textoControl} · {textoDelMes(card.monthAt)} · {card.durationMin} min
          </span>
          {card.status === "DRAFT" ? (
            <Pill color="amber" size="xs">
              Borrador
            </Pill>
          ) : null}
          {card.hasProgressPhoto ? (
            <Pill color="emerald" size="xs">
              <Camera size={11} strokeWidth={1.75} aria-hidden /> Foto
            </Pill>
          ) : null}
        </span>
        <span className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-[10px]">
          <Dato rotulo="Arco">
            {wireChange ? (
              <>
                <span className={orto.tonoApagado}>{wireFromLabel}</span>
                {" → "}
                <span className={`${orto.tonoVioleta} font-semibold`}>{wireToLabel}</span>
              </>
            ) : (
              <span>{wireToLabel ?? wireFromLabel}</span>
            )}
          </Dato>
          <Dato rotulo="Elásticos">{elasticsSummary}</Dato>
          <Dato rotulo="IPR / brackets">
            {iprDone > 0 ? <span className={`${orto.tonoExito} mr-2`}>+{iprDone} IPR</span> : null}
            {broken > 0 ? (
              <span className={orto.tonoPeligro}>
                {broken} recementado{broken === 1 ? "" : "s"}
              </span>
            ) : null}
            {iprDone === 0 && broken === 0 ? "—" : null}
          </Dato>
          <Dato rotulo="Placa">
            {plaque != null ? (
              <span className={`${plaqueTone} font-semibold`}>{plaque}%</span>
            ) : (
              <span className={orto.tonoApagado}>—</span>
            )}
            {card.hygiene.gingivitis ? (
              <span className={orto.tonoApagado}>
                {" "}
                · {GINGIVITIS_LABELS[card.hygiene.gingivitis]}
              </span>
            ) : null}
          </Dato>
        </span>
        {card.soap.p ? (
          <span className={`${orto.tonoTexto2} block mt-[8px] text-xs line-clamp-2`}>
            <span className="font-semibold">Plan:</span> {card.soap.p}
          </span>
        ) : null}
      </span>
      {/* La duración va en el renglón de arriba: aquí solo la flecha, para
          que en el teléfono el contenido tenga todo el ancho. */}
      <ChevronRight
        size={16}
        strokeWidth={1.75}
        className={`${orto.tonoApagado} flex-none self-center`}
        aria-hidden
      />
    </button>
  );
}

function Dato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <span className="block min-w-0">
      <span className={`${orto.datoEtiqueta} block`}>{rotulo}</span>
      <span className="block mt-[1px] text-[12.5px] [overflow-wrap:anywhere]">{children}</span>
    </span>
  );
}

/** ws1-t12 (revisión en panel.108, fallo 4): con su arcada, «NiTi 014 · Ambas → NiTi 016 · Superior». */
function wireLabel(wire: { gauge: string; material: string; archUpper?: boolean; archLower?: boolean }): string {
  return textoDeArcoConArcada(wire);
}
