"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Inbox, Mail, RotateCw, Shuffle, Timer } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import type { RealtyLeadRoutingConfig, RealtyRoutingStrategy } from "@/lib/realty/leads";
import { CopyButton, Field } from "./lead-bits";
import { dateTime, LEADS_CSS } from "./lead-ui";

const STRATEGIES: RealtyRoutingStrategy[] = ["ROTACION", "ZONA", "TURNO", "MANUAL"];
const DAYS = [0, 1, 2, 3, 4, 5, 6];

export interface RoutingCandidate {
  id: string;
  name: string;
  role: string;
  zones: string[];
  openLeads: number;
  lastAssignedAt: string | null;
}

export interface InboundLogRow {
  id: string;
  receivedAt: string;
  subject: string;
  from: string;
  portal: string | null;
  status: string;
  confidence: string | null;
  leadId: string | null;
  truncated: boolean;
}

export interface RoutingPayload {
  config: RealtyLeadRoutingConfig;
  canEdit: boolean;
  candidates: RoutingCandidate[];
  inbox: {
    address: string;
    portals: { slug: string; label: string; domain: string }[];
    configured: boolean;
    log: InboundLogRow[];
  };
  mode: string;
}

/**
 * REGLAS DE ASIGNACIÓN + BUZÓN DE CORREO.
 *
 * Las dos cosas viven en la misma pantalla a propósito: son las dos mitades
 * de "el prospecto llega solo y alguien lo atiende". Separarlas hace que se
 * configure una y se olvide la otra, y un prospecto que entra pero no se
 * asigna es exactamente igual de inútil que uno que no entra.
 */
export function RoutingScreen({
  dict,
  locale,
  initial,
  timeZone,
}: {
  dict: Dictionary;
  locale: string;
  initial: RoutingPayload;
  timeZone: string;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const [data, setData] = useState<RoutingPayload>(initial);
  const [config, setConfig] = useState<RealtyLeadRoutingConfig>(initial.config);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newZone, setNewZone] = useState("");

  const canEdit = data.canEdit;

  async function save(patch: Partial<RealtyLeadRoutingConfig>) {
    if (!canEdit) return;
    const next = { ...config, ...patch };
    setConfig(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/realty/leads/routing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = (await res.json().catch(() => ({}))) as {
        config?: RealtyLeadRoutingConfig;
        error?: string;
      };
      if (!res.ok || !json.config) {
        setError(json.error ?? t("error"));
        setConfig(config);
        return;
      }
      setConfig(json.config);
      setData((d) => ({ ...d, config: json.config as RealtyLeadRoutingConfig }));
      setNotice(t("rules.saved"));
      window.setTimeout(() => setNotice(null), 2500);
    } catch {
      setError(t("error"));
      setConfig(config);
    } finally {
      setSaving(false);
    }
  }

  async function sweepNow() {
    setSaving(true);
    try {
      const res = await fetch("/api/realty/leads/sweep", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { reassigned?: number };
      setNotice(
        json.reassigned && json.reassigned > 0
          ? t("rules.sweepDone", { count: json.reassigned })
          : t("rules.sweepNone"),
      );
      window.setTimeout(() => setNotice(null), 4000);
    } catch {
      setError(t("error"));
    } finally {
      setSaving(false);
    }
  }

  function togglePool(userId: string) {
    const on = config.poolUserIds.includes(userId);
    void save({
      poolUserIds: on
        ? config.poolUserIds.filter((x) => x !== userId)
        : [...config.poolUserIds, userId],
    });
  }

  function setZoneAgents(zone: string, userIds: string[]) {
    const next = { ...config.zoneOverrides };
    if (userIds.length === 0) delete next[zone];
    else next[zone] = userIds;
    void save({ zoneOverrides: next });
  }

  function setShift(userId: string, index: number, patch: Partial<{ days: number[]; from: string; to: string }>) {
    const list = [...(config.shifts[userId] ?? [])];
    const current = list[index] ?? { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" };
    list[index] = { ...current, ...patch };
    void save({ shifts: { ...config.shifts, [userId]: list } });
  }

  function addShift(userId: string) {
    const list = [...(config.shifts[userId] ?? []), { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00" }];
    void save({ shifts: { ...config.shifts, [userId]: list } });
  }

  function removeShift(userId: string, index: number) {
    const list = (config.shifts[userId] ?? []).filter((_, i) => i !== index);
    const next = { ...config.shifts };
    if (list.length === 0) delete next[userId];
    else next[userId] = list;
    void save({ shifts: next });
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: LEADS_CSS }} />

      <div className="realty-page">
        <div>
          <Link href="/inmobiliaria/prospectos" className="lead-btn lead-btn--sm lead-btn--ghost" style={{ paddingLeft: 0 }}>
            <ArrowLeft size={14} aria-hidden />
            {t("actions.back")}
          </Link>
        </div>

        <header>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--text-1)" }}>
            {t("rules.title")}
          </h1>
          <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--text-2)" }}>{t("rules.subtitle")}</p>
        </header>

        {!canEdit ? (
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-3)", background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)", borderRadius: 10, padding: "8px 11px" }}>
            {t("rules.readonly")}
          </p>
        ) : null}
        {notice ? (
          <p role="status" style={{ margin: 0, fontSize: 12.5, color: "var(--pine-700)", background: "var(--brand-soft)", border: "1px solid var(--border-brand)", borderRadius: 10, padding: "8px 11px" }}>
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--danger)", background: "rgba(198, 40, 40, 0.10)", border: "1px solid rgba(198, 40, 40, 0.30)", borderRadius: 10, padding: "8px 11px" }}>
            {error}
          </p>
        ) : null}

        {/* ═══ EL BUZÓN ═══ */}
        <section className="lead-panel">
          <h2 className="lead-panel__title" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 15 }}>
            <Inbox size={16} aria-hidden style={{ color: "var(--brand)" }} />
            {t("inbox.title")}
          </h2>
          <p style={{ margin: "5px 0 0", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>{t("inbox.help")}</p>

          {!data.inbox.configured ? (
            <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "#8A5200", background: "rgba(178, 106, 0, 0.12)", border: "1px solid rgba(178, 106, 0, 0.30)", borderRadius: 10, padding: "8px 11px" }}>
              {t("inbox.notConfigured")}
            </p>
          ) : null}

          <div style={{ marginTop: 11 }}>
            <span className="lead-label">{t("inbox.address")}</span>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                marginTop: 5,
                padding: "9px 11px",
                background: "var(--bg-elev-2)",
                border: "1px solid var(--border-strong)",
                borderRadius: 10,
                flexWrap: "wrap",
              }}
            >
              <Mail size={14} aria-hidden style={{ color: "var(--text-3)", flexShrink: 0 }} />
              <code style={{ fontSize: 13, color: "var(--text-1)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", overflowWrap: "anywhere", flex: 1, minWidth: 180 }}>
                {data.inbox.address}
              </code>
              <CopyButton value={data.inbox.address} label={t("actions.copy")} copiedLabel={t("actions.copied")} />
            </div>
          </div>

          <div style={{ marginTop: 13 }}>
            <p className="lead-panel__title">{t("inbox.howTitle")}</p>
            <p style={{ margin: "4px 0 9px", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>{t("inbox.howGeneric")}</p>
            <p className="lead-label">{t("inbox.supported")}</p>
            <ul style={{ listStyle: "none", display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0 0", padding: 0 }}>
              {data.inbox.portals.map((p) => (
                <li
                  key={p.slug}
                  className="lead-chip"
                  style={{ color: "var(--text-2)", background: "var(--bg-elev-2)", borderColor: "var(--border-soft)" }}
                  title={p.domain}
                >
                  {p.label}
                </li>
              ))}
            </ul>
          </div>

          {/* La bitácora de correos solo la trae el servidor para quien
              reparte prospectos. Se ESCONDE entera en vez de pintarla vacía:
              "todavía no ha llegado ningún correo" sería mentira para quien
              simplemente no tiene permiso de verla. */}
          {canEdit ? (
          <div style={{ marginTop: 15, borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
            <p className="lead-panel__title">{t("inbox.logTitle")}</p>
            <p style={{ margin: "4px 0 9px", fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.5 }}>{t("inbox.logHelp")}</p>
            {data.inbox.log.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-3)" }}>{t("inbox.logEmpty")}</p>
            ) : (
              <div className="lead-table-wrap">
                <table className="lead-table" style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th scope="col">{t("table.created")}</th>
                      <th scope="col">{t("inbox.address")}</th>
                      <th scope="col">{t("filters.source")}</th>
                      <th scope="col">{t("table.stage")}</th>
                      <th scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.inbox.log.map((row) => (
                      <tr key={row.id}>
                        <td style={{ whiteSpace: "nowrap", color: "var(--text-3)" }}>{dateTime(row.receivedAt, locale)}</td>
                        <td style={{ maxWidth: 260 }}>
                          <span className="lead-truncate" style={{ display: "block", color: "var(--text-1)" }}>
                            {row.subject}
                          </span>
                          <span className="lead-truncate" style={{ display: "block", fontSize: 11, color: "var(--text-4)" }}>
                            {row.from}
                          </span>
                        </td>
                        <td style={{ color: "var(--text-2)" }}>{row.portal ?? "—"}</td>
                        <td>
                          <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                            {t(`inbox.logStatus.${row.status}`)}
                          </span>
                          {row.confidence ? (
                            <div style={{ fontSize: 11, color: "var(--text-4)" }}>
                              {t(`inbox.confidence.${row.confidence}`)}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {row.leadId ? (
                            <Link href={`/inmobiliaria/prospectos/${row.leadId}`} className="lead-btn lead-btn--sm lead-btn--ghost">
                              {t("inbox.seeLead")}
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          ) : null}
        </section>

        {/* ═══ ESTRATEGIA ═══ */}
        <section className="lead-panel">
          <h2 className="lead-panel__title" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 15 }}>
            <Shuffle size={16} aria-hidden style={{ color: "var(--brand)" }} />
            {t("rules.strategyTitle")}
          </h2>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {STRATEGIES.map((s) => {
              const on = config.strategy === s;
              return (
                <label
                  key={s}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "11px 13px",
                    border: `1px solid ${on ? "var(--border-brand)" : "var(--border-soft)"}`,
                    background: on ? "var(--brand-soft)" : "transparent",
                    borderRadius: 11,
                    cursor: canEdit ? "pointer" : "not-allowed",
                    opacity: canEdit ? 1 : 0.7,
                  }}
                >
                  <input
                    type="radio"
                    name="strategy"
                    checked={on}
                    disabled={!canEdit || saving}
                    onChange={() => void save({ strategy: s })}
                    style={{ marginTop: 2 }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>
                      {t(`rules.strategy.${s}`)}
                    </span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--text-2)", lineHeight: 1.5, marginTop: 2 }}>
                      {t(`rules.strategy.${s}_help`)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        {/* ═══ ⭐ REASIGNACIÓN POR NO-RESPUESTA ═══ */}
        <section className="lead-panel" style={{ borderColor: "var(--border-brand)" }}>
          <h2 className="lead-panel__title" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 15 }}>
            <Timer size={16} aria-hidden style={{ color: "var(--brand)" }} />
            {t("rules.reassignTitle")}
          </h2>
          <p style={{ margin: "5px 0 0", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>{t("rules.reassignHelp")}</p>

          <label style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 12, fontSize: 13, color: "var(--text-1)", cursor: canEdit ? "pointer" : "not-allowed" }}>
            <input
              type="checkbox"
              checked={config.reassignEnabled}
              disabled={!canEdit || saving}
              onChange={(e) => void save({ reassignEnabled: e.target.checked })}
            />
            {t("rules.reassignEnabled")}
          </label>

          <div className="lead-filters" style={{ marginTop: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <Field label={t("rules.reassignMinutes")} help={t("rules.reassignMinutesHelp")} htmlFor="r-min">
              <input
                id="r-min"
                className="lead-input"
                type="number"
                min={1}
                max={1440}
                value={config.reassignAfterMinutes}
                disabled={!canEdit || saving || !config.reassignEnabled}
                onChange={(e) => setConfig({ ...config, reassignAfterMinutes: Number(e.target.value) })}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 1 && v <= 1440 && v !== data.config.reassignAfterMinutes) {
                    void save({ reassignAfterMinutes: Math.round(v) });
                  }
                }}
              />
            </Field>
            <Field label={t("rules.reassignHops")} help={t("rules.reassignHopsHelp")} htmlFor="r-hops">
              <input
                id="r-hops"
                className="lead-input"
                type="number"
                min={0}
                max={10}
                value={config.reassignMaxHops}
                disabled={!canEdit || saving || !config.reassignEnabled}
                onChange={(e) => setConfig({ ...config, reassignMaxHops: Number(e.target.value) })}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 0 && v <= 10 && v !== data.config.reassignMaxHops) {
                    void save({ reassignMaxHops: Math.round(v) });
                  }
                }}
              />
            </Field>
          </div>

          {canEdit ? (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="lead-btn" onClick={() => void sweepNow()} disabled={saving}>
                <RotateCw size={14} aria-hidden />
                {t("rules.sweepNow")}
              </button>
            </div>
          ) : null}
        </section>

        {/* ═══ QUIÉN ENTRA AL REPARTO ═══ */}
        <section className="lead-panel">
          <h2 className="lead-panel__title" style={{ fontSize: 15 }}>{t("rules.poolTitle")}</h2>
          <p style={{ margin: "5px 0 0", fontSize: 12.5, color: "var(--text-2)" }}>{t("rules.poolHelp")}</p>

          <ul style={{ listStyle: "none", margin: "11px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 7 }}>
            {data.candidates.map((c) => {
              const inPool = config.poolUserIds.length === 0 || config.poolUserIds.includes(c.id);
              return (
                <li
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 11px",
                    border: "1px solid var(--border-soft)",
                    borderRadius: 10,
                    background: inPool ? "var(--bg-elev-2)" : "transparent",
                    opacity: inPool ? 1 : 0.6,
                    flexWrap: "wrap",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={config.poolUserIds.includes(c.id)}
                    disabled={!canEdit || saving}
                    onChange={() => togglePool(c.id)}
                    aria-label={c.name}
                  />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{c.name}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--text-3)" }}>
                      {t("rules.poolOpen", { count: c.openLeads })} ·{" "}
                      {c.lastAssignedAt ? t("rules.poolLast", { when: dateTime(c.lastAssignedAt, locale) }) : t("rules.poolNever")}
                      {c.zones.length > 0 ? ` · ${c.zones.join(", ")}` : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ═══ ZONAS (solo aplica con reparto por ZONA) ═══ */}
        {config.strategy === "ZONA" ? (
          <section className="lead-panel">
            <h2 className="lead-panel__title" style={{ fontSize: 15 }}>{t("rules.zonesTitle")}</h2>
            <p style={{ margin: "5px 0 0", fontSize: 12.5, color: "var(--text-2)" }}>{t("rules.zonesHelp")}</p>

            <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 11 }}>
              {Object.entries(config.zoneOverrides).map(([zone, ids]) => (
                <div key={zone} style={{ border: "1px solid var(--border-soft)", borderRadius: 10, padding: "9px 11px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 9 }}>
                    <strong style={{ fontSize: 13, color: "var(--text-1)" }}>{zone}</strong>
                    {canEdit ? (
                      <button type="button" className="lead-btn lead-btn--sm lead-btn--ghost lead-btn--danger" onClick={() => setZoneAgents(zone, [])}>
                        {t("actions.close")}
                      </button>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
                    {data.candidates.map((c) => {
                      const on = ids.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className="lead-btn lead-btn--sm"
                          aria-pressed={on}
                          disabled={!canEdit || saving}
                          onClick={() => setZoneAgents(zone, on ? ids.filter((x) => x !== c.id) : [...ids, c.id])}
                          style={on ? { background: "var(--brand-soft)", borderColor: "var(--border-brand)", color: "var(--pine-700)" } : undefined}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {canEdit ? (
              <div style={{ display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap" }}>
                <input
                  className="lead-input"
                  style={{ maxWidth: 240 }}
                  value={newZone}
                  onChange={(e) => setNewZone(e.target.value)}
                  placeholder={t("rules.zonePlaceholder")}
                  aria-label={t("rules.zoneAdd")}
                />
                <button
                  type="button"
                  className="lead-btn"
                  disabled={!newZone.trim() || saving}
                  onClick={() => {
                    const zone = newZone.trim();
                    if (!zone) return;
                    // Se crea con el primer asesor de la lista: una zona sin
                    // nadie asignado no cambia nada y parecería que se guardó.
                    const first = data.candidates[0]?.id;
                    if (first) setZoneAgents(zone, [first]);
                    setNewZone("");
                  }}
                >
                  {t("rules.zoneAdd")}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* ═══ TURNOS (solo aplica con reparto por TURNO) ═══ */}
        {config.strategy === "TURNO" ? (
          <section className="lead-panel">
            <h2 className="lead-panel__title" style={{ fontSize: 15 }}>{t("rules.shiftsTitle")}</h2>
            <p style={{ margin: "5px 0 0", fontSize: 12.5, color: "var(--text-2)" }}>{t("rules.shiftsHelp", { tz: timeZone })}</p>

            <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 11 }}>
              {data.candidates.map((c) => {
                const shifts = config.shifts[c.id] ?? [];
                return (
                  <div key={c.id} style={{ border: "1px solid var(--border-soft)", borderRadius: 10, padding: "9px 11px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 9, flexWrap: "wrap" }}>
                      <strong style={{ fontSize: 13, color: "var(--text-1)" }}>{c.name}</strong>
                      {canEdit ? (
                        <button type="button" className="lead-btn lead-btn--sm" onClick={() => addShift(c.id)} disabled={saving}>
                          {t("rules.shiftAdd")}
                        </button>
                      ) : null}
                    </div>

                    {shifts.map((shift, i) => (
                      <div key={i} style={{ marginTop: 9, paddingTop: 9, borderTop: "1px solid var(--border-soft)" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                          {DAYS.map((d) => {
                            const on = shift.days.includes(d);
                            return (
                              <button
                                key={d}
                                type="button"
                                className="lead-btn lead-btn--sm"
                                aria-pressed={on}
                                disabled={!canEdit || saving}
                                onClick={() =>
                                  setShift(c.id, i, {
                                    days: on ? shift.days.filter((x) => x !== d) : [...shift.days, d],
                                  })
                                }
                                style={on ? { background: "var(--brand-soft)", borderColor: "var(--border-brand)", color: "var(--pine-700)" } : undefined}
                              >
                                {t(`rules.days.${d}`)}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ display: "flex", gap: 9, marginTop: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                          <div style={{ width: 120 }}>
                            <Field label={t("rules.shiftFrom")} htmlFor={`sh-${c.id}-${i}-from`}>
                              <input
                                id={`sh-${c.id}-${i}-from`}
                                className="lead-input"
                                type="time"
                                value={shift.from}
                                disabled={!canEdit || saving}
                                onChange={(e) => setShift(c.id, i, { from: e.target.value })}
                              />
                            </Field>
                          </div>
                          <div style={{ width: 120 }}>
                            <Field label={t("rules.shiftTo")} htmlFor={`sh-${c.id}-${i}-to`}>
                              <input
                                id={`sh-${c.id}-${i}-to`}
                                className="lead-input"
                                type="time"
                                value={shift.to}
                                disabled={!canEdit || saving}
                                onChange={(e) => setShift(c.id, i, { to: e.target.value })}
                              />
                            </Field>
                          </div>
                          {canEdit ? (
                            <button type="button" className="lead-btn lead-btn--sm lead-btn--danger" onClick={() => removeShift(c.id, i)} disabled={saving}>
                              {t("actions.close")}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* ═══ TOLERANCIA DEL MATCH ═══ */}
        <section className="lead-panel">
          <h2 className="lead-panel__title" style={{ fontSize: 15 }}>{t("rules.toleranceTitle")}</h2>
          <p style={{ margin: "5px 0 0", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>{t("rules.toleranceHelp")}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 11, flexWrap: "wrap" }}>
            <input
              type="range"
              min={0}
              max={30}
              step={1}
              value={config.matchTolerancePct}
              disabled={!canEdit || saving}
              onChange={(e) => setConfig({ ...config, matchTolerancePct: Number(e.target.value) })}
              onMouseUp={() => void save({ matchTolerancePct: config.matchTolerancePct })}
              onTouchEnd={() => void save({ matchTolerancePct: config.matchTolerancePct })}
              onKeyUp={() => void save({ matchTolerancePct: config.matchTolerancePct })}
              aria-label={t("rules.toleranceTitle")}
              style={{ flex: "1 1 220px", maxWidth: 340 }}
            />
            <strong style={{ fontSize: 15, color: "var(--brand)" }}>±{config.matchTolerancePct}%</strong>
          </div>
        </section>
      </div>
    </>
  );
}
