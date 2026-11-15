// ws6-t8 — el botón «WhatsApp» de un cliente en el panel abre SU chat en
// Mensajes cuando se puede, y wa.me cuando no (nunca un botón muerto).
//
//   npx tsx --test src/lib/barber/__tests__/wa-chat.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  barberMensajesHref,
  barberMensajesTextoInicial,
  barberWaChatAcceso,
  barberWaChatDestino,
  barberWaMeHref,
  BARBER_WA_CHAT_SIN_ACCESO,
} from "@/lib/barber/wa-chat-core";

const TODO = { paid: true, planInbox: true, canView: true, canSend: true, credenciales: true };
const CONECTADO = barberWaChatAcceso(TODO);
const SOLO_LEE = barberWaChatAcceso({ ...TODO, canSend: false });

test("acceso: hace falta TODO (pagado, plan, permiso de ver y WhatsApp conectado)", () => {
  assert.deepEqual(CONECTADO, { inbox: true, send: true });
  assert.deepEqual(SOLO_LEE, { inbox: true, send: false });
  for (const falta of ["paid", "planInbox", "canView", "credenciales"] as const) {
    assert.deepEqual(barberWaChatAcceso({ ...TODO, [falta]: false }), BARBER_WA_CHAT_SIN_ACCESO, falta);
  }
});

test("conectado + permiso → Mensajes con su teléfono (exista o no la conversación)", () => {
  for (const phone of ["9992602093", "999 260 2093", "+52 999 260 2093", "5219992602093"]) {
    assert.deepEqual(barberWaChatDestino({ acceso: CONECTADO, phone }), {
      href: "/barber/mensajes?tel=9992602093",
      interno: true,
    });
  }
  // Rol que solo lee: igual entra a leer el chat.
  assert.equal(barberWaChatDestino({ acceso: SOLO_LEE, phone: "9992602093" }).interno, true);
});

test("sin WhatsApp conectado o sin permiso → wa.me como hoy", () => {
  for (const acceso of [
    BARBER_WA_CHAT_SIN_ACCESO,
    barberWaChatAcceso({ ...TODO, credenciales: false }),
    barberWaChatAcceso({ ...TODO, canView: false }),
  ]) {
    assert.deepEqual(barberWaChatDestino({ acceso, phone: "9992602093" }), {
      href: "https://wa.me/529992602093",
      interno: false,
    });
  }
});

test("teléfono que no es de 10 dígitos → wa.me (Mensajes no lo abriría)", () => {
  const d = barberWaChatDestino({ acceso: CONECTADO, phone: "12345" });
  assert.equal(d.interno, false);
  assert.equal(d.href, "https://wa.me/12345");
  assert.equal(barberWaChatDestino({ acceso: CONECTADO, phone: null }).href, "https://wa.me/");
});

test("wa.me y la dirección de Mensajes", () => {
  assert.equal(barberWaMeHref("999-260-2093"), "https://wa.me/529992602093");
  assert.equal(barberWaMeHref("529992602093", "a b"), "https://wa.me/529992602093?text=a%20b");
  assert.equal(barberMensajesHref("9992602093"), "/barber/mensajes?tel=9992602093");
  assert.equal(barberMensajesTextoInicial("  hola  "), "hola");
  assert.equal(barberMensajesTextoInicial(["a", "b"]), null);
  assert.equal(barberMensajesTextoInicial("   "), null);
  assert.equal(barberMensajesTextoInicial("x".repeat(5000))?.length, 4000);
});

// ── Ningún botón del panel para hablar con UN cliente se queda en wa.me ──
// Lo que sí puede llevar wa.me en el panel: compartir con quien sea
// (afiliados, un producto de la tienda) y el WhatsApp de DaleControl.
const RAIZ = join(__dirname, "..", "..", "..", "..");
const PERMITIDOS_PANEL = new Set([
  "src/components/barber/afiliados/afiliados-screen.tsx", // compartir tu liga de afiliado
  "src/components/barber/billing/billing-screen.tsx", // hablar con DaleControl
  "src/components/barber/products/productos-client.tsx", // compartir un producto (waMeLink)
]);
// Pantallas del CLIENTE (él le escribe a la barbería): wa.me está bien.
const PUBLICOS = [
  "src/components/barber/booking/",
  "src/components/barber/portal/",
  "src/components/barber/tienda/",
  "src/components/barber/templates/",
  "src/components/barber/landing/",
];

function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n !== "__tests__") out.push(...archivos(p));
    } else if (/\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

test("panel: no queda un wa.me directo en botones de un cliente", () => {
  const sueltos: string[] = [];
  for (const base of ["src/components/barber", "src/app/barber/(panel)"]) {
    for (const f of archivos(join(RAIZ, base))) {
      const rel = relative(RAIZ, f).split("\\").join("/");
      if (PERMITIDOS_PANEL.has(rel) || PUBLICOS.some((p) => rel.startsWith(p))) continue;
      const src = readFileSync(f, "utf8");
      if (src.includes("https://wa.me") || src.includes("waMeLink(")) sueltos.push(rel);
    }
  }
  // Ticket y pedidos llevan un texto ya escrito: van en el punto 4.
  assert.deepEqual(sueltos.sort(), ["src/components/barber/cash/ticket-print.tsx", "src/components/barber/products/pedidos.tsx"]);
});

test("los botones del tablero usan ChatClienteLink", () => {
  for (const rel of [
    "src/components/barber/agenda/cita-piezas.tsx",
    "src/components/barber/clients/client-detail.tsx",
    "src/components/barber/walkin/walkin-panel.tsx",
    "src/app/barber/(panel)/solicitudes/solicitudes-client.tsx",
  ]) {
    assert.match(readFileSync(join(RAIZ, rel), "utf8"), /<ChatClienteLink[\s>]/, rel);
  }
  // El layout del panel es quien da el acceso (sin él, todo es wa.me).
  const layout = readFileSync(join(RAIZ, "src/app/barber/(panel)/layout.tsx"), "utf8");
  assert.match(layout, /<BarberWaChatProvider value=\{waChat\}>/);
  assert.match(layout, /getBarberWaChatAcceso\(ctx, plan, paid\)/);
});
