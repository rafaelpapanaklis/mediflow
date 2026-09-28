"use client";
// Índice de las secciones de la pestaña de Ortodoncia, con marca de dónde
// vas (scroll-spy). En ventana ancha es una columna que acompaña al bajar;
// en el resto es una tira de chips encima del contenido (antes, por debajo
// de 1024 px no había índice: 7 000 px de pestaña sin forma de saltar).
//
// Para navegar entre las pestañas del paciente sigue estando el menú de la
// ficha, arriba.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Camera,
  ClipboardList,
  DollarSign,
  FileText,
  Layers,
  RefreshCw,
  Shield,
  Smile,
  Star,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import orto from "../orto.module.css";

interface SectionEntry {
  /** Id del Card de la sección (matches `id="..."` en el DOM). */
  id: string;
  label: string;
  Icon: LucideIcon;
  /** Items "futuros" se muestran apagados hasta que el paciente entre en la
   *  fase relevante (retención / completado). */
  future?: boolean;
}

// Mismo orden que las secciones en OrthodonticsRedesignClient.
const SECTIONS: ReadonlyArray<SectionEntry> = [
  { id: "hero", label: "Resumen", Icon: Activity },
  { id: "tcards", label: "Controles", Icon: ClipboardList },
  { id: "diagnosis", label: "Diagnóstico", Icon: Smile },
  { id: "plan", label: "Plan de tratamiento", Icon: Layers },
  { id: "photos", label: "Fotos", Icon: Camera },
  { id: "finance", label: "Cobro", Icon: DollarSign },
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
 * Scroll-spy contextual con las secciones de Ortodoncia. Click navega con
 * `scrollIntoView({ behavior: "smooth", block: "start" })`. El activo se
 * calcula con IntersectionObserver — la sección con mayor intersection ratio
 * gana.
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
    <nav className={orto.indice} aria-label="Secciones de Ortodoncia">
      <div className={`${orto.ceja} ${orto.indiceTitulo}`}>Secciones</div>
      <div className={orto.indiceLista}>
        {SECTIONS.map((s) => {
          const Icon = s.Icon;
          const isActive = active === s.id;
          // Items "future" pierden el apagado cuando el paciente entra en la
          // fase aplicable.
          const isDimmed =
            s.future && status !== "retencion" && status !== "completado";
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onNavigate(s.id)}
              className={[
                orto.indiceItem,
                isActive ? orto.indiceItemActivo : "",
                isDimmed && !isActive ? orto.indiceItemApagado : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={isActive ? "true" : undefined}
            >
              <Icon size={15} strokeWidth={1.75} aria-hidden />
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>
      <div className={orto.indicePie}>
        <RefreshIndicator />
      </div>
    </nav>
  );
}

function RefreshIndicator() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className={orto.indiceItem}
      aria-label="Recargar datos del paciente"
      title="Recargar datos del paciente"
    >
      <RefreshCw size={14} strokeWidth={1.75} aria-hidden />
      <span>Recargar datos</span>
    </button>
  );
}
