"use client";
// EndoWhatsAppMessageModal — modal "Enviar mensaje al paciente" con
// las 4 plantillas endo (precita, post-TC inmediato, recordatorio
// restauración, control de seguimiento). Permite editar el texto,
// copiar al portapapeles y abrir wa.me con el número del paciente.

import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Copy, Check, X, ExternalLink } from "lucide-react";
import {
  ENDO_WA_TEMPLATE_LIST,
  ENDO_WA_TEMPLATES,
  type EndoTemplateDef,
  type EndoTemplateKey,
} from "@/lib/whatsapp/endo-templates";

export interface EndoWhatsAppMessageModalProps {
  open: boolean;
  patientName: string;
  /** Teléfono internacional (sin signos). Si null/empty, wa.me se deshabilita. */
  patientPhone?: string | null;
  toothFdi?: number;
  doctorName?: string;
  dateTime?: string;
  initialKey?: EndoTemplateKey;
  onClose: () => void;
  onSend?: (input: { templateKey: EndoTemplateKey; body: string; phone: string | null }) => void;
}

export function EndoWhatsAppMessageModal(props: EndoWhatsAppMessageModalProps) {
  const [selectedKey, setSelectedKey] = useState<EndoTemplateKey>(
    props.initialKey ?? "endo_precita_tc",
  );
  const [body, setBody] = useState("");
  const [copied, setCopied] = useState(false);

  const selected: EndoTemplateDef = useMemo(
    () => ENDO_WA_TEMPLATES[selectedKey] ?? ENDO_WA_TEMPLATE_LIST[0]!,
    [selectedKey],
  );

  useEffect(() => {
    if (!props.open) return;
    setBody(
      selected.build({
        patientName: props.patientName,
        toothFdi: props.toothFdi,
        dateTime: props.dateTime,
        doctorName: props.doctorName,
      }),
    );
  }, [props.open, props.patientName, props.toothFdi, props.dateTime, props.doctorName, selected]);

  if (!props.open) return null;

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      /* ignorar — el doctor puede copiar manual */
    }
  }

  function openWaMe() {
    const phone = (props.patientPhone ?? "").replace(/[^\d]/g, "");
    if (!phone) {
      alert("El paciente no tiene teléfono registrado.");
      return;
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(body)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div role="dialog" aria-modal="true" onClick={props.onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        <header style={header}>
          <strong style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
            <MessageCircle size={16} /> Enviar mensaje al paciente · {props.patientName}
          </strong>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" style={iconBtn}>
            <X size={18} />
          </button>
        </header>
        <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", flex: 1, minHeight: 0 }}>
          <ol
            style={{
              listStyle: "none",
              margin: 0,
              padding: 8,
              borderRight: "1px solid var(--border)",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {ENDO_WA_TEMPLATE_LIST.map((t) => (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => setSelectedKey(t.key)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: "1px solid",
                    borderColor:
                      t.key === selectedKey ? "var(--accent, #2563eb)" : "transparent",
                    background:
                      t.key === selectedKey ? "var(--surface-2)" : "transparent",
                    color: "var(--text-1)",
                    fontSize: 13,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{t.label}</span>
                  <span style={{ fontSize: 11, color: "var(--text-2)" }}>{t.key}</span>
                </button>
              </li>
            ))}
          </ol>
          <div
            style={{
              padding: 14,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-2)" }}>
              {selected.description}
            </p>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              style={{
                padding: 10,
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--surface-2)",
                color: "var(--text-1)",
                fontSize: 13,
                resize: "vertical",
                fontFamily: "inherit",
                lineHeight: 1.5,
              }}
            />
            {props.patientPhone ? (
              <small style={{ color: "var(--text-2)", fontSize: 11 }}>
                Teléfono del paciente: {props.patientPhone}
              </small>
            ) : (
              <small style={{ color: "var(--danger, #dc2626)", fontSize: 11 }}>
                El paciente no tiene teléfono registrado. wa.me no estará disponible.
              </small>
            )}
          </div>
        </div>
        <footer style={footer}>
          <button type="button" onClick={copyToClipboard} style={btnSecondary}>
            {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
            {copied ? "Copiado" : "Copiar texto"}
          </button>
          <button type="button" onClick={openWaMe} style={btnSecondary} disabled={!props.patientPhone}>
            <ExternalLink size={14} /> Abrir wa.me
          </button>
          <button
            type="button"
            onClick={() => {
              props.onSend?.({
                templateKey: selectedKey,
                body,
                phone: props.patientPhone ?? null,
              });
              props.onClose();
            }}
            style={btnPrimary}
          >
            Confirmar
          </button>
        </footer>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 9100,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
};
const modal: React.CSSProperties = {
  width: "min(820px, 100%)",
  maxHeight: "90vh",
  background: "var(--surface-1)",
  color: "var(--text-1)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};
const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 14px",
  borderBottom: "1px solid var(--border)",
};
const footer: React.CSSProperties = {
  display: "flex",
  gap: 8,
  justifyContent: "flex-end",
  padding: "10px 14px",
  borderTop: "1px solid var(--border)",
};
const iconBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--text-2)",
  cursor: "pointer",
};
const btnPrimary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  background: "var(--accent, #2563eb)",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  background: "var(--surface-2)",
  color: "var(--text-1)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 13,
  cursor: "pointer",
};
