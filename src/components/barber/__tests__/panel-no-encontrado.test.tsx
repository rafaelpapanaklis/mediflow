/* ═══════════════════════════════════════════════════════════════════════
   «NO ENCONTRADO» DEL PANEL DE BARBER (QA de cierre D, 16-nov).

     npx tsx --tsconfig tsconfig.test.json --test \
       src/components/barber/__tests__/panel-no-encontrado.test.tsx

   Un Barbero que abría el recibo de comisiones de un compañero veía el 404
   de la raíz: el del dental, con un hospital y «Volver al inicio» llevando a
   otro producto. Aquí se fija que:
     · el panel tiene SU página (dentro de (panel), con menú y tema);
     · no trae nada del dental y vuelve a Inicio del panel;
     · está en español y en inglés;
     · el recibo responde LO MISMO si no existe que si es de otro barbero.
   ═══════════════════════════════════════════════════════════════════════ */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getBarberT } from "@/i18n/dictionaries/barber";

const M = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = M._load;
M._load = function (request: string, ...rest: unknown[]) {
  // Fuera de Next, el enlace es un <a> y basta para leer a dónde lleva.
  if (request === "next/link") {
    return {
      __esModule: true,
      default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) =>
        createElement("a", { href, className }, children),
    };
  }
  return originalLoad.call(this, request, ...rest);
};
after(() => {
  M._load = originalLoad;
});

const RAIZ = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), "utf8");
/** El código sin comentarios: los comentarios SÍ nombran al dental para explicar el porqué. */
const sinComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGINA = "src/app/barber/(panel)/not-found.tsx";
const RECIBO = "src/app/barber/(panel)/comisiones/recibo/[barberId]/page.tsx";
const LLAVES = ["barber.shell.notFound.title", "barber.shell.notFound.body", "barber.shell.notFound.cta"];

test("el panel tiene su propia página de «no encontrado», dentro de (panel)", () => {
  assert.ok(fs.existsSync(path.join(RAIZ, PAGINA)), `${PAGINA} tiene que existir`);
  const codigo = sinComentarios(leer(PAGINA));
  for (const k of LLAVES) assert.ok(codigo.includes(`"${k}"`), `usa ${k}`);
  assert.match(codigo, /export default async function/);
});

test("la tarjeta no trae nada del dental y vuelve a Inicio del panel (es y en)", async () => {
  const { BarberPanelNotFound } = await import("@/components/barber/barber-panel-not-found");
  for (const locale of ["es", "en"]) {
    const t = getBarberT(locale);
    const [title, body, cta] = LLAVES.map((k) => t(k));
    const html = renderToStaticMarkup(createElement(BarberPanelNotFound, { title, body, cta }));
    // react-dom escapa el apóstrofo de «couldn't».
    const enHtml = (s: string) => s.replace(/'/g, "&#x27;");
    assert.ok(html.includes(enHtml(title)) && html.includes(enHtml(body)) && html.includes(enHtml(cta)), `${locale}: pinta título, texto y botón`);
    assert.match(html, /<a[^>]*href="\/barber\/inicio"/, `${locale}: el botón lleva a Inicio del panel`);
    assert.doesNotMatch(html, /href="\/"/, `${locale}: nada lleva a la raíz del sitio`);
    assert.doesNotMatch(html, /🏥|cl[ií]nica|dental|paciente|clinic|patient/i, `${locale}: nada del dental`);
  }
});

test("los textos existen en español y en inglés, y no son la llave cruda", () => {
  const es = getBarberT("es");
  const en = getBarberT("en");
  for (const k of LLAVES) {
    assert.notEqual(es(k), k, `es: ${k} traducida`);
    assert.notEqual(en(k), k, `en: ${k} traducida`);
    assert.notEqual(es(k), en(k), `${k}: es y en no son el mismo texto`);
  }
});

test("la tarjeta no dice si lo que se buscó existe: ni «permiso» ni «recibo» ni «no existe»", () => {
  for (const locale of ["es", "en"]) {
    const t = getBarberT(locale);
    const texto = LLAVES.map((k) => t(k)).join(" ");
    assert.doesNotMatch(texto, /permiso|acceso|recibo|no existe|permission|access|receipt|does not exist|doesn't exist/i, locale);
  }
});

test("recibo de comisiones: de otro barbero (403) y el que no existe responden con el mismo notFound()", () => {
  const codigo = sinComentarios(leer(RECIBO));
  assert.match(codigo, /e\.status === 403\)\s*notFound\(\)/, "el 403 de alcance cae en notFound()");
  assert.match(codigo, /if \(!receipt\)\s*notFound\(\)/, "el recibo que no existe cae en notFound()");
  // Si un día el 403 de alcance pintara «Sin acceso», se sabría que el recibo existe.
  const ramaAlcance = codigo.slice(codigo.indexOf("getCommissionReceipt(ctx"));
  assert.doesNotMatch(ramaAlcance, /BarberDenied/, "tras pedir el recibo no se pinta «Sin acceso»");
  assert.ok(RECIBO.startsWith("src/app/barber/(panel)/"), "el recibo vive bajo (panel): lo cubre su not-found");
});
