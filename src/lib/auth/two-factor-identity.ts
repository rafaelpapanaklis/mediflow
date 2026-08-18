/* ============================================================
   EL SEGUNDO FACTOR DE LA PERSONA — LADO BASE DE DATOS.

   La REGLA (y el porqué del hallazgo EQ-02) vive entera en
   two-factor-identity-core.ts, que es puro y se prueba sin Postgres.
   Aquí solo están las consultas y la escritura.

   ── POR QUÉ SE LEE Y NO SOLO SE ESCRIBE ───────────────────────
   Propagar las escrituras arregla a quien enrole a partir de ahora.
   Quien YA está enrolado en una sola de sus sedes sigue con el agujero
   hasta que corra el backfill (sql/eq02-2fa-por-persona.sql). Leer por
   persona lo cierra sin depender de que ese SQL se aplique: es
   fail-closed, que es como tiene que fallar un gate de autenticación.

   Y leer el SECRETO por persona es lo que evita el otro desastre: si el
   reto se exigiera en una sede cuya fila no tiene totpSecret, el dueño
   se quedaría encerrado fuera de su propia clínica sin poder contestar
   un código que nadie puede validar.
   ============================================================ */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { resolverDosFactores, type DosFactoresDeLaPersona } from "./two-factor-identity-core";

export {
  resolverDosFactores,
  type DosFactoresDeLaPersona,
  type FilaDeDosFactores,
} from "./two-factor-identity-core";

/**
 * El estado de 2FA de la persona entera.
 *
 * Una consulta, cacheada por petición (`cache` de React): el gate del layout,
 * el de /api y la pantalla del reto pueden preguntarlo sin multiplicarla.
 *
 * `isActive: true` a propósito: una membresía desactivada no debería poder
 * obligar a nada ni prestar su secret.
 */
export const dosFactoresDeLaPersona = cache(
  async (supabaseId: string): Promise<DosFactoresDeLaPersona> => {
    if (!supabaseId) return resolverDosFactores([]);
    const filas = await prisma.user.findMany({
      where: { supabaseId, isActive: true },
      select: {
        totpEnabled: true,
        totpSecret: true,
        recoveryCodes: true,
        clinic: { select: { require2fa: true } },
      },
    });
    return resolverDosFactores(filas);
  },
);

/**
 * ¿Alguna sede de esta persona tiene el segundo factor puesto?
 *
 * La versión barata para el camino caliente: una búsqueda por el índice
 * `@@index([supabaseId])` que devuelve como mucho una fila. Se usa donde ya se
 * tiene la fila activa en la mano y solo falta saber si alguna HERMANA obliga
 * — y quien llama corta antes con `||` si la propia fila ya obliga, así que
 * para la inmensa mayoría (una sola sede, sin 2FA) esto es una búsqueda de
 * índice que no encuentra nada. Al lado del `supabase.auth.getUser()` que ya
 * paga cada petición, es ruido.
 */
export const personaTieneDosFactores = cache(async (supabaseId: string): Promise<boolean> => {
  if (!supabaseId) return false;
  const alguna = await prisma.user.findFirst({
    where: { supabaseId, isActive: true, totpEnabled: true },
    select: { id: true },
  });
  return alguna !== null;
});

/**
 * Escribe el 2FA en TODAS las filas de la persona.
 *
 * Sin filtro de clínica, igual que `setMustChangePassword`: la identidad es
 * global, así que su segundo factor también. El aislamiento multi-tenant no se
 * pierde porque el supabaseId sale SIEMPRE de la sesión de quien llama — nunca
 * de la petición—, así que una persona solo puede tocar sus propias filas.
 *
 * Devuelve cuántas filas cambió.
 */
export async function propagarDosFactores(
  supabaseId: string,
  data: {
    totpEnabled?: boolean;
    totpSecret?: string | null;
    recoveryCodes?: string[];
  },
): Promise<number> {
  if (!supabaseId) return 0;
  const { count } = await prisma.user.updateMany({ where: { supabaseId }, data });
  return count;
}
