"use client";

import { useState, type KeyboardEvent, type MutableRefObject } from "react";
import { Check, CreditCard, Landmark, Loader2, Lock, RefreshCw, ShieldCheck, Store } from "lucide-react";
import type { PlanId } from "@/lib/billing/plans";
import { FIRST_MONTH_PROMO_MXN, cfdiBullet } from "@/lib/plan-shared";
import type { PlanCardData } from "@/app/dashboard/suspended/suspended-client";
import { centavosAMxn, importeSpei, type CuentaBancaria } from "@/lib/billing/spei-directo-core";
import { desgloseConIva, desgloseSinIva, ivaAplica } from "@/lib/billing/iva-cobro";
import { DatosTransferencia } from "./datos-transferencia";
import s from "./pago.module.css";

type PayMethod = "card" | "spei" | "oxxo";
type Billing = "monthly" | "annual";

/**
 * Todo lo que `SuspendedPlanCards` (suspended-client.tsx) ya calcula y decide:
 * estado, teclado del radiogroup, checkout. Esta vista NO tiene lógica propia
 * de cobro: recibe la de siempre y solo la pinta con la marca del registro
 * (pago.module.css). Así el pago sigue pasando por el mismo código con la
 * bandera encendida o apagada.
 */
export interface VistaPlanes {
  t: (key: string, vars?: Record<string, string | number>) => string;
  fmt: (n: number) => string;
  plans: PlanCardData[];
  currentPlan: PlanId | null;
  firstMonthEligible: boolean;
  recommendedPlan: PlanId | null;
  selectedPlan: PlanId;
  selected: PlanCardData | undefined;
  billing: Billing;
  method: PayMethod;
  /** Solo los métodos que se ofrecen (SPEI falta si no hay cuenta bancaria configurada). */
  methods: Array<{ id: PayMethod; label: string }>;
  isRedirecting: boolean;
  ctaPrice: number;
  ctaPromo: boolean;
  cardRefs: MutableRefObject<Array<HTMLDivElement | null>>;
  methodRefs: MutableRefObject<Array<HTMLButtonElement | null>>;
  priceOf: (id: PlanId | null) => number | null;
  perMonth: (plan: PlanCardData) => number;
  annualSavings: (plan: PlanCardData) => number;
  upsellBenefit: (planId: PlanId) => string;
  setSelectedPlan: (id: PlanId) => void;
  setBilling: (b: Billing) => void;
  setMethod: (m: PayMethod) => void;
  onCardKeyDown: (e: KeyboardEvent<HTMLDivElement>, index: number) => void;
  onMethodKeyDown: (e: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  /** Compra nueva con plan del alta: arrancar en resumen (ver suspended-client). */
  resumenInicial: boolean;
  handleStripeCheckout: (plan: PlanId) => void;
  /** SPEI directo: la cuenta de /admin (null = no se ofrece), el folio de la clínica y el IVA del cobro. */
  cuentaSpei: CuentaBancaria | null;
  referenciaSpei: string | null;
  /** El checkout tiene el IVA 16 % configurado (STRIPE_IVA_TAX_RATE_ID o Stripe Tax). Sin él, tarjeta/OXXO no cobran. */
  cobroConIvaListo: boolean;
  /** Plan que esta clínica (de las de antes) paga por OXXO/SPEI SIN IVA; null = todo lleva IVA. */
  planSinIva: PlanId | null;
  declarandoSpei: boolean;
  handleDeclararSpei: (plan: PlanId) => void;
}

// El mismo orden de viñetas que la tarjeta de siempre: el cupo de CFDI va en
// tercer lugar (o al final si el plan tiene menos de dos viñetas).
function vinetas(plan: PlanCardData): string[] {
  return plan.features.length < 2
    ? [...plan.features, cfdiBullet(plan)]
    : [...plan.features.slice(0, 2), cfdiBullet(plan), ...plan.features.slice(2)];
}

export function PlanesSuspendida({ v }: { v: VistaPlanes }) {
  const { t, fmt } = v;
  // Solo qué se enseña: con el plan del alta se arranca en resumen y
  // «Cambiar plan» abre las tres tarjetas de siempre (misma rejilla, mismo
  // radiogroup). El plan seleccionado y el checkout no cambian.
  const [mostrarTodos, setMostrarTodos] = useState(!v.resumenInicial);
  const resumen = !mostrarTodos && v.selected ? v.selected : null;
  const anual = v.billing === "annual";
  // Todo pago lleva IVA 16 % (tarjeta, OXXO y SPEI), salvo OXXO/SPEI del plan que una clínica de las de
  // antes ya paga a mano: cada importe dice «+ IVA» solo si lleva.
  const ivaDe = (planId: PlanId) => ivaAplica({ metodo: v.method, plan: planId, planExento: v.planSinIva });
  const ivaSel = ivaDe(v.selectedPlan);
  const iva = ivaSel ? " + IVA" : "";
  const ivaPlan = (planId: PlanId) => (ivaDe(planId) ? " + IVA" : "");

  // LO QUE SE COBRA: mensual = el precio del plan; anual = el TOTAL del año
  // (priceMxnAnnual), no el mensual por doce. Es el unitAmount del checkout.
  const cobrado = (plan: PlanCardData) => (anual ? plan.priceMxnAnnual : plan.priceMxn);
  const unidad = anual ? "al año" : "al mes";
  const notaPrecio = (plan: PlanCardData) =>
    anual
      ? `Equivale a ${fmt(v.perMonth(plan))} al mes · ahorras ${fmt(v.annualSavings(plan))} (35%)`
      : v.firstMonthEligible
        ? `Tu primer mes: solo ${fmt(FIRST_MONTH_PROMO_MXN[plan.id])} con tarjeta · luego ${fmt(plan.priceMxn)}/mes`
        : "Facturación mensual · cancela cuando quieras";

  // Lo que se cobra en tarjeta/OXXO: el subtotal (promo del primer mes si aplica, si no el precio del
  // plan) + IVA 16 % sobre ESE subtotal — el IVA va sobre lo que se cobra, promo incluida.
  const cobroNuevo = desgloseConIva(
    v.selected ? (v.ctaPromo ? FIRST_MONTH_PROMO_MXN[v.selected.id] * 100 : cobrado(v.selected) * 100) : 0,
  );
  const cobroMostrado = ivaSel ? cobroNuevo : desgloseSinIva(cobroNuevo.subtotalCents);

  const esSpei = v.method === "spei" && v.cuentaSpei !== null && v.selected !== undefined;
  const importe = esSpei && v.selected
    ? importeSpei({ plan: v.selected, billing: v.billing, conIva: ivaSel })
    : null;

  return (
    <div>
      {/* === Ciclo: mensual / anual === */}
      <div className={s.cicloFila}>
        <div className={s.conmutador}>
          <span
            aria-hidden
            className={s.conmutadorDeslizante}
            style={{ transform: v.billing === "annual" ? "translateX(100%)" : "translateX(0)" }}
          />
          {(["monthly", "annual"] as Billing[]).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => v.setBilling(b)}
              aria-pressed={v.billing === b}
              className={`${s.conmutadorOpcion} ${v.billing === b ? s.conmutadorOpcionActiva : ""}`}
            >
              {b === "monthly" ? "Mensual" : "Anual"}
            </button>
          ))}
        </div>
        <span className={`${s.etiqueta} ${s.etiquetaExito}`}>
          {v.billing === "annual" || !v.firstMonthEligible ? "Anual: 35% de descuento" : "Tu primer mes desde $19"}
        </span>
      </div>

      {/* === Tu plan elegido (la tarjeta navy del registro, con «Cambiar plan») === */}
      {resumen && (
        <div className={s.resumen} role="status">
          <span className={s.resumenIcono} aria-hidden>
            <Check size={22} strokeWidth={2.6} />
          </span>
          <div className={s.resumenCuerpo}>
            <span className={s.resumenK}>Tu plan elegido</span>
            <span className={s.resumenNombre}>{resumen.name}</span>
            <span className={s.resumenPrecio}>
              <strong className={s.resumenCifra}>{fmt(cobrado(resumen))}</strong>
              <span>
                MXN {unidad}
                {iva}
              </span>
              <span className={s.resumenPildora}>{anual ? "Pago anual" : "Pago mensual"}</span>
            </span>
            <span className={s.resumenNota}>{notaPrecio(resumen)}</span>
            <span className={s.resumenBeneficios}>
              {vinetas(resumen).slice(0, 3).map((f) => (
                <span key={f} className={s.resumenBeneficio}>
                  <Check size={14} strokeWidth={3} className={s.resumenBeneficioIcono} aria-hidden />
                  {f}
                </span>
              ))}
            </span>
          </div>
          <button type="button" className={s.cambiarPlan} onClick={() => setMostrarTodos(true)}>
            <RefreshCw size={14} aria-hidden />
            Cambiar plan
          </button>
        </div>
      )}

      {/* === Las tres tarjetas de plan (radiogroup) === */}
      {!resumen && (
        <div role="radiogroup" aria-label={t("pages.suspended.choosePlanTitle")} className={s.planes}>
          {v.plans.map((plan, i) => {
            const isRecommended = plan.id === v.recommendedPlan;
            const isCurrent = plan.id === v.currentPlan;
            const isTop = plan.id === "CLINIC" && v.currentPlan === "CLINIC";
            const isSelected = plan.id === v.selectedPlan;

            const curPrice = v.priceOf(v.currentPlan);
            const showUpsellLine = isRecommended && curPrice != null;
            const upsellAmount = showUpsellLine ? plan.priceMxn - (curPrice as number) : 0;

            return (
              <div
                key={plan.id}
                ref={(el) => {
                  v.cardRefs.current[i] = el;
                }}
                role="radio"
                aria-checked={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => v.setSelectedPlan(plan.id)}
                onKeyDown={(e) => v.onCardKeyDown(e, i)}
                className={[
                  s.plan,
                  isRecommended ? s.planRecomendado : "",
                  isSelected ? s.planSeleccionado : "",
                ].filter(Boolean).join(" ")}
              >
                <div className={s.planCabeza}>
                  <div className={s.planEtiquetas}>
                    {isRecommended && (
                      <span className={`${s.etiqueta} ${s.etiquetaActivo}`}>
                        ★ {t("pages.suspended.recommendedBadge")}
                      </span>
                    )}
                    {isCurrent && (
                      <span className={`${s.etiqueta} ${s.etiquetaExito}`}>
                        {t("pages.suspended.currentPlanBadge")}
                      </span>
                    )}
                    {isTop && <span className={s.etiqueta}>{t("pages.suspended.topPlanBadge")}</span>}
                  </div>
                  <span className={`${s.radio} ${isSelected ? s.radioActivo : ""}`} aria-hidden>
                    {isSelected && <span className={s.radioPunto} />}
                  </span>
                </div>

                <div className={s.planNombre}>{plan.name}</div>

                <div className={s.precio}>
                  <span className={s.precioCifra}>{fmt(cobrado(plan))}</span>
                  <span className={s.precioUnidad}>
                    {unidad}
                    {ivaPlan(plan.id)}
                  </span>
                </div>
                <div className={s.precioNota}>{notaPrecio(plan)}</div>

                {showUpsellLine && (
                  <div className={s.mejora}>
                    {t("pages.suspended.upsellLine", {
                      amount: upsellAmount.toLocaleString("es-MX"),
                      benefit: v.upsellBenefit(plan.id),
                    })}
                  </div>
                )}

                <div className={s.separador} />

                <div className={s.beneficios}>
                  {vinetas(plan).map((f) => (
                    <div key={f} className={s.beneficio}>
                      <Check size={18} strokeWidth={3} className={s.beneficioIcono} aria-hidden />
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* === Pago: método + (datos de la transferencia) + botón + confianza === */}
      <div className={s.pago}>
        <p className={s.pagoTitulo}>
          <span className={s.pagoTituloIcono}><ShieldCheck size={16} aria-hidden /></span>
          ¿Cómo quieres pagar?
        </p>
        <div
          role="radiogroup"
          aria-label={t("pages.suspended.methodCard")}
          className={s.metodos}
          style={{ gridTemplateColumns: `repeat(${v.methods.length}, minmax(0, 1fr))` }}
        >
          {v.methods.map((m, i) => {
            const active = v.method === m.id;
            return (
              <button
                key={m.id}
                ref={(el) => {
                  v.methodRefs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onClick={() => v.setMethod(m.id)}
                onKeyDown={(e) => v.onMethodKeyDown(e, i)}
                className={`${s.metodo} ${active ? s.metodoActivo : ""}`}
              >
                {m.id === "card" && <CreditCard size={16} aria-hidden />}
                {m.id === "spei" && <Landmark size={16} aria-hidden />}
                {m.id === "oxxo" && <Store size={16} aria-hidden />}
                {m.label}
              </button>
            );
          })}
        </div>

        {v.method === "oxxo" && <p className={s.notaMetodo}>{t("pages.suspended.asyncMethodNote")}</p>}

        {esSpei && v.cuentaSpei && importe && v.referenciaSpei ? (
          <>
            <DatosTransferencia
              cuenta={v.cuentaSpei}
              importe={importe}
              referencia={v.referenciaSpei}
              periodo={anual ? "anual" : "mensual"}
            />
            <button
              type="button"
              onClick={() => v.handleDeclararSpei(v.selectedPlan)}
              disabled={v.declarandoSpei}
              className={s.cta}
            >
              {v.declarandoSpei ? <Loader2 size={17} className={s.girando} aria-hidden /> : <Check size={17} aria-hidden />}
              {v.declarandoSpei ? "Avisando…" : "Ya hice la transferencia"}
            </button>
            <p className={s.ayuda}>
              Pulsa el botón solo después de hacer la transferencia. Tu panel se activa cuando la confirmemos.
            </p>
            <div className={s.confianza}>
              <span className={s.confianzaItem}>
                <Landmark size={12} aria-hidden /> Transferencia SPEI directa
              </span>
              <span className={s.confianzaPunto}>·</span>
              <span>Confirmación manual</span>
            </div>
          </>
        ) : (
          <>
            {v.selected && (
              <div className={s.desglose} data-testid="desglose-iva">
                <div className={s.desgloseFila}>
                  <span>{v.ctaPromo ? "Primer mes con tarjeta" : anual ? "Plan anual" : "Plan mensual"}</span>
                  <span>{centavosAMxn(cobroMostrado.subtotalCents)}</span>
                </div>
                {ivaSel && (
                  <div className={s.desgloseFila}>
                    <span>IVA 16 %</span>
                    <span>{centavosAMxn(cobroMostrado.ivaCents)}</span>
                  </div>
                )}
                <div className={`${s.desgloseFila} ${s.desgloseTotal}`}>
                  <span>Total a pagar</span>
                  <span>{centavosAMxn(cobroMostrado.totalCents)}</span>
                </div>
              </div>
            )}

            {!v.cobroConIvaListo && ivaSel && (
              <p className={`${s.aviso} ${s.avisoPeligro}`} role="alert">
                El pago con tarjeta y OXXO no está disponible por ahora. Puedes pagar por transferencia SPEI o escribirnos a soporte.
              </p>
            )}

            <button
              type="button"
              onClick={() => v.handleStripeCheckout(v.selectedPlan)}
              disabled={v.isRedirecting || (!v.cobroConIvaListo && ivaSel)}
              className={s.cta}
            >
              {v.isRedirecting ? <Loader2 size={17} className={s.girando} aria-hidden /> : <Lock size={16} aria-hidden />}
              {v.isRedirecting ? (
                t("pages.suspended.redirecting")
              ) : v.selected ? (
                <span>
                  {v.ctaPromo
                    ? `Pagar ${v.selected.name} — ${centavosAMxn(cobroMostrado.totalCents)} el primer mes`
                    : `Pagar ${v.selected.name} — ${centavosAMxn(cobroMostrado.totalCents)} ${unidad}`}
                  {ivaSel && <span className={s.ctaIva}> (IVA incluido)</span>}
                </span>
              ) : (
                ""
              )}
            </button>

            <div className={s.confianza}>
              <span className={s.confianzaItem}>
                <Lock size={12} aria-hidden /> Pago seguro vía Stripe
              </span>
              <span className={s.confianzaPunto}>·</span>
              <span>Cancela cuando quieras</span>
              <span className={s.confianzaPunto}>·</span>
              <span>Sin contratos</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
