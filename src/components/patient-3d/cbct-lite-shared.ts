// Formato del CBCT "lite": un volumen REDUCIDO del estudio, empaquetado en un
// binario compacto (~10-25 MB) que el SERVIDOR genera una vez y el MÓVIL descarga
// en lugar del .zip original (300-600 MB). Un iPhone no puede descargar +
// descomprimir + decodificar el estudio completo sin que iOS recargue la pestaña
// por falta de memoria; el lite evita TODO ese trabajo en el teléfono.
//
// Este archivo es PURO (sin Node, sin DOM): lo usan el generador del servidor
// (src/lib/cbct-lite.ts) para ESCRIBIR y el visor (DicomSetViewer) para LEER.
// Trabaja con ArrayBuffer/DataView/Int16Array, universales en ambos entornos.
//
// Layout (todo little-endian; las plataformas que importan —x86/ARM— son LE, y
// servidor y cliente comparten endianness):
//   [0..3]   magic ASCII "CBL1"
//   [4]      version (u8) = 1
//   [5]      invert (u8, 0/1)            — MONOCHROME1 del estudio
//   [6]      hasRealSpacing (u8, 0/1)    — el PixelSpacing del estudio era real (no [1,1])
//   [7]      geom (u8, campo de bits) — lo que se sabe del ESTUDIO ORIGINAL:
//              bits 0-3 = procedencia del orden (TRI-ESTADO):
//                0 = no consta   → lite generado antes de que existiera este campo
//                1 = el .zip SÍ estaba apilado por geometría real del paciente
//                2 = NO lo estaba (sin posición, mezclado, o posiciones que no
//                    separaban nada) → orden dudoso
//              bit  4   = el espaciado entre cortes NO era constante
//              bit  5   = se descartaron cortes de otra serie al construirlo
//              bits 6-7 = libres. El lector ENMASCARA, así que un escritor futuro
//                puede usarlos sin que este código lea basura.
//   [8..11]  count (u32)  — número de cortes (D)
//   [12..15] rows  (u32)  — filas por corte (H)
//   [16..19] cols  (u32)  — columnas por corte (W)
//   [20..23] dx (f32, mm/columna)  — espaciado físico YA ajustado por el submuestreo
//   [24..27] dy (f32, mm/fila)
//   [28..31] dz (f32, mm entre cortes)
//   [32..35] center (f32)  — ventana por defecto (el visor recalcula por percentiles)
//   [36..39] width  (f32)
//   [40..63] iop (6 × f32)      — ImageOrientationPatient del estudio ORIGINAL, o
//                                 24 ceros si no lo declaraba (ver hasIop abajo)
//   [64..]   píxeles: count*rows*cols valores Int16 LE (cortes concatenados en orden Z)
//
// LA RUTA DEL ARCHIVO LLEVA LA VERSIÓN, Y ESA ES LA QUE INVALIDA LA CACHÉ.
// El lite se cachea en Storage junto al .zip y el endpoint devuelve el archivo
// cacheado tal cual si existe (`objectExists` → signed URL, sin releerlo). Con la
// ruta fija de antes, un binario ya generado NO se regeneraba nunca: subir
// CBCT_LITE_VERSION solo conseguía que el cliente nuevo rechazara el binario
// viejo, pidiera al servidor que lo rehiciera y recibiera el mismo archivo otra
// vez → una pantalla de error permanente en el móvil para todos los estudios ya
// abiertos (NO un bucle: el visor reintenta una sola vez y se rinde; y un ADMIN
// podía salvarlo con `?force=1`, estudio por estudio). Por eso la versión va en
// el SUFIJO: una ruta nueva simplemente no existe todavía, el endpoint la genera
// por el camino normal y el binario viejo queda huérfano sin que nadie lo lea.
//
// POR QUÉ ESTA VEZ SÍ HACE FALTA REGENERAR. El byte srcGeom pudo colarse en un
// byte de relleno porque su ausencia se lee como "no consta" y no cambiaba nada.
// Ya no: de ese byte cuelga el VOLTEO vertical de coronal/sagital. Un lite viejo
// dice "no consta" → el móvil no voltea → el mismo estudio sale con el cráneo
// hacia arriba en el monitor y hacia abajo en el teléfono, sin aviso en ninguno
// de los dos. Eso no se arregla leyendo mejor: hay que rehacer el binario. Y ya
// que se rehace, se aprovecha para meter el IOP (bytes reservados [40..63], 24
// justos), que es lo que le faltaba al móvil para rotular R/L/A/P/S/I y para que
// su volteo se apoye en la orientación real y no en una suposición.
//
// COSTE, dicho claro: el primer móvil que abra cada estudio ya cacheado paga una
// regeneración (descarga del .zip + decodificación en el servidor), con el freno
// por clínica que ya tiene el endpoint. Y los `.lite.bin` antiguos se quedan en
// el bucket para siempre: NO existe ningún trabajo que los borre —el borrado de un
// estudio es lógico (NOM-004) y nunca tocó Storage—, así que son ~22 MB por
// estudio, y otros ~50 si alguna vez se pidió la variante HD, que ya no lee nadie.
// Se dice y no se disimula: purgarlos es una tarea de operación PENDIENTE.
//
// POR QUÉ srcGeom ES TRI-ESTADO y no un 0/1: con dos valores, el 0 de un binario
// que no lo escribió tendría que significar o "fiable" o "dudoso", y las dos
// lecturas mienten — quien lo generó ni siquiera miró la procedencia. El 0 es
// "no consta", y quien decide si avisar (geometryDoubtReason, en
// GeometryWarning.tsx) no avisa con él: solo se advierte de lo que se midió.
// Cualquier valor futuro que este lector no conozca cae también a "no consta",
// por la misma razón.

// Import de TIPO exclusivamente, a propósito: este archivo lo importa también
// /api/patients/[id]/models-3d (solo por el sufijo del derivado) y un import de
// VALOR de dicom-decode-core arrastraría `dicom-parser` al bundle de esa función
// para nada. Por eso la normal del plano no se calcula aquí sino en quien rotula,
// que la deriva del IOP que este binario sí transporta.
import type { DecodedSlice, ImageOrientation } from "./dicom-decode-core";

export const CBCT_LITE_HEADER_BYTES = 64;
// "CBL1" byte a byte (evita depender de TextEncoder en el cliente).
const MAGIC = [0x43, 0x42, 0x4c, 0x31] as const; // C B L 1
export const CBCT_LITE_VERSION = 1;

// Procedencia geométrica del ESTUDIO ORIGINAL del que salió este lite. Es la
// única forma que tiene el móvil de distinguir un lite bien ordenado (el .zip
// traía posiciones y el servidor ordenó por geometría real) de uno apilado a
// ciegas — porque los cortes que devuelve decodeCbctLite declaran siempre
// `orderSource: "instance"` y ahí esa señal ya se perdió.
//   "unknown"      → binario anterior a este campo: no consta (NO se avisa).
//   "positioned"   → todos los cortes del .zip traían ImagePositionPatient.
//   "unpositioned" → ninguno la traía, o solo una parte (ver buildCbctLite).
export type CbctLiteSourceGeometry = "unknown" | "positioned" | "unpositioned";

// Codificación en el byte [7]. Los enteros se quedan aquí: fuera de este archivo
// se habla en el tipo de arriba, nadie más tiene que saber que 2 es "dudoso".
function srcGeomToByte(v: CbctLiteSourceGeometry): number {
  return v === "positioned" ? 1 : v === "unpositioned" ? 2 : 0;
}
// Bit 4 del mismo byte: el espaciado entre cortes del estudio ORIGINAL no era
// constante. Va aquí y no en un byte propio porque la cabecera se quedó sin
// reservados al meter el IOP, y va en ESTE binario y no en el siguiente porque
// añadirlo después costaría un tercer sufijo y otra regeneración de todos los
// estudios. Sin él, un CBCT irregular avisa en el escritorio y calla en el
// teléfono: justo la divergencia que este arreglo existe para eliminar.
const SRC_GEOM_MASK = 0x0f;
const Z_VARIABLE_BIT = 0x10;
// Bit 5: al construir el volumen hubo que DESCARTAR cortes por tener otro raster,
// o sea el .zip traia mas de una serie. El escritorio lo sabe porque filtra el
// mismo delante del usuario; el movil recibe el volumen ya filtrado y sin este bit
// no tenia forma de enterarse.
const DROPPED_FOREIGN_BIT = 0x20;
function srcGeomFromByte(b: number): CbctLiteSourceGeometry {
  // Todo lo que no sea 1 o 2 —el 0 de los lites viejos incluido, y cualquier
  // código que invente un escritor futuro— es "no consta". Un lector no puede
  // deducir una advertencia de un valor que no entiende.
  const code = b & SRC_GEOM_MASK;
  return code === 1 ? "positioned" : code === 2 ? "unpositioned" : "unknown";
}

export interface CbctLiteMeta {
  count: number;
  rows: number;
  cols: number;
  dx: number;
  dy: number;
  dz: number;
  center: number;
  width: number;
  invert: boolean;
  hasRealSpacing: boolean;
  // Obligatorio a propósito: quien genere un lite tiene que DECIDIR qué sabe de
  // la geometría del estudio de origen. Dejarlo opcional invitaría a olvidarlo, y
  // un olvido aquí se lee como "no consta" para siempre en el binario cacheado.
  sourceGeometry: CbctLiteSourceGeometry;
  /** El espaciado entre cortes del estudio ORIGINAL no era constante. */
  zVariable: boolean;
  /** Se descartaron cortes de otro raster: el .zip traia mas de una serie. */
  droppedForeign: boolean;
  // ImageOrientationPatient del estudio ORIGINAL, o `null` si no lo declaraba (o
  // lo declaraba degenerado). Es lo que permite al MÓVIL rotular los bordes con
  // R/L/A/P/S/I: sin él, el visor del teléfono jamás ha podido decir de qué lado
  // del paciente está mirando. También es lo que hace comprobable el volteo
  // vertical de coronal/sagital en esa ruta, en vez de darlo por supuesto.
  imageOrientation: ImageOrientation | null;
}

/**
 * Serializa el volumen reducido a un binario lite. `voxels` son los cortes
 * concatenados en orden Z (length === count*rows*cols). Lo usa el generador del
 * servidor. Lanza si las dimensiones no cuadran (bug del llamador, no entrada).
 */
export function encodeCbctLite(meta: CbctLiteMeta, voxels: Int16Array): Uint8Array {
  const per = meta.rows * meta.cols;
  const n = meta.count * per;
  if (!Number.isInteger(n) || n <= 0) throw new Error("cbct-lite: dimensiones inválidas");
  if (voxels.length !== n) {
    throw new Error(`cbct-lite: voxels.length=${voxels.length} != count*rows*cols=${n}`);
  }
  const buf = new ArrayBuffer(CBCT_LITE_HEADER_BYTES + n * 2);
  const dv = new DataView(buf);
  for (let i = 0; i < 4; i++) dv.setUint8(i, MAGIC[i]);
  dv.setUint8(4, CBCT_LITE_VERSION);
  dv.setUint8(5, meta.invert ? 1 : 0);
  dv.setUint8(6, meta.hasRealSpacing ? 1 : 0);
  dv.setUint8(
    7,
    srcGeomToByte(meta.sourceGeometry) |
      (meta.zVariable ? Z_VARIABLE_BIT : 0) |
      (meta.droppedForeign ? DROPPED_FOREIGN_BIT : 0),
  );
  dv.setUint32(8, meta.count, true);
  dv.setUint32(12, meta.rows, true);
  dv.setUint32(16, meta.cols, true);
  dv.setFloat32(20, meta.dx, true);
  dv.setFloat32(24, meta.dy, true);
  dv.setFloat32(28, meta.dz, true);
  dv.setFloat32(32, meta.center, true);
  dv.setFloat32(36, meta.width, true);
  // IOP en [40..63]. Sin orientación se dejan los 24 bytes a cero, que es lo que
  // ya trae el ArrayBuffer: el lector distingue "no declarado" de "declarado" por
  // que un IOP real NUNCA es el vector nulo (sus dos mitades son unitarias), así
  // que los seis ceros no pueden confundirse con una orientación válida.
  if (meta.imageOrientation) {
    for (let i = 0; i < 6; i++) dv.setFloat32(40 + i * 4, meta.imageOrientation[i], true);
  }
  // Copia los píxeles en una vista alineada (offset 64 es múltiplo de 2 → válido).
  new Int16Array(buf, CBCT_LITE_HEADER_BYTES, n).set(voxels);
  return new Uint8Array(buf);
}

/**
 * Deserializa el binario lite a la MISMA forma de cortes que el visor ya consume
 * (DecodedSlice[]): así MprPane, Dicom3DVolume, la cruz y la ventana funcionan
 * sin cambios, solo con un volumen más pequeño. Devuelve null si el binario no es
 * un lite válido (magic/version/longitud), para que el visor caiga a su error.
 * Cada corte recibe su propia copia Int16Array (independiente del buffer origen).
 */
export function decodeCbctLite(buf: ArrayBuffer): { meta: CbctLiteMeta; slices: DecodedSlice[] } | null {
  if (!buf || buf.byteLength < CBCT_LITE_HEADER_BYTES) return null;
  const dv = new DataView(buf);
  for (let i = 0; i < 4; i++) if (dv.getUint8(i) !== MAGIC[i]) return null;
  if (dv.getUint8(4) !== CBCT_LITE_VERSION) return null;
  const invert = dv.getUint8(5) === 1;
  const hasRealSpacing = dv.getUint8(6) === 1;
  const geomByte = dv.getUint8(7);
  const sourceGeometry = srcGeomFromByte(geomByte);
  const zVariable = (geomByte & Z_VARIABLE_BIT) !== 0;
  const droppedForeign = (geomByte & DROPPED_FOREIGN_BIT) !== 0;
  const count = dv.getUint32(8, true);
  const rows = dv.getUint32(12, true);
  const cols = dv.getUint32(16, true);
  const dx = dv.getFloat32(20, true);
  const dy = dv.getFloat32(24, true);
  const dz = dv.getFloat32(28, true);
  const center = dv.getFloat32(32, true);
  const width = dv.getFloat32(36, true);
  // IOP de [40..63]. Se acepta solo si es un vector NO nulo y finito: los 24 ceros
  // significan "el estudio no lo declaraba" y cualquier basura tampoco sirve para
  // rotular un lado del paciente.
  const iopRaw: number[] = new Array(6);
  let iopSum = 0;
  let iopFinite = true;
  for (let i = 0; i < 6; i++) {
    const v = dv.getFloat32(40 + i * 4, true);
    if (!Number.isFinite(v)) iopFinite = false;
    iopRaw[i] = v;
    iopSum += Math.abs(v);
  }
  const imageOrientation: ImageOrientation | null =
    iopFinite && iopSum > 1e-6
      ? [iopRaw[0], iopRaw[1], iopRaw[2], iopRaw[3], iopRaw[4], iopRaw[5]]
      : null;
  const per = rows * cols;
  const n = count * per;
  if (count <= 0 || rows <= 0 || cols <= 0) return null;
  if (buf.byteLength < CBCT_LITE_HEADER_BYTES + n * 2) return null;
  // dx/dy/dz eran los ÚNICOS espaciados del sistema sin guarda, y de dz cuelga la
  // altura del raster de coronal/sagital: un `dz` de 0 los deja en una franja
  // negra muda, y un NaN atraviesa rasterDims/fitContain hasta `canvas.width=NaN`
  // → 0 y `createImageData(0,0)` LANZA dentro de un efecto, o sea pantalla en
  // blanco. Solo pasa con un binario corrupto o truncado, que es exactamente
  // cuando una guarda vale para algo.
  if (!(dx > 0) || !(dy > 0) || !(dz > 0)) return null;
  //  deja pasar Infinity, y un dz infinito hace que planeGeom devuelva NaN y
  // el coronal salga como una tira de 1 px. La comparación mide el signo; la
  // finitud hay que pedirla aparte.
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return null;
  if (!Number.isFinite(center) || !Number.isFinite(width)) return null;

  const all = new Int16Array(buf, CBCT_LITE_HEADER_BYTES, n);
  const slices: DecodedSlice[] = new Array(count);
  for (let z = 0; z < count; z++) {
    // .slice() copia: cada corte queda con su propio buffer (el visor/worker los
    // trata como independientes; además el volumen 3D transfiere buffers).
    const pixels = all.slice(z * per, (z + 1) * per);
    slices[z] = {
      rows,
      cols,
      pixels,
      center,
      width,
      invert,
      order: z,
      // El binario lite NO guarda geometría de paciente: el servidor lo generó a
      // partir de un volumen YA ordenado y remuestreado en Z, así que aquí
      // `order` es el índice del corte dentro del volumen, no una proyección en
      // milímetros. Declararlo "instance" es lo honesto — y evita que un
      // consumidor mezcle estos cortes con los del .zip creyendo que comparten
      // unidad. Sin IPP no se inventa una posición (null) y la normal cae al
      // axial por defecto, igual que en el núcleo cuando falta la orientación.
      //
      // OJO al falso positivo: este "instance" NO significa que el volumen esté
      // mal ordenado. Lo ordenó el SERVIDOR con la geometría del .zip original y,
      // si ese .zip traía posiciones, el orden es tan bueno como el del
      // escritorio. Quien quiera juzgar la fiabilidad del orden en la ruta móvil
      // tiene que mirar `meta.sourceGeometry`, no este campo: mirar aquí haría
      // que TODOS los usuarios de móvil vieran siempre una advertencia falsa.
      orderSource: "instance",
      imagePosition: null,
      // `planeNormal` es el EJE CON EL QUE SE ORDENÓ, y aquí no se ordenó nada:
      // el servidor entregó el volumen ya apilado y estos `order` son índices. Se
      // deja el axial estándar, que es el valor neutro del núcleo. NO se rellena
      // con la normal del IOP a propósito: quien rotula los bordes la deriva del
      // `imageOrientation` de abajo, que es el dato que el estudio sí declaró, y
      // así este campo no puede acabar afirmando un eje que aquí nadie usó.
      planeNormal: [0, 0, 1],
      // Copia propia por corte (nadie debe poder mutar la orientación del estudio
      // entero escribiendo en la de un corte), o `null` si el estudio original no
      // la declaraba: ahí el rotulado se calla, que es lo correcto.
      imageOrientation: imageOrientation
        ? [
            imageOrientation[0],
            imageOrientation[1],
            imageOrientation[2],
            imageOrientation[3],
            imageOrientation[4],
            imageOrientation[5],
          ]
        : null,
      // El binario no transporta el SeriesInstanceUID, y no le hace falta: el
      // servidor ya descartó los cortes de otras series antes de empaquetarlo, así
      // que esto ES una sola serie por construcción. `null` es lo honesto —"aquí
      // no consta"— y deja que el filtro de serie del visor caiga a los indicios,
      // que en un volumen ya homogéneo no descarta nada.
      seriesUid: null,
      pixelSpacing: [dx, dy],
      zSpacing: dz,
    };
  }
  return {
    meta: {
      count,
      rows,
      cols,
      dx,
      dy,
      dz,
      center,
      width,
      invert,
      hasRealSpacing,
      sourceGeometry,
      zVariable,
      droppedForeign,
      imageOrientation,
    },
    slices,
  };
}

// Sufijo del derivado lite hermano en storage (igual patrón que `.web.glb`).
//
// 🔴 EL NÚMERO DEL SUFIJO ES LA VERSIÓN DEL CONTENIDO, y subirlo es la ÚNICA
// forma de invalidar un lite ya generado: el endpoint sirve el objeto cacheado
// sin abrirlo, así que un binario con la ruta vieja no se rehace jamás (salvo
// `?force=1`, que es solo para ADMIN y va de uno en uno). Súbelo cuando el
// binario deje de significar lo mismo, no cuando solo se le añada un campo que
// el lector viejo pueda ignorar.
//   v1 (`.lite.bin`)  — sin geometría de paciente.
//   v2 (`.lite2.bin`) — trae la procedencia del orden (byte 7) y el
//                       ImageOrientationPatient del estudio. De esos dos datos
//                       cuelgan el volteo vertical de coronal/sagital y las
//                       letras anatómicas del móvil: con el binario v1 el
//                       teléfono no voltea y el escritorio sí, o sea el mismo
//                       CBCT del revés según el aparato. Por eso aquí no valía
//                       degradar con elegancia; había que rehacerlo.
export const CBCT_LITE_SUFFIX = ".lite2.bin";
// Variante de ALTA resolución (opt-in "HD" en el visor): 384² en plano vs 256.
export const CBCT_LITE_HI_SUFFIX = ".lite2-hi.bin";
export const CBCT_LITE_CONTENT_TYPE = "application/octet-stream";
