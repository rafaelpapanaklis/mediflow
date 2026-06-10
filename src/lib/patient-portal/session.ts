// Sesiones del portal del paciente (tabla patient_account_sessions +
// cookie httpOnly `patient_session`). Implementa A1.
//
// Diseño: la cookie lleva el token plano; en DB solo se guarda sha256(token).
// Transacciones cortas (PgBouncer): nada de transacciones largas aquí.
import { prisma } from "@/lib/prisma";
import { PATIENT_SESSION_COOKIE, PATIENT_SESSION_DAYS } from "./types";
import { generateSessionToken, sha256 } from "./crypto";

export interface SessionCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  expires: Date;
}

/** Crea la fila de sesión y devuelve el token PLANO + expiración. */
export async function createPatientSession(
  accountId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + PATIENT_SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.patientAccountSession.create({
    data: { accountId, tokenHash: sha256(token), expiresAt },
  });
  return { token, expiresAt };
}

/** Opciones de la cookie `patient_session` (httpOnly, secure en prod, lax, path /). */
export function sessionCookieOptions(expiresAt: Date): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  };
}

/** Borra la fila de sesión correspondiente a un token plano (logout). No truena si no existe. */
export async function destroySessionByToken(token: string): Promise<void> {
  await prisma.patientAccountSession.deleteMany({
    where: { tokenHash: sha256(token) },
  });
}

/** Borra TODAS las sesiones de una cuenta (tras reset de contraseña). */
export async function destroyAllSessions(accountId: string): Promise<void> {
  await prisma.patientAccountSession.deleteMany({ where: { accountId } });
}

export { PATIENT_SESSION_COOKIE };
