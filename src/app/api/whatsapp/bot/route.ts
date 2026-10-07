import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denegarBot } from "@/lib/whatsapp/bot/permiso-bot";
import { prisma } from "@/lib/prisma";
import { getOrCreateBotConfig, toConfigDTO, toFaqDTO, buildConfigUpdate } from "./service";
import { errorDeTamanoDePersona, PERSONA_MAX_CARACTERES } from "@/lib/whatsapp/bot/ai-prompt";
import {
  columnasDePreciosExisten,
  estadoDePreciosDelBot,
  guardarInterruptoresDePrecios,
  interruptoresDelBody,
} from "@/lib/whatsapp/bot/precios-bot";
import {
  columnaGenericasExiste,
  guardarGenericas,
  leerGenericas,
  nombresMarcados,
} from "@/lib/whatsapp/bot/servicios-agendables-db";
import { normalizarGenericas, type GenericasBot } from "@/lib/whatsapp/bot/menu-agenda-core";

export const dynamic = "force-dynamic";

/** ws1-t9 — lo de «Servicios al agendar» que la pantalla pinta: casillas genéricas + procedimientos marcados (solo lectura). */
async function estadoServiciosAgenda(clinicId: string): Promise<{
  botGenericas: GenericasBot;
  genericasDisponible: boolean;
  procedimientosAgendables: string[];
}> {
  const [botGenericas, genericasDisponible, procedimientosAgendables] = await Promise.all([
    leerGenericas(clinicId),
    columnaGenericasExiste(),
    nombresMarcados(clinicId).catch(() => [] as string[]),
  ]);
  return { botGenericas, genericasDisponible, procedimientosAgendables };
}

/**
 * GET /api/whatsapp/bot
 * Config del bot de la clínica de sesión (se crea con defaults si no existe) +
 * sus FAQs ordenadas. Multi-tenant: clinicId SIEMPRE de la sesión.
 */
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // ws1-t1 (C-103): lo mismo que la página (whatsapp.view). Antes daba 200 a quien la página saca.
  const sinVer = denegarBot(ctx, "ver");
  if (sinVer) return sinVer;

  const config = await getOrCreateBotConfig(ctx.clinicId);
  const faqs = await prisma.whatsAppBotFaq.findMany({
    where: { clinicId: ctx.clinicId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });

  // ws1-t3 — los dos interruptores de precios (SQL crudo, tolerante a que
  // la columna aún no exista: apagados).
  const precios = await estadoDePreciosDelBot(ctx.clinicId);

  return NextResponse.json({
    config: { ...toConfigDTO(config), ...precios, ...(await estadoServiciosAgenda(ctx.clinicId)) },
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
  const denied = denegarBot(ctx, "editar");
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

  // ws1-t9 — casillas genéricas de «Servicios al agendar». Sin el SQL pegado, dejarlas como están
  // (todas activas) no hace falta guardarlo; cambiarlas se rechaza ANTES de guardar nada.
  const genericasPedidas =
    body.botGenericas && typeof body.botGenericas === "object" ? normalizarGenericas(body.botGenericas) : null;
  if (genericasPedidas && !(await columnaGenericasExiste(true))) {
    const sinCambio = genericasPedidas.consulta && genericasPedidas.limpieza && genericasPedidas.urgencia;
    if (!sinCambio) {
      return NextResponse.json(
        { error: "Elegir los servicios al agendar todavía no está activo en tu clínica.", code: "genericas_sql_pendiente" },
        { status: 503 },
      );
    }
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

  if (genericasPedidas && (await columnaGenericasExiste())) {
    const g = await guardarGenericas(ctx.clinicId, genericasPedidas);
    if ("motivo" in g) {
      return NextResponse.json(
        { error: "Se guardó la configuración, pero no los servicios al agendar. Vuelve a intentarlo.", code: "genericas_no_guardadas" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    config: { ...toConfigDTO(updated), ...(await estadoDePreciosDelBot(ctx.clinicId)), ...(await estadoServiciosAgenda(ctx.clinicId)) },
  });
}
