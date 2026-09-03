"use server";

// ═══════════════════════════════════════════════════════════════════════
// Acciones del CRM de ventas de /admin.
//
// 🔴 CADA UNA VUELVE A VERIFICAR LA SESIÓN. El layout de /admin bloquea el
// RENDER de la página, pero una server action es un endpoint POST que se
// alcanza solo, sin pasar por ningún layout. Confiar en el layout aquí
// dejaría la libreta de prospectos —teléfonos, correos y notas de negocios
// reales— escribible y borrable por cualquiera con la URL.
//
// Auditoría: `logAdminGlobalEvent` exige un NextRequest y en una server
// action no hay ninguno, así que se emite el MISMO evento estructurado a
// mano — mismo tag "ADMIN_AUDIT", misma forma — leyendo IP y user-agent de
// headers(). Es best-effort: la auditoría nunca rompe la operación. Se
// auditan los movimientos que importan (alta, borrado, cambio de etapa e
// importación) y NO cada nota: un registro que se llena de ruido deja de
// leerse.
// ═══════════════════════════════════════════════════════════════════════
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getAdminSession } from "@/lib/admin-auth";
import {
  crmActualizar,
  crmCrear,
  crmEliminar,
  crmImportar,
  crmMoverEtapa,
  crmProgramarSeguimiento,
  crmRegistrarActividad,
  type CrmActividadEntrada,
  type CrmImportResumen,
  type CrmProspectoDTO,
  type CrmResultado,
} from "@/lib/admin/crm/service";
import type { CrmFilaImportada, CrmProspectoEntrada } from "@/lib/admin/crm/crm-core";

const RUTA = "/admin/crm";

const NO_AUTORIZADO = { ok: false as const, error: "No autorizado" };

function auditar(
  accion: string,
  entityId: string | null,
  admin: { id: string; email: string },
  datos?: Record<string, unknown>,
): void {
  try {
    const h = headers();
    console.log(
      JSON.stringify({
        tag: "ADMIN_AUDIT",
        type: `admin.crm-prospect.${accion}`,
        at: new Date().toISOString(),
        entity: "crm-prospect",
        entityId,
        action: accion,
        clinicId: null,
        adminId: admin.id,
        adminEmail: admin.email,
        ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
        userAgent: h.get("user-agent") ?? null,
        ...(datos ?? {}),
      }),
    );
  } catch (e) {
    console.error("auditar (crm) falló:", e);
  }
}

/** Revalida el tablero y, si la acción fue sobre uno en concreto, su ficha. */
function refrescar(id?: string | null): void {
  revalidatePath(RUTA);
  if (id) revalidatePath(`${RUTA}/${id}`);
}

// ── Alta, edición y baja ────────────────────────────────────────────────

export async function crearProspectoAccion(
  entrada: CrmProspectoEntrada & { tags?: string[] | string },
): Promise<CrmResultado<CrmProspectoDTO>> {
  const admin = await getAdminSession();
  if (!admin) return NO_AUTORIZADO;

  const r = await crmCrear(entrada, admin.user.email);
  if (!r.ok) return r;

  auditar("create", r.datos?.id ?? null, { id: admin.user.id, email: admin.user.email }, {
    after: { name: r.datos?.name, vertical: r.datos?.vertical, stage: r.datos?.stage },
  });
  refrescar(r.datos?.id);
  return r;
}

export async function actualizarProspectoAccion(
  id: string,
  entrada: CrmProspectoEntrada & { tags?: string[] | string },
): Promise<CrmResultado<CrmProspectoDTO>> {
  const admin = await getAdminSession();
  if (!admin) return NO_AUTORIZADO;

  const r = await crmActualizar(id, entrada);
  if (r.ok) refrescar(id);
  return r;
}

export async function eliminarProspectoAccion(id: string): Promise<CrmResultado> {
  const admin = await getAdminSession();
  if (!admin) return NO_AUTORIZADO;

  const r = await crmEliminar(id);
  if (!r.ok) return r;

  // Se audita ANTES de refrescar y con el mensaje que ya trae el nombre:
  // después del borrado no hay de dónde sacarlo.
  auditar("delete", id, { id: admin.user.id, email: admin.user.email }, { before: { mensaje: r.mensaje } });
  refrescar();
  return r;
}

// ── Embudo ──────────────────────────────────────────────────────────────

export async function moverEtapaAccion(
  id: string,
  etapa: string,
  opciones?: { nota?: string | null; motivoPerdida?: string | null },
): Promise<CrmResultado<CrmProspectoDTO>> {
  const admin = await getAdminSession();
  if (!admin) return NO_AUTORIZADO;

  const r = await crmMoverEtapa(id, etapa, admin.user.email, opciones);
  if (!r.ok) return r;

  auditar("stage", id, { id: admin.user.id, email: admin.user.email }, { after: { stage: etapa } });
  refrescar(id);
  return r;
}

// ── Bitácora ────────────────────────────────────────────────────────────

export async function registrarActividadAccion(
  prospectId: string,
  entrada: CrmActividadEntrada,
): Promise<CrmResultado<{ actividad: unknown; etapaNueva: string | null }>> {
  const admin = await getAdminSession();
  if (!admin) return NO_AUTORIZADO;

  const r = await crmRegistrarActividad(prospectId, entrada, admin.user.email);
  if (r.ok) refrescar(prospectId);
  return r as CrmResultado<{ actividad: unknown; etapaNueva: string | null }>;
}

/**
 * Lo que dispara el botón de WhatsApp o de llamar desde una tarjeta: deja
 * la constancia de que se intentó. La pantalla abre wa.me / tel: por su
 * cuenta — desde el servidor no se manda ningún mensaje, y por eso el
 * texto que queda anotado dice "se abrió", no "se envió".
 */
export async function contactoRapidoAccion(
  prospectId: string,
  kind: string,
): Promise<CrmResultado<{ actividad: unknown; etapaNueva: string | null }>> {
  const admin = await getAdminSession();
  if (!admin) return NO_AUTORIZADO;

  const texto =
    kind === "WHATSAPP"
      ? "Se abrió WhatsApp con el mensaje de primer contacto."
      : kind === "LLAMADA"
        ? "Se marcó desde el CRM."
        : kind === "EMAIL"
          ? "Se abrió el correo desde el CRM."
          : null;

  const r = await crmRegistrarActividad(prospectId, { kind, body: texto }, admin.user.email);
  if (r.ok) refrescar(prospectId);
  return r as CrmResultado<{ actividad: unknown; etapaNueva: string | null }>;
}

export async function programarSeguimientoAccion(
  id: string,
  fecha: string | null,
  nota: string | null,
): Promise<CrmResultado<CrmProspectoDTO>> {
  const admin = await getAdminSession();
  if (!admin) return NO_AUTORIZADO;

  const r = await crmProgramarSeguimiento(id, fecha, nota);
  if (r.ok) refrescar(id);
  return r;
}

// ── Importación ─────────────────────────────────────────────────────────

export async function importarAccion(
  filas: CrmFilaImportada[],
  comunes: { vertical?: string; source?: string; stage?: string },
): Promise<CrmResultado<CrmImportResumen>> {
  const admin = await getAdminSession();
  if (!admin) return NO_AUTORIZADO;

  const r = await crmImportar(filas, comunes ?? {}, admin.user.email);
  if (!r.ok) return r;

  auditar("import", null, { id: admin.user.id, email: admin.user.email }, {
    after: { creados: r.datos?.creados, repetidos: r.datos?.repetidos, vertical: comunes?.vertical },
  });
  refrescar();
  return r;
}
