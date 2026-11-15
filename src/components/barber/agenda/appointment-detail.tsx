"use client";

// ═══════════════════════════════════════════════════════════════════════
// La cita abierta desde la Agenda — propuesta B del mockup (ws6-t8), que
// eligió Rafael el 15-nov-2026: VENTANA centrada en escritorio (cliente a la
// izquierda, visita a la derecha, el recorrido cruzando arriba) y HOJA que
// sube desde abajo en celular (pestañas Visita / Cliente, la acción que
// sigue abajo, al alcance del pulgar).
//
// Lo que NO cambió (y no se debe romper):
//   · Los botones de estado NO se inventan: salen de nextStatuses() del
//     contrato (src/lib/barber/types.ts) y se vuelven a filtrar con
//     canTransition(). El primero del flujo lineal es la acción grande.
//   · Rol Barbero (sin agenda.edit): solo «En silla» y «Completada» en SUS
//     visitas (own-visits.ts); el servidor aplica la misma regla.
//   · Una solicitud web/bot sin aceptar NO se «confirma»: se ACEPTA por el
//     camino de Solicitudes (avisa al cliente).
//   · COMPLETAR ENCADENA CON EL COBRO (el puente a Caja de agenda-client).
//   · Cancelar pide confirmación.
//
// Lo nuevo del lado del servidor es de ws6-t5 (contrato fijo, ver
// cita-core.ts). Cada botón que depende de una ruta suya pregunta antes si
// la ruta existe (OPTIONS) y, si no, NO se pinta: nunca un error en pantalla.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Ban,
  Bell,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Hourglass,
  IdCard,
  MessageCircle,
  MoreHorizontal,
  NotebookPen,
  Package,
  Phone,
  Plus,
  Repeat,
  Scissors,
  Signpost,
  Star,
  User,
  UserCheck,
  UserX,
  Wallet,
  X,
} from "lucide-react";
import { formatBarberPhone } from "@/lib/barber/phone-format";
import {
  BARBER_APPOINTMENT_ACTION_LABELS,
  BARBER_APPOINTMENT_STATUS_UI,
  canTransition,
  isTerminalAppointmentStatus,
  nextStatuses,
  type BarberAppointmentDTO,
  type BarberAppointmentStatus,
  type BarberDTO,
  type BarberPaymentMethod,
  type BarberPhotoKind,
  type BarberProductDTO,
} from "@/lib/barber/types";
import {
  BARBER_MAX_APPOINTMENT_MIN,
  appointmentMinutes,
  formatMXN,
  formatMinutes,
  minuteToLabel,
  shopDateISO,
  shopMinuteOfDay,
} from "@/lib/barber/agenda";
import { sumMoneyBy } from "@/lib/barber/money";
import { isOwnVisitStatus } from "@/lib/barber/own-visits";
import { isBarberUnacceptedRequest } from "@/lib/barber/whatsapp-core";
import type { BarberClientDetail } from "@/lib/barber/loyalty";
import type { StarsView } from "@/lib/barber/stars-core";
import type { BarberVisitPhotoView } from "@/lib/barber/clients";
import { PhotoUploader, type UploadedPhoto } from "@/components/barber/clients/photo-uploader";
import { barberColor, initials } from "./agenda-ui";
import type { AppointmentDialogFocus } from "./appointment-dialog";
import {
  CANCEL_REASONS,
  CANCEL_REASON_MAX,
  cancelReasonText,
  citaSteps,
  findNextVisitSlot,
  nextVisitDateISO,
  nextVisitOptions,
  parseDepositAmount,
  routeSupports,
  usualReturnWeeks,
  type CitaDTO,
  type DayWindow,
  type NextSlot,
  type NextVisitResult,
} from "./cita-core";
import css from "./cita.module.css";

type T = (key: string, vars?: Record<string, string | number>) => string;

export interface AppointmentDetailProps {
  appointment: BarberAppointmentDTO;
  timezone: string;
  branchId: string;
  locale?: string;
  canEdit: boolean;
  /**
   * Rol Barbero (sin agenda.edit): id de SU ficha de barbero. En sus propias
   * visitas puede marcar «En silla» y «Completada»; nada más. null = no aplica.
   */
  ownBarberId?: string | null;
  /** clients.view: sin él, ni liga a la ficha ni datos del cliente. */
  canViewClients: boolean;
  /** clients.edit: subir fotos de la visita. */
  canEditClients?: boolean;
  /** cash.manage + el plan incluye caja. */
  canCharge: boolean;
  /** Ticket vivo de esta visita, si ya pasó por caja. */
  sale: { saleId: string; total: number } | null;
  /** Barberos (para el avatar y el nombre en «su próxima»). */
  barbers?: BarberDTO[];
  t: T;
  onClose: () => void;
  /** Abre el diálogo de editar (con el foco en un campo, si se pide). */
  onEdit: (focus?: AppointmentDialogFocus) => void;
  /** «Repetir esta cita»: «Nueva visita» con todo copiado. */
  onRepeat?: () => void;
  onChanged: (appointment: BarberAppointmentDTO, note?: string | null) => void;
  /** Una visita NUEVA creada desde aquí («su próxima»). */
  onCreated?: (appointment: BarberAppointmentDTO, note: string) => void;
  /** Aviso flotante de la agenda. */
  onToast?: (message: string, tone?: "ok" | "bad") => void;
  /** Abre el puente de cobro para esta visita. */
  onCharge: () => void;
  /** requests.manage: puede aceptar solicitudes web/bot. */
  canAcceptRequests?: boolean;
  /** Acepta la solicitud por el camino de Solicitudes (avisa al cliente). */
  onAcceptRequest?: () => void;
}

/** Estados que representan "seguir adelante" (el flujo lineal del contrato). */
const FORWARD: BarberAppointmentStatus[] = ["CONFIRMED", "IN_PROGRESS", "DONE"];
const PLUS_MIN = 15;
const DRAG_CLOSE_PX = 96;
const DEPOSIT_METHODS: BarberPaymentMethod[] = ["CASH", "CARD", "SPEI"];

// ── ¿Ya existe la ruta de ws6-t5? Se pregunta UNA vez por pestaña ─────
type RouteKey = "status" | "arrived" | "remind" | "draftItems" | "deposit";
const ROUTE_PATH: Record<RouteKey, string> = {
  status: "status",
  arrived: "arrived",
  remind: "remind",
  draftItems: "draft-items",
  deposit: "deposit",
};
const probes = new Map<RouteKey, Promise<{ status: number; allow: string | null }>>();
function probeRoute(key: RouteKey, appointmentId: string) {
  let p = probes.get(key);
  if (!p) {
    p = fetch(`/api/barber/appointments/${appointmentId}/${ROUTE_PATH[key]}`, { method: "OPTIONS" })
      .then((r) => ({ status: r.status, allow: r.headers.get("allow") }))
      .catch(() => ({ status: 0, allow: null }));
    probes.set(key, p);
    // Un fallo de red no se queda pegado para toda la sesión.
    void p.then((r) => {
      if (r.status === 0) probes.delete(key);
    });
  }
  return p;
}
interface Routes {
  cancelReason: boolean;
  arrived: boolean;
  remind: boolean;
  draftItems: boolean;
  deposit: boolean;
}
const NO_ROUTES: Routes = { cancelReason: false, arrived: false, remind: false, draftItems: false, deposit: false };

function useServerRoutes(appointmentId: string): Routes {
  const [routes, setRoutes] = useState<Routes>(NO_ROUTES);
  useEffect(() => {
    let alive = true;
    void Promise.all([
      probeRoute("status", appointmentId),
      probeRoute("arrived", appointmentId),
      probeRoute("remind", appointmentId),
      probeRoute("draftItems", appointmentId),
      probeRoute("deposit", appointmentId),
    ]).then(([status, arrived, remind, draft, deposit]) => {
      if (!alive) return;
      setRoutes({
        cancelReason: routeSupports(status.status, status.allow, "PATCH"),
        arrived: routeSupports(arrived.status, arrived.allow, "POST"),
        remind: routeSupports(remind.status, remind.allow, "POST"),
        draftItems: routeSupports(draft.status, draft.allow, "POST"),
        deposit: routeSupports(deposit.status, deposit.allow, "POST"),
      });
    });
    return () => {
      alive = false;
    };
  }, [appointmentId]);
  return routes;
}

// ── Lo del cliente que vive en su ficha ─────────────────────────────────
interface ClientInfo {
  loading: boolean;
  error: boolean;
  detail: BarberClientDetail | null;
  stars: StarsView | null;
}

function useClientInfo(clientId: string | null, enabled: boolean): ClientInfo {
  const [info, setInfo] = useState<ClientInfo>({ loading: false, error: false, detail: null, stars: null });
  useEffect(() => {
    if (!clientId || !enabled) {
      setInfo({ loading: false, error: false, detail: null, stars: null });
      return;
    }
    const controller = new AbortController();
    setInfo({ loading: true, error: false, detail: null, stars: null });
    void Promise.all([
      fetch(`/api/barber/clients/${clientId}`, { signal: controller.signal })
        .then((r) => (r.ok ? (r.json() as Promise<BarberClientDetail>) : null))
        .catch(() => null),
      fetch(`/api/barber/clients/${clientId}/stars`, { signal: controller.signal })
        .then((r) => (r.ok ? (r.json() as Promise<{ stars?: StarsView }>) : null))
        .catch(() => null),
    ]).then(([detail, stars]) => {
      if (controller.signal.aborted) return;
      setInfo({ loading: false, error: !detail, detail, stars: stars?.stars ?? null });
    });
    return () => controller.abort();
  }, [clientId, enabled]);
  return info;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}
function errorOf(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === "string" ? data.error : fallback;
}

// ═══════════════════════════════════════════════════════════════════════
export function AppointmentDetail(props: AppointmentDetailProps) {
  const { t, timezone } = props;
  const appt = props.appointment as CitaDTO;
  const intlLocale = props.locale === "en" ? "en-US" : "es-MX";
  const toast = props.onToast ?? (() => undefined);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"visit" | "client">("visit");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sub, setSub] = useState<null | "cancel" | "deposit" | "product">(null);
  const [showNext, setShowNext] = useState(appt.status === "IN_PROGRESS" || appt.status === "DONE");
  const nextRef = useRef<HTMLDivElement | null>(null);

  const routes = useServerRoutes(appt.id);
  const client = useClientInfo(appt.clientId, props.canViewClients);

  // ── Estado y acción que sigue (misma regla que antes) ────────────────
  const ui = BARBER_APPOINTMENT_STATUS_UI[appt.status];
  const options = nextStatuses(appt.status).filter((s) => canTransition(appt.status, s));
  const isOwnVisit = Boolean(props.ownBarberId) && appt.barberId === props.ownBarberId;
  const canAdvance = (s: BarberAppointmentStatus) => props.canEdit || (isOwnVisit && isOwnVisitStatus(s));
  const isRequest = isBarberUnacceptedRequest(appt);
  const primary = isRequest
    ? null
    : (options.find((s) => FORWARD.includes(s) && canAdvance(s)) ?? null);
  const terminal = isTerminalAppointmentStatus(appt.status);
  const canCancel = props.canEdit && options.includes("CANCELLED");
  const canNoShow = props.canEdit && options.includes("NO_SHOW");

  const minutes = appointmentMinutes(appt);
  const total = sumMoneyBy(appt.services, (s) => s.priceAtBooking);
  const deposit = appt.deposit ?? (appt.depositStatus ? { status: appt.depositStatus, amount: appt.depositAmount } : null);
  const depositPaid = deposit && deposit.status === "PAID" && deposit.amount ? deposit.amount : 0;
  const depositPending = deposit && deposit.status === "PENDING" && deposit.amount ? deposit.amount : 0;
  const due = Math.max(0, total - depositPaid);
  const chargeable =
    props.canCharge && !props.sale && appt.status !== "CANCELLED" && appt.status !== "NO_SHOW";

  const startMinute = shopMinuteOfDay(new Date(appt.startAt), timezone);
  const startLabel = minuteToLabel(startMinute);
  const endLabel = minuteToLabel(shopMinuteOfDay(new Date(appt.endAt), timezone));
  const dayLabel = new Intl.DateTimeFormat(intlLocale, {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(appt.startAt));
  const servicesLabel = appt.services.map((s) => s.serviceName).join(" + ");
  const barberName = appt.barberName || t("barber.agenda.card.noBarber");
  const clientLabel = appt.clientName || t("barber.agenda.card.noClient");
  const phoneDigits = (appt.clientPhone ?? "").replace(/\D/g, "").slice(-10);
  const steps = citaSteps(appt.status);

  const preWait = appt.status === "PENDING" || appt.status === "CONFIRMED";
  const canMarkArrived = props.canEdit && routes.arrived && preWait;
  const canRemind = props.canEdit && routes.remind && preWait && phoneDigits.length === 10;
  const canAddProduct = props.canCharge && routes.draftItems && !props.sale && !["CANCELLED", "NO_SHOW"].includes(appt.status);
  const canDeposit = props.canCharge && routes.deposit && !terminal && !props.sale && depositPaid === 0;
  const canNextVisit = props.canEdit && Boolean(appt.clientName || appt.clientId) && appt.status !== "CANCELLED";

  // ── Cliente: visitas, ritmo, preferencias ─────────────────────────────
  const detail = client.detail;
  const totalVisits = appt.client?.totalVisits ?? detail?.client.totalVisits ?? null;
  const realVisits = useMemo(() => {
    if (!detail) return [] as { at: string; barberName: string | null }[];
    return detail.history.entries
      .filter((e) => e.id !== appt.id && (e.kind === "sale" || (e.kind === "appointment" && e.status === "DONE")))
      .map((e) => ({ at: e.at, barberName: e.barberName }));
  }, [detail, appt.id]);
  const usual = useMemo(() => usualReturnWeeks(realVisits.map((v) => v.at), timezone), [realVisits, timezone]);
  const lastVisit = useMemo(() => {
    const before = realVisits.filter((v) => new Date(v.at).getTime() < new Date(appt.startAt).getTime());
    before.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return before[0] ?? null;
  }, [realVisits, appt.startAt]);
  const isNewClient = totalVisits === 0;

  // ── Acciones ──────────────────────────────────────────────────────────
  const generic = t("barber.agenda.queue.errors.generic");

  /** Vuelve a leer la visita (tras una acción de ws6-t5 que no la devuelva). */
  const refresh = useCallback(
    async (note?: string | null) => {
      const res = await fetch(`/api/barber/appointments/${appt.id}`);
      if (!res.ok) return;
      const data = await readJson(res);
      if (data.appointment) props.onChanged(data.appointment as BarberAppointmentDTO, note);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appt.id, props.onChanged],
  );

  const move = async (to: BarberAppointmentStatus, reason?: string | null) => {
    if (!canTransition(appt.status, to)) return;
    setBusy(to);
    setError(null);
    try {
      // El motivo viaja solo si ws6-t5 ya montó el PATCH; si no, el POST de
      // siempre (sin motivo).
      const withReason = to === "CANCELLED" && routes.cancelReason;
      const res = await fetch(`/api/barber/appointments/${appt.id}/status`, {
        method: withReason ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          withReason ? { to, reason: reason ?? null, branchId: props.branchId } : { to, branchId: props.branchId },
        ),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(errorOf(data, generic));
        return;
      }
      const updated = data.appointment as BarberAppointmentDTO | undefined;
      const note =
        typeof data.remindersInvalidated === "number" && data.remindersInvalidated > 0
          ? t("barber.agenda.move.remindersCancelled")
          : null;
      setSub(null);
      if (updated) props.onChanged(updated, note);
      else await refresh(note);
      // Completar y cobrar son UN solo movimiento del mostrador.
      if (to === "DONE" && props.canCharge) props.onCharge();
    } catch {
      setError(generic);
    } finally {
      setBusy(null);
    }
  };

  const patch = async (key: string, body: Record<string, unknown>, okNote: string) => {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/barber/appointments/${appt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, branchId: props.branchId }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        // 409 = no cabe: el motivo del servidor, tal cual.
        setError(errorOf(data, generic));
        return false;
      }
      props.onChanged(data.appointment as BarberAppointmentDTO, okNote);
      return true;
    } catch {
      setError(generic);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const plus15 = () =>
    void patch(
      "plus15",
      { durationMin: minutes + PLUS_MIN },
      t("barber.agenda.cita.facts.plus15Saved", { duration: formatMinutes(minutes + PLUS_MIN) }),
    );

  const postAction = async (key: RouteKey, method: "POST" | "DELETE", body?: Record<string, unknown>) => {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/barber/appointments/${appt.id}/${ROUTE_PATH[key]}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(body ?? {}), branchId: props.branchId }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(errorOf(data, generic));
        return null;
      }
      return data;
    } catch {
      setError(generic);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const toggleArrived = async () => {
    setMenuOpen(false);
    const data = await postAction("arrived", appt.arrivedAt ? "DELETE" : "POST");
    if (!data) return;
    const note = appt.arrivedAt ? null : t("barber.agenda.cita.actions.arrivedSaved");
    if (data.appointment) props.onChanged(data.appointment as BarberAppointmentDTO, note);
    else await refresh(note);
  };

  const remind = async () => {
    setMenuOpen(false);
    const data = await postAction("remind", "POST");
    if (!data) return;
    if (data.sent) toast(t("barber.agenda.cita.actions.remindSent"));
    else if (data.queued) toast(t("barber.agenda.cita.actions.remindQueued"));
    else toast(t("barber.agenda.cita.actions.remindNot", { reason: String(data.reason ?? "—") }), "bad");
  };

  const openNext = () => {
    setMenuOpen(false);
    setShowNext(true);
    setTab("visit");
    window.setTimeout(() => nextRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 30);
  };

  // ── Cerrar: Esc, botón, velo, y arrastrar la hoja hacia abajo ────────
  const winRef = useRef<HTMLDivElement | null>(null);
  const downOnVelo = useRef(false);
  const close = props.onClose;
  useEffect(() => {
    const back = document.activeElement;
    winRef.current?.focus();
    return () => {
      if (back instanceof HTMLElement) back.focus();
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (menuOpen) setMenuOpen(false);
      else if (sub) setSub(null);
      else close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen, sub, close]);

  const drag = useRef<{ y: number; dy: number; id: number } | null>(null);
  const onDragStart = (e: React.PointerEvent) => {
    // Solo la hoja (celular) se arrastra, y nunca desde un botón.
    if (!winRef.current || winRef.current.getBoundingClientRect().width > 720) return;
    if ((e.target as HTMLElement).closest("button, a, input, textarea, select")) return;
    drag.current = { y: e.clientY, dy: 0, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !winRef.current) return;
    d.dy = Math.max(0, e.clientY - d.y);
    winRef.current.style.transform = `translateY(${d.dy}px)`;
  };
  const onDragEnd = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.dy > DRAG_CLOSE_PX) {
      close();
      return;
    }
    if (winRef.current) winRef.current.style.transform = "";
  };

  // ── Pie: la acción que sigue ──────────────────────────────────────────
  let go: React.ReactNode = null;
  if (isRequest && props.canEdit) {
    go =
      props.canAcceptRequests && props.onAcceptRequest ? (
        <button
          type="button"
          className={css.go}
          data-accept-request=""
          onClick={props.onAcceptRequest}
          disabled={busy !== null}
        >
          <CheckCircle2 size={18} /> {t("barber.agenda.request.accept")}
        </button>
      ) : (
        <Link href="/barber/solicitudes" className={css.go}>
          {t("barber.agenda.request.view")}
        </Link>
      );
  } else if (primary) {
    const money = primary === "DONE" && chargeable;
    go = (
      <button
        type="button"
        className={`${css.go} ${money ? css.goMoney : ""}`}
        onClick={() => void move(primary)}
        disabled={busy !== null}
      >
        {primary === "IN_PROGRESS" ? <Scissors size={18} /> : primary === "DONE" ? <Wallet size={18} /> : <CheckCircle2 size={18} />}
        {money
          ? t("barber.agenda.cita.actions.completeAndCharge", { amount: formatMXN(due) })
          : BARBER_APPOINTMENT_ACTION_LABELS[primary]}
      </button>
    );
  } else if (chargeable && terminal) {
    go = (
      <button type="button" className={`${css.go} ${css.goMoney}`} onClick={props.onCharge} disabled={busy !== null}>
        <Wallet size={18} /> {t("barber.agenda.cita.actions.charge", { amount: formatMXN(due) })}
      </button>
    );
  } else if (canNextVisit && (appt.status === "DONE" || props.sale)) {
    go = (
      <button type="button" className={css.go} onClick={openNext} disabled={busy !== null}>
        <CalendarPlus size={18} /> {t("barber.agenda.cita.actions.nextVisit")}
      </button>
    );
  }

  // ── Menú «Más»: lo raro ───────────────────────────────────────────────
  const menuVisit: { key: string; icon: React.ReactNode; label: string; onClick: () => void }[] = [];
  if (canRemind) menuVisit.push({ key: "remind", icon: <Bell size={16} />, label: t("barber.agenda.cita.actions.remind"), onClick: () => void remind() });
  if (props.canEdit && props.onRepeat) menuVisit.push({ key: "repeat", icon: <Repeat size={16} />, label: t("barber.agenda.cita.actions.repeat"), onClick: () => { setMenuOpen(false); props.onRepeat?.(); } });
  if (canNextVisit && !showNext) menuVisit.push({ key: "next", icon: <CalendarPlus size={16} />, label: t("barber.agenda.cita.actions.nextVisit"), onClick: openNext });
  if (canDeposit) menuVisit.push({ key: "deposit", icon: <Wallet size={16} />, label: t("barber.agenda.cita.actions.deposit"), onClick: () => { setMenuOpen(false); setSub("deposit"); } });
  if (canMarkArrived && appt.arrivedAt) menuVisit.push({ key: "arrivedUndo", icon: <UserX size={16} />, label: t("barber.agenda.cita.actions.arrivedUndo"), onClick: () => void toggleArrived() });
  const hasMenu = menuVisit.length > 0 || canCancel;

  const moreButton = (extraClass: string) =>
    hasMenu ? (
      <div className={extraClass}>
        <button
          type="button"
          className={css.btn}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={t("barber.agenda.cita.more")}
        >
          <span className={css.moreLabel}>{t("barber.agenda.cita.more")}</span>
          <MoreHorizontal size={16} />
        </button>
      </div>
    ) : null;

  const tc: T = (key, vars) => t(`barber.clientes.${key}`, vars);

  return (
    <div
      className={css.velo}
      role="presentation"
      onPointerDown={(e) => {
        downOnVelo.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnVelo.current) close();
      }}
    >
      <div
        ref={winRef}
        className={css.win}
        role="dialog"
        aria-modal="true"
        aria-label={appt.clientName ? t("barber.agenda.cita.title", { name: appt.clientName }) : t("barber.agenda.cita.titleNoClient")}
        tabIndex={-1}
        data-cita-ventana=""
      >
        <div
          className={css.grab}
          aria-hidden="true"
          title={t("barber.agenda.cita.grab")}
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        />

        {/* ── Cabecera ── */}
        <div
          className={css.head}
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <div className={css.headMain}>
            <div className={css.headRow}>
              <span className={css.pill} data-status={appt.status}>
                {ui.label}
              </span>
              <span className={css.headClientMobile}>
                {clientLabel}
                {isNewClient ? <span> · {t("barber.agenda.cita.client.new").toLowerCase()}</span> : null}
              </span>
            </div>
            <div className={css.headRow}>
              <h2 className={css.headWhen}>
                {startLabel} – {endLabel}
              </h2>
              <span className={css.headWho}>
                {appt.barberId ? (
                  <span className={css.av} style={{ background: barberColor(appt.barberId) }} aria-hidden="true">
                    {initials(barberName)}
                  </span>
                ) : null}
                {barberName}
              </span>
            </div>
            <p className={css.headDay}>
              {dayLabel}
              {servicesLabel ? ` · ${servicesLabel}` : ""}
            </p>
          </div>
          <div className={css.headActs}>
            {moreButton(css.moreHead)}
            <button type="button" className={css.iconBtn} onClick={close} aria-label={t("barber.agenda.actions.close")}>
              <X size={18} />
            </button>
          </div>

          {steps ? (
            <ol className={css.track} aria-label={t("barber.agenda.detail.status")}>
              {steps.map((s) => (
                <li key={s.status} data-state={s.state} aria-current={s.state === "now" ? "step" : undefined}>
                  {t(`barber.agenda.cita.steps.${s.status}`)}
                  {s.state === "now" ? <span className={css.trackNow}>{t("barber.agenda.cita.stepNow")}</span> : null}
                </li>
              ))}
            </ol>
          ) : (
            <div className={`${css.banner} ${css.bannerBad}`}>
              {appt.status === "CANCELLED" ? <Ban size={16} /> : <UserX size={16} />}
              {appt.status === "CANCELLED"
                ? appt.cancelReason
                  ? t("barber.agenda.cita.cancelledWith", { reason: appt.cancelReason })
                  : t("barber.agenda.cita.cancelled")
                : t("barber.agenda.cita.noShow")}
            </div>
          )}

          {isRequest ? (
            <div className={`${css.banner} ${css.bannerWait}`}>
              <Hourglass size={16} /> {t("barber.agenda.request.pending")}
            </div>
          ) : null}
          {appt.arrivedAt && preWait ? (
            <div className={`${css.banner} ${css.bannerWait}`}>
              <UserCheck size={16} />
              {t("barber.agenda.cita.arrivedAt", {
                time: minuteToLabel(shopMinuteOfDay(new Date(appt.arrivedAt), timezone)),
              })}
            </div>
          ) : null}
          {props.sale ? (
            <div className={`${css.banner} ${css.bannerOk}`}>
              <CheckCircle2 size={16} />
              <span>
                {t("barber.agenda.cita.money.paidBanner", { amount: formatMXN(props.sale.total) })}{" "}
                <Link href={`/barber/caja/ticket/${props.sale.saleId}`} className={css.lnk} target="_blank">
                  {t("barber.agenda.detail.viewTicket")}
                </Link>
              </span>
            </div>
          ) : null}

          <div className={css.tabs} role="tablist">
            {(["visit", "client"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                className={css.tab}
                aria-selected={tab === k}
                onClick={() => setTab(k)}
              >
                {t(`barber.agenda.cita.tabs.${k}`)}
              </button>
            ))}
          </div>
        </div>

        {/* ── Cuerpo ── */}
        <div className={css.body} data-tab={tab}>
          <ClientColumn
            appt={appt}
            info={client}
            canViewClients={props.canViewClients}
            phoneDigits={phoneDigits}
            totalVisits={totalVisits}
            usual={usual}
            lastVisit={lastVisit}
            timezone={timezone}
            intlLocale={intlLocale}
            t={t}
          />

          <div className={css.vis}>
            {error ? (
              <div className={css.errorBox} role="alert">
                {error}
              </div>
            ) : null}

            <div className={css.facts}>
              <div className={css.fact}>
                <Signpost size={16} />
                <span className={css.factK}>{t("barber.agenda.cita.facts.barber")}</span>
                <span className={css.factV}>{barberName}</span>
                {props.canEdit && !terminal ? (
                  <span className={css.factActs}>
                    <button type="button" className={css.lnk} onClick={() => props.onEdit("barber")} disabled={busy !== null}>
                      {t("barber.agenda.cita.facts.changeBarber")}
                    </button>
                  </span>
                ) : null}
              </div>
              <div className={css.fact}>
                <Clock size={16} />
                <span className={css.factK}>{t("barber.agenda.cita.facts.time")}</span>
                <span className={css.factV}>
                  {startLabel} <small>· {formatMinutes(minutes)}</small>
                </span>
                {props.canEdit && !terminal ? (
                  <span className={css.factActs}>
                    <button type="button" className={css.lnk} onClick={() => props.onEdit("time")} disabled={busy !== null}>
                      {t("barber.agenda.cita.facts.moveTime")}
                    </button>
                    <button
                      type="button"
                      className={css.lnk}
                      onClick={plus15}
                      disabled={busy !== null || minutes + PLUS_MIN > BARBER_MAX_APPOINTMENT_MIN}
                      title={t("barber.agenda.cita.facts.plus15Title")}
                    >
                      {busy === "plus15" ? t("barber.agenda.modal.saving") : t("barber.agenda.cita.facts.plus15")}
                    </button>
                  </span>
                ) : null}
              </div>
              <div className={css.fact}>
                <MessageCircle size={16} />
                <span className={css.factK}>{t("barber.agenda.cita.facts.source")}</span>
                <span className={css.factV}>{t(`barber.agenda.detail.sources.${appt.source}`)}</span>
              </div>
            </div>

            {/* Servicios con su precio CONGELADO al reservar. */}
            <section className={css.blk}>
              <div className={css.blkHead}>
                <span className={css.grow}>{t("barber.agenda.cita.money.title")}</span>
              </div>
              <div className={css.lines}>
                {appt.services.length === 0 ? (
                  <p className={css.muted}>{t("barber.agenda.card.noServices")}</p>
                ) : (
                  appt.services.map((s) => (
                    <div key={s.id} className={css.line}>
                      <Scissors size={16} />
                      <span className={css.lineN}>{s.serviceName}</span>
                      <span className={css.lineP}>{formatMXN(s.priceAtBooking)}</span>
                    </div>
                  ))
                )}
              </div>
              {(props.canEdit && !terminal) || canAddProduct ? (
                <div className={css.lineAdd}>
                  {props.canEdit && !terminal ? (
                    <button type="button" className={css.lnk} onClick={() => props.onEdit("services")} disabled={busy !== null}>
                      <Plus size={15} /> {t("barber.agenda.cita.money.change")}
                    </button>
                  ) : null}
                  {canAddProduct ? (
                    <button type="button" className={css.lnk} onClick={() => setSub("product")} disabled={busy !== null}>
                      <Package size={15} /> {t("barber.agenda.cita.money.addProduct")}
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className={css.sum}>
                <span>{t("barber.agenda.detail.total")}</span>
                <span className={css.sumR}>{formatMXN(total)}</span>
                {depositPaid > 0 ? (
                  <>
                    <span className={css.sumDep}>{t("barber.agenda.cita.money.deposit")}</span>
                    <span className={`${css.sumR} ${css.sumDep}`}>−{formatMXN(depositPaid)}</span>
                  </>
                ) : null}
                {depositPending > 0 ? (
                  <>
                    <span>{t("barber.agenda.cita.money.depositPending")}</span>
                    <span className={css.sumR}>{formatMXN(depositPending)}</span>
                  </>
                ) : null}
                {!props.sale ? (
                  <>
                    <span className={css.sumTot}>{t("barber.agenda.cita.money.due")}</span>
                    <span className={`${css.sumR} ${css.sumTot}`}>{formatMXN(due)}</span>
                  </>
                ) : null}
              </div>
              {chargeable && terminal ? <p className={css.small}>{t("barber.agenda.detail.chargeSkipHint")}</p> : null}
            </section>

            {canNextVisit && showNext ? (
              <div ref={nextRef}>
                <NextVisit
                  appt={appt}
                  usual={usual}
                  timezone={timezone}
                  branchId={props.branchId}
                  intlLocale={intlLocale}
                  barbers={props.barbers ?? []}
                  onRepeat={props.onRepeat}
                  onCreated={props.onCreated}
                  t={t}
                />
              </div>
            ) : null}

            <VisitNote
              key={appt.id}
              appt={appt}
              canEdit={props.canEdit}
              busy={busy}
              onSave={(notes) => patch("notes", { notes }, t("barber.agenda.cita.note.saved"))}
              t={t}
            />

            {appt.clientId && props.canViewClients ? (
              <VisitPhotos
                appointmentId={appt.id}
                clientId={appt.clientId}
                canUpload={Boolean(props.canEditClients) && appt.status !== "CANCELLED"}
                t={t}
                tc={tc}
                onMessage={(m) => toast(m)}
              />
            ) : null}
          </div>
        </div>

        {/* ── Pie ── */}
        <div className={css.foot}>
          {canMarkArrived && !appt.arrivedAt && appt.barberName ? (
            <p className={css.footNote}>{t("barber.agenda.cita.foot.waiting", { barber: appt.barberName })}</p>
          ) : canMarkArrived && !appt.arrivedAt ? (
            <p className={css.footNote}>{t("barber.agenda.cita.foot.waitingNoBarber")}</p>
          ) : (
            <span className={css.grow} />
          )}
          {canNoShow ? (
            <button
              type="button"
              className={`${css.btn} ${css.alt}`}
              onClick={() => void move("NO_SHOW")}
              disabled={busy !== null}
            >
              <UserX size={16} /> {t("barber.agenda.cita.actions.noShow")}
            </button>
          ) : null}
          {canMarkArrived && !appt.arrivedAt ? (
            <button
              type="button"
              className={`${css.btn} ${css.alt}`}
              onClick={() => void toggleArrived()}
              disabled={busy !== null}
            >
              <UserCheck size={16} /> {t("barber.agenda.cita.actions.arrived")}
            </button>
          ) : null}
          {moreButton(css.moreFoot)}
          {go}
        </div>

        {/* ── Menú «Más» ── */}
        {menuOpen ? (
          <>
            <div className={css.menuVelo} onClick={() => setMenuOpen(false)} aria-hidden="true" />
            <div className={css.menu} role="menu">
              {menuVisit.length > 0 ? (
                <div className={css.menuG}>
                  <p>{t("barber.agenda.cita.moreGroupVisit")}</p>
                  {menuVisit.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      role="menuitem"
                      className={css.menuItem}
                      onClick={m.onClick}
                      disabled={busy !== null}
                    >
                      {m.icon} {m.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {canCancel ? (
                <div className={css.menuG}>
                  <p>{t("barber.agenda.cita.moreGroupStatus")}</p>
                  <button
                    type="button"
                    role="menuitem"
                    className={`${css.menuItem} ${css.menuDanger}`}
                    onClick={() => {
                      setMenuOpen(false);
                      setSub("cancel");
                    }}
                    disabled={busy !== null}
                  >
                    <Ban size={16} /> {t("barber.agenda.cita.actions.cancel")}
                  </button>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {/* ── Paneles encima ── */}
        {sub === "cancel" ? (
          <CancelPanel
            name={clientLabel}
            withReason={routes.cancelReason}
            busy={busy !== null}
            onBack={() => setSub(null)}
            onConfirm={(reason) => void move("CANCELLED", reason)}
            t={t}
          />
        ) : null}
        {sub === "deposit" ? (
          <DepositPanel
            max={total > 0 ? total : null}
            busy={busy !== null}
            onBack={() => setSub(null)}
            onConfirm={async (amount, method) => {
              const data = await postAction("deposit", "POST", { amount, method });
              if (!data) return;
              setSub(null);
              const note = t("barber.agenda.cita.deposit.saved", { amount: formatMXN(amount) });
              if (data.appointment) props.onChanged(data.appointment as BarberAppointmentDTO, note);
              else await refresh(note);
            }}
            t={t}
          />
        ) : null}
        {sub === "product" ? (
          <ProductPanel
            busy={busy !== null}
            onBack={() => setSub(null)}
            onConfirm={async (product, qty) => {
              const data = await postAction("draftItems", "POST", { productId: product.id, qty });
              if (!data) return;
              setSub(null);
              toast(t("barber.agenda.cita.product.added", { product: product.name }));
            }}
            t={t}
          />
        ) : null}
      </div>
    </div>
  );
}

// ═══ Columna del cliente ═══════════════════════════════════════════════
function ClientColumn(props: {
  appt: CitaDTO;
  info: ClientInfo;
  canViewClients: boolean;
  phoneDigits: string;
  totalVisits: number | null;
  usual: number | null;
  lastVisit: { at: string; barberName: string | null } | null;
  timezone: string;
  intlLocale: string;
  t: T;
}) {
  const { appt, info, t } = props;
  const name = appt.clientName || t("barber.agenda.card.noClient");
  const fileHref = appt.clientId && props.canViewClients ? `/barber/clientes/${appt.clientId}` : null;
  const prefs = info.detail?.preferences ?? null;
  const isNew = props.totalVisits === 0;

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(props.intlLocale, { timeZone: props.timezone, day: "numeric", month: "short", year: "numeric" }).format(
      new Date(iso),
    );

  return (
    <div className={css.cli}>
      <div className={css.cl}>
        <span className={css.clAv} aria-hidden="true">
          {appt.clientName ? initials(appt.clientName) : <User size={20} />}
        </span>
        <div style={{ minWidth: 0 }}>
          <h3 className={css.clName}>{fileHref ? <Link href={fileHref}>{name}</Link> : name}</h3>
          <div className={css.clMeta}>
            {isNew ? <span className={css.tagNew}>{t("barber.agenda.cita.client.new")}</span> : null}
            {props.totalVisits && props.totalVisits > 0 ? (
              <span>{t("barber.agenda.cita.client.visits", { count: props.totalVisits })}</span>
            ) : null}
            {appt.clientPhone ? (
              props.phoneDigits.length === 10 ? (
                <a href={`tel:+52${props.phoneDigits}`}>{formatBarberPhone(appt.clientPhone)}</a>
              ) : (
                <span>{formatBarberPhone(appt.clientPhone)}</span>
              )
            ) : null}
          </div>
        </div>
      </div>

      {props.phoneDigits.length === 10 || fileHref ? (
        <div className={css.contact}>
          {props.phoneDigits.length === 10 ? (
            <>
              <a
                className={css.btn}
                href={`https://wa.me/52${props.phoneDigits}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle size={16} /> {t("barber.agenda.cita.client.whatsapp")}
              </a>
              <a className={css.btn} href={`tel:+52${props.phoneDigits}`}>
                <Phone size={16} /> {t("barber.agenda.cita.client.call")}
              </a>
            </>
          ) : null}
          {fileHref ? (
            <Link className={css.btn} href={fileHref}>
              <IdCard size={16} /> {t("barber.agenda.cita.client.file")}
            </Link>
          ) : null}
        </div>
      ) : null}

      {!appt.clientId ? <p className={css.small}>{t("barber.agenda.cita.client.none")}</p> : null}
      {info.loading ? <p className={css.small}>{t("barber.agenda.cita.client.loading")}</p> : null}
      {info.error ? <p className={css.small}>{t("barber.agenda.cita.client.loadError")}</p> : null}

      <StarsBlock info={info} starsFromDto={appt.client?.stars ?? null} isNew={isNew} t={t} />

      {appt.clientId && props.canViewClients && !info.loading && !info.error ? (
        <section className={css.blk}>
          <div className={css.blkHead}>
            <Scissors size={15} />
            <span className={css.grow}>{t("barber.agenda.cita.likes.title")}</span>
          </div>
          {prefs && hasPrefs(prefs) ? (
            <dl className={css.corte}>
              {PREF_ROWS.filter((r) => prefs[r.key]).map((r) => (
                <div key={r.key} className={`${r.full ? css.full : ""} ${r.key === "avoidProducts" ? css.avoid : ""}`}>
                  <dt>{t(`barber.clientes.preferences.${r.key}`)}</dt>
                  <dd>{prefs[r.key]}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className={css.vacio}>
              <p>{isNew ? t("barber.agenda.cita.likes.emptyNew") : t("barber.agenda.cita.likes.empty")}</p>
              {fileHref ? (
                <Link className={css.btn} href={fileHref}>
                  <NotebookPen size={15} /> {t("barber.agenda.cita.likes.edit")}
                </Link>
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      {appt.clientId && props.canViewClients && info.detail ? (
        <section className={css.blk}>
          <div className={css.blkHead}>
            <span className={css.grow}>{t("barber.agenda.cita.history.title")}</span>
          </div>
          {props.lastVisit ? (
            <p className={css.muted}>
              {props.lastVisit.barberName
                ? t("barber.agenda.cita.history.last", { date: fmtDate(props.lastVisit.at), barber: props.lastVisit.barberName })
                : t("barber.agenda.cita.history.lastNoBarber", { date: fmtDate(props.lastVisit.at) })}
            </p>
          ) : (
            <p className={css.muted}>{t("barber.agenda.cita.history.none")}</p>
          )}
          {props.usual ? (
            <p className={css.muted}>
              {props.usual === 1
                ? t("barber.agenda.cita.history.usualOne")
                : t("barber.agenda.cita.history.usual", { weeks: props.usual })}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

const PREF_ROWS: { key: keyof BarberClientDetail["preferences"]; full?: boolean }[] = [
  { key: "clipperNumber" },
  { key: "fade" },
  { key: "topLength" },
  { key: "sideLength" },
  { key: "part" },
  { key: "beard" },
  { key: "products", full: true },
  { key: "avoidProducts", full: true },
  { key: "barberNotes", full: true },
];
function hasPrefs(p: BarberClientDetail["preferences"]): boolean {
  return PREF_ROWS.some((r) => Boolean(p[r.key]));
}

function StarsBlock(props: { info: ClientInfo; starsFromDto: number | null; isNew: boolean; t: T }) {
  const { info, t } = props;
  const sv = info.stars;
  if (sv && sv.enabled) {
    const filled = Math.min(sv.stars, sv.slots);
    return (
      <section className={css.blk}>
        <div className={css.blkHead}>{t("barber.agenda.cita.stars.title")}</div>
        <div className={css.stars}>
          <span className={css.starsRow} aria-hidden="true">
            {Array.from({ length: sv.slots }, (_, i) => (
              <Star key={i} size={13} fill="currentColor" data-off={i >= filled ? "" : undefined} />
            ))}
          </span>
          <span className={css.starsTxt}>
            <b>{t("barber.agenda.cita.stars.count", { stars: sv.stars, slots: sv.slots })}</b>
          </span>
        </div>
        <p className={css.muted}>
          {sv.available.length > 0
            ? t("barber.agenda.cita.stars.ready", { bonus: sv.available[0].name })
            : sv.stars === 0 && props.isNew
              ? t("barber.agenda.cita.stars.first")
              : sv.next
                ? t("barber.agenda.cita.stars.next", { remaining: sv.next.remaining, bonus: sv.next.bonus.name })
                : null}
        </p>
      </section>
    );
  }
  // Sin tarjeta de estrellas: los sellos de lealtad de la ficha, si están encendidos.
  const loyalty = info.detail?.loyalty;
  if (loyalty && loyalty.enabled) {
    return (
      <section className={css.blk}>
        <div className={css.blkHead}>{t("barber.agenda.cita.stars.stamps")}</div>
        <div className={css.stars}>
          <span className={css.starsTxt}>
            <b>{t("barber.agenda.cita.stars.stampsCount", { count: loyalty.progress, threshold: loyalty.threshold })}</b>
          </span>
        </div>
        {loyalty.rewardAvailable ? (
          <p className={css.muted}>{t("barber.agenda.cita.stars.stampsReady", { reward: loyalty.reward })}</p>
        ) : null}
      </section>
    );
  }
  if (props.starsFromDto !== null && !info.loading) {
    return (
      <section className={css.blk}>
        <div className={css.blkHead}>{t("barber.agenda.cita.stars.title")}</div>
        <span className={css.starsTxt}>
          <b>{props.starsFromDto}</b>
        </span>
      </section>
    );
  }
  return null;
}

// ═══ Nota de la visita (editable con agenda.edit) ══════════════════════
function VisitNote(props: {
  appt: CitaDTO;
  canEdit: boolean;
  busy: string | null;
  onSave: (notes: string | null) => Promise<boolean>;
  t: T;
}) {
  const { t } = props;
  const saved = props.appt.notes ?? "";
  const [text, setText] = useState(saved);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setText(saved);
  }, [saved, dirty]);

  return (
    <section className={css.blk}>
      <div className={css.blkHead}>
        <NotebookPen size={15} />
        <span className={css.grow}>{t("barber.agenda.cita.note.title")}</span>
        <span className={css.small}>{t("barber.agenda.cita.note.hint")}</span>
      </div>
      {props.canEdit ? (
        <>
          <textarea
            className={css.textarea}
            value={text}
            maxLength={500}
            placeholder={t("barber.agenda.cita.note.placeholder")}
            aria-label={t("barber.agenda.cita.note.title")}
            onChange={(e) => {
              setText(e.target.value);
              setDirty(e.target.value !== saved);
            }}
          />
          {dirty ? (
            <div>
              <button
                type="button"
                className={css.btn}
                disabled={props.busy !== null}
                onClick={async () => {
                  const ok = await props.onSave(text.trim() || null);
                  if (ok) setDirty(false);
                }}
              >
                {props.busy === "notes" ? t("barber.agenda.modal.saving") : t("barber.agenda.cita.note.save")}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className={saved ? css.noteRead : css.small}>{saved || t("barber.agenda.cita.note.empty")}</p>
      )}
    </section>
  );
}

// ═══ Fotos antes / después (el cargador de la ficha) ═══════════════════
function VisitPhotos(props: {
  appointmentId: string;
  clientId: string;
  canUpload: boolean;
  t: T;
  tc: T;
  onMessage: (m: string) => void;
}) {
  const { t } = props;
  const [photos, setPhotos] = useState<BarberVisitPhotoView[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/barber/clients/${props.clientId}/photos?appointmentId=${props.appointmentId}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ photos?: BarberVisitPhotoView[] }>) : null))
      .then((d) => {
        if (!controller.signal.aborted) setPhotos(d?.photos ?? []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [props.clientId, props.appointmentId]);

  if (photos === null) return null;
  if (photos.length === 0 && !props.canUpload) return null;
  return (
    <section className={css.blk}>
      <div className={css.blkHead}>
        <span className={css.grow}>{t("barber.agenda.cita.photos.title")}</span>
      </div>
      {photos.length > 0 ? (
        <div className={css.fotos}>
          {photos.map((p) => (
            <figure key={p.id} className={css.foto}>
              {p.signedUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={p.signedUrl} alt="" decoding="async" loading="lazy" />
              ) : null}
              <figcaption>{t(`barber.agenda.cita.photos.kinds.${p.kind as BarberPhotoKind}`)}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <p className={css.small}>{t("barber.agenda.cita.photos.empty")}</p>
      )}
      {props.canUpload ? (
        <PhotoUploader
          clientId={props.clientId}
          appointmentId={props.appointmentId}
          canPublish={false}
          t={props.tc}
          onUploaded={(photo: UploadedPhoto) =>
            setPhotos((list) => [...(list ?? []), photo as unknown as BarberVisitPhotoView])
          }
          onMessage={props.onMessage}
        />
      ) : null}
    </section>
  );
}

// ═══ Agendar su próxima (2 / 3 / 4 semanas) ════════════════════════════
function NextVisit(props: {
  appt: CitaDTO;
  usual: number | null;
  timezone: string;
  branchId: string;
  intlLocale: string;
  barbers: BarberDTO[];
  onRepeat?: () => void;
  onCreated?: (appointment: BarberAppointmentDTO, note: string) => void;
  t: T;
}) {
  const { appt, t, timezone } = props;
  const [weeks, setWeeks] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "searching" | "ready" | "error" | "saving">("idle");
  const [result, setResult] = useState<NextVisitResult | null>(null);
  const [picked, setPicked] = useState<NextSlot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const barber = props.barbers.find((b) => b.id === appt.barberId);
  const barberName = barber ? barber.nickname || barber.name : appt.barberName || t("barber.agenda.card.noBarber");
  const fmtDay = (dateISO: string) =>
    new Intl.DateTimeFormat(props.intlLocale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
      new Date(`${dateISO}T12:00:00Z`),
    );
  const fmtTime = (d: Date) => minuteToLabel(shopMinuteOfDay(d, timezone));

  const search = async (w: number) => {
    setWeeks(w);
    setPicked(null);
    setError(null);
    setResult(null);
    setState("searching");
    try {
      const dateISO = nextVisitDateISO(appt.startAt, w, timezone);
      const res = await fetch(`/api/barber/appointments?date=${dateISO}&days=1&branchId=${props.branchId}`);
      if (!res.ok) {
        setState("error");
        return;
      }
      const day = (await res.json()) as DayWindow;
      const r = findNextVisitSlot({ appointment: appt, weeks: w, timezone, day, now: new Date() });
      setResult(r);
      setPicked(r?.exact ?? null);
      setState("ready");
    } catch {
      setState("error");
    }
  };

  const book = async () => {
    if (!picked) return;
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/barber/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: props.branchId,
          barberId: picked.barberId,
          startAt: picked.startAt.toISOString(),
          serviceIds: appt.services.map((s) => s.serviceId),
          // Dura lo mismo que esta (si se alargó, la próxima también).
          durationMin: appointmentMinutes(appt),
          notes: null,
          clientId: appt.clientId,
          clientName: appt.clientName ?? "",
          clientPhone: appt.clientPhone ?? "",
        }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(errorOf(data, t("barber.agenda.queue.errors.generic")));
        setState("ready");
        return;
      }
      const note = t("barber.agenda.cita.next.created", {
        day: fmtDay(shopDateISO(picked.startAt, timezone)),
        time: fmtTime(picked.startAt),
      });
      props.onCreated?.(data.appointment as BarberAppointmentDTO, note);
      setWeeks(null);
      setResult(null);
      setPicked(null);
      setState("idle");
    } catch {
      setError(t("barber.agenda.queue.errors.generic"));
      setState("ready");
    }
  };

  const options = nextVisitOptions(props.usual);

  return (
    <section className={css.next} aria-live="polite">
      <div className={css.blkHead}>
        <CalendarPlus size={15} />
        <span className={css.grow}>{t("barber.agenda.cita.next.title")}</span>
        {props.usual ? <span className={css.chipUsual}>{t("barber.agenda.cita.next.usual", { weeks: props.usual })}</span> : null}
      </div>
      {!appt.barberId ? (
        <p className={css.muted}>{t("barber.agenda.cita.next.noBarber")}</p>
      ) : (
        <div className={css.chips}>
          {options.map((w) => (
            <button
              key={w}
              type="button"
              className={css.chip}
              aria-pressed={weeks === w}
              aria-label={t("barber.agenda.cita.next.weeksLabel", { weeks: w })}
              onClick={() => void search(w)}
              disabled={state === "searching" || state === "saving"}
            >
              {t("barber.agenda.cita.next.weeks", { weeks: w })}
            </button>
          ))}
        </div>
      )}
      {state === "searching" ? <p className={css.small}>{t("barber.agenda.cita.next.searching")}</p> : null}
      {state === "error" ? <p className={css.small}>{t("barber.agenda.cita.next.error")}</p> : null}
      {result && (state === "ready" || state === "saving") ? (
        result.exact ? (
          <p className={css.muted}>
            {t("barber.agenda.cita.next.exact", {
              day: fmtDay(result.dateISO),
              time: fmtTime(result.exact.startAt),
              barber: barberName,
            })}
          </p>
        ) : result.nearby.length > 0 ? (
          <>
            <p className={css.muted}>{t("barber.agenda.cita.next.nearby", { day: fmtDay(result.dateISO), barber: barberName })}</p>
            <div className={css.slotRow}>
              {result.nearby.map((s) => (
                <button
                  key={s.startAt.toISOString()}
                  type="button"
                  className={css.chip}
                  aria-pressed={picked?.startAt.getTime() === s.startAt.getTime()}
                  onClick={() => setPicked(s)}
                >
                  {fmtTime(s.startAt)}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className={css.muted}>{t("barber.agenda.cita.next.none", { day: fmtDay(result.dateISO), barber: barberName })}</p>
        )
      ) : null}
      {error ? (
        <div className={css.errorBox} role="alert">
          {error}
        </div>
      ) : null}
      {picked ? (
        <div className={css.slotRow}>
          <button type="button" className={css.go} onClick={() => void book()} disabled={state === "saving"}>
            <CalendarPlus size={18} />
            {state === "saving" ? t("barber.agenda.modal.saving") : `${t("barber.agenda.cita.next.confirm")} · ${fmtTime(picked.startAt)}`}
          </button>
        </div>
      ) : null}
      {props.onRepeat && result && !result.exact && result.nearby.length === 0 ? (
        <div>
          <button type="button" className={css.lnk} onClick={props.onRepeat}>
            <Repeat size={15} /> {t("barber.agenda.cita.actions.repeat")}
          </button>
        </div>
      ) : null}
    </section>
  );
}


// ═══ Paneles encima de la ventana ══════════════════════════════════════
function SubPanel(props: { title: string; children: React.ReactNode; onBack: () => void }) {
  return (
    <div
      className={css.subVelo}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onBack();
      }}
    >
      <div className={css.sub} role="dialog" aria-modal="true" aria-label={props.title}>
        <h3 className={css.subTitle}>{props.title}</h3>
        {props.children}
      </div>
    </div>
  );
}

function CancelPanel(props: {
  name: string;
  withReason: boolean;
  busy: boolean;
  onBack: () => void;
  onConfirm: (reason: string | null) => void;
  t: T;
}) {
  const { t } = props;
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  return (
    <SubPanel title={t("barber.agenda.cita.cancel.title", { name: props.name })} onBack={props.onBack}>
      {props.withReason ? (
        <div className={css.field}>
          {t("barber.agenda.cita.cancel.reason")}
          <div className={css.chips}>
            {CANCEL_REASONS.map((k) => {
              const label = t(`barber.agenda.cita.cancel.reasons.${k}`);
              return (
                <button
                  key={k}
                  type="button"
                  className={css.chip}
                  aria-pressed={picked === label}
                  onClick={() => setPicked(picked === label ? null : label)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <input
            className={css.input}
            value={typed}
            maxLength={CANCEL_REASON_MAX}
            placeholder={t("barber.agenda.cita.cancel.other")}
            aria-label={t("barber.agenda.cita.cancel.other")}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
      ) : null}
      <div className={css.subFoot}>
        <button type="button" className={css.btn} onClick={props.onBack} disabled={props.busy}>
          {t("barber.agenda.cita.cancel.back")}
        </button>
        <button
          type="button"
          className={`${css.btn} ${css.btnSolidDanger}`}
          onClick={() => props.onConfirm(props.withReason ? cancelReasonText(picked, typed) : null)}
          disabled={props.busy}
          data-cancel-confirm=""
        >
          {t("barber.agenda.cita.cancel.confirm")}
        </button>
      </div>
    </SubPanel>
  );
}

function DepositPanel(props: {
  max: number | null;
  busy: boolean;
  onBack: () => void;
  onConfirm: (amount: number, method: BarberPaymentMethod) => Promise<void>;
  t: T;
}) {
  const { t } = props;
  const [raw, setRaw] = useState("");
  const [method, setMethod] = useState<BarberPaymentMethod>("CASH");
  const [bad, setBad] = useState(false);
  return (
    <SubPanel title={t("barber.agenda.cita.deposit.title")} onBack={props.onBack}>
      <label className={css.field}>
        {t("barber.agenda.cita.deposit.amount")}
        <input
          className={css.input}
          inputMode="decimal"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setBad(false);
          }}
          placeholder="$0.00"
          autoFocus
        />
      </label>
      <div className={css.field}>
        {t("barber.agenda.cita.deposit.method")}
        <div className={css.chips}>
          {DEPOSIT_METHODS.map((m) => (
            <button key={m} type="button" className={css.chip} aria-pressed={method === m} onClick={() => setMethod(m)}>
              {t(`barber.agenda.cita.deposit.methods.${m}`)}
            </button>
          ))}
        </div>
      </div>
      {bad ? (
        <div className={css.errorBox} role="alert">
          {t("barber.agenda.cita.deposit.bad")}
        </div>
      ) : null}
      <div className={css.subFoot}>
        <button type="button" className={css.btn} onClick={props.onBack} disabled={props.busy}>
          {t("barber.agenda.cita.cancel.back")}
        </button>
        <button
          type="button"
          className={`${css.btn} ${css.go}`}
          disabled={props.busy}
          onClick={() => {
            const amount = parseDepositAmount(raw, props.max);
            if (amount === null) {
              setBad(true);
              return;
            }
            void props.onConfirm(amount, method);
          }}
        >
          {t("barber.agenda.cita.deposit.save")}
        </button>
      </div>
    </SubPanel>
  );
}

function ProductPanel(props: {
  busy: boolean;
  onBack: () => void;
  onConfirm: (product: BarberProductDTO, qty: number) => Promise<void>;
  t: T;
}) {
  const { t } = props;
  const [products, setProducts] = useState<BarberProductDTO[] | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<BarberProductDTO | null>(null);
  const [qty, setQty] = useState(1);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/barber/products?forSale=1", { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ products?: BarberProductDTO[] }>) : null))
      .then((d) => {
        if (!controller.signal.aborted) setProducts(d?.products ?? []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setProducts([]);
      });
    return () => controller.abort();
  }, []);
  const needle = q.trim().toLowerCase();
  const list = (products ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle)).slice(0, 30);

  return (
    <SubPanel title={t("barber.agenda.cita.product.title")} onBack={props.onBack}>
      <input
        className={css.input}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("barber.agenda.cita.product.search")}
        aria-label={t("barber.agenda.cita.product.search")}
        autoFocus
      />
      {products === null ? (
        <p className={css.small}>{t("barber.agenda.cita.client.loading")}</p>
      ) : products.length === 0 ? (
        <p className={css.small}>{t("barber.agenda.cita.product.empty")}</p>
      ) : list.length === 0 ? (
        <p className={css.small}>{t("barber.agenda.cita.product.noMatch")}</p>
      ) : (
        <div className={css.pick}>
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              className={css.pickItem}
              aria-pressed={picked?.id === p.id}
              onClick={() => setPicked(p)}
            >
              <span>{p.name}</span>
              <span>{formatMXN(p.price)}</span>
              <small>{t("barber.agenda.cita.product.stock", { stock: p.stock })}</small>
            </button>
          ))}
        </div>
      )}
      {picked ? (
        <label className={css.field}>
          {t("barber.agenda.cita.product.qty")}
          <input
            className={css.input}
            type="number"
            min={1}
            max={99}
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(99, Math.trunc(Number(e.target.value)) || 1)))}
          />
        </label>
      ) : null}
      <div className={css.subFoot}>
        <button type="button" className={css.btn} onClick={props.onBack} disabled={props.busy}>
          {t("barber.agenda.cita.cancel.back")}
        </button>
        <button
          type="button"
          className={`${css.btn} ${css.go}`}
          disabled={props.busy || !picked}
          onClick={() => picked && void props.onConfirm(picked, qty)}
        >
          <Package size={16} /> {t("barber.agenda.cita.product.add")}
        </button>
      </div>
    </SubPanel>
  );
}
