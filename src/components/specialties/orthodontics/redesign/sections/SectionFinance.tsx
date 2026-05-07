"use client";
// Sección F — Plan financiero del tratamiento.
//
// Header: 2 botones — "Presentar cotización" (G5) + "Sign@Home WhatsApp" (G6).
// Body: 3 cols Total/Pagado/Saldo + ProgressBar + botón Cobrar siguiente.
// Calendario: chips horizontales por mensualidad con estado pagado/pendiente/futuro.
// Footer: banner CFDI 4.0 Facturapi (M1) con CTA "Ver últimos N CFDI".

import { DollarSign, FileText, MessageCircle, Shield } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { Card } from "../atoms/Card";
import { Pill } from "../atoms/Pill";
import { ProgressBar } from "../atoms/ProgressBar";
import { fmtDateShort, fmtMoney } from "../atoms/format";
import type { OrthoInstallmentDTO } from "../types-finance";

export interface SectionFinanceProps {
  totalCost: number;
  paid: number;
  installments: OrthoInstallmentDTO[];
  /** Mensualidad sugerida en el botón "Cobrar siguiente". */
  nextInstallmentAmount?: number | null;
  /** Open Choice G5 — abre ModalOpenChoice. */
  onPresentQuote?: () => void;
  /** Sign@Home WhatsApp G6 — abre DrawerSignAtHome. */
  onSignAtHome?: () => void;
  /** Cobrar siguiente — abre ModalCollect. */
  onCollectNext?: () => void;
  /** Ver últimos CFDI — abre ModalCFDIList. */
  onViewCfdi?: () => void;
}

const INSTALLMENT_STYLE: Record<OrthoInstallmentDTO["status"], string> = {
  PAID: "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300",
  PENDING:
    "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300",
  OVERDUE:
    "bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-300",
  WAIVED:
    "bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400",
};

/** Para installments futuros sin estado "FUTURE", calculamos visual por dueDate. */
function visualStatus(
  inst: OrthoInstallmentDTO,
): "PAID" | "PENDING" | "OVERDUE" | "WAIVED" | "FUTURE" {
  if (inst.status === "PAID" || inst.status === "WAIVED") return inst.status;
  const due = new Date(inst.dueDate);
  const now = new Date();
  if (due > now && inst.status !== "OVERDUE") return "FUTURE";
  return inst.status;
}

const FUTURE_STYLE =
  "bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400";

export function SectionFinance(props: SectionFinanceProps) {
  const remaining = Math.max(0, props.totalCost - props.paid);
  const progressPct = props.totalCost > 0 ? Math.round((props.paid / props.totalCost) * 100) : 0;
  const nextPending = props.installments.find((i) => i.status === "PENDING");
  const nextAmount = props.nextInstallmentAmount ?? nextPending?.amount ?? 0;
  const monthlyAvg =
    props.installments.length > 0
      ? Math.floor(props.totalCost / props.installments.length)
      : 0;

  return (
    <Card
      id="finance"
      eyebrow="Sección F"
      title="Plan financiero del tratamiento"
      accent="emerald"
      action={
        <div className="flex gap-2 flex-wrap">
          {props.onPresentQuote ? (
            <Btn
              variant="secondary"
              size="sm"
              icon={<FileText className="w-3.5 h-3.5" aria-hidden />}
              onClick={props.onPresentQuote}
            >
              Presentar cotización <Pill color="violet" size="xs" className="ml-1">G5</Pill>
            </Btn>
          ) : null}
          {props.onSignAtHome ? (
            <Btn
              variant="emerald"
              size="sm"
              icon={<MessageCircle className="w-3.5 h-3.5" aria-hidden />}
              onClick={props.onSignAtHome}
            >
              Sign@Home WhatsApp <Pill color="white" size="xs" className="ml-1">G6</Pill>
            </Btn>
          ) : null}
        </div>
      }
    >
      <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-3 gap-4 border-b border-slate-100 dark:border-slate-800">
        <div className="md:border-r md:border-slate-100 md:pr-4 dark:md:border-slate-800">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">
            Total tratamiento
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900 font-mono dark:text-slate-100">
            {fmtMoney(props.totalCost)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 dark:text-slate-400">
            {props.installments.length} mensualidades de {fmtMoney(monthlyAvg)}
          </div>
        </div>
        <div className="md:border-r md:border-slate-100 md:pr-4 dark:md:border-slate-800">
          <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-medium dark:text-emerald-400">
            Pagado
          </div>
          <div className="mt-1 text-2xl font-bold text-emerald-700 font-mono dark:text-emerald-400">
            {fmtMoney(props.paid)}
          </div>
          <ProgressBar
            value={props.paid}
            max={props.totalCost}
            color="emerald"
            className="mt-2"
          />
          <div className="text-[11px] text-slate-500 mt-1 dark:text-slate-400">
            {progressPct}% del tratamiento
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">
            Saldo pendiente
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900 font-mono dark:text-slate-100">
            {fmtMoney(remaining)}
          </div>
          {props.onCollectNext && nextAmount > 0 ? (
            <Btn
              variant="emerald"
              size="sm"
              className="mt-2"
              icon={<DollarSign className="w-3.5 h-3.5" aria-hidden />}
              onClick={props.onCollectNext}
            >
              Cobrar siguiente · {fmtMoney(nextAmount)}
            </Btn>
          ) : null}
        </div>
      </div>

      <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h4 className="text-xs uppercase tracking-wider text-slate-500 font-medium dark:text-slate-400">
            Calendario de mensualidades
          </h4>
          <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
            <Pill color="emerald" size="xs">
              Pagado
            </Pill>
            <Pill color="amber" size="xs">
              Pendiente
            </Pill>
            <Pill color="slate" size="xs">
              Futuro
            </Pill>
          </div>
        </div>
        <div
          className={`grid gap-2`}
          style={{
            gridTemplateColumns: `repeat(${Math.min(props.installments.length, 8)}, minmax(0, 1fr))`,
          }}
        >
          {props.installments.map((inst) => {
            const v = visualStatus(inst);
            const cls = v === "FUTURE" ? FUTURE_STYLE : INSTALLMENT_STYLE[v as keyof typeof INSTALLMENT_STYLE];
            return (
              <div key={inst.id} className={`border rounded-md p-2 text-center ${cls}`}>
                <div className="text-[10px] uppercase tracking-wider opacity-70">
                  Mes {inst.installmentNumber}
                </div>
                <div className="text-xs font-mono font-semibold mt-0.5">
                  {fmtMoney(inst.amount)}
                </div>
                <div className="text-[9px] mt-0.5 opacity-70">
                  {fmtDateShort(inst.dueDate)}
                </div>
                {inst.cfdiUuid ? (
                  <div className="mt-1 text-[8px] uppercase tracking-wider opacity-80">
                    CFDI ✓
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-6 py-4 flex items-center justify-between bg-slate-50/50 flex-wrap gap-2 dark:bg-slate-900/40">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded bg-violet-100 flex items-center justify-center dark:bg-violet-900/40"
            aria-hidden
          >
            <Shield className="w-4 h-4 text-violet-700 dark:text-violet-300" aria-hidden />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              CFDI 4.0 nativo · Facturapi
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Cada cobro genera factura electrónica timbrada automáticamente ·{" "}
              <span className="text-violet-700 font-medium dark:text-violet-300">Moat M1</span>
            </div>
          </div>
        </div>
        {props.onViewCfdi ? (
          <Btn
            variant="ghost"
            size="sm"
            icon={<FileText className="w-3.5 h-3.5" aria-hidden />}
            onClick={props.onViewCfdi}
          >
            Ver últimos CFDI
          </Btn>
        ) : null}
      </div>
    </Card>
  );
}
