"use client";

// Cupón propio del afiliado. Si no tiene: formulario para solicitar su código
// (ej. JUAN10). Si tiene: código + estado (Activo / En revisión) + beneficio +
// rendimiento (usos y registros). El beneficio lo configura y aprueba el
// admin desde /admin/coupons.
//
// Estilo: lenguaje del panel (src/app/afiliados/panel.css) — `Chip` para el
// estado, `Note` para el aviso de BD, `StatRow`/`Stat` para el rendimiento y
// `dcafp-btn`/`dcafp-input` para los controles. Confirmaciones con el toast
// del panel; los errores siguen en react-hot-toast (tiene tono de error).
import { useState } from "react";
import toast from "react-hot-toast";
import { Copy, Check, TicketPercent } from "lucide-react";
import { Chip, Note, Stat, StatRow } from "@/components/afiliados/ui/panel-ui";
import { showPanelToast } from "@/components/afiliados/ui/panel-toast";
import type { AffiliateCouponInfo } from "@/app/api/afiliados/coupon/route";

export type { AffiliateCouponInfo };

const CODE_RE = /^[A-Z0-9]{4,12}$/;

// Tinte verde de los 2 s de "Copiado": estado efímero, no patrón.
const copiedBtnStyle: React.CSSProperties = {
  background: "var(--dcafp-ok-bg)",
  borderColor: "var(--dcafp-ok-line)",
  color: "var(--dcafp-ok-ink)",
};

export function CouponCard({
  initial,
  ready,
}: {
  initial: AffiliateCouponInfo | null;
  ready: boolean; // false = SQL sin correr → solo aviso, sin formulario
}) {
  const [coupon, setCoupon] = useState<AffiliateCouponInfo | null>(initial);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function requestCoupon() {
    const normalized = code.trim().toUpperCase();
    if (!CODE_RE.test(normalized)) {
      toast.error("El código debe tener de 4 a 12 letras o números");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/afiliados/coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: normalized }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error ?? "No se pudo solicitar el cupón");
        return;
      }
      setCoupon(body.coupon ?? null);
      setCode("");
      showPanelToast("Cupón solicitado. Te avisaremos cuando esté activo.");
    } catch {
      toast.error("No se pudo solicitar el cupón");
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!coupon) return;
    try {
      await navigator.clipboard.writeText(coupon.code);
      setCopied(true);
      showPanelToast("Código copiado");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  if (!ready) {
    return (
      <Note tone="warn">
        Disponible en cuanto se active la base de datos (
        <span className="dcafp-mono">sql/afiliados-ventas.sql</span>).
      </Note>
    );
  }

  // CON cupón: código + estado + beneficio + rendimiento
  if (coupon) {
    const benefit = coupon.active
      ? coupon.type === "percentage"
        ? `${coupon.value}% de descuento`
        : `$${coupon.value} MXN de descuento`
      : null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
          <div
            className="dcafp-mono"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              minHeight: 46,
              minWidth: 0,
              padding: "0 16px",
              borderRadius: "var(--dcafp-r-el)",
              background: "var(--dcafp-surface-2)",
              border: "1px solid var(--dcafp-line)",
              color: "var(--dcafp-ink)",
              fontSize: 19,
              fontWeight: 750,
              letterSpacing: "0.1em",
              overflowWrap: "anywhere",
            }}
          >
            <TicketPercent size={18} style={{ color: "var(--dcafp-brand)", flex: "0 0 auto" }} aria-hidden />
            {coupon.code}
          </div>
          <button
            type="button"
            onClick={copyCode}
            className="dcafp-btn dcafp-btn--outline"
            style={copied ? copiedBtnStyle : undefined}
            aria-label="Copiar el código de tu cupón"
          >
            {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
            {copied ? "Copiado" : "Copiar"}
          </button>
          <Chip tone={coupon.active ? "ok" : "amber"} dot>
            {coupon.active ? "Activo" : "En revisión"}
          </Chip>
        </div>

        {benefit ? (
          <p className="dcafp-sub" style={{ marginTop: 0 }}>
            Beneficio para la clínica que lo canjea: <strong>{benefit}</strong>.
          </p>
        ) : (
          <p className="dcafp-sub" style={{ marginTop: 0 }}>
            El equipo DaleControl está revisando tu cupón: definirá el beneficio y lo activará.
          </p>
        )}

        {/* Rendimiento del cupón: solo conteos propios, nunca datos de las
            clínicas. En cero van en gris — un 0 en negro se lee como pérdida. */}
        <StatRow>
          <Stat label="Canjes" value={coupon.usedCount} tone={coupon.usedCount > 0 ? "default" : "idle"} />
          <Stat
            label="Clínicas registradas"
            value={coupon.conversions}
            tone={coupon.conversions > 0 ? "default" : "idle"}
          />
        </StatRow>
      </div>
    );
  }

  // SIN cupón: formulario para solicitarlo
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <p className="dcafp-sub" style={{ marginTop: 0 }}>
        Tu cupón personalizado: las clínicas que lo canjeen al registrarse cuentan como referidas
        tuyas, aunque no usen tu link.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) requestCoupon();
          }}
          placeholder="JUAN10"
          maxLength={12}
          aria-label="Código que quieres para tu cupón"
          className="dcafp-input dcafp-mono"
          style={{
            flex: "0 1 200px",
            minWidth: 0,
            width: "auto",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        />
        <button
          type="button"
          onClick={requestCoupon}
          disabled={busy || !ready}
          className="dcafp-btn dcafp-btn--primary"
        >
          <TicketPercent size={16} aria-hidden />
          {busy ? "Solicitando…" : "Solicitar cupón"}
        </button>
      </div>
      <p className="dcafp-hint" style={{ margin: 0 }}>
        El equipo DaleControl define el beneficio y lo activa.
      </p>
    </div>
  );
}
