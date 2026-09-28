import { test } from "node:test";
import assert from "node:assert/strict";
import { CAJA_DEL_TRAZADO, datosDelTrazado, mimeDeImagen, puntosEnLaCaja } from "../datos-del-trazado";

const fila = {
  kind: "PROGRESS",
  analysisType: "STEINER",
  normSet: "MEXICAN",
  points: { S: { x: 10, y: 20 }, N: { x: 50, y: 25 }, raro: { x: "a" } },
  calibrationMmPerPixel: null,
  createdAt: new Date("2026-09-01T10:00:00Z"),
};

const base = {
  fila,
  cabecera: { clinicName: "Clínica" },
  patientName: "Ana López",
  patientDobIso: null,
  doctorName: "Dra. X",
  doctorCedula: null,
  ahora: new Date("2026-09-28T00:00:00Z"),
};

test("los puntos pasan de % de la caja 3:4 a la caja del PDF, y lo que no es punto se descarta", () => {
  const p = puntosEnLaCaja(fila.points) as Record<string, { x: number; y: number }>;
  assert.deepEqual(p.S, { x: 30, y: 80 });
  assert.equal(p.raro, undefined);
  assert.deepEqual(CAJA_DEL_TRAZADO, { widthPx: 300, heightPx: 400 });
});

test("con radiografía: imagen en la caja, puntos y etiquetas", () => {
  const d = datosDelTrazado({ ...base, imagenDataUrl: "data:image/png;base64,AA==" });
  assert.equal(d.analysisLabel, "Steiner");
  assert.equal(d.normSetLabel, "Norma mexicana");
  assert.equal(d.kindLabel, "Progreso");
  assert.deepEqual(d.image, { url: "data:image/png;base64,AA==", widthPx: 300, heightPx: 400 });
  assert.equal(d.points.length, 2);
  assert.ok(d.rows.length > 0);
  assert.equal(d.calibrationPxPerMm, null);
});

test("sin radiografía: solo la tabla; un análisis desconocido cae a Steiner", () => {
  const d = datosDelTrazado({ ...base, fila: { ...fila, analysisType: "OTRO" }, imagenDataUrl: null });
  assert.equal(d.image, null);
  assert.deepEqual(d.points, []);
  assert.equal(d.analysisLabel, "Steiner");
});

test("mimeDeImagen reconoce PNG y JPEG y nada más", () => {
  assert.equal(mimeDeImagen(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(mimeDeImagen(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(mimeDeImagen(new Uint8Array([0x3c, 0x68, 0x74, 0x6d])), null);
});
