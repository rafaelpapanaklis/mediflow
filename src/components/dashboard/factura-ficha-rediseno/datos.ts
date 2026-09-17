// Lo que la ficha de factura y el popup Nueva factura necesitan SABER, sin
// React y sin red: qué frase pintar, qué se puede enviar y a quién, y con qué
// arranca un duplicado. Puro, para poder probarlo.
//
// La aritmética del plan y sus palabras NO viven aquí: son las de
// `lib/quotes/condiciones-pago.ts`, las mismas de Presupuestos.

import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { fraseCondiciones } from "@/lib/invoices/correo-factura";

/** La factura tal como llega a las listas (Caja y expediente). Todo lo que no es
 *  folio/estado/importes es opcional: cada lista trae un recorte distinto. */
export interface FacturaDeFicha {
  id: string;
  invoiceNumber: string;
  status: string;
  total: number;
  paid: number;
  balance: number;
  createdAt: string | Date;
  cfdiUuid?: string | null;
  dueDate?: string | Date | null;
  items?: unknown;
  discount?: number | null;
  notes?: string | null;
  doctorId?: string | null;
  taxRate?: number | null;
  taxIncluded?: boolean | null;
  patientId?: string | null;
  patient?: { id?: string; firstName?: string | null; lastName?: string | null } | null;
  /** La trae el popup al crear, para que la frase salga sin esperar al lote. */
  condicionesPago?: CondicionesPago | null;
}

export interface ContactoPaciente { correo: boolean; telefono: boolean }

export type ViaEnvio = "correo" | "whatsapp";

/** La línea en violeta: la MISMA frase que lleva el correo al paciente. */
export const fraseDeFactura = fraseCondiciones;

/** "Limpieza, Resina y 2 más" — el título de la ficha cuando no hay otro. */
export function resumenConceptos(raw: unknown): { texto: string; cuantos: number } {
  const items = Array.isArray(raw) ? (raw as any[]) : [];
  const nombres = items
    .map((it) => String(it?.description ?? it?.name ?? "").trim())
    .filter((s) => s.length > 0);
  const vistos = nombres.slice(0, 2);
  const resto = nombres.length - vistos.length;
  return {
    texto: resto > 0 ? `${vistos.join(", ")} y ${resto} más` : vistos.join(", "),
    cuantos: items.length,
  };
}

// Espejo de lo que aceptan las dos rutas de envío. Si una ruta cambia sus
// estados, el botón seguiría saliendo y la ruta contestaría su 409 con motivo:
// nunca en silencio. Una prueba comprueba que siguen diciendo lo mismo.
const CON_SALDO = ["PENDING", "PARTIAL", "OVERDUE"];
/** WhatsApp es un AVISO DE SALDO: solo facturas emitidas con algo por cobrar. */
export function sePuedeEnviarPorWhatsApp(status: string): boolean {
  return CON_SALDO.includes(status);
}
/** Por correo también la ya pagada (es su comprobante). Borrador y cancelada, no. */
export function sePuedeEnviarPorCorreo(status: string): boolean {
  return CON_SALDO.includes(status) || status === "PAID";
}

/** Con qué arranca el popup cuando se DUPLICA una factura. */
export interface BorradorDeFactura {
  items: { name: string; quantity: number; unitPrice: number; discount: number }[];
  /** Descuento global, ya en pesos. */
  descuento: number;
  notes: string;
  doctorId: string;
  taxRate: number | null;
  taxIncluded: boolean | null;
  condiciones: CondicionesPago | null;
}

function n(x: unknown): number {
  const v = Number(x);
  return isFinite(v) ? v : 0;
}

/**
 * Duplicar NO copia en el servidor: abre Nueva factura con los mismos conceptos
 * y el mismo trato, para que quien cobra lo revise y pulse «Crear». La factura
 * nueva nace por POST /api/invoices como cualquier otra —folio nuevo, sin pagos,
 * sin CFDI, sin fecha de vencimiento— y no hereda NADA de dinero de la original.
 */
export function borradorDesdeFactura(inv: FacturaDeFicha, condiciones?: CondicionesPago | null): BorradorDeFactura {
  const items = (Array.isArray(inv.items) ? (inv.items as any[]) : [])
    .map((it) => {
      const quantity = Math.max(1, Math.floor(n(it?.quantity)) || 1);
      // Facturas viejas sin unitPrice: el importe de la línea entre la cantidad.
      const unitPrice = it?.unitPrice !== undefined && it?.unitPrice !== null
        ? n(it.unitPrice)
        : Math.round((n(it?.total) / quantity) * 100) / 100;
      return {
        name: String(it?.description ?? it?.name ?? "").trim(),
        quantity,
        unitPrice: Math.max(0, unitPrice),
        discount: Math.max(0, n(it?.discount)),
      };
    })
    .filter((it) => it.name.length > 0);
  const c = condiciones ?? inv.condicionesPago ?? null;
  return {
    items,
    descuento: Math.max(0, n(inv.discount)),
    notes: inv.notes ?? "",
    doctorId: inv.doctorId ?? "",
    taxRate: inv.taxRate === undefined || inv.taxRate === null ? null : n(inv.taxRate),
    taxIncluded: typeof inv.taxIncluded === "boolean" ? inv.taxIncluded : null,
    // El primer pago de la original ya pasó (o no aplica): la copia lo pide de nuevo.
    condiciones: c ? { ...c, primerPago: null } : null,
  };
}
