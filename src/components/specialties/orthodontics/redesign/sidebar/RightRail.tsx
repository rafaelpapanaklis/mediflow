"use client";
// Columna derecha de la pestaña de Ortodoncia: tarjetas apiladas que se
// quedan a la vista al bajar.
//   - Próxima cita
//   - Estado de cuenta (total / pagado / saldo + barra)
//   - En clínica (si el paciente está dentro)
//   - Sugerencias del asistente
//   - WhatsApp recientes

import { Calendar, CalendarClock, Clock, DollarSign, MapPin, MessageCircle, Sparkles, Wallet } from "lucide-react";
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
import orto from "../orto.module.css";

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

const ICONO = { size: 15, strokeWidth: 1.75 } as const;

export function RightRail(props: RightRailProps) {
  const remaining = Math.max(0, props.treatment.totalCost - props.treatment.paid);
  return (
    <aside className={orto.riel}>
      <NextAppointmentCard
        next={props.nextAppointment}
        onConfirm={props.onConfirmWhatsApp}
      />

      <Card title="Estado de cuenta" icon={<Wallet {...ICONO} />}>
        <div className={orto.tarjetaCuerpo}>
          <KV k="Total del tratamiento" v={fmtMoney(props.treatment.totalCost)} />
          <KV k="Pagado" v={fmtMoney(props.treatment.paid)} vClass={orto.tonoExito} />
          <KV
            k="Saldo"
            v={fmtMoney(remaining)}
            className={orto.filaTotal}
            vClass={remaining > 0 ? orto.tonoPeligro : orto.tonoExito}
          />
          <ProgressBar
            value={props.treatment.paid}
            max={props.treatment.totalCost}
            color="emerald"
            className="mt-3"
            ariaLabel="Avance de pagos"
          />
          {props.onCollectNow ? (
            <Btn
              variant="primary"
              size="md"
              className="mt-3 w-full"
              icon={<DollarSign size={15} strokeWidth={1.75} aria-hidden />}
              onClick={props.onCollectNow}
            >
              Cobrar ahora
              {props.suggestedChargeAmount != null
                ? ` · ${fmtMoney(props.suggestedChargeAmount)}`
                : ""}
            </Btn>
          ) : null}
        </div>
      </Card>

      {props.patientFlow ? <PatientFlowCard flow={props.patientFlow} /> : null}

      {props.aiSuggestions.length > 0 ? (
        <Card title="Sugerencias" icon={<Sparkles {...ICONO} />}>
          <div className={`${orto.tarjetaCuerpo} flex flex-col gap-[10px]`}>
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
        <Card title="WhatsApp recientes" icon={<MessageCircle {...ICONO} />}>
          <div className={`${orto.tarjetaCuerpo} flex flex-col gap-2`}>
            {props.whatsappRecent.length === 0 ? (
              <div className={orto.vacioLinea}>Todavía no hay mensajes con este paciente.</div>
            ) : null}
            {props.whatsappRecent.slice(0, 3).map((w) => (
              <WhatsAppEntry key={w.id} w={w} />
            ))}
            {props.onOpenChat ? (
              <Btn
                variant="secondary"
                size="md"
                className="mt-1 w-full"
                icon={<MessageCircle size={15} strokeWidth={1.75} aria-hidden />}
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
      <Card title="Próxima cita" icon={<CalendarClock {...ICONO} />}>
        <div className={orto.tarjetaCuerpo}>
          <div className={orto.vacio}>
            <span className={orto.vacioIcono} aria-hidden>
              <Calendar size={17} strokeWidth={1.75} />
            </span>
            <p className={orto.vacioTitulo}>Sin cita programada</p>
            <p className={orto.vacioPista}>
              Al cerrar un control puedes dejar indicado en cuántas semanas vuelve.
            </p>
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card title="Próxima cita" icon={<CalendarClock {...ICONO} />}>
      <div className={orto.tarjetaCuerpo}>
        <div className={`${orto.datoValor} ${orto.tonoVioleta}`} style={{ marginTop: 0 }}>
          {fmtDate(next.date)}
        </div>
        <div className={orto.datoSub}>
          {fmtTime(next.date)} · {next.durationMin} min
        </div>
        <div className="mt-3">
          <KV k="Tipo" v={next.type} />
          {next.wireActivation ? (
            <KV k="Activación" v={next.wireActivation} vClass={orto.tonoVioleta} />
          ) : null}
          {next.chair ? <KV k="Sillón" v={next.chair} /> : null}
          <KV k="Doctor" v={next.doctor} />
        </div>
        {onConfirm ? (
          <Btn
            variant="emerald-soft"
            size="md"
            className="mt-3 w-full"
            icon={<MessageCircle size={15} strokeWidth={1.75} aria-hidden />}
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
    <Card title="En clínica" icon={<MapPin {...ICONO} />} accent="amber">
      <div className={`${orto.tarjetaCuerpo} flex flex-col gap-2`}>
        <div className="flex items-center gap-2 flex-wrap">
          <Pill color={tone}>
            <span className={`${orto.punto} ${orto.puntoVivo}`} aria-hidden />
            {FLOW_STATUS_LABELS[flow.status]}
          </Pill>
          <span className={`${orto.tonoApagado} text-xs`}>desde {since}</span>
        </div>
        {flow.chair ? <KV k="Sillón" v={flow.chair} /> : null}
        <div className={`${orto.tonoApagado} flex items-center gap-1 text-[11.5px]`}>
          <Clock size={12} strokeWidth={1.75} aria-hidden />
          Ingresó {fmtDateShort(flow.enteredAt)} · {since}
        </div>
        {/* Mini-stepper visual */}
        <div className="mt-1 flex gap-1">
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
                    ? "bg-[color:var(--pr-activo)]"
                    : isPast
                      ? "bg-[color:var(--pr-exito)]"
                      : "bg-[color:var(--pr-hover)]"
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
  const variant: "emerald-soft" | "violet-soft" =
    s.cta === "whatsapp" ? "emerald-soft" : "violet-soft";
  const Icon = s.cta === "whatsapp" ? MessageCircle : Calendar;
  return (
    <div className={orto.caja}>
      <div className="text-[13px] font-semibold">{s.title}</div>
      <div className={`${orto.tonoTexto2} mt-[2px] text-xs leading-relaxed`}>{s.body}</div>
      {onAction ? (
        <Btn
          variant={variant}
          size="sm"
          className="mt-2 w-full"
          icon={<Icon size={14} strokeWidth={1.75} aria-hidden />}
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
    <div className={orto.caja}>
      <div className="flex items-center justify-between gap-2 mb-[2px]">
        <span className={orto.datoEtiqueta}>
          {w.direction === "in" ? "Recibido" : "Enviado"}
        </span>
        <span className={`${orto.tonoApagado} text-[11px]`}>{w.at}</span>
      </div>
      <div className={`${orto.tonoTexto2} text-xs line-clamp-2`}>{w.preview}</div>
    </div>
  );
}
