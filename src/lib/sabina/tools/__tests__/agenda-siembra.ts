/**
 * Siembra de las acciones de agenda (WS1-T2) — una clínica con agenda de verdad
 * y una vecina que chilla si se cuela.
 *
 * Reusa el evaluador de `where` de `./doble-base` (el que se comporta como
 * Prisma con `clinicId: undefined`), y le añade lo que las acciones leen y las
 * diez herramientas de lectura no: `user`, `resourceSchedule` y
 * `whatsAppReminder`. Esos tres delegados salen de instancias auxiliares del
 * mismo doble —se siembra la tabla en la ranura `resources` y se toma su
 * delegado—: es el mismo evaluador, sin copiarlo.
 *
 * 🔴 Y la base va envuelta en un ESPÍA: cualquier operación que no sea de
 * lectura LANZA y queda apuntada. Es lo que permite demostrar —y no suponer—
 * que las acciones proponen y no escriben.
 *
 * Todas las fechas son relativas a hoy, en la hora local de la clínica.
 */

import { todayInTz, tzLocalToUtc } from "@/lib/agenda/time-utils";
import { scheduleDayOfISO } from "@/lib/agenda/clinic-hours";
import { sumarDias } from "../fechas";
import type { SabinaCtx } from "../../tipos";
import { crearBase, type Fila } from "./doble-base";

export const CL_A = "cl-agenda";
export const CL_B = "cl-vecina";
export const TZ_A = "America/Mexico_City";

export const U_ADMIN = "u-admin";
export const U_DOC1 = "u-doc-hugo";
export const U_DOC2 = "u-doc-nadia";
export const U_RECEP = "u-recep";
export const U_DUENO = "u-dueno";
export const U_READONLY = "u-lectura";
export const U_DOC_B = "u-doc-vecina";

export const HOY = todayInTz(TZ_A);

/** El primer día (desde hoy+2) que cae en uno de estos días de semana (0=lunes … 6=domingo). */
function proximo(dias: number[]): string {
  for (let i = 2; i < 16; i++) {
    const f = sumarDias(HOY, i);
    if (dias.includes(scheduleDayOfISO(f, TZ_A))) return f;
  }
  throw new Error("no hay día de prueba");
}

/** Un martes, miércoles o jueves futuro: la clínica abre 09:00–18:00. */
export const DIA = proximo([1, 2, 3]);
/** Un domingo futuro: la clínica cierra. */
export const DOMINGO = proximo([6]);

export function en(dia: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return tzLocalToUtc(dia, h, m, TZ_A);
}

function paciente(over: Fila): Fila {
  return { status: "ACTIVE", visibleUserIds: [], deletedAt: null, phone: null, email: null, ...over };
}

function cita(over: Fila & { dia: string; de: string; a: string }): Fila {
  const { dia, de, a, ...resto } = over;
  return {
    clinicId: CL_A,
    resourceId: null,
    type: "Consulta",
    overrideReason: null,
    googleCalendarEventId: null,
    startsAt: en(dia, de),
    endsAt: en(dia, a),
    ...resto,
  };
}

export interface OpcionesSiembra {
  /** La clínica trabaja con sillones (recursos activos). */
  sillones?: boolean;
  /** Google Calendar conectado. */
  google?: boolean;
  /**
   * Bloqueos de agenda vigentes (WS1-T2). Vacío por defecto: la mayoría de
   * las pruebas de agenda no van de bloqueos y no tienen que enterarse de que
   * existen. Las filas llevan la forma de `agenda_blocks`: `doctorId` en null
   * = toda la clínica.
   */
  bloqueos?: Fila[];
}

export function datosAgenda(op: OpcionesSiembra = {}) {
  const clinics: Fila[] = [
    {
      id: CL_A, timezone: TZ_A, agendaDayStart: 8, agendaDayEnd: 20, defaultSlotMinutes: 30,
      category: "DENTAL", googleCalendarEnabled: !!op.google,
    },
    {
      id: CL_B, timezone: TZ_A, agendaDayStart: 8, agendaDayEnd: 20, defaultSlotMinutes: 30,
      category: "DENTAL", googleCalendarEnabled: false,
    },
  ];

  // Ajustes: L-V 09:00-18:00, sábado 09:00-13:00, domingo cerrado. 0 = lunes.
  const clinicSchedules: Fila[] = [0, 1, 2, 3, 4].map((d) => ({
    clinicId: CL_A, dayOfWeek: d, enabled: true, openTime: "09:00", closeTime: "18:00",
  }));
  clinicSchedules.push({ clinicId: CL_A, dayOfWeek: 5, enabled: true, openTime: "09:00", closeTime: "13:00" });
  clinicSchedules.push({ clinicId: CL_A, dayOfWeek: 6, enabled: false, openTime: "09:00", closeTime: "13:00" });

  const users: Fila[] = [
    { id: U_ADMIN, clinicId: CL_A, role: "ADMIN", firstName: "Rita", lastName: "Admin", isActive: true },
    { id: U_DOC1, clinicId: CL_A, role: "DOCTOR", firstName: "Hugo", lastName: "Salas", isActive: true },
    { id: U_DOC2, clinicId: CL_A, role: "DOCTOR", firstName: "Nadia", lastName: "Rojas", isActive: true },
    { id: "u-doc-baja", clinicId: CL_A, role: "DOCTOR", firstName: "Pablo", lastName: "Viejo", isActive: false },
    { id: U_RECEP, clinicId: CL_A, role: "RECEPTIONIST", firstName: "Lupe", lastName: "Mesa", isActive: true },
    { id: U_DUENO, clinicId: CL_A, role: "SUPER_ADMIN", firstName: "Rafael", lastName: "Dueño", isActive: true },
    { id: U_READONLY, clinicId: CL_A, role: "READONLY", firstName: "Leo", lastName: "Lector", isActive: true },
    { id: U_DOC_B, clinicId: CL_B, role: "DOCTOR", firstName: "Hugo", lastName: "Vecino", isActive: true },
  ];

  const patients: Fila[] = [
    paciente({ id: "p-mg1", clinicId: CL_A, firstName: "María", lastName: "García", patientNumber: "P0001", phone: "+52 55 1111 2222", email: "mg1@correo.mx" }),
    paciente({ id: "p-mg2", clinicId: CL_A, firstName: "María", lastName: "García", patientNumber: "P0002", phone: "5533334444" }),
    paciente({ id: "p-juan", clinicId: CL_A, firstName: "Juan", lastName: "Pérez", patientNumber: "P0003", phone: "5599990000", email: "juan@correo.mx" }),
    paciente({ id: "p-arch", clinicId: CL_A, firstName: "Octavio", lastName: "Archivado", patientNumber: "P0004", status: "ARCHIVED" }),
    // Restringida a la Dra. Rojas: recepción y el Dr. Salas no la ven.
    paciente({ id: "p-restr", clinicId: CL_A, firstName: "Renata", lastName: "Reservada", patientNumber: "P0005", visibleUserIds: [U_DOC2] }),
    paciente({ id: "p-borrada", clinicId: CL_A, firstName: "Berta", lastName: "Borrada", patientNumber: "P0006", deletedAt: new Date() }),
    // La vecina tiene OTRA María García: jamás puede salir en la clínica A.
    paciente({ id: "p-mg-vecina", clinicId: CL_B, firstName: "María", lastName: "García", patientNumber: "V9999", phone: "9990009999" }),
  ];

  const appointments: Fila[] = [
    // El Dr. Salas, el DIA: 10:00-10:30 con Juan y 12:00-13:00 con la restringida.
    cita({ id: "a-juan-10", patientId: "p-juan", doctorId: U_DOC1, status: "SCHEDULED", dia: DIA, de: "10:00", a: "10:30", googleCalendarEventId: "gcal-1" }),
    cita({ id: "a-restr-12", patientId: "p-restr", doctorId: U_DOC1, status: "CONFIRMED", dia: DIA, de: "12:00", a: "13:00" }),
    // La Dra. Rojas, el DIA.
    cita({ id: "a-mg1-11", patientId: "p-mg1", doctorId: U_DOC2, status: "CONFIRMED", dia: DIA, de: "11:00", a: "11:45" }),
    cita({ id: "a-juan-curso", patientId: "p-juan", doctorId: U_DOC2, status: "IN_PROGRESS", dia: DIA, de: "15:00", a: "15:30" }),
    cita({ id: "a-juan-cancel", patientId: "p-juan", doctorId: U_DOC2, status: "CANCELLED", dia: DIA, de: "16:00", a: "16:30" }),
    // Una cancelada NO ocupa: el hueco de las 17:00 del Dr. Salas está libre.
    cita({ id: "a-mg2-cancel", patientId: "p-mg2", doctorId: U_DOC1, status: "CANCELLED", dia: DIA, de: "17:00", a: "17:30" }),
    // Pasada y completada.
    cita({ id: "a-juan-pasada", patientId: "p-juan", doctorId: U_DOC1, status: "COMPLETED", dia: sumarDias(HOY, -3), de: "09:00", a: "09:30" }),
    // La vecina: el Dr. Vecino ocupado a las 09:00 del DIA (no debe tapar nada en A).
    cita({ id: "a-vecina", clinicId: CL_B, patientId: "p-mg-vecina", doctorId: U_DOC_B, status: "SCHEDULED", dia: DIA, de: "09:00", a: "18:00" }),
  ];

  const resources: Fila[] = [
    { id: "r-vecina", clinicId: CL_B, name: "Sillón VECINO", isActive: true, orderIndex: 0 },
  ];
  const resourceSchedules: Fila[] = [];
  if (op.sillones) {
    resources.push(
      { id: "r-1", clinicId: CL_A, name: "Sillón 1", isActive: true, orderIndex: 0 },
      { id: "r-2", clinicId: CL_A, name: "Sillón 2", isActive: true, orderIndex: 1 },
      { id: "r-baja", clinicId: CL_A, name: "Sillón de baja", isActive: false, orderIndex: 2 },
    );
    // El Sillón 2 solo trabaja por la mañana, de lunes a viernes.
    for (const d of [0, 1, 2, 3, 4]) {
      resourceSchedules.push({ resourceId: "r-2", dayOfWeek: d, startTime: "09:00", endTime: "12:00" });
    }
    // A las 14:00 del DIA el Sillón 1 lo ocupa la Dra. Rojas.
    appointments.push(
      cita({ id: "a-sillon1-14", patientId: "p-mg1", doctorId: U_DOC2, resourceId: "r-1", status: "SCHEDULED", dia: DIA, de: "14:00", a: "14:30" }),
    );
  }

  const whatsAppReminders: Fila[] = [
    // A Juan ya le salió el recordatorio de su cita de las 10:00.
    { id: "w-1", clinicId: CL_A, appointmentId: "a-juan-10", status: "SENT" },
  ];

  // WS1-T2 — la tabla de bloqueos. Tiene que EXISTIR en el doble aunque esté
  // vacía: `leerOcupacion` la consulta siempre, y un doble que no la declara
  // se lleva por delante toda la agenda de Sabina con un
  // «Cannot read properties of undefined (reading 'findMany')».
  const agendaBlocks: Fila[] = op.bloqueos ?? [];

  return { clinics, clinicSchedules, users, patients, appointments, resources, resourceSchedules, whatsAppReminders, agendaBlocks };
}

/* ── el espía ─────────────────────────────────────────────────────────── */

const LECTURAS = new Set(["findMany", "findFirst", "findUnique", "count", "groupBy", "aggregate"]);

export interface Espia {
  /** Cada operación pedida, en orden: "appointment.findMany", "$queryRaw"… */
  llamadas: string[];
  /** Las que NO eran de lectura. Tiene que quedar vacío siempre. */
  escrituras: string[];
}

export type BaseAgenda = Record<string, any> & { espia: Espia; filas: ReturnType<typeof datosAgenda> };

export function baseAgenda(op: OpcionesSiembra = {}): BaseAgenda {
  const filas = datosAgenda(op);
  const principal = crearBase({
    clinics: filas.clinics,
    clinicSchedules: filas.clinicSchedules,
    users: filas.users,
    patients: filas.patients,
    appointments: filas.appointments,
    resources: filas.resources,
  }) as Record<string, any>;
  // Mismo evaluador de `where`, sembrado en la ranura `resources`.
  const delegadoDe = (rows: Fila[]) => (crearBase({ resources: rows }) as Record<string, any>).resource;
  const modelos: Record<string, any> = {
    appointment: principal.appointment,
    patient: principal.patient,
    clinic: principal.clinic,
    clinicSchedule: principal.clinicSchedule,
    resource: principal.resource,
    user: delegadoDe(filas.users),
    resourceSchedule: delegadoDe(filas.resourceSchedules),
    whatsAppReminder: delegadoDe(filas.whatsAppReminders),
    agendaBlock: delegadoDe(filas.agendaBlocks),
  };

  const espia: Espia = { llamadas: [], escrituras: [] };
  const db: Record<string, any> = { espia, filas };
  for (const [modelo, delegado] of Object.entries(modelos)) {
    db[modelo] = new Proxy(
      {},
      {
        get(_t, op: string) {
          return (...args: unknown[]) => {
            espia.llamadas.push(`${modelo}.${op}`);
            if (!LECTURAS.has(op)) {
              espia.escrituras.push(`${modelo}.${op}`);
              throw new Error(`ESCRITURA PROHIBIDA: ${modelo}.${op}`);
            }
            return delegado[op](...args);
          };
        },
      },
    );
  }
  db.$queryRaw = async (q: unknown) => {
    espia.llamadas.push("$queryRaw");
    return principal.$queryRaw(q);
  };
  for (const prohibida of ["$transaction", "$executeRaw", "$executeRawUnsafe", "$queryRawUnsafe"]) {
    db[prohibida] = () => {
      espia.escrituras.push(prohibida);
      throw new Error(`ESCRITURA PROHIBIDA: ${prohibida}`);
    };
  }
  return db as BaseAgenda;
}

/* ── sesiones ─────────────────────────────────────────────────────────── */

export function sesion(db: BaseAgenda, over: Partial<SabinaCtx> = {}): SabinaCtx {
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

export const recepcion = (db: BaseAgenda) => sesion(db);
export const admin = (db: BaseAgenda) => sesion(db, { userId: U_ADMIN, role: "ADMIN" });
export const drSalas = (db: BaseAgenda) => sesion(db, { userId: U_DOC1, role: "DOCTOR" });
export const draRojas = (db: BaseAgenda) => sesion(db, { userId: U_DOC2, role: "DOCTOR" });
export const lector = (db: BaseAgenda) => sesion(db, { userId: U_READONLY, role: "READONLY", permissionsOverride: ["agenda.view", "agenda.create", "agenda.edit", "agenda.delete"] });
export const conKeys = (db: BaseAgenda, keys: string[]) => sesion(db, { permissionsOverride: keys });
