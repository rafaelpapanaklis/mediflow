/* ============================================================
   LA PRUEBA DEL CONTROL DE CONCURRENCIA DE LA MINI-WEB.

     npm run test:landing-concurrency

   Reproduce el fallo que dejó el editor inservible —"Tu página cambió
   en otra pestaña" el 100% de las veces, con un solo usuario y una
   sola pestaña— y fija las dos reglas que lo arreglan.

   La base falsa de abajo NO es un doble cualquiera: imita las dos
   cosas de PostgreSQL + Prisma donde estaba el fallo.

     · La columna guarda MICROsegundos (TIMESTAMPTZ(6), la convención
       del repo). Prisma la lee en un Date de JavaScript, que solo
       llega al MILIsegundo. Así que la marca que viaja al navegador
       NUNCA puede volver completa, y un `where: { updatedAt: <marca> }`
       de igualdad exacta no encuentra la fila jamás.
     · `updatedAt` se mueve por CUALQUIER escritura en la fila de la
       clínica —tokens de IA, webhook de Stripe, token de Google—, no
       solo por la mini-web.

   Sin base de datos: la lógica vive en @/lib/landing-concurrency
   contra un almacén inyectado, justo para poder probar esto.
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canonico, camposEnConflicto, guardarSinPisar, mismoContenido, ventanaDeMarca,
  type AlmacenDeClinica, type FilaDeGuardia,
} from "../landing-concurrency";

/* ══════════════════════════════════════════════════════════════
   La base falsa
   ══════════════════════════════════════════════════════════════ */

/** Reloj monótono en milisegundos. Cada escritura de Prisma avanza uno. */
let RELOJ = Date.UTC(2026, 7, 17, 5, 29, 33);

class ClinicaFalsa implements AlmacenDeClinica {
  /** La marca REAL de la columna, en microsegundos desde epoch. */
  micros: number;
  fila: Record<string, unknown>;
  /** Cuántos UPDATE guardados se intentaron. Para ver los reintentos. */
  intentos = 0;

  constructor(fila: Record<string, unknown>, opciones?: { microsegundos?: number }) {
    this.fila = { ...fila };
    // Por defecto, una fila escrita por Prisma: milisegundos exactos.
    // Con `microsegundos`, una fila escrita por SQL a mano (`NOW()`), que es
    // lo que el editor no podía volver a tocar nunca.
    this.micros = RELOJ * 1000 + (opciones?.microsegundos ?? 0);
  }

  /** Lo que Prisma devuelve al leer: el Date pierde los microsegundos. */
  private marcaLeida(): Date {
    return new Date(Math.floor(this.micros / 1000));
  }

  /** Lo que Prisma escribe en `@updatedAt`: un Date, o sea milisegundos. */
  private escribir(data: Record<string, unknown>) {
    Object.assign(this.fila, data);
    RELOJ += 1;
    this.micros = RELOJ * 1000;
  }

  /** Una escritura AJENA a la mini-web (el contador de tokens de IA, p. ej.). */
  escrituraAjena() {
    RELOJ += 1;
    this.micros = RELOJ * 1000;
  }

  /** Otra pestaña que publicó de verdad. */
  escrituraDeOtraPestana(data: Record<string, unknown>) {
    this.escribir(data);
  }

  async actualizarSi(marca: { gte: Date; lt: Date }, data: Record<string, unknown>) {
    this.intentos++;
    const dentro = this.micros >= marca.gte.getTime() * 1000 && this.micros < marca.lt.getTime() * 1000;
    if (!dentro) return 0;
    this.escribir(data);
    return 1;
  }

  async actualizar(data: Record<string, unknown>) {
    this.escribir(data);
    return this.marcaLeida();
  }

  async leer(columnas: string[]): Promise<FilaDeGuardia | null> {
    const out: FilaDeGuardia = { updatedAt: this.marcaLeida(), slug: "aurora" };
    for (const c of columnas) out[c] = this.fila[c] ?? null;
    return out;
  }
}

const SECCIONES_A = [{ id: "servicios", visible: true, orden: 0, titulo: "Lo que hacemos" }];
const SECCIONES_B = [{ id: "servicios", visible: true, orden: 0, titulo: "Nuestros tratamientos" }];

/** Lo que manda el editor: los valores nuevos y la base de la que partió. */
const guardar = (
  db: ClinicaFalsa,
  marca: Date,
  data: Record<string, unknown>,
  base: Record<string, unknown> | null,
) => guardarSinPisar(db, { data, esperado: marca, base });

/* ══════════════════════════════════════════════════════════════
   1 · EL FALLO: dos guardados seguidos desde la MISMA pestaña
   ══════════════════════════════════════════════════════════════ */

test("guardar dos veces seguidas desde la misma pestaña NO da 409", async () => {
  const db = new ClinicaFalsa({ landingSections: null });

  // La pestaña carga: se queda con la marca que le da el servidor.
  let marca = (await db.leer([])).updatedAt;
  let publicado: Record<string, unknown> = { landingSections: null };

  for (const secciones of [SECCIONES_A, SECCIONES_B]) {
    const r = await guardar(db, marca, { landingSections: secciones }, publicado);
    assert.equal(r.estado, "ok", "el segundo guardado desde la misma pestaña no puede ser un conflicto");
    if (r.estado !== "ok") return;
    // La pestaña se queda con la marca NUEVA y con lo que acaba de publicar.
    marca = r.updatedAt;
    publicado = { landingSections: secciones };
  }

  assert.deepEqual(db.fila.landingSections, SECCIONES_B);
});

test("una fila con microsegundos (escrita por SQL a mano) se puede guardar", async () => {
  // Éste es EXACTAMENTE el caso que dejaba el editor muerto para siempre: la
  // marca de la fila tiene 456 microsegundos que ningún Date puede expresar,
  // así que la igualdad exacta no encontraba la fila NUNCA — y como el
  // guardado no entraba, el valor tampoco se normalizaba.
  const db = new ClinicaFalsa({ landingSections: null }, { microsegundos: 456 });
  const marca = (await db.leer([])).updatedAt;
  assert.equal(marca.getTime() * 1000 + 456, db.micros, "la marca leída perdió los microsegundos, como en Prisma");

  const r = await guardar(db, marca, { landingSections: SECCIONES_A }, { landingSections: null });
  assert.equal(r.estado, "ok");
  assert.deepEqual(db.fila.landingSections, SECCIONES_A);
});

test("la guardia VIEJA (igualdad exacta) no encontraba esa fila: por eso el 409 era eterno", async () => {
  // El camino inverso. Si esto dejara de fallar, el arreglo de arriba estaría
  // probando otra cosa. `where: { updatedAt: <la marca leída> }` es lo que
  // había antes; contra una columna de microsegundos no acierta nunca, y como
  // el UPDATE no entra, la marca tampoco se normaliza: la fila queda muerta.
  const db = new ClinicaFalsa({ landingSections: null }, { microsegundos: 456 });
  const marca = (await db.leer([])).updatedAt;

  const igualdadExacta = marca.getTime() * 1000 === db.micros;
  assert.equal(igualdadExacta, false, "si esto fuera true, el fallo original no se estaría reproduciendo");

  // Y lo mismo tres veces seguidas: no es una carrera, es un punto muerto.
  for (let i = 0; i < 3; i++) {
    assert.equal(marca.getTime() * 1000 === db.micros, false);
  }
});

/* ══════════════════════════════════════════════════════════════
   2 · Un movimiento AJENO a la mini-web no es un conflicto
   ══════════════════════════════════════════════════════════════ */

test("una escritura ajena (tokens de IA, Stripe…) no dispara el conflicto", async () => {
  const db = new ClinicaFalsa({ landingSections: null });
  const marca = (await db.leer([])).updatedAt;

  // Mientras la clínica escribía, otro endpoint tocó la fila. `updatedAt` se
  // movió, pero la mini-web está intacta.
  db.escrituraAjena();

  const r = await guardar(db, marca, { landingSections: SECCIONES_A }, { landingSections: null });
  assert.equal(r.estado, "ok", "nadie tocó la mini-web: no hay a quién pisar");
  assert.equal(db.intentos, 2, "el primer intento falla y el segundo entra sobre la marca nueva");
});

test("varios movimientos ajenos seguidos siguen sin ser conflicto", async () => {
  const db = new ClinicaFalsa({ landingTagline: "antes" });
  const marca = (await db.leer([])).updatedAt;
  db.escrituraAjena();
  db.escrituraAjena();

  const r = await guardar(db, marca, { landingTagline: "después" }, { landingTagline: "antes" });
  assert.equal(r.estado, "ok");
  assert.equal(db.fila.landingTagline, "después");
});

/* ══════════════════════════════════════════════════════════════
   3 · Un conflicto DE VERDAD sí se para, y dice qué pasó
   ══════════════════════════════════════════════════════════════ */

test("otra pestaña que cambió la MISMA columna sí da conflicto, con el campo y el valor", async () => {
  const db = new ClinicaFalsa({ landingSections: null, landingTagline: "antes" });
  const marca = (await db.leer([])).updatedAt;

  db.escrituraDeOtraPestana({ landingSections: SECCIONES_B });

  const r = await guardar(
    db, marca,
    { landingSections: SECCIONES_A },
    { landingSections: null },
  );
  assert.equal(r.estado, "conflicto");
  if (r.estado !== "conflicto") return;
  assert.deepEqual(r.campos, ["landingSections"]);
  assert.deepEqual(r.actual.landingSections, SECCIONES_B, "hay que devolver lo de la base para poder ofrecer una salida");
  assert.deepEqual(db.fila.landingSections, SECCIONES_B, "no se pisó nada");
});

test("el conflicto señala SOLO las columnas que se movieron", async () => {
  const db = new ClinicaFalsa({ landingSections: null, landingTagline: "antes" });
  const marca = (await db.leer([])).updatedAt;

  db.escrituraDeOtraPestana({ landingTagline: "lo de la otra pestaña" });

  const r = await guardar(
    db, marca,
    { landingSections: SECCIONES_A, landingTagline: "lo mío" },
    { landingSections: null, landingTagline: "antes" },
  );
  assert.equal(r.estado, "conflicto");
  if (r.estado !== "conflicto") return;
  assert.deepEqual(r.campos, ["landingTagline"]);
});

test("publicar de todos modos: con la base que devolvió el conflicto, entra", async () => {
  const db = new ClinicaFalsa({ landingSections: null });
  const marca = (await db.leer([])).updatedAt;
  db.escrituraDeOtraPestana({ landingSections: SECCIONES_B });

  const primero = await guardar(db, marca, { landingSections: SECCIONES_A }, { landingSections: null });
  assert.equal(primero.estado, "conflicto");
  if (primero.estado !== "conflicto") return;

  // Es la salida que ofrece el diálogo: "publica lo mío encima". Se reintenta
  // con la marca y la base que acaba de devolver el servidor.
  const segundo = await guardar(db, primero.updatedAt, { landingSections: SECCIONES_A }, primero.actual);
  assert.equal(segundo.estado, "ok");
  assert.deepEqual(db.fila.landingSections, SECCIONES_A);
});

test("sin `base` cualquier movimiento cuenta como conflicto (conservador)", async () => {
  const db = new ClinicaFalsa({ landingSections: null });
  const marca = (await db.leer([])).updatedAt;
  db.escrituraAjena();

  const r = await guardar(db, marca, { landingSections: SECCIONES_A }, null);
  assert.equal(r.estado, "conflicto", "sin base no se puede saber si el movimiento me tocaba a mí");
});

/* ══════════════════════════════════════════════════════════════
   4 · Sin marca: el formulario de siempre escribe sin guardia
   ══════════════════════════════════════════════════════════════ */

test("sin esperadoUpdatedAt se escribe sin control (el formulario de siempre)", async () => {
  const db = new ClinicaFalsa({ landingTagline: "antes" });
  db.escrituraAjena();
  const r = await guardarSinPisar(db, { data: { landingTagline: "nuevo" }, esperado: null, base: null });
  assert.equal(r.estado, "ok");
  assert.equal(db.fila.landingTagline, "nuevo");
  assert.equal(db.intentos, 0, "no se usa el UPDATE guardado");
});

/* ══════════════════════════════════════════════════════════════
   5 · Las piezas
   ══════════════════════════════════════════════════════════════ */

test("el orden de las claves de un objeto no es una diferencia", () => {
  assert.ok(mismoContenido({ id: "a", titulo: "x" }, { titulo: "x", id: "a" }));
  assert.ok(mismoContenido([{ a: 1, b: 2 }], [{ b: 2, a: 1 }]));
  // El orden de una LISTA sí lo es: reordenar servicios es un cambio real.
  assert.ok(!mismoContenido([{ a: 1 }, { a: 2 }], [{ a: 2 }, { a: 1 }]));
});

test("null, undefined y clave ausente son lo mismo (columna Json vacía)", () => {
  assert.ok(mismoContenido(null, undefined));
  assert.ok(mismoContenido({ a: 1 }, { a: 1, b: undefined }));
  assert.deepEqual(camposEnConflicto(["landingFaqs"], {}, { landingFaqs: null }), []);
});

test("una lista vacía NO es lo mismo que null", () => {
  assert.ok(!mismoContenido([], null));
  assert.deepEqual(camposEnConflicto(["landingFaqs"], { landingFaqs: [] }, { landingFaqs: null }), ["landingFaqs"]);
});

test("canonico no se traga las claves heredadas del prototipo", () => {
  const raro = Object.create({ heredada: "no debería salir" }) as Record<string, unknown>;
  raro.propia = 1;
  assert.equal(canonico(raro), '{"propia":1}');
});

test("la ventana de la marca cubre el milisegundo entero y solo ése", () => {
  const v = ventanaDeMarca(new Date(1_700_000_000_123));
  assert.equal(v.gte.getTime(), 1_700_000_000_123);
  assert.equal(v.lt.getTime(), 1_700_000_000_124);
});
