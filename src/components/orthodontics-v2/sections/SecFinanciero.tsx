// Sección F · Plan financiero — escenarios A/B/C + installments + CFDI banner.

"use client";

import { Wallet, DollarSign, Pencil, Send, FileText } from "lucide-react";
import { InstallmentChip } from "@/components/orthodontics-v2/atoms";
import type { OrthoCaseBundle, FinancialScenario } from "@/lib/orthodontics-v2/types";

interface SecFinancieroProps {
  bundle: OrthoCaseBundle;
  onCmd: (cmd: string) => void;
}

function ScenarioCard({
  s,
  onActivate,
}: {
  s: FinancialScenario;
  onActivate?: () => void;
}) {
  return (
    <div
      className={`relative rounded-2xl border p-4 shadow-sm ${
        s.active
          ? "border-blue-500 bg-blue-50 shadow-[0_0_14px_rgba(124,58,237,.3)]"
          : "border-border bg-card"
      }`}
    >
      {s.active && (
        <span className="absolute -top-2 left-3.5 inline-flex items-center rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-medium text-white">
          ACTIVO
        </span>
      )}
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {s.label}
      </div>
      <div className="mb-2.5 grid grid-cols-2 gap-2.5">
        <div>
          <div className="font-mono text-[10px] uppercase text-muted-foreground">Enganche</div>
          <div className="font-mono font-semibold">${s.downPayment.toLocaleString()}</div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-muted-foreground">Mensual</div>
          <div className="font-mono font-semibold">
            ${Math.round((s.total - s.downPayment) / s.months).toLocaleString()}
          </div>
        </div>
        <div className="col-span-2">
          <div className="font-mono text-[10px] uppercase text-muted-foreground">Total</div>
          <div className="font-mono text-lg font-semibold">${s.total.toLocaleString()}</div>
        </div>
      </div>
      {!s.active && onActivate && (
        <button
          onClick={onActivate}
          className="w-full rounded-md bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600"
        >
          Activar
        </button>
      )}
    </div>
  );
}

export function SecFinanciero({ bundle, onCmd }: SecFinancieroProps) {
  const plan = bundle.financialPlan;

  if (!plan) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card px-8 py-14 text-center shadow-sm">
        <Wallet className="mx-auto h-9 w-9 text-muted-foreground" />
        <h2 className="mt-3 text-lg font-semibold">Sin plan financiero</h2>
        <p className="mx-auto mt-1.5 mb-4 max-w-md text-xs text-muted-foreground">
          Crea hasta 3 escenarios de cotización para enviar al paciente vía Sign@Home.
        </p>
        <button
          onClick={() => onCmd("drawer-edit-financial")}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-2 text-xs text-white hover:bg-blue-600"
        >
          <Wallet className="h-3 w-3" /> Crear plan financiero
        </button>
      </div>
    );
  }

  const paid = plan.installments
    .filter((i) => i.status === "PAID")
    .reduce((sum, i) => sum + Number(i.amount), 0);
  const next = plan.installments.find((i) => i.status === "PENDING");

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Plan financiero</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Escenario activo · {plan.months} meses · enganche ${Number(plan.downPayment).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => onCmd("drawer-send-quote")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-muted"
          >
            <Send className="h-3 w-3" /> Enviar escenarios · WhatsApp
          </button>
          <button
            onClick={() => onCmd("drawer-edit-financial")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-muted"
          >
            <Pencil className="h-3 w-3" /> Editar plan
          </button>
        </div>
      </div>

      {/* Escenarios */}
      {plan.scenarios.length > 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          {plan.scenarios.map((s) => (
            <ScenarioCard
              key={s.id}
              s={s}
              onActivate={() => onCmd(`activate-scenario:${s.id}`)}
            />
          ))}
        </div>
      )}

      {/* Calendar of installments */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Calendario de mensualidades</h3>
          {next && (
            <button
              onClick={() => onCmd(`drawer-collect:${next.id}`)}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-2.5 py-1.5 text-xs text-white hover:bg-blue-600"
            >
              <DollarSign className="h-3 w-3" /> Cobrar siguiente · ${Number(next.amount).toLocaleString()}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {plan.installments.map((m) => (
            <InstallmentChip
              key={m.id}
              inst={m}
              cfdi={m.status === "PAID"}
              onClick={() => onCmd(`drawer-collect:${m.id}`)}
            />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3.5 border-t border-border pt-3.5">
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Total tx</div>
            <div className="mt-1 font-mono text-xl font-semibold">${Number(plan.total).toLocaleString()}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Enganche</div>
            <div className="mt-1 font-mono text-xl font-semibold">${Number(plan.downPayment).toLocaleString()}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Mensualidades</div>
            <div className="mt-1 font-mono text-xl font-semibold">
              {plan.months} × ${Number(plan.monthly).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Cobrado</div>
            <div className="mt-1 font-mono text-xl font-semibold text-emerald-600">
              ${paid.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* CFDI Facturapi banner — único stub legítimo */}
      <div className="rounded-2xl border border-violet-300 bg-violet-50/60 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-violet-600">
            <FileText className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <div className="text-sm font-medium">CFDI 4.0 con Facturapi</div>
            <div className="text-[11px] text-muted-foreground">
              Stub Fase 2 · contratar para activar timbrado automático
            </div>
          </div>
          <button className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-muted">
            Conectar Facturapi
          </button>
        </div>
      </div>
    </div>
  );
}
