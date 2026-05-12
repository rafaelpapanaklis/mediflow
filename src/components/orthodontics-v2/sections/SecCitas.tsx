// Sección E · Citas & evolución — timeline de Treatment Cards + KPIs compliance.

"use client";

import { Plus, Calendar } from "lucide-react";
import { TreatmentCardItem } from "@/components/orthodontics-v2/atoms";
import type { OrthoCaseBundle } from "@/lib/orthodontics-v2/types";

interface SecCitasProps {
  bundle: OrthoCaseBundle;
  onCmd: (cmd: string) => void;
}

export function SecCitas({ bundle, onCmd }: SecCitasProps) {
  const cards = bundle.cards;

  if (cards.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card px-8 py-14 text-center shadow-sm">
        <Calendar className="mx-auto h-9 w-9 text-muted-foreground" />
        <h2 className="mt-3 text-lg font-semibold">Sin Treatment Cards</h2>
        <p className="mx-auto mt-1.5 mb-4 max-w-md text-xs text-muted-foreground">
          Las Treatment Cards se llenan después de cada cita. Empieza por la instalación inicial.
        </p>
        <button
          onClick={() => onCmd("drawer-new-tc")}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-2 text-xs text-white hover:bg-blue-600"
        >
          <Plus className="h-3 w-3" /> Nueva Treatment Card
        </button>
      </div>
    );
  }

  const complianceScores = cards
    .map((c) => c.elasticUse?.reportedCompliance)
    .filter((v): v is number => typeof v === "number");
  const avgCompliance = complianceScores.length
    ? Math.round(complianceScores.reduce((a, b) => a + b, 0) / complianceScores.length)
    : 0;
  const brokenBracketsCount = cards.reduce((sum, c) => sum + c.bracketsLost.length, 0);
  const completedAttendance = cards.filter((c) => c.signedOffAt).length;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Citas y evolución · Treatment Cards</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {cards.length} cards · próxima sugerida {cards[0]?.nextSuggestedAt ? new Date(cards[0].nextSuggestedAt).toLocaleDateString("es-MX") : "—"}
          </p>
        </div>
        <button
          onClick={() => onCmd("drawer-new-tc")}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-2.5 py-1.5 text-xs text-white hover:bg-blue-600"
        >
          <Plus className="h-3 w-3" /> Nueva card
        </button>
      </div>

      {/* Compliance bar */}
      <div className="grid grid-cols-2 gap-3.5 rounded-2xl border border-border bg-card p-4 shadow-sm md:grid-cols-4">
        <div>
          <div className="font-mono text-[10px] uppercase text-muted-foreground">Compliance global</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-blue-700">{avgCompliance}%</div>
          <div className="text-[11px] text-muted-foreground">elást + asist</div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-muted-foreground">Asistencia</div>
          <div className="mt-1 font-mono text-2xl font-semibold">
            {completedAttendance}/{cards.length}
          </div>
          <div className="text-[11px] text-emerald-600">100% · sin faltas</div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-muted-foreground">
            Uso elásticos prom.
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold text-amber-600">{avgCompliance}%</div>
          <div className="text-[11px] text-muted-foreground">hrs / día</div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-muted-foreground">Brackets caídos</div>
          <div className="mt-1 font-mono text-2xl font-semibold">{brokenBracketsCount}</div>
          <div className="text-[11px] text-muted-foreground">recolocados</div>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex flex-col gap-2.5">
        {cards.map((card, i) => (
          <TreatmentCardItem
            key={card.id}
            card={card}
            index={cards.length - i}
            onEdit={() => onCmd(`drawer-edit-tc:${card.id}`)}
            onPrint={() => onCmd(`print-card:${card.id}`)}
          />
        ))}
      </div>
    </div>
  );
}
