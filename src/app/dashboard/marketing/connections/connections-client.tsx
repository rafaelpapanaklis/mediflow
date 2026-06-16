"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { CheckCircle2, CircleSlash, Link2, Unplug } from "lucide-react";
import { EmptyStateNew } from "@/components/dashboard/empty-state";

export interface ConnectionAccount {
  id: string;
  provider: "FACEBOOK" | "INSTAGRAM";
  externalId: string;
  name: string | null;
  igBusinessId: string | null;
  connected: boolean;
}

const ERROR_MESSAGES: Record<string, string> = {
  oauth: "La conexión con Meta se canceló o falló.",
  auth: "Tu sesión expiró. Inicia sesión de nuevo.",
  forbidden: "Solo un administrador puede conectar redes.",
  state: "La solicitud no se pudo validar. Intenta de nuevo.",
  csrf: "La solicitud no pasó la verificación de seguridad. Intenta de nuevo.",
  clinic: "La conexión no corresponde a esta clínica.",
  config: "Faltan credenciales de Meta en el servidor (avísale al equipo).",
  nopages: "No encontramos páginas de Facebook que administres.",
  exchange: "Meta rechazó la conexión. Vuelve a intentarlo.",
};

export function ConnectionsClient({
  accounts,
  canManage,
}: {
  accounts: ConnectionAccount[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  // Lee el resultado del OAuth desde la query (?ok=1 / ?error=...) sin
  // useSearchParams (evita el requisito de <Suspense> en el build).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    let handled = false;
    if (sp.get("ok")) {
      toast.success("¡Conectado! Ya puedes publicar en tus redes.");
      handled = true;
    } else {
      const e = sp.get("error");
      if (e) {
        toast.error(ERROR_MESSAGES[e] ?? "No se pudo completar la conexión.");
        handled = true;
      }
    }
    if (handled) {
      window.history.replaceState({}, "", "/dashboard/marketing/connections");
    }
  }, []);

  const facebook = accounts.filter((a) => a.provider === "FACEBOOK");
  const instagram = accounts.filter((a) => a.provider === "INSTAGRAM");
  const orphanIg = instagram.filter(
    (ig) => !facebook.some((fb) => fb.igBusinessId && fb.igBusinessId === ig.igBusinessId),
  );

  async function disconnect(id: string, label: string) {
    if (!window.confirm(`¿Desconectar ${label}? Dejarás de publicar en esa cuenta.`)) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/marketing/connections?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Cuenta desconectada.");
      router.refresh();
    } catch {
      toast.error("No se pudo desconectar.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "var(--text-1)" }}>Conexiones</h2>
        <p style={{ margin: 0, fontSize: 14, color: "var(--text-2)", maxWidth: 580 }}>
          Vincula tu Página de Facebook e Instagram para publicar desde DaleControl. Tu Instagram
          debe ser <strong>Business</strong> y estar vinculado a una Página de Facebook.
        </p>
      </header>

      <section style={cardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h3 style={cardTitle}>Facebook + Instagram</h3>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}>
              Te llevaremos a Meta para autorizar tus páginas.
            </p>
          </div>
          {canManage ? (
            <a
              href="/api/marketing/oauth/start"
              style={primaryBtn}
              aria-label={
                facebook.length > 0
                  ? "Reconectar Facebook e Instagram con Meta"
                  : "Conectar Facebook e Instagram con Meta"
              }
            >
              <Link2 size={16} aria-hidden style={{ flexShrink: 0 }} />
              {facebook.length > 0 ? "Reconectar" : "Conectar con Facebook"}
            </a>
          ) : (
            <span style={{ fontSize: 13, color: "var(--text-2)" }}>
              Solo un administrador puede conectar.
            </span>
          )}
        </div>
      </section>

      {accounts.length === 0 ? (
        <section style={cardStyle} aria-label="Sin cuentas conectadas">
          <EmptyStateNew
            icon={Link2}
            tone="brand"
            title="Aún no hay cuentas conectadas"
            description="Vincula tu Página de Facebook e Instagram para empezar a publicar desde DaleControl."
            primaryCta={
              canManage
                ? {
                    label: "Conectar con Facebook",
                    href: "/api/marketing/oauth/start",
                    icon: Link2,
                  }
                : undefined
            }
          />
        </section>
      ) : (
        <section style={{ display: "grid", gap: 12 }}>
          {facebook.map((fb) => {
            const ig = instagram.find(
              (i) => fb.igBusinessId && i.igBusinessId === fb.igBusinessId,
            );
            return (
              <div key={fb.id} style={cardStyle}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={badge("#1877F2")}>Facebook</span>
                      <StatusPill connected={fb.connected} />
                    </div>
                    <strong style={ellipsisStrong}>{fb.name ?? "Página"}</strong>
                    {ig ? (
                      <span
                        style={{
                          fontSize: 13,
                          color: "var(--text-2)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={badge("linear-gradient(135deg,#f58529,#dd2a7b,#8134af)")}>Instagram</span> @{ig.name ?? ig.externalId}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                        Sin Instagram vinculado
                      </span>
                    )}
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => disconnect(fb.id, fb.name ?? "esta página")}
                      disabled={busy === fb.id}
                      aria-busy={busy === fb.id}
                      aria-label={`Desconectar ${fb.name ?? "esta página"} de Facebook`}
                      style={dangerBtn}
                    >
                      {busy === fb.id ? (
                        "Desconectando…"
                      ) : (
                        <>
                          <Unplug size={14} aria-hidden style={{ flexShrink: 0 }} />
                          Desconectar
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {orphanIg.map((ig) => (
            <div key={ig.id} style={cardStyle}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                  <span style={badge("linear-gradient(135deg,#f58529,#dd2a7b,#8134af)")}>Instagram</span>
                  <StatusPill connected={ig.connected} />
                  <strong style={ellipsisStrong}>@{ig.name ?? ig.externalId}</strong>
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => disconnect(ig.id, `@${ig.name ?? ig.externalId}`)}
                    disabled={busy === ig.id}
                    aria-busy={busy === ig.id}
                    aria-label={`Desconectar @${ig.name ?? ig.externalId} de Instagram`}
                    style={dangerBtn}
                  >
                    {busy === ig.id ? (
                      "Desconectando…"
                    ) : (
                      <>
                        <Unplug size={14} aria-hidden style={{ flexShrink: 0 }} />
                        Desconectar
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--border-soft)",
  borderRadius: 14,
  background: "var(--bg-elev)",
  padding: 16,
};
const cardTitle: React.CSSProperties = {
  margin: "0 0 2px",
  fontSize: 15,
  fontWeight: 600,
  color: "var(--text-1)",
};
const primaryBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  minHeight: 40,
  padding: "0 16px",
  borderRadius: 10,
  background: "var(--brand)",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  textDecoration: "none",
  border: "none",
  cursor: "pointer",
  boxShadow: "0 4px 16px -6px rgba(124,58,237,0.6)",
};
const dangerBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 36,
  padding: "8px 12px",
  borderRadius: 8,
  background: "transparent",
  color: "var(--danger)",
  border: "1px solid var(--border-soft)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
};
const ellipsisStrong: React.CSSProperties = {
  color: "var(--text-1)",
  fontSize: 15,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
function badge(color: string): React.CSSProperties {
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    background: color,
    color: "#fff",
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
  };
}

/**
 * Estado real de la conexión (lo trae el server desde
 * /api/marketing/connections → socialAccount.connected). No es solo color:
 * incluye icono + texto para accesibilidad (no depende del color).
 */
function StatusPill({ connected }: { connected: boolean }) {
  const Icon = connected ? CheckCircle2 : CircleSlash;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        flexShrink: 0,
        background: connected ? "var(--success-soft)" : "var(--bg-elev-2)",
        color: connected ? "var(--success)" : "var(--text-2)",
        border: `1px solid ${connected ? "var(--success)" : "var(--border-soft)"}`,
      }}
    >
      <Icon size={12} aria-hidden style={{ flexShrink: 0 }} />
      {connected ? "Conectada" : "Desconectada"}
    </span>
  );
}
