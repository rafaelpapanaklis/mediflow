"use client";

// ═══════════════════════════════════════════════════════════════════════
// Horarios y bloqueos. Lo que se define aquí es lo que la agenda OFRECE:
// fuera del horario de un barbero, o dentro de un bloqueo, la agenda no
// deja poner una visita (ni arrastrando ni desde el modal).
//
// Turno partido = varias franjas del mismo día. Por eso el guardado manda
// la SEMANA COMPLETA del barbero y el servidor la reemplaza de un jalón:
// editar fila por fila deja estados intermedios raros a medio guardar.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Plus, Trash2 } from "lucide-react";
import { type Dictionary } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import {
  BARBER_TIME_OFF_TYPE_LABELS,
  type BarberDTO,
  type BarberScheduleDTO,
  type BarberTimeOffDTO,
  type BarberTimeOffType,
} from "@/lib/barber/types";
import {
  hhmmToMinute,
  minuteToHHMM,
  minuteToLabel,
  shopDateISO,
  shopLocalToUtc,
  shopMinuteOfDay,
} from "@/lib/barber/agenda";
import { Field, agendaCss as css } from "./agenda-ui";

interface Shift {
  start: number;
  end: number;
}

type WeekShifts = Record<number, Shift[]>;

const DAYS = [1, 2, 3, 4, 5, 6, 0];
const DEFAULT_SHIFT: Shift = { start: 10 * 60, end: 20 * 60 };
const TIME_OFF_TYPES: BarberTimeOffType[] = ["BREAK", "VACATION", "HOLIDAY", "OTHER"];

export interface ScheduleManagerProps {
  dict: Dictionary;
  timezone: string;
  branchId: string;
  canManage: boolean;
  /**
   * Barbero que llega elegido en la URL (?barbero=). Es lo que hace que el
   * aviso "Sin horario cargado" de la agenda sirva de algo: aterrizas
   * directo en el horario de ESE barbero, no en el del primero de la lista.
   */
  initialBarberId?: string | null;
}

export function ScheduleManager(props: ScheduleManagerProps) {
  const t = useMemo(() => makeBarberT(props.dict), [props.dict]);
  const [tab, setTab] = useState<"week" | "timeOff">("week");

  const [barbers, setBarbers] = useState<BarberDTO[]>([]);
  const [schedules, setSchedules] = useState<BarberScheduleDTO[]>([]);
  const [timeOff, setTimeOff] = useState<BarberTimeOffDTO[]>([]);
  const [barberId, setBarberId] = useState("");
  const [week, setWeek] = useState<WeekShifts>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/barber/schedules?branchId=${props.branchId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : t("barber.agenda.state.error"));
        return;
      }
      const data = await res.json();
      setBarbers(data.barbers ?? []);
      setSchedules(data.schedules ?? []);
      setTimeOff(data.timeOff ?? []);
      // El de la URL manda, pero SOLO si existe en esta sede: un id ajeno
      // no debe seleccionar nada (el filtro de inquilino ya lo hizo el
      // servidor; aquí simplemente no se le hace caso).
      const list: BarberDTO[] = data.barbers ?? [];
      const asked = props.initialBarberId
        ? (list.find((b) => b.id === props.initialBarberId)?.id ?? "")
        : "";
      setBarberId((prev) => prev || asked || list.find((b) => b.isActive)?.id || "");
      setError(null);
    } catch {
      setError(t("barber.agenda.state.error"));
    }
  }, [props.branchId, props.initialBarberId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // La semana en edición se rearma cada vez que cambia el barbero elegido.
  useEffect(() => {
    if (!barberId) return;
    const next: WeekShifts = {};
    for (const day of DAYS) next[day] = [];
    for (const row of schedules) {
      if (row.barberId !== barberId || !row.isActive) continue;
      (next[row.dayOfWeek] ??= []).push({ start: row.startMinute, end: row.endMinute });
    }
    for (const day of DAYS) next[day].sort((a, b) => a.start - b.start);
    setWeek(next);
    setDirty(false);
  }, [barberId, schedules]);

  const updateShift = (day: number, index: number, patch: Partial<Shift>) => {
    setWeek((prev) => {
      const list = [...(prev[day] ?? [])];
      list[index] = { ...list[index], ...patch };
      return { ...prev, [day]: list };
    });
    setDirty(true);
  };

  const addShift = (day: number) => {
    setWeek((prev) => {
      const list = [...(prev[day] ?? [])];
      const last = list[list.length - 1];
      list.push(last ? { start: Math.min(last.end + 60, 1380), end: Math.min(last.end + 300, 1440) } : DEFAULT_SHIFT);
      return { ...prev, [day]: list };
    });
    setDirty(true);
  };

  const removeShift = (day: number, index: number) => {
    setWeek((prev) => ({ ...prev, [day]: (prev[day] ?? []).filter((_, i) => i !== index) }));
    setDirty(true);
  };

  const copyToWeek = (day: number) => {
    const source = week[day] ?? [];
    setWeek((prev) => {
      const next = { ...prev };
      for (const d of [1, 2, 3, 4, 5, 6]) next[d] = source.map((s) => ({ ...s }));
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const rows: { dayOfWeek: number; startMinute: number; endMinute: number }[] = [];
      for (const day of DAYS) {
        for (const shift of week[day] ?? []) {
          if (shift.end <= shift.start) {
            setError(t("barber.agenda.schedule.saveError"));
            return;
          }
          rows.push({ dayOfWeek: day, startMinute: shift.start, endMinute: shift.end });
        }
      }
      const res = await fetch("/api/barber/schedules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barberId, rows, branchId: props.branchId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : t("barber.agenda.schedule.saveError"));
        return;
      }
      setSchedules(data.schedules ?? []);
      setDirty(false);
      setNotice(t("barber.agenda.schedule.saved"));
    } catch {
      setError(t("barber.agenda.schedule.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className={css.toolbar}>
        <Link href="/barber/agenda" className={`${css.btn} ${css.btnIcon}`} aria-label={t("barber.agenda.actions.backToAgenda")}>
          <ArrowLeft size={16} />
        </Link>
        <div className={css.dateBlock}>
          <h1 className={css.dateTitle}>{t("barber.agenda.schedule.title")}</h1>
          <p className={css.dateSub}>{t("barber.agenda.schedule.subtitle")}</p>
        </div>
        <span className={css.toolbarSpacer} />
        <div className={css.segmented} role="tablist">
          {(["week", "timeOff"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`${css.seg} ${tab === key ? css.segActive : ""}`}
              onClick={() => setTab(key)}
            >
              {t(`barber.agenda.schedule.tabs.${key}`)}
            </button>
          ))}
        </div>
      </div>

      {error ? <div className={css.errorBox} style={{ marginBottom: 12 }}>{error}</div> : null}
      {notice ? (
        <div className={css.totals} style={{ marginBottom: 12 }}>
          <span>{notice}</span>
        </div>
      ) : null}

      {tab === "week" ? (
        <div className={css.board} style={{ padding: 16 }}>
          <div style={{ maxWidth: 320, marginBottom: 16 }}>
            <Field label={t("barber.agenda.schedule.barber")}>
              <select
                className={css.select}
                value={barberId}
                onChange={(e) => setBarberId(e.target.value)}
              >
                {barbers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nickname || b.name}
                    {b.isActive ? "" : " (inactivo)"}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {!barberId ? (
            <p className={css.hint}>{t("barber.agenda.schedule.noBarber")}</p>
          ) : (
            <>
              <p className={css.hint} style={{ marginBottom: 12 }}>
                {t("barber.agenda.schedule.splitHint")}
              </p>
              {DAYS.map((day) => {
                const shifts = week[day] ?? [];
                return (
                  <div
                    key={day}
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "12px 0",
                      borderBottom: "1px solid var(--border-soft)",
                    }}
                  >
                    <div style={{ flex: "0 0 108px", minWidth: 0 }}>
                      <strong style={{ fontSize: 13, color: "var(--text-1)" }}>
                        {t(`barber.agenda.weekdays.${day}`)}
                      </strong>
                      <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                        {shifts.length === 0
                          ? t("barber.agenda.schedule.closedDay")
                          : shifts
                              .map((s) => `${minuteToLabel(s.start)}–${minuteToLabel(s.end)}`)
                              .join(" · ")}
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "1 1 260px" }}>
                      {shifts.map((shift, index) => (
                        <div key={index} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="time"
                            step={900}
                            className={css.input}
                            style={{ width: 120 }}
                            value={minuteToHHMM(shift.start)}
                            disabled={!props.canManage}
                            onChange={(e) => {
                              const minute = hhmmToMinute(e.target.value);
                              if (minute !== null) updateShift(day, index, { start: minute });
                            }}
                            aria-label={t("barber.agenda.schedule.from")}
                          />
                          <span style={{ color: "var(--text-3)" }}>–</span>
                          <input
                            type="time"
                            step={900}
                            className={css.input}
                            style={{ width: 120 }}
                            value={minuteToHHMM(shift.end)}
                            disabled={!props.canManage}
                            onChange={(e) => {
                              const minute = hhmmToMinute(e.target.value);
                              if (minute !== null) updateShift(day, index, { end: minute });
                            }}
                            aria-label={t("barber.agenda.schedule.to")}
                          />
                          {props.canManage ? (
                            <button
                              type="button"
                              className={`${css.btn} ${css.btnIcon}`}
                              onClick={() => removeShift(day, index)}
                              aria-label={t("barber.agenda.schedule.removeShift")}
                            >
                              <Trash2 size={14} />
                            </button>
                          ) : null}
                        </div>
                      ))}
                      {props.canManage ? (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button type="button" className={css.btn} onClick={() => addShift(day)}>
                            <Plus size={14} /> {t("barber.agenda.schedule.addShift")}
                          </button>
                          {shifts.length > 0 ? (
                            <button type="button" className={css.btn} onClick={() => copyToWeek(day)}>
                              <Copy size={14} /> {t("barber.agenda.schedule.copyToWeek")}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {props.canManage ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
                  <button
                    type="button"
                    className={`${css.btn} ${css.btnPrimary}`}
                    onClick={save}
                    disabled={saving}
                  >
                    {t("barber.agenda.schedule.save")}
                  </button>
                  {dirty ? <span className={css.hint}>{t("barber.agenda.schedule.unsaved")}</span> : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <TimeOffTab
          t={t}
          timezone={props.timezone}
          branchId={props.branchId}
          canManage={props.canManage}
          barbers={barbers}
          timeOff={timeOff}
          onChanged={load}
        />
      )}
    </div>
  );
}

// ── Bloqueos ───────────────────────────────────────────────────────────

function TimeOffTab(props: {
  t: (key: string, vars?: Record<string, string | number>) => string;
  timezone: string;
  branchId: string;
  canManage: boolean;
  barbers: BarberDTO[];
  timeOff: BarberTimeOffDTO[];
  onChanged: () => void | Promise<void>;
}) {
  const { t, timezone } = props;
  const today = shopDateISO(new Date(), timezone);

  const [who, setWho] = useState("");
  const [type, setType] = useState<BarberTimeOffType>("BREAK");
  const [startDate, setStartDate] = useState(today);
  const [startTime, setStartTime] = useState("14:00");
  const [endDate, setEndDate] = useState(today);
  const [endTime, setEndTime] = useState("15:00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trapped, setTrapped] = useState<number>(0);

  const create = async () => {
    setBusy(true);
    setError(null);
    setTrapped(0);
    try {
      const startAt = localToUtcISO(startDate, startTime, timezone);
      const endAt = localToUtcISO(endDate, endTime, timezone);
      const res = await fetch("/api/barber/schedules/timeoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: props.branchId,
          barberId: who || null,
          type,
          startAt,
          endAt,
          reason: reason.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : t("barber.agenda.schedule.timeOff.createError"));
        return;
      }
      setTrapped(Array.isArray(data.trapped) ? data.trapped.length : 0);
      setReason("");
      await props.onChanged();
    } catch {
      setError(t("barber.agenda.schedule.timeOff.createError"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/barber/schedules/timeoff/${id}`, { method: "DELETE" });
    await props.onChanged();
  };

  const fmt = (iso: string) => {
    const date = new Date(iso);
    return `${shopDateISO(date, timezone)} ${minuteToLabel(shopMinuteOfDay(date, timezone))}`;
  };

  return (
    <div className={css.board} style={{ padding: 16 }}>
      <p className={css.hint} style={{ marginBottom: 14 }}>
        {t("barber.agenda.schedule.timeOff.subtitle")}
      </p>

      {props.canManage ? (
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            paddingBottom: 16,
            borderBottom: "1px solid var(--border-soft)",
            marginBottom: 16,
          }}
        >
          <Field label={t("barber.agenda.schedule.timeOff.who")}>
            <select className={css.select} value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">{t("barber.agenda.schedule.timeOff.wholeShop")}</option>
              {props.barbers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nickname || b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("barber.agenda.schedule.timeOff.type")}>
            <select
              className={css.select}
              value={type}
              onChange={(e) => setType(e.target.value as BarberTimeOffType)}
            >
              {TIME_OFF_TYPES.map((value) => (
                <option key={value} value={value}>
                  {BARBER_TIME_OFF_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("barber.agenda.schedule.timeOff.start")}>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="date"
                className={css.input}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <input
                type="time"
                step={900}
                className={css.input}
                style={{ width: 110 }}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
          </Field>
          <Field label={t("barber.agenda.schedule.timeOff.end")}>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="date"
                className={css.input}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
              <input
                type="time"
                step={900}
                className={css.input}
                style={{ width: 110 }}
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </Field>
          <Field label={t("barber.agenda.schedule.timeOff.reason")}>
            <input
              className={css.input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("barber.agenda.schedule.timeOff.reasonPlaceholder")}
              maxLength={120}
            />
          </Field>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              type="button"
              className={`${css.btn} ${css.btnPrimary}`}
              onClick={create}
              disabled={busy}
              style={{ width: "100%" }}
            >
              {busy
                ? t("barber.agenda.schedule.timeOff.creating")
                : t("barber.agenda.schedule.timeOff.create")}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className={css.errorBox} style={{ marginBottom: 12 }}>{error}</div> : null}
      {trapped > 0 ? (
        <div className={css.errorBox} style={{ marginBottom: 12 }}>
          {t("barber.agenda.schedule.timeOff.trapped", { count: trapped })}
        </div>
      ) : null}

      {props.timeOff.length === 0 ? (
        <p className={css.hint}>{t("barber.agenda.schedule.timeOff.empty")}</p>
      ) : (
        props.timeOff.map((off) => {
          const barber = props.barbers.find((b) => b.id === off.barberId);
          return (
            <div key={off.id} className={css.detailRow}>
              <span className={css.detailKey}>
                {off.barberId
                  ? (barber?.nickname ?? barber?.name ?? "—")
                  : t("barber.agenda.schedule.timeOff.wholeShop")}
              </span>
              <span className={css.detailValue}>
                {BARBER_TIME_OFF_TYPE_LABELS[off.type]}
                {off.reason ? ` · ${off.reason}` : ""}
                <br />
                <span className={css.resultMeta}>
                  {fmt(off.startAt)} → {fmt(off.endAt)}
                </span>
              </span>
              {props.canManage ? (
                <button
                  type="button"
                  className={`${css.btn} ${css.btnIcon} ${css.btnDanger}`}
                  onClick={() => void remove(off.id)}
                  aria-label={t("barber.agenda.schedule.timeOff.delete")}
                >
                  <Trash2 size={14} />
                </button>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

/**
 * (fecha + hora locales de la barbería) → ISO en UTC para mandar a la API.
 * Usa el MISMO conversor que el servidor, así el navegador y la base nunca
 * discrepan por una hora.
 */
function localToUtcISO(dateISO: string, hhmm: string, timezone: string): string {
  const minute = hhmmToMinute(hhmm) ?? 0;
  return shopLocalToUtc(dateISO, minute, timezone).toISOString();
}
