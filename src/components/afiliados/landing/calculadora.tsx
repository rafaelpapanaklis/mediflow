"use client";

/**
 * Calculadora pública del programa de afiliados.
 *
 * CORTE SERVER/CLIENT (la razón de que exista payout-core):
 * este componente importa la matemática SÓLO de `@/lib/affiliates/payout-core`
 * —módulo puro, sin Prisma—. Importar `payout.ts` o `public-offer.ts` desde
 * aquí metería el cliente de Prisma en el bundle del navegador y rompería el
 * build. Los montos llegan como PROPS desde el server component de
 * /afiliados, que sí los resuelve en vivo desde affiliate_payout_config y
 * plan_configs: en este archivo no hay ni un peso escrito a mano.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Calculator, Minus, Plus, Zap } from "lucide-react";
import {
  DEFAULT_PAYOUT_CONFIG,
  simulateProgram,
  type PayoutConfig,
  type PlanKey,
} from "@/lib/affiliates/payout-core";

/**
 * Espejo local de PublicOfferPlan. A propósito NO se importa el tipo de
 * `public-offer.ts`: aunque un `import type` se borra al compilar, basta un
 * refactor que lo convierta en import de valor para arrastrar Prisma al
 * navegador. Una interfaz de seis campos sale más barata que ese riesgo.
 */
export interface PlanRow {
  key: PlanKey;
  label: string;
  priceMxn: number;
  recurringMxn: number;
  oneTimeMxn: number;
  oneTimeAsMonths: number | null;
}

export interface CalculadoraAfiliadosProps {
  plans: PlanRow[];
  cfg: PayoutConfig;
  pricesMxn: Record<PlanKey, number>;
  startAtInvoiceNo: number;
}

const MAX_CLINICAS = 999;

/** Mismo formato que `fmtMxn` de public-offer, duplicado para no importarlo. */
function fmtMxn(n: number): string {
  const value = Number.isFinite(n) ? n : 0;
  return "$" + Math.round(value).toLocaleString("es-MX");
}

/**
 * Arranca con clínicas ya puestas para que la primera pintada muestre
 * resultados en vez de tres ceros. Se siembra el plan intermedio si existe;
 * si el admin apagó ese plan, el primero que quede.
 */
function initialCounts(rows: PlanRow[]): Record<PlanKey, number> {
  const base: Record<PlanKey, number> = { BASIC: 0, PRO: 0, CLINIC: 0 };
  const seed = rows.find((p) => p.key === "PRO") ?? rows[0];
  if (seed) base[seed.key] = 3;
  return base;
}

export function CalculadoraAfiliados({
  plans,
  cfg,
  pricesMxn,
  startAtInvoiceNo,
}: CalculadoraAfiliadosProps) {
  // Un plan sin comisión en ninguna de las dos modalidades está apagado en la
  // config: sumarlo sólo produciría ceros confusos.
  const activos = plans.filter((p) => p.recurringMxn > 0 || p.oneTimeMxn > 0);
  const rows = activos.length > 0 ? activos : plans;

  const [counts, setCounts] = useState<Record<PlanKey, number>>(() => initialCounts(rows));

  function setCount(key: PlanKey, raw: number) {
    const n = Number.isFinite(raw) ? Math.min(MAX_CLINICAS, Math.max(0, Math.floor(raw))) : 0;
    setCounts((prev) => ({ ...prev, [key]: n }));
  }

  const sim = simulateProgram(counts, pricesMxn, cfg);

  // El arranque de la comisión sale de la config, nunca de un literal: si el
  // admin lo mueve a 1 o a 3, el conteo de pagos del primer año lo sigue.
  const startAt =
    Number.isFinite(startAtInvoiceNo) && startAtInvoiceNo > 0
      ? Math.round(startAtInvoiceNo)
      : DEFAULT_PAYOUT_CONFIG.startAtInvoiceNo;
  const cobrosSinComision = Math.max(0, startAt - 1);
  const mesesPagados = Math.max(0, 12 - cobrosSinComision);
  const acumulado12 = sim.recurring.costMxn * mesesPagados;

  const detallePrimerAnio =
    cobrosSinComision === 0
      ? `Son ${mesesPagados} pagos: uno por cada mes que la clínica siga suscrita.`
      : cobrosSinComision === 1
        ? `Son ${mesesPagados} pagos: el primer cobro de cada clínica es promocional y no comisiona.`
        : `Son ${mesesPagados} pagos: los primeros ${cobrosSinComision} cobros de cada clínica son promocionales y no comisionan.`;

  if (rows.length === 0) return null;

  return (
    <div className="afi-calc">
      <div className="afi-calc__head">
        <Calculator className="afi-calc__headicon" aria-hidden="true" />
        <h3 className="afi-calc__title">Calcula lo que ganarías</h3>
        <span className="afi-calc__badge">
          <Zap aria-hidden="true" /> Montos vigentes hoy
        </span>
      </div>

      <div className="afi-calc__body">
        <div className="afi-calc__rows">
          {rows.map((p) => {
            const id = `afi-count-${p.key}`;
            const meta: string[] = [];
            if (p.priceMxn > 0) meta.push(`Plan de ${fmtMxn(p.priceMxn)}/mes`);
            if (p.recurringMxn > 0) meta.push(`${fmtMxn(p.recurringMxn)} al mes para ti`);
            if (p.oneTimeMxn > 0) meta.push(`${fmtMxn(p.oneTimeMxn)} de una sola vez`);
            const value = counts[p.key] ?? 0;

            return (
              <div key={p.key} className="afi-calc__row">
                <div className="afi-calc__rowinfo">
                  <label className="afi-calc__rowname" htmlFor={id}>
                    Clínicas en plan {p.label}
                  </label>
                  {meta.length > 0 && <span className="afi-calc__rowmeta">{meta.join(" · ")}</span>}
                </div>

                <div className="afi-stepper">
                  <button
                    type="button"
                    className="afi-stepper__btn"
                    aria-label={`Quitar una clínica del plan ${p.label}`}
                    disabled={value <= 0}
                    onClick={() => setCount(p.key, value - 1)}
                  >
                    <Minus aria-hidden="true" />
                  </button>
                  <input
                    id={id}
                    className="afi-stepper__input"
                    type="number"
                    min={0}
                    max={MAX_CLINICAS}
                    step={1}
                    inputMode="numeric"
                    value={value}
                    onChange={(e) =>
                      setCount(p.key, e.target.value === "" ? 0 : Number(e.target.value))
                    }
                  />
                  <button
                    type="button"
                    className="afi-stepper__btn"
                    aria-label={`Agregar una clínica al plan ${p.label}`}
                    disabled={value >= MAX_CLINICAS}
                    onClick={() => setCount(p.key, value + 1)}
                  >
                    <Plus aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div aria-live="polite">
          {sim.clinics === 0 ? (
            <p className="afi-calc__empty">
              Agrega clínicas para ver tu estimación.
            </p>
          ) : (
            <>
              <div className="afi-results">
                <div className="afi-result afi-result--hero">
                  <p className="afi-result__label">Modalidad recurrente — al mes</p>
                  <p className="afi-result__value">{fmtMxn(sim.recurring.costMxn)}</p>
                  <p className="afi-result__sub">
                    Cada mes, mientras esas clínicas sigan suscritas.
                  </p>
                </div>

                <div className="afi-result">
                  <p className="afi-result__label">Acumulado en los primeros 12 meses</p>
                  <p className="afi-result__value">{fmtMxn(acumulado12)}</p>
                  <p className="afi-result__sub">{detallePrimerAnio}</p>
                </div>

                <div className="afi-result">
                  <p className="afi-result__label">Modalidad pago único — de golpe</p>
                  <p className="afi-result__value">{fmtMxn(sim.onetime.costMxn)}</p>
                  <p className="afi-result__sub">
                    Un solo pago por esas {sim.clinics}{" "}
                    {sim.clinics === 1 ? "clínica" : "clínicas"}.
                  </p>
                </div>
              </div>

              <div className="afi-calc__foot">
                <p className="afi-note">
                  Después del primer año, la modalidad recurrente sigue pagándote{" "}
                  <b>{fmtMxn(sim.recurring.costMxn)} al mes</b> mientras esas clínicas sigan
                  activas. La modalidad de pago único ya se cobró completa y no se repite.
                </p>
                <p className="afi-disclaimer">
                  Es una estimación con los montos vigentes hoy. No es una promesa de ingresos.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="afi-calc__cta">
          <Link href="/afiliados/registro" className="mfh-btn mfh-btn--primary">
            Registrarme gratis <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}
