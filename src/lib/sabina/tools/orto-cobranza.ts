/**
 * `orto_cobranza` — las mensualidades de ortodoncia.
 *
 *   «¿quién debe mensualidades y cuánto?» ............... que: "deben"
 *   «¿cuánto entra por mensualidades este mes?» ......... que: "este_mes"
 *
 * 🔴 NI UN NÚMERO PROPIO. «deben» es la pantalla «Cobranza de mensualidades»:
 * `loadOrthoCases` (cada caso resuelto por `cobranzaDelCasoUnificada` contra su
 * factura real) → `filasDeCobranza` → `resumenDeCobranza`. «este_mes» es el
 * Tablero (`loadOrthoTableroData`): la proyección de mensualidades (T6), la
 * producción del mes (T4) y el saldo vencido (T3). Sabina dice la cifra que la
 * clínica ve en esas dos pantallas, con el mismo nombre.
 *
 * 🔴 SOLO LECTURA, y aquí es donde más importa: no cobra, no registra pagos, no
 * crea facturas ni planes de pago y no manda el recordatorio por WhatsApp
 * (MAPA-dinero §7). Da el enlace a la pantalla de Cobranza, que es donde se cobra.
 *
 * ── PERMISOS ────────────────────────────────────────────────────────────
 * La key del módulo la mira el runner, y después el candado `billing.view`: la
 * pantalla de Cobranza no la pide para VER, pero todo el dinero que Sabina
 * enseña va detrás de esa key, y si el Super Admin le quita facturación a Sabina
 * tampoco puede salir por aquí. Visibilidad de paciente: la del panel.
 */

import { z } from "zod";
import { fraseDeAtraso, fraseDeVencidos } from "@/lib/orthodontics/cobranza-modulo";
import {
  definirHerramienta,
  fraseRecorte,
  lineasDeLista,
  pesos,
  pesosDeLista,
  plural,
  recortar,
  tienePermiso,
  type Lista,
} from "./base";
import {
  ENLACES_ORTO,
  PERMISO_ORTO,
  avisoEnlace,
  avisoSinModulo,
  fechaCorta,
  sinModulo,
  type EstadoModulo,
  type OmitidaOrto,
} from "./orto-comun";
import type { SabinaCandado, SabinaCtx } from "../tipos";

const parametros = z.object({
  /** "deben" = quién debe y cuánto · "este_mes" = lo que entra por mensualidades este mes. */
  que: z.enum(["deben", "este_mes"]).optional(),
});

export type ParamsOrtoCobranza = z.infer<typeof parametros>;

export interface DeudorOrtoFila {
  paciente: string;
  doctor: string | null;
  /** Lo que falta de los pagos ya vencidos, en pesos. */
  vencido: number;
  pagosVencidos: number;
  /** AAAA-MM-DD del pago vencido más viejo. */
  vencidoDesde: string | null;
  diasDeAtraso: number | null;
  /** Todo lo que le falta por pagar del tratamiento. */
  porCobrar: number;
  /** `false` = caso terminado o abandonado que sigue debiendo. */
  casoActivo: boolean;
}

export interface DatosOrtoCobranza {
  modulo: EstadoModulo;
  que: "deben" | "este_mes";
  /** AAAA-MM-DD de hoy en la clínica: contra ese día se midió lo vencido. */
  hoy: string;
  deben: {
    deudores: Lista<DeudorOrtoFila>;
    /** Los totales de arriba de la pantalla de Cobranza. */
    vencido: { casos: number; pagos: number; importe: number };
    /** Al corriente, con un pago que vence de hoy a siete días. */
    porVencer: { casos: number; importe: number };
    /** Todo lo que falta por cobrar de todos los casos. */
    porCobrar: number;
    alCorriente: number;
    sinPlan: number;
  } | null;
  esteMes: {
    /** "AAAA-MM". */
    mes: string;
    /** T6: mensualidades que TODAVÍA no vencen y vencen en lo que queda del mes. */
    porVencerEnElMes: number;
    /** T4: la «Producción del mes» del Tablero, por doctor tratante, tal cual. */
    cobradoPorDoctor: Array<{ doctor: string; importe: number }>;
    /** La suma de esas barras. El Tablero no pinta el total: es lo único que aquí se suma. */
    cobradoEnElMes: number;
    /** T3: lo vencido sin cobrar, del mes que sea. */
    vencido: { casos: number; importe: number };
    /** T6 del mes siguiente, para que «¿y el que viene?» no cueste otra consulta. */
    mesSiguiente: { mes: string; importe: number } | null;
  } | null;
  omitidas: OmitidaOrto[];
  enlace: string;
}

/** « (Mariana Cortés $20,000, Renata Solís $8,000)»: las barras de «Producción del mes». */
function porDoctor(filas: Array<{ doctor: string; importe: number }>): string {
  if (filas.length < 2) return "";
  return ` (${filas.map((f) => `${f.doctor} ${pesos(f.importe)}`).join(", ")})`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "2026-09" → "septiembre de 2026". */
function mesLegible(clave: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(clave);
  return m && MESES[Number(m[2]) - 1] ? `${MESES[Number(m[2]) - 1]} de ${m[1]}` : clave;
}

/** El dinero de ortodoncia va detrás de `billing.view`, igual que el resto del dinero de Sabina. */
const candadoFacturacion: SabinaCandado = {
  etiqueta: "billing.view",
  async abre(ctx: SabinaCtx): Promise<boolean> {
    return tienePermiso(ctx, "billing.view");
  },
};

export const ortoCobranza = definirHerramienta<ParamsOrtoCobranza, DatosOrtoCobranza>({
  nombre: "orto_cobranza",
  descripcion:
    "ORTODONCIA, mensualidades: quién debe y cuánto, con sus días de atraso (que: \"deben\"), y cuánto entra " +
    "por mensualidades este mes: lo que falta por vencer, lo ya cobrado y lo vencido (\"este_mes\"). Son las " +
    "cifras de las pantallas Cobranza y Tablero del módulo. Solo lee: no cobra ni manda recordatorios; da el enlace.",
  parametros,
  permiso: PERMISO_ORTO,
  candado: candadoFacturacion,

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosOrtoCobranza> {
    const motor = await import("./orto-motor");
    const que = params.que ?? "deben";
    const enlace = que === "este_mes" ? ENLACES_ORTO.tablero : ENLACES_ORTO.cobranza;
    const base: DatosOrtoCobranza = { modulo: "activo", que, hoy: "", deben: null, esteMes: null, omitidas: [], enlace };

    const modulo = await motor.estadoDelModulo(ctx);
    if (modulo !== "activo") return { ...base, ...sinModulo(modulo) };

    if (que === "este_mes") {
      const t = await motor.leerTablero(ctx);
      const [actual, siguiente] = t.monthlyProjection;
      return {
        ...base,
        esteMes: {
          mes: actual?.monthKey ?? "",
          porVencerEnElMes: actual?.amountMxn ?? 0,
          cobradoPorDoctor: t.productionByDoctor.map((p) => ({ doctor: p.doctorName, importe: p.amountMxn })),
          cobradoEnElMes: t.productionByDoctor.reduce((s, p) => s + p.amountMxn, 0),
          vencido: { casos: t.overdue.count, importe: t.overdue.amountMxn },
          mesSiguiente: siguiente ? { mes: siguiente.monthKey, importe: siguiente.amountMxn } : null,
        },
      };
    }

    const c = await motor.leerCobranza(ctx);
    // Las filas ya vienen en el orden de la pantalla: el atraso más viejo arriba.
    const deudores: DeudorOrtoFila[] = c.filas
      .filter((f) => f.situacion === "vencido")
      .map((f) => ({
        paciente: f.patientName,
        doctor: f.treatingDoctorName,
        vencido: f.vencido,
        pagosVencidos: f.cuotasVencidas,
        vencidoDesde: f.vencidoDesde,
        diasDeAtraso: f.diasDeAtraso,
        porCobrar: f.porCobrar,
        casoActivo: f.casoActivo,
      }));
    return {
      ...base,
      hoy: c.hoy,
      deben: {
        deudores: recortar(deudores),
        vencido: { casos: c.resumen.vencido.casos, pagos: c.resumen.vencido.cuotas, importe: c.resumen.vencido.importe },
        porVencer: c.resumen.porVencer,
        porCobrar: c.resumen.porCobrar,
        alCorriente: c.resumen.alCorriente,
        sinPlan: c.resumen.sinPlan,
      },
    };
  },

  // Nunca es «sin datos»: «nadie debe» y «este mes no vence nada» son respuestas.
  vacio: () => false,

  avisoObligatorio(d) {
    if (d.modulo !== "activo") return avisoSinModulo(d.modulo);
    if (d.que === "este_mes") return avisoEnlace("cobrar una mensualidad", "Cobranza de ortodoncia", ENLACES_ORTO.cobranza);
    return avisoEnlace("cobrar una mensualidad o mandar el recordatorio", "Cobranza de ortodoncia", d.enlace);
  },

  resumir(d) {
    if (d.modulo !== "activo") return avisoSinModulo(d.modulo).frase;
    const cobranza = `[Cobranza de ortodoncia](${ENLACES_ORTO.cobranza})`;

    if (d.esteMes) {
      const m = d.esteMes;
      const siguiente = m.mesSiguiente
        ? ` En ${mesLegible(m.mesSiguiente.mes)} vencen ${pesos(m.mesSiguiente.importe)}.`
        : "";
      return (
        `Mensualidades de ortodoncia de ${mesLegible(m.mes)}: ${pesos(m.cobradoEnElMes)} ya cobrados en el mes` +
        `${porDoctor(m.cobradoPorDoctor)} y ` +
        `${pesos(m.porVencerEnElMes)} de pagos que vencen en lo que queda del mes. Aparte hay ` +
        `${pesos(m.vencido.importe)} vencidos sin cobrar de ${plural(m.vencido.casos, "caso", "casos")}, que entran solo si se cobran.` +
        `${siguiente} Son las cifras del [Tablero de ortodoncia](${d.enlace}); lo cobrado es lo pagado a la factura del ` +
        `tratamiento y lo que vence es una proyección, no dinero recibido. Yo no cobro: se cobra en ${cobranza}.`
      );
    }

    const x = d.deben!;
    if (x.deudores.total === 0) {
      const porVencer =
        x.porVencer.casos > 0
          ? ` ${plural(x.porVencer.casos, "caso tiene", "casos tienen")} un pago que vence en los próximos siete días, por ${pesos(x.porVencer.importe)}.`
          : "";
      return (
        `Nadie debe mensualidades de ortodoncia vencidas al ${fechaCorta(d.hoy)}.${porVencer} ` +
        `Por cobrar en total (sin vencer): ${pesos(x.porCobrar)}. Se ve en ${cobranza}.`
      );
    }
    const monto = pesosDeLista(x.deudores.filas.map((f) => f.vencido));
    const lista = lineasDeLista(x.deudores.filas, (f) => {
      const atraso = fraseDeAtraso(f.diasDeAtraso);
      return (
        `${f.paciente} — ${monto(f.vencido)}, ${fraseDeVencidos(f.pagosVencidos)}${atraso ? `, ${atraso}` : ""}` +
        `${f.casoActivo ? "" : " (caso cerrado)"}`
      );
    });
    const f0 = x.deudores.filas[0];
    const uno =
      !lista && f0
        ? ` Es ${f0.paciente}: ${pesos(f0.vencido)}, ${fraseDeVencidos(f0.pagosVencidos)}` +
          `${fraseDeAtraso(f0.diasDeAtraso) ? `, ${fraseDeAtraso(f0.diasDeAtraso)}` : ""}.`
        : "";
    const porVencer =
      x.porVencer.casos > 0
        ? ` Además, ${plural(x.porVencer.casos, "caso", "casos")} con un pago por vencer en siete días (${pesos(x.porVencer.importe)}).`
        : "";
    return (
      `${plural(x.vencido.casos, "caso debe", "casos deben")} mensualidades de ortodoncia: ${pesos(x.vencido.importe)} vencidos en ` +
      `${fraseDeVencidos(x.vencido.pagos)}${fraseRecorte(x.deudores, "casos")}.${porVencer} ` +
      `Por cobrar en total, vencido y por vencer: ${pesos(x.porCobrar)}.` +
      `${lista ? " Del atraso más viejo al más reciente:" : uno}${lista}\n` +
      `Yo no cobro ni mando recordatorios: eso se hace en ${cobranza}.`
    );
  },
});
