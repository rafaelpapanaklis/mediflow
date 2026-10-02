import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { getOrCreateBotConfig, toConfigDTO, toFaqDTO, buildConfigUpdate } from "./service";
import { errorDeTamanoDePersona, PERSONA_MAX_CARACTERES } from "@/lib/whatsapp/bot/ai-prompt";
import {
  columnasDePreciosExisten,
  estadoDePreciosDelBot,
  guardarInterruptoresDePrecios,
  interruptoresDelBody,
} from "@/lib/whatsapp/bot/precios-bot";

export const dynamic = "force-dynamic";

/**
 * GET /api/whatsapp/bot
 * Config del bot de la clínica de sesión (se crea con defaults si no existe) +
 * sus FAQs ordenadas. Multi-tenant: clinicId SIEMPRE de la sesión.
 */
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = await getOrCreateBotConfig(ctx.clinicId);
  const faqs = await prisma.whatsAppBotFaq.findMany({
    where: { clinicId: ctx.clinicId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });

  // ws1-t3 — los dos interruptores de precios (SQL crudo, tolerante a que
  // la columna aún no exista: apagados).
  const precios = await estadoDePreciosDelBot(ctx.clinicId);

  return NextResponse.json({
    config: { ...toConfigDTO(config), ...precios },
    faqs: faqs.map(toFaqDTO),
  });
}

/**
 * PATCH /api/whatsapp/bot
 * Actualiza enabled, botName, persona, greeting, businessHours, afterHoursMsg,
 * canAnswerFaq, canBookAppointments, fallbackToHuman y (ws1-t3, SQL crudo)
 * canQuoteProcedurePrices / canQuoteOrthoPrices (whitelist). clinicId de
 * la sesión; nunca del body.
 *
 * Exige "whatsapp.send": lo que se guarda aquí (persona, saludo, FAQs) es
 * literalmente el texto que el bot le dice a pacientes reales desde el número
 * oficial de la clínica, y `canBookAppointments` lo autoriza a crear citas. Es
 * el mismo permiso de escritura de WhatsApp que ya tienen ADMIN, SUPER_ADMIN y
 * RECEPTIONIST por default; DOCTOR y READONLY no.
 */
export async function PATCH(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "whatsapp.send");
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Garantiza que exista la fila antes del update (idempotente).
  const actual = await getOrCreateBotConfig(ctx.clinicId);

  // Tope de tamaño de la persona (ws1-t5): no se recorta en silencio, se
  // rechaza con un mensaje que la pantalla muestra tal cual. Si la persona no
  // cambió (se guarda otro campo), pasa aunque sea larga.
  const errorPersona = errorDeTamanoDePersona(
    typeof body.persona === "string" ? body.persona : undefined,
    actual.persona,
  );
  if (errorPersona) {
    return NextResponse.json(
      { error: errorPersona, code: "persona_demasiado_larga", max: PERSONA_MAX_CARACTERES },
      { status: 400 },
    );
  }

  // ws1-t3 — interruptores de precios. Encender sin el SQL pegado se rechaza
  // ANTES de guardar nada (apagado no hace falta guardarlo: ya lo está).
  const precios = interruptoresDelBody(body);
  if ((precios.canQuoteProcedurePrices === true || precios.canQuoteOrthoPrices === true) && !(await columnasDePreciosExisten(true))) {
    return NextResponse.json(
      { error: "Dar precios por WhatsApp todavía no está activo en tu clínica.", code: "precios_sql_pendiente" },
      { status: 503 },
    );
  }

  const data = buildConfigUpdate(body);
  const updated = await prisma.whatsAppBotConfig.update({
    where: { clinicId: ctx.clinicId },
    data,
  });

  const guardado = await guardarInterruptoresDePrecios(ctx.clinicId, precios);
  // `"motivo" in`: con strict apagado, `!guardado.ok` no estrecha la unión.
  if ("motivo" in guardado) {
    return NextResponse.json(
      { error: "Se guardó la configuración, pero no los interruptores de precios. Vuelve a intentarlo.", code: "precios_no_guardados" },
      { status: guardado.motivo === "sin-columna" ? 503 : 500 },
    );
  }

  return NextResponse.json({ config: { ...toConfigDTO(updated), ...(await estadoDePreciosDelBot(ctx.clinicId)) } });
}
