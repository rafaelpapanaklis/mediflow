"use client";
// Pediatrics — modal "Enviar mensaje al tutor" con preview en vivo.
//
// El doctor selecciona la plantilla, ajusta el contexto (recomendaciones
// libres, doctor, etc.) y ve el mensaje renderizado antes de enviar via
// wa.me (link directo al WhatsApp del tutor) o copiar al portapapeles.

import { useEffect, useMemo, useState } from "react";
import { Copy, MessageCircle, X } from "lucide-react";
import {
  PED_TUTOR_TEMPLATE_LIST,
  buildTutorMessage,
  type TutorTemplateContext,
  type TutorTemplateKey,
} from "@/lib/whatsapp/templates";

export interface SendTutorMessageModalProps {
  open: boolean;
  onClose: () => void;
  childName: string;
  guardianName: string;
  guardianPhone: string | null;
  clinicName: string;
  doctorName?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  yearsSinceFirstVisit?: number;
  /** Plantilla pre-seleccionada al abrir el modal. */
  defaultTemplate?: TutorTemplateKey;
}

export function SendTutorMessageModal(props: SendTutorMessageModalProps) {
  const [tplKey, setTplKey] = useState<TutorTemplateKey>(
    props.defaultTemplate ?? "ped_pre_cita",
  );
  const [recommendations, setRecommendations] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (props.open) {
      setTplKey(props.defaultTemplate ?? "ped_pre_cita");
      setRecommendations("");
      setCopied(false);
    }
  }, [props.open, props.defaultTemplate]);

  const ctx: TutorTemplateContext = useMemo(
    () => ({
      childName: props.childName,
      guardianName: props.guardianName,
      clinicName: props.clinicName,
      doctorName: props.doctorName,
      appointmentDate: props.appointmentDate,
      appointmentTime: props.appointmentTime,
      yearsSinceFirstVisit: props.yearsSinceFirstVisit,
      recommendations: recommendations
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    }),
    [props, recommendations],
  );

  const preview = useMemo(() => buildTutorMessage(tplKey, ctx), [tplKey, ctx]);

  if (!props.open) return null;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(preview);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // sin clipboard — el textarea es selectable manualmente
    }
  };

  const onSend = () => {
    const phone = (props.guardianPhone ?? "").replace(/\D/g, "");
    const text = encodeURIComponent(preview);
    const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url, "_blank");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Enviar mensaje al tutor"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 220,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={props.onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--surface-1)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 16, color: "var(--text-1)" }}>
            Enviar mensaje al tutor
          </h2>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={props.onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-2)",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--text-2)" }}>Plantilla</label>
          <select
            value={tplKey}
            onChange={(e) => setTplKey(e.target.value as TutorTemplateKey)}
            style={selectStyle}
          >
            {PED_TUTOR_TEMPLATE_LIST.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <small style={{ fontSize: 11, color: "var(--text-2)" }}>
            {PED_TUTOR_TEMPLATE_LIST.find((t) => t.key === tplKey)?.description}
          </small>
        </div>

        {tplKey === "ped_post_cita_recomendaciones" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--text-2)" }}>
              Recomendaciones (una por línea)
            </label>
            <textarea
              value={recommendations}
              onChange={(e) => setRecommendations(e.target.value)}
              rows={4}
              placeholder={"Cepillado supervisado 2 veces al día\nEvitar dulces 24h\n…"}
              style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
            />
          </div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--text-2)" }}>Vista previa</label>
          <div
            style={{
              whiteSpace: "pre-line",
              padding: 12,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 13,
              color: "var(--text-1)",
              lineHeight: 1.5,
            }}
          >
            {preview}
          </div>
        </div>

        {!props.guardianPhone ? (
          <div
            role="alert"
            style={{
              fontSize: 12,
              color: "var(--warning, #b45309)",
              background: "var(--warning-surface, #fef3c7)",
              padding: 8,
              borderRadius: 6,
            }}
          >
            El tutor no tiene teléfono registrado. Puedes copiar el mensaje y enviarlo manualmente.
          </div>
        ) : null}

        <footer style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={() => void onCopy()} style={btnSecondary}>
            <Copy size={13} aria-hidden /> {copied ? "Copiado" : "Copiar"}
          </button>
          <button type="button" onClick={onSend} style={btnPrimary}>
            <MessageCircle size={13} aria-hidden /> Abrir WhatsApp
          </button>
        </footer>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-1)",
  fontSize: 13,
  padding: "6px 8px",
};

const selectStyle: React.CSSProperties = { ...inputStyle };

const btnPrimary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  fontSize: 13,
  background: "var(--accent)",
  color: "var(--text-on-accent, #fff)",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  fontSize: 13,
  background: "var(--surface-2)",
  color: "var(--text-1)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  cursor: "pointer",
};
