/**
 * AUTOCOMPLETAR LA PÁGINA WEB — el núcleo puro.
 *
 * Run: npx tsx --test src/lib/landing-autocompletar/__tests__/core.test.ts
 *
 * Lo que se vigila es la promesa hecha a la clínica: los precios se COPIAN
 * del tarifario (nunca los escribe el modelo), nada de lo que ya estaba en la
 * página se pierde, lo que falta se dice, y lo que el modelo invente se marca.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  precioDeTarifario, cifraDePrecio, nombreNormalizado, proponerServicios, aplicarServicios,
  resumenDeHorario, faltantes, construirHechos, cifrasSinRespaldo, avisosDe, extraerJson,
  validarRedaccion, armarLectura, MAX_SERVICIOS,
  type FilaTarifario, type FilaDoctor, type FilaHorario, type DatosDeClinica,
} from "../core";

const fila = (id: string, name: string, basePrice: number, extra: Partial<FilaTarifario> = {}): FilaTarifario =>
  ({ id, name, category: "dental", basePrice, duration: 30, description: null, ...extra });

const CLINICA: DatosDeClinica = {
  name: "Dental Altabrisa", city: "Mérida", state: "Yucatán", address: "Calle 20 #123",
  phone: "999 123 4567", landingWhatsapp: null, landingMsiPlazos: [3, 6],
};
const DOCTORA: FilaDoctor = { firstName: "Ana", lastName: "Pérez", specialty: "Ortodoncia", role: "DOCTOR", tieneCedula: true };
const SEMANA: FilaHorario[] = [0, 1, 2, 3, 4].map(d => ({ dayOfWeek: d, enabled: true, openTime: "09:00", closeTime: "18:00" }))
  .concat([{ dayOfWeek: 5, enabled: true, openTime: "09:00", closeTime: "14:00" }, { dayOfWeek: 6, enabled: false, openTime: "09:00", closeTime: "18:00" }]);

test("el precio se copia con formato y un precio en 0 no se publica", () => {
  assert.equal(precioDeTarifario(1200), "$1,200");
  assert.equal(precioDeTarifario(850.5), "$850.50");
  assert.equal(precioDeTarifario(1234567), "$1,234,567");
  assert.equal(precioDeTarifario(0), "");
  assert.equal(precioDeTarifario(Number.NaN), "");
});

test("la cifra de un precio escrito a mano se lee sin adivinar", () => {
  assert.equal(cifraDePrecio("Desde $1,200 MXN"), 1200);
  assert.equal(cifraDePrecio("$850.50"), 850.5);
  assert.equal(cifraDePrecio("Consultar"), null);
  assert.equal(cifraDePrecio(null), null);
});

test("los nombres se emparejan sin acentos, mayúsculas ni espacios de más", () => {
  assert.equal(nombreNormalizado("  Limpieza  Dental "), nombreNormalizado("limpieza dental"));
  assert.equal(nombreNormalizado("Extracción"), "extraccion");
});

test("proponerServicios distingue nuevo, distinto, sin-precio e igual", () => {
  const tarifario = [
    fila("a", "Limpieza dental", 800),
    fila("b", "Resina", 1200),
    fila("c", "Extracción", 900),
    fila("d", "Blanqueamiento", 3500),
    fila("e", "limpieza DENTAL", 999), // duplicado por nombre: se ignora
  ];
  const guardados = [
    { name: "Resina", price: "$1,000", durationMin: 30, icon: "✨" },   // precio viejo
    { name: "extraccion", price: "", durationMin: 30 },                 // sin precio en la página
    { name: "Blanqueamiento", price: "Desde $3,500", durationMin: 30 }, // coincide
    { name: "Diseño de sonrisa", price: "$20,000" },                    // solo en la página
  ];
  const p = proponerServicios(tarifario, guardados);
  assert.deepEqual(p.map(x => [x.id, x.estado, x.indiceGuardado]), [
    ["a", "nuevo", null], ["b", "distinto", 0], ["c", "sin-precio", 1], ["d", "igual", 2],
  ]);
  assert.equal(p[0].precio, "$800");
  assert.equal(p[1].enPagina?.precio, "$1,000");
});

test("aplicarServicios no quita ni reordena lo que ya estaba y conserva el ícono", () => {
  const tarifario = [fila("a", "Limpieza dental", 800, { description: "Profilaxis con ultrasonido." }), fila("b", "Resina", 1200, { duration: 45 })];
  const guardados = [{ name: "Diseño de sonrisa", price: "$20,000" }, { name: "Resina", price: "$1,000", durationMin: 30, icon: "✨", desc: "La mía" }];
  const propuesta = proponerServicios(tarifario, guardados);
  const r = aplicarServicios(guardados, propuesta, [{ id: "a", conPrecio: true }, { id: "b", conPrecio: true }]);
  assert.ok(r.ok);
  assert.deepEqual(r.servicios, [
    { name: "Diseño de sonrisa", price: "$20,000" },
    { name: "Resina", price: "$1,200", durationMin: 45, icon: "✨", desc: "La mía" },
    { name: "Limpieza dental", desc: "Profilaxis con ultrasonido.", price: "$800", durationMin: 30, icon: "🦷" },
  ]);
  // La entrada no se muta: la pantalla la sigue usando como «lo publicado».
  assert.equal(guardados[1].price, "$1,000");
});

test("sin precio: el servicio entra, el precio no", () => {
  const propuesta = proponerServicios([fila("a", "Limpieza", 800)], []);
  const r = aplicarServicios([], propuesta, [{ id: "a", conPrecio: false, desc: "Texto aprobado" }]);
  assert.ok(r.ok && r.servicios[0].price === "" && r.servicios[0].desc === "Texto aprobado");
});

test("más servicios que el tope del PATCH: se dice, no se corta en silencio", () => {
  const tarifario = Array.from({ length: MAX_SERVICIOS + 2 }, (_, i) => fila(`p${i}`, `Tratamiento ${i}`, 100 + i));
  const propuesta = proponerServicios(tarifario, []);
  const r = aplicarServicios([], propuesta, propuesta.map(p => ({ id: p.id, conPrecio: true })));
  assert.equal(r.ok, false);
  if (r.ok === false) assert.match(r.motivo, /hasta 60 servicios/);
});

test("el horario se resume agrupando días seguidos con las mismas horas", () => {
  assert.equal(resumenDeHorario(SEMANA), "Lunes a viernes 09:00–18:00 · Sábado 09:00–14:00");
  assert.equal(resumenDeHorario([]), "");
  assert.equal(resumenDeHorario([{ dayOfWeek: 2, enabled: false, openTime: "09:00", closeTime: "18:00" }]), "");
});

test("lo que falta se dice: sin tarifario, sin doctores, sin horario", () => {
  const vacia = faltantes({ ...CLINICA, address: null, phone: "" }, [], [], []);
  assert.deepEqual(vacia.map(f => f.que), ["tarifario", "doctores", "horarios", "direccion", "telefono"]);
  assert.deepEqual(faltantes(CLINICA, [fila("a", "x", 1)], [DOCTORA], SEMANA), []);
  const sinEsp = faltantes(CLINICA, [fila("a", "x", 1)], [{ ...DOCTORA, specialty: " " }], SEMANA);
  assert.deepEqual(sinEsp.map(f => f.que), ["especialidades"]);
});

test("los hechos que ve el modelo no llevan precios ni cédulas", () => {
  const hechos = construirHechos(CLINICA, [DOCTORA], SEMANA, [{ id: "a", nombre: "Limpieza", categoria: "dental", nota: null }]);
  const json = JSON.stringify(hechos);
  assert.ok(!/price|precio|cedula|\$/i.test(json), json);
  assert.equal(hechos.horario, "Lunes a viernes 09:00–18:00 · Sábado 09:00–14:00");
  assert.equal(hechos.ciudad, "Mérida, Yucatán");
});

test("una cifra que no sale de los hechos se marca; una que sí, no", () => {
  const hechos = construirHechos(CLINICA, [DOCTORA], SEMANA, []);
  assert.deepEqual(cifrasSinRespaldo("Abrimos de 9:00 a 18:00 y ofrecemos 3 y 6 meses.", hechos), []);
  assert.deepEqual(cifrasSinRespaldo("Más de 15 años y 5,000 pacientes.", hechos), ["15", "5000"]);
  assert.equal(avisosDe("Atención cálida en Mérida.", hechos).length, 0);
  assert.equal(avisosDe("Limpiezas desde $500.", hechos).length, 2);
  assert.match(avisosDe("Tratamientos sin dolor, garantizado.", hechos)[0], /promesa/);
});

test("la respuesta del modelo se valida: ids desconocidos fuera, topes puestos", () => {
  const hechos = construirHechos(CLINICA, [DOCTORA], SEMANA, [{ id: "a", nombre: "Limpieza", categoria: "dental", nota: null }]);
  const crudo = extraerJson('```json\n{"eslogan":"Tu sonrisa, en buenas manos","presentacion":"' + "x".repeat(900) + '","servicios":[{"id":"a","desc":"Limpieza profesional."},{"id":"zzz","desc":"Inventado"},{"id":"a","desc":"Repetido"}],"preguntas":[{"pregunta":"¿Dónde están?","respuesta":"En Calle 20 #123."},{"pregunta":"","respuesta":"x"}]}\n```');
  const r = validarRedaccion(crudo, hechos);
  assert.ok(r);
  assert.equal(r!.eslogan?.texto, "Tu sonrisa, en buenas manos");
  assert.equal(r!.presentacion?.texto.length, 600);
  assert.deepEqual(r!.servicios.map(s => s.id), ["a"]);
  assert.equal(r!.preguntas.length, 1);
  assert.deepEqual(r!.preguntas[0].avisos, []);
  assert.equal(validarRedaccion(extraerJson("lo siento, no puedo"), hechos), null);
  assert.equal(validarRedaccion({ eslogan: 3 }, hechos), null);
});

test("la lectura sugiere WhatsApp solo si la página no tiene uno", () => {
  assert.equal(armarLectura(CLINICA, [], [], [], []).whatsappSugerido, "999 123 4567");
  assert.equal(armarLectura({ ...CLINICA, landingWhatsapp: "9991112222" }, [], [], [], []).whatsappSugerido, null);
});
