// ─────────────────────────────────────────────────────────────────────────────
// Ciudad de la clínica y especialidad del doctor en la carta de consentimiento (auditoría de uso, C-61).
//
//   · «Lugar y fecha: Mérida» con «Dirección: … 03100 Ciudad de México, CDMX»: la ciudad sale de
//     `lugarDeLaClinica` (la dirección manda si el campo ciudad la contradice), la misma regla que la
//     constancia de asistencia.
//   · «Especialidad: ____» aunque el doctor la tiene: la carta solo leía `User.especialidad` (la «oficial»),
//     y «Mi perfil»/Equipo guardan la del selector en `User.specialty`. Si la oficial está vacía, se usa la
//     del selector — solo si es un valor de la lista de Equipo (o un sinónimo conocido: «orthodontics» →
//     «Ortodoncia»); «Otra» o un texto que no se reconoce no se imprimen como especialidad.
//
// PURO: sin Prisma ni React.
// ─────────────────────────────────────────────────────────────────────────────

import { lugarDeLaClinica } from "@/lib/clinica/lugar-de-la-clinica";
import { esDeLaLista, especialidadParaElSelector } from "@/lib/team/especialidad-equipo";

/** La ciudad que va en «Lugar y fecha» y junto a la dirección; null si no se sabe. */
export function ciudadParaCarta(clinica: { city?: string | null; address?: string | null } | null | undefined): string | null {
  if (!clinica) return null;
  return lugarDeLaClinica({ ciudad: clinica.city, direccion: clinica.address }).ciudad || null;
}

/** La especialidad que se imprime: la oficial; si falta, la de Equipo/Mi perfil cuando es de la lista. */
export function especialidadParaCarta(doctor: { especialidad?: string | null; specialty?: string | null } | null | undefined): string | null {
  if (!doctor) return null;
  const oficial = (doctor.especialidad ?? "").trim();
  if (oficial) return oficial;
  const leida = especialidadParaElSelector(doctor.specialty);
  return leida && leida !== "Otra" && esDeLaLista(leida) ? leida : null;
}
