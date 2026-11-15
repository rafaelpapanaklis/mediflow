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
import { type Dictionary } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import { sumMoney } from "@/lib/barber/money";
import type { SaleRow } from "@/lib/barber/cash";
import {
  BARBER_APPOINTMENT_STATUS_UI,
  isTerminalAppointmentStatus,
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
  formatMinutes,
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
import { nextSlotStart } from "./next-slot";
import { HoverCard, useHoverCard } from "./hover-card";
import { quickActions } from "./rejilla";
import type { CardQuickAction } from "./appointment-card";

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
    /** Rol Barbero: id del barbero cuyas visitas puede marcar En silla / Completada. */
    advanceOwnBarberId?: string | null;
    schedule: boolean;
    clients: boolean;
    createClients: boolean;
    cash: boolean;
    /** requests.manage: aceptar solicitudes web/bot (camino de Solicitudes). */
    requests?: boolean;
  };
}

/** Pantalla de Solicitudes: donde se aceptan las reservas web y del bot. */
const REQUESTS_HREF = "/barber/solicitudes";

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
  /** Visita a resaltar al abrir (viene de Inicio: ?visita=<id>). */
  highlightId?: string | null;
  /** El plan incluye caja. Sin esto no se ofrece cobrar (el server igual lo niega). */
  cashEnabled: boolean;
}

export function AgendaClient(props: AgendaClientProps) {
  const t = useMemo(() => makeBarberT(props.dict), [props.dict]);
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

  // Desde Inicio (?visita=<id>): en cuanto la visita está en pantalla, se
  // lleva a la vista y se resalta unos segundos. Una sola vez.
  const resaltada = useRef(false);
  useEffect(() => {
    const id = props.highlightId;
    if (!id || resaltada.current || !data?.appointments.some((a) => a.id === id)) return;
    resaltada.current = true;
    // Después del «ir a la hora de ahora» de la rejilla, para no pelearse con él.
    const t1 = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-appt-id="${CSS.escape(id)}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      el.setAttribute("data-resaltada", "");
      window.setTimeout(() => el.removeAttribute("data-resaltada"), 4000);
    }, 350);
    return () => window.clearTimeout(t1);
  }, [data, props.highlightId]);

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
      const newBarber =
        barberId !== previousBarber
          ? data?.barbers.find((b) => b.id === barberId)
          : null;
      // Movida a OTRO día (vista Semana): el aviso dice a cuál.
      const newDay =
        shopDateISO(startAt, timezone) !== shopDateISO(new Date(previousStart), timezone)
          ? new Intl.DateTimeFormat(props.locale === "en" ? "en-US" : "es-MX", {
              timeZone: timezone,
              weekday: "long",
              day: "numeric",
            }).format(startAt)
          : null;
      setToast({
        message: newBarber
          ? t("barber.agenda.move.movedBarber", {
              barber: newBarber.nickname || newBarber.name,
              time: label,
            })
          : newDay
            ? t("barber.agenda.move.movedDay", { day: newDay, time: label })
            : t("barber.agenda.move.moved", { time: label }),
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
    [patchAppointment, replaceAppointment, t, timezone, data?.barbers, props.locale],
  );

  // ── Alargar / acortar jalando el borde de abajo ──────────────────────
  // Mismo PATCH que el +/- del detalle (`durationMin`): el servidor revalida
  // el hueco y la constraint de la base manda. Optimista y con «Deshacer».
  const handleResize = useCallback(
    async (appt: BarberAppointmentDTO, durationMin: number) => {
      const previousEnd = appt.endAt;
      const previousDuration = Math.round(
        (new Date(appt.endAt).getTime() - new Date(appt.startAt).getTime()) / 60_000,
      );
      replaceAppointment({
        ...appt,
        endAt: new Date(new Date(appt.startAt).getTime() + durationMin * 60_000).toISOString(),
      });
      const { ok, payload } = await patchAppointment(appt.id, { durationMin });
      if (!ok || !payload.appointment) {
        replaceAppointment({ ...appt, endAt: previousEnd });
        setToast({ message: payload.error ?? t("barber.agenda.state.error"), tone: "bad" });
        return;
      }
      replaceAppointment(payload.appointment);
      setToast({
        message: t("barber.agenda.resize.done", { duration: formatMinutes(durationMin) }),
        note: payload.remindersInvalidated ? t("barber.agenda.move.remindersCancelled") : null,
        actionLabel: t("barber.agenda.actions.undo"),
        onAction: async () => {
          const undo = await patchAppointment(appt.id, { durationMin: previousDuration });
          if (undo.ok && undo.payload.appointment) {
            replaceAppointment(undo.payload.appointment);
            setToast({ message: t("barber.agenda.resize.undone") });
          } else {
            setToast({ message: t("barber.agenda.move.undoFailed"), tone: "bad" });
          }
        },
      });
    },
    [patchAppointment, replaceAppointment, t],
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
      sumMoney(
        visibleAppointments
          .filter((a) => a.status !== "CANCELLED" && a.status !== "NO_SHOW")
          .reduce<number[]>((acc, a) => acc.concat(a.services.map((x) => x.priceAtBooking)), []),
      ),
    [visibleAppointments],
  );

  const step = (delta: number) => setDateISO((prev) => addDaysISO(prev, delta * days));
  const canEdit = data?.can.edit ?? false;
  const canCharge = props.cashEnabled && (data?.can.cash ?? false);
  const charged = data?.charged ?? {};

  // ── Resumen al pasar el mouse ────────────────────────────────────────
  const hover = useHoverCard();
  const closeHover = hover.close;
  // Cambiar de día o de vista lo quita (la visita ya no está donde estaba).
  useEffect(() => closeHover(), [view, dateISO, chair, closeHover]);
  const hovered =
    hover.anchor && data && !detail && !editing && !creating && !charging
      ? data.appointments.find((a) => a.id === hover.anchor?.appointmentId) ?? null
      : null;

  const openDetail = (appt: BarberAppointmentDTO) => {
    hover.close();
    setDetail(appt);
  };

  const openCharge = (appt: BarberAppointmentDTO) => {
    hover.close();
    setDetail(null);
    setCharging({
      id: appt.id,
      clientLabel: appt.clientName || t("barber.agenda.card.noClient"),
    });
  };

  // ── Acción rápida del estado siguiente (en la visita) ────────────────
  // Misma regla que el detalle (quickActions en rejilla.ts): quien edita
  // avanza el flujo; el rol Barbero solo «Iniciar»/«Completar» en SUS
  // visitas; cobrar pide caja. El servidor vuelve a revisarlo todo.
  const ownBarberId = data?.can.advanceOwnBarberId ?? null;
  const [busyId, setBusyId] = useState<string | null>(null);
  const quickFor = (appt: BarberAppointmentDTO) =>
    quickActions({
      status: appt.status,
      barberId: appt.barberId,
      canEdit,
      ownBarberId,
      canCharge,
      charged: Boolean(charged[appt.id]),
      source: appt.source,
      canAcceptRequests: data?.can.requests ?? false,
    });
  const quickAction = (appt: BarberAppointmentDTO): CardQuickAction | null => {
    const q = quickFor(appt);
    // Solicitud web/bot sin aceptar: se ACEPTA (camino de Solicitudes), no se «confirma».
    if (q.accept) return { label: t("barber.agenda.request.accept"), tone: "go" };
    if (q.viewRequests) {
      return { label: t("barber.agenda.request.view"), tone: "go", href: REQUESTS_HREF };
    }
    if (q.advance) {
      return q.chargeOnDone
        ? { label: t("barber.agenda.hover.short.DONE_CHARGE"), tone: "money" }
        : { label: t(`barber.agenda.hover.short.${q.advance}`), tone: "go" };
    }
    if (q.charge) return { label: t("barber.agenda.detail.charge"), tone: "money" };
    return null;
  };
  // ── Aceptar una solicitud (web/bot) ──────────────────────────────────
  // El MISMO camino que el botón «Aceptar» de Solicitudes: PATCH
  // /api/barber/booking-requests/[id] → resolveBookingRequest, que la pasa a
  // Confirmada y le encola al cliente el «quedó agendada». Nada de POST
  // /status, que la confirmaría en silencio (M1, ronda 2).
  const acceptRequest = async (appt: BarberAppointmentDTO) => {
    hover.close();
    setBusyId(appt.id);
    try {
      const res = await fetch(`/api/barber/booking-requests/${appt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "aceptar" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        status?: BarberAppointmentDTO["status"];
        notified?: boolean;
      };
      if (!res.ok) {
        setToast({ message: body.error ?? t("barber.agenda.queue.errors.generic"), tone: "bad" });
        void load(true);
        return;
      }
      replaceAppointment({ ...appt, status: body.status ?? "CONFIRMED" });
      setToast({
        message: t("barber.agenda.request.accepted", {
          client: appt.clientName || t("barber.agenda.card.noClient"),
        }),
        // Igual que Solicitudes: si no le va a llegar aviso, que lo sepa quien acepta.
        note: body.notified ? t("barber.agenda.request.notified") : t("barber.agenda.request.notNotified"),
      });
      void load(true);
    } catch {
      setToast({ message: t("barber.agenda.queue.errors.generic"), tone: "bad" });
    } finally {
      setBusyId(null);
    }
  };

  const runQuickAction = async (appt: BarberAppointmentDTO) => {
    hover.close();
    const q = quickFor(appt);
    if (q.accept) {
      await acceptRequest(appt);
      return;
    }
    if (!q.advance) {
      if (q.charge) openCharge(appt);
      return;
    }
    const to = q.advance;
    setBusyId(appt.id);
    try {
      const res = await fetch(`/api/barber/appointments/${appt.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, branchId: props.branchId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.appointment) {
        setToast({
          message: typeof body.error === "string" ? body.error : t("barber.agenda.queue.errors.generic"),
          tone: "bad",
        });
        return;
      }
      const updated = body.appointment as BarberAppointmentDTO;
      replaceAppointment(updated);
      // Completar y cobrar son UN movimiento del mostrador (igual que el detalle).
      if (to === "DONE" && q.chargeOnDone) {
        openCharge(updated);
        return;
      }
      setToast({
        message: t("barber.agenda.hover.done", {
          client: updated.clientName || t("barber.agenda.card.noClient"),
          status: t(`barber.agenda.hover.status.${to}`),
        }),
        note: body.remindersInvalidated > 0 ? t("barber.agenda.move.remindersCancelled") : null,
      });
    } catch {
      setToast({ message: t("barber.agenda.queue.errors.generic"), tone: "bad" });
    } finally {
      setBusyId(null);
    }
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
                  ? // En Semana suma los 7 días: decía «Total del día» (QA A, 15-nov).
                    ` · ${t(days > 1 ? "barber.agenda.summary.weekTotal" : "barber.agenda.summary.dayTotal")} ${formatMXN(dayTotal)}`
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
                    startAt: nextSlotStart(new Date(), timezone),
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
            onSlotRejected={(message) => setToast({ message, tone: "bad" })}
            onCardClick={openDetail}
            onCardHover={hover.show}
            onCardHoverEnd={hover.close}
            quickAction={quickAction}
            onQuickAction={(appt) => void runQuickAction(appt)}
            busyId={busyId}
            onDragStart={hover.close}
            onMove={(appt, startAt, barberId) => void handleMove(appt, startAt, barberId)}
            onResize={(appt, minutes) => void handleResize(appt, minutes)}
            onDropRejected={(message) => setToast({ message, tone: "bad" })}
          />
        ) : data ? (
          <WeekBoard
            dateISO={dateISO}
            timezone={timezone}
            barbers={visibleBarbers}
            appointments={visibleAppointments}
            schedules={data.schedules}
            timeOff={data.timeOff}
            charged={charged}
            canEdit={canEdit}
            t={t}
            onPickDay={(day) => {
              setDateISO(day);
              setView("day");
            }}
            onCardClick={openDetail}
            onSlotClick={(barberId, startAt) => setCreating({ barberId, startAt })}
            onSlotRejected={(message) => setToast({ message, tone: "bad" })}
            onMove={(appt, startAt, barberId) => void handleMove(appt, startAt, barberId)}
            onResize={(appt, minutes) => void handleResize(appt, minutes)}
            onDropRejected={(message) => setToast({ message, tone: "bad" })}
            onDragStart={hover.close}
            onCardHover={hover.show}
            onCardHoverEnd={hover.close}
            quickAction={quickAction}
            onQuickAction={(appt) => void runQuickAction(appt)}
            busyId={busyId}
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
            {/* El barbero que puede iniciar y completar SUS visitas
                (advanceOwnBarberId) no está en «solo lectura»: su aviso lo dice. */}
            {data.can.advanceOwnBarberId
              ? t("barber.agenda.state.readOnlyOwnBarber")
              : t("barber.agenda.state.readOnly")}
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
          ownBarberId={data?.can.advanceOwnBarberId ?? null}
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
          canAcceptRequests={data?.can.requests ?? false}
          onAcceptRequest={() => void acceptRequest(detail)}
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
            // El ticket se ofrece, no se abre solo: quien cobra a la fila
            // de gente no quiere una pestaña nueva en cada cobro.
            setToast({
              message: t("barber.agenda.charge.done", { amount: formatMXN(sale.total) }),
              actionLabel: t("barber.agenda.charge.viewTicket"),
              onAction: () =>
                window.open(`/barber/caja/ticket/${sale.id}`, "_blank", "noopener,noreferrer"),
            });
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

      {hovered && hover.anchor ? (
        <HoverCard
          anchor={hover.anchor}
          appointment={hovered}
          timezone={timezone}
          sale={charged[hovered.id] ?? null}
          quickLabel={quickAction(hovered)?.label ?? null}
          draggable={canEdit && Boolean(hovered.barberId) && !isTerminalAppointmentStatus(hovered.status)}
          t={t}
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
