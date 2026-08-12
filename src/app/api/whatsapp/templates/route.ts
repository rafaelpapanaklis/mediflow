// Plantillas aprobadas de WhatsApp por clínica (M-09).
//
// La clínica registra aquí, por cada tipo de mensaje, el NOMBRE EXACTO con el
// que Meta le aprobó la plantilla y su idioma. Sin esto, un aviso automático
// fuera de la ventana de 24 h no puede salir (lib/whatsapp/send-mode.ts).
//
// Multi-tenant: se escribe SIEMPRE sobre la clínica de la sesión; el body no
// puede elegir clínica.

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import {
  WA_TEMPLATE_SPECS,
  isValidTemplateLang,
  isValidTemplateName,
  parseWaTemplates,
  type WaTemplateMap,
} from "@/lib/whatsapp/template-config";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const ctx = await getAuthContext();
  const user = ctx?.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Mismo permiso que el resto de escrituras de WhatsApp (bot, conexión).
  const denied = denyIfMissingPermission(user, "whatsapp.send");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const incoming = (body as { templates?: unknown }).templates;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  // Se valida campo a campo para poder decir QUÉ está mal. `parseWaTemplates`
  // descarta en silencio (es lo correcto al leer de la BD), pero al guardar la
  // clínica necesita enterarse de que su nombre no es válido en vez de creer
  // que quedó registrado y descubrirlo cuando un recordatorio no salga.
  const clean: WaTemplateMap = {};
  const errors: Array<{ kind: string; field: "name" | "lang"; message: string }> = [];

  for (const spec of WA_TEMPLATE_SPECS) {
    const entry = (incoming as Record<string, unknown>)[spec.kind];
    if (entry === undefined || entry === null) continue;
    if (typeof entry !== "object") {
      errors.push({ kind: spec.kind, field: "name", message: "Formato inválido." });
      continue;
    }
    const rawName = (entry as Record<string, unknown>).name;
    const rawLang = (entry as Record<string, unknown>).lang;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const lang = typeof rawLang === "string" ? rawLang.trim() : "";

    // Vaciar los dos campos = borrar la plantilla de ese tipo (válido).
    if (name === "" && lang === "") continue;

    if (!isValidTemplateName(name)) {
      errors.push({
        kind: spec.kind,
        field: "name",
        message:
          "El nombre debe ser el de Meta: solo minúsculas, números y guion bajo (ej. recordatorio_cita).",
      });
      continue;
    }
    if (!isValidTemplateLang(lang)) {
      errors.push({
        kind: spec.kind,
        field: "lang",
        message: "El idioma debe tener el formato de Meta: es, es_MX, en_US…",
      });
      continue;
    }
    clean[spec.kind] = { name, lang };
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: "invalid_templates", errors }, { status: 400 });
  }

  const updated = await prisma.clinic.update({
    where: { id: user.clinicId },
    // El cast es estructural, no una evasión: `clean` solo contiene strings
    // que acaban de validarse arriba, pero WaTemplateMap declara claves fijas
    // y el Json de entrada de Prisma pide índice de cadena.
    data: { waTemplates: clean as unknown as Prisma.InputJsonObject },
    select: { waTemplates: true, waBillingOk: true },
  });

  // Se devuelve lo PARSEADO, no la fila: es exactamente lo que la pantalla
  // necesita y no arrastra ningún otro campo de la clínica al navegador.
  return NextResponse.json({
    templates: parseWaTemplates(updated.waTemplates),
    billingOk: updated.waBillingOk,
  });
}
