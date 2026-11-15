/**
 * Las fichas de barbero que se ofrecen al ligar a una persona del equipo
 * (Equipo → Dar de alta / Editar).
 *
 * Lógica de uso (L3, 15-nov): la lista mostraba TODAS las fichas, de todas
 * las sedes y aunque ya fueran de otra persona. En panel.108 tres usuarios
 * quedaron ligados a «Barbero Prueba Dos»: las citas y comisiones de esa
 * ficha se vuelven «suyas» de los tres. Y en Editar salían fichas de otra
 * sede que el servidor rechaza al guardar.
 *
 * - Solo las fichas de la sede de la persona (el servidor exige lo mismo).
 * - La que ya está ligada a OTRA persona activa se marca con su nombre:
 *   el dueño decide, pero lo ve antes de elegir.
 */

export interface FichaBarbero {
  id: string;
  name: string;
  barbershopId: string;
}

export interface MiembroLigado {
  id: string;
  firstName: string;
  lastName: string;
  barberId: string | null;
  isActive: boolean;
}

export interface OpcionFicha {
  id: string;
  name: string;
  /** Nombre de la otra persona activa que ya tiene esta ficha; null si está libre. */
  ligadaA: string | null;
}

export function opcionesDeFicha(
  barberos: FichaBarbero[],
  miembros: MiembroLigado[],
  {
    barbershopId,
    miembroId,
    actual,
  }: { barbershopId: string; miembroId?: string | null; actual?: string | null },
): OpcionFicha[] {
  const duenoDe = new Map<string, string>();
  for (const m of miembros) {
    if (!m.isActive || !m.barberId || m.id === miembroId) continue;
    if (!duenoDe.has(m.barberId)) duenoDe.set(m.barberId, `${m.firstName} ${m.lastName}`.trim());
  }
  return barberos
    // La ficha que ya tiene se queda aunque sea de otra sede (dato viejo): si no,
    // el select la pinta vacía y al guardar se desligaría sin que nadie lo pidiera.
    .filter((b) => b.barbershopId === barbershopId || (actual && b.id === actual))
    .map((b) => ({ id: b.id, name: b.name, ligadaA: duenoDe.get(b.id) ?? null }));
}
