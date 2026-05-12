// Collapsible card · utility atom · design/atoms.jsx COLLAPSIBLE CARD.

"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { LucideIcon } from "lucide-react";

interface CollapsibleProps {
  title: string;
  Icon?: LucideIcon;
  summary?: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Collapsible({
  title,
  Icon,
  summary,
  badge,
  defaultOpen = true,
  children,
}: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {badge && (
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {badge}
          </span>
        )}
        <div className="flex-1" />
        {summary && <span className="text-xs text-muted-foreground">{summary}</span>}
        <Chevron className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3.5">{children}</div>
      )}
    </div>
  );
}
