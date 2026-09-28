// Ortodoncia — Ola 0 (ws1-t1): layout del módulo con su propio SUBMENÚ
// (Tablero · Pacientes en tratamiento · Cobranza de mensualidades ·
// Controles/agenda · Alertas · Configuración — decisión de Rafael) y la
// guarda de módulo para las seis páginas de abajo.
//
// Sin el módulo contratado, NINGUNA existe: redirect a /dashboard, igual
// que hoy /dashboard/specialties/orthodontics con un módulo vencido.
//
// El guardia usa `hasActiveOrthodonticsModule` (ClinicModule real, SIN el
// atajo de trial de `canAccessModule`/`evaluateAccess`) — ver ese archivo
// para el porqué exacto (Rafael quiere ver el módulo en su propia clínica
// de prueba, que ya lo tiene contratado de verdad, sin que aparezca en el
// resto de clínicas dentales solo por estar en trial). Si la parte «Acceso
// y permisos» (A1, Ola 1) decide compartir un único guardia para todo el
// marketplace, este archivo es lo único que hay que tocar aquí.
//
// 28-sep-2026 (ws1-t3, decisión de Rafael): quien NO tiene el módulo ya no
// rebota a /dashboard sin explicación; va a la página de contratar
// (/dashboard/orthodontics/contratar), que vive dentro de esta misma ruta.
// Esa página se pinta SIN submenú: no hay módulo que recorrer. La decisión
// entera está en `decidirEntradaAlModulo` (src/lib/orthodontics/contratar.ts),
// pura y con tests; aquí solo se le dan los datos.
export const dynamic = "force-dynamic";

import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { hasPermission } from "@/lib/auth/permissions";
import {
  COOKIE_VISTA_PREVIA_SIN_MODULO,
  decidirEntradaAlModulo,
  moduloActivoALaVista,
  vistaPreviaSinModulo,
} from "@/lib/orthodontics/contratar";
import { RaizModulo } from "@/components/specialties/orthodontics/modulo/piezas";
import { SubmenuOrtodoncia } from "@/components/specialties/orthodontics/modulo/submenu";

const SUBMENU = [
  { href: "/dashboard/orthodontics/tablero", label: "Tablero" },
  { href: "/dashboard/orthodontics/pacientes", label: "Pacientes en tratamiento" },
  { href: "/dashboard/orthodontics/cobranza", label: "Cobranza de mensualidades" },
  { href: "/dashboard/orthodontics/controles", label: "Controles / agenda" },
  { href: "/dashboard/orthodontics/alertas", label: "Alertas" },
  { href: "/dashboard/orthodontics/configuracion", label: "Configuración" },
] as const;

export default async function OrthodonticsModuleLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();
  const active = await hasActiveOrthodonticsModule(user.clinicId);
  // La vista previa «sin módulo» solo puede QUITAR el acceso a la vista, nunca
  // darlo, y en producción se ignora.
  const moduloActivo = moduloActivoALaVista(
    active,
    vistaPreviaSinModulo({
      nodeEnv: process.env.NODE_ENV,
      cookie: cookies().get(COOKIE_VISTA_PREVIA_SIN_MODULO)?.value,
    }),
  );

  const entrada = decidirEntradaAlModulo({
    esDental: user.clinic.category === "DENTAL",
    // P3 (Ola 1, ws1-t3): "specialties.orthodontics" es el permiso UI del
    // módulo — sin él (por ejemplo, alguien a quien la clínica se lo quitó
    // desde Equipo → Permisos) tampoco entra por URL directa.
    tienePermiso: hasPermission(
      { role: user.role, permissionsOverride: user.permissionsOverride },
      "specialties.orthodontics",
    ),
    moduloActivo,
    // La pone el middleware en toda ruta de /dashboard (la misma cabecera que
    // usa el layout del panel para sus barreras).
    pathname: headers().get("x-pathname"),
  });
  if (entrada.tipo === "redirigir") redirect(entrada.a);

  // Diseño (ws1-t3): la raíz del módulo trae los tokens y la tipografía del
  // rediseño; el submenú marca el apartado abierto y se queda pegado arriba.
  return (
    <RaizModulo>
      {entrada.tipo === "modulo" && <SubmenuOrtodoncia apartados={SUBMENU} />}
      {children}
    </RaizModulo>
  );
}
