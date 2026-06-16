"use client";

// Portada del módulo Marketing (WS-MKT-T6). Recibe KPIs + próximos posts ya
// calculados en el server (page.tsx) y los pinta con la UI del panel
// (AnalyticsCard, EmptyStateNew, tokens var(--*)). El estado de conexiones se
// enriquece llamando a /api/marketing/connections (de T4); si esa ruta aún no
// existe (404) o falla, degrada al conteo que vino del server.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  PencilLine,
  Link2,
  Library,
  CalendarClock,
  Send,
  FileText,
  AlertTriangle,
  Instagram,
  Facebook,
  Share2,
  Plug,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { AnalyticsCard } from "@/components/dashboard/analytics/analytics-card";
import { EmptyStateNew } from "@/components/dashboard/empty-state";

export interface UpcomingPost {
  id: string;
  channel: string;
  caption: string;
  scheduledFor: string | null; // ISO
}

export interface OverviewData {
  scheduled: number;
  publishedThisMonth: number;
  drafts: number;
  failed: number;
  connectedAccounts: number;
  upcoming: UpcomingPost[];
}

interface RemoteAccount {
  provider?: string;
  name?: string | null;
}

export function MarketingOverviewClient({ data }: { data: OverviewData }) {
  // Conexiones: baseline del server + intento de enriquecer con la API de T4.
  const [accounts, setAccounts] = useState<RemoteAccount[] | null>(null);
  const [connLoading, setConnLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/marketing/connections", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        const arr = Array.isArray(d)
          ? d
          : Array.isArray(d?.accounts)
            ? d.accounts
            : Array.isArray(d?.connections)
              ? d.connections
              : null;
        setAccounts(arr);
        setConnLoading(false);
      })
      .catch(() => {
        // 404 / sin ruta / error → degradamos al conteo del server.
        setAccounts(null);
        setConnLoading(false);
      });
    return () => ctrl.abort();
  }, []);

  const liveCount = accounts ? accounts.length : data.connectedAccounts;
  const hasConnections = liveCount > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <style>{`@keyframes mf-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      {/* Aviso si hay publicaciones fallidas */}
      {data.failed > 0 && (
        <Link
          href="/dashboard/marketing/calendar"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderRadius: 12,
            background: "rgba(220, 38, 38, 0.08)",
            border: "1px solid rgba(220, 38, 38, 0.25)",
            color: "var(--text-1)",
            textDecoration: "none",
            fontSize: 13,
          }}
        >
          <AlertTriangle size={16} aria-hidden style={{ color: "#dc2626", flexShrink: 0 }} />
          <span>
            {data.failed === 1
              ? "1 publicación falló al enviarse."
              : `${data.failed} publicaciones fallaron al enviarse.`}{" "}
            Revísalas en el calendario.
          </span>
          <ArrowRight size={14} aria-hidden style={{ marginLeft: "auto", color: "var(--text-3)" }} />
        </Link>
      )}

      {/* KPIs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 14,
        }}
      >
        <AnalyticsCard
          label="Programados"
          value={data.scheduled.toLocaleString("es-MX")}
          icon={<CalendarClock size={14} aria-hidden />}
          tone="brand"
          hint="Posts en cola"
        />
        <AnalyticsCard
          label="Publicados este mes"
          value={data.publishedThisMonth.toLocaleString("es-MX")}
          icon={<Send size={14} aria-hidden />}
          tone="success"
          hint="Ya en tus redes"
        />
        <AnalyticsCard
          label="Borradores"
          value={data.drafts.toLocaleString("es-MX")}
          icon={<FileText size={14} aria-hidden />}
          tone="neutral"
          hint="Por terminar"
        />
        <AnalyticsCard
          label="Cuentas conectadas"
          value={liveCount.toLocaleString("es-MX")}
          icon={<Share2 size={14} aria-hidden />}
          tone={hasConnections ? "success" : "warning"}
          hint={hasConnections ? "Instagram / Facebook" : "Aún sin conectar"}
        />
      </div>

      {/* Accesos rápidos */}
      <section>
        <SectionTitle>Empieza aquí</SectionTitle>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 12,
          }}
        >
          <ActionCard
            href="/dashboard/marketing/studio"
            icon={Sparkles}
            title="Crear con IA"
            subtitle="Ideas, captions y hashtags al instante"
          />
          <ActionCard
            href="/dashboard/marketing/composer"
            icon={PencilLine}
            title="Crear post"
            subtitle="Redacta y programa una publicación"
          />
          <ActionCard
            href="/dashboard/marketing/library"
            icon={Library}
            title="Biblioteca"
            subtitle="Plantillas listas para tu clínica"
          />
          <ActionCard
            href="/dashboard/marketing/connections"
            icon={Link2}
            title="Conectar redes"
            subtitle="Vincula Instagram y Facebook"
          />
        </div>
      </section>

      {/* Próximos posts + Conexiones */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* Próximos posts */}
        <Panel>
          <PanelHeader
            title="Próximos posts"
            icon={CalendarClock}
            action={{ label: "Ver calendario", href: "/dashboard/marketing/calendar" }}
          />
          {data.upcoming.length === 0 ? (
            <EmptyStateNew
              icon={CalendarClock}
              title="Nada programado todavía"
              description="Crea tu primera publicación y prográmala para que salga sola a la hora que elijas."
              tone="brand"
              size="sm"
              primaryCta={{
                label: "Crear post",
                href: "/dashboard/marketing/composer",
                icon: PencilLine,
              }}
            />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {data.upcoming.map((post) => (
                <UpcomingRow key={post.id} post={post} />
              ))}
            </ul>
          )}
        </Panel>

        {/* Conexiones */}
        <Panel>
          <PanelHeader
            title="Conexiones"
            icon={Plug}
            action={{ label: "Gestionar", href: "/dashboard/marketing/connections" }}
          />
          {connLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : hasConnections ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {accounts && accounts.length > 0 ? (
                accounts.map((a, i) => (
                  <ConnectionRow key={i} provider={a.provider} name={a.name ?? undefined} />
                ))
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}>
                  {liveCount === 1
                    ? "1 cuenta conectada."
                    : `${liveCount} cuentas conectadas.`}
                </p>
              )}
            </div>
          ) : (
            <EmptyStateNew
              icon={Link2}
              title="Conecta tus redes"
              description="Vincula tu Instagram y tu página de Facebook para publicar y programar desde aquí."
              tone="warning"
              size="sm"
              primaryCta={{
                label: "Conectar redes",
                href: "/dashboard/marketing/connections",
                icon: Link2,
              }}
            />
          )}
        </Panel>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Subcomponentes
// ─────────────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        margin: "0 0 10px",
        fontSize: 13,
        fontWeight: 600,
        color: "var(--text-2)",
        letterSpacing: "0.02em",
      }}
    >
      {children}
    </h2>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        borderRadius: 14,
        padding: 16,
        minWidth: 0,
      }}
    >
      {children}
    </section>
  );
}

function PanelHeader({
  title,
  icon: Icon,
  action,
}: {
  title: string;
  icon: LucideIcon;
  action?: { label: string; href: string };
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <Icon size={16} aria-hidden style={{ color: "var(--brand)", flexShrink: 0 }} />
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{title}</h3>
      {action && (
        <Link
          href={action.href}
          style={{
            marginLeft: "auto",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--brand)",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

function ActionCard({
  href,
  icon: Icon,
  title,
  subtitle,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className="mf-action-card"
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--border-brand, rgba(124,58,237,0.4))";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border-soft)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: 14,
        borderRadius: 12,
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        textDecoration: "none",
        transition: "border-color 0.15s, transform 0.15s",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "var(--brand-softer)",
          border: "1px solid rgba(124,58,237,0.20)",
          display: "grid",
          placeItems: "center",
          color: "var(--brand)",
          flexShrink: 0,
        }}
      >
        <Icon size={18} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{title}</span>
        <span style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.4 }}>{subtitle}</span>
      </span>
    </Link>
  );
}

function UpcomingRow({ post }: { post: UpcomingPost }) {
  const ch = channelMeta(post.channel);
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        borderRadius: 10,
        background: "var(--bg-elev-2, rgba(127,127,127,0.04))",
        border: "1px solid var(--border-soft)",
        minWidth: 0,
      }}
    >
      <span
        aria-hidden
        title={ch.label}
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          display: "grid",
          placeItems: "center",
          color: "#fff",
          background: ch.bg,
          flexShrink: 0,
        }}
      >
        <ch.Icon size={15} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <span
          style={{
            fontSize: 13,
            color: "var(--text-1)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {post.caption?.trim() || "(sin texto)"}
        </span>
        <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{formatWhen(post.scheduledFor)}</span>
      </span>
    </li>
  );
}

function ConnectionRow({ provider, name }: { provider?: string; name?: string }) {
  const meta = providerMeta(provider);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 10,
        background: "var(--bg-elev-2, rgba(127,127,127,0.04))",
        border: "1px solid var(--border-soft)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          display: "grid",
          placeItems: "center",
          color: "#fff",
          background: meta.bg,
          flexShrink: 0,
        }}
      >
        <meta.Icon size={14} />
      </span>
      <span style={{ fontSize: 13, color: "var(--text-1)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {name || meta.label}
      </span>
      <span
        style={{
          marginLeft: "auto",
          fontSize: 11,
          fontWeight: 600,
          color: "#059669",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} aria-hidden />
        Conectada
      </span>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div
      aria-hidden
      style={{
        height: 44,
        borderRadius: 10,
        background: "linear-gradient(90deg, var(--bg-elev-2, rgba(127,127,127,0.06)), rgba(127,127,127,0.12), var(--bg-elev-2, rgba(127,127,127,0.06)))",
        backgroundSize: "200% 100%",
        animation: "mf-shimmer 1.4s ease-in-out infinite",
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function channelMeta(channel: string): { label: string; bg: string; Icon: LucideIcon } {
  switch (channel) {
    case "INSTAGRAM":
      return { label: "Instagram", bg: "linear-gradient(135deg,#f58529,#dd2a7b,#8134af)", Icon: Instagram };
    case "FACEBOOK":
      return { label: "Facebook", bg: "#1877f2", Icon: Facebook };
    case "BOTH":
    default:
      return { label: "Instagram y Facebook", bg: "linear-gradient(135deg,#1877f2,#dd2a7b)", Icon: Share2 };
  }
}

function providerMeta(provider?: string): { label: string; bg: string; Icon: LucideIcon } {
  const p = (provider || "").toUpperCase();
  if (p.includes("INSTA")) return { label: "Instagram", bg: "linear-gradient(135deg,#f58529,#dd2a7b,#8134af)", Icon: Instagram };
  if (p.includes("FACE")) return { label: "Facebook", bg: "#1877f2", Icon: Facebook };
  return { label: provider || "Red social", bg: "var(--brand)", Icon: Share2 };
}

function formatWhen(iso: string | null): string {
  if (!iso) return "Sin fecha";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Sin fecha"; // Intl lanza con Invalid Date
  try {
    return d.toLocaleString("es-MX", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Sin fecha";
  }
}
