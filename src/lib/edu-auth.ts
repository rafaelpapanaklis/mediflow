import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { EduInstitution, EduUser } from "@prisma/client";
import type { EduRole } from "@/lib/edu/types";
import {
  assertEduPermission,
  EduForbiddenError,
  hasEduPermission,
  type EduPermissionKey,
} from "@/lib/edu/permissions";

export { assertEduPermission, EduForbiddenError, hasEduPermission };
export type { EduPermissionKey };

/**
 * Contexto de sesión de un usuario de INSTITUTO (DaleControl
 * Institucional) — espejo 1:1 de getBarberContext (src/lib/barber-auth.ts).
 *
 * 🔴 institutionId sale SIEMPRE de aquí, JAMÁS del body o del query. TODA
 * consulta de negocio del vertical filtra por este institutionId.
 *
 * 🔴 OJO PRISMA: un institutionId `undefined` BORRA el filtro de tenant.
 * `where: { institutionId: undefined }` no devuelve cero filas: devuelve
 * las de TODOS los institutos, y de ahí a que una escuela vea el padrón de
 * otra hay un paso. Nunca dejes que un undefined llegue a un where — si
 * dudas, saca el id de este contexto y no de un parámetro opcional.
 *
 * Devuelve null sin redirigir (los guards los hacen las páginas/layouts).
 * No mira el contrato del instituto: eso AVISA, no corta (ver
 * src/lib/edu/contract.ts).
 */
export interface EduContext {
  eduUserId: string;
  institutionId: string;
  institution: EduInstitution;
  user: EduUser;
  role: EduRole;
}

export async function getEduContext(): Promise<EduContext | null> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const eu = await prisma.eduUser.findFirst({
      where: { supabaseId: user.id, isActive: true },
      include: { institution: true },
      orderBy: { createdAt: "asc" },
    });
    if (!eu) return null;

    return {
      eduUserId: eu.id,
      institutionId: eu.institutionId,
      institution: eu.institution,
      user: eu,
      role: eu.role as EduRole,
    };
  } catch (err) {
    // Tabla edu_users aún sin migrar (sql/edu-ola-0.sql sin aplicar) o BD
    // caída → esta sesión "no es de instituto". JAMÁS propagar: este helper
    // corre en el router de entrada y en el layout del panel, y un throw
    // aquí sin límite de error deja pantalla blanca con la consola muda.
    // El warning es lo único que distingue "no aplicaste el .sql" de
    // "este usuario no es del instituto", que se ven igual desde fuera.
    console.warn(
      "[edu-auth] no se pudo resolver la sesión de instituto (¿falta aplicar sql/edu-ola-0.sql?):",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Nombre para pintar en el panel. Vive aquí y no en cada pantalla para que
 * nadie vuelva a concatenar `firstName + " " + lastName` con un espacio de
 * más cuando falte el apellido.
 */
export function eduUserDisplayName(user: Pick<EduUser, "firstName" | "lastName" | "email">): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return full || user.email;
}
