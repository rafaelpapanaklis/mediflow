/**
 * El contexto y el error de los bloqueos, en un módulo SIN prisma.
 *
 * Existe solo para romper un ciclo: `ruta.server.ts` necesita el tipo
 * `BloqueoCtx` y la clase `BloqueoError`, y `service.ts` —que es quien los
 * usa de verdad— importa prisma. Con el tipo aquí, la ruta no arrastra el
 * servicio solo para tipar su contexto.
 */
import type { Role } from "@prisma/client";
import type { ClinicSession } from "@/lib/agenda/api-helpers";
import { hasPermission } from "@/lib/auth/permissions";

export { BloqueoError } from "./core";

/**
 * Quién pide. Sale SIEMPRE de la sesión (`loadClinicSession`), nunca del
 * cuerpo de la petición.
 */
export interface BloqueoCtx {
  clinicId: string;
  userId: string;
  role: Role;
  /** Nombre para congelar en `createdByName`. */
  displayName: string;
  timezone: string;
  /** `agenda.bloqueos` concedido. */
  puedeGestionar: boolean;
}

/**
 * La sesión convertida en contexto, SIN comprobar permisos.
 *
 * Lo usan `contextoDeBloqueos` (que además gatea) y el GET de
 * `/api/appointments`, que adjunta los bloqueos al payload de la agenda y ya
 * tiene su propio gate. Está escrito UNA vez porque el `clinicId` y el rol
 * tienen que salir de la sesión siempre y de la misma forma: dos
 * construcciones paralelas son dos sitios donde se puede colar el `clinicId`
 * del cuerpo de la petición.
 *
 * ⚠️ Vive en este módulo, y no en `ruta.server.ts`, porque aquel lleva
 * `import "server-only"` y el GET de la agenda se prueba con `tsx --test` y
 * mocks de módulo, donde ese paquete no se resuelve. `ClinicSession` entra
 * como `import type`, que se borra en tiempo de ejecución: traerla no
 * arrastra el `server-only` de `api-helpers`.
 */
export function ctxDeSesion(session: ClinicSession): BloqueoCtx {
  return {
    clinicId: session.clinic.id,
    userId: session.user.id,
    role: session.user.role,
    displayName: session.user.displayName,
    timezone: session.clinic.timezone,
    puedeGestionar: hasPermission(
      {
        role: session.user.role,
        permissionsOverride: session.user.permissionsOverride ?? [],
      },
      "agenda.bloqueos",
    ),
  };
}
