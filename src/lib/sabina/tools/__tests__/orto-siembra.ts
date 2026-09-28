/**
 * ORTODONCIA sembrada sobre las dos clínicas de `./siembra` (ws1-t11).
 *
 * Los pacientes, los usuarios y las sedes son los de siempre (Ana, Beto, Carla,
 * Dora, Elías, la paciente restringida y la del SUR). Aquí se les añaden sus
 * casos de ortodoncia, sus controles en la agenda, sus hojas de control y sus
 * facturas a plazos.
 *
 * ── LOS CASOS DEL NORTE ────────────────────────────────────────────────
 *  · Ana    — en curso, mes 7 de 24. Plan a plazos: enganche $5,000 + 10 de
 *             $2,000; pagó el enganche y dos. Debe UNA mensualidad ($2,000).
 *             Tres hojas firmadas con la higiene empeorando, y un borrador de
 *             hoy con otro arco (que NO cuenta: el arco actual es el firmado).
 *  · Beto   — en curso, sin factura todavía. Su último control fue hace 60
 *             días, faltó al de hace 20 y no tiene otro agendado: URGENTE.
 *  · Carla  — en retención, plan saldado. Control en tres días.
 *  · Dora   — en curso, modo PAGO POR CONTROL, con alineadores (trae el 3 y
 *             debería traer el 6). Debe un control de $800.
 *  · Elías  — caso COMPLETADO, con su plan de tres pagos saldado.
 *  · Iván   — caso en ABANDONO que nunca tuvo factura: no hay nada que dar por
 *             saldado.
 *  · Paula  — la paciente RESTRINGIDA (solo la ve la administradora): en curso,
 *             debe tres mensualidades ($6,000). Un doctor no puede enterarse.
 *
 * ── EL SUR ─────────────────────────────────────────────────────────────
 * Sofía SUR: caso en curso, $99,999 vencidos y un control hoy. Si algo de eso
 * sale en una consulta del norte, es una fuga entre clínicas.
 *
 * ── LA SEDE SIN MÓDULO ─────────────────────────────────────────────────
 * `CL_SIN_MODULO` es dental y tiene un caso sembrado, pero NO tiene el módulo
 * contratado; `CL_VENCIDA` lo tuvo y se le venció. En ninguna de las dos puede
 * salir un dato de ortodoncia.
 *
 * Todas las fechas son relativas a hoy, como en `./siembra`.
 */

import { subMonths } from "date-fns";
import { tzLocalToUtc } from "@/lib/agenda/time-utils";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";
import { sumarDias } from "../fechas";
import type { SabinaCtx } from "../../tipos";
import { crearBase, type BaseDoble, type Datos, type Fila } from "./doble-base";
import type { SqlCrudo } from "./preparar-orto";
import {
  CL_NORTE,
  CL_SUR,
  HOY_N,
  HOY_S,
  TZ_NORTE,
  TZ_SUR,
  U_ADMIN_N,
  U_ADMIN_S,
  U_DOC2_N,
  U_DOC_N,
  datosDePrueba,
} from "./siembra";

export const CL_SIN_MODULO = "cl-sin-modulo";
export const CL_VENCIDA = "cl-vencida";

const DIA_MS = 86_400_000;
const haceDias = (n: number) => new Date(Date.now() - n * DIA_MS);
const enDias = (n: number) => new Date(Date.now() + n * DIA_MS);
const en = (dia: string, hora: number, min: number, tz: string) => tzLocalToUtc(dia, hora, min, tz);

/** Las condiciones de pago de una factura (`invoice_payment_terms`): las lee el módulo por SQL crudo. */
interface Terminos {
  invoiceId: string;
  modo: string;
  metodo: string | null;
  enganche: number;
  numPagos: number;
  frecuencia: string;
  primerPago: string;
  difiereConSuBanco: boolean;
}

function plan(over: Fila): Fila {
  return {
    diagnosisId: `dx-${over.id}`,
    technique: "METAL_BRACKETS",
    techniqueNotes: null,
    estimatedDurationMonths: 24,
    startDate: null,
    installedAt: null,
    prescriptionSlot: null,
    bondingType: null,
    prescriptionNotes: null,
    totalCostMxn: 0,
    status: "IN_PROGRESS",
    statusUpdatedAt: haceDias(200),
    droppedOutAt: null,
    treatingDoctorId: null,
    invoiceId: null,
    billingMode: null,
    createdAt: haceDias(250),
    deletedAt: null,
    ...over,
  };
}

function control(over: Fila): Fila {
  return { type: TIPO_CITA_CONTROL_ORTO, resourceId: null, status: "SCHEDULED", ...over };
}

function hoja(over: Fila): Fila {
  return {
    clinicId: CL_NORTE,
    appointmentId: null,
    controlAppointmentId: null,
    durationMin: 30,
    phaseKey: "LEVELING",
    monthAt: 1,
    wireFromId: null,
    wireToId: null,
    soapS: "",
    soapO: "",
    soapA: "",
    soapP: "",
    hygienePlaquePct: null,
    hygieneGingivitis: null,
    hygieneWhiteSpots: false,
    hasProgressPhoto: false,
    photoSetId: null,
    nextDate: null,
    nextDurationMin: null,
    status: "SIGNED",
    signedAt: over.visitDate ?? null,
    deletedAt: null,
    ...over,
  };
}

function arco(over: Fila): Fila {
  return {
    clinicId: CL_NORTE,
    treatmentPlanId: "plan-ana",
    phaseKey: "ALIGNMENT",
    shape: "ROUND",
    purpose: null,
    archUpper: true,
    archLower: true,
    durationWeeks: 6,
    auxiliaries: [],
    notes: null,
    status: "PLANNED",
    plannedDate: null,
    appliedDate: null,
    completedDate: null,
    ...over,
  };
}

export interface SiembraOrto {
  datos: Datos;
  sql: SqlCrudo;
}

export function datosOrto(): SiembraOrto {
  const d = datosDePrueba();

  d.clinics = [
    ...(d.clinics ?? []),
    { id: CL_SIN_MODULO, timezone: TZ_NORTE, agendaDayStart: 8, agendaDayEnd: 20, category: "DENTAL" },
    { id: CL_VENCIDA, timezone: TZ_NORTE, agendaDayStart: 8, agendaDayEnd: 20, category: "DENTAL" },
  ];
  d.patients = [
    ...(d.patients ?? []),
    {
      id: "p-sin-1", clinicId: CL_SIN_MODULO, firstName: "Nora", lastName: "SINMODULO", status: "ACTIVE",
      visibleUserIds: [], deletedAt: null, dob: null, createdAt: haceDias(90),
    },
  ];

  d.modules = [
    { id: "m-orto", key: "orthodontics" },
    { id: "m-endo", key: "endodontics" },
  ];
  d.clinicModules = [
    { id: "cm-n", clinicId: CL_NORTE, moduleId: "m-orto", status: "active", currentPeriodEnd: enDias(300) },
    { id: "cm-s", clinicId: CL_SUR, moduleId: "m-orto", status: "active", currentPeriodEnd: enDias(300) },
    // Otro módulo, activo: no abre Ortodoncia.
    { id: "cm-sin-endo", clinicId: CL_SIN_MODULO, moduleId: "m-endo", status: "active", currentPeriodEnd: enDias(300) },
    // Lo tuvo y se venció.
    { id: "cm-venc", clinicId: CL_VENCIDA, moduleId: "m-orto", status: "active", currentPeriodEnd: haceDias(3) },
  ];

  d.orthodonticDiagnoses = [
    { id: "dx-plan-ana", clinicId: CL_NORTE, patientId: "p-ana", deletedAt: null, diagnosedAt: haceDias(260), habits: [] },
    // Elías Ruiz ya terminó; Iris solo tiene la valoración, sin plan.
    { id: "dx-iris", clinicId: CL_NORTE, patientId: "p-inact-3", deletedAt: null, diagnosedAt: haceDias(15), habits: [] },
  ];

  d.orthodonticTreatmentPlans = [
    plan({
      id: "plan-ana", clinicId: CL_NORTE, patientId: "p-ana", treatingDoctorId: U_DOC_N,
      installedAt: subMonths(new Date(), 7), estimatedDurationMonths: 24, invoiceId: "inv-orto-ana",
    }),
    plan({
      id: "plan-beto", clinicId: CL_NORTE, patientId: "p-beto", treatingDoctorId: U_DOC_N,
      installedAt: subMonths(new Date(), 2), estimatedDurationMonths: 18,
    }),
    plan({
      id: "plan-carla", clinicId: CL_NORTE, patientId: "p-carla", treatingDoctorId: U_DOC_N, status: "RETENTION",
      installedAt: subMonths(new Date(), 20), estimatedDurationMonths: 18, invoiceId: "inv-orto-carla",
    }),
    plan({
      id: "plan-dora", clinicId: CL_NORTE, patientId: "p-dora", treatingDoctorId: U_DOC2_N, technique: "CLEAR_ALIGNERS",
      installedAt: subMonths(new Date(), 3), estimatedDurationMonths: 12, billingMode: "PAGO_POR_CONTROL",
    }),
    plan({
      id: "plan-elias", clinicId: CL_NORTE, patientId: "p-elias", treatingDoctorId: U_DOC2_N, status: "COMPLETED",
      installedAt: subMonths(new Date(), 30), estimatedDurationMonths: 24, invoiceId: "inv-orto-elias",
    }),
    plan({
      id: "plan-ivan", clinicId: CL_NORTE, patientId: "p-inact-2", treatingDoctorId: U_DOC2_N, status: "DROPPED_OUT",
      installedAt: subMonths(new Date(), 14), estimatedDurationMonths: 24, droppedOutAt: haceDias(200),
    }),
    plan({
      id: "plan-priv", clinicId: CL_NORTE, patientId: "p-priv", treatingDoctorId: U_DOC_N,
      installedAt: subMonths(new Date(), 5), estimatedDurationMonths: 24, invoiceId: "inv-orto-priv",
    }),
    // ── la del sur ──
    plan({
      id: "plan-sur", clinicId: CL_SUR, patientId: "p-sur-1", treatingDoctorId: U_ADMIN_S,
      installedAt: subMonths(new Date(), 4), estimatedDurationMonths: 24, invoiceId: "inv-orto-sur",
    }),
    // ── la sede sin módulo: el caso existe en la base, y no puede salir ──
    plan({
      id: "plan-sin", clinicId: CL_SIN_MODULO, patientId: "p-sin-1",
      installedAt: subMonths(new Date(), 4), estimatedDurationMonths: 24,
    }),
  ];

  d.orthodonticPhases = [
    { id: "ph-ana-1", treatmentPlanId: "plan-ana", phaseKey: "ALIGNMENT", status: "COMPLETED", orderIndex: 0 },
    { id: "ph-ana-2", treatmentPlanId: "plan-ana", phaseKey: "LEVELING", status: "IN_PROGRESS", orderIndex: 1 },
    { id: "ph-ana-3", treatmentPlanId: "plan-ana", phaseKey: "SPACE_CLOSURE", status: "NOT_STARTED", orderIndex: 2 },
    { id: "ph-sur-1", treatmentPlanId: "plan-sur", phaseKey: "FINISHING", status: "IN_PROGRESS", orderIndex: 4 },
  ];

  d.orthoWireSteps = [
    arco({ id: "w-ana-1", orderIndex: 0, material: "NITI", gauge: "0.014", status: "COMPLETED" }),
    arco({ id: "w-ana-2", orderIndex: 1, material: "NITI", shape: "RECT", gauge: "16x22", phaseKey: "LEVELING", status: "COMPLETED" }),
    // El que la secuencia PLANEADA da por activo. El actual de verdad es el
    // último anotado en un control firmado (w-ana-2).
    arco({ id: "w-ana-3", orderIndex: 2, material: "SS", shape: "RECT", gauge: "19x25", phaseKey: "LEVELING", status: "ACTIVE" }),
    arco({ id: "w-sur-1", clinicId: CL_SUR, treatmentPlanId: "plan-sur", orderIndex: 0, material: "TMA", gauge: "ARCO DEL SUR", status: "ACTIVE" }),
  ];

  d.orthoTreatmentCards = [
    hoja({
      id: "h-ana-1", treatmentPlanId: "plan-ana", patientId: "p-ana", cardNumber: 1, visitDate: haceDias(90),
      wireToId: "w-ana-1", hygienePlaquePct: 20, hygieneGingivitis: "LEVE",
    }),
    hoja({
      id: "h-ana-2", treatmentPlanId: "plan-ana", patientId: "p-ana", cardNumber: 2, visitDate: haceDias(60),
      wireFromId: "w-ana-1", wireToId: "w-ana-2", hygienePlaquePct: 30, hygieneGingivitis: "LEVE",
    }),
    // A las 18:30 de Ciudad de México: en UTC ya es el día siguiente.
    hoja({
      id: "h-ana-3", treatmentPlanId: "plan-ana", patientId: "p-ana", cardNumber: 3,
      visitDate: en(sumarDias(HOY_N, -30), 18, 30, TZ_NORTE),
      wireFromId: "w-ana-2", wireToId: "w-ana-2", hygienePlaquePct: 45, hygieneGingivitis: "MODERADA", hygieneWhiteSpots: true,
    }),
    // BORRADOR de hoy: un borrador no es un dato clínico confirmado.
    hoja({
      id: "h-ana-4", treatmentPlanId: "plan-ana", patientId: "p-ana", cardNumber: 4, visitDate: haceDias(0),
      wireFromId: "w-ana-2", wireToId: "w-ana-3", hygienePlaquePct: 5, hygieneGingivitis: "AUSENTE",
      status: "DRAFT", signedAt: null, appointmentId: "c-ana-hoy",
    }),
    hoja({
      id: "h-dora-1", treatmentPlanId: "plan-dora", patientId: "p-dora", cardNumber: 1, visitDate: haceDias(0),
      appointmentId: "c-dora-hoy", hygienePlaquePct: 10, hygieneGingivitis: "AUSENTE",
    }),
    hoja({
      id: "h-sur-1", clinicId: CL_SUR, treatmentPlanId: "plan-sur", patientId: "p-sur-1", cardNumber: 1,
      visitDate: haceDias(10), wireToId: "w-sur-1", hygienePlaquePct: 99, hygieneGingivitis: "SEVERA",
    }),
  ];
  d.orthoCardElastics = [
    { id: "e-ana-1", cardId: "h-ana-1", clinicId: CL_NORTE, elasticClass: "CLASE_II", config: "3/16 6oz", zone: "BILATERAL" },
  ];

  d.orthodonticAligners = [
    {
      id: "al-dora", treatmentPlanId: "plan-dora", patientId: "p-dora", clinicId: CL_NORTE, systemName: "Invisalign",
      totalTrays: 20, currentTray: 3, changeIntervalDays: 14, startedAt: haceDias(70), status: "ACTIVE", deletedAt: null,
    },
    {
      id: "al-sur", treatmentPlanId: "plan-sur", patientId: "p-sur-1", clinicId: CL_SUR, systemName: "ALINEADOR DEL SUR",
      totalTrays: 99, currentTray: 98, changeIntervalDays: 14, startedAt: haceDias(70), status: "ACTIVE", deletedAt: null,
    },
  ];

  d.appointments = [
    ...(d.appointments ?? []),
    // ── HOY en la del norte ──
    control({ id: "c-ana-hoy", clinicId: CL_NORTE, patientId: "p-ana", doctorId: U_DOC_N, status: "CONFIRMED", startsAt: en(HOY_N, 10, 0, TZ_NORTE), endsAt: en(HOY_N, 10, 30, TZ_NORTE) }),
    control({ id: "c-dora-hoy", clinicId: CL_NORTE, patientId: "p-dora", doctorId: U_DOC2_N, status: "COMPLETED", startsAt: en(HOY_N, 12, 0, TZ_NORTE), endsAt: en(HOY_N, 12, 30, TZ_NORTE) }),
    control({ id: "c-priv-hoy", clinicId: CL_NORTE, patientId: "p-priv", doctorId: U_DOC_N, status: "CONFIRMED", startsAt: en(HOY_N, 16, 0, TZ_NORTE), endsAt: en(HOY_N, 16, 30, TZ_NORTE) }),
    control({ id: "c-elias-hoy", clinicId: CL_NORTE, patientId: "p-elias", doctorId: U_DOC2_N, status: "CANCELLED", startsAt: en(HOY_N, 17, 0, TZ_NORTE), endsAt: en(HOY_N, 17, 30, TZ_NORTE) }),
    // ── los próximos días ──
    control({ id: "c-carla-3d", clinicId: CL_NORTE, patientId: "p-carla", doctorId: U_DOC_N, startsAt: en(sumarDias(HOY_N, 3), 9, 0, TZ_NORTE), endsAt: en(sumarDias(HOY_N, 3), 9, 30, TZ_NORTE) }),
    // Cada paciente con control hoy tiene además el siguiente, para que «sin
    // control» no dependa de la hora a la que corra la prueba.
    control({ id: "c-ana-28d", clinicId: CL_NORTE, patientId: "p-ana", doctorId: U_DOC_N, startsAt: en(sumarDias(HOY_N, 28), 10, 0, TZ_NORTE), endsAt: en(sumarDias(HOY_N, 28), 10, 30, TZ_NORTE) }),
    control({ id: "c-dora-30d", clinicId: CL_NORTE, patientId: "p-dora", doctorId: U_DOC2_N, startsAt: en(sumarDias(HOY_N, 30), 12, 0, TZ_NORTE), endsAt: en(sumarDias(HOY_N, 30), 12, 30, TZ_NORTE) }),
    control({ id: "c-priv-10d", clinicId: CL_NORTE, patientId: "p-priv", doctorId: U_DOC_N, startsAt: en(sumarDias(HOY_N, 10), 16, 0, TZ_NORTE), endsAt: en(sumarDias(HOY_N, 10), 16, 30, TZ_NORTE) }),
    // ── el pasado ──
    control({ id: "c-ana-30", clinicId: CL_NORTE, patientId: "p-ana", doctorId: U_DOC_N, status: "COMPLETED", startsAt: haceDias(30), endsAt: haceDias(30) }),
    control({ id: "c-beto-60", clinicId: CL_NORTE, patientId: "p-beto", doctorId: U_DOC_N, status: "COMPLETED", startsAt: haceDias(60), endsAt: haceDias(60) }),
    control({ id: "c-beto-20", clinicId: CL_NORTE, patientId: "p-beto", doctorId: U_DOC_N, status: "NO_SHOW", startsAt: haceDias(20), endsAt: haceDias(20) }),
    // ── la del sur ──
    control({ id: "c-sur-hoy", clinicId: CL_SUR, patientId: "p-sur-1", doctorId: U_ADMIN_S, status: "CONFIRMED", startsAt: en(HOY_S, 11, 0, TZ_SUR), endsAt: en(HOY_S, 11, 30, TZ_SUR) }),
  ];

  d.invoices = [
    ...(d.invoices ?? []),
    { id: "inv-orto-ana", clinicId: CL_NORTE, patientId: "p-ana", status: "PARTIAL", total: 25000, paid: 9000, balance: 16000, discount: 0, dueDate: null, createdAt: haceDias(110), items: [] },
    { id: "inv-orto-carla", clinicId: CL_NORTE, patientId: "p-carla", status: "PAID", total: 12000, paid: 12000, balance: 0, discount: 0, dueDate: null, createdAt: haceDias(600), items: [] },
    { id: "inv-orto-elias", clinicId: CL_NORTE, patientId: "p-elias", status: "PAID", total: 6000, paid: 6000, balance: 0, discount: 0, dueDate: null, createdAt: haceDias(900), items: [] },
    { id: "inv-orto-priv", clinicId: CL_NORTE, patientId: "p-priv", status: "PENDING", total: 10000, paid: 0, balance: 10000, discount: 0, dueDate: null, createdAt: haceDias(80), items: [] },
    // Los controles de Dora (pago por control): uno pagado y uno vencido.
    { id: "inv-ctl-dora-1", clinicId: CL_NORTE, patientId: "p-dora", status: "PAID", total: 800, paid: 800, balance: 0, discount: 0, dueDate: haceDias(40), createdAt: haceDias(40), invoiceNumber: "MF-0801", appointmentId: "c-dora-viejo-1", orthodonticTreatmentPlanId: "plan-dora", items: [] },
    { id: "inv-ctl-dora-2", clinicId: CL_NORTE, patientId: "p-dora", status: "PENDING", total: 800, paid: 0, balance: 800, discount: 0, dueDate: haceDias(10), createdAt: haceDias(10), invoiceNumber: "MF-0802", appointmentId: "c-dora-viejo-2", orthodonticTreatmentPlanId: "plan-dora", items: [] },
    { id: "inv-orto-sur", clinicId: CL_SUR, patientId: "p-sur-1", status: "PENDING", total: 99999, paid: 0, balance: 99999, discount: 0, dueDate: null, createdAt: haceDias(80), items: [] },
  ];
  d.appointments.push(
    control({ id: "c-dora-viejo-1", clinicId: CL_NORTE, patientId: "p-dora", doctorId: U_DOC2_N, status: "COMPLETED", startsAt: haceDias(40), endsAt: haceDias(40) }),
    control({ id: "c-dora-viejo-2", clinicId: CL_NORTE, patientId: "p-dora", doctorId: U_DOC2_N, status: "COMPLETED", startsAt: haceDias(10), endsAt: haceDias(10) }),
  );

  d.payments = [
    ...(d.payments ?? []),
    { id: "pay-orto-ana-0", invoiceId: "inv-orto-ana", amount: 5000, method: "cash", paidAt: haceDias(105) },
    { id: "pay-orto-ana-1", invoiceId: "inv-orto-ana", amount: 2000, method: "transfer", paidAt: haceDias(70) },
    { id: "pay-orto-ana-2", invoiceId: "inv-orto-ana", amount: 2000, method: "transfer", paidAt: haceDias(0) },
    { id: "pay-orto-elias", invoiceId: "inv-orto-elias", amount: 6000, method: "cash", paidAt: haceDias(800) },
    { id: "pay-orto-carla", invoiceId: "inv-orto-carla", amount: 12000, method: "cash", paidAt: haceDias(590) },
    { id: "pay-orto-sur", invoiceId: "inv-orto-sur", amount: 1, method: "cash", paidAt: haceDias(0) },
  ];

  const aFecha = (f: Date) => f.toISOString().slice(0, 10);
  const terminos: Terminos[] = [
    { invoiceId: "inv-orto-ana", modo: "plazos", metodo: null, enganche: 5000, numPagos: 10, frecuencia: "MONTHLY", primerPago: aFecha(haceDias(105)), difiereConSuBanco: false },
    { invoiceId: "inv-orto-carla", modo: "plazos", metodo: null, enganche: 2000, numPagos: 10, frecuencia: "MONTHLY", primerPago: aFecha(haceDias(600)), difiereConSuBanco: false },
    { invoiceId: "inv-orto-elias", modo: "plazos", metodo: null, enganche: 0, numPagos: 3, frecuencia: "MONTHLY", primerPago: aFecha(haceDias(900)), difiereConSuBanco: false },
    { invoiceId: "inv-orto-priv", modo: "plazos", metodo: null, enganche: 0, numPagos: 5, frecuencia: "MONTHLY", primerPago: aFecha(haceDias(75)), difiereConSuBanco: false },
    { invoiceId: "inv-orto-sur", modo: "plazos", metodo: null, enganche: 0, numPagos: 1, frecuencia: "MONTHLY", primerPago: aFecha(haceDias(75)), difiereConSuBanco: false },
  ];

  return { datos: d, sql: sqlDe(d, terminos) };
}

/** La lista que viaja en un `Prisma.join(ids)`, o el valor suelto. */
function listaDe(valor: unknown): string[] {
  const v = valor as { values?: unknown[] } | unknown[] | string | null;
  if (Array.isArray(v)) return v.map(String);
  if (v && typeof v === "object" && Array.isArray((v as { values?: unknown[] }).values)) {
    return (v as { values: unknown[] }).values.map(String);
  }
  return v == null ? [] : [String(v)];
}

/**
 * Las cuatro consultas en SQL crudo del módulo, contestadas desde la siembra.
 * Cada una filtra por el `clinicId` que LLEGA en la consulta: si un cargador
 * mandara el de otra clínica (o ninguno), devolvería las filas de esa otra.
 */
function sqlDe(d: Datos, terminos: Terminos[]): SqlCrudo {
  return (texto, valores) => {
    if (/information_schema\.columns/.test(texto) || /to_regclass/.test(texto)) return [{ existe: true }];
    const clinicId = String(valores[0] ?? "");
    const ids = listaDe(valores[1]);

    if (/"invoice_payment_terms"/.test(texto)) {
      const deLaClinica = new Set((d.invoices ?? []).filter((i) => i.clinicId === clinicId).map((i) => i.id));
      return terminos
        .filter((t) => ids.includes(t.invoiceId) && deLaClinica.has(t.invoiceId))
        .map((t) => ({ ...t, primerPago: new Date(`${t.primerPago}T00:00:00Z`) }));
    }
    if (/"orthodonticTreatmentPlanId"/.test(texto)) {
      const controles = new Set(
        (d.appointments ?? []).filter((a) => a.type === TIPO_CITA_CONTROL_ORTO).map((a) => a.id),
      );
      return (d.invoices ?? [])
        .filter(
          (i) =>
            i.clinicId === clinicId &&
            ids.includes(i.orthodonticTreatmentPlanId) &&
            i.appointmentId &&
            controles.has(i.appointmentId),
        )
        .map((i) => ({
          planId: i.orthodonticTreatmentPlanId,
          invoiceId: i.id,
          invoiceNumber: i.invoiceNumber ?? null,
          total: i.total,
          paid: i.paid,
          status: i.status,
          dueDate: i.dueDate ?? null,
          createdAt: i.createdAt,
        }));
    }
    if (/"billingMode"/.test(texto)) {
      return (d.orthodonticTreatmentPlans ?? [])
        .filter((p) => p.clinicId === clinicId && ids.includes(p.id))
        .map((p) => ({ id: p.id, billingMode: p.billingMode ?? null }));
    }
    throw new Error(`SQL crudo no previsto en la siembra de ortodoncia: ${texto.slice(0, 120)}`);
  };
}

/* ── la base y las sesiones ──────────────────────────────────────────── */

export function baseOrto(): { db: BaseDoble; sql: SqlCrudo; datos: Datos } {
  const s = datosOrto();
  return { db: crearBase(s.datos), sql: s.sql, datos: s.datos };
}

export function sesion(db: BaseDoble, over: Partial<SabinaCtx> = {}): SabinaCtx {
  return {
    clinicId: CL_NORTE,
    userId: U_ADMIN_N,
    role: "ADMIN",
    permissionsOverride: [],
    timezone: TZ_NORTE,
    clinicCategory: "DENTAL",
    clinicaNombre: "Clínica Norte",
    db,
    ...over,
  };
}
