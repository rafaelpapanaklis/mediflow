/* ═══════════════════════════════════════════════════════════════════════
   PLANTILLA «BARRIO» (ws6-t3): LOS DATOS DIFÍCILES.

     npx tsx --tsconfig tsconfig.test.json --test \
       "src/components/barber/templates/__tests__/barrio.test.tsx"

   Lo que el encargo pide revisar uno por uno: sin ninguna foto, sin logo,
   1 y 9 barberos, 0 y 30 servicios, nombre de 40 letras, sin reseñas, sin
   horario, sucursal, Tienda apagada/encendida. Y la regla de la casa: si
   una sección no tiene datos NO sale (ni su liga en la tira). Más la
   rejilla de Instagram, que con cualquier número de fotos no deja huecos.
   ═══════════════════════════════════════════════════════════════════════ */

import "./_sin-css"; // ← PRIMERO: ../index arrastra skins.css
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { configBarberWebVacia, normalizarConfigBarberWeb, ordenDeSecciones, type BarberWebConfig } from "@/lib/barber/landing";
import { BARBER_WEB_MANIFESTS, BARBER_WEB_TEMPLATES } from "../index";
import { letrasPorRenglon, planRejilla, tramoMasLargo } from "../t-barrio";
import type { BarberWebBarbero, BarberWebData, BarberWebServicio } from "../types";

const FOTO = (n: number) => `https://cdn.example.com/f${n}.webp`;

function sv(i: number, categoria = "Cortes"): BarberWebServicio {
  return { id: `s${i}`, nombre: `Servicio ${i}`, descripcion: null, duracionMin: 30, precio: 150 + i, categoria };
}
function barbero(i: number, extra: Partial<BarberWebBarbero> = {}): BarberWebBarbero {
  return { id: `b${i}`, nombre: `Barbero ${i}`, apodo: null, fotoUrl: null, bio: null, ...extra };
}

function datos(extra: Partial<BarberWebData> = {}, config: Partial<BarberWebConfig> = {}): BarberWebData {
  return {
    shop: { id: "x", name: "Filo", slug: "filo", phone: null, address: null, city: null, state: null, logoUrl: null },
    config: normalizarConfigBarberWeb({ ...configBarberWebVacia(), ...config }),
    manifest: BARBER_WEB_MANIFESTS.barrio,
    servicios: [],
    barberos: [],
    editando: false,
    ...extra,
  };
}
const pinta = (d: BarberWebData) => renderToStaticMarkup(BARBER_WEB_TEMPLATES.barrio({ data: d }));
const tira = (html: string) => html.slice(html.indexOf('<nav aria-label="Secciones"'), html.indexOf("</nav>"));

/* ── La rejilla de Instagram ────────────────────────────────────── */

test("rejilla: de 1 a 40 fotos, en 3 y en 6 columnas, nunca deja un hueco", () => {
  for (const C of [3, 6]) {
    for (let n = 1; n <= 40; n++) {
      const plan = planRejilla(n, C, 15);
      const visibles = plan.filter((c) => !c.oculta);
      const celdas = visibles.reduce((t, c) => t + c.col * c.fila, 0);
      assert.equal(celdas % C, 0, `${n} fotos en ${C} columnas: sobran ${C - (celdas % C)} celdas`);
      assert.ok(visibles.length >= Math.min(n, 15) - 0, `${n} fotos en ${C}: escondió de más`);
      for (const c of visibles) assert.ok(c.col <= C, `${n} en ${C}: una foto más ancha que la rejilla`);
      // Ninguna tira de 3:1 o 6:1 salvo la foto única (que va 4:3 / 21:9).
      if (n > 1) for (const c of visibles) assert.ok(c.col < C || c.fila > 1, `${n} en ${C}: una foto sola en su renglón`);
    }
  }
});

test("rejilla: con 0 fotos no hay sección en público; en el editor sale el hueco", () => {
  const html = pinta(datos({ servicios: [sv(1)] }));
  assert.ok(!html.includes('id="portafolio"'));
  assert.ok(!tira(html).includes("#portafolio"), "la tira liga a Cortes sin fotos");
  const ed = pinta(datos({ editando: true }));
  assert.ok(ed.includes('id="portafolio"') && ed.includes("dcbw-hueco"));
});

test("rejilla: 1 y 2 fotos salen enteras, con Instagram si lo hay", () => {
  for (const n of [1, 2]) {
    const html = pinta(datos({}, { galeria: Array.from({ length: n }, (_, i) => FOTO(i)), instagram: "filoclub" }));
    assert.equal((html.match(/<figure/g) ?? []).length, n);
    assert.ok(html.includes("@filoclub") && html.includes('href="https://instagram.com/filoclub"'));
  }
  const sinIg = pinta(datos({}, { galeria: [FOTO(1)] }));
  assert.ok(!sinIg.includes("bw-ig"), "sin Instagram no se inventa una cuenta");
});

/* ── Datos difíciles ────────────────────────────────────────────── */

test("barbería pelada (sin fotos, sin logo, 0 servicios, sin reseñas, sin horario, sin contacto): ni secciones vacías ni ligas muertas", () => {
  const html = pinta(datos({ barberos: [barbero(1)] }));
  for (const id of ["servicios", "portafolio", "resenas", "contacto", "tienda"]) {
    assert.ok(!html.includes(`id="${id}"`), `sale «${id}» vacía`);
    assert.ok(!tira(html).includes(`#${id}`), `la tira liga a «${id}», que no existe`);
  }
  assert.ok(html.includes('id="equipo"') && html.includes('id="portada"') && html.includes('id="reservar"'));
  assert.ok(!html.includes("<img"), "sin fotos no hay ninguna <img>");
  assert.ok(!html.includes("bw-cinta"), "sin servicios no corre la cinta");
  assert.ok(html.includes("bw-marca-letra"), "sin logo va la inicial");
  // Sin WhatsApp: ni botón ni muelle de WhatsApp; Reservar sí.
  assert.ok(!html.includes("wa.me") && html.includes('class="bw-muelle-ir" href="/b/filo/reservar"'));
});

test("nada del mockup se cuela: ni Filo, ni precios, ni reseñas, ni la dirección de ejemplo", () => {
  const html = pinta(datos({ shop: { id: "x", name: "Los Compas", slug: "compas", phone: null, address: null, city: null, state: null, logoUrl: null } }));
  for (const de of ["Filo", "Chapultepec", "Americana", "Guadalajara", "$320", "Diego A.", "4.8", "@filobarberclub"]) {
    assert.ok(!html.includes(de), `aparece «${de}» del mockup`);
  }
  const fuente = readFileSync(path.resolve(__dirname, "../t-barrio.tsx"), "utf8");
  assert.ok(!/fotos\/[a-z-]+\.webp/.test(fuente), "el componente apunta a una foto del mockup");
});

test("nombre de 40 letras: el titular calcula su tamaño por renglón y no por la palabra sola", () => {
  const nombre = "Barbería y Estética Masculina Don Ramiro";
  assert.equal(nombre.length, 40);
  assert.equal(letrasPorRenglon(nombre), 14); // ⌈40/3⌉: tres renglones como mucho
  assert.equal(letrasPorRenglon("Filo Barber Club"), 6); // la palabra más larga
  assert.equal(letrasPorRenglon("Supercalifragilístico"), 21);
  const html = pinta(datos({ shop: { id: "x", name: nombre, slug: "r", phone: null, address: null, city: null, state: null, logoUrl: null } }));
  assert.ok(html.includes("--bw-letras:14"));
});

test("1 y 9 barberos; sin horario sale sin «Reservar», con su aviso", () => {
  const uno = pinta(datos({ barberos: [barbero(1, { apodo: "Dani", bio: "Fades." })] }));
  assert.ok(uno.includes("Reservar con Dani") && uno.includes("/b/filo/reservar?barbero=b1"));
  // U3: «con» va en el código, como en Oficio; el texto es solo el verbo.
  const cta = BARBER_WEB_MANIFESTS.barrio.secciones.find((s) => s.id === "equipo")!.copia!.find((c) => c.clave === "equipo.cta")!;
  assert.equal(cta.porDefecto, "Reservar");
  const agendar = pinta(datos({ barberos: [barbero(1, { nombre: "Juan Pérez" })] }, { copia: { "equipo.cta": "Agendar" } }));
  assert.ok(agendar.includes("Agendar con Juan"), "el verbo reescrito no sigue «con <nombre>»");
  assert.ok(!/con\s*(<!-- -->)?\s*con/.test(agendar), "«con con»");
  const nueve = pinta(datos({ barberos: Array.from({ length: 9 }, (_, i) => barbero(i, { sinHorario: i === 4 })) }));
  assert.equal((nueve.match(/class="bw-barbero"/g) ?? []).length, 9);
  assert.ok(!nueve.includes("barbero=b4"), "ofrece reservar con quien no tiene horario");
  assert.ok(nueve.includes("Barbero 4") && nueve.includes("Todavía sin citas en línea"));
});

test("30 servicios: todos con su liga, los combos en tarjetas y fichas por categoría", () => {
  const cats = ["Cortes", "Barba", "Combos", "Spa", "Color"];
  const html = pinta(datos({ servicios: Array.from({ length: 30 }, (_, i) => sv(i, cats[i % 5])) }));
  for (let i = 0; i < 30; i++) assert.ok(html.includes(`/b/filo/reservar?servicio=s${i}`), `falta el servicio ${i}`);
  assert.equal((html.match(/class="bw-combo"/g) ?? []).length, 6);
  assert.equal((html.match(/href="#bw-grupo-\d"/g) ?? []).length, 5);
  // Una sola categoría («general»): sin fichas ni título de grupo.
  const una = pinta(datos({ servicios: [sv(1, "general"), sv(2, "general")] }));
  assert.ok(!una.includes("bw-fichas") && !una.includes("bw-grupo-titulo"));
});

test("B3 · reseñas: sin promedio ni «según nuestros clientes» (las escribe la barbería); sin reseñas no hay sección", () => {
  const html = pinta(datos({}, { resenas: [{ nombre: "A", texto: "Bien", estrellas: 5 }, { nombre: "B", texto: "Ok", estrellas: 4 }] }));
  assert.ok(html.includes("Bien") && html.includes("Ok"));
  for (const no of [">4.5<", "4.5", "de 5,", "según nuestros clientes", "bw-nota"]) assert.ok(!html.includes(no), `sale «${no}»`);
  // Cada reseña conserva SUS estrellas (las de la tarjeta), y solo esas dos.
  assert.equal((html.match(/class="dcbw-estrellas"/g) ?? []).length, 2);
  const s = BARBER_WEB_MANIFESTS.barrio.secciones.find((x) => x.id === "resenas")!;
  assert.ok(!(s.copia ?? []).some((c) => c.clave === "resenas.promedio"), "sigue la clave del promedio en el manifiesto");
  assert.ok(!pinta(datos()).includes('id="resenas"'));
});

test("sucursal con dirección larga y horario: mapa, cómo llegar y horario agrupado", () => {
  const horario = [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, abierto: dia > 0, desde: "11:00", hasta: "21:00" }));
  const html = pinta(
    datos(
      { shop: { id: "x", name: "Filo — Sucursal Norte", slug: "filo-norte", phone: "33 1111 2222", address: "Av. Patria 1891 local 4-B", city: "Zapopan", state: "Jalisco", logoUrl: null } },
      { horario, whatsapp: "523311112222" },
    ),
  );
  assert.ok(html.includes('id="contacto"') && html.includes("google.com/maps?q="));
  assert.ok(html.includes("Av. Patria 1891 local 4-B<small>Zapopan, Jalisco</small>"));
  // B2: el horario es la pieza compartida TablaHorario (los siete días), no el
  // texto de horarioAgrupado partido a mano.
  assert.ok(html.includes('<ul class="dcbw-horario bw-horario">'));
  assert.ok(html.includes('<li class="dcbw-cerrado"><span class="dcbw-horario-dia">Lunes</span><span class="dcbw-horario-rango">Cerrado</span></li>'));
  assert.ok(html.includes('<span class="dcbw-horario-dia">Domingo</span><span class="dcbw-horario-rango">11:00 am – 9:00 pm</span>'));
  assert.ok(!html.includes("<table"), "queda la tabla rearmada");
  // La píldora de la portada: el tramo seguido más largo, de las filas.
  assert.ok(html.includes("Mar – Dom: 11:00 am – 9:00 pm"));
  assert.ok(html.includes('href="tel:33 1111 2222"') && html.includes("wa.me/523311112222"));
  // El renglón de la portada no dice «hoy» (ISR: el HTML no sabe qué día es).
  assert.ok(!/\bHoy\b/.test(html));
});

test("Tienda: encendida va JUSTO después de Servicios (sección y tira); apagada, ni una ni otra", () => {
  const prod = { id: "p1", nombre: "Pomada", precio: 200, fotoUrl: null, categoria: null, url: "/b/filo/tienda/p1", agotado: true };
  const base = { servicios: [sv(1)], productos: [prod], tiendaUrl: "/b/filo/tienda" };
  const orden = ordenDeSecciones(BARBER_WEB_MANIFESTS.barrio, configBarberWebVacia());
  assert.equal(orden[orden.indexOf("servicios") + 1], "tienda");
  assert.equal(BARBER_WEB_MANIFESTS.barrio.secciones.find((s) => s.id === "tienda")!.textos![0].porDefecto, "Tienda");
  // Las otras doce siguen con la tienda al final y su título de siempre.
  assert.equal(ordenDeSecciones(BARBER_WEB_MANIFESTS.clasica, configBarberWebVacia()).at(-1), "tienda");
  assert.equal(BARBER_WEB_MANIFESTS.clasica.secciones.find((s) => s.id === "tienda")!.textos![0].porDefecto, "Productos");

  const html = pinta(datos(base));
  const t = tira(html);
  assert.ok(t.indexOf('href="#servicios"') < t.indexOf('href="/b/filo/tienda"'));
  assert.ok(html.indexOf('id="servicios"') < html.indexOf('id="tienda"'));
  assert.ok(html.includes("Agotado"));
  const apagada = pinta(datos(base, { secciones: { tienda: { visible: false, titulo: null, subtitulo: null } } }));
  assert.ok(!apagada.includes('id="tienda"') && !apagada.includes("/b/filo/tienda"));
});

test("«Mis citas» arriba solo con WhatsApp conectado (cuentaUrl)", () => {
  assert.ok(pinta(datos({ cuentaUrl: "/b/filo/mi-cuenta" })).includes('class="bw-mis" href="/b/filo/mi-cuenta"'));
  assert.ok(!pinta(datos()).includes("Mis citas"));
});

test("B2 · tramoMasLargo sale de las filas del horario, no del texto", () => {
  const dia = (d: number, abierto: boolean, hasta = "21:00") => ({ dia: d, abierto, desde: "11:00", hasta });
  const c = (h: ReturnType<typeof dia>[]) => normalizarConfigBarberWeb({ horario: h });
  assert.equal(tramoMasLargo(c([])), null);
  assert.equal(tramoMasLargo(c([0, 1, 2, 3, 4, 5, 6].map((d) => dia(d, false)))), null);
  assert.equal(tramoMasLargo(c([dia(6, true)])), "Dom: 11:00 am – 9:00 pm");
  // Lun–Mié a las 9, Jue–Sáb a las 8: dos tramos de tres, gana el primero.
  assert.equal(
    tramoMasLargo(c([0, 1, 2, 3, 4, 5].map((d) => dia(d, true, d < 3 ? "21:00" : "20:00")))),
    "Lun – Mié: 11:00 am – 9:00 pm",
  );
  // Salteados: el lunes solo pierde contra Mié–Vie.
  assert.equal(tramoMasLargo(c([dia(0, true), dia(2, true), dia(3, true), dia(4, true)])), "Mié – Vie: 11:00 am – 9:00 pm");
});

test("B1 · la cinta se puede pausar (WCAG 2.2.2): botón fuera de aria-hidden, hover/foco y reduced-motion", () => {
  const html = pinta(datos({ servicios: [sv(1), sv(2)] }));
  const cinta = html.slice(html.indexOf('<div class="bw-cinta">'), html.indexOf("bw-cinta-via"));
  assert.match(cinta, /<label class="bw-cinta-pausa"><input type="checkbox"[^>]*aria-label="Pausar la cinta de precios"/);
  assert.ok(!cinta.includes("aria-hidden=\"true\"><label"), "el botón quedó dentro de aria-hidden");
  assert.match(html, /class="bw-cinta-via" aria-hidden="true"/);
  const css = readFileSync(path.resolve(__dirname, "../skins.css"), "utf8");
  const piel = css.slice(css.indexOf("13 · BARRIO"));
  assert.match(piel, /\.bw-cinta:hover \.bw-cinta-via,\s*\.dcbw-barrio \.bw-cinta:focus-within \.bw-cinta-via,\s*\.dcbw-barrio \.bw-cinta:has\(\.bw-cinta-pausa input:checked\) \.bw-cinta-via \{\s*animation-play-state: paused;/);
  const quieta = piel.slice(piel.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(quieta, /\.bw-cinta-via,[\s\S]*?animation: none/);
  assert.match(quieta, /\.bw-cinta-pausa \{\s*display: none;/);
});

test("la piel no escribe colores de acento sueltos y respeta prefers-reduced-motion", () => {
  const css = readFileSync(path.resolve(__dirname, "../skins.css"), "utf8");
  const piel = css.slice(css.indexOf("13 · BARRIO"));
  assert.ok(piel.length > 1000);
  // Ningún hex de los acentos del catálogo: el color de la barbería entra por --dcbw-acento-*.
  for (const hex of ["#be7a3c", "#a2612f", "#b25e33", "#8a4b2a", "#2b4eff"]) assert.ok(!piel.toLowerCase().includes(hex), `hex de acento ${hex} en la piel`);
  assert.match(piel, /@media \(prefers-reduced-motion: reduce\)/);
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(css), "Google Fonts en vivo");
  assert.match(piel, /url\("\/barber\/fuentes\/archivo-400-900\.woff2"\)/);
});
