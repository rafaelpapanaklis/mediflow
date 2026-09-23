// Las letras de un PaymentPlan (POST /api/payment-plans) — aritmética pura, sin I/O.
//
// Antes la ruta repartía en pesos flotantes: redondeaba `resto / n` y le echaba
// TODO el residuo a la última letra. Con eso:
//   · $1.00 en 60 letras daba 59 letras de $0.02 y una última de −$0.18;
//   · un enganche mayor que el total daba letras NEGATIVAS, sin un 400;
//   · «mensual» era +30 días: a los 12 meses el plan se había adelantado 5 días
//     y la letra «del 15» caía el 10.
//
// Ahora se usa la MISMA aritmética que las condiciones de pago de presupuestos y
// facturas (`lib/quotes/condiciones-pago.ts`): centavos enteros con el residuo de
// a un centavo en las PRIMERAS letras (`repartirCentavos`) y el mismo día de cada
// mes (`sumarPeriodos`). Una sola regla para «pago a plazos» en todo el panel.

import {
  aCentavos,
  aFechaSolo,
  aPesos,
  MAX_PAGOS,
  repartirCentavos,
  sumarPeriodos,
} from "@/lib/quotes/condiciones-pago";
import { PLAN_FREQUENCY, type PlanFrequency } from "./status";

export interface LetraCalculada {
  /** 1..N */
  installment: number;
  /** Pesos, en centavos exactos. */
  amount: number;
  /** Día de vencimiento, "YYYY-MM-DD". */
  fecha: string;
}

export interface PlanCalculado {
  totalAmount: number;
  downPayment: number;
  installments: number;
  frequency: PlanFrequency;
  /** "YYYY-MM-DD" */
  startDate: string;
  letras: LetraCalculada[];
}

/**
 * Un solo tipo con `error` o `plan` (y no una unión discriminada): el repo no
 * compila en `strict` y una unión `{ ok: true } | { ok: false }` no estrecha.
 */
export interface ResultadoLetras {
  error: string | null;
  plan: PlanCalculado | null;
}

/**
 * Tope del total, en pesos. Por encima de ~90 billones los centavos dejan de
 * ser enteros exactos en un `number` (MAX_SAFE_INTEGER) y la suma de las letras
 * ya no daría el total: $1e15 en 12 letras sumaba 1000000000000000.1. Cien
 * millones es muchísimo más que cualquier tratamiento y deja todo exacto.
 */
export const MAX_TOTAL_PLAN = 100_000_000;

function falla(error: string): ResultadoLetras {
  return { error, plan: null };
}

/**
 * Valida lo que llega del cliente y arma las letras.
 *
 * La suma de las letras es EXACTAMENTE `total − enganche`, en centavos. La
 * primera letra vence un periodo DESPUÉS de `startDate` (como siempre hizo la
 * ruta: `startDate` es el día del trato / del enganche).
 *
 * `hoy` ("YYYY-MM-DD", en la zona de la clínica) es el inicio cuando el cuerpo
 * no trae `startDate`.
 */
export function calcularLetras(
  body: {
    totalAmount?: unknown;
    downPayment?: unknown;
    installments?: unknown;
    frequency?: unknown;
    startDate?: unknown;
  },
  hoy: string,
): ResultadoLetras {
  const total = Number(body.totalAmount);
  const totalC = aCentavos(total);
  if (!isFinite(total) || totalC <= 0) return falla("El total debe ser mayor a $0");
  if (total > MAX_TOTAL_PLAN) return falla("El total excede el máximo de un plan de pagos");

  const engancheRaw = body.downPayment === undefined || body.downPayment === null || body.downPayment === ""
    ? 0
    : Number(body.downPayment);
  if (!isFinite(engancheRaw) || engancheRaw < 0) return falla("Enganche inválido");
  const engancheC = aCentavos(engancheRaw);
  if (engancheC >= totalC) {
    return falla("El enganche cubre todo el total: no queda nada que repartir en letras");
  }

  const n = Number(body.installments);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGOS) {
    return falla(`El número de letras debe ser un entero entre 1 y ${MAX_PAGOS}`);
  }

  const restoC = totalC - engancheC;
  // Nunca una letra de $0.00: 6 letras sobre 3¢ no es un plan.
  if (restoC < n) {
    return falla(`No alcanza para ${n} letras: quedan ${aPesos(restoC).toFixed(2)} por repartir`);
  }

  // hasOwnProperty y no `PLAN_FREQUENCY[x] ?? …`: "toString" o "constructor"
  // encontrarían la función heredada de Object y la guardarían como frecuencia.
  const f = String(body.frequency);
  const frequency: PlanFrequency = Object.prototype.hasOwnProperty.call(PLAN_FREQUENCY, f)
    ? PLAN_FREQUENCY[f as keyof typeof PLAN_FREQUENCY]
    : PLAN_FREQUENCY.MONTHLY;

  let startDate = hoy;
  if (body.startDate !== undefined && body.startDate !== null && body.startDate !== "") {
    const fecha = aFechaSolo(body.startDate);
    if (!fecha) return falla("Fecha de inicio inválida (usa AAAA-MM-DD)");
    startDate = fecha;
  }

  const letras = repartirCentavos(restoC, n).map((centavos, i) => ({
    installment: i + 1,
    amount: aPesos(centavos),
    fecha: sumarPeriodos(startDate, frequency, i + 1),
  }));

  return {
    error: null,
    plan: {
      totalAmount: aPesos(totalC),
      downPayment: aPesos(engancheC),
      installments: n,
      frequency,
      startDate,
      letras,
    },
  };
}
