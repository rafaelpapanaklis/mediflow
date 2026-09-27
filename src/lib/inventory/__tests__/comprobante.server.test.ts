// Ajuste 1 — solo las ramas de validación que se resuelven ANTES de tocar la
// base o el storage (tipo/tamaño): el resto (subida real a Supabase Storage)
// se prueba en QA en vivo, no aquí — mockear @/lib/storage entero para esto
// no valía el esfuerzo frente a un ajuste de este tamaño.
import { test } from "node:test";
import assert from "node:assert/strict";
import { subirComprobanteDeCompra, ComprobanteInvalidoError } from "../comprobante.server";

function archivoFalso(overrides: Partial<{ type: string; size: number; name: string }> = {}): File {
  return {
    type: overrides.type ?? "image/jpeg",
    size: overrides.size ?? 1024,
    name: overrides.name ?? "ticket.jpg",
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as File;
}

// db que revienta si algo la llama — estas dos pruebas deben cortar ANTES.
const dbQueNuncaDebeLlamarse = new Proxy({}, {
  get() { throw new Error("no debía tocar la base: la validación de tipo/tamaño va antes"); },
}) as any;

test("subirComprobanteDeCompra: rechaza un tipo no permitido antes de tocar la base", async () => {
  await assert.rejects(
    () => subirComprobanteDeCompra(
      { clinicId: "c1", purchaseId: "p1", file: archivoFalso({ type: "application/zip" }) },
      dbQueNuncaDebeLlamarse,
    ),
    ComprobanteInvalidoError,
  );
});

test("subirComprobanteDeCompra: rechaza un archivo mayor a 15MB antes de tocar la base", async () => {
  await assert.rejects(
    () => subirComprobanteDeCompra(
      { clinicId: "c1", purchaseId: "p1", file: archivoFalso({ size: 16 * 1024 * 1024 }) },
      dbQueNuncaDebeLlamarse,
    ),
    ComprobanteInvalidoError,
  );
});
