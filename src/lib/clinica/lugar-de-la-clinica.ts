// ─────────────────────────────────────────────────────────────────────────────
// En qué ciudad está la clínica, para los documentos (auditoría de uso, C-60 y C-61).
//
// La constancia de asistencia decía «en Mérida» y la carta de consentimiento
// «Lugar y fecha: Mérida» con «Dirección: Av. Insurgentes Sur 1234 … 03100
// Ciudad de México, CDMX». La clínica tenía «Mérida» en el campo ciudad y la
// dirección completa de CDMX: los documentos tomaban el campo ciudad a ciegas.
//
// Regla: la DIRECCIÓN manda cuando trae su código postal seguido de la ciudad
// («03100 Ciudad de México, CDMX») y el campo ciudad no aparece en ella. Si la
// dirección no dice ciudad (o dice la misma), se usa el campo ciudad de siempre.
// Nada se escribe en la base: se decide qué imprimir, y se avisa de la
// contradicción para que la clínica la corrija.
//
// PURO: sin Prisma ni React.
// ─────────────────────────────────────────────────────────────────────────────

function normalizar(t: string): string {
  return (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.\s]+/g, " ").trim();
}

/** «CDMX», «Cd. de México», «Ciudad de México», «México D.F.» son el mismo lugar. */
function esCdmx(n: string): boolean {
  return ["cdmx", "cd mx", "ciudad de mexico", "cd de mexico", "mexico df", "df", "d f", "distrito federal"].includes(n);
}

function mismoLugar(a: string, b: string): boolean {
  const x = normalizar(a);
  const y = normalizar(b);
  return x === y || (esCdmx(x) && esCdmx(y));
}

/** La ciudad (y el estado, si viene) que sigue al código postal: «… 03100 Ciudad de México, CDMX». */
export function ciudadDeLaDireccion(direccion: string | null | undefined): { ciudad: string; estado: string | null } | null {
  const d = (direccion ?? "").trim();
  if (!d) return null;
  // El ÚLTIMO código postal de 5 dígitos (un número exterior de 5 cifras va antes) y lo que le sigue.
  const cps = [...d.matchAll(/(?<![\d#])(\d{5})(?!\d)/g)];
  const ultimo = cps.pop();
  if (!ultimo || ultimo.index === undefined) return null;
  const resto = d.slice(ultimo.index + 5).replace(/^[\s,]+/, "");
  const [ciudadCruda, estadoCrudo] = resto.split(",").map((x) => x.trim());
  const limpiar = (x: string | undefined) => (x ?? "").replace(/[.;]+$/, "").trim();
  const ciudad = limpiar(ciudadCruda);
  const estado = limpiar(estadoCrudo) || null;
  if (!ciudad || ciudad.length < 3 || /^\d/.test(ciudad)) return null;
  return { ciudad, estado };
}

export interface LugarDeLaClinica {
  /** Lo que se imprime en «Lugar y fecha», «en <lugar>», etc. Vacío si no se sabe. */
  lugar: string;
  /** La ciudad sola (sin estado), para quien la pega a la dirección. */
  ciudad: string;
  /** El campo ciudad dice otra cosa que la dirección: la clínica debería corregirlo. */
  contradice: boolean;
}

export function lugarDeLaClinica(c: { ciudad?: string | null; estado?: string | null; direccion?: string | null }): LugarDeLaClinica {
  const campoCiudad = (c.ciudad ?? "").trim();
  const campoEstado = (c.estado ?? "").trim();
  const deLaDireccion = ciudadDeLaDireccion(c.direccion);
  const direccionN = normalizar(c.direccion ?? "");

  if (deLaDireccion) {
    const coincide = !campoCiudad || mismoLugar(campoCiudad, deLaDireccion.ciudad) || direccionN.includes(normalizar(campoCiudad));
    if (!coincide) {
      const estado = deLaDireccion.estado && !mismoLugar(deLaDireccion.estado, deLaDireccion.ciudad) ? deLaDireccion.estado : null;
      return { lugar: [deLaDireccion.ciudad, estado].filter(Boolean).join(", "), ciudad: deLaDireccion.ciudad, contradice: true };
    }
  }
  const ciudad = campoCiudad || deLaDireccion?.ciudad || "";
  const estadoBase = campoEstado || (!campoCiudad ? deLaDireccion?.estado ?? "" : "");
  const estado = estadoBase && !mismoLugar(estadoBase, ciudad) ? estadoBase : "";
  return { lugar: [ciudad, estado].filter(Boolean).join(", "), ciudad, contradice: false };
}

/** ¿La dirección ya dice esa ciudad? Entonces no se le pega otra vez («…, CDMX, Ciudad de México»). */
export function direccionYaDiceLaCiudad(direccion: string | null | undefined, ciudad: string | null | undefined): boolean {
  const c = normalizar(ciudad ?? "");
  if (!c) return true;
  const d = normalizar(direccion ?? "");
  if (d.includes(c)) return true;
  return esCdmx(c) && ["cdmx", "ciudad de mexico", "cd de mexico", "mexico df"].some((x) => d.includes(x));
}
