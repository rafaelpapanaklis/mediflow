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
import { useCajon } from "../atoms/useCajon";
import orto from "../orto.module.css";

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
  const cajonRef = useCajon<HTMLElement>(props.onClose);
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
        className={orto.velo}
        onClick={props.onClose}
        aria-hidden
      />
      <aside
        ref={cajonRef}
        tabIndex={-1}
        className={orto.cajon}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-edit-financial-title"
      >
        <header className={orto.cajonCabeza}>
          <div>
            <div className={orto.cajonCeja}>
              Editor del plan financiero
            </div>
            <h3
              id="drawer-edit-financial-title"
              className={orto.cajonTitulo}
            >
              Modificar precio · enganche · meses
            </h3>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Cerrar"
            className={orto.botonIcono}
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {c.paidInstallmentsCount > 0 ? (
            <div className="bg-[color:var(--pr-alerta-suave)] border border-[color:var(--orto-alerta-borde)] rounded-[10px] p-3 text-xs text-[color:var(--pr-alerta)]">
              <strong>{c.paidInstallmentsCount} mensualidad(es) ya pagada(s)</strong>
              · Estas se preservan. Solo se recalculan las pendientes.
            </div>
          ) : null}

          {/* Total */}
          <div>
            <label className="block text-xs font-semibold text-[color:var(--pr-texto-2)] mb-1">
              Precio total del tratamiento
            </label>
            <div className="relative">
              <DollarSign
                className="w-4 h-4 text-[color:var(--pr-texto-3)] absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden
              />
              <input
                type="number"
                step="100"
                value={totalAmount}
                onChange={(e) => setTotalAmount(Number(e.target.value))}
                className={`${orto.entrada} w-full`}
                placeholder="33340"
              />
            </div>
            {downGreaterThanTotal ? (
              <div className="mt-1 text-[11px] text-[color:var(--pr-peligro)]">
                El enganche no puede ser mayor o igual al total.
              </div>
            ) : null}
          </div>

          {/* Enganche */}
          <div>
            <label className="block text-xs font-semibold text-[color:var(--pr-texto-2)] mb-1">
              Enganche (pago inicial)
            </label>
            <div className="relative">
              <DollarSign
                className="w-4 h-4 text-[color:var(--pr-texto-3)] absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden
              />
              <input
                type="number"
                step="100"
                value={downPayment}
                onChange={(e) => setDownPayment(Number(e.target.value))}
                className={`${orto.entrada} w-full`}
                placeholder="0 (sin enganche)"
              />
            </div>
            <div className="mt-1 text-[11px] text-[color:var(--pr-texto-3)]">
              Restante a financiar: <span className="tabular-nums font-semibold">{fmtMoney(Math.max(0, totalAmount - downPayment))}</span>
            </div>
          </div>

          {/* Meses */}
          <div>
            <label className="block text-xs font-semibold text-[color:var(--pr-texto-2)] mb-1">
              Número de mensualidades
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {MONTH_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setMonths(p.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-[8px] border transition-colors ${
                    months === p.value
                      ? "bg-[color:var(--pr-exito)] text-[color:var(--pr-activo-texto)] border-[color:var(--pr-exito)]"
                      : "bg-[color:var(--pr-tarjeta)] text-[color:var(--pr-texto-2)] border-[color:var(--pr-borde)] hover:bg-[color:var(--pr-hover)]"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setMonths(isCustomMonths ? months : 9)}
                className={`px-3 py-1.5 text-xs font-medium rounded-[8px] border transition-colors ${
                  isCustomMonths
                    ? "bg-[color:var(--pr-exito)] text-[color:var(--pr-activo-texto)] border-[color:var(--pr-exito)]"
                    : "bg-[color:var(--pr-tarjeta)] text-[color:var(--pr-texto-2)] border-[color:var(--pr-borde)] hover:bg-[color:var(--pr-hover)]"
                }`}
              >
                Personalizado
              </button>
            </div>
            {isCustomMonths ? (
              <div className="relative">
                <Calendar
                  className="w-4 h-4 text-[color:var(--pr-texto-3)] absolute left-3 top-1/2 -translate-y-1/2"
                  aria-hidden
                />
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={months}
                  onChange={(e) => setMonths(Number(e.target.value))}
                  className={`${orto.entrada} w-full`}
                  placeholder="9"
                />
              </div>
            ) : null}
            {tooFewMonths ? (
              <div className="mt-1 text-[11px] text-[color:var(--pr-peligro)]">
                Mínimo {c.paidInstallmentsCount} meses · ya hay esa cantidad
                de mensualidades pagadas.
              </div>
            ) : null}
          </div>

          {/* Día de pago */}
          <div>
            <label className="block text-xs font-semibold text-[color:var(--pr-texto-2)] mb-1">
              Día del mes para cobrar
            </label>
            <input
              type="number"
              min={1}
              max={28}
              value={paymentDay}
              onChange={(e) => setPaymentDay(Number(e.target.value))}
              className={`${orto.entrada} w-full`}
            />
          </div>

          {/* Preview cálculo */}
          <div className="border border-[color:var(--orto-exito-borde)] bg-[color:var(--pr-exito-suave)] rounded-[10px] p-4">
            <div className="flex items-center gap-2 mb-2">
              <Calculator className="w-4 h-4 text-[color:var(--pr-exito)]" aria-hidden />
              <div className="text-xs font-semibold text-[color:var(--pr-exito)]">
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
            <div className="bg-[color:var(--pr-peligro-suave)] border border-[color:var(--orto-peligro-borde)] rounded-[10px] p-3 text-xs text-[color:var(--pr-peligro)]">
              {error}
            </div>
          ) : null}
        </div>

        <footer className={`${orto.cajonPie} ${orto.cajonPieReparto}`}>
          <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--pr-texto-3)]">
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
    ? "text-[color:var(--pr-exito)] font-bold tabular-nums"
    : muted
      ? "text-[color:var(--pr-texto-3)] tabular-nums"
      : "text-[color:var(--pr-texto)] tabular-nums";
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-[color:var(--pr-texto-2)]">{k}</span>
      <span className={valueCls}>{v}</span>
    </div>
  );
}
