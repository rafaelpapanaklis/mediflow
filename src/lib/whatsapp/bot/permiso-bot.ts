// Quién ve y quién cambia la configuración del bot de WhatsApp (ws1-t1, ronda de arreglos de la auditoría de
// uso — C-103).
//
// Decisión 12 de Rafael (ronda de arreglos): el bot, como hoy — verlo pide «Ver WhatsApp» (lo mismo que la
// página /dashboard/whatsapp/bot) y cambiarlo pide «Enviar WhatsApp» (recepción, dueño y admin lo tienen de
// fábrica; doctor y solo lectura no). No hay un permiso propio «Configurar bot».
//
// EL FALLO QUE CIERRA: `GET /api/whatsapp/bot` contestaba 200 (persona, saludo y FAQs) a quien la página saca
// con `?denied=`, y el 403 del guardado decía «No tienes permiso para «Enviar WhatsApp»» a alguien que solo
// quería configurar el bot, sin decir por qué ese permiso.

import { NextResponse } from "next/server";
import { hasPermission, type PermissionKey } from "@/lib/auth/permissions";

type UsuarioConPermisos = { role: string; permissionsOverride?: string[] | null };

export const TEXTO_SIN_PERMISO_VER_BOT =
  "No tienes acceso a la configuración del bot de WhatsApp: pide el permiso «Ver WhatsApp» al dueño de la clínica.";
export const TEXTO_SIN_PERMISO_EDITAR_BOT =
  "Cambiar el bot pide el permiso «Enviar WhatsApp», porque lo que se guarda aquí es lo que el bot les dice a los pacientes desde el número de la clínica. Pídeselo al dueño.";

/** 403 con un texto que dice QUÉ permiso falta y por qué, o null si puede. */
export function denegarBot(usuario: UsuarioConPermisos, accion: "ver" | "editar"): NextResponse | null {
  const permiso: PermissionKey = accion === "ver" ? "whatsapp.view" : "whatsapp.send";
  const puede = hasPermission({ role: usuario.role, permissionsOverride: usuario.permissionsOverride ?? [] }, permiso);
  if (puede) return null;
  return NextResponse.json(
    { error: accion === "ver" ? TEXTO_SIN_PERMISO_VER_BOT : TEXTO_SIN_PERMISO_EDITAR_BOT, permiso },
    { status: 403 },
  );
}
