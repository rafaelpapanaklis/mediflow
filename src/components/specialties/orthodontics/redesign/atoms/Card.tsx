// Atom: Card wrapper estándar del rediseño ortho.
// bg-white + border-slate-200 + rounded-xl + shadow-sm.

import type { ReactNode } from "react";

type AccentColor = "violet" | "emerald" | "amber" | "rose" | "slate";

const ACCENT_DOT: Record<AccentColor, string> = {
  violet: "bg-violet-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  slate: "bg-slate-400",
};

export interface CardProps {
  id?: string;
  eyebrow?: string;
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  accent?: AccentColor;
}

export function Card(props: CardProps) {
  const { id, eyebrow, title, action, children, className = "", footer, accent } = props;
  const hasHeader = Boolean(title || action || eyebrow);
  return (
    <section
      id={id}
      className={`bg-white border border-slate-200 rounded-xl shadow-sm dark:bg-slate-900 dark:border-slate-800 ${className}`}
    >
      {hasHeader ? (
        <header className="flex items-end justify-between gap-4 px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="min-w-0">
            {eyebrow ? (
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1 dark:text-slate-500">
                {eyebrow}
              </div>
            ) : null}
            {title ? (
              <h3 className="text-[15px] font-semibold text-slate-900 flex items-center gap-2 dark:text-slate-100">
                {accent ? (
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full ${ACCENT_DOT[accent]}`}
                    aria-hidden
                  />
                ) : null}
                {title}
              </h3>
            ) : null}
          </div>
          {action ? <div className="flex-shrink-0">{action}</div> : null}
        </header>
      ) : null}
      <div>{children}</div>
      {footer ? (
        <footer className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 rounded-b-xl dark:border-slate-800 dark:bg-slate-900/40">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}
