"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSpecialtiesByCategory, type SpecialtyCategory } from "@/lib/specialty-data";
import { SpecIcon } from "./primitives/spec-icon";

const GROUP_COLOR: Record<SpecialtyCategory, string> = {
  "Dental":       "#a78bfa",
  "Médicas":      "#34d399",
  "Salud mental": "#38bdf8",
  "Bienestar":    "#fbbf24",
};

const GROUP_ORDER: SpecialtyCategory[] = ["Dental", "Médicas", "Salud mental", "Bienestar"];

const CLOSE_DELAY_MS = 150;

interface SpecialtiesDropdownProps {
  /** Slug activo si estamos dentro de una página de especialidad. */
  currentSlug?: string;
  /** Estilos opcionales para el botón trigger. */
  triggerColor?: string;
}

export function SpecialtiesDropdown({ currentSlug, triggerColor }: SpecialtiesDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const groups = getSpecialtiesByCategory();

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [cancelClose]);

  const openNow = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);

  // Cerrar al click fuera / tecla Escape
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  // Limpieza del timer al desmontar
  useEffect(() => () => cancelClose(), [cancelClose]);

  const activeColor = triggerColor ?? "var(--ld-brand-light, #a78bfa)";

  return (
    <div
      ref={rootRef}
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
      style={{ position: "relative", display: "inline-block" }}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        style={{
          cursor: "pointer",
          background: "transparent",
          border: "none",
          padding: 0,
          fontSize: 13,
          fontFamily: "inherit",
          color: open ? activeColor : "var(--ld-fg-muted, rgba(245,245,247,0.65))",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          userSelect: "none",
          transition: "color .15s",
        }}
      >
        Especialidades
        <span
          style={{
            fontSize: 9,
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform .18s",
          }}
          aria-hidden="true"
        >
          ▼
        </span>
      </button>

      {open && (
        <div
          /* Outer wrapper: sin estilos visuales, solo crea el bridge invisible
             de 14px para que el mouse no "caiga" entre el trigger y el panel
             y dispare onMouseLeave del root. */
          onMouseEnter={cancelClose}
          style={{
            position: "absolute",
            top: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            paddingTop: 14,
            zIndex: 200,
          }}
        >
        <div
          role="menu"
          style={{
            width: 880,
            padding: 24,
            borderRadius: 16,
            background: "rgba(18,16,32,0.96)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(124,58,237,0.25)",
            boxShadow:
              "0 30px 60px rgba(0,0,0,0.6), 0 0 40px rgba(124,58,237,0.12), inset 0 1px 0 rgba(255,255,255,0.04)",
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 24,
          }}
        >
          {GROUP_ORDER.map(cat => {
            const items = groups[cat];
            const color = GROUP_COLOR[cat];
            return (
              <div key={cat}>
                <div
                  style={{
                    fontSize: 11,
                    color,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                    fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
                    paddingBottom: 8,
                    marginBottom: 8,
                    borderBottom: `1px solid ${color}33`,
                  }}
                >
                  {cat}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {items.map(s => {
                    const isActive = s.slug === currentSlug;
                    return (
                      <Link
                        key={s.slug}
                        href={`/${s.slug}`}
                        onClick={() => setOpen(false)}
                        role="menuitem"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "8px 10px",
                          borderRadius: 8,
                          textDecoration: "none",
                          fontSize: 13,
                          color: isActive ? color : "var(--ld-fg, #f5f5f7)",
                          background: isActive ? `${color}1f` : "transparent",
                          transition: "background .12s, color .12s",
                        }}
                        onMouseEnter={e => {
                          if (!isActive) {
                            e.currentTarget.style.background = `${color}14`;
                            e.currentTarget.style.color = color;
                          }
                        }}
                        onMouseLeave={e => {
                          if (!isActive) {
                            e.currentTarget.style.background = "transparent";
                            e.currentTarget.style.color = "var(--ld-fg, #f5f5f7)";
                          }
                        }}
                      >
                        <span
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 6,
                            background: `${color}18`,
                            color,
                            display: "grid",
                            placeItems: "center",
                            flexShrink: 0,
                          }}
                        >
                          <SpecIcon type={s.icon} size={13} />
                        </span>
                        <span style={{ lineHeight: 1.2 }}>{s.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        </div>
      )}
    </div>
  );
}
