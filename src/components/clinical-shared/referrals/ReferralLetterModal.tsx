"use client";
// Clinical-shared — modal para crear hoja de referencia.

import { useEffect, useState } from "react";
import { Mail, MessageCircle, Printer, X } from "lucide-react";
import type { ClinicalModule } from "@prisma/client";
import {
  buildReferralSummary,
  createReferralLetter,
  listDoctorContacts,
  markReferralSent,
} from "@/app/actions/clinical-shared/referrals";
import { isFailure } from "@/lib/clinical-shared/result";

export interface ReferralLetterModalProps {
  patientId: string;
  patientName: string;
  module: ClinicalModule;
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
}

interface ContactOption {
  id: string;
  fullName: string;
  specialty: string | null;
  cedula: string | null;
  phone: string | null;
  email: string | null;
  clinicName: string | null;
}

export function ReferralLetterModal(props: ReferralLetterModalProps) {
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [contactId, setContactId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [referralId, setReferralId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setError(null);
    setReferralId(null);
    setPdfUrl(null);
    setLoading(true);
    void Promise.all([
      listDoctorContacts(),
      buildReferralSummary({ patientId: props.patientId, module: props.module }),
    ]).then(([contactsRes, summaryRes]) => {
      if (isFailure(contactsRes)) setError(contactsRes.error);
      else setContacts(contactsRes.data);
      if (isFailure(summaryRes)) setError(summaryRes.error);
      else setSummary(summaryRes.data.summary);
      setLoading(false);
    });
  }, [props.open, props.patientId, props.module]);

  if (!props.open) return null;

  const onCreate = async () => {
    setError(null);
    setLoading(true);
    const res = await createReferralLetter({
      patientId: props.patientId,
      module: props.module,
      contactId: contactId || null,
      reason,
      summary,
    });
    if (isFailure(res)) {
      setError(res.error);
    } else {
      setReferralId(res.data.id);
      setPdfUrl(res.data.pdfUrl);
      props.onCreated?.(res.data.id);
    }
    setLoading(false);
  };

  const onPrint = () => {
    if (!pdfUrl) return;
    const w = window.open(pdfUrl, "_blank");
    if (w) w.focus();
  };

  const onSend = async (channel: "whatsapp" | "email") => {
    if (!referralId) return;
    const r = await markReferralSent({ id: referralId, channel });
    if (isFailure(r)) {
      setError(r.error);
      return;
    }
    if (channel === "whatsapp") {
      const text = `Hoja de referencia para ${props.patientName}: ${reason}`;
      const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(url, "_blank");
    } else if (channel === "email") {
      const url = `mailto:?subject=${encodeURIComponent("Hoja de referencia")}&body=${encodeURIComponent(`${reason}\n\n${summary}`)}`;
      window.open(url);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Hoja de referencia"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
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
          width: "min(720px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--surface-1)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 16, color: "var(--text-1)" }}>
            Hoja de referencia · {props.patientName}
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
          <label style={{ fontSize: 12, color: "var(--text-2)" }}>Doctor receptor</label>
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            style={selectStyle}
          >
            <option value="">— Sin asignar (texto libre) —</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
                {c.specialty ? ` · ${c.specialty}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--text-2)" }}>Motivo</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej. Interconsulta con ortopedista maxilar por mordida cruzada"
            maxLength={300}
            style={inputStyle}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--text-2)" }}>
            Resumen clínico (auto-llenado, editable)
          </label>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={10}
            style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
          />
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              padding: 8,
              background: "var(--danger-surface, #fee2e2)",
              color: "var(--danger, #b91c1c)",
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : null}

        <footer style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {referralId ? (
            <>
              <button type="button" onClick={onPrint} style={btnSecondary}>
                <Printer size={13} aria-hidden /> Imprimir
              </button>
              <button type="button" onClick={() => void onSend("whatsapp")} style={btnSecondary}>
                <MessageCircle size={13} aria-hidden /> WhatsApp
              </button>
              <button type="button" onClick={() => void onSend("email")} style={btnSecondary}>
                <Mail size={13} aria-hidden /> Email
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void onCreate()}
              disabled={loading || !reason.trim() || !summary.trim()}
              style={btnPrimary}
            >
              {loading ? "Generando…" : "Generar PDF"}
            </button>
          )}
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

const selectStyle: React.CSSProperties = { ...inputStyle, padding: "6px 8px" };

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
