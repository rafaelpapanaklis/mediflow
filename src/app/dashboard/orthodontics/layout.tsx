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
export const dynamic = "force-dynamic";

import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { hasPermission } from "@/lib/auth/permissions";
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
  if (user.clinic.category !== "DENTAL") redirect("/dashboard");
  const active = await hasActiveOrthodonticsModule(user.clinicId);
  if (!active) redirect("/dashboard");
  // P3 (Ola 1, ws1-t3): "specialties.orthodontics" es el permiso UI del
  // módulo — sin él (por ejemplo, alguien a quien la clínica se lo quitó
  // desde Equipo → Permisos) tampoco entra por URL directa.
  if (!hasPermission({ role: user.role, permissionsOverride: user.permissionsOverride }, "specialties.orthodontics")) {
    redirect("/dashboard");
  }

  // Diseño (ws1-t3): la raíz del módulo trae los tokens y la tipografía del
  // rediseño; el submenú marca el apartado abierto y se queda pegado arriba.
  return (
    <RaizModulo>
      <SubmenuOrtodoncia apartados={SUBMENU} />
      {children}
    </RaizModulo>
  );
}
