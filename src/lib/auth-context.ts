import { createClient } from "@/lib/supabase/server";
import { authDebug } from "@/lib/auth/debug-log";
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { readActiveClinicCookie, logClinicFallback, resembrarActiveClinicCookie } from "@/lib/active-clinic";
import { resolverSesion } from "@/lib/auth/sesion-en-cache";
import { isPlanExpired, isApiPathBlockedForExpiredPlan } from "@/lib/plan-status";
import { esPeticionDeServerAction } from "@/lib/auth/peticion-server-action";
import { redirect } from "next/navigation";
import { decidirDosPasos } from "@/lib/auth/two-factor-decision";
import { bloqueaDosPasos } from "@/lib/auth/two-factor-gate";
import { TWO_FA_CHALLENGE_PATH, TWO_FA_SETUP_PATH } from "@/lib/auth/two-factor-constants";
import { estadoSuplantacionDe } from "@/lib/admin/suplantacion";
import { sedeCerradaPara } from "@/lib/sede-clave/gate.server";
import { RUTA_SEDE_CON_CLAVE } from "@/lib/sede-clave/core";
import { dondeCitasDelDoctor } from "@/lib/agenda/citas-del-doctor";

export interface AuthContext {
  userId:       string;
  clinicId:     string;
  role:         string;
  color:        string;
  clinic:       any;
  user:         any;
  // Override granular del default del role. Siempre presente como string[]
  // (vacío si no hay override). Endpoints lo usan con
  // denyIfMissingPermission(ctx, "billing.refund").
  permissionsOverride: string[];
  clinicCategory: string; // ClinicCategory enum value
  // Plan vencido (trial expirado y suscripción no activa). Ver isPlanExpired
  // en @/lib/plan-status. Expuesto para callers que quieran degradar la UI/UX.
  isPlanExpired: boolean;
  // Role helpers
  isSuperAdmin: boolean;  // Platform owner — global access
  isAdmin:      boolean;  // Clinic admin — full access to their clinic
  isDoctor:     boolean;  // Doctor — only their own data
  isReceptionist: boolean; // Receptionist — limited access
  canManageTeam: boolean;  // Can create/edit/delete doctors
  canViewAllData: boolean; // Can see all clinic data (not just own)
  // M5 (auditoría 30-sep): presente solo si esta sesión es «Ver como clínica»
  // de un admin de plataforma (admin_impersonation_sessions). El resto del
  // contexto es el del dueño, como siempre.
  suplantacion?: { adminUserId: string; adminEmail: string; expiresAt: Date } | null;
}

/**
 * Core auth function — call this in every API route.
 * Returns null if unauthenticated or inactive.
 * The clinicId is ALWAYS taken from the session, never from the request body.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const r = await resolverAuthContext();
  if (r && esBloqueoSede(r)) {
    // ws1-t4: la sede activa tiene clave y este navegador no la ha tecleado
    // (o el desbloqueo caducó o la clave cambió). En /api, null → 401. En una
    // server action o una PÁGINA se manda a la pantalla de la clave: si no, la
    // página que hace `if (!ctx) redirect("/login")` mandaría al login a quien
    // solo tiene que teclear la clave.
    if ((await esServerAction()) || !(await esRutaApi())) redirect(RUTA_SEDE_CON_CLAVE);
    return null;
  }
  if (r && esBloqueo(r)) {
    // ws1-t8 · M1: en una SERVER ACTION (cabecera next-action) el null se
    // traduciría en un «No autorizado» genérico; mandar al reto es lo que el
    // usuario necesita. La cabecera la puede poner cualquiera, pero solo elige
    // CÓMO se corta, nunca SI se corta. Fuera del try: redirect lanza.
    if (await esServerAction()) {
      redirect(r.bloqueoDosPasos === "challenge" ? TWO_FA_CHALLENGE_PATH : TWO_FA_SETUP_PATH);
    }
    return null;
  }
  return r as AuthContext | null;
}

/**
 * ⚠ SIN el gate de la clave de la sede NI el de plan vencido (ws1-t4). Solo
 * para /api/sede-clave/*: la pantalla «Esta sede tiene clave» tiene que poder
 * desbloquear una sede cerrada (si no, nadie entraría nunca), y una sede con
 * clave y el plan vencido tiene que poder desbloquearse para llegar a la
 * pantalla de pago. El 2FA SÍ se exige: la clave de la sede va después del
 * segundo factor, nunca en su lugar. También /api/auth/change-password (ws1-t1,
 * 29-oct): la contraseña temporal es una barrera ANTERIOR a la clave y su
 * cambio tiene que funcionar con la sede cerrada; la ruta vuelve a pedir la
 * sede abierta para un cambio voluntario. La lista de quién la usa la fija
 * src/lib/sede-clave/__tests__/sede-clave.test.ts.
 */
export async function getAuthContextParaClaveDeSede(): Promise<AuthContext | null> {
  const r = await resolverAuthContext({ paraClaveDeSede: true });
  if (!r || esBloqueo(r) || esBloqueoSede(r)) return null;
  return r;
}

type BloqueoDosPasos = { bloqueoDosPasos: "challenge" | "setup" };
type BloqueoSedeClave = { bloqueoSedeClave: true };
type Resolucion = AuthContext | BloqueoDosPasos | BloqueoSedeClave;

function esBloqueo(r: Resolucion): r is BloqueoDosPasos {
  return "bloqueoDosPasos" in r;
}

function esBloqueoSede(r: Resolucion): r is BloqueoSedeClave {
  return "bloqueoSedeClave" in r;
}

async function esServerAction(): Promise<boolean> {
  try { return !!(await headers()).get("next-action"); } catch { return false; }
}

/** ¿Es una ruta /api? Sin cabeceras (fuera de una petición) se trata como /api: no se redirige. */
async function esRutaApi(): Promise<boolean> {
  try { return ((await headers()).get("x-pathname") ?? "").startsWith("/api"); } catch { return true; }
}

async function resolverAuthContext(opciones: { paraClaveDeSede?: boolean } = {}): Promise<Resolucion | null> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // M5: «Ver como clínica» vencida (2 h) o cerrada = sin sesión.
    const suplantacion = await estadoSuplantacionDe(supabase);
    if (suplantacion.tipo === "terminada") return null;

    const activeClinicId = await readActiveClinicCookie();

    // UNA lectura: todas las filas ACTIVAS de la persona (una por sede, casi
    // siempre una sola), de la más antigua a la más nueva. De ahí salen las
    // tres cosas que antes eran hasta tres consultas en serie:
    //   · la fila de la clínica activa (la de la cookie), si existe;
    //   · si no, la primera por createdAt — el fallback de siempre;
    //   · y si ALGUNA tiene 2FA (EQ-02), que es exactamente lo que preguntaba
    //     personaTieneDosFactores: { supabaseId, isActive: true, totpEnabled: true }.
    // Cada `/api` pagaba un viaje de ida y vuelta a la base de más por esto
    // (medido el 23-sep-2026: ~190 ms por viaje desde el servidor de QA). La
    // clínica que se elige es la MISMA que antes: el filtro por clinicId que
    // hacía el WHERE ahora lo hace el `find`, contra filas que ya son todas de
    // este supabaseId.
    // En las lecturas de /api esa resolución va en caché 10 s, con llave
    // persona + clínica de la cookie: ver @/lib/auth/sesion-en-cache. Los gates
    // de abajo (2FA, plan) NO se cachean: corren en cada petición.
    const { deLaCookie: dbUser, elegida, dosFactoresEnAlguna } = await resolverSesion(user.id, activeClinicId);

    if (dbUser) {
      authDebug("log", "[AUTH-DEBUG getAuthContext] cookie OK", JSON.stringify({ picked: dbUser.clinicId }));
    }

    const finalUser = elegida;

    if (!finalUser || !finalUser.isActive) return null;

    if (!dbUser) {
      // Cookie inservible: se reescribe con la elegida (ws1-t12), así la
      // próxima petición ya no cae aquí. Ver resembrarActiveClinicCookie.
      const resembrada = await resembrarActiveClinicCookie(finalUser.clinicId);
      if (activeClinicId) {
        authDebug("warn", "[AUTH-DEBUG getAuthContext] cookie inválida, reseteada", JSON.stringify({
          reason: "supabaseId no es activo en clinicId solicitada",
          requested: activeClinicId,
          picked: finalUser.clinicId,
        }));
        logClinicFallback({ supabaseId: user.id, requestedClinicId: activeClinicId, actualClinicId: finalUser.clinicId, resembrada });
      } else {
        authDebug("warn", "[AUTH-DEBUG getAuthContext] cookie inválida, reseteada", JSON.stringify({
          reason: "cookie ausente o HMAC inválido",
          picked: finalUser.clinicId,
        }));
      }
    }

    const isSuperAdmin   = finalUser.role === "SUPER_ADMIN";
    const isAdmin        = finalUser.role === "ADMIN" || isSuperAdmin;
    const isDoctor       = finalUser.role === "DOCTOR";
    const isReceptionist = finalUser.role === "RECEPTIONIST";

    // Normalizamos permissionsOverride a [] si Prisma client viejo (deploy
    // cacheado) no devuelve el campo. Sin esto, ctx.user.permissionsOverride
    // sería undefined y denyIfMissingPermission caería al default del rol
    // ignorando el override real en DB.
    const permissionsOverride: string[] =
      ((finalUser as any).permissionsOverride as string[] | null | undefined) ?? [];

    // Gate central de 2FA (EQ-01 → ws1-t8 · M1). El segundo factor protegía las
    // PANTALLAS y no los datos; EQ-01 lo extendió a /api, pero solo ahí: se
    // decidía por el x-pathname, que para una SERVER ACTION (POST a
    // /dashboard/...) o una página no es /api, así que las ~176 actions de
    // src/app/actions y las páginas que leen datos con esta función pasaban
    // con solo la contraseña (borrando la cookie df_2fa_pending, que es del
    // cliente). Ahora se aplica SIEMPRE que haya sesión de clínica, sin mirar
    // la ruta: las únicas salidas son las del propio flujo del 2FA, y van por
    // código (getTwoFactorActor, getCurrentUserSinDosPasos), no por una lista
    // de rutas que una cabecera pueda imitar.
    //
    // Va ANTES del gate de plan, igual que en el layout de /dashboard: el 2FA es
    // AUTENTICACIÓN y el plan es una cuestión comercial posterior. Fail-closed:
    // las rutas que hacen `if (!ctx) return 401` quedan cerradas sin tocarlas.
    // El 403 con código que el panel sabe leer lo emite el fast-path del
    // middleware; ver @/lib/auth/two-factor-gate.
    //
    // EQ-02: `totpEnabled` es una columna de la FILA, y una persona tiene una
    // fila por clínica: se pregunta a todas las suyas, también las de sedes
    // ARCHIVADAS (revisión ws1-t9, M1: el 2FA no se apaga porque se archive
    // la sede donde se enroló; el gate falla cerrado).
    const enrolado =
      !!(finalUser as { totpEnabled?: boolean | null }).totpEnabled || dosFactoresEnAlguna;

    const { decision } = await decidirDosPasos({
      supabaseId: finalUser.supabaseId,
      clinicId:   finalUser.clinicId,
      role:       finalUser.role,
      totpEnabled: enrolado,
      clinic:     finalUser.clinic as { require2fa?: boolean | null } | null,
    });
    if (bloqueaDosPasos(decision)) return { bloqueoDosPasos: decision };

    // Gate de la CLAVE DE LA SEDE (ws1-t4). Después del 2FA (que decide QUIÉN
    // es) y antes del plan. Con la clave activa, nadie —tampoco el SUPER_ADMIN—
    // usa la sede sin haberla tecleado en este navegador en las últimas 72 h;
    // «Ver como clínica» de /admin pasa. Sin sql/sede-clave.sql pegado no
    // consulta nada y devuelve false. Ver @/lib/sede-clave/gate.server.
    if (
      !opciones.paraClaveDeSede &&
      (await sedeCerradaPara({ supabaseId: finalUser.supabaseId, clinicId: finalUser.clinicId }))
    ) {
      return { bloqueoSedeClave: true };
    }

    // Gate central de plan vencido a nivel API. Si la clínica está vencida
    // (trial expirado + suscripción no activa) y la request va a una ruta
    // /api NO exenta (allowlist de pago/auth en @/lib/plan-status), cortamos
    // devolviendo null → la ruta responde 401, igual que con sesión inválida.
    // El pathname lo inyecta el middleware en x-pathname para TODA ruta /api;
    // si falta (páginas server, callers no-API) NO bloqueamos — el layout de
    // /dashboard ya redirige esas navegaciones a /dashboard/suspended. El
    // gate aplica a TODOS los roles (un SUPER_ADMIN destraba desde /admin,
    // ruta con su propia auth, no cubierta por este check).
    // ws1-t11 · lead 11: también corta las SERVER ACTIONS que no salen de la
    // pantalla de pago o de soporte (una action es un POST a /dashboard/... y
    // el redirect del layout no impide que corra). Ver isApiPathBlockedForExpiredPlan.
    const planExpired = isPlanExpired(finalUser.clinic);
    if (planExpired && !opciones.paraClaveDeSede) {
      const peticion = await (async () => {
        try {
          const h = await headers();
          return { pathname: h.get("x-pathname"), esAction: esPeticionDeServerAction(h) };
        } catch { return { pathname: null, esAction: false as const }; }
      })();
      if (isApiPathBlockedForExpiredPlan(peticion.pathname, peticion.esAction)) return null;
    }

    return {
      userId:         finalUser.id,
      clinicId:       finalUser.clinicId,
      role:           finalUser.role,
      color:          finalUser.color ?? "#3b82f6",
      clinic:         finalUser.clinic,
      // EQ-02: `totpEnabled` sale corregido a nivel PERSONA, no de la fila de
      // esta sede. Quien lo lea aguas abajo ve si el segundo factor está puesto
      // en la cuenta, que es lo que significa de verdad.
      user:           { ...finalUser, permissionsOverride, totpEnabled: enrolado },
      permissionsOverride,
      clinicCategory: (finalUser.clinic as any).category ?? "OTHER",
      isPlanExpired:  planExpired,
      isSuperAdmin,
      isAdmin,
      isDoctor,
      isReceptionist,
      canManageTeam:   isAdmin,
      canViewAllData:  isAdmin,
      suplantacion: suplantacion.tipo === "activa"
        ? {
            adminUserId: suplantacion.fila.adminUserId,
            adminEmail: suplantacion.fila.adminEmail,
            expiresAt: new Date(suplantacion.fila.expiresAt),
          }
        : null,
    };
  } catch {
    return null;
  }
}

/**
 * Resuelve el filtro de clínica de una query de PACIENTES.
 *
 * MULTI-CLÍNICA · FASE 2: `visibleClinicIds` llega SÓLO desde
 * getVisiblePatientClinicIds(ctx.clinicId) (@/lib/branches), que a su vez sale
 * de la sesión — nunca de un parámetro del cliente. Si no llega, o si trae una
 * sola sede, la query queda EXACTAMENTE como estaba (id pelado).
 *
 * Defensa en profundidad: aunque un caller pasara una lista manipulada, se
 * exige que la sede activa esté dentro; si no, se ignora la lista entera.
 */
function clinicFilterFor(ctx: AuthContext, visibleClinicIds?: string[]): string | { in: string[] } {
  if (!visibleClinicIds || visibleClinicIds.length <= 1) return ctx.clinicId;
  if (visibleClinicIds.indexOf(ctx.clinicId) === -1) return ctx.clinicId;
  return { in: visibleClinicIds };
}

/**
 * Build patient WHERE clause based on role.
 * Admins see all clinic patients. Doctors only see their own.
 *
 * Visibilidad por paciente (patients.visibleUserIds, ver @/lib/patient-visibility):
 *   - lista VACÍA  → comportamiento histórico intacto: lo ve todo el equipo, y
 *                    a los doctores se les siguen aplicando las heurísticas de
 *                    abajo (primaryDoctor / cita / record).
 *   - lista LLENA  → SUSTITUYE las heurísticas: lo ven SOLO los userIds de la
 *                    lista (+ cualquier admin, que no pasa por este filtro).
 *
 * Todo va dentro de `AND` a propósito: antes las heurísticas vivían en un `OR`
 * de primer nivel y `...extra` podía pisarlo (el handler legacy mandaba su
 * búsqueda como `extra.OR` y borraba el scope del doctor = fuga). Con `AND`
 * coexisten con cualquier `extra`.
 *
 * `visibleClinicIds` (opcional, multi-clínica Fase 2) amplía el scope de CLÍNICAS
 * a las sedes vinculadas (vía clinicFilterFor). OPT-IN por superficie: quien no lo
 * pasa sigue viendo sólo su sede. Compone con la visibilidad por-paciente: las
 * sedes deciden QUÉ clínicas entran; visibleUserIds, QUÉ pacientes dentro de ellas.
 */
export function buildPatientWhere(
  ctx: AuthContext,
  extra: Record<string, any> = {},
  visibleClinicIds?: string[],
) {
  const { AND: extraAnd, ...restExtra } = extra;
  const extraAndList: any[] = extraAnd
    ? Array.isArray(extraAnd) ? extraAnd : [extraAnd]
    : [];

  const scope: any[] = [];
  if (!ctx.isAdmin) {
    const legacyDoctorScope = ctx.isDoctor
      ? {
          OR: [
            { primaryDoctorId: ctx.userId },
            { appointments: { some: { doctorId: ctx.userId } } },
            // ws1-t11 (D3): y el paciente con una cita «Sin doctor» de ESTA clínica que este doctor puede
            // tomar: en la clínica ahora, o por venir. Una vieja que nadie cerró, o una ya atendida, no abre nada.
            {
              appointments: {
                some: {
                  clinicId: ctx.clinicId,
                  doctorId: null,
                  OR: [
                    { status: { in: ["CHECKED_IN", "IN_CHAIR"] } },
                    { status: { in: ["SCHEDULED", "CONFIRMED"] }, endsAt: { gte: new Date() } },
                  ],
                },
              },
            },
            { records: { some: { doctorId: ctx.userId } } },
          ],
        }
      : null;

    scope.push({
      OR: [
        // Sin lista → como siempre (heurísticas de doctor si aplica).
        legacyDoctorScope
          ? { AND: [{ visibleUserIds: { isEmpty: true } }, legacyDoctorScope] }
          : { visibleUserIds: { isEmpty: true } },
        // Con lista que me incluye → manda la lista, ignora heurísticas.
        { visibleUserIds: { has: ctx.userId } },
      ],
    });
  }

  const AND = [...scope, ...extraAndList];
  return {
    clinicId: clinicFilterFor(ctx, visibleClinicIds), // ALWAYS — cross-clinic guard + multi-clínica opt-in
    // ARCO (P2): un paciente cancelado (deletedAt ≠ null, PII anonimizado) no
    // debe aparecer en listas, ficha ni pickers — ninguna lectura núcleo lo
    // filtraba. Va ANTES de restExtra para que un caller pueda sobreescribirlo
    // a propósito (hoy ninguno lo hace). OJO: el folio de paciente
    // (next-patient-number.ts) NO usa este where y debe seguir contando TODAS
    // las filas — no "arreglar" aquello con este filtro.
    deletedAt: null,
    ...(AND.length ? { AND } : {}),
    ...restExtra,
  };
}

/**
 * Build appointment WHERE clause based on role.
 */
export function buildAppointmentWhere(ctx: AuthContext, extra: Record<string, any> = {}) {
  if (!ctx.isDoctor) return { clinicId: ctx.clinicId, ...extra };
  // ws1-t11 (D3) — un DOCTOR: las suyas y las «Sin doctor» de pacientes que puede ver
  // (`dondeCitasDelDoctor`, la misma regla que la agenda). En `AND`, junto al `AND` del que llama.
  const { AND: extraAnd, ...resto } = extra;
  const lista: any[] = extraAnd ? (Array.isArray(extraAnd) ? extraAnd : [extraAnd]) : [];
  return {
    clinicId: ctx.clinicId,
    ...resto,
    AND: [dondeCitasDelDoctor({ userId: ctx.userId, clinicId: ctx.clinicId }), ...lista],
  };
}

/**
 * Build medical record WHERE clause based on role.
 */
export function buildRecordWhere(ctx: AuthContext, extra: Record<string, any> = {}) {
  return {
    clinicId: ctx.clinicId,
    ...(ctx.isDoctor && { doctorId: ctx.userId }),
    ...extra,
  };
}

/**
 * Require a minimum role. Returns 403 response if not authorized.
 * Use in API routes that need specific permissions.
 */
export function requireRole(ctx: AuthContext | null, ...roles: string[]): NextResponse | null {
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!roles.includes(ctx.role) && !ctx.isSuperAdmin) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  return null;
}

/**
 * Require admin role. Returns 403 if not admin.
 */
export function requireAdmin(ctx: AuthContext | null): NextResponse | null {
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  return null;
}

/**
 * Verify that a resource belongs to the user's clinic.
 * Critical for preventing cross-clinic access.
 */
export function assertSameClinic(ctx: AuthContext, resourceClinicId: string): boolean {
  return ctx.clinicId === resourceClinicId || ctx.isSuperAdmin;
}
