"use client";
// Sección D — Controles (la hoja de control de cada visita).
//
// 3 vistas: Historial / Próxima cita / Calendario.
// Click en una fila del historial → abre DrawerTreatmentCard (ver hermano).

import { useState } from "react";
import { CalendarClock, ClipboardCheck, ClipboardList } from "lucide-react";
import { Btn, Card } from "../atoms";
import { TimelineRow } from "../atoms/TimelineRow";
import {
  PHASE_LABELS,
  type NextAppointmentDTO,
  type TreatmentCardDTO,
} from "../types";
import { fmtDate, fmtDateShort } from "../atoms/format";
import orto from "../orto.module.css";

type Tab = "next" | "history" | "calendar";

export interface SectionTreatmentCardsProps {
  cards: TreatmentCardDTO[];
  nextAppointment: NextAppointmentDTO | null;
  onOpenCard?: (cardId: string) => void;
  onStartNewCard?: () => void;
  /** Texto del label "Whatsapp" si se quiere personalizar (default "Confirmar WhatsApp"). */
  confirmLabel?: string;
}

export function SectionTreatmentCards(props: SectionTreatmentCardsProps) {
  // Con controles ya registrados, lo primero que se quiere ver al abrir al
  // paciente es el último (qué arco lleva, qué se dejó anotado).
  const [tab, setTab] = useState<Tab>(props.cards.length > 0 ? "history" : "next");

  const sorted = [...props.cards].sort((a, b) => b.cardNumber - a.cardNumber);

  const tabs: ReadonlyArray<{ id: Tab; label: string; count?: number }> = [
    { id: "history", label: "Historial", count: sorted.length },
    { id: "next", label: "Próxima cita" },
    { id: "calendar", label: "Calendario" },
  ];

  return (
    <Card
      id="tcards"
      icon={<ClipboardList size={15} strokeWidth={1.75} />}
      title="Controles"
      eyebrow="La hoja de control de cada visita"
      action={
        props.onStartNewCard ? (
          <Btn
            variant="violet-soft"
            size="sm"
            icon={<ClipboardCheck size={14} strokeWidth={1.75} aria-hidden />}
            onClick={props.onStartNewCard}
          >
            Registrar control
          </Btn>
        ) : null
      }
    >
      <div className="px-[18px] pt-[14px]">
        <div className={orto.segmento} role="tablist" aria-label="Vista de los controles">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={[orto.segmentoBoton, tab === t.id ? orto.segmentoActivo : ""]
                .filter(Boolean)
                .join(" ")}
            >
              {t.label}
              {t.count != null ? <span className={orto.segmentoCuenta}>{t.count}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {tab === "next" ? (
        <NextTabPanel next={props.nextAppointment} onStart={props.onStartNewCard} />
      ) : null}
      {tab === "history" ? (
        <HistoryTabPanel
          cards={sorted}
          onOpenCard={props.onOpenCard}
          onStart={props.onStartNewCard}
        />
      ) : null}
      {tab === "calendar" ? <CalendarTabPanel cards={sorted} /> : null}
    </Card>
  );
}

function NextTabPanel({
  next,
  onStart,
}: {
  next: NextAppointmentDTO | null;
  onStart?: () => void;
}) {
  if (!next) {
    return (
      <div className={orto.tarjetaCuerpo}>
        <div className={orto.vacio}>
          <span className={orto.vacioIcono} aria-hidden>
            <CalendarClock size={17} strokeWidth={1.75} />
          </span>
          <p className={orto.vacioTitulo}>Sin próxima cita programada</p>
          <p className={orto.vacioPista}>
            Agenda el siguiente control desde «Agendar próxima», arriba.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className={orto.tarjetaCuerpo}>
      <div className={`${orto.caja} ${orto.cajaVioleta}`} style={{ padding: "14px 16px" }}>
        <div className="flex items-start justify-between gap-x-4 gap-y-3 flex-wrap">
          <div className="min-w-0">
            <div className={`${orto.datoValor} ${orto.datoValorGrande}`} style={{ marginTop: 0, whiteSpace: "normal" }}>
              {fmtDate(next.date)}
            </div>
            <div className={`${orto.tonoTexto2} mt-[3px] text-[13px]`}>
              {next.type} · {next.durationMin} min
              {next.chair ? ` · ${next.chair}` : ""}
            </div>
            <div className={`${orto.tonoApagado} mt-[1px] text-xs`}>con {next.doctor}</div>
          </div>
          {/* «Confirmar WhatsApp» no tenía acción conectada (un botón que no
              hacía nada): se deja de pintar hasta que exista el envío. */}
          {onStart ? (
            <Btn
              variant="primary"
              size="md"
              icon={<ClipboardCheck size={15} strokeWidth={1.75} aria-hidden />}
              onClick={onStart}
            >
              Registrar control
            </Btn>
          ) : null}
        </div>
        {next.prep.length > 0 ? (
          <div className="mt-[14px] pt-[12px] border-t border-[color:var(--orto-violeta-borde)]">
            <div className={`${orto.ceja} mb-2`}>Sugerido para esta cita</div>
            <ul className="flex flex-col gap-[5px]">
              {next.prep.map((p, i) => (
                <li key={i} className={`${orto.tonoTexto2} flex items-start gap-2 text-[13px]`}>
                  <span className={`${orto.punto} ${orto.tonoVioleta} mt-[6px]`} aria-hidden />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HistoryTabPanel({
  cards,
  onOpenCard,
  onStart,
}: {
  cards: TreatmentCardDTO[];
  onOpenCard?: (id: string) => void;
  onStart?: () => void;
}) {
  if (cards.length === 0) {
    return (
      <div className={orto.tarjetaCuerpo}>
        <div className={orto.vacio}>
          <span className={orto.vacioIcono} aria-hidden>
            <ClipboardList size={17} strokeWidth={1.75} />
          </span>
          <p className={orto.vacioTitulo}>Aún no hay controles registrados</p>
          <p className={orto.vacioPista}>
            Cada control guarda el arco, los elásticos, la higiene y la nota de la visita.
          </p>
          {onStart ? (
            <Btn
              variant="primary"
              size="md"
              className="mt-1"
              icon={<ClipboardCheck size={15} strokeWidth={1.75} aria-hidden />}
              onClick={onStart}
            >
              Registrar el primer control
            </Btn>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className={`${orto.tarjetaCuerpo} flex flex-col gap-2`}>
      {cards.map((card, i) => (
        <TimelineRow
          key={card.id}
          card={card}
          isLast={i === cards.length - 1}
          onClick={onOpenCard ? () => onOpenCard(card.id) : undefined}
        />
      ))}
    </div>
  );
}

function CalendarTabPanel({ cards }: { cards: TreatmentCardDTO[] }) {
  // Calendar simple del mes actual marcando días con cita.
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const dayOfWeekOffset = (firstOfMonth.getDay() + 6) % 7; // lunes = 0
  const totalCells = Math.ceil((dayOfWeekOffset + lastOfMonth.getDate()) / 7) * 7;

  const dayHasCard = new Set<number>();
  for (const c of cards) {
    const d = new Date(c.visitDate);
    if (d.getFullYear() === year && d.getMonth() === month) {
      dayHasCard.add(d.getDate());
    }
  }

  const monthLabel = today.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  const lastCard = cards[0];

  return (
    <div className={orto.tarjetaCuerpo}>
      <div className="max-w-[420px]">
        <div className="text-[13px] font-semibold capitalize mb-[10px]">{monthLabel}</div>
        <div className={`${orto.datoEtiqueta} grid grid-cols-7 gap-[6px] mb-[6px]`}>
          {["L", "M", "X", "J", "V", "S", "D"].map((d, i) => (
            <div key={i} className="text-center">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-[6px]">
          {Array.from({ length: totalCells }, (_, i) => {
            const day = i - dayOfWeekOffset + 1;
            const inMonth = day >= 1 && day <= lastOfMonth.getDate();
            const isToday = inMonth && day === today.getDate();
            const isAppt = inMonth && dayHasCard.has(day);
            return (
              <div
                key={i}
                className={`h-[38px] rounded-[8px] border text-xs flex flex-col items-center justify-center gap-[3px] ${
                  !inMonth
                    ? "border-transparent"
                    : isToday
                      ? "border-[color:var(--pr-activo)] bg-[color:var(--pr-activo-suave)]"
                      : isAppt
                        ? "border-[color:var(--orto-violeta-borde)] bg-[color:var(--pr-tarjeta)]"
                        : "border-[color:var(--pr-borde-suave)] bg-[color:var(--pr-tarjeta-2)]"
                }`}
              >
                {inMonth ? (
                  <>
                    <span className={isToday ? `${orto.tonoVioleta} font-bold` : orto.tonoTexto2}>
                      {day}
                    </span>
                    {isAppt ? <span className={`${orto.punto} ${orto.tonoVioleta}`} aria-hidden /> : null}
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className={`${orto.tonoApagado} mt-[12px] text-xs`}>
        {dayHasCard.size} control{dayHasCard.size === 1 ? "" : "es"} registrado
        {dayHasCard.size === 1 ? "" : "s"} este mes.
        {lastCard ? (
          <span>
            {" "}
            Último: {fmtDateShort(lastCard.visitDate)} · fase {PHASE_LABELS[lastCard.phaseKey]}.
          </span>
        ) : null}
      </div>
    </div>
  );
}
