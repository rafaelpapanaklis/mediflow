// WireStepRow para tabla de arcos · design/atoms.jsx atom 6.

import { GripVertical, Pencil, Trash2 } from "lucide-react";
import type { ArchVM } from "@/lib/orthodontics-v2/types";

const PHASE_LABEL: Record<string, string> = {
  ALIGNMENT: "Alineación",
  LEVELING: "Nivelación",
  SPACE_CLOSE: "Cierre",
  DETAIL: "Detalles",
  FINISHING: "Finalización",
  RETENTION: "Retención",
};

const MATERIAL_LABEL: Record<string, string> = {
  NITI: "NiTi",
  SS: "SS",
  TMA: "TMA",
  BETA_TI: "β-Ti",
  ESTHETIC: "Estético",
  OTHER: "Otro",
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  PAST: { label: "Pasado", cls: "bg-muted text-muted-foreground" },
  CURRENT: { label: "● Actual", cls: "bg-blue-100 text-blue-700" },
  FUTURE: { label: "Futuro", cls: "bg-muted text-muted-foreground" },
  SKIPPED: { label: "Saltado", cls: "bg-amber-100 text-amber-700" },
};

interface WireStepRowProps {
  arch: ArchVM;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function WireStepRow({ arch, onEdit, onDelete }: WireStepRowProps) {
  const status = STATUS_LABEL[arch.status] ?? STATUS_LABEL.FUTURE;
  return (
    <div
      className={`grid items-center gap-2 px-3 py-2 border-b border-border text-sm ${
        arch.status === "CURRENT" ? "bg-blue-50/50" : ""
      }`}
      style={{ gridTemplateColumns: "24px 32px 110px 60px 110px 60px 1fr 80px" }}
    >
      <button className="text-muted-foreground cursor-grab" aria-label="Mover">
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <span className={`font-mono font-semibold text-sm ${arch.status === "CURRENT" ? "text-blue-700" : "text-foreground"}`}>
        {arch.order}
      </span>
      <span className="text-foreground">{PHASE_LABEL[arch.phase] ?? arch.phase}</span>
      <span className="font-mono text-xs text-muted-foreground">{MATERIAL_LABEL[arch.material] ?? arch.material}</span>
      <span className="font-mono text-xs font-medium text-foreground">{arch.gauge}</span>
      <span className="font-mono text-[11px] text-muted-foreground">{arch.durationW} sem</span>
      <div className="flex justify-end">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${status.cls}`}>
          {status.label}
        </span>
      </div>
      <div className="flex justify-end gap-1">
        {onEdit && (
          <button
            onClick={onEdit}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            aria-label="Editar arco"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="rounded-md p-1 text-rose-600 hover:bg-rose-50"
            aria-label="Borrar arco"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
