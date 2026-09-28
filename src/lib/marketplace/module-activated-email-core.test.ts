/**
 * Correo «Módulo activado».
 *
 *   npx tsx --test src/lib/marketplace/module-activated-email-core.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  armarCorreoModuloActivado,
  avisarModuloActivado,
  escaparHtml,
  lineaDeCobro,
  llaveCorreoModulo,
  type AvisoModuloActivado,
  type DatosCorreoModulo,
  type DepsAvisoModulo,
} from "./module-activated-email-core";

function datos(over: Partial<DatosCorreoModulo> = {}): DatosCorreoModulo {
  return {
    firstName: "Ana",
    clinicName: "Clínica Sonrisa",
    moduleName: "Ortodoncia",
    origen: "compra",
    amountMxn: 129,
    billing: "monthly",
    method: "card",
    periodEnd: new Date("2026-10-28T18:00:00Z"),
    moduleUrl: "https://www.dalecontrol.com/dashboard/orthodontics",
    primerosPasos: ["Elige cómo cobras", "Abre tu primer caso"],
    timeZone: "America/Mexico_City",
    ...over,
  };
}

test("compra con tarjeta: dice lo que pagó, que lleva IVA y cuándo se renueva", () => {
  const linea = lineaDeCobro(datos());
  assert.match(linea ?? "", /\$129\.00 MXN al mes más IVA/);
  assert.match(linea ?? "", /Se renueva solo el 28 de octubre de 2026/);
  assert.match(linea ?? "", /cancelarlo cuando quieras/);
});

test("compra anual: dice «al año»", () => {
  assert.match(lineaDeCobro(datos({ billing: "annual", amountMxn: 1316 })) ?? "", /\$1,316\.00 MXN al año más IVA/);
});

test("SPEI/OXXO: es un pago único y no promete renovación", () => {
  const linea = lineaDeCobro(datos({ method: "spei" })) ?? "";
  assert.match(linea, /pago único/);
  assert.match(linea, /activo hasta el 28 de octubre de 2026/);
  assert.doesNotMatch(linea, /Se renueva solo/);
});

test("cortesía: no habla de pagos ni de importes", () => {
  const correo = armarCorreoModuloActivado(datos({ origen: "cortesia", amountMxn: 129 }));
  assert.match(correo.text, /no se te cobra nada/);
  assert.doesNotMatch(correo.text, /\$/);
  assert.doesNotMatch(correo.text, /Confirmamos tu pago/);
  assert.match(correo.html, /Sin costo/);
});

test("compra sin importe conocido: no inventa un precio", () => {
  const correo = armarCorreoModuloActivado(datos({ amountMxn: 0 }));
  assert.equal(lineaDeCobro(datos({ amountMxn: 0 })), null);
  assert.doesNotMatch(correo.text, /\$/);
  assert.doesNotMatch(correo.html, /Tu pago/);
});

test("la fecha sale en la zona de la clínica, no un día antes ni después", () => {
  // 29-oct 03:00 UTC = 28-oct 21:00 en México.
  const linea = lineaDeCobro(datos({ periodEnd: new Date("2026-10-29T03:00:00Z") })) ?? "";
  assert.match(linea, /28 de octubre de 2026/);
});

test("una zona horaria inválida no tumba el correo", () => {
  assert.match(lineaDeCobro(datos({ timeZone: "No/Existe" })) ?? "", /28 de octubre de 2026/);
});

test("asunto, botón y primeros pasos", () => {
  const correo = armarCorreoModuloActivado(datos());
  assert.equal(correo.subject, "Tu módulo de Ortodoncia está activo · DaleControl");
  assert.match(correo.html, /href="https:\/\/www\.dalecontrol\.com\/dashboard\/orthodontics"/);
  assert.match(correo.html, /<li>Elige cómo cobras<\/li>/);
  assert.match(correo.text, /1\. Elige cómo cobras\n2\. Abre tu primer caso/);
  assert.match(correo.text, /Listo, Ana: Ortodoncia está activo/);
});

test("sin nombre ni pasos: no deja huecos", () => {
  const correo = armarCorreoModuloActivado(datos({ firstName: null, primerosPasos: [] }));
  assert.match(correo.text, /^Listo: Ortodoncia está activo/);
  assert.doesNotMatch(correo.text, /Primeros pasos/);
  assert.doesNotMatch(correo.html, /Primeros pasos/);
});

test("el nombre de la clínica se escapa en el HTML", () => {
  const correo = armarCorreoModuloActivado(datos({ clinicName: `Dental <script>alert("x")</script>` }));
  assert.doesNotMatch(correo.html, /<script>/);
  assert.match(correo.html, /&lt;script&gt;/);
  assert.equal(escaparHtml(`a&b<c>"d"'e'`), "a&amp;b&lt;c&gt;&quot;d&quot;&#39;e&#39;");
});

test("la llave del candado es la misma para el mismo pago", () => {
  const a = llaveCorreoModulo({ clinicId: "c1", moduleKey: "orthodontics", referencia: "sub_1" });
  const b = llaveCorreoModulo({ clinicId: "c1", moduleKey: "orthodontics", referencia: "sub_1" });
  const c = llaveCorreoModulo({ clinicId: "c1", moduleKey: "orthodontics", referencia: "sub_2" });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

// ── El aviso completo ──────────────────────────────────────────────────────

function montar(over: Partial<DepsAvisoModulo> = {}) {
  const enviados: Array<{ to: string; subject: string; html: string; text: string }> = [];
  const candados = new Set<string>();
  const deps: DepsAvisoModulo = {
    cargarDestino: async () => ({ email: "ana@clinica.mx", firstName: "Ana", clinicName: "Clínica Sonrisa", timeZone: "America/Mexico_City" }),
    cargarNombreModulo: async () => "Ortodoncia",
    reservar: async (llave) => {
      if (candados.has(llave)) return false;
      candados.add(llave);
      return true;
    },
    enviar: async (c) => {
      enviados.push(c);
    },
    siteUrl: "https://www.dalecontrol.com/",
    destinoDelModulo: () => ({ ruta: "/dashboard/orthodontics", primerosPasos: ["Elige cómo cobras"] }),
    ...over,
  };
  return { deps, enviados };
}

const AVISO: AvisoModuloActivado = {
  clinicId: "c1",
  moduleKey: "orthodontics",
  origen: "compra",
  referencia: "sub_1",
  amountMxn: 129,
  billing: "monthly",
  method: "card",
  periodEnd: new Date("2026-10-28T18:00:00Z"),
};

test("aviso: manda un correo al dueño con el enlace al módulo", async () => {
  const { deps, enviados } = montar();
  const r = await avisarModuloActivado(AVISO, deps);
  assert.deepEqual(r, { enviado: true, a: "ana@clinica.mx" });
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0]?.to, "ana@clinica.mx");
  assert.match(enviados[0]?.text ?? "", /https:\/\/www\.dalecontrol\.com\/dashboard\/orthodontics/);
  assert.doesNotMatch(enviados[0]?.text ?? "", /com\/\/dashboard/);
});

test("aviso: el mismo pago avisado dos veces (Stripe reenvía) manda un solo correo", async () => {
  const { deps, enviados } = montar();
  await avisarModuloActivado(AVISO, deps);
  const segundo = await avisarModuloActivado({ ...AVISO }, deps);
  assert.deepEqual(segundo, { enviado: false, motivo: "ya-enviado" });
  assert.equal(enviados.length, 1);
});

test("aviso: otra suscripción de la misma clínica sí avisa (volvió a contratar)", async () => {
  const { deps, enviados } = montar();
  await avisarModuloActivado(AVISO, deps);
  await avisarModuloActivado({ ...AVISO, referencia: "sub_2" }, deps);
  assert.equal(enviados.length, 2);
});

test("aviso: sin correo, sin clínica o sin módulo no manda nada ni toma el candado", async () => {
  let reservas = 0;
  const contar = async () => {
    reservas += 1;
    return true;
  };
  const sinCorreo = montar({ cargarDestino: async () => ({ email: "  ", firstName: null, clinicName: "X", timeZone: null }), reservar: contar });
  assert.deepEqual(await avisarModuloActivado(AVISO, sinCorreo.deps), { enviado: false, motivo: "sin-correo" });
  const sinClinica = montar({ cargarDestino: async () => null, reservar: contar });
  assert.deepEqual(await avisarModuloActivado(AVISO, sinClinica.deps), { enviado: false, motivo: "sin-clinica" });
  const sinModulo = montar({ cargarNombreModulo: async () => null, reservar: contar });
  assert.deepEqual(await avisarModuloActivado(AVISO, sinModulo.deps), { enviado: false, motivo: "sin-modulo" });
  assert.equal(reservas, 0);
  assert.equal(sinCorreo.enviados.length + sinClinica.enviados.length + sinModulo.enviados.length, 0);
});

test("aviso: si el envío o la base fallan, no lanza", async () => {
  const roto = montar({
    enviar: async () => {
      throw new Error("proveedor caído");
    },
  });
  assert.deepEqual(await avisarModuloActivado(AVISO, roto.deps), { enviado: false, motivo: "error" });
  const baseRota = montar({
    cargarDestino: async () => {
      throw new Error("pooler");
    },
  });
  assert.deepEqual(await avisarModuloActivado(AVISO, baseRota.deps), { enviado: false, motivo: "error" });
});

test("aviso de cortesía: el correo no habla de pagos", async () => {
  const { deps, enviados } = montar();
  await avisarModuloActivado({ clinicId: "c1", moduleKey: "orthodontics", origen: "cortesia", referencia: "admin:1" }, deps);
  assert.match(enviados[0]?.text ?? "", /no se te cobra nada/);
  assert.doesNotMatch(enviados[0]?.text ?? "", /Pagaste/);
});
