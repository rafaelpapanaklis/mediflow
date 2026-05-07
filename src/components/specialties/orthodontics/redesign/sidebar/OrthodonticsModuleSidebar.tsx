"use client";
// Sub-sidebar contextual del módulo Ortodoncia — scroll-spy a las 9
// secciones (A-I) del orchestrator. Sticky en lg+, oculto en mobile.
//
// Mockup ref: docs/ortho-redesign/ortho-patient/shell.jsx ContextSidebar.
// Adapta los items: solo grupo "Ortodoncia" expandido con sub-items por
// sección. Para navegar entre tabs del paciente el QuickNav del shell
// patient-detail (siempre visible a la izquierda) sigue siendo el camino.

import { useEffect, useState } from "react";
import {
  Activity,
  Camera,
  DollarSign,
  FileText,
  Layers,
  RefreshCw,
  Shield,
  Smile,
  Star,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface SectionEntry {
  /** Id del Card de la sección (matches `id="..."` en el DOM). */
  id: string;
  label: string;
  Icon: LucideIcon;
  badge?: string;
  /** Items "futuros" se muestran con opacidad reducida hasta que el
   *  paciente entre en la fase relevante (retención / completado). */
  future?: boolean;
}

const SECTIONS: ReadonlyArray<SectionEntry> = [
  { id: "hero", label: "Resumen", Icon: Activity },
  { id: "diagnosis", label: "Diagnóstico", Icon: Smile },
  { id: "plan", label: "Plan de tratamiento", Icon: Layers },
  { id: "tcards", label: "Treatment Card", Icon: Activity, badge: "G1" },
  { id: "photos", label: "Fotos comparativas", Icon: Camera },
  { id: "finance", label: "Plan financiero", Icon: DollarSign },
  { id: "retention", label: "Retención", Icon: Shield, future: true },
  { id: "post", label: "Post-tratamiento", Icon: Star, future: true },
  { id: "docs", label: "Documentos", Icon: FileText },
];

export interface OrthodonticsModuleSidebarProps {
  /**
   * Estado del tratamiento — usado para decidir cuándo des-marcar items
   * como "future". Cuando es `retencion` o `completado`, retention/post
   * pasan a estado normal.
   */
  treatmentStatus?:
    | "no-iniciado"
    | "en-tratamiento"
    | "retencion"
    | "completado";
}

/**
 * Scroll-spy contextual sidebar con 9 secciones de Ortodoncia. Click navega
 * con `scrollIntoView({ behavior: "smooth", block: "start" })`. Highlight
 * activo se calcula con IntersectionObserver — la sección con mayor
 * intersection ratio gana.
 */
export function OrthodonticsModuleSidebar(props: OrthodonticsModuleSidebarProps) {
  const [active, setActive] = useState<string>("hero");
  const status = props.treatmentStatus ?? "en-tratamiento";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ids = SECTIONS.map((s) => s.id);
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el != null);
    if (elements.length === 0) return;

    // Mantener un mapa con los ratios actuales de cada sección visible y
    // elegir la de mayor ratio cada vez que se actualiza algún entry.
    const ratios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          ratios.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        }
        let bestId = "";
        let bestRatio = 0;
        ratios.forEach((r, id) => {
          if (r > bestRatio) {
            bestRatio = r;
            bestId = id;
          }
        });
        if (bestId) setActive(bestId);
      },
      {
        // Top offset para que la sección "activa" empiece a contar desde
        // un poco abajo del topbar+header sticky (~140px).
        rootMargin: "-140px 0px -55% 0px",
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      },
    );

    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onNavigate = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // Optimistic — el observer la corregirá si quedó fuera de view.
    setActive(id);
  };

  return (
    <aside
      className="hidden lg:block w-full flex-shrink-0"
      aria-label="Navegación de secciones Ortodoncia"
    >
      <nav className="bg-white border border-slate-200 rounded-xl p-3 sticky top-20 dark:bg-slate-900 dark:border-slate-800">
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium px-2 mb-1.5 dark:text-slate-500">
          Ortodoncia · secciones
        </div>
        <div className="space-y-0.5">
          {SECTIONS.map((s) => {
            const Icon = s.Icon;
            const isActive = active === s.id;
            // Items "future" pierden el dim cuando el paciente entra
            // en la fase aplicable.
            const isDimmed =
              s.future && status !== "retencion" && status !== "completado";
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onNavigate(s.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm relative transition-colors ${
                  isActive
                    ? "bg-violet-50 text-violet-700 font-medium dark:bg-violet-900/30 dark:text-violet-200"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                } ${isDimmed ? "opacity-60" : ""}`}
                aria-current={isActive ? "true" : undefined}
              >
                {isActive && (
                  <span
                    className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-violet-600 rounded-r dark:bg-violet-400"
                    aria-hidden
                  />
                )}
                <Icon
                  size={14}
                  className={
                    isActive
                      ? "text-violet-600 dark:text-violet-300"
                      : "text-slate-500 dark:text-slate-400"
                  }
                  aria-hidden
                />
                <span className="flex-1 text-left truncate">{s.label}</span>
                {s.badge ? (
                  <span
                    className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                      isActive
                        ? "text-violet-600 bg-violet-100 dark:text-violet-200 dark:bg-violet-900/40"
                        : "text-slate-500 bg-slate-100 dark:text-slate-400 dark:bg-slate-800"
                    }`}
                  >
                    {s.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="mt-3 pt-3 border-t border-slate-100 px-2 dark:border-slate-800">
          <RefreshIndicator />
        </div>
      </nav>
    </aside>
  );
}

function RefreshIndicator() {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined") window.location.reload();
      }}
      className="w-full flex items-center gap-2 text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
    >
      <RefreshCw size={11} aria-hidden />
      Recargar datos del paciente
    </button>
  );
}
