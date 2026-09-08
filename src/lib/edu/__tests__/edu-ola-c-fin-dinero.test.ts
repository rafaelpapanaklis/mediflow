/**
 * OLA C·fin — DINERO Y AGENDA: lo que la auditoría final dejó abierto.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-ola-c-fin-dinero.test.ts
 *       (o `npm run test:edu`, que descubre este archivo solo)
 *
 * Fija los siete puntos que el informe del 8-sep-2026 nombra con
 * archivo:línea: la evidencia de «aceptar en el mostrador» y el vencido que
 * se cobraba (#5), la liga pública que no caducaba (S-6), el candado de
 * sede que era un no-op (S-5), el folio del cobro atascado en el 10 001, el
 * pago que caía en el cajón de la otra sede, H-63, `resolveEduStuckInvoice`,
 * el `idempotencyKey` de la conversión, el `where` del reagendado y el
 * `contactPreference: NINGUNO` que no respetaba nadie.
 *
 * Mismo enfoque doble que `edu-dinero-ola-c.test.ts`, y por la misma razón:
 * lo que vive en funciones PURAS se prueba llamándolo, y lo que vive en la
 * capa de Prisma —un `where` al que le faltaba una clave, un `update` que
 * tenía que ser `updateMany`, un ctx que llegaba sin envolver— se comprueba
 * LEYENDO EL ARCHIVO con los comentarios quitados: un archivo se juzga por
 * lo que hace, no por lo que dice su prosa.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eduNextInvoiceFolio } from "../facturacion-core";
import {
  eduQuoteLigaVigente,
  eduQuoteVencido,
  type EduQuoteStatus,
} from "../presupuestos-core";

const RAIZ = join(__dirname, "..", "..", "..", "..");

/** El archivo, sin comentarios: se juzga por lo que hace, no por lo que dice. */
function fuenteDe(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

/**
 * El cuerpo de UNA función, para no acusar al archivo entero. Vale para las
 * cuatro formas que hay en estos archivos: exportada o de módulo (`export`
 * o no), `async` o no. `nextEduChargeFolio` y `parseIdempotencyKey` no se
 * exportan, y la segunda ni siquiera es asíncrona.
 */
function cuerpoDe(src: string, nombre: string): string {
  const desde = src.search(new RegExp(`(export )?(async )?function ${nombre}\\b`));
  assert.notEqual(desde, -1, `no se encontró ${nombre}: ¿la renombraron?`);
  const cortes = [
    src.indexOf("\nexport ", desde + 1),
    src.indexOf("\nasync function ", desde + 1),
    src.indexOf("\nfunction ", desde + 1),
  ].filter((n) => n > 0);
  return cortes.length === 0 ? src.slice(desde) : src.slice(desde, Math.min(...cortes));
}

const CAJA = () => fuenteDe("src", "lib", "edu", "caja.ts");
const PRESU = () => fuenteDe("src", "lib", "edu", "presupuestos.ts");
const AGENDA = () => fuenteDe("src", "lib", "edu", "agenda.ts");
const FACT = () => fuenteDe("src", "lib", "edu", "facturacion.ts");
const WA = () => fuenteDe("src", "lib", "edu", "whatsapp.ts");

const AYER = new Date("2026-09-07T12:00:00.000Z");
const HOY = new Date("2026-09-08T12:00:00.000Z");

function quote(status: EduQuoteStatus, extra: Record<string, unknown> = {}) {
  return { status, validUntil: null as Date | null, ...extra };
}

// ═════════════════════════════════════════════════════════════════════
// #5 · ACEPTAR EN EL MOSTRADOR: EVIDENCIA, Y NADA DE VENCIDOS
// ═════════════════════════════════════════════════════════════════════

test("🔴 #5 · aceptar en el mostrador escribe las CINCO columnas de evidencia", () => {
  const cuerpo = cuerpoDe(PRESU(), "cambiarEstadoEduQuote");
  // Antes no había rama para ACEPTADO: las cinco quedaban NULL y solo las
  // escribía la liga pública. El PDF exige `acceptedAt` para pintar la
  // franja, así que uno aceptado en el mostrador salía idéntico a uno que
  // nadie ha contestado.
  assert.match(cuerpo, /destino === "ACEPTADO"/);
  for (const col of [
    "acceptedAt",
    "acceptedByName",
    "acceptedHash",
    "acceptedIp",
    "acceptedUserAgent",
  ]) {
    assert.match(cuerpo, new RegExp(`data\\.${col} =`), `falta ${col}`);
  }
});

test("🔴 #5 · el hash del mostrador es el MISMO texto canónico que el de la liga", () => {
  const cuerpo = cuerpoDe(PRESU(), "cambiarEstadoEduQuote");
  // Media evidencia para las dos puertas del mismo documento son dos reglas
  // distintas sobre el mismo papel: sin el hash no se puede contestar
  // "¿aceptó ESTE total?".
  assert.match(cuerpo, /eduQuoteTextoCanonico/);
  assert.match(cuerpo, /createHash\("sha256"\)/);
  // Y para hashear hace falta releer las partidas con sus importes.
  assert.match(cuerpo, /items:\s*\{[\s\S]*?lineTotalCents: true/);
});

test("🔴 #5 · un presupuesto VENCIDO no se acepta (y por eso no se cobra)", () => {
  const cuerpo = cuerpoDe(PRESU(), "cambiarEstadoEduQuote");
  assert.match(cuerpo, /destino === "ACEPTADO" && eduQuoteVencido\(/);
  assert.match(cuerpo, /409/);
  // 🔴 Y se comprueba con el estado de PARTIDA (`desde`), no con el de
  // destino: `eduQuoteVencido` devuelve false en cuanto el estado deja de
  // ser PRESENTADO, así que preguntarlo después de aceptar no vale.
  assert.match(cuerpo, /eduQuoteVencido\(\{ status: desde, validUntil: q\.validUntil \}, now\)/);
});

test("🔴 #5 · por qué el candado va al aceptar y no al convertir", () => {
  // La razón, comprobada: aceptar BORRA la condición de vencido.
  const vencido = { status: "PRESENTADO" as EduQuoteStatus, validUntil: AYER };
  assert.equal(eduQuoteVencido(vencido, HOY), true);
  assert.equal(eduQuoteVencido({ ...vencido, status: "ACEPTADO" }, HOY), false);
});

test("#5 · la pantalla pide el nombre de quien acepta y lo manda", () => {
  const pantalla = fuenteDe("src", "components", "edu", "dinero", "presupuestos-screen.tsx");
  assert.match(pantalla, /status: "ACEPTADO", acceptedByName: aceptante\.trim\(\)/);
  // Y no deja aceptar sin él: la liga pública exige el nombre completo y el
  // mostrador no puede pedir menos.
  assert.match(pantalla, /aceptante\.trim\(\)\.length < 3/);
});

// ═════════════════════════════════════════════════════════════════════
// S-6 · LA LIGA PÚBLICA CADUCA Y SE INVALIDA
// ═════════════════════════════════════════════════════════════════════

test("🔴 S-6 · la liga sirve solo mientras el presupuesto vive para el paciente", () => {
  // Sirve: presentado y dentro de la vigencia.
  assert.equal(eduQuoteLigaVigente(quote("PRESENTADO"), HOY), true);
  assert.equal(eduQuoteLigaVigente(quote("PRESENTADO", { validUntil: HOY }), AYER), true);
  // Sirve: aceptado y todavía sin cobro — es su propio acuse.
  assert.equal(eduQuoteLigaVigente(quote("ACEPTADO"), HOY), true);
});

test("🔴 S-6 · caducado, cancelado, rechazado, borrador y convertido: NO", () => {
  assert.equal(eduQuoteLigaVigente(quote("PRESENTADO", { validUntil: AYER }), HOY), false);
  assert.equal(eduQuoteLigaVigente(quote("CANCELADO"), HOY), false);
  assert.equal(eduQuoteLigaVigente(quote("RECHAZADO"), HOY), false);
  // Un borrador conserva el token (volverá a servir al presentarse otra
  // vez), pero mientras se edita sus partidas no son las que el paciente vio.
  assert.equal(eduQuoteLigaVigente(quote("BORRADOR"), HOY), false);
  // Ya convertido en cobro: el papel dejó de ser una oferta.
  assert.equal(eduQuoteLigaVigente(quote("ACEPTADO", { chargeId: "c1" }), HOY), false);
  assert.equal(eduQuoteLigaVigente(quote("PRESENTADO", { chargeId: "c1" }), HOY), false);
});

test("🔴 S-6 · las DOS puertas públicas pasan por la misma función", () => {
  const src = PRESU();
  const leer = cuerpoDe(src, "getEduQuotePorToken");
  // Antes buscaba por `acceptToken` sin filtrar el estado y devolvía folio,
  // título, partidas e importes de un cancelado.
  assert.match(leer, /if \(!eduQuoteLigaVigente\(/);
  assert.match(leer, /return null/);

  const aceptar = cuerpoDe(src, "aceptarEduQuotePorToken");
  assert.match(aceptar, /if \(!eduQuoteLigaVigente\(/);
  // 🔴 Y con el MISMO mensaje que un token inexistente: decir "venció" o
  // "lo canceló la clínica" confirmaría que el token es real ante quien
  // recibió la liga reenviada.
  assert.match(aceptar, /eduQuoteLigaVigente[\s\S]{0,220}"Ese enlace no es válido\.", 404/);
});

// ═════════════════════════════════════════════════════════════════════
// S-5 · EL CANDADO DE SEDE DEJA DE SER UN NO-OP
// ═════════════════════════════════════════════════════════════════════

test("🔴 S-5 · crear y retirar un bloqueo reciben el ctx CON sede", () => {
  // `eduCampusCovers(undefined, x)` devuelve true siempre, así que los dos
  // `if` de agenda-bloqueos.ts no rechazaban nunca: el ctx llegaba crudo.
  const crear = fuenteDe("src", "app", "api", "instituto", "bloqueos", "route.ts");
  assert.match(crear, /eduWithCampus\(g\.ctx, await getEduCampusScope\(g\.ctx\)\)/);
  assert.match(crear, /createEduBloqueo\(cctx,/);

  const retirar = fuenteDe("src", "app", "api", "instituto", "bloqueos", "[id]", "route.ts");
  assert.match(retirar, /eduWithCampus\(g\.ctx, await getEduCampusScope\(g\.ctx\)\)/);
  assert.match(retirar, /retirarEduBloqueo\(cctx,/);
});

test("🔴 S-5 · y el mismo mecanismo tumbaba el arreglo de H-23", () => {
  // agenda.ts mete `campusIds` en el `where` de setEduAppointmentStatus
  // desde la Ola C; la ruta pasaba `g.ctx` sin envolver y el filtro era
  // código muerto que compilaba sin ruido, porque el campo es opcional.
  assert.match(cuerpoDe(AGENDA(), "setEduAppointmentStatus"), /campusIds: ctx\.campusIds/);
  const ruta = fuenteDe("src", "app", "api", "instituto", "agenda", "[id]", "estado", "route.ts");
  assert.match(ruta, /eduWithCampus\(g\.ctx, await getEduCampusScope\(g\.ctx\)\)/);
  assert.match(ruta, /setEduAppointmentStatus\(cctx,/);
});

// ═════════════════════════════════════════════════════════════════════
// EL FOLIO DEL COBRO ATASCADO EN EL 10 001
// ═════════════════════════════════════════════════════════════════════

test("🔴 el folio del COBRO ya no muere pasado C-9999", () => {
  // Es la misma aritmética que H-68 arregló para la factura, reusada en vez
  // de copiada: "C-10000" < "C-9999" como texto, así que el "último" se
  // congelaba y el bucle de tres intentos proponía tres veces el mismo
  // folio — la caja dejaba de cobrar para toda la escuela.
  assert.equal(eduNextInvoiceFolio("C", null, 0), "C-0001");
  assert.equal(eduNextInvoiceFolio("C", "C-0041", 41), "C-0042");
  assert.equal(eduNextInvoiceFolio("C", "C-9999", 9999), "C-10000");
  assert.equal(eduNextInvoiceFolio("C", "C-9999", 10000), "C-10001");
  assert.equal(eduNextInvoiceFolio("C", "C-9999", 12345), "C-12346");
  // El conteo nunca RETROCEDE: con huecos manda el alfabético.
  assert.equal(eduNextInvoiceFolio("C", "C-0500", 3), "C-0501");
});

test("🔴 nextEduChargeFolio pregunta las DOS cosas", () => {
  const cuerpo = cuerpoDe(CAJA(), "nextEduChargeFolio");
  assert.match(cuerpo, /eduCharge\.count\(\{ where \}\)/);
  assert.match(cuerpo, /eduNextInvoiceFolio\("C", last\?\.folio \?\? null, emitidos\)/);
  // Y ya no se calcula a mano en dos sitios distintos.
  assert.doesNotMatch(cuerpo, /padStart\(4/);
});

// ═════════════════════════════════════════════════════════════════════
// H-63 · LEER Y ESCRIBIR UN COBRO POR ID, CON RECORTE DE SEDE
// ═════════════════════════════════════════════════════════════════════

test("🔴 H-63 · las TRES puertas por id llevan la sede", () => {
  const src = CAJA();
  for (const fn of ["getEduCharge", "addEduPayment", "cancelEduCharge"]) {
    assert.match(
      cuerpoDe(src, fn),
      /eduChargeScopeWhere\(\{[\s\S]{0,160}campusIds: ctx\.campusIds/,
      `${fn} sigue leyendo el cobro sin recorte de sede`,
    );
  }
});

test("🔴 H-63 · y los endpoints le pasan el alcance de verdad", () => {
  const detalle = fuenteDe("src", "app", "api", "instituto", "caja", "cobros", "[id]", "route.ts");
  assert.match(detalle, /getEduCharge\(cctx,/);
  assert.match(detalle, /cancelEduCharge\(cctx,/);
  assert.equal(
    (detalle.match(/eduWithCampus\(g\.ctx, await getEduCampusScope\(g\.ctx\)\)/g) ?? []).length,
    2,
    "GET y PATCH resuelven el alcance cada uno",
  );
  const pagos = fuenteDe(
    "src", "app", "api", "instituto", "caja", "cobros", "[id]", "pagos", "route.ts",
  );
  assert.match(pagos, /addEduPayment\(eduWithCampus\(g\.ctx, sede\)/);
});

// ═════════════════════════════════════════════════════════════════════
// EL PAGO DE OTRA SEDE QUE CAÍA EN EL TURNO DEL COBRO
// ═════════════════════════════════════════════════════════════════════

test("🔴 el pago se sella en el turno del MOSTRADOR, no en el del cobro", () => {
  const cuerpo = cuerpoDe(CAJA(), "addEduPayment");
  // El paciente pagaba $5,000 en efectivo en Sur un cobro emitido en Norte:
  // el cajón de Sur sobraba $5,000 y el esperado de Norte faltaba $5,000.
  assert.match(cuerpo, /const mostrador =/);
  assert.match(cuerpo, /options\.campusId/);
  assert.match(cuerpo, /getEduOpenCashSession\(ctx, mostrador\)/);
  // Y se cae a la sede del cobro cuando el llamador no sabe dónde está
  // (vista consolidada, instituto sin sedes): ahí no cambia nada.
  assert.match(cuerpo, /:\s*cobro\.campusId;/);
  assert.doesNotMatch(cuerpo, /getEduOpenCashSession\(ctx, cobro\.campusId\)/);
});

test("la sede del mostrador sale del selector, JAMÁS del body", () => {
  const pagos = fuenteDe(
    "src", "app", "api", "instituto", "caja", "cobros", "[id]", "pagos", "route.ts",
  );
  assert.match(pagos, /eduCampusForCharge\(sede\)/);
  assert.match(pagos, /campusId: donde\.ok \? donde\.campusId : null/);
  // Con la consolidada puesta NO se rebota: abonar a un cobro que ya existe
  // no emite ningún documento, así que no exige elegir mostrador.
  assert.doesNotMatch(pagos, /donde\.reason/);
});

// ═════════════════════════════════════════════════════════════════════
// EL idempotencyKey DE LA CONVERSIÓN DE PRESUPUESTO
// ═════════════════════════════════════════════════════════════════════

test("🔴 convertir un presupuesto pasa la clave de idempotencia", () => {
  const cuerpo = cuerpoDe(PRESU(), "convertirEduQuote");
  // El sello de `chargeId` va DESPUÉS de emitir: dos clics simultáneos
  // emitían dos cobros con dos folios y el segundo recibía un 409 que decía
  // "cancélalo en Caja", con el paciente delante.
  assert.match(cuerpo, /idempotencyKey: `presupuesto-\$\{q\.id\}`/);
  const sello = cuerpo.indexOf("chargeId: null }");
  const emite = cuerpo.indexOf("await createEduCharge(");
  assert.ok(emite > 0 && sello > emite, "el sello sigue yendo después de emitir");
});

test("la clave derivada cumple lo que exige parseIdempotencyKey", () => {
  // 16-80 caracteres de [A-Za-z0-9_-]. Un cuid son 25.
  const clave = `presupuesto-${"c".repeat(25)}`;
  assert.ok(clave.length >= 16 && clave.length <= 80);
  assert.match(clave, /^[A-Za-z0-9_-]+$/);
  const cuerpo = cuerpoDe(CAJA(), "parseIdempotencyKey");
  assert.match(cuerpo, /v\.length < 16 \|\| v\.length > 80/);
});

// ═════════════════════════════════════════════════════════════════════
// EL studentId / caseId EN EL `where` DEL REAGENDADO
// ═════════════════════════════════════════════════════════════════════

test("🔴 reagendar no deshace un traspaso", () => {
  const cuerpo = cuerpoDe(AGENDA(), "updateEduAppointment");
  // Un traspaso cambia `studentId` y `caseId` sin tocar el estado: el
  // `where` con solo `status` lo dejaba pasar y el UPDATE devolvía el
  // paciente al alumno saliente.
  assert.match(
    cuerpo,
    /updateMany\(\{[\s\S]{0,240}status: current\.status,\s*studentId: current\.studentId,\s*caseId: current\.caseId,/,
  );
  assert.match(cuerpo, /movida\.count === 0/);
  assert.match(cuerpo, /la traspasó a otro alumno/);
});

// ═════════════════════════════════════════════════════════════════════
// resolveEduStuckInvoice · NI UN SEGUNDO CFDI DE ALGO YA TIMBRADO
// ═════════════════════════════════════════════════════════════════════

test("🔴 resolveEduStuckInvoice deja de ser un check-then-act", () => {
  const cuerpo = cuerpoDe(FACT(), "resolveEduStuckInvoice");
  // Las DOS ramas —"no hay comprobante" y "aquí está el UUID"— reclaman la
  // fila con el estado leído en el `where`. Si gana la primera, la fila
  // quedaba FAILED con `activeChargeId: null`, el cobro se liberaba y el
  // siguiente "Facturar" emitía un segundo CFDI de algo que el SAT ya
  // timbró — y el primero ni se puede cancelar, porque nunca guardó su
  // `facturapiId`.
  const candados = cuerpo.match(
    /updateMany\(\{\s*where: \{ id: factura\.id, institutionId, status: "STAMPING" \}/g,
  );
  assert.equal(candados?.length, 2, "las dos ramas tienen que llevar el candado");
  assert.doesNotMatch(cuerpo, /eduInvoice\.update\(\{/);
  assert.equal((cuerpo.match(/conflictoAlResolver\(factura\.folio\)/g) ?? []).length, 2);
});

test("el 409 avisa de lo que de verdad está en juego", () => {
  const src = FACT();
  assert.match(cuerpoDe(src, "conflictoAlResolver"), /409/);
  assert.match(src, /timbraría un segundo CFDI/);
});

// ═════════════════════════════════════════════════════════════════════
// contactPreference: NINGUNO
// ═════════════════════════════════════════════════════════════════════

test("🔴 quien pidió que no le escriban no recibe WhatsApp", () => {
  const cuerpo = cuerpoDe(WA(), "enviarYRegistrar");
  // El schema lo promete desde el primer día ("NINGUNO = dijo que no quiere
  // que le escriban, y eso se respeta") y no lo miraba nadie: cero
  // apariciones de la columna en recordatorios.ts y en whatsapp.ts.
  assert.match(cuerpo, /contactPreference: true/);
  assert.match(cuerpo, /ficha\?\.contactPreference === "NINGUNO"/);
  assert.match(cuerpo, /return bloquear\(/);
});

test("🔴 se comprueba en la ÚNICA puerta, no en el barrido", () => {
  // Así lo respetan también el recibo y el consentimiento que se mandan a
  // mano desde la ficha, y ninguna pantalla futura puede olvidárselo.
  const wa = WA();
  const cuerpo = cuerpoDe(wa, "enviarYRegistrar");
  const preferencia = cuerpo.indexOf("contactPreference");
  const telefono = cuerpo.indexOf("eduWaPhone(args.rawPhone)");
  assert.ok(preferencia > 0 && telefono > 0);
  // Antes que el teléfono: el motivo escrito tiene que ser la negativa del
  // paciente, no "el teléfono no tiene 10 dígitos".
  assert.ok(preferencia < telefono);
  // Y deja constancia BLOQUEADA, como todo lo que no se intenta.
  assert.match(cuerpo, /registrarBloqueo|bloquear\(/);
});

test("solo NINGUNO bloquea: LLAMADA y CORREO son preferencia de canal", () => {
  const cuerpo = cuerpoDe(WA(), "enviarYRegistrar");
  for (const otro of ["LLAMADA", "CORREO", "WHATSAPP"]) {
    assert.doesNotMatch(
      cuerpo,
      new RegExp(`contactPreference === "${otro}"`),
      `apagarle el aviso a quien prefiere ${otro} es una decisión de producto que nadie ha tomado`,
    );
  }
});
