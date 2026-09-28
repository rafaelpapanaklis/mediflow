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
// (/dashboard/contratar/ortodoncia). Esa página vive FUERA de esta ruta a
// propósito: este guardia está en un layout, y un layout no se vuelve a
// ejecutar al navegar entre las páginas que cuelgan de él. Así, para quien no
// tiene el módulo este layout no llega a montarse. El guardia es
// `exigirModuloOrtodoncia` (src/lib/orthodontics/exigir-modulo.ts), que además
// corre en cada página; la decisión es `decidirEntradaAlModulo`, pura y con tests.
export const dynamic = "force-dynamic";

import type { ReactNode } from "react";
import { exigirModuloOrtodoncia } from "@/lib/orthodontics/exigir-modulo";
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
  // El mismo guardia que corre en cada página del módulo (ver exigir-modulo.ts
  // para por qué en los dos sitios).
  await exigirModuloOrtodoncia();

  // Diseño (ws1-t3): la raíz del módulo trae los tokens y la tipografía del
  // rediseño; el submenú marca el apartado abierto y se queda pegado arriba.
  return (
    <RaizModulo>
      <SubmenuOrtodoncia apartados={SUBMENU} />
      {children}
    </RaizModulo>
  );
}
