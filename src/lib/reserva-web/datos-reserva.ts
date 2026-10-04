// Lo que la reserva web pública necesita además de la mini-web (ws1-t1, tercera ronda — N-39 y N-40). Puro.
//
// N-40 · PRECIOS: los servicios de la reserva se teclean a mano en Página web › Servicios («Desde $2,500») y no
// coincidían con el tarifario (Blanqueamiento $3,500). Decisión de Rafael (tercera ronda): los precios salen del
// CATÁLOGO DE PROCEDIMIENTOS; si un servicio no está ligado a ninguno (por nombre, sin acentos ni mayúsculas),
// queda como hoy. Varios procedimientos con el mismo nombre y precios distintos → «Desde $X» (el menor). Ronda final:
// también por familia («Ortodoncia» → «Desde» el menor de «Ortodoncia …») y en singular («Implantes»).
//
// N-39 · AVISOS: la reserva prometía «te confirma por WhatsApp» aunque la clínica no tuviera WhatsApp conectado.
// Decisión: sin WhatsApp no se promete ningún aviso por WhatsApp; se dice que la clínica llama al teléfono que deje.

export function normalizarNombreServicio(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function pesos(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

/**
 * { nombreNormalizado: «$3,500» | «Desde $600» } a partir del catálogo activo. Los de $0 no ponen precio.
 *
 * ws1-t1 (ronda final, N-40): además de los nombres exactos, cada FAMILIA. «Ortodoncia» no existe en el tarifario,
 * pero «Ortodoncia brackets» ($25,000) e «Ortodoncia invisible» ($45,000) sí: el servicio de la página se queda con
 * «Desde $25,000». La familia es el comienzo del nombre del procedimiento, palabra completa («ortodoncia …»), y se
 * guarda con la clave `familia:<nombre>`. Lo exacto manda sobre la familia.
 */
export function preciosDelCatalogo(procedimientos: Array<{ name: string; basePrice: number | null }>): Record<string, string> {
  const porNombre = new Map<string, number[]>();
  for (const p of procedimientos) {
    if (!p.name || !(typeof p.basePrice === "number") || !(p.basePrice > 0)) continue;
    const k = normalizarNombreServicio(p.name);
    porNombre.set(k, [...(porNombre.get(k) ?? []), p.basePrice]);
  }
  const out: Record<string, string> = {};
  const porFamilia = new Map<string, number>();
  for (const [k, precios] of Array.from(porNombre.entries())) {
    const min = Math.min(...precios);
    const todosIguales = precios.every((x) => x === min);
    out[k] = todosIguales ? pesos(min) : `Desde ${pesos(min)}`;
    // Cada prefijo de palabras completas, sin el nombre entero: «ortodoncia brackets» → «ortodoncia».
    const palabras = k.split(" ");
    for (let n = 1; n < palabras.length; n++) {
      const fam = palabras.slice(0, n).join(" ");
      porFamilia.set(fam, Math.min(porFamilia.get(fam) ?? Infinity, min));
    }
  }
  for (const [fam, min] of Array.from(porFamilia.entries())) out[`familia:${fam}`] = `Desde ${pesos(min)}`;
  return out;
}

/** Plural sencillo de la página → singular del tarifario («implantes» → «implante»). */
function singular(nombre: string): string | null {
  return nombre.length > 3 && nombre.endsWith("s") ? nombre.slice(0, -1) : null;
}

/** El precio que se enseña: el del catálogo si el servicio está ligado; si no, el que escribió la clínica. */
export function precioDeServicio(
  servicio: { name: string; price?: string | null },
  catalogo: Record<string, string> | null | undefined,
): string | null {
  const n = normalizarNombreServicio(servicio.name);
  const uno = singular(n);
  const delCatalogo =
    catalogo?.[n] ??
    (uno ? catalogo?.[uno] : undefined) ??
    catalogo?.[`familia:${n}`] ??
    (uno ? catalogo?.[`familia:${uno}`] : undefined);
  return delCatalogo ?? servicio.price ?? null;
}

export interface TextosAvisoReserva {
  solicitudPide: string;
  solicitudConfirma: string;
  citaDetalles: string;
  citaRecordatorio: string | null;
  campoTelefono: string;
}

/** Los textos al paciente según tenga o no WhatsApp la clínica. Sin saberlo, como sin WhatsApp (no se promete). */
export function textosAvisoReserva(avisosWhatsApp: boolean | null | undefined, clinica: string): TextosAvisoReserva {
  if (avisosWhatsApp === true) {
    return {
      solicitudPide: "La clínica lo revisa y te confirma por WhatsApp — todavía no es una cita agendada.",
      solicitudConfirma: `${clinica} revisará tu solicitud y te confirmará por WhatsApp.`,
      citaDetalles: "Recibirás un WhatsApp con los detalles",
      citaRecordatorio: "Recordatorio 24 horas antes",
      campoTelefono: "WhatsApp * (10 dígitos)",
    };
  }
  return {
    solicitudPide: "La clínica lo revisa y te llama al teléfono que dejes para confirmarlo — todavía no es una cita agendada.",
    solicitudConfirma: `${clinica} revisará tu solicitud y te llamará al teléfono que dejaste para confirmarla.`,
    citaDetalles: "Si hay algún cambio, la clínica te llamará al teléfono de tu cuenta",
    citaRecordatorio: null,
    campoTelefono: "Teléfono * (10 dígitos)",
  };
}
