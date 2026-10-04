// Reserva web pública (/reservar/<slug>, mini-webs y directorio): textos y la regla de «¿cabe el procedimiento
// en el hueco?» (ws1-t1, ronda de arreglos de la auditoría de uso — C-100). Puro: lo usa
// `src/app/[slug]/_shared/booking-flow.tsx` y lo prueban sin React.
//
// LO QUE CIERRA:
//   · «Lunes, 5 De Octubre»: la clase CSS `capitalize` subía TODAS las palabras. Ahora solo la primera letra.
//   · «Dr/a. Dr Importado…»: un doctor cuyo nombre ya trae «Dr»/«Dra» salía con el título dos veces.
//   · El horario se elige ANTES del procedimiento y nada comprobaba que un implante de 90 min cupiera en el hueco
//     de las 10:00: ahora el procedimiento que no cabe a esa hora se dice («No cabe a las 10:00…») y no se elige.
//   · «Valoración de ortodoncia» salía sin precio mientras los demás sí: se dice «Precio a confirmar en la
//     clínica» en vez de dejar el hueco (no se inventa un precio; decisión 15).

/** «lunes, 5 de octubre» → «Lunes, 5 de octubre». */
export function fechaLargaReserva(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return "";
  const t = new Date(y, m - 1, d).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** «Dr/a. Ana López», salvo que el nombre ya traiga el título («Dr Importado» → «Dr Importado …»). */
export function nombreDoctorReserva(d: { firstName?: string | null; lastName?: string | null }): string {
  const nombre = [d.firstName, d.lastName].filter(Boolean).join(" ").trim();
  if (/^(dr|dra|dr\/a)\.?(\s|$)/i.test(nombre)) return nombre;
  return `Dr/a. ${nombre}`;
}

function aMin(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function aHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/**
 * ¿Cabe un procedimiento de `duracionMin` empezando a `inicio`? Cada tramo de `paso` minutos desde el inicio tiene
 * que estar libre. Con «cualquier doctor» (`doctoresPorHueco`), además tiene que haber UN mismo doctor libre en
 * todos los tramos. Sin duración conocida, cabe (no se sabe y no se bloquea).
 */
export function cabeElServicio(
  inicio: string,
  duracionMin: number | null | undefined,
  libres: string[],
  doctoresPorHueco?: Record<string, string[]> | null,
  paso = 30,
): boolean {
  const ini = aMin(inicio);
  if (ini === null || !duracionMin || duracionMin <= paso) return true;
  const set = new Set(libres);
  let comunes: Set<string> | null = doctoresPorHueco ? new Set(doctoresPorHueco[inicio] ?? []) : null;
  for (let t = ini; t < ini + duracionMin; t += paso) {
    const h = aHHMM(t);
    if (!set.has(h)) return false;
    if (comunes && doctoresPorHueco) {
      const aqui = new Set(doctoresPorHueco[h] ?? []);
      comunes = new Set(Array.from(comunes).filter((id) => aqui.has(id)));
      if (comunes.size === 0) return false;
    }
  }
  return true;
}

export function textoNoCabe(inicio: string, duracionMin: number): string {
  return `No cabe a las ${inicio}: dura ${duracionMin} min. Elige otra hora.`;
}

/** La línea de precio y duración de un procedimiento; sin precio, cuando otros sí lo tienen, se dice. */
export function lineaDePrecio(
  s: { price?: string | null; durationMin?: number | null },
  otrosTienenPrecio: boolean,
): string | null {
  const precio = s.price || (otrosTienenPrecio ? "Precio a confirmar en la clínica" : null);
  const partes = [precio, s.durationMin ? `${s.durationMin} min` : null].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}
