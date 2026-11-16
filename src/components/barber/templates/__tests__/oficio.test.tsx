/* ═══════════════════════════════════════════════════════════════════════
   OFICIO CON DATOS DIFÍCILES (ws6-t2).

     npx tsx --tsconfig tsconfig.test.json --test \
       "src/components/barber/templates/__tests__/oficio.test.tsx"

   Lo que el encargo pide revisar uno por uno: sin ninguna foto, sin logo,
   1 y 9 barberos, 0 y 30 servicios, nombre de 40 letras, sin reseñas, sin
   horario, sucursal, tienda encendida/apagada. Regla de fondo: lo que no
   tiene datos NO sale (ni la sección, ni su liga en el menú).
   ═══════════════════════════════════════════════════════════════════════ */

import "./_sin-css"; // ← PRIMERO: ../index arrastra skins.css
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { configBarberWebVacia, normalizarConfigBarberWeb, ordenDeSecciones } from "@/lib/barber/landing";
import { BARBER_WEB_MANIFESTS, BARBER_WEB_TEMPLATES, PlantillaBarberWeb } from "../index";
import type { BarberWebBarbero, BarberWebData, BarberWebServicio } from "../types";

const HORARIO = [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, abierto: dia < 6, desde: "10:00", hasta: "20:00" }));

const SERVICIOS: BarberWebServicio[] = [
  { id: "s1", nombre: "Corte clásico", descripcion: "A tijera.", duracionMin: 30, precio: 180, categoria: "Corte" },
  { id: "s2", nombre: "Arreglo de barba", descripcion: null, duracionMin: 25, precio: 140, categoria: "Barba" },
  { id: "c1", nombre: "Corte + barba", descripcion: null, duracionMin: 55, precio: 300, categoria: "Combos de la casa" },
];

function barbero(i: number, extra: Partial<BarberWebBarbero> = {}): BarberWebBarbero {
  return { id: `b${i}`, nombre: `Barbero ${i}`, apodo: null, fotoUrl: null, bio: null, ...extra };
}

function datos(extra: Partial<BarberWebData> = {}): BarberWebData {
  return {
    shop: {
      id: "x",
      name: "Barbería El Roble",
      slug: "el-roble",
      phone: "999 555 0142",
      address: "Calle 60 #452",
      city: "Mérida",
      state: "Yucatán",
      logoUrl: null,
    },
    config: normalizarConfigBarberWeb({
      horario: HORARIO,
      whatsapp: "529995550142",
      instagram: "@elroble",
      resenas: [{ nombre: "Roberto M.", texto: "Nunca he salido con un mal corte.", estrellas: 5 }],
      galeria: ["https://x.test/c1.webp", "https://x.test/c2.webp"],
      fotos: { portada: "https://x.test/portada.webp" },
    }),
    manifest: BARBER_WEB_MANIFESTS.oficio,
    servicios: SERVICIOS,
    barberos: [barbero(1, { fotoUrl: "https://x.test/b1.webp", apodo: "Don Chuy" }), barbero(2, { sinHorario: true })],
    editando: false,
    ...extra,
  };
}

const pinta = (d: BarberWebData) => renderToStaticMarkup(BARBER_WEB_TEMPLATES.oficio({ data: d }));
const menu = (html: string) => html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
const cuenta = (html: string, s: string) => html.split(s).length - 1;

test("el manifiesto pone la vitrina JUSTO después de la carta, con sus propios textos", () => {
  const orden = ordenDeSecciones(BARBER_WEB_MANIFESTS.oficio, configBarberWebVacia());
  assert.deepEqual(orden, ["portada", "servicios", "tienda", "equipo", "portafolio", "resenas", "contacto", "reservar"]);
  const tienda = BARBER_WEB_MANIFESTS.oficio.secciones.find((s) => s.id === "tienda")!;
  assert.equal(tienda.textos?.find((t) => t.campo === "titulo")?.porDefecto, "La vitrina");
  // Y no le cambió los textos a ninguna otra plantilla (el objeto de la tienda es uno por plantilla).
  assert.equal(
    BARBER_WEB_MANIFESTS.clasica.secciones.find((s) => s.id === "tienda")?.textos?.find((t) => t.campo === "titulo")?.porDefecto,
    "Productos",
  );
  assert.equal(BARBER_WEB_MANIFESTS.oficio.secciones.filter((s) => s.id === "tienda").length, 1);
});

test("llena: todas las secciones, el combo en el tablero y la carta aparte", () => {
  const html = pinta(datos());
  for (const id of ["portada", "servicios", "equipo", "portafolio", "resenas", "contacto", "reservar"]) {
    assert.ok(html.includes(`id="${id}"`), `falta ${id}`);
  }
  assert.ok(html.includes("dcbw-of-tablero"), "sin tablero de combos");
  assert.ok(html.includes("Combos de la casa"));
  assert.ok(html.includes("/b/el-roble/reservar?servicio=c1"), "el combo no lleva a reservar con él");
  assert.ok(html.includes("Reservar con Don Chuy"), "el barbero con apodo no se nombra por su apodo");
  assert.ok(html.includes("Más cortes en @elroble"));
  assert.ok(html.includes('href="https://instagram.com/elroble"'));
});

test("sin categoría de combos no hay tablero (nada inventado)", () => {
  const html = pinta(datos({ servicios: SERVICIOS.filter((s) => s.id !== "c1") }));
  assert.ok(!html.includes("dcbw-of-tablero"));
});

test("sin ninguna foto: ni una <img>, la inicial en el arco y monograma de marca", () => {
  const d = datos({ barberos: [barbero(1)] });
  d.config = { ...d.config, fotos: {}, galeria: [] };
  const html = pinta(d);
  assert.equal(cuenta(html, "<img"), 0, "salió una foto que la barbería no subió");
  assert.ok(html.includes("dcbw-of-espejo-letra"), "el arco de portada quedó vacío");
  assert.ok(html.includes("dcbw-of-monograma"));
  assert.ok(!html.includes('id="portafolio"'), "pared de cortes vacía");
  assert.ok(!html.includes('href="#portafolio"'), "liga del menú a una sección que no está");
});

test("con logo, el logo; sin él, el monograma con la inicial que importa", () => {
  const con = pinta(datos({ shop: { ...datos().shop, logoUrl: "https://x.test/logo.webp" } }));
  assert.ok(con.includes('src="https://x.test/logo.webp"'));
  assert.ok(!con.includes("dcbw-of-monograma"));
  const sin = pinta(datos({ shop: { ...datos().shop, name: "Barbería y Peluquería Los Compadres" } }));
  assert.match(sin, /dcbw-of-monograma"[^>]*>C</);
});

test("1 barbero y 9 barberos", () => {
  assert.equal(cuenta(pinta(datos({ barberos: [barbero(1)] })), 'class="dcbw-of-barbero"'), 1);
  const nueve = pinta(datos({ barberos: Array.from({ length: 9 }, (_, i) => barbero(i)) }));
  assert.equal(cuenta(nueve, 'class="dcbw-of-barbero"'), 9);
});

test("0 servicios: ni sección ni liga; 30 servicios: los 30 con su reserva", () => {
  const cero = pinta(datos({ servicios: [] }));
  assert.ok(!cero.includes('id="servicios"'));
  assert.ok(!menu(cero).includes("#servicios"));
  const treinta = Array.from({ length: 30 }, (_, i) => ({ ...SERVICIOS[0], id: `t${i}`, categoria: ["Corte", "Barba", "Combos"][i % 3] }));
  const html = pinta(datos({ servicios: treinta }));
  for (let i = 0; i < 30; i++) assert.ok(html.includes(`reservar?servicio=t${i}"`), `falta t${i}`);
  // Diez combos: la columna izquierda deja de ir pegada (no cabría en pantalla).
  assert.ok(html.includes("dcbw-of-sin-pegar"));
});

test("nombre de 40 letras: el rótulo baja un escalón", () => {
  const nombre = "Barbería y Peluquería Los Compadres Nort";
  assert.equal(nombre.length, 40);
  const html = pinta(datos({ shop: { ...datos().shop, name: nombre } }));
  assert.ok(html.includes("dcbw-of-largo"));
  assert.ok(html.includes(nombre));
});

test("sin reseñas: ni sección ni liga", () => {
  const d = datos();
  d.config = { ...d.config, resenas: [] };
  const html = pinta(d);
  assert.ok(!html.includes('id="resenas"'));
  assert.ok(!menu(html).includes("#resenas"));
});

test("sin horario guardado: ni tabla, ni «Horario», ni la línea del reloj en la portada", () => {
  const d = datos();
  d.config = { ...d.config, horario: [] };
  const html = pinta(d);
  assert.ok(!html.includes("dcbw-of-horario"));
  assert.ok(!html.includes(">Horario<"));
  assert.ok(!html.includes("am –"));
});

test("portada: el horario es el primer tramo ABIERTO, nunca «Lun: Cerrado»", () => {
  // Cierra el lunes (muy común): antes la portada enseñaba solo «Lun: Cerrado».
  const d = datos();
  d.config = { ...d.config, horario: HORARIO.map((h) => ({ ...h, abierto: h.dia !== 0 && h.dia < 6 })) };
  const html = pinta(d);
  const portada = html.slice(html.indexOf('id="portada"'), html.indexOf('id="servicios"'));
  assert.ok(!portada.includes("Cerrado"), "la portada enseña un tramo cerrado");
  assert.match(portada, /Mar – Sáb: 10:00 am – 8:00 pm/);
});

test("sin nada de contacto: ni «Visítanos» ni su ancla en el menú", () => {
  const d = datos({ shop: { ...datos().shop, phone: null, address: null, city: null, state: null } });
  d.config = { ...d.config, horario: [], whatsapp: null, instagram: null };
  const html = pinta(d);
  assert.ok(!html.includes('id="contacto"'));
  assert.ok(!html.includes('href="#contacto"'));
});

test("sucursal: su nombre tal cual, su propio WhatsApp y su reserva", () => {
  const d = datos({ shop: { ...datos().shop, name: "Barbería El Roble — Sucursal Altabrisa", slug: "el-roble-altabrisa" } });
  const html = pinta(d);
  assert.ok(html.includes("Barbería El Roble — Sucursal Altabrisa"));
  assert.ok(html.includes('href="/b/el-roble-altabrisa/reservar"'));
});

test("tienda encendida: «Tienda» en el menú justo después de Servicios; apagada: nada", () => {
  const con = pinta(datos({
    productos: [{ id: "p1", nombre: "Pomada", precio: 180, fotoUrl: null, categoria: null, url: "/b/el-roble/tienda/p1", agotado: false }],
    tiendaUrl: "/b/el-roble/tienda",
  }));
  const nav = menu(con);
  const iServ = nav.indexOf('href="#servicios"');
  assert.ok(iServ >= 0 && nav.indexOf('href="/b/el-roble/tienda"') > iServ);
  assert.equal(nav.indexOf("<a", iServ + 1), nav.indexOf('<a href="/b/el-roble/tienda"'));
  assert.ok(con.indexOf('id="tienda"') > con.indexOf('id="servicios"'));
  assert.ok(con.indexOf('id="tienda"') < con.indexOf('id="equipo"'), "la vitrina no va tras la carta");
  const sin = pinta(datos());
  assert.ok(!sin.includes("/tienda"));
});

test("en el editor, la portada sin foto enseña el hueco (nunca en público)", () => {
  const d = datos({ editando: true });
  d.config = { ...d.config, fotos: {} };
  assert.ok(pinta(d).includes("dcbw-hueco"));
  assert.ok(!pinta({ ...d, editando: false }).includes("dcbw-hueco"));
});

test("una plantilla retirada (id desconocido) se pinta con Oficio, la de por defecto", () => {
  const d = datos({ manifest: { ...BARBER_WEB_MANIFESTS.oficio, id: "retirada" as never } });
  assert.ok(renderToStaticMarkup(<PlantillaBarberWeb data={d} />).includes("dcbw-oficio"));
});

test("WhatsApp: sin número no hay botón redondo ni de portada", () => {
  const d = datos();
  d.config = { ...d.config, whatsapp: null };
  const html = pinta(d);
  assert.ok(!html.includes("wa.me"));
  assert.ok(!html.includes("dcbw-of-redondo"));
});
