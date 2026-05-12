// Sección A · Resumen — hero KPIs + fase stepper + quick actions + dx + última cita.

"use client";

import { Layers, Wand2, TrendingUp, Wallet, CalendarPlus, Camera, ArrowRight, DollarSign, ChevronRight } from "lucide-react";
import { StatCardKPI } from "@/components/orthodontics-v2/atoms";
import type { OrthoCaseBundle } from "@/lib/orthodontics-v2/types";

const PHASES = [
  { k: "ALIGNMENT", l: "Alineación" },
  { k: "LEVELING", l: "Nivelación" },
  { k: "SPACE_CLOSE", l: "Cierre" },
  { k: "DETAIL", l: "Detalles" },
  { k: "FINISHING", l: "Finalización" },
  { k: "RETENTION", l: "Retención" },
];

interface SecResumenProps {
  bundle: OrthoCaseBundle;
  onCmd: (cmd: string) => void;
}

export function SecResumen({ bundle, onCmd }: SecResumenProps) {
  const { case: caso, plan, financialPlan, cards } = bundle;
  const currentArch = plan?.arches.find((a) => a.status === "CURRENT");
  const phaseIdx = caso.currentPhase
    ? PHASES.findIndex((p) => p.k === caso.currentPhase)
    : -1;
  const totalArches = plan?.arches.length ?? 0;
  const archesPast = plan?.arches.filter((a) => a.status === "PAST").length ?? 0;
  const lastCard = cards[0];
  const paidInst = financialPlan?.installments.filter((i) => i.status === "PAID").length ?? 0;
  const totalInst = financialPlan?.installments.length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <StatCardKPI
          label="Fase actual"
          value={caso.currentPhase ? PHASES.find((p) => p.k === caso.currentPhase)?.l ?? caso.currentPhase : "—"}
          sub={currentArch ? `Arco ${currentArch.order} de ${totalArches}` : `${archesPast}/${totalArches} arcos`}
          accent
        />
        <StatCardKPI
          label="Arco colocado"
          value={currentArch ? currentArch.gauge : "—"}
          sub={currentArch ? `Sem · ${currentArch.durationW}` : ""}
        />
        <StatCardKPI
          label="Compliance"
          value="—"
          sub="elást · asist"
        />
        <StatCardKPI
          label="Plan financiero"
          value={totalInst > 0 ? `${paidInst}/${totalInst}` : "—"}
          sub={financialPlan ? `$${Number(financialPlan.monthly).toLocaleString()}` : ""}
        />
      </div>

      {/* Stepper de fases */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Progreso por fase</h3>
          <span className="font-mono text-[11px] text-muted-foreground">
            {archesPast} / {totalArches} arcos completados
          </span>
        </div>
        <div className="flex gap-1.5">
          {PHASES.map((p, i) => {
            const state = phaseIdx === -1 ? "future" : i < phaseIdx ? "done" : i === phaseIdx ? "current" : "future";
            return (
              <div
                key={p.k}
                className={`flex-1 rounded-lg border px-3 py-2.5 ${
                  state === "done"
                    ? "bg-emerald-50 border-emerald-200"
                    : state === "current"
                      ? "bg-blue-50 border-blue-500 shadow-[0_0_16px_rgba(124,58,237,.3)]"
                      : "bg-muted/40 border-border"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full font-mono text-[10px] font-semibold ${
                      state === "done"
                        ? "bg-emerald-500 text-white"
                        : state === "current"
                          ? "bg-blue-500 text-white"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="text-xs font-medium">{p.l}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick actions */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold">Acciones rápidas</h3>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {(
            [
              { icon: CalendarPlus, label: "Registrar cita hoy", key: "N", cmd: "drawer-new-tc" },
              { icon: Camera, label: "Subir foto-set", key: "F", cmd: "drawer-upload-photos" },
              { icon: ArrowRight, label: "Avanzar al arco siguiente", key: "A", cmd: "advance-arch" },
              { icon: DollarSign, label: "Cobrar próxima", key: "C", cmd: "drawer-collect" },
            ] as const
          ).map(({ icon: Icon, label, key, cmd }) => (
            <button
              key={cmd}
              onClick={() => onCmd(cmd)}
              className="flex flex-col items-start gap-1.5 rounded-xl border border-border bg-card p-3 text-left hover:bg-muted"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-medium">{label}</span>
              <span className="font-mono text-[10px] text-muted-foreground">tecla {key}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Diagnóstico — resumen</h3>
            <button
              onClick={() => onCmd("nav-expediente")}
              className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Ver completo <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          {bundle.diagnosis ? (
            <div className="grid grid-cols-3 gap-2.5 text-xs">
              <div>
                <div className="font-mono text-[10px] uppercase text-muted-foreground">
                  Clase Angle
                </div>
                <div className="mt-0.5 font-medium">{bundle.diagnosis.angleClass}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase text-muted-foreground">
                  Resalte
                </div>
                <div className="mt-0.5 font-mono font-medium">
                  {bundle.diagnosis.overjetMm ?? "—"} mm
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase text-muted-foreground">
                  Sobremordida
                </div>
                <div className="mt-0.5 font-mono font-medium">
                  {bundle.diagnosis.overbiteMm ?? "—"} mm
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Aún sin diagnóstico capturado.</p>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {lastCard ? `Última cita · #${cards.length}` : "Última cita"}
            </h3>
            <button
              onClick={() => onCmd("nav-citas")}
              className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Ver <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          {lastCard ? (
            <div className="flex flex-col gap-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                  {lastCard.visitType}
                </span>
                <span className="font-mono text-muted-foreground">
                  {new Date(lastCard.visitDate).toLocaleDateString("es-MX")}
                </span>
              </div>
              <p className="text-muted-foreground line-clamp-2">{lastCard.soap.p}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Sin Treatment Cards aún.</p>
          )}
        </div>
      </div>
    </div>
  );
}
