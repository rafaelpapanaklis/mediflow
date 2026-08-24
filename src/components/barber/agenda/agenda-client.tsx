"use client";

// ═══════════════════════════════════════════════════════════════════════
// Pantalla de AGENDA. Es la que la barbería deja abierta todo el día, así
// que manda la vista DÍA: se refresca sola cada minuto (solo con la
// pestaña visible: una pestaña de fondo no gasta batería ni base de datos)
// y todo movimiento se puede deshacer.
//
// NAVEGAR ES UN SOLO GRUPO: flechas, "Hoy", la fecha y Día/Semana viven
// juntos, a la izquierda. Antes los tabs estaban pegados al borde derecho
// y en un monitor ancho quedaban a medio metro de las flechas: nadie los
// encontraba. A la derecha quedan las ACCIONES (nueva visita, horarios),
// que es otra cosa.
//
// Los modales cuelgan de la RAÍZ, fuera de .screen y de la rejilla: los dos
// llevan `container-type` para sus @container, y un container-type atrapa a
// position:fixed (el modal quedaría encerrado dentro del tablero).
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { makeT, type Dictionary } from "@/i18n/t";
import type { SaleRow } from "@/lib/barber/cash";
import {
  BARBER_APPOINTMENT_STATUS_UI,
  type BarberAppointmentDTO,
  type BarberAppointmentStatus,
  type BarberDTO,
  type BarberScheduleDTO,
  type BarberServiceDTO,
  type BarberTimeOffDTO,
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
import { Toast, agendaCss as css, barberColor } from "./agenda-ui";
import { DayBoard } from "./day-board";
import { WeekBoard } from "./week-board";
import { AppointmentDialog } from "./appointment-dialog";
import { AppointmentDetail } from "./appointment-detail";
import { ChargeBridge } from "./charge-bridge";

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
  charged: Record<string, { saleId: string; total: number }>;
  can: {
    edit: boolean;
    schedule: boolean;
    clients: boolean;
    createClients: boolean;
    cash: boolean;
  };
}

interface ToastState {
  message: string;
  note?: string | null;
  actionLabel?: string | null;
  onAction?: () => void;
  tone?: "ok" | "bad";
}

/** Orden de la leyenda: el mismo del flujo, no alfabético. */
const LEGEND_ORDER: BarberAppointmentStatus[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "DONE",
  "NO_SHOW",
  "CANCELLED",
];

export interface AgendaClientProps {
  dict: Dictionary;
  /** Sub-diccionario `barber.caja`: lo hablan los modales de dinero. */
  cajaDict: Dictionary;
  locale: string;
  timezone: string;
  branchId: string;
  initialDateISO: string;
  /** El plan incluye caja. Sin esto no se ofrece cobrar (el server igual lo niega). */
  cashEnabled: boolean;
}

export function AgendaClient(props: AgendaClientProps) {
  const t = useMemo(() => makeT(props.dict), [props.dict]);
  const [view, setView] = useState<"day" | "week">("day");
  const [dateISO, setDateISO] = useState(props.initialDateISO);
  const [data, setData] = useState<AgendaPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  /** null = todas las sillas. Con varias sillas en un celular, se elige una. */
  const [chair, setChair] = useState<string | null>(null);

  const [detail, setDetail] = useState<BarberAppointmentDTO | null>(null);
  const [editing, setEditing] = useState<BarberAppointmentDTO | null>(null);
  const [creating, setCreating] = useState<{ barberId: string | null; startAt: Date } | null>(null);
  const [charging, setCharging] = useState<{ id: string; clientLabel: string } | null>(null);

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
        note: payload.remindersInvalidated ? t("barber.agenda.move.remindersCancelled") : null,
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

  const activeBarbers = useMemo(
    () => (data?.barbers ?? []).filter((b) => b.isActive),
    [data],
  );

  // La silla elegida recorta columnas Y resumen: si filtras a Beto, el total
  // del día es el de Beto, no el de toda la barbería (mentir sería peor).
  const visibleBarbers = useMemo(
    () => (chair ? activeBarbers.filter((b) => b.id === chair) : activeBarbers),
    [activeBarbers, chair],
  );

  const visibleAppointments = useMemo(
    () => (chair ? dayAppointments.filter((a) => a.barberId === chair) : dayAppointments),
    [dayAppointments, chair],
  );

  // Si la silla filtrada desaparece (se dio de baja), se vuelve a "todas".
  useEffect(() => {
    if (chair && !activeBarbers.some((b) => b.id === chair)) setChair(null);
  }, [chair, activeBarbers]);

  const dayTotal = useMemo(
    () =>
      visibleAppointments
        .filter((a) => a.status !== "CANCELLED" && a.status !== "NO_SHOW")
        .reduce((acc, a) => acc + a.services.reduce((s, x) => s + x.priceAtBooking, 0), 0),
    [visibleAppointments],
  );

  const step = (delta: number) => setDateISO((prev) => addDaysISO(prev, delta * days));
  const canEdit = data?.can.edit ?? false;
  const canCharge = props.cashEnabled && (data?.can.cash ?? false);
  const charged = data?.charged ?? {};

  const openCharge = (appt: BarberAppointmentDTO) => {
    setDetail(null);
    setCharging({
      id: appt.id,
      clientLabel: appt.clientName || t("barber.agenda.card.noClient"),
    });
  };

  return (
    <div>
      {/* .screen lleva container-type: los modales NO viven aquí dentro. */}
      <div className={css.screen}>
        <div className={css.toolbar}>
          {/* Navegar: flechas + Hoy + fecha + Día/Semana, TODO junto. */}
          <div className={css.navGroup}>
            <div className={css.navArrows}>
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
            </div>

            <div className={css.dateBlock}>
              <h1 className={css.dateTitle}>{title}</h1>
              <p className={css.dateSub}>
                {t("barber.agenda.summary.appointments", { count: visibleAppointments.length })}
                {dayTotal > 0
                  ? ` · ${t("barber.agenda.summary.dayTotal")} ${formatMXN(dayTotal)}`
                  : ""}
              </p>
            </div>

            <div className={css.segmented} role="tablist" aria-label={t("barber.agenda.views.label")}>
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
          </div>

          <span className={css.toolbarSpacer} />

          <div className={css.toolbarActions}>
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
                    barberId: chair ?? activeBarbers[0]?.id ?? null,
                    startAt: new Date(),
                  })
                }
              >
                <Plus size={15} /> {t("barber.agenda.actions.new")}
              </button>
            ) : null}
          </div>
        </div>

        {/* Filtro de sillas: la salida honesta al "no cabe en el celular".
            Vale para las dos vistas — en semana filtra la maraña de todos
            los barberos mezclados — y por eso el resumen de arriba cuenta
            siempre lo mismo que se está viendo. */}
        {activeBarbers.length > 1 ? (
          <div className={css.chairs} role="group" aria-label={t("barber.agenda.chairs.label")}>
            <button
              type="button"
              className={`${css.chair} ${chair === null ? css.chairOn : ""}`}
              aria-pressed={chair === null}
              onClick={() => setChair(null)}
            >
              {t("barber.agenda.chairs.all")}
            </button>
            {activeBarbers.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`${css.chair} ${chair === b.id ? css.chairOn : ""}`}
                aria-pressed={chair === b.id}
                onClick={() => setChair((prev) => (prev === b.id ? null : b.id))}
              >
                <span className={css.chairDot} style={{ background: barberColor(b.id) }} aria-hidden />
                {b.nickname || b.name}
              </button>
            ))}
          </div>
        ) : null}

        {error ? <div className={css.errorBox} style={{ marginBottom: 12 }}>{error}</div> : null}

        {loading && !data ? (
          <div className={css.board}>
            <div className={css.empty}>{t("barber.agenda.state.loading")}</div>
          </div>
        ) : data && view === "day" ? (
          <DayBoard
            dateISO={dateISO}
            timezone={timezone}
            barbers={visibleBarbers}
            appointments={visibleAppointments}
            schedules={data.schedules}
            timeOff={data.timeOff}
            charged={charged}
            canEdit={canEdit}
            canSchedule={data.can.schedule}
            t={t}
            onSlotClick={(barberId, startAt) => setCreating({ barberId, startAt })}
            onCardClick={setDetail}
            onMove={(appt, startAt, barberId) => void handleMove(appt, startAt, barberId)}
          />
        ) : data ? (
          <WeekBoard
            dateISO={dateISO}
            timezone={timezone}
            barbers={visibleBarbers}
            appointments={visibleAppointments}
            schedules={data.schedules}
            t={t}
            onPickDay={(day) => {
              setDateISO(day);
              setView("day");
            }}
            onCardClick={setDetail}
          />
        ) : null}

        {/* Qué significa cada color. Sin esto, el color solo lo entiende
            quien lo eligió. */}
        {data ? (
          <div className={css.legend}>
            {LEGEND_ORDER.map((status) => (
              <span key={status} className={css.legendItem}>
                <span className={css.legendSwatch} data-status={status} aria-hidden />
                {BARBER_APPOINTMENT_STATUS_UI[status].label}
              </span>
            ))}
          </div>
        ) : null}

        {!canEdit && data ? (
          <p className={css.hint} style={{ marginTop: 10 }}>
            {t("barber.agenda.state.readOnly")}
          </p>
        ) : null}
      </div>

      {/* ── Modales: FUERA de .screen (container-type atrapa fixed) ── */}
      {detail ? (
        <AppointmentDetail
          appointment={detail}
          timezone={timezone}
          branchId={props.branchId}
          canEdit={canEdit}
          canViewClients={data?.can.clients ?? false}
          canCharge={canCharge}
          sale={charged[detail.id] ?? null}
          t={t}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditing(detail);
            setDetail(null);
          }}
          onChanged={(next, note) => {
            replaceAppointment(next);
            if (note) setToast({ message: note });
          }}
          onCharge={() => openCharge(detail)}
        />
      ) : null}

      {charging ? (
        <ChargeBridge
          cajaDict={props.cajaDict}
          appointmentId={charging.id}
          clientLabel={charging.clientLabel}
          timezone={timezone}
          t={t}
          onClose={() => setCharging(null)}
          onCharged={(sale: SaleRow) => {
            setCharging(null);
            setToast({ message: t("barber.agenda.charge.done", { amount: formatMXN(sale.total) }) });
            // Recargar trae `charged` al día: la tarjeta se marca cobrada.
            void load(true);
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
