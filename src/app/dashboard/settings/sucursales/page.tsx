export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getOwnedBranches, listPatientLinks } from "@/lib/branches";
import { SucursalesClient } from "./sucursales-client";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";

export const metadata: Metadata = { title: "Sucursales — DaleControl" };

/**
 * /dashboard/settings/sucursales — MULTI-CLÍNICA · FASE 2.
 *
 * El dueño ve todas sus sedes y decide, PAR POR PAR, cuáles comparten el
 * expediente de sus pacientes. Sin transitividad: marcar A↔B y B↔C no hace
 * que A vea a los de C.
 *
 * Sólo SUPER_ADMIN: un ADMIN de sede no puede abrirle el expediente de su
 * sucursal a otra. El guard se repite en la API (GET/POST/DELETE de
 * /api/clinics/links) — esta página es sólo la primera puerta.
 */
export default async function SucursalesSettingsPage() {
  const user = await getCurrentUser();
  if (user.role !== "SUPER_ADMIN") redirect("/dashboard");

  // REDISEÑO (ws1-t2): el MISMO interruptor `menu-dos-niveles` de la clínica,
  // junto a las sedes (ni una consulta más; falla cerrado → false = la
  // pantalla de siempre). Los vínculos siguen esperando a las sedes: dependen
  // de ellas.
  const [branches, rediseno] = await Promise.all([
    getOwnedBranches(user.supabaseId),
    menuDosNivelesEncendido(user.clinicId),
  ]);
  const links = await listPatientLinks(branches.map((b) => b.clinicId));

  return (
    // key por clínica: si el dueño cambia de sede con el switcher, la vista se
    // re-monta en vez de conservar el estado de la anterior.
    <SucursalesClient
      key={user.clinicId}
      branches={branches}
      initialLinks={links}
      activeClinicId={user.clinicId}
      rediseno={rediseno}
    />
  );
}
