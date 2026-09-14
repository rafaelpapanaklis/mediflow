/**
 * La tarjeta de confirmación: que no se pueda confirmar por error y que nunca
 * diga «hecho» sin que lo diga el servidor.
 *
 *   npm run test:sabina-tarjeta
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SABINA_ARMADO_MS,
  actualizarPropuesta,
  desfaseReloj,
  estadoVisible,
  etiquetaEstado,
  leerPropuesta,
  leerRespuestaPropuesta,
  marcarReemplazadas,
  pideCasilla,
  puedeConfirmar,
  repartirPropuestas,
  textoCaducidad,
  type SabinaPropuestaVista,
} from "../propuesta-core";

const T0 = 1_757_800_000_000;

function vista(over: Partial<SabinaPropuestaVista> = {}): SabinaPropuestaVista {
  return {
    id: "3f1c2a8e-1111-4aaa-8bbb-123456789abc",
    accion: "agendar_cita",
    titulo: "Agendar cita",
    boton: "Sí, agendar",
    tarjeta: { frase: "Agendar a María López el jueves 18 a las 10:00 con el Dr. Ruiz", detalles: [], avisos: [] },
    deshacer: { reversible: true, como: "Cancelando la cita." },
    creadaEn: T0,
    expiraEn: T0 + 10 * 60_000,
    estado: "pendiente",
    resultado: null,
    ...over,
  };
}

const base = { ahoraCliente: T0 + 5_000, desfase: 0, armada: true, casillaMarcada: false, ocupado: false };

test("el botón nace apagado: sin armar no se confirma", () => {
  assert.ok(SABINA_ARMADO_MS >= 1_000);
  assert.equal(puedeConfirmar({ ...base, propuesta: vista(), armada: false }), false);
  assert.equal(puedeConfirmar({ ...base, propuesta: vista() }), true);
});

test("mientras hay otra petición en marcha no se confirma", () => {
  assert.equal(puedeConfirmar({ ...base, propuesta: vista(), ocupado: true }), false);
});

test("lo que no se puede deshacer pide la casilla, y sin ella no se confirma", () => {
  const irreversible = vista({ deshacer: { reversible: false, aviso: "El paciente recibe el correo de cancelación." } });
  assert.equal(pideCasilla(irreversible), true);
  assert.equal(puedeConfirmar({ ...base, propuesta: irreversible }), false);
  assert.equal(puedeConfirmar({ ...base, propuesta: irreversible, casillaMarcada: true }), true);
  assert.equal(pideCasilla(vista()), false);
});

test("una propuesta que no declara con claridad que se puede deshacer se trata como irreversible", () => {
  const cruda = { ...vista(), deshacer: { reversible: "sí" } };
  const leida = leerPropuesta(cruda)!;
  assert.equal(leida.deshacer.reversible, false);
  assert.equal(pideCasilla(leida), true);
});

test("caducada con el reloj del SERVIDOR: un teléfono atrasado no la enseña viva", () => {
  const p = vista();
  const clienteAtrasado = T0 + 9 * 60_000; // el teléfono cree que faltan 60 s
  const desfase = desfaseReloj(T0 + 10 * 60_000 + 1, clienteAtrasado); // el servidor dice que ya pasó
  assert.equal(estadoVisible(p, clienteAtrasado, desfase), "caducada");
  assert.equal(puedeConfirmar({ ...base, propuesta: p, ahoraCliente: clienteAtrasado, desfase }), false);
  assert.equal(textoCaducidad(p, clienteAtrasado, desfase), "Caducada");
});

test("la cuenta atrás se lee en minutos", () => {
  assert.equal(textoCaducidad(vista(), T0 + 30_000, 0), "Caduca en 9 min");
  assert.equal(textoCaducidad(vista(), T0 + 9 * 60_000 + 30_000, 0), "Caduca en menos de un minuto");
});

test("ningún estado que no sea `pendiente` deja confirmar", () => {
  for (const estado of ["en_curso", "hecha", "fallida", "descartada", "reemplazada", "caducada"] as const) {
    assert.equal(puedeConfirmar({ ...base, propuesta: vista({ estado }) }), false, estado);
  }
});

test("mientras no se confirme, la cabecera dice que no se hizo nada", () => {
  assert.match(etiquetaEstado("pendiente").texto, /todavía no se hizo nada/);
  for (const e of ["descartada", "reemplazada", "caducada"] as const) assert.match(etiquetaEstado(e).texto, /no se hizo nada/);
  assert.equal(etiquetaEstado("hecha").tono, "bien");
});

test("respuesta perdida al confirmar → «no se sabe», nunca «hecho»", () => {
  assert.deepEqual(leerRespuestaPropuesta(null, null, T0), { tipo: "desconocido" });
  assert.deepEqual(leerRespuestaPropuesta(502, "<html>", T0), { tipo: "desconocido" });
});

test("respuesta con propuesta: se usa su estado y su reloj", () => {
  const cuerpo = { propuesta: vista({ estado: "hecha", resultado: { ok: true, tipo: "hecha", frase: "Agendé." } }), ahora: T0 + 2_000 };
  const r = leerRespuestaPropuesta(200, cuerpo, T0);
  assert.equal(r.tipo, "propuesta");
  if (r.tipo === "propuesta") {
    assert.equal(r.propuesta.estado, "hecha");
    assert.equal(r.propuesta.resultado?.frase, "Agendé.");
    assert.equal(r.desfase, 2_000);
  }
});

test("404 sin propuesta trae su frase; 401 y 429 se explican sin prometer nada", () => {
  const r404 = leerRespuestaPropuesta(404, { resultado: { ok: false, tipo: "no_encontrada", frase: "No encuentro esa propuesta. No se hizo nada." } }, T0);
  assert.equal(r404.tipo, "sin_propuesta");
  const r401 = leerRespuestaPropuesta(401, { error: "x" }, T0);
  assert.equal(r401.tipo === "sin_propuesta" && r401.resultado.ok, false);
  const r429 = leerRespuestaPropuesta(429, null, T0);
  assert.match(r429.tipo === "sin_propuesta" ? r429.resultado.frase : "", /no se hizo nada/);
});

test("una propuesta rota del servidor no se pinta", () => {
  assert.equal(leerPropuesta({ id: "x" }), null);
  assert.equal(leerPropuesta({ ...vista(), estado: "inventado" }), null);
  assert.equal(leerPropuesta({ ...vista(), expiraEn: "mañana" }), null);
});

test("al llegar una propuesta nueva, las pendientes anteriores se ven sustituidas (y las cerradas no se tocan)", () => {
  const vieja = vista({ id: "a" });
  const hecha = vista({ id: "b", estado: "hecha" });
  const nueva = vista({ id: "c" });
  const mensajes = [
    { role: "assistant", timestamp: T0, propuestas: [vieja, hecha] },
    { role: "assistant", timestamp: T0 + 1, propuestas: [nueva] },
  ];
  const r = marcarReemplazadas(mensajes, ["c"]);
  assert.deepEqual(r.flatMap((m) => m.propuestas!.map((p) => [p.id, p.estado])), [
    ["a", "reemplazada"],
    ["b", "hecha"],
    ["c", "pendiente"],
  ]);
});

test("actualizar una propuesta la cambia donde esté", () => {
  const mensajes = [{ role: "assistant", timestamp: T0, propuestas: [vista({ id: "a" })] }];
  const r = actualizarPropuesta(mensajes, vista({ id: "a", estado: "descartada" }));
  assert.equal(r[0].propuestas![0].estado, "descartada");
});

test("al reabrir, cada tarjeta va bajo la respuesta de Sabina de su turno", () => {
  const mensajes: Array<{ role: string; timestamp: number; propuestas?: SabinaPropuestaVista[] }> = [
    { role: "user", timestamp: T0 + 10 },
    { role: "assistant", timestamp: T0 + 11 },
    { role: "user", timestamp: T0 + 500 },
    { role: "assistant", timestamp: T0 + 501 },
  ];
  const r = repartirPropuestas(mensajes, [vista({ id: "segunda", creadaEn: T0 + 400 }), vista({ id: "primera", creadaEn: T0 + 5 })]);
  assert.deepEqual(r[1].propuestas?.map((p) => p.id), ["primera"]);
  assert.deepEqual(r[3].propuestas?.map((p) => p.id), ["segunda"]);
});

/* ── Tabla de conceptos y enlace a lo creado (dinero, ws1-t2) ─────────── */

test("la tabla llega entera o no llega: una fila de otro ancho la descarta (los importes caerían bajo otra columna)", () => {
  const tabla = {
    columnas: [{ titulo: "Concepto" }, { titulo: "Importe", numerica: true }],
    filas: [["Limpieza", "$800.00"], ["Resina", "$651.00"]],
    pie: [{ etiqueta: "Total", valor: "$1,451.00", fuerte: true }],
  };
  const buena = leerPropuesta({ ...vista(), tarjeta: { ...vista().tarjeta, tabla } });
  assert.deepEqual(buena?.tarjeta.tabla, tabla);

  const rota = leerPropuesta({ ...vista(), tarjeta: { ...vista().tarjeta, tabla: { ...tabla, filas: [["Limpieza"]] } } });
  assert.ok(rota, "la propuesta se sigue pintando");
  assert.equal(rota!.tarjeta.tabla, undefined, "pero sin la tabla desalineada");
  assert.equal(leerPropuesta(vista())?.tarjeta.tabla, undefined, "sin tabla, nada");
});

test("el enlace del resultado solo abre rutas de la app; uno hacia fuera se ignora", () => {
  const conEnlace = (url: string) =>
    leerRespuestaPropuesta(200, {
      propuesta: { ...vista({ estado: "hecha" }), resultado: { ok: true, tipo: "hecha", frase: "Listo.", enlace: { texto: "Comprobante MF-0016", url } } },
    }, T0);
  const buena = conEnlace("/api/invoices/inv_1/print");
  assert.equal(buena.tipo, "propuesta");
  assert.deepEqual((buena as any).propuesta.resultado.enlace, { texto: "Comprobante MF-0016", url: "/api/invoices/inv_1/print" });
  for (const mala of ["https://otro.sitio/x", "javascript:alert(1)", "//otro.sitio/api/x", "/api/../../etc/passwd", "/login"]) {
    const r = conEnlace(mala);
    assert.equal((r as any).propuesta.resultado.enlace, undefined, mala);
    assert.equal((r as any).propuesta.resultado.frase, "Listo.", "la frase se conserva");
  }
});
