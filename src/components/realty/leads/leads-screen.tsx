"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LayoutGrid, List, Plus, RefreshCw, Search, SlidersHorizontal, Sliders } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import {
  REALTY_LEAD_FLOW,
  REALTY_LOST_REASONS,
  type RealtyLeadStage,
  type RealtyLostReason,
} from "@/lib/realty/types";
import type { RealtyLeadCardDTO, RealtyLeadsCatalogs } from "@/lib/realty/leads";
import { contactHeat, LEADS_CSS } from "./lead-ui";
import { Dialog, Field, Kpi, useNow } from "./lead-bits";
import { LeadBoard } from "./lead-board";
import { LeadTable } from "./lead-table";
import { NewLeadDialog } from "./new-lead-dialog";
import { TasksToday } from "./tasks-today";

const VIEW_KEY = "realty.leads.view";
const CREDITS = ["INFONAVIT", "FOVISSSTE", "BANCARIO", "CONTADO", "NINGUNO"] as const;

interface ApiPayload {
  leads: RealtyLeadCardDTO[];
  total: number;
  truncated: boolean;
  catalogs: RealtyLeadsCatalogs;
  routing: { strategy: string; reassignAfterMinutes: number; reassignEnabled: boolean };
  sweep: { reassigned: number } | null;
  me: { realtyUserId: string; role: string };
}

/**
 * Pantalla del EMBUDO. Tablero (arrastrable) y tabla sobre los MISMOS datos:
 * el tablero es para mover, la tabla para buscar.
 *
 * CONVENCIÓN B de i18n: el servidor manda el sub-árbol `realty.leads` ya
 * recortado y aquí NO se antepone prefijo. Cruzar las dos convenciones es lo
 * que pinta llaves crudas (ver src/lib/realty/i18n.ts).
 */
export function LeadsScreen({
  dict,
  locale,
  initial,
  canEdit,
  canAssign,
  timeZone,
}: {
  dict: Dictionary;
  locale: string;
  initial: ApiPayload;
  canEdit: boolean;
  canAssign: boolean;
  timeZone: string;
}) {
  // 🔴 useMemo NO es cosmético: makeRealtyT devuelve una FUNCIÓN NUEVA en
  // cada render. Con `t` suelto en las dependencias del useCallback de
  // abajo, `load` cambiaba de identidad en cada render, el useEffect que
  // depende de `load` volvía a dispararse, y la pantalla entraba en un
  // BUCLE INFINITO de peticiones al embudo.
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const now = useNow();

  const [data, setData] = useState<ApiPayload>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [view, setView] = useState<"board" | "table">("board");
  const [showFilters, setShowFilters] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pendingLost, setPendingLost] = useState<{ leadId: string; from: RealtyLeadStage } | null>(null);
  const [lostReason, setLostReason] = useState<RealtyLostReason | "">("");

  // Filtros
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [stage, setStage] = useState("");
  const [agent, setAgent] = useState("");
  const [source, setSource] = useState("");
  const [credit, setCredit] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [maxAgeDays, setMaxAgeDays] = useState("");
  const [onlyUncontacted, setOnlyUncontacted] = useState(false);

  // La preferencia de vista es de la persona, no de la cuenta: se guarda en
  // el navegador. Se lee en un efecto (no en el estado inicial) para que el
  // HTML del servidor y el del primer render del cliente coincidan.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === "board" || saved === "table") setView(saved);
    } catch {
      /* modo privado o almacenamiento bloqueado: se queda con el tablero */
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search.trim()), 320);
    return () => window.clearTimeout(id);
  }, [search]);

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    if (debounced) sp.set("search", debounced);
    if (stage) sp.set("stage", stage);
    if (agent) sp.set("assignedUserId", agent);
    if (source) sp.set("source", source);
    if (credit) sp.set("creditKind", credit);
    if (budgetMin) sp.set("budgetMin", budgetMin.replace(/[^0-9.]/g, ""));
    if (budgetMax) sp.set("budgetMax", budgetMax.replace(/[^0-9.]/g, ""));
    if (maxAgeDays) sp.set("maxAgeDays", maxAgeDays);
    if (onlyUncontacted) sp.set("onlyUncontacted", "1");
    return sp.toString();
  }, [debounced, stage, agent, source, credit, budgetMin, budgetMax, maxAgeDays, onlyUncontacted]);

  const activeFilterCount = useMemo(
    () =>
      [stage, agent, source, credit, budgetMin, budgetMax, maxAgeDays].filter(Boolean).length +
      (onlyUncontacted ? 1 : 0),
    [stage, agent, source, credit, budgetMin, budgetMax, maxAgeDays, onlyUncontacted],
  );

  // Cada carga trae la barrida de reasignación del servidor. `sweep=0` en la
  // recarga tras mover una tarjeta: no tiene sentido volver a barrer cuando
  // el usuario acaba de tocar el embudo.
  const load = useCallback(
    async (opts: { sweep?: boolean } = {}) => {
      setLoading(true);
      setError(null);
      try {
        const sp = new URLSearchParams(query);
        if (opts.sweep === false) sp.set("sweep", "0");
        const res = await fetch(`/api/realty/leads?${sp.toString()}`, { cache: "no-store" });
        if (!res.ok) {
          setError(t("error"));
          return;
        }
        const json = (await res.json()) as ApiPayload;
        setData(json);
        if (json.sweep && json.sweep.reassigned > 0) {
          setNotice(t("rules.sweepDone", { count: json.sweep.reassigned }));
        }
      } catch {
        setError(t("error"));
      } finally {
        setLoading(false);
      }
    },
    [query, t],
  );

  // La primera carga ya viene del servidor: solo se recarga cuando cambian
  // los filtros. Sin esta guarda se pediría dos veces al abrir la pantalla.
  const firstQuery = useRef(query);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      if (query === firstQuery.current) return;
    }
    void load();
  }, [query, load]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(id);
  }, [notice]);

  function switchView(next: "board" | "table") {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* sin almacenamiento: la vista dura lo que dure la sesión */
    }
  }

  async function move(leadId: string, to: RealtyLeadStage, reason?: RealtyLostReason) {
    const before = data.leads;
    // Optimismo: la tarjeta salta de columna al soltarla. Si el servidor
    // dice que no, se revierte y se explica — dejar la tarjeta "pensando"
    // en un tablero es peor que moverla y deshacer.
    setData((d) => ({
      ...d,
      leads: d.leads.map((l) => (l.id === leadId ? { ...l, stage: to } : l)),
    }));
    try {
      const res = await fetch(`/api/realty/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: to, lostReason: reason ?? null }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setData((d) => ({ ...d, leads: before }));
        setError(json.error ?? t("error"));
        return;
      }
      await load({ sweep: false });
    } catch {
      setData((d) => ({ ...d, leads: before }));
      setError(t("error"));
    }
  }

  function onMove(leadId: string, to: RealtyLeadStage) {
    if (!canEdit) return;
    if (to === "PERDIDO") {
      // PERDIDO pide motivo ANTES de mover: sin el motivo, el reporte de
      // pérdidas no distingue "caro" de "nadie le contestó", que es
      // justamente lo único que sirve para arreglarlo.
      const lead = data.leads.find((l) => l.id === leadId);
      if (!lead) return;
      setLostReason("");
      setPendingLost({ leadId, from: lead.stage });
      return;
    }
    void move(leadId, to);
  }

  const kpis = useMemo(() => {
    let uncontacted = 0;
    let red = 0;
    let unassigned = 0;
    let open = 0;
    for (const lead of data.leads) {
      if (lead.stage === "CIERRE" || lead.stage === "PERDIDO") continue;
      open += 1;
      const heat = contactHeat(lead, now);
      if (heat.neverContacted) uncontacted += 1;
      if (heat.heat === "ROJO") red += 1;
      if (!lead.assignedUserId) unassigned += 1;
    }
    return { uncontacted, red, unassigned, open };
  }, [data.leads, now]);

  const isEmpty = data.total === 0 && activeFilterCount === 0 && !debounced;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: LEADS_CSS }} />

      <div className="realty-page">
        {/* ── Encabezado ── */}
        <header style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start", justifyContent: "space-between" }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--text-1)" }}>
              {t("title")}
            </h1>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--text-2)" }}>{t("subtitle")}</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="lead-btn"
              onClick={() => void load()}
              disabled={loading}
              title={t("actions.refresh")}
            >
              <RefreshCw size={14} aria-hidden style={loading ? { opacity: 0.5 } : undefined} />
              {t("actions.refresh")}
            </button>
            <Link href="/inmobiliaria/prospectos/reglas" className="lead-btn">
              <Sliders size={14} aria-hidden />
              {t("actions.rules")}
            </Link>
            {canEdit ? (
              <button
                type="button"
                className="lead-btn realty-btn-primary"
                onClick={() => setShowNew(true)}
              >
                <Plus size={15} aria-hidden />
                {t("actions.new")}
              </button>
            ) : null}
          </div>
        </header>

        {/* El dato que justifica la pantalla. No es relleno: es lo que hace
            que alguien mire el semáforo en vez de ignorarlo. */}
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--text-3)",
            background: "var(--brand-softer)",
            border: "1px solid var(--border-soft)",
            borderRadius: 10,
            padding: "8px 11px",
            lineHeight: 1.5,
          }}
        >
          {t("why")}
        </p>

        {notice ? (
          <p
            role="status"
            style={{
              margin: 0,
              fontSize: 12.5,
              color: "var(--pine-700)",
              background: "var(--brand-soft)",
              border: "1px solid var(--border-brand)",
              borderRadius: 10,
              padding: "8px 11px",
            }}
          >
            {notice}
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            style={{
              margin: 0,
              fontSize: 12.5,
              color: "var(--danger)",
              background: "rgba(198, 40, 40, 0.10)",
              border: "1px solid rgba(198, 40, 40, 0.30)",
              borderRadius: 10,
              padding: "8px 11px",
              display: "flex",
              gap: 10,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            {error}
            <button type="button" className="lead-btn lead-btn--sm" onClick={() => void load()}>
              {t("retry")}
            </button>
          </p>
        ) : null}

        {/* ── KPIs: cada uno es un filtro de un clic ── */}
        <div className="lead-kpis">
          <Kpi
            label={t("kpi.uncontacted")}
            value={kpis.uncontacted}
            help={t("kpi.uncontactedHelp")}
            tone={kpis.uncontacted > 0 ? "danger" : "neutral"}
            active={onlyUncontacted}
            onClick={() => setOnlyUncontacted((v) => !v)}
          />
          <Kpi label={t("kpi.red")} value={kpis.red} help={t("kpi.redHelp")} tone={kpis.red > 0 ? "warning" : "neutral"} />
          <Kpi
            label={t("kpi.unassigned")}
            value={kpis.unassigned}
            help={t("kpi.unassignedHelp")}
            tone={kpis.unassigned > 0 ? "info" : "neutral"}
            active={agent === "SIN_ASIGNAR"}
            onClick={() => setAgent((v) => (v === "SIN_ASIGNAR" ? "" : "SIN_ASIGNAR"))}
          />
          <Kpi label={t("kpi.open")} value={kpis.open} help={t("kpi.openHelp")} tone="brand" />
        </div>

        {/* ── Barra de herramientas ── */}
        <div className="lead-toolbar">
          <div className="lead-toolbar__grow" style={{ position: "relative" }}>
            <Search
              size={14}
              aria-hidden
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-4)",
              }}
            />
            <input
              className="lead-input"
              style={{ paddingLeft: 30 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("search.placeholder")}
              aria-label={t("search.label")}
              type="search"
            />
          </div>

          <button
            type="button"
            className="lead-btn"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
          >
            <SlidersHorizontal size={14} aria-hidden />
            {activeFilterCount > 0 ? t("filters.applied", { count: activeFilterCount }) : t("actions.filters")}
          </button>

          <div role="tablist" aria-label={t("views.label")} style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              role="tab"
              aria-selected={view === "board"}
              className="lead-btn"
              onClick={() => switchView("board")}
              style={
                view === "board"
                  ? { background: "var(--brand-soft)", borderColor: "var(--border-brand)", color: "var(--pine-700)" }
                  : undefined
              }
            >
              <LayoutGrid size={14} aria-hidden />
              {t("views.board")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "table"}
              className="lead-btn"
              onClick={() => switchView("table")}
              style={
                view === "table"
                  ? { background: "var(--brand-soft)", borderColor: "var(--border-brand)", color: "var(--pine-700)" }
                  : undefined
              }
            >
              <List size={14} aria-hidden />
              {t("views.table")}
            </button>
          </div>
        </div>

        {showFilters ? (
          <div className="lead-panel">
            <div className="lead-filters">
              <Field label={t("filters.stage")} htmlFor="f-stage">
                <select id="f-stage" className="lead-select" value={stage} onChange={(e) => setStage(e.target.value)}>
                  <option value="">{t("filters.all")}</option>
                  {[...REALTY_LEAD_FLOW, "PERDIDO"].map((s) => (
                    <option key={s} value={s}>
                      {t(`stages.${s}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("filters.agent")} htmlFor="f-agent">
                <select id="f-agent" className="lead-select" value={agent} onChange={(e) => setAgent(e.target.value)}>
                  <option value="">{t("filters.all")}</option>
                  <option value="SIN_ASIGNAR">{t("filters.unassigned")}</option>
                  {data.catalogs.agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("filters.source")} htmlFor="f-source">
                <select id="f-source" className="lead-select" value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="">{t("filters.all")}</option>
                  {data.catalogs.sources.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/^portal:/, "")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("filters.credit")} htmlFor="f-credit">
                <select id="f-credit" className="lead-select" value={credit} onChange={(e) => setCredit(e.target.value)}>
                  <option value="">{t("filters.all")}</option>
                  {CREDITS.map((c) => (
                    <option key={c} value={c}>
                      {t(`credit.${c}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`${t("filters.budget")} — ${t("filters.budgetMin")}`} htmlFor="f-bmin">
                <input
                  id="f-bmin"
                  className="lead-input"
                  value={budgetMin}
                  onChange={(e) => setBudgetMin(e.target.value)}
                  inputMode="numeric"
                />
              </Field>
              <Field label={`${t("filters.budget")} — ${t("filters.budgetMax")}`} htmlFor="f-bmax">
                <input
                  id="f-bmax"
                  className="lead-input"
                  value={budgetMax}
                  onChange={(e) => setBudgetMax(e.target.value)}
                  inputMode="numeric"
                />
              </Field>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginTop: 11 }}>
              <div style={{ minWidth: 180 }}>
                <Field label={t("filters.age")} htmlFor="f-age">
                  <select id="f-age" className="lead-select" value={maxAgeDays} onChange={(e) => setMaxAgeDays(e.target.value)}>
                    <option value="">{t("filters.ageAny")}</option>
                    <option value="1">{t("filters.age1")}</option>
                    <option value="7">{t("filters.age7")}</option>
                    <option value="30">{t("filters.age30")}</option>
                    <option value="90">{t("filters.age90")}</option>
                  </select>
                </Field>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--text-2)", cursor: "pointer" }}>
                <input type="checkbox" checked={onlyUncontacted} onChange={(e) => setOnlyUncontacted(e.target.checked)} />
                {t("filters.onlyUncontacted")}
              </label>
              {activeFilterCount > 0 ? (
                <button
                  type="button"
                  className="lead-btn lead-btn--sm lead-btn--ghost"
                  onClick={() => {
                    setStage("");
                    setAgent("");
                    setSource("");
                    setCredit("");
                    setBudgetMin("");
                    setBudgetMax("");
                    setMaxAgeDays("");
                    setOnlyUncontacted(false);
                  }}
                >
                  {t("actions.clearFilters")}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {data.truncated ? (
          <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-3)" }}>
            {t("board.truncated", { count: data.leads.length })}
          </p>
        ) : null}

        {/* ── El embudo ── */}
        {isEmpty ? (
          <div className="lead-panel" style={{ textAlign: "center", padding: "34px 20px" }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text-1)" }}>{t("empty.title")}</p>
            <p style={{ margin: "7px auto 14px", fontSize: 13, color: "var(--text-2)", maxWidth: 460, lineHeight: 1.6 }}>
              {t("empty.body")}
            </p>
            <Link href="/inmobiliaria/prospectos/reglas" className="lead-btn realty-btn-primary">
              {t("empty.cta")}
            </Link>
          </div>
        ) : view === "board" ? (
          <LeadBoard leads={data.leads} t={t} now={now} canDrag={canEdit} onMove={onMove} />
        ) : (
          <LeadTable leads={data.leads} t={t} now={now} locale={locale} />
        )}

        <TasksToday t={t} canAssign={canAssign} timeZone={timeZone} locale={locale} />
      </div>

      {/* ── Diálogos. Se montan aquí, hermanos de .realty-page, y además
          Dialog los pinta en un portal a .realty-shell: el container-type
          de .realty-page atrapa position:fixed (ver lead-bits.tsx). ── */}
      {showNew ? (
        <NewLeadDialog
          t={t}
          catalogs={data.catalogs}
          canAssign={canAssign}
          onClose={() => setShowNew(false)}
          onCreated={({ reusedContact }) => {
            setShowNew(false);
            if (reusedContact) setNotice(t("new.reused"));
            void load({ sweep: false });
          }}
        />
      ) : null}

      {pendingLost ? (
        <Dialog
          title={t("lost.title")}
          closeLabel={t("actions.close")}
          onClose={() => setPendingLost(null)}
          footer={
            <>
              <button type="button" className="lead-btn" onClick={() => setPendingLost(null)}>
                {t("actions.cancel")}
              </button>
              <button
                type="button"
                className="lead-btn lead-btn--danger"
                disabled={!lostReason}
                onClick={() => {
                  if (!lostReason) return;
                  const target = pendingLost;
                  setPendingLost(null);
                  void move(target.leadId, "PERDIDO", lostReason);
                }}
              >
                {t("lost.confirm")}
              </button>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>{t("lost.help")}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {REALTY_LOST_REASONS.map((r) => (
              <label
                key={r}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "9px 11px",
                  border: `1px solid ${lostReason === r ? "var(--border-brand)" : "var(--border-soft)"}`,
                  background: lostReason === r ? "var(--brand-soft)" : "transparent",
                  borderRadius: 10,
                  fontSize: 13,
                  color: "var(--text-1)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="lost-reason"
                  value={r}
                  checked={lostReason === r}
                  onChange={() => setLostReason(r)}
                />
                {t(`lostReasons.${r}`)}
              </label>
            ))}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
