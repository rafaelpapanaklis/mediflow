/**
 * `caja` — cómo va la caja de efectivo, cuánto debería haber, el corte por
 * preparar y el histórico de cortes. SOLO LEE.
 *
 * ── UNA HERRAMIENTA, TRES VISTAS ───────────────────────────────────────
 * Las cinco preguntas de Caja («¿está abierta?», «¿cuánto efectivo debería
 * haber?», «prepárame el corte», «¿cuadró el de ayer?», «llevas 20 h sin
 * cortar») salen de dos lecturas: el turno abierto y el histórico. Cinco
 * herramientas serían cinco esquemas pagados en CADA llamada al modelo; aquí es
 * uno con un parámetro.
 *
 * ── LO QUE SABINA NO HACE AQUÍ, A PROPÓSITO ────────────────────────────
 * No abre, no registra retiros y no cierra (MAPA-caja §10, decidido): cerrar es
 * contar billetes con la mano y no se deshace, el papel del corte solo se
 * imprime en la pestaña que cerró, y el PIN tendría que pasar por el chat. La
 * vista `corte` junta las cifras y MANDA A CAJA a contar y cerrar.
 *
 * 🔴 El efectivo esperado es un CÁLCULO (apertura + efectivo cobrado − retiros),
 * no dinero contado: puede salir alto (un reembolso en efectivo no se resta, la
 * base no sabe con qué método salió) o bajo (un cobro apuntado con otro método).
 * Por eso viaja SIEMPRE con su aviso, en los datos y en el resumen. Presentarlo
 * como un hecho es cómo alguien cuadra mal una caja.
 *
 * ── DE DÓNDE SALE CADA COSA (nada reescrito) ───────────────────────────
 *  · Turno: `getCajaShift` de @/lib/caja, el mismo cálculo que pinta la
 *    pantalla (`getCajaState` pasa por el mismo `shiftOf`), con `ctx.db`.
 *  · Histórico: `getCajaHistory`, el mismo de la pantalla, con `ctx.db`.
 *  · Aviso de «sin cortar»: `staleShiftOf` de @/lib/caja-turno, que es lo que
 *    usa la pantalla (18 h o cambio de día natural).
 *  · Acceso: `billing.view` + el candado de la bandera (./candado-caja).
 *
 * ── LAS DOS COSAS QUE LA PANTALLA HACE DISTINTO, Y POR QUÉ ─────────────
 *  · Pacientes restringidos: la lista del turno de la pantalla no los enmascara
 *    (N7). Sabina sí, con el criterio de la pestaña Facturas: «Paciente privado»
 *    sin sacar la fila, para que los totales cuadren. Y como mucho 50 cobros.
 *  · El «hoy»: las cuatro cifras del día de arriba de Caja van en UTC−6 fijo
 *    (N8). Sabina NO las repite (la apertura sugerida no es un conteo y «cobrado
 *    hoy» no es lo cobrado, §10). Lo único de «día» que usa es el aviso de sin
 *    cortar, y ahí la pantalla ya usa la zona de la clínica: Sabina también.
 */

import { z } from "zod";
import { DEFAULT_TZ } from "@/lib/agenda/date-ranges";
import { getCajaHistory, getCajaShift, type CajaDb, type CajaHistoryRow } from "@/lib/caja";
import { dayKeyIn, staleShiftOf } from "@/lib/caja-turno";
import { candadoCaja } from "./candado-caja";
import { dbDe, definirHerramienta, fraseRecorte, pesos, plural, recortar, visorDe, type Lista } from "./base";
import { fechaDe, horaDe } from "./fechas";
import type { SabinaCtx } from "../tipos";

const parametros = z.object({
  vista: z
    .enum(["turno", "corte", "historial"])
    .optional()
    .describe("turno (default): cómo va; corte: para preparar el cierre; historial: cortes cerrados"),
});

export type ParamsCaja = z.infer<typeof parametros>;

/**
 * Cuántos cortes enseña el histórico. La pantalla pinta 30; aquí van los 10 más
 * recientes (las mismas filas, en el mismo orden) porque el resultado se reenvía
 * al modelo en cada ronda que sigue: 30 cortes son ~1 600 tokens por ronda para
 * contestar casi siempre «¿cuadró el de ayer?» o «¿cómo fue la semana?».
 */
export const CORTES_HISTORIAL = 10;

/** Va pegado al efectivo esperado, siempre. */
export const AVISO_ESPERADO =
  "Es un cálculo del sistema, no dinero contado: puede no cuadrar con el cajón " +
  "(p. ej., un reembolso en efectivo no se resta). Solo contando se sabe cuánto hay.";

/**
 * Lo que el motor añade a la respuesta si habló del turno abierto sin decir que
 * el esperado es un cálculo. La marca es laxa a propósito («cálculo» en
 * cualquier forma): basta con que lo haya dicho a su manera para no repetirlo.
 */
export const AVISO_ESPERADO_RESPUESTA = {
  frase: "Ojo: el efectivo esperado es un cálculo del sistema, no dinero contado; solo contando se sabe cuánto hay.",
  marca: "cálculo",
};

/** Cómo se cierra de verdad. Sabina no lo hace. */
export const COMO_CERRAR =
  "Yo no cierro la caja: ve a Caja, cuenta el efectivo y cierra con tu PIN. No escribas tu PIN en este chat.";

const METODO: Record<string, string> = {
  cash: "efectivo",
  debit: "tarjeta de débito",
  credit: "tarjeta de crédito",
  transfer: "transferencia",
  check: "cheque",
  other: "otro",
  refund: "reembolso",
  anticipo: "anticipo (saldo a favor)",
};

export interface RetiroFila {
  /** «YYYY-MM-DD HH:MM», hora de la clínica. */
  cuando: string;
  monto: number;
  motivo: string;
  quien: string;
}

export interface CobroFila {
  cuando: string;
  /** «Paciente privado» si quien pregunta no puede ver a ese paciente. */
  paciente: string;
  concepto: string;
  metodo: string;
  /** Un reembolso va en positivo, como en la base, con `metodo: "reembolso"`: no suma. */
  monto: number;
}

export interface CorteFila {
  abierta: string;
  cerrada: string | null;
  /** Quien ABRIÓ: la base no guarda quién cerró. */
  abrio: string;
  apertura: number;
  /** Cálculo congelado al cerrar. */
  esperado: number | null;
  /** Lo que contó una persona. */
  contado: number | null;
  /** contado − esperado: negativo = faltó, positivo = sobró. */
  diferencia: number | null;
  notas: string | null;
}

export interface TurnoAbierto {
  desde: string;
  abrio: string;
  horasAbierta: number;
  /** El aviso de la pantalla (18 h o cambio de día). `null` = no toca. */
  sinCortar: { horas: number; cambioDeDia: boolean } | null;
  efectivoEsperado: number;
  avisoEsperado: string;
  apertura: number;
  efectivoCobrado: number;
  tarjetaDebito: number;
  tarjetaCredito: number;
  /** Transferencia, cheque y otros. Sin tarjeta. */
  otrosMetodos: number;
  totalCobrado: number;
  /** Se enseñan; no restan del esperado ni suman al cobrado. */
  reembolsos: number;
  retirosTotal: number;
  retiros: Lista<RetiroFila>;
  /** Solo en la vista `corte`. */
  descuentos?: number;
  iva?: number;
  cobros?: Lista<CobroFila>;
  comoCerrar?: string;
}

export interface DatosCajaTurno {
  vista: "turno" | "corte";
  abierta: boolean;
  turno: TurnoAbierto | null;
  /** Solo con la caja cerrada: para contestar algo más que «está cerrada». */
  ultimoCorte: CorteFila | null;
}

export interface DatosCajaHistorial {
  vista: "historial";
  cortes: Lista<CorteFila>;
}

export type DatosCaja = DatosCajaTurno | DatosCajaHistorial;

export const caja = definirHerramienta<ParamsCaja, DatosCaja>({
  nombre: "caja",
  descripcion:
    "Caja de efectivo: si está abierta (desde cuándo, quién), efectivo esperado, tarjeta y retiros del turno, " +
    "o el histórico de cortes. Solo lee; abrir, retirar y cerrar se hacen en Caja con PIN.",
  parametros,
  permiso: "billing.view",
  candado: candadoCaja,

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosCaja> {
    // El doble de pruebas y `prisma` cumplen las lecturas que pide Caja; el cast
    // es a `CajaDb`, que solo declara lecturas, y todo corre bajo `soloLectura`.
    const db = dbDe(ctx) as unknown as CajaDb;
    const tz = zonaValida(ctx.timezone);
    const vista = params.vista ?? "turno";

    if (vista === "historial") {
      const filas = await getCajaHistory(ctx.clinicId, CORTES_HISTORIAL, db);
      return { vista, cortes: recortar(filas.map((r) => corteFila(r, tz))) };
    }

    const ahora = new Date();
    const turno = await getCajaShift(ctx.clinicId, { db, viewer: visorDe(ctx), now: ahora });

    if (!turno.register || !turno.totals) {
      const [ultimo] = await getCajaHistory(ctx.clinicId, 1, db);
      return { vista, abierta: false, turno: null, ultimoCorte: ultimo ? corteFila(ultimo, tz) : null };
    }

    const t = turno.totals;
    const abierto: TurnoAbierto = {
      desde: cuando(turno.register.openedAt, tz),
      abrio: turno.register.operatorName,
      horasAbierta: Math.max(0, Math.floor((ahora.getTime() - new Date(turno.register.openedAt).getTime()) / 3_600_000)),
      sinCortar: sinCortar(turno.register.openedAt, ahora, tz),
      efectivoEsperado: t.expectedCash,
      avisoEsperado: AVISO_ESPERADO,
      apertura: t.openingBalance,
      efectivoCobrado: t.cashIncome,
      tarjetaDebito: t.cardDebitIncome,
      tarjetaCredito: t.cardCreditIncome,
      otrosMetodos: t.otherIncome,
      totalCobrado: t.totalIncome,
      reembolsos: t.refunds,
      retirosTotal: t.withdrawals,
      retiros: recortar(
        turno.withdrawals.map((w) => ({
          cuando: cuando(w.recordedAt, tz),
          monto: w.amount,
          motivo: w.reason,
          quien: w.recordedByName,
        })),
      ),
    };

    if (vista === "corte") {
      abierto.descuentos = t.discounts;
      abierto.iva = t.tax;
      // Lo más reciente primero: si hay que recortar a 50, se quedan los últimos.
      abierto.cobros = recortar(
        [...turno.list].reverse().map((r) => ({
          cuando: cuando(r.at, tz),
          paciente: r.patientName,
          concepto: corto(r.concept, 80),
          metodo: METODO[r.method] ?? r.method,
          monto: r.amount,
        })),
      );
      abierto.comoCerrar = COMO_CERRAR;
    }

    return { vista, abierta: true, turno: abierto, ultimoCorte: null };
  },

  vacio: (d) => d.vista === "historial" && d.cortes.total === 0,

  // 🔴 El prompt pide contestar corto, y «en caja hay $1,900» sin el aviso es la
  // frase que no puede salir. Con el turno abierto, el motor lo garantiza.
  avisoObligatorio: (d) => (d.vista !== "historial" && d.turno ? AVISO_ESPERADO_RESPUESTA : null),

  resumir(d) {
    if (d.vista === "historial") return resumirHistorial(d);
    if (!d.turno) {
      const base =
        d.vista === "corte"
          ? "La caja está cerrada: no hay turno abierto, así que no hay corte que preparar."
          : "La caja está cerrada: no hay turno abierto.";
      return d.ultimoCorte ? `${base} Último corte: ${fraseCorte(d.ultimoCorte)}` : `${base} No hay cortes anteriores.`;
    }

    const t = d.turno;
    const partes = [
      `Caja abierta desde ${t.desde} (la abrió ${t.abrio}; ${plural(t.horasAbierta, "hora", "horas")}).`,
      `Efectivo esperado ${pesos(t.efectivoEsperado)} (apertura ${pesos(t.apertura)} + efectivo cobrado ` +
        `${pesos(t.efectivoCobrado)} − retiros ${pesos(t.retirosTotal)}). ${AVISO_ESPERADO}`,
      `Tarjeta: débito ${pesos(t.tarjetaDebito)}, crédito ${pesos(t.tarjetaCredito)}; transferencia y otros ${pesos(t.otrosMetodos)}.`,
      `${plural(t.retiros.total, "retiro", "retiros")} en el turno${fraseRecorte(t.retiros, "retiros")}.`,
    ];
    if (t.sinCortar) {
      partes.push(
        `Lleva ${plural(t.sinCortar.horas, "hora", "horas")} sin cortar${t.sinCortar.cambioDeDia ? " y ya cambió el día" : ""}: ` +
          "la pantalla de Caja recomienda hacer el corte.",
      );
    }
    if (d.vista === "corte" && t.cobros) {
      partes.push(
        `Descuentos ${pesos(t.descuentos ?? 0)}, IVA ${pesos(t.iva ?? 0)}, reembolsos ${pesos(t.reembolsos)} (no suman). ` +
          `${plural(t.cobros.total, "cobro", "cobros")} en el turno${fraseRecorte(t.cobros, "cobros")}.`,
      );
      partes.push(COMO_CERRAR);
    }
    return partes.join(" ");
  },
});

/* ── ayudas ──────────────────────────────────────────────────────────── */

function zonaValida(tz: string): string {
  try {
    new Intl.DateTimeFormat("es-MX", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

function cuando(iso: string, tz: string): string {
  const d = new Date(iso);
  return `${fechaDe(d, tz)} ${horaDe(d, tz)}`;
}

function sinCortar(openedAt: string, ahora: Date, tz: string): TurnoAbierto["sinCortar"] {
  const aviso = staleShiftOf(openedAt, ahora.getTime(), dayKeyIn(tz));
  return aviso ? { horas: aviso.hours, cambioDeDia: aviso.crossedDay } : null;
}

function corto(texto: string | null | undefined, max: number): string {
  const s = String(texto ?? "").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function corteFila(r: CajaHistoryRow, tz: string): CorteFila {
  return {
    abierta: cuando(r.openedAt, tz),
    cerrada: r.closedAt ? cuando(r.closedAt, tz) : null,
    abrio: r.operatorName,
    apertura: r.openingBalance,
    esperado: r.expectedCash,
    contado: r.countedClosingBalance,
    diferencia: r.variance,
    notas: r.closingNotes ? corto(r.closingNotes, 140) : null,
  };
}

function fraseDiferencia(v: number | null): string {
  // «sin diferencia registrada» se leía como «no hubo diferencia».
  if (v === null) return "la diferencia no quedó guardada";
  if (v < 0) return `faltaron ${pesos(-v)}`;
  if (v > 0) return `sobraron ${pesos(v)}`;
  return "cuadró exacto";
}

function fraseCorte(c: CorteFila): string {
  const esperado = c.esperado === null ? "sin dato" : pesos(c.esperado);
  const contado = c.contado === null ? "sin dato" : pesos(c.contado);
  return `cerrado ${c.cerrada ?? "sin fecha"}, esperado ${esperado} (cálculo), contado ${contado}: ${fraseDiferencia(c.diferencia)}.`;
}

function resumirHistorial(d: DatosCajaHistorial): string {
  const ultimo = d.cortes.filas[0];
  const n = d.cortes.filas.length;
  const conDiferencia = d.cortes.filas.filter((c) => c.diferencia !== null && c.diferencia !== 0).length;
  const sinDato = d.cortes.filas.filter((c) => c.diferencia === null).length;
  // Con 30 filas puede haber más cortes atrás: se dice «los 30 más recientes»,
  // no «30 cortes», que sonaría a todos los que hay.
  const cuantos = n >= CORTES_HISTORIAL ? `Los ${n} cortes más recientes` : plural(n, "corte cerrado", "cortes cerrados");
  // Un corte sin diferencia guardada no cuenta como cuadrado: no se sabe.
  const cuadre =
    conDiferencia === 0 && sinDato === 0
      ? "Todos cuadraron exacto."
      : [
          conDiferencia > 0 ? `${plural(conDiferencia, "no cuadró", "no cuadraron")} exacto.` : "",
          sinDato > 0 ? `${plural(sinDato, "no tiene", "no tienen")} la diferencia guardada.` : "",
        ]
          .filter(Boolean)
          .join(" ");
  return `${cuantos}, del más reciente al más viejo. El último: ${fraseCorte(ultimo)} ${cuadre}`;
}
