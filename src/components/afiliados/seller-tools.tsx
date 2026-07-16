"use client";

// Herramientas del VENDEDOR: multi-links con campaña (crear/listar/eliminar +
// copiar URL + QR descargable) y su cupón propio. Espejo de los componentes de
// herramientas del afiliado (links-manager.tsx + coupon-card.tsx) pero contra
// /api/afiliados/vendedor/*. Carga sus datos en el cliente al montar; si el SQL
// no está aplicado (503 tools_not_ready) muestra un aviso suave en cada sección.
// Estilo: inline styles con CSS vars del panel + react-hot-toast. 100% responsive.
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  Copy,
  Check,
  Plus,
  Trash2,
  MousePointerClick,
  TicketPercent,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { QrDownloadButton } from "@/components/afiliados/tools/qr-download-button";

type SellerLink = {
  id: string;
  name: string;
  campaign: string;
  clicks: number;
  url: string;
};

type SellerCouponInfo = {
  code: string;
  active: boolean;
  type: string;
  value: number;
  usedCount: number;
  conversions: number;
};

const CODE_RE = /^[A-Z0-9]{4,12}$/;

const urlInputStyle: React.CSSProperties = {
  flex: "1 1 220px",
  minWidth: 0,
  height: 40,
  padding: "0 12px",
  borderRadius: 10,
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  color: "var(--text-2)",
  fontSize: 12.5,
  outline: "none",
};

const chipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "3px 9px",
  borderRadius: 999,
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  color: "var(--text-3)",
  fontSize: 11.5,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

function brandButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
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
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    fontFamily: "inherit",
    transition: "all .15s",
    whiteSpace: "nowrap",
  };
}

function notReadyBanner() {
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: 10,
        border: "1px solid var(--warning-border-strong)",
        background: "var(--warning-soft)",
        color: "var(--text-2)",
        fontSize: 12.5,
        lineHeight: 1.5,
      }}
    >
      Disponible en cuanto se active la base de datos (
      <span className="mono">sql/afiliados-ventas.sql</span>).
    </div>
  );
}

function errorMessage(body: any, fallback: string): string {
  if (body?.error === "tools_not_ready") {
    return "Las herramientas aún no están activas en la base de datos.";
  }
  return typeof body?.error === "string" && body.error ? body.error : fallback;
}

// ── Sección de links ──────────────────────────────────────────────────────
function SellerLinks() {
  const [links, setLinks] = useState<SellerLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/afiliados/vendedor/links");
        const body = await res.json().catch(() => null);
        if (!alive) return;
        if (res.status === 503 || body?.error === "tools_not_ready") {
          setReady(false);
        } else if (res.ok && Array.isArray(body?.links)) {
          setLinks(body.links as SellerLink[]);
        }
      } catch {
        if (alive) setReady(false);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const canCreate = ready && !creating && name.trim().length >= 2;

  async function createLink() {
    if (!canCreate) return;
    setCreating(true);
    try {
      const res = await fetch("/api/afiliados/vendedor/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.link) {
        toast.error(errorMessage(body, "No se pudo crear el link"));
        return;
      }
      setLinks((prev) => [...prev, body.link as SellerLink]);
      setName("");
      toast.success("Link creado");
    } catch {
      toast.error("No se pudo crear el link");
    } finally {
      setCreating(false);
    }
  }

  async function copy(link: SellerLink) {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopiedId(link.id);
      toast.success("Enlace copiado");
      setTimeout(() => setCopiedId((id) => (id === link.id ? null : id)), 2000);
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  async function removeLink(link: SellerLink) {
    // Paso 1: armar confirmación (se desarma sola a los 4 s).
    if (confirmingId !== link.id) {
      setConfirmingId(link.id);
      setTimeout(() => setConfirmingId((id) => (id === link.id ? null : id)), 4000);
      return;
    }
    // Paso 2: eliminar de verdad.
    if (deletingId) return;
    setDeletingId(link.id);
    try {
      const res = await fetch(`/api/afiliados/vendedor/links/${link.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(errorMessage(body, "No se pudo eliminar el link"));
        return;
      }
      setLinks((prev) => prev.filter((x) => x.id !== link.id));
      toast.success("Link eliminado");
    } catch {
      toast.error("No se pudo eliminar el link");
    } finally {
      setDeletingId(null);
      setConfirmingId((id) => (id === link.id ? null : id));
    }
  }

  return (
    <CardNew
      title="Tus links por campaña"
      sub="Crea un link por canal (Facebook, WhatsApp, expos...) y descubre cuál te trae más clínicas."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {!ready && notReadyBanner()}

        {/* Crear link */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void createLink();
          }}
          style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Facebook, WhatsApp, Expo dental..."
            aria-label="Nombre de la campaña"
            maxLength={40}
            disabled={!ready || creating}
            style={{
              ...urlInputStyle,
              color: "var(--text-1)",
              fontSize: 13,
              opacity: ready ? 1 : 0.55,
            }}
          />
          <button type="submit" disabled={!canCreate} style={brandButtonStyle(!canCreate)}>
            <Plus size={15} />
            {creating ? "Creando..." : "Crear link"}
          </button>
        </form>

        {loading ? (
          <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>Cargando…</p>
        ) : links.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
            Crea tu primer link nombrado para saber qué canal te trae más clínicas.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {links.map((l) => {
              const copied = copiedId === l.id;
              const confirming = confirmingId === l.id;
              const deleting = deletingId === l.id;
              return (
                <div key={l.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{l.name}</span>
                    <span style={chipStyle}>
                      <MousePointerClick size={12} />
                      {l.clicks} clics
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
                    <input
                      readOnly
                      value={l.url}
                      onFocus={(e) => e.currentTarget.select()}
                      className="mono"
                      style={urlInputStyle}
                    />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => void copy(l)}
                        style={{
                          ...brandButtonStyle(false),
                          background: copied
                            ? "var(--success-soft, rgba(52,211,153,0.12))"
                            : "var(--brand-soft)",
                          color: copied ? "var(--success)" : "var(--violet-400)",
                        }}
                      >
                        {copied ? <Check size={15} /> : <Copy size={15} />}
                        {copied ? "Copiado" : "Copiar"}
                      </button>
                      <QrDownloadButton url={l.url} fileName={`qr-${l.campaign}`} />
                      <button
                        type="button"
                        onClick={() => void removeLink(l)}
                        disabled={deleting}
                        aria-label={confirming ? "Confirmar eliminación" : `Eliminar link ${l.name}`}
                        title={confirming ? "Se perderán los clics de este link" : "Eliminar link"}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                          padding: "0 12px",
                          height: 40,
                          flexShrink: 0,
                          borderRadius: 10,
                          border: confirming
                            ? "1px solid var(--danger-border-strong)"
                            : "1px solid var(--border-soft)",
                          background: confirming ? "var(--danger-soft)" : "var(--bg-elev-2)",
                          color: confirming ? "var(--danger)" : "var(--text-3)",
                          fontSize: 12.5,
                          fontWeight: 600,
                          cursor: deleting ? "not-allowed" : "pointer",
                          opacity: deleting ? 0.55 : 1,
                          fontFamily: "inherit",
                          transition: "all .15s",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <Trash2 size={15} />
                        {confirming ? (deleting ? "Eliminando..." : "¿Eliminar?") : ""}
                      </button>
                    </div>
                  </div>
                  {confirming && (
                    <p style={{ fontSize: 11.5, color: "var(--warning-strong)", margin: 0, lineHeight: 1.4 }}>
                      Se perderán los clics de este link. Pulsa &quot;¿Eliminar?&quot; otra vez para confirmar.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </CardNew>
  );
}

// ── Sección de cupón ──────────────────────────────────────────────────────
function SellerCoupon() {
  const [coupon, setCoupon] = useState<SellerCouponInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/afiliados/vendedor/coupon");
        const body = await res.json().catch(() => null);
        if (!alive) return;
        if (res.status === 503 || body?.error === "tools_not_ready") {
          setReady(false);
        } else if (res.ok) {
          setCoupon(body?.coupon ?? null);
        }
      } catch {
        if (alive) setReady(false);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function requestCoupon() {
    const normalized = code.trim().toUpperCase();
    if (!CODE_RE.test(normalized)) {
      toast.error("El código debe tener de 4 a 12 letras o números");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/afiliados/vendedor/coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: normalized }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(errorMessage(body, "No se pudo solicitar el cupón"));
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

  let inner: React.ReactNode;
  if (!ready) {
    inner = notReadyBanner();
  } else if (loading) {
    inner = <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>Cargando…</p>;
  } else if (coupon) {
    const benefit = coupon.active
      ? coupon.type === "percentage"
        ? `${coupon.value}% de descuento`
        : `$${coupon.value} MXN de descuento`
      : null;
    inner = (
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
          {coupon.usedCount} canjes
        </p>
      </div>
    );
  } else {
    inner = (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
          Tu cupón personalizado: las clínicas que lo canjeen al registrarse cuentan como referidas tuyas,
          aunque no usen tu link.
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
            disabled={busy}
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

  return (
    <CardNew
      title="Tu cupón"
      sub="Un código con tu nombre: quien lo canjea al registrarse cuenta como referido tuyo, aunque no use tu link."
    >
      {inner}
    </CardNew>
  );
}

export function SellerTools(_props: { siteUrl: string; parentSlug: string }) {
  // SIN "enlace base": un /socio/<slug> sin ?c= atribuiría la clínica solo al
  // afiliado PADRE, no al vendedor. El vendedor SIEMPRE debe compartir un link
  // con campaña (lleva su sellerId) para ganar su comisión.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SellerLinks />
      <SellerCoupon />
    </div>
  );
}
