/**
 * DaleControl INSTITUCIONAL — LA CUOTA DE ALMACENAMIENTO DEL INSTITUTO.
 *
 * Módulo PURO a propósito (sin prisma, sin supabase, sin next/server): lo
 * importan el route handler que corta la subida, el panel de dirección que
 * pinta el medidor y el /admin que cobra el TB extra. Un tope duplicado es
 * un tope que un día dice 5 TB en la pantalla y 4 TB en el servidor.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LA CUOTA ES POR INSTITUTO, NO POR SEDE
 *
 * Tres sedes con 5 TB son 5 TB entre las tres, no 15. La sede es una
 * división DENTRO de la escuela (Ola 11) y comparten la bolsa; las sedes
 * en sí son ilimitadas. Por eso todo lo de aquí habla de `institutionId` y
 * el `where` de la suma (eduAlmacenamientoWhere) tiene UNA sola llave: en
 * cuanto alguien le agregue un campusId, la escuela con dos edificios
 * empieza a ver la mitad de su consumo y cree que le sobra espacio.
 *
 * 🔴 LA CUOTA ES UNA CLÁUSULA DEL CONTRATO: LA DIRECCIÓN LA VE Y NO LA EDITA
 *
 * Se cambia desde el /admin de DaleControl o por SQL. Es la misma línea que
 * ya trazó la Ola 8 con lo que incluye el contrato de IA, y por la misma
 * razón: la factura de Supabase la paga DaleControl, así que un formulario
 * que dejara subir el número convertiría "lo que incluye tu contrato" en
 * "lo que alguien tecleó", y quien paga no estaría en la conversación.
 *
 * 🔴 LO QUE ESTE MEDIDOR CUENTA, Y LO QUE NO
 *
 * Cuenta ESTUDIOS: la suma de EduStudy.sizeBytes del instituto. El bucket
 * `edu-files` guarda además las FIRMAS de consentimiento, que no tienen
 * fila con su tamaño, así que no entran — y no se estiman: un medidor que
 * inventa bytes es peor que no tener medidor, porque se le cree. La
 * pantalla lo DICE con todas sus letras (EDU_ALM_NOTA_ALCANCE).
 * ═══════════════════════════════════════════════════════════════════════
 */
import { eduFormatBytes } from "@/lib/edu/estudios-core";

/** Un TB, en bytes (binario: 1024^4). El mismo que usa eduFormatBytes. */
export const EDU_BYTES_POR_TB = 1024 ** 4;

/**
 * Lo que INCLUYE un contrato institucional: 5 TB.
 *
 * Es el `@default` de EduInstitution.storageQuotaBytes y el valor con el
 * que nace un instituto nuevo. Vive aquí además de en el esquema porque es
 * el número contra el que se calcula el excedente a facturar, y ese cálculo
 * no puede depender de leer un default de Postgres.
 */
export const EDU_ALM_INCLUIDO_BYTES = 5 * EDU_BYTES_POR_TB; // 5 497 558 138 880

/**
 * 🔴 FUENTE ÚNICA DEL PRECIO DEL TB EXTRA: $400 MXN al mes.
 *
 * Ninguna pantalla, ningún componente y ningún texto escribe este número a
 * mano. Si mañana el TB extra vale $450, se cambia AQUÍ y cambia en el
 * /admin, en el reporte y en cualquier sitio que lo diga. Un precio
 * hardcodeado en la UI es un bug: el día que suba, la mitad de las
 * pantallas seguirá cobrando el viejo y nadie sabrá cuál es el bueno.
 */
export const EDU_ALM_TB_EXTRA_MXN = 400;

/** El umbral en el que el medidor se pone ÁMBAR. */
export const EDU_ALM_UMBRAL_AVISO = 80;
/** El umbral en el que el medidor se pone ROJO. */
export const EDU_ALM_UMBRAL_CRITICO = 95;

/**
 * Los topes del editor del /admin, en TB enteros.
 *
 * El mínimo NO es 0 a propósito: una cuota de cero bloquea la subida de una
 * escuela viva en el mismo instante en que se guarda, sin aviso previo y
 * sin que nadie en la escuela pueda hacer nada. Si de verdad hay que
 * cortarle a un instituto, eso es desactivarlo, no dejarle una cuota que
 * miente. El máximo es una barrera contra el dedo gordo: 1000 TB serían
 * $398 000 MXN al mes de contrato, y ese número no se teclea sin querer.
 */
export const EDU_ALM_TB_MIN = 1;
export const EDU_ALM_TB_MAX = 1000;

/**
 * Lo que la pantalla tiene que CONFESAR sobre el número que enseña.
 *
 * No es una nota al pie decorativa: sin ella, "1.2 TB de 5 TB" se lee como
 * "todo lo que hay en el bucket", y no lo es.
 */
export const EDU_ALM_NOTA_ALCANCE =
  "Se cuentan los ESTUDIOS del expediente (radiografías, tomografías, fotos y PDFs). " +
  "Las firmas de consentimiento también viven en el almacenamiento, pero no se registra " +
  "su tamaño y no se estiman: este medidor no inventa bytes.";

// ═══════════════════════════════════════════════════════════════════════
// EL MEDIDOR
// ═══════════════════════════════════════════════════════════════════════

/**
 * Lo que hace falta para contestar "¿cuánto llevo y cuánto me queda?".
 *
 * 🔴 `usadoBytes` NO sale de ninguna columna: se CUENTA sumando
 * EduStudy.sizeBytes del instituto cada vez que alguien pregunta (misma
 * decisión que el cupo de IA de la Ola 8 y que el avance académico de la
 * Ola 6). Un contador guardado se desincroniza el día que una escritura
 * falle a la mitad.
 *
 * Los dos son `number` y no `bigint` a propósito: un BigInt no se
 * serializa a JSON —revienta el route handler con "Do not know how to
 * serialize a BigInt"— ni viaja de un componente de servidor a uno de
 * cliente. La conversión no pierde un byte: 1000 TB son 1.1e15, por debajo
 * de Number.MAX_SAFE_INTEGER (9.0e15).
 */
export interface EduAlmMedidor {
  /** Suma de EduStudy.sizeBytes del INSTITUTO (todas sus sedes juntas). */
  usadoBytes: number;
  /** La cuota contratada, EduInstitution.storageQuotaBytes. */
  cuotaBytes: number;
  /** Cuántos estudios son. Es lo que da derecho a decir "de estudios". */
  estudios: number;
}

/** Un número que se pueda sumar, o 0. Blinda la aritmética de nulls y NaN. */
function sano(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * El `where` de la suma: UNA sola llave, el instituto.
 *
 * 🔴 Aquí es donde se respeta "la cuota es por instituto y no por sede".
 * EduStudy ni siquiera tiene campusId, así que sumar por institutionId ya
 * pool las tres sedes solo — pero esta función existe para que ese hecho
 * tenga UN sitio, con su prueba, en vez de repetirse en el handler que
 * corta la subida y en el panel que la pinta.
 *
 * 🔴 Un institutionId vacío revienta a propósito: en Prisma
 * `where: { institutionId: undefined }` NO devuelve cero filas — BORRA el
 * filtro y devuelve las de TODAS las escuelas. Aquí eso sería sumarle a un
 * instituto el consumo del vecino.
 */
export function eduAlmacenamientoWhere(institutionId: string): { institutionId: string } {
  if (typeof institutionId !== "string" || !institutionId) {
    throw new Error("eduAlmacenamientoWhere: falta el institutionId");
  }
  return { institutionId };
}

/** Lo que queda, en bytes. Nunca negativo. */
export function eduAlmRestanteBytes(m: EduAlmMedidor): number {
  return Math.max(0, sano(m?.cuotaBytes) - sano(m?.usadoBytes));
}

/**
 * ¿Ya no cabe nada más?
 *
 * Se decide con los BYTES y no con el porcentaje pintado: 99.6 % redondea a
 * 100 y todavía caben gigas. La invariante que sostiene toda la pantalla es
 * la contraria — **100 % ⟺ bloqueado**— y por eso el porcentaje se calcula
 * hacia abajo (ver eduAlmPorcentaje).
 */
export function eduAlmLleno(m: EduAlmMedidor): boolean {
  return eduAlmRestanteBytes(m) <= 0;
}

/**
 * Qué porcentaje de la cuota se lleva usado, 0–100.
 *
 * Hacia ABAJO (floor) mientras quede un solo byte, y 100 exacto cuando ya
 * no queda: así el número que se lee y el color que se pinta no pueden
 * discrepar, y "100 %" significa siempre "la subida está bloqueada".
 *
 * Una cuota de cero (solo se llega ahí escribiendo la fila a mano) devuelve
 * 100: no queda nada, y una barra vacía diría lo contrario.
 */
export function eduAlmPorcentaje(m: EduAlmMedidor): number {
  const cuota = sano(m?.cuotaBytes);
  if (cuota <= 0) return 100;
  if (eduAlmLleno(m)) return 100;
  return Math.max(0, Math.min(99, Math.floor((sano(m?.usadoBytes) / cuota) * 100)));
}

export type EduAlmNivel = "ok" | "aviso" | "critico" | "lleno";

/**
 * El semáforo. Se deriva del MISMO porcentaje que se pinta, para que no
 * pueda salir un "80 %" en verde ni un "79 %" en ámbar.
 */
export function eduAlmNivel(m: EduAlmMedidor): EduAlmNivel {
  if (eduAlmLleno(m)) return "lleno";
  const pct = eduAlmPorcentaje(m);
  if (pct >= EDU_ALM_UMBRAL_CRITICO) return "critico";
  if (pct >= EDU_ALM_UMBRAL_AVISO) return "aviso";
  return "ok";
}

export interface EduAlmTexto {
  titulo: string;
  detalle: string;
}

/**
 * Lo que el medidor DICE, en palabras, según dónde esté.
 *
 * Vive en el módulo puro y no dentro del JSX porque es lo que se prueba:
 * que a partir del 80 % diga cuánto queda, y que al 100 % diga que la
 * subida está bloqueada Y qué hacer al respecto. Un semáforo que solo
 * cambia de color deja a quien lo mira adivinando qué se espera de él.
 */
export function eduAlmTexto(m: EduAlmMedidor): EduAlmTexto {
  const restante = eduAlmRestanteBytes(m);
  const nivel = eduAlmNivel(m);

  if (nivel === "lleno") {
    return {
      titulo: "Almacenamiento lleno: la subida de estudios está BLOQUEADA",
      detalle:
        `Se llegó a la cuota de ${eduFormatBytes(sano(m?.cuotaBytes))} y no se puede subir ` +
        "ni una radiografía más. Hay dos salidas: contratar más TB con DaleControl " +
        `(${eduAlmPrecioLabel()}) o liberar espacio borrando estudios que ya no hagan falta. ` +
        "Lo demás del panel sigue funcionando igual.",
    };
  }

  if (nivel === "critico") {
    return {
      titulo: `Queda ${eduFormatBytes(restante)} de almacenamiento`,
      detalle:
        "Es menos del 5 % de la cuota: con una tomografía se acaba. Cuando llegue a cero " +
        "no se podrá subir ningún estudio, así que conviene contratar más TB ahora " +
        `(${eduAlmPrecioLabel()}) y no cuando ya esté detenido.`,
    };
  }

  if (nivel === "aviso") {
    return {
      titulo: `Queda ${eduFormatBytes(restante)} de almacenamiento`,
      detalle:
        `Ya se usó el ${eduAlmPorcentaje(m)} % de la cuota. Todavía no bloquea nada, pero es ` +
        "el momento de decidir: más TB con DaleControl o una limpieza de estudios viejos.",
    };
  }

  return {
    titulo: `Queda ${eduFormatBytes(restante)} de almacenamiento`,
    detalle:
      `Va el ${eduAlmPorcentaje(m)} % de la cuota del contrato. Cuando llegue al ` +
      `${EDU_ALM_UMBRAL_AVISO} % esta tarjeta lo avisa, y al 100 % la subida de estudios se ` +
      "detiene.",
  };
}

// ═══════════════════════════════════════════════════════════════════════
// EL CORTE DE LA SUBIDA
// ═══════════════════════════════════════════════════════════════════════

/** ¿Cabe un archivo de `bytes` sin pasarse de la cuota? */
export function eduAlmCabe(m: EduAlmMedidor, bytes: number): boolean {
  return sano(bytes) <= eduAlmRestanteBytes(m);
}

/**
 * El mensaje del rechazo, escrito para la persona que está subiendo.
 *
 * 🔴 NUNCA UN 413 MUDO. Quien sube es un alumno con el paciente en el
 * sillón: "no se pudo subir" lo deja mirando la pantalla. Tiene que leer
 * cuánto pesa lo suyo, cuánto queda y a quién decírselo.
 *
 * Sí, esto le dice a un alumno cuánto espacio queda —el MEDIDOR es de
 * dirección, este renglón no—: sin ese número no puede saber si su archivo
 * es el problema o si la escuela está llena, que es justo lo que necesita
 * para decidir si reintenta con otra cosa o va a avisar.
 */
export function eduAlmRechazo(m: EduAlmMedidor, bytes: number): string {
  const restante = eduAlmRestanteBytes(m);
  if (restante <= 0) {
    return (
      `El almacenamiento del instituto está lleno (${eduFormatBytes(sano(m?.cuotaBytes))} de ` +
      "cuota) y no se pueden subir más estudios. Avísale a la dirección: hay que contratar " +
      "más espacio o liberar el que hay. Lo que ya está subido no se pierde."
    );
  }
  return (
    `Ese archivo pesa ${eduFormatBytes(sano(bytes))} y al instituto solo le quedan ` +
    `${eduFormatBytes(restante)} de almacenamiento. Avísale a la dirección: hay que contratar ` +
    "más espacio o liberar el que hay."
  );
}

// ═══════════════════════════════════════════════════════════════════════
// EL DINERO (lo que ve Rafael en su /admin)
// ═══════════════════════════════════════════════════════════════════════

/** Bytes → TB con un decimal. Para "5 TB contratados". */
export function eduAlmTb(bytes: number): number {
  return Math.round((sano(bytes) / EDU_BYTES_POR_TB) * 10) / 10;
}

/** TB → bytes. Lo que guarda el editor del /admin. */
export function eduAlmBytesDeTb(tb: number): number {
  return Math.round(sano(tb) * EDU_BYTES_POR_TB);
}

/**
 * Los TB que van POR ENCIMA de lo incluido. Nunca negativo: una cuota por
 * debajo de los 5 TB incluidos no genera una factura en negativo.
 */
export function eduAlmTbExtra(cuotaBytes: number): number {
  const extra = sano(cuotaBytes) - EDU_ALM_INCLUIDO_BYTES;
  if (extra <= 0) return 0;
  return Math.round((extra / EDU_BYTES_POR_TB) * 10) / 10;
}

/**
 * CUÁNTO FACTURARLE AL MES por el almacenamiento extra, en pesos.
 *
 * (contratados − 5 incluidos) × $400. Se redondea al peso porque el editor
 * del /admin solo acepta TB enteros; una cuota con fracción solo puede
 * venir de un UPDATE a mano, y ahí la proporción sigue siendo la respuesta
 * honesta.
 *
 * Este es el renglón que existe para que ese dinero no se le vaya a nadie:
 * hoy una escuela puede tener 20 TB contratados y nadie se acuerda de
 * cobrarle los 15 de más.
 */
export function eduAlmCostoExtraMxn(cuotaBytes: number): number {
  return Math.round(eduAlmTbExtra(cuotaBytes) * EDU_ALM_TB_EXTRA_MXN);
}

/** "$400 MXN al mes por TB extra" — el precio, dicho una sola vez. */
export function eduAlmPrecioLabel(): string {
  return `$${EDU_ALM_TB_EXTRA_MXN.toLocaleString("es-MX")} MXN al mes por TB extra`;
}

/** "$6,000 MXN" — pesos enteros, con separador de miles. */
export function eduAlmMxnLabel(pesos: number): string {
  return `$${Math.round(sano(pesos)).toLocaleString("es-MX")} MXN`;
}

/** "5 TB" / "7.5 TB". Para las columnas del /admin. */
export function eduAlmTbLabel(bytes: number): string {
  const tb = eduAlmTb(bytes);
  return `${Number.isInteger(tb) ? tb : tb.toFixed(1)} TB`;
}

/**
 * Lee los TB que teclearon en el /admin y devuelve el error o null.
 *
 * Entera y dentro de los topes. Se valida aquí —módulo puro— y no dentro de
 * la server action para poder probarlo sin sesión ni base de datos, que es
 * lo mismo que hizo la Ola 8 con las reglas del excedente de IA.
 */
export function eduAlmValidarTb(tb: unknown): string | null {
  const n = Number(tb);
  if (!Number.isFinite(n)) return "Escribe cuántos TB incluye el contrato.";
  if (!Number.isInteger(n)) return "Los TB se contratan enteros (5, 10, 20…).";
  if (n < EDU_ALM_TB_MIN) {
    return (
      `La cuota mínima es ${EDU_ALM_TB_MIN} TB. Una cuota de cero bloquea la subida de ` +
      "estudios de una escuela viva en el mismo instante en que se guarda; si hay que " +
      "cortarle a un instituto, se desactiva, no se le deja una cuota que miente."
    );
  }
  if (n > EDU_ALM_TB_MAX) return `La cuota máxima que acepta este editor es ${EDU_ALM_TB_MAX} TB.`;
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// La forma que viaja a la pantalla del /admin
// ═══════════════════════════════════════════════════════════════════════

export interface EduAlmAdminRow {
  institutionId: string;
  nombre: string;
  slug: string;
  activo: boolean;
  /** Sedes que tiene. Informativo: NO divide la cuota (son ilimitadas). */
  sedes: number;
  medidor: EduAlmMedidor;
  /** TB contratados, TB usados y lo que hay que facturarle al mes. */
  cuotaTbLabel: string;
  usadoTbLabel: string;
  extraTb: number;
  costoExtraMxn: number;
}
