import type { CSSProperties, ReactNode } from "react";

type BadgeTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

type BadgeProps = {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
  /**
   * Override puntual — p.ej. para pisar el color de texto fijo (no
   * theme-aware) de `.badge-new--*` en una pantalla que sí corre en claro.
   * Nadie más lo pasaba antes de esto, así que ningún consumidor existente
   * cambia de aspecto.
   */
  style?: CSSProperties;
};

export function BadgeNew({ tone = "neutral", dot, children, className, style }: BadgeProps) {
  const cls = ["badge-new", `badge-new--${tone}`, className].filter(Boolean).join(" ");
  return (
    <span className={cls} style={style}>
      {dot && <span className="badge-new__dot" />}
      {children}
    </span>
  );
}
