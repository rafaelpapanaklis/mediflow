import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aplicarCorrecciones,
  purgarCorrecciones,
  registrarCorreccion,
  type CorreccionesDeEstado,
} from "../correcciones-estado-cita";

const citas = [
  { id: "a", status: "SCHEDULED", hora: "10:00" },
  { id: "b", status: "CONFIRMED", hora: "11:00" },
  { id: "c", status: "COMPLETED", hora: "12:00" },
];

test("sin correcciones devuelve la misma lista (misma identidad)", () => {
  assert.equal(aplicarCorrecciones(citas, {}), citas);
});

test("cancelar pinta la fila como CANCELLED y no toca las demás", () => {
  const corr = registrarCorreccion(citas, {}, "a", "CANCELLED");
  const vista = aplicarCorrecciones(citas, corr);
  assert.equal(vista.find((c) => c.id === "a")!.status, "CANCELLED");
  assert.equal(vista.find((c) => c.id === "a")!.hora, "10:00");
  assert.equal(vista.find((c) => c.id === "b"), citas[1]);
  assert.equal(vista.find((c) => c.id === "c"), citas[2]);
  // la lista original no se muta
  assert.equal(citas[0].status, "SCHEDULED");
});

test("los contadores que se derivan de la lista ya corregida cambian al momento", () => {
  const corr = registrarCorreccion(citas, {}, "a", "CANCELLED");
  const vista = aplicarCorrecciones(citas, corr);
  const vivas = (l: typeof citas) => l.filter((c) => !["CANCELLED", "NO_SHOW"].includes(c.status)).length;
  assert.equal(vivas(citas), 3);
  assert.equal(vivas(vista), 2);
});

test("una cita que no está, o que ya tenía ese estado, no anota nada", () => {
  const vacio: CorreccionesDeEstado = {};
  assert.equal(registrarCorreccion(citas, vacio, "zzz", "CANCELLED"), vacio);
  assert.equal(registrarCorreccion(citas, vacio, "c", "COMPLETED"), vacio);
});

test("`desde` sale de la fila del servidor, no de la ya corregida", () => {
  const corr = registrarCorreccion(citas, {}, "b", "CANCELLED");
  assert.deepEqual(corr.b, { desde: "CONFIRMED", a: "CANCELLED" });
});

test("cuando el servidor ya trae CANCELLED la corrección se descarta", () => {
  const corr = registrarCorreccion(citas, {}, "a", "CANCELLED");
  const servidorAlDia = citas.map((c) => (c.id === "a" ? { ...c, status: "CANCELLED" } : c));
  assert.deepEqual(purgarCorrecciones(servidorAlDia, corr), {});
  // y aunque no se purgara, pintarla encima no cambia nada
  const vista = aplicarCorrecciones(servidorAlDia, corr);
  assert.equal(vista, servidorAlDia);
});

test("una cita cancelada y luego reactivada NO vuelve a pintarse cancelada", () => {
  const corr = registrarCorreccion(citas, {}, "a", "CANCELLED");
  // el servidor llega con la cita cancelada → se purga
  const conCancelada = citas.map((c) => (c.id === "a" ? { ...c, status: "CANCELLED" } : c));
  const purgadas = purgarCorrecciones(conCancelada, corr);
  // luego alguien la reactiva desde «Editar cita»
  const reactivada = citas.map((c) => (c.id === "a" ? { ...c, status: "SCHEDULED" } : c));
  assert.equal(aplicarCorrecciones(reactivada, purgadas).find((c) => c.id === "a")!.status, "SCHEDULED");
});

test("si el servidor la movió a otro estado distinto del esperado, gana el servidor", () => {
  const corr = registrarCorreccion(citas, {}, "a", "CANCELLED");
  const servidor = citas.map((c) => (c.id === "a" ? { ...c, status: "IN_PROGRESS" } : c));
  assert.equal(aplicarCorrecciones(servidor, corr).find((c) => c.id === "a")!.status, "IN_PROGRESS");
  assert.deepEqual(purgarCorrecciones(servidor, corr), {});
});

test("si la fila desaparece del servidor la corrección se descarta", () => {
  const corr = registrarCorreccion(citas, {}, "a", "CANCELLED");
  assert.deepEqual(purgarCorrecciones(citas.filter((c) => c.id !== "a"), corr), {});
});

test("purgar sin nada que quitar devuelve el mismo objeto (sin re-render)", () => {
  const corr = registrarCorreccion(citas, {}, "a", "CANCELLED");
  assert.equal(purgarCorrecciones(citas, corr), corr);
});

// ── Candado del cableado ─────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { join } from "node:path";

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

test("la ficha del paciente lee las citas ya corregidas y «Cancelar» las anota", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /appointments: citasDelServidor/);
  assert.match(ficha, /aplicarCorrecciones\(citasDelServidor, correccionesCita\)/);
  assert.match(ficha, /marcarEstadoDeCita\(appt\.id, "CANCELLED"\)/);
  assert.match(ficha, /onEstadoCambiado=\{marcarEstadoDeCita\}/);
  const ventana = leer("src/components/dashboard/citas-expediente/ventana-cita.tsx");
  assert.match(ventana, /onEstadoCambiado\?\.\(cita\.id, "CANCELLED"\)/);
  assert.match(ventana, /onEstadoCambiado\?\.\(cita\.id, destino\)/);
});

// ws1-t8 (revisión final de ortodoncia, fallo 5): tras «Completar consulta» la cabecera seguía con «Próxima cita
// … · Iniciar consulta» de la cita recién completada hasta recargar. La ficha la anota COMPLETED al momento.
import { proximaCitaDeLaFicha } from "../proxima-cita";

test("una cita completada en la ficha deja de ser la «próxima» sin esperar al servidor", () => {
  const ahora = new Date("2026-10-02T20:40:00.000Z"); // 14:40 en CDMX
  const servidor = [{ id: "hoy", status: "IN_PROGRESS", startsAt: "2026-10-02T20:30:00.000Z" }];
  assert.equal(proximaCitaDeLaFicha(servidor, ahora, "America/Mexico_City")?.id, "hoy");
  const corr = registrarCorreccion(servidor, {}, "hoy", "COMPLETED");
  assert.equal(proximaCitaDeLaFicha(aplicarCorrecciones(servidor, corr), ahora, "America/Mexico_City"), null);
});

test("«Completar consulta» (y la hoja que cierra la cita) anotan la cita como COMPLETED", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  const fin = ficha.slice(ficha.indexOf("const handleEndConsult"), ficha.indexOf("const cerrarConsultaPorLaHoja"));
  // Las dos salidas buenas: la hoja ya firmada cerró la cita, y el PATCH /complete respondió bien.
  assert.equal((fin.match(/marcarEstadoDeCita\(activeAppointment\.id, "COMPLETED"\)/g) ?? []).length, 2);
  const porLaHoja = ficha.slice(ficha.indexOf("const cerrarConsultaPorLaHoja"), ficha.indexOf("const consultDoctorName"));
  assert.match(porLaHoja, /marcarEstadoDeCita\(appointmentId, "COMPLETED"\)/);
});
