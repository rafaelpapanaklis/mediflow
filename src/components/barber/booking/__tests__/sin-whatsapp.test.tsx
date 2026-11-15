/* ═══════════════════════════════════════════════════════════════════════
   SIN WHATSAPP CONECTADO NO SE PROMETE WHATSAPP.

     npx tsx --tsconfig tsconfig.test.json \
       src/components/barber/booking/__tests__/sin-whatsapp.test.tsx

   Pulido · punto 1 (M1 de la revisión de ws6-t3). La pantalla final de la
   reserva pública:
     · con WhatsApp conectado → como siempre («por WhatsApp», «Ver mis citas»);
     · sin WhatsApp → «La barbería te confirma.» y SIN «Ver mis citas» (el
       código de acceso solo sale por WhatsApp).
   El sí/no lo resuelve el servidor (barberiaTieneWhatsApp) y al navegador
   solo llega un booleano.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import Module from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { BookingDone, type BookingConfirmation } from "../booking-done";
import type { PublicBarbershopDTO } from "@/lib/barber/booking-core";

const shop: PublicBarbershopDTO = {
  id: "s1",
  name: "Barbería Prueba",
  slug: "prueba",
  phone: null,
  address: null,
  city: null,
  state: null,
  timezone: "America/Mexico_City",
  locale: "es",
  logoUrl: null,
  branchName: null,
};

const pendiente: BookingConfirmation = {
  reference: "ABC123",
  status: "PENDING",
  startAt: "2026-11-16T17:00:00.000Z",
  endAt: "2026-11-16T17:30:00.000Z",
  barberName: "Luis",
  services: [{ name: "Corte", price: 100 }],
  total: 100,
  duplicate: false,
  clientName: "Ana Pérez",
};

function pinta(whatsappConnected: boolean | undefined, confirmation = pendiente): string {
  return renderToStaticMarkup(
    createElement(BookingDone, { slug: "prueba", shop, confirmation, whatsappConnected }),
  );
}

test("con WhatsApp conectado: igual que hoy (promete WhatsApp y ofrece «Ver mis citas»)", () => {
  for (const flag of [true, undefined]) {
    const html = pinta(flag);
    assert.match(html, /La barbería te confirma en un momento por WhatsApp\./);
    assert.match(html, /Ver mis citas/);
    assert.match(html, /\/b\/prueba\/mi-cuenta/);
  }
});

test("sin WhatsApp: «La barbería te confirma.» a secas y sin «Ver mis citas»", () => {
  const html = pinta(false);
  assert.match(html, /La barbería te confirma\./);
  assert.doesNotMatch(html, /por WhatsApp/);
  assert.doesNotMatch(html, /Ver mis citas/);
  assert.doesNotMatch(html, /mi-cuenta/);
  // «Reservar otra» sigue ahí.
  assert.match(html, /\/b\/prueba\/reservar/);
});

test("sin WhatsApp, una cita ya confirmada tampoco ofrece «Ver mis citas»", () => {
  const html = pinta(false, { ...pendiente, status: "CONFIRMED" });
  assert.match(html, /Tu lugar está apartado\./);
  assert.doesNotMatch(html, /Ver mis citas/);
});

test("el formulario cambia la ayuda del teléfono y el aviso legal según el dato del servidor", () => {
  const flujo = readFileSync(path.resolve(__dirname, "../booking-flow.tsx"), "utf8");
  assert.match(flujo, /whatsappConnected = true/);
  assert.match(flujo, /barber\.reserva\.datos\.telefonoAyudaSinWa/);
  assert.match(flujo, /barber\.reserva\.datos\.avisoSinWa/);
  assert.match(flujo, /whatsappConnected=\{whatsappConnected\}/);
  const pagina = readFileSync(
    path.resolve(__dirname, "../../../../app/b/[slug]/reservar/page.tsx"),
    "utf8",
  );
  assert.match(pagina, /barberiaTieneWhatsApp\(shop\.id\)/);
  assert.match(pagina, /whatsappConnected=\{whatsappConnected\}/);
});

test("barberiaTieneWhatsApp: solo un booleano; número y token presentes = true; todo lo demás = false", async () => {
  const filas: Record<string, unknown> = {
    ok: { phoneNumberId: "123", whatsappToken: "tok" },
    sinToken: { phoneNumberId: "123", whatsappToken: null },
    sinNumero: { phoneNumberId: null, whatsappToken: "tok" },
  };
  const load = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
  const original = load;
  (Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
    if (request === "@/lib/prisma" || request.endsWith("/lib/prisma")) {
      return {
        prisma: {
          barbershop: {
            findUnique: async ({ where }: { where: { id: string } }) => {
              if (where.id === "boom") throw new Error("base caída");
              return filas[where.id] ?? null;
            },
          },
        },
      };
    }
    return original.call(this, request, ...rest);
  };
  try {
    const { barberiaTieneWhatsApp } = await import("@/lib/barber/wa-conectado");
    assert.equal(await barberiaTieneWhatsApp("ok"), true);
    assert.equal(await barberiaTieneWhatsApp("sinToken"), false);
    assert.equal(await barberiaTieneWhatsApp("sinNumero"), false);
    assert.equal(await barberiaTieneWhatsApp("no-existe"), false);
    assert.equal(await barberiaTieneWhatsApp("boom"), false);
    assert.equal(await barberiaTieneWhatsApp(""), false);
    assert.equal(typeof (await barberiaTieneWhatsApp("ok")), "boolean");
  } finally {
    (Module as unknown as { _load: unknown })._load = original;
  }
});
