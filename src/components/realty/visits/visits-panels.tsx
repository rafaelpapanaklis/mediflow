"use client";

// ═══════════════════════════════════════════════════════════════════════
// Las tres pestañas que no son el calendario:
//
//   · RUTA DEL DÍA  — las visitas de HOY ordenadas por cercanía, con la liga
//     a Google Maps. Nada sofisticado a propósito: ordenar y abrir el mapa
//     resuelve el 90% del problema y no depende de una API de pago.
//
//   · LLAVES ⭐     — quién trae la llave de qué y desde cuándo. Es el
//     tablero que hoy vive en un grupo de WhatsApp y se pierde.
//
//   · RECORDATORIOS — qué avisos tocan y por dónde salen. El envío NO se
//     reimplementa aquí: el POST del servidor delega en T6.
//
// Las tres cargan SOLAS al abrirse, no con la pantalla: quien entra a ver el
// calendario no tiene por qué pagar tres consultas que no va a mirar.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CircleAlert, ExternalLink, KeyRound, MapPin, Plus, RefreshCw, Route, Send } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import css from "./visits.module.css";
import { Banner, Dialog, Empty, Field, Pill, type ToastState } from "./visits-ui";
import {
  buildMapsPlaceUrl,
  buildMapsRouteUrl,
  orderVisitsByProximity,
  realtyDateISO,
  type RealtyKeyCardDTO,
  type RealtyVisitAgentDTO,
  type RealtyVisitCardDTO,
} from "./visit-core";

export interface RouteOrigin {
  name: string;
  query: string;
  lat: number | null;
  lng: number | null;
}

// ── Ruta del día ────────────────────────────────────────────────────────

export function RoutePanel({
  t,
  timeZone,
  locale,
  origin,
  agents,
  meId,
  onOpenVisit,
}: {
  t: TFunction;
  timeZone: string;
  locale: string;
  origin: RouteOrigin | null;
  agents: RealtyVisitAgentDTO[];
  meId: string;
  onOpenVisit: (visit: RealtyVisitCardDTO) => void;
}) {
  const [visits, setVisits] = useState<RealtyVisitCardDTO[] | null>(null);
  const [error, setError] = useState(false);
  // 🔴 Una ruta es de UNA persona. Sin este filtro, a un gerente se le pintaba
  // una ruta que mezclaba las paradas de cinco asesores y no la podía manejar
  // nadie. Arranca en uno mismo; el selector deja mirar la de otro.
  const [who, setWho] = useState<string>(meId);

  const load = useCallback(async () => {
    setError(false);
    try {
      const todayISO = realtyDateISO(new Date(), timeZone);
      const sp = new URLSearchParams();
      sp.set("date", todayISO);
      sp.set("days", "1");
      if (who) sp.set("userId", who);
      const res = await fetch(`/api/realty/visits?${sp.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        setError(true);
        return;
      }
      const json = (await res.json()) as { visits: RealtyVisitCardDTO[] };
      setVisits(json.visits);
    } catch {
      setError(true);
    }
  }, [timeZone, who]);

  useEffect(() => {
    void load();
  }, [load]);

  const hora = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
        timeZone: timeZone || "America/Mexico_City",
        timeStyle: "short",
      }),
    [timeZone, locale],
  );

  // Una visita cancelada o a la que no llegó nadie NO es una parada. Las
  // realizadas tampoco: la ruta es lo que FALTA por hacer hoy.
  const pending = useMemo(
    () =>
      (visits ?? []).filter(
        (v) => v.status === "PROGRAMADA" || v.status === "CONFIRMADA",
      ),
    [visits],
  );

  const originPoint = useMemo(
    () =>
      origin && typeof origin.lat === "number" && typeof origin.lng === "number"
        ? { lat: origin.lat, lng: origin.lng }
        : null,
    [origin],
  );

  const stops = useMemo(
    () => orderVisitsByProximity(pending, originPoint),
    [pending, originPoint],
  );

  const link = useMemo(
    () => buildMapsRouteUrl(stops, origin ? { query: origin.query } : null),
    [stops, origin],
  );

  // ¿El orden por cercanía contradice el de las citas? Se DICE, no se
  // esconde: la agenda manda y una ruta bonita que llega tarde no sirve.
  const differs = useMemo(() => {
    const byTime = pending
      .slice()
      .sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : a.scheduledAt > b.scheduledAt ? 1 : 0))
      .map((v) => v.id);
    const byNear = stops.map((s) => s.visitId);
    if (byTime.length !== byNear.length) return false;
    for (let i = 0; i < byTime.length; i++) if (byTime[i] !== byNear[i]) return true;
    return false;
  }, [pending, stops]);

  const visitById = useMemo(() => {
    const map = new Map<string, RealtyVisitCardDTO>();
    for (let i = 0; i < pending.length; i++) map.set(pending[i].id, pending[i]);
    return map;
  }, [pending]);

  return (
    <div className={css.panel}>
      <h2 className={css.panelTitle}>
        <Route size={16} aria-hidden="true" />
        {t("route.title")}
      </h2>
      <p className={css.panelIntro}>{t("route.intro")}</p>

      <Banner tone="info">
        <MapPin size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{origin ? t("route.from", { name: origin.name }) : t("route.fromNone")}</span>
      </Banner>

      {differs ? (
        <Banner tone="warn">
          <CircleAlert size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{t("route.differs")}</span>
        </Banner>
      ) : null}

      {link && link.dropped > 0 ? (
        <Banner tone="warn">
          <CircleAlert size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{t("route.dropped", { included: link.included, dropped: link.dropped })}</span>
        </Banner>
      ) : null}

      <div className={css.toolbar}>
        {agents.length > 1 ? (
          <select
            className={css.select}
            style={{ width: "auto", minWidth: 150 }}
            aria-label={t("toolbar.agent")}
            value={who}
            onChange={(e) => setWho(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            <option value="">{t("toolbar.allAgents")}</option>
          </select>
        ) : null}
        {link ? (
          <a
            className={`${css.btn} ${css.btnPrimary}`}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={14} aria-hidden="true" />
            {t("route.open")}
          </a>
        ) : null}
        <button type="button" className={css.btn} onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden="true" />
          {t("toolbar.refresh")}
        </button>
      </div>

      {error ? <Empty>{t("error")}</Empty> : null}
      {!error && visits === null ? <Empty>{t("loading")}</Empty> : null}
      {!error && visits !== null && stops.length === 0 ? <Empty>{t("route.empty")}</Empty> : null}

      {stops.length > 0 ? (
        <div className={css.rows}>
          {stops.map((stop, i) => {
            const visit = visitById.get(stop.visitId);
            const place = buildMapsPlaceUrl(stop.query || null);
            const flat = stop.lat === null || stop.lng === null;
            return (
              <div key={stop.visitId} className={flat ? `${css.stop} ${css.stopFlat}` : css.stop}>
                <span className={css.stopIndex}>{i + 1}</span>
                <div className={css.rowMain}>
                  <span className={css.rowTitle}>{stop.title}</span>
                  <span className={css.rowMeta}>
                    {hora.format(new Date(stop.scheduledAt))}
                    {visit && visit.leadName ? ` · ${t("card.with", { name: visit.leadName })}` : ""}
                  </span>
                  {stop.legKm !== null ? (
                    <span className={css.rowMeta}>
                      {t("route.leg", { km: stop.legKm.toFixed(1) })}
                    </span>
                  ) : null}
                  {flat ? <span className={css.rowMeta}>{t("route.noAddress")}</span> : null}
                </div>
                <div className={css.rowActions}>
                  {visit ? (
                    <button
                      type="button"
                      className={`${css.btn} ${css.btnSm}`}
                      onClick={() => onOpenVisit(visit)}
                    >
                      {t("grid.moreLabel")}
                    </button>
                  ) : null}
                  {place ? (
                    <a
                      className={`${css.btn} ${css.btnSm}`}
                      href={place}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink size={12} aria-hidden="true" />
                      {t("route.openOne")}
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ── Llaves ⭐ ───────────────────────────────────────────────────────────

interface KeysPayload {
  out: RealtyKeyCardDTO[];
  recentlyReturned: RealtyKeyCardDTO[];
  overdueCount: number;
  overdueDays: number;
  properties: { id: string; title: string; colonia: string | null; keysOut: number }[];
  agents: RealtyVisitAgentDTO[];
}

export function KeysPanel({
  t,
  timeZone,
  locale,
  onToast,
  onCountChange,
}: {
  t: TFunction;
  timeZone: string;
  locale: string;
  onToast: (state: ToastState) => void;
  /** El badge de la pestaña vive en la pantalla; aquí se le avisa del cambio. */
  onCountChange: (overdue: number) => void;
}) {
  const [data, setData] = useState<KeysPayload | null>(null);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showHand, setShowHand] = useState(false);
  const [editing, setEditing] = useState<RealtyKeyCardDTO | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/realty/keys", { cache: "no-store" });
      if (!res.ok) {
        setError(true);
        return;
      }
      const json = (await res.json()) as KeysPayload;
      setData(json);
      onCountChange(json.overdueCount);
    } catch {
      setError(true);
    }
  }, [onCountChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const fecha = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
        timeZone: timeZone || "America/Mexico_City",
        dateStyle: "medium",
      }),
    [timeZone, locale],
  );

  async function giveBack(key: RealtyKeyCardDTO) {
    setBusyId(key.id);
    try {
      const res = await fetch(`/api/realty/keys/${key.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returned: true }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        onToast({ message: (json && json.error) || t("error"), tone: "bad" });
        return;
      }
      onToast({ message: t("keys.returned"), tone: "ok" });
      await load();
    } catch {
      onToast({ message: t("error"), tone: "bad" });
    } finally {
      setBusyId(null);
    }
  }

  function daysLabel(key: RealtyKeyCardDTO): string {
    if (key.daysOut <= 0) return t("keys.today");
    if (key.daysOut === 1) return t("keys.dayOut");
    return t("keys.daysOut", { days: key.daysOut });
  }

  function holderLabel(key: RealtyKeyCardDTO): string {
    if (key.holderName) return `${t("keys.holder")}: ${key.holderName}`;
    if (key.holderNote) return `${t("keys.holderNote")}: ${key.holderNote}`;
    return t("grid.unassigned");
  }

  return (
    <div className={css.panel}>
      <h2 className={css.panelTitle}>
        <KeyRound size={16} aria-hidden="true" />
        {t("keys.title")}
        {data && data.out.length > 0 ? <Pill tone="neutral">{data.out.length}</Pill> : null}
      </h2>
      <p className={css.panelIntro}>{t("keys.intro")}</p>

      {data && data.overdueCount > 0 ? (
        <Banner tone="warn">
          <CircleAlert size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {data.overdueCount === 1
              ? t("keys.alertOne", { days: data.overdueDays })
              : t("keys.alert", { count: data.overdueCount, days: data.overdueDays })}
          </span>
        </Banner>
      ) : null}

      <div className={css.toolbar}>
        <button
          type="button"
          className={`${css.btn} ${css.btnPrimary}`}
          onClick={() => setShowHand(true)}
        >
          <Plus size={14} aria-hidden="true" />
          {t("keys.handOver")}
        </button>
        <button type="button" className={css.btn} onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden="true" />
          {t("toolbar.refresh")}
        </button>
      </div>

      {error ? <Empty>{t("error")}</Empty> : null}
      {!error && data === null ? <Empty>{t("loading")}</Empty> : null}
      {data && data.out.length === 0 ? <Empty>{t("keys.empty")}</Empty> : null}

      {data && data.out.length > 0 ? (
        <div className={css.rows}>
          {data.out.map((key) => (
            <div key={key.id} className={key.overdue ? `${css.row} ${css.rowOverdue}` : css.row}>
              <div className={css.rowMain}>
                <span className={css.rowTitle}>{key.propertyTitle}</span>
                <span className={css.rowMeta}>{holderLabel(key)}</span>
                <span className={css.rowMeta}>
                  {t("keys.since")}: {fecha.format(new Date(key.takenAt))}
                </span>
              </div>
              <Pill tone={key.overdue ? "danger" : "neutral"}>{daysLabel(key)}</Pill>
              <div className={css.rowActions}>
                <button
                  type="button"
                  className={`${css.btn} ${css.btnSm}`}
                  onClick={() => setEditing(key)}
                >
                  {t("keys.editNote")}
                </button>
                <button
                  type="button"
                  className={`${css.btn} ${css.btnSm} ${css.btnPrimary}`}
                  disabled={busyId === key.id}
                  onClick={() => void giveBack(key)}
                >
                  {busyId === key.id ? t("keys.returning") : t("keys.return")}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {data && data.recentlyReturned.length > 0 ? (
        <>
          <h3 className={css.panelTitle} style={{ fontSize: 13 }}>
            {t("keys.history")}
          </h3>
          <div className={css.rows}>
            {data.recentlyReturned.map((key) => (
              <div key={key.id} className={css.row} style={{ opacity: 0.8 }}>
                <div className={css.rowMain}>
                  <span className={css.rowTitle}>{key.propertyTitle}</span>
                  <span className={css.rowMeta}>
                    {holderLabel(key)} · {daysLabel(key)}
                  </span>
                </div>
                <Pill tone="neutral">
                  {key.returnedAt ? fecha.format(new Date(key.returnedAt)) : t("keys.returned")}
                </Pill>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {showHand && data ? (
        <HandOverDialog
          t={t}
          properties={data.properties}
          agents={data.agents}
          onClose={() => setShowHand(false)}
          onDone={() => {
            setShowHand(false);
            void load();
          }}
        />
      ) : null}

      {editing ? (
        <EditNoteDialog
          t={t}
          keyCard={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void load();
          }}
          onError={(message) => onToast({ message, tone: "bad" })}
        />
      ) : null}
    </div>
  );
}

function HandOverDialog({
  t,
  properties,
  agents,
  onClose,
  onDone,
}: {
  t: TFunction;
  properties: { id: string; title: string; colonia: string | null; keysOut: number }[];
  agents: RealtyVisitAgentDTO[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [search, setSearch] = useState("");
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [mode, setMode] = useState<"team" | "other">("team");
  const [holderUserId, setHolderUserId] = useState(agents.length > 0 ? agents[0].id : "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El buscador filtra EN EL NAVEGADOR sobre la cartera que ya vino: son
  // cien inmuebles como mucho y una petición por tecla no compra nada.
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return properties.slice(0, 60);
    return properties
      .filter(
        (p) =>
          p.title.toLowerCase().indexOf(term) !== -1 ||
          (p.colonia ?? "").toLowerCase().indexOf(term) !== -1,
      )
      .slice(0, 60);
  }, [properties, search]);

  const chosen = useMemo(
    () => properties.find((p) => p.id === propertyId) ?? null,
    [properties, propertyId],
  );

  async function submit() {
    if (!propertyId) {
      setError(t("hand.needProperty"));
      return;
    }
    if (mode === "team" && !holderUserId) {
      setError(t("hand.needWho"));
      return;
    }
    if (mode === "other" && !note.trim()) {
      setError(t("hand.needWho"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/realty/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          holderUserId: mode === "team" ? holderUserId : null,
          holderNote: mode === "other" ? note.trim() : note.trim() || null,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError((json && json.error) || t("hand.failed"));
        return;
      }
      onDone();
    } catch {
      setError(t("hand.failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={t("hand.title")}
      closeLabel={t("detail.close")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={css.btn} onClick={onClose}>
            {t("detail.close")}
          </button>
          <button
            type="button"
            className={`${css.btn} ${css.btnPrimary}`}
            onClick={submit}
            disabled={saving}
          >
            {saving ? t("hand.saving") : t("hand.confirm")}
          </button>
        </>
      }
    >
      <Field label={t("hand.property")} error={error && !propertyId ? error : null}>
        <input
          className={css.input}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("hand.propertyPlaceholder")}
        />
        <div className={css.results}>
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              className={propertyId === p.id ? `${css.result} ${css.resultActive}` : css.result}
              onClick={() => setPropertyId(p.id)}
            >
              {p.title}
              {p.colonia ? (
                <span style={{ color: "var(--text-4)", marginLeft: 6 }}>· {p.colonia}</span>
              ) : null}
            </button>
          ))}
        </div>
      </Field>

      {chosen && chosen.keysOut > 0 ? (
        <Banner tone="warn">
          <CircleAlert size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{t("hand.alreadyOut", { count: chosen.keysOut })}</span>
        </Banner>
      ) : null}

      <Field label={t("hand.who")}>
        <div className={css.segment}>
          <button
            type="button"
            className={mode === "team" ? `${css.segmentBtn} ${css.segmentActive}` : css.segmentBtn}
            onClick={() => setMode("team")}
          >
            {t("hand.team")}
          </button>
          <button
            type="button"
            className={mode === "other" ? `${css.segmentBtn} ${css.segmentActive}` : css.segmentBtn}
            onClick={() => setMode("other")}
          >
            {t("hand.other")}
          </button>
        </div>
      </Field>

      {mode === "team" ? (
        <Field label={t("hand.who")} error={error && propertyId ? error : null}>
          <select
            className={css.select}
            value={holderUserId}
            onChange={(e) => setHolderUserId(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <Field
        label={t("hand.note")}
        error={error && propertyId && mode === "other" ? error : null}
      >
        <input
          className={css.input}
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("hand.notePlaceholder")}
        />
      </Field>
    </Dialog>
  );
}

function EditNoteDialog({
  t,
  keyCard,
  onClose,
  onDone,
  onError,
}: {
  t: TFunction;
  keyCard: RealtyKeyCardDTO;
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [note, setNote] = useState(keyCard.holderNote ?? "");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch(`/api/realty/keys/${keyCard.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holderNote: note.trim() || null }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        onError((json && json.error) || t("error"));
        return;
      }
      onDone();
    } catch {
      onError(t("error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={keyCard.propertyTitle}
      closeLabel={t("detail.close")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={css.btn} onClick={onClose}>
            {t("detail.close")}
          </button>
          <button
            type="button"
            className={`${css.btn} ${css.btnPrimary}`}
            onClick={submit}
            disabled={saving}
          >
            {saving ? t("hand.saving") : t("hand.confirm")}
          </button>
        </>
      }
    >
      <Field label={t("keys.holderNote")}>
        <input
          className={css.input}
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("hand.notePlaceholder")}
        />
      </Field>
    </Dialog>
  );
}

// ── Recordatorios ───────────────────────────────────────────────────────

interface RemindersPayload {
  channel: "WHATSAPP" | "CORREO" | "PANEL";
  pending: {
    visitId: string;
    propertyTitle: string;
    leadName: string | null;
    agentName: string | null;
    scheduledAt: string;
    channel: "WHATSAPP" | "CORREO" | "PANEL";
    sent: boolean;
    blocked: string | null;
  }[];
}

export function RemindersPanel({
  t,
  timeZone,
  locale,
  onToast,
}: {
  t: TFunction;
  timeZone: string;
  locale: string;
  onToast: (state: ToastState) => void;
}) {
  const [data, setData] = useState<RemindersPayload | null>(null);
  const [error, setError] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/realty/visits/reminders", { cache: "no-store" });
      if (!res.ok) {
        setError(true);
        return;
      }
      setData((await res.json()) as RemindersPayload);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cuando = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
        timeZone: timeZone || "America/Mexico_City",
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [timeZone, locale],
  );

  async function send() {
    setSending(true);
    try {
      const res = await fetch("/api/realty/visits/reminders", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) {
        onToast({ message: (json && json.error) || t("error"), tone: "bad" });
        return;
      }
      onToast({
        message: t("reminders.result", {
          sent: json.sent ?? 0,
          failed: json.failed ?? 0,
          skipped: json.skipped ?? 0,
        }),
        note: json.agentsNotified ? t("reminders.agents", { count: json.agentsNotified }) : null,
        tone: json.failed > 0 ? "bad" : "ok",
      });
      await load();
    } catch {
      onToast({ message: t("error"), tone: "bad" });
    } finally {
      setSending(false);
    }
  }

  const faltan = useMemo(
    () => (data ? data.pending.filter((p) => !p.sent && !p.blocked).length : 0),
    [data],
  );

  return (
    <div className={css.panel}>
      <h2 className={css.panelTitle}>
        <Bell size={16} aria-hidden="true" />
        {t("reminders.title")}
      </h2>
      <p className={css.panelIntro}>{t("reminders.intro")}</p>

      <Banner tone={data && data.channel === "CORREO" ? "warn" : "info"}>
        <CircleAlert size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          {data && data.channel === "CORREO"
            ? t("reminders.channelMail")
            : t("reminders.channelWhatsapp")}
        </span>
      </Banner>

      <p className={css.hint}>{t("reminders.agentNote")}</p>

      <div className={css.toolbar}>
        <button
          type="button"
          className={`${css.btn} ${css.btnPrimary}`}
          onClick={() => void send()}
          disabled={sending || faltan === 0}
        >
          <Send size={14} aria-hidden="true" />
          {sending ? t("reminders.sending") : t("reminders.send")}
        </button>
        <button type="button" className={css.btn} onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden="true" />
          {t("toolbar.refresh")}
        </button>
      </div>

      {error ? <Empty>{t("error")}</Empty> : null}
      {!error && data === null ? <Empty>{t("loading")}</Empty> : null}
      {data && data.pending.length === 0 ? <Empty>{t("reminders.empty")}</Empty> : null}

      {data && data.pending.length > 0 ? (
        <div className={css.rows}>
          {data.pending.map((p) => (
            <div key={p.visitId} className={css.row}>
              <div className={css.rowMain}>
                <span className={css.rowTitle}>{p.propertyTitle}</span>
                <span className={css.rowMeta}>
                  {cuando.format(new Date(p.scheduledAt))}
                  {p.leadName ? ` · ${t("card.with", { name: p.leadName })}` : ""}
                </span>
                {p.blocked ? <span className={css.errorText}>{p.blocked}</span> : null}
              </div>
              <Pill tone={p.blocked ? "danger" : p.sent ? "brand" : "warn"}>
                {p.blocked ? t("reminders.blocked") : p.sent ? t("reminders.sent") : t("reminders.waiting")}
              </Pill>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
