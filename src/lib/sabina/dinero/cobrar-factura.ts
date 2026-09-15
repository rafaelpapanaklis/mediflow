/**
 * `cobrar_factura` — registrar un pago (con monto) o saldar la factura completa
 * (sin monto). Es UNA herramienta y no dos porque para el modelo son lo mismo:
 * cobrarle a una factura. Por dentro llama a los dos endpoints de la pantalla:
 *
 *   con monto  → POST /api/invoices/[id]            (el modal «Cobrar $X»)
 *   sin monto  → POST /api/invoices/[id]/mark-paid  (el botón «Marcar pagada»)
 *
 * 🔴 EL CANDADO PROPIO (MAPA-dinero §7.8 y §7.9), porque el servidor no lo pone:
 *  · Solo los seis métodos del selector; nunca `refund` (N4). Y el método se
 *    PREGUNTA: sin él no hay tarjeta. «Marcar pagada» de la pantalla guarda
 *    efectivo siempre (N17); aquí no hay método por defecto.
 *  · Monto ≤ total − pagado (el servidor tolera 1¢ de más; Sabina, ninguno).
 *  · Fecha: hoy. No se manda `paidAt`, así que el servidor pone su «ahora».
 *  · Borrador: la tarjeta dice que primero la confirma, y el usuario decide.
 *  · Huella con estado, total, pagado y `updatedAt` de la factura (y el día): si
 *    otro cobro entró entre la tarjeta y el botón, no se cobra. Lo que la huella
 *    NO cierra: dos propuestas distintas sobre la misma factura confirmadas en el
 *    mismo instante (el candado del engranaje es por propuesta, no por factura).
 *    El handler serializa y no deja pasar del saldo; dos abonos que caben, entran
 *    los dos. Es la misma carrera que tienen dos pestañas de la pantalla (N8).
 *  · Tras un fallo que PUDO escribir (500, excepción), se RELEE la factura antes de
 *    decir nada: ningún cobro es idempotente (N8) y un «inténtalo otra vez» a
 *    ciegas cobra dos veces. No se arregla N8; se rodea.
 */

import { randomUUID } from "crypto";
import { z } from "zod";
import { round2 } from "@/lib/invoice-totals";
import {
  definirAccion,
  type LlaveEscritura,
  type ManejadorRuta,
  type SabinaEjecucion,
  type SabinaPreparacion,
} from "../engine-acciones";
import { soloLectura } from "../engine-solo-lectura";
import { tienePermiso } from "../tools/base";
import { fechaLarga } from "../tools/agenda-comun";
import { hoyEnClinica } from "../tools/fechas";
import type { SabinaCtx } from "../tipos";
import {
  ETIQUETA_METODO,
  ID_SEGURO,
  METODOS_COBRO,
  dinero,
  esMetodoCobro,
  estadoDe,
  leerFacturaPorId,
  pacienteConFolio,
  resolverFactura,
  rutaComprobante,
  sinVerFacturacion,
  type FacturaLeida,
  type MetodoCobro,
} from "./comun";
import { falloIncierto, rechazoDeDinero } from "./respuestas";

const COBRABLES = ["DRAFT", "PENDING", "PARTIAL", "OVERDUE"];

const parametros = z.object({
  factura: z.string().max(40).optional().describe("Folio (MF-0042). Si no lo sabes, manda paciente."),
  paciente: z.string().max(120).optional(),
  monto: z.number().positive().max(10_000_000).optional().describe("Pesos. Omítelo para saldar todo."),
  metodo: z.enum(METODOS_COBRO).optional().describe("Solo si el usuario lo dijo."),
});

export type ParamsCobrar = z.infer<typeof parametros>;

export interface DatosCobro {
  facturaId: string;
  folio: string;
  paciente: string;
  /** `abono` = registrar un pago por `monto`; `saldar` = marcar pagada. */
  modo: "abono" | "saldar";
  /** Lo que se cobra: el monto pedido, o el saldo que había al proponer. */
  monto: number;
  metodo: MetodoCobro;
  /** Era borrador: se confirma (POST /confirm) antes de cobrar. */
  confirmarPrimero: boolean;
  antes: { total: number; paid: number };
}

const esquemaDatos = z.object({
  facturaId: z.string().regex(ID_SEGURO),
  folio: z.string(),
  paciente: z.string(),
  modo: z.enum(["abono", "saldar"]),
  monto: z.number().positive(),
  metodo: z.enum(METODOS_COBRO),
  confirmarPrimero: z.boolean(),
  antes: z.object({ total: z.number(), paid: z.number() }),
}) as z.ZodType<DatosCobro>;

/* ── fase 1 ────────────────────────────────────────────────────────────── */

const PREGUNTA_METODO =
  "¿Con qué método pagó? Efectivo, tarjeta débito, tarjeta crédito, transferencia, cheque u otro.";

export async function prepararCobro(ctx: SabinaCtx, p: ParamsCobrar): Promise<SabinaPreparacion<DatosCobro>> {
  const sinVer = sinVerFacturacion(ctx);
  if (sinVer) return sinVer;
  const r = await resolverFactura(ctx, p, {
    estados: COBRABLES,
    filtro: (f) => COBRABLES.includes(f.status) && f.saldo > 0,
    queTiene: "con saldo por cobrar",
  });
  if (r.tipo === "aclarar") return { tipo: "aclarar", pregunta: r.pregunta, opciones: r.opciones };
  if (r.tipo === "no") return { tipo: "no_se_puede", frase: r.frase };
  const f = r.valor;

  if (f.status === "CANCELLED") return { tipo: "no_se_puede", frase: `La factura ${f.folio} está cancelada: no se le puede cobrar.` };
  if (f.status === "PAID" || f.saldo <= 0) {
    return { tipo: "no_se_puede", frase: `La factura ${f.folio} ya está pagada: no le queda saldo.` };
  }

  // El método va DESPUÉS de saber qué factura: preguntar dos cosas a la vez confunde.
  if (!p.metodo) {
    return {
      tipo: "aclarar",
      pregunta: `${PREGUNTA_METODO} (Factura ${f.folio} de ${f.paciente.nombre}, saldo ${dinero(f.saldo)}.)`,
      opciones: METODOS_COBRO.map((m) => `${ETIQUETA_METODO[m]} → metodo: ${m}`),
    };
  }

  const modo: DatosCobro["modo"] = p.monto === undefined ? "saldar" : "abono";
  const monto = modo === "saldar" ? f.saldo : round2(p.monto!);
  if (monto <= 0) return { tipo: "no_se_puede", frase: "El monto tiene que ser mayor a $0." };
  if (monto > f.saldo) {
    return {
      tipo: "no_se_puede",
      frase: `A la factura ${f.folio} le quedan ${dinero(f.saldo)}; no puedo cobrarle ${dinero(monto)}.`,
    };
  }

  const confirmarPrimero = f.status === "DRAFT";
  // Confirmar un borrador lo hace POST /confirm, que pide `billing.create`. Sin ese
  // permiso la tarjeta prometería algo que el servidor va a rechazar a medias.
  if (confirmarPrimero && !tienePermiso(ctx, "billing.create")) {
    return {
      tipo: "sin_permiso",
      frase: `La factura ${f.folio} sigue en borrador y confirmarla pide el permiso de crear facturas, que no tienes. Que la confirme alguien con ese permiso y luego la cobro.`,
    };
  }

  return { tipo: "propuesta", datos: datosDe(f, modo, monto, p.metodo), tarjeta: tarjetaDe(ctx, f, modo, monto, p.metodo) };
}

function datosDe(f: FacturaLeida, modo: DatosCobro["modo"], monto: number, metodo: MetodoCobro): DatosCobro {
  return {
    facturaId: f.id,
    folio: f.folio,
    paciente: f.paciente.nombre,
    modo,
    monto,
    metodo,
    confirmarPrimero: f.status === "DRAFT",
    antes: { total: f.total, paid: f.paid },
  };
}

/** El saldo que queda, con la MISMA aritmética que el handler (paid redondeado primero). */
export function saldoTras(f: { total: number; paid: number }, monto: number): number {
  return Math.max(0, round2(f.total - round2(f.paid + monto)));
}

function tarjetaDe(ctx: SabinaCtx, f: FacturaLeida, modo: DatosCobro["modo"], monto: number, metodo: MetodoCobro) {
  const metodoTxt = ETIQUETA_METODO[metodo].toLowerCase();
  const frase =
    modo === "saldar"
      ? `Saldar la factura ${f.folio} de ${f.paciente.nombre}: cobrar ${dinero(monto)} (${metodoTxt}).`
      : `Registrar un pago de ${dinero(monto)} (${metodoTxt}) a la factura ${f.folio} de ${f.paciente.nombre}.`;
  const avisos: string[] = [];
  if (f.status === "DRAFT") {
    avisos.push(
      `La factura ${f.folio} está en BORRADOR: primero la voy a confirmar (pasa a pendiente y ya no se puede borrar, solo anular) y después registro el cobro.`,
    );
  }
  if (f.timbrada) avisos.push("Esta factura ya está timbrada (CFDI). Este cobro no genera un complemento de pago.");
  avisos.push("No se le manda recibo ni mensaje al paciente.");
  return {
    frase,
    detalles: [
      { etiqueta: "Paciente", valor: pacienteConFolio(f.paciente) },
      { etiqueta: "Factura", valor: `${f.folio} · ${estadoDe(f.status)} · total ${dinero(f.total)}` },
      { etiqueta: modo === "saldar" ? "Cobro (todo el saldo)" : "Cobro", valor: dinero(monto) },
      { etiqueta: "Método", valor: ETIQUETA_METODO[metodo] },
      { etiqueta: "Fecha", valor: `hoy, ${fechaLarga(new Date(), ctx.timezone)}` },
      { etiqueta: "Saldo", antes: dinero(f.saldo), valor: dinero(saldoTras(f, monto)) },
    ],
    avisos,
  };
}

/* ── fase 2 ────────────────────────────────────────────────────────────── */

async function manejador(ruta: "cobro" | "saldar" | "confirmar"): Promise<ManejadorRuta> {
  if (ruta === "cobro") return (await import("@/app/api/invoices/[id]/route")).POST as ManejadorRuta;
  if (ruta === "saldar") return (await import("@/app/api/invoices/[id]/mark-paid/route")).POST as ManejadorRuta;
  return (await import("@/app/api/invoices/[id]/confirm/route")).POST as ManejadorRuta;
}

/**
 * Tras un fallo que pudo haber escrito: ¿quedó o no quedó el cobro? Se relee la
 * factura bajo el candado de solo lectura y se compara lo pagado con lo que había.
 */
async function releerTrasFallo(ctx: SabinaCtx, d: DatosCobro, confirmada: boolean): Promise<SabinaEjecucion> {
  const previo = confirmada ? "Confirmé la factura, pero al cobrar el sistema falló" : "El sistema falló al cobrar";
  let ahora: FacturaLeida | null = null;
  try {
    ahora = await soloLectura(`releer ${d.folio} tras fallo`, () => leerFacturaPorId(ctx, d.facturaId));
  } catch {
    ahora = null;
  }
  if (!ahora) {
    return {
      ok: false,
      tipo: "error",
      frase: `${previo} y no pude revisar la factura ${d.folio}. No sé si el cobro quedó: revísala en la pantalla antes de repetirlo.`,
    };
  }
  const esperado = round2(d.antes.paid + d.monto);
  if (round2(ahora.paid) === esperado) {
    return {
      ok: true,
      frase: `${previo}, pero revisé la factura ${d.folio} y el cobro de ${dinero(d.monto)} SÍ quedó registrado (pagado: ${dinero(ahora.paid)}). No lo repitas.`,
      entidad: { tipo: "invoice", id: d.facturaId },
      enlace: { texto: `Comprobante ${d.folio}`, url: rutaComprobante(d.facturaId) },
    };
  }
  if (round2(ahora.paid) === round2(d.antes.paid)) {
    return {
      ok: false,
      tipo: "error",
      frase: `${previo}. Revisé la factura ${d.folio}: el cobro NO quedó registrado (sigue con ${dinero(ahora.paid)} pagado). Puedes pedírmelo otra vez.`,
    };
  }
  return {
    ok: false,
    tipo: "error",
    frase: `${previo} y la factura ${d.folio} cambió de otra forma (pagado: ${dinero(d.antes.paid)} → ${dinero(ahora.paid)}). Revísala en la pantalla antes de volver a cobrar.`,
  };
}

export async function ejecutarCobro(
  llave: LlaveEscritura,
  ctx: SabinaCtx,
  d: DatosCobro,
): Promise<SabinaEjecucion> {
  // Lo guardado no se da por bueno a ciegas: método de la lista, monto positivo, id de ruta.
  if (!ID_SEGURO.test(d.facturaId) || !esMetodoCobro(d.metodo) || !(d.monto > 0) || !Number.isFinite(d.monto)) {
    console.error("[sabina/dinero] propuesta de cobro guardada con datos que no corresponden", { folio: d.folio });
    return { ok: false, tipo: "error", frase: "Esa propuesta no se pudo ejecutar tal como estaba. No se cobró nada; pídemelo otra vez." };
  }
  const params = { id: d.facturaId };
  const base = `/api/invoices/${d.facturaId}`;

  if (d.confirmarPrimero) {
    let r0;
    try {
      r0 = await llave.llamar(await manejador("confirmar"), { metodo: "POST", ruta: `${base}/confirm`, params });
    } catch {
      r0 = { status: 0, cuerpo: null };
    }
    if (r0.status !== 200) {
      // Confirmar no mueve dinero: si falló, no hay cobro que revisar.
      return rechazoDeDinero(
        r0.status === 0 ? { status: 500, cuerpo: null } : r0,
        `No confirmé la factura ${d.folio} ni cobré nada`,
        "confirmar la factura",
      );
    }
  }

  let r;
  try {
    r =
      d.modo === "saldar"
        ? await llave.llamar(await manejador("saldar"), { metodo: "POST", ruta: `${base}/mark-paid`, cuerpo: { method: d.metodo }, params })
        : // Sin `paidAt`: el servidor pone su «ahora», que es la fecha de hoy que prometió la tarjeta.
          await llave.llamar(await manejador("cobro"), { metodo: "POST", ruta: base, cuerpo: { amount: d.monto, method: d.metodo }, params });
  } catch {
    r = { status: 0, cuerpo: null };
  }

  if (r.status === 200) {
    const aviso = (r.cuerpo as { warning?: unknown } | null)?.warning;
    const queda = saldoTras(d.antes, d.monto);
    const confirmada = d.confirmarPrimero ? `Confirmé la factura ${d.folio} y ` : "";
    const cobro = `${confirmada}${confirmada ? "registré" : "Listo: registré"} ${dinero(d.monto)} (${ETIQUETA_METODO[d.metodo].toLowerCase()}) a la factura ${d.folio} de ${d.paciente}.`;
    const saldo = queda > 0 ? ` Le quedan ${dinero(queda)}.` : " Quedó pagada.";
    return {
      ok: true,
      frase: `${cobro}${saldo}${typeof aviso === "string" && aviso ? ` Ojo: ${aviso}.` : ""}`,
      entidad: { tipo: "invoice", id: d.facturaId },
      enlace: { texto: `Comprobante ${d.folio}`, url: rutaComprobante(d.facturaId) },
    };
  }
  if (falloIncierto(r.status)) return releerTrasFallo(ctx, d, d.confirmarPrimero);
  const prefijo = d.confirmarPrimero ? `Confirmé la factura ${d.folio}, pero no se registró el cobro` : "No se registró el cobro";
  return rechazoDeDinero(r, prefijo, "cobrar");
}

/* ── la acción ─────────────────────────────────────────────────────────── */

export const accionCobrarFactura = definirAccion<ParamsCobrar, DatosCobro>({
  nombre: "cobrar_factura",
  descripcion:
    "Prepara el cobro de una factura: un pago por `monto`, o sin monto la salda completa. " +
    "El método pregúntaselo SIEMPRE al usuario; nunca lo supongas.",
  titulo: "Cobrar factura",
  boton: "Sí, registrar el cobro",
  queHace: "cobrar facturas",
  permiso: "billing.charge",
  deshacer: {
    reversible: false,
    aviso: "Un cobro no se borra: solo un administrador puede registrar un reembolso, y los dos movimientos quedan en Caja.",
  },
  parametros,
  datos: esquemaDatos,

  preparar: prepararCobro,

  /** Lo que la tarjeta dio por bueno y el endpoint no mira: la factura tal como estaba, y el día. */
  async huella(ctx, d) {
    const f = await leerFacturaPorId(ctx, d.facturaId);
    if (!f) return `ya_no:${randomUUID()}`;
    return [f.status, f.total, f.paid, f.updatedAt, hoyEnClinica(ctx.timezone)].join("|");
  },

  ejecutar: ejecutarCobro,
});
