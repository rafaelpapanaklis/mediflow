import { NextResponse } from "next/server";
import { getBarberClientsConfig, saveBarberClientsConfig } from "@/lib/barber/clients";
import { gateBarberClients, readJson, serverError } from "../_helpers";

export const dynamic = "force-dynamic";

/** GET — config de fidelidad e inactividad de ESTA barbería. */
export async function GET() {
  const gate = await gateBarberClients("clients.view");
  if ("response" in gate) return gate.response;
  try {
    return NextResponse.json({ config: await getBarberClientsConfig(gate.ctx) });
  } catch (e) {
    return serverError("settings.get", e);
  }
}

/**
 * PATCH — cada cuántos cortes se regala el premio y a los cuántos días se
 * considera inactivo a un cliente. NADA de esto está cableado en el código:
 * cada barbería pone su número. Los rangos se recortan en el servidor.
 *
 * Permiso `settings.edit` (dueño/encargado): es configuración de la barbería,
 * no una acción de mostrador.
 */
export async function PATCH(req: Request) {
  const gate = await gateBarberClients("settings.edit");
  if ("response" in gate) return gate.response;

  try {
    const body = await readJson(req);
    const result = await saveBarberClientsConfig(gate.ctx, body);
    if (!result.ok) {
      return NextResponse.json(
        {
          error:
            result.reason === "sql_pendiente"
              ? "Falta aplicar sql/barber_clientes.sql en la base de datos."
              : "No se pudo guardar la configuración.",
          config: result.config,
        },
        { status: result.reason === "sql_pendiente" ? 409 : 500 },
      );
    }
    return NextResponse.json({ config: result.config });
  } catch (e) {
    return serverError("settings.patch", e);
  }
}
