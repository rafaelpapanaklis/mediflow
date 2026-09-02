/**
 * DaleControl INSTITUCIONAL — EL PANEL DE DIRECCIÓN contra la base.
 *
 * SERVIDOR: importa prisma. Las cuentas viven en direccion-core.ts (puro,
 * probable sin base de datos) y el recorte de filas en visibility.ts. Aquí
 * solo se leen datos y se les pasan a las dos.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ESTA PANTALLA CRUZA CASI TODAS LAS TABLAS DEL VERTICAL, ASÍ QUE EL
 * PRESUPUESTO DE CONSULTAS ES PARTE DEL DISEÑO.
 *
 * La regla que se siguió: UNA consulta por TABLA y por VENTANA, nunca una
 * por fila. Todo lo que se puede agrupar se agrupa en memoria (los
 * `agrupar()` de abajo), y lo que se puede sumar en Postgres se suma allí
 * (`groupBy` de los pagos, `aggregate` de las autorizaciones) para no
 * traerse filas que solo se iban a sumar.
 *
 * Y el segundo freno: **el panel carga NÚMEROS, no listas**. La lista que
 * hay detrás de cada cifra se pide aparte (`getEduDireccionDetalle`) y solo
 * cuando alguien la abre. Si el panel cargara las veinte listas por si
 * acaso, sería una pantalla de ocho segundos que nadie vuelve a abrir — y
 * un tablero que no se abre no sirve para dirigir nada.
 *
 * 🔴 MENOS DE 7 PROMESAS POR `Promise.all` (regla del repo). Los tres
 * grupos de abajo son de 6, 6 y 2. Y la página llama a `ahora` y a `panel`
 * en SECUENCIA, no en paralelo: encadenar dos bloques de seis dejaría doce
 * consultas simultáneas contra el mismo pool.
 *
 * 🔴 institutionId SIEMPRE de getEduContext(). Ni un `where` de este
 * archivo lo lee del body o del query: en Prisma un
 * `where: { institutionId: undefined }` no devuelve cero filas, BORRA el
 * filtro y devuelve las de TODOS los institutos.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import {
  EDU_BUSY_STATUSES,
  EDU_MAX_CHAIRS,
  eduCleanId,
  eduDayRange,
  eduFormatDayLong,
  eduFormatTime,
  eduSafeTimeZone,
  eduTodayISO,
} from "@/lib/edu/agenda-core";
import { eduCurrentAssignmentWhere } from "@/lib/edu/padron-core";
import { eduMoney } from "@/lib/edu/dinero-core";
import { eduAppointmentMinutes, eduHoursLabel } from "@/lib/edu/evaluacion-core";
import { listEduEvaluacion } from "@/lib/edu/evaluacion";
import {
  EDU_APPOINTMENT_STATUS_LABELS,
  EDU_APPROVAL_STAGE_LABELS,
  EDU_CASE_CLOSED_STATUSES,
  EDU_CASE_STATUS_LABELS,
  EDU_PATIENT_STATUS_LABELS,
  type EduApprovalStage,
  type EduAppointmentStatus,
  type EduPatientStatus,
} from "@/lib/edu/types";
import {
  eduAppointmentScopeWhere,
  eduCaseScopeWhere,
  eduChairScopeWhere,
  eduChargeScopeWhere,
  eduPatientScopeWhere,
  eduPaymentScopeWhere,
  eduPuedeVerLaClinicaEntera,
  eduStudentScopeWhere,
  eduVisibility,
  EDU_CLINICA_ENTERA_NONE_DETAIL,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import { eduCampusLabel, eduWithCampus, type EduCampusScope } from "@/lib/edu/campus-core";
import {
  buildEduDireccionCsv,
  EDU_DIR_MAX_PENDIENTES_VIVAS,
  EDU_DIR_DETALLE_DETALLES,
  EDU_DIR_DETALLE_TITULOS,
  EDU_DIR_MAX_CITAS,
  EDU_DIR_MAX_DETALLE,
  EDU_DIR_MAX_FILAS,
  EDU_DIR_TOP_ALUMNOS,
  EDU_DIR_FIRMA_VIEJA_MIN,
  eduDirArmarSerie,
  eduDirCapacidadMinutos,
  eduDirDiaDe,
  eduDirEsperaLabel,
  eduDirEstadoAgregado,
  eduDirMinutosDesde,
  eduDirOcupacion,
  eduDirPuntosPorDia,
  eduDirSemaforoDeFirmas,
  eduDirSillonEstado,
  eduDirVariacion,
  eduDirVentana,
  eduDirWeekdayCounts,
  parseEduDirInicioPeriodo,
  type EduDirAhora,
  type EduDirAlumnoRow,
  type EduDirCifra,
  type EduDirDetalleFila,
  type EduDirDetalleKey,
  type EduDirDetallePage,
  type EduDirDocenteVivo,
  type EduDirEspecialidadRow,
  type EduDirFiltrosCrudos,
  type EduDirInicio,
  type EduDirInicioAcceso,
  type EduDirPanel,
  type EduDirRecepcionFila,
  type EduDirSillonUso,
  type EduDirSillonVivo,
  type EduDirVentana,
} from "@/lib/edu/direccion-core";

export { buildEduDireccionCsv };

/** La etiqueta de la etapa del gate (Ola 4), sin reventar si la base trae
 *  una que el catalogo todavia no conoce. */
function etapaLabel(stage: string): string {
  return EDU_APPROVAL_STAGE_LABELS[stage as EduApprovalStage] ?? stage;
}

// ═══════════════════════════════════════════════════════════════════════
// 0 · EL ALCANCE
//
// 🔴 ESTE TABLERO ES DE DIRECCIÓN, Y ESO NO ES UN COMENTARIO: ES UN
// `where`. Las cinco lecturas arman su filtro con visibility.ts, igual que
// el resto del vertical, y ADEMÁS se comprueba que los cuatro recursos
// devuelvan alcance COMPLETO. La razón es de producto, no de seguridad:
// alguien con `direccion.panel` encendido por override pero rol DOCENTE
// vería un tablero titulado "La clínica ahora" con la mitad de los
// sillones — un número recortado presentado como el total es peor que no
// enseñar nada.
// ═══════════════════════════════════════════════════════════════════════

interface EduDirAlcance {
  institutionId: string;
  timeZone: string;
  citas: (extra?: Prisma.EduStudentWhereInput) => Prisma.EduAppointmentWhereInput;
  casos: Prisma.EduCaseWhereInput;
  pacientes: Prisma.EduPatientWhereInput;
  alumnos: Prisma.EduStudentWhereInput;
  cobros: Prisma.EduChargeWhereInput;
  pagos: Prisma.EduPaymentWhereInput;
  /** Los SILLONES de la sede. Ver la nota de la sede, arriba. */
  sillones: Prisma.EduChairWhereInput;
  /**
   * El recorte del PAGO, que no tiene columna de sede: se cuelga de su
   * cobro. `null` = sin recorte.
   *
   * Se devuelve como pieza y no aplicado porque las dos consultas de pagos
   * ya cuelgan un `charge: { case: { programId } }` de la especialidad, y
   * escribir la clave `charge` dos veces en el mismo objeto pierde uno de
   * los dos filtros EN SILENCIO. Se fusionan en `pagoCharge()`.
   */
  pagoSede: Prisma.EduChargeWhereInput | null;
}

/**
 * El `charge` de una consulta de PAGOS, con la sede y la especialidad en
 * el MISMO objeto. Devuelve `{}` cuando no hay ni una ni otra, para no
 * meter un `charge: {}` inútil en el `where`.
 */
function pagoCharge(
  alcance: EduDirAlcance,
  programId: string | null,
): Prisma.EduPaymentWhereInput {
  const charge: Prisma.EduChargeWhereInput = {
    ...(alcance.pagoSede ?? {}),
    ...(programId ? { case: { programId } } : {}),
  };
  return Object.keys(charge).length > 0 ? { charge } : {};
}

function eduDirAlcance(ctx: EduClinicaContext & { timeZone: string }, now: Date): EduDirAlcance {
  const institutionId = ctx?.institutionId;
  if (!institutionId || typeof institutionId !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }

  const sPac = eduVisibility(ctx, "patients");
  const sCit = eduVisibility(ctx, "appointments");
  const sCas = eduVisibility(ctx, "cases");
  const sCob = eduVisibility(ctx, "charges");

  // 🔴 LA NEGACIÓN LA DECIDE visibility.ts, NO ESTE ARCHIVO. Desde que el
  // Inicio de dirección pinta totales (sus tres gráficas), la misma regla
  // hace falta en dos sitios, y escribirla dos veces es cómo se llega a que
  // una de las dos pantallas se lo permita a un rol nuevo. El motivo del
  // 403 también sale de allí, para que las dos digan lo mismo.
  if (!eduPuedeVerLaClinicaEntera(ctx)) {
    throw new EduPadronError(EDU_CLINICA_ENTERA_NONE_DETAIL, 403);
  }

  // 🔴 Ola 11 · LA SEDE, y aquí NO niega: RECORTA. Es lo contrario del
  // alcance de arriba, y la diferencia es de qué habla cada uno. El alcance
  // por rol dice A QUIÉN ve esta cuenta, y por eso un total recortado sería
  // falso; la sede dice DE QUÉ EDIFICIO se está hablando, que es una
  // pregunta legítima de la dirección de una escuela con dos campus —"¿cómo
  // va el norte?"— y la respuesta es el total DEL NORTE.
  //
  // Sin sedes dadas de alta, `campusIds` es `null` y ninguno de estos
  // `where` cambia: el tablero se comporta exactamente como antes de la
  // Ola 11. Con una sede elegida en la barra superior, TODO lo que cuelga
  // de un edificio la respeta — y lo que no cuelga de ninguno (pacientes,
  // casos, alumnos) NO se recorta, porque un alumno rota entre sedes y su
  // expediente es uno solo.
  const campusIds = ctx.campusIds;

  return {
    institutionId,
    timeZone: ctx.timeZone,
    citas: (extra) =>
      eduAppointmentScopeWhere({
        institutionId,
        scope: sCit,
        now,
        studentExtra: extra,
        campusIds,
      }),
    casos: eduCaseScopeWhere({ institutionId, scope: sCas, now }),
    pacientes: eduPatientScopeWhere({ institutionId, scope: sPac, now }),
    alumnos: eduStudentScopeWhere({ institutionId, scope: sCas, now }),
    cobros: eduChargeScopeWhere({ institutionId, scope: sCob, campusIds }),
    pagos: eduPaymentScopeWhere({ institutionId, scope: sCob }),
    sillones: eduChairScopeWhere({ institutionId, campusIds }),
    // El pago no tiene columna de sede (no es un olvido: el dinero entra
    // contra un cobro, y el cobro es el que selló dónde estaba el
    // mostrador). Se cuelga de su cobro.
    pagoSede: Array.isArray(campusIds) ? { campusId: { in: campusIds } } : null,
  };
}

/**
 * El contexto que necesitan las funciones de este archivo.
 *
 * `campusIds` lo hereda de EduClinicaContext (Ola 11): es el recorte por
 * sede, y `null` significa SIN recorte — nunca `[]`, que significa ninguna.
 */
export interface EduDirContext extends EduClinicaContext {
  timeZone: string;
  institutionName: string;
  /** La sede elegida, para escribirla en el tablero y en el CSV. */
  campusLabel: string | null;
}

/**
 * 🔴 LA SEDE ENTRA POR AQUÍ Y POR NINGÚN OTRO SITIO. Este constructor es el
 * embudo de las CINCO entradas del tablero (la página y los cuatro
 * endpoints), así que pedirla como argumento es lo que hace imposible que
 * una de las cinco se quede sin ella: sin el segundo argumento el tablero
 * es el consolidado del instituto, que es exactamente lo que se ve cuando
 * no hay sedes o cuando se elige "Todas".
 *
 * Se pasa EXPLÍCITA y no se lee aquí dentro porque `getEduCampusScope`
 * consulta la base y lee la cookie: meterla aquí volvería síncrono lo que
 * no lo es y ataría este archivo (que las pruebas usan sin base) al
 * request.
 */
export function eduDirContextFrom(
  ctx: {
    eduUserId: string;
    institutionId: string;
    role: EduClinicaContext["role"];
    institution: { name: string; timezone: string };
  },
  sede?: EduCampusScope | null,
): EduDirContext {
  return eduWithCampus(
    {
      eduUserId: ctx.eduUserId,
      institutionId: ctx.institutionId,
      role: ctx.role,
      timeZone: eduSafeTimeZone(ctx.institution?.timezone),
      institutionName: ctx.institution?.name ?? "",
      campusLabel: sede?.active ? eduCampusLabel(sede.active) : null,
    },
    sede ?? null,
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · LA CLÍNICA AHORA
//
// 🔴 QUÉ SIGNIFICA "AHORA": las citas de HOY (día de calendario del
// instituto) que están en CHECKED_IN, IN_CHAIR o IN_PROGRESS.
//
//   · CHECKED_IN  → llegó a recepción. NO ocupa sillón: si contara, "3 de
//     20 sillones en uso" incluiría a gente sentada en la sala de espera, y
//     esa cifra es justo la que decide si caben más pacientes.
//   · IN_CHAIR / IN_PROGRESS → está en el sillón. Eso es ocupar.
//
// La ventana es el DÍA y no "las últimas dos horas" a propósito: una cita
// que nadie cerró se queda ahí y se ve — que es lo que hay que arreglar—,
// pero no arrastra las de anteayer.
// ═══════════════════════════════════════════════════════════════════════

const VIVAS: EduAppointmentStatus[] = ["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS"];
const EN_SILLON: EduAppointmentStatus[] = ["IN_CHAIR", "IN_PROGRESS"];

const CITA_VIVA_SELECT = {
  id: true,
  chairId: true,
  patientId: true,
  studentId: true,
  caseId: true,
  status: true,
  startsAt: true,
  checkedInAt: true,
  startedAt: true,
  supervisorUserId: true,
  patient: { select: { firstName: true, lastName: true, folio: true } },
  student: {
    select: {
      id: true,
      programId: true,
      user: { select: { firstName: true, lastName: true } },
      program: { select: { name: true } },
    },
  },
  supervisor: { select: { id: true, firstName: true, lastName: true } },
  chair: { select: { id: true, name: true, number: true } },
} satisfies Prisma.EduAppointmentSelect;

export async function getEduDireccionAhora(
  ctx: EduDirContext,
  filtros: EduDirFiltrosCrudos,
  now: Date = new Date(),
): Promise<EduDirAhora> {
  const alcance = eduDirAlcance(ctx, now);
  const tz = alcance.timeZone;
  const programId = eduCleanId(filtros?.especialidad);
  const hoyISO = eduTodayISO(tz, now);
  const dia = eduDayRange(hoyISO, tz, 1);

  const [sillones, citas] = await Promise.all([
    prisma.eduChair.findMany({
      where: { ...alcance.sillones, isActive: true },
      orderBy: [{ orderIndex: "asc" }, { number: "asc" }],
      take: EDU_MAX_CHAIRS,
      select: { id: true, name: true, number: true },
    }),
    prisma.eduAppointment.findMany({
      where: {
        ...alcance.citas(programId ? { programId } : undefined),
        ...(dia ? { startsAt: { gte: dia.from, lt: dia.to } } : {}),
        status: { in: VIVAS },
      },
      orderBy: [{ startsAt: "asc" }],
      take: EDU_MAX_CHAIRS * 4,
      select: CITA_VIVA_SELECT,
    }),
  ]);

  const enSillon = citas.filter((c) => EN_SILLON.includes(c.status as EduAppointmentStatus));
  const studentIds = Array.from(new Set(enSillon.map((c) => c.studentId)));

  // 🔴 LAS PENDIENTES SE PIDEN TODAS, NO LAS DE UNOS `caseId` CONCRETOS.
  //
  // Parece un desperdicio y es justo lo contrario. La agenda del vertical
  // casi nunca engancha la cita a su caso (`caseId` se queda en null), así
  // que filtrar por los `caseId` de las citas que hay en los sillones
  // dejaría fuera la mayoría de las esperas — y "esperando docente", que
  // es la mitad de para qué existe esta rejilla, casi nunca se encendería.
  //
  // Trayendo las PENDIENTES del instituto (que son pocas: es la bandeja
  // del docente, no un histórico) y su caso, se puede emparejar cada
  // sillón por DOS caminos: por `caseId` cuando la cita lo trae, y por
  // (paciente, alumno) cuando no. Cuesta la misma consulta y el mismo
  // viaje, y usa el índice de bandeja que ya existe.
  const [pendientes, asignaciones] = await Promise.all([
    prisma.eduCaseApproval.findMany({
      where: { institutionId: alcance.institutionId, status: "PENDING" },
      orderBy: [{ requestedAt: "asc" }],
      take: EDU_DIR_MAX_PENDIENTES_VIVAS,
      select: {
        caseId: true,
        stage: true,
        requestedAt: true,
        case: { select: { id: true, patientId: true, studentId: true, status: true } },
      },
    }),
    prisma.eduSupervisorAssignment.findMany({
      where: {
        institutionId: alcance.institutionId,
        studentId: { in: studentIds },
        ...eduCurrentAssignmentWhere(now),
      },
      orderBy: [{ isPrimary: "desc" }, { startsAt: "desc" }],
      select: {
        studentId: true,
        supervisorUserId: true,
        isPrimary: true,
        supervisor: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  // Las pendientes vienen de la más vieja a la más nueva, así que la
  // PRIMERA que se guarda en cada clave es la que decide cuánto lleva
  // esperando ese sillón.
  //
  // Dos claves para lo mismo: el `caseId` y el par «paciente + alumno». La
  // segunda es la que cubre las citas que no traen caso enganchado, y solo
  // se rellena con casos ABIERTOS — un caso cerrado no tiene a nadie
  // esperando en un sillón.
  type Espera = { stage: EduApprovalStage; requestedAt: Date };
  const esperaPorCaso = new Map<string, Espera>();
  const esperaPorPareja = new Map<string, Espera>();
  const parejaKey = (patientId: string, studentId: string): string => `${patientId}|${studentId}`;

  for (const p of pendientes) {
    if (!esperaPorCaso.has(p.caseId)) esperaPorCaso.set(p.caseId, p);
    const c = p.case;
    if (!c || EDU_CASE_CLOSED_STATUSES.includes(c.status)) continue;
    const k = parejaKey(c.patientId, c.studentId);
    if (!esperaPorPareja.has(k)) esperaPorPareja.set(k, p);
  }

  const titularPorAlumno = new Map<
    string,
    { userId: string; name: string }
  >();
  for (const a of asignaciones) {
    if (!titularPorAlumno.has(a.studentId)) {
      titularPorAlumno.set(a.studentId, {
        userId: a.supervisorUserId,
        name: persona(a.supervisor),
      });
    }
  }

  // Un sillón puede acumular varias citas vivas a lo largo del día (una que
  // nadie cerró más la de ahora). Gana la MÁS RECIENTE: es la que está
  // pasando.
  const ocupacionPorSillon = new Map<string, (typeof enSillon)[number]>();
  for (const c of enSillon) {
    const previa = ocupacionPorSillon.get(c.chairId);
    if (!previa || c.startsAt.getTime() >= previa.startsAt.getTime()) {
      ocupacionPorSillon.set(c.chairId, c);
    }
  }

  // Los sillones que salen en la rejilla: los activos MÁS cualquiera que
  // tenga a alguien dentro aunque esté dado de baja (que sería un problema,
  // y esconderlo no lo arregla).
  // ⚠️ `Array.from` y no `for…of` sobre el iterador del Map: el tsconfig de
  // este repo no lleva `target: es2015` ni `downlevelIteration`, así que
  // recorrer un iterador directamente no compila.
  const ocupadas = Array.from(ocupacionPorSillon.values());
  const rejilla = new Map<string, { id: string; name: string; number: number }>();
  for (const s of sillones) rejilla.set(s.id, s);
  for (const c of ocupadas) {
    if (!rejilla.has(c.chairId)) rejilla.set(c.chairId, c.chair);
  }

  const docentes = new Map<string, EduDirDocenteVivo>();
  let sillonesSinDocente = 0;

  const filas: EduDirSillonVivo[] = Array.from(rejilla.values())
    .sort((a, b) => a.number - b.number)
    .map((s) => {
      const cita = ocupacionPorSillon.get(s.id) ?? null;
      if (!cita) {
        return {
          chairId: s.id,
          name: s.name,
          number: s.number,
          estado: "LIBRE" as const,
          appointmentId: null,
          patientId: null,
          patientName: null,
          patientFolio: null,
          studentId: null,
          studentName: null,
          programName: null,
          caseId: null,
          desdeLabel: null,
          esperaMinutos: null,
          esperaEtapa: null,
          supervisorName: null,
        };
      }

      const espera =
        (cita.caseId ? esperaPorCaso.get(cita.caseId) : undefined) ??
        esperaPorPareja.get(parejaKey(cita.patientId, cita.studentId)) ??
        null;
      const esperaMinutos = espera ? eduDirMinutosDesde(espera.requestedAt, now) : null;

      // 🔴 QUIÉN RESPONDE POR ESTE SILLÓN. Primero el supervisor que quedó
      // guardado en la cita; si la cita no lo trae —que es lo normal cuando
      // se agendó sin elegirlo—, el titular VIGENTE del alumno. Si no hay
      // ninguno de los dos, nadie responde: se cuenta y se dice.
      const deLaCita = cita.supervisor
        ? { userId: cita.supervisor.id, name: persona(cita.supervisor), porTitularidad: false }
        : null;
      const titular = titularPorAlumno.get(cita.studentId);
      const responsable =
        deLaCita ?? (titular ? { ...titular, porTitularidad: true } : null);

      if (!responsable) sillonesSinDocente += 1;
      else {
        const prev = docentes.get(responsable.userId);
        if (prev) {
          prev.sillones += 1;
          prev.porTitularidad = prev.porTitularidad && responsable.porTitularidad;
        } else {
          docentes.set(responsable.userId, {
            userId: responsable.userId,
            name: responsable.name,
            sillones: 1,
            porTitularidad: responsable.porTitularidad,
          });
        }
      }

      return {
        chairId: s.id,
        name: s.name,
        number: s.number,
        estado: eduDirSillonEstado(true, esperaMinutos),
        appointmentId: cita.id,
        patientId: cita.patientId,
        patientName: persona(cita.patient),
        patientFolio: cita.patient.folio,
        studentId: cita.studentId,
        studentName: persona(cita.student.user),
        programName: cita.student.program?.name ?? null,
        caseId: cita.caseId,
        desdeLabel: eduFormatTime(cita.startedAt ?? cita.checkedInAt ?? cita.startsAt, tz),
        esperaMinutos,
        esperaEtapa: espera ? etapaLabel(espera.stage) : null,
        supervisorName: responsable?.name ?? null,
      };
    });

  const enSillonIds = new Set(ocupadas.map((c) => c.id));
  const recepcion: EduDirRecepcionFila[] = citas
    .filter((c) => !enSillonIds.has(c.id) && c.status === "CHECKED_IN")
    .map((c) => ({
      appointmentId: c.id,
      patientName: persona(c.patient),
      patientFolio: c.patient.folio,
      studentName: persona(c.student.user),
      programName: c.student.program?.name ?? null,
      chairName: `${c.chair.number} · ${c.chair.name}`,
      desdeLabel: eduFormatTime(c.checkedInAt ?? c.startsAt, tz),
      esperaMinutos: eduDirMinutosDesde(c.checkedInAt ?? c.startsAt, now),
    }));

  const esperas = filas
    .map((f) => f.esperaMinutos)
    .filter((v): v is number => typeof v === "number");

  return {
    generadoISO: now.toISOString(),
    horaLabel: eduFormatTime(now, tz),
    pacientesEnClinica: new Set(citas.map((c) => c.patientId)).size,
    alumnosAtendiendo: new Set(enSillon.map((c) => c.studentId)).size,
    sillonesEnUso: ocupacionPorSillon.size,
    sillonesTotal: rejilla.size,
    docentesResponsables: docentes.size,
    sillonesSinDocente,
    esperandoFirma: esperas.length,
    esperaMasViejaMin: esperas.length > 0 ? Math.max(...esperas) : null,
    sillones: filas,
    recepcion,
    docentes: Array.from(docentes.values()).sort((a, b) => b.sillones - a.sillones),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · EL PANEL DEL PERIODO
// ═══════════════════════════════════════════════════════════════════════

const CITA_PERIODO_SELECT = {
  id: true,
  patientId: true,
  studentId: true,
  chairId: true,
  type: true,
  status: true,
  startsAt: true,
  endsAt: true,
  checkedInAt: true,
  startedAt: true,
  completedAt: true,
  student: { select: { programId: true } },
} satisfies Prisma.EduAppointmentSelect;

export async function getEduDireccionPanel(
  ctx: EduDirContext,
  filtros: EduDirFiltrosCrudos,
  now: Date = new Date(),
): Promise<EduDirPanel> {
  const alcance = eduDirAlcance(ctx, now);
  const institutionId = alcance.institutionId;
  const tz = alcance.timeZone;
  const ventana = eduDirVentana(filtros, tz, now);
  const programId = eduCleanId(filtros?.especialidad);
  const avisos: string[] = [];
  if (ventana.aviso) avisos.push(ventana.aviso);

  const enPeriodo = { gte: ventana.from, lt: ventana.to };
  const enPrevio = { gte: ventana.prevFrom, lt: ventana.prevTo };
  const porAlumno = programId ? { programId } : undefined;
  const casoDelPrograma: Prisma.EduCaseWhereInput = programId ? { programId } : {};
  const cobroDelPrograma: Prisma.EduChargeWhereInput = programId ? { case: { programId } } : {};

  // ── Grupo 1 · lo del periodo ─────────────────────────────────────────
  const [citas, citasPrev, casos, casosPrev, cobros, pagos] = await Promise.all([
    prisma.eduAppointment.findMany({
      where: { ...alcance.citas(porAlumno), startsAt: enPeriodo },
      take: EDU_DIR_MAX_CITAS + 1,
      select: CITA_PERIODO_SELECT,
    }),
    prisma.eduAppointment.findMany({
      where: { ...alcance.citas(porAlumno), startsAt: enPrevio },
      take: EDU_DIR_MAX_CITAS + 1,
      // Del periodo anterior solo se necesitan CUATRO números, así que se
      // traen tres columnas y no la fila entera.
      select: { patientId: true, type: true, status: true },
    }),
    prisma.eduCase.findMany({
      where: {
        ...alcance.casos,
        ...casoDelPrograma,
        OR: [{ openedAt: enPeriodo }, { closedAt: enPeriodo }],
      },
      take: EDU_DIR_MAX_FILAS + 1,
      select: {
        id: true,
        programId: true,
        studentId: true,
        status: true,
        openedAt: true,
        closedAt: true,
        // Para "calificaciones sin registrar": la VIGENTE es la fila que
        // nadie corrige (Ola 6). Se leen las dos columnas y se decide en
        // memoria; no hay bandera que consultar.
        grades: { select: { id: true, correctsId: true } },
      },
    }),
    prisma.eduCase.findMany({
      where: {
        ...alcance.casos,
        ...casoDelPrograma,
        OR: [{ openedAt: enPrevio }, { closedAt: enPrevio }],
      },
      take: EDU_DIR_MAX_FILAS + 1,
      select: { status: true, openedAt: true, closedAt: true },
    }),
    prisma.eduCharge.findMany({
      where: { ...alcance.cobros, ...cobroDelPrograma, chargedAt: enPeriodo },
      take: EDU_DIR_MAX_FILAS + 1,
      select: {
        id: true,
        totalCents: true,
        balanceCents: true,
        status: true,
        feeScheduleId: true,
        caseId: true,
        case: { select: { programId: true } },
        // 🔴 El ORIGEN REAL del paciente. Es la otra mitad del control del
        // dinero: la tarifa que se aplicó se compara contra esto.
        patient: { select: { referredByStudentId: true } },
      },
    }),
    // Los pagos se SUMAN en Postgres: son la única cifra de dinero que hay
    // que traer entera y no se pinta ni una de sus filas.
    prisma.eduPayment.groupBy({
      by: ["isRefund"],
      where: {
        ...alcance.pagos,
        paidAt: enPeriodo,
        ...pagoCharge(alcance, programId),
      },
      _sum: { amountCents: true },
    }),
  ]);

  // ── Grupo 2 · el contexto ────────────────────────────────────────────
  const hoyISO = eduTodayISO(tz, now);
  const diaHoy = eduDayRange(hoyISO, tz, 1);

  const [pagosPrev, sillones, programas, firmas, sinAlumno, citasHoy] = await Promise.all([
    prisma.eduPayment.groupBy({
      by: ["isRefund"],
      where: {
        ...alcance.pagos,
        paidAt: enPrevio,
        ...pagoCharge(alcance, programId),
      },
      _sum: { amountCents: true },
    }),
    // 🔴 CON LA SEDE. La ocupación es un cociente, y sus dos mitades tienen
    // que ser del mismo edificio: los sillones son el denominador y las
    // citas de arriba (ya recortadas) el numerador. Un denominador de dos
    // campus con un numerador de uno da una ocupación de la mitad.
    prisma.eduChair.findMany({
      where: alcance.sillones,
      orderBy: [{ orderIndex: "asc" }, { number: "asc" }],
      take: EDU_MAX_CHAIRS,
      select: {
        id: true,
        name: true,
        number: true,
        isActive: true,
        schedules: { select: { weekday: true, startMinute: true, endMinute: true } },
      },
    }),
    // SIN filtrar por la especialidad elegida: esta lista alimenta el
    // SELECTOR, y un selector que solo trae la opcion ya elegida no deja
    // volver a otra.
    prisma.eduProgram.findMany({
      where: { institutionId, isActive: true },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true },
    }),
    // count + el más viejo en UNA consulta: dos serían dos viajes para
    // pintar la misma tarjeta.
    prisma.eduCaseApproval.aggregate({
      where: {
        institutionId,
        status: "PENDING",
        ...(programId ? { case: { programId } } : {}),
      },
      _count: { _all: true },
      _min: { requestedAt: true },
    }),
    prisma.eduPatient.count({
      where: {
        ...alcance.pacientes,
        status: { in: ["NEW", "ACTIVE"] },
        cases: { none: { institutionId, status: { notIn: EDU_CASE_CLOSED_STATUSES } } },
        appointments: {
          none: { institutionId, startsAt: { gte: now }, status: { in: EDU_BUSY_STATUSES } },
        },
      },
    }),
    // "En clínica hoy" es HOY, pase lo que pase con el filtro de periodo:
    // la columna lo dice con esa palabra. Son las citas de un solo día, así
    // que es la consulta más barata del grupo.
    prisma.eduAppointment.findMany({
      where: {
        ...alcance.citas(porAlumno),
        ...(diaHoy ? { startsAt: { gte: diaHoy.from, lt: diaHoy.to } } : {}),
        status: { in: EDU_BUSY_STATUSES },
      },
      take: EDU_DIR_MAX_CITAS,
      select: { studentId: true, student: { select: { programId: true } } },
    }),
  ]);

  // ── Grupo 3 · lo académico y lo que falta ────────────────────────────
  const [evaluacion, sinDocente] = await Promise.all([
    // 🔴 REUSO, NO SEGUNDA CUENTA. El avance, el semáforo y el motivo salen
    // de la Ola 6 tal cual. Recalcularlos aquí es cómo se llega a que la
    // pantalla de Evaluación diga 5 y la de Dirección diga 6, y entonces no
    // se puede usar ninguna de las dos.
    listEduEvaluacion(ctx, { programId }, now),
    prisma.eduStudent.count({
      where: {
        ...alcance.alumnos,
        status: "ACTIVE",
        ...(programId ? { programId } : {}),
        supervisors: { none: { institutionId, ...eduCurrentAssignmentWhere(now) } },
      },
    }),
  ]);

  // ── Topes ────────────────────────────────────────────────────────────
  const citasCortadas = citas.length > EDU_DIR_MAX_CITAS;
  const casosCortados = casos.length > EDU_DIR_MAX_FILAS;
  const cobrosCortados = cobros.length > EDU_DIR_MAX_FILAS;
  const citasV = citasCortadas ? citas.slice(0, EDU_DIR_MAX_CITAS) : citas;
  const citasPrevV = citasPrev.slice(0, EDU_DIR_MAX_CITAS);
  const casosV = casosCortados ? casos.slice(0, EDU_DIR_MAX_FILAS) : casos;
  const casosPrevV = casosPrev.slice(0, EDU_DIR_MAX_FILAS);
  const cobrosV = cobrosCortados ? cobros.slice(0, EDU_DIR_MAX_FILAS) : cobros;

  if (citasCortadas) {
    avisos.push(
      `El periodo tiene más de ${EDU_DIR_MAX_CITAS.toLocaleString("es-MX")} citas y las cuentas se hicieron con las primeras. Acorta el periodo o filtra por especialidad para que los totales sean exactos.`,
    );
  }
  if (casosCortados || cobrosCortados) {
    avisos.push(
      `El periodo tiene más de ${EDU_DIR_MAX_FILAS.toLocaleString("es-MX")} casos o cobros y las cuentas se hicieron con los primeros. Acorta el periodo para que los totales sean exactos.`,
    );
  }
  if (evaluacion.truncated) {
    avisos.push(
      "El instituto tiene más estudiantes de los que cabe medir de una vez; el avance por especialidad se calculó con los primeros. Filtra por especialidad para verlos todos.",
    );
  }
  if (programId) {
    avisos.push(
      "Con una especialidad seleccionada, el dinero solo cuenta los cobros que traen un caso de esa especialidad: caja cobra sin abrir expediente, así que un cobro sin caso no se puede atribuir a ninguna.",
    );
    // Un id tecleado a mano (o el de una especialidad que se dio de baja)
    // deja el tablero entero en cero, y en cero se lee como "esta
    // especialidad no hizo nada". Se dice cuál es la diferencia.
    if (!programas.some((p) => p.id === programId)) {
      avisos.push(
        "La especialidad del filtro no está activa en tu instituto, así que el tablero salió vacío. Vuelve a «Todas» en el selector de arriba.",
      );
    }
  }

  // ── §2 · Actividad del periodo ───────────────────────────────────────
  const completadas = citasV.filter((c) => c.status === "COMPLETED");
  const completadasPrev = citasPrevV.filter((c) => c.status === "COMPLETED");

  const pacientesAtendidos = new Set(completadas.map((c) => c.patientId)).size;
  const pacientesAtendidosPrev = new Set(completadasPrev.map((c) => c.patientId)).size;

  const iniciados = casosV.filter((c) => dentro(c.openedAt, ventana)).length;
  const iniciadosPrev = casosPrevV.filter((c) => dentroPrev(c.openedAt, ventana)).length;
  const terminados = casosV.filter(
    (c) => c.status === "COMPLETED" && dentro(c.closedAt, ventana),
  ).length;
  const terminadosPrev = casosPrevV.filter(
    (c) => c.status === "COMPLETED" && dentroPrev(c.closedAt, ventana),
  ).length;

  const tamizajes = completadas.filter((c) => c.type === "TAMIZAJE").length;
  const tamizajesPrev = completadasPrev.filter((c) => c.type === "TAMIZAJE").length;

  const cobradoCents = neto(pagos);
  const cobradoPrevCents = neto(pagosPrev);

  // ── §5 · Dinero ──────────────────────────────────────────────────────
  const listasDeAlumno = await listasConReglaDeAlumno(institutionId);
  const vivos = cobrosV.filter((c) => c.status !== "CANCELLED");

  let publicoCents = 0;
  let alumnoCents = 0;
  let controlCents = 0;
  let controlCount = 0;
  let inversoCents = 0;
  let inversoCount = 0;
  let sinListaCents = 0;
  let sinListaCount = 0;
  let emitidoCents = 0;
  let pendienteCents = 0;
  const cobradoPorPrograma = new Map<string, number>();
  let cobradoSinCaso = 0;

  for (const c of vivos) {
    emitidoCents += c.totalCents;
    pendienteCents += c.balanceCents;

    const loTrajoUnAlumno = Boolean(c.patient?.referredByStudentId);
    if (loTrajoUnAlumno) alumnoCents += c.totalCents;
    else publicoCents += c.totalCents;

    if (!c.feeScheduleId) {
      sinListaCents += c.totalCents;
      sinListaCount += 1;
    } else {
      const tarifaDeAlumno = listasDeAlumno.has(c.feeScheduleId);
      // 🔴 EL CONTROL. La tarifa barata sobre alguien que llegó solo a la
      // clínica: o falta marcar quién lo trajo, o se cobró de menos.
      if (tarifaDeAlumno && !loTrajoUnAlumno) {
        controlCents += c.totalCents;
        controlCount += 1;
      }
      if (!tarifaDeAlumno && loTrajoUnAlumno) {
        inversoCents += c.totalCents;
        inversoCount += 1;
      }
    }

    const prog = c.case?.programId ?? null;
    if (prog) cobradoPorPrograma.set(prog, (cobradoPorPrograma.get(prog) ?? 0) + c.totalCents);
    else cobradoSinCaso += c.totalCents;
  }

  const sillonesActivos = sillones.filter((s) => s.isActive).length;

  // ── §7 · Uso de la clínica ───────────────────────────────────────────
  const weekdayCounts = eduDirWeekdayCounts(ventana.desdeISO, ventana.dias);
  const minutosPorSillon = new Map<string, { min: number; citas: number }>();
  let minutosTotales = 0;
  let citasConMinutos = 0;

  for (const c of citasV) {
    const m = eduAppointmentMinutes(c);
    if (m.minutes <= 0) continue;
    minutosTotales += m.minutes;
    citasConMinutos += 1;
    const acc = minutosPorSillon.get(c.chairId);
    if (acc) {
      acc.min += m.minutes;
      acc.citas += 1;
    } else {
      minutosPorSillon.set(c.chairId, { min: m.minutes, citas: 1 });
    }
  }

  const usoSillones: EduDirSillonUso[] = sillones.map((s) => {
    const acc = minutosPorSillon.get(s.id) ?? { min: 0, citas: 0 };
    const capacidadMin = eduDirCapacidadMinutos(s.schedules, weekdayCounts);
    return {
      chairId: s.id,
      name: s.name,
      number: s.number,
      usadosMin: acc.min,
      capacidadMin,
      ocupacion: eduDirOcupacion(acc.min, capacidadMin),
      citas: acc.citas,
    };
  });

  const conHorario = usoSillones.filter((s) => s.capacidadMin !== null);
  const capacidadMin = conHorario.reduce((a, s) => a + (s.capacidadMin ?? 0), 0);
  // 🔴 El numerador de la ocupación son SOLO los sillones con horario: si
  // se sumaran las horas de los que no lo tienen sobre una capacidad que no
  // los incluye, la ocupación podría pasar del 100 % sin que nadie
  // entendiera por qué.
  const usadosConHorario = conHorario.reduce((a, s) => a + s.usadosMin, 0);
  const sillonesSinHorario = usoSillones.length - conHorario.length;
  if (sillonesSinHorario > 0) {
    avisos.push(
      `${sillonesSinHorario} ${sillonesSinHorario === 1 ? "sillón no tiene" : "sillones no tienen"} horario capturado, así que no entran en la ocupación: sin horario un sillón está "siempre abierto" y no hay contra qué dividir. Captúralo en Sillones.`,
    );
  }

  const noShow = citasV.filter((c) => c.status === "NO_SHOW").length;
  const canceladas = citasV.filter((c) => c.status === "CANCELLED").length;

  // ── §3 · Por especialidad ────────────────────────────────────────────
  const alumnosPorPrograma = agrupar(evaluacion.rows, (r) => r.programId);
  const enClinicaHoy = new Map<string, Set<string>>();
  for (const c of citasHoy) {
    const p = c.student?.programId;
    if (!p) continue;
    const set = enClinicaHoy.get(p) ?? new Set<string>();
    set.add(c.studentId);
    enClinicaHoy.set(p, set);
  }

  const pacientesPorPrograma = new Map<string, Set<string>>();
  for (const c of completadas) {
    const p = c.student?.programId;
    if (!p) continue;
    const set = pacientesPorPrograma.get(p) ?? new Set<string>();
    set.add(c.patientId);
    pacientesPorPrograma.set(p, set);
  }

  const nombrePrograma = new Map<string, string>();
  for (const p of programas) nombrePrograma.set(p.id, p.name);
  for (const r of evaluacion.rows) {
    if (!nombrePrograma.has(r.programId)) nombrePrograma.set(r.programId, r.programName);
  }

  const todasLasFilas: EduDirEspecialidadRow[] = Array.from(nombrePrograma.entries())
    .map(([id, name]) => {
      const suyos = (alumnosPorPrograma.get(id) ?? []).filter((r) => r.status === "ACTIVE");
      // 🔴 DOS CUENTAS Y NO UNA. La BARRA se saca de todos los alumnos
      // activos; el SEMÁFORO, solo de los MEDIBLES (los de una generación
      // con fechas). Mezclarlos haría que un alumno cuya generación nadie
      // fechó —que la Ola 6 devuelve con `esperados: 0` y sus `totales`
      // completos— arrastrara a su especialidad entera hacia "ATRASADO"
      // por un dato administrativo, y ese rojo se lo enseñaría alguien a
      // un grupo de alumnos.
      const medibles = suyos.filter((r) => r.fraccion !== null);
      const agregado = eduDirEstadoAgregado({
        hechos: suyos.reduce((a, r) => a + r.hechos, 0),
        totales: suyos.reduce((a, r) => a + r.totales, 0),
        hechosMedibles: medibles.reduce((a, r) => a + r.hechos, 0),
        esperados: medibles.reduce((a, r) => a + r.esperados, 0),
        totalesMedibles: medibles.reduce((a, r) => a + r.totales, 0),
        medibles: medibles.length,
      });
      return {
        programId: id,
        programName: name,
        alumnos: suyos.length,
        enClinicaHoy: enClinicaHoy.get(id)?.size ?? 0,
        pacientes: pacientesPorPrograma.get(id)?.size ?? 0,
        cobradoCents: cobradoPorPrograma.get(id) ?? 0,
        avance: agregado.avance,
        esperado: agregado.esperado,
        estado: agregado.estado,
        motivo: agregado.motivo,
      };
    })
    .sort((a, b) => a.programName.localeCompare(b.programName, "es"));

  // Con una especialidad elegida la tabla ensena UNA fila: las otras
  // saldrian en cero y se leerian como "esta especialidad no hizo nada".
  const especialidades = programId
    ? todasLasFilas.filter((e) => e.programId === programId)
    : todasLasFilas;

  // ── §4 · Alumnos ─────────────────────────────────────────────────────
  const actividadPorAlumno = new Map<string, { pacientes: Set<string>; citas: number; min: number }>();
  for (const c of completadas) {
    const acc = actividadPorAlumno.get(c.studentId) ?? {
      pacientes: new Set<string>(),
      citas: 0,
      min: 0,
    };
    acc.pacientes.add(c.patientId);
    acc.citas += 1;
    acc.min += eduAppointmentMinutes(c).minutes;
    actividadPorAlumno.set(c.studentId, acc);
  }

  const fichaAlumno = new Map(evaluacion.rows.map((r) => [r.studentId, r]));
  const masActivos: EduDirAlumnoRow[] = Array.from(actividadPorAlumno.entries())
    .map(([studentId, acc]) => {
      const f = fichaAlumno.get(studentId);
      return {
        studentId,
        studentName: f?.studentName ?? "Estudiante fuera de la lista",
        matricula: f?.matricula ?? "—",
        programName: f?.programName ?? "—",
        pacientes: acc.pacientes.size,
        citas: acc.citas,
        horasLabel: eduHoursLabel(acc.min),
        estado: f?.estado ?? null,
        motivo: f?.motivo ?? "",
      };
    })
    .sort((a, b) => b.pacientes - a.pacientes || b.citas - a.citas)
    .slice(0, EDU_DIR_TOP_ALUMNOS);

  const atrasados: EduDirAlumnoRow[] = evaluacion.rows
    // Ya vienen ordenadas de peor a mejor por la Ola 6: aquí solo se
    // recorta a los que hay que llamar.
    .filter((r) => r.estado === "ATRASADO" || r.estado === "VIGILAR")
    .slice(0, EDU_DIR_TOP_ALUMNOS)
    .map((r) => {
      const acc = actividadPorAlumno.get(r.studentId);
      return {
        studentId: r.studentId,
        studentName: r.studentName,
        matricula: r.matricula,
        programName: r.programName,
        pacientes: acc?.pacientes.size ?? 0,
        citas: acc?.citas ?? 0,
        horasLabel: r.hoursLabel,
        estado: r.estado,
        motivo: r.motivo,
      };
    });

  // ── §6 · Pendientes ──────────────────────────────────────────────────
  const sinCalificar = casosV.filter(
    (c) =>
      c.status === "COMPLETED" &&
      dentro(c.closedAt, ventana) &&
      calificacionVigente(c.grades) === null,
  ).length;

  const firmaMasViejaMin = eduDirMinutosDesde(firmas._min.requestedAt, now);

  // ── Las cuatro tarjetas ──────────────────────────────────────────────
  const tarjetas: EduDirCifra[] = [
    {
      detalle: "pacientes-atendidos",
      label: "Pacientes atendidos",
      value: String(pacientesAtendidos),
      raw: pacientesAtendidos,
      note: "Personas distintas con al menos una cita terminada.",
      semaforo: "NEUTRO",
      variacion: eduDirVariacion(pacientesAtendidos, pacientesAtendidosPrev),
      sub: null,
    },
    {
      detalle: "casos-abiertos",
      label: "Tratamientos iniciados",
      value: String(iniciados),
      raw: iniciados,
      note: "Casos abiertos dentro del periodo.",
      semaforo: "NEUTRO",
      variacion: eduDirVariacion(iniciados, iniciadosPrev),
      sub: {
        detalle: "casos-cerrados",
        label: "terminados",
        value: String(terminados),
        raw: terminados,
        note: "Casos cerrados como terminados.",
        semaforo: "NEUTRO",
        variacion: eduDirVariacion(terminados, terminadosPrev),
        sub: null,
      },
    },
    {
      detalle: "tamizajes",
      label: "Tamizajes",
      value: String(tamizajes),
      raw: tamizajes,
      note: "Valoraciones iniciales terminadas: por ahí entra un paciente.",
      semaforo: "NEUTRO",
      variacion: eduDirVariacion(tamizajes, tamizajesPrev),
      sub: null,
    },
    {
      detalle: "cobros",
      label: "Cobrado",
      value: eduMoney(cobradoCents),
      raw: cobradoCents,
      note: "Pagos menos devoluciones, por la fecha del pago.",
      semaforo: "NEUTRO",
      variacion: eduDirVariacion(cobradoCents, cobradoPrevCents),
      sub: null,
    },
  ];

  return {
    ventana,
    institucion: ctx.institutionName,
    sede: ctx.campusLabel,
    especialidadId: programId,
    especialidadNombre: programId ? nombrePrograma.get(programId) ?? null : null,
    tarjetas,
    opciones: programas.map((p) => ({ id: p.id, name: p.name })),
    especialidades,
    cobradoSinCaso,
    masActivos,
    atrasados,
    dinero: {
      cobradoCents,
      cobradoPrevCents,
      emitidoCents,
      pendienteCents,
      cobros: vivos.length,
      publicoCents,
      alumnoCents,
      controlCents,
      controlCount,
      inversoCents,
      inversoCount,
      sinListaCents,
      sinListaCount,
      ticketPromedioCents: vivos.length > 0 ? Math.round(emitidoCents / vivos.length) : null,
      porSillonCents: sillonesActivos > 0 ? Math.round(cobradoCents / sillonesActivos) : null,
      sillonesActivos,
    },
    pendientes: {
      firmas: firmas._count._all,
      firmaMasViejaMin,
      pacientesSinAlumno: sinAlumno,
      calificacionesSinRegistrar: sinCalificar,
      alumnosSinDocente: sinDocente,
    },
    uso: {
      ocupacion: eduDirOcupacion(usadosConHorario, capacidadMin > 0 ? capacidadMin : null),
      usadosMin: minutosTotales,
      capacidadMin: capacidadMin > 0 ? capacidadMin : null,
      libresMin: capacidadMin > 0 ? Math.max(0, capacidadMin - usadosConHorario) : null,
      sillonesSinHorario,
      citasPerdidas: noShow + canceladas,
      noShow,
      canceladas,
      duracionPromedioMin:
        citasConMinutos > 0 ? Math.round(minutosTotales / citasConMinutos) : null,
      sillones: usoSillones
        .slice()
        .sort((a, b) => (a.ocupacion ?? 2) - (b.ocupacion ?? 2) || a.number - b.number),
    },
    avisos,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 2-BIS · EL INICIO DE LA DIRECCIÓN: TRES SERIES POR DÍA
//
// 🔴 ES EL MISMO TABLERO, PARTIDO POR DÍA. Vive en este archivo y no en
// uno nuevo porque las tres gráficas contestan preguntas que las tarjetas
// de arriba ya contestan: pacientes atendidos y dinero cobrado son
// literalmente dos de las cuatro. Un módulo aparte con su propio `where`
// habría sido un segundo sitio donde decidir qué es "cobrado", y el día
// que los dos discrepen —y discrepan— la dirección deja de creerle a los
// dos.
//
// Lo que se comparte, y no por comodidad:
//   · el ALCANCE  → eduDirAlcance(), que NIEGA a quien no ve la clínica
//     entera (la regla vive en visibility.ts) y recorta por sede;
//   · la VENTANA  → eduDirVentana(), con su periodo anterior pegado por la
//     izquierda y del mismo largo;
//   · los TOPES   → EDU_DIR_MAX_CITAS y EDU_DIR_MAX_FILAS, con el mismo
//     aviso cuando se alcanzan;
//   · la VARIACIÓN→ eduDirVariacion(), que NO inventa un porcentaje
//     cuando el periodo anterior fue cero.
//
// 🔴 Y LO QUE NO SE COMPARTE, DICHO AQUÍ PARA QUE NO SE DESCUBRA TARDE:
//
//   1. El Inicio NO filtra por especialidad. Es la portada de la escuela
//      entera; el desglose por especialidad es una herramienta de análisis
//      y vive en /instituto/direccion, con su exportación al lado. Meter
//      aquí un segundo selector sería pedirle a quien acaba de entrar que
//      configure algo antes de leer nada.
//   2. Las AUTORIZACIONES no se recortan por sede, y la pantalla lo dice.
//      Una autorización cuelga de un CASO, y en la Ola 11 lo académico
//      —alumnos, casos, pacientes— NO se divide por campus: un alumno rota
//      entre sedes y su expediente es uno solo. Derivarle una sede por el
//      sillón de alguna de sus citas sería inventarla (un caso puede tener
//      citas en dos edificios). Es la misma decisión que ya toma la
//      tarjeta "esperando firma" del tablero de Dirección.
// ═══════════════════════════════════════════════════════════════════════

/** Los estados de una cita que ocupan la agenda de hoy. */
const CITAS_DE_HOY_STATUSES = EDU_BUSY_STATUSES;

export async function getEduDireccionInicio(
  ctx: EduDirContext,
  filtros: EduDirFiltrosCrudos,
  now: Date = new Date(),
): Promise<EduDirInicio> {
  // 🔴 PRIMERA LÍNEA Y NO LA ÚLTIMA: esto es lo que impide que un DOCENTE,
  // un ALUMNO o CAJA que teclee /instituto/inicio reciba el dinero de la
  // escuela. Lanza EduPadronError 403 con su motivo.
  const alcance = eduDirAlcance(ctx, now);
  const institutionId = alcance.institutionId;
  const tz = alcance.timeZone;

  const periodo = parseEduDirInicioPeriodo(filtros?.periodo);
  const ventana = eduDirVentana({ periodo }, tz, now);
  const avisos: string[] = [];
  if (ventana.aviso) avisos.push(ventana.aviso);

  const enPeriodo = { gte: ventana.from, lt: ventana.to };
  const enPrevio = { gte: ventana.prevFrom, lt: ventana.prevTo };
  const hoyISO = eduTodayISO(tz, now);
  const diaHoy = eduDayRange(hoyISO, tz, 1);

  // ── Grupo 1 · las tres series y sus periodos anteriores ──────────────
  // Seis promesas (el tope del repo es siete). Las de "anterior" traen lo
  // MÍNIMO para un solo número: un count o un groupBy, nunca las filas.
  const [citas, citasPrev, pagos, pagosPrev, firmadas, firmadasPrev] = await Promise.all([
    // 🔴 La ventana se aplica sobre `startsAt`, igual que en el tablero,
    // y el día de la barra sale de ESA MISMA columna. Repartir por
    // `completedAt` metería en la gráfica una cita que empezó dentro del
    // periodo y se cerró fuera, o al revés — y entonces la suma de las
    // barras no sería el total de arriba.
    prisma.eduAppointment.findMany({
      where: { ...alcance.citas(), status: "COMPLETED", startsAt: enPeriodo },
      take: EDU_DIR_MAX_CITAS + 1,
      select: { patientId: true, startsAt: true },
    }),
    prisma.eduAppointment.findMany({
      where: { ...alcance.citas(), status: "COMPLETED", startsAt: enPrevio },
      take: EDU_DIR_MAX_CITAS + 1,
      // Del periodo anterior solo hace falta CUÁNTAS PERSONAS distintas.
      select: { patientId: true },
    }),
    // El dinero se trae por filas —y no con el `groupBy` del tablero—
    // porque aquí hay que repartirlo por día, y Postgres no puede agrupar
    // por "día en la zona del instituto" sin SQL crudo; y el SQL crudo se
    // saltaría los `where` de visibility.ts, que es justo lo que no se
    // hace en este vertical. Con el mismo tope que los cobros.
    prisma.eduPayment.findMany({
      where: { ...alcance.pagos, paidAt: enPeriodo, ...pagoCharge(alcance, null) },
      take: EDU_DIR_MAX_FILAS + 1,
      select: { paidAt: true, amountCents: true, isRefund: true },
    }),
    // El anterior sí se suma en Postgres: es UN número y no se pinta.
    prisma.eduPayment.groupBy({
      by: ["isRefund"],
      where: { ...alcance.pagos, paidAt: enPrevio, ...pagoCharge(alcance, null) },
      _sum: { amountCents: true },
    }),
    // 🔴 AUTORIZACIONES FIRMADAS, por la fecha de la DECISIÓN. `status`
    // APPROVED y no "tiene firma": una que caducó (EXPIRED, el contenido
    // cambió después de firmarse) ya no autoriza nada, y contarla diría
    // que ese tratamiento sigue autorizado cuando no lo está.
    prisma.eduCaseApproval.findMany({
      where: { institutionId, status: "APPROVED", decidedAt: enPeriodo },
      take: EDU_DIR_MAX_FILAS + 1,
      select: { decidedAt: true },
    }),
    prisma.eduCaseApproval.count({
      where: { institutionId, status: "APPROVED", decidedAt: enPrevio },
    }),
  ]);

  // ── Grupo 2 · lo que está esperando ──────────────────────────────────
  // Tres consultas, todas de CONTEO: este bloque son accesos, no listas.
  const [firmasPendientes, citasHoy, porCobrar] = await Promise.all([
    // count + la más vieja en UNA consulta, igual que el tablero: dos
    // serían dos viajes para pintar la misma tarjeta.
    prisma.eduCaseApproval.aggregate({
      where: { institutionId, status: "PENDING" },
      _count: { _all: true },
      _min: { requestedAt: true },
    }),
    prisma.eduAppointment.count({
      where: {
        ...alcance.citas(),
        ...(diaHoy ? { startsAt: { gte: diaHoy.from, lt: diaHoy.to } } : {}),
        status: { in: CITAS_DE_HOY_STATUSES },
      },
    }),
    // 🔴 EL SALDO VIVO, NO EL DEL PERIODO. "Por cobrar" es lo que la
    // escuela tiene sin cobrar HOY, venga de cuando venga: recortarlo al
    // periodo escondería justo la deuda vieja, que es la que importa.
    //
    // Se excluye CANCELLED además de exigir saldo > 0. Anular un cobro
    // deja el saldo en cero (lo dice el esquema), así que la segunda
    // condición sobra… mientras nadie escriba una fila que se salte esa
    // regla. Si alguien la escribe, esto no la cuenta como dinero por
    // cobrar en vez de sumarla en silencio.
    prisma.eduCharge.aggregate({
      where: { ...alcance.cobros, status: { not: "CANCELLED" }, balanceCents: { gt: 0 } },
      _sum: { balanceCents: true },
      _count: { _all: true },
    }),
  ]);

  // ── Topes ────────────────────────────────────────────────────────────
  const citasCortadas = citas.length > EDU_DIR_MAX_CITAS;
  const pagosCortados = pagos.length > EDU_DIR_MAX_FILAS;
  const firmasCortadas = firmadas.length > EDU_DIR_MAX_FILAS;
  const citasV = citasCortadas ? citas.slice(0, EDU_DIR_MAX_CITAS) : citas;
  const pagosV = pagosCortados ? pagos.slice(0, EDU_DIR_MAX_FILAS) : pagos;
  const firmadasV = firmasCortadas ? firmadas.slice(0, EDU_DIR_MAX_FILAS) : firmadas;

  if (citasCortadas) {
    avisos.push(
      `El periodo tiene más de ${EDU_DIR_MAX_CITAS.toLocaleString("es-MX")} citas y la gráfica de pacientes se hizo con las primeras. Cambia a la semana para que los totales sean exactos.`,
    );
  }
  if (pagosCortados || firmasCortadas) {
    avisos.push(
      `El periodo tiene más de ${EDU_DIR_MAX_FILAS.toLocaleString("es-MX")} pagos o autorizaciones y las gráficas se hicieron con los primeros. Cambia a la semana para que los totales sean exactos.`,
    );
  }

  // ── Serie 1 · pacientes atendidos ────────────────────────────────────
  // 🔴 PERSONAS DISTINTAS, y por eso hay un Set POR DÍA y otro del periodo
  // entero. Quien vino el lunes y el jueves cuenta uno el lunes, uno el
  // jueves y UNO en el total: las barras no suman el total, y la pantalla
  // lo dice en vez de dejar que alguien las sume a mano y le salga otra
  // cosa. El total es el MISMO número que la tarjeta "Pacientes
  // atendidos" del tablero de Dirección, que se calcula igual.
  const pacientesPorDia = new Map<string, Set<string>>();
  const pacientesDelPeriodo = new Set<string>();
  for (const c of citasV) {
    pacientesDelPeriodo.add(c.patientId);
    const dia = eduDirDiaDe(c.startsAt, tz);
    if (!dia) continue;
    const set = pacientesPorDia.get(dia) ?? new Set<string>();
    set.add(c.patientId);
    pacientesPorDia.set(dia, set);
  }
  const pacientesValores = new Map<string, number>();
  pacientesPorDia.forEach((set, dia) => pacientesValores.set(dia, set.size));

  const serviciosPuntos = eduDirPuntosPorDia(ventana.desdeISO, ventana.dias, pacientesValores);
  const pacientesSerie = eduDirArmarSerie({
    key: "pacientes",
    titulo: "Pacientes atendidos",
    detalle: "Personas distintas con una cita TERMINADA ese día.",
    unidad: "conteo",
    puntos: serviciosPuntos,
    total: pacientesDelPeriodo.size,
    anterior: new Set(citasPrev.map((c) => c.patientId)).size,
    nota:
      "Las barras no suman el total: quien vino dos días cuenta en los dos días y una sola " +
      "vez en el total, porque la cifra cuenta personas y no visitas.",
  });

  // ── Serie 2 · dinero cobrado ─────────────────────────────────────────
  // Pagos MENOS devoluciones, por la fecha del PAGO — la misma definición
  // que la tarjeta "Cobrado" del tablero. Un día puede salir negativo si
  // se devolvió más de lo que entró, y se pinta así: taparlo en cero
  // escondería el único día que hay que ir a mirar.
  const cobradoValores = new Map<string, number>();
  let cobradoCents = 0;
  for (const p of pagosV) {
    const monto = p.isRefund ? -p.amountCents : p.amountCents;
    cobradoCents += monto;
    const dia = eduDirDiaDe(p.paidAt, tz);
    if (!dia) continue;
    cobradoValores.set(dia, (cobradoValores.get(dia) ?? 0) + monto);
  }
  const cobradoSerie = eduDirArmarSerie({
    key: "cobrado",
    titulo: "Dinero cobrado",
    detalle: "Lo que ENTRÓ a caja ese día, menos las devoluciones.",
    unidad: "dinero",
    puntos: eduDirPuntosPorDia(ventana.desdeISO, ventana.dias, cobradoValores),
    total: cobradoCents,
    anterior: neto(pagosPrev),
    nota:
      "Son pagos REALES, no cobros emitidos: un ticket de hoy que se paga la semana que viene " +
      "entra en el día en que se paga. Lo emitido y lo que falta por cobrar están en Dirección.",
  });

  // ── Serie 3 · tratamientos autorizados ───────────────────────────────
  const autorizadasValores = new Map<string, number>();
  for (const f of firmadasV) {
    const dia = eduDirDiaDe(f.decidedAt, tz);
    if (!dia) continue;
    autorizadasValores.set(dia, (autorizadasValores.get(dia) ?? 0) + 1);
  }
  const autorizacionesSerie = eduDirArmarSerie({
    key: "autorizaciones",
    titulo: "Tratamientos autorizados",
    detalle: "Autorizaciones que un docente FIRMÓ ese día (plan, procedimiento, sesión o alta).",
    unidad: "conteo",
    puntos: eduDirPuntosPorDia(ventana.desdeISO, ventana.dias, autorizadasValores),
    total: firmadasV.length,
    anterior: firmadasPrev,
    nota: ctx.campusLabel
      ? "Esta gráfica es del INSTITUTO ENTERO aunque arriba haya una sede elegida: una " +
        "autorización cuelga de un caso, y un caso no es de una sede — el estudiante rota " +
        "entre edificios y su expediente es uno solo."
      : "",
  });

  // ── Lo que está esperando ────────────────────────────────────────────
  const firmasCount = firmasPendientes._count._all ?? 0;
  const firmaMasViejaMin = eduDirMinutosDesde(firmasPendientes._min.requestedAt, now);
  const saldoCents = porCobrar._sum.balanceCents ?? 0;
  const saldoCobros = porCobrar._count._all ?? 0;

  const esperando: EduDirInicioAcceso[] = [
    {
      key: "firmas",
      titulo: "Autorizaciones sin firmar",
      valor: String(firmasCount),
      raw: firmasCount,
      detalle:
        firmasCount === 0
          ? "No hay ninguna esperando decisión de un docente."
          : `${firmasCount === 1 ? "Una autorización espera" : `${firmasCount} autorizaciones esperan`} la decisión de un docente. La más vieja lleva ${eduDirEsperaLabel(firmaMasViejaMin)}.`,
      href: "/instituto/autorizaciones",
      semaforo: eduDirSemaforoDeFirmas(firmasCount, firmaMasViejaMin),
    },
    {
      key: "citas-hoy",
      titulo: "Citas de hoy",
      valor: String(citasHoy),
      raw: citasHoy,
      detalle:
        citasHoy === 0
          ? "Hoy no hay ninguna cita agendada."
          : `Agendadas para hoy y todavía en pie (sin contar canceladas ni ausencias). ${eduFormatDayLong(hoyISO)}.`,
      href: "/instituto/agenda",
      semaforo: "NEUTRO",
    },
    {
      key: "por-cobrar",
      titulo: "Por cobrar",
      valor: eduMoney(saldoCents),
      raw: saldoCents,
      detalle:
        saldoCobros === 0
          ? "No queda ningún cobro con saldo."
          : `Saldo vivo de ${saldoCobros.toLocaleString("es-MX")} ${saldoCobros === 1 ? "cobro" : "cobros"}, de cualquier fecha — no solo del periodo de arriba.`,
      href: "/instituto/caja",
      semaforo: "NEUTRO",
    },
  ];

  return {
    ventana,
    periodo,
    institucion: ctx.institutionName,
    sede: ctx.campusLabel,
    series: [pacientesSerie, cobradoSerie, autorizacionesSerie],
    esperando,
    avisos,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LA LISTA QUE HAY DETRÁS DE CADA CIFRA
//
// 🔴 MISMO ALCANCE Y MISMOS FILTROS QUE LA PANTALLA. Un endpoint de detalle
// es exactamente el sitio donde se olvida el recorte —"total, es una
// listita"—, así que arma sus `where` con las mismas funciones de
// visibility.ts y con la misma ventana.
// ═══════════════════════════════════════════════════════════════════════

export async function getEduDireccionDetalle(
  ctx: EduDirContext,
  key: EduDirDetalleKey,
  filtros: EduDirFiltrosCrudos,
  now: Date = new Date(),
): Promise<EduDirDetallePage> {
  const alcance = eduDirAlcance(ctx, now);
  const institutionId = alcance.institutionId;
  const tz = alcance.timeZone;
  const ventana = eduDirVentana(filtros, tz, now);
  const programId = eduCleanId(filtros?.especialidad);
  const enPeriodo = { gte: ventana.from, lt: ventana.to };
  const porAlumno = programId ? { programId } : undefined;

  const base = {
    key,
    titulo: EDU_DIR_DETALLE_TITULOS[key],
    detalle: EDU_DIR_DETALLE_DETALLES[key],
  };

  switch (key) {
    case "pacientes-atendidos": {
      // 🔴 SE CONSULTA LA TABLA DE PACIENTES, no la de citas. La cifra
      // cuenta PERSONAS ("quien vino tres veces cuenta una"), así que la
      // lista tiene que salir de una fila por persona: deduplicar citas
      // después del `take` daría una lista más corta que la cifra, y
      // entonces el director la cuenta a mano y le sale otro número.
      const filas = await prisma.eduPatient.findMany({
        where: {
          ...alcance.pacientes,
          appointments: {
            some: {
              institutionId,
              status: "COMPLETED",
              startsAt: enPeriodo,
              ...(porAlumno ? { student: porAlumno } : {}),
            },
          },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        take: EDU_DIR_MAX_DETALLE + 1,
        select: {
          id: true,
          folio: true,
          firstName: true,
          lastName: true,
          phone: true,
          referredByStudentId: true,
          _count: {
            select: {
              appointments: {
                where: { institutionId, status: "COMPLETED", startsAt: enPeriodo },
              },
            },
          },
        },
      });

      return pagina(base, filas, EDU_DIR_MAX_DETALLE, (p) => ({
        id: p.id,
        titulo: `${persona(p)} · ${p.folio}`,
        sub: p.phone ? `Tel. ${p.phone}` : "Sin teléfono capturado",
        campos: [
          { k: "Citas en el periodo", v: String(p._count.appointments) },
          { k: "Origen", v: p.referredByStudentId ? "Lo trajo un estudiante" : "Llegó solo" },
        ],
        href: `/instituto/pacientes/${p.id}`,
        semaforo: "NEUTRO",
      }));
    }

    case "citas-completadas":
    case "tamizajes":
    case "citas-perdidas": {
      const where: Prisma.EduAppointmentWhereInput = {
        ...alcance.citas(porAlumno),
        startsAt: enPeriodo,
        ...(key === "citas-perdidas"
          ? { status: { in: ["CANCELLED", "NO_SHOW"] as EduAppointmentStatus[] } }
          : { status: "COMPLETED" as EduAppointmentStatus }),
        ...(key === "tamizajes" ? { type: "TAMIZAJE" as const } : {}),
      };
      const filas = await prisma.eduAppointment.findMany({
        where,
        orderBy: [{ startsAt: "desc" }],
        take: EDU_DIR_MAX_DETALLE + 1,
        select: {
          id: true,
          patientId: true,
          startsAt: true,
          endsAt: true,
          status: true,
          type: true,
          checkedInAt: true,
          startedAt: true,
          completedAt: true,
          patient: { select: { firstName: true, lastName: true, folio: true } },
          student: {
            select: { user: { select: { firstName: true, lastName: true } }, matricula: true },
          },
          chair: { select: { name: true, number: true } },
        },
      });

      return pagina(base, filas, EDU_DIR_MAX_DETALLE, (a) => ({
        id: a.id,
        titulo: `${persona(a.patient)} · ${a.patient.folio}`,
        sub: `${persona(a.student.user)} (${a.student.matricula}) · Sillón ${a.chair.number}`,
        campos: [
          { k: "Cuándo", v: `${fecha(a.startsAt, tz)} ${eduFormatTime(a.startsAt, tz)}` },
          { k: "Estado", v: EDU_APPOINTMENT_STATUS_LABELS[a.status as EduAppointmentStatus] },
          { k: "Duró", v: eduHoursLabel(eduAppointmentMinutes(a).minutes) },
        ],
        href: `/instituto/pacientes/${a.patientId}`,
        semaforo: a.status === "NO_SHOW" || a.status === "CANCELLED" ? "VIGILAR" : "NEUTRO",
      }));
    }

    case "casos-abiertos":
    case "casos-cerrados":
    case "calificaciones-pendientes": {
      const where: Prisma.EduCaseWhereInput = {
        ...alcance.casos,
        ...(programId ? { programId } : {}),
        ...(key === "casos-abiertos"
          ? { openedAt: enPeriodo }
          : { status: "COMPLETED" as const, closedAt: enPeriodo }),
        // 🔴 El filtro va en la BASE y no después del `take`: filtrar 200
        // filas ya traídas daría una lista más corta que la cifra.
        //
        // "Sin calificación vigente" y "sin ninguna calificación" son lo
        // mismo, y conviene saber por qué: la vigente es la fila que nadie
        // corrige (Ola 6), y en una cadena g1 ← g2 la última nunca está
        // corregida. Así que un caso con calificaciones SIEMPRE tiene una
        // vigente, y el único caso sin vigente es el que no tiene ninguna.
        ...(key === "calificaciones-pendientes" ? { grades: { none: {} } } : {}),
      };
      const filas = await prisma.eduCase.findMany({
        where,
        orderBy: key === "casos-abiertos" ? [{ openedAt: "desc" }] : [{ closedAt: "desc" }],
        take: EDU_DIR_MAX_DETALLE + 1,
        select: {
          id: true,
          patientId: true,
          status: true,
          openedAt: true,
          closedAt: true,
          patient: { select: { firstName: true, lastName: true, folio: true } },
          student: {
            select: { user: { select: { firstName: true, lastName: true } }, matricula: true },
          },
          program: { select: { name: true } },
          grades: { select: { id: true, correctsId: true } },
        },
      });

      return pagina(base, filas, EDU_DIR_MAX_DETALLE, (c) => ({
        id: c.id,
        titulo: `${persona(c.patient)} · ${c.patient.folio}`,
        sub: `${c.program.name} · ${persona(c.student.user)} (${c.student.matricula})`,
        campos: [
          { k: "Estado", v: EDU_CASE_STATUS_LABELS[c.status] },
          { k: "Abierto", v: fecha(c.openedAt, tz) },
          { k: "Cerrado", v: c.closedAt ? fecha(c.closedAt, tz) : "—" },
        ],
        href: `/instituto/pacientes/${c.patientId}/casos`,
        semaforo: key === "calificaciones-pendientes" ? "VIGILAR" : "NEUTRO",
      }));
    }

    case "cobros":
    case "cobrado-publico":
    case "cobrado-alumno":
    case "control-tarifa":
    case "control-inverso":
    case "pendiente-cobro": {
      const listasDeAlumno = await listasConReglaDeAlumno(institutionId);
      const where: Prisma.EduChargeWhereInput = {
        ...alcance.cobros,
        ...(programId ? { case: { is: { programId } } } : {}),
        chargedAt: enPeriodo,
        status: { not: "CANCELLED" },
        ...(key === "cobrado-publico" || key === "control-tarifa"
          ? { patient: { referredByStudentId: null } }
          : {}),
        ...(key === "cobrado-alumno" || key === "control-inverso"
          ? { patient: { referredByStudentId: { not: null } } }
          : {}),
        ...(key === "pendiente-cobro" ? { balanceCents: { gt: 0 } } : {}),
        ...(key === "control-tarifa" && listasDeAlumno.size > 0
          ? { feeScheduleId: { in: Array.from(listasDeAlumno) } }
          : {}),
        ...(key === "control-inverso" && listasDeAlumno.size > 0
          ? { feeScheduleId: { notIn: Array.from(listasDeAlumno) } }
          : {}),
      };

      const filas = await prisma.eduCharge.findMany({
        where,
        orderBy: [{ chargedAt: "desc" }],
        take: EDU_DIR_MAX_DETALLE + 1,
        select: {
          id: true,
          folio: true,
          totalCents: true,
          balanceCents: true,
          status: true,
          chargedAt: true,
          feeScheduleId: true,
          feeScheduleLabel: true,
          patientId: true,
          patient: {
            select: { firstName: true, lastName: true, folio: true, referredByStudentId: true },
          },
        },
      });

      // Los cobros SIN lista guardada no se pueden clasificar: se quedan
      // fuera de los dos controles en vez de contarse como "correctos".
      const usadas =
        key === "control-tarifa" || key === "control-inverso"
          ? filas.filter((c) => Boolean(c.feeScheduleId))
          : filas;

      const alarma = key === "control-tarifa" || key === "control-inverso";
      return pagina(base, usadas, EDU_DIR_MAX_DETALLE, (c) => ({
        id: c.id,
        titulo: `${c.folio} · ${persona(c.patient)}`,
        sub: c.feeScheduleLabel
          ? `Lista aplicada: ${c.feeScheduleLabel}`
          : "Sin lista guardada: no se puede clasificar",
        campos: [
          { k: "Total", v: eduMoney(c.totalCents) },
          { k: "Saldo", v: eduMoney(c.balanceCents) },
          {
            k: "Origen del paciente",
            v: c.patient.referredByStudentId ? "Lo trajo un estudiante" : "Llegó solo",
          },
        ],
        href: `/instituto/pacientes/${c.patientId}`,
        semaforo: alarma ? (key === "control-tarifa" ? "ACTUAR" : "VIGILAR") : "NEUTRO",
      }));
    }

    case "firmas-pendientes": {
      const filas = await prisma.eduCaseApproval.findMany({
        where: {
          institutionId,
          status: "PENDING",
          ...(programId ? { case: { programId } } : {}),
        },
        orderBy: [{ requestedAt: "asc" }],
        take: EDU_DIR_MAX_DETALLE + 1,
        select: {
          id: true,
          stage: true,
          requestedAt: true,
          isEmergency: true,
          case: {
            select: {
              id: true,
              patientId: true,
              patient: { select: { firstName: true, lastName: true, folio: true } },
              program: { select: { name: true } },
              student: {
                select: { matricula: true, user: { select: { firstName: true, lastName: true } } },
              },
            },
          },
        },
      });

      return pagina(base, filas, EDU_DIR_MAX_DETALLE, (a) => {
        const min = eduDirMinutosDesde(a.requestedAt, now);
        return {
          id: a.id,
          titulo: `${persona(a.case.patient)} · ${a.case.patient.folio}`,
          sub: `${a.case.program.name} · ${persona(a.case.student.user)} (${a.case.student.matricula})`,
          campos: [
            { k: "Etapa", v: etapaLabel(a.stage) },
            { k: "Esperando", v: eduDirEsperaLabel(min) },
            { k: "Urgencia", v: a.isEmergency ? "Marcada como urgencia" : "—" },
          ],
          href: "/instituto/autorizaciones",
          semaforo:
            min !== null && min >= EDU_DIR_FIRMA_VIEJA_MIN ? "ACTUAR" : "VIGILAR",
        };
      });
    }

    case "pacientes-sin-alumno": {
      const filas = await prisma.eduPatient.findMany({
        where: {
          ...alcance.pacientes,
          status: { in: ["NEW", "ACTIVE"] },
          cases: { none: { institutionId, status: { notIn: EDU_CASE_CLOSED_STATUSES } } },
          appointments: {
            none: { institutionId, startsAt: { gte: now }, status: { in: EDU_BUSY_STATUSES } },
          },
        },
        orderBy: [{ createdAt: "desc" }],
        take: EDU_DIR_MAX_DETALLE + 1,
        select: {
          id: true,
          folio: true,
          firstName: true,
          lastName: true,
          phone: true,
          status: true,
          createdAt: true,
          referredByStudentId: true,
        },
      });

      return pagina(base, filas, EDU_DIR_MAX_DETALLE, (p) => ({
        id: p.id,
        titulo: `${persona(p)} · ${p.folio}`,
        sub: p.phone ? `Tel. ${p.phone}` : "Sin teléfono capturado",
        campos: [
          { k: "Registrado", v: fecha(p.createdAt, tz) },
          { k: "Origen", v: p.referredByStudentId ? "Lo trajo un estudiante" : "Llegó solo" },
          { k: "Estado", v: EDU_PATIENT_STATUS_LABELS[p.status as EduPatientStatus] },
        ],
        href: `/instituto/pacientes/${p.id}`,
        semaforo: "VIGILAR",
      }));
    }

    case "alumnos-sin-docente": {
      const filas = await prisma.eduStudent.findMany({
        where: {
          ...alcance.alumnos,
          status: "ACTIVE",
          ...(programId ? { programId } : {}),
          supervisors: { none: { institutionId, ...eduCurrentAssignmentWhere(now) } },
        },
        orderBy: [{ matricula: "asc" }],
        take: EDU_DIR_MAX_DETALLE + 1,
        select: {
          id: true,
          matricula: true,
          semester: true,
          user: { select: { firstName: true, lastName: true, email: true } },
          program: { select: { name: true } },
          cohort: { select: { name: true } },
        },
      });

      return pagina(base, filas, EDU_DIR_MAX_DETALLE, (s) => ({
        id: s.id,
        titulo: `${persona(s.user)} · ${s.matricula}`,
        sub: `${s.program.name} · ${s.cohort.name}`,
        campos: [
          { k: "Semestre", v: String(s.semester) },
          { k: "Correo", v: s.user.email },
          { k: "Qué falta", v: "Asignarle un docente supervisor" },
        ],
        href: "/instituto/docentes",
        semaforo: "ACTUAR",
      }));
    }

    default: {
      // El union está cerrado; esto solo se alcanza si alguien agrega una
      // key al catálogo y no la cablea aquí — y entonces tiene que verse.
      const nunca: never = key;
      throw new EduPadronError(`Esa lista no existe: ${String(nunca)}`, 400);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · AYUDAS
// ═══════════════════════════════════════════════════════════════════════

function persona(u: { firstName: string; lastName: string } | null | undefined): string {
  if (!u) return "—";
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || "—";
}

function fecha(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(d);
}

function agrupar<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const r of rows ?? []) {
    const k = key(r);
    const lista = map.get(k);
    if (lista) lista.push(r);
    else map.set(k, [r]);
  }
  return map;
}

function dentro(d: Date | null, v: EduDirVentana): boolean {
  return Boolean(d && d.getTime() >= v.from.getTime() && d.getTime() < v.to.getTime());
}

function dentroPrev(d: Date | null, v: EduDirVentana): boolean {
  return Boolean(d && d.getTime() >= v.prevFrom.getTime() && d.getTime() < v.prevTo.getTime());
}

/** Pagos − devoluciones, en centavos. El signo lo pone `isRefund`. */
function neto(grupos: { isRefund: boolean; _sum: { amountCents: number | null } }[]): number {
  let total = 0;
  for (const g of grupos ?? []) {
    const v = g._sum.amountCents ?? 0;
    total += g.isRefund ? -v : v;
  }
  return total;
}

/**
 * La calificación VIGENTE de un caso: la fila que nadie corrige.
 *
 * Es la regla de la Ola 6 aplicada a lo mínimo que hace falta aquí (saber
 * si HAY una). `eduCurrentGrade` de evaluacion-core devuelve la fila
 * completa y necesita más columnas; esto solo necesita las dos del enlace.
 */
function calificacionVigente(
  grades: { id: string; correctsId: string | null }[],
): { id: string } | null {
  const corregidas = new Set(
    (grades ?? []).map((g) => g.correctsId).filter((v): v is string => typeof v === "string"),
  );
  return (grades ?? []).find((g) => !corregidas.has(g.id)) ?? null;
}

/**
 * Los ids de las listas de precios cuya REGLA es "paciente de alumno".
 *
 * Es la mitad del control del dinero: sin esto no se puede saber si la
 * tarifa barata se aplicó a quien no le tocaba. Se leen las activas y las
 * inactivas a propósito — un cobro de hace tres semanas pudo aplicar una
 * lista que la dirección ya desactivó, y ese cobro sigue existiendo.
 */
async function listasConReglaDeAlumno(institutionId: string): Promise<Set<string>> {
  const listas = await prisma.eduFeeSchedule.findMany({
    where: { institutionId, rule: "REFERRED_BY_STUDENT" },
    select: { id: true },
  });
  return new Set(listas.map((l) => l.id));
}

/** Arma la página de detalle aplicando el tope y diciéndolo. */
function pagina<T>(
  base: { key: EduDirDetalleKey; titulo: string; detalle: string },
  filas: T[],
  max: number,
  map: (row: T) => EduDirDetalleFila,
): EduDirDetallePage {
  const truncated = filas.length > max;
  const visibles = truncated ? filas.slice(0, max) : filas;
  return {
    ...base,
    filas: visibles.map(map),
    total: visibles.length,
    truncated,
  };
}
