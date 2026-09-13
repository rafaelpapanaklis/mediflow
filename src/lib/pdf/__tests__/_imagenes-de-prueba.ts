/**
 * Imágenes de verdad fabricadas a mano, para las pruebas de la cabecera común.
 * Sin dependencias: un PNG mínimo se arma con zlib y un JPEG se declara con su
 * marcador SOF0, que es lo único que mira `imageAspect`.
 *
 * No es un `.test.ts`: no se ejecuta solo, lo importan las pruebas.
 */
import zlib from "node:zlib";

function crc32(buf: Buffer): number {
  let c: number;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** PNG opaco de w×h. Válido de verdad: @react-pdf lo pinta. */
export function makePng(w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x40);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0; // filtro "none"
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // profundidad de bit
  ihdr[9] = 2; // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** JPEG con APP0 + SOF0 de w×h: lo justo para que se lea la proporción. */
export function makeJpeg(w: number, h: number): Buffer {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2); // longitud del segmento
  sof[4] = 8; // precisión
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  sof[9] = 3; // componentes
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]), // APP0 corto
    sof,
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

/** Formatos que @react-pdf NO sabe pintar: tienen que descartarse al bajar. */
export const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x20, 0, 0, 0]),
  Buffer.from("WEBPVP8 "),
  Buffer.alloc(16, 0),
]);
export const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(20, 0)]);
export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
