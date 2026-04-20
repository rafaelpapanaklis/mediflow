import type { ReactNode } from "react";

type BadgeTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

type BadgeProps = {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
};

export function BadgeNew({ tone = "neutral", dot, children, className }: BadgeProps) {
  const cls = ["badge-new", `badge-new--${tone}`, className].filter(Boolean).join(" ");
  return (
    <span className={cls}>
      {dot && <span className="badge-new__dot" />}
      {children}
    </span>
  );
}
