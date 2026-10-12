/**
 * WhatsApp desde arriba + embudo en los botones de la portada (11-oct-2026,
 * ws1-t4, punto 1 del encargo de ws7). Run: npm run test:whatsapp-portada
 * (= tsx --test --tsconfig tsconfig.test.json: los botones son JSX).
 *
 * Fallan con el código anterior: no existían `enlaceWhatsapp`, los mensajes por
 * origen, `cta-embudo.tsx` ni la barra móvil, y la banda mandaba
 * `whatsapp_click` a gtag por su cuenta. (12-oct: la barra dejó de tocar
 * LiveChat —Rafael lo oculta en celular desde su configuración— y la prueba
 * vigila que siga sin tocarlo.)
 *
 * Sin navegador: `window`, gtag y storage simulados como en embudo.test.ts.
 * Los componentes de cta-embudo.tsx no usan hooks, así que se llaman como
 * funciones y se dispara el `onClick` del elemento que devuelven.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";
import { WHATSAPP_CTA, enlaceWhatsapp } from "../landing-data";
import { BotonWhatsapp, EnlaceEmpezar } from "../cta-embudo";
import { ANCHO_MOVIL_MAX, barraVisible } from "../barra-movil-logica";
import { GA4_MEASUREMENT_ID } from "@/lib/analytics/ga4";

const aqui = dirname(fileURLToPath(import.meta.url));
const v2 = join(aqui, "..");
const leer = (rel: string) => readFileSync(join(v2, rel), "utf8");

class Store {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
}
let llamadas: unknown[][] = [];
function navegador(pathname: string) {
  llamadas = [];
  (globalThis as Record<string, unknown>).window = {
    location: { pathname, search: "", origin: "https://dalecontrol.com" },
    localStorage: new Store(),
    sessionStorage: new Store(),
    gtag: (...a: unknown[]) => llamadas.push(a),
  };
}
beforeEach(() => navegador("/"));

type Elemento = { props: { href?: string; target?: string; rel?: string; onClick?: () => void } };

describe("el número vive en un solo sitio", () => {
  it("solo landing-data.ts lo tiene; hero, tarjetas, barra y banda lo toman de ahí", () => {
    const conNumero = readdirSync(v2)
      .filter((f) => /\.(tsx?|css)$/.test(f))
      .filter((f) => leer(f).includes(WHATSAPP_CTA.numberE164));
    assert.deepEqual(conNumero, ["landing-data.ts"]);
    assert.ok(!leer("../../../../../app/page.tsx").includes(WHATSAPP_CTA.numberE164));
  });

  it("wa.me sin «+» y con el mensaje del origen", () => {
    const u = new URL(enlaceWhatsapp("hero"));
    assert.equal(u.host, "wa.me");
    assert.equal(u.pathname, `/${WHATSAPP_CTA.numberE164}`);
    assert.ok(!/\+/.test(u.pathname));
    assert.equal(u.searchParams.get("text"), WHATSAPP_CTA.mensajes.hero);
  });
});

describe("mensaje precargado distinto según el botón", () => {
  it("hero, precio, barra móvil y banda no repiten texto", () => {
    const textos = (["hero", "precio", "barra_movil", "banda"] as const).map((o) => new URL(enlaceWhatsapp(o)).searchParams.get("text"));
    assert.equal(new Set(textos).size, 4);
    for (const t of textos) assert.ok(t && t.length > 20);
  });

  it("precio lleva el nombre del plan, y sin plan no deja un hueco", () => {
    const con = new URL(enlaceWhatsapp("precio", "Profesional")).searchParams.get("text")!;
    assert.match(con, /plan Profesional\./);
    assert.ok(!con.includes("{plan}"));
    const sin = new URL(enlaceWhatsapp("precio")).searchParams.get("text")!;
    assert.ok(!sin.includes("{plan}") && !sin.includes("sobre el plan"));
  });
});

describe("cada botón llama a registrarPaso (embudo.ts) UNA vez", () => {
  it("WhatsApp: whatsapp_clic con origen y plan, pestaña nueva, un solo evento", () => {
    // Al evento va el ID del plan (como en clic_empezar); al mensaje, el nombre legible.
    const el = BotonWhatsapp({ origen: "precio", plan: "CLINIC", planNombre: "Clínica", children: "x" }) as unknown as Elemento;
    assert.equal(el.props.href, enlaceWhatsapp("precio", "Clínica"));
    assert.match(decodeURIComponent(el.props.href!), /plan Clínica\./);
    assert.equal(el.props.target, "_blank");
    assert.match(el.props.rel ?? "", /noopener/);
    el.props.onClick!();
    assert.equal(llamadas.length, 1);
    assert.deepEqual(llamadas[0], ["event", "whatsapp_clic", { send_to: GA4_MEASUREMENT_ID, origen: "precio", plan: "CLINIC" }]);
  });

  it("Empezar: clic_empezar con su origen, sin cambiar el destino", () => {
    const el = EnlaceEmpezar({ origen: "barra_movil", href: "#precios", children: "x" }) as unknown as Elemento;
    assert.equal(el.props.href, "#precios");
    el.props.onClick!();
    assert.deepEqual(llamadas, [["event", "clic_empezar", { send_to: GA4_MEASUREMENT_ID, origen: "barra_movil" }]]);
  });

  it("en una ruta privada el clic no mide nada y el enlace sigue vivo", () => {
    navegador("/dashboard");
    const el = BotonWhatsapp({ origen: "hero", children: "x" }) as unknown as Elemento;
    el.props.onClick!();
    assert.equal(llamadas.length, 0);
    assert.ok(el.props.href?.startsWith("https://wa.me/"));
  });

  it("los cuatro orígenes están cableados en la portada y nadie llama a gtag/fbq aparte", () => {
    assert.match(leer("hero.tsx"), /origen="hero"[\s\S]*origen="hero"/);
    assert.match(leer("pricing-section.tsx"), /origen: "precio"/);
    assert.match(leer("pricing-section.tsx"), /origen="precio"/);
    assert.match(leer("barra-movil.tsx"), /origen="barra_movil"[\s\S]*origen="barra_movil"/);
    assert.match(leer("whatsapp-cta.tsx"), /origen="banda"/);
    for (const f of ["hero.tsx", "pricing-section.tsx", "barra-movil.tsx", "whatsapp-cta.tsx", "cta-embudo.tsx"]) {
      assert.ok(!/\bgtag\(|\bfbq\(|whatsapp_click/.test(leer(f)), `${f} mide por su cuenta`);
    }
    assert.match(leer("../../../../../app/page.tsx"), /<BarraMovil \/>/);
  });
});

describe("barra fija de móvil", () => {
  it("se ve cuando el hero sale de pantalla", () => {
    assert.equal(barraVisible(true), false);
    assert.equal(barraVisible(false), true);
  });

  it("la barra no toca LiveChat: Rafael lo oculta en celular desde su configuración", () => {
    // Un «minimize» nuestro podría volver a enseñar el lanzador que él ocultó.
    for (const f of ["barra-movil.tsx", "barra-movil-logica.ts"]) {
      assert.ok(!/LiveChatWidget|"hide"|"minimize"/.test(leer(f)), `${f} llama a LiveChat`);
    }
  });

  it("el CSS la limita al mismo quiebre de móvil y la tarjeta reserva la pista del enlace", () => {
    const css = leer("landing-v2.css");
    assert.match(css, new RegExp(`@media \\(max-width: ${ANCHO_MOVIL_MAX}px\\) \\{\\s*\\.dcv4-barra \\{`));
    assert.match(css, /\.dcv4-barra, \.dcv4-barra__hueco \{ display: none; \}/);
    assert.match(css, /\.dcv4-price__wa \{ grid-row: -2 \/ -1; \}/);
    assert.match(leer("pricing-section.tsx"), /\+ 3;/);
  });
});
