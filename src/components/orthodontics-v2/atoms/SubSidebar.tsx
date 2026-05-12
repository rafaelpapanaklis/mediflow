// SubSidebar del módulo · 8 secciones + atajos · design/atoms.jsx SUB-SIDEBAR.

"use client";

import {
  LayoutDashboard,
  ClipboardList,
  Camera,
  FileBarChart2,
  CalendarHeart,
  Wallet,
  ShieldCheck,
  Folder,
} from "lucide-react";

export type OrthoSectionKey =
  | "resumen"
  | "expediente"
  | "fotos"
  | "plan"
  | "citas"
  | "financiero"
  | "retencion"
  | "documentos";

const SECTIONS: Array<{ k: OrthoSectionKey; label: string; Icon: typeof LayoutDashboard }> = [
  { k: "resumen", label: "Resumen", Icon: LayoutDashboard },
  { k: "expediente", label: "Expediente clínico", Icon: ClipboardList },
  { k: "fotos", label: "Fotos & Rx", Icon: Camera },
  { k: "plan", label: "Plan de tratamiento", Icon: FileBarChart2 },
  { k: "citas", label: "Citas & evolución", Icon: CalendarHeart },
  { k: "financiero", label: "Plan financiero", Icon: Wallet },
  { k: "retencion", label: "Retención", Icon: ShieldCheck },
  { k: "documentos", label: "Documentos", Icon: Folder },
];

interface SubSidebarProps {
  active: OrthoSectionKey;
  onChange: (k: OrthoSectionKey) => void;
  counts?: Partial<Record<OrthoSectionKey, number>>;
}

export function SubSidebar({ active, onChange, counts = {} }: SubSidebarProps) {
  return (
    <nav className="flex flex-col gap-0.5 p-2">
      <div className="mb-2 border-b border-border px-3 pb-3 pt-2">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Módulo
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-blue-500 text-white">
            <ShieldCheck className="h-3 w-3" />
          </span>
          <span className="text-[13px] font-semibold">Ortodoncia</span>
        </div>
      </div>
      {SECTIONS.map(({ k, label, Icon }) => {
        const isActive = active === k;
        const badge = counts[k];
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
              isActive
                ? "bg-blue-50 text-blue-700 font-medium shadow-[inset_2px_0_0_rgb(59_130_246)]"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="flex-1">{label}</span>
            {badge != null && badge > 0 && (
              <span
                className={`rounded px-1.5 py-px font-mono text-[10px] ${
                  isActive ? "bg-blue-500 text-white" : "bg-muted text-muted-foreground"
                }`}
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
      <div className="mt-3 border-t border-border px-3 pb-2 pt-3">
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Atajos
        </div>
        <div className="flex flex-col gap-0.5 font-mono text-[11px] text-muted-foreground">
          {(
            [
              ["+ TC", "N"],
              ["+ Foto", "F"],
              ["Cobrar", "C"],
              ["Avanzar arco", "A"],
              ["? ayuda", "?"],
            ] as const
          ).map(([label, key]) => (
            <div key={key} className="flex justify-between">
              <span>{label}</span>
              <kbd className="rounded border border-border bg-muted px-1 text-[10px]">{key}</kbd>
            </div>
          ))}
        </div>
      </div>
    </nav>
  );
}
