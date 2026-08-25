"use server";

// ═══════════════════════════════════════════════════════════════════════
// Acciones del editor de parámetros fiscales de las calculadoras.
//
// 🔴 CADA ACCIÓN VUELVE A VERIFICAR LA SESIÓN. El layout de /admin bloquea
// el render de la PÁGINA, pero una server action es un endpoint POST que se
// alcanza solo, sin pasar por ningún layout. Confiar en el layout aquí
// dejaría la tabla de impuestos de la plataforma escribible por cualquiera.
//
// Auditoría: logAdminGlobalEvent exige un NextRequest y en una server action
// no hay ninguno, así que se emite el MISMO evento estructurado a mano —
// mismo tag "ADMIN_AUDIT", misma forma— leyendo IP y user-agent de headers().
// Es best-effort: la auditoría nunca rompe la operación.
// ═══════════════════════════════════════════════════════════════════════
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getAdminSession } from "@/lib/admin-auth";
import {
  borrarParametro,
  guardarParametro,
  sembrarParametros,
  type GuardarParametroInput,
} from "@/lib/realty/calc/params";
import { isKnownStateCode } from "@/lib/realty/calc/catalog";

const RUTA = "/admin/inmobiliarias/parametros";

const KINDS = ["ISAI", "UMA", "UDI", "INPC", "INFONAVIT", "FOVISSSTE"];

/** Resultado único con campos opcionales: el repo compila con strict:false. */
export interface AccionResultado {
  ok: boolean;
  error?: string;
  mensaje?: string;
}

function auditar(accion: string, entityId: string, datos: Record<string, unknown>): void {
  try {
    const h = headers();
    console.log(
      JSON.stringify({
        tag: "ADMIN_AUDIT",
        type: `admin.realty-calc-param.${accion}`,
        at: new Date().toISOString(),
        entity: "realty-calc-param",
        entityId,
        action: accion,
        clinicId: null,
        adminId: datos.adminId ?? null,
        adminEmail: datos.adminEmail ?? null,
        ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
        userAgent: h.get("user-agent") ?? null,
        before: datos.before ?? null,
        after: datos.after ?? null,
      }),
    );
  } catch (e) {
    console.error("auditar (realty-calc-param) falló:", e);
  }
}

export async function sembrarAccion(): Promise<AccionResultado> {
  const admin = await getAdminSession();
  if (!admin) return { ok: false, error: "No autorizado" };

  const r = await sembrarParametros();
  if (r.error) return { ok: false, error: r.error };

  auditar("seed", "catalogo", {
    adminId: admin.user.id,
    adminEmail: admin.user.email,
    after: { creadas: r.creadas, omitidas: r.omitidas },
  });
  revalidatePath(RUTA);
  return {
    ok: true,
    mensaje:
      r.creadas === 0
        ? `No había nada nuevo que sembrar: las ${r.omitidas} filas del catálogo ya estaban.`
        : `Se sembraron ${r.creadas} filas. Se dejaron intactas ${r.omitidas} que ya existían.`,
  };
}

export async function guardarAccion(input: {
  id?: string | null;
  kind: string;
  stateCode: string;
  year: number;
  value: number;
  effectiveFrom: string;
  metaJson: string;
}): Promise<AccionResultado> {
  const admin = await getAdminSession();
  if (!admin) return { ok: false, error: "No autorizado" };

  if (!KINDS.includes(input.kind)) return { ok: false, error: "Tipo de parámetro desconocido." };
  const stateCode = String(input.stateCode ?? "").trim().toUpperCase();
  if (!isKnownStateCode(stateCode)) {
    return { ok: false, error: 'Clave de estado desconocida (usa "MX" para lo federal).' };
  }

  let meta: Record<string, unknown>;
  try {
    const parsed = JSON.parse(input.metaJson || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "El detalle tiene que ser un objeto JSON." };
    }
    meta = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, error: "El detalle no es JSON válido. Revisa las comillas y las comas." };
  }

  const payload: GuardarParametroInput = {
    id: input.id ?? null,
    kind: input.kind,
    stateCode,
    year: Number(input.year),
    value: Number(input.value),
    effectiveFrom: String(input.effectiveFrom),
    meta,
  };

  const r = await guardarParametro(payload);
  if (!r.ok) return { ok: false, error: r.error };

  auditar(input.id ? "update" : "create", r.id ?? "", {
    adminId: admin.user.id,
    adminEmail: admin.user.email,
    after: {
      kind: payload.kind,
      stateCode: payload.stateCode,
      year: payload.year,
      value: payload.value,
      effectiveFrom: payload.effectiveFrom,
    },
  });
  revalidatePath(RUTA);
  return { ok: true, mensaje: "Guardado." };
}

export async function borrarAccion(id: string): Promise<AccionResultado> {
  const admin = await getAdminSession();
  if (!admin) return { ok: false, error: "No autorizado" };
  if (!id) return { ok: false, error: "Falta el parámetro." };

  const r = await borrarParametro(id);
  if (!r.ok) return { ok: false, error: r.error };

  auditar("delete", id, { adminId: admin.user.id, adminEmail: admin.user.email });
  revalidatePath(RUTA);
  return { ok: true, mensaje: "Borrado." };
}
