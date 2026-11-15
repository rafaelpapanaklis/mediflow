// GET /api/barber/whatsapp/unread → { chats: n } — cuántos chats tienen algo
// sin leer. Es lo ÚNICO que necesita el contador de «Mensajes» del menú.
//
// Antes el menú pedía /threads cada minuto: ~2 000 mensajes viajando a
// Node para quedarse con un número (revisión ronda 16). Aquí Postgres
// agrega y devuelve UN entero.
//
// MISMAS reglas que la lista (listBarberThreads en src/lib/barber/whatsapp.ts),
// para que el número del menú y la bandeja nunca digan cosas distintas:
//   · las mismas 2 000 filas más nuevas de la barbería;
//   · las marcas de sistema (sys:…) no son mensajes;
//   · sin leer = un entrante después del último saliente del hilo;
//   · archivado = la última marca es «archivar» y es más nueva que el último
//     mensaje real (un mensaje nuevo desarchiva solo), y no cuenta.
// MISMO candado que /threads: whatsapp.view + whatsappInbox.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BARBER_WA_ARCHIVE_MARK, BARBER_WA_SYS_PREFIX } from "@/lib/barber/whatsapp-core";
import { jsonError, openWaGate, WA_INBOX_FEATURE } from "../_server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const gate = await openWaGate({
    permission: "whatsapp.view",
    feature: WA_INBOX_FEATURE,
    branchId: url.searchParams.get("branchId"),
  });
  if (gate.response) return gate.response;

  const sys = `${BARBER_WA_SYS_PREFIX}%`;
  try {
    const rows = await prisma.$queryRaw<Array<{ n: number }>>`
      WITH ult AS (
        SELECT "phone", "direction", "createdAt", "templateName",
               COALESCE("templateName" LIKE ${sys}, false) AS es_sys
        FROM "barber_messages"
        WHERE "barbershopId" = ${gate.gate.shopId}
        ORDER BY "createdAt" DESC
        LIMIT 2000
      ), por AS (
        SELECT "phone",
          MAX("createdAt") FILTER (WHERE NOT es_sys AND "direction" = 'INBOUND')  AS ult_in,
          MAX("createdAt") FILTER (WHERE NOT es_sys AND "direction" = 'OUTBOUND') AS ult_out,
          MAX("createdAt") FILTER (WHERE NOT es_sys)                              AS ult_real,
          (ARRAY_AGG("templateName" ORDER BY "createdAt" DESC) FILTER (WHERE es_sys))[1] AS marca,
          MAX("createdAt") FILTER (WHERE es_sys)                                  AS marca_at
        FROM ult
        GROUP BY "phone"
      )
      SELECT COUNT(*)::int AS n
      FROM por
      WHERE ult_in IS NOT NULL
        AND (ult_out IS NULL OR ult_in > ult_out)
        AND NOT (marca IS NOT NULL AND marca = ${BARBER_WA_ARCHIVE_MARK} AND marca_at > ult_real)
    `;
    return NextResponse.json({ chats: Number(rows[0]?.n ?? 0) });
  } catch (err) {
    console.error("[GET barber/whatsapp/unread]", err);
    return jsonError("No se pudo contar los chats sin leer.", 500);
  }
}
