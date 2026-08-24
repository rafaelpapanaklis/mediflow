"use client";

// ═══════════════════════════════════════════════════════════════════════
// Pantalla de AGENDA. Es la que la barbería deja abierta todo el día, así
// que manda la vista DÍA: se refresca sola cada minuto (solo con la
// pestaña visible: una pestaña de fondo no gasta batería ni base de datos)
// y todo movimiento se puede deshacer.
//
// Los modales cuelgan de aquí, NO de la rejilla: el tablero lleva
// `container-type` para sus @container, y un container-type atrapa a
// position:fixed (el modal quedaría encerrado dentro del tablero).
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { makeT, type Dictionary } from "@/i18n/t";
import type {
  BarberAppointmentDTO,
  BarberDTO,
  BarberScheduleDTO,
  BarberServiceDTO,
  BarberTimeOffDTO,
} from "@/lib/barber/types";
import {
  addDaysISO,
  formatMXN,
  minuteToLabel,
  shopDateISO,
  shopMinuteOfDay,
  startOfWeekISO,
  weekDaysISO,
} from "@/lib/barber/agenda";
import { Toast, agendaCss as css } from "./agenda-ui";
import { DayBoard } from "./day-board";
import { WeekBoard } from "./week-board";
import { AppointmentDialog } from "./appointment-dialog";
import { AppointmentDetail } from "./appointment-detail";

interface AgendaPayload {
  branchId: string;
  timezone: string;
  dateISO: string;
  days: number;
  barbers: BarberDTO[];
  services: BarberServiceDTO[];
  schedules: BarberScheduleDTO[];
  timeOff: BarberTimeOffDTO[];
  appointments: BarberAppointmentDTO[];
  can: { edit: boolean; schedule: boolean; clients: boolean; createClients: boolean };
}

interface ToastState {
  message: string;
  note?: string | null;
  actionLabel?: string | null;
  onAction?: () => void;
  tone?: "ok" | "bad";
}

export interface AgendaClientProps {
  dict: Dictionary;
  locale: string;
  timezone: string;
  branchId: string;
  initialDateISO: string;
}

export function AgendaClient(props: AgendaClientProps) {
  const t = useMemo(() => makeT(props.dict), [props.dict]);
  const [view, setView] = useState<"day" | "week">("day");
  const [dateISO, setDateISO] = useState(props.initialDateISO);
  const [data, setData] = useState<AgendaPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const [detail, setDetail] = useState<BarberAppointmentDTO | null>(null);
  const [editing, setEditing] = useState<BarberAppointmentDTO | null>(null);
  const [creating, setCreating] = useState<{ barberId: string | null; startAt: Date } | null>(null);

  const timezone = data?.timezone ?? props.timezone;
  const rangeStart = view === "week" ? startOfWeekISO(dateISO) : dateISO;
  const days = view === "week" ? 7 : 1;

  // ── Carga ────────────────────────────────────────────────────────────
  const inFlight = useRef<AbortController | null>(null);
  const load = useCallback(
    async (quiet = false) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      if (!quiet) setLoading(true);
      try {
        const res = await fetch(
          `/api/barber/appointments?date=${rangeStart}&days=${days}&branchId=${props.branchId}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(typeof body.error === "string" ? body.error : t("barber.agenda.state.error"));
          return;
        }
        setData((await res.json()) as AgendaPayload);
        setError(null);
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setError(t("barber.agenda.state.error"));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [rangeStart, days, props.branchId, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Refresco silencioso: solo con la pestaña visible. Una pestaña de fondo
  // ni se entera (Chrome congela los timers y no tiene caso insistir).
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // El aviso flotante se va solo a los 9 segundos (da tiempo a "Deshacer").
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 9_000);
    return () => window.clearTimeout(id);
  }, [toast]);

  // ── Mover una visita (arrastrar y soltar) ────────────────────────────
  const replaceAppointment = useCallback((next: BarberAppointmentDTO) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            appointments: prev.appointments.some((a) => a.id === next.id)
              ? prev.appointments.map((a) => (a.id === next.id ? next : a))
              : [...prev.appointments, next],
          }
        : prev,
    );
    setDetail((prev) => (prev && prev.id === next.id ? next : prev));
  }, []);

  const patchAppointment = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const res = await fetch(`/api/barber/appointments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, branchId: props.branchId }),
      });
      const payload = await res.json().catch(() => ({}));
      return { ok: res.ok, payload } as {
        ok: boolean;
        payload: { appointment?: BarberAppointmentDTO; error?: string; remindersInvalidated?: number };
      };
    },
    [props.branchId],
  );

  const handleMove = useCallback(
    async (appt: BarberAppointmentDTO, startAt: Date, barberId: string) => {
      const previousStart = appt.startAt;
      const previousBarber = appt.barberId;
      const durationMs = new Date(appt.endAt).getTime() - new Date(appt.startAt).getTime();

      // Optimista: la tarjeta salta al instante y se corrige si el servidor
      // dice que no (la constraint EXCLUDE es la que manda de verdad).
      replaceAppointment({
        ...appt,
        startAt: startAt.toISOString(),
        endAt: new Date(startAt.getTime() + durationMs).toISOString(),
        barberId,
      });

      const { ok, payload } = await patchAppointment(appt.id, {
        startAt: startAt.toISOString(),
        barberId,
      });

      if (!ok || !payload.appointment) {
        replaceAppointment({ ...appt, startAt: previousStart, barberId: previousBarber });
        setToast({ message: payload.error ?? t("barber.agenda.state.error"), tone: "bad" });
        return;
      }

      replaceAppointment(payload.appointment);
      const label = minuteToLabel(shopMinuteOfDay(startAt, timezone));
      setToast({
        message: t("barber.agenda.move.moved", { time: label }),
        note: payload.remindersInvalidated
          ? t("barber.agenda.move.remindersCancelled")
          : null,
        actionLabel: t("barber.agenda.actions.undo"),
        onAction: async () => {
          const undo = await patchAppointment(appt.id, {
            startAt: previousStart,
            barberId: previousBarber,
          });
          if (undo.ok && undo.payload.appointment) {
            replaceAppointment(undo.payload.appointment);
            setToast({ message: t("barber.agenda.move.undone") });
          } else {
            setToast({ message: t("barber.agenda.move.undoFailed"), tone: "bad" });
          }
        },
      });
    },
    [patchAppointment, replaceAppointment, t, timezone],
  );

  // ── Encabezado ───────────────────────────────────────────────────────
  const title = useMemo(() => {
    const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(props.locale === "en" ? "en-US" : "es-MX", {
        timeZone: "UTC",
        ...opts,
      }).format(new Date(`${iso}T12:00:00Z`));
    if (view === "day") {
      return fmt(dateISO, { weekday: "long", day: "numeric", month: "long" });
    }
    const week = weekDaysISO(dateISO);
    return `${fmt(week[0], { day: "numeric", month: "short" })} – ${fmt(week[6], {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}`;
  }, [dateISO, view, props.locale]);

  const dayAppointments = useMemo(() => {
    if (!data) return [] as BarberAppointmentDTO[];
    if (view === "week") return data.appointments;
    return data.appointments.filter(
      (a) => shopDateISO(new Date(a.startAt), timezone) === dateISO,
    );
  }, [data, view, dateISO, timezone]);

  const dayTotal = useMemo(
    () =>
      dayAppointments
        .filter((a) => a.status !== "CANCELLED" && a.status !== "NO_SHOW")
        .reduce((acc, a) => acc + a.services.reduce((s, x) => s + x.priceAtBooking, 0), 0),
    [dayAppointments],
  );

  const step = (delta: number) => setDateISO((prev) => addDaysISO(prev, delta * days));
  const canEdit = data?.can.edit ?? false;

  return (
    <div>
      <div className={css.toolbar}>
        <button
          type="button"
          className={`${css.btn} ${css.btnIcon}`}
          onClick={() => step(-1)}
          aria-label={t("barber.agenda.nav.prev")}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          className={`${css.btn} ${css.btnIcon}`}
          onClick={() => step(1)}
          aria-label={t("barber.agenda.nav.next")}
        >
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          className={css.btn}
          onClick={() => setDateISO(shopDateISO(new Date(), timezone))}
        >
          {t("barber.agenda.nav.today")}
        </button>

        <div className={css.dateBlock}>
          <h1 className={css.dateTitle}>{title}</h1>
          <p className={css.dateSub}>
            {t("barber.agenda.summary.appointments", { count: dayAppointments.length })}
            {dayTotal > 0 ? ` · ${t("barber.agenda.summary.dayTotal")} ${formatMXN(dayTotal)}` : ""}
          </p>
        </div>

        <span className={css.toolbarSpacer} />

        <div className={css.segmented} role="tablist">
          {(["day", "week"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              className={`${css.seg} ${view === v ? css.segActive : ""}`}
              onClick={() => setView(v)}
            >
              {t(`barber.agenda.views.${v}`)}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`${css.btn} ${css.btnIcon}`}
          onClick={() => void load()}
          aria-label={t("barber.agenda.actions.retry")}
        >
          <RefreshCw size={15} />
        </button>

        {data?.can.schedule ? (
          <Link href="/barber/agenda/horarios" className={css.btn}>
            <CalendarClock size={15} /> {t("barber.agenda.actions.schedules")}
          </Link>
        ) : null}

        {canEdit ? (
          <button
            type="button"
            className={`${css.btn} ${css.btnPrimary}`}
            onClick={() =>
              setCreating({
                barberId: data?.barbers.find((b) => b.isActive)?.id ?? null,
                startAt: new Date(),
              })
            }
          >
            <Plus size={15} /> {t("barber.agenda.actions.new")}
          </button>
        ) : null}
      </div>

      {error ? <div className={css.errorBox} style={{ marginBottom: 12 }}>{error}</div> : null}

      {loading && !data ? (
        <div className={css.board}>
          <div className={css.empty}>{t("barber.agenda.state.loading")}</div>
        </div>
      ) : data && view === "day" ? (
        <DayBoard
          dateISO={dateISO}
          timezone={timezone}
          barbers={data.barbers}
          appointments={dayAppointments}
          schedules={data.schedules}
          timeOff={data.timeOff}
          canEdit={canEdit}
          t={t}
          onSlotClick={(barberId, startAt) => setCreating({ barberId, startAt })}
          onCardClick={setDetail}
          onMove={(appt, startAt, barberId) => void handleMove(appt, startAt, barberId)}
        />
      ) : data ? (
        <WeekBoard
          dateISO={dateISO}
          timezone={timezone}
          barbers={data.barbers}
          appointments={data.appointments}
          schedules={data.schedules}
          t={t}
          onPickDay={(day) => {
            setDateISO(day);
            setView("day");
          }}
          onCardClick={setDetail}
        />
      ) : null}

      {!canEdit && data ? (
        <p className={css.hint} style={{ marginTop: 10 }}>
          {t("barber.agenda.state.readOnly")}
        </p>
      ) : null}

      {/* ── Modales: FUERA del tablero (container-type atrapa fixed) ── */}
      {detail ? (
        <AppointmentDetail
          appointment={detail}
          timezone={timezone}
          branchId={props.branchId}
          canEdit={canEdit}
          t={t}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditing(detail);
            setDetail(null);
          }}
          onChanged={(next, note) => {
            replaceAppointment(next);
            if (note) setToast({ message: note });
            setDetail(null);
          }}
        />
      ) : null}

      {creating && data ? (
        <AppointmentDialog
          mode="create"
          timezone={timezone}
          branchId={props.branchId}
          barbers={data.barbers}
          services={data.services}
          canSearchClients={data.can.clients}
          initialBarberId={creating.barberId}
          initialStartAt={creating.startAt}
          t={t}
          onClose={() => setCreating(null)}
          onSaved={(appt) => {
            replaceAppointment(appt);
            setCreating(null);
            void load(true);
          }}
        />
      ) : null}

      {editing && data ? (
        <AppointmentDialog
          mode="edit"
          timezone={timezone}
          branchId={props.branchId}
          barbers={data.barbers}
          services={data.services}
          canSearchClients={data.can.clients}
          appointment={editing}
          t={t}
          onClose={() => setEditing(null)}
          onSaved={(appt) => {
            replaceAppointment(appt);
            setEditing(null);
            void load(true);
          }}
        />
      ) : null}

      {toast ? (
        <Toast
          message={toast.message}
          note={toast.note}
          actionLabel={toast.actionLabel}
          onAction={
            toast.onAction
              ? () => {
                  const action = toast.onAction;
                  setToast(null);
                  action?.();
                }
              : undefined
          }
          tone={toast.tone}
        />
      ) : null}
    </div>
  );
}
