import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { parseEduBoolean } from "@/lib/edu/padron-core";
import {
  setEduTeamMemberActive,
  setEduTeamMemberCampuses,
  setEduTeamMemberPermissions,
  updateEduTeamMember,
  type EduTeamUpdateResult,
} from "@/lib/edu/equipo";

export const dynamic = "force-dynamic";

/** Los campos de la persona que este PATCH sabe corregir (H-04). */
const CAMPOS_PERSONA = ["firstName", "lastName", "email", "phone", "role"] as const;

/**
 * PATCH /api/instituto/equipo/[id] — corrige los DATOS de una persona, da de
 * baja / reactiva su cuenta, o (P2-8) guarda sus permisos personalizados.
 *
 * 🔴 NO HAY DELETE, y no lo va a haber: sus notas clínicas, sus casos, sus
 * citas y sus cobros apuntan a este id. Dar de baja es escribir
 * `isActive: false`, y con eso getEduContext deja de resolver su sesión —
 * no entra al panel — sin borrar una línea de lo que hizo.
 *
 * 🔴 H-04 · `firstName`, `lastName`, `email`, `phone` y `role` en el body:
 * los cinco campos que capturaba el alta y ninguno se podía corregir. El
 * correo se escribe en Supabase Auth Y en Prisma, con reversión si la
 * segunda falla; el rol solo lo cambia una DIRECCION y BORRA el override de
 * permisos (viene de vuelta en `overrideDescartado` porque no hay dónde
 * guardarlo). Las reglas viven en `updateEduTeamMember`.
 *
 * 🔴 P2-8 · `permissionsOverride` en el body:
 *   · una LISTA de keys → se sanea (sanitizeEduPermissionKeys) y REEMPLAZA
 *     al default del rol;
 *   · `null` → restaurar el rol (override vacío);
 *   · ausente → los permisos no se tocan.
 * Nadie edita los suyos, y una lista que quede vacía tras sanear rebota —
 * las reglas viven en setEduTeamMemberPermissions y ahí están explicadas.
 *
 * 🔴 H-112 · `campusIds` en el body: la lista de sedes a las que entra,
 * EXACTA (reemplaza lo que tuviera). `[]` significa TODAS —la regla de la
 * ola de sedes— y la respuesta lo devuelve dicho (`abrioTodas`) para que la
 * pantalla lo pueda avisar: en esa tabla, quitar todas las filas concede
 * MÁS acceso, no menos. Ausente = no se tocan. La escritura vive en
 * campus.ts, que es el único escritor de esa tabla.
 *
 * 🔴 El ORDEN importa: primero los datos (que pueden cambiar el ROL), después
 * los permisos, después las sedes, y el estado al final. Al revés, un
 * override guardado antes del cambio de rol lo borraría el propio cambio de
 * rol y quien lo mandó creería que quedó puesto.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const g = await eduApiGuard("equipo.manage");
  if ("response" in g) return g.response;

  try {
    const body = await eduReadJson(request);

    const tocaEstado = body.isActive !== undefined;
    const tocaPermisos = "permissionsOverride" in body;
    const tocaSedes = "campusIds" in body;
    const tocaPersona = CAMPOS_PERSONA.some((k) => body[k] !== undefined);
    if (!tocaEstado && !tocaPermisos && !tocaSedes && !tocaPersona) {
      return NextResponse.json({ error: "No mandaste ningún cambio." }, { status: 400 });
    }

    let persona: EduTeamUpdateResult | null = null;
    if (tocaPersona) {
      persona = await updateEduTeamMember(g.ctx, params.id, {
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        phone: body.phone,
        role: body.role,
      });
    }

    let permisos: { permissionsOverride: string[] } | null = null;
    if (tocaPermisos) {
      permisos = await setEduTeamMemberPermissions(g.ctx, params.id, body.permissionsOverride);
    }

    let sedes: { campusIds: string[]; abrioTodas: boolean } | null = null;
    if (tocaSedes) {
      sedes = await setEduTeamMemberCampuses(g.ctx, params.id, body.campusIds);
    }

    let estado: { isActive: boolean; supervisionesCerradas: number } | null = null;
    if (tocaEstado) {
      const isActive = parseEduBoolean(body.isActive);
      if (isActive === null) {
        return NextResponse.json(
          { error: "Di si la cuenta queda activa o dada de baja." },
          { status: 400 },
        );
      }
      estado = await setEduTeamMemberActive(g.ctx, params.id, isActive);
    }

    return NextResponse.json({
      ok: true,
      id: params.id,
      ...(estado ?? {}),
      ...(permisos ?? {}),
      ...(sedes ?? {}),
      ...(persona
        ? {
            emailChanged: persona.emailChanged,
            roleChanged: persona.roleChanged,
            overrideDescartado: persona.overrideDescartado,
          }
        : {}),
    });
  } catch (err) {
    return eduApiError(err, "PATCH /api/instituto/equipo/[id]");
  }
}
