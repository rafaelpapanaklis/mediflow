"use client";

// ═══════════════════════════════════════════════════════════════════════
// Una VISITA en la rejilla — la misma pieza en la vista Día y en Semana.
//
// Es un <button> de verdad (Enter y espacio la abren, el foco se ve), y va
// dentro de un marco que lleva la posición. En el marco viven, junto a la
// tarjeta y NO dentro de ella (un botón no puede llevar otro botón):
//
//   · la ACCIÓN RÁPIDA del estado siguiente («Confirmar», «Iniciar»,
//     «Completar», «Cobrar»), que aparece al pasar el mouse o al llegar con
//     el teclado. Está EN la visita y no en el resumen flotante a propósito:
//     el resumen (como el del dental) no captura el puntero, para que nunca
//     tape ni robe el clic a la visita o al hueco de al lado;
//   · el ASA del borde de abajo para alargar/acortar.
//
// Tocar la tarjeta SIEMPRE abre el detalle — también las cerradas y sin
// permiso de edición: justo la completada es la que hay que abrir para
// cobrarla.
// ═══════════════════════════════════════════════════════════════════════
import { useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import {
  BARBER_APPOINTMENT_STATUS_UI,
  isTerminalAppointmentStatus,
  type BarberAppointmentDTO,
} from "@/lib/barber/types";
import { BARBER_CARD_COMPACT_PX, formatMXN } from "@/lib/barber/agenda";
import { sumMoneyBy } from "@/lib/barber/money";
import { agendaCss as css, barberColor } from "./agenda-ui";

type T = (key: string, vars?: Record<string, string | number>) => string;

export interface CardQuickAction {
  label: string;
  /** «money» = cobra (verde de caja); «go» = avanza el flujo. */
  tone: "go" | "money";
  /** Si lleva a otra pantalla (p. ej. Solicitudes): es un enlace, no una acción. */
  href?: string;
}

export interface AppointmentCardProps {
  appointment: BarberAppointmentDTO;
  variant: "day" | "week";
  top: number;
  height: number;
  lane: number;
  laneCount: number;
  startLabel: string;
  endLabel: string;
  barberName: string;
  sale: { saleId: string; total: number } | null;
  dragging: boolean;
  draggable: boolean;
  quick: CardQuickAction | null;
  busy: boolean;
  t: T;
  onOpen: () => void;
  onQuick: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onResizeDown: (e: React.PointerEvent) => void;
  onHoverStart?: (el: HTMLElement, e: { clientX: number; clientY: number }) => void;
  onHoverEnd?: () => void;
}

export function AppointmentCard(props: AppointmentCardProps) {
  const { appointment: appt, t, variant } = props;
  // La acción rápida se enseña con el MOUSE encima o con el foco de TECLADO.
  // Con el dedo no: el :hover se queda «pegado» tras un toque y el botón
  // taparía el nombre en una tarjeta angosta (ahí todo sigue en el detalle).
  const [mouseOver, setMouseOver] = useState(false);
  const [keyboardIn, setKeyboardIn] = useState(false);
  const ui = BARBER_APPOINTMENT_STATUS_UI[appt.status];
  const compact = props.height < BARBER_CARD_COMPACT_PX;
  const week = variant === "week";
  const roomy = !week && props.height >= 74 && props.laneCount === 1;
  /** Poco alto, partida en carriles o en Semana: no cabe el texto del estado. */
  const narrow = compact || props.laneCount > 1 || week;
  const total = sumMoneyBy(appt.services, (s) => s.priceAtBooking);

  const now = Date.now();
  const startMs = new Date(appt.startAt).getTime();
  const endMs = new Date(appt.endAt).getTime();
  const terminal = isTerminalAppointmentStatus(appt.status);
  const live = !terminal && startMs <= now && now < endMs;
  const past = !terminal && !live && endMs <= now;

  const gap = week ? 2 : 3;
  const width = 100 / props.laneCount;
  const clientLabel = appt.clientName || t("barber.agenda.card.noClient");
  const serviceLabel =
    appt.services.length > 0
      ? appt.services.map((s) => s.serviceName).join(" + ")
      : t("barber.agenda.card.noServices");
  const statusLabel = t(`barber.agenda.hover.status.${appt.status}`);

  return (
    <div
      className={`${css.cardSlot} ${props.dragging ? css.cardSlotDragging : ""}`}
      data-card=""
      style={{
        top: props.top,
        height: props.height,
        left: `calc(${props.lane * width}% + ${gap}px)`,
        width: `calc(${width}% - ${gap * 2}px)`,
      }}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        setMouseOver(true);
        if (e.buttons === 0) props.onHoverStart?.(e.currentTarget, e);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setMouseOver(false);
        props.onHoverEnd?.();
      }}
      onFocus={(e) => {
        // Solo el foco de TECLADO enseña la acción rápida: el de un toque no.
        let keyboard = false;
        try {
          keyboard = (e.target as HTMLElement).matches(":focus-visible");
        } catch {
          keyboard = false;
        }
        if (keyboard) setKeyboardIn(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyboardIn(false);
      }}
    >
      <button
        type="button"
        data-status={appt.status}
        className={[
          css.card,
          compact ? css.cardCompact : "",
          props.dragging ? css.cardDragging : "",
          live ? css.cardLive : "",
          past ? css.cardPast : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ cursor: props.draggable ? "grab" : "pointer" }}
        aria-label={t("barber.agenda.card.aria", {
          time: props.startLabel,
          client: clientLabel,
          status: statusLabel,
        })}
        // Con el resumen al pasar el mouse, el `title` nativo saldría encima
        // de él diciendo lo mismo: solo se deja si no hay resumen.
        title={
          props.onHoverStart
            ? undefined
            : `${props.startLabel} – ${props.endLabel} · ${clientLabel} · ${serviceLabel} · ${props.barberName} · ${statusLabel}`
        }
        onClick={(e) => {
          e.stopPropagation();
          props.onOpen();
        }}
        onPointerDown={props.onPointerDown}
        onContextMenu={(e) => {
          // Mantener apretado con el dedo es «mover»: sin menú del sistema.
          if (props.draggable) e.preventDefault();
        }}
      >
        <span className={css.cardRow}>
          <span className={css.cardTime}>
            {narrow ? props.startLabel : `${props.startLabel} – ${props.endLabel}`}
          </span>
          {/* Partida en carriles, la palabra del estado se cortaría a
              «CANC…»: ahí vale más el punto de color (el estado completo
              sigue en el aria-label y en el resumen). */}
          {narrow ? (
            <span className={css.cardDot} aria-hidden />
          ) : (
            <span className={css.cardStatus}>{ui.label}</span>
          )}
        </span>

        <span className={css.cardName}>{clientLabel}</span>

        {compact ? null : week ? (
          // Semana: la tercera línea solo si CABE entera.
          props.height >= 60 ? (
            <span className={css.cardServices}>
              <span
                className={css.cardBarberDot}
                style={{
                  background: barberColor(appt.barberId ?? "sin"),
                  display: "inline-block",
                  marginRight: 5,
                  verticalAlign: -1,
                }}
                aria-hidden
              />
              {appt.barberName ?? t("barber.agenda.card.noBarber")}
            </span>
          ) : null
        ) : (
          <span className={css.cardServices}>{serviceLabel}</span>
        )}

        {roomy ? (
          <span className={css.cardFoot}>
            <span className={css.cardBarber}>
              <span
                className={css.cardBarberDot}
                style={{ background: barberColor(appt.barberId ?? "sin") }}
                aria-hidden
              />
              <span className={css.cardBarberName}>{props.barberName}</span>
            </span>
            {props.sale ? (
              <span className={css.cardPaid}>
                <CheckCircle2 size={11} /> {t("barber.agenda.card.charged")}
              </span>
            ) : total > 0 ? (
              <span className={css.cardPrice}>{formatMXN(total)}</span>
            ) : null}
          </span>
        ) : null}
      </button>

      {props.quick?.href && (mouseOver || keyboardIn) && !props.dragging ? (
        <Link
          href={props.quick.href}
          className={`${css.cardQuick} ${css.btnPrimary} ${compact ? css.cardQuickCompact : ""}`}
          data-quick=""
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {props.quick.label}
        </Link>
      ) : props.quick && (mouseOver || keyboardIn) && !props.dragging ? (
        <button
          type="button"
          className={`${css.cardQuick} ${props.quick.tone === "money" ? css.btnMoney : css.btnPrimary} ${
            compact ? css.cardQuickCompact : ""
          }`}
          data-quick=""
          disabled={props.busy}
          onClick={(e) => {
            e.stopPropagation();
            props.onQuick();
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {props.quick.label}
        </button>
      ) : null}

      {/* El asa para alargar/acortar: el borde de abajo. Se nota al pasar el
          mouse (cursor ↕ y una rayita); con el dedo, mantener apretado. */}
      {props.draggable && !compact ? (
        <span
          className={css.resizeHandle}
          data-resize=""
          aria-hidden
          onPointerDown={props.onResizeDown}
          onClick={(e) => e.stopPropagation()}
        />
      ) : null}
    </div>
  );
}
