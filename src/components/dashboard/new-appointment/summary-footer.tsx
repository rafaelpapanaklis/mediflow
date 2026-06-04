"use client";

import { Info, Loader2 } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useT } from "@/i18n/i18n-provider";

interface Props {
  summary: React.ReactNode;
  submitting: boolean;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}

/**
 * Footer pegajoso del rediseño: resumen textual en vivo (icono info + detalle
 * de la cita) + botones Cancelar (ghost) y Crear cita (primario violeta).
 * Mantiene ButtonNew y la lógica de disabled/submitting del padre.
 */
export function SummaryFooter({ summary, submitting, disabled, onCancel, onSubmit }: Props) {
  const t = useT();
  return (
    <footer style={footerStyle}>
      <div style={summaryWrapStyle}>
        <Info size={14} aria-hidden style={{ color: "var(--brand)", flexShrink: 0 }} />
        <span style={summaryTextStyle}>{summary}</span>
      </div>
      <ButtonNew variant="ghost" onClick={onCancel} disabled={submitting}>
        {t("common.cancel")}
      </ButtonNew>
      <ButtonNew variant="primary" onClick={onSubmit} disabled={disabled}>
        {submitting ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            {t("appointments.summaryFooter.creating")}
          </>
        ) : (
          t("appointments.summaryFooter.createAppointment")
        )}
      </ButtonNew>
    </footer>
  );
}

const footerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "14px 24px",
  borderTop: "1px solid var(--border-soft)",
  background: "var(--bg)",
};

const summaryWrapStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const summaryTextStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 13,
  color: "var(--text-3)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
