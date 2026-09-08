/**
 * DaleControl INSTITUCIONAL — EL PLAN DE TRATAMIENTO contra la base.
 *
 * SERVIDOR: importa prisma. Lo puro (estados, transiciones, KPI, próxima
 * fecha) vive en plan-tratamiento-core.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL DOBLE CANDADO
 *
 *   · PERMISO — `expediente.view` para leer, `expediente.write` para
 *     armar el plan y marcar sesiones. Ninguna key nueva: el plan de
 *     tratamiento es parte del expediente y quien escribe la nota de una
 *     sesión es quien la hizo.
 *   · ALCANCE — el CLÍNICO (`getEduClinicalPatient`, recurso "cases").
 *     CAJA no ve planes de tratamiento: cobra, no planifica actos
 *     clínicos.
 *
 * ⚠️ EL IMPORTE (`totalCents`) SE GUARDA PERO NO LO VE EL ALUMNO. El plan
 * lo lee el alcance clínico, así que el número viaja; la pantalla de C·2
 * lo esconde para quien no lleva `caja.view`. Se deja escrito aquí porque
 * es exactamente el tipo de detalle que se pierde entre una ola y la
 * siguiente.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import {
  eduCleanId,
  eduFormatDayShort,
  eduFormatTime,
  eduOptionalText,
  eduSafeTimeZone,
  eduUtcToZoned,
} from "@/lib/edu/agenda-core";
import { getEduClinicalPatient } from "@/lib/edu/expediente";
import { eduClinicalScope } from "@/lib/edu/expediente-core";
import type { EduClinicaContext } from "@/lib/edu/visibility";
import {
  EDU_PLAN_DESC_MAX,
  EDU_PLAN_MAX_PARTIDAS,
  EDU_PLAN_MAX_ROWS,
  EDU_PLAN_MAX_SESIONES,
  EDU_PLAN_SESSION_NOTES_MAX,
  EDU_PLAN_STATUSES_CERRADOS,
  eduPlanAtrasado,
  eduPlanDescripcionCon,
  eduPlanEsMio,
  eduPlanDescripcionHumana,
  eduPlanKpis,
  eduPlanParseEntero,
  eduPlanParseFechaHecha,
  eduPlanParseNombre,
  eduPlanParsePartidasPedidas,
  eduPlanParseStatus,
  eduPlanPartidasParse,
  eduPlanPartidasTotal,
  eduPlanProximaFecha,
  eduPlanPuedeCerrar,
  eduPlanPuedeTransicionar,
  type EduPlanKpis,
  type EduPlanPartida,
  type EduTreatmentPlanStatus,
} from "@/lib/edu/plan-tratamiento-core";
import {
  eduCaseScopeWhere,
  eduPatientScopeWhere,
  eduStudentScopeWhere,
  eduVisibility,
  eduScopeIsEmpty,
} from "@/lib/edu/visibility";
import { getEduTarifaDePaciente } from "@/lib/edu/tarifas";
import { eduAudit, type EduAuditActor } from "@/lib/edu/auditoria";

export interface EduPlanContext extends EduClinicaContext, EduAuditActor {}

/** El nombre de una persona, con el correo de respaldo. Mismo criterio que
 *  el resto del vertical: una fila sin nombre no se pinta en blanco. */
function personName(u: { firstName: string; lastName: string; email?: string }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Sin nombre";
}

function requireInstitution(ctx: { institutionId?: string }): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Tu sesión no trae instituto. Vuelve a entrar.", 401);
  }
  return id;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 #3 · EL RECORTE POR CASO. El plan NO se abre solo con el paciente.
 *
 * Hasta esta ola las tres puertas del plan —leer, marcar sesión y cambiar
 * el estado— comprobaban únicamente `getEduClinicalPatient`, que es el
 * alcance del PACIENTE. Con eso, un paciente con dos casos abiertos deja el
 * plan de cada alumno a la vista del otro: Ana, que lleva la ortodoncia,
 * abría `/pacientes/P/plan`, leía el plan de endodoncia de Beto con el
 * texto de cada sesión y —como escribir un plan es `expediente.write`, que
 * ALUMNO trae por defecto— podía pulsar «Marcar abandonado», que es
 * TERMINAL: el plan no se reabre.
 *
 * El expediente ya recortaba por CASO y con el motivo escrito al lado
 * (`listEduPatientRecords`: «un alumno que lleva la endodoncia de esta
 * señora NO lee las notas de su ortodoncia»). Esto es la misma regla, en el
 * módulo de al lado.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 OLA C·fin 2 · Y EL PLAN «SIN CASO» TAMBIÉN TIENE DUEÑO.
 *
 * El recorte de arriba dejaba la rama `{ caseId: null }` abierta de par en
 * par, con el argumento de que «un plan sin caso no es de ningún alumno,
 * así que no hay caso ajeno que proteger». Ese argumento es el que falla, y
 * falla justo en el caso que la pantalla provoca sola: el selector de caso
 * del formulario se quedaba en «Sin caso» cuando el paciente tiene DOS
 * casos, así que el plan desprotegido es el que se crea por defecto.
 *
 * La cadena, entera: el paciente P tiene la ortodoncia de Ana y la
 * endodoncia de Beto. Beto abre un plan y el formulario lo deja sin caso.
 * Ana entra a `/instituto/pacientes/P/plan`, LEE el plan de Beto con el
 * texto de cada sesión, y con un PATCH lo pasa a COMPLETADO —que es
 * TERMINAL igual que ABANDONADO (`EDU_PLAN_TRANSITIONS.COMPLETADO = []`) y
 * lo alcanza `expediente.write`, que ALUMNO trae por defecto—: el
 * tratamiento de otro, cerrado para siempre, sin un renglón que lo explique.
 *
 * SÍ tiene dueño, y el campo ya existe: `createdById`, que se escribe al
 * crear. Así que la rama sin caso pide TRES cosas a la vez, y no una:
 *
 *   · el PACIENTE en el alcance de quien mira (`eduPatientScopeWhere`), que
 *     es el mismo recorte que abre la ficha y el expediente. Va DENTRO del
 *     `where` y no fuera: este helper también alimenta el `updateMany` de
 *     la escritura, donde no hay ningún `getEduClinicalPatient` antes;
 *   · el instituto, que ya viajaba;
 *   · y el DUEÑO — quien lo armó si soy alumno; quien lo armó o cualquiera
 *     de mis alumnos vigentes si soy docente. Dirección sigue con
 *     `scope.kind === "all"` y no toca nada.
 *
 * ⚠️ Se aplica también a la LECTURA, y no solo a la escritura. Un plan que
 * se puede leer entero —con la nota de cada sesión— es la mitad del
 * hallazgo, y esconderlo no pierde datos de nadie: dirección los ve todos,
 * el docente ve los de sus alumnos, y `edu_treatment_plans` la crea
 * `sql/edu-ola-c.sql`, que todavía no está aplicado. No hay filas viejas
 * que desaparezcan porque todavía no hay filas.
 *
 * ⚠️ Un plan cuyo autor se dio de baja tiene `createdById` null (el FK es
 * SetNull) y deja de estar al alcance de un alumno o un docente: lo ve la
 * dirección, que es quien puede reasignarlo. Falla del lado cerrado, que es
 * el lado por el que tiene que fallar.
 * ═══════════════════════════════════════════════════════════════════════
 */
function eduPlanScopeWhere(
  ctx: EduPlanContext,
  institutionId: string,
  now: Date,
): Prisma.EduTreatmentPlanWhereInput {
  const scope = eduClinicalScope(ctx);
  // Sin alcance clínico no hay plan que valga. No debería llegarse aquí
  // —getEduClinicalPatient ya contestó 404— pero un `where` que no filtra
  // nada es exactamente lo que este helper viene a impedir.
  if (eduScopeIsEmpty(scope) || scope.kind === "none") return { id: { in: [] } };
  // Alcance completo (dirección): el paciente ya se comprobó y no hay nada
  // más que recortar.
  if (scope.kind === "all") return {};

  // 🔴 OLA C·fin 3 · Y LA TERCERA RAMA: EL PLAN QUE ARMA LA ESCUELA.
  //
  // El recorte de la C·fin 2 miraba solo `createdById`, y un EduUser de
  // DIRECCIÓN no tiene `studentProfile`: no caía en ninguna rama. Resultado
  // —del lado cerrado, pero roto igual—: el plan sin caso que arma la
  // dirección o un docente quedaba INVISIBLE para el alumno que lo tiene
  // que ejecutar. Y ése es justo el caso de uso por el que `caseId` es
  // nulable, escrito en el schema: «la valoración inicial propone un plan
  // antes de que haya alumno asignado». Con cero casos, además, el
  // formulario solo ofrece «sin caso».
  //
  // No abre nada nuevo: esta rama vive DENTRO del `{ caseId: null,
  // patient: eduPatientScopeWhere(...) }` de abajo, así que el paciente
  // sigue teniendo que estar en el alcance de quien mira. Lo que añade es
  // que el autor pueda ser quien enseña, no solo quien ejecuta.
  //
  // ⚠️ Ver, sí; CERRARLO, no: `eduPlanEsMio` sigue mirando `createdById`,
  // así que el alumno no lo pasa a COMPLETADO (lo hacen su docente y la
  // dirección, `eduPlanPuedeCerrar`). Falla del lado cerrado.
  const armadoPorLaEscuela: Prisma.EduTreatmentPlanWhereInput = {
    createdBy: { role: { in: ["DIRECCION", "DOCENTE"] } },
  };

  // Quién es «el dueño» de un plan sin caso. Para el DOCENTE son tres
  // opciones y no una: los planes que armó él, los que armaron los alumnos
  // que supervisa HOY (la vigencia la pone el mismo helper que el resto del
  // vertical, no una copia local del predicado) y los que armó la escuela.
  const dueno: Prisma.EduTreatmentPlanWhereInput =
    scope.kind === "own"
      ? { OR: [{ createdById: scope.studentUserId }, armadoPorLaEscuela] }
      : {
          OR: [
            { createdById: scope.supervisorUserId },
            { createdBy: { studentProfile: eduStudentScopeWhere({ institutionId, scope, now }) } },
            armadoPorLaEscuela,
          ],
        };

  return {
    OR: [
      { caseId: null, patient: eduPatientScopeWhere({ institutionId, scope, now }), ...dueno },
      { case: eduCaseScopeWhere({ institutionId, scope, now }) },
    ],
  };
}

export interface EduPlanRow {
  id: string;
  name: string;
  /**
   * La descripción TAL CUAL está en la base, bloque de partidas incluido.
   * La pantalla pinta `descripcion` (la parte humana) y `partidas` por
   * separado: ver el encabezado de las partidas en el core.
   */
  description: string | null;
  /** Lo que escribió una persona, sin el bloque canónico del servidor. */
  descripcion: string;
  /** Las partidas del tarifario con las que se armó el importe. */
  partidas: EduPlanPartida[];
  caseId: string | null;
  status: EduTreatmentPlanStatus;
  totalCents: number;
  startsAt: string;
  expectedEndAt: string | null;
  closedAt: string | null;
  nextExpectedAt: string | null;
  closeReason: string | null;
  createdByName: string;
  /**
   * 🔴 OLA C·fin 2 · ¿es MÍO? El alumno del caso, o —cuando no hay caso—
   * quien lo armó. Viaja como booleano y no como id: la pantalla solo
   * necesita saber si puede ofrecer el botón que CIERRA el plan, y mandar
   * el id de otra persona sería mandar un dato que nadie va a pintar.
   * Para dirección y para el docente que supervisa es `false` y da igual:
   * los dos pueden cerrar por rol.
   */
  esMio: boolean;
  kpis: EduPlanKpis & { atrasado: boolean };
  sesiones: {
    id: string;
    sessionNumber: number;
    notes: string | null;
    completedAt: string | null;
    /** Quién la marcó: en la clínica de una escuela, el alumno que la hizo. */
    completedByName: string | null;
    appointmentId: string | null;
    /** «12 mar · 10:00 · Sillón 3», o null si no está ligada a ninguna cita. */
    appointmentLabel: string | null;
  }[];
}

/** LOS PLANES de un paciente, con sus sesiones y su avance ya calculado. */
export async function listEduPlanes(
  ctx: EduPlanContext,
  patientId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<EduPlanRow[]> {
  const institutionId = requireInstitution(ctx);
  const paciente = await getEduClinicalPatient(ctx, patientId, now);
  if (!paciente) throw new EduPadronError("Ese paciente no existe o no es de tu instituto.", 404);

  const filas = await prisma.eduTreatmentPlan.findMany({
    // #3 · el recorte por CASO va en el `where`, no en un `.filter()`
    // después: un recorte fuera de la consulta es un recorte que el
    // siguiente `findMany` se olvida de copiar.
    where: {
      institutionId,
      patientId: paciente.id,
      ...eduPlanScopeWhere(ctx, institutionId, now),
    },
    orderBy: [{ status: "asc" }, { startsAt: "desc" }],
    take: EDU_PLAN_MAX_ROWS,
    include: {
      // El alumno del caso, para poder contestar «¿es mío?» sin una
      // segunda consulta por plan.
      case: { select: { student: { select: { userId: true } } } },
      sessions: {
        orderBy: { sessionNumber: "asc" },
        select: {
          id: true,
          sessionNumber: true,
          notes: true,
          completedAt: true,
          appointmentId: true,
          // 🔴 QUIÉN la marcó, no solo cuándo. Una sesión hecha sin firma
          // no contesta la pregunta que un expediente tiene que contestar,
          // y en una clínica de escuela la respuesta ES la evaluación de
          // alguien. El nombre sale de la relación y no de una columna
          // congelada porque `EduTreatmentSession` no la tiene; si la
          // cuenta se desactiva, el FK es SetNull y aquí queda null — el
          // rastro dice cuándo aunque ya no pueda decir quién.
          completedBy: { select: { firstName: true, lastName: true, email: true } },
          appointment: {
            select: { startsAt: true, chair: { select: { name: true } } },
          },
        },
      },
    },
  });

  const tz = eduSafeTimeZone(timeZone);

  return filas.map((p) => {
    const kpis = eduPlanKpis(p.sessions, p.totalSessions);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      descripcion: eduPlanDescripcionHumana(p.description),
      partidas: eduPlanPartidasParse(p.description),
      caseId: p.caseId,
      status: p.status as EduTreatmentPlanStatus,
      totalCents: p.totalCents,
      startsAt: p.startsAt.toISOString(),
      expectedEndAt: p.expectedEndAt?.toISOString() ?? null,
      closedAt: p.closedAt?.toISOString() ?? null,
      nextExpectedAt: p.nextExpectedAt?.toISOString() ?? null,
      closeReason: p.closeReason,
      createdByName: p.createdByName,
      esMio: eduPlanEsMio(p, ctx.eduUserId),
      kpis: {
        ...kpis,
        atrasado: eduPlanAtrasado(p.status as EduTreatmentPlanStatus, p.nextExpectedAt, now),
      },
      sesiones: p.sessions.map((s) => ({
        id: s.id,
        sessionNumber: s.sessionNumber,
        notes: s.notes,
        completedAt: s.completedAt?.toISOString() ?? null,
        completedByName: s.completedBy ? personName(s.completedBy) : null,
        appointmentId: s.appointmentId,
        // La cita se rotula EN EL SERVIDOR y en la zona del INSTITUTO: en
        // el navegador saldría en la zona de quien mira, y una cita de las
        // 19:00 en Tijuana se pintaría al día siguiente.
        appointmentLabel: s.appointment
          ? `${eduFormatDayShort(eduUtcToZoned(s.appointment.startsAt, tz).dayISO)} ${eduFormatTime(
              s.appointment.startsAt,
              tz,
            )}${s.appointment.chair ? ` · ${s.appointment.chair.name}` : ""}`
          : null,
      })),
    };
  });
}

/**
 * CREA un plan y sus sesiones vacías de una vez.
 *
 * 🔴 LAS SESIONES SE CREAN TODAS, VACÍAS, DESDE EL PRINCIPIO. Un plan de
 * doce sesiones tiene doce renglones desde el día uno: es lo que permite
 * marcar la 5 sin haber marcado la 4 (pasa: el paciente se saltó una
 * cita), y lo que hace que el avance sea una cuenta y no una resta contra
 * un número guardado.
 *
 * 🔴 EL CASO SE COMPRUEBA DENTRO DEL MISMO PACIENTE. Sin eso, se podría
 * colgar un plan de un caso de otra persona pasando su id: el alcance ya
 * comprobó el paciente, no el caso.
 */
export async function createEduPlan(
  ctx: EduPlanContext,
  patientId: string,
  body: {
    name?: unknown;
    description?: unknown;
    caseId?: unknown;
    totalSessions?: unknown;
    sessionIntervalDays?: unknown;
    totalCents?: unknown;
    /** Las partidas del tarifario: `[{ procedureId, quantity }]`. */
    items?: unknown;
  },
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ id: string }> {
  const institutionId = requireInstitution(ctx);
  const paciente = await getEduClinicalPatient(ctx, patientId, now);
  if (!paciente) throw new EduPadronError("Ese paciente no existe o no es de tu instituto.", 404);

  const name = eduPlanParseNombre(body?.name);
  const humana = eduOptionalText(body?.description, EDU_PLAN_DESC_MAX) ?? null;
  const totalSessions = eduPlanParseEntero(body?.totalSessions, "Las sesiones", 1, EDU_PLAN_MAX_SESIONES, 1);
  const sessionIntervalDays = eduPlanParseEntero(body?.sessionIntervalDays, "El intervalo en días", 1, 365, 30);

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 LAS PARTIDAS Y EL IMPORTE — Y EL PRECIO LO PONE EL TARIFARIO.
  //
  // Lo que el navegador manda son PROCEDIMIENTOS Y CANTIDADES; el precio
  // de cada uno lo resuelve `getEduTarifaDePaciente`, que es la misma
  // función que usa caja y la que aplica la lista que a ESTE paciente le
  // toca (convenio, campaña, «lo trajo un alumno»). Un `unitPriceCents`
  // que llega del cliente es un precio que el cliente puede cambiar, y la
  // regla (d) de la casa dice que la fuente es la tabla, no la pantalla.
  //
  // 🔴 Y LAS PARTIDAS SON DEL DINERO, ASÍ QUE PIDEN EL ALCANCE DEL DINERO.
  // El plan lo abre el alcance CLÍNICO (un alumno arma el suyo), pero
  // ponerle precio no: para docente y alumno el recurso "charges" es
  // `none` y el tarifario ni se consulta. Un alumno crea el plan sin
  // importe, que es exactamente lo que su rol puede contestar.
  // ═══════════════════════════════════════════════════════════════════
  const veDinero = !eduScopeIsEmpty(eduVisibility(ctx, "charges"));
  const pedidas = eduPlanParsePartidasPedidas(body?.items);
  let partidas: EduPlanPartida[] = [];
  if (pedidas.length > 0) {
    if (!veDinero) {
      throw new EduPadronError(
        "Tu rol no pone precios: arma el plan sin partidas y que la dirección le ponga el importe desde el tarifario.",
        403,
      );
    }
    const tarifa = await getEduTarifaDePaciente(ctx, paciente.id);
    const porId = new Map(tarifa.prices.map((x) => [x.procedureId, x]));
    for (const pedida of pedidas) {
      // `prices` solo trae los que TIENEN precio en la lista que le toca
      // a este paciente; los que no, van en `sinPrecio`. Por eso basta con
      // no encontrarlo aquí para saber que no se puede presupuestar.
      const precio = porId.get(pedida.procedureId);
      if (!precio) {
        throw new EduPadronError(
          "Uno de los procedimientos que elegiste no tiene precio en la lista que le toca a este paciente. Ponle precio en Tarifarios o quítalo del plan.",
          409,
        );
      }
      partidas.push({
        name: precio.name,
        quantity: pedida.quantity,
        unitPriceCents: precio.priceCents,
      });
    }
  }

  // Sin partidas, el importe puede llegar a mano (es el caso de un plan
  // cerrado a tanto alzado). Con partidas manda la suma: dos números para
  // lo mismo es cómo se llega a un presupuesto que no cuadra con su plan.
  const totalCents =
    partidas.length > 0
      ? eduPlanPartidasTotal(partidas)
      : veDinero
        ? eduPlanParseEntero(body?.totalCents, "El importe en centavos", 0, 99_999_999, 0)
        : 0;

  const description = eduPlanDescripcionCon(humana, partidas);

  let caseId: string | null = null;
  const rawCase = eduCleanId(body?.caseId);
  if (rawCase) {
    // #3 · Y EL CASO TIENE QUE ESTAR EN EL ALCANCE DE QUIEN LO MANDA. Sin
    // esto se cuelga un plan del caso de OTRO alumno del mismo paciente, y
    // a partir de ahí el plan es suyo.
    //
    // 🔴 Va en `AND` y no esparcido: `eduCaseScopeWhere` puede devolver
    // `{ institutionId, id: { in: [] } }` (el «ninguno») y una clave `id`
    // escrita encima lo BORRARÍA. Es literalmente el error contra el que
    // avisa por escrito arco.ts.
    const caso = await prisma.eduCase.findFirst({
      where: {
        AND: [
          eduCaseScopeWhere({ institutionId, scope: eduClinicalScope(ctx), now }),
          { id: rawCase, institutionId, patientId: paciente.id },
        ],
      },
      select: { id: true },
    });
    if (!caso) throw new EduPadronError("Ese caso no existe o no es de este paciente.", 404);
    caseId = caso.id;
  }

  const createdByName = `${ctx.user.firstName} ${ctx.user.lastName}`.trim().slice(0, 160) || "—";

  const creado = await prisma.$transaction(async (tx) => {
    const plan = await tx.eduTreatmentPlan.create({
      data: {
        institutionId,
        patientId: paciente.id,
        caseId,
        name,
        description,
        totalSessions,
        sessionIntervalDays,
        totalCents,
        startsAt: now,
        nextExpectedAt: new Date(now.getTime() + sessionIntervalDays * 24 * 60 * 60 * 1000),
        createdById: ctx.eduUserId,
        createdByName,
      },
      select: { id: true },
    });

    await tx.eduTreatmentSession.createMany({
      data: Array.from({ length: totalSessions }, (_, i) => ({
        institutionId,
        planId: plan.id,
        sessionNumber: i + 1,
      })),
    });

    return plan;
  });

  await eduAudit(ctx, {
    action: "create",
    entity: "treatmentPlan",
    entityId: creado.id,
    patientId: paciente.id,
    after: { name, totalSessions, totalCents, partidas: partidas.length },
    ...meta,
  });

  return { id: creado.id };
}

/**
 * MARCA (o desmarca) una sesión como hecha, y recalcula la próxima fecha.
 *
 * 🔴 `updateMany` CON EL ESTADO EN EL `where` Y 409 SI `count === 0`. Es la
 * regla de la casa: dos alumnos con el mismo plan abierto, el primero
 * marca la sesión 5, el segundo también — y el segundo recibiría un 200
 * sin haber escrito nada.
 *
 * 🔴 EL PLAN SE RECALCULA EN LA MISMA TRANSACCIÓN. Si `nextExpectedAt` se
 * escribiera después, un fallo entre las dos escrituras dejaría el plan
 * saliendo como atrasado para siempre.
 */
export async function marcarEduPlanSesion(
  ctx: EduPlanContext,
  planId: string,
  sessionId: string,
  body: {
    hecha?: unknown;
    notes?: unknown;
    /** La fecha en que se hizo, si no fue hoy. Nunca futura. */
    completedAt?: unknown;
    /** La CITA en la que se hizo, si la hubo. `null` la desliga. */
    appointmentId?: unknown;
  },
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ id: string; completedAt: string | null; kpis: EduPlanKpis }> {
  const institutionId = requireInstitution(ctx);

  const pid = eduCleanId(planId);
  const sid = eduCleanId(sessionId);
  if (!pid || !sid) throw new EduPadronError("Falta el plan o la sesión.", 400);

  const plan = await prisma.eduTreatmentPlan.findFirst({
    // #3 · el CASO, no solo el instituto: el plan de otro alumno del mismo
    // paciente se ve igual que uno que no existe.
    where: { id: pid, institutionId, ...eduPlanScopeWhere(ctx, institutionId, now) },
    select: {
      id: true,
      patientId: true,
      status: true,
      startsAt: true,
      sessionIntervalDays: true,
      totalSessions: true,
    },
  });
  if (!plan) throw new EduPadronError("Ese plan no existe o no es de tu instituto.", 404);

  // El ALCANCE: el plan es del paciente, así que se comprueba el paciente.
  const paciente = await getEduClinicalPatient(ctx, plan.patientId, now);
  if (!paciente) throw new EduPadronError("Ese plan no existe o no es de tu instituto.", 404);

  if (EDU_PLAN_STATUSES_CERRADOS.includes(plan.status as EduTreatmentPlanStatus)) {
    throw new EduPadronError(
      "Ese plan ya está cerrado. Un plan cerrado no se reabre: se abre otro.",
      409,
    );
  }

  const hecha = body?.hecha !== false;
  const notes = eduOptionalText(body?.notes, EDU_PLAN_SESSION_NOTES_MAX);
  // La fecha REAL del acto, cuando no es hoy (se documenta el jueves lo
  // que se hizo el martes). Sin ella se sella `now`, que es el caso normal.
  const fechaHecha = hecha ? eduPlanParseFechaHecha(body?.completedAt, now) : null;

  // 🔴 LA CITA SE COMPRUEBA CONTRA EL MISMO PACIENTE, y no se cree lo que
  // llega en el cuerpo. Sin esto se podría colgar la sesión de una cita de
  // otra persona pasando su id: el alcance comprobó el PACIENTE, no la
  // cita. `null` explícito desliga; `undefined` no toca la columna.
  let appointmentId: string | null | undefined;
  if (body?.appointmentId === null || body?.appointmentId === "") {
    appointmentId = null;
  } else if (body?.appointmentId !== undefined) {
    const cita = eduCleanId(body.appointmentId);
    if (!cita) throw new EduPadronError("Esa cita no se entiende.", 400);
    const existe = await prisma.eduAppointment.findFirst({
      where: { id: cita, institutionId, patientId: plan.patientId },
      select: { id: true },
    });
    if (!existe) {
      throw new EduPadronError("Esa cita no existe o no es de este paciente.", 404);
    }
    appointmentId = existe.id;
  }

  const kpis = await prisma.$transaction(async (tx) => {
    const res = await tx.eduTreatmentSession.updateMany({
      // El estado leído va en el where: si se pide marcar, la sesión tiene
      // que estar SIN marcar, y al revés.
      where: {
        id: sid,
        institutionId,
        planId: plan.id,
        completedAt: hecha ? null : { not: null },
      },
      data: {
        completedAt: hecha ? (fechaHecha ?? now) : null,
        completedById: hecha ? ctx.eduUserId : null,
        ...(notes === undefined ? {} : { notes }),
        ...(appointmentId === undefined ? {} : { appointmentId }),
      },
    });
    if (res.count === 0) {
      throw new EduPadronError(
        hecha
          ? "Esa sesión ya estaba marcada como hecha. Actualiza la pantalla."
          : "Esa sesión no estaba marcada. Actualiza la pantalla.",
        409,
      );
    }

    const sesiones = await tx.eduTreatmentSession.findMany({
      where: { institutionId, planId: plan.id },
      select: { sessionNumber: true, completedAt: true },
    });
    const k = eduPlanKpis(sesiones, plan.totalSessions);
    await tx.eduTreatmentPlan.updateMany({
      where: { id: plan.id, institutionId },
      data: { nextExpectedAt: eduPlanProximaFecha(k, plan.startsAt, plan.sessionIntervalDays) },
    });
    return k;
  });

  await eduAudit(ctx, {
    action: "update",
    entity: "treatmentPlan",
    entityId: plan.id,
    patientId: plan.patientId,
    before: { sesionHecha: !hecha },
    after: { sesionHecha: hecha, avance: kpis.avance },
    ...meta,
  });

  return {
    id: sid,
    completedAt: hecha ? (fechaHecha ?? now).toISOString() : null,
    kpis,
  };
}

/**
 * CAMBIA EL ESTADO del plan (pausar, terminar, abandonar).
 *
 * Las transiciones válidas son un DATO (`EDU_PLAN_TRANSITIONS`), no una
 * cadena de `if` que el segundo endpoint se olvide de copiar.
 */
export async function cambiarEstadoEduPlan(
  ctx: EduPlanContext,
  planId: string,
  body: { status?: unknown; reason?: unknown },
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
): Promise<{ id: string; status: EduTreatmentPlanStatus }> {
  const institutionId = requireInstitution(ctx);

  const pid = eduCleanId(planId);
  if (!pid) throw new EduPadronError("Falta el plan.", 400);

  const destino = eduPlanParseStatus(body?.status);
  if (!destino) throw new EduPadronError("Ese estado de plan no existe.", 400);

  const plan = await prisma.eduTreatmentPlan.findFirst({
    // #3 · ídem: cerrar el plan de otro alumno era el daño más grande de
    // los tres, porque COMPLETADO y ABANDONADO no se reabren.
    where: { id: pid, institutionId, ...eduPlanScopeWhere(ctx, institutionId, now) },
    select: {
      id: true,
      patientId: true,
      status: true,
      // Para el candado de los estados TERMINALES de más abajo.
      caseId: true,
      createdById: true,
      case: { select: { student: { select: { userId: true } } } },
    },
  });
  if (!plan) throw new EduPadronError("Ese plan no existe o no es de tu instituto.", 404);

  const paciente = await getEduClinicalPatient(ctx, plan.patientId, now);
  if (!paciente) throw new EduPadronError("Ese plan no existe o no es de tu instituto.", 404);

  const desde = plan.status as EduTreatmentPlanStatus;
  if (!eduPlanPuedeTransicionar(desde, destino)) {
    throw new EduPadronError(
      `Un plan ${desde} no puede pasar a ${destino}. Un plan cerrado no se reabre: se abre otro.`,
      409,
    );
  }

  const cierra = EDU_PLAN_STATUSES_CERRADOS.includes(destino);
  const reason = eduOptionalText(body?.reason, 500) ?? null;
  if (destino === "ABANDONADO" && !reason) {
    throw new EduPadronError(
      "Abandonar un plan pide un motivo: es lo que distingue «el paciente dejó de venir» de «se terminó».",
      400,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 #3 · ABANDONAR NO ES UN CLIC DE ALUMNO.
  //
  // `ABANDONADO` no tiene salida (`EDU_PLAN_TRANSITIONS.ABANDONADO = []`):
  // un plan abandonado no se reabre nunca, se abre otro. Que la misma llave
  // que sirve para marcar la sesión de hoy —`expediente.write`, que ALUMNO
  // trae por defecto— sirviera también para cerrar un tratamiento para
  // siempre es lo que convertía el hallazgo del alcance en daño
  // irreversible. Con el recorte por caso ya no se puede tocar el plan de
  // otro; esto cierra el otro lado: el alumno tampoco cierra el suyo de un
  // clic sin que lo sepa quien lo supervisa.
  //
  // Es la puerta MÍNIMA: el motivo ya se exigía, y sigue exigiéndose. Lo que
  // se añade es quién puede darlo. `PAUSADO` no cierra nada, y `COMPLETADO`
  // tiene su propio candado — el de aquí abajo, que lo deja en manos del
  // alumno que lleva el plan pero no de cualquiera que comparta paciente.
  // ═══════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 OLA C·fin 2 · Y **COMPLETADO** TAMPOCO ES UN TERMINAL SILENCIOSO.
  //
  // El candado de abajo cubría un solo estado, y COMPLETADO cierra igual:
  // `EDU_PLAN_TRANSITIONS.COMPLETADO = []`, está en
  // `EDU_PLAN_STATUSES_CERRADOS` y se alcanza con `expediente.write`, que
  // ALUMNO trae por defecto. Cerrar por terminado sigue siendo la
  // conclusión normal del trabajo del alumno —por eso él SÍ puede, y por
  // eso esto no es una copia del candado de ABANDONADO—, pero solo sobre
  // SU plan: el del caso que lleva, o el que armó cuando no hay caso.
  //
  // El `where` de arriba ya no deja llegar aquí con el plan de otro. Esto
  // es el segundo cerrojo, escrito aparte y sobre el dato leído: un
  // recorte que vive solo dentro de un `where` es un recorte que el
  // siguiente `findFirst` se olvida de copiar, y lo que está en juego es
  // irreversible.
  //
  // La confirmación (la pantalla la pide para los dos) y el rastro (el
  // renglón de bitácora, `closedById`, `closedAt` y el motivo) ya estaban.
  // ═══════════════════════════════════════════════════════════════════
  // Primero el de ABANDONADO, porque su mensaje es el que de verdad ayuda:
  // «eso lo marca tu docente». El general de abajo lo taparía.
  if (destino === "ABANDONADO" && ctx.role !== "DIRECCION" && ctx.role !== "DOCENTE") {
    throw new EduPadronError(
      "Abandonar un plan lo cierra para siempre: no se reabre, se abre otro. Eso lo marca tu docente o la dirección. Escribe en la nota de la sesión lo que pasó y díselo.",
      403,
    );
  }

  if (cierra && !eduPlanPuedeCerrar(ctx.role, eduPlanEsMio(plan, ctx.eduUserId), destino)) {
    throw new EduPadronError(
      "Ese plan no es tuyo, y cerrarlo no se deshace. Lo cierra el alumno que lo lleva, su docente o la dirección.",
      403,
    );
  }

  // 🔴 `Unchecked…` y no `…UpdateManyMutationInput`: Prisma deja los
  // escalares de llave foránea (`closedById`) SOLO en la variante
  // "unchecked", porque la otra espera que se escriban por la relación.
  // Un `as` sobre el tipo equivocado compilaría igual y sería mentira.
  const data: Prisma.EduTreatmentPlanUncheckedUpdateManyInput = {
    status: destino,
    closedAt: cierra ? now : null,
    closedById: cierra ? ctx.eduUserId : null,
    closeReason: cierra ? reason : null,
  };

  // El estado LEÍDO en el where: si alguien lo cambió entre la lectura y
  // esta escritura, count sale 0 y contestamos 409 en vez de pisar su
  // decisión.
  const res = await prisma.eduTreatmentPlan.updateMany({
    // El alcance viaja también a la ESCRITURA, no solo a la lectura de
    // arriba: es la regla de la casa y cuesta lo mismo.
    where: {
      id: plan.id,
      institutionId,
      status: desde,
      ...eduPlanScopeWhere(ctx, institutionId, now),
    },
    data,
  });
  if (res.count === 0) {
    throw new EduPadronError(
      "Alguien cambió el estado de ese plan mientras lo mirabas. Actualiza la pantalla.",
      409,
    );
  }

  await eduAudit(ctx, {
    action: "update",
    entity: "treatmentPlan",
    entityId: plan.id,
    patientId: plan.patientId,
    before: { status: desde },
    after: { status: destino, closeReason: reason },
    ...meta,
  });

  return { id: plan.id, status: destino };
}
