/**
 * DaleControl INSTITUCIONAL — Ola 12 · EL RESUMEN DE LA FICHA contra la
 * base de datos.
 *
 * SERVIDOR: importa prisma. Lo puro (qué bloque ve cada rol, qué es un
 * aviso) vive en resumen-core.ts; el recorte, en visibility.ts. Aquí solo
 * hay consultas — y NINGUNA arma su propio `where`: el de citas sale de
 * eduAppointmentScopeWhere, el de casos de eduCaseScopeWhere y el de
 * dinero de eduChargeScopeWhere. Un resumen que se saltara el punto único
 * le contaría a un alumno las visitas de otros alumnos, y el bug se vería
 * exactamente igual que "funciona".
 *
 * 🔴 EL DINERO NO SE CONSULTA cuando el alcance no es "all". No es un
 * `hidden` de pantalla: la consulta NO SE HACE, así el saldo de un
 * paciente jamás viaja en el payload RSC de un alumno (la lección del
 * P1-4: lo que llega al navegador ya se filtró en el servidor).
 *
 * 🔴 Promise.all CORTO a propósito (5 y 2, nunca cerca de 7): esta
 * pantalla cruza muchas tablas y es la primera de la ficha — una consulta
 * lenta aquí retrasa TODAS las visitas a la ficha.
 */
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import { eduCurrentAssignmentWhere } from "@/lib/edu/padron-core";
import {
  eduCleanId,
  eduFormatDayShort,
  eduFormatTime,
  eduSafeTimeZone,
  eduUtcToZoned,
} from "@/lib/edu/agenda-core";
import {
  eduAppointmentScopeWhere,
  eduCaseScopeWhere,
  eduChargeScopeWhere,
  eduPatientScopeWhere,
  eduScopeIsEmpty,
  type EduClinicaContext,
} from "@/lib/edu/visibility";
import {
  eduResumenAvisos,
  eduResumenScopes,
  eduResumenTimeline,
  eduResumenVeClinico,
  eduResumenVeDinero,
  type EduPatientResumenData,
  type EduResumenCita,
  type EduResumenEstudio,
  type EduResumenTimelineItem,
} from "@/lib/edu/resumen-core";
// Ola de Casos: la derivación de "qué espera el caso" es la MISMA de la
// pantalla global — dos derivaciones divergirían en un mes.
import { eduCasoEsperando } from "@/lib/edu/casos-core";
import { eduSignRead } from "@/lib/edu/storage";
import {
  EDU_CASE_CLOSED_STATUSES,
  EDU_PRESCRIPTION_STATUS_LABELS,
  EDU_STUDY_KIND_LABELS,
} from "@/lib/edu/types";

export type { EduPatientResumenData } from "@/lib/edu/resumen-core";

function requireInstitution(ctx: EduClinicaContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

function personName(u: { firstName: string; lastName: string; email?: string }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Sin nombre";
}

/** "lun 31 ago 09:30" en la zona del instituto. */
function stampLabel(d: Date, timeZone: string): string {
  const tz = eduSafeTimeZone(timeZone);
  const { dayISO } = eduUtcToZoned(d, tz);
  return `${eduFormatDayShort(dayISO)} ${eduFormatTime(d, tz)}`;
}

/** El `select` de las dos citas del resumen (última y próxima). */
const CITA_RESUMEN_SELECT = {
  startsAt: true,
  student: {
    select: { matricula: true, user: { select: { firstName: true, lastName: true, email: true } } },
  },
  chair: { select: { name: true, campus: { select: { name: true } } } },
  supervisor: { select: { firstName: true, lastName: true, email: true } },
} as const;

type CitaResumenPayload = {
  startsAt: Date;
  student: {
    matricula: string;
    user: { firstName: string; lastName: string; email: string };
  };
  chair: { name: string; campus: { name: string } } | null;
  supervisor: { firstName: string; lastName: string; email: string } | null;
};

function toCita(
  c: CitaResumenPayload | null,
  timeZone: string,
  multiSede: boolean,
): EduResumenCita | null {
  if (!c) return null;
  return {
    label: stampLabel(c.startsAt, timeZone),
    studentName: personName(c.student.user),
    studentMatricula: c.student.matricula,
    chairName: c.chair?.name ?? null,
    // La sede solo se dice cuando hay MÁS de una: "Sillón 3 · Sede única"
    // es ruido en la escuela chica, que son casi todas (regla de la Ola 11).
    campusName: multiSede ? (c.chair?.campus.name ?? null) : null,
    supervisorName: c.supervisor ? personName(c.supervisor) : null,
  };
}

/**
 * El resumen de UN paciente, con cada bloque recortado (o directamente NO
 * consultado) según quien pregunta. El paciente en sí ya lo validó la
 * página con getEduPatient — aquí cada consulta vuelve a cerrar tenant y
 * alcance por su cuenta, así que un patientId ajeno solo produce ceros.
 *
 * ⚠️ La ficha NO se filtra por sede a propósito (decisión de la Ola 11):
 * el expediente y la historia de un paciente son UNO, se atienda donde se
 * atienda. Por eso aquí no viaja `campusIds`.
 */
export async function getEduPatientResumen(
  ctx: EduClinicaContext,
  patientId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduPatientResumenData | null> {
  const institutionId = requireInstitution(ctx);
  const id = eduCleanId(patientId);
  if (!id) return null;

  const scopes = eduResumenScopes(ctx);
  const veCitas = !eduScopeIsEmpty(scopes.citas);
  const veClinico = eduResumenVeClinico(scopes);
  const veDinero = eduResumenVeDinero(scopes);

  const citasWhere = eduAppointmentScopeWhere({ institutionId, scope: scopes.citas, now });
  const casosWhere = eduCaseScopeWhere({ institutionId, scope: scopes.clinico, now });

  // ¿El instituto reparte por sedes? Decide si la sede se PINTA. Es una
  // cuenta barata (count con take implícito) y va dentro del mismo batch.
  const [visitas, ultima, proxima, casos, dinero, sedes] = await Promise.all([
    veCitas
      ? prisma.eduAppointment.count({
          where: { ...citasWhere, patientId: id, status: "COMPLETED" },
        })
      : Promise.resolve(0),
    veCitas
      ? prisma.eduAppointment.findFirst({
          where: { ...citasWhere, patientId: id, status: "COMPLETED" },
          orderBy: [{ startsAt: "desc" }],
          select: CITA_RESUMEN_SELECT,
        })
      : Promise.resolve(null),
    veCitas
      ? prisma.eduAppointment.findFirst({
          where: {
            ...citasWhere,
            patientId: id,
            startsAt: { gt: now },
            // Las vivas: una cancelada o un "no llegó" no son la próxima
            // visita de nadie, y una COMPLETED futura no existe.
            status: { notIn: ["CANCELLED", "NO_SHOW", "COMPLETED"] },
          },
          orderBy: [{ startsAt: "asc" }],
          select: CITA_RESUMEN_SELECT,
        })
      : Promise.resolve(null),
    veClinico
      ? prisma.eduCase.findMany({
          where: { ...casosWhere, patientId: id, status: { notIn: EDU_CASE_CLOSED_STATUSES } },
          orderBy: [{ openedAt: "desc" }],
          take: 20,
          select: {
            id: true,
            status: true,
            openedAt: true,
            supervisorUserId: true,
            program: { select: { name: true } },
            student: {
              select: {
                matricula: true,
                user: { select: { firstName: true, lastName: true, email: true } },
                // El titular VIGENTE del alumno: decide el aviso "sin
                // docente". Mismo predicado de vigencia de siempre — no se
                // reescribe aquí.
                supervisors: {
                  where: { institutionId, ...eduCurrentAssignmentWhere(now) },
                  take: 1,
                  select: { id: true },
                },
              },
            },
            supervisor: { select: { firstName: true, lastName: true, email: true } },
          },
        })
      : Promise.resolve([]),
    veDinero
      ? prisma.eduCharge.aggregate({
          where: { ...eduChargeScopeWhere({ institutionId, scope: scopes.dinero }), patientId: id },
          _sum: { paidCents: true, balanceCents: true },
          _count: true,
        })
      : Promise.resolve(null),
    prisma.eduCampus.count({ where: { institutionId } }).catch(() => 0),
  ]);

  const multiSede = sedes > 1;
  const tz = eduSafeTimeZone(timeZone);

  // ── Segundo lote (solo con alcance clínico): lo que alimenta los ──────
  // avisos, la LÍNEA DE TIEMPO, la espera de cada caso y los estudios.
  // Cinco consultas y no más (la regla del Promise.all corto sigue).
  //
  // · Las NOTAS y las RECETAS se recortan por el CASO (`case: casosWhere`):
  //   es el mismo alcance de sus pestañas.
  // · Los ESTUDIOS cuelgan del paciente, así que su recorte es la puerta
  //   clínica sobre el PACIENTE (eduPatientScopeWhere con el scope de
  //   "cases") — el criterio de la Ola 3: quien abre el expediente ve
  //   TODOS los estudios de la boca.
  // · Los CONSENTIMIENTOS son del paciente entero, como en su pestaña
  //   (Ola 3B): la carta de atención general no cuelga de ningún caso.
  const openIds = casos.map((c) => c.id);
  const [consents, approvals, notas, estudios, recetas] = veClinico
    ? await Promise.all([
        prisma.eduConsent.findMany({
          where: { institutionId, patientId: id },
          orderBy: [{ createdAt: "desc" }],
          select: {
            id: true,
            caseId: true,
            procedure: true,
            createdAt: true,
            createdByName: true,
            signedAt: true,
            revokedAt: true,
          },
        }),
        openIds.length > 0
          ? prisma.eduCaseApproval.findMany({
              // PENDING para el aviso y la espera; APPROVED solo para la
              // espera ("plan firmado: puede iniciar"). Los demás estados
              // no cambian ninguna de las dos.
              where: {
                institutionId,
                caseId: { in: openIds },
                status: { in: ["PENDING", "APPROVED"] },
              },
              select: { caseId: true, stage: true, status: true },
            })
          : Promise.resolve([]),
        prisma.eduRecord.findMany({
          where: { institutionId, patientId: id, case: casosWhere },
          orderBy: [{ createdAt: "desc" }],
          take: 6,
          select: {
            id: true,
            createdAt: true,
            author: { select: { firstName: true, lastName: true, email: true } },
            case: { select: { program: { select: { name: true } } } },
          },
        }),
        prisma.eduStudy.findMany({
          where: {
            institutionId,
            patientId: id,
            patient: eduPatientScopeWhere({ institutionId, scope: scopes.clinico, now }),
          },
          orderBy: [{ createdAt: "desc" }],
          take: 6,
          select: {
            id: true,
            kind: true,
            name: true,
            mimeType: true,
            storagePath: true,
            createdAt: true,
            uploadedBy: { select: { firstName: true, lastName: true, email: true } },
          },
        }),
        prisma.eduPrescription.findMany({
          where: { institutionId, patientId: id, case: casosWhere },
          orderBy: [{ createdAt: "desc" }],
          take: 6,
          select: {
            id: true,
            status: true,
            createdAt: true,
            proposedByName: true,
            case: { select: { program: { select: { name: true } } } },
          },
        }),
      ])
    : [[], [], [], [], []];

  // ── Los avisos: consentimientos y autorizaciones de ESOS casos ────────
  let avisos: EduPatientResumenData["avisos"] = [];
  const approvalsPorCaso = new Map<string, { stage: (typeof approvals)[number]["stage"]; status: (typeof approvals)[number]["status"] }[]>();
  for (const a of approvals) {
    const lista = approvalsPorCaso.get(a.caseId) ?? [];
    lista.push({ stage: a.stage, status: a.status });
    approvalsPorCaso.set(a.caseId, lista);
  }
  if (veClinico && casos.length > 0) {
    const pendientesPorCaso: Record<string, number> = {};
    for (const a of approvals) {
      if (a.status !== "PENDING") continue;
      pendientesPorCaso[a.caseId] = (pendientesPorCaso[a.caseId] ?? 0) + 1;
    }
    avisos = eduResumenAvisos(
      casos.map((c) => ({
        id: c.id,
        status: c.status,
        programName: c.program.name,
        supervisorUserId: c.supervisorUserId,
        tieneTitularVigente: c.student.supervisors.length > 0,
      })),
      consents,
      pendientesPorCaso,
    );
  }

  // ── La línea de tiempo: cuatro orígenes, un orden ─────────────────────
  let timeline: EduResumenTimelineItem[] | null = null;
  let estudiosResumen: EduResumenEstudio[] | null = null;
  if (veClinico) {
    const items: EduResumenTimelineItem[] = [];
    for (const n of notas) {
      items.push({
        kind: "nota",
        atISO: n.createdAt.toISOString(),
        whenLabel: stampLabel(n.createdAt, tz),
        title: `Nota clínica · ${n.case.program.name}`,
        who: personName(n.author),
      });
    }
    for (const e of estudios) {
      items.push({
        kind: "estudio",
        atISO: e.createdAt.toISOString(),
        whenLabel: stampLabel(e.createdAt, tz),
        title: `${EDU_STUDY_KIND_LABELS[e.kind] ?? e.kind} · ${e.name}`,
        who: personName(e.uploadedBy),
      });
    }
    for (const c of consents.slice(0, 6)) {
      // El estado va EN el título: un consentimiento revocado que se lea
      // como uno más es cómo alguien acaba tratando a quien dijo que no.
      const estado = c.revokedAt ? " (revocado)" : c.signedAt ? "" : " (sin firmar)";
      items.push({
        kind: "consentimiento",
        atISO: c.createdAt.toISOString(),
        whenLabel: stampLabel(c.createdAt, tz),
        title: `Consentimiento · ${c.procedure}${estado}`,
        who: c.createdByName,
      });
    }
    for (const r of recetas) {
      items.push({
        kind: "receta",
        atISO: r.createdAt.toISOString(),
        whenLabel: stampLabel(r.createdAt, tz),
        title: `Receta · ${r.case.program.name} (${(EDU_PRESCRIPTION_STATUS_LABELS[r.status] ?? r.status).toLowerCase()})`,
        who: r.proposedByName,
      });
    }
    timeline = eduResumenTimeline(items);

    // Los últimos 3 estudios, con miniatura FIRMADA solo si son imagen
    // (una tomografía comprimida no tiene miniatura barata). Tres firmas
    // como mucho — nunca una por cada estudio del paciente.
    const top = estudios.slice(0, 3);
    const thumbs = await Promise.all(
      top.map((e) =>
        e.mimeType.startsWith("image/") ? eduSignRead(e.storagePath, 600) : Promise.resolve(""),
      ),
    );
    estudiosResumen = top.map((e, i) => ({
      id: e.id,
      kindLabel: EDU_STUDY_KIND_LABELS[e.kind] ?? e.kind,
      name: e.name,
      whenLabel: stampLabel(e.createdAt, tz),
      byName: personName(e.uploadedBy),
      thumbUrl: thumbs[i] ? thumbs[i] : null,
    }));
  }

  return {
    visitas,
    recortado: scopes.citas.kind !== "all",
    ultimaVisita: toCita(ultima, tz, multiSede),
    proximaCita: toCita(proxima, tz, multiSede),
    casos: veClinico
      ? casos.map((c) => ({
          id: c.id,
          status: c.status,
          programName: c.program.name,
          studentName: personName(c.student.user),
          studentMatricula: c.student.matricula,
          supervisorName: c.supervisor ? personName(c.supervisor) : null,
          abiertoLabel: eduFormatDayShort(eduUtcToZoned(c.openedAt, tz).dayISO),
          espera: eduCasoEsperando(c.status, approvalsPorCaso.get(c.id) ?? []),
        }))
      : null,
    saldo: dinero
      ? {
          cobradoCents: dinero._sum.paidCents ?? 0,
          pendienteCents: dinero._sum.balanceCents ?? 0,
          cobros: dinero._count,
        }
      : null,
    avisos,
    timeline,
    estudios: estudiosResumen,
  };
}
