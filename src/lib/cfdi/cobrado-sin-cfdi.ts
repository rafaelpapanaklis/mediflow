// «Cobrado sin CFDI» del mes, para el contador (ws1-t8, auditoría CFDI F-09).
//
// Lo que la clínica cobró en el mes y NO tiene comprobante propio es lo que su contador mete en la
// factura global a «público en general» (RMF 2026, regla 2.7.1.21; Guía de llenado del CFDI global
// del SAT). Si en la global entra algo que luego se timbra aquí, el ingreso queda DOS veces ante el
// SAT; si falta algo, queda sin declarar. Este reporte es la lista para que el contador no adivine.
//
// Unidad: el COBRO (Payment), en el mes de la clínica según su fecha de cobro — el ingreso de una
// persona física (612 y 626) se acumula cuando se cobra (flujo de efectivo). Reglas, en orden:
//   1. Reembolsos (method "refund"): aparte, en su propia lista. No son ingreso.
//   2. Nota en borrador o cancelada: fuera (no es venta; mismo criterio que Caja).
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
// PURO: sin Prisma. El servidor (cobrado-sin-cfdi.server.ts) junta los datos.

import { armarCsvExcel } from "@/lib/csv-excel";
import { resolveTaxMode } from "@/lib/invoice-totals";

export const CFDI_CLAIM_PREFIX_FACTURA = "timbrando:";

export interface PagoDelMes {
  id: string;
  paidAt: Date;
  amount: number;
  method: string;
  invoice: {
    id: string;
    invoiceNumber: string | null;
    status: string;
    balance: number;
    cfdiUuid: string | null;
    taxRate: number | null;
    taxIncluded: boolean | null;
  };
}

/** Estados de los CFDI de la factura completa (registros sin pago) y de cada pago. */
export interface CfdiConocidos {
  /** invoiceId → estados de sus CFDI de factura completa. */
  porFactura: ReadonlyMap<string, readonly string[]>;
  /** paymentId → estado de su CFDI propio ("valid", "apartado", "cancelled"…). */
  porPago: ReadonlyMap<string, string>;
}

export type Motivo = "incluido" | "anticipo" | "reembolso" | "timbrada" | "timbradoPorPago" | "enRevision" | "noEsVenta";

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
  if (p.method === "refund") return "reembolso";
  if (p.invoice.status === "DRAFT" || p.invoice.status === "CANCELLED") return "noEsVenta";
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
  formaSat: string | null;
  importe: number;
  base: number;
  iva: number;
  conIva: boolean;
  notaConSaldo: boolean;
  motivo: Motivo;
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
  };
  excluidos: { timbradas: number; timbradoPorPago: number; noEsVenta: number };
}

/** El importe se toma como lo cobrado (IVA incluido si lo lleva): base = importe / 1.16. */
function fila(p: PagoDelMes, motivo: Motivo, fecha: string, modoClinica: string | null | undefined): FilaReporte {
  const importe = r2(p.amount);
  const conIva = llevaIva(p.invoice, modoClinica);
  const base = conIva ? r2(importe / 1.16) : importe;
  return {
    fecha,
    folio: p.invoice.invoiceNumber ?? "",
    metodo: p.method,
    formaSat: formaSatDe(p.method),
    importe,
    base,
    iva: r2(importe - base),
    conIva,
    notaConSaldo: p.invoice.balance > 0.005,
    motivo,
  };
}

export function armarReporte(args: {
  mes: string;
  pagos: readonly PagoDelMes[];
  cfdi: CfdiConocidos;
  modoClinica: string | null | undefined;
  /** Fecha local (YYYY-MM-DD) de un instante, en la zona de la clínica. */
  fechaLocal: (d: Date) => string;
}): ReporteCobradoSinCfdi {
  const filas: FilaReporte[] = [];
  const anticipos: FilaReporte[] = [];
  const reembolsos: FilaReporte[] = [];
  const enRevision: FilaReporte[] = [];
  const excluidos = { timbradas: 0, timbradoPorPago: 0, noEsVenta: 0 };
  const ordenados = [...args.pagos].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime() || a.id.localeCompare(b.id));
  for (const p of ordenados) {
    const motivo = clasificarPago(p, args.cfdi);
    const f = fila(p, motivo, args.fechaLocal(p.paidAt), args.modoClinica);
    if (motivo === "incluido") filas.push(f);
    else if (motivo === "anticipo") anticipos.push(f);
    else if (motivo === "reembolso") {
      // Un reembolso de una nota timbrada se corrige con nota de crédito, no con la global.
      const deLaNota = clasificarPago({ ...p, method: "cash" }, args.cfdi);
      if (deLaNota === "incluido") reembolsos.push(f);
    } else if (motivo === "enRevision") enRevision.push(f);
    else if (motivo === "timbrada") excluidos.timbradas += 1;
    else if (motivo === "timbradoPorPago") excluidos.timbradoPorPago += 1;
    else excluidos.noEsVenta += 1;
  }
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
    notas: new Set(filas.map((f) => f.folio)).size,
    conSaldo: filas.filter((f) => f.notaConSaldo).length,
    apartados: { anticipos, reembolsos, enRevision },
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
};

/** CSV para Excel (BOM, CRLF): las filas que van a la global y, abajo, lo que va aparte. */
export function csvDelReporte(r: ReporteCobradoSinCfdi): string {
  const enc = ["Fecha de cobro", "Folio de la nota", "Método en el panel", "Forma de pago SAT", "Importe cobrado", "Base", "IVA", "Impuesto", "Nota con saldo", "Sección"];
  const linea = (f: FilaReporte, seccion: string): (string | number | null)[] => [
    f.fecha, f.folio, METODO_ES[f.metodo] ?? f.metodo, f.formaSat ?? "Por definir (el panel no sabe con qué pagó)",
    f.importe, f.base, f.iva, f.conIva ? "IVA 16%" : "Exento", f.notaConSaldo ? "Sí: si va en la global, no la timbres después" : "No", seccion,
  ];
  const filas: (string | number | null)[][] = [enc];
  for (const f of r.filas) filas.push(linea(f, "Para la factura global"));
  filas.push(["", "", "", "TOTAL para la global", r.total, r.base, r.iva, "", "", ""]);
  for (const f of r.apartados.anticipos) filas.push(linea(f, "Aparte: pagado con saldo a favor (revisar con el contador)"));
  for (const f of r.apartados.reembolsos) filas.push(linea({ ...f, importe: -f.importe, base: -f.base, iva: -f.iva }, "Aparte: reembolso"));
  for (const f of r.apartados.enRevision) filas.push(linea(f, "Aparte: timbre en duda (revisar en Facturapi)"));
  return armarCsvExcel(filas);
}
