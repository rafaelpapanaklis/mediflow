"use server";

// ═══════════════════════════════════════════════════════════════════════
// Acción del editor de la CUOTA DE ALMACENAMIENTO de un instituto.
//
// 🔴 VUELVE A VERIFICAR LA SESIÓN. El layout de /admin bloquea el render de
// la PÁGINA, pero una server action es un endpoint POST que se alcanza
// solo, sin pasar por ningún layout. Confiar en el layout aquí dejaría la
// cuota —o sea, lo que se le factura a un cliente— escribible por
// cualquiera.
//
// Auditoría: logAdminGlobalEvent exige un NextRequest y en una server action
// no hay ninguno, así que se emite el MISMO evento estructurado a mano —
// mismo tag "ADMIN_AUDIT", misma forma— leyendo IP y user-agent de headers().
// Es best-effort: la auditoría nunca rompe la operación. Aquí importa más
// que en otras pantallas: subir una cuota cambia lo que se le cobra a una
// escuela, y eso tiene que dejar rastro con nombre.
// ═══════════════════════════════════════════════════════════════════════
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getAdminSession } from "@/lib/admin-auth";
import { setEduAlmacenamientoCuotaTb } from "@/lib/edu/almacenamiento";
import { eduAlmTbLabel } from "@/lib/edu/almacenamiento-core";

const RUTA = "/admin/institutos";

/** Resultado único con campos opcionales: el repo compila con strict:false. */
export interface AccionResultado {
  ok: boolean;
  error?: string;
  mensaje?: string;
}

function auditar(entityId: string, datos: Record<string, unknown>): void {
  try {
    const h = headers();
    console.log(
      JSON.stringify({
        tag: "ADMIN_AUDIT",
        type: "admin.edu-institution.storage-quota",
        at: new Date().toISOString(),
        entity: "edu-institution",
        entityId,
        action: "update",
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
    console.error("auditar (edu-institution) falló:", e);
  }
}

export async function guardarCuotaAccion(input: {
  institutionId: string;
  tb: number;
}): Promise<AccionResultado> {
  const admin = await getAdminSession();
  if (!admin) return { ok: false, error: "No autorizado" };

  const r = await setEduAlmacenamientoCuotaTb(input?.institutionId, input?.tb);
  if (!r.ok) return { ok: false, error: r.error };

  auditar(input.institutionId, {
    adminId: admin.user.id,
    adminEmail: admin.user.email,
    before: { storageQuotaBytes: r.antesBytes },
    after: { storageQuotaBytes: r.despuesBytes },
  });
  revalidatePath(RUTA);
  return {
    ok: true,
    mensaje: `Cuota guardada: ${eduAlmTbLabel(r.despuesBytes ?? 0)}. Acuérdate de facturarlo.`,
  };
}
