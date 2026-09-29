// H26 (revisión final, ws1-t4): sin WhatsApp conectado, «Pedir anticipo» lo
// dice antes en vez de ofrecer «Pedir y enviar por WhatsApp».
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "../../../..");
const leer = (r: string) => readFileSync(join(RAIZ, r), "utf8");

test("los dos GET dicen si hay WhatsApp con el mismo criterio que el POST", () => {
  for (const r of ["src/app/api/appointments/[id]/anticipo/route.ts", "src/app/api/invoices/[id]/anticipo/route.ts"]) {
    const src = leer(r);
    assert.match(src, /conectado: !!\(clinica\?\.waConnected && clinica\.waPhoneNumberId && clinica\.waAccessToken\)/, r);
    assert.match(src, /puedeEnviar: denyIfMissingPermission\(ctx, "whatsapp\.send"\) === null/, r);
    assert.doesNotMatch(src, /waAccessToken: clinica/, `${r}: el token nunca sale`);
  }
});

test("el modal esconde el botón y explica por qué", () => {
  const modal = leer("src/components/dashboard/billing/modal-pedir-anticipo.tsx");
  assert.match(modal, /\{!motivoSinWhatsApp && \(\s*<ButtonNew variant="secondary"/);
  assert.match(modal, /Esta clínica no tiene WhatsApp conectado: pide el anticipo y comparte el texto o el PDF por otro medio\./);
  assert.match(modal, /if \(!w\) return null;/, "sin el dato (servidor viejo), se ofrece como antes");
});
