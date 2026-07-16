"use client";

// Cupón propio del afiliado. Si no tiene: formulario para solicitar su código
// (ej. JUAN10). Si tiene: código + estado (Activo / En revisión) + beneficio +
// rendimiento (usos y registros). El beneficio lo configura y aprueba el
// admin desde /admin/coupons. Estilo: inline styles + CSS vars del panel,
// BadgeNew para el estado, react-hot-toast.
import { useState } from "react";
import toast from "react-hot-toast";
import { Copy, Check, TicketPercent } from "lucide-react";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import type { AffiliateCouponInfo } from "@/app/api/afiliados/coupon/route";

export type { AffiliateCouponInfo };

const CODE_RE = /^[A-Z0-9]{4,12}$/;

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
      toast.success("Cupón solicitado. Te avisaremos cuando esté activo.");
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
      toast.success("Código copiado");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  if (!ready) {
    return (
      <div
        style={{
          padding: "12px 16px",
          borderRadius: 12,
          border: "1px solid var(--warning-border-strong)",
          background: "var(--warning-soft)",
          color: "var(--text-2)",
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        Disponible en cuanto se active la base de datos (
        <span className="mono">sql/afiliados-ventas.sql</span>).
      </div>
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
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div
            className="mono"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              height: 46,
              padding: "0 16px",
              borderRadius: 10,
              background: "var(--bg-elev-2)",
              border: "1px solid var(--border-soft)",
              color: "var(--text-1)",
              fontSize: 19,
              fontWeight: 700,
              letterSpacing: "0.1em",
            }}
          >
            <TicketPercent size={18} />
            {coupon.code}
          </div>
          <button
            type="button"
            onClick={copyCode}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "0 14px",
              height: 40,
              flexShrink: 0,
              borderRadius: 10,
              border: "1px solid var(--border-brand)",
              background: copied ? "var(--success-soft, rgba(52,211,153,0.12))" : "var(--brand-soft)",
              color: copied ? "var(--success)" : "var(--violet-400)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all .15s",
            }}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "Copiado" : "Copiar"}
          </button>
          <BadgeNew tone={coupon.active ? "success" : "warning"} dot>
            {coupon.active ? "Activo" : "En revisión"}
          </BadgeNew>
        </div>

        {benefit ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
            Beneficio para la clínica que lo canjea: <strong>{benefit}</strong>.
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
            El equipo DaleControl está revisando tu cupón: definirá el beneficio y lo activará.
          </p>
        )}

        <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)", lineHeight: 1.45 }}>
          {coupon.usedCount} canjes · {coupon.conversions} clínicas registradas
        </p>
      </div>
    );
  }

  // SIN cupón: formulario para solicitarlo
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
        Tu cupón personalizado: las clínicas que lo canjeen al registrarse cuentan como
        referidas tuyas, aunque no usen tu link.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) requestCoupon();
          }}
          placeholder="JUAN10"
          maxLength={12}
          className="mono"
          style={{
            width: 200,
            maxWidth: "100%",
            height: 40,
            padding: "0 12px",
            borderRadius: 10,
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border-soft)",
            color: "var(--text-1)",
            fontSize: 14,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={requestCoupon}
          disabled={busy || !ready}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "0 14px",
            height: 40,
            flexShrink: 0,
            borderRadius: 10,
            border: "1px solid var(--border-brand)",
            background: "var(--brand-soft)",
            color: "var(--violet-400)",
            fontSize: 13,
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
            fontFamily: "inherit",
            transition: "all .15s",
          }}
        >
          <TicketPercent size={15} />
          {busy ? "Solicitando…" : "Solicitar cupón"}
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)", lineHeight: 1.45 }}>
        El equipo DaleControl define el beneficio y lo activa.
      </p>
    </div>
  );
}
