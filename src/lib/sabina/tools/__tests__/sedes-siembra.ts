/**
 * CUATRO CLÍNICAS Y TRES PERSONAS — el instrumento con el que se demuestra que
 * comparar sedes no enseña la sede de nadie más.
 *
 * Se monta ENCIMA de `datosDePrueba()` (siembra.ts) en vez de tocarlo: las dos
 * clínicas de siempre siguen siendo las de siempre, con sus mismas cifras, y
 * aquí solo se AÑADE lo que esta tarea necesita —quién es quién y dos clínicas
 * más—. Así ninguna de las otras pruebas del catálogo cambia de resultado.
 *
 * ── EL REPARTO ─────────────────────────────────────────────────────────
 *
 *   CL_NORTE  «Local Altabrisa»   Rafael tiene ficha ACTIVA     → SÍ la ve
 *   CL_SUR    «Centro»            Rafael tiene ficha ACTIVA     → SÍ la ve
 *   CL_EXSEDE «SEDE CERRADA»      Rafael tiene ficha DESACTIVADA→ NO la ve
 *   CL_AJENA  «CLINICA AJENA SA»  otro cliente, sin relación    → NO la ve
 *   CL_VENCIDA«SEDE VENCIDA»      suya, pero con el PLAN VENCIDO→ NO se mira
 *                                  (opt-in: `{ conSedeVencida: true }`)
 *
 * Y tres personas, porque el derecho es de la PERSONA y no de la clínica:
 *
 *   SB_RAFA   fichas en NORTE y SUR (y una muerta en EXSEDE) → compara dos
 *   SB_LUPE   recepción, ficha SOLO en NORTE                 → compara una
 *   SB_AJENO  el otro cliente, ficha SOLO en AJENA           → compara una
 *
 * Lupe es la prueba de que la sede hermana no se hereda del jefe: CL_SUR es
 * sede hermana de la suya, su jefe la ve, y ella no, porque no tiene ficha allí.
 *
 * ── LOS NÚMEROS CHILLAN ────────────────────────────────────────────────
 * Lo de CL_AJENA y CL_EXSEDE está puesto con cifras imposibles (777777,
 * 888888…) y apellidos en mayúsculas. Una fuga no se puede confundir con un
 * dato propio: o sale el número absurdo, o no sale.
 */

import { todayInTz, tzLocalToUtc } from "@/lib/agenda/time-utils";
import { sumarDias } from "../fechas";
import type { SabinaCtx } from "../../tipos";
import { crearBase, type BaseDoble, type Datos, type Fila } from "./doble-base";
import {
  CL_NORTE,
  CL_SUR,
  TZ_NORTE,
  TZ_SUR,
  U_ADMIN_N,
  U_ADMIN_S,
  U_DOC_N,
  U_DOC2_N,
  U_RECEP_N,
  datosDePrueba,
} from "./siembra";

/* ── quién es quién (el `supabaseId`, que es lo que une sedes) ────────── */

export const SB_RAFA = "sb-rafael";
export const SB_LUPE = "sb-lupe";
export const SB_AJENO = "sb-ajeno";
export const SB_SARA = "sb-sara";

/* ── las dos clínicas que añade esta tarea ────────────────────────────── */

/** La sede de la que a Rafael le desactivaron la ficha. Existe, y no es suya ya. */
export const CL_EXSEDE = "cl-exsede";
/** Otro cliente de DaleControl. Ninguna relación con las de Rafael. */
export const CL_AJENA = "cl-ajena";
/**
 * Sede propia de Rafael con el PLAN VENCIDO. Ficha activa y todo, pero hoy el
 * panel no la deja abrir (`isPlanExpired` → /dashboard/suspended), así que
 * tampoco se compara. Opt-in: solo la siembra quien la prueba.
 */
export const CL_VENCIDA = "cl-vencida";

export const TZ_EXSEDE = "America/Monterrey";
export const TZ_VENCIDA = "America/Merida";
export const TZ_AJENA = "America/Tijuana";

/** Fichas nuevas. Una por (persona, sede). */
export const U_RAFA_S = "u-rafa-sur";
export const U_RAFA_EX = "u-rafa-exsede";
export const U_AJENO = "u-ajeno";
export const U_RAFA_V = "u-rafa-vencida";

/* ── los nombres, que es lo que se enseña (nunca un id) ───────────────── */

export const NOMBRE_NORTE = "Local Altabrisa";
export const NOMBRE_SUR = "Centro";
export const NOMBRE_EXSEDE = "SEDE CERRADA";
export const NOMBRE_AJENA = "CLINICA AJENA SA";
export const NOMBRE_VENCIDA = "SEDE VENCIDA";

/**
 * Las cifras de las dos clínicas prohibidas. Si alguna aparece en una respuesta,
 * hay fuga: ninguna clínica real factura 777777 pesos.
 */
export const CIFRAS_PROHIBIDAS = [777777, 666666, 888888, 555555];

/** Lo de la sede con el plan vencido. Tampoco puede salir en una comparación. */
export const CIFRAS_VENCIDA = [444444, 333333];

/** Citas de Rafael EN CENTRO, para medir el recorte de rol DOCTOR de esa ficha. */
export const CITAS_DE_RAFA_EN_SUR = 3;
export const AUSENCIAS_DE_RAFA_EN_SUR = 2;

const HOY_N = todayInTz(TZ_NORTE);

function en(dia: string, hora: number, min: number, tz: string): Date {
  return tzLocalToUtc(dia, hora, min, tz);
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

/** A qué persona pertenece cada ficha de la siembra de siempre. */
const IDENTIDAD: Record<string, string> = {
  [U_ADMIN_N]: SB_RAFA,
  [U_RECEP_N]: SB_LUPE,
  [U_DOC_N]: "sb-hugo",
  [U_DOC2_N]: "sb-nadia",
  // Sara es otra persona con ficha en CL_SUR. Que Rafael también tenga ficha
  // allí no la convierte a ella en dueña de nada del norte.
  [U_ADMIN_S]: SB_SARA,
};

/** Nombre y zona de las dos clínicas de siempre (la siembra no les pone nombre). */
const NOMBRES: Record<string, { name: string; timezone: string }> = {
  [CL_NORTE]: { name: NOMBRE_NORTE, timezone: TZ_NORTE },
  [CL_SUR]: { name: NOMBRE_SUR, timezone: TZ_SUR },
};

/**
 * La siembra de siempre + identidades + las dos clínicas prohibidas.
 *
 * `opciones.sabinaUserPermissions` deja sembrar el recorte que el Super Admin de
 * UNA sede le puso a Sabina para UNA ficha: es lo que prueba que el recorte de
 * la sede hermana se aplica con la ficha de allí y no con la de aquí.
 */
export interface OpcionesSiembra {
  sabinaUserPermissions?: Fila[];
  /** Añade `CL_VENCIDA`: sede propia de Rafael con el plan vencido. */
  conSedeVencida?: boolean;
}

export function datosDeSedes(opciones: OpcionesSiembra = {}): Datos {
  const d = datosDePrueba();

  const clinics: Fila[] = [
    ...(d.clinics ?? []).map((c) => ({ ...c, ...(NOMBRES[c.id] ?? {}) })),
    { id: CL_EXSEDE, name: NOMBRE_EXSEDE, timezone: TZ_EXSEDE, agendaDayStart: 8, agendaDayEnd: 20, category: "DENTAL" },
    { id: CL_AJENA, name: NOMBRE_AJENA, timezone: TZ_AJENA, agendaDayStart: 8, agendaDayEnd: 20, category: "DENTAL" },
    ...(opciones.conSedeVencida
      ? [
          {
            id: CL_VENCIDA, name: NOMBRE_VENCIDA, timezone: TZ_VENCIDA,
            agendaDayStart: 8, agendaDayEnd: 20, category: "DENTAL",
            // Lo que mira `isPlanExpired`: periodo terminado y sin suscripción viva.
            trialEndsAt: hace(40), subscriptionStatus: null,
          },
        ]
      : []),
  ];

  const users: Fila[] = [
    ...(d.users ?? []).map((u) => ({ ...u, supabaseId: IDENTIDAD[u.id] ?? `sb-${u.id}` })),
    // Rafael en la sede hermana: ficha ACTIVA, así que sí la ve.
    {
      id: U_RAFA_S, clinicId: CL_SUR, supabaseId: SB_RAFA, role: "ADMIN",
      firstName: "Rafael", lastName: "Centro", isActive: true, permissionsOverride: [],
    },
    // 🔴 Rafael en la sede que ya no es suya: MISMA persona, MISMA fila, pero
    // `isActive: false`. Si alguien olvidara ese filtro, esta sede se colaría.
    {
      id: U_RAFA_EX, clinicId: CL_EXSEDE, supabaseId: SB_RAFA, role: "SUPER_ADMIN",
      firstName: "Rafael", lastName: "Exsede", isActive: false, permissionsOverride: [],
    },
    // El otro cliente. Ninguna fila lo relaciona con Rafael.
    {
      id: U_AJENO, clinicId: CL_AJENA, supabaseId: SB_AJENO, role: "SUPER_ADMIN",
      firstName: "Otro", lastName: "CLIENTE", isActive: true, permissionsOverride: [],
    },
    ...(opciones.conSedeVencida
      ? [
          {
            id: U_RAFA_V, clinicId: CL_VENCIDA, supabaseId: SB_RAFA, role: "SUPER_ADMIN",
            firstName: "Rafael", lastName: "Vencida", isActive: true, permissionsOverride: [],
          },
        ]
      : []),
  ];

  const patients: Fila[] = [
    ...(d.patients ?? []),
    paciente({ id: "p-ajena-1", clinicId: CL_AJENA, firstName: "Ana", lastName: "AJENA", patientNumber: "X0001", createdAt: hace(3) }),
    paciente({ id: "p-ajena-2", clinicId: CL_AJENA, firstName: "Beto", lastName: "AJENA", patientNumber: "X0002", createdAt: hace(4) }),
    paciente({ id: "p-ex-1", clinicId: CL_EXSEDE, firstName: "Eva", lastName: "EXSEDE", patientNumber: "E0001", createdAt: hace(3) }),
    ...(opciones.conSedeVencida
      ? [paciente({ id: "p-venc-1", clinicId: CL_VENCIDA, firstName: "Vera", lastName: "VENCIDA", patientNumber: "V0001", createdAt: hace(3) })]
      : []),
  ];

  const appointments: Fila[] = [
    ...(d.appointments ?? []),
    cita({ id: "a-ajena-1", clinicId: CL_AJENA, patientId: "p-ajena-1", doctorId: U_AJENO, status: "NO_SHOW", startsAt: en(sumarDias(HOY_N, -6), 9, 0, TZ_AJENA), endsAt: en(sumarDias(HOY_N, -6), 9, 30, TZ_AJENA) }),
    cita({ id: "a-ajena-2", clinicId: CL_AJENA, patientId: "p-ajena-2", doctorId: U_AJENO, status: "COMPLETED", startsAt: en(sumarDias(HOY_N, -6), 10, 0, TZ_AJENA), endsAt: en(sumarDias(HOY_N, -6), 10, 30, TZ_AJENA) }),
    cita({ id: "a-ex-1", clinicId: CL_EXSEDE, patientId: "p-ex-1", doctorId: U_RAFA_EX, status: "NO_SHOW", startsAt: en(sumarDias(HOY_N, -6), 9, 0, TZ_EXSEDE), endsAt: en(sumarDias(HOY_N, -6), 9, 30, TZ_EXSEDE) }),
    // 🔴 Citas de RAFAEL en Centro. Existen para que el recorte de rol DOCTOR
    // se pueda MEDIR con un número: si la ficha de Centro es DOCTOR, se cuentan
    // estas tres y no las de Sara; con la ficha equivocada, el conteo cambia.
    // Son CITAS_DE_RAFA_EN_SUR = 3, de ellas AUSENCIAS_DE_RAFA_EN_SUR = 2.
    cita({ id: "a-rafa-s-1", clinicId: CL_SUR, patientId: "p-sur-1", doctorId: U_RAFA_S, status: "NO_SHOW", startsAt: en(sumarDias(HOY_N, -8), 9, 0, TZ_SUR), endsAt: en(sumarDias(HOY_N, -8), 9, 30, TZ_SUR) }),
    cita({ id: "a-rafa-s-2", clinicId: CL_SUR, patientId: "p-sur-2", doctorId: U_RAFA_S, status: "NO_SHOW", startsAt: en(sumarDias(HOY_N, -9), 9, 0, TZ_SUR), endsAt: en(sumarDias(HOY_N, -9), 9, 30, TZ_SUR) }),
    cita({ id: "a-rafa-s-3", clinicId: CL_SUR, patientId: "p-sur-1", doctorId: U_RAFA_S, status: "COMPLETED", startsAt: en(sumarDias(HOY_N, -10), 9, 0, TZ_SUR), endsAt: en(sumarDias(HOY_N, -10), 9, 30, TZ_SUR) }),
    ...(opciones.conSedeVencida
      ? [
          cita({ id: "a-venc-1", clinicId: CL_VENCIDA, patientId: "p-venc-1", doctorId: U_RAFA_V, status: "NO_SHOW", startsAt: en(sumarDias(HOY_N, -6), 9, 0, TZ_VENCIDA), endsAt: en(sumarDias(HOY_N, -6), 9, 30, TZ_VENCIDA) }),
        ]
      : []),
  ];

  const invoices: Fila[] = [
    ...(d.invoices ?? []),
    {
      id: "inv-ajena-1", clinicId: CL_AJENA, patientId: "p-ajena-1", status: "PENDING",
      total: 777777, paid: 0, balance: 777777, discount: 0, dueDate: hace(30),
      createdAt: hace(5),
      items: [{ description: "TRATAMIENTO AJENO", quantity: 1, unitPrice: 777777, total: 777777 }],
    },
    {
      id: "inv-ajena-2", clinicId: CL_AJENA, patientId: "p-ajena-2", status: "PAID",
      total: 666666, paid: 666666, balance: 0, discount: 0, dueDate: null,
      createdAt: hace(5),
      items: [{ description: "OTRO AJENO", quantity: 1, unitPrice: 666666, total: 666666 }],
    },
    {
      id: "inv-ex-1", clinicId: CL_EXSEDE, patientId: "p-ex-1", status: "PENDING",
      total: 888888, paid: 0, balance: 888888, discount: 0, dueDate: hace(30),
      createdAt: hace(5),
      items: [{ description: "TRATAMIENTO EXSEDE", quantity: 1, unitPrice: 888888, total: 888888 }],
    },
    ...(opciones.conSedeVencida
      ? [
          {
            id: "inv-venc-1", clinicId: CL_VENCIDA, patientId: "p-venc-1", status: "PENDING",
            total: 444444, paid: 0, balance: 444444, discount: 0, dueDate: hace(30),
            createdAt: hace(5),
            items: [{ description: "TRATAMIENTO VENCIDO", quantity: 1, unitPrice: 444444, total: 444444 }],
          },
          {
            id: "inv-venc-2", clinicId: CL_VENCIDA, patientId: "p-venc-1", status: "PAID",
            total: 333333, paid: 333333, balance: 0, discount: 0, dueDate: null,
            createdAt: hace(5),
            items: [{ description: "OTRO VENCIDO", quantity: 1, unitPrice: 333333, total: 333333 }],
          },
        ]
      : []),
  ];

  const payments: Fila[] = [
    ...(d.payments ?? []),
    { id: "pay-ajena-1", invoiceId: "inv-ajena-2", amount: 666666, method: "cash", paidAt: hace(5) },
    { id: "pay-ex-1", invoiceId: "inv-ex-1", amount: 555555, method: "cash", paidAt: hace(5) },
    ...(opciones.conSedeVencida
      ? [{ id: "pay-venc-1", invoiceId: "inv-venc-2", amount: 333333, method: "cash", paidAt: hace(5) }]
      : []),
  ];

  return {
    ...d,
    clinics,
    users,
    patients,
    appointments,
    invoices,
    payments,
    sabinaUserPermissions: opciones.sabinaUserPermissions ?? [],
  };
}

function hace(dias: number): Date {
  return new Date(Date.now() - dias * 86_400_000);
}

export function baseDeSedes(opciones: OpcionesSiembra = {}): BaseDoble {
  return crearBase(datosDeSedes(opciones));
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

/** Rafael, con la sesión parada en Altabrisa. Tiene ficha activa también en Centro. */
export function rafaEnNorte(db: BaseDoble, over: Partial<SabinaCtx> = {}): SabinaCtx {
  return ctx(over, db);
}

/** Rafael, con la sesión parada en Centro. La comparación es la misma, del otro lado. */
export function rafaEnSur(db: BaseDoble, over: Partial<SabinaCtx> = {}): SabinaCtx {
  return ctx({ clinicId: CL_SUR, userId: U_RAFA_S, timezone: TZ_SUR, ...over }, db);
}

/** Lupe, recepción de Altabrisa. Una sola ficha: una sola sede. */
export function lupeEnNorte(db: BaseDoble, over: Partial<SabinaCtx> = {}): SabinaCtx {
  return ctx({ userId: U_RECEP_N, role: "RECEPTIONIST", ...over }, db);
}

/** El otro cliente, en su propia clínica. No comparte nada con Rafael. */
export function ajenoEnSuClinica(db: BaseDoble, over: Partial<SabinaCtx> = {}): SabinaCtx {
  return ctx(
    { clinicId: CL_AJENA, userId: U_AJENO, role: "SUPER_ADMIN", timezone: TZ_AJENA, ...over },
    db,
  );
}
