import { z } from "zod";
import { round2, itemQuantity, itemUnitPrice, itemDiscount } from "@/lib/invoice-totals";

export const registerSchema = z.object({
  firstName:  z.string().min(2),
  lastName:   z.string().min(2),
  email:      z.string().email(),
  password:   z.string().min(8),
  clinicName: z.string().min(2),
  specialty:  z.string().min(1),
  country:    z.string().min(1),
  city:       z.string().optional(),
  phone:      z.string().optional(),
  plan:       z.enum(["BASIC","PRO","CLINIC"]).default("PRO"),
});

/**
 * Schema del PUT de /api/patients/[id] — o sea, de una EDICIÓN.
 *
 * PAC-01 · POR QUÉ NINGÚN CAMPO LLEVA `.default()`
 * ------------------------------------------------
 * Este schema tiene UN ÚNICO consumidor en todo el repo: `patientSchema.parse`
 * en el PUT de src/app/api/patients/[id]/route.ts, cuyo resultado se esparce
 * sobre un `prisma.patient.update`. El alta (POST /api/patients) NO lo usa: lee
 * `body.*` a mano con sus propios `?? []` / `?? null`.
 *
 * En ese contexto un `.default([])` es destructivo, no protector: zod RELLENA
 * con `[]` el campo que el body no trae, y el update escribe ese `[]` encima de
 * lo que había. `allergies`, `chronicConditions`, `currentMedications` y `tags`
 * llevaban `.default([])` y el modal de edición no manda los tres últimos, así
 * que corregir un teléfono borraba los padecimientos crónicos y la medicación
 * actual — justo lo que lee el chequeo de contraindicaciones al recetar.
 *
 * Con `.optional()` y SIN default, el campo ausente parsea a `undefined` y
 * Prisma lo trata como "no tocar esta columna". Mandar `[]` EXPLÍCITO sigue
 * vaciando el array, que es lo que debe pasar cuando el usuario de verdad
 * borra el último elemento. Mismo motivo para `gender`: con `.default("OTHER")`
 * un body sin género reescribía el género del paciente a OTHER.
 *
 * SI ALGÚN DÍA ESTE SCHEMA SE USA PARA UN ALTA: los defaults van en el POST, no
 * aquí. Un schema compartido entre crear y editar no puede llevar defaults, y
 * la columna ya trae `@default([])` en Postgres para el INSERT.
 */
export const patientSchema = z.object({
  firstName:          z.string().min(2),
  lastName:           z.string().min(2),
  email:              z.string().email().optional().or(z.literal("")),
  phone:              z.string().optional(),
  dob:                z.string().optional(),
  gender:             z.enum(["M","F","OTHER"]).optional(),
  bloodType:          z.string().optional(),
  address:            z.string().optional(),
  insuranceProvider:  z.string().optional(),
  insurancePolicy:    z.string().optional(),
  allergies:          z.array(z.string()).optional(),
  chronicConditions:  z.array(z.string()).optional(),
  currentMedications: z.array(z.string()).optional(),
  tags:               z.array(z.string()).optional(),
  notes:              z.string().optional(),
  // NOM-024 identificación
  curp:               z.string().max(18).optional().nullable(),
  curpStatus:         z.enum(["COMPLETE","PENDING","FOREIGN"]).optional(),
  passportNo:         z.string().max(20).optional().nullable(),
  // NOM-004 antecedentes
  familyHistory:                   z.string().optional().nullable(),
  personalNonPathologicalHistory:  z.string().optional().nullable(),
  // Contacto de emergencia (anamnesis WS1-T2)
  emergencyContactName:            z.string().optional().nullable(),
  emergencyContactPhone:           z.string().optional().nullable(),
  emergencyContactRelation:        z.string().optional().nullable(),
});

export const appointmentSchema = z.object({
  patientId:    z.string().min(1),
  doctorId:     z.string().min(1),
  type:         z.string().min(1),
  date:         z.string().min(1),
  startTime:    z.string().min(1),
  endTime:      z.string().min(1),
  durationMins: z.number().default(30),
  room:         z.string().optional(),
  notes:        z.string().optional(),
});

/**
 * Mensaje único del clamp de descuento por línea. Lo comparten el schema (POST
 * /api/invoices) y el recálculo del PATCH de /api/invoices/[id], para que el 400
 * se lea igual venga por donde venga.
 */
export const LINE_DISCOUNT_ERROR = "El descuento de un concepto no puede exceder su importe (cantidad × precio unitario)";

/**
 * ¿El descuento de esta línea supera su importe? Se mide con los MISMOS
 * efectivos y el MISMO redondeo a centavos que `itemLineTotal`, así que un
 * descuento legítimamente IGUAL al importe pasa —el SAT lo permite, lo que
 * prohíbe es descuento > importe— y el ruido de punto flotante lo absorbe round2.
 */
function lineDiscountExceedsAmount(it: any): boolean {
  return itemDiscount(it) > round2(itemQuantity(it) * itemUnitPrice(it));
}

/**
 * Índice del primer concepto con descuento inválido, o -1 si todos cuadran. Es
 * para los callers SIN zod: el PATCH de /api/invoices/[id] recalcula la factura
 * con los items CRUDOS del body y necesita la misma regla, no una copia.
 */
export function findInvalidLineDiscount(items: any[]): number {
  if (!Array.isArray(items)) return -1;
  for (let i = 0; i < items.length; i++) {
    if (lineDiscountExceedsAmount(items[i])) return i;
  }
  return -1;
}

export const invoiceSchema = z.object({
  patientId:     z.string().min(1),
  appointmentId: z.string().optional(),
  items: z.array(z.object({
    description: z.string().min(1),
    quantity:    z.number().min(1),
    unitPrice:   z.number().min(0),
    // Descuento por línea del editor. Sin esta llave, zod la STRIPEA del item
    // y el JSON guardado pierde el descuento → la guarda del CFDI (que calcula
    // qty × unitPrice − discount) vería el bruto y bloquearía el timbrado.
    discount:    z.number().min(0).optional(),
    total:       z.number(),
  }).refine((it) => !lineDiscountExceedsAmount(it), {
    // La regla vive en el SERVIDOR porque en el cliente ya estaba y no basta: el
    // editor acota el descuento a `Math.min(discount, qty × unitPrice)` al armar
    // el payload, pero un POST fabricado a mano se lo salta y `itemLineTotal`
    // devuelve NEGATIVO — ese importe en rojo contamina el subtotal, el total y
    // el balance de una factura real (y rompe la invariante total = Σconceptos −
    // descuento que verifica el timbrado). Va por ITEM, no sobre el arreglo,
    // para que el issue apunte a `items.<i>.discount`: la línea culpable.
    message: LINE_DISCOUNT_ERROR,
    path: ["discount"],
  })).min(1),
  discount:      z.number().default(0),
  paymentMethod: z.string().optional(),
  notes:         z.string().optional(),
  dueDate:       z.string().optional(),
});

export type RegisterInput    = z.infer<typeof registerSchema>;
export type PatientInput     = z.infer<typeof patientSchema>;
export type AppointmentInput = z.infer<typeof appointmentSchema>;
export type InvoiceInput     = z.infer<typeof invoiceSchema>;
