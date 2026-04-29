"use client";

import { useState } from "react";

type ArcoType = "ACCESS" | "RECTIFICATION" | "CANCELLATION" | "OPPOSITION";

const TYPE_OPTIONS: Array<{ id: ArcoType; label: string; hint: string }> = [
  { id: "ACCESS",         label: "Acceso",        hint: "Conocer qué datos tienen sobre mí" },
  { id: "RECTIFICATION",  label: "Rectificación", hint: "Corregir datos inexactos" },
  { id: "CANCELLATION",   label: "Cancelación",   hint: "Eliminar mis datos" },
  { id: "OPPOSITION",     label: "Oposición",     hint: "Oponerme a un tratamiento específico" },
];

export function ArcoForm() {
  const [type, setType] = useState<ArcoType>("ACCESS");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [patientId, setPatientId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    | { ok: true; requestId: string; eta: string }
    | { ok: false; error: string }
    | null
  >(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/arco/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          email: email.trim().toLowerCase(),
          reason: reason.trim(),
          patientId: patientId.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ ok: true, requestId: data.requestId, eta: data.eta });
        setEmail(""); setReason(""); setPatientId(""); setType("ACCESS");
      } else {
        setResult({ ok: false, error: humanize(data.error) });
      }
    } catch {
      setResult({ ok: false, error: "No se pudo enviar la solicitud. Intenta de nuevo." });
    } finally {
      setSubmitting(false);
    }
  }

  if (result?.ok) {
    return (
      <div
        style={{
          padding: 20,
          borderRadius: 12,
          background: "rgba(16, 185, 129, 0.08)",
          border: "1px solid rgba(16, 185, 129, 0.30)",
          color: "var(--text-1, #0f172a)",
          fontSize: 14,
        }}
      >
        <strong style={{ display: "block", marginBottom: 4, color: "#059669" }}>
          Solicitud recibida
        </strong>
        Folio: <code>{result.requestId}</code>
        <div style={{ marginTop: 6, fontSize: 13, color: "var(--text-2, #475569)" }}>
          Tiempo de respuesta: {result.eta}. Recibirás novedades en el correo proporcionado.
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label="Tipo de solicitud" required>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setType(opt.id)}
              aria-pressed={type === opt.id}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${type === opt.id ? "var(--brand, #2563eb)" : "var(--border-soft, #cbd5e1)"}`,
                background: type === opt.id ? "var(--brand-softer, #eff6ff)" : "transparent",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>{opt.label}</div>
              <div style={{ fontSize: 11, color: "var(--text-3, #64748b)", marginTop: 2 }}>{opt.hint}</div>
            </button>
          ))}
        </div>
      </Field>

      <Field label="Correo de contacto" required hint="Donde recibirás la respuesta">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@correo.com"
          style={inputStyle}
        />
      </Field>

      <Field label="Detalle de la solicitud" required hint="Mínimo 10 caracteres, máximo 4000.">
        <textarea
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={5}
          placeholder="Describe qué datos quieres acceder, rectificar, cancelar o por qué te opones al tratamiento."
          style={{ ...inputStyle, minHeight: 110, resize: "vertical" }}
        />
      </Field>

      <Field label="Paciente ID (opcional)" hint="Si tu clínica te lo proporcionó">
        <input
          type="text"
          value={patientId}
          onChange={(e) => setPatientId(e.target.value)}
          placeholder="cuid… (opcional)"
          style={inputStyle}
        />
      </Field>

      {result?.ok === false && (
        <div
          role="alert"
          style={{
            padding: "10px 14px",
            background: "rgba(220, 38, 38, 0.08)",
            border: "1px solid rgba(220, 38, 38, 0.30)",
            borderRadius: 8,
            fontSize: 13,
            color: "#b91c1c",
          }}
        >
          {result.error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        style={{
          padding: "12px 18px",
          borderRadius: 10,
          background: "var(--brand, #2563eb)",
          color: "#fff",
          border: "none",
          fontWeight: 700,
          fontSize: 14,
          cursor: submitting ? "wait" : "pointer",
          alignSelf: "flex-start",
          fontFamily: "inherit",
        }}
      >
        {submitting ? "Enviando…" : "Enviar solicitud"}
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid var(--border-soft, #cbd5e1)",
  borderRadius: 10,
  fontSize: 14,
  fontFamily: "inherit",
  background: "var(--bg-elev, #fff)",
  color: "var(--text-1, #0f172a)",
};

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2, #475569)" }}>
        {label} {required && <span style={{ color: "#dc2626" }}>*</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: 11, color: "var(--text-3, #64748b)" }}>{hint}</span>}
    </label>
  );
}

function humanize(error: string): string {
  switch (error) {
    case "invalid_type":      return "Tipo de solicitud inválido.";
    case "reason_too_short":  return "El detalle debe tener al menos 10 caracteres.";
    case "reason_too_long":   return "El detalle no puede exceder 4000 caracteres.";
    case "email_invalid":     return "Correo inválido.";
    case "email_mismatch":    return "El correo no coincide con el registrado para ese paciente.";
    case "patient_not_found": return "No encontramos un paciente con ese ID.";
    default:                  return "No se pudo enviar la solicitud. Intenta de nuevo.";
  }
}
