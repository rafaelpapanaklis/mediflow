/**
 * EL CONTRATO DE LAS FILAS DEL PLAN (ws1-t12 · P1) — funciones puras.
 *
 * Run: npm run test:plan-filas
 *
 * Dinero en centavos exactos, lectura de lo que manda el navegador, estados y «editar el plan»
 * (nada se borra: se cancela; una fila hecha o cobrada no se calla).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aCentavos, aPesos, filaDto, leerFila, leerFilas, motivoParaNoCancelar, planearCambios, puedePasar, resumenDeFilas,
  totalCentavos, conProcedimientosValidos, MAX_FILAS_POR_PLAN, type FilaDelPlan,
} from "@/lib/treatments/items";
import { mensajeDeFila, cuerpoDeErrorDeFila } from "@/lib/treatments/errores";

const fila = (id: string, extra: Partial<FilaDelPlan> = {}): FilaDelPlan => ({
  id, clinicId: "c1", planId: "p1", procedureId: null, nombre: `Proc ${id}`, dientes: [], caras: [], fase: "restauradora",
  faseNumero: null, cantidad: 1, precioCentavos: 100_00, estado: "pendiente", hechoEn: null, hechoPor: null, citaId: null,
  motivo: "", hallazgo: null, invoiceId: null, invoiceLinea: null, quoteItemId: null, orden: 0, canceladoEn: null,
  canceladoPor: null, createdById: null, createdAt: new Date(0), updatedAt: new Date(0), ...extra,
});

test("dinero: pesos → centavos sin pasar por float, y de vuelta", () => {
  assert.equal(aCentavos("1,250.50"), 125050);
  assert.equal(aCentavos("$1,250.5"), 125050);
  assert.equal(aCentavos(1250.5), 125050);
  assert.equal(aCentavos("0.29"), 29); // en float 0.29 × 100 = 28.999…
  assert.equal(aCentavos(0.29), 29);
  assert.equal(aCentavos("0.295"), 30); // tercer decimal redondea
  assert.equal(aCentavos("449.60"), 44960);
  assert.ok(Number.isNaN(aCentavos("doce")));
  assert.ok(Number.isNaN(aCentavos(undefined)));
  assert.equal(aPesos(125050), 1250.5);
});

test("leer una fila: dientes, caras, precio y estado como los manda la ventana", () => {
  const { fila: f, codigo } = leerFila({ nombre: " Resina 2 caras ", dientes: "16, 26", caras: "mi", precio: "1250.50", cantidad: "2", fase: "restauradora", motivo: "Caries" });
  assert.equal(codigo, null);
  assert.deepEqual(f!.dientes, [16, 26]);
  assert.deepEqual(f!.caras, ["M", "O"], "la incisal se guarda como O y en orden de lectura");
  assert.equal(f!.precioCentavos, 125050);
  assert.equal(f!.cantidad, 2);
  assert.equal(f!.nombre, "Resina 2 caras");
  assert.equal(f!.estado, "pendiente");
  assert.equal(f!.id, null);
  // precioCentavos manda sobre precio; dientes como lista; sin cantidad = 1
  const b = leerFila({ name: "Limpieza", dientes: [11, 11], precioCentavos: 80000, precio: "1" }).fila!;
  assert.deepEqual(b.dientes, [11]);
  assert.equal(b.precioCentavos, 80000);
  assert.equal(b.cantidad, 1);
  // sin precio = $0 (cortesía), no un error
  assert.equal(leerFila({ nombre: "Revisión" }).fila!.precioCentavos, 0);
  // hallazgo de origen
  const h = leerFila({ nombre: "Endodoncia", hallazgo: { condicion: "pulpitis", diente: 36, caras: ["o"], entryId: "e1" } }).fila!;
  assert.deepEqual(h.hallazgo, { condicion: "pulpitis", diente: 36, caras: ["O"], entryId: "e1" });
});

test("leer una fila: cada dato malo tiene su código", () => {
  const casos: Array<[Record<string, unknown>, string]> = [
    [{}, "sin_nombre"],
    [{ nombre: "   " }, "sin_nombre"],
    [{ nombre: "x".repeat(201) }, "nombre_largo"],
    [{ nombre: "R", dientes: "16, 99" }, "diente_invalido"],
    [{ nombre: "R", caras: "MX" }, "cara_invalida"],
    [{ nombre: "R", fase: "inventada" }, "fase_invalida"],
    [{ nombre: "R", faseNumero: 0 }, "fase_invalida"],
    [{ nombre: "R", cantidad: 0 }, "cantidad_invalida"],
    [{ nombre: "R", cantidad: 1.5 }, "cantidad_invalida"],
    [{ nombre: "R", cantidad: 1000 }, "cantidad_invalida"],
    [{ nombre: "R", precio: "-5" }, "precio_invalido"],
    [{ nombre: "R", precio: "doce" }, "precio_invalido"],
    [{ nombre: "R", precioCentavos: 10.5 }, "precio_invalido"],
    [{ nombre: "R", precio: 10_000_001 }, "precio_invalido"],
    [{ nombre: "R", estado: "cancelado" }, "estado_invalido"],
  ];
  for (const [raw, codigo] of casos) assert.equal(leerFila(raw).codigo, codigo, JSON.stringify(raw));
  // los tres estados con los que puede nacer
  for (const estado of ["pendiente", "en_curso", "hecho"]) assert.equal(leerFila({ nombre: "R", estado }).fila!.estado, estado);
});

test("leer la lista: una fila mala detiene todo, con su índice; ids repetidos; tope", () => {
  assert.equal(leerFilas("no").codigo, "filas_no_lista");
  const mala = leerFilas([{ nombre: "A" }, { nombre: "B", dientes: "99" }]);
  assert.equal(mala.ok, false);
  assert.equal(mala.indice, 1);
  assert.equal(mala.codigo, "diente_invalido");
  assert.equal(leerFilas([{ id: "f1", nombre: "A" }, { id: "f1", nombre: "B" }]).codigo, "fila_repetida");
  assert.equal(leerFilas(Array.from({ length: MAX_FILAS_POR_PLAN + 1 }, () => ({ nombre: "A" }))).codigo, "demasiadas_filas");
  const ok = leerFilas([{ nombre: "A" }, { id: "f2", nombre: "B" }]);
  assert.equal(ok.ok, true);
  assert.equal(ok.filas!.length, 2);
  assert.equal(ok.filas![1].id, "f2");
});

test("estados: lo que se puede y lo que no", () => {
  assert.ok(puedePasar("pendiente", "hecho"));
  assert.ok(puedePasar("pendiente", "en_curso"));
  assert.ok(puedePasar("en_curso", "hecho"));
  assert.ok(puedePasar("hecho", "pendiente"), "deshacer");
  assert.ok(!puedePasar("hecho", "cancelado"), "un hecho no se cancela");
  assert.ok(!puedePasar("cancelado", "pendiente"), "una cancelada no revive: es fila nueva");
  assert.equal(motivoParaNoCancelar(fila("a", { estado: "hecho" })), "fila_hecha");
  assert.equal(motivoParaNoCancelar(fila("a", { invoiceId: "inv1" })), "fila_cobrada");
  assert.equal(motivoParaNoCancelar(fila("a")), null);
});

test("resumen y total: las canceladas no cuentan", () => {
  const filas = [
    fila("a", { cantidad: 2, precioCentavos: 1250_50 }),
    fila("b", { estado: "hecho", precioCentavos: 800_00, invoiceId: "inv1" }),
    fila("c", { estado: "en_curso", precioCentavos: 0 }),
    fila("d", { estado: "cancelado", precioCentavos: 999_00 }),
  ];
  assert.equal(totalCentavos(filas), 2 * 1250_50 + 800_00);
  assert.deepEqual(resumenDeFilas(filas), {
    vivas: 3, pendientes: 1, enCurso: 1, hechas: 1, canceladas: 1, totalCentavos: 3301_00, enNotaCentavos: 800_00,
  });
  const dto = filaDto(filas[0]);
  assert.equal(dto.precio, 1250.5);
  assert.equal(dto.importe, 2501);
  assert.equal(dto.createdAt, new Date(0).toISOString());
});

test("editar el plan: altas, cambios, cancelaciones y orden", () => {
  const actuales = [fila("a", { orden: 0 }), fila("b", { orden: 1 }), fila("c", { orden: 2 }), fila("x", { estado: "cancelado", orden: 3 })];
  const lectura = leerFilas([
    { id: "b", nombre: "Proc b", fase: "restauradora", precioCentavos: 100_00 }, // igual: no es cambio
    { nombre: "Nueva", precio: 300 },
    { id: "a", nombre: "Proc a", fase: "restauradora", precioCentavos: 150_00 }, // cambia precio
  ]);
  const plan = planearCambios(actuales, lectura.filas!);
  assert.equal(plan.ok, true);
  assert.equal(plan.altas!.length, 1);
  assert.equal(plan.altas![0].nombre, "Nueva");
  assert.deepEqual(plan.cambios!.map((c) => c.id), ["a"]);
  assert.deepEqual(plan.cancelar!.map((f) => f.id), ["c"], "c no vino: se cancela; x ya estaba cancelada");
  assert.deepEqual(plan.orden, ["b", "alta:0", "a"]);
});

test("editar el plan: lo que no se deja", () => {
  const cobrada = fila("a", { invoiceId: "inv1", precioCentavos: 100_00 });
  const hecha = fila("h", { estado: "hecho" });
  // una cobrada no cambia de precio…
  let r = planearCambios([cobrada], leerFilas([{ id: "a", nombre: "Proc a", precioCentavos: 120_00 }]).filas!);
  assert.equal(r.codigo, "fila_cobrada");
  assert.equal(r.indice, 0);
  // …pero sí de dientes y fase
  r = planearCambios([cobrada], leerFilas([{ id: "a", nombre: "Proc a", precioCentavos: 100_00, dientes: "16", fase: "correctiva" }]).filas!);
  assert.equal(r.ok, true);
  assert.equal(r.cambios!.length, 1);
  // una cobrada o hecha no se calla
  assert.equal(planearCambios([cobrada], []).codigo, "fila_cobrada");
  assert.equal(planearCambios([hecha], []).codigo, "fila_hecha");
  // un id ajeno, o de una cancelada
  assert.equal(planearCambios([fila("a")], leerFilas([{ id: "zz", nombre: "Q" }]).filas!).codigo, "fila_desconocida");
  assert.equal(planearCambios([fila("a", { estado: "cancelado" })], leerFilas([{ id: "a", nombre: "Q" }]).filas!).codigo, "fila_cancelada");
});

test("procedimiento de otra clínica: se anula, la fila se queda", () => {
  const filas = leerFilas([{ nombre: "A", procedureId: "mio" }, { nombre: "B", procedureId: "ajeno" }]).filas!;
  const limpias = conProcedimientosValidos(filas, new Set(["mio"]));
  assert.deepEqual(limpias.map((f) => f.procedureId), ["mio", null]);
});

test("mensajes de error en es y en, con código e índice", () => {
  assert.match(mensajeDeFila("fila_cobrada"), /nota de cobro/);
  assert.match(mensajeDeFila("fila_cobrada", "en"), /billing note/);
  assert.match(mensajeDeFila("inventado"), /No se pudo guardar/);
  assert.deepEqual(Object.keys(cuerpoDeErrorDeFila("diente_invalido", 2)), ["error", "code", "indice"]);
  assert.deepEqual(Object.keys(cuerpoDeErrorDeFila("fila_hecha", -1)), ["error", "code"]);
});
