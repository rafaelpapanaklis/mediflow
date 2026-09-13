/**
 * WS1-T6 — formatos de logo que sí pintan en los PDF.
 *
 * Run: npm run test:clinic-logo
 *
 * Antes de este archivo, `esMimeDeLogoValido`/`esUrlDeLogoValida` no
 * existían: `npm run test:clinic-logo` falla con
 * "Cannot find module '../clinic-logo'" contra `origin/main`. Con este
 * cambio existen y hacen cumplir la regla real — `@react-pdf` no pinta
 * webp/gif/svg — que hasta ahora nada validaba: `PATCH /api/settings`
 * copiaba `logoUrl` tal cual, así que una clínica podía terminar con un logo
 * que se ve en su mini-web y sale en blanco en sus facturas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { esMimeDeLogoValido, esUrlDeLogoValida, LOGO_ALLOWED_MIME_TYPES } from "../clinic-logo";

test("acepta los MIME que @react-pdf sí pinta", () => {
  assert.equal(esMimeDeLogoValido("image/png"), true);
  assert.equal(esMimeDeLogoValido("image/jpeg"), true);
});

test("rechaza los formatos que @react-pdf deja en blanco", () => {
  assert.equal(esMimeDeLogoValido("image/webp"), false);
  assert.equal(esMimeDeLogoValido("image/gif"), false);
  assert.equal(esMimeDeLogoValido("image/svg+xml"), false);
});

test("LOGO_ALLOWED_MIME_TYPES no se contamina con webp/gif/svg", () => {
  for (const bloqueado of ["image/webp", "image/gif", "image/svg+xml", "application/pdf"]) {
    assert.equal((LOGO_ALLOWED_MIME_TYPES as readonly string[]).includes(bloqueado), false);
  }
});

test("esUrlDeLogoValida acepta png/jpg/jpeg por extensión, http(s)", () => {
  assert.equal(esUrlDeLogoValida("https://x.supabase.co/storage/v1/landing/c1/logo/1.png"), true);
  assert.equal(esUrlDeLogoValida("https://x.supabase.co/storage/v1/landing/c1/logo/1.jpg"), true);
  assert.equal(esUrlDeLogoValida("https://x.supabase.co/storage/v1/landing/c1/logo/1.JPEG"), true);
});

test("esUrlDeLogoValida rechaza webp/gif/svg y esquemas no http(s)", () => {
  assert.equal(esUrlDeLogoValida("https://x.supabase.co/storage/v1/landing/c1/logo/1.webp"), false);
  assert.equal(esUrlDeLogoValida("https://x.supabase.co/storage/v1/landing/c1/logo/1.svg"), false);
  assert.equal(esUrlDeLogoValida("javascript:alert(1)"), false);
  assert.equal(esUrlDeLogoValida("ftp://x.com/a.png"), false);
});

test("esUrlDeLogoValida rechaza null/vacío/no-string (limpiar el logo se hace con logoUrl:null, no con esto)", () => {
  assert.equal(esUrlDeLogoValida(null), false);
  assert.equal(esUrlDeLogoValida(""), false);
  assert.equal(esUrlDeLogoValida(undefined), false);
});
