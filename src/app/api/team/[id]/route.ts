import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { getPlanLimitsForClinic } from "@/lib/plans";
import { CLINIC_OVERRIDE_SELECT } from "@/lib/billing/plan-overrides";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { logMutation } from "@/lib/audit";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { MIEMBRO_SELECT, camposPublicosDeMiembro } from "@/lib/team/member-fields";
import { clasificarErrorAuth, esUuid, ERROR_SIN_CUENTA } from "@/lib/team/auth-errors";

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

// P1-8: roles asignables por API — los mismos que ofrece la UI de equipo
// (team-client.tsx ROLES). Nunca SUPER_ADMIN: asignarlo por API era una
// escalada de privilegios (requireRole le da bypass en todo el producto).
const ASSIGNABLE_ROLES: string[] = ["DOCTOR", "ADMIN", "RECEPTIONIST"];

// Mismo patrón que EMAIL_RE de @/lib/import/engine.ts. Se declara local en vez
// de importarlo porque ese módulo arrastra exceljs entero (y un route.ts no
// puede exportar nada que no sea handler/config de Next).
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// GET /api/team/[id] — get doctor details
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) return err;

  // EQ-05: `include` sin `select` traía la fila ENTERA y se serializaba tal
  // cual — totpSecret en claro, los hashes de los códigos de recuperación, el
  // hash del PIN de Caja y el refresh token de Google. Con la lista blanca el
  // secreto ni siquiera sale de Postgres.
  const member = await prisma.user.findFirst({
    where: { id: params.id, clinicId: ctx!.clinicId }, // cross-clinic protection
    select: {
      ...MIEMBRO_SELECT,
      _count: {
        select: {
          appointments: true,
          records: true,
          primaryPatients: true,
        },
      },
    },
  });

  if (!member) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json(member);
}

// PATCH /api/team/[id] — update doctor info
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // EQ-07: editar a un miembro es "Editar equipo" del modal (antes
  // `requireAdmin`; mismos roles por default: SA y ADMIN), con override. Los
  // guards de más abajo sobre SUPER_ADMIN siguen siendo por rol.
  const denied = denyIfMissingPermission(ctx, "team.edit");
  if (denied) return denied;

  // El body de la request solo se puede leer una vez. Antes lo leíamos dos
  // veces (una dentro del guard de self-edit y otra para el update), lo que
  // disparaba "Body has already been read" como excepción no manejada y
  // devolvía 500 con body vacío al cliente — el frontend tronaba con
  // "Unexpected end of JSON input" al editar la cédula del propio doctor.
  const body = await req.json();

  // Prevent changing own role or deactivating self
  //
  // El correo propio SÍ se permite, a diferencia de rol/estado. Los dos casos de
  // arriba se bloquean porque son escalada (subirse el rol) o lock-out (dejarse
  // fuera); cambiarse el correo no es ninguno de los dos: getAuthContext resuelve
  // la sesión por supabaseId — el `sub` del JWT, que no cambia — y la contraseña
  // sigue siendo la misma, así que ni se cae la sesión abierta ni se pierde el
  // acceso. Es además el caso legítimo más común (el dueño cambia su correo).
  if (params.id === ctx!.userId) {
    if (body.role && body.role !== ctx!.role) {
      return NextResponse.json({ error: "No puedes cambiar tu propio rol" }, { status: 400 });
    }
    if (body.isActive === false) {
      return NextResponse.json({ error: "No puedes desactivarte a ti mismo" }, { status: 400 });
    }
  }

  // Verify member belongs to this clinic
  const member = await prisma.user.findFirst({
    where: { id: params.id, clinicId: ctx!.clinicId },
  });
  if (!member) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  // P1-8: (a) el rol nuevo debe estar en la allowlist de la UI — se acepta
  // re-enviar el rol actual sin cambio (el modal manda el form completo);
  // (b) un no-SUPER_ADMIN no puede tocar rol/estado de un SUPER_ADMIN (ni
  // degradar ni desactivar al dueño de la plataforma).
  if (
    body.role !== undefined &&
    body.role !== member.role &&
    !ASSIGNABLE_ROLES.includes(body.role)
  ) {
    return NextResponse.json(
      { error: "Rol inválido. Permitidos: DOCTOR, ADMIN, RECEPTIONIST." },
      { status: 400 },
    );
  }
  const touchesSuperAdminRoleOrState =
    (body.role !== undefined && body.role !== member.role) || body.isActive === false;
  if (member.role === "SUPER_ADMIN" && !ctx!.isSuperAdmin && touchesSuperAdminRoleOrState) {
    return NextResponse.json(
      { error: "Solo un SUPER_ADMIN puede modificar el rol o estado de un SUPER_ADMIN" },
      { status: 403 },
    );
  }

  // Tope de usuarios por plan al REACTIVAR. El POST de /api/team ya lo valida,
  // pero este PATCH aplicaba isActive a ciegas: crear 2 → desactivar 1 → crear
  // el 3º → PATCH {isActive:true} dejaba 3 activos en un plan de 2. Solo se
  // valida el paso inactivo→activo (desactivar siempre se permite).
  // FAIL-OPEN: si no se puede leer el plan o contar, se deja pasar y se loguea
  // — un error del gate no puede impedirle a un admin reactivar a su equipo.
  if (body.isActive === true && member.isActive === false) {
    try {
      const clinicPlan = await prisma.clinic.findUnique({ where: { id: ctx!.clinicId }, select: CLINIC_OVERRIDE_SELECT });
      const { maxUsers } = await getPlanLimitsForClinic(clinicPlan);
      if (maxUsers != null) {
        const activeUsers = await prisma.user.count({ where: { clinicId: ctx!.clinicId, isActive: true } });
        if (activeUsers >= maxUsers) {
          return NextResponse.json(
            { error: `Tu plan incluye ${maxUsers} usuario(s) activo(s). Desactiva a alguien más o sube de plan para reactivar a este miembro.`, code: "PLAN_LIMIT_USERS", limit: maxUsers },
            { status: 402 },
          );
        }
      }
    } catch (e) {
      console.error("[api/team/[id] PATCH] no se pudo validar el tope de usuarios, se deja pasar:", e);
    }
  }

  // ── Cambio de email ───────────────────────────────────────────────────────
  // El email NO es una columna más: es la IDENTIDAD DE LOGIN en Supabase Auth.
  // Este PATCH lo ignoraba (no estaba en el `data` de abajo), así que editarlo
  // desde /dashboard/team guardaba "bien" sin cambiar nada — un no-op silencioso.
  //
  // Se aplica en LOS DOS lados, en este orden: Supabase primero (es la fuente de
  // verdad del login) y Prisma sólo si Supabase respondió OK. Si Prisma truena
  // después, se revierte Supabase — dejar Auth con el correo nuevo y el panel
  // con el viejo es justo el estado imposible de depurar que esto viene a cerrar.
  //
  // La comparación es case-insensitive contra lo que ya hay en BD: el modal
  // reenvía el form completo, y filas viejas guardadas con mayúsculas no deben
  // contar como "cambio" (Supabase trata el login como case-insensitive).
  const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
  const emailChanged = emailRaw !== null && emailRaw !== member.email.trim().toLowerCase();

  // Filas hermanas del MISMO supabaseId. El schema es @@unique([supabaseId,
  // clinicId]): una persona tiene UNA fila User POR clínica y /api/clinics crea
  // cada sucursal con el supabaseId del dueño. Como Auth es global, cambiar el
  // login lo cambia para TODAS sus sedes — si sólo tocáramos la fila de esta
  // clínica, las demás seguirían mostrando el correo viejo.
  let siblingIds: string[] = [];
  let supabaseAdmin: ReturnType<typeof getAdminClient> | null = null;
  // El correo cambió EN Supabase (y hay que deshacerlo si Prisma truena). Se
  // separa de `emailChanged` porque un miembro sin cuenta de acceso cambia de
  // correo en la fila y Auth no se toca.
  let authActualizado = false;
  // La fila apunta a una cuenta de Auth que ya no existe (invitado que nunca
  // entró, o cuenta borrada por un reinicio de la clínica). Ver abajo.
  let sinCuentaDeAcceso = false;

  if (emailChanged) {
    if (!EMAIL_RE.test(emailRaw!)) {
      return NextResponse.json({ error: "El email no tiene un formato válido" }, { status: 400 });
    }

    // Escalada de privilegios: cambiarle el correo a un SUPER_ADMIN es
    // apoderarse de su login (con el correo nuevo se pide "olvidé mi
    // contraseña" y se toma la cuenta del dueño de la plataforma). Mismo
    // criterio que el guard de rol/estado de arriba y que reset-password.
    if (member.role === "SUPER_ADMIN" && !ctx!.isSuperAdmin) {
      return NextResponse.json(
        { error: "Solo un SUPER_ADMIN puede cambiar el correo de un SUPER_ADMIN" },
        { status: 403 },
      );
    }

    const siblings = await prisma.user.findMany({
      where: { supabaseId: member.supabaseId },
      select: { id: true, clinicId: true },
    });
    siblingIds = siblings.filter(s => s.id !== member.id).map(s => s.id);

    // Duplicado: mismo chequeo que el alta (POST /api/team) — no puede haber dos
    // usuarios con el mismo correo en una clínica. Se evalúa sobre TODAS las
    // clínicas donde vamos a escribir, no sólo la activa, e insensitive para
    // atrapar también las filas viejas guardadas con mayúsculas.
    const clash = await prisma.user.findFirst({
      where: {
        email:      { equals: emailRaw!, mode: "insensitive" },
        clinicId:   { in: Array.from(new Set(siblings.map(s => s.clinicId))) },
        supabaseId: { not: member.supabaseId },
      },
      select: { id: true },
    });
    if (clash) {
      return NextResponse.json(
        { error: "Ya existe un usuario con ese email en esta clínica" },
        { status: 400 },
      );
    }

    supabaseAdmin = getAdminClient();
    const authError: any = !esUuid(member.supabaseId)
      ? ERROR_SIN_CUENTA // demo / muestra de QA: nunca tuvo cuenta, y supabase-js lanzaría con un id así
      : (await supabaseAdmin.auth.admin.updateUserById(
          member.supabaseId,
          // email_confirm: sin esto el correo queda pendiente de confirmar y el
          // doctor no puede entrar hasta hacer clic en un mail que nunca pidió.
          { email: emailRaw!, email_confirm: true },
        )).error;
    if (authError) {
      const causa = clasificarErrorAuth(authError);
      if (causa === "cuenta-no-existe") {
        // BEVADENT, 28-sep-2026: la fila de la doctora apuntaba a una cuenta de
        // Auth ya borrada (el reinicio de la clínica la quitó y dejó la fila
        // inactiva). Todo intento de cambiarle el correo — y con él la cédula,
        // que viaja en el mismo PATCH — moría con un mensaje genérico. Un
        // miembro sin cuenta de acceso no tiene login que cambiar: el correo se
        // guarda en la fila y Auth no se toca. Para darle acceso de verdad está
        // "Restablecer contraseña", que crea la cuenta con este correo.
        sinCuentaDeAcceso = true;
      } else if (causa === "correo-ya-registrado") {
        // Mismo caso que cubre el alta (POST /api/team): el correo ya es de otra
        // cuenta de la plataforma, sea de esta clínica o de cualquier otra.
        return NextResponse.json({
          error: "Este email ya tiene cuenta en DaleControl. Usa otro correo distinto para este miembro.",
        }, { status: 400 });
      } else if (causa === "correo-invalido") {
        return NextResponse.json({
          error: "El sistema de acceso no aceptó ese correo (formato o dominio). Revisa que esté bien escrito. No se guardó ningún cambio.",
        }, { status: 400 });
      } else if (causa === "limite") {
        return NextResponse.json({
          error: "Hay demasiados intentos seguidos. Espera unos minutos y vuelve a guardar. No se guardó ningún cambio.",
        }, { status: 429 });
      } else {
        console.error("[api/team/[id] PATCH] supabase updateUserById falló:", authError);
        const motivo = (authError as any).code || (authError as any).status || "desconocido";
        return NextResponse.json(
          {
            error: `No se pudo actualizar el correo de acceso (motivo: ${motivo}). No se guardó ningún cambio, tampoco la cédula ni los demás datos: para guardarlos sin tocar el correo, deja el correo como estaba.`,
          },
          { status: 502 },
        );
      }
    } else {
      authActualizado = true;
    }
  }

  const data = {
    ...(body.firstName  !== undefined && { firstName:  body.firstName  }),
    ...(body.lastName   !== undefined && { lastName:   body.lastName   }),
    ...(body.specialty  !== undefined && { specialty:  body.specialty  }),
    ...(body.color      !== undefined && { color:      body.color      }),
    ...(body.phone      !== undefined && { phone:      body.phone      }),
    ...(body.avatarUrl  !== undefined && { avatarUrl:  body.avatarUrl  }),
    ...(body.role       !== undefined && { role:       body.role       }),
    ...(body.isActive   !== undefined && { isActive:   body.isActive   }),
    ...(body.services   !== undefined && { services:   body.services   }),
    // NOM-024 — datos del médico
    ...(body.cedulaProfesional  !== undefined && { cedulaProfesional:  body.cedulaProfesional  || null }),
    ...(body.especialidad       !== undefined && { especialidad:       body.especialidad       || null }),
    ...(body.cedulaEspecialidad !== undefined && { cedulaEspecialidad: body.cedulaEspecialidad || null }),
    // Sólo cuando cambió de verdad: así un guardado que no toca el correo no
    // reescribe la columna ni dispara el aviso de "entra con el correo nuevo".
    ...(emailChanged && { email: emailRaw! }),
  };

  let updated: Awaited<ReturnType<typeof prisma.user.update>>;
  try {
    updated = emailChanged
      ? await prisma.$transaction(async (tx) => {
          const row = await tx.user.update({ where: { id: params.id }, data });
          // Las otras sedes de la misma persona: mismo correo o nada.
          if (siblingIds.length > 0) {
            await tx.user.updateMany({ where: { id: { in: siblingIds } }, data: { email: emailRaw! } });
          }
          return row;
        })
      : await prisma.user.update({ where: { id: params.id }, data });
  } catch (e) {
    // Supabase ya cambió y Prisma no. Se revierte Auth para que el doctor siga
    // entrando con el correo que el panel muestra.
    if (authActualizado && supabaseAdmin) {
      const { error: revertError } = await supabaseAdmin.auth.admin.updateUserById(
        member.supabaseId,
        { email: member.email, email_confirm: true },
      );
      if (revertError) {
        console.error(
          "[api/team/[id] PATCH] CUENTAS DESINCRONIZADAS: Supabase quedó con el correo nuevo, Prisma con el viejo, y la reversión también falló.",
          { userId: params.id, supabaseId: member.supabaseId, emailAnterior: member.email, emailNuevo: emailRaw, causa: e, revertError },
        );
        return NextResponse.json({
          error: `No se guardó el cambio y tampoco se pudo deshacer: la cuenta quedó iniciando sesión con ${emailRaw} aunque el panel siga mostrando ${member.email}. Avisa a soporte con este dato antes de volver a intentar.`,
        }, { status: 500 });
      }
    }
    console.error("[api/team/[id] PATCH] update falló:", e);
    return NextResponse.json({ error: "No se pudieron guardar los cambios" }, { status: 500 });
  }

  await logMutation({
    req,
    clinicId: ctx!.clinicId,
    userId: ctx!.userId,
    entityType: "user",
    entityId: params.id,
    action: "update",
    // Ambos son la fila COMPLETA (ni el findFirst de arriba ni el update llevan
    // select), así que diffObjects registra `email: {before, after}` solo. No
    // meterle un select a ninguno de los dos: un cambio de identidad de login
    // tiene que quedar rastreable.
    before: member as any,
    after: updated as any,
  });

  revalidateAfter("team");

  // emailChanged: la UI lo usa para avisarle al admin que el miembro ahora
  // inicia sesión con el correo nuevo — sin esa señal el cambio es invisible.
  //
  // EQ-05: la fila entera se queda en el servidor. Aquí hacía falta completa
  // (la bitácora de arriba saca el diff de ella), pero lo que se responde pasa
  // por la lista blanca: el spread `{...updated}` mandaba el secret TOTP de esa
  // persona al navegador de quien pulsó "Guardar cambios".
  // sinCuentaDeAcceso: el correo se guardó en la ficha pero este miembro no tiene
  // cuenta con la que iniciar sesión — la UI avisa cómo dársela.
  return NextResponse.json({
    ...camposPublicosDeMiembro(updated),
    emailChanged,
    sinCuentaDeAcceso,
    ...(sinCuentaDeAcceso && {
      aviso: `Se guardaron los cambios. Ojo: ${updated.firstName} no tiene una cuenta para iniciar sesión, así que el correo quedó solo en su ficha. Para darle acceso, el dueño (SUPER_ADMIN) abre su ficha y pulsa «Restablecer contraseña»: eso le crea la cuenta con este correo.`,
    }),
  });
}

// DELETE /api/team/[id] — permanently remove doctor
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  // EQ-07: dar de baja es "Editar equipo" (antes `requireAdmin`).
  const denied = denyIfMissingPermission(ctx, "team.edit");
  if (denied) return denied;

  // Cannot delete yourself
  if (params.id === ctx!.userId) {
    return NextResponse.json({ error: "No puedes eliminarte a ti mismo" }, { status: 400 });
  }

  const member = await prisma.user.findFirst({
    where: { id: params.id, clinicId: ctx!.clinicId },
    include: { _count: { select: { appointments: true, records: true } } },
  });

  if (!member) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  // P1-8: un ADMIN no puede eliminar (ni desactivar vía este DELETE) al dueño
  // de la plataforma.
  if (member.role === "SUPER_ADMIN" && !ctx!.isSuperAdmin) {
    return NextResponse.json(
      { error: "Solo un SUPER_ADMIN puede eliminar a un SUPER_ADMIN" },
      { status: 403 },
    );
  }

  // If doctor has appointments/records, deactivate instead of delete
  if (member._count.appointments > 0 || member._count.records > 0) {
    await prisma.user.updateMany({ where: { id: params.id, clinicId: ctx!.clinicId }, data: { isActive: false } });
    await logMutation({
      req, clinicId: ctx!.clinicId, userId: ctx!.userId,
      entityType: "user", entityId: params.id, action: "delete",
      before: { firstName: member.firstName, lastName: member.lastName, email: member.email, role: member.role, deactivated: true },
    });
    revalidateAfter("team");
    return NextResponse.json({ deactivated: true, message: "Doctor desactivado (tiene registros históricos)" });
  }

  // Sin citas ni expedientes: se intenta borrar de verdad. Orden: PRIMERO la fila,
  // DESPUÉS la cuenta de Auth. Antes era al revés y, si la fila no se dejaba
  // borrar, la persona quedaba sin cuenta de acceso pero seguía en el equipo
  // (BEVADENT, 28-sep-2026: cinco intentos seguidos de «Eliminar» a la doctora).
  //
  // La razón típica de que la fila se niegue: `audit_logs` tiene FK a users(id) y
  // un trigger que impide tocarlo (trg_audit_logs_immutable). Quien hizo o a quien
  // le hicieron un cambio alguna vez ya tiene filas ahí, aunque no tenga una sola
  // cita. En ese caso se desactiva, igual que cuando hay historial clínico, y la
  // respuesta lo dice en vez de tronar con un 500 vacío.
  let borrado = false;
  try {
    const r = await prisma.user.deleteMany({ where: { id: params.id, clinicId: ctx!.clinicId } });
    borrado = r.count > 0;
  } catch (e) {
    console.warn("[api/team/[id] DELETE] la fila no se puede borrar (historial de auditoría u otra referencia); se desactiva:", (e as any)?.code ?? e);
  }

  if (!borrado) {
    await prisma.user.updateMany({ where: { id: params.id, clinicId: ctx!.clinicId }, data: { isActive: false } });
    await logMutation({
      req, clinicId: ctx!.clinicId, userId: ctx!.userId,
      entityType: "user", entityId: params.id, action: "delete",
      before: { firstName: member.firstName, lastName: member.lastName, email: member.email, role: member.role, deactivated: true },
    });
    revalidateAfter("team");
    return NextResponse.json({ deactivated: true, message: "Doctor desactivado (tiene registros históricos)" });
  }

  await logMutation({
    req, clinicId: ctx!.clinicId, userId: ctx!.userId,
    entityType: "user", entityId: params.id, action: "delete",
    before: { firstName: member.firstName, lastName: member.lastName, email: member.email, role: member.role, hardDelete: true },
  });

  // La cuenta de Auth es de la PERSONA, no de la fila: si tiene filas en otras
  // clínicas (sucursales del dueño, mismo supabaseId) borrarla las dejaría sin
  // poder entrar. Solo se borra cuando ya no queda ninguna fila que la use. Si la
  // cuenta ya no existe (sin acceso) no hay nada que borrar y no es un error.
  const restantes = await prisma.user.count({ where: { supabaseId: member.supabaseId } });
  if (restantes === 0 && esUuid(member.supabaseId)) {
    const { error: authError } = await getAdminClient().auth.admin.deleteUser(member.supabaseId);
    if (authError && clasificarErrorAuth(authError) !== "cuenta-no-existe") {
      console.error("[api/team/[id] DELETE] la fila se borró pero la cuenta de Auth no:", { supabaseId: member.supabaseId, authError });
    }
  }

  revalidateAfter("team");
  return NextResponse.json({ deleted: true });
}
