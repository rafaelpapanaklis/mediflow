"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X, Calendar, Clock } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { formatTimeInTz } from "@/lib/agenda/date-ranges";
import { useT } from "@/i18n/i18n-provider";

export interface RescheduleConfirmProps {
  open: boolean;
  doctorName: string;
  originalStartsAt: string;
  newStartsAt: string;
  timezone: string;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function formatDateShort(iso: string, timezone: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric", month: "short", year: "numeric", timeZone: timezone,
  }).format(d);
}

export function AgendaRescheduleConfirmModal({
  open, doctorName, originalStartsAt, newStartsAt, timezone, submitting, onConfirm, onCancel,
}: RescheduleConfirmProps) {
  const t = useT();
  const originalTime = formatTimeInTz(originalStartsAt, timezone);
  const originalDate = formatDateShort(originalStartsAt, timezone);
  const newTime = formatTimeInTz(newStartsAt, timezone);
  const newDate = formatDateShort(newStartsAt, timezone);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o && !submitting) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay style={overlayStyle} />
        <Dialog.Content style={dialogStyle} onEscapeKeyDown={onCancel} aria-describedby={undefined}>
          <header style={headerStyle}>
            <Dialog.Title style={titleStyle}>{t("agenda.rescheduleConfirm.title")}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label={t("common.close")} style={closeBtnStyle} disabled={submitting}>
                <X size={16} />
              </button>
            </Dialog.Close>
          </header>

          <div style={bodyStyle}>
            <div style={doctorRowStyle}>
              <span style={{ color: "var(--text-3)", fontSize: 13 }}>{t("agenda.rescheduleConfirm.doctor")}</span>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{doctorName}</span>
            </div>

            <div style={cardsRowStyle}>
              <div style={originalCardStyle}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{t("agenda.rescheduleConfirm.originalAppt")}</div>
                <div style={statusRowStyle}>
                  <Calendar size={14} style={{ color: "var(--text-3)" }} aria-hidden />
                  <span style={{ fontSize: 12, color: "var(--text-2)" }}>{t("agenda.rescheduleConfirm.rescheduled")}</span>
                </div>
                <div style={{ ...timeStyle, textDecoration: "line-through", color: "var(--text-3)" }}>{originalTime}</div>
                <div style={{ ...dateStyle, textDecoration: "line-through", color: "var(--text-3)" }}>{originalDate}</div>
              </div>

              <div style={newCardStyle}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{t("agenda.rescheduleConfirm.newAppt")}</div>
                <div style={statusRowStyle}>
                  <Clock size={14} style={{ color: "var(--brand)" }} aria-hidden />
                  <span style={{ fontSize: 12, color: "var(--brand)" }}>{t("agenda.rescheduleConfirm.pending")}</span>
                </div>
                <div style={timeStyle}>{newTime}</div>
                <div style={dateStyle}>{newDate}</div>
              </div>
            </div>
          </div>

          <footer style={footerStyle}>
            <ButtonNew variant="ghost" onClick={onCancel} disabled={submitting}>
              {t("common.cancel")}
            </ButtonNew>
            <ButtonNew variant="primary" onClick={onConfirm} disabled={submitting}>
              {submitting ? t("agenda.rescheduleConfirm.rescheduling") : t("agenda.rescheduleConfirm.reschedule")}
            </ButtonNew>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(15,10,30,0.55)", backdropFilter: "blur(4px)", zIndex: 80,
};
const dialogStyle: React.CSSProperties = {
  position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
  width: "min(92vw, 560px)", maxHeight: "90vh", background: "var(--bg-elev)", border: "1px solid var(--border-strong)",
  borderRadius: 14, boxShadow: "0 24px 60px -12px rgba(15,10,30,0.4)",
  display: "flex", flexDirection: "column", zIndex: 81,
  fontFamily: "var(--font-sans, system-ui, sans-serif)", overflow: "hidden",
};
const headerStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "16px 20px", borderBottom: "1px solid var(--border-soft)", flexShrink: 0,
};
const titleStyle: React.CSSProperties = { fontSize: 15, fontWeight: 600, color: "var(--text-1)", margin: 0 };
const closeBtnStyle: React.CSSProperties = {
  width: 28, height: 28, display: "grid", placeItems: "center", background: "transparent",
  border: "1px solid transparent", borderRadius: 6, color: "var(--text-2)", cursor: "pointer",
};
const bodyStyle: React.CSSProperties = { padding: 20, display: "flex", flexDirection: "column", gap: 16, flex: 1, overflowY: "auto", minHeight: 0 };
const doctorRowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12 };
const cardsRowStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
const originalCardStyle: React.CSSProperties = {
  padding: 16, border: "1px solid var(--border-soft)", borderRadius: 10, background: "var(--bg-elev-2)",
};
const newCardStyle: React.CSSProperties = {
  padding: 16, border: "1px solid var(--border-brand)", borderRadius: 10, background: "var(--brand-soft)",
};
const statusRowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, marginBottom: 8 };
const timeStyle: React.CSSProperties = { fontSize: 16, fontWeight: 600, marginBottom: 4 };
const dateStyle: React.CSSProperties = { fontSize: 13, color: "var(--text-2)" };
const footerStyle: React.CSSProperties = {
  display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 20px",
  borderTop: "1px solid var(--border-soft)", flexShrink: 0,
};
