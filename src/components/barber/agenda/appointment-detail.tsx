"use client";

// ═══════════════════════════════════════════════════════════════════════
// Detalle de una visita: quién, con quién, qué, cuánto dura y qué sigue.
//
// Los botones de estado NO se inventan: salen de nextStatuses() del
// contrato (src/lib/barber/types.ts) y se vuelven a filtrar con
// canTransition() antes de disparar. El primero del flujo lineal se pinta
// como acción principal —"Confirmar cita", "Iniciar servicio", "Completar
// visita"— y cancelar / no llegó quedan como secundarios. Si el contrato
// cambia el flujo, esta pantalla cambia sola.
//
// COMPLETAR ENCADENA CON EL COBRO. Hasta hoy se completaba la visita y el
// dinero no entraba nunca a la caja: nadie volvía a /barber/caja a cobrar
// lo que ya se había terminado. Ahora, al pasar a "completada", se ofrece
// cobrar en el acto (el modal de ticket de la caja, montado por el puente).
// Saltarse el cobro sigue siendo posible, pero es un botón que hay que
// tocar a propósito, no lo que pasa por descuido.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBarberPhone } from "@/lib/barber/phone-format";
import { CheckCircle2, MessageCircle, Minus, Pencil, Plus, Receipt, User } from "lucide-react";
import {
  BARBER_APPOINTMENT_ACTION_LABELS,
  BARBER_APPOINTMENT_STATUS_UI,
  canTransition,
  isTerminalAppointmentStatus,
  nextStatuses,
  type BarberAppointmentDTO,
  type BarberAppointmentStatus,
} from "@/lib/barber/types";
import {
  BARBER_DURATION_STEP_MIN,
  BARBER_MAX_APPOINTMENT_MIN,
  BARBER_MIN_APPOINTMENT_MIN,
  appointmentMinutes,
  clampAppointmentMinutes,
  formatMXN,
  formatMinutes,
  minuteToLabel,
  shopMinuteOfDay,
} from "@/lib/barber/agenda";
import { sumMoneyBy } from "@/lib/barber/money";
import { isOwnVisitStatus } from "@/lib/barber/own-visits";
import { isBarberUnacceptedRequest } from "@/lib/barber/whatsapp-core";
import { Field, Modal, Pill, agendaCss as css } from "./agenda-ui";

export interface AppointmentDetailProps {
  appointment: BarberAppointmentDTO;
  timezone: string;
  branchId: string;
  canEdit: boolean;
  /**
   * Rol Barbero (sin agenda.edit): id de SU ficha de barbero. En sus propias
   * visitas puede marcar «En silla» y «Completada»; nada más. null = no aplica.
   */
  ownBarberId?: string | null;
  /** clients.view: sin él, el nombre del cliente no es liga a su ficha. */
  canViewClients: boolean;
  /** cash.manage + el plan incluye caja. */
  canCharge: boolean;
  /** Ticket vivo de esta visita, si ya pasó por caja. */
  sale: { saleId: string; total: number } | null;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onClose: () => void;
  onEdit: () => void;
  onChanged: (appointment: BarberAppointmentDTO, note?: string | null) => void;
  /** Abre el puente de cobro para esta visita. */
  onCharge: () => void;
  /** requests.manage: puede aceptar solicitudes web/bot. */
  canAcceptRequests?: boolean;
  /** Acepta la solicitud por el camino de Solicitudes (avisa al cliente). */
  onAcceptRequest?: () => void;
}

/** Estados que representan "seguir adelante" (el flujo lineal del contrato). */
const FORWARD: BarberAppointmentStatus[] = ["CONFIRMED", "IN_PROGRESS", "DONE"];

export function AppointmentDetail(props: AppointmentDetailProps) {
  const { appointment: appt, t, timezone } = props;
  const [busy, setBusy] = useState<string | null>(null);
  // «Cancelar cita» pide confirmación (QA A, 15-nov): antes cancelaba al
  // primer clic, aun con el cliente en la silla. Igual que Solicitudes.
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savedMinutes = appointmentMinutes(appt);
  const [minutes, setMinutes] = useState(savedMinutes);
  // Texto que se está tecleando en «Duración»: deja borrar y reescribir.
  const [durDraft, setDurDraft] = useState<string | null>(null);
  const [durationDirty, setDurationDirty] = useState(false);

  // Si la visita cambia por debajo (se guardó, o el refresco silencioso la
  // trajo movida) el control se re-sincroniza, salvo que haya un cambio a
  // medio escribir: eso no se pisa.
  useEffect(() => {
    if (durationDirty) return;
    setMinutes(savedMinutes);
  }, [savedMinutes, durationDirty]);

  const ui = BARBER_APPOINTMENT_STATUS_UI[appt.status];
  const options = nextStatuses(appt.status).filter((s) => canTransition(appt.status, s));
  // Quién puede AVANZAR esta visita: quien edita la agenda (todo el flujo), o
  // su propio barbero, y solo hacia «En silla» / «Completada». El servidor
  // aplica la misma regla (own-visits.ts); aquí solo se decide qué se pinta.
  const isOwnVisit = Boolean(props.ownBarberId) && appt.barberId === props.ownBarberId;
  const canAdvance = (s: BarberAppointmentStatus) => props.canEdit || (isOwnVisit && isOwnVisitStatus(s));
  // Solicitud web/bot sin aceptar (ronda 2, M1): NO se «confirma» por la
  // ruta de estado — eso se saltaba el «quedó agendada» al cliente. Se
  // ACEPTA por el camino de Solicitudes (onAcceptRequest), o se manda allá.
  const isRequest = isBarberUnacceptedRequest(appt);
  const primary = isRequest
    ? null
    : (options.find((s) => FORWARD.includes(s) && canAdvance(s)) ?? null);
  const secondary = options.filter((s) => s !== primary && !(isRequest && s === "CONFIRMED"));
  const terminal = isTerminalAppointmentStatus(appt.status);

  const total = sumMoneyBy(appt.services, (s) => s.priceAtBooking);
  const depositPaid = appt.depositStatus === "PAID" && appt.depositAmount ? appt.depositAmount : 0;
  const startLabel = minuteToLabel(shopMinuteOfDay(new Date(appt.startAt), timezone));
  const endLabel = minuteToLabel(shopMinuteOfDay(new Date(appt.endAt), timezone));
  const dayLabel = new Intl.DateTimeFormat("es-MX", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(appt.startAt));

  // Cobrar tiene sentido cuando la visita ya terminó y todavía no hay
  // ticket. Cancelada / no llegó jamás se cobran (createSale las rechaza).
  const chargeable =
    props.canCharge && !props.sale && appt.status !== "CANCELLED" && appt.status !== "NO_SHOW";

  const setDuration = (next: number) => {
    const clamped = clampAppointmentMinutes(next);
    if (clamped === null) return;
    setMinutes(clamped);
    setDurationDirty(clamped !== savedMinutes);
  };

  const move = async (to: BarberAppointmentStatus) => {
    if (!canTransition(appt.status, to)) return;
    setBusy(to);
    setError(null);
    try {
      const res = await fetch(`/api/barber/appointments/${appt.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, branchId: props.branchId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : t("barber.agenda.queue.errors.generic"));
        return;
      }
      const updated = data.appointment as BarberAppointmentDTO;
      const note =
        data.remindersInvalidated > 0 ? t("barber.agenda.move.remindersCancelled") : null;
      // Completar y cobrar son UN solo movimiento del mostrador.
      if (to === "DONE" && props.canCharge) {
        props.onChanged(updated, note);
        props.onCharge();
        return;
      }
      props.onChanged(updated, note);
    } catch {
      setError(t("barber.agenda.queue.errors.generic"));
    } finally {
      setBusy(null);
    }
  };

  const saveDuration = async () => {
    setBusy("duration");
    setError(null);
    try {
      const res = await fetch(`/api/barber/appointments/${appt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: props.branchId, durationMin: minutes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 = el hueco ya no cabe. El mensaje viene del servidor (o de la
        // constraint EXCLUDE) y se muestra tal cual: decir "error" a secas
        // no le sirve a nadie con un cliente enfrente.
        setError(typeof data.error === "string" ? data.error : t("barber.agenda.queue.errors.generic"));
        setMinutes(savedMinutes);
        setDurationDirty(false);
        return;
      }
      setDurationDirty(false);
      props.onChanged(
        data.appointment as BarberAppointmentDTO,
        t("barber.agenda.detail.durationSaved", { duration: formatMinutes(minutes) }),
      );
    } catch {
      setError(t("barber.agenda.queue.errors.generic"));
    } finally {
      setBusy(null);
    }
  };

  const phoneDigits = (appt.clientPhone ?? "").replace(/\D/g, "").slice(-10);

  return (
    <Modal
      title={t("barber.agenda.detail.title")}
      onClose={props.onClose}
      closeLabel={t("barber.agenda.actions.close")}
      footer={
        <>
          {props.canEdit && !terminal ? (
            <button type="button" className={css.btn} onClick={props.onEdit} disabled={busy !== null}>
              <Pencil size={14} /> {t("barber.agenda.detail.edit")}
            </button>
          ) : null}
          {chargeable && terminal ? (
            <button
              type="button"
              className={`${css.btn} ${css.btnMoney}`}
              onClick={props.onCharge}
              disabled={busy !== null}
            >
              <Receipt size={14} /> {t("barber.agenda.detail.chargeNow")}
            </button>
          ) : null}
          {isRequest && props.canEdit ? (
            props.canAcceptRequests && props.onAcceptRequest ? (
              <button
                type="button"
                className={`${css.btn} ${css.btnPrimary}`}
                data-accept-request=""
                onClick={props.onAcceptRequest}
                disabled={busy !== null}
              >
                {t("barber.agenda.request.accept")}
              </button>
            ) : (
              <Link href="/barber/solicitudes" className={`${css.btn} ${css.btnPrimary}`}>
                {t("barber.agenda.request.view")}
              </Link>
            )
          ) : null}
          {primary ? (
            <button
              type="button"
              className={`${css.btn} ${primary === "DONE" && chargeable ? css.btnMoney : css.btnPrimary}`}
              onClick={() => move(primary)}
              disabled={busy !== null}
            >
              {primary === "DONE" && chargeable
                ? t("barber.agenda.detail.completeAndCharge")
                : BARBER_APPOINTMENT_ACTION_LABELS[primary]}
            </button>
          ) : null}
        </>
      }
    >
      {error ? <div className={css.errorBox}>{error}</div> : null}

      {props.sale ? (
        <div className={css.paidBanner}>
          <CheckCircle2 size={15} />
          <span>
            {t("barber.agenda.detail.alreadyCharged", { amount: formatMXN(props.sale.total) })}{" "}
            <Link
              href={`/barber/caja/ticket/${props.sale.saleId}`}
              className={css.detailLink}
              target="_blank"
            >
              {t("barber.agenda.detail.viewTicket")}
            </Link>
          </span>
        </div>
      ) : null}

      {/* Cuándo, en grande: es el dato que más se mira. */}
      <div className={css.detailHead}>
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <p className={css.detailWhen}>
            {startLabel} – {endLabel}
          </p>
          <p className={css.detailWhenSub}>{dayLabel}</p>
        </div>
        <Pill tone={ui.tone}>{ui.label}</Pill>
      </div>

      {/* Duración editable: alargar o acortar sin volver a agendar. */}
      <Field
        label={t("barber.agenda.detail.duration")}
        hint={
          props.canEdit && !terminal ? t("barber.agenda.detail.durationHint") : null
        }
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div className={css.stepper}>
            <button
              type="button"
              className={css.stepperBtn}
              onClick={() => setDuration(minutes - BARBER_DURATION_STEP_MIN)}
              disabled={!props.canEdit || terminal || minutes <= BARBER_MIN_APPOINTMENT_MIN}
              aria-label={t("barber.agenda.detail.durationLess")}
            >
              <Minus size={14} />
            </button>
            <input
              className={css.stepperValue}
              inputMode="numeric"
              value={durDraft ?? minutes}
              disabled={!props.canEdit || terminal}
              aria-label={t("barber.agenda.detail.duration")}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                setDurDraft(digits);
                const raw = parseInt(digits, 10);
                if (!Number.isFinite(raw)) return;
                setMinutes(raw);
                setDurationDirty(raw !== savedMinutes);
              }}
              onBlur={() => {
                setDurDraft(null);
                setDuration(minutes);
              }}
            />
            <button
              type="button"
              className={css.stepperBtn}
              onClick={() => setDuration(minutes + BARBER_DURATION_STEP_MIN)}
              disabled={!props.canEdit || terminal || minutes >= BARBER_MAX_APPOINTMENT_MIN}
              aria-label={t("barber.agenda.detail.durationMore")}
            >
              <Plus size={14} />
            </button>
            <span className={css.stepperUnit}>{t("barber.agenda.detail.minutes")}</span>
          </div>
          {durationDirty ? (
            <button
              type="button"
              className={`${css.btn} ${css.btnPrimary}`}
              onClick={saveDuration}
              disabled={busy !== null}
            >
              {busy === "duration"
                ? t("barber.agenda.modal.saving")
                : t("barber.agenda.detail.durationApply")}
            </button>
          ) : null}
        </div>
      </Field>

      <div>
        <div className={css.detailRow}>
          <span className={css.detailKey}>{t("barber.agenda.detail.client")}</span>
          <span className={css.detailValue}>
            {appt.clientId && props.canViewClients ? (
              <Link href={`/barber/clientes/${appt.clientId}`} className={css.detailLink}>
                <User size={12} style={{ verticalAlign: -2 }} /> {appt.clientName || "—"}
              </Link>
            ) : (
              (appt.clientName ?? "—")
            )}
            {phoneDigits.length === 10 ? (
              <>
                {" · "}
                <a
                  href={`https://wa.me/52${phoneDigits}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={css.detailLink}
                >
                  <MessageCircle size={12} style={{ verticalAlign: -2 }} /> {formatBarberPhone(appt.clientPhone)}
                </a>
              </>
            ) : appt.clientPhone ? (
              <span style={{ color: "var(--text-3)" }}> · {formatBarberPhone(appt.clientPhone)}</span>
            ) : null}
          </span>
        </div>
        <div className={css.detailRow}>
          <span className={css.detailKey}>{t("barber.agenda.detail.barber")}</span>
          <span className={css.detailValue}>
            {appt.barberName || t("barber.agenda.card.noBarber")}
          </span>
        </div>
        <div className={css.detailRow}>
          <span className={css.detailKey}>{t("barber.agenda.detail.source")}</span>
          <span className={css.detailValue}>
            {t(`barber.agenda.detail.sources.${appt.source}`)}
          </span>
        </div>
      </div>

      {/* Servicios con su precio CONGELADO al reservar. */}
      <Field label={t("barber.agenda.detail.services")}>
        {appt.services.length === 0 ? (
          <p className={css.hint}>{t("barber.agenda.card.noServices")}</p>
        ) : (
          <div>
            {appt.services.map((s) => (
              <div key={s.id} className={css.serviceLine}>
                <span className={css.serviceName}>{s.serviceName}</span>
                <span className={css.servicePrice}>{formatMXN(s.priceAtBooking)}</span>
              </div>
            ))}
          </div>
        )}
        <div className={css.totals}>
          <span>{t("barber.agenda.detail.total")}</span>
          <span className={css.totalsValue}>{formatMXN(total)}</span>
        </div>
        {/* Anticipo PAGADO de la cita: la caja lo descuenta sola al cobrar.
            (Textos del diccionario de caja: son los mismos del ticket.) */}
        {depositPaid > 0 ? (
          <>
            <div className={css.serviceLine}>
              <span className={css.serviceName}>{t("barber.caja.ticket.depositApplied")}</span>
              <span className={css.servicePrice}>−{formatMXN(depositPaid)}</span>
            </div>
            {!props.sale ? (
              <div className={css.totals}>
                <span>{t("barber.caja.ticket.depositDue")}</span>
                <span className={css.totalsValue}>{formatMXN(Math.max(0, total - depositPaid))}</span>
              </div>
            ) : null}
          </>
        ) : null}
      </Field>

      {appt.notes ? (
        <Field label={t("barber.agenda.detail.notes")}>
          <p className={css.hint} style={{ fontSize: 13, color: "var(--text-2)" }}>
            {appt.notes}
          </p>
        </Field>
      ) : null}

      {props.canEdit && secondary.length > 0 ? (
        <div className={css.actionsRow}>
          {secondary.map((status) => (
            <button
              type="button"
              key={status}
              className={`${css.btn} ${css.btnSm} ${status === "CANCELLED" ? css.btnDanger : ""}`}
              onClick={() => (status === "CANCELLED" ? setConfirmCancel(true) : move(status))}
              disabled={busy !== null || confirmCancel}
            >
              {BARBER_APPOINTMENT_ACTION_LABELS[status]}
            </button>
          ))}
        </div>
      ) : null}

      {props.canEdit && confirmCancel && secondary.includes("CANCELLED") ? (
        <div className={css.actionsRow} role="alertdialog" aria-label={t("barber.agenda.detail.cancelConfirm", { name: appt.clientName || "—" })}>
          <p className={css.hint} style={{ flexBasis: "100%", margin: 0, color: "var(--text-1)" }}>
            {t("barber.agenda.detail.cancelConfirm", { name: appt.clientName || "—" })}
          </p>
          <button
            type="button"
            className={`${css.btn} ${css.btnSm} ${css.btnDanger}`}
            onClick={() => {
              setConfirmCancel(false);
              move("CANCELLED");
            }}
            disabled={busy !== null}
          >
            {t("barber.agenda.detail.cancelYes")}
          </button>
          <button
            type="button"
            className={`${css.btn} ${css.btnSm}`}
            onClick={() => setConfirmCancel(false)}
            disabled={busy !== null}
          >
            {t("barber.agenda.detail.cancelNo")}
          </button>
        </div>
      ) : null}

      {/* Salirse sin cobrar tiene que ser una decisión, no un descuido. */}
      {chargeable && terminal ? (
        <p className={css.hint}>{t("barber.agenda.detail.chargeSkipHint")}</p>
      ) : null}
    </Modal>
  );
}
