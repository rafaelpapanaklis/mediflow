// IPRSlot · design/atoms.jsx atom 9.

interface IPRSlotProps {
  label: string;
  planned: number;
  done?: number;
  status?: "PENDING" | "PARTIAL" | "DONE";
  onClick?: () => void;
}

const STATUS_COLOR: Record<string, string> = {
  PENDING: "rgb(107 114 128)",
  PARTIAL: "rgb(245 158 11)",
  DONE: "rgb(16 185 129)",
};

export function IPRSlot({ label, planned, done = 0, status = "PENDING", onClick }: IPRSlotProps) {
  const color = STATUS_COLOR[status];
  const display = done > 0 ? `${done.toFixed(1)}/${planned.toFixed(1)}` : planned.toFixed(1);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-9 flex-col items-center gap-0.5 rounded-md border border-border bg-muted/40 px-0.5 py-1 hover:bg-muted"
    >
      <span className="font-mono text-[9px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[11px] font-semibold" style={{ color }}>
        {display}
      </span>
      <span className="h-0.5 w-4 rounded-sm" style={{ background: color }} />
    </button>
  );
}
