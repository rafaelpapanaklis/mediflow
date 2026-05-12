// Badge selectable de aparatología · design/atoms.jsx atom 3.

interface ApplianceBadgeProps {
  code: string;
  label?: string;
  on?: boolean;
  onClick?: () => void;
}

const CATALOG: Record<string, { label: string; tone: string }> = {
  brackets_metal: { label: "Metálicos", tone: "neutral" },
  metal: { label: "Metálicos", tone: "neutral" },
  damon: { label: "Damon (auto)", tone: "info" },
  self_lig: { label: "Autoligado", tone: "info" },
  ceramic: { label: "Cerámica", tone: "violet" },
  invisalign: { label: "Invisalign", tone: "brand" },
  aligners: { label: "Alineadores", tone: "brand" },
  clearcorrect: { label: "ClearCorrect", tone: "brand" },
  lingual: { label: "Linguales", tone: "violet" },
  rpe: { label: "RPE Hyrax", tone: "warn" },
  quad: { label: "Quad-Helix", tone: "warn" },
  expander: { label: "Expansor", tone: "warn" },
};

const TONE_CLASSES: Record<string, string> = {
  neutral: "bg-muted text-foreground border-border",
  info: "bg-cyan-50 text-cyan-700 border-cyan-200",
  brand: "bg-blue-50 text-blue-700 border-blue-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
  warn: "bg-amber-50 text-amber-700 border-amber-200",
};

export function ApplianceBadge({ code, label, on, onClick }: ApplianceBadgeProps) {
  const entry = CATALOG[code.toLowerCase()] ?? { label: label ?? code, tone: "neutral" };
  const ttype = entry.tone;
  return (
    <button
      onClick={onClick}
      data-on={on ? "true" : "false"}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        on
          ? "bg-blue-500 text-white border-blue-600"
          : TONE_CLASSES[ttype] ?? TONE_CLASSES.neutral
      }`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {entry.label}
    </button>
  );
}
