// Datos por RENGLÓN de un tratamiento de Dentalink (06_Presupuestos_Detalle) que antes se perdían (ws1-t8).
// Puro y sin base: lo usan el handler de tratamientos y —para los renglones de ortodoncia— el de casos (ws1-t12).
//
//  · Precio: «Precio Paciente» es lo que de verdad se cobra (el precio final, como siempre). «Precio Original» es el
//    de lista; la diferencia es el descuento y se ve en el renglón: unitPrice = original, discount = original − paciente,
//    lineTotal = paciente. El total del tratamiento no cambia.
//  · Notas del renglón: categoría, código y lo pagado de ESA prestación (QuoteItem no tiene columnas para ello y no
//    se agrega SQL): un texto con etiquetas fijas que `leerNotaDeRenglon` sabe volver a leer.

export interface PrecioDeRenglon {
  unitPrice: number;
  discount: number;
  aviso?: string;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Precio unitario y descuento de un renglón a partir del precio de lista y del que paga el paciente.
 * Sin precio de lista (o sin el del paciente) no hay nada que separar: se conserva el precio del paciente sin descuento.
 * Un precio de lista MENOR que el del paciente (recargo, lista desactualizada) no inventa un descuento negativo: gana el
 * precio del paciente y se avisa.
 */
export function precioDeRenglon(args: { original: number | null; paciente: number; cantidad?: number }): PrecioDeRenglon {
  const { original, paciente } = args;
  const cantidad = args.cantidad && args.cantidad >= 1 ? args.cantidad : 1;
  if (original === null || !Number.isFinite(original) || original < 0) return { unitPrice: round2(paciente), discount: 0 };
  if (original > paciente + 0.005) {
    return { unitPrice: round2(original), discount: round2((original - paciente) * cantidad) };
  }
  if (original < paciente - 0.005) {
    return {
      unitPrice: round2(paciente),
      discount: 0,
      aviso: `El precio de lista (${original.toFixed(2)}) es menor que el que paga el paciente (${paciente.toFixed(2)}): se conserva el del paciente, sin descuento`,
    };
  }
  return { unitPrice: round2(paciente), discount: 0 };
}

const ETIQ_CATEGORIA = "Categoría: ";
const ETIQ_CODIGO = "Código: ";
const ETIQ_PAGADO = "Pagado en el sistema anterior: $";

export interface NotaDeRenglon {
  categoria?: string | null;
  codigo?: string | null;
  /** Lo pagado de esta prestación (0 = nada; null = el archivo no lo trae). */
  pagado?: number | null;
  /** Texto previo del renglón (p. ej. «Cantidad original: 2»). */
  previa?: string | null;
}

/** El texto de notas del renglón, o null si no hay nada que decir. */
export function notaDeRenglon(n: NotaDeRenglon): string | null {
  const partes: string[] = [];
  if (n.previa) partes.push(n.previa);
  if (n.categoria) partes.push(`${ETIQ_CATEGORIA}${n.categoria}`);
  if (n.codigo) partes.push(`${ETIQ_CODIGO}${n.codigo}`);
  if (n.pagado !== null && n.pagado !== undefined && n.pagado > 0) partes.push(`${ETIQ_PAGADO}${round2(n.pagado).toFixed(2)}`);
  return partes.length ? partes.join(" · ") : null;
}

/** Inverso de `notaDeRenglon`: lo que se pueda leer de las notas de un renglón migrado. */
export function leerNotaDeRenglon(notas: string | null | undefined): { categoria: string | null; codigo: string | null; pagado: number | null } {
  const out = { categoria: null as string | null, codigo: null as string | null, pagado: null as number | null };
  for (const parte of (notas ?? "").split(" · ")) {
    if (parte.startsWith(ETIQ_CATEGORIA)) out.categoria = parte.slice(ETIQ_CATEGORIA.length).trim() || null;
    else if (parte.startsWith(ETIQ_CODIGO)) out.codigo = parte.slice(ETIQ_CODIGO.length).trim() || null;
    else if (parte.startsWith(ETIQ_PAGADO)) {
      const n = Number(parte.slice(ETIQ_PAGADO.length).trim());
      out.pagado = Number.isFinite(n) ? n : null;
    }
  }
  return out;
}

/**
 * ¿Cuadra lo pagado por prestación con el total abonado del tratamiento? Manda SIEMPRE el total; devuelve el aviso a
 * mostrar cuando no coinciden (o null). Normalmente la suma por prestación es MENOR: hay pagos sin prestación asignada.
 */
export function conciliarPagado(sumaPorRenglon: number, totalTratamiento: number): string | null {
  const suma = round2(sumaPorRenglon);
  const total = round2(totalTratamiento);
  if (Math.abs(suma - total) <= 0.01) return null;
  if (suma > total) {
    return `Lo pagado por prestación (${suma.toFixed(2)}) supera el total abonado del tratamiento (${total.toFixed(2)}): manda el total`;
  }
  return `Lo pagado por prestación (${suma.toFixed(2)}) no llega al total abonado del tratamiento (${total.toFixed(2)}): la diferencia son pagos sin prestación asignada; manda el total`;
}
