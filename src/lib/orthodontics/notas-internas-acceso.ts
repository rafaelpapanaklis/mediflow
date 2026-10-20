// Ortodoncia — «Notas internas»: ¿quién entra? PURO (sin Prisma ni React), con pruebas.
// Parte del módulo SOLO-EQUIPO (NOTAS_INTERNAS_SOLO_EQUIPO, ver ./notas-internas-service).
//
// Decisión de Rafael: las ve TODO el equipo que tiene acceso a pacientes (no solo quien lee el expediente
// clínico: la nota interna es de trato, no un dato clínico — «pidió que lo atienda el doctor X»). Por eso la
// llave NO es `medicalRecord.*`, sino la del paciente, más la llave del módulo de Ortodoncia (la misma que abre
// la pestaña):
//   · ver ...... `patients.view`  + `specialties.orthodontics`
//   · escribir . `patients.edit`  + `specialties.orthodontics` (corregir: además autor o admin, ver el servicio)
// La visibilidad del paciente restringido (`visibleUserIds`) la revisa la ruta con `assertPatientVisible`.

import { hasPermission } from "@/lib/auth/permissions";
import { tieneAccesoOrtodoncia } from "./acceso-doctor";

export type ModoNotasInternas = "ver" | "escribir";

interface Usuario {
  role: string;
  permissionsOverride?: string[] | null;
}

export function puedeNotasInternas(user: Usuario | null | undefined, modo: ModoNotasInternas): boolean {
  if (!user || typeof user.role !== "string") return false;
  const quien = { role: user.role, permissionsOverride: user.permissionsOverride ?? [] };
  const llave = modo === "ver" ? "patients.view" : "patients.edit";
  return hasPermission(quien, llave) && tieneAccesoOrtodoncia(quien);
}

export const MENSAJE_SIN_ACCESO_NOTAS_INTERNAS =
  "No tienes permiso para ver o escribir las notas internas de este paciente.";
