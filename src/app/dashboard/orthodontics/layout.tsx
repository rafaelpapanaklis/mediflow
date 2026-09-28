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
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { hasPermission } from "@/lib/auth/permissions";

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <nav
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          borderBottom: "1px solid var(--border-soft)",
          paddingBottom: 12,
        }}
      >
        {SUBMENU.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-2)",
              background: "var(--bg-elev-2)",
            }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
