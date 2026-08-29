// Generador SERVER-ONLY del CBCT "lite": descomprime el .zip del estudio, decodifica
// los cortes (reutilizando el núcleo DICOM del visor, que corre igual en Node) y
// produce un volumen REDUCIDO (~256×256 × ~180 cortes) empaquetado con
// encodeCbctLite. El móvil descarga ESE binario (~10-25 MB) en lugar de los
// 300-600 MB originales, que no caben en la RAM de un iPhone.
//
// Memoria: NO acumula el estudio full-res. Decodifica corte a corte y reduce en
// plano (XY) AL VUELO, reteniendo solo los cortes ya pequeños; el submuestreo en
// Z se aplica después de ordenar. Así el pico del servidor queda muy por debajo
// del estudio completo (cabe holgado en los ~3 GB de una función Vercel Pro).
//
// Patrón análogo al de src/lib/mesh-to-glb.ts (derivado web generado en servidor).

import JSZip from "jszip";
import {
  decodeSliceAsync,
  isDicomEntryName,
  type DecodedSlice,
  type ImageOrientation,
  type SliceOrderSource,
} from "@/components/patient-3d/dicom-decode-core";
import {
  encodeCbctLite,
  type CbctLiteMeta,
  type CbctLiteSourceGeometry,
} from "@/components/patient-3d/cbct-lite-shared";
// El orden de la pila y la medida del espaciado salen del MISMO módulo puro que
// usa el visor de escritorio. Es lo único que garantiza que el volumen del móvil
// y el del monitor sean el mismo volumen; mientras cada lado tuvo su copia, el
// mismo estudio se apilaba distinto y nadie estaba en posición de notarlo.
import {
  isPhysicallyOrdered,
  measureZSpacing,
  sameOrientation,
  sortSlicesForVolume,
} from "@/components/patient-3d/cbct-mpr-shared";

// Topes del volumen lite. ~256² en plano × ~180 cortes Int16 ≈ 23 MB máx.
const TARGET_XY = 256;
const TARGET_Z = 180;

// Box-average de un corte Int16 (rows×cols) a (rows/yStep)×(cols/xStep). Promediar
// (no decimar) reduce el aliasing y conserva trabéculas. No-op si los factores son 1.
function downsampleSliceXY(
  px: Int16Array,
  rows: number,
  cols: number,
  xStep: number,
  yStep: number,
): { pixels: Int16Array; rows: number; cols: number } {
  if (xStep <= 1 && yStep <= 1) return { pixels: px, rows, cols };
  const W = Math.max(1, Math.floor(cols / xStep));
  const H = Math.max(1, Math.floor(rows / yStep));
  const out = new Int16Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = y * yStep;
    for (let x = 0; x < W; x++) {
      const x0 = x * xStep;
      let sum = 0;
      let n = 0;
      for (let dy = 0; dy < yStep; dy++) {
        const r = y0 + dy;
        if (r >= rows) break;
        const rowOff = r * cols;
        for (let dx = 0; dx < xStep; dx++) {
          const c = x0 + dx;
          if (c >= cols) break;
          sum += px[rowOff + c];
          n++;
        }
      }
      out[y * W + x] = n > 0 ? Math.round(sum / n) : 0;
    }
  }
  return { pixels: out, rows: H, cols: W };
}

interface ReducedSlice {
  pixels: Int16Array;
  rows: number;
  cols: number;
  order: number;
  // De dónde salió `order` en el corte ORIGINAL. Este campo es la única memoria
  // que queda de la geometría del .zip: el binario lite no transporta
  // ImagePositionPatient, así que si no se conserva aquí y se resume en la
  // cabecera, el móvil pierde para siempre la forma de saber si el volumen que
  // recibe está ordenado por geometría real o apilado a ciegas.
  orderSource: SliceOrderSource;
  // Geometría de paciente del corte ORIGINAL. Al binario solo viaja el IOP, y una
  // sola vez en la cabecera; estos tres campos hacen falta AQUÍ para que el
  // servidor pueda ordenar la pila y medir el espaciado con las mismas funciones
  // que el escritorio, en vez de con una copia suya que se desincroniza.
  imagePosition: [number, number, number] | null;
  planeNormal: [number, number, number];
  imageOrientation: ImageOrientation | null;
  seriesUid: string | null;
  center: number;
  width: number;
  invert: boolean;
  pixelSpacing: [number, number];
  zSpacing: number;
}

export interface BuildCbctLiteResult {
  bytes: Uint8Array;
  meta: CbctLiteMeta;
  sourceSlices: number; // cortes del estudio ANTES del submuestreo en Z (para logging)
}

/**
 * Construye el binario lite a partir del .zip del CBCT. Lanza con un mensaje claro
 * si el zip no trae cortes legibles. `input` acepta lo que JSZip entiende (Blob /
 * ArrayBuffer / Uint8Array) — en el endpoint llega el Blob de Supabase Storage.
 */
export async function buildCbctLite(
  input: ArrayBuffer | Uint8Array | Blob,
  targetXY: number = TARGET_XY,
  targetZ: number = TARGET_Z,
): Promise<BuildCbctLiteResult> {
  // JSZip en Node NO soporta Blob (su lectura de Blob usa FileReader, solo navegador).
  // supabase.storage.download() devuelve un Blob -> convertir a Uint8Array, o JSZip lanza
  // "Can't read the data of the loaded zip file".
  const zipInput =
    input instanceof Uint8Array || input instanceof ArrayBuffer
      ? input
      : new Uint8Array(await (input as Blob).arrayBuffer());
  const zip = await JSZip.loadAsync(zipInput);
  const entries = (Object.values(zip.files) as any[]).filter((f) => !f.dir && isDicomEntryName(f.name));
  if (entries.length === 0) throw new Error("El .zip no contiene cortes DICOM legibles");

  // 1) Decodifica cada entrada y reduce XY AL VUELO (descarta el full-res).
  let xStep = 0;
  let yStep = 0;
  let baseRows = 0;
  let baseCols = 0;
  let baseSeries: string | null | undefined; // SeriesInstanceUID del primer corte
  let foreign = 0; // cortes descartados por ser de otra serie
  const reduced: ReducedSlice[] = [];
  for (const entry of entries) {
    let frames: DecodedSlice[] | null = null;
    try {
      const buf: ArrayBuffer = await entry.async("arraybuffer");
      frames = await decodeSliceAsync(buf, reduced.length);
    } catch {
      frames = null; // corte inválido / comprimido no soportado: se salta
    }
    if (!frames) continue;
    for (const s of frames) {
      if (baseRows === 0) {
        baseRows = s.rows;
        baseCols = s.cols;
        baseSeries = s.seriesUid;
        xStep = Math.max(1, Math.ceil(s.cols / targetXY));
        yStep = Math.max(1, Math.ceil(s.rows / targetXY));
      }
      // Se descarta por RASTER y también por SERIE. El raster solo no bastaba: dos
      // adquisiciones del mismo paciente pueden compartir matriz y colarse enteras
      // dentro del volumen sin que nada falle al pintar —el visor de escritorio las
      // separa por SeriesInstanceUID y aquí no había con qué—. Con el UID delante,
      // la intrusa se cuenta como ajena y el binario sale con una sola serie.
      const otraSerie = !!baseSeries && !!s.seriesUid && s.seriesUid !== baseSeries;
      if (s.rows !== baseRows || s.cols !== baseCols || otraSerie) {
        foreign++;
        continue;
      }
      const ds = downsampleSliceXY(s.pixels, s.rows, s.cols, xStep, yStep);
      reduced.push({
        pixels: ds.pixels,
        rows: ds.rows,
        cols: ds.cols,
        order: s.order,
        orderSource: s.orderSource,
        imagePosition: s.imagePosition,
        planeNormal: s.planeNormal,
        imageOrientation: s.imageOrientation,
        seriesUid: s.seriesUid,
        center: s.center,
        width: s.width,
        invert: s.invert,
        pixelSpacing: s.pixelSpacing,
        zSpacing: s.zSpacing,
      });
    }
  }
  if (reduced.length === 0) throw new Error("No se pudo decodificar ningún corte del estudio");
  // El raster de referencia es el del PRIMER corte que se decodifica, y ese orden
  // lo pone el .zip. Aquí no se puede elegir el mayoritario como hace el visor de
  // escritorio: este bucle reduce cada corte AL VUELO y tira el full-res, que es
  // justo lo que permite procesar un estudio de 3 GB en una función; para votar
  // habría que haberlos guardado todos. Lo que sí se puede es no entregar un
  // volumen construido sobre la serie equivocada: si se descartó TANTO COMO o más
  // de lo que se guardó, el primer corte no era de la serie principal —el caso del
  // scout que entra antes que el volumen— y el lite saldría siendo la imagen de
  // localización. Mejor un error que el móvil sabe explicar que un estudio de
  // mentira. El `>=` y no `>` es deliberado: con 10 scouts y 10 cortes de volumen,
  // `>` no saltaba y el teléfono recibía los scouts como si fueran el CBCT.
  if (foreign >= reduced.length) {
    throw new Error(
      `El .zip mezcla series de distinto tamaño (${reduced.length} cortes de ${baseRows}×${baseCols} frente a ${foreign} de otro formato) y la primera no es la principal`,
    );
  }

  // 2) Orden Z real (el zip puede traer los cortes desordenados). Se usa EL MISMO
  //    comparador que el escritorio (sortSlicesForVolume) y no el `a.order - b.order`
  //    de siempre. No es cosmética: desde que `order` puede venir en milímetros con
  //    signo, la resta cruda baraja un set en el que conviven cortes con posición y
  //    cortes sin ella —intercala mm con índices— y deja fuera del volumen los
  //    `order` no finitos. Con dos comparadores distintos, el escritorio anclaba los
  //    cortes huérfanos en su ranura y el servidor los repartía por todo el volumen:
  //    el mismo estudio, apilado de dos formas, y ninguna de las dos pantallas podía
  //    ver a la otra para notarlo.
  sortSlicesForVolume(reduced);

  // 2.b) ¿De qué calidad es ESE orden? Se resume aquí, con los cortes originales
  //   todavía a mano, porque a partir del paso 3 ya no queda rastro: el binario
  //   lite no lleva posiciones y sus cortes se declaran "instance" siempre. Sin
  //   este resumen, el móvil no podría distinguir un volumen ordenado por
  //   geometría real de uno apilado por InstanceNumber, y avisar de "geometría no
  //   verificada" a todos por igual sería una advertencia falsa en la inmensa
  //   mayoría de los estudios (los que sí traen ImagePositionPatient).
  //
  //   ESTUDIO MEZCLADO (parte de los cortes con posición y parte sin) = DUDOSO,
  //   sin medias tintas. No es prudencia genérica: cuando conviven las dos ramas,
  //   los `order` están en unidades distintas —milímetros con signo (p. ej.
  //   −120..+60) frente a un índice entero (1..300)— y el sort de arriba no los
  //   invierte, los INTERCALA. El volumen resultante está barajado, que es peor
  //   que estar ordenado a ciegas; llamarlo "positioned" porque la mayoría traía
  //   posición sería afirmar una exactitud que nadie comprobó.
  //   Y NO BASTA CON QUE TODOS DECLAREN POSICIÓN: tiene que haber ordenado algo.
  //   Un estudio cuyos 300 cortes traen la MISMA ImagePositionPatient cumple
  //   `every(orderSource === "position")` y sin embargo su orden es el de llegada
  //   del .zip; uno con dos series mezcladas también lo cumple, y su volumen queda
  //   entrelazado. "positioned" es una promesa que el móvil usa para VOLTEAR la
  //   imagen y para rotular S/I, así que se exige la prueba entera: procedencia
  //   física en todos, una sola orientación, y una separación real medible.
  //   El juicio lo hace `isPhysicallyOrdered`, la MISMA función que usa el visor
  //   de escritorio para decidir si voltea y si rotula. Escrito dos veces, el
  //   móvil y el monitor podían responder distinto a la misma pregunta sobre el
  //   mismo estudio, que es el fallo que este arreglo entero viene a cerrar.
  const measured = measureZSpacing(reduced);
  const oneOrientation = sameOrientation(reduced);
  const sourceGeometry: CbctLiteSourceGeometry = isPhysicallyOrdered(reduced, measured)
    ? "positioned"
    : "unpositioned";

  // 3) Submuestreo en Z: 1 de cada zStep para no pasar de TARGET_Z cortes.
  const zStep = Math.max(1, Math.ceil(reduced.length / targetZ));
  const picked: ReducedSlice[] = [];
  for (let i = 0; i < reduced.length; i += zStep) picked.push(reduced[i]);

  const count = picked.length;
  const rows = picked[0].rows;
  const cols = picked[0].cols;
  const per = rows * cols;

  // 4) Concatena los píxeles + spacing físico AJUSTADO por los factores de reducción
  //    (cada vóxel del lite cubre xStep/yStep/zStep vóxeles originales, así que el mm
  //    por vóxel se multiplica — las proporciones físicas se conservan).
  const voxels = new Int16Array(count * per);
  for (let z = 0; z < count; z++) {
    const p = picked[z].pixels;
    voxels.set(p.length === per ? p : p.subarray(0, per), z * per);
  }
  const base = picked[0];
  const ps = base.pixelSpacing || [1, 1];
  const hasRealSpacing = !!(ps && (ps[0] !== 1 || ps[1] !== 1));
  const mid = picked[Math.floor(count / 2)] || base;

  // Espaciado entre cortes: el MEDIDO arriba de las posiciones reales, igual que
  // hace el escritorio, y solo si no hay medida se cae al header.
  //
  // Teniendo las posiciones delante, seguir creyéndole a SliceThickness era la
  // última pieza que hacía que el mismo estudio saliera con dos escalas según el
  // aparato: un CBCT con grosor declarado 0.4 y paso real 0.3 medía 120 mm de alto
  // en el teléfono y 90 en el monitor. Se midió sobre `reduced` (todos los cortes,
  // antes del submuestreo en Z) y se multiplica por zStep, porque cada corte del
  // lite representa zStep cortes del original.
  const dzBase = measured && measured.sz ? measured.sz : base.zSpacing || 1;

  // ImageOrientationPatient del estudio, para que el móvil pueda rotular los
  // bordes. Solo si TODOS los cortes coinciden: un .zip con dos series (el volumen
  // y un scout lateral) no tiene "una" orientación, y mandar la del primer corte
  // sería rotular el volumen con la lateralidad de otra imagen.
  const imageOrientation = oneOrientation ? reduced[0].imageOrientation : null;

  const meta: CbctLiteMeta = {
    count,
    rows,
    cols,
    dx: (ps[0] || 1) * xStep,
    dy: (ps[1] || 1) * yStep,
    dz: dzBase * zStep,
    center: mid.center,
    width: mid.width,
    invert: base.invert,
    hasRealSpacing,
    sourceGeometry,
    // El espaciado irregular viaja al binario para que el MÓVIL también lo pueda
    // advertir. Sin este bit, el mismo estudio avisaba en el escritorio y callaba
    // en el teléfono — la divergencia que este arreglo cierra.
    zVariable: !!measured?.variable,
    // Que hubo que descartar cortes de otro raster también viaja: el escritorio lo
    // sabe porque hace el filtrado delante del usuario, y el móvil recibe el
    // volumen ya filtrado. Sin este bit, el mismo .zip con dos series avisaba en
    // el monitor y se veía impecable en el teléfono.
    droppedForeign: foreign > 0,
    imageOrientation,
  };
  return { bytes: encodeCbctLite(meta, voxels), meta, sourceSlices: reduced.length };
}
