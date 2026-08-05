"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import toast from "react-hot-toast";
import { Eyebrow, PanelCard } from "@/components/afiliados/ui/panel-ui";

const PAYOUT_METHODS: { value: string; label: string; placeholder: string }[] = [
  { value: "", label: "Sin definir", placeholder: "" },
  { value: "SPEI", label: "Transferencia SPEI", placeholder: "CLABE de 18 dígitos" },
  { value: "PAYPAL", label: "PayPal", placeholder: "Correo de tu cuenta PayPal" },
  { value: "OTHER", label: "Otro", placeholder: "Describe cómo quieres recibir tus pagos" },
];

// Fila de casilla: el <label> envuelve al input, así que todo el renglón es
// zona táctil. `minHeight` la lleva a los 44px del diseño.
const checkRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  minHeight: "var(--dcafp-tap)",
  fontSize: 13.5,
  color: "var(--dcafp-ink-2)",
  cursor: "pointer",
};

const checkboxStyle: CSSProperties = {
  width: 17,
  height: 17,
  flex: "0 0 auto",
  accentColor: "var(--dcafp-brand)",
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
      <PanelCard
        title="Datos de pago"
        sub="Indícanos cómo prefieres recibir tus comisiones. El equipo de DaleControl usará estos datos para procesar tus pagos."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <label className="dcafp-label" htmlFor="payout-method">
              Método de pago
            </label>
            <select
              id="payout-method"
              className="dcafp-select"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {PAYOUT_METHODS.map((m) => (
                <option key={m.value || "none"} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {method && (
            <div style={{ minWidth: 0 }}>
              <label className="dcafp-label" htmlFor="payout-details">
                Datos
              </label>
              <input
                id="payout-details"
                className="dcafp-input"
                type="text"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder={current.placeholder}
              />
            </div>
          )}

          <div
            style={{
              borderTop: "1px solid var(--dcafp-line-soft)",
              paddingTop: 16,
              minWidth: 0,
            }}
          >
            <Eyebrow>Notificaciones por email</Eyebrow>
            <p className="dcafp-hint" style={{ margin: "6px 0 8px" }}>
              Elige qué avisos quieres recibir en tu correo.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {NOTIFY_OPTIONS.map((opt) => (
                <label key={opt.key} style={checkRowStyle}>
                  <input
                    type="checkbox"
                    checked={prefs[opt.key]}
                    onChange={(e) => setPrefs({ ...prefs, [opt.key]: e.target.checked })}
                    style={checkboxStyle}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <button type="submit" className="dcafp-btn dcafp-btn--primary" disabled={saving}>
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </div>
      </PanelCard>
    </form>
  );
}
