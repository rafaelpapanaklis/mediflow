// «Cobrado sin CFDI» del mes, para el contador (ws1-t8, auditoría CFDI F-09).
//
// Lo que la clínica cobró en el mes y NO tiene comprobante propio es lo que su contador mete en la
// factura global a «público en general» (RMF 2026, regla 2.7.1.21; Guía de llenado del CFDI global
// del SAT). Si en la global entra algo que luego se timbra aquí, el ingreso queda DOS veces ante el
// SAT; si falta algo, queda sin declarar. Este reporte es la lista para que el contador no adivine.
//
// Unidad: el COBRO (Payment), en el mes de la clínica según su fecha de cobro — el ingreso de una
// persona física (612 y 626) se acumula cuando se cobra (flujo de efectivo). Reglas, en orden:
//   1. Reembolsos (method "refund"): aparte, en su propia lista. No son ingreso. Pero el
//      TRASPASO a saldo a favor (refundMethod "saldo_a_favor": excedente de un cobro, cita
//      cancelada…) NO es un reembolso: el dinero no salió y el cobro de origen sigue siendo
//      ingreso (ws1-t4, auditoría de uso C-38). Va en su propia lista, sin restar nada.
//   2. Lo que la definición ÚNICA de ingresos (lib/dinero/ingresos.server.ts, la de Finanzas)
//      no cuenta como cobro ni como reembolso: fuera (nota en borrador o cancelada, historia
//      migrada…). El servidor marca cada pago con `enDefinicionUnica`; sin esa marca se usa
//      la regla de siempre (borrador o cancelada = no es venta).
//   3. Cobro con su propio CFDI (factura a plazos, «Facturar este pago»): fuera, ya timbrado.
//   4. Nota con CFDI vigente (o un UUID heredado sin registro): fuera, ya timbrada.
//   5. Timbre en duda (factura apartada «timbrando:…», o un pago con su CFDI «apartado»): fuera del
//      total y en «en revisión», porque no se sabe si el CFDI existe (ver cfdi-timbre-incierto).
//   6. «anticipo» (se pagó con saldo a favor): aparte. El dinero entró antes, cuando se dio el
//      anticipo; contarlo aquí otra vez podría duplicarlo. CONFIRMAR CON CONTADOR.
//   7. Todo lo demás: entra al reporte. Si la nota todavía tiene saldo se marca: si se incluye en la
//      global, esa nota ya no debe timbrarse sola después.
// Un CFDI cancelado (status "cancelled"/"canceled") ya no ampara nada: el cobro vuelve a contar.
//
// Además (C-39): el dinero que ENTRÓ sin nota (anticipo pagado por Mercado Pago, excedente de un
// cobro automático; filas de `patient_credits` que Finanzas cuenta como ingreso el día que entran)
// también va a la global, en el mes en que entró. Así «para la global» − reembolsos = Finanzas,
// salvo lo ya timbrado.
//
// PURO: sin Prisma. El servidor (cobrado-sin-cfdi.server.ts) junta los datos.

import { armarCsvExcel } from "@/lib/csv-excel";
import { resolveTaxMode } from "@/lib/invoice-totals";
import { esTraspasoASaldoAFavor } from "@/lib/dinero/reembolsos";

export const CFDI_CLAIM_PREFIX_FACTURA = "timbrando:";

export interface PagoDelMes {
  id: string;
  paidAt: Date;
  amount: number;
  method: string;
  /** En un reembolso: por dónde salió el dinero ("saldo_a_favor" = no salió, es un traspaso). */
  refundMethod?: string | null;
  /**
   * ¿La definición única de ingresos (la de Finanzas) lo cuenta, como cobro o como reembolso?
   * La pone el servidor. undefined = no se sabe: regla de siempre (borrador o cancelada fuera).
   */
  enDefinicionUnica?: boolean;
  invoice: {
    id: string;
    invoiceNumber: string | null;
    status: string;
    balance: number;
    cfdiUuid: string | null;
    taxRate: number | null;
    taxIncluded: boolean | null;
    /**
     * N-23 (segunda auditoría de uso): qué parte de la nota va GRAVADA al 16% según sus conceptos
     * (la misma resolución por procedimiento que el timbrado, lib/cfdi/fiscal-concepto). 0 = todo
     * exento, 1 = todo gravado. undefined = no se sabe: el modo de la nota, como antes.
     */
    proporcionIva16?: number | null;
  };
}

/**
 * N-22 (segunda auditoría de uso): dinero que entró en este mes y que, ya como saldo a favor, se
 * aplicó a una nota que SÍ tiene su CFDI. Ese ingreso ya está ante el SAT en ese CFDI: no va en la
 * global (un mismo ingreso nunca en dos CFDI). Lo arma el servidor (anticipos-timbrados.server).
 */
export interface CubiertoEnOtroCfdi {
  /** De dónde salió el dinero: los cobros de una nota (cita cancelada), un cobro (excedente) o un anticipo sin nota. */
  tipo: "factura" | "pago" | "credito";
  ref: string;
  monto: number;
  /** Folio de la nota timbrada donde se usó. */
  folioDestino: string;
}

/** Estados de los CFDI de la factura completa (registros sin pago) y de cada pago. */
export interface CfdiConocidos {
  /** invoiceId → estados de sus CFDI de factura completa. */
  porFactura: ReadonlyMap<string, readonly string[]>;
  /** paymentId → estado de su CFDI propio ("valid", "apartado", "cancelled"…). */
  porPago: ReadonlyMap<string, string>;
}

export type Motivo = "incluido" | "anticipo" | "reembolso" | "traspaso" | "timbrada" | "timbradoPorPago" | "enRevision" | "noEsVenta";

/** Dinero que entró sin nota (fila de `patient_credits` que Finanzas cuenta como ingreso). */
export interface AnticipoSinNota {
  id: string;
  creditDate: Date;
  amount: number;
  /** "anticipo_mercadopago", "cobro_automatico_mercadopago"… */
  source: string;
}

const CANCELADO = new Set(["cancelled", "canceled"]);
const vigente = (st: string) => !CANCELADO.has(st);

/** Método interno → c_FormaPago. null = el panel no lo sabe (Mercado Pago, «tarjeta»…). */
export const FORMA_SAT_DE_METODO: Readonly<Record<string, string | null>> = {
  cash: "01", efectivo: "01", check: "02", transfer: "03", transferencia: "03", spei: "03",
  credit: "04", debit: "28",
};
export function formaSatDe(method: string): string | null {
  return FORMA_SAT_DE_METODO[method] ?? null;
}

export function clasificarPago(p: PagoDelMes, cfdi: CfdiConocidos): Motivo {
  // C-38: pasar dinero a saldo a favor no es devolverlo; no resta de nada.
  if (esTraspasoASaldoAFavor(p)) return "traspaso";
  const notaFuera = p.invoice.status === "DRAFT" || p.invoice.status === "CANCELLED";
  // El saldo a favor aplicado («anticipo») nunca es ingreso en Finanzas (se contó al cobrarse):
  // para él vale la regla de la nota; para lo demás, la definición única cuando se sabe.
  const fuera = p.method === "anticipo" || p.enDefinicionUnica === undefined ? notaFuera : !p.enDefinicionUnica;
  if (p.method === "refund") return fuera && p.enDefinicionUnica === false ? "noEsVenta" : "reembolso";
  if (fuera) return "noEsVenta";
  const delPago = cfdi.porPago.get(p.id);
  if (delPago === "apartado") return "enRevision";
  if (delPago && vigente(delPago)) return "timbradoPorPago";
  const uuid = p.invoice.cfdiUuid;
  if (uuid && uuid.startsWith(CFDI_CLAIM_PREFIX_FACTURA)) return "enRevision";
  const deFactura = cfdi.porFactura.get(p.invoice.id) ?? [];
  if (deFactura.some(vigente)) return "timbrada";
  // UUID en la nota sin ningún registro: timbrada antes de que existieran los registros. Si todos
  // sus registros están cancelados, el UUID es el del cancelado y la nota ya no está amparada.
  if (uuid && deFactura.length === 0) return "timbrada";
  if (p.method === "anticipo") return "anticipo";
  return "incluido";
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** ¿Lleva IVA desglosado? El MISMO criterio que el timbrado (resolveTaxMode). */
export function llevaIva(inv: { taxRate: number | null; taxIncluded: boolean | null }, modoClinica: string | null | undefined): boolean {
  return resolveTaxMode(inv, modoClinica) === "iva16";
}

export interface FilaReporte {
  fecha: string; // YYYY-MM-DD en la zona de la clínica
  folio: string;
  metodo: string;
  /** "cobro" = un Payment de una nota; "anticipoSinNota" = dinero que entró sin nota (C-39). */
  origen: "cobro" | "anticipoSinNota";
  formaSat: string | null;
  importe: number;
  base: number;
  iva: number;
  conIva: boolean;
  notaConSaldo: boolean;
  motivo: Motivo;
  /** Para ligar la fila con su origen (N-22). No sale en el CSV. */
  ref?: { invoiceId?: string; pagoId?: string; creditoId?: string };
  /** N-22: en «ya va en otro CFDI», el folio de la nota timbrada donde se usó. */
  folioDestino?: string;
}

export interface ReporteCobradoSinCfdi {
  mes: string;
  filas: FilaReporte[];
  total: number;
  base: number;
  iva: number;
  porForma: Array<{ formaSat: string | null; importe: number }>;
  notas: number;
  conSaldo: number;
  apartados: {
    anticipos: FilaReporte[];
    reembolsos: FilaReporte[];
    enRevision: FilaReporte[];
    /** C-38: lo que pasó a saldo a favor en el mes. Informativo: no resta (el cobro de origen ya cuenta). */
    traspasos: FilaReporte[];
    /** N-22: lo que entró este mes y ya está en el CFDI de otra nota (se usó como saldo a favor): fuera de la global. */
    enOtroCfdi: FilaReporte[];
  };
  /** C-39: cuánto de `total` es dinero que entró sin nota (anticipos por Mercado Pago…). */
  anticiposSinNota: number;
  excluidos: { timbradas: number; timbradoPorPago: number; noEsVenta: number };
}

/** El importe se toma como lo cobrado (IVA incluido si lo lleva): base = importe / 1.16. */
function fila(p: PagoDelMes, motivo: Motivo, fecha: string, modoClinica: string | null | undefined): FilaReporte {
  const importe = r2(p.amount);
  // N-23: con la proporción gravada de sus conceptos, el IVA es el de esa parte (IVA incluido en lo
  // cobrado: IVA = importe × proporción × 16/116). Sin ella, el modo de la nota.
  const prop = p.invoice.proporcionIva16;
  const conIva = typeof prop === "number" ? prop > 0 : llevaIva(p.invoice, modoClinica);
  const base = typeof prop === "number"
    ? r2(importe - r2(importe * Math.min(1, Math.max(0, prop)) * 16 / 116))
    : conIva ? r2(importe / 1.16) : importe;
  return {
    fecha,
    folio: p.invoice.invoiceNumber ?? "",
    metodo: p.method,
    origen: "cobro",
    // Un reembolso no se paga «con» nada: su forma es por dónde salió el dinero (C-56).
    formaSat: p.method === "refund" ? (p.refundMethod ? formaSatDe(p.refundMethod) : null) : formaSatDe(p.method),
    importe,
    base,
    iva: r2(importe - base),
    conIva,
    // N-27: una nota cancelada guarda su saldo, pero no «sigue debiendo».
    notaConSaldo: p.invoice.status !== "CANCELLED" && p.invoice.balance > 0.005,
    motivo,
    ref: { invoiceId: p.invoice.id, pagoId: p.id },
  };
}

/** Fila del dinero que entró sin nota. Sin nota no hay IVA propio: el modo de la clínica. */
function filaDeAnticipo(a: AnticipoSinNota, fecha: string, modoClinica: string | null | undefined): FilaReporte {
  const importe = r2(a.amount);
  const conIva = llevaIva({ taxRate: null, taxIncluded: null }, modoClinica);
  const base = conIva ? r2(importe / 1.16) : importe;
  return {
    fecha, folio: "", metodo: a.source, origen: "anticipoSinNota",
    // Mercado Pago: el panel no sabe si fue crédito o débito (formas 30/31: CONFIRMAR CON CONTADOR).
    formaSat: null,
    importe, base, iva: r2(importe - base), conIva, notaConSaldo: false, motivo: "incluido",
    ref: { creditoId: a.id },
  };
}

/**
 * N-22: saca de la global lo que ya ampara el CFDI de otra nota. Recorta las filas de su origen
 * (en orden de fecha) y deja lo recortado en `enOtroCfdi`, con el folio destino. Base e IVA se
 * recortan en la misma proporción. Puro.
 */
export function sacarLoCubierto(filas: FilaReporte[], cubiertos: readonly CubiertoEnOtroCfdi[]): FilaReporte[] {
  const fuera: FilaReporte[] = [];
  for (const c of cubiertos) {
    let falta = r2(c.monto);
    for (const f of filas) {
      if (falta <= 0.005) break;
      const r = f.ref ?? {};
      const es = c.tipo === "factura" ? r.invoiceId === c.ref && !!r.pagoId
        : c.tipo === "pago" ? r.pagoId === c.ref
        : r.creditoId === c.ref;
      if (!es || f.importe <= 0.005) continue;
      const corte = r2(Math.min(falta, f.importe));
      const factor = f.importe > 0 ? corte / f.importe : 0;
      const baseCorte = r2(f.base * factor);
      fuera.push({ ...f, importe: corte, base: baseCorte, iva: r2(corte - baseCorte), folioDestino: c.folioDestino });
      f.importe = r2(f.importe - corte);
      f.base = r2(f.base - baseCorte);
      f.iva = r2(f.importe - f.base);
      falta = r2(falta - corte);
    }
  }
  return fuera;
}

export function armarReporte(args: {
  mes: string;
  pagos: readonly PagoDelMes[];
  /** C-39: dinero que entró sin nota en el mes (Finanzas lo cuenta como ingreso ese día). */
  anticiposSinNota?: readonly AnticipoSinNota[];
  /** N-22: lo de este mes que ya está en el CFDI de otra nota. */
  cubiertosEnOtroCfdi?: readonly CubiertoEnOtroCfdi[];
  cfdi: CfdiConocidos;
  modoClinica: string | null | undefined;
  /** Fecha local (YYYY-MM-DD) de un instante, en la zona de la clínica. */
  fechaLocal: (d: Date) => string;
}): ReporteCobradoSinCfdi {
  const filas: FilaReporte[] = [];
  const anticipos: FilaReporte[] = [];
  const reembolsos: FilaReporte[] = [];
  const enRevision: FilaReporte[] = [];
  const traspasos: FilaReporte[] = [];
  const excluidos = { timbradas: 0, timbradoPorPago: 0, noEsVenta: 0 };
  type Mov = { t: number; id: string; f: () => void };
  const movs: Mov[] = [];
  for (const p of args.pagos) {
    movs.push({ t: p.paidAt.getTime(), id: p.id, f: () => {
      const motivo = clasificarPago(p, args.cfdi);
      const f = fila(p, motivo, args.fechaLocal(p.paidAt), args.modoClinica);
      if (motivo === "incluido") filas.push(f);
      else if (motivo === "anticipo") anticipos.push(f);
      else if (motivo === "traspaso") traspasos.push(f);
      else if (motivo === "reembolso") {
        // Un reembolso de una nota timbrada se corrige con nota de crédito, no con la global.
        // Si la definición única lo resta (p. ej. el reembolso de una nota que luego se canceló,
        // C-01), la nota cuenta como venta aunque esté cancelada: mismo criterio que Finanzas.
        const deLaNota = clasificarPago({ ...p, method: "cash", refundMethod: null }, args.cfdi);
        if (deLaNota === "incluido") reembolsos.push(f);
      } else if (motivo === "enRevision") enRevision.push(f);
      else if (motivo === "timbrada") excluidos.timbradas += 1;
      else if (motivo === "timbradoPorPago") excluidos.timbradoPorPago += 1;
      else excluidos.noEsVenta += 1;
    } });
  }
  for (const a of args.anticiposSinNota ?? []) {
    if (!(a.amount > 0)) continue;
    movs.push({ t: a.creditDate.getTime(), id: a.id, f: () => filas.push(filaDeAnticipo(a, args.fechaLocal(a.creditDate), args.modoClinica)) });
  }
  movs.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  for (const m of movs) m.f();
  const enOtroCfdi = sacarLoCubierto(filas, args.cubiertosEnOtroCfdi ?? []);
  for (let i = filas.length - 1; i >= 0; i--) if (filas[i].importe <= 0.005) filas.splice(i, 1);
  const suma = (xs: FilaReporte[], k: "importe" | "base" | "iva") => r2(xs.reduce((s, x) => s + x[k], 0));
  const formas = new Map<string | null, number>();
  for (const f of filas) formas.set(f.formaSat, r2((formas.get(f.formaSat) ?? 0) + f.importe));
  const porForma = Array.from(formas, ([formaSat, importe]) => ({ formaSat, importe }))
    .sort((a, b) => b.importe - a.importe || String(a.formaSat).localeCompare(String(b.formaSat)));
  return {
    mes: args.mes,
    filas,
    total: suma(filas, "importe"),
    base: suma(filas, "base"),
    iva: suma(filas, "iva"),
    porForma,
    notas: new Set(filas.filter((f) => f.origen === "cobro").map((f) => f.folio)).size,
    conSaldo: filas.filter((f) => f.notaConSaldo).length,
    apartados: { anticipos, reembolsos, enRevision, traspasos, enOtroCfdi },
    anticiposSinNota: suma(filas.filter((f) => f.origen === "anticipoSinNota"), "importe"),
    excluidos,
  };
}

/** «2026-10» válido (y no en el futuro lejano). */
export function esMesValido(mes: unknown): mes is string {
  if (typeof mes !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return false;
  const y = Number(mes.slice(0, 4));
  return y >= 2000 && y <= 2100;
}

const METODO_ES: Record<string, string> = {
  cash: "Efectivo", debit: "Tarjeta de débito", credit: "Tarjeta de crédito", transfer: "Transferencia",
  check: "Cheque", mercadopago: "Mercado Pago", card: "Tarjeta", online: "Pago en línea", other: "Otro",
  anticipo: "Saldo a favor (anticipo)", refund: "Reembolso",
  anticipo_mercadopago: "Anticipo por Mercado Pago (sin nota)",
  cobro_automatico_mercadopago: "Excedente de cobro automático (sin nota)",
};

/** CSV para Excel (BOM, CRLF): las filas que van a la global y, abajo, lo que va aparte. */
export function csvDelReporte(r: ReporteCobradoSinCfdi): string {
  const enc = ["Fecha de cobro", "Folio de la nota", "Método en el panel", "Forma de pago SAT", "Importe cobrado", "Base", "IVA", "Impuesto", "Nota con saldo", "Sección"];
  const forma = (f: FilaReporte) => f.formaSat
    ?? (f.metodo === "refund" ? "No aplica (devolución)" : "Por definir (el panel no sabe con qué pagó)");
  const linea = (f: FilaReporte, seccion: string, metodo?: string, formaTexto?: string): (string | number | null)[] => [
    f.fecha, f.folio || "Sin nota", metodo ?? METODO_ES[f.metodo] ?? f.metodo, formaTexto ?? forma(f),
    f.importe, f.base, f.iva, f.conIva ? "IVA 16%" : "Exento", f.notaConSaldo ? "Sí: si va en la global, no la timbres después" : "No", seccion,
  ];
  const filas: (string | number | null)[][] = [enc];
  for (const f of r.filas) filas.push(linea(f, "Para la factura global"));
  filas.push(["", "", "", "TOTAL para la global", r.total, r.base, r.iva, "", "", ""]);
  for (const f of r.apartados.anticipos) filas.push(linea(f, "Aparte: pagado con saldo a favor (el dinero contó el mes en que entró)"));
  for (const f of r.apartados.reembolsos) filas.push(linea({ ...f, importe: -f.importe, base: -f.base, iva: -f.iva }, "Aparte: reembolso"));
  for (const f of r.apartados.enRevision) filas.push(linea(f, "Aparte: timbre en duda (revisar en Facturapi)"));
  // N-25: un traspaso no es un reembolso: ni «Reembolso» ni «devolución» en sus columnas.
  for (const f of r.apartados.traspasos ?? []) filas.push(linea(f, "Informativo: pasó a saldo a favor (no es reembolso, no resta)", "Traspaso a saldo a favor", "No aplica (no salió dinero)"));
  // N-22: ya ampara este ingreso el CFDI de otra nota (se usó como saldo a favor).
  for (const f of r.apartados.enOtroCfdi ?? []) filas.push(linea(f, `Fuera de la global: ya va en el CFDI de ${f.folioDestino ?? "otra nota"}`));
  return armarCsvExcel(filas);
}
