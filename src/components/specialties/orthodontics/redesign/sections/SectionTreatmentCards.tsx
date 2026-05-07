"use client";
// Sección D — Treatment Card · Citas mensuales (G1 ⭐).
//
// 3 tabs: Próxima cita / Historial / Calendario.
// Click en una row del historial → abre DrawerTreatmentCard (ver hermano).

import { useState } from "react";
import { Plus, Zap } from "lucide-react";
import { Btn, Card } from "../atoms";
import { TimelineRow } from "../atoms/TimelineRow";
import {
  PHASE_LABELS,
  type NextAppointmentDTO,
  type TreatmentCardDTO,
} from "../types";
import { fmtDate, fmtDateShort } from "../atoms/format";

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
  const [tab, setTab] = useState<Tab>("next");

  const sorted = [...props.cards].sort((a, b) => b.cardNumber - a.cardNumber);

  const tabs: ReadonlyArray<{ id: Tab; label: string; count?: number }> = [
    { id: "next", label: "Próxima cita" },
    { id: "history", label: "Historial", count: sorted.length },
    { id: "calendar", label: "Calendario" },
  ];

  return (
    <Card
      id="tcards"
      eyebrow="Sección D · G1 — Gap más grande cerrado"
      title="Treatment Card · Citas mensuales"
      accent="violet"
      action={
        props.onStartNewCard ? (
          <Btn
            variant="primary"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" aria-hidden />}
            onClick={props.onStartNewCard}
          >
            Nueva cita
          </Btn>
        ) : null
      }
    >
      <nav
        className="px-6 pt-3 border-b border-slate-100 dark:border-slate-800"
        role="tablist"
        aria-label="Vista de Treatment Card"
      >
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors focus:outline-none ${
                tab === t.id
                  ? "border-violet-600 text-violet-700 font-medium dark:text-violet-300"
                  : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {t.label}
              {t.count != null ? (
                <span className="ml-1.5 text-[10px] font-mono text-slate-400 dark:text-slate-500">
                  {t.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </nav>

      {tab === "next" ? (
        <NextTabPanel
          next={props.nextAppointment}
          onStart={props.onStartNewCard}
          confirmLabel={props.confirmLabel ?? "Confirmar WhatsApp"}
        />
      ) : null}
      {tab === "history" ? (
        <HistoryTabPanel
          cards={sorted}
          onOpenCard={props.onOpenCard}
        />
      ) : null}
      {tab === "calendar" ? <CalendarTabPanel cards={sorted} /> : null}
    </Card>
  );
}

function NextTabPanel({
  next,
  onStart,
  confirmLabel,
}: {
  next: NextAppointmentDTO | null;
  onStart?: () => void;
  confirmLabel: string;
}) {
  if (!next) {
    return (
      <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
        Sin próxima cita programada.
      </div>
    );
  }
  return (
    <div className="p-6">
      <div className="bg-violet-50 border border-violet-200 rounded-lg p-5 dark:bg-violet-900/20 dark:border-violet-800">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-violet-700 font-medium dark:text-violet-300">
              Próxima cita
            </div>
            <div className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">
              {fmtDate(next.date)}
            </div>
            <div className="text-sm text-slate-600 mt-0.5 dark:text-slate-400">
              {next.type} · {next.durationMin} min
              {next.chair ? ` · ${next.chair}` : ""}
            </div>
            <div className="text-xs text-slate-500 mt-1 dark:text-slate-500">
              con {next.doctor}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Btn variant="secondary" size="sm">
              {confirmLabel}
            </Btn>
            {onStart ? (
              <Btn
                variant="primary"
                size="sm"
                icon={<Zap className="w-3.5 h-3.5" aria-hidden />}
                onClick={onStart}
              >
                Comenzar cita
              </Btn>
            ) : null}
          </div>
        </div>
        {next.prep.length > 0 ? (
          <div className="mt-4 pt-4 border-t border-violet-200/60 dark:border-violet-800">
            <div className="text-[10px] uppercase tracking-wider text-violet-700 font-medium mb-2 dark:text-violet-300">
              Plan para esta cita (sugerencia IA)
            </div>
            <ul className="space-y-1">
              {next.prep.map((p, i) => (
                <li
                  key={i}
                  className="text-sm text-slate-700 flex items-center gap-2 dark:text-slate-300"
                >
                  <span
                    className="w-4 h-4 rounded border border-violet-300 bg-white flex items-center justify-center dark:bg-slate-900 dark:border-violet-700"
                    aria-hidden
                  />
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
}: {
  cards: TreatmentCardDTO[];
  onOpenCard?: (id: string) => void;
}) {
  if (cards.length === 0) {
    return (
      <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
        Aún no hay citas registradas en este tratamiento.
      </div>
    );
  }
  return (
    <div className="p-6 space-y-3">
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
    <div className="p-6">
      <div className="grid grid-cols-7 gap-2 text-[10px] uppercase tracking-wider text-slate-400 mb-2 dark:text-slate-500">
        {["L", "M", "X", "J", "V", "S", "D"].map((d, i) => (
          <div key={i} className="text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: totalCells }, (_, i) => {
          const day = i - dayOfWeekOffset + 1;
          const inMonth = day >= 1 && day <= lastOfMonth.getDate();
          const isToday = inMonth && day === today.getDate();
          const isAppt = inMonth && dayHasCard.has(day);
          return (
            <div
              key={i}
              className={`aspect-square rounded-md border text-xs flex flex-col items-center justify-start p-1.5 ${
                !inMonth
                  ? "border-transparent"
                  : isToday
                    ? "border-violet-500 bg-violet-50 dark:bg-violet-900/30 dark:border-violet-700"
                    : isAppt
                      ? "border-violet-200 bg-white dark:bg-slate-900 dark:border-violet-700/40"
                      : "border-slate-100 bg-white dark:bg-slate-900 dark:border-slate-800"
              }`}
            >
              {inMonth ? (
                <>
                  <span
                    className={`text-[11px] ${
                      isToday
                        ? "font-bold text-violet-700 dark:text-violet-300"
                        : "text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    {day}
                  </span>
                  {isAppt ? (
                    <span
                      className="mt-1 w-1.5 h-1.5 rounded-full bg-violet-500"
                      aria-hidden
                    />
                  ) : null}
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-4 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="capitalize">{monthLabel}</span> · {dayHasCard.size} cita
        {dayHasCard.size === 1 ? "" : "s"} registrada{dayHasCard.size === 1 ? "" : "s"} este
        mes.
        {lastCard ? (
          <span> Última: {fmtDateShort(lastCard.visitDate)} · fase {PHASE_LABELS[lastCard.phaseKey]}.</span>
        ) : null}
      </div>
    </div>
  );
}
