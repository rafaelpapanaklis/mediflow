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
import { eduSearchTokens } from "@/lib/edu/padron-core";
import { eduUserSearchIndex } from "@/lib/edu/search";
import {
  EDU_TEAM_BULK_CHUNK,
  EDU_TEAM_MAX_ROWS,
  EDU_TEMP_PASSWORD_BYTES,
  eduTeamFullName,
  eduTeamMemberInput,
  eduTempPasswordFromBytes,
  type EduTeamAltaResult,
  type EduTeamFilters,
  type EduTeamRow,
} from "@/lib/edu/equipo-core";
// P2-8: el saneador del catálogo, que existía desde la Ola 0 esperando a la
// pantalla de permisos. TODO lo que venga del cliente pasa por él antes de
// guardarse en permissionsOverride — una key inventada no se guarda.
import { sanitizeEduPermissionKeys } from "@/lib/edu/permissions";

/** El error con status HTTP del vertical, otra vez el MISMO: `eduApiError`
 *  lo mapea tal cual y un error propio saldría como 500 genérico. */
export { EduPadronError as EduEquipoError };

export type { EduTeamAltaResult, EduTeamRow } from "@/lib/edu/equipo-core";

/** Lo mínimo de la sesión que necesita este archivo. */
export interface EduTeamContext {
  institutionId: string;
  eduUserId: string;
  role: EduRole;
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
    const fila = await prisma.eduUser.create({
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
      },
      select: { id: true },
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
  for (const fila of filas) {
    const input = (fila ?? {}) as Record<string, unknown>;
    salida.push(await createEduTeamMember(ctx, input, institutionName));
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
): Promise<{ id: string; isActive: boolean }> {
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

  await prisma.eduUser.update({ where: { id: persona.id }, data: { isActive } });
  return { id: persona.id, isActive };
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
    select: { id: true },
  });
  if (!persona) throw new EduPadronError("Esa persona no es de este instituto.", 404);

  if (persona.id === ctx.eduUserId) {
    throw new EduPadronError(
      "No puedes editar tus propios permisos. Pídeselo a otra persona de dirección.",
    );
  }

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

  await prisma.eduUser.update({
    where: { id: persona.id },
    data: { permissionsOverride: override },
  });
  return { id: persona.id, permissionsOverride: override };
}
