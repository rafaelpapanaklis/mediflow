// RONDA 3 · M7 (revisora ws6-t3): al devolver un anticipo, lo que va a pasar
// con el dinero se lee ANTES de confirmar, no después de haberlo devuelto.
//
// Prueba ESTÁTICA (lee el código y los diccionarios; sin base ni navegador):
//   · el botón «Devolver» de la lista no manda nada al servidor: abre el
//     diálogo;
//   · el único sitio que pide la devolución es el botón de confirmar de ese
//     diálogo, que va DESPUÉS del aviso;
//   · el aviso dice las tres cosas que importan (turno abierto, ticket
//     negativo de hoy, baja el esperado y el ingreso), en es y en.
//
//   npx tsx --test src/lib/barber/__tests__/devolver-anticipo-aviso.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getBarberDict } from "@/i18n/dictionaries/barber";

const ROOT = join(__dirname, "..", "..", "..", "..");
const src = readFileSync(join(ROOT, "src/components/barber/memberships/deposits-tab.tsx"), "utf8");

function text(locale: "es" | "en", path: string): string {
  let node: unknown = getBarberDict(locale);
  for (const part of path.split(".")) node = (node as Record<string, unknown>)?.[part];
  assert.equal(typeof node, "string", `[${locale}] falta ${path}`);
  return node as string;
}

test("«Devolver» en la lista abre el diálogo; no devuelve nada por sí solo", () => {
  const listStart = src.indexOf('t("barber.membresias.anticipos.list.refund")');
  assert.ok(listStart > 0, "sigue existiendo el botón Devolver de la lista");
  const button = src.slice(src.lastIndexOf("<button", listStart), listStart);
  assert.match(button, /setRefunding\(d\)/, "el botón abre el diálogo de devolución");
  assert.doesNotMatch(button, /apiCall|action: "refund"/, "y no llama al servidor");
  assert.doesNotMatch(src, /window\.confirm\([^)]*refund/i, "ya no es un confirm() del navegador");
});

test("la devolución solo se pide desde el botón de confirmar, y el aviso va antes", () => {
  const posts = src.split('action: "refund"').length - 1;
  assert.equal(posts, 1, "un solo sitio manda la devolución al servidor");
  const modal = src.slice(src.indexOf("function RefundDepositModal("));
  assert.ok(modal.includes('action: "refund"'), "ese sitio es el diálogo");

  // Dentro de lo que se pinta: primero el aviso, luego el error del servidor.
  const body = modal.slice(modal.indexOf("<div style={{ display"));
  const iWarning = body.indexOf('t("barber.membresias.anticipos.refund.warning"');
  const iError = body.indexOf("{error ?");
  assert.ok(iWarning > 0 && iError > iWarning, "el aviso se ve siempre, antes de cualquier resultado");
  assert.match(modal, /onClick=\{submit\}/, "confirmar es un clic explícito");
});

test("el aviso dice lo que va a pasar con el dinero, en español y en inglés", () => {
  const es = text("es", "barber.membresias.anticipos.refund.warning");
  assert.match(es, /Antes de confirmar/);
  assert.match(es, /turno abierto/);
  assert.match(es, /ticket negativo/);
  assert.match(es, /efectivo esperado/);
  assert.match(es, /ingreso/);
  assert.match(es, /\{amount\}/);

  const en = text("en", "barber.membresias.anticipos.refund.warning");
  assert.match(en, /Before you confirm/);
  assert.match(en, /open shift/);
  assert.match(en, /negative/);
  assert.match(en, /expected cash/);
  assert.match(en, /\{amount\}/);

  for (const key of ["title", "who", "howReturned", "sameMethod", "confirm"]) {
    text("es", `barber.membresias.anticipos.refund.${key}`);
    text("en", `barber.membresias.anticipos.refund.${key}`);
  }
});
