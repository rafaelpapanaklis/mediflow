"use client";

// Shell del panel de analítica del owner: filtros (periodo + superficie),
// barra de tabs y drill-down por clínica. Cada tab hace su propio fetch usando
// el `query` compartido.

import { useMemo, useState } from "react";
import {
  Activity,
  Radio,
  Compass,
  Globe2,
  FileText,
  MousePointerClick,
  Building2,
  Calendar,
  X,
} from "lucide-react";
import { Segmented } from "./ui";
import { OverviewTab } from "./overview-tab";
import { SourcesTab } from "./sources-tab";
import { GeoTab } from "./geo-tab";
import { PagesTab } from "./pages-tab";
import { HeatmapTab } from "./heatmap-tab";
import { IdentifiedTab } from "./identified-tab";
import { LiveTab } from "./live-tab";

export interface TabProps {
  /** querystring compartido: from, to, surface, clinicId (ya codificado). */
  query: string;
  from: string;
  to: string;
  surface: string;
  clinicId: string | null;
  /** Drill-down desde Identificados → filtra por clínica. */
  onClinicSelect?: (clinicId: string, name: string) => void;
}

type TabKey = "overview" | "live" | "sources" | "geo" | "pages" | "heatmap" | "identified";

const TABS: { k: TabKey; label: string; icon: React.ComponentType<{ size?: number | string }> }[] = [
  { k: "overview", label: "Resumen", icon: Activity },
  { k: "live", label: "En vivo", icon: Radio },
  { k: "sources", label: "Fuentes", icon: Compass },
  { k: "geo", label: "Ubicaciones", icon: Globe2 },
  { k: "pages", label: "Páginas", icon: FileText },
  { k: "heatmap", label: "Heatmap", icon: MousePointerClick },
  { k: "identified", label: "Identificados", icon: Building2 },
];

type Preset = "today" | "7d" | "30d" | "90d" | "custom";

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
}

export function AnalyticsClient() {
  const today = iso(new Date());
  const [tab, setTab] = useState<TabKey>("overview");
  const [preset, setPreset] = useState<Preset>("30d");
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today);
  const [surface, setSurface] = useState("all");
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [clinicName, setClinicName] = useState<string | null>(null);

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p === "custom") return;
    const t = iso(new Date());
    setTo(t);
    if (p === "today") setFrom(t);
    else if (p === "7d") setFrom(daysAgo(7));
    else if (p === "30d") setFrom(daysAgo(30));
    else if (p === "90d") setFrom(daysAgo(90));
  }

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("from", from);
    p.set("to", to);
    if (surface !== "all") p.set("surface", surface);
    if (clinicId) p.set("clinicId", clinicId);
    return p.toString();
  }, [from, to, surface, clinicId]);

  const tabProps: TabProps = {
    query,
    from,
    to,
    surface,
    clinicId,
    onClinicSelect: (id, name) => {
      setClinicId(id);
      setClinicName(name);
      setTab("overview");
    },
  };

  const presets: { k: Preset; l: string }[] = [
    { k: "today", l: "Hoy" },
    { k: "7d", l: "7 días" },
    { k: "30d", l: "30 días" },
    { k: "90d", l: "90 días" },
    { k: "custom", l: "Custom" },
  ];

  const surfaces: { k: string; l: string }[] = [
    { k: "all", l: "Todo" },
    { k: "public", l: "Sitio web" },
    { k: "dashboard", l: "Panel" },
    { k: "portal", l: "Portal" },
  ];

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 20px 48px" }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          Analytics
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
          Tráfico del sitio y del panel, fuentes, ubicaciones, heatmaps y visitantes en vivo — datos propios.
        </p>
      </div>

      {/* Filtros */}
      <div
        className="card"
        style={{ marginBottom: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: 14 }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-3)", fontSize: 12 }}>
          <Calendar size={14} />
          <span>Periodo</span>
        </div>
        <Segmented options={presets} value={preset} onChange={applyPreset} />
        {preset === "custom" && (
          <>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="input-new" style={{ width: 150 }} />
            <span style={{ color: "var(--text-3)", fontSize: 12 }}>→</span>
            <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="input-new" style={{ width: 150 }} />
          </>
        )}
        <div style={{ width: 1, height: 22, background: "var(--border-soft)" }} />
        <Segmented options={surfaces} value={surface} onChange={setSurface} />
        {clinicId && (
          <button
            type="button"
            onClick={() => {
              setClinicId(null);
              setClinicName(null);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--brand)",
              border: "1px solid rgba(124,58,237,0.3)",
              background: "rgba(124,58,237,0.08)",
              borderRadius: 999,
              padding: "4px 10px",
              cursor: "pointer",
            }}
          >
            <Building2 size={13} />
            {clinicName || "Clínica"}
            <X size={13} />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div
        className="scrollbar-thin"
        style={{ display: "flex", gap: 4, marginBottom: 18, overflowX: "auto", paddingBottom: 4, borderBottom: "1px solid var(--border-soft)" }}
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.k;
          return (
            <button
              key={t.k}
              type="button"
              onClick={() => setTab(t.k)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "9px 14px",
                borderRadius: "8px 8px 0 0",
                border: "none",
                borderBottom: active ? "2px solid var(--brand)" : "2px solid transparent",
                background: active ? "var(--bg-hover)" : "transparent",
                color: active ? "var(--text-1)" : "var(--text-3)",
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              <Icon size={14} />
              {t.label}
              {t.k === "live" && (
                <span style={{ width: 7, height: 7, borderRadius: 999, background: "#22c55e", boxShadow: "0 0 6px #22c55e" }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Contenido */}
      {tab === "overview" && <OverviewTab {...tabProps} />}
      {tab === "live" && <LiveTab {...tabProps} />}
      {tab === "sources" && <SourcesTab {...tabProps} />}
      {tab === "geo" && <GeoTab {...tabProps} />}
      {tab === "pages" && <PagesTab {...tabProps} />}
      {tab === "heatmap" && <HeatmapTab {...tabProps} />}
      {tab === "identified" && <IdentifiedTab {...tabProps} />}
    </div>
  );
}
