"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { type Dictionary, type TVars } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import {
  Banner,
  Btn,
  ErrorText,
  Field,
  Segmented,
  SwitchRow,
  TextArea,
  TextInput,
  apiCall,
  useSaving,
} from "../team/admin-ui";
import {
  BARBER_BOT_ABILITY_KEYS,
  BARBER_BOT_AI_CAP_MAX,
  BARBER_BOT_AI_CAP_MIN,
  type BarberBotAbility,
  type BarberBotPanelState,
  type BarberBotSettings,
} from "@/lib/barber/bot-core";
import s from "./bot.module.css";

/* ═══════════════════════════════════════════════════════════════════════
   /barber/whatsapp/bot — encender el bot y confiar en él.

   La pantalla está ordenada por la pregunta que se hace el dueño, en ese
   orden: ¿está prendido? · ¿cómo habla? · ¿qué puede hacer? · ¿cuándo? ·
   ¿cuánto me cuesta? · ¿qué ha agendado?

   Lo último es lo que gana la confianza: un bot que agenda de verdad se
   demuestra con las citas que trajo, no con una casilla encendida.
   ═══════════════════════════════════════════════════════════════════════ */

const BotDict = createContext<Dictionary | null>(null);

type BotT = (key: string, vars?: TVars) => string;

function useBotT(): BotT {
  const dict = useContext(BotDict);
  return useMemo(() => {
    return makeBarberT(dict ?? {}, "barber.bot");
  }, [dict]);
}

export interface BarberBotScreenProps {
  dict: Dictionary;
  locale: string;
  initial: BarberBotPanelState;
  connected: boolean;
  canEdit: boolean;
  canAttend: boolean;
}

export function BarberBotScreen(props: BarberBotScreenProps) {
  return (
    <BotDict.Provider value={props.dict}>
      <Screen {...props} />
    </BotDict.Provider>
  );
}

function Screen({ locale, initial, connected, canEdit, canAttend }: BarberBotScreenProps) {
  const t = useBotT();
  const [settings, setSettings] = useState<BarberBotSettings>(initial.settings);
  const [pauses, setPauses] = useState(initial.pauses);
  const [savedAt, setSavedAt] = useState(0);
  const { saving, error, setError, run } = useSaving();

  // El bot no puede encenderse si le falta algo del entorno. Se dice con
  // todas sus letras en vez de dejar una casilla que no hace nada.
  const blocked = !initial.storageReady
    ? t("errors.storageMissing")
    : !initial.aiConfigured
      ? t("errors.aiMissing")
      : !connected
        ? t("power.notConnected")
        : null;

  const patch = (next: Partial<BarberBotSettings>) => {
    setSettings((prev) => ({ ...prev, ...next }));
    setSavedAt(0);
  };

  const save = (override?: Partial<BarberBotSettings>) => {
    const payload = { ...settings, ...(override ?? {}) };
    setError(null);
    void run(async () => {
      const res = await apiCall<{ settings: BarberBotSettings }>("/api/barber/bot", {
        method: "PATCH",
        json: payload,
      });
      // Se pinta lo que devolvió el SERVIDOR, no lo que se mandó: si
      // normalizeBotSettings recortó algo, el dueño lo ve tal cual quedó.
      setSettings(res.settings);
      setSavedAt(Date.now());
    });
  };

  const resume = (phone: string) => {
    void run(async () => {
      const res = await apiCall<{ pauses: typeof pauses }>("/api/barber/bot/pause", {
        method: "POST",
        json: { phone, action: "resume" },
      });
      setPauses(res.pauses);
    });
  };

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div>
          <h1 className={s.title}>{t("title")}</h1>
          <p className={s.subtitle}>{t("subtitle")}</p>
        </div>
        {canEdit ? (
          <Btn onClick={() => save()} disabled={saving}>
            {saving ? t("actions.saving") : savedAt ? t("actions.saved") : t("actions.save")}
          </Btn>
        ) : null}
      </header>

      {blocked ? <Banner>{blocked}</Banner> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}

      <div className={s.grid}>
        {/* ── ¿Está prendido? ───────────────────────────────────────── */}
        <section className={s.card}>
          <h2 className={s.cardTitle}>{t("power.title")}</h2>
          <SwitchRow
            title={settings.enabled ? t("power.on") : t("power.off")}
            hint={settings.enabled ? t("power.hintOn") : t("power.hintOff")}
            checked={settings.enabled}
            disabled={!canEdit || saving || (!settings.enabled && blocked !== null)}
            onChange={(next) => {
              // Encender y apagar se guarda AL MOMENTO: es el interruptor
              // que alguien va a buscar con prisa cuando algo salga mal.
              patch({ enabled: next });
              save({ enabled: next });
            }}
          />
        </section>

        {/* ── ¿Cuánto me cuesta? ────────────────────────────────────── */}
        <section className={s.card}>
          <h2 className={s.cardTitle}>{t("spend.title")}</h2>
          <p className={s.hint}>{t("spend.hint")}</p>
          <Field label={t("spend.capLabel")} hint={t("spend.model", { model: initial.aiModel })}>
            {(id) => (
              <div className={s.capRow}>
                <span className={s.currency}>$</span>
                <TextInput
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={BARBER_BOT_AI_CAP_MIN}
                  max={BARBER_BOT_AI_CAP_MAX}
                  value={String(settings.aiDailyCapMxn)}
                  disabled={!canEdit || saving}
                  onChange={(e) => patch({ aiDailyCapMxn: Number(e.target.value) })}
                />
              </div>
            )}
          </Field>
          <Meter
            label={t("spend.today", {
              spent: `$${initial.spend.spentMxn.toFixed(2)}`,
              cap: `$${initial.spend.capMxn}`,
            })}
            ratio={initial.spend.capMxn > 0 ? initial.spend.spentMxn / initial.spend.capMxn : 1}
          />
          {initial.spend.capReached ? (
            <Banner tone="danger">{t("spend.reached")}</Banner>
          ) : null}
        </section>

        {/* ── Cupo del plan ─────────────────────────────────────────── */}
        <section className={s.card}>
          <h2 className={s.cardTitle}>{t("quota.title")}</h2>
          {initial.quota.limit < 0 ? (
            <p className={s.hint}>{t("quota.unlimited")}</p>
          ) : (
            <>
              <Meter
                label={t("quota.used", {
                  used: String(initial.quota.used),
                  limit: String(initial.quota.limit),
                })}
                ratio={initial.quota.limit > 0 ? initial.quota.used / initial.quota.limit : 1}
              />
              {initial.quota.used >= initial.quota.limit ? (
                <Banner tone="danger">{t("quota.exhausted")}</Banner>
              ) : initial.quota.tight ? (
                <Banner>{t("quota.tight")}</Banner>
              ) : null}
            </>
          )}
        </section>

        {/* ── ¿Cómo habla? ──────────────────────────────────────────── */}
        <section className={s.card}>
          <h2 className={s.cardTitle}>{t("tone.title")}</h2>
          <Segmented
            value={settings.tone}
            onChange={(tone) => patch({ tone })}
            options={[
              { value: "relajado", label: t("tone.relajado") },
              { value: "formal", label: t("tone.formal") },
            ]}
          />
          <p className={s.hint}>
            {settings.tone === "relajado" ? t("tone.relajadoHint") : t("tone.formalHint")}
          </p>
          <Field label={t("tone.nameLabel")} hint={t("tone.nameHint")}>
            {(id) => (
              <TextInput
                id={id}
                value={settings.botName}
                placeholder={t("tone.namePlaceholder")}
                maxLength={40}
                disabled={!canEdit || saving}
                onChange={(e) => patch({ botName: e.target.value })}
              />
            )}
          </Field>
          <Field label={t("tone.notesLabel")} hint={t("tone.notesHint")}>
            {(id) => (
              <TextArea
                id={id}
                rows={4}
                value={settings.notes}
                placeholder={t("tone.notesPlaceholder")}
                maxLength={1200}
                disabled={!canEdit || saving}
                onChange={(e) => patch({ notes: e.target.value })}
              />
            )}
          </Field>
        </section>

        {/* ── ¿Qué puede hacer? ─────────────────────────────────────── */}
        <section className={s.card}>
          <h2 className={s.cardTitle}>{t("abilities.title")}</h2>
          <p className={s.hint}>{t("abilities.hint")}</p>
          {BARBER_BOT_ABILITY_KEYS.map((key) => (
            <SwitchRow
              key={key}
              title={t(`abilities.${key}`)}
              hint={
                key === "reagendar" && !settings.abilities.agendar
                  ? t("abilities.reagendarLocked")
                  : undefined
              }
              checked={settings.abilities[key]}
              disabled={
                !canEdit || saving || (key === "reagendar" && !settings.abilities.agendar)
              }
              onChange={(next) => patch({ abilities: nextAbilities(settings, key, next) })}
            />
          ))}
        </section>

        {/* ── ¿Cuándo contesta? ─────────────────────────────────────── */}
        <section className={s.card}>
          <h2 className={s.cardTitle}>{t("hours.title")}</h2>
          <Segmented
            value={settings.hours.mode}
            onChange={(mode) => patch({ hours: { ...settings.hours, mode } })}
            options={[
              { value: "always", label: t("hours.always") },
              { value: "custom", label: t("hours.custom") },
            ]}
          />
          {settings.hours.mode === "always" ? (
            <p className={s.hint}>{t("hours.alwaysHint")}</p>
          ) : (
            <>
              <div className={s.hoursRow}>
                <Field label={t("hours.from")}>
                  {(id) => (
                    <TextInput
                      id={id}
                      type="time"
                      value={toHHMM(settings.hours.startMinute)}
                      disabled={!canEdit || saving}
                      onChange={(e) =>
                        patch({
                          hours: { ...settings.hours, startMinute: fromHHMM(e.target.value) },
                        })
                      }
                    />
                  )}
                </Field>
                <Field label={t("hours.to")}>
                  {(id) => (
                    <TextInput
                      id={id}
                      type="time"
                      value={toHHMM(settings.hours.endMinute)}
                      disabled={!canEdit || saving}
                      onChange={(e) =>
                        patch({
                          hours: { ...settings.hours, endMinute: fromHHMM(e.target.value) },
                        })
                      }
                    />
                  )}
                </Field>
              </div>
              <div className={s.days} role="group" aria-label={t("hours.days")}>
                {[0, 1, 2, 3, 4, 5, 6].map((d) => {
                  const on = settings.hours.days.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      className={s.day}
                      aria-pressed={on}
                      disabled={!canEdit || saving}
                      onClick={() =>
                        patch({
                          hours: {
                            ...settings.hours,
                            days: on
                              ? settings.hours.days.filter((x) => x !== d)
                              : [...settings.hours.days, d].sort((a, b) => a - b),
                          },
                        })
                      }
                    >
                      {t(`weekdays.${d}`)}
                    </button>
                  );
                })}
              </div>
              {settings.hours.days.length === 0 ? (
                <Banner tone="danger">{t("hours.noDays")}</Banner>
              ) : (
                <p className={s.hint}>{t("hours.offHint")}</p>
              )}
            </>
          )}
        </section>

        {/* ── Chats que atiende una persona ─────────────────────────── */}
        <section className={s.card}>
          <h2 className={s.cardTitle}>{t("pauses.title")}</h2>
          <p className={s.hint}>{t("pauses.hint")}</p>
          {pauses.length === 0 ? (
            <p className={s.empty}>{t("pauses.empty")}</p>
          ) : (
            <ul className={s.list}>
              {pauses.map((p) => (
                <li key={p.phone} className={s.row}>
                  <div className={s.rowMain}>
                    <span className={s.rowTitle}>{prettyPhone(p.phone)}</span>
                    <span className={s.rowSub}>
                      {p.reason ? `${p.reason} · ` : ""}
                      {t("pauses.pausedAt", { when: shortWhen(p.pausedAt, locale) })}
                    </span>
                  </div>
                  {canAttend ? (
                    <Btn size="sm" variant="ghost" disabled={saving} onClick={() => resume(p.phone)}>
                      {t("pauses.resume")}
                    </Btn>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Lo que ha agendado ────────────────────────────────────── */}
        <section className={`${s.card} ${s.wide}`}>
          <h2 className={s.cardTitle}>{t("history.title")}</h2>
          <p className={s.hint}>{t("history.hint")}</p>
          {initial.bookings.length === 0 ? (
            <p className={s.empty}>{t("history.empty")}</p>
          ) : (
            <ul className={s.list}>
              {initial.bookings.map((b) => (
                <li key={b.id} className={s.row}>
                  <div className={s.rowMain}>
                    <span className={s.rowTitle}>
                      {b.clientName || prettyPhone(b.clientPhone ?? "")}
                      <span className={s.ref}>#{b.reference}</span>
                    </span>
                    <span className={s.rowSub}>
                      {t("history.when", { when: shortWhen(b.startAt, locale) })}
                      {b.barberName ? ` · ${b.barberName}` : ""}
                      {b.services.length > 0 ? ` · ${b.services.join(", ")}` : ""}
                    </span>
                  </div>
                  <div className={s.rowEnd}>
                    <span className={s.total}>${Math.round(b.total)}</span>
                    <span className={`${s.status} ${s[`st_${b.status}`] ?? ""}`}>
                      {t(`history.status.${b.status}`)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/* ── Piezas chicas ─────────────────────────────────────────────────── */

function Meter({ label, ratio }: { label: string; ratio: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((Number.isFinite(ratio) ? ratio : 0) * 100)));
  return (
    <div className={s.meterWrap}>
      <div className={s.meterLabel}>{label}</div>
      <div
        className={s.meter}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={s.meterFill}
          data-tight={pct >= 85 ? "true" : "false"}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Apagar "agendar" apaga también "reagendar": mover una cita es elegir un
 * hueco nuevo. Misma regla que normalizeBotSettings en el servidor — se
 * repite aquí para que la pantalla no enseñe un estado que el servidor va a
 * corregir en cuanto guarde.
 */
function nextAbilities(
  settings: BarberBotSettings,
  key: BarberBotAbility,
  value: boolean,
): BarberBotSettings["abilities"] {
  const next = { ...settings.abilities, [key]: value };
  if (!next.agendar) next.reagendar = false;
  return next;
}

function toHHMM(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fromHHMM(value: string): number {
  const [h, m] = (value || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return Math.max(0, Math.min(1439, h * 60 + m));
}

function prettyPhone(phone: string): string {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length !== 10) return phone || "—";
  return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
}

function shortWhen(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}
