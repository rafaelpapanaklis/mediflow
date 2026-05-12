// Drawer + Modal shells compartidos · derivado de design/drawers.jsx Backdrop.

"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface ShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: string;
  side?: "right" | "center";
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
}

export function DrawerShell({
  open,
  onClose,
  title,
  subtitle,
  badge,
  side = "right",
  width = 620,
  children,
  footer,
}: ShellProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isRight = side === "right";

  return (
    <div
      onClick={onClose}
      className={`fixed inset-0 z-[9999] flex backdrop-blur-sm ${
        isRight ? "justify-end" : "items-center justify-center"
      } bg-black/60`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex flex-col overflow-hidden border bg-card shadow-2xl ${
          isRight ? "h-full border-l" : "max-h-[86vh] rounded-2xl border"
        }`}
        style={{ width, maxWidth: isRight ? width : "90vw" }}
      >
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card px-5 py-4">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-sora text-lg font-semibold">{title}</h2>
              {badge && (
                <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                  {badge}
                </span>
              )}
            </div>
            {subtitle && (
              <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 hover:bg-muted"
            aria-label="Cerrar · Esc"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-border bg-card px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
