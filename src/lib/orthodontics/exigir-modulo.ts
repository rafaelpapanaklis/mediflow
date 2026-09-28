import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { hasActiveOrthodonticsModule } from "./access";
import {
  COOKIE_VISTA_PREVIA_SIN_MODULO,
  decidirEntradaAlModulo,
  moduloActivoALaVista,
  vistaPreviaSinModulo,
} from "./contratar";

/**
 * El guardia del módulo de Ortodoncia (ws1-t3, 28-sep-2026): clínica dental,
 * permiso `specialties.orthodontics` y módulo contratado de verdad. Si algo
 * falta, REDIRIGE (a /dashboard o a la página de contratar) y no vuelve.
 *
 * Lo llaman el layout de /dashboard/orthodontics Y cada una de sus páginas.
 * Las dos cosas, a propósito: en Next un layout no se vuelve a ejecutar al
 * navegar entre las páginas que cuelgan de él, así que un guardia que viva
 * SOLO en el layout no ve lo que pasa después de la primera entrada (que el
 * módulo venza con la pestaña abierta, o una petición hecha a mano que diga
 * que el layout ya está montado). La página sí se ejecuta en cada visita.
 *
 * `cache` de React: en una misma petición, layout y página comparten la
 * respuesta; no son dos viajes a la base. El `clinicId` sale de la sesión.
 */
export const exigirModuloOrtodoncia = cache(async (): Promise<void> => {
  const user = await getCurrentUser();
  const real = await hasActiveOrthodonticsModule(user.clinicId);
  // La vista previa «sin módulo» solo puede QUITAR el acceso a la vista, nunca
  // darlo, y en producción se ignora.
  const moduloActivo = moduloActivoALaVista(
    real,
    vistaPreviaSinModulo({
      nodeEnv: process.env.NODE_ENV,
      cookie: cookies().get(COOKIE_VISTA_PREVIA_SIN_MODULO)?.value,
    }),
  );
  const entrada = decidirEntradaAlModulo({
    esDental: user.clinic.category === "DENTAL",
    // "specialties.orthodontics" es el permiso UI del módulo: sin él (por
    // ejemplo, alguien a quien la clínica se lo quitó desde Equipo →
    // Permisos) tampoco entra por URL directa.
    tienePermiso: hasPermission(
      { role: user.role, permissionsOverride: user.permissionsOverride },
      "specialties.orthodontics",
    ),
    moduloActivo,
  });
  if (entrada.tipo === "redirigir") redirect(entrada.a);
});
