import type { LucideIcon } from "lucide-react";
import { Sparkles } from "lucide-react";

export interface OrthoModulePlaceholderProps {
  title: string;
  description: string;
  icon?: LucideIcon;
}

/**
 * Placeholder "Próximamente" de una sección del módulo Ortodoncia (Ola 0,
 * ws1-t1) — mismo espíritu que `BarberPlaceholder`
 * (src/components/barber/.../barber-placeholder.tsx): cada parte de la
 * Ola 1 REEMPLAZA la página que lo usa por la suya, sin tocar el layout ni
 * el menú. Ver «MAPA DE PARTES» en REPORTE-ws1-t1.md.
 *
 * Server component a propósito (sin hooks): las seis páginas que lo montan
 * son server components y no hace falta pagar el bundle de un client
 * component por un cartel que se va a reemplazar entero.
 */
export function OrthoModulePlaceholder({
  title,
  description,
  icon: Icon = Sparkles,
}: OrthoModulePlaceholderProps) {
  return (
    <div
      style={{
        minHeight: "50vh",
        display: "grid",
        placeItems: "center",
        padding: "clamp(16px, 3vw, 40px)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 16,
          padding: "clamp(24px, 4vw, 40px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "var(--brand-grad, linear-gradient(135deg, #6d5efc, #8f7bff))",
            display: "grid",
            placeItems: "center",
            color: "#fff",
          }}
        >
          <Icon size={26} />
        </div>

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 12px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--brand)",
            background: "var(--brand-soft)",
            border: "1px solid var(--border-brand)",
          }}
        >
          Próximamente
        </span>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: "var(--text-1)",
              margin: 0,
            }}
          >
            {title}
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-2)", margin: 0 }}>
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}
