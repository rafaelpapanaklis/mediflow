import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { logAudit, extractAuditMeta } from "@/lib/audit";
import { markMustChangePassword } from "@/lib/auth/must-change-password";
import { clasificarErrorAuth, esCorreoMarcador, esUuid, ERROR_SIN_CUENTA } from "@/lib/team/auth-errors";

// Service-role client. Mismo patrón que /api/team/[id]/route.ts:8-13 —
// usa SUPABASE_SERVICE_ROLE_KEY (NUNCA exponer al cliente). Disable de
// session/refresh porque el client es solo para llamar admin endpoints.
function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// Genera un password temporal alfanumérico de 12 chars (mayúsculas,
// minúsculas, dígitos). ~71 bits de entropía. Lo bastante fuerte para un
// uso único hasta que el user lo cambie por uno propio.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
function generateTempPassword(len = 12): string {
  // crypto global está disponible en runtime Node 20+ y Edge — getRandomValues
  // es criptográficamente seguro, no Math.random().
  const bytes = new Uint32Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// POST /api/team/[id]/reset-password
//
// Sólo SUPER_ADMIN. Reemplaza el password del target via Supabase Admin API.
// Devuelve el password temporal una sola vez — el SUPER_ADMIN lo entrega al
// usuario por canal seguro (Slack/WhatsApp/etc). Si lo pierde, hay que
// volver a resetear.
//
// Multi-tenant: aunque SUPER_ADMIN tiene acceso global a su clínica, exigimos
// que el target pertenezca a la misma clinicId — defensa adicional contra
// scenarios de un super-admin tocando users de otra clínica.
//
// Lock-out defense: rechaza target.role === "SUPER_ADMIN" para que un super
// no pueda forzar cambio de password de otro super.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: "Solo SUPER_ADMIN puede resetear contraseñas" }, { status: 403 });
  }

  // Multi-tenant: target user en la misma clinic del actor.
  const target = await prisma.user.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, supabaseId: true, role: true, firstName: true, lastName: true, email: true, isActive: true },
  });
  if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  if (target.role === "SUPER_ADMIN") {
    return NextResponse.json({ error: "No se puede resetear contraseña de otro SUPER_ADMIN" }, { status: 400 });
  }

  if (!target.isActive) {
    return NextResponse.json({ error: "El usuario está desactivado — reactívalo antes de resetear contraseña" }, { status: 400 });
  }

  const tempPassword = generateTempPassword(12);

  const supabaseAdmin = getAdminClient();
  let supabaseIdFinal = target.supabaseId;
  let cuentaCreada = false;

  // Un supabaseId que no es UUID (demo, muestra de QA) haría LANZAR a supabase-js.
  const updateError: any = !esUuid(target.supabaseId)
    ? ERROR_SIN_CUENTA
    : (await supabaseAdmin.auth.admin.updateUserById(target.supabaseId, { password: tempPassword })).error;

  if (updateError) {
    if (clasificarErrorAuth(updateError) !== "cuenta-no-existe") {
      console.error("[/api/team/[id]/reset-password] supabase update failed:", updateError);
      return NextResponse.json({ error: "No se pudo actualizar la contraseña en Supabase" }, { status: 500 });
    }

    // El miembro NO tiene cuenta de acceso: su fila apunta a un usuario de Auth
    // que ya no existe (BEVADENT, 28-sep-2026: el reinicio de la clínica la borró
    // y dejó la fila con un correo de relleno). Restablecer una contraseña que no
    // existe no tiene sentido; lo que el admin quiere es que esa persona pueda
    // entrar. Se le CREA la cuenta con el correo de su ficha y la temporal, y la
    // fila (y sus hermanas del mismo id muerto) pasa a apuntar a ella.
    if (esCorreoMarcador(target.email) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target.email)) {
      return NextResponse.json({
        error: "Este miembro no tiene cuenta de acceso y su correo no es uno real. Edítalo, escribe su correo verdadero, guarda, y vuelve a pulsar «Restablecer contraseña» para crearle el acceso.",
        code: "SIN_CUENTA_SIN_CORREO",
      }, { status: 400 });
    }

    const { data: creada, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: target.email.trim().toLowerCase(),
      password: tempPassword,
      email_confirm: true,
    });
    if (createError || !creada?.user) {
      if (createError && clasificarErrorAuth(createError) === "correo-ya-registrado") {
        return NextResponse.json({
          error: "Ese correo ya tiene cuenta en DaleControl (de otra persona o de otra clínica). Cámbialo por otro distinto y vuelve a intentar.",
        }, { status: 400 });
      }
      console.error("[/api/team/[id]/reset-password] no se pudo crear la cuenta de acceso:", createError);
      return NextResponse.json({ error: "No se pudo crear la cuenta de acceso de este miembro" }, { status: 500 });
    }

    try {
      // Todas las filas que compartían el id muerto (una persona = una fila por
      // sucursal): todas quedan con la cuenta nueva o ninguna.
      await prisma.user.updateMany({
        where: { supabaseId: target.supabaseId },
        data: { supabaseId: creada.user.id },
      });
    } catch (e) {
      // La cuenta recién creada no sirve de nada sin la fila enlazada, y dejarla
      // ocuparía el correo. Se deshace para poder reintentar limpio.
      await supabaseAdmin.auth.admin.deleteUser(creada.user.id).catch(() => {});
      console.error("[/api/team/[id]/reset-password] no se pudo enlazar la cuenta nueva:", e);
      return NextResponse.json({ error: "No se pudo enlazar la cuenta de acceso nueva. No se cambió nada; vuelve a intentar." }, { status: 500 });
    }
    supabaseIdFinal = creada.user.id;
    cuentaCreada = true;
  }

  // La temporal recién aplicada la conoce el SUPER_ADMIN que la generó: el
  // usuario NO puede quedarse con ella. Se marca sólo después de que Supabase
  // aceptó el cambio (si Auth falla, arriba se corta y no hay nada que exigir).
  // Marca las filas HERMANAS del mismo supabaseId — una por clínica, ver
  // markMustChangePassword — y exenta a las cuentas de Google.
  await markMustChangePassword(supabaseIdFinal);

  // Audit log — guardamos quién reseteó a quién y cuándo. NO guardamos el
  // password (ni hash) en el log: solo la acción y el target. Usamos
  // logAudit directo porque logMutation está limitado a create/update/delete
  // y nuestro AuditAction "password_reset" es una acción dedicada con
  // semántica de seguridad propia (requiere SUPER_ADMIN, ya gateado arriba).
  const meta = extractAuditMeta(req);
  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "user",
    entityId: target.id,
    action: "password_reset",
    changes: {
      email:  { before: target.email, after: target.email },
      target: { before: null, after: `${target.firstName} ${target.lastName}` },
      ...(cuentaCreada && { cuentaDeAccesoCreada: { before: false, after: true } }),
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({
    success: true,
    tempPassword,
    cuentaCreada,
    ...(cuentaCreada && {
      aviso: `${target.firstName} no tenía cuenta de acceso: se le creó una con el correo ${target.email}. Entrégale esta contraseña temporal; al entrar tendrá que cambiarla.`,
    }),
  });
}
