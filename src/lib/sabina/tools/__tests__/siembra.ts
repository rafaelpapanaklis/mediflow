/**
 * DOS CLÍNICAS DE PRUEBA, sembradas a mano.
 *
 * Es la pieza que pide el prompt de esta tarea: «monta dos clínicas de prueba y
 * demuestra que ninguna herramienta devuelve datos de la otra». Los datos de la
 * clínica de al lado (`CL_SUR`) están puestos para CHILLAR si se cuelan —
 * nombres con "SUR", importes absurdos como $99,999— así que una fuga no se
 * puede confundir con un dato propio.
 *
 * ── TODAS LAS FECHAS SON RELATIVAS A AHORA ─────────────────────────────
 * A propósito: una siembra con fechas absolutas ("2026-09-10") empieza a fallar
 * el mes que viene y se acaba borrando la prueba en vez de arreglarla. Los
 * instantes se construyen con `tzLocalToUtc(dia, hora, min, tz)`, o sea en la
 * hora LOCAL de cada clínica, que es también lo que se está probando: `CL_SUR`
 * está en Cancún (UTC-5, sin horario de verano) y `CL_NORTE` en Ciudad de
 * México (UTC-6), así que una herramienta que usara la zona del proceso en vez
 * de la de la clínica daría números distintos para las dos.
 */

import { todayInTz, tzLocalToUtc } from "@/lib/agenda/time-utils";
import { sumarDias } from "../fechas";
import type { SabinaCtx } from "../../tipos";
import { crearBase, type BaseDoble, type Datos, type Fila } from "./doble-base";

export const CL_NORTE = "cl-norte";
export const CL_SUR = "cl-sur";
export const TZ_NORTE = "America/Mexico_City";
export const TZ_SUR = "America/Cancun";

export const U_ADMIN_N = "u-admin-n";
export const U_DOC_N = "u-doc-n";
export const U_DOC2_N = "u-doc2-n";
export const U_RECEP_N = "u-recep-n";
export const U_ADMIN_S = "u-admin-s";

/** Hoy en el calendario de cada clínica. */
export const HOY_N = todayInTz(TZ_NORTE);
export const HOY_S = todayInTz(TZ_SUR);

/** Un día concreto del pasado, para las pruebas que necesitan un rango cerrado. */
export const DIA_LLENO = sumarDias(HOY_N, -7); // 60 citas: prueba del tope de 50
export const DIA_AUSENCIAS = sumarDias(HOY_N, -5);
export const DIA_MUCHAS_AUSENCIAS = sumarDias(HOY_N, -20);
export const DIA_ALTAS_MASIVAS = sumarDias(HOY_N, -40);

const DIA_MS = 86_400_000;

/** Instante UTC de una hora LOCAL de la clínica. */
function en(dia: string, hora: number, min: number, tz: string): Date {
  return tzLocalToUtc(dia, hora, min, tz);
}

/** Hace `n` días desde ahora, como instante. Para lo que no es día de calendario. */
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
    dob: null,
    source: null,
    lifecycleStage: "patient",
    ...over,
  };
}

function cita(over: Fila): Fila {
  return { resourceId: null, type: "Consulta", ...over };
}

export function datosDePrueba(): Datos {
  const clinics: Fila[] = [
    { id: CL_NORTE, timezone: TZ_NORTE, agendaDayStart: 8, agendaDayEnd: 20, category: "DENTAL" },
    { id: CL_SUR, timezone: TZ_SUR, agendaDayStart: 8, agendaDayEnd: 20, category: "DENTAL" },
  ];

  // Horario de Ajustes de la del norte: L-V 09-19, sábado 09-14, domingo cerrado.
  // 0 = lunes … 6 = domingo.
  const clinicSchedules: Fila[] = [
    { clinicId: CL_NORTE, dayOfWeek: 0, enabled: true, openTime: "09:00", closeTime: "19:00" },
    { clinicId: CL_NORTE, dayOfWeek: 1, enabled: true, openTime: "09:00", closeTime: "19:00" },
    { clinicId: CL_NORTE, dayOfWeek: 2, enabled: true, openTime: "09:00", closeTime: "19:00" },
    { clinicId: CL_NORTE, dayOfWeek: 3, enabled: true, openTime: "09:00", closeTime: "19:00" },
    { clinicId: CL_NORTE, dayOfWeek: 4, enabled: true, openTime: "09:00", closeTime: "19:00" },
    { clinicId: CL_NORTE, dayOfWeek: 5, enabled: true, openTime: "09:00", closeTime: "14:00" },
    { clinicId: CL_NORTE, dayOfWeek: 6, enabled: false, openTime: "09:00", closeTime: "14:00" },
    // La del sur no configuró Ajustes: cae al agendaDayStart/End histórico.
  ];

  const resources: Fila[] = [
    { id: "r-n1", clinicId: CL_NORTE, isActive: true, kind: "SILLA_DENTAL" },
    { id: "r-n2", clinicId: CL_NORTE, isActive: true, kind: "CONSULTORIO_DENTAL" },
    { id: "r-n3", clinicId: CL_NORTE, isActive: false, kind: "SILLA_DENTAL" }, // de baja: no cuenta
    { id: "r-n4", clinicId: CL_NORTE, isActive: true, kind: "SALA_DE_ESPERA" }, // no es de tratamiento
    { id: "r-s1", clinicId: CL_SUR, isActive: true, kind: "SILLA_DENTAL" },
    { id: "r-s2", clinicId: CL_SUR, isActive: true, kind: "SILLA_DENTAL" },
    { id: "r-s3", clinicId: CL_SUR, isActive: true, kind: "SILLA_DENTAL" },
  ];

  const users: Fila[] = [
    { id: U_ADMIN_N, clinicId: CL_NORTE, role: "ADMIN", firstName: "Rita", lastName: "Admin", isActive: true },
    { id: U_DOC_N, clinicId: CL_NORTE, role: "DOCTOR", firstName: "Hugo", lastName: "Salas", isActive: true },
    { id: U_DOC2_N, clinicId: CL_NORTE, role: "DOCTOR", firstName: "Nadia", lastName: "Rojas", isActive: true },
    { id: U_RECEP_N, clinicId: CL_NORTE, role: "RECEPTIONIST", firstName: "Lupe", lastName: "Mesa", isActive: true },
    { id: U_ADMIN_S, clinicId: CL_SUR, role: "ADMIN", firstName: "Sara", lastName: "Sur", isActive: true },
  ];

  const patients: Fila[] = [
    paciente({
      id: "p-ana", clinicId: CL_NORTE, firstName: "Ana", lastName: "Perez",
      patientNumber: "P0001", phone: "+52 55 1234 5678", email: "ana@ejemplo.mx",
      createdAt: haceDias(100), primaryDoctorId: U_DOC_N,
    }),
    paciente({
      id: "p-beto", clinicId: CL_NORTE, firstName: "Beto", lastName: "Munoz",
      patientNumber: "P0002", phone: "5598765432",
      createdAt: haceDias(20), primaryDoctorId: U_DOC_N,
    }),
    paciente({
      id: "p-carla", clinicId: CL_NORTE, firstName: "Carla", lastName: "Gomez",
      patientNumber: "P0003", createdAt: haceDias(5), primaryDoctorId: U_DOC_N,
      source: "Recomendacion",
    }),
    paciente({
      id: "p-dora", clinicId: CL_NORTE, firstName: "Dora", lastName: "Sanchez",
      patientNumber: "P0004", createdAt: haceDias(2), primaryDoctorId: U_DOC2_N,
      source: "Google",
    }),
    paciente({
      id: "p-elias", clinicId: CL_NORTE, firstName: "Elias", lastName: "Ruiz",
      patientNumber: "P0005", createdAt: haceDias(1), primaryDoctorId: U_DOC2_N,
      source: "Google",
    }),
    // Restringida: solo la ve el admin (la lista NO vacía manda sobre las
    // heurísticas de doctor).
    paciente({
      id: "p-priv", clinicId: CL_NORTE, firstName: "Paula", lastName: "Restringida",
      patientNumber: "P0006", createdAt: haceDias(4), visibleUserIds: [U_ADMIN_N],
    }),
    // Cancelada por ARCO: no debe aparecer en NINGUNA lista.
    paciente({
      id: "p-borrado", clinicId: CL_NORTE, firstName: "Borrado", lastName: "ARCO",
      patientNumber: "P0007", createdAt: haceDias(3), deletedAt: haceDias(1),
    }),
    // Pacientes de la prueba de inactivos.
    paciente({ id: "p-inact-1", clinicId: CL_NORTE, firstName: "Ines", lastName: "Vieja", patientNumber: "P0101", phone: "5511110001", createdAt: haceDias(500) }),
    paciente({ id: "p-inact-2", clinicId: CL_NORTE, firstName: "Ivan", lastName: "Agendado", patientNumber: "P0102", createdAt: haceDias(400) }),
    paciente({ id: "p-inact-3", clinicId: CL_NORTE, firstName: "Iris", lastName: "Reciente", patientNumber: "P0103", createdAt: haceDias(300) }),
    paciente({ id: "p-inact-4", clinicId: CL_NORTE, firstName: "Ismael", lastName: "Nuncavino", patientNumber: "P0104", createdAt: haceDias(350) }),
    paciente({ id: "p-inact-5", clinicId: CL_NORTE, firstName: "Irma", lastName: "Antigua", patientNumber: "P0105", phone: "5511110005", createdAt: haceDias(700) }),
    // ── la clínica de al lado ──
    paciente({ id: "p-sur-1", clinicId: CL_SUR, firstName: "Sofia", lastName: "SUR", patientNumber: "S0001", phone: "9981110001", createdAt: haceDias(3) }),
    paciente({ id: "p-sur-2", clinicId: CL_SUR, firstName: "Simon", lastName: "SUR", patientNumber: "S0002", createdAt: haceDias(2) }),
    paciente({ id: "p-sur-inact", clinicId: CL_SUR, firstName: "Saul", lastName: "SUR", patientNumber: "S0003", createdAt: haceDias(800) }),
  ];

  const appointments: Fila[] = [
    // ── HOY en la del norte ──
    // 07:30: FUERA del horario 08-20. Si la ventana fuera el horario de atención
    // y no el día natural, esta cita desaparecería (hallazgos 40 y 32).
    cita({ id: "a-hoy-1", clinicId: CL_NORTE, patientId: "p-ana", doctorId: U_DOC_N, status: "CONFIRMED", type: "Urgencia", startsAt: en(HOY_N, 7, 30, TZ_NORTE), endsAt: en(HOY_N, 8, 15, TZ_NORTE) }),
    cita({ id: "a-hoy-2", clinicId: CL_NORTE, patientId: "p-beto", doctorId: U_DOC_N, status: "COMPLETED", type: "Limpieza dental", startsAt: en(HOY_N, 10, 0, TZ_NORTE), endsAt: en(HOY_N, 10, 30, TZ_NORTE) }),
    cita({ id: "a-hoy-3", clinicId: CL_NORTE, patientId: "p-carla", doctorId: U_DOC_N, status: "CANCELLED", startsAt: en(HOY_N, 11, 0, TZ_NORTE), endsAt: en(HOY_N, 11, 30, TZ_NORTE) }),
    cita({ id: "a-hoy-4", clinicId: CL_NORTE, patientId: "p-dora", doctorId: U_DOC2_N, status: "NO_SHOW", startsAt: en(HOY_N, 12, 0, TZ_NORTE), endsAt: en(HOY_N, 12, 30, TZ_NORTE) }),
    // 23:30, y cruza la medianoche: pertenece al día en que EMPEZÓ.
    cita({ id: "a-hoy-5", clinicId: CL_NORTE, patientId: "p-elias", doctorId: U_DOC2_N, status: "SCHEDULED", startsAt: en(HOY_N, 23, 30, TZ_NORTE), endsAt: en(sumarDias(HOY_N, 1), 0, 15, TZ_NORTE) }),
    // La cita de la paciente restringida: el hueco existe, el nombre no viaja.
    cita({ id: "a-hoy-6", clinicId: CL_NORTE, patientId: "p-priv", doctorId: U_DOC_N, status: "CONFIRMED", startsAt: en(HOY_N, 16, 0, TZ_NORTE), endsAt: en(HOY_N, 16, 30, TZ_NORTE) }),

    // ── HOY en la del sur: NUNCA debe salir en la del norte ──
    cita({ id: "a-sur-1", clinicId: CL_SUR, patientId: "p-sur-1", doctorId: U_ADMIN_S, status: "CONFIRMED", startsAt: en(HOY_S, 10, 0, TZ_SUR), endsAt: en(HOY_S, 10, 30, TZ_SUR) }),
    cita({ id: "a-sur-2", clinicId: CL_SUR, patientId: "p-sur-2", doctorId: U_ADMIN_S, status: "NO_SHOW", startsAt: en(HOY_S, 11, 0, TZ_SUR), endsAt: en(HOY_S, 11, 30, TZ_SUR) }),

    // ── ausencias: 3 NO_SHOW + 4 cumplidas + 1 cancelada, hace 5 días ──
    cita({ id: "a-ns-1", clinicId: CL_NORTE, patientId: "p-ana", doctorId: U_DOC_N, status: "NO_SHOW", startsAt: en(DIA_AUSENCIAS, 9, 0, TZ_NORTE), endsAt: en(DIA_AUSENCIAS, 9, 30, TZ_NORTE) }),
    cita({ id: "a-ns-2", clinicId: CL_NORTE, patientId: "p-ana", doctorId: U_DOC_N, status: "NO_SHOW", startsAt: en(DIA_AUSENCIAS, 10, 0, TZ_NORTE), endsAt: en(DIA_AUSENCIAS, 10, 30, TZ_NORTE) }),
    cita({ id: "a-ns-3", clinicId: CL_NORTE, patientId: "p-beto", doctorId: U_DOC2_N, status: "NO_SHOW", startsAt: en(DIA_AUSENCIAS, 11, 0, TZ_NORTE), endsAt: en(DIA_AUSENCIAS, 11, 30, TZ_NORTE) }),
    cita({ id: "a-ok-1", clinicId: CL_NORTE, patientId: "p-ana", doctorId: U_DOC_N, status: "COMPLETED", startsAt: en(DIA_AUSENCIAS, 12, 0, TZ_NORTE), endsAt: en(DIA_AUSENCIAS, 13, 0, TZ_NORTE) }),
    cita({ id: "a-ok-2", clinicId: CL_NORTE, patientId: "p-beto", doctorId: U_DOC_N, status: "COMPLETED", startsAt: en(DIA_AUSENCIAS, 13, 0, TZ_NORTE), endsAt: en(DIA_AUSENCIAS, 14, 0, TZ_NORTE) }),
    cita({ id: "a-ok-3", clinicId: CL_NORTE, patientId: "p-carla", doctorId: U_DOC2_N, status: "COMPLETED", startsAt: en(DIA_AUSENCIAS, 14, 0, TZ_NORTE), endsAt: en(DIA_AUSENCIAS, 15, 0, TZ_NORTE) }),
    cita({ id: "a-ok-4", clinicId: CL_NORTE, patientId: "p-dora", doctorId: U_DOC2_N, status: "COMPLETED", startsAt: en(DIA_AUSENCIAS, 15, 0, TZ_NORTE), endsAt: en(DIA_AUSENCIAS, 16, 0, TZ_NORTE) }),
    cita({ id: "a-can-1", clinicId: CL_NORTE, patientId: "p-elias", doctorId: U_DOC_N, status: "CANCELLED", startsAt: en(DIA_AUSENCIAS, 16, 0, TZ_NORTE), endsAt: en(DIA_AUSENCIAS, 16, 30, TZ_NORTE) }),
    // Una ausencia de la del sur el mismo día: no debe sumar en la del norte.
    cita({ id: "a-ns-sur", clinicId: CL_SUR, patientId: "p-sur-1", doctorId: U_ADMIN_S, status: "NO_SHOW", startsAt: en(DIA_AUSENCIAS, 9, 0, TZ_SUR), endsAt: en(DIA_AUSENCIAS, 9, 30, TZ_SUR) }),

    // ── inactivos ──
    cita({ id: "a-in-1", clinicId: CL_NORTE, patientId: "p-inact-1", doctorId: U_DOC_N, status: "COMPLETED", startsAt: haceDias(400), endsAt: haceDias(400) }),
    cita({ id: "a-in-2a", clinicId: CL_NORTE, patientId: "p-inact-2", doctorId: U_DOC_N, status: "COMPLETED", startsAt: haceDias(200), endsAt: haceDias(200) }),
    // …pero ya tiene cita: no es un paciente perdido.
    cita({ id: "a-in-2b", clinicId: CL_NORTE, patientId: "p-inact-2", doctorId: U_DOC_N, status: "SCHEDULED", startsAt: enDias(10), endsAt: enDias(10) }),
    cita({ id: "a-in-3", clinicId: CL_NORTE, patientId: "p-inact-3", doctorId: U_DOC_N, status: "COMPLETED", startsAt: haceDias(100), endsAt: haceDias(100) }),
    // Solo canceló: nunca fue una visita cumplida.
    cita({ id: "a-in-4", clinicId: CL_NORTE, patientId: "p-inact-4", doctorId: U_DOC_N, status: "CANCELLED", startsAt: haceDias(300), endsAt: haceDias(300) }),
    // CHECKED_OUT también es visita cumplida.
    cita({ id: "a-in-5", clinicId: CL_NORTE, patientId: "p-inact-5", doctorId: U_DOC_N, status: "CHECKED_OUT", startsAt: haceDias(600), endsAt: haceDias(600) }),
    cita({ id: "a-in-sur", clinicId: CL_SUR, patientId: "p-sur-inact", doctorId: U_ADMIN_S, status: "COMPLETED", startsAt: haceDias(700), endsAt: haceDias(700) }),
  ];

  // 60 citas el mismo día: la prueba del tope de 50.
  for (let i = 0; i < 60; i++) {
    appointments.push(
      cita({
        id: `a-masiva-${i}`,
        clinicId: CL_NORTE,
        patientId: "p-ana",
        doctorId: U_DOC_N,
        status: "CONFIRMED",
        type: "Revision",
        startsAt: en(DIA_LLENO, 9, i, TZ_NORTE),
        endsAt: en(DIA_LLENO, 9, i + 1, TZ_NORTE),
      }),
    );
  }

  // 55 ausencias el mismo día: el tope de 50 en `ausencias`.
  for (let i = 0; i < 55; i++) {
    appointments.push(
      cita({
        id: `a-ns-masiva-${i}`,
        clinicId: CL_NORTE,
        patientId: "p-beto",
        doctorId: U_DOC_N,
        status: "NO_SHOW",
        startsAt: en(DIA_MUCHAS_AUSENCIAS, 9, i, TZ_NORTE),
        endsAt: en(DIA_MUCHAS_AUSENCIAS, 9, i + 1, TZ_NORTE),
      }),
    );
  }

  // 60 altas el mismo día: el tope de 50 en `pacientes_nuevos` y en el buscador.
  for (let i = 0; i < 60; i++) {
    patients.push(
      paciente({
        id: `p-masivo-${i}`,
        clinicId: CL_NORTE,
        firstName: "Masivo",
        lastName: `Numero${i}`,
        patientNumber: `M${i}`,
        primaryDoctorId: U_DOC_N,
        createdAt: en(DIA_ALTAS_MASIVAS, 12, 0, TZ_NORTE),
        source: "Importacion",
      }),
    );
  }

  const invoices: Fila[] = [
    {
      id: "inv-1", clinicId: CL_NORTE, patientId: "p-ana", status: "PAID",
      total: 5000, paid: 5000, balance: 0, discount: 0, dueDate: null,
      createdAt: en(sumarDias(HOY_N, -5), 11, 0, TZ_NORTE),
      items: [
        { description: "Limpieza dental", quantity: 1, unitPrice: 1000, total: 1000 },
        { description: "Resina", quantity: 4, unitPrice: 1000, total: 4000 },
      ],
    },
    {
      id: "inv-2", clinicId: CL_NORTE, patientId: "p-beto", status: "PENDING",
      total: 3000, paid: 0, balance: 3000, discount: 0,
      dueDate: haceDias(10),
      createdAt: en(sumarDias(HOY_N, -8), 11, 0, TZ_NORTE),
      items: [{ description: "Endodoncia", quantity: 1, unitPrice: 3000, total: 3000 }],
    },
    {
      id: "inv-3", clinicId: CL_NORTE, patientId: "p-carla", status: "PARTIAL",
      total: 2000, paid: 1500, balance: 500, discount: 0,
      dueDate: enDias(10),
      createdAt: en(sumarDias(HOY_N, -3), 11, 0, TZ_NORTE),
      items: [{ description: "Limpieza dental", quantity: 1, unitPrice: 2000, total: 2000 }],
    },
    // BORRADOR: cuenta como saldo en la pantalla de Pacientes, y NO como
    // vencido (Finanzas excluye DRAFT) ni como facturado.
    {
      id: "inv-4", clinicId: CL_NORTE, patientId: "p-dora", status: "DRAFT",
      total: 1000, paid: 0, balance: 1000, discount: 0, dueDate: haceDias(20),
      createdAt: en(sumarDias(HOY_N, -2), 11, 0, TZ_NORTE),
      items: [{ description: "Consulta general", quantity: 1, unitPrice: 1000, total: 1000 }],
    },
    // CANCELADA con balance intacto: el agujero clásico. No es deuda.
    {
      id: "inv-5", clinicId: CL_NORTE, patientId: "p-elias", status: "CANCELLED",
      total: 4000, paid: 0, balance: 4000, discount: 0, dueDate: haceDias(30),
      createdAt: en(sumarDias(HOY_N, -4), 11, 0, TZ_NORTE),
      items: [{ description: "Ortodoncia", quantity: 1, unitPrice: 4000, total: 4000 }],
    },
    // Con DESCUENTO de factura: ejercita el prorrateo por concepto.
    {
      id: "inv-6", clinicId: CL_NORTE, patientId: "p-ana", status: "PAID",
      total: 900, paid: 900, balance: 0, discount: 100, dueDate: null,
      createdAt: en(sumarDias(HOY_N, -4), 11, 0, TZ_NORTE),
      items: [{ description: "Blanqueamiento", quantity: 1, unitPrice: 1000, total: 1000 }],
    },
    // De la paciente RESTRINGIDA, y con saldo: es lo que hace que la prueba de
    // visibilidad por la puerta de facturación pueda fallar de verdad. Fuera del
    // rango de 10 días a propósito, para no mover las cifras de los otros casos;
    // la deuda no lleva rango, así que aquí sí cuenta. Sin `dueDate`: no vence.
    {
      id: "inv-7", clinicId: CL_NORTE, patientId: "p-priv", status: "PENDING",
      total: 7777, paid: 0, balance: 7777, discount: 0, dueDate: null,
      createdAt: en(sumarDias(HOY_N, -60), 11, 0, TZ_NORTE),
      items: [{ description: "Tratamiento restringido", quantity: 1, unitPrice: 7777, total: 7777 }],
    },
    // ── la del sur ──
    {
      id: "inv-sur-1", clinicId: CL_SUR, patientId: "p-sur-1", status: "PENDING",
      total: 99999, paid: 0, balance: 99999, discount: 0, dueDate: haceDias(60),
      createdAt: en(sumarDias(HOY_S, -3), 11, 0, TZ_SUR),
      items: [{ description: "TRATAMIENTO DEL SUR", quantity: 1, unitPrice: 99999, total: 99999 }],
    },
  ];

  const payments: Fila[] = [
    { id: "pay-1", invoiceId: "inv-1", amount: 5000, method: "cash", paidAt: en(sumarDias(HOY_N, -5), 12, 0, TZ_NORTE) },
    { id: "pay-2", invoiceId: "inv-3", amount: 1500, method: "credit", paidAt: en(sumarDias(HOY_N, -3), 12, 0, TZ_NORTE) },
    // Reembolso: se guarda con monto POSITIVO. Sin el filtro se sumaría como cobro.
    { id: "pay-3", invoiceId: "inv-3", amount: 500, method: "refund", paidAt: en(sumarDias(HOY_N, -2), 12, 0, TZ_NORTE) },
    // Pago de una factura CANCELADA: no es ingreso.
    { id: "pay-4", invoiceId: "inv-5", amount: 4000, method: "cash", paidAt: en(sumarDias(HOY_N, -4), 12, 0, TZ_NORTE) },
    { id: "pay-5", invoiceId: "inv-6", amount: 900, method: "transfer", paidAt: en(sumarDias(HOY_N, -4), 13, 0, TZ_NORTE) },
    // ── la del sur ──
    { id: "pay-sur-1", invoiceId: "inv-sur-1", amount: 50000, method: "cash", paidAt: en(sumarDias(HOY_S, -3), 12, 0, TZ_SUR) },
  ];

  const records: Fila[] = [
    { id: "rec-1", clinicId: CL_NORTE, patientId: "p-ana", doctorId: U_DOC_N, visitDate: haceDias(5) },
    { id: "rec-2", clinicId: CL_NORTE, patientId: "p-beto", doctorId: U_DOC_N, visitDate: haceDias(5) },
    { id: "rec-sur", clinicId: CL_SUR, patientId: "p-sur-1", doctorId: U_ADMIN_S, visitDate: haceDias(3) },
  ];

  return { clinics, clinicSchedules, resources, users, patients, appointments, invoices, payments, records };
}

export function base(): BaseDoble {
  return crearBase(datosDePrueba());
}

/* ── contextos de sesión ─────────────────────────────────────────────── */

function ctx(over: Partial<SabinaCtx>, db: BaseDoble): SabinaCtx {
  return {
    clinicId: CL_NORTE,
    userId: U_ADMIN_N,
    role: "ADMIN",
    permissionsOverride: [],
    timezone: TZ_NORTE,
    clinicCategory: "DENTAL",
    db,
    ...over,
  };
}

/** Administradora de la del norte: lo ve todo de SU clínica. */
export function adminNorte(db: BaseDoble): SabinaCtx {
  return ctx({}, db);
}

/** Doctor de la del norte: solo SUS citas y SUS pacientes. */
export function doctorNorte(db: BaseDoble): SabinaCtx {
  return ctx({ userId: U_DOC_N, role: "DOCTOR" }, db);
}

/** Recepción de la del norte. */
export function recepcionNorte(db: BaseDoble): SabinaCtx {
  return ctx({ userId: U_RECEP_N, role: "RECEPTIONIST" }, db);
}

/** Administradora de la del SUR. Sirve para probar la fuga en las dos direcciones. */
export function adminSur(db: BaseDoble): SabinaCtx {
  return ctx({ clinicId: CL_SUR, userId: U_ADMIN_S, timezone: TZ_SUR }, db);
}

/**
 * Sesión con el override puesto a mano: SOLO las keys que se le pasen.
 * `permissionsOverride` REEMPLAZA al default del rol (no se mergea), así que es
 * la forma exacta en que el SUPER_ADMIN apaga un interruptor en el modal de
 * Permisos del equipo.
 */
export function conPermisos(db: BaseDoble, keys: string[]): SabinaCtx {
  return ctx({ userId: U_RECEP_N, role: "RECEPTIONIST", permissionsOverride: keys }, db);
}
