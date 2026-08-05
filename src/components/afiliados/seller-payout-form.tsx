"use client";

// Datos de pago del VENDEDOR. Espejo de payout-form.tsx SIN las preferencias de
// notificación: solo método + datos. PATCH a /api/afiliados/vendedor/me.
// Estilo: clases `dcafp-*` de src/app/afiliados/panel.css (label/input/select/
// botón) + <PanelCard>. Sin título en la tarjeta: la página ya encabeza con
// "Datos de pago" y repetirlo dejaba dos veces el mismo titular.
import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { PanelCard } from "@/components/afiliados/ui/panel-ui";

const PAYOUT_METHODS: { value: string; label: string; placeholder: string }[] = [
  { value: "", label: "Sin definir", placeholder: "" },
  { value: "SPEI", label: "Transferencia SPEI", placeholder: "CLABE de 18 dígitos" },
  { value: "PAYPAL", label: "PayPal", placeholder: "Correo de tu cuenta PayPal" },
  { value: "OTHER", label: "Otro", placeholder: "Describe cómo quieres recibir tus pagos" },
];

export function SellerPayoutForm({
  initialMethod,
  initialDetails,
}: {
  initialMethod: string;
  initialDetails: string;
}) {
  const [method, setMethod] = useState(initialMethod);
  const [details, setDetails] = useState(initialDetails);
  const [saving, setSaving] = useState(false);

  const current = PAYOUT_METHODS.find((m) => m.value === method) ?? PAYOUT_METHODS[0];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/afiliados/vendedor/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payoutMethod: method || undefined,
          payoutDetails: details.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? "No se pudo guardar");
      }
      toast.success("Datos de pago actualizados");
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <PanelCard>
        <p className="dcafp-hint" style={{ marginBottom: 18 }}>
          Indícanos cómo prefieres recibir tus comisiones. El equipo de DaleControl usará estos datos para
          procesar tus pagos.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 460, minWidth: 0 }}>
          <div>
            <label className="dcafp-label" htmlFor="seller-payout-method">
              Método de pago
            </label>
            <select
              id="seller-payout-method"
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
            <div>
              <label className="dcafp-label" htmlFor="seller-payout-details">
                Datos
              </label>
              <input
                id="seller-payout-details"
                className="dcafp-input"
                type="text"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder={current.placeholder}
              />
            </div>
          )}

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
