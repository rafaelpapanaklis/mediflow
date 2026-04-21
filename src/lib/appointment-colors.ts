// Paleta compartida para status de cita en las vistas del calendario.
// Colores alineados con los tokens del design system (success, warning,
// brand, info, danger). Cada status devuelve background soft, text, border
// e dot (color sólido para el punto indicador).

export type ApptColors = {
  bg: string;
  text: string;
  border: string;
  dot: string;
  label: string;
};

export function getApptColors(status: string): ApptColors {
  switch (status) {
    case "CONFIRMED":
      return {
        bg:     "rgba(16,185,129,0.12)",
        text:   "#6ee7b7",
        border: "rgba(16,185,129,0.2)",
        dot:    "#10b981",
        label:  "Confirmada",
      };
    case "PENDING":
      return {
        bg:     "rgba(245,158,11,0.12)",
        text:   "#fcd34d",
        border: "rgba(245,158,11,0.2)",
        dot:    "#f59e0b",
        label:  "Pendiente",
      };
    case "IN_PROGRESS":
      return {
        bg:     "rgba(124,58,237,0.12)",
        text:   "#c4b5fd",
        border: "rgba(124,58,237,0.2)",
        dot:    "#7c3aed",
        label:  "En curso",
      };
    case "COMPLETED":
      return {
        bg:     "rgba(59,130,246,0.12)",
        text:   "#93c5fd",
        border: "rgba(59,130,246,0.2)",
        dot:    "#3b82f6",
        label:  "Completada",
      };
    case "CANCELLED":
    case "NO_SHOW":
      return {
        bg:     "rgba(239,68,68,0.12)",
        text:   "#fca5a5",
        border: "rgba(239,68,68,0.2)",
        dot:    "#ef4444",
        label:  status === "NO_SHOW" ? "No asistió" : "Cancelada",
      };
    default:
      return {
        bg:     "rgba(255,255,255,0.04)",
        text:   "var(--text-2)",
        border: "var(--border-soft)",
        dot:    "var(--text-3)",
        label:  status,
      };
  }
}
