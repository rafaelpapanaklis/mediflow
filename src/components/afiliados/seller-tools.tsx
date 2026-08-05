"use client";

// Herramientas del VENDEDOR: multi-links con campaña (crear/listar/eliminar +
// copiar URL + QR descargable) y su cupón propio. Espejo de los componentes de
// herramientas del afiliado (links-manager.tsx + coupon-card.tsx) pero contra
// /api/afiliados/vendedor/*. Carga sus datos en el cliente al montar; si el SQL
// no está aplicado (503 tools_not_ready) muestra un aviso suave en cada sección.
//
// Estilo: clases `dcafp-*` de src/app/afiliados/panel.css + primitivas de
// components/afiliados/ui (PanelCard, Chip, Note, EmptyState, Stat). Copiar el
// enlace/cupón usa CopyButton/CopyCodeButton, que traen el toast del panel (la
// píldora de abajo); el resto de avisos —crear, eliminar, errores— sigue en
// react-hot-toast. 100% responsive: nada desborda a 375px.
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Link2, MousePointerClick, Plus, TicketPercent, Trash2 } from "lucide-react";
import {
  Chip,
  EmptyState,
  Note,
  PanelCard,
  Stat,
  StatRow,
} from "@/components/afiliados/ui/panel-ui";
import { CopyButton, CopyCodeButton } from "@/components/afiliados/ui/copy-button";
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

function NotReadyNote() {
  return (
    <Note tone="warn">
      Disponible en cuanto se active la base de datos (
      <span className="dcafp-mono">sql/afiliados-ventas.sql</span>).
    </Note>
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
    <PanelCard
      title="Tus links por campaña"
      sub="Crea un link por canal (Facebook, WhatsApp, expos...) y descubre cuál te trae más clínicas."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        {!ready && <NotReadyNote />}

        {/* Crear link */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void createLink();
          }}
          style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}
        >
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <label className="dcafp-label" htmlFor="seller-link-name">
              Nombre de la campaña
            </label>
            <input
              id="seller-link-name"
              className="dcafp-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Facebook, WhatsApp, Expo dental..."
              maxLength={40}
              disabled={!ready || creating}
              style={{ opacity: ready ? 1 : 0.55 }}
            />
          </div>
          <button type="submit" className="dcafp-btn dcafp-btn--primary" disabled={!canCreate}>
            <Plus size={16} aria-hidden />
            {creating ? "Creando..." : "Crear link"}
          </button>
        </form>

        {loading ? (
          <p className="dcafp-hint">Cargando…</p>
        ) : links.length === 0 ? (
          <EmptyState icon={<Link2 size={22} />} title="Aún no tienes links">
            Crea tu primer link con nombre —Facebook, WhatsApp, una expo— y aquí verás cuántos clics trae
            cada uno y cuál te está dejando clínicas.
          </EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            {links.map((l, i) => {
              const confirming = confirmingId === l.id;
              const deleting = deletingId === l.id;
              return (
                <div
                  key={l.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    minWidth: 0,
                    borderTop: i > 0 ? "1px solid var(--dcafp-line-soft)" : undefined,
                    paddingTop: i > 0 ? 14 : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                    <span className="dcafp-linkrow__k" style={{ overflowWrap: "anywhere" }}>
                      {l.name}
                    </span>
                    <Chip sm>
                      <MousePointerClick size={12} aria-hidden />
                      {l.clicks} clics
                    </Chip>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
                    <input
                      readOnly
                      value={l.url}
                      onFocus={(e) => e.currentTarget.select()}
                      aria-label={`Enlace de ${l.name}`}
                      className="dcafp-urlbox"
                      style={{ flex: "1 1 220px" }}
                    />
                    <CopyButton
                      text={l.url}
                      toast="Enlace copiado"
                      ariaLabel={`Copiar el enlace de ${l.name}`}
                      variant="outline"
                    />
                    <QrDownloadButton url={l.url} fileName={`qr-${l.campaign}`} />
                    <button
                      type="button"
                      onClick={() => void removeLink(l)}
                      disabled={deleting}
                      aria-label={confirming ? `Confirmar eliminación del link ${l.name}` : `Eliminar link ${l.name}`}
                      title={confirming ? "Se perderán los clics de este link" : "Eliminar link"}
                      className={confirming ? "dcafp-btn dcafp-btn--danger" : "dcafp-iconbtn"}
                    >
                      <Trash2 size={16} aria-hidden />
                      {confirming ? (deleting ? "Eliminando..." : "¿Eliminar?") : null}
                    </button>
                  </div>
                  {confirming && (
                    <p className="dcafp-hint" style={{ color: "var(--dcafp-warn-ink)" }}>
                      Se perderán los clics de este link. Pulsa &quot;¿Eliminar?&quot; otra vez para confirmar.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PanelCard>
  );
}

// ── Sección de cupón ──────────────────────────────────────────────────────
function SellerCoupon() {
  const [coupon, setCoupon] = useState<SellerCouponInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

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

  let inner: React.ReactNode;
  if (!ready) {
    inner = <NotReadyNote />;
  } else if (loading) {
    inner = <p className="dcafp-hint">Cargando…</p>;
  } else if (coupon) {
    const benefit = coupon.active
      ? coupon.type === "percentage"
        ? `${coupon.value}% de descuento`
        : `$${coupon.value} MXN de descuento`
      : null;
    inner = (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <div className="dcafp-linkhero">
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", minWidth: 0 }}>
            <CopyCodeButton code={coupon.code} kicker="CUPÓN" toast="Cupón copiado" />
            <Chip tone={coupon.active ? "ok" : "amber"} dot sm>
              {coupon.active ? "Activo" : "En revisión"}
            </Chip>
          </div>
          {benefit ? (
            <p style={{ fontSize: 13, color: "var(--dcafp-ink-2)", lineHeight: 1.5 }}>
              Beneficio para la clínica que lo canjea: <strong>{benefit}</strong>.
            </p>
          ) : (
            <p style={{ fontSize: 13, color: "var(--dcafp-ink-2)", lineHeight: 1.5 }}>
              El equipo DaleControl está revisando tu cupón: definirá el beneficio y lo activará.
            </p>
          )}
        </div>

        <StatRow>
          <Stat label="Canjes" value={coupon.usedCount} tone={coupon.usedCount > 0 ? "default" : "idle"} />
        </StatRow>
      </div>
    );
  } else {
    inner = (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <p style={{ fontSize: 13, color: "var(--dcafp-ink-2)", lineHeight: 1.5 }}>
          Tu cupón personalizado: las clínicas que lo canjeen al registrarse cuentan como referidas tuyas,
          aunque no usen tu link.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "0 1 200px", minWidth: 0 }}>
            <label className="dcafp-label" htmlFor="seller-coupon-code">
              Código que quieres
            </label>
            <input
              id="seller-coupon-code"
              className="dcafp-input dcafp-mono"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) requestCoupon();
              }}
              placeholder="JUAN10"
              maxLength={12}
              style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}
            />
          </div>
          <button type="button" onClick={requestCoupon} disabled={busy} className="dcafp-btn dcafp-btn--primary">
            <TicketPercent size={16} aria-hidden />
            {busy ? "Solicitando…" : "Solicitar cupón"}
          </button>
        </div>
        <p className="dcafp-hint">El equipo DaleControl define el beneficio y lo activa.</p>
      </div>
    );
  }

  return (
    <PanelCard
      title="Tu cupón"
      sub="Un código con tu nombre: quien lo canjea al registrarse cuenta como referido tuyo, aunque no use tu link."
    >
      {inner}
    </PanelCard>
  );
}

export function SellerTools(_props: { siteUrl: string; parentSlug: string }) {
  // SIN "enlace base": un /socio/<slug> sin ?c= atribuiría la clínica solo al
  // afiliado PADRE, no al vendedor. El vendedor SIEMPRE debe compartir un link
  // con campaña (lleva su sellerId) para ganar su comisión.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
      <SellerLinks />
      <SellerCoupon />
    </div>
  );
}
