"use client";

import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";

const PAYOUT_METHODS: { value: string; label: string; placeholder: string }[] = [
  { value: "", label: "Sin definir", placeholder: "" },
  { value: "SPEI", label: "Transferencia SPEI", placeholder: "CLABE de 18 dígitos" },
  { value: "PAYPAL", label: "PayPal", placeholder: "Correo de tu cuenta PayPal" },
  { value: "OTHER", label: "Otro", placeholder: "Describe cómo quieres recibir tus pagos" },
];

const fieldStyle: React.CSSProperties = {
  height: 42,
  padding: "0 14px",
  borderRadius: 10,
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  color: "var(--text-1)",
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-2)",
  marginBottom: 6,
  display: "block",
};

const checkRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  fontSize: 13.5,
  color: "var(--text-2)",
  cursor: "pointer",
};

const NOTIFY_OPTIONS: { key: "notifySignup" | "notifyConversion" | "notifyPayout"; label: string }[] = [
  { key: "notifySignup", label: "Nuevo registro con tu enlace" },
  { key: "notifyConversion", label: "Referido convertido a cliente de pago" },
  { key: "notifyPayout", label: "Pago de comisiones realizado" },
];

interface NotifyPrefs {
  notifySignup: boolean;
  notifyConversion: boolean;
  notifyPayout: boolean;
}

export function PayoutForm({
  initialMethod,
  initialDetails,
  initialPrefs,
}: {
  initialMethod: string;
  initialDetails: string;
  initialPrefs?: NotifyPrefs;
}) {
  const [method, setMethod] = useState(initialMethod);
  const [details, setDetails] = useState(initialDetails);
  const [prefs, setPrefs] = useState<NotifyPrefs>({
    notifySignup: initialPrefs?.notifySignup ?? true,
    notifyConversion: initialPrefs?.notifyConversion ?? true,
    notifyPayout: initialPrefs?.notifyPayout ?? true,
  });
  const [saving, setSaving] = useState(false);

  const current = PAYOUT_METHODS.find((m) => m.value === method) ?? PAYOUT_METHODS[0];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/afiliados/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payoutMethod: method || undefined,
          payoutDetails: details.trim() || undefined,
          notifySignup: prefs.notifySignup,
          notifyConversion: prefs.notifyConversion,
          notifyPayout: prefs.notifyPayout,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? "No se pudo guardar");
      }
      const json = await res.json().catch(() => ({} as any));
      if (json?.prefsSaved === false) {
        toast.success("Datos de pago actualizados");
        toast("Las preferencias de notificación no se pudieron guardar todavía.", { icon: "⚠️" });
      } else {
        toast.success("Cambios guardados");
      }
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <CardNew title="Datos de pago">
        <p style={{ fontSize: 13, color: "var(--text-3)", margin: "0 0 18px", lineHeight: 1.5 }}>
          Indícanos cómo prefieres recibir tus comisiones. El equipo de DaleControl usará estos datos para
          procesar tus pagos.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 460 }}>
          <div>
            <label style={labelStyle}>Método de pago</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} style={fieldStyle}>
              {PAYOUT_METHODS.map((m) => (
                <option key={m.value || "none"} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {method && (
            <div>
              <label style={labelStyle}>Datos</label>
              <input
                type="text"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder={current.placeholder}
                style={fieldStyle}
              />
            </div>
          )}

          <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", marginBottom: 4 }}>
              Notificaciones por email
            </div>
            <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: "0 0 12px", lineHeight: 1.5 }}>
              Elige qué avisos quieres recibir en tu correo.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {NOTIFY_OPTIONS.map((opt) => (
                <label key={opt.key} style={checkRowStyle}>
                  <input
                    type="checkbox"
                    checked={prefs[opt.key]}
                    onChange={(e) => setPrefs({ ...prefs, [opt.key]: e.target.checked })}
                    style={{ width: 16, height: 16, accentColor: "#8b5cf6", cursor: "pointer" }}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <ButtonNew type="submit" variant="primary" disabled={saving}>
              {saving ? "Guardando…" : "Guardar cambios"}
            </ButtonNew>
          </div>
        </div>
      </CardNew>
    </form>
  );
}
