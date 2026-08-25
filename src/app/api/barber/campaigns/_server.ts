// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — puerta común de las APIs de CAMPAÑAS.
//
// Reutiliza openAgendaGate: sesión → sede accesible → feature del plan →
// permiso del rol, en ese orden y con el barbershopId SIEMPRE saliendo de
// la sesión. No se inventa otro check.
//
// LA FEATURE ES `whatsappInbox` y no una nueva: ese es exactamente el
// conjunto "Avanzado y Profesional" que pide el contrato, ya existe en
// BARBER_FEATURES, ya está en las filas de barber_plan_configs de los dos
// planes y ya la usa la bandeja. Inventar una llave nueva habría dejado a
// TODAS las barberías fuera hasta correr un UPDATE sobre esa tabla, porque
// una llave que no está en el Json `features` se lee como false.
//
// SIN branchId a propósito: las listas y el envío salen de la barbería de
// la SESIÓN. Aceptar otra sede aquí mandaría los mensajes de una barbería
// con las credenciales de WhatsApp de otra.
// ═══════════════════════════════════════════════════════════════════════
import { openAgendaGate, jsonError, readJson, asString } from "../appointments/_server";
import type { BarberPermissionKey } from "@/lib/barber-auth";

export { jsonError, readJson, asString };

/** Avanzado y Profesional. El Básico NO entra a campañas. */
export const CAMPAIGNS_FEATURE = "whatsappInbox" as const;

export async function openCampaignsGate(permission: BarberPermissionKey) {
  return openAgendaGate({ permission, feature: CAMPAIGNS_FEATURE, branchId: null });
}
