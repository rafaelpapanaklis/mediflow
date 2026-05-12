// Sección G · Retención — retenedor sup/inf + régimen + checkpoints + NPS + referidos.

"use client";

import { Pencil, ShieldCheck, Download, Share2 } from "lucide-react";
import type { OrthoCaseBundle } from "@/lib/orthodontics-v2/types";

interface SecRetencionProps {
  bundle: OrthoCaseBundle;
  onCmd: (cmd: string) => void;
}

const RETAINER_LABEL: Record<string, string> = {
  NONE: "Ninguno",
  HAWLEY: "Hawley",
  ESSIX: "Essix",
  FIXED_3_3: "Fijo 3-3",
  FIXED_EXTENDED: "Fijo extendido",
  CLEAR_NIGHT: "Nocturno transparente",
};

export function SecRetencion({ bundle, onCmd }: SecRetencionProps) {
  const plan = bundle.retentionPlan;

  if (!plan) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card px-8 py-14 text-center shadow-sm">
        <ShieldCheck className="mx-auto h-9 w-9 text-muted-foreground" />
        <h2 className="mt-3 text-lg font-semibold">Sin plan de retención</h2>
        <p className="mx-auto mt-1.5 mb-4 max-w-md text-xs text-muted-foreground">
          Configura régimen, checkpoints post-debond y código de referidos.
        </p>
        <button
          onClick={() => onCmd("drawer-config-retention")}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-2 text-xs text-white hover:bg-blue-600"
        >
          <ShieldCheck className="h-3 w-3" /> Configurar retención
        </button>
      </div>
    );
  }

  const debonded = !!bundle.case.debondedAt;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Retención y post-tratamiento</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {debonded
              ? `Activo · debonding ${new Date(bundle.case.debondedAt!).toLocaleDateString("es-MX")}`
              : "Planificación pre-debonding"}
          </p>
        </div>
        <button
          onClick={() => onCmd("drawer-config-retention")}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-2.5 py-1.5 text-xs text-white hover:bg-blue-600"
        >
          <Pencil className="h-3 w-3" /> Editar régimen
        </button>
      </div>

      {/* Retainers */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-2.5 text-sm font-semibold">Retenedor superior</h3>
          <div className="space-y-1.5 text-xs">
            <div>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">Tipo</span>
              <span className="ml-2 font-medium">{RETAINER_LABEL[plan.retUpper] ?? plan.retUpper}</span>
            </div>
            <div>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">Calibre</span>
              <span className="ml-2 font-mono font-medium">{plan.fixedGauge ?? "—"}</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-2.5 text-sm font-semibold">Retenedor inferior</h3>
          <div className="space-y-1.5 text-xs">
            <div>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">Tipo</span>
              <span className="ml-2 font-medium">{RETAINER_LABEL[plan.retLower] ?? plan.retLower}</span>
            </div>
            <div>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">Calibre</span>
              <span className="ml-2 font-mono font-medium">{plan.fixedGauge ?? "—"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Régimen */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold">Régimen de uso</h3>
        <p className="whitespace-pre-wrap text-xs text-muted-foreground">{plan.regimen}</p>
      </div>

      {/* Checkpoints */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold">Controles post-debonding</h3>
        <div className="flex flex-wrap gap-2">
          {plan.checkpoints.map((d, i) => {
            const date = new Date(d);
            const done = plan.checkpointsDone[d.toString()] !== undefined;
            const past = date < new Date();
            return (
              <div
                key={i}
                className={`min-w-32 rounded-lg border px-3.5 py-2.5 ${
                  done
                    ? "bg-emerald-50 border-emerald-200"
                    : past
                      ? "bg-rose-50 border-rose-200"
                      : "bg-muted/40 border-border"
                }`}
              >
                <div className="text-[11px] font-medium">+{i + 1}</div>
                <div className="font-mono text-[10px] text-muted-foreground">
                  {date.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
                </div>
              </div>
            );
          })}
          {plan.checkpoints.length === 0 && (
            <p className="text-xs text-muted-foreground">Sin checkpoints programados.</p>
          )}
        </div>
      </div>

      {/* Referrals */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-2.5 text-sm font-semibold">Programa de referidos</h3>
          <div className="mb-2.5 rounded-lg border border-violet-300 bg-violet-50/60 p-3">
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Código</div>
            <div className="mt-1 font-mono text-2xl font-semibold tracking-wider text-violet-600">
              {plan.referralCode}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Premio: {plan.referralReward.label} · {plan.referralsCount} referido(s)
          </div>
          <button
            onClick={() => onCmd("generate-referral-card")}
            className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-muted"
          >
            <Share2 className="h-3 w-3" /> Generar share-card
          </button>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-2.5 text-sm font-semibold">PDF antes / después</h3>
          <p className="mb-2.5 text-xs text-muted-foreground">
            {plan.beforeAfterPdf
              ? "PDF generado · disponible para descarga"
              : "Disponible al marcar debonding completado"}
          </p>
          <button
            onClick={() => onCmd("generate-before-after-pdf")}
            disabled={!debonded}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-500 px-2.5 py-1.5 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
          >
            <Download className="h-3 w-3" /> Generar PDF
          </button>
        </div>
      </div>
    </div>
  );
}
