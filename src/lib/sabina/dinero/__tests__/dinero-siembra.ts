/**
 * Siembra del área de DINERO de Sabina (ws1-t2): la clínica de agenda (CL_A) y
 * su vecina (CL_B), con facturas, pagos, presupuestos y, a pedido, mensajes del
 * Inbox y rastro de Sabina.
 *
 * Los pacientes, doctores y clínicas son los de `agenda-siembra` (dos «María
 * García», una restringida a la Dra. Rojas, una borrada por ARCO). Lo que se
 * añade está puesto para CHILLAR si se cuela:
 *  · la vecina tiene una factura con el MISMO folio MF-0010 y un saldo absurdo;
 *  · la paciente restringida debe $7,000 que recepción no puede ver;
 *  · hay una cancelada, una pagada, un borrador y una timbrada.
 *
 * La base va envuelta en un ESPÍA: toda operación que no sea de lectura LANZA y
 * queda apuntada, con sus argumentos (para comprobar, p. ej., que nadie pidió el
 * token de WhatsApp).
 */

import { sumarDias } from "../../tools/fechas";
import { CL_A, CL_B, HOY, TZ_A, U_ADMIN, U_DOC1, U_DOC2, U_RECEP, datosAgenda, en } from "../../tools/__tests__/agenda-siembra";
import { crearBase, type Fila } from "../../tools/__tests__/doble-base";
import type { SabinaCtx } from "../../tipos";

export { CL_A, CL_B, HOY, TZ_A, U_ADMIN, U_DOC1, U_DOC2, U_RECEP };

const AYER = sumarDias(HOY, -1);

export function datosDinero() {
  const agenda = datosAgenda();
  const clinics: Fila[] = agenda.clinics.map((c) =>
    c.id === CL_A
      ? {
          ...c, name: "Clínica QA", phone: "55 5000 1000", cfdiTaxMode: "exempt",
          waConnected: true, waPhoneNumberId: "wa-num-a", waAccessToken: "SECRETO-NO-SE-LEE",
          waTemplates: { payment_notice: { name: "dc_aviso_saldo", lang: "es_MX", status: "APPROVED" } },
        }
      : { ...c, name: "Clínica VECINA", phone: "99 9000 9000", cfdiTaxMode: "iva16", waConnected: true, waPhoneNumberId: "wa-b", waAccessToken: "OTRO" },
  );

  const factura = (over: Fila): Fila => ({
    discount: 0, taxRate: 0, taxIncluded: true, cfdiUuid: null, dueDate: null,
    createdAt: en(AYER, "10:00"), updatedAt: en(AYER, "10:00"), ...over,
  });

  const invoices: Fila[] = [
    factura({
      id: "inv-juan-1", clinicId: CL_A, patientId: "p-juan", invoiceNumber: "MF-0010", status: "PENDING",
      subtotal: 1200, total: 1200, paid: 0, balance: 1200,
      items: [{ description: "Limpieza dental", quantity: 1, unitPrice: 1200, total: 1200 }],
    }),
    factura({
      id: "inv-juan-2", clinicId: CL_A, patientId: "p-juan", invoiceNumber: "MF-0011", status: "PARTIAL",
      subtotal: 3000, total: 3000, paid: 1000, balance: 2000, createdAt: en(AYER, "11:00"),
      items: [{ description: "Resina", quantity: 2, unitPrice: 1500, total: 3000 }],
    }),
    factura({
      id: "inv-juan-cancel", clinicId: CL_A, patientId: "p-juan", invoiceNumber: "MF-0009", status: "CANCELLED",
      subtotal: 400, total: 400, paid: 0, balance: 400, createdAt: en(sumarDias(HOY, -9), "10:00"),
      items: [{ description: "Consulta", quantity: 1, unitPrice: 400, total: 400 }],
    }),
    factura({
      id: "inv-mg1-borrador", clinicId: CL_A, patientId: "p-mg1", invoiceNumber: "MF-0012", status: "DRAFT",
      subtotal: 800, total: 800, paid: 0, balance: 800,
      items: [{ description: "Extracción", quantity: 1, unitPrice: 800, total: 800 }],
    }),
    factura({
      id: "inv-mg2-pagada", clinicId: CL_A, patientId: "p-mg2", invoiceNumber: "MF-0013", status: "PAID",
      subtotal: 500, total: 500, paid: 500, balance: 0,
      items: [{ description: "Revisión", quantity: 1, unitPrice: 500, total: 500 }],
    }),
    factura({
      id: "inv-mg2-timbrada", clinicId: CL_A, patientId: "p-mg2", invoiceNumber: "MF-0015", status: "PENDING",
      subtotal: 900, total: 900, paid: 0, balance: 900, cfdiUuid: "uuid-timbrado",
      items: [{ description: "Guarda oclusal", quantity: 1, unitPrice: 900, total: 900 }],
    }),
    factura({
      id: "inv-restr", clinicId: CL_A, patientId: "p-restr", invoiceNumber: "MF-0014", status: "PENDING",
      subtotal: 7000, total: 7000, paid: 0, balance: 7000,
      items: [{ description: "Tratamiento RESTRINGIDO", quantity: 1, unitPrice: 7000, total: 7000 }],
    }),
    // ── la vecina: MISMO folio que la de Juan ──
    factura({
      id: "inv-vecina", clinicId: CL_B, patientId: "p-mg-vecina", invoiceNumber: "MF-0010", status: "PENDING",
      subtotal: 99999, total: 99999, paid: 0, balance: 99999,
      items: [{ description: "TRATAMIENTO DE LA VECINA", quantity: 1, unitPrice: 99999, total: 99999 }],
    }),
  ];

  const payments: Fila[] = [
    { id: "pay-juan-2", invoiceId: "inv-juan-2", amount: 1000, method: "credit", paidAt: en(AYER, "12:00") },
    { id: "pay-mg2", invoiceId: "inv-mg2-pagada", amount: 500, method: "cash", paidAt: en(AYER, "12:30") },
    { id: "pay-vecina", invoiceId: "inv-vecina", amount: 1, method: "cash", paidAt: en(AYER, "12:00") },
  ];

  const quotes: Fila[] = [
    { id: "q-juan", clinicId: CL_A, patientId: "p-juan", folio: "P-0001", title: "Rehabilitación", status: "ACCEPTED", invoiceId: null, discountAmount: 100, total: 2900, createdAt: en(AYER, "09:00"), updatedAt: en(AYER, "09:00") },
    { id: "q-mg1", clinicId: CL_A, patientId: "p-mg1", folio: "P-0002", title: "Extracción", status: "ACCEPTED", invoiceId: "inv-mg1-borrador", discountAmount: 0, total: 800, createdAt: en(AYER, "09:00"), updatedAt: en(AYER, "09:00") },
    { id: "q-juan-presentado", clinicId: CL_A, patientId: "p-juan", folio: "P-0003", title: "Ortodoncia", status: "PRESENTED", invoiceId: null, discountAmount: 0, total: 30000, createdAt: en(AYER, "09:00"), updatedAt: en(AYER, "09:00") },
    { id: "q-restr", clinicId: CL_A, patientId: "p-restr", folio: "P-0004", title: "Reservado", status: "ACCEPTED", invoiceId: null, discountAmount: 0, total: 5000, createdAt: en(AYER, "09:00"), updatedAt: en(AYER, "09:00") },
    { id: "q-vecina", clinicId: CL_B, patientId: "p-mg-vecina", folio: "P-0001", title: "DE LA VECINA", status: "ACCEPTED", invoiceId: null, discountAmount: 0, total: 88888, createdAt: en(AYER, "09:00"), updatedAt: en(AYER, "09:00") },
  ];
  const quoteItems: Fila[] = [
    { id: "qi-1", quoteId: "q-juan", name: "Corona", toothFdi: "16", quantity: 1, unitPrice: 2500, discount: 0, sortOrder: 1 },
    { id: "qi-2", quoteId: "q-juan", name: "Resina", toothFdi: null, quantity: 2, unitPrice: 250, discount: 0, sortOrder: 0 },
    { id: "qi-3", quoteId: "q-mg1", name: "Extracción", toothFdi: "38", quantity: 1, unitPrice: 800, discount: 0, sortOrder: 0 },
    { id: "qi-4", quoteId: "q-restr", name: "Reservado", toothFdi: null, quantity: 1, unitPrice: 5000, discount: 0, sortOrder: 0 },
    { id: "qi-5", quoteId: "q-vecina", name: "VECINA", toothFdi: null, quantity: 1, unitPrice: 88888, discount: 0, sortOrder: 0 },
  ];

  return {
    ...agenda,
    clinics,
    invoices,
    payments,
    quotes,
    quoteItems,
    inboxThreads: [] as Fila[],
    inboxMessages: [] as Fila[],
    auditLogs: [] as Fila[],
  };
}

/* ── el espía ─────────────────────────────────────────────────────────── */

const LECTURAS = new Set(["findMany", "findFirst", "findUnique", "count", "groupBy", "aggregate"]);

export interface EspiaDinero {
  llamadas: Array<{ op: string; args: any }>;
  escrituras: string[];
}

export type BaseDinero = Record<string, any> & { espia: EspiaDinero; filas: ReturnType<typeof datosDinero> };

export function baseDinero(ajustar?: (d: ReturnType<typeof datosDinero>) => void): BaseDinero {
  const filas = datosDinero();
  ajustar?.(filas);
  const principal = crearBase(filas as any) as Record<string, any>;
  const espia: EspiaDinero = { llamadas: [], escrituras: [] };
  const db: Record<string, any> = { espia, filas };
  for (const modelo of ["invoice", "patient", "payment", "clinic", "quote", "inboxMessage", "auditLog", "appointment"]) {
    db[modelo] = new Proxy(
      {},
      {
        get(_t, op: string) {
          return (...args: any[]) => {
            espia.llamadas.push({ op: `${modelo}.${op}`, args: args[0] });
            if (!LECTURAS.has(op)) {
              espia.escrituras.push(`${modelo}.${op}`);
              throw new Error(`ESCRITURA PROHIBIDA: ${modelo}.${op}`);
            }
            return principal[modelo][op](...args);
          };
        },
      },
    );
  }
  db.$queryRaw = async (q: unknown) => {
    espia.llamadas.push({ op: "$queryRaw", args: q });
    return principal.$queryRaw(q);
  };
  for (const prohibida of ["$transaction", "$executeRaw", "$executeRawUnsafe", "$queryRawUnsafe"]) {
    db[prohibida] = () => {
      espia.escrituras.push(prohibida);
      throw new Error(`ESCRITURA PROHIBIDA: ${prohibida}`);
    };
  }
  return db as BaseDinero;
}

/* ── sesiones ─────────────────────────────────────────────────────────── */

export function sesion(db: BaseDinero, over: Partial<SabinaCtx> = {}): SabinaCtx {
  return {
    clinicId: CL_A,
    userId: U_RECEP,
    role: "RECEPTIONIST",
    permissionsOverride: [],
    timezone: TZ_A,
    clinicCategory: "DENTAL",
    db: db as any,
    ...over,
  };
}

export const recepcion = (db: BaseDinero) => sesion(db);
export const admin = (db: BaseDinero) => sesion(db, { userId: U_ADMIN, role: "ADMIN" });
export const drSalas = (db: BaseDinero) => sesion(db, { userId: U_DOC1, role: "DOCTOR" });
export const draRojas = (db: BaseDinero) => sesion(db, { userId: U_DOC2, role: "DOCTOR" });
/** Administradora de la VECINA: la fuga en la otra dirección. */
export const adminVecina = (db: BaseDinero) => sesion(db, { clinicId: CL_B, userId: "u-admin-vecina", role: "ADMIN" });
export const conKeys = (db: BaseDinero, keys: string[]) => sesion(db, { permissionsOverride: keys });

/** Un mensaje de aviso de saldo que ya salió hoy a ese teléfono. */
export function avisoEnInbox(d: ReturnType<typeof datosDinero>, telefono: string, body: string, hace = 60) {
  const hilo = { id: `th-${d.inboxThreads.length + 1}`, clinicId: CL_A, channel: "WHATSAPP", externalId: `521${telefono.replace(/\D/g, "").slice(-10)}` };
  d.inboxThreads.push(hilo);
  d.inboxMessages.push({
    id: `im-${d.inboxMessages.length + 1}`, threadId: hilo.id, direction: "OUT", body,
    externalId: `sys:payment_notice:wamid-${d.inboxMessages.length + 1}`, sentAt: new Date(Date.now() - hace * 1000),
  });
}
