/**
 * LA PUERTA DE /dashboard/settings PARA QUIEN SOLO VIENE A SU HORARIO.
 * WS1-T2 · horario.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL PROBLEMA
 *
 * `src/app/dashboard/settings/page.tsx` pide `settings.view`, y el rol DOCTOR
 * no la tiene: hoy un doctor que entra a Configuración rebota a
 * `/dashboard?denied=settings.view`. Pero su horario y sus bloqueos viven en
 * la pestaña «Horarios y bloqueos» de esa pantalla, así que sin abrir la
 * puerta no puede editarlos.
 *
 * 🔴 LO QUE NO SE PUEDE HACER: darle `settings.view`. Esa llave es TODA la
 * Configuración (la clínica, la facturación, las integraciones). El encargo es
 * abrirle UNA pestaña, no regalarle el resto.
 *
 * 🔴 LA DECISIÓN VIVE AQUÍ, NO EN LA PÁGINA. Se entra con `settings.view`
 * (todo, como hoy) **o** con `agenda.bloqueos` (solo la pestaña de horarios).
 * Quien no tiene ninguna de las dos sigue rebotando exactamente igual que hoy,
 * con el mismo `?denied=settings.view`.
 *
 * ⚠️ QUIÉN LA CONECTA: la página y la pantalla son de ws1-t3. Esta función
 * sustituye al `requirePermissionOrRedirect(user, "settings.view")` de
 * page.tsx, y la pantalla tiene que respetar `pestanas`. Las dos cosas van
 * JUNTAS: abrir la puerta sin recortar la pantalla le enseñaría al doctor
 * todas las pestañas que hoy decide `settings-client.tsx` por rol.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Pura: no toca la red, ni la base, ni `redirect`. Se prueba sin nada.
 */
import { hasPermission, type PermissionKey } from "@/lib/auth/permissions";

/** El id de la pestaña en `settings-client.tsx` (`?tab=horarios`). */
export const PESTANA_HORARIOS = "horarios";

/** La llave que abre la puerta estrecha. La misma que exige la API del horario. */
export const LLAVE_HORARIO: PermissionKey = "agenda.bloqueos";

export interface AccesoAjustes {
  /** ¿Pasa de la puerta? */
  entra: boolean;
  /** `true` = toda Configuración (`settings.view`), como hoy. */
  completo: boolean;
  /**
   * Las ÚNICAS pestañas que puede ver. `null` = todas (entra completo, o no
   * entra). Con acceso estrecho, solo `["horarios"]`.
   */
  pestanas: string[] | null;
  /**
   * La key que se reporta al rebotar (`/dashboard?denied=<key>`). Es
   * `settings.view` —la de siempre—, no la de horario: a quien no tiene
   * ninguna, la puerta le tiene que seguir diciendo lo mismo que hoy.
   */
  denegadoPor: PermissionKey | null;
}

export function accesoAAjustes(user: {
  role: string;
  permissionsOverride?: string[] | null;
}): AccesoAjustes {
  const u = { role: user.role, permissionsOverride: user.permissionsOverride ?? [] };
  if (hasPermission(u, "settings.view")) {
    return { entra: true, completo: true, pestanas: null, denegadoPor: null };
  }
  if (hasPermission(u, LLAVE_HORARIO)) {
    return { entra: true, completo: false, pestanas: [PESTANA_HORARIOS], denegadoPor: null };
  }
  return { entra: false, completo: false, pestanas: null, denegadoPor: "settings.view" };
}

/** A dónde se rebota a quien no entra. El mismo destino que `requirePermissionOrRedirect`. */
export function rutaDeRebote(acceso: AccesoAjustes): string | null {
  if (acceso.entra) return null;
  return `/dashboard?denied=${encodeURIComponent(acceso.denegadoPor ?? "settings.view")}`;
}

/**
 * La pestaña con la que arranca la pantalla. Con acceso estrecho, SIEMPRE la
 * de horarios: un `?tab=facturacion` en la URL no puede abrir otra cosa.
 */
export function pestanaInicial(acceso: AccesoAjustes, pedida: string | null | undefined): string | undefined {
  if (acceso.pestanas) {
    return pedida && acceso.pestanas.includes(pedida) ? pedida : acceso.pestanas[0];
  }
  return pedida ?? undefined;
}
