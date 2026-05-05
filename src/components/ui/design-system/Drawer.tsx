"use client";
// Pediatrics — Drawer lateral con focus-trap manual y portal. Spec: §1.14, §4.A.3

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X, Loader2 } from "lucide-react";

export type DrawerWidth = "sm" | "md" | "lg";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  width?: DrawerWidth;
  footer?: ReactNode;
  children: ReactNode;
  closeOnOverlay?: boolean;
  loading?: boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Drawer(props: DrawerProps) {
  const {
    open,
    onClose,
    title,
    subtitle,
    width = "md",
    footer,
    children,
    closeOnOverlay = true,
    loading = false,
  } = props;

  const titleId = useId();
  const subtitleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    const panel = panelRef.current;
    if (panel) {
      const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const first = focusables[0] ?? panel;
      window.requestAnimationFrame(() => first.focus());
    }
    return () => {
      const previous = previousFocusRef.current;
      if (previous && typeof previous.focus === "function") {
        previous.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const widthClass =
    width === "sm" ? "drawer drawer--sm" : width === "lg" ? "drawer drawer--lg" : "drawer";

  return createPortal(
    <div
      className="drawer-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && closeOnOverlay) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        className={widthClass}
        onKeyDown={handleKeyDown}
      >
        <DrawerHeader>
          <div className="drawer__title-block">
            <h2 id={titleId} className="drawer__title">{title}</h2>
            {subtitle ? (
              <p id={subtitleId} className="drawer__subtitle">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            className="drawer__close"
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        </DrawerHeader>
        <DrawerBody>{children}</DrawerBody>
        {footer ? <DrawerFooter>{footer}</DrawerFooter> : null}
        {loading ? (
          <div className="drawer__loading" aria-live="polite">
            <Loader2 size={20} className="drawer__spinner" aria-hidden />
            <span className="sr-only">Cargando…</span>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function DrawerHeader({ children }: { children: ReactNode }) {
  return <header className="drawer__header">{children}</header>;
}

export function DrawerBody({ children }: { children: ReactNode }) {
  return <div className="drawer__body">{children}</div>;
}

export function DrawerFooter({ children }: { children: ReactNode }) {
  return <footer className="drawer__footer">{children}</footer>;
}

export function DrawerOverlay({ children }: { children: ReactNode }) {
  return <div className="drawer-overlay">{children}</div>;
}
