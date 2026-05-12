// InstallmentChip · design/atoms.jsx atom 7.

import { Check, AlertCircle, Circle } from "lucide-react";
import type { InstallmentVM } from "@/lib/orthodontics-v2/types";

const STATUS_STYLES: Record<
  string,
  { bg: string; fg: string; Icon: typeof Check; label: string }
> = {
  PAID: {
    bg: "bg-emerald-50 border-emerald-200",
    fg: "text-emerald-700",
    Icon: Check,
    label: "Pagado",
  },
  PENDING: {
    bg: "bg-amber-50 border-amber-200",
    fg: "text-amber-700",
    Icon: AlertCircle,
    label: "Pendiente",
  },
  FUTURE: {
    bg: "bg-card border-border",
    fg: "text-muted-foreground",
    Icon: Circle,
    label: "Futuro",
  },
  OVERDUE: {
    bg: "bg-rose-50 border-rose-200",
    fg: "text-rose-700",
    Icon: AlertCircle,
    label: "Vencido",
  },
  WAIVED: {
    bg: "bg-muted border-border",
    fg: "text-muted-foreground",
    Icon: Check,
    label: "Condonado",
  },
};

interface InstallmentChipProps {
  inst: InstallmentVM;
  cfdi?: boolean;
  onClick?: () => void;
}

export function InstallmentChip({ inst, cfdi, onClick }: InstallmentChipProps) {
  const style = STATUS_STYLES[inst.status] ?? STATUS_STYLES.FUTURE;
  const { Icon } = style;
  const amountFmt = `$${Number(inst.amount).toLocaleString("en-US")}`;
  return (
    <button
      onClick={onClick}
      className={`flex min-w-24 flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors hover:scale-[1.02] ${style.bg}`}
    >
      <div className="flex items-center justify-between">
        <span className={`font-mono text-[10px] font-semibold ${style.fg}`}>
          M{inst.number}
        </span>
        <Icon className={`h-2.5 w-2.5 ${style.fg}`} />
      </div>
      <span className="font-mono text-sm font-semibold text-foreground">{amountFmt}</span>
      <span className="font-mono text-[9px] text-muted-foreground">
        {new Date(inst.dueDate).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
      </span>
      {cfdi && (
        <span className="font-mono text-[9px] text-emerald-600">CFDI ✓</span>
      )}
    </button>
  );
}
