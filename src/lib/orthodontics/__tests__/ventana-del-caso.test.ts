// ws1-t12 — la ventana única del caso: obligatorio = técnica y doctor; lo demás a medias.
// Correr: npm run test:orto-plan-detalle
import { test } from "node:test";
import assert from "node:assert/strict";
import { costoParaGuardar, faltantesDelDiagnostico, faltantesDelPlanCompleto, fraseDeLoQueFalta, hayQueCrearLaFactura, notaDelCobro, planDePagoAlAbrir, type EstadoDelPlanEnLaVentana } from "../ventana-del-caso";

const BASE: EstadoDelPlanEnLaVentana = {
  sinTecnica: false,
  sinDoctor: false,
  costoTexto: "",
  modo: "PRECIO_TOTAL",
  modoResponsable: "none",
  tutorElegidoId: "",
  tutorNombre: "",
  tutorTelefono: "",
  errorDelPlanCompleto: null,
  despues: false,
  puedeCobrar: true,
  precioColocacion: "",
  enganche: "",
  numPagos: "18",
  primerPago: "2026-10-29",
};

test("solo la técnica y el doctor son obligatorios para abrir el caso: lo demás puede quedar vacío", () => {
  const f = faltantesDelPlanCompleto(BASE);
  assert.deepEqual(f, { obligatorios: [], correcciones: [] });
  assert.equal(fraseDeLoQueFalta(f, "crear"), null);
  const sin = faltantesDelPlanCompleto({ ...BASE, sinTecnica: true, sinDoctor: true });
  assert.equal(sin.obligatorios.length, 2);
  assert.match(fraseDeLoQueFalta(sin, "crear")!, /^Para abrir el caso falta: .*técnica.* y el doctor tratante/);
  assert.match(fraseDeLoQueFalta(sin, "editar")!, /^Para guardar falta:/);
});

test("lo que se escribe tiene que valer; lo vacío no es un problema", () => {
  assert.deepEqual(faltantesDelPlanCompleto({ ...BASE, costoTexto: "abc" }).correcciones, ["un costo válido (mayor que cero) o déjalo vacío para armarlo después"]);
  assert.deepEqual(faltantesDelPlanCompleto({ ...BASE, modoResponsable: "existing" }).correcciones, ["elegir al responsable del pago (o marcar «El paciente»)"]);
  const nuevo = faltantesDelPlanCompleto({ ...BASE, modoResponsable: "new", tutorNombre: "A", tutorTelefono: "123" }).correcciones;
  assert.equal(nuevo.length, 2);
  assert.match(faltantesDelPlanCompleto({ ...BASE, errorDelPlanCompleto: "Cantidad de controles: escribe un número." }).correcciones[0]!, /^el plan de tratamiento \(Cantidad de controles/);
});

test("con factura y pagos, el costo nuevo no puede quedar por debajo de lo pagado", () => {
  const e = { ...BASE, conFactura: true, yaPagado: 12000 };
  assert.equal(faltantesDelPlanCompleto({ ...e, costoTexto: "30000" }).correcciones.length, 0);
  assert.equal(faltantesDelPlanCompleto({ ...e, costoTexto: "12000" }).correcciones.length, 0, "igual a lo pagado sí cabe");
  assert.match(faltantesDelPlanCompleto({ ...e, costoTexto: "9000" }).correcciones[0]!, /por debajo de lo ya pagado/);
});

test("la factura se crea solo con costo válido, permiso de cobro y sin «lo armo después»", () => {
  assert.equal(hayQueCrearLaFactura({ ...BASE }), false, "sin costo");
  assert.equal(hayQueCrearLaFactura({ ...BASE, costoTexto: "36000" }), true);
  assert.equal(hayQueCrearLaFactura({ ...BASE, costoTexto: "36000", despues: true }), false);
  assert.equal(hayQueCrearLaFactura({ ...BASE, costoTexto: "36000", puedeCobrar: false }), false);
  assert.equal(hayQueCrearLaFactura({ ...BASE, costoTexto: "36000", conFactura: true }), false, "ya tiene");
  assert.equal(hayQueCrearLaFactura({ ...BASE, modo: "PAGO_POR_CONTROL" }), false, "sin precio de colocación");
  assert.equal(hayQueCrearLaFactura({ ...BASE, modo: "PAGO_POR_CONTROL", precioColocacion: "4500" }), true);
});

test("con factura por crear, enganche y pagos tienen que valer", () => {
  const f = faltantesDelPlanCompleto({ ...BASE, costoTexto: "36000", enganche: "40000" });
  assert.deepEqual(f.correcciones, ["un enganche menor al costo total"]);
  assert.deepEqual(faltantesDelPlanCompleto({ ...BASE, costoTexto: "36000", despues: true, enganche: "40000" }).correcciones, [], "con «después» no se exige nada del plan de pago");
});

test("planDePagoAlAbrir: null si no hay factura que crear; con costo, las condiciones de siempre", () => {
  assert.equal(planDePagoAlAbrir({ ...BASE, enObservacion: false }), null);
  const p = planDePagoAlAbrir({ ...BASE, costoTexto: "36000", enganche: "6000", numPagos: "15", enObservacion: false });
  assert.deepEqual(p, { modoDeCobro: "PRECIO_TOTAL", precioColocacion: null, enganche: 6000, numPagos: 15, primerPago: "2026-10-29" });
  assert.equal(planDePagoAlAbrir({ ...BASE, costoTexto: "36000", enObservacion: true }), null);
});

test("el diagnóstico pide su resumen; en observación, la fecha de revisión; con diagnóstico ya hecho, nada", () => {
  assert.equal(faltantesDelDiagnostico({ necesitaDiagnostico: false, enObservacion: false, resumen: "", proximaRevision: "" }).length, 0);
  assert.match(faltantesDelDiagnostico({ necesitaDiagnostico: true, enObservacion: false, resumen: "corto", proximaRevision: "" })[0]!, /5 de 40/);
  assert.equal(faltantesDelDiagnostico({ necesitaDiagnostico: true, enObservacion: true, resumen: "x".repeat(40), proximaRevision: "" })[0], "la fecha de la próxima revisión");
});

test("la nota bajo el botón dice qué pasará con el cobro", () => {
  const b = { enObservacion: false, puedeCobrar: true, despues: false, conFactura: false, seCreaLaFactura: true, modo: "crear" as const };
  assert.equal(notaDelCobro(b), "Se creará la factura del tratamiento con este plan");
  assert.match(notaDelCobro({ ...b, seCreaLaFactura: false }), /Sin costo todavía: el caso se abre sin factura/);
  assert.match(notaDelCobro({ ...b, despues: true }), /queda pendiente/);
  assert.match(notaDelCobro({ ...b, puedeCobrar: false }), /Recepción armará/);
  assert.match(notaDelCobro({ ...b, conFactura: true }), /su factura/);
});

test("costoParaGuardar: lo escrito o 0", () => {
  assert.equal(costoParaGuardar("36,000"), 36000);
  assert.equal(costoParaGuardar(""), 0);
  assert.equal(costoParaGuardar("abc"), 0);
});
