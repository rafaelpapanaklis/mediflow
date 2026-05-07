"use client";
// DrawerEditFinancialPlan — editor del plan financiero del tratamiento.
//
// Abre desde Sección F → "Editar plan financiero". Permite a la clínica
// modificar:
//   - precio total
//   - monto de enganche
//   - número de meses (presets 3/6/12/18/24 + personalizado)
//
// Server action `updateFinancialPlan`:
//   - preserva installments PAID
//   - recalcula installments PENDING/FUTURE
//   - actualiza paidAmount/pendingAmount
//   - sincroniza OrthodonticTreatmentPlan.totalCostMxn

import { useMemo, useState } from "react";
import { Calculator, Calendar, DollarSign, Save, Shield, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { Pill } from "../atoms/Pill";
import { fmtMoney } from "../atoms/format";

const MONTH_PRESETS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 3, label: "3 meses" },
  { value: 6, label: "6 meses" },
  { value: 12, label: "12 meses" },
  { value: 18, label: "18 meses" },
  { value: 24, label: "24 meses" },
];

export interface DrawerEditFinancialPlanProps {
  /** Valores actuales del plan financiero. */
  current: {
    totalAmount: number;
    initialDownPayment: number;
    installmentCount: number;
    installmentAmount: number;
    paidInstallmentsCount: number;
    paidAmount: number;
  };
  onClose: () => void;
  onConfirm?: (payload: {
    totalAmount: number;
    initialDownPayment: number;
    installmentCount: number;
    paymentDayOfMonth: number;
  }) => Promise<void> | void;
}

export function DrawerEditFinancialPlan(props: DrawerEditFinancialPlanProps) {
  const c = props.current;
  const [totalAmount, setTotalAmount] = useState<number>(c.totalAmount);
  const [downPayment, setDownPayment] = useState<number>(c.initialDownPayment);
  const [months, setMonths] = useState<number>(c.installmentCount);
  const [paymentDay, setPaymentDay] = useState<number>(14);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCustomMonths = !MONTH_PRESETS.find((p) => p.value === months);

  // Cálculo en vivo del nuevo installment (preview).
  const newInstallment = useMemo(() => {
    if (months <= 0) return 0;
    const remaining = totalAmount - downPayment;
    if (remaining <= 0) return 0;
    return Math.round(remaining / months);
  }, [totalAmount, downPayment, months]);

  // Validación: no se puede reducir installments por debajo de los ya pagados.
  const tooFewMonths = months < c.paidInstallmentsCount;
  const downGreaterThanTotal = downPayment >= totalAmount;
  const submittable =
    !tooFewMonths &&
    !downGreaterThanTotal &&
    totalAmount > 0 &&
    months >= 1 &&
    months <= 60 &&
    !submitting;

  const submit = async () => {
    if (!submittable) return;
    setSubmitting(true);
    setError(null);
    try {
      await props.onConfirm?.({
        totalAmount,
        initialDownPayment: downPayment,
        installmentCount: months,
        paymentDayOfMonth: paymentDay,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/50 z-40 dark:bg-slate-950/70"
        onClick={props.onClose}
        aria-hidden
      />
      <aside
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[500px] bg-white border-l border-slate-200 z-50 shadow-2xl flex flex-col dark:bg-slate-900 dark:border-slate-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-edit-financial-title"
      >
        <header className="px-6 py-4 border-b border-slate-100 bg-emerald-50/50 flex items-center justify-between dark:border-slate-800 dark:bg-emerald-900/10">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-medium dark:text-emerald-300">
              Editor del plan financiero
            </div>
            <h3
              id="drawer-edit-financial-title"
              className="text-base font-semibold text-slate-900 mt-0.5 dark:text-slate-100"
            >
              Modificar precio · enganche · meses
            </h3>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Cerrar"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {c.paidInstallmentsCount > 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-200">
              <strong>{c.paidInstallmentsCount} mensualidad(es) ya pagada(s)</strong>
              · Estas se preservan. Solo se recalculan las pendientes.
            </div>
          ) : null}

          {/* Total */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-300">
              Precio total del tratamiento
            </label>
            <div className="relative">
              <DollarSign
                className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden
              />
              <input
                type="number"
                step="100"
                value={totalAmount}
                onChange={(e) => setTotalAmount(Number(e.target.value))}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                placeholder="33340"
              />
            </div>
            {downGreaterThanTotal ? (
              <div className="mt-1 text-[11px] text-rose-600">
                El enganche no puede ser mayor o igual al total.
              </div>
            ) : null}
          </div>

          {/* Enganche */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-300">
              Enganche (pago inicial)
            </label>
            <div className="relative">
              <DollarSign
                className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden
              />
              <input
                type="number"
                step="100"
                value={downPayment}
                onChange={(e) => setDownPayment(Number(e.target.value))}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                placeholder="0 (sin enganche)"
              />
            </div>
            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Restante a financiar: <span className="font-mono font-semibold">{fmtMoney(Math.max(0, totalAmount - downPayment))}</span>
            </div>
          </div>

          {/* Meses */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-300">
              Número de mensualidades
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {MONTH_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setMonths(p.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                    months === p.value
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setMonths(isCustomMonths ? months : 9)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                  isCustomMonths
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700"
                }`}
              >
                Personalizado
              </button>
            </div>
            {isCustomMonths ? (
              <div className="relative">
                <Calendar
                  className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                  aria-hidden
                />
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={months}
                  onChange={(e) => setMonths(Number(e.target.value))}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                  placeholder="9"
                />
              </div>
            ) : null}
            {tooFewMonths ? (
              <div className="mt-1 text-[11px] text-rose-600">
                Mínimo {c.paidInstallmentsCount} meses · ya hay esa cantidad
                de mensualidades pagadas.
              </div>
            ) : null}
          </div>

          {/* Día de pago */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 dark:text-slate-300">
              Día del mes para cobrar
            </label>
            <input
              type="number"
              min={1}
              max={28}
              value={paymentDay}
              onChange={(e) => setPaymentDay(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
            />
          </div>

          {/* Preview cálculo */}
          <div className="border border-emerald-200 bg-emerald-50/50 rounded-lg p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
            <div className="flex items-center gap-2 mb-2">
              <Calculator className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
              <div className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                Vista previa del nuevo plan
              </div>
            </div>
            <div className="space-y-1 text-xs">
              <Row k="Total" v={fmtMoney(totalAmount)} />
              <Row k="Enganche" v={fmtMoney(downPayment)} />
              <Row k="Restante" v={fmtMoney(Math.max(0, totalAmount - downPayment))} />
              <Row
                k={`${months} mensualidades de`}
                v={fmtMoney(newInstallment)}
                emphasized
              />
              <Row
                k="Total mensualidades"
                v={fmtMoney(newInstallment * months)}
                muted
              />
            </div>
          </div>

          {error ? (
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-700 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-300">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="px-6 py-4 border-t border-slate-100 flex items-center justify-between dark:border-slate-800">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <Shield className="w-3 h-3" aria-hidden />
            Audit trail · cambios firmados con before/after
          </div>
          <div className="flex gap-2">
            <Btn variant="ghost" size="md" onClick={props.onClose}>
              Cancelar
            </Btn>
            <Btn
              variant="emerald"
              size="md"
              icon={<Save className="w-3.5 h-3.5" aria-hidden />}
              onClick={submit}
              disabled={!submittable}
            >
              {submitting ? "Guardando..." : "Guardar cambios"}
            </Btn>
          </div>
        </footer>
      </aside>
    </>
  );
}

function Row({
  k,
  v,
  emphasized,
  muted,
}: {
  k: string;
  v: string;
  emphasized?: boolean;
  muted?: boolean;
}) {
  const valueCls = emphasized
    ? "text-emerald-700 font-bold font-mono dark:text-emerald-300"
    : muted
      ? "text-slate-400 font-mono"
      : "text-slate-900 font-mono dark:text-slate-100";
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-slate-600 dark:text-slate-400">{k}</span>
      <span className={valueCls}>{v}</span>
    </div>
  );
}
