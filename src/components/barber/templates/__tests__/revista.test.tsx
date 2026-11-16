/* ═══════════════════════════════════════════════════════════════════════
   «REVISTA» CON DATOS DIFÍCILES (ws6-t6, 16-nov).

     npx tsx --tsconfig tsconfig.test.json --test \
       "src/components/barber/templates/__tests__/revista.test.tsx"

   La plantilla que más depende de fotos buenas. Lo que tiene que ser
   verdad con datos reales y feos: sin fotos no hay huecos (sale la
   inicial), sección sin datos no sale, el índice solo lleva a lo que se
   pinta, «Tienda» junto a «Servicios», 1 y 9 barberos, 0 y 30 servicios,
   un nombre de 40 letras, sin horario, sucursal.
   ═══════════════════════════════════════════════════════════════════════ */

import "./_sin-css"; // ← PRIMERO: ../index arrastra skins.css
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { normalizarConfigBarberWeb, ordenDeSecciones, configBarberWebVacia } from "@/lib/barber/landing";
import { BARBER_WEB_MANIFESTS } from "../index";
import { PlantillaRevista } from "../t-revista";
import type { BarberWebBarbero, BarberWebData, BarberWebProducto, BarberWebServicio } from "../types";

const SLUG = "el-corte";
const TIENDA = `/b/${SLUG}/tienda`;
const FOTO = "https://cdn.ejemplo.mx/portada.webp";

const servicio = (i: number, categoria = "general"): BarberWebServicio => ({
  id: `s${i}`,
  nombre: `Servicio ${i}`,
  descripcion: null,
  duracionMin: 30,
  precio: 100 + i,
  categoria,
});
const barbero = (i: number, extra: Partial<BarberWebBarbero> = {}): BarberWebBarbero => ({
  id: `b${i}`,
  nombre: `Barbero ${i}`,
  apodo: null,
  fotoUrl: null,
  bio: null,
  ...extra,
});
const POMADA: BarberWebProducto = {
  id: "p1",
  nombre: "Pomada",
  precio: 180,
  fotoUrl: null,
  categoria: "Cabello",
  url: `${TIENDA}/p1`,
  agotado: false,
};

const HORARIO = [1, 2, 3, 4, 5].map((dia) => ({ dia, abierto: true, desde: "10:00", hasta: "20:00" }));

function datos(o: {
  name?: string;
  config?: Record<string, unknown>;
  servicios?: BarberWebServicio[];
  barberos?: BarberWebBarbero[];
  productos?: BarberWebProducto[];
  address?: string | null;
  phone?: string | null;
  editando?: boolean;
  cuenta?: boolean;
  slug?: string;
} = {}): BarberWebData {
  const productos = o.productos ?? [POMADA];
  const slug = o.slug ?? SLUG;
  return {
    shop: {
      id: "x",
      name: o.name ?? "Raya",
      slug,
      phone: o.phone === undefined ? "55 5555 0164" : o.phone,
      address: o.address === undefined ? "Colima 124" : o.address,
      city: o.address === null ? null : "CDMX",
      state: null,
      logoUrl: null,
    },
    config: normalizarConfigBarberWeb({ whatsapp: "5215555550164", horario: HORARIO, ...(o.config ?? {}) }),
    manifest: BARBER_WEB_MANIFESTS.revista,
    servicios: o.servicios ?? [servicio(1), servicio(2)],
    barberos: o.barberos ?? [barbero(1)],
    productos,
    tiendaUrl: productos.length ? `/b/${slug}/tienda` : null,
    cuentaUrl: o.cuenta === false ? null : `/b/${slug}/mi-cuenta`,
    editando: o.editando ?? false,
  };
}

const pinta = (d: BarberWebData) => renderToStaticMarkup(<PlantillaRevista data={d} />);
const indice = (html: string) => html.slice(html.indexOf('aria-label="Secciones"'), html.indexOf("</nav>"));
const abajo = (html: string) => html.slice(html.indexOf('aria-label="Menú"'));

test("manifiesto: «Tienda» va justo después de «Servicios», con sus textos", () => {
  const orden = ordenDeSecciones(BARBER_WEB_MANIFESTS.revista, configBarberWebVacia());
  assert.equal(orden[orden.indexOf("servicios") + 1], "tienda");
  const tienda = BARBER_WEB_MANIFESTS.revista.secciones.find((s) => s.id === "tienda")!;
  assert.equal(tienda.textos?.find((t) => t.campo === "titulo")?.porDefecto, "Tienda");
  // Las otras doce no se tocaron: su tienda sigue al final y con «Productos».
  const clasica = BARBER_WEB_MANIFESTS.clasica.secciones;
  assert.equal(clasica[clasica.length - 1].id, "tienda");
  assert.equal(clasica[clasica.length - 1].textos?.find((t) => t.campo === "titulo")?.porDefecto, "Productos");
});

test("sin ninguna foto: en público la cápsula es la inicial, sin hueco ni rótulo de ranura", () => {
  const html = pinta(datos({ barberos: [barbero(1), barbero(2, { nombre: "Óscar" })] }));
  assert.ok(!html.includes("dcbw-hueco"), "hueco de foto en público");
  assert.ok(!html.includes("Foto de portada"), "rótulo de ranura en público");
  assert.match(html, /dcbw-rv-sin-foto[^>]*><span class="dcbw-rv-letra" aria-hidden="true">R</);
  assert.ok(html.includes(">Ó</span>"), "la inicial del barbero sin foto");
  assert.ok(!html.includes("<img"), "no hay ninguna foto que pintar");
  assert.ok(!html.includes('id="portafolio"'), "portafolio sin fotos salió en público");
});

test("con foto de portada: la foto y no la inicial", () => {
  const html = pinta(datos({ config: { fotos: { portada: FOTO } } }));
  assert.ok(html.includes(`src="${FOTO}"`));
  assert.ok(!html.includes("dcbw-rv-sin-foto"));
});

test("en el editor: la cápsula vacía dice qué foto va ahí y el portafolio enseña dónde caen", () => {
  const html = pinta(datos({ editando: true }));
  assert.ok(html.includes("Foto de portada"));
  assert.ok(html.includes('id="portafolio"'));
  assert.ok(html.includes("dcbw-hueco"));
});

test("0 servicios: ni sección, ni «Servicios» en el índice o la barra, ni «Ver servicios»", () => {
  const html = pinta(datos({ servicios: [] }));
  assert.ok(!html.includes('id="servicios"'));
  assert.ok(!html.includes('href="#servicios"'));
  assert.ok(!html.includes("Ver servicios"));
  // La tienda sigue a la mano, primera del índice.
  assert.ok(indice(html).indexOf(`href="${TIENDA}"`) > 0);
});

test("30 servicios en categorías: los 30 enlazan a su reserva y los combos van destacados", () => {
  const lista = Array.from({ length: 30 }, (_, i) => servicio(i, ["Cabello", "Barba", "Combos"][i % 3]));
  const html = pinta(datos({ servicios: lista }));
  for (const s of lista) assert.ok(html.includes(`/b/${SLUG}/reservar?servicio=${s.id}"`), s.id);
  assert.equal((html.match(/dcbw-rv-destacada/g) ?? []).length, 1);
});

test("1 barbero y 9 barberos: todos salen; el sin horario sin «Reservar» y con su nota", () => {
  assert.equal((pinta(datos({ barberos: [barbero(1)] })).match(/<h3>Barbero /g) ?? []).length, 1);
  const nueve = Array.from({ length: 9 }, (_, i) => barbero(i, i === 8 ? { sinHorario: true } : {}));
  const html = pinta(datos({ barberos: nueve }));
  assert.equal((html.match(/<h3>Barbero /g) ?? []).length, 9);
  assert.ok(!html.includes("barbero=b8"));
  assert.ok(html.includes("Todavía sin citas en línea."));
  assert.ok(html.includes('aria-label="Reservar con Barbero 0"'));
});

test("nombre de 40 letras: talla chica en portada y en la lateral", () => {
  const name = "Barbería y Peluquería Los Hermanos Gómez";
  assert.equal(name.length, 40);
  const html = pinta(datos({ name }));
  assert.ok(html.includes("dcbw-rv-titular dcbw-rv-talla-l"));
  assert.ok(html.includes("dcbw-rv-marca-l"));
  assert.ok(pinta(datos({ name: "Raya" })).includes("dcbw-rv-talla-s"));
});

test("sin reseñas ni horario: ni sección de reseñas, ni horario en portada, lateral o visita", () => {
  const html = pinta(datos({ config: { resenas: [], horario: [] } }));
  assert.ok(!html.includes('id="resenas"'));
  assert.ok(!html.includes('href="#resenas"'));
  assert.ok(!html.includes("am –"), "sale un rango de horas sin horario");
  assert.ok(!html.includes("dcbw-rv-abierto"));
  assert.ok(!html.includes("Horario"));
});

test("con horario: solo los tramos abiertos arriba, la semana entera en Visita", () => {
  const html = pinta(datos());
  // Días 1..5 = martes a sábado (0 es lunes).
  assert.ok(html.includes("Mar – Sáb"));
  const portada = html.slice(html.indexOf("dcbw-rv-datos"), html.indexOf("</dl>"));
  assert.ok(!portada.includes("Cerrado"), "un tramo cerrado salió en la portada");
  assert.ok(html.includes("Domingo"), "la tabla de Visita lleva los siete días");
});

test("Tienda encendida: en el índice justo tras Servicios, en la barra y su sección; apagada: nada", () => {
  const html = pinta(datos());
  const idx = indice(html);
  const iServ = idx.indexOf('href="#servicios"');
  const iTienda = idx.indexOf(`href="${TIENDA}"`);
  assert.ok(iServ > 0 && iTienda > iServ);
  assert.equal(idx.indexOf("<a", iServ + 1), idx.lastIndexOf("<a", iTienda), "hay otra liga entre Servicios y Tienda");
  assert.ok(abajo(html).includes(`href="${TIENDA}"`));
  assert.ok(html.includes('id="tienda"'));

  const off = pinta(datos({ config: { secciones: { tienda: { visible: false } } } }));
  assert.ok(!off.includes("/tienda"));
  assert.ok(!off.includes('id="tienda"'));
});

test("sin dirección, teléfono, horario ni WhatsApp: no sale Visita ni su ancla", () => {
  const html = pinta(
    datos({ address: null, phone: null, cuenta: false, config: { horario: [], whatsapp: null } }),
  );
  assert.ok(!html.includes('id="contacto"'));
  assert.ok(!html.includes('href="#contacto"'));
  assert.ok(!html.includes("dcbw-rv-datos"), "la ficha de la portada vacía");
  assert.ok(!html.includes("/mi-cuenta"));
  assert.ok(!html.includes("wa.me"));
});

test("sucursal: todo apunta a SU slug (reserva, mis citas, tienda)", () => {
  const productos = [{ ...POMADA, url: "/b/raya-condesa/tienda/p1" }];
  const html = pinta(datos({ name: "Raya · Condesa", slug: "raya-condesa", productos }));
  assert.ok(html.includes('href="/b/raya-condesa/reservar"'));
  assert.ok(html.includes('href="/b/raya-condesa/mi-cuenta"'));
  assert.ok(html.includes('href="/b/raya-condesa/tienda"'));
  assert.ok(!html.includes(`/b/${SLUG}/`));
});

test("los textos se reescriben desde Mi web con las claves compartidas", () => {
  const html = pinta(
    datos({
      config: {
        copia: { "portada.cta": "Agendar", "servicios.menu": "Precios", "contacto.menu": "Dónde" },
        secciones: { reservar: { visible: true, titulo: "Te esperamos" } },
      },
    }),
  );
  assert.ok(html.includes(">Agendar<"));
  assert.ok(indice(html).includes(">Precios<"));
  assert.ok(abajo(html).includes(">Dónde<"));
  assert.ok(html.includes("Te esperamos"));
});
