// TreatmentCard collapsible · design/atoms.jsx atom 8.
// Renombrado a TreatmentCardItem para evitar colisión con el modelo Prisma.

import { useState } from "react";
import { ChevronDown, ChevronRight, Check, Printer, Pencil, MessageSquare, Eye, Microscope, ListChecks } from "lucide-react";
import type { TreatmentCardVM } from "@/lib/orthodontics-v2/types";

const TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  INSTALLATION: { label: "Instalación", cls: "bg-violet-100 text-violet-700" },
  CONTROL: { label: "Control mensual", cls: "bg-blue-100 text-blue-700" },
  EMERGENCY: { label: "Urgencia", cls: "bg-amber-100 text-amber-700" },
  DEBONDING: { label: "Debonding", cls: "bg-emerald-100 text-emerald-700" },
  RETAINER_FIT: { label: "Coloc. retenedor", cls: "bg-cyan-100 text-cyan-700" },
  FOLLOWUP: { label: "Seguimiento", cls: "bg-muted text-muted-foreground" },
};

interface TreatmentCardItemProps {
  card: TreatmentCardVM;
  index?: number;
  onEdit?: () => void;
  onPrint?: () => void;
}

export function TreatmentCardItem({ card, index, onEdit, onPrint }: TreatmentCardItemProps) {
  const [open, setOpen] = useState(false);
  const t = TYPE_LABEL[card.visitType] ?? TYPE_LABEL.FOLLOWUP;
  const compliance = card.elasticUse?.reportedCompliance;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 text-left"
        type="button"
      >
        {index != null && (
          <span className="w-6 font-mono text-[11px] font-medium text-muted-foreground">
            #{index}
          </span>
        )}
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${t.cls}`}>
          {t.label}
        </span>
        <span className="text-xs text-muted-foreground">
          {new Date(card.visitDate).toLocaleDateString("es-MX", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}
        </span>
        {compliance != null && (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
              compliance >= 80
                ? "bg-emerald-100 text-emerald-700"
                : compliance >= 60
                  ? "bg-amber-100 text-amber-700"
                  : "bg-rose-100 text-rose-700"
            }`}
          >
            {compliance}%
          </span>
        )}
        <div className="flex-1" />
        {card.signedOffAt && (
          <span className="text-emerald-600" title="Firmada">
            <Check className="h-3 w-3" />
          </span>
        )}
        <Chevron className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="mt-3 grid grid-cols-2 gap-3.5 border-t border-border pt-3">
          {(
            [
              ["S", "Subjetivo", card.soap.s, MessageSquare],
              ["O", "Objetivo", card.soap.o, Eye],
              ["A", "Análisis", card.soap.a, Microscope],
              ["P", "Plan", card.soap.p, ListChecks],
            ] as const
          ).map(([k, l, v, Icon]) => (
            <div key={k}>
              <div className="mb-0.5 flex items-center gap-1.5">
                <span className="w-3.5 text-center font-mono text-[10px] font-semibold text-blue-600">
                  {k}
                </span>
                <Icon className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {l}
                </span>
              </div>
              <p className="pl-5 text-xs text-muted-foreground">{v || "—"}</p>
            </div>
          ))}
          <div className="col-span-2 flex justify-end gap-1.5 pt-1">
            {onPrint && (
              <button
                onClick={onPrint}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-muted"
              >
                <Printer className="h-3 w-3" /> Imprimir indicaciones
              </button>
            )}
            {onEdit && (
              <button
                onClick={onEdit}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-muted"
              >
                <Pencil className="h-3 w-3" /> Editar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
