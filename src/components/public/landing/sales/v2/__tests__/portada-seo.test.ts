/**
 * SEO de la portada (12-oct-2026, ws1-t4, punto 3 del encargo de ws7).
 * Run: npm run test:portada-seo
 *
 * Fallan con el código anterior: no existían portada-seo.ts ni src/lib/llms;
 * page.tsx llevaba la descripción (167 caracteres) con «$419» y «$19» escritos a
 * mano, y la Organización del JSON-LD no tenía `sameAs`.
 * 7-nov-2026: la descripción es el texto fijo de Rafael (166 caracteres, sin precio).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { REDES_SOCIALES, SAME_AS, descripcionPortada } from "../portada-seo";
import { textoLlms } from "@/lib/llms/llms-txt";
import { PRODUCTO_SLUGS } from "@/lib/producto/data";

const aqui = dirname(fileURLToPath(import.meta.url));
const pagina = readFileSync(join(aqui, "../../../../../../app/page.tsx"), "utf8");

describe("meta description de la portada", () => {
  it("es el texto exacto que eligió Rafael (7-nov-2026), sin precio", () => {
    assert.equal(
      descripcionPortada(),
      "DaleControl el mejor software para tu clínica dental y consultorios en México. Organiza tu clínica dental en un solo lugar con la mejor tecnología y con IA integrada.",
    );
    assert.equal(descripcionPortada().length, 166);
  });

  it("page.tsx ya no lleva precios escritos a mano y arma la descripción en generateMetadata", () => {
    assert.ok(pagina.includes("export async function generateMetadata"));
    assert.ok(!pagina.includes("export const metadata"));
    assert.ok(!/\$\d/.test(pagina), "hay un precio escrito a mano en page.tsx");
    assert.ok(pagina.includes("const description = descripcionPortada();"));
    assert.ok(pagina.includes("openGraph: { ...metadataFija.openGraph, description }"));
    assert.ok(pagina.includes("twitter: { ...metadataFija.twitter, description }"));
  });
});

describe("sameAs de la Organización", () => {
  it("son Instagram, Facebook y TikTok con el usuario @dalecontrol.com", () => {
    assert.deepEqual(REDES_SOCIALES.map((r) => r.red), ["Instagram", "Facebook", "TikTok"]);
    assert.deepEqual(SAME_AS, [
      "https://www.instagram.com/dalecontrol.com/",
      "https://www.facebook.com/dalecontrol.com",
      "https://www.tiktok.com/@dalecontrol.com",
    ]);
  });

  it("page.tsx los mete en la Organización del JSON-LD", () => {
    const org = pagina.slice(pagina.indexOf('"@type": "Organization"'), pagina.indexOf('"@type": "WebSite"'));
    assert.ok(org.includes("sameAs: SAME_AS"));
  });
});

describe("/llms.txt", () => {
  const txt = textoLlms();

  it("sigue el formato de llmstxt.org: un H1, resumen en «>», secciones H2 con listas", () => {
    const lineas = txt.split("\n");
    assert.equal(lineas[0], "# DaleControl");
    assert.ok(lineas[2].startsWith("> "));
    assert.equal(lineas.filter((l) => l.startsWith("# ")).length, 1);
    assert.ok(lineas.filter((l) => l.startsWith("## ")).length >= 3);
  });

  it("enlaza las 8 páginas de producto y las tres redes, sin cifras de precio", () => {
    for (const slug of PRODUCTO_SLUGS) assert.ok(txt.includes(`https://www.dalecontrol.com/${slug})`), slug);
    for (const url of SAME_AS) assert.ok(txt.includes(`(${url})`), url);
    assert.ok(!/\$\s?\d/.test(txt), "hay un precio en el llms.txt");
    assert.ok(txt.length < 4000);
  });

  it("route.ts solo exporta GET y dynamic (Next rechaza exports extra en una ruta)", () => {
    const ruta = readFileSync(join(aqui, "../../../../../../app/llms.txt/route.ts"), "utf8");
    const exportados = [...ruta.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map((m) => m[1]).sort();
    assert.deepEqual(exportados, ["GET", "dynamic"]);
    assert.ok(ruta.includes('"force-static"'));
  });
});
