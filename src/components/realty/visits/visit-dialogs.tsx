"use client";

// ═══════════════════════════════════════════════════════════════════════
// Los diálogos de la agenda: agendar, ver la visita y capturar lo que dijo
// el prospecto.
//
// La retroalimentación (⭐ punto C del encargo) es DOS TOQUES y nada más:
// una tarjeta de resultado y, si quiere, una nota. Todo lo que se le pida de
// más a un asesor que acaba de bajarse del coche NO se captura, y sin captura
// el reporte al propietario de O2-T5 se queda sin materia prima.
//
// FECHAS: el par (día, hora) que teclea la persona se convierte a UTC con
// realtyLocalToUtc Y LA ZONA DE LA CUENTA. Nunca con `new Date(y, m, d)`, que
// usaría la zona del navegador: alguien en Cancún agendando para la oficina
// de Guadalajara habría creado la visita una hora corrida.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Phone, Search } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import css from "./visits.module.css";
import { Dialog, Field, Pill } from "./visits-ui";
import {
  REALTY_VISIT_OUTCOMES,
  buildMapsPlaceUrl,
  canVisitTransition,
  isValidDateISO,
  labelToMinute,
  minuteToLabel,
  realtyDateISO,
  realtyLocalToUtc,
  realtyMinuteOfDay,
  visitMapQuery,
  type RealtyVisitAgentDTO,
  type RealtyVisitCardDTO,
  type RealtyVisitOutcome,
  type RealtyVisitStatusKey,
} from "./visit-core";

// ── Selector con buscador ───────────────────────────────────────────────

interface PickerItem {
  id: string;
  label: string;
  meta?: string | null;
}

/**
 * Lista con buscador. No es un `<select>` porque la cartera de una agencia
 * son cientos de inmuebles y un desplegable nativo con 400 opciones no se
 * usa: se busca por colonia y se elige.
 */
function Picker({
  items,
  value,
  onPick,
  placeholder,
  search,
  onSearch,
  emptyLabel,
  noneLabel,
}: {
  items: PickerItem[];
  value: string | null;
  onPick: (id: string | null) => void;
  placeholder: string;
  search: string;
  onSearch: (value: string) => void;
  emptyLabel: string;
  /** Si viene, se pinta arriba una opción "sin nada" (prospecto opcional). */
  noneLabel?: string;
}) {
  return (
    <>
      <div style={{ position: "relative" }}>
        <Search
          size={13}
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 9,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--text-4)",
            pointerEvents: "none",
          }}
        />
        <input
          className={css.input}
          style={{ paddingLeft: 26 }}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={placeholder}
        />
      </div>
      <div className={css.results}>
        {noneLabel ? (
          <button
            type="button"
            className={value === null ? `${css.result} ${css.resultActive}` : css.result}
            onClick={() => onPick(null)}
          >
            {noneLabel}
          </button>
        ) : null}
        {items.length === 0 && !noneLabel ? (
          <span className={css.result} style={{ color: "var(--text-4)", cursor: "default" }}>
            {emptyLabel}
          </span>
        ) : null}
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={value === item.id ? `${css.result} ${css.resultActive}` : css.result}
            onClick={() => onPick(item.id)}
          >
            {item.label}
            {item.meta ? (
              <span style={{ color: "var(--text-4)", marginLeft: 6 }}>· {item.meta}</span>
            ) : null}
          </button>
        ))}
      </div>
    </>
  );
}

// ── Agendar ─────────────────────────────────────────────────────────────

interface TargetsPayload {
  properties: { id: string; title: string; colonia: string | null }[];
  leads: { id: string; name: string; phone: string | null }[];
}

export function NewVisitDialog({
  t,
  timeZone,
  agents,
  canAssign,
  defaultDateISO,
  defaultMinute,
  defaultAgentId,
  onClose,
  onCreated,
}: {
  t: TFunction;
  timeZone: string;
  agents: RealtyVisitAgentDTO[];
  /** Un AGENT solo se agenda a sí mismo: el servidor lo fuerza y aquí se esconde. */
  canAssign: boolean;
  defaultDateISO: string;
  defaultMinute: number;
  defaultAgentId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [targets, setTargets] = useState<TargetsPayload>({ properties: [], leads: [] });
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string>(defaultAgentId ?? "");
  const [dateISO, setDateISO] = useState(defaultDateISO);
  const [time, setTime] = useState(minuteToLabel(defaultMinute));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => {
    let alive = true;
    const sp = new URLSearchParams();
    if (debounced) sp.set("search", debounced);
    fetch(`/api/realty/visits/targets?${sp.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: TargetsPayload | null) => {
        if (alive && json) setTargets(json);
      })
      .catch(() => {
        /* el diálogo sigue usable: se reintenta al teclear */
      });
    return () => {
      alive = false;
    };
  }, [debounced]);

  async function submit() {
    if (!propertyId) {
      setError(t("new.needProperty"));
      return;
    }
    const minute = labelToMinute(time);
    if (minute === null || !isValidDateISO(dateISO)) {
      setError(t("new.needTime"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/realty/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          leadId,
          userId: canAssign ? agentId || null : null,
          scheduledAt: realtyLocalToUtc(dateISO, minute, timeZone).toISOString(),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError((json && json.error) || t("new.failed"));
        return;
      }
      onCreated();
    } catch {
      setError(t("new.failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={t("new.title")}
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
            {saving ? t("new.saving") : t("new.confirm")}
          </button>
        </>
      }
    >
      <Field label={t("new.property")} error={error && !propertyId ? error : null}>
        <Picker
          items={targets.properties.map((p) => ({ id: p.id, label: p.title, meta: p.colonia }))}
          value={propertyId}
          onPick={setPropertyId}
          placeholder={t("new.propertyPlaceholder")}
          search={search}
          onSearch={setSearch}
          emptyLabel={t("grid.empty")}
        />
      </Field>

      <Field label={t("new.lead")}>
        <Picker
          items={targets.leads.map((l) => ({ id: l.id, label: l.name, meta: l.phone }))}
          value={leadId}
          onPick={setLeadId}
          placeholder={t("new.leadPlaceholder")}
          search={search}
          onSearch={setSearch}
          emptyLabel={t("grid.empty")}
          noneLabel={t("new.leadNone")}
        />
      </Field>

      {canAssign ? (
        <Field label={t("new.agent")}>
          <select
            className={css.select}
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            <option value="">{t("new.agentDefault")}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <div className={css.fieldRow}>
        <Field label={t("new.date")}>
          <input
            className={css.input}
            type="date"
            value={dateISO}
            onChange={(e) => setDateISO(e.target.value)}
          />
        </Field>
        <Field label={t("new.time")} error={error && propertyId ? error : null}>
          <input
            className={css.input}
            type="time"
            step={900}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}

// ── Retroalimentación ⭐ ────────────────────────────────────────────────

/**
 * Los dos toques. Se abre al marcar REALIZADA y se puede saltar: forzar la
 * captura haría que la gente marque cualquier cosa con tal de cerrar el
 * diálogo, y un dato inventado envenena el reporte al propietario.
 */
export function FeedbackDialog({
  t,
  visit,
  onClose,
  onSave,
}: {
  t: TFunction;
  visit: RealtyVisitCardDTO;
  onClose: () => void;
  onSave: (feedback: { outcome: RealtyVisitOutcome | null; note: string | null }) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState<RealtyVisitOutcome | null>(visit.outcome);
  const [note, setNote] = useState(visit.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(withOutcome: RealtyVisitOutcome | null) {
    setSaving(true);
    setError(null);
    try {
      await onSave({ outcome: withOutcome, note: note.trim() || null });
    } catch {
      setError(t("feedback.failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={t("feedback.title")}
      closeLabel={t("detail.close")}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className={css.btn}
            onClick={() => run(null)}
            disabled={saving}
          >
            {t("feedback.skip")}
          </button>
          <button
            type="button"
            className={`${css.btn} ${css.btnPrimary}`}
            disabled={saving}
            onClick={() => {
              if (!outcome) {
                setError(t("feedback.needOutcome"));
                return;
              }
              void run(outcome);
            }}
          >
            {saving ? t("feedback.saving") : t("feedback.save")}
          </button>
        </>
      }
    >
      <p className={css.panelIntro}>{t("feedback.intro")}</p>

      <Field label={t("outcome.label")} error={error}>
        <div className={css.optionGrid}>
          {REALTY_VISIT_OUTCOMES.map((key) => (
            <button
              key={key}
              type="button"
              className={outcome === key ? `${css.option} ${css.optionActive}` : css.option}
              aria-pressed={outcome === key}
              onClick={() => {
                setOutcome(key);
                setError(null);
              }}
            >
              {t(`outcome.${key}`)}
            </button>
          ))}
        </div>
      </Field>

      <Field label={t("feedback.noteLabel")}>
        <textarea
          className={css.textarea}
          value={note}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("feedback.notePlaceholder")}
        />
      </Field>
    </Dialog>
  );
}

// ── Detalle de la visita ────────────────────────────────────────────────

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={css.row} style={{ alignItems: "flex-start" }}>
      <div className={css.rowMain}>
        <span className={css.rowMeta}>{label}</span>
        <span className={css.rowTitle} style={{ whiteSpace: "normal" }}>
          {children}
        </span>
      </div>
    </div>
  );
}

export function VisitDetailDialog({
  t,
  visit,
  timeZone,
  locale,
  onClose,
  onStatus,
  onAskFeedback,
}: {
  t: TFunction;
  visit: RealtyVisitCardDTO;
  timeZone: string;
  locale: string;
  onClose: () => void;
  onStatus: (status: RealtyVisitStatusKey) => Promise<void>;
  onAskFeedback: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const when = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
        timeZone: timeZone || "America/Mexico_City",
        dateStyle: "full",
        timeStyle: "short",
      }).format(new Date(visit.scheduledAt)),
    [visit.scheduledAt, timeZone, locale],
  );

  const mapUrl = buildMapsPlaceUrl(visitMapQuery(visit));

  async function go(status: RealtyVisitStatusKey) {
    setBusy(true);
    try {
      await onStatus(status);
    } finally {
      setBusy(false);
    }
  }

  const can = (to: RealtyVisitStatusKey) => canVisitTransition(visit.status, to);

  return (
    <Dialog
      title={t("detail.title")}
      closeLabel={t("detail.close")}
      onClose={onClose}
      footer={
        <>
          {can("PROGRAMADA") && visit.status !== "PROGRAMADA" ? (
            <button type="button" className={css.btn} disabled={busy} onClick={() => void go("PROGRAMADA")}>
              {t("detail.reopen")}
            </button>
          ) : null}
          {can("CANCELADA") ? (
            <button
              type="button"
              className={`${css.btn} ${css.btnDanger}`}
              disabled={busy}
              onClick={() => void go("CANCELADA")}
            >
              {t("detail.cancel")}
            </button>
          ) : null}
          {can("NO_ASISTIO") ? (
            <button type="button" className={css.btn} disabled={busy} onClick={() => void go("NO_ASISTIO")}>
              {t("detail.markNoShow")}
            </button>
          ) : null}
          {can("CONFIRMADA") ? (
            <button type="button" className={css.btn} disabled={busy} onClick={() => void go("CONFIRMADA")}>
              {t("detail.markConfirmed")}
            </button>
          ) : null}
          {can("REALIZADA") ? (
            <button
              type="button"
              className={`${css.btn} ${css.btnPrimary}`}
              disabled={busy}
              onClick={onAskFeedback}
            >
              {t("detail.markDone")}
            </button>
          ) : null}
        </>
      }
    >
      <div className={css.toolbar}>
        <Pill tone={visit.status === "CANCELADA" || visit.status === "NO_ASISTIO" ? "danger" : "brand"}>
          {t(`status.${visit.status}`)}
        </Pill>
        {mapUrl ? (
          <a
            className={`${css.btn} ${css.btnSm}`}
            href={mapUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={13} aria-hidden="true" />
            {t("card.openMap")}
          </a>
        ) : null}
        {visit.leadPhone ? (
          <a className={`${css.btn} ${css.btnSm}`} href={`tel:${visit.leadPhone}`}>
            <Phone size={13} aria-hidden="true" />
            {visit.leadPhone}
          </a>
        ) : null}
      </div>

      <div className={css.rows}>
        <Line label={t("detail.property")}>{visit.propertyTitle}</Line>
        <Line label={t("detail.when")}>{when}</Line>
        <Line label={t("detail.lead")}>{visit.leadName ?? t("card.noLead")}</Line>
        <Line label={t("detail.agent")}>{visit.userName ?? t("grid.unassigned")}</Line>
      </div>

      <div>
        <h3 className={css.panelTitle} style={{ fontSize: 13, marginBottom: 6 }}>
          {t("detail.feedbackTitle")}
        </h3>
        {visit.outcome || visit.note ? (
          <div className={css.rows}>
            {visit.outcome ? (
              <div>
                <Pill tone={visit.outcome === "LE_GUSTO" ? "brand" : "warn"}>
                  {t(`outcome.${visit.outcome}`)}
                </Pill>
              </div>
            ) : null}
            {visit.note ? (
              <p className={css.panelIntro} style={{ whiteSpace: "pre-wrap" }}>
                {visit.note}
              </p>
            ) : null}
          </div>
        ) : (
          <p className={css.panelIntro}>{t("detail.noFeedback")}</p>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Día y minuto por defecto de "Agendar visita": el día que se está viendo y
 * la próxima hora en punto si es hoy. Vive aquí porque lo usa el botón de la
 * barra y también el atajo de la tarjeta vacía.
 */
export function defaultSlot(
  viewISO: string,
  timeZone: string,
  now: number,
): { dateISO: string; minute: number } {
  const todayISO = realtyDateISO(new Date(now), timeZone);
  if (viewISO !== todayISO) return { dateISO: viewISO, minute: 10 * 60 };
  const minute = realtyMinuteOfDay(new Date(now), timeZone);
  return { dateISO: viewISO, minute: Math.min(23 * 60, Math.ceil((minute + 30) / 60) * 60) };
}
