// POST /api/realty/pld/expedientes — abrir o actualizar un expediente.
//
// Una sola ruta para las dos cosas: el expediente de un contacto es ÚNICO
// (índice (accountId, contactId)), así que "crear" y "editar" son la misma
// operación vista dos veces. Dos rutas separadas obligarían al cliente a
// saber si ya existe, y esa carrera se pierde sola.
import { NextResponse } from "next/server";
import { errorPld, gatePld, leerJson, malaPeticion } from "../_guard";
import { guardarExpediente, parsearParcheExpediente } from "@/lib/realty/pld/expedientes";
import { registrarAcceso } from "@/lib/realty/pld/bitacora";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await gatePld("pld.manage");
  if ("response" in gate) return gate.response;
  const { ctx, nombreUsuario } = gate;

  try {
    const body = await leerJson(req);
    const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
    if (!contactId) return malaPeticion("Falta decir de qué contacto es el expediente.");

    const parsed = parsearParcheExpediente(body);
    if ("error" in parsed) return malaPeticion(parsed.error);

    // guardarExpediente comprueba que el contacto sea de ESTA cuenta antes
    // de escribir: un id de otra inmobiliaria no crea nada aquí.
    const res = await guardarExpediente(ctx, contactId, parsed.parche, nombreUsuario);
    if ("error" in res) return malaPeticion(res.error);

    await registrarAcceso(ctx, { action: "VER_EXPEDIENTE", fileId: res.id }, req);
    return NextResponse.json({ ok: true, id: res.id });
  } catch (e) {
    return errorPld("expedientes", e);
  }
}
