"use client";

import { ArrowLeftRight, Banknote, CreditCard, Ellipsis, ScrollText, X } from "lucide-react";
import {
  eduCambioCents,
  eduMoney,
  eduMoneyInputValue,
  eduPagosFailed,
  parseEduMoneyCents,
  parseEduPagosDivididos,
} from "@/lib/edu/dinero-core";
import {
  EDU_MAX_PAGOS_POR_OPERACION,
  EDU_MSI_OPTIONS,
  EDU_PAYMENT_METHODS_COBRABLES,
  EDU_PAYMENT_METHOD_SHORT,
  type EduPaymentMethod,
} from "@/lib/edu/types";

/**
 * EL BLOQUE DE FORMAS DE PAGO — uno solo, para los cuatro sitios donde
 * entra dinero: el cobro inmediato, el pago suelto de un recibo, el
 * enganche de un plan y la mensualidad de un plan.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 QUÉ ARREGLA. En el mostrador el paciente trae $500 en efectivo y el
 * resto con tarjeta, y la caja solo aceptaba UN método: había que mentir
 * ("todo efectivo") o partir el cobro en dos, que descuadra el recibo y el
 * CFDI. Aquí se declaran hasta tres formas y cada una acaba en su PROPIA
 * fila de pago, con su método y su referencia.
 *
 * 🔴 LA VALIDACIÓN ES LA DEL SERVIDOR, literalmente. Este componente llama
 * a `parseEduPagosDivididos` —la misma función pura, el mismo archivo— con
 * lo que va a mandar. Si aquí se deja apretar el botón, allá pasa; y si
 * allá rebota, aquí ya lo decía. Dos validaciones parecidas son dos
 * validaciones que un día discrepan delante del paciente.
 *
 * 🔴 "RECIBE" NO VIAJA. El efectivo que se pone sobre el mostrador sirve
 * para calcular el CAMBIO y nada más: lo que se guarda es lo que se
 * COBRA. Guardar los $1,000 que trajo el paciente por un cobro de $850
 * descuadraría el corte por $150 que están en su bolsillo.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Una fila del formulario. Todo texto: es lo que hay en los inputs. */
export interface EduPagoDraft {
  key: string;
  method: EduPaymentMethod;
  monto: string;
  referencia: string;
  notas: string;
  msiMonths: number | null;
  /** SOLO UI: el efectivo recibido, para el cambio. No viaja al servidor. */
  recibido: string;
}

export interface EduFormasPagoProps {
  /** Lo que hay que cubrir: el total, el saldo o el monto de la mensualidad. */
  objetivoCents: number;
  /**
   * true = la suma tiene que dar EXACTAMENTE el objetivo (una mensualidad
   * se cobra completa). false = puede quedar a deber.
   */
  exacto: boolean;
  value: EduPagoDraft[];
  onChange: (next: EduPagoDraft[]) => void;
  /** Prefijo de los `id` de los campos: hay hasta dos bloques por pantalla. */
  idPrefix: string;
  disabled?: boolean;
}

const ICONO: Record<EduPaymentMethod, typeof Banknote> = {
  CASH: Banknote,
  CARD: CreditCard,
  CARD_DEBIT: CreditCard,
  CARD_CREDIT: CreditCard,
  TRANSFER: ArrowLeftRight,
  CHECK: ScrollText,
  OTHER: Ellipsis,
};

/** Cómo se llama el campo contextual de cada método, y qué se escribe en él. */
const CAMPO: Partial<Record<EduPaymentMethod, { label: string; hint: string; obligatorio: boolean }>> = {
  CARD_DEBIT: {
    label: "Autorización de la terminal",
    hint: "El número que imprime el voucher. Sirve para aclarar un cargo.",
    obligatorio: false,
  },
  CARD_CREDIT: {
    label: "Autorización de la terminal",
    hint: "El número que imprime el voucher. Sirve para aclarar un cargo.",
    obligatorio: false,
  },
  TRANSFER: {
    label: "Clave de rastreo / folio",
    hint: "La clave del SPEI o el folio del depósito.",
    obligatorio: false,
  },
  CHECK: {
    label: "Número de cheque y banco",
    hint: "Obligatorio: sin él, un cheque devuelto no se puede rastrear.",
    obligatorio: true,
  },
};

/**
 * Centavos de lo que hay en un input, para la aritmética de PANTALLA (el
 * renglón "Cubierto / Falta / Sobra" y el cambio).
 *
 * 🔴 Usa `parseEduMoneyCents`, el MISMO lector del servidor, y no una
 * limpieza a mano: un tercer lector de dinero es cómo el renglón vivo
 * acaba diciendo una cosa (".50" → $0.50) y el aviso de debajo otra
 * ("no es una cantidad válida"). Lo que no se puede leer vale 0, que es
 * lo que hace que el botón se quede bloqueado hasta que se corrija.
 */
export function eduCentavosDeInput(texto: string): number {
  return parseEduMoneyCents(texto) ?? 0;
}

let contadorDeFilas = 0;

/** Una fila nueva, con el monto que le toque. */
export function eduNuevoPagoDraft(montoCents: number): EduPagoDraft {
  contadorDeFilas += 1;
  return {
    key: `fp${contadorDeFilas}`,
    method: "CASH",
    monto: montoCents > 0 ? eduMoneyInputValue(montoCents) : "",
    referencia: "",
    notas: "",
    msiMonths: null,
    recibido: "",
  };
}

/**
 * 🔴 LO QUE SE MANDA. Es la ÚNICA traducción de los inputs al cuerpo del
 * POST, y por eso `recibido` no aparece: se queda en la pantalla.
 */
export function eduSerializarPagos(value: EduPagoDraft[]): {
  method: EduPaymentMethod;
  amountCents: string;
  reference: string | null;
  notes: string | null;
  msiMonths: number | null;
}[] {
  return value.map((p) => ({
    method: p.method,
    amountCents: p.monto,
    reference: p.referencia.trim() || null,
    notes: p.notas.trim() || null,
    msiMonths: p.method === "CARD_CREDIT" ? p.msiMonths : null,
  }));
}

/**
 * ¿Se puede mandar? Con la MISMA función del servidor, sobre lo MISMO que
 * se va a mandar. Devuelve el error escrito, o null si todo cuadra.
 */
export function eduValidarPagos(
  value: EduPagoDraft[],
  objetivoCents: number,
  exacto: boolean,
): string | null {
  const r = parseEduPagosDivididos({ payments: eduSerializarPagos(value) }, objetivoCents, {
    exacto,
  });
  // La guarda y no `!r.ok`: con strict:false el booleano no estrecha.
  return eduPagosFailed(r) ? r.error : null;
}

export function EduFormasPago({
  objetivoCents,
  exacto,
  value,
  onChange,
  idPrefix,
  disabled,
}: EduFormasPagoProps) {
  const sumaCents = value.reduce((a, p) => a + eduCentavosDeInput(p.monto), 0);
  const restanteCents = objetivoCents - sumaCents;

  function actualizar(key: string, parche: Partial<EduPagoDraft>) {
    onChange(value.map((p) => (p.key === key ? { ...p, ...parche } : p)));
  }

  function quitar(key: string) {
    onChange(value.filter((p) => p.key !== key));
  }

  function dividir() {
    if (value.length >= EDU_MAX_PAGOS_POR_OPERACION) return;
    // La fila nueva nace con LO QUE FALTA: es lo que va a teclear quien
    // cobra, y así el renglón de abajo dice "Cubierto" de una vez.
    onChange([...value, eduNuevoPagoDraft(Math.max(0, restanteCents))]);
  }

  return (
    <div className="edu-fp">
      {value.map((p, i) => {
        const campo = CAMPO[p.method];
        const montoCents = eduCentavosDeInput(p.monto);
        const cambio =
          p.method === "CASH" && p.recibido.trim() !== ""
            ? eduCambioCents(eduCentavosDeInput(p.recibido), montoCents)
            : null;
        const faltaEfectivo =
          p.method === "CASH" &&
          p.recibido.trim() !== "" &&
          eduCentavosDeInput(p.recibido) < montoCents;

        return (
          <div className="edu-fp__fila" key={p.key}>
            {value.length > 1 && (
              <div className="edu-fp__cabeza">
                <span className="edu-fp__num">
                  Forma {i + 1} de {value.length}
                </span>
                <button
                  type="button"
                  className="edu-assign__x"
                  aria-label={`Quitar la forma de pago ${i + 1}`}
                  onClick={() => quitar(p.key)}
                  disabled={disabled}
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {/* ── El método, en botones y no en un <select> ──────────
                Un selector esconde las opciones detrás de un clic, y la
                pregunta "¿débito o crédito?" se contesta con el voucher en
                la mano: tiene que estar a la vista. */}
            <div className="edu-fp__metodos" role="group" aria-label="Método de pago">
              {EDU_PAYMENT_METHODS_COBRABLES.map((m) => {
                const Icono = ICONO[m];
                const activo = p.method === m;
                return (
                  <button
                    key={m}
                    type="button"
                    className="edu-fp__metodo"
                    aria-pressed={activo}
                    disabled={disabled}
                    onClick={() =>
                      actualizar(p.key, {
                        method: m,
                        // Los campos contextuales del método anterior no se
                        // arrastran: una autorización de terminal en un pago
                        // en efectivo es un dato falso.
                        referencia: "",
                        notas: "",
                        msiMonths: null,
                        recibido: "",
                      })
                    }
                  >
                    <Icono size={17} aria-hidden="true" />
                    <span>{EDU_PAYMENT_METHOD_SHORT[m]}</span>
                  </button>
                );
              })}
            </div>

            <div className="edu-formgrid edu-formgrid--2">
              <div className="edu-field">
                <label className="edu-field__label" htmlFor={`${idPrefix}-monto-${p.key}`}>
                  Monto
                </label>
                <input
                  id={`${idPrefix}-monto-${p.key}`}
                  className="edu-input"
                  inputMode="decimal"
                  value={p.monto}
                  onChange={(e) => actualizar(p.key, { monto: e.target.value })}
                  placeholder="0.00"
                  disabled={disabled}
                  autoComplete="off"
                />
              </div>

              {/* ── El campo contextual: cambia con el método ───────── */}
              {p.method === "CASH" ? (
                <div className="edu-field">
                  <label className="edu-field__label" htmlFor={`${idPrefix}-rec-${p.key}`}>
                    Recibe
                  </label>
                  <input
                    id={`${idPrefix}-rec-${p.key}`}
                    className="edu-input"
                    inputMode="decimal"
                    value={p.recibido}
                    onChange={(e) => actualizar(p.key, { recibido: e.target.value })}
                    placeholder="Con cuánto paga"
                    disabled={disabled}
                    autoComplete="off"
                  />
                  <span className="edu-field__hint">
                    Solo para calcular el cambio. No se guarda: lo que se registra es lo que se
                    cobra.
                  </span>
                </div>
              ) : p.method === "OTHER" ? (
                <div className="edu-field">
                  <label className="edu-field__label" htmlFor={`${idPrefix}-mot-${p.key}`}>
                    Motivo (beca, vale, cortesía)
                  </label>
                  <input
                    id={`${idPrefix}-mot-${p.key}`}
                    className="edu-input"
                    value={p.notas}
                    onChange={(e) => actualizar(p.key, { notas: e.target.value })}
                    placeholder="Beca 50 %"
                    disabled={disabled}
                    autoComplete="off"
                  />
                  <span className="edu-field__hint">
                    Obligatorio. “Otro” existe para no obligar a mentir en el método, no para
                    esconder de dónde salió el dinero.
                  </span>
                </div>
              ) : campo ? (
                <div className="edu-field">
                  <label className="edu-field__label" htmlFor={`${idPrefix}-ref-${p.key}`}>
                    {campo.label}
                  </label>
                  <input
                    id={`${idPrefix}-ref-${p.key}`}
                    className="edu-input"
                    value={p.referencia}
                    onChange={(e) => actualizar(p.key, { referencia: e.target.value })}
                    disabled={disabled}
                    autoComplete="off"
                  />
                  <span className="edu-field__hint">{campo.hint}</span>
                </div>
              ) : null}
            </div>

            {cambio !== null && (
              <p className="edu-fp__cambio">
                Cambio <strong>{eduMoney(cambio)}</strong>
              </p>
            )}
            {faltaEfectivo && (
              <p className="edu-fp__resto edu-fp__resto--falta">
                Con {eduMoney(eduCentavosDeInput(p.recibido))} no alcanza para{" "}
                {eduMoney(montoCents)}.
              </p>
            )}

            {/* ── Meses sin intereses: SOLO con crédito ─────────────
                Y con el nombre completo, porque el mostrador confunde los
                dos calendarios: esto lo financia el BANCO y la escuela
                cobra el total hoy; el plan de pagos de la escuela es la
                otra opción del cobro. */}
            {p.method === "CARD_CREDIT" && (
              <div className="edu-field">
                <span className="edu-field__label">Meses sin intereses del banco</span>
                <div className="edu-msi" role="group" aria-label="Meses sin intereses del banco">
                  <button
                    type="button"
                    className="edu-fp__metodo"
                    aria-pressed={p.msiMonths === null}
                    disabled={disabled}
                    onClick={() => actualizar(p.key, { msiMonths: null })}
                  >
                    Sin MSI
                  </button>
                  {EDU_MSI_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="edu-fp__metodo"
                      aria-pressed={p.msiMonths === n}
                      disabled={disabled}
                      onClick={() => actualizar(p.key, { msiMonths: n })}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <span className="edu-field__hint">
                  Lo financia el banco: la escuela recibe el total hoy. Si lo que quieres es
                  diferir el cobro en mensualidades de la escuela, eso es el plan de pagos a
                  meses.
                </span>
              </div>
            )}
          </div>
        );
      })}

      <div className="edu-fp__pie">
        {value.length < EDU_MAX_PAGOS_POR_OPERACION && (
          <button
            type="button"
            className="edu-btn edu-btn--quiet edu-btn--sm"
            onClick={dividir}
            disabled={disabled}
          >
            Dividir en otra forma de pago
          </button>
        )}

        {/* ── El renglón vivo ────────────────────────────────────────
            Dice en una línea si ya está cubierto, cuánto falta o cuánto
            sobra. Sobrar bloquea SIEMPRE (el servidor no acepta cobrar de
            más); faltar solo bloquea cuando el pago tiene que ser exacto
            —una mensualidad—, porque en un cobro normal quedar a deber es
            una decisión legítima y se dice con esas palabras. */}
        {restanteCents === 0 ? (
          <span className="edu-fp__resto edu-fp__resto--ok">Cubierto ✓</span>
        ) : restanteCents < 0 ? (
          <span className="edu-fp__resto edu-fp__resto--sobra">
            Sobra {eduMoney(-restanteCents)}: ajústalo, no se puede cobrar de más.
          </span>
        ) : exacto ? (
          <span className="edu-fp__resto edu-fp__resto--falta">
            Faltan {eduMoney(restanteCents)}: la mensualidad se cobra completa.
          </span>
        ) : (
          <span className="edu-fp__resto">Queda a deber {eduMoney(restanteCents)}</span>
        )}
      </div>
    </div>
  );
}
