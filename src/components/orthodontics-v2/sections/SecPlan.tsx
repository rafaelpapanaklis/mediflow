// Sección D · Plan de tratamiento — 5 sub-tabs (aparatología, decisiones, wires, IPR, objetivos).

"use client";

import { useState } from "react";
import { Layers, ClipboardList, GitBranch, Ruler, Target, Plus, Save, Check, Pencil } from "lucide-react";
import { ApplianceBadge, WireStepRow, IPRSlot } from "@/components/orthodontics-v2/atoms";
import type { OrthoCaseBundle } from "@/lib/orthodontics-v2/types";

interface SecPlanProps {
  bundle: OrthoCaseBundle;
  onCmd: (cmd: string) => void;
}

type TabKey = "aparatologia" | "decisiones" | "wires" | "ipr" | "objetivos";

const TABS: Array<{ k: TabKey; label: string; Icon: typeof Layers }> = [
  { k: "aparatologia", label: "Aparatología", Icon: Layers },
  { k: "decisiones", label: "Decisiones", Icon: ClipboardList },
  { k: "wires", label: "Arcos", Icon: GitBranch },
  { k: "ipr", label: "IPR", Icon: Ruler },
  { k: "objetivos", label: "Objetivos", Icon: Target },
];

export function SecPlan({ bundle, onCmd }: SecPlanProps) {
  const [tab, setTab] = useState<TabKey>("aparatologia");
  const plan = bundle.plan;

  if (!plan) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card px-8 py-14 text-center shadow-sm">
        <Layers className="mx-auto h-9 w-9 text-muted-foreground" />
        <h2 className="mt-3 text-lg font-semibold">Sin plan de tratamiento</h2>
        <p className="mx-auto mt-1.5 mb-4 max-w-md text-xs text-muted-foreground">
          Crea un plan desde cero o carga una plantilla pre-armada para acelerar.
        </p>
        <div className="flex justify-center gap-2">
          <button
            onClick={() => onCmd("drawer-edit-plan")}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-2 text-xs text-white hover:bg-blue-600"
          >
            <Plus className="h-3 w-3" /> Plan en blanco
          </button>
          <button
            onClick={() => onCmd("modal-template")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-muted"
          >
            <Layers className="h-3 w-3" /> Cargar plantilla
          </button>
        </div>
      </div>
    );
  }

  const totalWeeks = plan.arches.reduce((sum, a) => sum + a.durationW, 0);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Plan de tratamiento</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {plan.appliances.join(", ") || "Sin aparatología"} · {plan.arches.length} arcos · {totalWeeks} sem
          </p>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => onCmd("modal-template")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-muted"
          >
            <Layers className="h-3 w-3" /> Plantilla
          </button>
          <button
            onClick={() => onCmd("modal-save-template")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-muted"
          >
            <Save className="h-3 w-3" /> Guardar como
          </button>
          <button
            disabled={!!plan.acceptedAt}
            onClick={() => onCmd("accept-plan")}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-2.5 py-1.5 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
          >
            <Check className="h-3 w-3" /> {plan.acceptedAt ? "Aceptado" : "Aceptar plan"}
          </button>
        </div>
      </div>

      <div className="flex w-fit gap-1 rounded-xl bg-muted p-1">
        {TABS.map(({ k, label, Icon }) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            data-active={tab === k}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-colors ${
              tab === k
                ? "bg-blue-500 text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {tab === "aparatologia" && (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold">Aparatología seleccionada</h3>
          <div className="flex flex-wrap gap-1.5">
            {plan.appliances.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin aparatología seleccionada.</p>
            ) : (
              plan.appliances.map((code) => (
                <ApplianceBadge key={code} code={code} on />
              ))
            )}
            <button
              onClick={() => onCmd("drawer-new-appliance")}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-card px-2.5 py-1 text-xs hover:bg-muted"
            >
              <Plus className="h-3 w-3" /> Tipo nuevo
            </button>
          </div>
        </div>
      )}

      {tab === "decisiones" && (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold">Decisiones del caso</h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="font-mono text-[10px] uppercase text-muted-foreground">Extracciones</div>
              <div className="mt-0.5 font-medium">
                {plan.extractions.length > 0 ? plan.extractions.join(", ") : "No requiere"}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase text-muted-foreground">Elásticos</div>
              <div className="mt-0.5 font-medium">
                {Object.keys(plan.elastics).length > 0 ? "Configurado" : "—"}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase text-muted-foreground">Expansores</div>
              <div className="mt-0.5 font-medium">
                {Object.keys(plan.expanders).length > 0 ? "Configurado" : "Ninguno"}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase text-muted-foreground">TADs</div>
              <div className="mt-0.5 font-medium">
                {Object.keys(plan.tads).length > 0 ? "Sí" : "No"}
              </div>
            </div>
          </div>
          <button
            onClick={() => onCmd("drawer-edit-plan")}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-muted"
          >
            <Pencil className="h-3 w-3" /> Editar decisiones
          </button>
        </div>
      )}

      {tab === "wires" && (
        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border p-4">
            <div>
              <h3 className="text-sm font-semibold">Wire sequencing</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Secuencia planeada · {plan.arches.length} arcos · {totalWeeks} semanas
              </p>
            </div>
            <button
              onClick={() => onCmd("drawer-new-wire")}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-2.5 py-1.5 text-xs text-white hover:bg-blue-600"
            >
              <Plus className="h-3 w-3" /> Agregar arco
            </button>
          </div>
          {plan.arches.map((a) => (
            <WireStepRow
              key={a.id}
              arch={a}
              onEdit={() => onCmd(`drawer-edit-wire:${a.id}`)}
              onDelete={() => onCmd(`delete-wire:${a.id}`)}
            />
          ))}
        </div>
      )}

      {tab === "ipr" && (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold">IPR map · Interproximal reduction</h3>
          <div className="flex flex-wrap justify-center gap-1.5">
            {Object.entries(plan.iprPlan).map(([key, mm]) => (
              <IPRSlot key={key} label={key} planned={mm} />
            ))}
            {Object.keys(plan.iprPlan).length === 0 && (
              <p className="text-xs text-muted-foreground">Sin IPR planeado.</p>
            )}
          </div>
        </div>
      )}

      {tab === "objetivos" && (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold">Objetivos del tratamiento</h3>
          {plan.objectives.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin objetivos definidos.</p>
          ) : (
            <ul className="space-y-1.5">
              {plan.objectives.map((g, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-1.5 text-xs"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-card font-mono text-[10px] font-semibold text-muted-foreground">
                    {i + 1}
                  </span>
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          )}
          {plan.notes && (
            <div className="mt-3 border-t border-border pt-3">
              <div className="font-mono text-[10px] uppercase text-muted-foreground">Notas</div>
              <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">{plan.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
