/**
 * La siembra de `oportunidades_perdidas`, encima de la de siempre.
 *
 * NO se toca `siembra.ts`: aquella la comparten todas las pruebas de Sabina y
 * cambiarla movería cifras de herramientas que no son mías. Aquí se PARTE de
 * ella (`datosDePrueba()`) y se añaden las filas de esta área, con los mismos
 * dos hábitos que la original:
 *
 *  · todas las fechas son RELATIVAS a ahora, para que la prueba no caduque;
 *  · lo de la clínica del SUR lleva importes absurdos (99,999 / 88,888 / 77,777)
 *    para que una fuga de tenant CHILLE y no se pueda confundir con un dato
 *    propio.
 *
 * El caso del medio —el que de verdad importa— es el DOBLE CONTEO: hay un
 * presupuesto aceptado con factura viva (su dinero ya está en `por_cobrar`) y un
 * plan nacido de otro presupuesto (que no puede contarse dos veces).
 */

import { datosDePrueba, CL_NORTE, CL_SUR, U_ADMIN_N, U_DOC_N, U_DOC2_N, U_ADMIN_S } from "./siembra";
import { crearBase, type BaseDoble, type Datos, type Fila } from "./doble-base";

const DIA_MS = 86_400_000;

function haceDias(n: number): Date {
  return new Date(Date.now() - n * DIA_MS);
}
function enDias(n: number): Date {
  return new Date(Date.now() + n * DIA_MS);
}

function paciente(over: Fila): Fila {
  return {
    status: "ACTIVE",
    visibleUserIds: [],
    deletedAt: null,
    primaryDoctorId: null,
    phone: null,
    email: null,
    createdAt: haceDias(400),
    ...over,
  };
}

/* ── los pacientes de esta área ───────────────────────────────────────── */

export const P_ACEPTADO = "p-esc-aceptado"; // presupuesto aceptado, factura en BORRADOR
export const P_FACTURADO = "p-esc-facturado"; // presupuesto aceptado YA facturado y por cobrar
export const P_AGENDADO = "p-esc-agendado"; // aceptado, pero ya tiene cita: no se perdió
export const P_PLAN = "p-esc-plan"; // plan activo con sesiones pendientes y atrasado
export const P_PLAN_ALDIA = "p-esc-plan-aldia"; // plan activo cuya próxima sesión aún no toca
export const P_PLAN_OTRO_DOC = "p-esc-plan-otro"; // plan de la otra doctora (scope de DOCTOR)
export const P_CARO = "p-esc-caro"; // presupuesto de $30,000 de hace una semana
export const P_BARATO = "p-esc-barato"; // presupuesto de $800 de hace seis meses
export const P_CAIDA = "p-esc-caida"; // canceló y nunca volvió
export const P_RECUPERADO = "p-esc-recuperado"; // canceló y volvió cuatro días después
export const P_ARCO = "p-esc-arco"; // archivado: fuera de las listas, dentro del contador
export const P_PLAN_NULO = "p-esc-plan-nulo"; // su presupuesto aceptado NO tiene `acceptedAt`
export const P_ESPERA = "p-esc-espera"; // pidió mover su cita desde el portal y nadie contestó

/* ── lo que debe valer cada cosa, escrito una sola vez ────────────────── */

/** Presupuesto aceptado sin agendar y sin factura viva: cuenta entero. */
export const VALOR_ACEPTADO = 12_000;
/** Aceptado pero YA facturado: la fila sale y vale 0 (su dinero está en por_cobrar). */
export const VALOR_FACTURADO = 20_000;
/** Plan de $40,000 en 4 sesiones con 1 hecha → pendiente 3/4 = $30,000. */
export const COSTE_PLAN = 40_000;
export const VALOR_PLAN_PENDIENTE = 30_000;
/** El ejemplo literal de Rafael: $30,000 de hace una semana contra $800 de hace seis meses. */
export const VALOR_CARO = 30_000;
export const VALOR_BARATO = 800;
/** Lo del paciente archivado: nunca en una lista, siempre en `archivados`. */
export const SALDO_ARCO = 5_000;

export function datosEscape(): Datos {
  const base = datosDePrueba();

  const patients: Fila[] = [
    ...(base.patients ?? []),
    paciente({ id: P_ACEPTADO, clinicId: CL_NORTE, firstName: "Rosa", lastName: "Acepto", patientNumber: "E0001", phone: "5510000001", primaryDoctorId: U_DOC_N }),
    paciente({ id: P_FACTURADO, clinicId: CL_NORTE, firstName: "Tito", lastName: "Facturado", patientNumber: "E0002", phone: "5510000002", primaryDoctorId: U_DOC_N }),
    paciente({ id: P_AGENDADO, clinicId: CL_NORTE, firstName: "Nina", lastName: "Agendada", patientNumber: "E0003", phone: "5510000003", primaryDoctorId: U_DOC_N }),
    paciente({ id: P_PLAN, clinicId: CL_NORTE, firstName: "Pablo", lastName: "Plan", patientNumber: "E0004", phone: "5510000004", primaryDoctorId: U_DOC_N }),
    paciente({ id: P_PLAN_ALDIA, clinicId: CL_NORTE, firstName: "Paz", lastName: "AlDia", patientNumber: "E0005", phone: "5510000005", primaryDoctorId: U_DOC_N }),
    paciente({ id: P_PLAN_OTRO_DOC, clinicId: CL_NORTE, firstName: "Otto", lastName: "OtraDoctora", patientNumber: "E0006", phone: "5510000006", primaryDoctorId: U_DOC2_N }),
    paciente({ id: P_CARO, clinicId: CL_NORTE, firstName: "Celia", lastName: "Cara", patientNumber: "E0007", phone: "5510000007", primaryDoctorId: U_DOC_N }),
    paciente({ id: P_BARATO, clinicId: CL_NORTE, firstName: "Bruno", lastName: "Barato", patientNumber: "E0008", phone: "5510000008", primaryDoctorId: U_DOC_N }),
    paciente({ id: P_CAIDA, clinicId: CL_NORTE, firstName: "Cati", lastName: "Cayo", patientNumber: "E0009", phone: "5510000009", primaryDoctorId: U_DOC_N }),
    paciente({ id: P_RECUPERADO, clinicId: CL_NORTE, firstName: "Raul", lastName: "Volvio", patientNumber: "E0010", phone: "5510000010", primaryDoctorId: U_DOC_N }),
    paciente({ id: P_PLAN_NULO, clinicId: CL_NORTE, firstName: "Nilo", lastName: "SinFecha", patientNumber: "E0012", phone: "5510000012", primaryDoctorId: U_DOC_N }),
    paciente({ id: P_ESPERA, clinicId: CL_NORTE, firstName: "Eva", lastName: "Espera", patientNumber: "E0013", phone: "5510000013", primaryDoctorId: U_DOC_N }),
    // Cancelado por ARCO: tiene deuda y presupuesto, y NO puede salir en ninguna lista.
    paciente({ id: P_ARCO, clinicId: CL_NORTE, firstName: "Ana", lastName: "Archivada", patientNumber: "E0011", phone: "5510000011", deletedAt: haceDias(30) }),
    // ── la clínica de al lado ──
    paciente({ id: "p-sur-esc", clinicId: CL_SUR, firstName: "Sixto", lastName: "SUR", patientNumber: "S9001", phone: "9980000001" }),
  ];

  const invoices: Fila[] = [
    ...(base.invoices ?? []),
    // La factura BORRADOR que nace con todo presupuesto: NO es por cobrar, así
    // que el presupuesto de Rosa cuenta entero.
    { id: "inv-esc-draft", invoiceNumber: "MF-9001", clinicId: CL_NORTE, patientId: P_ACEPTADO, status: "DRAFT", total: VALOR_ACEPTADO, paid: 0, balance: VALOR_ACEPTADO, discount: 0, dueDate: null, createdAt: haceDias(40), items: [{ description: "Corona", quantity: 1, unitPrice: VALOR_ACEPTADO, total: VALOR_ACEPTADO }] },
    // La de Tito SÍ está viva y por cobrar: su presupuesto no puede volver a sumar.
    { id: "inv-esc-viva", invoiceNumber: "MF-9002", clinicId: CL_NORTE, patientId: P_FACTURADO, status: "PENDING", total: VALOR_FACTURADO, paid: 0, balance: VALOR_FACTURADO, discount: 0, dueDate: haceDias(20), createdAt: haceDias(40), items: [{ description: "Implante", quantity: 1, unitPrice: VALOR_FACTURADO, total: VALOR_FACTURADO }] },
    // La del plan de Pablo: BORRADOR, para que el plan cuente su parte pendiente.
    { id: "inv-esc-plan", invoiceNumber: "MF-9003", clinicId: CL_NORTE, patientId: P_PLAN, status: "DRAFT", total: COSTE_PLAN, paid: 0, balance: COSTE_PLAN, discount: 0, dueDate: null, createdAt: haceDias(90), items: [{ description: "Ortodoncia", quantity: 1, unitPrice: COSTE_PLAN, total: COSTE_PLAN }] },
    // La factura VIVA del plan cuyo presupuesto no tiene `acceptedAt`: es la que
    // se contaría dos veces si ese presupuesto se perdiera por el filtro de fecha.
    { id: "inv-esc-nulo", invoiceNumber: "MF-9005", clinicId: CL_NORTE, patientId: P_PLAN_NULO, status: "PENDING", total: 24_000, paid: 0, balance: 24_000, discount: 0, dueDate: haceDias(10), createdAt: haceDias(100), items: [{ description: "Protesis", quantity: 1, unitPrice: 24_000, total: 24_000 }] },
    // Del paciente ARCHIVADO: por cobrar de verdad, pero no se le llama.
    { id: "inv-esc-arco", invoiceNumber: "MF-9004", clinicId: CL_NORTE, patientId: P_ARCO, status: "PENDING", total: SALDO_ARCO, paid: 0, balance: SALDO_ARCO, discount: 0, dueDate: haceDias(50), createdAt: haceDias(60), items: [{ description: "Tratamiento", quantity: 1, unitPrice: SALDO_ARCO, total: SALDO_ARCO }] },
    // ── la del sur ──
    { id: "inv-sur-esc", invoiceNumber: "SF-9001", clinicId: CL_SUR, patientId: "p-sur-esc", status: "PENDING", total: 77777, paid: 0, balance: 77777, discount: 0, dueDate: haceDias(30), createdAt: haceDias(40), items: [{ description: "FACTURA DEL SUR", quantity: 1, unitPrice: 77777, total: 77777 }] },
  ];

  const quotes: Fila[] = [
    ...(base.quotes ?? []),
    // Aceptado, sin plan, con factura en BORRADOR → cuenta entero.
    { id: "q-aceptado", clinicId: CL_NORTE, patientId: P_ACEPTADO, folio: "P-0001", title: "Corona de zirconio", status: "ACCEPTED", total: VALOR_ACEPTADO, subtotal: VALOR_ACEPTADO, discountAmount: 0, acceptedAt: haceDias(30), presentedAt: haceDias(40), validUntil: enDias(30), invoiceId: "inv-esc-draft", treatmentPlanId: null, createdAt: haceDias(40) },
    // Aceptado y YA facturado y por cobrar → la fila sale, el dinero NO se repite.
    { id: "q-facturado", clinicId: CL_NORTE, patientId: P_FACTURADO, folio: "P-0002", title: "Implante unitario", status: "ACCEPTED", total: VALOR_FACTURADO, subtotal: VALOR_FACTURADO, discountAmount: 0, acceptedAt: haceDias(35), presentedAt: haceDias(45), validUntil: enDias(30), invoiceId: "inv-esc-viva", treatmentPlanId: null, createdAt: haceDias(45) },
    // Aceptado PERO con cita futura: no se ha perdido nada.
    { id: "q-agendado", clinicId: CL_NORTE, patientId: P_AGENDADO, folio: "P-0003", title: "Blanqueamiento", status: "ACCEPTED", total: 50_000, subtotal: 50_000, discountAmount: 0, acceptedAt: haceDias(20), presentedAt: haceDias(25), validUntil: enDias(30), invoiceId: null, treatmentPlanId: null, createdAt: haceDias(25) },
    // Aceptado y CONVERTIDO en plan: lo representa el plan, no él.
    { id: "q-plan", clinicId: CL_NORTE, patientId: P_PLAN, folio: "P-0004", title: "Ortodoncia 18 meses", status: "ACCEPTED", total: COSTE_PLAN, subtotal: COSTE_PLAN, discountAmount: 0, acceptedAt: haceDias(90), presentedAt: haceDias(95), validUntil: enDias(30), invoiceId: "inv-esc-plan", treatmentPlanId: "tp-pablo", createdAt: haceDias(95) },
    // El ejemplo de Rafael: $30,000 de hace una semana…
    { id: "q-caro", clinicId: CL_NORTE, patientId: P_CARO, folio: "P-0010", title: "Rehabilitacion completa", status: "PRESENTED", total: VALOR_CARO, subtotal: VALOR_CARO, discountAmount: 0, acceptedAt: null, presentedAt: haceDias(8), validUntil: enDias(22), invoiceId: null, treatmentPlanId: null, createdAt: haceDias(8) },
    // …contra $800 de hace seis meses, y además caducado.
    { id: "q-barato", clinicId: CL_NORTE, patientId: P_BARATO, folio: "P-0011", title: "Limpieza", status: "PRESENTED", total: VALOR_BARATO, subtotal: VALOR_BARATO, discountAmount: 0, acceptedAt: null, presentedAt: haceDias(180), validUntil: haceDias(150), invoiceId: null, treatmentPlanId: null, createdAt: haceDias(180) },
    // Rechazado: contestó que no. NO es "sin respuesta".
    { id: "q-rechazado", clinicId: CL_NORTE, patientId: P_CARO, folio: "P-0012", title: "Carillas", status: "REJECTED", total: 44_000, subtotal: 44_000, discountAmount: 0, acceptedAt: null, rejectedAt: haceDias(20), presentedAt: haceDias(30), validUntil: enDias(10), invoiceId: null, treatmentPlanId: null, createdAt: haceDias(30) },
    // Borrador: ni se presentó. Tampoco es "sin respuesta".
    { id: "q-borrador", clinicId: CL_NORTE, patientId: P_CARO, folio: "P-0013", title: "Puente", status: "DRAFT", total: 66_000, subtotal: 66_000, discountAmount: 0, acceptedAt: null, presentedAt: null, validUntil: null, invoiceId: null, treatmentPlanId: null, createdAt: haceDias(60) },
    // Del ARCHIVADO: presentado y sin respuesta, pero no se le llama.
    { id: "q-arco", clinicId: CL_NORTE, patientId: P_ARCO, folio: "P-0014", title: "Protesis", status: "PRESENTED", total: 9_000, subtotal: 9_000, discountAmount: 0, acceptedAt: null, presentedAt: haceDias(60), validUntil: enDias(10), invoiceId: null, treatmentPlanId: null, createdAt: haceDias(60) },
    // 🔴 ACEPTADO pero SIN `acceptedAt` (fila vieja o importada). Tiene que
    // entrar igual: es el que dice que el plan `tp-nulo` ya está facturado.
    { id: "q-nulo", clinicId: CL_NORTE, patientId: P_PLAN_NULO, folio: "P-0005", title: "Protesis completa", status: "ACCEPTED", total: 24_000, subtotal: 24_000, discountAmount: 0, acceptedAt: null, presentedAt: haceDias(110), validUntil: enDias(30), invoiceId: "inv-esc-nulo", treatmentPlanId: "tp-nulo", createdAt: haceDias(100) },
    // ── la del sur ──
    { id: "q-sur", clinicId: CL_SUR, patientId: "p-sur-esc", folio: "S-0001", title: "PRESUPUESTO DEL SUR", status: "ACCEPTED", total: 99_999, subtotal: 99_999, discountAmount: 0, acceptedAt: haceDias(30), presentedAt: haceDias(40), validUntil: enDias(30), invoiceId: null, treatmentPlanId: null, createdAt: haceDias(40) },
    { id: "q-sur-2", clinicId: CL_SUR, patientId: "p-sur-esc", folio: "S-0002", title: "OTRO DEL SUR", status: "PRESENTED", total: 99_999, subtotal: 99_999, discountAmount: 0, acceptedAt: null, presentedAt: haceDias(40), validUntil: enDias(30), invoiceId: null, treatmentPlanId: null, createdAt: haceDias(40) },
  ];

  const treatmentPlans: Fila[] = [
    // 4 sesiones, 1 hecha, la próxima debía haber sido hace un mes y sin cita.
    { id: "tp-pablo", clinicId: CL_NORTE, patientId: P_PLAN, doctorId: U_DOC_N, name: "Ortodoncia 18 meses", status: "ACTIVE", totalCost: COSTE_PLAN, totalSessions: 4, sessionIntervalDays: 30, startDate: haceDias(90), nextExpectedDate: haceDias(30), createdAt: haceDias(90) },
    // Su próxima sesión es dentro de dos semanas: todavía no se ha caído nada.
    { id: "tp-aldia", clinicId: CL_NORTE, patientId: P_PLAN_ALDIA, doctorId: U_DOC_N, name: "Periodontal", status: "ACTIVE", totalCost: 20_000, totalSessions: 4, sessionIntervalDays: 30, startDate: haceDias(30), nextExpectedDate: enDias(14), createdAt: haceDias(30) },
    // Terminado: no falta ninguna sesión.
    { id: "tp-hecho", clinicId: CL_NORTE, patientId: P_PLAN_ALDIA, doctorId: U_DOC_N, name: "Endodoncia", status: "COMPLETED", totalCost: 9_000, totalSessions: 2, sessionIntervalDays: 30, startDate: haceDias(200), nextExpectedDate: haceDias(170), createdAt: haceDias(200) },
    // De la OTRA doctora, atrasado: el scope de DOCTOR tiene que dejarlo fuera
    // para el doctor Hugo y dentro para la administradora.
    { id: "tp-otro-doc", clinicId: CL_NORTE, patientId: P_PLAN_OTRO_DOC, doctorId: U_DOC2_N, name: "Protesis", status: "ACTIVE", totalCost: 16_000, totalSessions: 2, sessionIntervalDays: 30, startDate: haceDias(120), nextExpectedDate: haceDias(60), createdAt: haceDias(120) },
    // Su presupuesto no tiene `acceptedAt`; su factura SÍ está viva y por cobrar.
    { id: "tp-nulo", clinicId: CL_NORTE, patientId: P_PLAN_NULO, doctorId: U_DOC_N, name: "Protesis completa", status: "ACTIVE", totalCost: 24_000, totalSessions: 2, sessionIntervalDays: 30, startDate: haceDias(100), nextExpectedDate: haceDias(40), createdAt: haceDias(100) },
    // ── la del sur ──
    { id: "tp-sur", clinicId: CL_SUR, patientId: "p-sur-esc", doctorId: U_ADMIN_S, name: "PLAN DEL SUR", status: "ACTIVE", totalCost: 88_888, totalSessions: 2, sessionIntervalDays: 30, startDate: haceDias(120), nextExpectedDate: haceDias(60), createdAt: haceDias(120) },
  ];

  const treatmentSessions: Fila[] = [
    { id: "ts-1", treatmentId: "tp-pablo", sessionNumber: 1, completedAt: haceDias(60), createdAt: haceDias(60) },
    { id: "ts-2", treatmentId: "tp-aldia", sessionNumber: 1, completedAt: haceDias(20), createdAt: haceDias(20) },
    { id: "ts-3", treatmentId: "tp-hecho", sessionNumber: 1, completedAt: haceDias(190), createdAt: haceDias(190) },
    { id: "ts-4", treatmentId: "tp-hecho", sessionNumber: 2, completedAt: haceDias(180), createdAt: haceDias(180) },
    { id: "ts-sur", treatmentId: "tp-sur", sessionNumber: 1, completedAt: haceDias(100), createdAt: haceDias(100) },
  ];

  const appointments: Fila[] = [
    ...(base.appointments ?? []),
    // Nina ya viene: su presupuesto aceptado NO es una oportunidad perdida.
    { id: "a-esc-futura", clinicId: CL_NORTE, patientId: P_AGENDADO, doctorId: U_DOC_N, type: "Blanqueamiento", status: "SCHEDULED", resourceId: null, startsAt: enDias(5), endsAt: enDias(5) },
    // Cati canceló hace 20 días y no volvió a pisar la agenda.
    { id: "a-esc-caida", clinicId: CL_NORTE, patientId: P_CAIDA, doctorId: U_DOC_N, type: "Limpieza dental", status: "CANCELLED", resourceId: null, startsAt: haceDias(20), endsAt: haceDias(20) },
    // …y otra antes: dos caídas, UNA sola llamada.
    { id: "a-esc-caida-2", clinicId: CL_NORTE, patientId: P_CAIDA, doctorId: U_DOC_N, type: "Limpieza dental", status: "NO_SHOW", resourceId: null, startsAt: haceDias(45), endsAt: haceDias(45) },
    // Raul canceló hace 30 y vino hace 26: se recuperó solo.
    { id: "a-esc-rec-1", clinicId: CL_NORTE, patientId: P_RECUPERADO, doctorId: U_DOC_N, type: "Consulta", status: "CANCELLED", resourceId: null, startsAt: haceDias(30), endsAt: haceDias(30) },
    { id: "a-esc-rec-2", clinicId: CL_NORTE, patientId: P_RECUPERADO, doctorId: U_DOC_N, type: "Consulta", status: "COMPLETED", resourceId: null, startsAt: haceDias(26), endsAt: haceDias(26) },
    // Del ARCHIVADO: cayó y nadie la reagendó, pero no se le llama.
    { id: "a-esc-arco", clinicId: CL_NORTE, patientId: P_ARCO, doctorId: U_DOC_N, type: "Consulta", status: "CANCELLED", resourceId: null, startsAt: haceDias(15), endsAt: haceDias(15) },
    // La cita que Eva quiere mover, y la del paciente archivado.
    { id: "a-esc-espera", clinicId: CL_NORTE, patientId: P_ESPERA, doctorId: U_DOC_N, type: "Consulta", status: "SCHEDULED", resourceId: null, startsAt: enDias(9), endsAt: enDias(9) },
    { id: "a-esc-espera-arco", clinicId: CL_NORTE, patientId: P_ARCO, doctorId: U_DOC_N, type: "Consulta", status: "SCHEDULED", resourceId: null, startsAt: enDias(11), endsAt: enDias(11) },
    // ── la del sur ──
    { id: "a-sur-esc", clinicId: CL_SUR, patientId: "p-sur-esc", doctorId: U_ADMIN_S, type: "CITA DEL SUR", status: "CANCELLED", resourceId: null, startsAt: haceDias(10), endsAt: haceDias(10) },
  ];

  const bookingRequests: Fila[] = [
    // Pidió cita por la web hace 3 días para pasado mañana: nadie ha contestado.
    { id: "br-1", clinicId: CL_NORTE, status: "PENDIENTE", patientName: "Wendy Web", patientWhatsapp: "5210000001", serviceName: "Limpieza dental", requestedAt: enDias(2), createdAt: haceDias(3) },
    // Pidió para un día que YA PASÓ y sigue marcada PENDIENTE (el paso a
    // EXPIRADA es perezoso): se quedó esperando un día concreto.
    { id: "br-2", clinicId: CL_NORTE, status: "PENDIENTE", patientName: "Pedro Plantado", patientWhatsapp: "5210000002", serviceName: "Urgencia", requestedAt: haceDias(4), createdAt: haceDias(6) },
    // Ya resuelta: no se está escapando nada.
    { id: "br-3", clinicId: CL_NORTE, status: "ACEPTADA", patientName: "Aida Atendida", patientWhatsapp: "5210000003", serviceName: "Consulta", requestedAt: haceDias(2), createdAt: haceDias(5) },
    // ── la del sur ──
    { id: "br-sur", clinicId: CL_SUR, status: "PENDIENTE", patientName: "Wilma SUR", patientWhatsapp: "5219990001", serviceName: "SOLICITUD DEL SUR", requestedAt: enDias(2), createdAt: haceDias(3) },
  ];

  const appointmentChangeRequests: Fila[] = [
    { id: "acr-1", clinicId: CL_NORTE, appointmentId: "a-esc-espera", patientId: P_ESPERA, accountId: "acc-1", type: "RESCHEDULE", status: "PENDING", proposedStartsAt: enDias(16), createdAt: haceDias(2), updatedAt: haceDias(2) },
    // Ya contestada.
    { id: "acr-2", clinicId: CL_NORTE, appointmentId: "a-esc-futura", patientId: P_AGENDADO, accountId: "acc-2", type: "CANCEL", status: "APPROVED", proposedStartsAt: null, createdAt: haceDias(8), updatedAt: haceDias(7) },
    // Del ARCHIVADO: pendiente, pero no se le llama.
    { id: "acr-arco", clinicId: CL_NORTE, appointmentId: "a-esc-espera-arco", patientId: P_ARCO, accountId: "acc-3", type: "RESCHEDULE", status: "PENDING", proposedStartsAt: enDias(20), createdAt: haceDias(5), updatedAt: haceDias(5) },
    // ── la del sur ──
    { id: "acr-sur", clinicId: CL_SUR, appointmentId: "a-sur-esc", patientId: "p-sur-esc", accountId: "acc-s", type: "RESCHEDULE", status: "PENDING", proposedStartsAt: enDias(20), createdAt: haceDias(2), updatedAt: haceDias(2) },
  ];

  return { ...base, patients, invoices, quotes, appointments, treatmentPlans, treatmentSessions, bookingRequests, appointmentChangeRequests };
}

export function baseEscape(): BaseDoble {
  return crearBase(datosEscape());
}
