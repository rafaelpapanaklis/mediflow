// ToothPicker FDI 32 dientes · design/atoms.jsx atom 4.

const UPPER_R = [18, 17, 16, 15, 14, 13, 12, 11];
const UPPER_L = [21, 22, 23, 24, 25, 26, 27, 28];
const LOWER_L = [38, 37, 36, 35, 34, 33, 32, 31];
const LOWER_R = [41, 42, 43, 44, 45, 46, 47, 48];

interface ToothPickerProps {
  selected?: number[];
  onToggle?: (n: number) => void;
  size?: "sm" | "md";
  disabled?: boolean;
}

export function ToothPicker({ selected = [], onToggle, size = "md", disabled }: ToothPickerProps) {
  const SZ = size === "sm" ? 22 : 28;
  const F = SZ * 0.4;

  const Tooth = ({ n }: { n: number }) => {
    const on = selected.includes(n);
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && onToggle?.(n)}
        style={{
          width: SZ,
          height: SZ + 4,
          borderRadius: 6,
          background: on ? "rgb(59 130 246)" : "rgb(255 255 255)",
          color: on ? "#fff" : "rgb(75 85 99)",
          border: `1px solid ${on ? "rgb(37 99 235)" : "rgb(229 231 235)"}`,
          fontSize: F,
          fontWeight: 500,
          fontFamily: "'JetBrains Mono', monospace",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          transition: "all .08s",
          lineHeight: 1,
        }}
      >
        {n}
      </button>
    );
  };

  const Row = ({ left, right, label }: { left: number[]; right: number[]; label: string }) => (
    <div className="flex items-center gap-1">
      <span className="w-5 text-right font-mono text-[9px] text-muted-foreground">{label}</span>
      {left.map((n) => (
        <Tooth key={n} n={n} />
      ))}
      <div className="w-2" />
      {right.map((n) => (
        <Tooth key={n} n={n} />
      ))}
      <span className="w-5 font-mono text-[9px] text-muted-foreground">{label === "R" ? "L" : "R"}</span>
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-1">
      <Row left={UPPER_R} right={UPPER_L} label="R" />
      <div className="h-px w-[95%] bg-border" />
      <Row left={LOWER_R} right={LOWER_L} label="R" />
    </div>
  );
}
