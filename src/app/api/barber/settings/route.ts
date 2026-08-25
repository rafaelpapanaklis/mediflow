import { NextResponse } from "next/server";
import { barberApiError } from "@/lib/barber/branches";
import {
  getBarberSettings,
  saveBookingPolicy,
  saveCampaignSettings,
  saveInactivitySettings,
  saveLoyaltySettings,
  updateBarberProfile,
} from "@/lib/barber/settings";
import { gateSettings, readJson, revalidateShopWeb } from "./_gate";

export const dynamic = "force-dynamic";

/** GET /api/barber/settings → todos los ajustes de ESTA barbería (sin secretos). */
export async function GET() {
  const gate = await gateSettings();
  if ("response" in gate) return gate.response;
  try {
    const settings = await getBarberSettings(gate.ctx);
    return NextResponse.json({ settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return barberApiError(e, "settings:GET");
  }
}

/** Cuál SQL falta, por sección, para que el mensaje diga qué aplicar. */
const SQL_POR_SECCION: Record<string, string> = {
  loyalty: "sql/barber_clientes.sql",
  inactivity: "sql/barber_clientes.sql",
  campaigns: "sql/barber_campanas.sql",
  booking: "sql/barber_settings.sql",
};

/**
 * PATCH /api/barber/settings — { section, ...campos }.
 *
 *   section = "profile"    → nombre, teléfono, correo, dirección, ciudad,
 *                            estado, zona horaria (solo lo que venga).
 *   section = "loyalty"    → { enabled, threshold, reward }
 *   section = "inactivity" → { days }
 *   section = "campaigns"  → { cooldownDays }
 *   section = "booking"    → { policy: "auto" | "manual" }
 *
 * Cada sección se guarda sola: un número fuera de rango en fidelidad no
 * impide guardar el teléfono. Si el SQL de la sección no está aplicado se
 * responde 409 con el nombre del archivo que falta.
 */
export async function PATCH(req: Request) {
  const gate = await gateSettings();
  if ("response" in gate) return gate.response;
  const { ctx } = gate;
  try {
    const body = await readJson(req);
    const section = typeof body.section === "string" ? body.section : "";

    if (section === "profile") {
      const profile = await updateBarberProfile(ctx, body);
      revalidateShopWeb(ctx.barbershop.slug);
      return NextResponse.json({ profile });
    }

    let result:
      | Awaited<ReturnType<typeof saveLoyaltySettings>>
      | Awaited<ReturnType<typeof saveInactivitySettings>>
      | Awaited<ReturnType<typeof saveCampaignSettings>>
      | Awaited<ReturnType<typeof saveBookingPolicy>>;

    if (section === "loyalty") result = await saveLoyaltySettings(ctx, body);
    else if (section === "inactivity") result = await saveInactivitySettings(ctx, body);
    else if (section === "campaigns") result = await saveCampaignSettings(ctx, body);
    else if (section === "booking") result = await saveBookingPolicy(ctx, body.policy);
    else return NextResponse.json({ error: "Sección desconocida." }, { status: 400 });

    if (!result.ok) {
      const pendiente = result.reason === "sql_pendiente";
      return NextResponse.json(
        {
          error: pendiente
            ? `Este ajuste todavía no se puede guardar: falta aplicar ${SQL_POR_SECCION[section]} en la base de datos.`
            : "No se pudo guardar el ajuste. Inténtalo otra vez.",
          sqlPendiente: pendiente,
          value: result.value,
        },
        { status: pendiente ? 409 : 500 },
      );
    }
    return NextResponse.json({ value: result.value });
  } catch (e) {
    return barberApiError(e, "settings:PATCH");
  }
}
