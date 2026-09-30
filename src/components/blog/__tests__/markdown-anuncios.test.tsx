import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";

// tsx compila el JSX con el runtime clásico (tsconfig: jsx preserve para Next):
// React tiene que existir como global antes de cargar el componente.
(globalThis as unknown as { React: typeof React }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BlogMarkdown, sufijoDeAnuncio } = require("../markdown") as typeof import("../markdown");

const render = (md: string) => renderToStaticMarkup(<BlogMarkdown content={md} />);

const ANUNCIO = (s: string) =>
  `> **Tu primer mes por solo $29**\n>\n> Plan Profesional: agenda con recordatorios.\n>\n> [Empieza →](/ "anuncio-${s}")`;

describe("anuncios del blog", () => {
  it("cita con enlace anuncio-pro → tarjeta con botón <a> real", () => {
    const h = render(ANUNCIO("pro"));
    assert.match(h, /<aside class="blog-ad blog-ad--pro" data-anuncio="pro"/);
    assert.match(h, /<a [^>]*href="\/"[^>]*class="blog-ad__cta"|<a [^>]*class="blog-ad__cta"[^>]*href="\/"/);
    assert.match(h, /<strong>Tu primer mes por solo \$29<\/strong>/);
    assert.ok(!h.includes("<blockquote"));
  });

  for (const v of ["pro", "basico", "clinica", "anual", "sabina", "migracion"]) {
    it(`variante ${v}`, () => {
      const h = render(ANUNCIO(v));
      assert.ok(h.includes(`blog-ad--${v}`));
      assert.ok(h.includes(`data-anuncio="${v}"`));
    });
  }

  it("sufijo desconocido → misma tarjeta, variante neutra", () => {
    const h = render(ANUNCIO("otra"));
    assert.ok(h.includes("blog-ad--otro"));
    assert.ok(h.includes('data-anuncio="otra"'));
  });

  it("cita normal y cita con enlace sin title anuncio- se ven como hoy", () => {
    const a = render("> Una cita normal.");
    assert.match(a, /<blockquote>/);
    assert.ok(!a.includes("blog-ad"));
    const b = render('> Ver [la guía](/blog "otra-cosa") hoy.');
    assert.match(b, /<blockquote>/);
    assert.ok(!b.includes("blog-ad"));
  });

  it("un title «anuncio-» fuera de una cita no crea tarjeta", () => {
    const h = render('[x](/ "anuncio-pro")');
    assert.ok(!h.includes("<aside"));
  });

  it("no habilita HTML crudo", () => {
    const h = render('> <script>alert(1)</script> [x](/ "anuncio-pro")\n\n<div class="blog-ad">x</div>');
    assert.ok(!h.includes("<script"));
    assert.ok(!h.includes('<div class="blog-ad">'));
  });

  it("sufijoDeAnuncio", () => {
    assert.equal(sufijoDeAnuncio("anuncio-pro"), "pro");
    assert.equal(sufijoDeAnuncio("anuncio-"), null);
    assert.equal(sufijoDeAnuncio("promo-pro"), null);
    assert.equal(sufijoDeAnuncio(undefined), null);
  });
});

describe("imágenes del blog", () => {
  it("ruta relativa /blog/panel/… conserva src y alt, con lazy", () => {
    const h = render("![Agenda del día por doctor](/blog/panel/agenda.webp)\n*Así se ve en DaleControl: la agenda.*");
    assert.match(h, /<img src="\/blog\/panel\/agenda\.webp" alt="Agenda del día por doctor" loading="lazy"/);
    assert.match(h, /<\/em>/);
  });
  it("https externa sigue funcionando", () => {
    const h = render("![foto](https://images.unsplash.com/x.jpg)");
    assert.match(h, /<img src="https:\/\/images\.unsplash\.com\/x\.jpg" alt="foto" loading="lazy"/);
  });
  it("javascript: se neutraliza", () => {
    assert.ok(!render("![x](javascript:alert(1))").includes("javascript:"));
  });
});
