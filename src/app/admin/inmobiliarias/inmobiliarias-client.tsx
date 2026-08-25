"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Building2, RefreshCcw, SlidersHorizontal } from "lucide-react";
import type {
  AdminRealtyAccountRow,
  RealtyVerticalMetrics,
} from "@/lib/realty/admin";
import {
  MODE_FILTERS,
  MODE_LABELS,
  SUBSCRIPTION_FILTERS,
  planFilterOptions,
  formatBytes,
  formatInt,
  formatMoney,
  formatQuota,
  percentOf,
  relativeDate,
  shortDate,
  subscriptionFace,
  type AdminTone,
} from "@/components/admin/inmobiliarias/shared";
import "@/components/admin/inmobiliarias/inmobiliarias.css";

/**
 * Listado de cuentas del vertical INMUEBLES.
 *
 * 🔴 Los números de esta pantalla son SOLO de inmuebles. No se suman con el
 * MRR del dental ni con el de barberías: cada vertical vive en sus propias
 * tablas y mezclarlos daría un número que no significa nada.
 */
type SortKey =
  | "name"
  | "city"
  | "mode"
  | "plan"
  | "status"
  | "users"
  | "properties"
  | "storage"
  | "lastActivityAt"
  | "createdAt";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "Inmobiliaria" },
  { key: "city", label: "Ciudad" },
  { key: "mode", label: "Modo" },
  { key: "plan", label: "Plan" },
  { key: "status", label: "Suscripción" },
  { key: "users", label: "Usuarios", align: "right" },
  { key: "properties", label: "Inmuebles", align: "right" },
  { key: "storage", label: "Archivos", align: "right" },
  { key: "lastActivityAt", label: "Última actividad" },
  { key: "createdAt", label: "Alta" },
];

function chip(tone: AdminTone, label: string) {
  const cls =
    tone === "success"
      ? " dcin-chip--success"
      : tone === "warning"
        ? " dcin-chip--warning"
        : tone === "danger"
          ? " dcin-chip--danger"
          : tone === "info"
            ? " dcin-chip--info"
            : "";
  return <span className={`dcin-chip${cls}`}>{label}</span>;
}

export function AdminInmobiliariasClient() {
  const [rows, setRows] = useState<AdminRealtyAccountRow[]>([]);
  const [metrics, setMetrics] = useState<RealtyVerticalMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [plan, setPlan] = useState("");
  const [mode, setMode] = useState("");
  const [status, setStatus] = useState("");

  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "createdAt",
    dir: "desc",
  });

  const seqRef = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(id);
  }, [q]);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ metrics: "1" });
      if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
      if (plan) params.set("plan", plan);
      if (mode) params.set("mode", mode);
      if (status) params.set("status", status);

      const res = await fetch(`/api/admin/inmobiliarias?${params.toString()}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      // Guardia anti-carrera: solo la respuesta MÁS RECIENTE pinta.
      if (seq !== seqRef.current) return;
      if (!res.ok) {
        setError(data?.error ?? "No se pudo cargar el listado.");
        return;
      }
      setRows(data.accounts ?? []);
      setMetrics(data.metrics ?? null);
    } catch (err) {
      if (seq === seqRef.current) setError("No se pudo conectar.");
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [debouncedQ, plan, mode, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    const dir = sort.dir === "asc" ? 1 : -1;
    copy.sort((a, b) => {
      switch (sort.key) {
        case "name":
          return a.name.localeCompare(b.name, "es") * dir;
        case "city":
          return (a.city ?? "").localeCompare(b.city ?? "", "es") * dir;
        case "mode":
          return a.mode.localeCompare(b.mode, "es") * dir;
        case "plan":
          return a.plan.localeCompare(b.plan, "es") * dir;
        case "status":
          return a.subscriptionStatus.localeCompare(b.subscriptionStatus, "es") * dir;
        case "users":
          return (a.users - b.users) * dir;
        case "properties":
          return (a.properties - b.properties) * dir;
        case "storage":
          return (a.storageUsedBytes - b.storageUsedBytes) * dir;
        case "lastActivityAt":
          // Sin actividad va SIEMPRE al final, no "primero por ser null".
          return (
            ((a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0) -
              (b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0)) *
            dir
          );
        default:
          return (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * dir;
      }
    });
    return copy;
  }, [rows, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  return (
    <div className="dcin">
      <header className="dcin-head">
        <div>
          <h1 className="dcin-title">Inmobiliarias</h1>
          <p className="dcin-sub">
            Cuentas de DaleControl Inmuebles. Los números de esta pantalla son
            solo de este vertical: no incluyen clínicas ni barberías.
          </p>
        </div>
        <div className="dcin-actions">
          <Link className="dcin-btn" href="/admin/inmobiliarias/planes">
            <SlidersHorizontal size={14} aria-hidden />
            Planes y precios
          </Link>
          <button type="button" className="dcin-btn" onClick={() => void load()} disabled={loading}>
            <RefreshCcw size={14} aria-hidden />
            Actualizar
          </button>
        </div>
      </header>

      {metrics ? (
        <div className="dcin-kpis">
          <div className="dcin-kpi">
            <span className="dcin-kpi__label">MRR de inmuebles</span>
            <span className="dcin-kpi__value">{formatMoney(metrics.mrrMonthly)}</span>
            <span className="dcin-kpi__hint">
              Solo cuentas en estado &quot;active&quot;. La cortesía paga $0 y no cuenta.
            </span>
          </div>
          <div className="dcin-kpi">
            <span className="dcin-kpi__label">Cuentas</span>
            <span className="dcin-kpi__value">{formatInt(metrics.accounts)}</span>
            <span className="dcin-kpi__hint">
              {formatInt(metrics.activeAccounts)} con acceso ·{" "}
              {formatInt(metrics.pendingPayment)} sin contratar
            </span>
          </div>
          <div className="dcin-kpi">
            <span className="dcin-kpi__label">Altas del mes</span>
            <span className="dcin-kpi__value">{formatInt(metrics.signupsThisMonth)}</span>
            <span className="dcin-kpi__hint">
              {formatInt(metrics.churnThisMonth)} bajas (aproximado)
            </span>
          </div>
          <div className="dcin-kpi">
            <span className="dcin-kpi__label">Inmuebles en cartera</span>
            <span className="dcin-kpi__value">{formatInt(metrics.properties)}</span>
            <span className="dcin-kpi__hint">{formatInt(metrics.offices)} oficinas activas</span>
          </div>
          <div className="dcin-kpi">
            <span className="dcin-kpi__label">Tickets abiertos</span>
            <span className="dcin-kpi__value">{formatInt(metrics.openTickets)}</span>
            <span className="dcin-kpi__hint">De todas las cuentas del vertical</span>
          </div>
        </div>
      ) : null}

      {metrics && metrics.byPlan.length > 0 ? (
        <div className="dcin-grid2">
          <section className="dcin-card">
            <h2 className="dcin-cardtitle">MRR por plan</h2>
            <div className="dcin-tablewrap" style={{ border: "none" }}>
              <table className="dcin-table" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th className="dcin-th dcin-th--plain">Plan</th>
                    <th className="dcin-th dcin-th--plain dcin-num">Precio</th>
                    <th className="dcin-th dcin-th--plain dcin-num">Cuentas</th>
                    <th className="dcin-th dcin-th--plain dcin-num">Con acceso</th>
                    <th className="dcin-th dcin-th--plain dcin-num">Cobrando</th>
                    <th className="dcin-th dcin-th--plain dcin-num">MRR</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.byPlan.map((line) => (
                    <tr key={line.planId} className="dcin-row">
                      <td>{line.name}</td>
                      <td className="dcin-num">{formatMoney(line.priceMonthly)}</td>
                      <td className="dcin-num">{formatInt(line.accounts)}</td>
                      <td className="dcin-num">{formatInt(line.activeAccounts)}</td>
                      <td className="dcin-num">{formatInt(line.billableAccounts)}</td>
                      <td className="dcin-num">{formatMoney(line.mrr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="dcin-note">
              &quot;Con acceso&quot; incluye las cortesías, que pagan $0; el MRR
              sale de la columna &quot;Cobrando&quot; y por eso la suma de las
              líneas cuadra con el total de arriba. El precio sale de{" "}
              <code>realty_plan_configs</code>: editarlo ahí cambia esta tabla y
              la pantalla del cliente sin volver a desplegar.
            </p>
          </section>

          <section className="dcin-card">
            <h2 className="dcin-cardtitle">Por modo de cuenta</h2>
            <div className="dcin-tablewrap" style={{ border: "none" }}>
              <table className="dcin-table" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th className="dcin-th dcin-th--plain">Modo</th>
                    <th className="dcin-th dcin-th--plain dcin-num">Cuentas</th>
                    <th className="dcin-th dcin-th--plain dcin-num">Con acceso</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.byMode.map((line) => (
                    <tr key={line.mode} className="dcin-row">
                      <td>{MODE_LABELS[line.mode]}</td>
                      <td className="dcin-num">{formatInt(line.accounts)}</td>
                      <td className="dcin-num">{formatInt(line.activeAccounts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="dcin-note">
              El modo (inmobiliaria, asesor, propietario) y el plan son ejes
              independientes: un rentista puede pagar el plan más alto.
            </p>
          </section>
        </div>
      ) : null}

      <div className="dcin-controls">
        <input
          className="dcin-control dcin-control--wide"
          type="search"
          placeholder="Buscar por nombre, slug, ciudad o correo…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Buscar inmobiliarias"
        />
        <select
          className="dcin-control"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          aria-label="Filtrar por modo"
        >
          {MODE_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          className="dcin-control"
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          aria-label="Filtrar por plan"
        >
          {planFilterOptions(metrics?.byPlan).map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          className="dcin-control"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filtrar por suscripción"
        >
          {SUBSCRIPTION_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="dcin-card">
          <p className="dcin-note">{error}</p>
        </div>
      ) : null}

      <div className="dcin-tablewrap">
        {loading && rows.length === 0 ? (
          <div className="dcin-empty">Cargando…</div>
        ) : sorted.length === 0 ? (
          <div className="dcin-empty">
            <div className="dcin-empty__title">Sin inmobiliarias</div>
            <div>
              No hay cuentas que coincidan con el filtro. Si acabas de aplicar el
              SQL del vertical, todavía no se ha registrado nadie.
            </div>
          </div>
        ) : (
          <table className="dcin-table">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`dcin-th${col.align === "right" ? " dcin-num" : ""}`}
                    onClick={() => toggleSort(col.key)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") toggleSort(col.key);
                    }}
                  >
                    {col.label}
                    {sort.key === col.key ? (
                      <span className="dcin-sortmark">{sort.dir === "asc" ? "▲" : "▼"}</span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const face = subscriptionFace(row.subscriptionStatus);
                const quotaBytes = row.storageQuotaMb * 1024 * 1024;
                const pct = percentOf(row.storageUsedBytes, quotaBytes);
                return (
                  <tr key={row.id} className="dcin-row">
                    <td>
                      <Link className="dcin-link" href={`/admin/inmobiliarias/${row.id}`}>
                        {row.name}
                      </Link>
                      <div className="dcin-ellipsis" style={{ fontSize: 11.5, opacity: 0.7 }}>
                        /{row.slug}
                      </div>
                    </td>
                    <td className="dcin-ellipsis">
                      {row.city ? `${row.city}${row.state ? `, ${row.state}` : ""}` : "—"}
                    </td>
                    <td className="dcin-nowrap">{MODE_LABELS[row.mode]}</td>
                    <td className="dcin-nowrap">{row.planName}</td>
                    <td className="dcin-nowrap">{chip(face.tone, face.label)}</td>
                    <td className="dcin-num">{formatInt(row.users)}</td>
                    <td className="dcin-num">{formatInt(row.properties)}</td>
                    <td className="dcin-num">
                      {formatBytes(row.storageUsedBytes)}
                      <div style={{ fontSize: 11, opacity: 0.7 }}>
                        de {formatQuota(row.storageQuotaMb)} · {pct}%
                      </div>
                    </td>
                    <td className="dcin-nowrap">{relativeDate(row.lastActivityAt)}</td>
                    <td className="dcin-nowrap">{shortDate(row.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="dcin-note">
        <Building2 size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} aria-hidden />
        Se muestran hasta 500 cuentas. El orden por columna se aplica sobre lo
        que ya está cargado; los filtros sí van al servidor.
      </p>
    </div>
  );
}
