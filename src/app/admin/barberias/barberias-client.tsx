"use client";

// ═══════════════════════════════════════════════════════════════════════
// /admin/barberias — roster del vertical BARBER.
//
// Métricas arriba (activas, MRR de barber, altas y bajas del mes, reparto
// por plan) + búsqueda + filtros de plan/estado/sede + tabla ORDENABLE por
// cualquier columna. Fila clicable → ficha de la barbería.
//
// API: GET /api/admin/barberias?plan=&status=&scope=&q=&metrics=1
// Contrato: src/lib/barber/admin.ts. Ancho por @container (barberias.css).
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarPlus,
  DollarSign,
  LifeBuoy,
  MessageSquare,
  Scissors,
  Search,
  Store,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { BARBER_PLAN_IDS } from "@/lib/barber/plan-shared";
import type { AdminBarbershopRow, BarberVerticalMetrics } from "@/lib/barber/admin";
import {
  PLAN_TONES,
  SCOPE_FILTERS,
  SUBSCRIPTION_FILTERS,
  formatInt,
  formatMoney,
  formatQuota,
  relativeDate,
  shortDate,
  subscriptionFace,
  fullDate,
} from "@/components/admin/barberias/shared";
import "@/components/admin/barberias/barberias.css";

type SortKey =
  | "name"
  | "city"
  | "plan"
  | "status"
  | "createdAt"
  | "barbers"
  | "lastActivityAt"
  | "whatsapp";

const COLUMNS: { key: SortKey; label: string; cls?: string; align?: "right" | "center" }[] = [
  { key: "name", label: "Barbería" },
  { key: "city", label: "Ciudad", cls: "dcba-col-wide" },
  { key: "plan", label: "Plan" },
  { key: "status", label: "Suscripción" },
  { key: "barbers", label: "Barberos", align: "right" },
  { key: "whatsapp", label: "WhatsApp", cls: "dcba-col-xwide" },
  { key: "lastActivityAt", label: "Última actividad", cls: "dcba-col-wide" },
  { key: "createdAt", label: "Alta" },
];

function sortValue(row: AdminBarbershopRow, key: SortKey): string | number {
  switch (key) {
    case "name":
      return row.name.toLowerCase();
    case "city":
      return (row.city ?? "").toLowerCase();
    case "plan":
      return BARBER_PLAN_IDS.indexOf(row.plan);
    case "status":
      return subscriptionFace(row.subscriptionStatus).label.toLowerCase();
    case "barbers":
      return row.barbers;
    case "whatsapp":
      return row.whatsappConnected ? 1 : 0;
    case "lastActivityAt":
      return row.lastActivityAt ?? "";
    case "createdAt":
      return row.createdAt;
  }
}

export function AdminBarberiasClient() {
  const router = useRouter();

  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState("");
  const [scope, setScope] = useState("all");
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");

  const [rows, setRows] = useState<AdminBarbershopRow[]>([]);
  const [metrics, setMetrics] = useState<BarberVerticalMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const fetchSeq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setAppliedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const seq = ++fetchSeq.current;
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const params = new URLSearchParams();
        if (plan) params.set("plan", plan);
        if (status) params.set("status", status);
        if (scope && scope !== "all") params.set("scope", scope);
        const term = appliedQ.trim();
        if (term) params.set("q", term);
        params.set("metrics", "1");

        const res = await fetch(`/api/admin/barberias?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (seq !== fetchSeq.current) return;
        if (res.status === 401) {
          setError(true);
          toast.error("Tu sesión de admin expiró. Vuelve a iniciar sesión.");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (seq !== fetchSeq.current) return;
        setRows(Array.isArray(data?.barbershops) ? data.barbershops : []);
        if (data?.metrics) setMetrics(data.metrics);
        setError(false);
      } catch (err) {
        if ((err as Error)?.name === "AbortError" || seq !== fetchSeq.current) return;
        setError(true);
        toast.error("No se pudieron cargar las barberías");
      } finally {
        if (seq === fetchSeq.current) {
          setLoading(false);
          setLoadedOnce(true);
        }
      }
    })();
    return () => controller.abort();
  }, [plan, status, scope, appliedQ, refreshKey]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      let cmp: number;
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb), "es");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      // Fechas y conteos se leen mejor de mayor a menor al primer clic.
      setSortDir(key === "name" || key === "city" ? "asc" : "desc");
    }
  }

  const hasFilters = Boolean(plan || status || (scope && scope !== "all") || appliedQ.trim());
  const showEmpty = loadedOnce && !loading && !error && rows.length === 0;

  return (
    <div className="dcba">
      <div className="dcba-head">
        <div>
          <h1 className="dcba-title">Barberías</h1>
          <p className="dcba-sub">
            Vertical DaleControl Barber. Números independientes del panel dental.
          </p>
        </div>
        <Link href="/admin/barberias/soporte" style={{ textDecoration: "none" }}>
          <ButtonNew size="sm" variant="secondary" icon={<LifeBuoy size={14} />}>
            Soporte de barberías
            {metrics && metrics.ticketsPendingReply > 0 ? ` (${metrics.ticketsPendingReply})` : ""}
          </ButtonNew>
        </Link>
      </div>

      {/* ── D. Métricas del vertical ─────────────────────────────────── */}
      <div className="dcba-kpis">
        <KpiCard
          label="Barberías activas"
          value={metrics ? formatInt(metrics.activeAccounts) : "—"}
          icon={Store}
          hero
          hint={
            metrics
              ? `${formatInt(metrics.accounts)} cuentas dadas de alta · ${formatInt(metrics.branches)} sucursales`
              : undefined
          }
        />
        <KpiCard
          label="MRR de barber"
          value={metrics ? formatMoney(metrics.mrrMonthly) : "—"}
          icon={DollarSign}
          hint="Sólo suscripciones de barbería, a precio de barber_plan_configs."
        />
        <KpiCard
          label="Altas del mes"
          value={metrics ? formatInt(metrics.signupsThisMonth) : "—"}
          icon={CalendarPlus}
          delta={metrics ? { value: "Cuentas nuevas", direction: "up" } : undefined}
        />
        <KpiCard
          label="Bajas del mes"
          value={metrics ? formatInt(metrics.churnThisMonth) : "—"}
          icon={ArrowDownRight}
          tone={metrics && metrics.churnThisMonth > 0 ? "warning" : undefined}
          hint="Aproximado: cuentas hoy sin suscripción activa cuyo registro cambió este mes."
        />
        <KpiCard
          label="Tickets sin responder"
          value={metrics ? formatInt(metrics.ticketsPendingReply) : "—"}
          icon={MessageSquare}
          tone={metrics && metrics.ticketsPendingReply > 0 ? "danger" : undefined}
          hint={metrics ? `${formatInt(metrics.openTickets)} abiertos en total` : undefined}
        />
      </div>

      {/* Reparto por plan — precios y cuotas SIEMPRE de barber_plan_configs. */}
      {metrics && metrics.byPlan.length > 0 && (
        <div className="dcba-section">
          <CardNew>
            <div className="dcba-cardtitle">
              <Scissors size={14} />
              Reparto por plan
            </div>
            <div className="dcba-grid3">
              {metrics.byPlan.map((p) => (
                <div key={p.planId}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <BadgeNew tone={PLAN_TONES[p.planId] ?? "neutral"}>{p.name}</BadgeNew>
                    <span className="dcba-note">{formatMoney(p.priceMonthly)}/mes</span>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 600, color: "var(--text-1)" }}>
                    {formatInt(p.activeAccounts)}
                    <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 400 }}>
                      {" "}
                      / {formatInt(p.accounts)} cuentas
                    </span>
                  </div>
                  <div className="dcba-note">{formatMoney(p.mrr)} de MRR</div>
                </div>
              ))}
            </div>
          </CardNew>
        </div>
      )}

      {/* ── Controles ────────────────────────────────────────────────── */}
      <div className="dcba-controls">
        <div className="search-field dcba-control--wide">
          <Search size={14} />
          <input
            placeholder="Nombre, slug, ciudad o correo…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setAppliedQ(q);
            }}
            aria-label="Buscar barbería"
          />
        </div>

        <select
          className="input-new dcba-control"
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          aria-label="Filtrar por plan"
        >
          <option value="">Todos los planes</option>
          {(metrics?.byPlan ?? []).map((p) => (
            <option key={p.planId} value={p.planId}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          className="input-new dcba-control"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filtrar por estado de suscripción"
        >
          {SUBSCRIPTION_FILTERS.map((f) => (
            <option key={f.value || "all"} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <select
          className="input-new dcba-control"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          aria-label="Filtrar por tipo de sede"
        >
          {SCOPE_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {/* ── A. Tabla ─────────────────────────────────────────────────── */}
      <CardNew noPad>
        {error && !loading ? (
          <div className="dcba-empty">
            <div className="dcba-empty__icon">
              <AlertTriangle size={20} style={{ color: "var(--danger)" }} />
            </div>
            <div className="dcba-empty__title">No se pudo cargar el roster</div>
            <div className="dcba-empty__body">
              Revisa tu conexión o tu sesión de admin e inténtalo otra vez.
            </div>
            <ButtonNew size="sm" variant="secondary" onClick={() => setRefreshKey((k) => k + 1)}>
              Reintentar
            </ButtonNew>
          </div>
        ) : showEmpty ? (
          <div className="dcba-empty">
            <div className="dcba-empty__icon">
              <Store size={20} style={{ color: "var(--text-3)" }} />
            </div>
            <div className="dcba-empty__title">
              {hasFilters ? "Ninguna barbería con estos filtros" : "Todavía no hay barberías"}
            </div>
            <div className="dcba-empty__body">
              {hasFilters
                ? "Prueba a quitar algún filtro o a buscar por otro término."
                : "Cuando alguien se registre en DaleControl Barber aparecerá aquí."}
            </div>
            {hasFilters && (
              <ButtonNew
                size="sm"
                variant="secondary"
                onClick={() => {
                  setPlan("");
                  setStatus("");
                  setScope("all");
                  setQ("");
                  setAppliedQ("");
                }}
              >
                Quitar filtros
              </ButtonNew>
            )}
          </div>
        ) : (
          <div className="dcba-tablewrap">
            <table
              className="table-new"
              style={{ opacity: loading && loadedOnce ? 0.6 : 1, transition: "opacity .15s" }}
            >
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={`dcba-th ${c.cls ?? ""}`}
                      style={c.align ? { textAlign: c.align } : undefined}
                      onClick={() => toggleSort(c.key)}
                      title={`Ordenar por ${c.label}`}
                    >
                      {c.label}
                      {sortKey === c.key && (
                        <span className="dcba-sortmark">{sortDir === "asc" ? "▲" : "▼"}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && !loadedOnce
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={`skel-${i}`}>
                        {COLUMNS.map((c) => (
                          <td key={c.key} className={c.cls}>
                            <span className="skel-new" style={{ width: 110, maxWidth: "100%", height: 12 }} />
                          </td>
                        ))}
                      </tr>
                    ))
                  : sorted.map((row) => {
                      const face = subscriptionFace(row.subscriptionStatus);
                      const go = () => router.push(`/admin/barberias/${row.id}`);
                      return (
                        <tr
                          key={row.id}
                          className="dcba-row"
                          tabIndex={0}
                          onClick={go}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") go();
                          }}
                        >
                          <td>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-1)" }}>
                                {row.name}
                              </div>
                              <div className="mono dcba-note">{row.slug}</div>
                              {row.isBranch ? (
                                <div className="dcba-note">
                                  Sucursal{row.branchName ? ` · ${row.branchName}` : ""}
                                  {row.parentName ? ` de ${row.parentName}` : ""}
                                </div>
                              ) : row.branchCount > 0 ? (
                                <div className="dcba-note">
                                  Matriz · {formatInt(row.branchCount)}{" "}
                                  {row.branchCount === 1 ? "sucursal" : "sucursales"}
                                </div>
                              ) : null}
                            </div>
                          </td>
                          <td className="dcba-col-wide">
                            <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                              {row.city || "—"}
                              {row.state ? `, ${row.state}` : ""}
                            </span>
                          </td>
                          <td>
                            <BadgeNew tone={PLAN_TONES[row.plan] ?? "neutral"}>{row.planName}</BadgeNew>
                            <div className="mono dcba-note" style={{ marginTop: 4 }}>
                              {formatMoney(row.planPriceMonthly)}/mes
                            </div>
                          </td>
                          <td>
                            <BadgeNew tone={face.tone} dot>
                              {face.label}
                            </BadgeNew>
                            {row.isBranch && (
                              <div className="dcba-note" style={{ marginTop: 4 }}>
                                Heredado de la matriz
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <span className="mono" style={{ fontSize: 13, color: "var(--text-1)" }}>
                              {formatInt(row.barbers)}
                            </span>
                            <div className="dcba-note">{formatInt(row.teamUsers)} con acceso</div>
                          </td>
                          <td className="dcba-col-xwide">
                            {row.whatsappConnected ? (
                              <BadgeNew tone="success" dot>
                                {row.whatsappMode === "PLATFORM" ? "Número DaleControl" : "WABA propia"}
                              </BadgeNew>
                            ) : (
                              <BadgeNew tone="neutral">Sin conectar</BadgeNew>
                            )}
                            <div className="dcba-note" style={{ marginTop: 4 }}>
                              {formatInt(row.messagesUsedPeriod)} / {formatQuota(row.messageQuota)} msj
                            </div>
                          </td>
                          <td className="dcba-col-wide">
                            <span
                              style={{ fontSize: 12, color: "var(--text-2)" }}
                              title={fullDate(row.lastActivityAt)}
                            >
                              {relativeDate(row.lastActivityAt)}
                            </span>
                            {row.openTickets > 0 && (
                              <div className="dcba-note" style={{ color: "var(--warning)" }}>
                                {formatInt(row.openTickets)}{" "}
                                {row.openTickets === 1 ? "ticket abierto" : "tickets abiertos"}
                              </div>
                            )}
                          </td>
                          <td>
                            <span
                              className="mono dcba-nowrap"
                              style={{ fontSize: 12, color: "var(--text-2)" }}
                              title={fullDate(row.createdAt)}
                            >
                              {shortDate(row.createdAt)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        )}
      </CardNew>

      {!error && rows.length > 0 && (
        <p className="dcba-note" style={{ marginTop: 10 }}>
          <ArrowUpRight size={11} style={{ verticalAlign: -1 }} /> {formatInt(sorted.length)} sedes
          listadas. Haz clic en cualquier encabezado para reordenar.
        </p>
      )}
    </div>
  );
}
