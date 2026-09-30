import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST → «Sincronizar citas futuras»: sube a Google las citas futuras que se
// crearon antes de conectar (o mientras la conexión estaba caída). La lógica
// (idempotente, sin duplicar) es de agenda/google-sync.ts; esta ruta solo la
// abre a los admins de la clínica de la sesión.
export async function POST() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Import dinámico y sin tipar: si la función aún no existe en google-sync, la
  // ruta contesta 501 en vez de romper el build ni el resto del sync.
  const mod: any = await import("@/lib/agenda/google-sync");
  if (typeof mod.sincronizarCitasFuturasAGoogle !== "function") {
    return NextResponse.json({ error: "La sincronización de citas futuras aún no está disponible." }, { status: 501 });
  }

  try {
    const r = await mod.sincronizarCitasFuturasAGoogle(ctx.clinicId);
    return NextResponse.json({
      success: true,
      creadas: Number(r?.creadas ?? 0),
      omitidas: Number(r?.omitidas ?? 0),
      fallidas: Number(r?.fallidas ?? 0),
      // restantes > 0: se agotó el tiempo; es idempotente, se vuelve a pulsar.
      restantes: Number(r?.restantes ?? 0),
      // «no_conectada» | «conexion_caida»: no hizo nada y dice por qué.
      motivo: typeof r?.motivo === "string" ? r.motivo : undefined,
    });
  } catch (e: any) {
    console.error("[google-calendar] sincronizar citas futuras falló:", e?.message ?? e);
    return NextResponse.json({ error: "No se pudo sincronizar. Intenta de nuevo en unos minutos." }, { status: 500 });
  }
}
