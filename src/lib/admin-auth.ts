import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

/**
 * WS2-T3 · Auth de admin con sesiones REALES en BD.
 *
 * Antes: una sola cookie global cuyo valor == env ADMIN_SECRET_TOKEN. Sin
 * identidad, sin revocación, sin atribución. Ahora:
 *  - La cookie `admin_token` lleva un token ALEATORIO por sesión (32 bytes).
 *  - En BD (AdminSession) vive solo su sha256, con ip/UA, expiración (8h) y
 *    revokedAt. Validar = buscar la sesión VIVA + cargar el AdminUser activo.
 *  - El login valida contra AdminUser (bcrypt) + TOTP por usuario.
 *
 * Runtime: TODO esto corre en Node (route handlers + el layout server de
 * /admin), nunca en el Edge middleware — Prisma no corre en Edge. El middleware
 * sólo hace un "presence gate" de la cookie; la validación real (revocación
 * incluida) la hacen el layout y cada ruta vía isAdminAuthed()/getAdminSession().
 */

export const ADMIN_COOKIE = "admin_token";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas
const BCRYPT_ROUNDS = 10;

export interface AdminUserLite {
  id: string;
  email: string;
  role: string;
  totpSecret: string | null;
  totpEnabled: boolean;
}

export interface AdminAuthContext {
  user: AdminUserLite;
  sessionId: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Opciones de la cookie de sesión admin (httpOnly, secure en prod, 8h). */
export function adminCookieOptions(maxAgeMs: number = SESSION_TTL_MS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    maxAge: Math.floor(maxAgeMs / 1000),
    path: "/",
  };
}

// ── Validación de sesión (Node; DB-backed) ────────────────────────────────

/**
 * Lee la cookie, busca la AdminSession VIVA (no revocada, no expirada) por
 * sha256(token) y carga el AdminUser activo. Devuelve el contexto admin o null.
 * Fail-closed: cualquier error → null (no autenticado).
 */
export async function getAdminSession(): Promise<AdminAuthContext | null> {
  try {
    const token = cookies().get(ADMIN_COOKIE)?.value;
    if (!token) return null;

    const session = await prisma.adminSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: { adminUser: true },
    });

    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;

    const u = session.adminUser;
    if (!u || !u.isActive) return null;

    return {
      user: {
        id: u.id,
        email: u.email,
        role: u.role,
        totpSecret: u.totpSecret,
        totpEnabled: u.totpEnabled,
      },
      sessionId: session.id,
    };
  } catch (e) {
    console.error("[admin-auth] getAdminSession error:", e);
    return null;
  }
}

/**
 * Guard booleano DB-backed para route handlers. ASÍNCRONO (antes era síncrono):
 * todos los callers deben usar `await isAdminAuthed()`. Olvidar el await deja
 * pasar una Promise (truthy) — el build + el grep de verificación lo cazan.
 */
export async function isAdminAuthed(): Promise<boolean> {
  return (await getAdminSession()) !== null;
}

// ── Ciclo de vida de la sesión ─────────────────────────────────────────────

/** Crea una sesión: token aleatorio (devuelto en claro) + sha256 en BD. */
export async function createAdminSession(
  adminUserId: string,
  meta: { ipAddress?: string; userAgent?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex"); // 64 chars hex
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.adminSession.create({
    data: {
      adminUserId,
      tokenHash: sha256(token),
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

/** Revoca la sesión cuyo token está en la cookie (logout). No-op si no hay. */
export async function revokeAdminSessionByToken(token: string | undefined | null): Promise<void> {
  if (!token) return;
  try {
    await prisma.adminSession.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch (e) {
    console.error("[admin-auth] revokeAdminSessionByToken error:", e);
  }
}

/**
 * Revoca una sesión por id. Acotado al adminUserId dueño para que un id forjado
 * no revoque sesiones de otro admin.
 */
export async function revokeAdminSession(sessionId: string, adminUserId: string): Promise<void> {
  await prisma.adminSession.updateMany({
    where: { id: sessionId, adminUserId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revoca TODAS las sesiones del admin (opcionalmente excepto la actual). */
export async function revokeAllAdminSessions(adminUserId: string, exceptSessionId?: string): Promise<void> {
  await prisma.adminSession.updateMany({
    where: {
      adminUserId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
}

export interface AdminSessionRow {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
  current: boolean;
}

/** Lista las sesiones VIVAS del admin para la vista "Sesiones". */
export async function listAdminSessions(adminUserId: string, currentSessionId: string): Promise<AdminSessionRow[]> {
  const rows = await prisma.adminSession.findMany({
    where: { adminUserId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, ipAddress: true, userAgent: true, createdAt: true, expiresAt: true },
  });
  return rows.map((r) => ({ ...r, current: r.id === currentSessionId }));
}

// ── Semilla del primer admin (idempotente) ─────────────────────────────────

/**
 * Si no existe ningún AdminUser, crea el primero desde las envs actuales para
 * NO perder acceso al migrar: email = ADMIN_EMAIL (o admin@dalecontrol.com),
 * passwordHash = bcrypt(ADMIN_PASSWORD), totpSecret = ADMIN_TOTP_SECRET. Se
 * llama al inicio del login. Devuelve `true` si al terminar existe al menos un
 * AdminUser (sembrado o preexistente); `false` si no hay ninguno y no se pudo
 * sembrar (falta ADMIN_PASSWORD) — el login usa eso para un error claro.
 */
export async function ensureSeedAdmin(): Promise<boolean> {
  try {
    const count = await prisma.adminUser.count();
    if (count > 0) return true;

    const password = process.env.ADMIN_PASSWORD;
    if (!password) return false;

    const email = process.env.ADMIN_EMAIL || "admin@dalecontrol.com";
    const totpSecret = process.env.ADMIN_TOTP_SECRET || null;

    await prisma.adminUser.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        totpSecret,
        totpEnabled: !!totpSecret,
        role: "SUPER_ADMIN",
        isActive: true,
      },
    });
    console.warn(`[admin-auth] Primer AdminUser sembrado desde envs: ${email}`);
    return true;
  } catch (e) {
    console.error("[admin-auth] ensureSeedAdmin error:", e);
    return false;
  }
}

/**
 * Identifica al admin por contraseña (la UI de login no pide email; hay pocos
 * admins). Recorre los admins activos y compara bcrypt. Devuelve el primero que
 * coincide o null.
 */
export async function findAdminByPassword(password: string): Promise<AdminUserLite | null> {
  if (!password) return null;
  const admins = await prisma.adminUser.findMany({
    where: { isActive: true },
    select: { id: true, email: true, role: true, passwordHash: true, totpSecret: true, totpEnabled: true },
  });
  for (const a of admins) {
    if (await bcrypt.compare(password, a.passwordHash)) {
      return { id: a.id, email: a.email, role: a.role, totpSecret: a.totpSecret, totpEnabled: a.totpEnabled };
    }
  }
  return null;
}

// ── Helper Edge (dead-code de compat): solo presencia, sin BD ───────────────
// No lo importa nadie hoy; el matcher real vive en src/middleware.ts. Se deja
// como "presence gate" coherente con el nuevo modelo (Edge no puede tocar BD).
export function adminMiddleware(request: NextRequest) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  if (!token) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
