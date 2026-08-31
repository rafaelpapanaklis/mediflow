/**
 * FACTURACIÓN CFDI — Ola 10 de DaleControl INSTITUCIONAL.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-facturacion.test.ts
 *
 * (No hay `npm run test:edu-facturacion`: package.json es un archivo del
 * producto dental y esta ola no lo toca. Cuando el vertical se integre a
 * main, es UNA línea.)
 *
 * Todo se comprueba SIN base de datos y SIN red: las validaciones, la
 * aritmética y el payload de Facturapi son funciones puras, y lo que no lo
 * es se comprueba LEYENDO EL CÓDIGO (el orden del candado, que el ambiente
 * no salga de una variable de entorno, que ninguna lectura se salte la
 * puerta del dinero).
 *
 * Lo que fija este archivo, en orden de importancia:
 *
 *  1. 🔴 QUE UN COBRO NO SE PUEDA FACTURAR DOS VECES. El candado es el
 *     índice único (institutionId, activeChargeId) y la RESERVA que se
 *     inserta ANTES de llamar a Facturapi. Las dos cosas se verifican:
 *     que estén declaradas (schema + .sql) y que el orden del código sea
 *     ése y no el contrario.
 *
 *  2. 🔴 QUE LOS IMPORTES SALGAN DEL COBRO CONGELADO. `eduCuadreDelCobro`
 *     rechaza —sin tolerancia— cualquier factura cuyos conceptos no sumen
 *     exactamente el total del cobro.
 *
 *  3. 🔴 QUE LA INTERFAZ NO MIENTA SOBRE LA VALIDEZ FISCAL. El ambiente
 *     sale de la CONFIGURACIÓN y no de una constante, y el texto de
 *     PRUEBAS dice que NO tiene validez fiscal.
 *
 *  4. que el dinero siga siendo de dirección y caja: ni un docente ni un
 *     alumno ven una factura, y no depende de un permiso apagado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  EduFiscalEnv as PrismaEduFiscalEnv,
  EduInvoiceStatus as PrismaEduInvoiceStatus,
  EduTaxMode as PrismaEduTaxMode,
} from "@prisma/client";
import {
  EDU_CANCEL_MOTIVES,
  EDU_FISCAL_ENVS,
  EDU_FISCAL_ENV_DETAILS,
  EDU_FISCAL_ENV_LABELS,
  EDU_INVOICE_STATUSES,
  EDU_INVOICE_STATUS_LABELS,
  EDU_TAX_MODES,
  eduConceptosDeCobro,
  eduCuadreDelCobro,
  eduFiscalNotice,
  eduItemsFacturapi,
  eduNextInvoiceFolio,
  eduSugerirFormaPago,
  esEduCancelMotive,
  esEduFormaPago,
  esEduProductKey,
  esEduTaxRegime,
  esEduUsoCfdi,
  normalizeEduLegalName,
  normalizeEduRfc,
  normalizeEduTaxEmail,
  normalizeEduZip,
  parseEduInvoiceFilters,
  parseEduReceptor,
  type EduFiscalEnv,
  type EduInvoiceStatus,
  type EduLineaDeCobro,
  type EduTaxMode,
} from "../facturacion-core";
import {
  EDU_ALL_PERMISSIONS,
  EDU_PERMISSION_GROUPS,
  EDU_ROLE_DEFAULTS,
  hasEduPermission,
  type EduPermissionKey,
} from "../permissions";
import { EDU_NAV_ITEMS, EDU_NAV_LABELS, EDU_UPCOMING_AREAS, type EduRole } from "../types";
import { eduChargeScopeWhere, eduScopeIsEmpty, eduVisibility } from "../visibility";

const INST = "inst_1";

// ─────────────────────────────────────────────────────────────────────
// 0 · Candado de TIPOS: las uniones == los enums de Prisma
//     Si el schema gana un estado y este archivo no, `tsc --noEmit` falla
//     aquí. En runtime esto no existe.
// ─────────────────────────────────────────────────────────────────────
type Exacto<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _envCoincide: Exacto<EduFiscalEnv, PrismaEduFiscalEnv> = true;
const _statusCoincide: Exacto<EduInvoiceStatus, PrismaEduInvoiceStatus> = true;
const _taxCoincide: Exacto<EduTaxMode, PrismaEduTaxMode> = true;
void _envCoincide;
void _statusCoincide;
void _taxCoincide;

// ═════════════════════════════════════════════════════════════════════
// 1 · 🔴 UN COBRO NO SE FACTURA DOS VECES
//
// El candado no es un `if` ni un botón deshabilitado: es un índice único
// de Postgres más el ORDEN en que se escriben las cosas. Las dos mitades
// se comprueban leyendo el código, porque no hay forma de probarlas sin
// base de datos — y son justo las que no pueden romperse en silencio.
// ═════════════════════════════════════════════════════════════════════

const RAIZ = join(__dirname, "..", "..", "..", "..");
const SCHEMA = readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8");
const SQL_PATH = join(RAIZ, "sql", "edu-ola-10.sql");
const SERVER = readFileSync(join(RAIZ, "src", "lib", "edu", "facturacion.ts"), "utf8");
const CORE = readFileSync(join(RAIZ, "src", "lib", "edu", "facturacion-core.ts"), "utf8");

// El archivo SIN comentarios.
//
// Existe porque los escaneos de código de más abajo buscan cosas que este
// módulo NO debe hacer ("leer FACTURAPI_ENV", "llevar la llave de
// Facturapi al cliente")… y los comentarios del módulo las MENCIONAN,
// precisamente para explicar por qué no se hacen. Sin esto, documentar la
// regla rompería la prueba que la vigila.
//
// Se quitan los bloques de comentario y las líneas de dos barras,
// respetando las dos barras de una URL (van precedidas de dos puntos).
const RE_BLOQUE = new RegExp("/\\*[\\s\\S]*?\\*/", "g");
const RE_LINEA = new RegExp("(^|[^:])//[^\\r\\n]*", "g");

function sinComentarios(texto: string): string {
  return texto.replace(RE_BLOQUE, " ").replace(RE_LINEA, "$1");
}

const SERVER_CODIGO = sinComentarios(SERVER);
const CORE_CODIGO = sinComentarios(CORE);

test("🔴 el schema declara el índice único que impide dos facturas vivas del mismo cobro", () => {
  assert.match(
    SCHEMA,
    /@@unique\(\[institutionId, activeChargeId\]/,
    "sin @@unique([institutionId, activeChargeId]) el candado no existe: dos clics producen dos timbres",
  );
  // Y la columna tiene que ser NULLABLE: es lo que permite que un cobro
  // acumule facturas canceladas (Postgres considera los NULL distintos).
  assert.match(SCHEMA, /activeChargeId String\?/);
});

test("🔴 el .sql crea ese mismo índice único, y no hay ni un DROP", () => {
  assert.ok(existsSync(SQL_PATH), "falta sql/edu-ola-10.sql");
  const sql = readFileSync(SQL_PATH, "utf8");
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS "edu_invoices_activo_key"[\s\S]*?"activeChargeId"/,
    "el .sql no crea el candado: aplicarlo dejaría la base sin la única garantía real",
  );
  // Idempotencia: todo se crea con IF NOT EXISTS o dentro de un DO que
  // traga duplicate_object, y NADA se borra.
  const dropsReales = sql
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .filter((l) => /\bDROP\b/i.test(l));
  assert.deepEqual(dropsReales, [], "un .sql de este vertical no borra nada");
});

test("🔴 la RESERVA se inserta ANTES de llamar a Facturapi (si no, el candado llega tarde)", () => {
  const emit = SERVER.slice(SERVER.indexOf("export async function emitEduInvoice"));
  assert.ok(emit.length > 0, "no se encontró emitEduInvoice");

  const reserva = emit.indexOf("prisma.eduInvoice.create");
  const timbre = emit.indexOf("await createInvoice(");
  assert.ok(reserva > 0, "emitEduInvoice ya no inserta la reserva");
  assert.ok(timbre > 0, "emitEduInvoice ya no llama a createInvoice");
  assert.ok(
    reserva < timbre,
    "la fila se está creando DESPUÉS de timbrar: dos clics simultáneos pedirían dos timbres antes de que el índice único pudiera decir nada",
  );
});

test("🔴 un fallo de RED no libera el cobro; una respuesta de Facturapi sí", () => {
  // La distinción vive en `pudoHaberTimbrado`. Que exista y que el camino
  // dudoso NO ponga activeChargeId en null es lo que impide el CFDI
  // duplicado: si no sabemos si el SAT timbró, el cobro se queda tomado.
  assert.match(SERVER, /function pudoHaberTimbrado/);
  const emit = SERVER.slice(SERVER.indexOf("export async function emitEduInvoice"));
  const dudoso = emit.indexOf("if (dudoso)");
  const liberaFailed = emit.indexOf('status: "FAILED"');
  assert.ok(dudoso > 0 && liberaFailed > dudoso, "cambió la estructura del catch del timbrado");
  const ramaDudosa = emit.slice(dudoso, liberaFailed);
  assert.ok(
    !/activeChargeId:\s*null/.test(ramaDudosa),
    "la rama de fallo de RED está liberando el cobro: eso es exactamente cómo se produce un CFDI duplicado",
  );
});

test("🔴 solo la CANCELACIÓN (y el fallo confirmado) liberan el cobro", () => {
  const cancel = SERVER.slice(SERVER.indexOf("export async function cancelEduInvoice"));
  assert.match(
    cancel,
    /activeChargeId: null/,
    "cancelar tiene que soltar el cobro; si no, una factura cancelada bloquea al paciente para siempre",
  );
});

// ═════════════════════════════════════════════════════════════════════
// 2 · 🔴 LOS IMPORTES SALEN DEL COBRO CONGELADO
// ═════════════════════════════════════════════════════════════════════

function linea(over: Partial<EduLineaDeCobro> = {}): EduLineaDeCobro {
  const quantity = over.quantity ?? 1;
  const unitPriceCents = over.unitPriceCents ?? 150000;
  const discountCents = over.discountCents ?? 0;
  return {
    description: over.description ?? "Endodoncia unirradicular",
    quantity,
    unitPriceCents,
    discountCents,
    totalCents: over.totalCents ?? quantity * unitPriceCents - discountCents,
  };
}

test("el cuadre pasa cuando los conceptos suman EXACTAMENTE el total del cobro", () => {
  const lineas = [linea(), linea({ description: "Radiografía", unitPriceCents: 25000 })];
  const cuadre = eduCuadreDelCobro(
    { subtotalCents: 175000, discountCents: 0, totalCents: 175000 },
    lineas,
  );
  assert.equal(cuadre.ok, true);
  assert.equal(cuadre.error, null);
  assert.equal(cuadre.totalCents, 175000);
});

test("🔴 el cuadre RECHAZA un total que no coincide, y sin tolerancia de un centavo", () => {
  const cuadre = eduCuadreDelCobro(
    { subtotalCents: 150000, discountCents: 0, totalCents: 150001 },
    [linea()],
  );
  assert.equal(cuadre.ok, false);
  assert.match(cuadre.error ?? "", /no se timbra/i);
  // El mensaje trae los DOS importes: quien lo lee tiene que poder ir a
  // arreglar el cobro sin adivinar cuál de los dos está mal.
  assert.match(cuadre.error ?? "", /1,500\.00/);
  assert.match(cuadre.error ?? "", /1,500\.01/);
});

test("el cuadre rechaza un cobro sin conceptos y uno de $0.00", () => {
  const vacio = eduCuadreDelCobro({ subtotalCents: 0, discountCents: 0, totalCents: 0 }, []);
  assert.equal(vacio.ok, false);
  assert.match(vacio.error ?? "", /no tiene conceptos/i);

  const cero = eduCuadreDelCobro({ subtotalCents: 0, discountCents: 0, totalCents: 0 }, [
    linea({ unitPriceCents: 0, totalCents: 0 }),
  ]);
  assert.equal(cero.ok, false);
  assert.match(cero.error ?? "", /\$0\.00/);
});

test("el cuadre atrapa líneas que no cuadran solas (subtotal − descuento ≠ total)", () => {
  const mala: EduLineaDeCobro = {
    description: "Resina",
    quantity: 2,
    unitPriceCents: 50000,
    discountCents: 10000,
    totalCents: 100000, // debería ser 90000
  };
  const cuadre = eduCuadreDelCobro(
    { subtotalCents: 100000, discountCents: 10000, totalCents: 100000 },
    [mala],
  );
  assert.equal(cuadre.ok, false);
  assert.match(cuadre.error ?? "", /no cuadran solas/i);
});

test("🔴 los conceptos se COPIAN de las líneas del cobro: ni el precio ni el texto se recalculan", () => {
  const lineas = [
    linea({ description: "Endodoncia (tarifa de alumno)", unitPriceCents: 80000, quantity: 1 }),
  ];
  const conceptos = eduConceptosDeCobro(lineas, "85121600");
  assert.equal(conceptos.length, 1);
  assert.equal(conceptos[0].description, "Endodoncia (tarifa de alumno)");
  assert.equal(conceptos[0].unitPriceCents, 80000);
  assert.equal(conceptos[0].totalCents, 80000);
  assert.equal(conceptos[0].productKey, "85121600");
  assert.equal(conceptos[0].unitKey, "E48");
});

test("una clave del SAT inservible cae a la de servicios odontológicos, no al payload", () => {
  // Sin esto, Facturapi contesta "No se encontró la clave de producto o
  // servicio" — el mismo fallo que ya se pagó en el dental con claveSat "".
  const conceptos = eduConceptosDeCobro([linea()], "");
  assert.equal(conceptos[0].productKey, "85121600");
  assert.equal(esEduProductKey("85121600"), true);
  assert.equal(esEduProductKey("851216"), false);
  assert.equal(esEduProductKey("ABCDEFGH"), false);
});

// ═════════════════════════════════════════════════════════════════════
// 3 · EL PAYLOAD DE FACTURAPI
// ═════════════════════════════════════════════════════════════════════

test("🔴 EXENTO manda taxes explícitos: sin ellos Facturapi desglosa IVA 16 % por su cuenta", () => {
  const items = eduItemsFacturapi(eduConceptosDeCobro([linea()], "85121600"), "EXENTO");
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].product.taxes, [{ type: "IVA", factor: "Exento", rate: 0 }]);
  assert.equal(items[0].product.tax_included, false);
});

test("IVA16 desglosa el impuesto DENTRO del precio: el total sigue siendo lo cobrado", () => {
  const items = eduItemsFacturapi(eduConceptosDeCobro([linea()], "85121600"), "IVA16");
  assert.deepEqual(items[0].product.taxes, [{ type: "IVA", rate: 0.16 }]);
  assert.equal(
    items[0].product.tax_included,
    true,
    "con tax_included:false el CFDI saldría por más de lo que pagó el paciente",
  );
});

test("los centavos se convierten a pesos SIN error de coma flotante", () => {
  const items = eduItemsFacturapi(
    eduConceptosDeCobro(
      [linea({ quantity: 3, unitPriceCents: 33333, discountCents: 1, totalCents: 99998 })],
      "85121600",
    ),
    "EXENTO",
  );
  assert.equal(items[0].product.price, 333.33);
  assert.equal(items[0].discount, 0.01);
  assert.equal(items[0].quantity, 3);
  // Y la cuenta que hará Facturapi da exactamente el total del cobro.
  assert.equal(
    Math.round((items[0].quantity * items[0].product.price - items[0].discount) * 100),
    99998,
  );
});

// ═════════════════════════════════════════════════════════════════════
// 4 · LOS DATOS FISCALES
// ═════════════════════════════════════════════════════════════════════

test("el RFC se normaliza (mayúsculas, sin guiones ni espacios) y se valida", () => {
  assert.equal(normalizeEduRfc(" cabc-800101-hx3 "), "CABC800101HX3");
  assert.equal(normalizeEduRfc("ieo010101aaa"), "IEO010101AAA");
  // Los genéricos del SAT son RFC válidos y tienen que pasar.
  assert.equal(normalizeEduRfc("XAXX010101000"), "XAXX010101000");
  assert.equal(normalizeEduRfc("XEXX010101000"), "XEXX010101000");
  // Y lo que no es un RFC, no pasa.
  assert.equal(normalizeEduRfc("HOLA"), null);
  assert.equal(normalizeEduRfc("CABC8001HX3"), null);
  assert.equal(normalizeEduRfc(""), null);
  assert.equal(normalizeEduRfc(null), null);
  assert.equal(normalizeEduRfc(12345), null);
});

test("el código postal son cinco dígitos, ni más ni menos", () => {
  assert.equal(normalizeEduZip("44100"), "44100");
  assert.equal(normalizeEduZip(" 01000 "), "01000");
  assert.equal(normalizeEduZip("4410"), null);
  assert.equal(normalizeEduZip("441000"), null);
  assert.equal(normalizeEduZip("4410A"), null);
});

test("la razón social colapsa espacios (un doble espacio al copiar rompe el timbrado)", () => {
  assert.equal(
    normalizeEduLegalName("  INSTITUTO   DE  ESPECIALIDADES  "),
    "INSTITUTO DE ESPECIALIDADES",
  );
  assert.equal(normalizeEduLegalName("ab"), null);
  // No se pasa a mayúsculas: hay razones sociales que el SAT guarda con
  // minúsculas y forzarlas sería inventar.
  assert.equal(normalizeEduLegalName("Colegio Odontológico"), "Colegio Odontológico");
});

test("las claves del SAT se validan contra el catálogo, no contra una expresión regular", () => {
  assert.equal(esEduTaxRegime("601"), true);
  assert.equal(esEduTaxRegime("999"), false);
  assert.equal(esEduUsoCfdi("D01"), true);
  assert.equal(esEduUsoCfdi("ZZZ"), false);
  assert.equal(esEduFormaPago("01"), true);
  assert.equal(esEduFormaPago("77"), false);
});

test("el correo del receptor es opcional y se rechaza si no es un correo", () => {
  assert.equal(normalizeEduTaxEmail(" Ana@Correo.MX "), "ana@correo.mx");
  assert.equal(normalizeEduTaxEmail(""), null);
  assert.equal(normalizeEduTaxEmail("ana@"), null);
  assert.equal(normalizeEduTaxEmail(undefined), null);
});

test("parseEduReceptor devuelve el receptor limpio, o QUÉ campo está mal", () => {
  const ok = parseEduReceptor(
    {
      rfc: "cabc800101hx3",
      legalName: "  Ana  Pérez ",
      taxRegime: "612",
      zipCode: "44100",
      email: "ana@correo.mx",
      usoCfdi: "D01",
    },
    { usoCfdi: "G03" },
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.receptor?.rfc, "CABC800101HX3");
  assert.equal(ok.receptor?.legalName, "Ana Pérez");
  assert.equal(ok.receptor?.usoCfdi, "D01");

  const sinRegimen = parseEduReceptor(
    { rfc: "CABC800101HX3", legalName: "Ana Pérez", zipCode: "44100" },
    { usoCfdi: "D01" },
  );
  assert.equal(sinRegimen.ok, false);
  assert.match(sinRegimen.error ?? "", /régimen fiscal/i);

  const sinRfc = parseEduReceptor({ legalName: "Ana" }, { usoCfdi: "D01" });
  assert.equal(sinRfc.ok, false);
  assert.match(sinRfc.error ?? "", /RFC/);

  // Sin uso del CFDI en la entrada, cae al default del instituto.
  const conDefault = parseEduReceptor(
    { rfc: "CABC800101HX3", legalName: "Ana Pérez", taxRegime: "612", zipCode: "44100" },
    { usoCfdi: "G03" },
  );
  assert.equal(conDefault.ok, true);
  assert.equal(conDefault.receptor?.usoCfdi, "G03");
});

// ═════════════════════════════════════════════════════════════════════
// 5 · LA FORMA DE PAGO NO SE ADIVINA
// ═════════════════════════════════════════════════════════════════════

test("la forma de pago se SUGIERE del último pago real; sin pagos no se sugiere nada", () => {
  assert.equal(
    eduSugerirFormaPago([
      { method: "CASH", isRefund: false, paidAt: "2026-01-01T10:00:00Z" },
      { method: "TRANSFER", isRefund: false, paidAt: "2026-01-02T10:00:00Z" },
    ]),
    "03",
  );
  assert.equal(
    eduSugerirFormaPago([{ method: "CASH", isRefund: false, paidAt: "2026-01-01T10:00:00Z" }]),
    "01",
  );
  assert.equal(eduSugerirFormaPago([]), null);
});

test("una DEVOLUCIÓN no decide la forma de pago", () => {
  assert.equal(
    eduSugerirFormaPago([
      { method: "CASH", isRefund: false, paidAt: "2026-01-01T10:00:00Z" },
      { method: "TRANSFER", isRefund: true, paidAt: "2026-01-05T10:00:00Z" },
    ]),
    "01",
  );
});

test('🔴 el método "Otro" NO se traduce a una clave del SAT: que lo diga quien cobró', () => {
  assert.equal(
    eduSugerirFormaPago([{ method: "OTHER", isRefund: false, paidAt: "2026-01-01T10:00:00Z" }]),
    null,
  );
});

test("el servidor EXIGE la forma de pago: no hay default silencioso", () => {
  assert.match(
    SERVER,
    /Elige la forma de pago del SAT/,
    "si el endpoint pusiera un default, el CFDI llevaría un dato falso con el que el SAT cruza depósitos",
  );
});

// ═════════════════════════════════════════════════════════════════════
// 6 · 🔴 LA INTERFAZ NO PUEDE MENTIR SOBRE LA VALIDEZ FISCAL
// ═════════════════════════════════════════════════════════════════════

test("🔴 el aviso de PRUEBAS dice que NO tiene validez fiscal, con esas palabras", () => {
  const aviso = eduFiscalNotice({ environment: "TEST", isEnabled: true });
  assert.equal(aviso.level, "pruebas");
  assert.match(aviso.title, /PRUEBAS/);
  assert.match(aviso.title + " " + aviso.detail, /NO tienen? validez fiscal/i);
  // Y dice por qué el documento ENGAÑA: se ve igual que uno real.
  assert.match(aviso.detail, /no llega al SAT/i);
});

test("el aviso EN VIVO dice que sí es un comprobante fiscal", () => {
  const aviso = eduFiscalNotice({ environment: "LIVE", isEnabled: true });
  assert.equal(aviso.level, "vivo");
  assert.match(aviso.detail, /fiscal/i);
});

test("sin configuración, y con la facturación apagada, el aviso lo dice y no promete nada", () => {
  const sin = eduFiscalNotice(null);
  assert.equal(sin.level, "sin-configurar");
  const apagada = eduFiscalNotice({ environment: "TEST", isEnabled: false });
  assert.equal(apagada.level, "apagado");
});

test("🔴 el ambiente NO sale de una variable de entorno en ninguna parte del módulo", () => {
  // El dental decide TEST/LIVE con process.env.FACTURAPI_ENV, que es una
  // sola para todo el despliegue. Si este módulo la leyera, encender el
  // dental en vivo encendería la facturación de todas las escuelas.
  for (const [nombre, texto] of [
    ["facturacion.ts", SERVER_CODIGO],
    ["facturacion-core.ts", CORE_CODIGO],
  ] as const) {
    assert.ok(
      !/FACTURAPI_ENV/.test(texto),
      `${nombre} lee FACTURAPI_ENV: el ambiente del instituto vive en su configuración`,
    );
    assert.ok(
      !/facturapi-env/.test(texto),
      `${nombre} importa el módulo de ambiente del dental`,
    );
    assert.ok(
      !/isFacturapiLive/.test(texto),
      `${nombre} usa isFacturapiLive(), que mira la variable global`,
    );
  }
  // Y sí lee la columna de la configuración.
  assert.match(SERVER, /config\.environment as EduFiscalEnv/);
});

test("cada factura recuerda EN QUÉ AMBIENTE se timbró (pasar a vivo no reetiqueta el pasado)", () => {
  assert.match(SCHEMA, /model EduInvoice[\s\S]*?environment EduFiscalEnv/);
  // Y se descarga y se cancela con la llave de ESE ambiente, no del actual.
  assert.match(SERVER, /factura\.environment as EduFiscalEnv/);
});

test("los tres enums tienen etiqueta en español para todos sus valores", () => {
  for (const e of EDU_FISCAL_ENVS) {
    assert.ok(EDU_FISCAL_ENV_LABELS[e], `falta etiqueta de ambiente ${e}`);
    assert.ok(EDU_FISCAL_ENV_DETAILS[e].length > 40, `${e} sin explicación usable`);
  }
  for (const s of EDU_INVOICE_STATUSES) {
    assert.ok(EDU_INVOICE_STATUS_LABELS[s], `falta etiqueta de estado ${s}`);
  }
  assert.deepEqual(EDU_TAX_MODES, ["EXENTO", "IVA16"]);
});

// ═════════════════════════════════════════════════════════════════════
// 7 · CANCELACIÓN
// ═════════════════════════════════════════════════════════════════════

test('🔴 no se ofrece el motivo "01": el SAT lo rechaza sin el UUID que sustituye', () => {
  assert.equal(
    EDU_CANCEL_MOTIVES.some((m) => m.clave === "01"),
    false,
    "el motivo 01 exige un CFDI sustituto que todavía no existe cuando alguien pulsa Cancelar",
  );
  assert.deepEqual(
    EDU_CANCEL_MOTIVES.map((m) => m.clave),
    ["02", "03", "04"],
  );
  assert.equal(esEduCancelMotive("02"), true);
  assert.equal(esEduCancelMotive("01"), false);
  assert.equal(esEduCancelMotive("zz"), false);
});

test("cancelar EXIGE un motivo del catálogo y un texto escrito por una persona", () => {
  const cancel = SERVER.slice(SERVER.indexOf("export async function cancelEduInvoice"));
  assert.match(cancel, /esEduCancelMotive\(input\.motive\)/);
  assert.match(cancel, /reason\.length < 5/);
});

test("🔴 cancelar NO borra: la fila se queda con su UUID y su XML", () => {
  const cancel = SERVER.slice(
    SERVER.indexOf("export async function cancelEduInvoice"),
    SERVER.indexOf("export async function resolveEduStuckInvoice"),
  );
  assert.ok(!/prisma\.eduInvoice\.delete/.test(cancel), "una factura no se borra nunca");
  assert.ok(!/uuid: null/.test(cancel), "cancelar estaría tirando el folio fiscal");
  assert.ok(!/xml: null/.test(cancel), "cancelar estaría tirando el documento fiscal");
});

test("todo el módulo de servidor no borra ni una factura", () => {
  assert.ok(
    !/prisma\.eduInvoice\.delete/.test(SERVER) && !/deleteMany/.test(SERVER),
    "hay un borrado de facturas: un comprobante fiscal se cancela, no se borra",
  );
});

// ═════════════════════════════════════════════════════════════════════
// 8 · 🔴 EL DINERO SIGUE SIENDO DE DIRECCIÓN Y CAJA
// ═════════════════════════════════════════════════════════════════════

const KEYS_OLA_10: EduPermissionKey[] = [
  "facturacion.view",
  "facturacion.emit",
  "facturacion.cancel",
  "facturacion.config",
];

test("las cuatro keys están en el catálogo, descritas en español", () => {
  for (const k of KEYS_OLA_10) {
    assert.ok(k in EDU_ALL_PERMISSIONS, `falta ${k} en el catálogo`);
    const desc = EDU_ALL_PERMISSIONS[k];
    assert.ok(desc && desc.length > 8, `${k} sin descripción usable: ${desc}`);
    assert.notEqual(desc, k, `${k} se describe con su propia key`);
  }
});

test("las cuatro viven en el grupo «Facturación», y en uno solo", () => {
  const grupo = EDU_PERMISSION_GROUPS.find((g) => g.title === "Facturación");
  assert.ok(grupo, "no hay grupo de Facturación en la pantalla de permisos");
  for (const k of KEYS_OLA_10) {
    assert.ok(grupo.keys.includes(k), `${k} no está en el grupo`);
    assert.equal(
      EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes(k)).length,
      1,
      `${k} aparece en más de un grupo`,
    );
  }
});

test("🔴 el reparto es EXACTAMENTE el del contrato", () => {
  // DIRECCION: las cuatro.
  for (const k of KEYS_OLA_10) {
    assert.equal(hasEduPermission({ role: "DIRECCION" }, k), true, `DIRECCION debería traer ${k}`);
  }
  // CAJA: ve y emite. NO cancela y NO configura.
  assert.equal(hasEduPermission({ role: "CAJA" }, "facturacion.view"), true);
  assert.equal(hasEduPermission({ role: "CAJA" }, "facturacion.emit"), true);
  assert.equal(hasEduPermission({ role: "CAJA" }, "facturacion.cancel"), false);
  assert.equal(hasEduPermission({ role: "CAJA" }, "facturacion.config"), false);
  // DOCENTE y ALUMNO: ninguna.
  for (const rol of ["DOCENTE", "ALUMNO"] as EduRole[]) {
    for (const k of KEYS_OLA_10) {
      assert.equal(hasEduPermission({ role: rol }, k), false, `${rol} no debería traer ${k}`);
    }
    // …y siguen entrando al panel.
    assert.equal(hasEduPermission({ role: rol }, "inicio.view"), true);
  }
});

test("emitir y cancelar son DOS keys: la de emitir no abre la de cancelar", () => {
  const soloEmite = {
    role: "CAJA" as EduRole,
    permissionsOverride: ["facturacion.view", "facturacion.emit"],
  };
  assert.equal(hasEduPermission(soloEmite, "facturacion.emit"), true);
  assert.equal(hasEduPermission(soloEmite, "facturacion.cancel"), false);
  assert.equal(hasEduPermission(soloEmite, "facturacion.config"), false);
});

test("un permiso NUEVO no le llega solo a quien ya tiene override (por eso el .sql trae backfill)", () => {
  const conOverrideViejo = {
    role: "DIRECCION" as EduRole,
    permissionsOverride: ["inicio.view", "caja.view"],
  };
  assert.equal(hasEduPermission(conOverrideViejo, "caja.view"), true);
  assert.equal(hasEduPermission(conOverrideViejo, "facturacion.view"), false);
});

test("el .sql trae el backfill de las cuatro keys, y NO se lo da a docente ni a alumno", () => {
  const sql = readFileSync(SQL_PATH, "utf8");
  for (const k of KEYS_OLA_10) {
    assert.ok(sql.includes(`'${k}'`), `el backfill no menciona ${k}`);
  }
  assert.ok(sql.includes(`"role" = 'DIRECCION'`), "falta el bloque de DIRECCION");
  assert.ok(sql.includes(`"role" = 'CAJA'`), "falta el bloque de CAJA");
  assert.ok(
    !sql.includes(`"role" = 'DOCENTE'`) && !sql.includes(`"role" = 'ALUMNO'`),
    "el backfill le está dando facturación a docentes o alumnos",
  );
  // Y todo el backfill va COMENTADO: se aplica a sabiendas, no de rebote.
  for (const l of sql.split(/\r?\n/)) {
    if (/^\s*UPDATE "edu_users"/.test(l)) {
      assert.fail(`hay un UPDATE de permisos SIN comentar: ${l}`);
    }
  }
});

test("🔴 un ALUMNO y un DOCENTE no ven facturas, y no depende del permiso sino del ALCANCE", () => {
  for (const rol of ["ALUMNO", "DOCENTE"] as EduRole[]) {
    const scope = eduVisibility({ role: rol, eduUserId: "u_1" }, "charges");
    assert.deepEqual(scope, { kind: "none" });
    assert.equal(eduScopeIsEmpty(scope), true);
    assert.deepEqual(eduChargeScopeWhere({ institutionId: INST, scope }), {
      institutionId: INST,
      id: { in: [] },
    });
  }
});

test("🔴 TODA función exportada del módulo de servidor pasa por la puerta del dinero", () => {
  // Incluidas las LECTURAS: un alumno con "facturacion.view" encendido a
  // mano tiene que chocar con requireDinero igual que con la caja.
  const partes = SERVER.split(/export async function /).slice(1);
  assert.ok(partes.length >= 10, `se esperaban más funciones exportadas, hay ${partes.length}`);
  for (const parte of partes) {
    const nombre = parte.slice(0, parte.indexOf("("));
    assert.ok(
      parte.includes("requireDinero(ctx)"),
      `${nombre} no llama a requireDinero: es una puerta del dinero abierta`,
    );
  }
});

test("ninguna función del módulo acepta un institutionId suelto (viene del ctx y de nadie más)", () => {
  assert.ok(
    !/export async function \w+\([^)]*institutionId:/.test(SERVER),
    "una firma exportada acepta institutionId: es un bug de tenant esperando",
  );
});

// ═════════════════════════════════════════════════════════════════════
// 9 · LA PANTALLA
// ═════════════════════════════════════════════════════════════════════

test("Facturación está en el menú, con su permiso, su etiqueta y fuera de «Próximamente»", () => {
  const item = EDU_NAV_ITEMS.find((i) => i.key === "facturacion");
  assert.ok(item, "el item de Facturación no está en el menú");
  assert.equal(item.permission, "facturacion.view");
  assert.equal(item.href, "/instituto/facturacion");
  assert.ok(EDU_NAV_LABELS.facturacion, "el item no tiene etiqueta en español");
  assert.equal(
    EDU_UPCOMING_AREAS.some((a) => a.key === "facturacion"),
    false,
  );
});

test("los datos fiscales NO llevan item de menú propio (se llega desde Facturación)", () => {
  assert.equal(
    EDU_NAV_ITEMS.some((i) => i.href.includes("datos-fiscales")),
    false,
  );
});

test("los filtros de la lista se leen de la URL y descartan lo inventado", () => {
  assert.deepEqual(parseEduInvoiceFilters(undefined), { q: "", status: null });
  assert.deepEqual(parseEduInvoiceFilters({ q: "  F-0001 ", estado: "valid" }), {
    q: "F-0001",
    status: "VALID",
  });
  assert.deepEqual(parseEduInvoiceFilters({ estado: "LO-QUE-SEA" }), { q: "", status: null });
  // Un array (?q=a&q=b) toma el primero en vez de reventar.
  assert.deepEqual(parseEduInvoiceFilters({ q: ["uno", "dos"] }), { q: "uno", status: null });
});

test("el folio interno se rellena con ceros (si no, F-9 iría después de F-10)", () => {
  assert.equal(eduNextInvoiceFolio("F", null), "F-0001");
  assert.equal(eduNextInvoiceFolio("F", "F-0001"), "F-0002");
  assert.equal(eduNextInvoiceFolio("F", "F-0099"), "F-0100");
  assert.equal(eduNextInvoiceFolio("FAC", "FAC-0009"), "FAC-0010");
  // Un folio con otra forma no rompe: se empieza de nuevo en 1 y el índice
  // único del folio impediría pisar uno existente.
  assert.equal(eduNextInvoiceFolio("F", "algo-raro"), "F-0001");
});

test("las pantallas del vertical no reciben el XML completo ni la llave de Facturapi", () => {
  // La forma que viaja al navegador solo dice SI hay XML, no lo lleva.
  assert.match(CORE, /hasXml: boolean/);
  assert.ok(
    !/xml: string/.test(CORE_CODIGO),
    "EduInvoiceRow estaría llevando el XML completo al HTML de la pantalla",
  );
  assert.ok(
    !/facturapiLiveKey/.test(CORE_CODIGO) && !/facturapiOrgId/.test(CORE_CODIGO),
    "la forma que va al cliente no puede llevar secretos de Facturapi",
  );
  // Y la vista de configuración solo dice si hay organización.
  assert.match(CORE, /hasOrg: boolean/);
});
