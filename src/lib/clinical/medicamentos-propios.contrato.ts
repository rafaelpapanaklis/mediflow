/**
 * Lo PURO de los medicamentos propios de la clínica (ws1-t10): tipos, límites,
 * caracteres permitidos, listas de forma farmacéutica y vía, cómo se arma la
 * fila que se guarda en `cums_items` y la validación del alta. Sin Prisma ni
 * Node: lo importan el servidor (`medicamentos-propios.server.ts`) y la
 * pantalla (`cums-selector.tsx`). El diseño completo está explicado en el
 * archivo del servidor.
 */

import type { Controlado } from "@/lib/clinical/controlados";

/** Lo que el buscador y la receta ven de un medicamento (global o propio). */
export interface MedicamentoCatalogo {
  clave: string;
  descripcion: string;
  presentacion: string;
  formaFarmaceutica: string | null;
  grupoTerapeutico: string | null;
  cofeprisGroup: string | null;
  /** `true` si es de la lista propia de la clínica. */
  propio?: boolean;
}

/** Grupo terapéutico con el que se guardan las filas propias (no se enseña en pantalla). */
export const GRUPO_PROPIO = "Propio de la clínica";

export const LIMITES_PROPIO = {
  nombre: 120,
  concentracion: 60,
  forma: 60,
  via: 40,
  presentacion: 120,
  /** `cums_items.presentacion` es VARCHAR(200). */
  presentacionGuardada: 200,
} as const;

/**
 * Caracteres permitidos en TODOS los campos del alta (v2, hallazgo M-1 de t8):
 * letras latinas con acentos, ñ y ü, dígitos, espacio y `. , % / + - ( ) :`.
 * Nada más. Así una «о» cirílica, una «ο» griega, un «Ｔ» de ancho completo,
 * «ø» o «ı» —que en pantalla y en la verificación pública del QR se ven
 * idénticos a la letra latina y al candado se le escapaban— ni siquiera entran:
 * 400 `datos_invalidos` con `motivo: "caracteres"`.
 */
export const CARACTERES_PERMITIDOS = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü0-9 .,%/+\-():]*$/;

/**
 * En CONCENTRACIÓN y PRESENTACIÓN (no en el nombre) se admiten además los
 * signos legítimos de una dosis (v3, m-4 de t8): «µ» (50 µg; la «μ» griega se
 * convierte en «µ» al limpiar), «°», «ª», «º», «×», «½ ¼ ¾», «;» y «'» (pies
 * de… no: minutos, «1' 30''»). Ninguno sirve para escribir un controlado: el
 * nombre sigue con la lista estrecha.
 */
export const CARACTERES_PERMITIDOS_DOSIS = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü0-9 .,%/+\-():µ°ªº×½¼¾;']*$/;

export type CampoAlta = keyof AltaMedicamentoPropio;

/**
 * Formas farmacéuticas y vías del alta. El VALOR que se guarda es siempre el
 * español (la receta es un documento mexicano y así lo lee la farmacia); la
 * etiqueta se traduce con la clave (`clinical.cumsSelector.forms.*` /
 * `routes.*`). El servidor solo acepta estos valores (v2: la vía ya no es
 * texto libre, que se imprimía en la receta sin pasar por el candado).
 */
export const FORMAS_FARMACEUTICAS = [
  ["tableta", "Tableta"], ["capsula", "Cápsula"], ["suspension", "Suspensión"], ["solucion", "Solución"],
  ["jarabe", "Jarabe"], ["gotas", "Gotas"], ["gel", "Gel"], ["crema", "Crema"], ["pomada", "Pomada"],
  ["enjuague", "Enjuague"], ["spray", "Spray"], ["inyectable", "Inyectable"], ["parche", "Parche"],
  ["polvo", "Polvo"], ["supositorio", "Supositorio"], ["otra", "Otra"],
] as const;

export const VIAS = [
  ["oral", "Oral"], ["topica", "Tópica"], ["bucal", "Bucal"], ["sublingual", "Sublingual"],
  ["intramuscular", "Intramuscular"], ["intravenosa", "Intravenosa"], ["subcutanea", "Subcutánea"],
  ["inhalada", "Inhalada"], ["nasal", "Nasal"], ["oftalmica", "Oftálmica"], ["otica", "Ótica"],
  ["rectal", "Rectal"], ["vaginal", "Vaginal"], ["otra", "Otra"],
] as const;

const VALORES_FORMA = new Set<string>(FORMAS_FARMACEUTICAS.map(([, v]) => v));
const VALORES_VIA = new Set<string>(VIAS.map(([, v]) => v));

export interface AltaMedicamentoPropio {
  nombre: string;
  concentracion: string;
  forma: string;
  via: string;
  presentacion?: string | null;
}

/** Por qué un campo no pasa: vacío, con caracteres que no se permiten, o fuera de la lista (forma y vía). */
export type MotivoInvalido = "vacio" | "caracteres" | "lista";

export type ResultadoAlta =
  | { ok: true; medicamento: MedicamentoCatalogo; existia: boolean }
  | { ok: false; error: "sin_sql" }
  | { ok: false; error: "datos_invalidos"; campo: keyof AltaMedicamentoPropio; motivo: MotivoInvalido }
  | { ok: false; error: "medicamento_controlado"; controlado: Controlado };

/**
 * Lo que entra se normaliza a NFC (una «á» escrita como «a» + acento aparte,
 * como la mandan algunos teclados y el pegar de macOS, se vuelve la «á» de una
 * pieza), la «μ» griega (U+03BC) pasa a ser el signo micro «µ» (U+00B5), y los
 * espacios raros (NBSP, fino, ideográfico, tabulador) se vuelven uno normal.
 */
export function normalizarEntrada(v: unknown): string {
  return typeof v === "string" ? v.normalize("NFC").replace(/\u03BC/g, "\u00B5").replace(/\s+/g, " ").trim() : "";
}

function limpio(v: unknown, max: number): string {
  return normalizarEntrada(v).slice(0, max);
}

/** `null` si el texto solo usa caracteres permitidos para ese campo; si no, el primer carácter que sobra. */
export function caracterNoPermitido(texto: string, campo: CampoAlta = "nombre"): string | null {
  const permitidos = campo === "concentracion" || campo === "presentacion" ? CARACTERES_PERMITIDOS_DOSIS : CARACTERES_PERMITIDOS;
  const t = normalizarEntrada(texto);
  if (permitidos.test(t)) return null;
  for (const ch of t) if (!permitidos.test(ch)) return ch;
  return "?";
}

/** Nombre y presentación tal como se guardan (y como salen en el PDF y en el QR). */
export function armarFilaPropia(alta: AltaMedicamentoPropio): { descripcion: string; presentacion: string; formaFarmaceutica: string } {
  const nombre = limpio(alta.nombre, LIMITES_PROPIO.nombre);
  const concentracion = limpio(alta.concentracion, LIMITES_PROPIO.concentracion);
  const forma = limpio(alta.forma, LIMITES_PROPIO.forma);
  const via = limpio(alta.via, LIMITES_PROPIO.via);
  const presentacion = limpio(alta.presentacion, LIMITES_PROPIO.presentacion);
  // «500 mg, caja c/10 tabletas, vía oral»: la presentación del catálogo lleva
  // la concentración y la caja; la vía va al final porque el catálogo global no
  // tiene columna para ella y así queda impresa en la receta.
  const partes = [concentracion, presentacion, via ? `vía ${via.toLowerCase()}` : ""].filter(Boolean);
  return {
    descripcion: nombre,
    presentacion: partes.join(", ").slice(0, LIMITES_PROPIO.presentacionGuardada),
    formaFarmaceutica: forma,
  };
}

/**
 * Valida los campos: nombre, concentración, forma y vía obligatorios; todos
 * con solo caracteres permitidos; forma y vía de sus listas.
 */
export function validarAlta(
  alta: Partial<AltaMedicamentoPropio>,
): { ok: true; alta: AltaMedicamentoPropio } | { ok: false; campo: keyof AltaMedicamentoPropio; motivo: MotivoInvalido } {
  const nombre = limpio(alta.nombre, LIMITES_PROPIO.nombre);
  const concentracion = limpio(alta.concentracion, LIMITES_PROPIO.concentracion);
  const forma = limpio(alta.forma, LIMITES_PROPIO.forma);
  const via = limpio(alta.via, LIMITES_PROPIO.via);
  const presentacion = limpio(alta.presentacion, LIMITES_PROPIO.presentacion);

  const campos: Array<[keyof AltaMedicamentoPropio, string, boolean]> = [
    ["nombre", nombre, true],
    ["concentracion", concentracion, true],
    ["forma", forma, true],
    ["via", via, true],
    ["presentacion", presentacion, false],
  ];
  for (const [campo, valor, obligatorio] of campos) {
    if (obligatorio && (campo === "nombre" ? valor.length < 2 : !valor)) return { ok: false, campo, motivo: "vacio" };
    if (caracterNoPermitido(valor, campo)) return { ok: false, campo, motivo: "caracteres" };
  }
  if (!VALORES_FORMA.has(forma)) return { ok: false, campo: "forma", motivo: "lista" };
  if (!VALORES_VIA.has(via)) return { ok: false, campo: "via", motivo: "lista" };

  return { ok: true, alta: { nombre, concentracion, forma, via, presentacion: presentacion || null } };
}
