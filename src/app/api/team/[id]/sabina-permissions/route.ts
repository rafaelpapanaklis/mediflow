import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";
import { ALL_PERMISSIONS, sanitizePermissionKeys } from "@/lib/auth/permissions";
import { esTablaDeSabinaAusente, leerAjustesSabinaConEstado } from "@/lib/sabina/ajustes-sabina";
import { AJUSTES_SABINA_POR_DEFECTO, permisosDeSabina } from "@/lib/sabina/permisos-sabina";

// GET   /api/team/[id]/sabina-permissions
// PATCH /api/team/[id]/sabina-permissions
//
// Lo que Sabina puede hacer en nombre de UN usuario. Mismo criterio entero que
// PATCH /api/team/[id]/permissions, con sus cuatro defensas:
//   1. Solo SUPER_ADMIN.
//   2. El usuario objetivo es de la clínica de la SESIÓN (nunca del cliente).
//   3. No se toca a otro SUPER_ADMIN (takeover / lock-out cruzado).
//   4. Audit log obligatorio en cada cambio.
// Y las keys pasan por `sanitizePermissionKeys`.
//
// Body del PATCH: { sabinaEnabled: boolean, sabinaPermissions: string[] | null }
//   - sabinaPermissions null  → «lo mismo que el usuario» (limpia la lista).
//   - sabinaPermissions array → exactamente esas keys (las desconocidas se
//     descartan). Una lista vacía se RECHAZA: en esta convención vacío significa
//     «todo lo del usuario», y quien desmarca todas las casillas quiere lo
//     contrario. Para que Sabina no haga nada está sabinaEnabled: false.
//
// Guardar aquí nunca le da a Sabina más que al usuario: la intersección se
// hace en cada petición a Sabina (`crearSabinaCtx`), no al guardar.

const FALTA_SQL =
  "Falta aplicar sql/sabina-permisos.sql en la base. Hasta entonces Sabina puede todo lo que puede cada usuario y aquí no se puede guardar nada.";

type Actor = NonNullable<Awaited<ReturnType<typeof getAuthContext>>>;

async function objetivo(
  ctx: Actor,
  id: string,
): Promise<{ target: { id: string; role: string; permissionsOverride: string[] } | null; error: NextResponse | null }> {
  // Defensa 2: el objetivo tiene que estar en la clínica del actor.
  const target = await prisma.user.findFirst({
    where: { id, clinicId: ctx.clinicId },
    select: { id: true, role: true, permissionsOverride: true },
  });
  if (!target) return { target: null, error: NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 }) };
  // Defensa 3.
  if (target.role === "SUPER_ADMIN") {
    return {
      target: null,
      error: NextResponse.json({ error: "No se pueden modificar los permisos de Sabina de un SUPER_ADMIN" }, { status: 400 }),
    };
  }
  return { target, error: null };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Defensa 1.
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: "Solo SUPER_ADMIN puede gestionar permisos" }, { status: 403 });
  }

  const { target, error } = await objetivo(ctx, params.id);
  if (error) return error;

  // Lo que el usuario puede se calcula AQUÍ, con la misma función que aplica el
  // candado: la pantalla no reimplementa la regla, la pinta.
  const usuario = { role: target.role, permissionsOverride: target.permissionsOverride };
  let leido: Awaited<ReturnType<typeof leerAjustesSabinaConEstado>>;
  try {
    leido = await leerAjustesSabinaConEstado(ctx.clinicId, target.id);
  } catch (e) {
    console.error("[team/sabina-permissions] no se pudieron leer", {
      clinicId: ctx.clinicId,
      code: (e as { code?: string })?.code ?? null,
    });
    return NextResponse.json({ error: "No se pudieron leer los permisos de Sabina. Inténtalo de nuevo." }, { status: 503 });
  }
  const { disponible, ajustes } = leido;

  const guardado = ajustes ?? AJUSTES_SABINA_POR_DEFECTO;
  const recorte = permisosDeSabina(usuario, guardado);
  return NextResponse.json({
    disponible,
    sabinaEnabled: guardado.activa,
    sabinaPermissions: sanitizePermissionKeys(guardado.permisos),
    // Se decide con la lista GUARDADA, no con la limpia: una lista de keys que ya
    // no existen no concede nada, y pintarla como «lo mismo que el usuario» haría
    // que un Guardar sin tocar nada le devolviera todo a Sabina.
    sabinaSameAsUser: guardado.permisos.length === 0,
    permisosDelUsuario: recorte.delUsuario,
    permisosDeSabina: recorte.permitidas,
    ...(disponible ? {} : { aviso: FALTA_SQL }),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Defensa 1.
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: "Solo SUPER_ADMIN puede gestionar permisos" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const enabled = body?.sabinaEnabled;
  const raw = body?.sabinaPermissions;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "sabinaEnabled debe ser true o false" }, { status: 400 });
  }
  if (raw !== null && !Array.isArray(raw)) {
    return NextResponse.json({ error: "sabinaPermissions debe ser null o array" }, { status: 400 });
  }
  // `sanitizePermissionKeys` usa `in`, que deja pasar "constructor": aquí se
  // exige key PROPIA del catálogo para que la lista vacía no se cuele disfrazada.
  const permissions =
    raw === null
      ? []
      : sanitizePermissionKeys(raw).filter((k) => Object.prototype.hasOwnProperty.call(ALL_PERMISSIONS, k));
  if (raw !== null && permissions.length === 0) {
    return NextResponse.json(
      {
        error:
          "Marca al menos un permiso para Sabina. Si no quieres que haga nada en nombre de este usuario, apágala.",
      },
      { status: 400 },
    );
  }

  const { target, error } = await objetivo(ctx, params.id);
  if (error) return error;

  let antes: { activa: boolean; permisos: string[] };
  try {
    const leido = await leerAjustesSabinaConEstado(ctx.clinicId, target.id);
    if (!leido.disponible) return NextResponse.json({ error: FALTA_SQL, disponible: false }, { status: 503 });
    antes = leido.ajustes ?? AJUSTES_SABINA_POR_DEFECTO;
  } catch {
    return NextResponse.json({ error: "No se pudieron leer los permisos de Sabina. Inténtalo de nuevo." }, { status: 503 });
  }

  try {
    await prisma.sabinaUserPermission.upsert({
      where: { userId: target.id },
      // clinicId de la SESIÓN, y el objetivo ya se comprobó que es de esa clínica.
      create: { userId: target.id, clinicId: ctx.clinicId, enabled, permissions, updatedById: ctx.userId },
      update: { clinicId: ctx.clinicId, enabled, permissions, updatedById: ctx.userId },
    });
  } catch (e) {
    if (esTablaDeSabinaAusente(e)) {
      return NextResponse.json({ error: FALTA_SQL, disponible: false }, { status: 503 });
    }
    throw e;
  }

  // Defensa 4.
  await logMutation({
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "user",
    entityId: target.id,
    action: "update",
    before: { sabinaEnabled: antes.activa, sabinaPermissions: sanitizePermissionKeys(antes.permisos) },
    after: { sabinaEnabled: enabled, sabinaPermissions: permissions, sabinaSameAsUser: permissions.length === 0 },
  });

  const recorte = permisosDeSabina({ role: target.role, permissionsOverride: target.permissionsOverride }, {
    activa: enabled,
    permisos: permissions,
  });
  return NextResponse.json({
    success: true,
    sabinaEnabled: enabled,
    sabinaPermissions: permissions,
    permisosDelUsuario: recorte.delUsuario,
    permisosDeSabina: recorte.permitidas,
  });
}
