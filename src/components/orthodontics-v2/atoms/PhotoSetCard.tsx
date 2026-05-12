// PhotoSetCard timeline · design/atoms.jsx atom 5.

interface PhotoSetCardProps {
  stage: string;
  date: string;
  count: number;
  total: number;
  active?: boolean;
  onClick?: () => void;
}

export function PhotoSetCard({
  stage,
  date,
  count,
  total,
  active,
  onClick,
}: PhotoSetCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-left transition-all ${
        active
          ? "bg-blue-500 text-white border-blue-600 shadow-lg shadow-violet-500/30"
          : "bg-card hover:bg-muted border-border"
      }`}
    >
      <span className="font-mono text-sm font-semibold">{stage}</span>
      <div className="flex flex-col gap-px">
        <span className="text-[11px] opacity-80">{date}</span>
        <span className="font-mono text-[10px] opacity-70">
          {count}/{total} fotos
        </span>
      </div>
    </button>
  );
}
