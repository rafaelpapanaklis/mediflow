"use client";
// Right rail del rediseño ortho: cards apiladas con sticky scroll.
//   - Próxima cita (con CTA confirmar WhatsApp)
//   - Estado de cuenta (total/pagado/saldo + barra + Cobrar ahora + CFDI 4.0)
//   - Patient Flow G16 (si activo, badge tiempo real)
//   - Sugerencias IA M2 (cards con CTA WhatsApp/agendar)
//   - WhatsApp recientes M5 (lista corta + CTA abrir chat)

import { Calendar, Clock, DollarSign, MessageCircle, Sparkles } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { Card } from "../atoms/Card";
import { KV } from "../atoms/KV";
import { Pill } from "../atoms/Pill";
import { ProgressBar } from "../atoms/ProgressBar";
import { fmtDate, fmtDateShort, fmtMoney, fmtTime } from "../atoms/format";
import {
  FLOW_STATUS_LABELS,
  type AISuggestionDTO,
  type NextAppointmentDTO,
  type OrthoTreatmentDTO,
  type PatientFlowDTO,
  type WhatsAppEntryDTO,
} from "../types";

export interface RightRailProps {
  treatment: OrthoTreatmentDTO;
  nextAppointment: NextAppointmentDTO | null;
  patientFlow: PatientFlowDTO | null;
  aiSuggestions: AISuggestionDTO[];
  whatsappRecent: WhatsAppEntryDTO[];
  /** Monto sugerido en el botón "Cobrar ahora" (siguiente mensualidad). */
  suggestedChargeAmount?: number | null;
  onCollectNow?: () => void;
  onConfirmWhatsApp?: () => void;
  onOpenChat?: () => void;
  onAISuggestionAction?: (id: string) => void;
}

export function RightRail(props: RightRailProps) {
  const remaining = Math.max(0, props.treatment.totalCost - props.treatment.paid);
  return (
    <aside className="w-full lg:w-72 flex-shrink-0 space-y-4">
      <NextAppointmentCard
        next={props.nextAppointment}
        onConfirm={props.onConfirmWhatsApp}
      />

      <Card title="Estado de cuenta" eyebrow="Plan ortodóntico">
        <div className="px-5 py-4 space-y-2">
          <KV
            k="Total tx"
            v={fmtMoney(props.treatment.totalCost)}
            vClass="font-mono text-slate-900 dark:text-slate-100"
          />
          <KV
            k="Pagado"
            v={fmtMoney(props.treatment.paid)}
            vClass="font-mono text-emerald-700 dark:text-emerald-400"
          />
          <div className="flex justify-between text-sm font-semibold pt-1 border-t border-slate-100 dark:border-slate-800">
            <span className="text-slate-700 dark:text-slate-300">Saldo</span>
            <span className="font-mono text-slate-900 dark:text-slate-100">
              {fmtMoney(remaining)}
            </span>
          </div>
          <ProgressBar
            value={props.treatment.paid}
            max={props.treatment.totalCost}
            color="emerald"
            className="mt-2"
            ariaLabel="Avance de pagos"
          />
          {props.onCollectNow ? (
            <Btn
              variant="primary"
              size="sm"
              className="mt-3 w-full justify-center"
              icon={<DollarSign className="w-3.5 h-3.5" aria-hidden />}
              onClick={props.onCollectNow}
            >
              Cobrar ahora
              {props.suggestedChargeAmount != null
                ? ` · ${fmtMoney(props.suggestedChargeAmount)}`
                : ""}
            </Btn>
          ) : null}
          <div className="text-[10px] text-slate-400 text-center mt-1 dark:text-slate-500">
            CFDI 4.0 timbrado automáticamente · M1 Facturapi
          </div>
        </div>
      </Card>

      {props.patientFlow ? <PatientFlowCard flow={props.patientFlow} /> : null}

      {props.aiSuggestions.length > 0 ? (
        <Card title="Sugerencias IA" eyebrow="M2 · Asistente clínico">
          <div className="px-5 py-4 space-y-3">
            {props.aiSuggestions.map((s) => (
              <AISuggestionCard
                key={s.id}
                s={s}
                onAction={props.onAISuggestionAction}
              />
            ))}
          </div>
        </Card>
      ) : null}

      {props.whatsappRecent.length > 0 || props.onOpenChat ? (
        <Card title="WhatsApp recientes" eyebrow="M5 · Bidireccional">
          <div className="px-5 py-4 space-y-2">
            {props.whatsappRecent.slice(0, 3).map((w) => (
              <WhatsAppEntry key={w.id} w={w} />
            ))}
            {props.onOpenChat ? (
              <Btn
                variant="secondary"
                size="sm"
                className="mt-2 w-full justify-center"
                icon={<MessageCircle className="w-3.5 h-3.5" aria-hidden />}
                onClick={props.onOpenChat}
              >
                Abrir chat completo
              </Btn>
            ) : null}
          </div>
        </Card>
      ) : null}
    </aside>
  );
}

function NextAppointmentCard({
  next,
  onConfirm,
}: {
  next: NextAppointmentDTO | null;
  onConfirm?: () => void;
}) {
  if (!next) {
    return (
      <Card title="Próxima cita" eyebrow="Sin programar">
        <div className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">
          No hay próxima cita en agenda.
        </div>
      </Card>
    );
  }
  return (
    <Card title="Próxima cita" eyebrow="HOY +1">
      <div className="px-5 py-4">
        <div className="text-base font-bold text-slate-900 dark:text-slate-100">
          {fmtDate(next.date)}
        </div>
        <div className="text-sm text-slate-600 dark:text-slate-400">
          {fmtTime(next.date)} · {next.durationMin} min
        </div>
        <div className="mt-2 pt-2 border-t border-slate-100 space-y-1 dark:border-slate-800">
          <KV k="Tipo" v={next.type} />
          {next.wireActivation ? (
            <KV
              k="Activación"
              v={next.wireActivation}
              vClass="text-violet-700 font-mono font-medium dark:text-violet-300"
            />
          ) : null}
          {next.chair ? <KV k="Sillón" v={next.chair} /> : null}
          <KV k="Doctor" v={next.doctor} />
        </div>
        {onConfirm ? (
          <Btn
            variant="emerald-soft"
            size="sm"
            className="mt-3 w-full justify-center"
            icon={<MessageCircle className="w-3.5 h-3.5" aria-hidden />}
            onClick={onConfirm}
          >
            Confirmar por WhatsApp
          </Btn>
        ) : null}
      </div>
    </Card>
  );
}

function PatientFlowCard({ flow }: { flow: PatientFlowDTO }) {
  const since = flow.enteredAt ? fmtTime(flow.enteredAt) : "—";
  const tone = flow.status === "WAITING" ? "amber" : flow.status === "IN_CHAIR" ? "violet" : "emerald";
  return (
    <Card title="Patient flow" eyebrow="G16 · En clínica">
      <div className="px-5 py-4 space-y-2">
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"
            aria-hidden
          />
          <Pill color={tone} size="sm">
            {FLOW_STATUS_LABELS[flow.status]}
          </Pill>
          <span className="text-xs text-slate-500 dark:text-slate-400">desde {since}</span>
        </div>
        {flow.chair ? (
          <KV
            k="Sillón"
            v={flow.chair}
            vClass="text-slate-900 font-medium dark:text-slate-100"
          />
        ) : null}
        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" aria-hidden />
            Ingresó {fmtDateShort(flow.enteredAt)} · {since}
          </span>
        </div>
        {/* Mini-stepper visual */}
        <div className="mt-2 flex gap-1">
          {(["WAITING", "IN_CHAIR", "CHECKOUT"] as const).map((s) => {
            const isPast =
              (flow.status === "IN_CHAIR" && s === "WAITING") ||
              (flow.status === "CHECKOUT" && (s === "WAITING" || s === "IN_CHAIR"));
            const isCurrent = s === flow.status;
            return (
              <div
                key={s}
                className={`flex-1 h-1.5 rounded-full ${
                  isCurrent
                    ? "bg-violet-500"
                    : isPast
                      ? "bg-emerald-500"
                      : "bg-slate-200 dark:bg-slate-700"
                }`}
                aria-label={FLOW_STATUS_LABELS[s]}
              />
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function AISuggestionCard({
  s,
  onAction,
}: {
  s: AISuggestionDTO;
  onAction?: (id: string) => void;
}) {
  const variant: "emerald" | "violet-soft" =
    s.cta === "whatsapp" ? "emerald" : "violet-soft";
  const Icon = s.cta === "whatsapp" ? MessageCircle : Calendar;
  return (
    <div className="bg-violet-50/50 border border-violet-100 rounded-lg p-3 dark:bg-violet-900/20 dark:border-violet-800">
      <div className="flex items-start gap-2 mb-1.5">
        <Sparkles
          className="w-3.5 h-3.5 text-violet-600 mt-0.5 flex-shrink-0 dark:text-violet-300"
          aria-hidden
        />
        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
          {s.title}
        </div>
      </div>
      <div className="text-[11px] text-slate-600 leading-relaxed dark:text-slate-400">
        {s.body}
      </div>
      {onAction ? (
        <Btn
          variant={variant}
          size="sm"
          className="mt-2 w-full justify-center"
          icon={<Icon className="w-3 h-3" aria-hidden />}
          onClick={() => onAction(s.id)}
        >
          {s.ctaLabel}
        </Btn>
      ) : null}
    </div>
  );
}

function WhatsAppEntry({ w }: { w: WhatsAppEntryDTO }) {
  return (
    <div className="border border-slate-100 rounded-md px-3 py-2 dark:border-slate-800">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium dark:text-slate-500">
          {w.direction === "in" ? "Recibido" : "Enviado"}
        </span>
        <span className="text-[10px] text-slate-400 dark:text-slate-500">{w.at}</span>
      </div>
      <div className="text-[11px] text-slate-700 line-clamp-1 dark:text-slate-300">
        {w.preview}
      </div>
    </div>
  );
}
