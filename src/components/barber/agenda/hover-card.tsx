"use client";

// ═══════════════════════════════════════════════════════════════════════
// El RESUMEN de una visita al pasar el mouse — sin abrir nada.
//
// Tomado del dental (detalles-al-pasar, decisión de Rafael del 28-oct-2026):
//  · sale tras 300 ms quieto encima: pasar el mouse por la agenda sin
//    detenerse no enseña nada;
//  · solo con mouse (con el dedo, tocar abre el detalle de siempre);
//  · se coloca junto a la visita con la MISMA cuenta del dental,
//    `posicionDeLaTarjeta` (pura, importada sin tocar);
//  · NO captura el puntero: nunca tapa ni roba el clic a la visita o al
//    hueco de al lado (en Día cae encima de la columna del otro barbero).
//    Por eso la acción rápida del estado siguiente vive EN la visita
//    (appointment-card.tsx) y no aquí.
//  · un scroll, Esc, un clic o empezar a arrastrar lo quitan.
//
// Se pinta en la RAÍZ de la agenda, fuera de .screen y de .board: los dos
// llevan container-type, que atraparía al position:fixed.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Hand, Inbox, Scissors, Wallet } from "lucide-react";
import { isBarberUnacceptedRequest } from "@/lib/barber/whatsapp-core";
import { posicionDeLaTarjeta } from "@/lib/agenda-nueva/detalles-al-pasar";
import { BARBER_APPOINTMENT_STATUS_UI, type BarberAppointmentDTO } from "@/lib/barber/types";
import {
  appointmentMinutes,
  formatMXN,
  formatMinutes,
  minuteToLabel,
  shopMinuteOfDay,
} from "@/lib/barber/agenda";
import { sumMoneyBy } from "@/lib/barber/money";
import { HOVER_CARD_DELAY_MS } from "./rejilla";
import { Pill, agendaCss as css, barberColor } from "./agenda-ui";

type T = (key: string, vars?: Record<string, string | number>) => string;

export interface HoverAnchor {
  appointmentId: string;
  rect: { left: number; top: number; right: number; bottom: number };
  pointer: { x: number; y: number } | null;
}

/** Cuándo se enseña y cuándo se quita. */
export function useHoverCard() {
  const [anchor, setAnchor] = useState<HoverAnchor | null>(null);
  const timer = useRef<number | null>(null);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const close = useCallback(() => {
    clear();
    setAnchor(null);
  }, []);

  const show = useCallback(
    (appt: BarberAppointmentDTO, el: HTMLElement, e: { clientX: number; clientY: number }) => {
      clear();
      const pointer = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        if (!el.isConnected) return;
        const r = el.getBoundingClientRect();
        setAnchor({
          appointmentId: appt.id,
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
          pointer,
        });
      }, HOVER_CARD_DELAY_MS);
    },
    [],
  );

  // Un scroll mueve la visita debajo del resumen; Esc lo cierra (WCAG 1.4.13).
  const open = anchor !== null;
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => () => clear(), []);

  return { anchor, show, close };
}

const CARD_WIDTH = 290;

export interface HoverCardProps {
  anchor: HoverAnchor;
  appointment: BarberAppointmentDTO;
  timezone: string;
  sale: { saleId: string; total: number } | null;
  /** Texto de la acción rápida que la visita ofrece (si hay), para decirlo. */
  quickLabel: string | null;
  draggable: boolean;
  t: T;
}

export function HoverCard(props: HoverCardProps) {
  const { appointment: appt, t, anchor } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const p = posicionDeLaTarjeta(
      anchor.rect,
      { ancho: window.innerWidth, alto: window.innerHeight },
      { ancho: el.offsetWidth || CARD_WIDTH, alto: el.offsetHeight },
      anchor.pointer,
    );
    setPos((v) => (v && v.left === p.left && v.top === p.top ? v : { left: p.left, top: p.top }));
  }, [anchor, appt.status]);

  const ui = BARBER_APPOINTMENT_STATUS_UI[appt.status];
  const start = minuteToLabel(shopMinuteOfDay(new Date(appt.startAt), props.timezone));
  const end = minuteToLabel(shopMinuteOfDay(new Date(appt.endAt), props.timezone));
  const total = sumMoneyBy(appt.services, (s) => s.priceAtBooking);
  const services =
    appt.services.length > 0
      ? appt.services.map((s) => s.serviceName).join(" + ")
      : t("barber.agenda.card.noServices");
  const deposit =
    appt.depositAmount && appt.depositAmount > 0 && appt.depositStatus
      ? { amount: appt.depositAmount, status: appt.depositStatus }
      : null;
  const client = appt.clientName || t("barber.agenda.card.noClient");

  return (
    <div
      ref={ref}
      className={css.hoverCard}
      data-hover-card={appt.id}
      role="tooltip"
      aria-label={t("barber.agenda.hover.label", { client })}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: CARD_WIDTH }}
    >
      <div className={css.hoverHead}>
        <span className={css.hoverName}>{client}</span>
        <Pill tone={ui.tone}>{t(`barber.agenda.hover.status.${appt.status}`)}</Pill>
      </div>

      <dl className={css.hoverRows}>
        <div className={css.hoverRow}>
          <dt aria-label={t("barber.agenda.hover.time")}>
            <Clock size={13} aria-hidden />
          </dt>
          <dd>
            {start} – {end}
            <span className={css.hoverMuted}> · {formatMinutes(appointmentMinutes(appt))}</span>
          </dd>
        </div>
        <div className={css.hoverRow}>
          <dt aria-label={t("barber.agenda.detail.barber")}>
            <span
              className={css.cardBarberDot}
              style={{ background: barberColor(appt.barberId ?? "sin"), display: "inline-block" }}
              aria-hidden
            />
          </dt>
          <dd>{appt.barberName || t("barber.agenda.card.noBarber")}</dd>
        </div>
        <div className={css.hoverRow}>
          <dt aria-label={t("barber.agenda.detail.services")}>
            <Scissors size={13} aria-hidden />
          </dt>
          <dd>
            {services}
            {total > 0 ? <span className={css.hoverMuted}> · {formatMXN(total)}</span> : null}
          </dd>
        </div>
        {deposit ? (
          <div className={css.hoverRow}>
            <dt aria-label={t("barber.agenda.hover.deposit")}>
              <Wallet size={13} aria-hidden />
            </dt>
            <dd>
              {t(`barber.agenda.hover.depositStatus.${deposit.status}`, {
                amount: formatMXN(deposit.amount),
              })}
            </dd>
          </div>
        ) : null}
        {isBarberUnacceptedRequest(appt) ? (
          <div className={css.hoverRow} data-request="">
            <dt aria-label={t("barber.agenda.request.view")}>
              <Inbox size={13} aria-hidden />
            </dt>
            <dd>{t("barber.agenda.request.pending")}</dd>
          </div>
        ) : null}
        {props.sale ? (
          <div className={css.hoverRow}>
            <dt aria-label={t("barber.agenda.card.charged")}>
              <CheckCircle2 size={13} aria-hidden />
            </dt>
            <dd>{t("barber.agenda.detail.alreadyCharged", { amount: formatMXN(props.sale.total) })}</dd>
          </div>
        ) : null}
      </dl>

      {props.quickLabel || props.draggable ? (
        <div className={css.hoverFoot}>
          {props.quickLabel ? (
            <p className={css.hoverHint}>{t("barber.agenda.hover.quickHint", { action: props.quickLabel })}</p>
          ) : null}
          {props.draggable ? (
            <p className={css.hoverHint}>
              <Hand size={12} aria-hidden /> {t("barber.agenda.card.dragHint")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
