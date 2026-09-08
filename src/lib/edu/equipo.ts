/**
 * DaleControl INSTITUCIONAL — el EQUIPO contra la base de datos y contra
 * Supabase Auth.
 *
 * SERVIDOR: importa prisma y la SERVICE ROLE KEY de Supabase. No lo importe
 * jamás un componente "use client" — arrastraría al navegador el runtime de
 * Prisma y, mucho peor, el nombre de la variable con la llave de servicio.
 * Lo puro y compartible vive en equipo-core.ts.
 *
 * 🔴 REGLA DE ORO (la misma de todo el vertical): TODA función recibe el
 * contexto de sesión y saca de ahí el institutionId. Ninguna lo acepta como
 * parámetro suelto.
 *
 * ── LAS DOS COSAS QUE PASAN AL DAR DE ALTA ──────────────────────────────
 * Un alta son DOS escrituras en dos sistemas distintos:
 *   1. la cuenta en Supabase Auth (el login), y
 *   2. la fila en edu_users (quién es dentro de ESTE instituto).
 * No hay transacción que abarque las dos: Supabase Auth no está en nuestra
 * base. Por eso el orden importa y está elegido — primero Auth, después la
 * fila. Si falla la fila, queda una cuenta de Auth huérfana que el
 * siguiente intento REUSA (ver `resolverSupabaseIdExistente`); si fuera al
 * revés, quedaría una persona en el padrón que no puede entrar, y eso no se
 * arregla solo.
 *
 * ── EL CASO QUE HOY REVIENTA ────────────────────────────────────────────
 * 🔴 Si el correo YA existe en Supabase Auth —una persona que ya usa
 * DaleControl dental, o un docente que da clase en dos institutos— el alta
 * NO falla: se reusa ese supabaseId y se crea solo la fila de edu_users. El
 * par (supabaseId, institutionId) es único, así que la misma persona puede
 * existir en dos institutos sin pisarse. Lo que NO se hace es enseñar una
 * contraseña temporal: esa cuenta ya tiene la suya y cambiarla dejaría
 * fuera a la persona de su otro producto.
 */
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EduPadronError } from "@/lib/edu/padron";
import type { EduRole } from "@/lib/edu/types";
import { eduCurrentAssignmentWhere, eduSearchTokens } from "@/lib/edu/padron-core";
import { eduUserSearchIndex } from "@/lib/edu/search";
import {
  EDU_TEAM_BULK_CHUNK,
  EDU_TEAM_MAX_ROWS,
  EDU_TEMP_PASSWORD_BYTES,
  EDU_ULTIMA_DIRECCION_ERROR,
  eduOverrideDejaSinAdministracion,
  eduTeamFullName,
  eduTeamGuardDireccion,
  eduTeamMemberInput,
  eduTeamPersonaEditInput,
  eduTempPasswordFromBytes,
  type EduTeamAltaResult,
  type EduTeamFilters,
  type EduTeamPersonaEdit,
  type EduTeamRow,
} from "@/lib/edu/equipo-core";
// P2-8: el saneador del catálogo, que existía desde la Ola 0 esperando a la
// pantalla de permisos. TODO lo que venga del cliente pasa por él antes de
// guardarse en permissionsOverride — una key inventada no se guarda.
import { sanitizeEduPermissionKeys } from "@/lib/edu/permissions";
// H-112 · las sedes de una persona. `campus.ts` es el ÚNICO escritor de
// edu_user_campus_access (ver su §3B): aquí se le pide, nunca se toca la
// tabla. En esa tabla la AUSENCIA de filas concede MÁS acceso, así que dos
// sitios decidiendo qué significa "vacío" no es una duplicación estética.
import { eduParseCampusIds, setEduUserCampuses } from "@/lib/edu/campus";
// Ola C · la bitácora. Un solo escritor, y NUNCA lanza: si el renglón de
// auditoría no entra, el alta sigue.
import { eduAudit, type EduAuditActor } from "@/lib/edu/auditoria";

/** El error con status HTTP del vertical, otra vez el MISMO: `eduApiError`
 *  lo mapea tal cual y un error propio saldría como 500 genérico. */
export { EduPadronError as EduEquipoError };

export type { EduTeamAltaResult, EduTeamRow } from "@/lib/edu/equipo-core";

/** Lo mínimo de la sesión que necesita este archivo. */
export interface EduTeamContext {
  institutionId: string;
  eduUserId: string;
  role: EduRole;
  /**
   * Ola C · solo para la BITÁCORA: el nombre del actor va CONGELADO en el
   * renglón (dar de baja a alguien o ascenderlo no puede reescribir con qué
   * sombrero hizo algo ayer). Opcional a propósito, para poder seguir
   * llamando a estas funciones desde una prueba sin fabricar un EduUser
   * entero — el `EduContext` real siempre lo trae.
   */
  user?: { firstName: string; lastName: string } | null;
}

/** El actor de la bitácora a partir del contexto. Ver el comentario de arriba. */
function auditor(ctx: EduTeamContext): EduAuditActor {
  return {
    institutionId: ctx.institutionId,
    eduUserId: ctx.eduUserId,
    role: ctx.role,
    user: { firstName: ctx.user?.firstName ?? "", lastName: ctx.user?.lastName ?? "" },
  };
}

/**
 * H-04 · el rastro de «QUIÉN tocó esta cuenta y cuándo», para meterlo en el
 * `data` de cada escritura sobre `edu_users`.
 *
 * Va en TODAS las escrituras de este archivo y no en algunas: la pregunta
 * que la dirección hace un martes es «¿quién le cambió esto?», y una
 * columna que solo se llena a veces contesta «no se sabe» exactamente igual
 * que una vacía.
 *
 * `updatedByAt` es APARTE de `updatedAt` a propósito: `updatedAt` lo mueve
 * cualquier escritura (un `lastLogin`, por ejemplo) y lo que hay que poder
 * contestar es cuándo la tocó una PERSONA. Y de paso es lo que ancla la
 * caducidad de la contraseña temporal (H-153, ver puerta-core.ts).
 */
function rastro(ctx: EduTeamContext, now: Date) {
  return { updatedById: ctx.eduUserId, updatedByAt: now };
}

function requireInstitution(ctx: EduTeamContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · SUPABASE AUTH — el cliente de administración
// ═══════════════════════════════════════════════════════════════════════

function supabaseEnv(): { url: string; serviceKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    // Mensaje para una persona: quien lo lee es la dirección del instituto,
    // no quien desplegó. Dice a QUIÉN avisar, no qué variable falta.
    throw new EduPadronError(
      "Este servidor no está configurado para crear cuentas. Avísale a quien administra DaleControl.",
      500,
    );
  }
  return { url, serviceKey };
}

/** Mismo patrón que src/app/api/team/route.ts del dental: sin sesión
 *  persistida y sin refresco automático — es un cliente de un solo uso, no
 *  la sesión de nadie. */
function adminClient() {
  const { url, serviceKey } = supabaseEnv();
  return createAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** ¿El error de Supabase es "ese correo ya tiene cuenta"? GoTrue lo ha
 *  dicho de varias formas según la versión, así que se reconocen todas en
 *  vez de casarse con una. */
function esCorreoYaRegistrado(mensaje: string, code?: string): boolean {
  if (code === "email_exists" || code === "user_already_exists") return true;
  const m = mensaje.toLowerCase();
  return (
    m.includes("already been registered") ||
    m.includes("already registered") ||
    m.includes("already exists")
  );
}

/**
 * Encuentra el supabaseId de un correo que YA tiene cuenta.
 *
 * Se busca en este orden y no en otro:
 *
 *  1. NUESTRAS tablas. Es el caso real y el barato: la persona ya está en
 *     OTRO instituto (edu_users) o usa el panel dental (users). Una consulta
 *     a una base que ya está abierta, sin salir a la red.
 *  2. La API de administración de GoTrue, con `filter` por correo. Es UNA
 *     petición, no un recorrido de todos los usuarios del proyecto —que con
 *     el dental vivo en producción serían miles.
 *
 * Devuelve null si no aparece por ningún lado, y entonces quien llama
 * contesta un error que dice qué hacer. Adivinar aquí sería enlazar a una
 * persona con la cuenta de otra.
 */
async function resolverSupabaseIdExistente(email: string): Promise<string | null> {
  const enOtroInstituto = await prisma.eduUser.findFirst({
    where: { email },
    select: { supabaseId: true },
    orderBy: { createdAt: "asc" },
  });
  if (enOtroInstituto?.supabaseId) return enOtroInstituto.supabaseId;

  // El dental. Se lee SOLO el supabaseId: ni el nombre, ni la clínica, ni
  // nada de ese producto entra a este vertical.
  const enDental = await prisma.user.findFirst({
    where: { email },
    select: { supabaseId: true },
    orderBy: { createdAt: "asc" },
  });
  if (enDental?.supabaseId) return enDental.supabaseId;

  try {
    const { url, serviceKey } = supabaseEnv();
    const res = await fetch(
      `${url}/auth/v1/admin/users?per_page=50&filter=${encodeURIComponent(email)}`,
      {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { users?: { id?: string; email?: string }[] };
    // 🔴 Comparación EXACTA del correo: `filter` de GoTrue es un LIKE, así
    // que "ana@x.mx" puede traer también "mariana@x.mx". Enlazar a la
    // persona equivocada sería darle acceso al expediente de otra.
    const exacto = (data.users ?? []).find(
      (u) => typeof u.email === "string" && u.email.toLowerCase() === email && u.id,
    );
    return exacto?.id ?? null;
  } catch {
    // La red falló. No es motivo para inventar un id: quien llama lo
    // traduce en un error que le dice a la dirección qué hacer.
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LECTURA — quién es el equipo del instituto
// ═══════════════════════════════════════════════════════════════════════

function teamWhere(institutionId: string, filters: EduTeamFilters): Prisma.EduUserWhereInput {
  const where: Prisma.EduUserWhereInput = { institutionId };
  if (filters.role) where.role = filters.role;
  if (filters.estado) where.isActive = filters.estado === "activos";

  // 🔴 El buscador mira `searchIndex` (nombre + apellido + correo +
  // teléfono, sin acentos y en minúsculas). Buscar "Rodriguez" tiene que
  // encontrar a "Rodríguez" también aquí: es el mismo bug de la lista de
  // pacientes y se arregla con el mismo mecanismo, no con otro.
  const tokens = eduSearchTokens(filters.q);
  if (tokens.length > 0) {
    where.AND = tokens.map((token) => ({ searchIndex: { contains: token } }));
  }
  return where;
}

/**
 * El equipo del instituto.
 *
 * Salen TODOS los roles, activos e inactivos, porque ésta es la pantalla
 * desde la que se reactiva a alguien: esconder a los dados de baja haría
 * imposible volver a darlos de alta.
 *
 * Se ordena por rol y luego por nombre para que la dirección encuentre "la
 * lista de docentes" sin filtrar.
 */
export async function listEduTeam(
  ctx: EduTeamContext,
  filters: EduTeamFilters,
): Promise<{ rows: EduTeamRow[]; truncated: boolean }> {
  const institutionId = requireInstitution(ctx);
  const rows = await prisma.eduUser.findMany({
    where: teamWhere(institutionId, filters),
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { firstName: "asc" }, { lastName: "asc" }],
    take: EDU_TEAM_MAX_ROWS + 1,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      permissionsOverride: true,
      lastLogin: true,
      createdAt: true,
      studentProfile: { select: { id: true, matricula: true } },
      // H-112 · a qué sedes entra. Viaja para que el editor de la persona
      // arranque de lo que de verdad hay marcado, y para que la fila pueda
      // decir «entra a todas» cuando NO hay ninguna — que es la lectura que
      // sorprende y la que nadie hacía.
      campusAccess: { select: { campusId: true } },
    },
  });

  return {
    truncated: rows.length > EDU_TEAM_MAX_ROWS,
    rows: rows.slice(0, EDU_TEAM_MAX_ROWS).map((u) => ({
      id: u.id,
      name: eduTeamFullName(u),
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      phone: u.phone,
      role: u.role as EduRole,
      isActive: u.isActive,
      isSelf: u.id === ctx.eduUserId,
      // P2-8: para el editor de permisos. Esta pantalla exige equipo.manage,
      // así que quien lo recibe es quien puede escribirlo.
      permissionsOverride: u.permissionsOverride ?? [],
      hasStudentProfile: Boolean(u.studentProfile),
      // El de EduStudent. `u.id` es el de la cuenta y NO sirve para la ficha.
      studentId: u.studentProfile?.id ?? null,
      matricula: u.studentProfile?.matricula ?? null,
      lastLogin: iso(u.lastLogin),
      createdAt: u.createdAt.toISOString(),
      // Vacío = TODAS las sedes (la regla de la ola de sedes). La pantalla
      // lo dice con esas palabras; aquí solo se transporta.
      campusIds: u.campusAccess.map((a) => a.campusId),
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL ALTA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Da de alta a UNA persona: cuenta en Supabase Auth + fila en edu_users.
 *
 * Devuelve un EduTeamAltaResult (no lanza) porque el alta masiva necesita
 * seguir con el renglón siguiente cuando uno falla: si esto lanzara, un
 * correo mal escrito en la fila 12 tiraría las 200. Los errores de
 * PERMISO y de sesión sí lanzan, y los lanza el endpoint antes de llegar
 * aquí.
 */
export async function createEduTeamMember(
  ctx: EduTeamContext,
  input: {
    firstName?: unknown;
    lastName?: unknown;
    email?: unknown;
    role?: unknown;
    phone?: unknown;
  },
  institutionName: string,
  /**
   * 🔴 H-112 · LAS SEDES A LAS QUE ENTRA, elegidas en el mismo paso del
   * alta. Tienen que venir YA validadas contra este instituto
   * (`eduParseCampusIds`, campus.ts): el endpoint las valida UNA vez y el
   * alta masiva las reusa para las 25 filas, en vez de preguntarle a la
   * base lo mismo veinticinco veces.
   *
   * ⚠️ Lista VACÍA = TODAS las sedes. Es la regla de la ola de sedes y NO
   * se cambia aquí (cambiarla dejaría fuera a todo el mundo el día que se
   * aplicó): lo que cambia es que ahora el alta lo PREGUNTA y la pantalla
   * dice qué significa no marcar ninguna.
   */
  campusIds: string[] = [],
  now: Date = new Date(),
): Promise<EduTeamAltaResult> {
  const institutionId = requireInstitution(ctx);

  const check = eduTeamMemberInput(input);
  const correoCrudo = typeof input.email === "string" ? input.email.trim() : "";
  if (!check.value) {
    return {
      ok: false,
      email: correoCrudo,
      name: "",
      role: null,
      tempPassword: null,
      reused: false,
      id: null,
      error: check.error,
    };
  }
  const { firstName, lastName, email, role, phone } = check.value;
  const name = eduTeamFullName({ firstName, lastName, email });
  const fallo = (error: string): EduTeamAltaResult => ({
    ok: false,
    email,
    name,
    role,
    tempPassword: null,
    reused: false,
    id: null,
    error,
  });

  // 🔴 H-16 · CREAR UNA DIRECCIÓN ES COSA DE LA DIRECCIÓN. El <select> del
  // alta ofrecía los cuatro roles a cualquiera con `equipo.manage`, y esa
  // llave se presta por override a un coordinador. Con ella se creaba una
  // cuenta DIRECCION con un correo propio, se leía su contraseña temporal en
  // la misma pantalla que la crea, y se entraba como dirección del instituto.
  // Se devuelve como fallo de renglón (no lanza) para que un alta masiva con
  // una fila de más no tire las otras 199.
  const guard = eduTeamGuardDireccion(ctx.role, role, "crear");
  if (guard) return fallo(guard);

  // Ya está en ESTE instituto → no se toca Supabase siquiera. El índice
  // único (supabaseId, institutionId) lo rebotaría igual, pero con un error
  // de base de datos que no le dice nada a nadie.
  const yaEsta = await prisma.eduUser.findFirst({
    where: { institutionId, email },
    select: { id: true, isActive: true },
  });
  if (yaEsta) {
    return fallo(
      yaEsta.isActive
        ? "Ya hay alguien con ese correo en este instituto."
        : "Ya hay alguien con ese correo en este instituto, dado de baja. Reactívalo en vez de crearlo otra vez.",
    );
  }

  const admin = adminClient();
  const tempPassword = eduTempPasswordFromBytes(randomBytes(EDU_TEMP_PASSWORD_BYTES));

  let supabaseId: string | null = null;
  let reused = false;

  const { data: creado, error: errorAlta } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    // Sin correo de verificación y SIN invitación: la contraseña se le
    // entrega a la persona en la mano. Una escuela da de alta a 40 alumnos
    // en una tarde y no puede depender de 40 bandejas de entrada.
    email_confirm: true,
    user_metadata: { firstName, lastName, institutionName },
  });

  if (creado?.user?.id) {
    supabaseId = creado.user.id;
  } else {
    const mensaje = errorAlta?.message ?? "";
    const code = (errorAlta as { code?: string } | null)?.code;
    if (!esCorreoYaRegistrado(mensaje, code)) {
      return fallo(mensaje || "Supabase no pudo crear la cuenta.");
    }
    // 🔴 EL CASO QUE ANTES REVENTABA. El correo ya tiene cuenta en
    // DaleControl (el panel dental, u otro instituto). No se falla: se
    // reusa ese supabaseId y se crea SOLO la fila de edu_users.
    supabaseId = await resolverSupabaseIdExistente(email);
    reused = true;
    if (!supabaseId) {
      return fallo(
        "Ese correo ya tiene cuenta en DaleControl pero no se pudo enlazar. Inténtalo de nuevo; si sigue, avísale a quien administra DaleControl.",
      );
    }
  }

  try {
    // 🔴 LA PERSONA Y SUS SEDES, EN LA MISMA TRANSACCIÓN. Media alta
    // —cuenta creada, sedes no— es una persona con acceso al instituto
    // ENTERO sin que nadie lo haya decidido, que es exactamente el H-112
    // visto desde el otro lado.
    const fila = await prisma.$transaction(async (tx) => {
      const creada = await tx.eduUser.create({
        data: {
          institutionId,
          supabaseId,
          email,
          firstName,
          lastName,
          role,
          phone,
          isActive: true,
          // El índice sin acentos se escribe AQUÍ, en el mismo create: una
          // persona que existe y no se puede buscar es una persona que, para
          // quien la busca, no existe.
          searchIndex: eduUserSearchIndex({ firstName, lastName, email, phone }),
          // La contraseña la generó el sistema y la conoce quien dio de alta:
          // esa persona no puede quedarse con ella. Cuando se REUSA una
          // cuenta no se marca, porque esa persona ya eligió su contraseña y
          // obligarla a cambiarla la sacaría de su otro producto.
          //
          // Desde la ola de cierre (P2-9) esta bandera POR FIN tiene lector:
          // el layout del panel manda a /instituto/cambiar-contrasena a quien
          // la traiga encendida, y no deja pasar hasta que la persona define
          // la suya (POST /api/instituto/auth/cambiar-contrasena la levanta).
          mustChangePassword: !reused,
          // H-04 · quién dio de alta a esta persona y cuándo. Y H-153: es el
          // ancla de la caducidad de la temporal (ver puerta-core.ts) — sin
          // esta fecha, "cuándo se emitió" solo se podría adivinar.
          ...rastro(ctx, now),
        },
        select: { id: true },
      });
      // El único escritor de edu_user_campus_access, con la MISMA `tx`.
      await setEduUserCampuses(ctx, creada.id, campusIds, tx);
      return creada;
    });

    // Bitácora (H-162). Va DESPUÉS de la transacción y nunca lanza: un
    // renglón de auditoría que no entra no puede tumbar un alta que sí pasó.
    // No se registra la contraseña temporal en ninguna parte.
    await eduAudit(auditor(ctx), {
      action: "create",
      entity: "user",
      entityId: fila.id,
      after: {
        email,
        firstName,
        lastName,
        role,
        phone,
        isActive: true,
        mustChangePassword: !reused,
        reusoCuentaExistente: reused,
        sedes: campusIds.length === 0 ? "todas" : campusIds.join(","),
      },
    });

    return {
      ok: true,
      email,
      name,
      role,
      // 🔴 La contraseña sale UNA vez y solo si la creamos nosotros. Si se
      // reusó la cuenta, esa persona entra con la suya de siempre y
      // enseñarle una nueva sería mentirle.
      tempPassword: reused ? null : tempPassword,
      reused,
      id: fila.id,
      error: null,
    };
  } catch (err) {
    // La cuenta de Auth quedó creada y la fila no. El siguiente intento con
    // el mismo correo entra por la rama de "ya registrado" y la REUSA, así
    // que esto se recupera solo — pero se dice, porque quien está mirando
    // tiene que saber que ese renglón no quedó.
    const code = (err as { code?: string })?.code;
    const detalle =
      code === "P2002"
        ? "Ya hay alguien con ese correo en este instituto."
        : "Se creó el acceso pero no se pudo guardar a la persona. Vuelve a intentarlo con el mismo correo.";
    console.error("[instituto] alta de equipo falló tras crear la cuenta de Auth:", err);
    return fallo(detalle);
  }
}

/**
 * El alta MASIVA de un trozo de la lista.
 *
 * Las filas se crean UNA POR UNA y en serie, no en paralelo, a propósito:
 * son llamadas a Supabase Auth y lanzarle 25 a la vez es la forma más
 * rápida de que empiece a contestar 429 y medio grupo se quede sin cuenta
 * con un error que no explica nada.
 *
 * Devuelve un resultado POR RENGLÓN, en el mismo orden: la pantalla pinta
 * la tabla de contraseñas con esto, y un renglón que falló sale con su
 * motivo al lado en vez de desaparecer.
 */
export async function createEduTeamMembers(
  ctx: EduTeamContext,
  filas: unknown,
  institutionName: string,
  /** H-112 · las MISMAS sedes para todo el trozo. Ya validadas. */
  campusIds: string[] = [],
): Promise<EduTeamAltaResult[]> {
  requireInstitution(ctx);
  if (!Array.isArray(filas)) {
    throw new EduPadronError("No mandaste ninguna lista de personas.");
  }
  if (filas.length === 0) {
    throw new EduPadronError("La lista llegó vacía.");
  }
  if (filas.length > EDU_TEAM_BULK_CHUNK) {
    // No es un tope de cuánta gente se puede dar de alta: la pantalla parte
    // la lista y manda varios trozos. Es un tope por PETICIÓN, para que una
    // sola no se pase del tiempo máximo de la función.
    throw new EduPadronError(
      `Manda como mucho ${EDU_TEAM_BULK_CHUNK} personas por vez. La pantalla parte las listas largas sola.`,
    );
  }

  const salida: EduTeamAltaResult[] = [];
  // Una sola hora para todo el trozo: veinticinco filas de la misma tanda
  // con veinticinco marcas de tiempo distintas se leen como veinticinco
  // altas separadas cuando alguien mire la bitácora dentro de un año.
  const now = new Date();
  for (const fila of filas) {
    const input = (fila ?? {}) as Record<string, unknown>;
    salida.push(await createEduTeamMember(ctx, input, institutionName, campusIds, now));
  }
  return salida;
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LA BAJA — desactivar, JAMÁS borrar
// ═══════════════════════════════════════════════════════════════════════

/**
 * Da de baja (o reactiva) a una persona.
 *
 * 🔴 NUNCA SE BORRA LA FILA, y no es una preferencia estética: sus notas
 * clínicas, sus casos, sus citas y sus cobros la referencian por id. Un
 * DELETE se llevaría por delante el expediente de pacientes reales —los
 * onDelete del schema son Cascade porque están pensados para borrar un
 * instituto entero, no una persona— y además dejaría una nota clínica
 * firmada sin autor, que es exactamente lo que la NOM-004 no permite.
 *
 * Dar de baja apaga el acceso al panel: getEduContext solo resuelve
 * usuarios con isActive true, así que la sesión siguiente ya no entra.
 *
 * ⚠️ Lo que NO hace: tocar la cuenta de Supabase Auth. Es a propósito — esa
 * misma cuenta puede ser la que esa persona usa en el panel dental o en
 * otro instituto, y desactivarla ahí sería sacarla de un producto que no
 * tiene nada que ver con esta escuela.
 */
export async function setEduTeamMemberActive(
  ctx: EduTeamContext,
  memberId: string,
  isActive: boolean,
  now: Date = new Date(),
): Promise<{ id: string; isActive: boolean; supervisionesCerradas: number }> {
  const institutionId = requireInstitution(ctx);

  const persona = await prisma.eduUser.findFirst({
    where: { id: memberId, institutionId },
    select: { id: true, isActive: true, role: true },
  });
  if (!persona) throw new EduPadronError("Esa persona no es de este instituto.", 404);

  if (persona.isActive === isActive) {
    throw new EduPadronError(
      isActive ? "Esa cuenta ya estaba activa." : "Esa cuenta ya estaba dada de baja.",
    );
  }

  // 🔴 H-16 · A una cuenta de DIRECCION solo la toca otra de DIRECCION.
  // Cubre los dos sentidos a propósito: dar de baja a la dirección que había
  // era el primer eslabón de la cadena de escalada, y REACTIVAR una
  // dirección dada de baja es devolverle la llave de la escuela —que es
  // exactamente la misma decisión, vista del otro lado.
  const guard = eduTeamGuardDireccion(ctx.role, persona.role as EduRole, isActive ? "reactivar" : "baja");
  if (guard) throw new EduPadronError(guard, 403);

  if (!isActive) {
    // 🔴 Nadie se da de baja a sí mismo. Con una sola dirección en la
    // escuela —que es lo normal— sería cerrar la puerta desde dentro con
    // la llave puesta fuera: no habría quién reactivara a nadie.
    if (persona.id === ctx.eduUserId) {
      throw new EduPadronError(
        "No puedes darte de baja a ti mismo. Pídeselo a otra persona de dirección.",
      );
    }
    // Y tampoco se da de baja a la ÚLTIMA dirección activa, por lo mismo:
    // el instituto se quedaría sin nadie que pueda dar de alta.
    if (persona.role === "DIRECCION") {
      const otras = await prisma.eduUser.count({
        where: { institutionId, role: "DIRECCION", isActive: true, NOT: { id: persona.id } },
      });
      if (otras === 0) {
        throw new EduPadronError(
          "Es la única cuenta de dirección activa. Da de alta a otra antes de dar de baja a ésta.",
        );
      }
    }
  }

  // ── LA ESCRITURA, con el estado leído en el `where` ─────────────────
  // Es el patrón de la casa desde la Ola A (recetas, consentimientos): entre
  // el `findFirst` de arriba y esta escritura caben otra pestaña y otra
  // persona de dirección. `updateMany` con `isActive: !isActive` en el where
  // convierte la carrera en un 409 con texto, en vez de en dos bajas que se
  // pisan —y, peor, en unas supervisiones cerradas dos veces.
  //
  // 🔴 H-99 · DAR DE BAJA A UN DOCENTE CIERRA SUS SUPERVISIONES. Sin esto,
  // sus 12 asignaciones seguían VIGENTES: la lista lo pintaba «Inactivo · 12
  // estudiantes hoy», el padrón lo seguía enseñando como titular, y sus 12
  // alumnos se quedaban con las autorizaciones pendientes en manos de una
  // persona que ya no entra. El código ya sabía que un docente inactivo no
  // debe llevar alumnos —`assignEduSupervisor` rebota una asignación NUEVA
  // contra un docente de baja—; lo que faltaba era cerrar las que ya tenía.
  //
  // Se cierran (endsAt = ahora), NUNCA se borran: dentro de un año hay que
  // poder contestar quién supervisaba a este alumno el 3 de marzo.
  // Reactivar NO las reabre: quién supervisa a quién hoy es una decisión
  // académica que se toma en el padrón, no un efecto secundario.
  const { supervisionesCerradas } = await prisma.$transaction(async (tx) => {
    const cambio = await tx.eduUser.updateMany({
      where: { id: persona.id, institutionId, isActive: !isActive },
      // H-04 · con el rastro de quién la dio de baja (o la reactivó).
      data: { isActive, ...rastro(ctx, now) },
    });
    if (cambio.count === 0) {
      throw new EduPadronError(
        isActive
          ? "Alguien reactivó esa cuenta mientras mirabas. Actualiza la pantalla."
          : "Alguien dio de baja esa cuenta mientras mirabas. Actualiza la pantalla.",
        409,
      );
    }

    if (!isActive && persona.role === "DOCENTE") {
      const cerradas = await tx.eduSupervisorAssignment.updateMany({
        where: {
          institutionId,
          supervisorUserId: persona.id,
          ...eduCurrentAssignmentWhere(now),
        },
        data: { endsAt: now },
      });
      return { supervisionesCerradas: cerradas.count };
    }
    return { supervisionesCerradas: 0 };
  });

  await eduAudit(auditor(ctx), {
    action: isActive ? "update" : "delete",
    entity: "user",
    entityId: persona.id,
    before: { isActive: !isActive },
    after: { isActive, supervisionesCerradas },
  });

  return { id: persona.id, isActive, supervisionesCerradas };
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · LOS PERMISOS (P2-8) — el override por fin se escribe desde el panel
// ═══════════════════════════════════════════════════════════════════════

/**
 * Guarda (o restaura) el override de permisos de una persona.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 CIERRE (P2-8) · LA PANTALLA DE PERMISOS QUE EL CATÁLOGO PROMETÍA.
 *
 * permissions.ts describía desde la Ola 0 una pantalla de permisos que
 * nunca se construyó: EDU_PERMISSION_GROUPS y sanitizeEduPermissionKeys no
 * tenían UN solo llamador, y todos los "si un día alguien le enciende X por
 * override desde la pantalla de permisos" eran teóricos — el único camino
 * real era SQL a mano. Esta función (y el editor en la pantalla de equipo)
 * los cablea.
 *
 * LAS REGLAS, y por qué:
 *
 *   · `keys: null` = RESTAURAR el rol (override vacío). Es distinto de
 *     mandar una lista vacía, que REBOTA: por la semántica del override
 *     (getEduEffectivePermissions), una lista vacía CAE al default del rol
 *     — así que "sin ninguna casilla" no existe como estado. Guardarla en
 *     silencio le diría a la dirección "le quité todo" cuando en realidad
 *     le devolvió todo. Para dejar a alguien sin panel se le da de baja.
 *
 *   · 🔴 NADIE SE EDITA SUS PROPIOS PERMISOS. Es la misma regla que "nadie
 *     se da de baja a sí mismo", y con una consecuencia extra que importa:
 *     como quien edita conserva SIEMPRE su equipo.manage, el instituto no
 *     puede quedarse sin nadie que administre por una tarde de casillas.
 *
 *   · Las keys pasan por sanitizeEduPermissionKeys: lo inventado y lo
 *     repetido se descarta ANTES de tocar la base.
 *
 * ⚠️ Lo que un override NO puede abrir sigue cerrado por el ALCANCE: el
 * dinero, el expediente para caja, el tablero de dirección — los dos
 * candados de siempre. Encender una casilla de más enseña una pantalla
 * vacía, no los datos. Es exactamente el diseño que el catálogo describe.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function setEduTeamMemberPermissions(
  ctx: EduTeamContext,
  memberId: string,
  rawKeys: unknown,
): Promise<{ id: string; permissionsOverride: string[] }> {
  const institutionId = requireInstitution(ctx);

  const persona = await prisma.eduUser.findFirst({
    where: { id: memberId, institutionId },
    select: { id: true, role: true, isActive: true, permissionsOverride: true },
  });
  if (!persona) throw new EduPadronError("Esa persona no es de este instituto.", 404);

  if (persona.id === ctx.eduUserId) {
    throw new EduPadronError(
      "No puedes editar tus propios permisos. Pídeselo a otra persona de dirección.",
    );
  }

  // 🔴 H-16 · LOS PERMISOS DE UNA DIRECCIÓN LOS EDITA OTRA DIRECCIÓN. Éste
  // era el segundo eslabón: con `equipo.manage` prestado se abría «Permisos»
  // sobre la cuenta de dirección y se le dejaba solo `inicio.view`. Esa
  // dirección perdía `equipo.manage` y NO podía recuperarlo —hacen falta
  // permisos que ya no tiene—, así que el instituto se quedaba administrado
  // por quien había hecho el recorte.
  const guard = eduTeamGuardDireccion(ctx.role, persona.role as EduRole, "permisos");
  if (guard) throw new EduPadronError(guard, 403);

  let override: string[];
  if (rawKeys === null) {
    override = [];
  } else if (Array.isArray(rawKeys)) {
    override = sanitizeEduPermissionKeys(rawKeys);
    if (override.length === 0) {
      throw new EduPadronError(
        "No quedó ninguna casilla válida. Sin casillas no hay permisos personalizados: usa «Restaurar el rol», o da de baja la cuenta si lo que quieres es cerrarle el panel.",
      );
    }
  } else {
    throw new EduPadronError("Manda la lista de permisos, o null para restaurar el rol.", 400);
  }

  // 🔴 H-16 · Y NADIE VACÍA A LA ÚLTIMA DIRECCIÓN ACTIVA. Con DOS cuentas
  // de dirección la cadena todavía se podía encadenar: dar de baja a la
  // primera (permitido, solo se protegía a la última) y recortarle los
  // permisos a la segunda. Al llegar a la última, quitarle «Administrar el
  // equipo» deja al instituto sin nadie que pueda devolvérselo — ni a ella
  // misma, porque nadie edita sus propios permisos.
  //
  // Restaurar el rol (`null` → override vacío) NUNCA cae aquí: el default de
  // DIRECCION lleva `equipo.manage`, así que siempre queda esa salida.
  if (override.length > 0 && persona.role === "DIRECCION" && persona.isActive) {
    const otras = await prisma.eduUser.count({
      where: { institutionId, role: "DIRECCION", isActive: true, NOT: { id: persona.id } },
    });
    if (eduOverrideDejaSinAdministracion(override, otras === 0)) {
      throw new EduPadronError(EDU_ULTIMA_DIRECCION_ERROR, 409);
    }
  }

  // El estado leído en el `where`: el ROL. Si otra pestaña le cambió el rol
  // entre la lectura y esta escritura, el guardia de arriba se resolvió
  // contra un rol que ya no es el suyo — y los permisos que se guardarían
  // serían los que se marcaron para el rol viejo.
  const anterior = persona.permissionsOverride ?? [];
  const escrito = await prisma.eduUser.updateMany({
    where: { id: persona.id, institutionId, role: persona.role },
    data: {
      permissionsOverride: override,
      // 🔴 H-04 · EL OVERRIDE QUE SE VA NO DESAPARECE. Hasta esta ola, la
      // única forma de recuperar lo que alguien tenía marcado era que quien
      // lo cambió lo hubiera apuntado del mensaje verde. Ahora queda en la
      // fila (y el diff completo, en la bitácora).
      permissionsOverridePrevious: anterior,
      ...rastro(ctx, new Date()),
    },
  });
  if (escrito.count === 0) {
    throw new EduPadronError(
      "Alguien cambió el rol de esa cuenta mientras editabas sus permisos. Actualiza la pantalla y vuelve a mirarlos.",
      409,
    );
  }

  await eduAudit(auditor(ctx), {
    action: "update",
    entity: "user",
    entityId: persona.id,
    before: { permissionsOverride: anterior.join(",") || "(el default del rol)" },
    after: { permissionsOverride: override.join(",") || "(el default del rol)" },
  });

  return { id: persona.id, permissionsOverride: override };
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · CORREGIR A UNA PERSONA (H-04) — nombre, correo, teléfono y ROL
//
// Hasta esta ola, los CUATRO únicos escritores de EduUser en todo el repo
// eran `isActive`, `permissionsOverride`, la cédula profesional y
// `mustChangePassword`. El alta capturaba cinco campos y el único PATCH
// admitía dos: un `maria.rodrigez@…` mal tecleado dejaba a esa persona fuera
// para siempre y la fila vieja huérfana; una alumna que se casaba se quedaba
// con el apellido viejo firmando notas clínicas el resto de su carrera; y un
// docente que ascendía a coordinación necesitaba OTRA cuenta, con su
// historial clínico colgando del id viejo.
// ═══════════════════════════════════════════════════════════════════════

export interface EduTeamUpdateResult {
  id: string;
  emailChanged: boolean;
  roleChanged: boolean;
  /**
   * 🔴 El override de permisos que se BORRÓ al cambiar de rol. Viaja de
   * vuelta porque NO HAY DÓNDE GUARDARLO: el vertical no tiene columna de
   * histórico ni bitácora (H-162), así que la única forma de que no
   * desaparezca sin dejar rastro es enseñárselo a quien hizo el cambio, en
   * el momento, para que lo apunte. Vacío si no había o si no cambió el rol.
   */
  overrideDescartado: string[];
}

/**
 * ¿Esta cuenta de Auth la comparte alguien más? (el panel dental, u otro
 * instituto)
 *
 * Importa para DOS decisiones distintas, y las dos por lo mismo: la cuenta
 * de Supabase Auth es UNA para todo DaleControl. Cambiarle el correo o la
 * contraseña desde aquí le cambia el login en el otro producto, y ese otro
 * producto no es de este vertical.
 */
async function cuentaCompartida(
  supabaseId: string,
  eduUserId: string,
): Promise<{ enDental: boolean; enOtroInstituto: boolean }> {
  const [dental, otro] = await Promise.all([
    prisma.user.findFirst({ where: { supabaseId }, select: { id: true } }),
    prisma.eduUser.findFirst({
      where: { supabaseId, NOT: { id: eduUserId } },
      select: { id: true },
    }),
  ]);
  return { enDental: Boolean(dental), enOtroInstituto: Boolean(otro) };
}

/**
 * Corrige los datos de una persona del instituto.
 *
 * ── EL CORREO, QUE NO ES UNA COLUMNA MÁS ────────────────────────────────
 * Es la IDENTIDAD DE LOGIN en Supabase Auth. Se escribe en LOS DOS lados y
 * en este orden: Auth primero (es la fuente de verdad del login) y Prisma
 * solo si Auth contestó OK; si Prisma truena después, se REVIERTE Auth.
 * Dejar Auth con el correo nuevo y el panel con el viejo es el estado
 * imposible de depurar que esto viene a cerrar. Es el mismo camino que el
 * alta y el mismo que el dental (src/app/api/team/[id]/route.ts:144-180).
 *
 * ⚠️ Si esa cuenta de Auth la usa TAMBIÉN el panel dental, el correo NO se
 * cambia desde aquí y se dice por qué: este vertical no escribe tablas del
 * dental (misma regla que el cambio de contraseña), así que cambiar el login
 * dejaría al panel dental mostrando un correo que ya no entra.
 *
 * ── EL ROL ──────────────────────────────────────────────────────────────
 * Solo lo cambia una DIRECCION, nunca sobre sí misma, y BORRA el override:
 * como el override REEMPLAZA al default del rol (no se suma), un override
 * escrito para el rol viejo seguiría mandando sobre el rol nuevo — un
 * "docente ascendido a dirección" se quedaría con los permisos de docente y
 * nadie entendería por qué.
 */
export async function updateEduTeamMember(
  ctx: EduTeamContext,
  memberId: string,
  input: {
    firstName?: unknown;
    lastName?: unknown;
    email?: unknown;
    phone?: unknown;
    role?: unknown;
  },
): Promise<EduTeamUpdateResult> {
  const institutionId = requireInstitution(ctx);

  const check = eduTeamPersonaEditInput(input);
  if (!check.value) throw new EduPadronError(check.error);
  const cambios: EduTeamPersonaEdit = check.value;

  const persona = await prisma.eduUser.findFirst({
    where: { id: memberId, institutionId },
    select: {
      id: true,
      supabaseId: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      role: true,
      isActive: true,
      permissionsOverride: true,
    },
  });
  if (!persona) throw new EduPadronError("Esa persona no es de este instituto.", 404);

  // 🔴 H-16 · a una cuenta de DIRECCION solo la toca otra de DIRECCION.
  // Cambiarle el correo a la dirección es apoderarse de su login: con el
  // correo nuevo se pide "olvidé mi contraseña" y se toma la cuenta.
  const guardActual = eduTeamGuardDireccion(ctx.role, persona.role as EduRole, "datos");
  if (guardActual) throw new EduPadronError(guardActual, 403);

  const roleChanged = Boolean(cambios.role) && cambios.role !== persona.role;
  if (roleChanged) {
    // Cambiar de rol es cambiar quién es esta persona en el instituto: solo
    // la dirección. Y el rol DESTINO pasa por el mismo guardia, para que
    // nadie se ascienda a nadie a dirección por la puerta de atrás.
    if (ctx.role !== "DIRECCION") {
      throw new EduPadronError(
        "Solo una cuenta de Dirección puede cambiar el rol de una persona.",
        403,
      );
    }
    const guardDestino = eduTeamGuardDireccion(ctx.role, cambios.role as EduRole, "crear");
    if (guardDestino) throw new EduPadronError(guardDestino, 403);

    if (persona.id === ctx.eduUserId) {
      throw new EduPadronError(
        "No puedes cambiarte el rol a ti mismo. Pídeselo a otra persona de dirección.",
      );
    }
    // La última dirección activa no se degrada: el instituto se quedaría sin
    // nadie que pueda dar de alta, dar de baja ni repartir permisos. Es la
    // misma regla que ya protegía la baja, por el mismo motivo.
    if (persona.role === "DIRECCION" && persona.isActive) {
      const otras = await prisma.eduUser.count({
        where: { institutionId, role: "DIRECCION", isActive: true, NOT: { id: persona.id } },
      });
      if (otras === 0) {
        throw new EduPadronError(
          "Es la única cuenta de Dirección activa del instituto. Da de alta a otra antes de cambiarle el rol a ésta.",
        );
      }
    }
  }

  const emailChanged = Boolean(cambios.email) && cambios.email !== persona.email;

  // ── El correo, comprobado ANTES de tocar Supabase ────────────────────
  let compartida = { enDental: false, enOtroInstituto: false };
  if (emailChanged) {
    compartida = await cuentaCompartida(persona.supabaseId, persona.id);
    if (compartida.enDental) {
      throw new EduPadronError(
        "Ese acceso es el mismo que esta persona usa en el panel dental de DaleControl. Cambiarle el correo aquí le cambiaría el login allá, y este panel no escribe los datos del dental: el cambio tiene que hacerse desde ahí.",
        409,
      );
    }
    const choque = await prisma.eduUser.findFirst({
      where: { institutionId, email: cambios.email, NOT: { id: persona.id } },
      select: { id: true },
    });
    if (choque) {
      throw new EduPadronError("Ya hay alguien con ese correo en este instituto.", 409);
    }
  }

  // Los valores FINALES, para reescribir el índice sin acentos. Si no se
  // reescribiera, corregir un apellido dejaría a la persona buscable por el
  // viejo y no por el nuevo — que es la misma trampa que ya se cerró en el
  // alta y en la matrícula del padrón.
  const finalFirst = cambios.firstName ?? persona.firstName;
  const finalLast = cambios.lastName ?? persona.lastName;
  const finalEmail = cambios.email ?? persona.email;
  const finalPhone = cambios.phone !== undefined ? cambios.phone : persona.phone;

  const now = new Date();
  const overrideAnterior = persona.permissionsOverride ?? [];
  const data: Prisma.EduUserUpdateManyMutationInput = {
    ...(cambios.firstName !== undefined && { firstName: cambios.firstName }),
    ...(cambios.lastName !== undefined && { lastName: cambios.lastName }),
    ...(cambios.phone !== undefined && { phone: cambios.phone }),
    ...(emailChanged && { email: cambios.email }),
    ...(roleChanged && {
      role: cambios.role,
      permissionsOverride: [],
      // 🔴 H-04 · el override que BORRA el cambio de rol queda guardado, y
      // H-114 · el rol anterior también, con su fecha. Un alumno que se
      // gradúa y vuelve de docente es la misma persona con dos historias, y
      // hasta esta ola la primera desaparecía en el instante del cambio: la
      // única constancia era el mensaje verde que quien lo hizo tenía que
      // apuntar a mano.
      permissionsOverridePrevious: overrideAnterior,
      rolePrevious: persona.role as EduRole,
      roleChangedAt: now,
    }),
    // H-04 · quién tocó la ficha, en TODOS los casos (no solo al cambiar el
    // rol): la pregunta «¿quién le cambió el correo?» es la que no se podía
    // contestar.
    ...rastro(ctx, now),
    searchIndex: eduUserSearchIndex({
      firstName: finalFirst,
      lastName: finalLast,
      email: finalEmail,
      phone: finalPhone,
    }),
  };

  // ── Auth PRIMERO ─────────────────────────────────────────────────────
  let admin: ReturnType<typeof adminClient> | null = null;
  if (emailChanged) {
    admin = adminClient();
    const { error } = await admin.auth.admin.updateUserById(persona.supabaseId, {
      email: cambios.email,
      // Sin esto el correo queda pendiente de confirmar y la persona no
      // entra hasta hacer clic en un mail que nunca pidió.
      email_confirm: true,
    });
    if (error) {
      const mensaje = error.message ?? "";
      const code = (error as { code?: string })?.code;
      if (esCorreoYaRegistrado(mensaje, code)) {
        throw new EduPadronError(
          "Ese correo ya tiene cuenta en DaleControl. Usa otro distinto para esta persona.",
          409,
        );
      }
      console.error("[instituto] cambio de correo falló en Supabase:", mensaje);
      throw new EduPadronError(
        "No se pudo cambiar el correo de acceso. No se guardó ningún cambio.",
        502,
      );
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      // El estado leído en el `where`: el rol y el correo con los que se
      // tomaron las decisiones de arriba. Si otra pestaña los cambió en
      // medio, esto no escribe y contesta 409 en vez de pisar.
      const escrito = await tx.eduUser.updateMany({
        where: { id: persona.id, institutionId, role: persona.role, email: persona.email },
        data,
      });
      if (escrito.count === 0) {
        throw new EduPadronError(
          "Alguien más cambió los datos de esa persona mientras editabas. Actualiza la pantalla y vuelve a mirarlos.",
          409,
        );
      }

      // El correo es de la CUENTA, no del instituto: si esta persona da
      // clase en dos, las dos filas tienen que decir el mismo correo — el
      // login es uno solo. Y con el correo va su índice de búsqueda, o en el
      // otro instituto dejaría de encontrarse por el correo nuevo.
      if (emailChanged && compartida.enOtroInstituto) {
        const hermanas = await tx.eduUser.findMany({
          where: { supabaseId: persona.supabaseId, NOT: { id: persona.id } },
          select: { id: true, firstName: true, lastName: true, phone: true },
        });
        for (const h of hermanas) {
          await tx.eduUser.update({
            where: { id: h.id },
            data: {
              email: cambios.email,
              searchIndex: eduUserSearchIndex({
                firstName: h.firstName,
                lastName: h.lastName,
                email: cambios.email,
                phone: h.phone,
              }),
            },
          });
        }
      }
    });
  } catch (err) {
    // Supabase ya cambió y Prisma no. Se revierte Auth para que la persona
    // siga entrando con el correo que el panel enseña.
    if (emailChanged && admin) {
      const { error: revertError } = await admin.auth.admin.updateUserById(persona.supabaseId, {
        email: persona.email,
        email_confirm: true,
      });
      if (revertError) {
        console.error(
          "[instituto] CUENTAS DESINCRONIZADAS: Supabase quedó con el correo nuevo, Prisma con el viejo, y la reversión también falló.",
          {
            eduUserId: persona.id,
            supabaseId: persona.supabaseId,
            emailAnterior: persona.email,
            emailNuevo: cambios.email,
            causa: err,
            revertError,
          },
        );
        throw new EduPadronError(
          `No se guardó el cambio y tampoco se pudo deshacer: esa cuenta quedó entrando con ${cambios.email} aunque el panel siga mostrando ${persona.email}. Avísale a quien administra DaleControl con este dato antes de volver a intentarlo.`,
          500,
        );
      }
    }
    throw err;
  }

  await eduAudit(auditor(ctx), {
    action: "update",
    entity: "user",
    entityId: persona.id,
    before: {
      firstName: persona.firstName,
      lastName: persona.lastName,
      email: persona.email,
      phone: persona.phone,
      role: persona.role,
      ...(roleChanged && { permissionsOverride: overrideAnterior.join(",") }),
    },
    after: {
      firstName: finalFirst,
      lastName: finalLast,
      email: finalEmail,
      phone: finalPhone,
      role: roleChanged ? cambios.role : persona.role,
      ...(roleChanged && { permissionsOverride: "(borrado por el cambio de rol)" }),
    },
  });

  return {
    id: persona.id,
    emailChanged,
    roleChanged,
    overrideDescartado: roleChanged ? overrideAnterior : [],
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · RESTABLECER LA CONTRASEÑA (H-04) — sin pasar por Supabase a mano
//
// `equipo-core.ts` decía, y era verdad: «Si se pierde, la dirección tiene que
// restablecerla desde Supabase». Mientras tanto el login prometía lo
// contrario —«La dirección de tu instituto da de alta las cuentas y
// restablece las contraseñas»—. Una tarde de 40 altas y una contraseña
// apuntada mal dejaban a esa persona fuera hasta que alguien con acceso al
// proyecto de Supabase la rescatara.
//
// Es el mismo camino que el alta, ni uno nuevo: temporal generada aquí +
// `mustChangePassword`. Y desde H-03, esa marca ya no solo cierra pantallas:
// cierra la API entera hasta que la persona defina la suya.
// ═══════════════════════════════════════════════════════════════════════

export async function resetEduTeamMemberPassword(
  ctx: EduTeamContext,
  memberId: string,
): Promise<{ id: string; name: string; email: string; tempPassword: string }> {
  const institutionId = requireInstitution(ctx);

  const persona = await prisma.eduUser.findFirst({
    where: { id: memberId, institutionId },
    select: {
      id: true,
      supabaseId: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      mustChangePassword: true,
    },
  });
  if (!persona) throw new EduPadronError("Esa persona no es de este instituto.", 404);

  const guard = eduTeamGuardDireccion(ctx.role, persona.role as EduRole, "contrasena");
  if (guard) throw new EduPadronError(guard, 403);

  if (!persona.isActive) {
    throw new EduPadronError(
      "Esa cuenta está dada de baja. Reactívala antes de restablecerle la contraseña.",
    );
  }

  // 🔴 LA MISMA REGLA QUE EL ALTA, Y POR LO MISMO. Si ese acceso lo usa
  // también el panel dental o otro instituto, cambiarle la contraseña desde
  // aquí la deja fuera de un producto que no tiene nada que ver con esta
  // escuela. El alta ya se negaba a enseñar una temporal en ese caso
  // (`tempPassword: reused ? null : …`); esto es la misma decisión.
  const compartida = await cuentaCompartida(persona.supabaseId, persona.id);
  if (compartida.enDental || compartida.enOtroInstituto) {
    throw new EduPadronError(
      compartida.enDental
        ? "Ese acceso es el mismo que esta persona usa en el panel dental de DaleControl: cambiarle la contraseña aquí la dejaría fuera de allá. Que la recupere desde «¿Olvidaste tu contraseña?» del panel dental."
        : "Esa persona usa el mismo acceso en otro instituto: cambiarle la contraseña aquí la dejaría fuera del otro. Que la recupere desde «¿Olvidaste tu contraseña?».",
      409,
    );
  }

  const tempPassword = eduTempPasswordFromBytes(randomBytes(EDU_TEMP_PASSWORD_BYTES));

  // Auth PRIMERO: es la fuente de verdad del login. Si falla, no se toca
  // Prisma — marcar `mustChangePassword` con la contraseña vieja todavía
  // viva sería dejar a la persona sin poder entrar y sin poder cambiarla.
  const admin = adminClient();
  const { error } = await admin.auth.admin.updateUserById(persona.supabaseId, {
    password: tempPassword,
  });
  if (error) {
    console.error("[instituto] restablecer contraseña falló en Supabase:", error.message);
    throw new EduPadronError(
      "No se pudo restablecer la contraseña. Intenta de nuevo.",
      502,
    );
  }

  // La temporal la conoce quien la generó: esa persona no puede quedarse con
  // ella. El estado leído en el `where` es `isActive` — si le dieron de baja
  // mientras tanto, la marca no se escribe y se dice.
  const marcado = await prisma.eduUser.updateMany({
    where: { id: persona.id, institutionId, isActive: true },
    // 🔴 `rastro` NO es decoración aquí: `updatedByAt` es lo que ANCLA la
    // caducidad de esta temporal (H-153, puerta-core.ts). Sin esta fecha, la
    // temporal recién emitida heredaría la antigüedad de la cuenta y podría
    // nacer caducada.
    data: { mustChangePassword: true, ...rastro(ctx, new Date()) },
  });
  if (marcado.count === 0) {
    // La contraseña de Auth YA cambió. No se revierte —no la tenemos— pero
    // se dice exactamente qué pasó, que es lo único útil aquí.
    throw new EduPadronError(
      "Se cambió la contraseña, pero alguien dio de baja esa cuenta mientras tanto. Reactívala y vuelve a restablecerla para que se le exija cambiarla al entrar.",
      409,
    );
  }

  // La contraseña NO entra a la bitácora, ni la vieja ni la nueva. Lo que
  // se registra es el ACTO: quién le restableció el acceso a quién.
  await eduAudit(auditor(ctx), {
    action: "update",
    entity: "user",
    entityId: persona.id,
    before: { mustChangePassword: persona.mustChangePassword },
    after: { mustChangePassword: true, contrasenaRestablecida: true },
  });

  return {
    id: persona.id,
    name: eduTeamFullName(persona),
    email: persona.email,
    tempPassword,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 8 · LAS SEDES DE UNA PERSONA (H-112) — editables después del alta
//
// El alta ya las pregunta; esto es la otra mitad, «editable después desde
// la persona»: la misma casilla, en el mismo diálogo desde el que se
// corrige su correo o su rol, para que no haya que ir a otra pantalla y
// buscarla en una lista de doscientos nombres.
//
// ⚠️ La pantalla /instituto/sedes SIGUE existiendo y sigue siendo la buena
// para la otra pregunta —«¿quién entra al campus norte?»—, que se contesta
// mirando una sede y no una persona. Son las dos caras de la misma tabla y
// las dos escriben por el mismo sitio (campus.ts).
// ═══════════════════════════════════════════════════════════════════════

export async function setEduTeamMemberCampuses(
  ctx: EduTeamContext,
  memberId: string,
  rawCampusIds: unknown,
): Promise<{ id: string; campusIds: string[]; abrioTodas: boolean }> {
  const institutionId = requireInstitution(ctx);

  const persona = await prisma.eduUser.findFirst({
    where: { id: memberId, institutionId },
    select: {
      id: true,
      role: true,
      campusAccess: { select: { campusId: true } },
    },
  });
  if (!persona) throw new EduPadronError("Esa persona no es de este instituto.", 404);

  // 🔴 H-16 · a una cuenta de DIRECCION solo la toca otra de DIRECCION.
  // Decidir a qué sedes entra la dirección de la escuela es decidir qué
  // parte de su propia escuela ve, así que va por el mismo guardia que sus
  // datos y sus permisos.
  const guard = eduTeamGuardDireccion(ctx.role, persona.role as EduRole, "datos");
  if (guard) throw new EduPadronError(guard, 403);

  const antes = persona.campusAccess.map((a) => a.campusId);
  const campusIds = await eduParseCampusIds(ctx, rawCampusIds);
  const res = await setEduUserCampuses(ctx, persona.id, campusIds);

  await eduAudit(auditor(ctx), {
    action: "update",
    entity: "user",
    entityId: persona.id,
    before: { sedes: antes.length === 0 ? "todas" : antes.join(",") },
    after: { sedes: campusIds.length === 0 ? "todas" : campusIds.join(",") },
  });

  return { id: persona.id, campusIds: res.campusIds, abrioTodas: res.abrioTodas };
}
