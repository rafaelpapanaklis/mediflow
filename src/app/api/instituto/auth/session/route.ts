import { NextResponse } from "next/server";
import { getEduContext } from "@/lib/edu-auth";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { eduAudit, eduAuditRequestMeta } from "@/lib/edu/auditoria";
import {
  eduLoginMensaje,
  eduTempPasswordEstado,
  type EduLoginMotivo,
} from "@/lib/edu/puerta-core";

export const dynamic = "force-dynamic";

/**
 * ¿La sesión de Supabase que trae este navegador es de un instituto?
 *
 * Lo consulta el login del vertical justo después de autenticar, para poder
 * decir "esta cuenta no es de aquí" en vez de rebotar en silencio contra
 * /instituto (la cookie de Supabase es una sola para todo el dominio, así
 * que una credencial de clínica autentica perfectamente y no pertenece a
 * ningún instituto).
 *
 * 🔴 QUÉ SE DEVUELVE, Y POR QUÉ NO ES MÁS. `{ ok }` y, cuando NO, un
 * `motivo` del catálogo cerrado de puerta-core.ts con su mensaje ya
 * escrito. Ni el rol, ni el id, ni el permiso de nadie: lo único que este
 * endpoint puede revelar es lo que quien YA se autenticó sabe de sí mismo.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 H-158 · «DADA DE BAJA» NO ES LO MISMO QUE «NO ERES DE AQUÍ».
 *
 * `getEduContext` devuelve null igual para las dos cosas —su `where` lleva
 * `isActive: true`— y el login enseñaba un solo texto: «Esta cuenta no
 * pertenece a ningún instituto. Pide a la dirección de tu escuela que te dé
 * de alta». El docente que rotó llamaba a la escuela, que lo daba de alta
 * OTRA VEZ: cuenta nueva, y su historial clínico —notas firmadas, casos,
 * supervisiones— colgando del id viejo para siempre. Lo que hacía falta era
 * REACTIVAR, que es un clic.
 *
 * Así que cuando el contexto sale null se pregunta UNA cosa más: ¿existe
 * fila de esta cuenta en algún instituto, aunque esté inactiva? Es una
 * consulta por `supabaseId`, que es el id de la persona que acaba de
 * autenticarse: no se puede usar para preguntar por nadie más.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 H-153 · Y AQUÍ SE MIRA SI LA TEMPORAL CADUCÓ.
 *
 * Las temporales tienen forma pública (`Edu-XXXX-XXXY`) y no caducaban
 * nunca. Ahora caducan (EDU_TEMP_PASSWORD_DIAS), y el sitio donde eso se
 * DICE es la puerta: entrar y toparse con un panel que no abre, sin
 * explicación, es peor que no entrar. El candado de verdad está en el
 * canje —POST /api/instituto/auth/cambiar-contrasena rechaza una temporal
 * caducada— porque con `mustChangePassword` encendida el panel entero ya
 * está cerrado y canjearla es lo ÚNICO que esa temporal puede hacer.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 H-159 · Y AQUÍ SE ESCRIBE «ÚLTIMA ENTRADA». `EduUser.lastLogin` existía
 * en el schema desde la Ola 0, se LEÍA en cuatro sitios —la ficha del
 * docente, la lista de equipo— y no se escribía en ninguno.
 *
 * Se escribe AQUÍ y no en `getEduContext`, que es lo que parecería obvio:
 * ese helper corre en CADA render del panel (force-dynamic), así que
 * escribir ahí sería un UPDATE por pantalla pintada. Este endpoint lo llama
 * el login UNA vez, justo después de autenticar — que es exactamente lo que
 * la columna quiere decir.
 *
 * El try/catch NO es decoración: si la escritura falla, la persona entra
 * igual. Una columna de auditoría informativa no puede ser el motivo de que
 * alguien se quede en la puerta.
 */
export async function GET(request: Request) {
  const ctx = await getEduContext();

  if (!ctx) {
    const { motivo, institucion } = await porQueNoEntra();
    return NextResponse.json(
      { ok: false, motivo, error: eduLoginMensaje(motivo, institucion) },
      { status: 401 },
    );
  }

  // H-153 · la temporal con fecha. `updatedByAt` (Ola C base) es cuándo la
  // tocó una PERSONA: el alta y el restablecimiento la escriben, así que es
  // el momento en que se emitió esta temporal. Ver puerta-core.ts.
  const temporal = eduTempPasswordEstado(ctx.user, new Date());
  if (temporal.caducada) {
    const motivo: EduLoginMotivo = "temporal-caducada";
    return NextResponse.json(
      { ok: false, motivo, error: eduLoginMensaje(motivo) },
      { status: 401 },
    );
  }

  try {
    await prisma.eduUser.updateMany({
      where: { id: ctx.eduUserId, institutionId: ctx.institutionId },
      data: { lastLogin: new Date() },
    });
  } catch (err) {
    console.warn("[instituto/auth] no se pudo anotar la última entrada:", err);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 EL RENGLÓN DE ENTRADA. La bitácora registraba veinte módulos y no
  // registraba quién ENTRA, que es la primera pregunta de cualquiera que
  // investigue algo — y el panel se usa de pie en el piso clínico y en
  // equipo compartido, así que «¿quién estaba dentro esa tarde?» es una
  // pregunta real y no un trámite.
  //
  // Va AQUÍ y no en `getEduContext` por el mismo motivo que `lastLogin`:
  // ese helper corre en cada render del panel y dejaría un renglón por
  // pantalla pintada. Este endpoint lo llama el login UNA vez, justo
  // después de autenticar.
  //
  // Guarda la IP y el navegador (los pone `eduAudit`) y NADA de la
  // contraseña. `eduAudit` nunca lanza: una entrada que no se registra no
  // puede dejar a nadie fuera.
  // ═══════════════════════════════════════════════════════════════════
  await eduAudit(ctx, {
    action: "login",
    entity: "session",
    entityId: ctx.eduUserId,
    after: { entro: new Date(), conTemporal: temporal.aplica },
    ...eduAuditRequestMeta(request),
  });

  // `debeCambiar` viaja para que el login mande DIRECTO a la pantalla de
  // cambio en vez de rebotar contra el layout del panel. Es un booleano
  // sobre uno mismo: no dice nada que la persona no vaya a ver un segundo
  // después. Y `diasTemporal` para que sepa cuánto le queda.
  return NextResponse.json({
    ok: true,
    debeCambiar: temporal.aplica,
    diasTemporal: temporal.diasRestantes,
  });
}

/**
 * Por qué NO entra esta sesión. Solo se llama cuando el contexto salió
 * null, y solo mira la cuenta de quien acaba de autenticarse.
 */
async function porQueNoEntra(): Promise<{
  motivo: EduLoginMotivo;
  institucion: string | null;
}> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // Ni siquiera hay sesión de Supabase: no autenticó (o ya se le cayó).
    if (!user) return { motivo: "credenciales", institucion: null };

    // 🔴 SIN `isActive` en el where — ésa es toda la diferencia con
    // getEduContext, y es el hallazgo entero. Se pide lo mínimo: si está
    // activa y su nombre, nada más.
    const fila = await prisma.eduUser.findFirst({
      where: { supabaseId: user.id },
      orderBy: { createdAt: "asc" },
      select: { isActive: true, institution: { select: { name: true } } },
    });
    if (!fila) return { motivo: "ajena", institucion: null };
    // Existe y no está activa → dada de baja. (Si estuviera activa,
    // getEduContext la habría resuelto y no estaríamos aquí; el caso raro
    // de que se reactive entre las dos consultas se lee como "ajena" y la
    // persona solo tiene que volver a intentar.)
    if (!fila.isActive) {
      return { motivo: "baja", institucion: fila.institution?.name ?? null };
    }
    return { motivo: "ajena", institucion: null };
  } catch (err) {
    // La base no contestó. NO se inventa un motivo: el genérico de
    // "no eres de aquí" sería mentir, así que se usa el de credenciales,
    // que es el único que no afirma nada sobre la cuenta.
    console.warn("[instituto/auth] no se pudo saber por qué no entra:", err);
    return { motivo: "credenciales", institucion: null };
  }
}
