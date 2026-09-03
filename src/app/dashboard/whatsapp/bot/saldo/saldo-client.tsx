"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Wallet,
  CreditCard,
  Building2,
  Upload,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { aiBillingFeatureLabel } from "@/lib/ai-billing/types";
import { fmtMXNdec, formatRelativeDate } from "@/lib/format";

// ── Tipos de la API (GET /api/ai-wallet) ──────────────────────────────────────
type UsageRow = {
  id: string;
  feature: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  billedCents: number;
  createdAt: string;
};

type TransactionRow = {
  id: string;
  type: "TOPUP" | "CHARGE" | "REFUND" | "ADJUSTMENT";
  amountCents: number;
  balanceAfterCents: number;
  source: "STRIPE" | "MERCADOPAGO" | "SPEI" | "USAGE" | "ADMIN";
  note: string | null;
  createdAt: string;
};

type WalletData = {
  balanceCents: number;
  status: "ACTIVE" | "PAUSED";
  autoRecharge: boolean;
  autoRechargeThresholdCents: number;
  autoRechargeAmountCents: number;
  hasPaymentMethod: boolean;
  isAdmin: boolean;
  usage: UsageRow[];
  transactions: TransactionRow[];
};

// Montos preestablecidos para recargar (en centavos).
const PRESET_AMOUNTS_CENTS = [20000, 50000, 100000, 200000];

// ── Etiquetas en español neutro ───────────────────────────────────────────────
// El historial de esta pantalla ya viene filtrado a consumo prepago, así que en
// la práctica solo aparece "Bot de WhatsApp"; el mapa compartido cubre el resto
// sin que haya que tocar dos archivos si algún día se cobra otra función.
const featureLabel = aiBillingFeatureLabel;

function txTypeLabel(type: TransactionRow["type"]): string {
  switch (type) {
    case "TOPUP":
      return "Recarga";
    case "CHARGE":
      return "Consumo";
    case "REFUND":
      return "Reembolso";
    case "ADJUSTMENT":
      return "Ajuste";
    default:
      return type;
  }
}

function txSourceLabel(source: TransactionRow["source"]): string {
  switch (source) {
    case "STRIPE":
      return "Tarjeta";
    case "MERCADOPAGO":
      return "MercadoPago";
    case "SPEI":
      return "Transferencia";
    case "USAGE":
      return "Uso de IA";
    case "ADMIN":
      return "Ajuste manual";
    default:
      return source;
  }
}

// ── Por qué un $0.00 aquí es CORRECTO ───────────────────────────────────────
// El saldo SOLO se gasta cuando el bot contesta con IA (lib/whatsapp/bot/ai.ts
// llama a chatMetered, y únicamente si canSpend() da true: monedero ACTIVE con
// saldo, o sobregiro con tarjeta). Con el monedero en cero o pausado el bot ni
// siquiera llama al modelo: cae a la FAQ por reglas o al handoff, que son
// gratis. Y los recordatorios y las plantillas de WhatsApp NO consumen IA: los
// cobra Meta a la tarjeta de la clínica. Sin decirlo, el cero parece un error
// de cobro o una pantalla rota.
const SPEND_SCOPE_NOTE =
  "Tu saldo se usa solo cuando el bot responde con IA. Los recordatorios y las plantillas de WhatsApp los cobra Meta a la tarjeta de tu clínica: no salen de aquí.";

const IDLE_CONSEQUENCE_NOTE =
  "El bot no está usando IA: responde solo las preguntas frecuentes que tengas configuradas o pasa la conversación a una persona.";

// Dos motivos distintos para que el monedero esté parado. Decir cuál de los
// dos evita que el mensaje suene equivocado cuando hay saldo pero el monedero
// está pausado.
function idleTitle(status: WalletData["status"]): string {
  return status !== "ACTIVE" ? "Tu monedero está pausado" : "Te quedaste sin saldo";
}

// Ancla de la tarjeta "Recargar saldo", que vive en esta misma pantalla: el CTA
// lleva ahí en vez de inventar una ruta nueva.
const RECHARGE_ANCHOR = "recargar-saldo";

const rootStyle = {
  padding: "clamp(14px, 1.6vw, 28px)",
  maxWidth: 1100,
  margin: "0 auto",
} as const;

export function SaldoClient() {
  const [data, setData] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Recarga.
  const [amountCents, setAmountCents] = useState(50000); // $500 por defecto
  const [customPesos, setCustomPesos] = useState("");
  const [payBusy, setPayBusy] = useState(false);

  // Modal SPEI.
  const [speiOpen, setSpeiOpen] = useState(false);
  const [speiPesos, setSpeiPesos] = useState("");
  const [speiFile, setSpeiFile] = useState<File | null>(null);
  const [speiBusy, setSpeiBusy] = useState(false);

  // Recarga automática.
  const [autoOn, setAutoOn] = useState(false);
  const [thresholdPesos, setThresholdPesos] = useState("");
  const [autoAmountPesos, setAutoAmountPesos] = useState("");
  const [savingAuto, setSavingAuto] = useState(false);

  // ── Carga inicial ────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/ai-wallet");
        if (!res.ok) throw new Error((await res.text().catch(() => "")) || "Error");
        const d: WalletData = await res.json();
        if (!alive) return;
        setData(d);
        setAutoOn(!!d.autoRecharge);
        setThresholdPesos(String((d.autoRechargeThresholdCents || 0) / 100));
        setAutoAmountPesos(String((d.autoRechargeAmountCents || 0) / 100));
      } catch (err: unknown) {
        if (!alive) return;
        setLoadError(true);
        toast.error(
          err instanceof Error && err.message ? err.message : "No se pudo cargar tu saldo",
        );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ── Recargas con pasarela (Tarjeta / MercadoPago) ──────────────────────────────
  async function startCheckout(path: string) {
    setPayBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents }),
      });
      if (res.status === 404) {
        toast("Disponible muy pronto.");
        return;
      }
      if (!res.ok) {
        toast.error("No se pudo iniciar el pago. Inténtalo de nuevo.");
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (json && json.url) {
        window.location.href = json.url;
        return;
      }
      toast.error("No se pudo iniciar el pago. Inténtalo de nuevo.");
    } catch {
      // Las rutas de pago aún no existen (404 hasta que se mergeen).
      toast("Disponible muy pronto.");
    } finally {
      setPayBusy(false);
    }
  }

  // ── SPEI ───────────────────────────────────────────────────────────────────────
  function openSpei() {
    setSpeiPesos(String(amountCents / 100));
    setSpeiFile(null);
    setSpeiOpen(true);
  }

  async function submitSpei() {
    if (!speiFile) {
      toast.error("Adjunta tu comprobante.");
      return;
    }
    setSpeiBusy(true);
    try {
      const pesos = parseFloat(speiPesos);
      const cents = Math.round((Number.isNaN(pesos) ? 0 : pesos) * 100);
      const fd = new FormData();
      fd.append("amountCents", String(cents));
      fd.append("file", speiFile);
      const res = await fetch("/api/ai-wallet/spei/topup", { method: "POST", body: fd });
      if (!res.ok) {
        toast("El pago por transferencia estará disponible muy pronto.");
        return;
      }
      toast.success("Comprobante enviado. Lo revisaremos y acreditaremos tu saldo.");
      setSpeiOpen(false);
    } catch {
      toast("El pago por transferencia estará disponible muy pronto.");
    } finally {
      setSpeiBusy(false);
    }
  }

  // ── Guardar recarga automática ──────────────────────────────────────────────────
  async function saveAuto() {
    setSavingAuto(true);
    try {
      const tp = parseFloat(thresholdPesos);
      const ap = parseFloat(autoAmountPesos);
      const body = {
        autoRecharge: autoOn,
        autoRechargeThresholdCents: Math.round((Number.isNaN(tp) ? 0 : tp) * 100),
        autoRechargeAmountCents: Math.round((Number.isNaN(ap) ? 0 : ap) * 100),
      };
      const res = await fetch("/api/ai-wallet/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 403) {
        toast.error("Solo administradores pueden cambiar esto.");
        return;
      }
      if (!res.ok) {
        toast.error("No se pudo guardar. Inténtalo de nuevo.");
        return;
      }
      const updated = await res.json();
      setData((prev) =>
        prev
          ? {
              ...prev,
              balanceCents: updated.balanceCents ?? prev.balanceCents,
              status: updated.status ?? prev.status,
              autoRecharge: updated.autoRecharge ?? prev.autoRecharge,
              autoRechargeThresholdCents:
                updated.autoRechargeThresholdCents ?? prev.autoRechargeThresholdCents,
              autoRechargeAmountCents:
                updated.autoRechargeAmountCents ?? prev.autoRechargeAmountCents,
              hasPaymentMethod: updated.hasPaymentMethod ?? prev.hasPaymentMethod,
            }
          : prev,
      );
      toast.success("Guardado");
    } catch {
      toast.error("No se pudo guardar. Inténtalo de nuevo.");
    } finally {
      setSavingAuto(false);
    }
  }

  // ── Estados de carga / error ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={rootStyle}>
        <div style={{ color: "var(--text-3)", fontSize: 13, padding: "40px 0", textAlign: "center" }}>
          Cargando…
        </div>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div style={rootStyle}>
        <div style={{ marginBottom: 16 }}>
          <Link href="/dashboard/whatsapp/bot" className="btn-new btn-new--ghost">
            ← Volver al bot
          </Link>
        </div>
        <CardNew title="No se pudo cargar tu saldo" sub="Vuelve a intentarlo en unos momentos.">
          <ButtonNew variant="primary" onClick={() => window.location.reload()}>
            Reintentar
          </ButtonNew>
        </CardNew>
      </div>
    );
  }

  const lowThreshold = data.autoRechargeThresholdCents > 0 ? data.autoRechargeThresholdCents : 5000;
  const showLowWarning = !data.autoRecharge && data.balanceCents < lowThreshold;
  // Monedero parado = pausado o sin saldo. Es exactamente lo que hace que
  // canSpend() devuelva false y el bot no llame a la IA.
  const walletIdle = data.status !== "ACTIVE" || data.balanceCents <= 0;
  const spentCents = data.usage.reduce((acc, u) => acc + u.billedCents, 0);

  return (
    <div style={rootStyle}>
      {/* ── Header ── */}
      <div style={{ marginBottom: 16 }}>
        <Link href="/dashboard/whatsapp/bot" className="btn-new btn-new--ghost">
          ← Volver al bot
        </Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: "var(--brand-soft)",
            border: "1px solid var(--border-soft)",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Wallet size={20} style={{ color: "var(--brand)" }} />
        </div>
        <div>
          <h1
            style={{
              fontSize: "clamp(16px, 1.4vw, 22px)",
              letterSpacing: "-0.02em",
              color: "var(--text-1)",
              fontWeight: 600,
              margin: 0,
            }}
          >
            Saldo de IA
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
            Paga solo lo que tu asistente de IA consume. Sin mensualidades.
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        {/* ── Balance hero ── */}
        <CardNew>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}>
                Saldo disponible
              </div>
              <div style={{ fontSize: 40, fontWeight: 600, color: "var(--text-1)", lineHeight: 1.1 }}>
                {fmtMXNdec(data.balanceCents / 100)}
              </div>
            </div>
            <BadgeNew tone={data.status === "ACTIVE" ? "success" : "warning"} dot>
              {data.status === "ACTIVE" ? "Activo" : "Pausado"}
            </BadgeNew>
          </div>
          {walletIdle ? (
            <div
              style={{
                marginTop: 14,
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid var(--border-soft)",
                background: "var(--bg-elev-2)",
                fontSize: 12.5,
                lineHeight: 1.6,
                color: "var(--text-2)",
              }}
            >
              <div style={{ fontWeight: 600, color: "var(--text-1)", marginBottom: 3 }}>
                {idleTitle(data.status)}
              </div>
              {IDLE_CONSEQUENCE_NOTE} Mientras tanto no se te cobra nada.
              {/* La tarjeta "Consumo de IA" explica lo mismo, pero queda al final de
                  la página: quien mira el $0.00 lo tiene aquí arriba. */}
              <div style={{ marginTop: 8, color: "var(--text-3)" }}>{SPEND_SCOPE_NOTE}</div>
              <RechargeCta isAdmin={data.isAdmin} />
            </div>
          ) : showLowWarning ? (
            <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 12 }}>
              Saldo bajo — recarga para que tu bot siga respondiendo.
            </div>
          ) : null}
        </CardNew>

        {/* ── Recargar (solo admin) ── */}
        {data.isAdmin ? (
          <>
            <CardNew id={RECHARGE_ANCHOR} title="Recargar saldo" sub="Elige un monto y un método de pago.">
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Chips de monto */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {PRESET_AMOUNTS_CENTS.map((cents) => {
                    const selected = !customPesos && amountCents === cents;
                    return (
                      <button
                        key={cents}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          setAmountCents(cents);
                          setCustomPesos("");
                        }}
                        style={{
                          padding: "9px 16px",
                          borderRadius: 999,
                          cursor: "pointer",
                          fontSize: 13,
                          fontWeight: 600,
                          color: selected ? "var(--brand)" : "var(--text-2)",
                          border: `1px solid ${selected ? "var(--brand)" : "var(--border-soft)"}`,
                          background: selected ? "var(--brand-soft)" : "var(--bg-elev)",
                          transition: "all .15s",
                        }}
                      >
                        {fmtMXNdec(cents / 100)}
                      </button>
                    );
                  })}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--text-3)" }}>Otro monto $</span>
                    <input
                      className="input-new mono"
                      type="number"
                      min={0}
                      step="1"
                      style={{ width: 120 }}
                      placeholder="0"
                      value={customPesos}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCustomPesos(v);
                        const pesos = parseFloat(v);
                        if (!Number.isNaN(pesos) && pesos > 0) {
                          setAmountCents(Math.round(pesos * 100));
                        }
                      }}
                    />
                  </div>
                </div>

                {/* Botones de método de pago */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <ButtonNew
                    variant="primary"
                    icon={<CreditCard size={15} />}
                    disabled={payBusy}
                    onClick={() => startCheckout("/api/ai-wallet/stripe/checkout")}
                  >
                    Tarjeta
                  </ButtonNew>
                  <ButtonNew
                    variant="secondary"
                    icon={<Wallet size={15} />}
                    disabled={payBusy}
                    onClick={() => startCheckout("/api/ai-wallet/mercadopago/checkout")}
                  >
                    MercadoPago
                  </ButtonNew>
                  <ButtonNew
                    variant="secondary"
                    icon={<Building2 size={15} />}
                    disabled={payBusy}
                    onClick={openSpei}
                  >
                    Transferencia (SPEI)
                  </ButtonNew>
                </div>
              </div>
            </CardNew>

            {/* ── Recarga automática ── */}
            <CardNew title="Recarga automática" sub="Mantén tu bot siempre disponible sin pensar en el saldo.">
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <Switch on={autoOn} onClick={() => setAutoOn((v) => !v)} disabled={savingAuto} />
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>
                    Recargar automáticamente cuando el saldo esté bajo
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 14,
                  }}
                >
                  <div className="field-new">
                    <label className="field-new__label">Recargar cuando baje de ($)</label>
                    <input
                      className="input-new mono"
                      type="number"
                      min={0}
                      step="1"
                      value={thresholdPesos}
                      onChange={(e) => setThresholdPesos(e.target.value)}
                    />
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">Recargar este monto ($)</label>
                    <input
                      className="input-new mono"
                      type="number"
                      min={0}
                      step="1"
                      value={autoAmountPesos}
                      onChange={(e) => setAutoAmountPesos(e.target.value)}
                    />
                  </div>
                </div>

                {!data.hasPaymentMethod && (
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                    Para la recarga automática necesitas guardar una tarjeta (botón Tarjeta).
                  </div>
                )}

                <div>
                  <ButtonNew variant="primary" onClick={saveAuto} disabled={savingAuto}>
                    {savingAuto ? "Guardando…" : "Guardar"}
                  </ButtonNew>
                </div>
              </div>
            </CardNew>
          </>
        ) : (
          <CardNew>
            <div style={{ fontSize: 13, color: "var(--text-3)" }}>
              Solo administradores pueden recargar o configurar la recarga automática.
            </div>
          </CardNew>
        )}

        {/* ── Historial de consumo ── */}
        <CardNew title="Consumo de IA" sub="Detalle de lo que ha consumido tu asistente." noPad>
          {data.usage.length === 0 ? (
            <div style={{ padding: "28px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 600, color: "var(--text-1)", lineHeight: 1.1 }}>
                {fmtMXNdec(spentCents / 100)}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
                gastado en IA hasta hoy
              </div>
              <p
                style={{
                  maxWidth: 520,
                  margin: "12px auto 0",
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  color: "var(--text-2)",
                }}
              >
                {SPEND_SCOPE_NOTE}
              </p>
              {walletIdle && (
                <p
                  style={{
                    maxWidth: 520,
                    margin: "8px auto 0",
                    fontSize: 12.5,
                    lineHeight: 1.6,
                    color: "var(--text-2)",
                  }}
                >
                  {`${idleTitle(data.status)}. ${IDLE_CONSEQUENCE_NOTE}`}
                </p>
              )}
            </div>
          ) : (
            <table className="table-new">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Detalle</th>
                  <th className="mono">Tokens</th>
                  <th className="mono">Costo</th>
                </tr>
              </thead>
              <tbody>
                {data.usage.map((u) => (
                  <tr key={u.id}>
                    <td>{formatRelativeDate(u.createdAt)}</td>
                    <td>{featureLabel(u.feature)}</td>
                    <td className="mono">
                      {(u.inputTokens + u.outputTokens).toLocaleString("es-MX")}
                    </td>
                    <td className="mono">{fmtMXNdec(u.billedCents / 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardNew>

        {/* ── Historial de movimientos ── */}
        <CardNew title="Recargas y movimientos" sub="Tus recargas, consumos y ajustes de saldo." noPad>
          {data.transactions.length === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>
              Aún no hay movimientos.
            </div>
          ) : (
            <table className="table-new">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Origen</th>
                  <th className="mono">Monto</th>
                  <th className="mono">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((t) => {
                  const positive = t.amountCents >= 0;
                  return (
                    <tr key={t.id}>
                      <td>{formatRelativeDate(t.createdAt)}</td>
                      <td>{txTypeLabel(t.type)}</td>
                      <td>{txSourceLabel(t.source)}</td>
                      <td className="mono" style={{ color: positive ? "#16a34a" : "#dc2626" }}>
                        {positive ? "+" : ""}
                        {fmtMXNdec(t.amountCents / 100)}
                      </td>
                      <td className="mono">{fmtMXNdec(t.balanceAfterCents / 100)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardNew>
      </div>

      {/* ── Modal SPEI ── */}
      {speiOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setSpeiOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(15,10,30,0.55)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 440,
              background: "var(--bg-elev)",
              border: "1px solid var(--border-soft)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
              padding: 20,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 14,
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>
                  Transferencia (SPEI)
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 4 }}>
                  Indica el monto que transferiste y adjunta tu comprobante.
                </div>
              </div>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => setSpeiOpen(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: "var(--text-3)",
                  padding: 4,
                  lineHeight: 0,
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="field-new">
                <label className="field-new__label">Monto ($)</label>
                <input
                  className="input-new mono"
                  type="number"
                  min={0}
                  step="1"
                  value={speiPesos}
                  onChange={(e) => setSpeiPesos(e.target.value)}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">Comprobante</label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setSpeiFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <ButtonNew variant="ghost" onClick={() => setSpeiOpen(false)} disabled={speiBusy}>
                  Cancelar
                </ButtonNew>
                <ButtonNew
                  variant="primary"
                  icon={<Upload size={15} />}
                  onClick={submitSpei}
                  disabled={speiBusy}
                >
                  {speiBusy ? "Enviando…" : "Enviar comprobante"}
                </ButtonNew>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// CTA de recarga. No inventa ruta: ancla a la tarjeta "Recargar saldo" de esta
// misma pantalla, que es donde viven Tarjeta / MercadoPago / SPEI. Si quien mira
// no es administrador esa tarjeta no se pinta, así que se le dice a quién pedirlo.
function RechargeCta({ isAdmin }: { isAdmin: boolean }) {
  if (!isAdmin) {
    return (
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-3)" }}>
        Pídele a un administrador de la clínica que recargue el saldo.
      </div>
    );
  }
  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        className="btn-new btn-new--secondary"
        onClick={() =>
          document
            .getElementById(RECHARGE_ANCHOR)
            // `center` en vez de un ancla #: así la barra superior fija no tapa
            // la tarjeta a la que acabamos de mandar al usuario.
            ?.scrollIntoView({ behavior: "smooth", block: "center" })
        }
      >
        <Wallet size={15} /> Recargar saldo
      </button>
    </div>
  );
}

// Interruptor del design system: la clase global `.switch` de globals.css. Aquí
// había una COPIA con estilos inline porque `.switch` pintaba el OFF con blanco
// al 10 % y desaparecía sobre las tarjetas claras; con el token --switch-off
// arreglado, la copia sobra.
function Switch({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`switch ${on ? "switch--on" : ""}`}
    >
      <span className="switch__thumb" />
    </button>
  );
}
