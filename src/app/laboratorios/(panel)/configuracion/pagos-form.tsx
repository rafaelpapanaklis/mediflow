"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Landmark, Wallet, Banknote, CreditCard, ShieldCheck, CheckCircle2 } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";

interface PagosInitial {
  paySpeiEnabled: boolean;
  payMercadoPagoEnabled: boolean;
  payCashEnabled: boolean;
  // El token nunca llega al cliente; solo si HAY uno guardado.
  mpConnected: boolean;
}

// Fila de método: switch accesible + descripción. Espejo del estilo del resto
// de la config (CardNew + var(--*)). Sin librerías de toggle: checkbox nativo
// estilizado como interruptor.
function MethodRow({
  icon,
  title,
  desc,
  checked,
  onChange,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 10,
        border: `1px solid ${checked ? "var(--border-brand)" : "var(--border-soft)"}`,
        background: checked ? "var(--brand-soft)" : "var(--bg-elev)",
        cursor: disabled ? "default" : "pointer",
        transition: "border-color .15s ease, background .15s ease",
      }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          background: checked ? "var(--brand-softer)" : "var(--bg-elev-2)",
          border: `1px solid ${checked ? "var(--border-brand)" : "var(--border-soft)"}`,
          color: checked ? "var(--violet-400)" : "var(--text-3)",
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 16, height: 16, marginTop: 3, flexShrink: 0, cursor: disabled ? "default" : "pointer" }}
      />
    </label>
  );
}

export function PagosForm({ canEdit, initial }: { canEdit: boolean; initial: PagosInitial }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [spei, setSpei] = useState(initial.paySpeiEnabled);
  const [mp, setMp] = useState(initial.payMercadoPagoEnabled);
  const [cash, setCash] = useState(initial.payCashEnabled);

  // Token: nunca se prefill (no llega al cliente). `connected` = ya hay uno
  // guardado. `token` = uno nuevo a guardar. `disconnect` = borrarlo.
  const [connected, setConnected] = useState(initial.mpConnected);
  const [token, setToken] = useState("");
  const [disconnect, setDisconnect] = useState(false);

  const disabled = !canEdit || saving;

  async function save() {
    // Si MercadoPago queda habilitado, debe haber un token (guardado o nuevo).
    if (mp && !connected && !token.trim()) {
      toast.error("Para habilitar MercadoPago, pega tu Access Token.");
      return;
    }
    if (mp && disconnect && !token.trim()) {
      toast.error("No puedes desconectar el token con MercadoPago habilitado.");
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        paySpeiEnabled: spei,
        payMercadoPagoEnabled: mp,
        payCashEnabled: cash,
      };
      if (token.trim()) {
        payload.mpAccessToken = token.trim();
      } else if (disconnect) {
        payload.mpAccessToken = null;
      }

      const res = await fetch("/api/laboratorios/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "No se pudieron guardar los métodos de pago.");
      }
      const data = await res.json().catch(() => ({}));
      // Reflejar el estado real de conexión devuelto por el server.
      setConnected(Boolean(data?.mpConnected));
      setToken("");
      setDisconnect(false);
      toast.success("Métodos de pago actualizados");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CardNew>
      <div className="form-section__title">
        <Wallet size={13} style={{ color: "var(--violet-400)" }} /> Métodos de pago{" "}
        <span className="form-section__rule" />
      </div>
      <p style={{ color: "var(--text-3)", fontSize: 12, marginTop: -4, marginBottom: 14, lineHeight: 1.5 }}>
        Elige cómo pueden pagarte las clínicas por tus servicios. El cobro de MercadoPago llega
        directo a tu cuenta, sin comisión de MediFlow.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <MethodRow
          icon={<Landmark size={16} />}
          title="Transferencia (SPEI)"
          desc="La clínica transfiere a tus cuentas CLABE. Agrégalas en “Cuentas bancarias”."
          checked={spei}
          onChange={setSpei}
          disabled={disabled}
        />
        <MethodRow
          icon={<CreditCard size={16} />}
          title="MercadoPago"
          desc="Cobro en línea con tu propia cuenta de MercadoPago. Requiere tu Access Token."
          checked={mp}
          onChange={setMp}
          disabled={disabled}
        />
        <MethodRow
          icon={<Banknote size={16} />}
          title="Efectivo"
          desc="La clínica paga en efectivo al recibir el trabajo."
          checked={cash}
          onChange={setCash}
          disabled={disabled}
        />
      </div>

      {/* Token de MercadoPago: solo visible cuando el método está habilitado. */}
      {mp && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 10,
            border: "1px solid var(--border-soft)",
            background: "var(--bg-elev)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
              <CreditCard size={15} style={{ color: "var(--violet-400)" }} />
              Conexión con MercadoPago
            </div>
            {connected && !disconnect && (
              <BadgeNew tone="success" dot>
                Conectado
              </BadgeNew>
            )}
          </div>

          <div className="field-new">
            <label className="field-new__label">Access Token</label>
            <input
              className="input-new mono"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                if (e.target.value) setDisconnect(false);
              }}
              disabled={disabled}
              placeholder={connected ? "•••••••• (guardado) — pega uno nuevo para reemplazar" : "APP_USR-…"}
            />
            <span style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <ShieldCheck size={12} style={{ color: "var(--success)" }} />
              Tu Access Token de MercadoPago; los pagos llegan directo a tu cuenta. No se muestra una vez guardado.
            </span>
          </div>

          {connected && (
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {disconnect ? (
                <span style={{ fontSize: 12, color: "var(--danger)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Se desconectará al guardar.{" "}
                  <button
                    type="button"
                    className="btn-new btn-new--ghost btn-new--sm"
                    onClick={() => setDisconnect(false)}
                  >
                    Deshacer
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="btn-new btn-new--ghost btn-new--sm"
                  style={{ color: "var(--danger)" }}
                  disabled={disabled}
                  onClick={() => {
                    // Desconectar el token implica que ya no puedes cobrar por
                    // MercadoPago → deshabilitamos el método para no dejar un
                    // estado inválido (habilitado sin token).
                    setDisconnect(true);
                    setToken("");
                    setMp(false);
                  }}
                >
                  Desconectar token
                </button>
              )}
              {!disconnect && (
                <span style={{ fontSize: 11, color: "var(--text-4)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <CheckCircle2 size={12} style={{ color: "var(--success)" }} />
                  Listo para recibir cobros en línea.
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {canEdit && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <ButtonNew variant="primary" onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar métodos de pago"}
          </ButtonNew>
        </div>
      )}
    </CardNew>
  );
}
