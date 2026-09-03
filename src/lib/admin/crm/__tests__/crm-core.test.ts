/**
 * Pruebas del núcleo del CRM de ventas de /admin.
 *
 * Correr: npm run test:crm
 *
 * Qué protege — las cuatro cosas que, si se rompen, no truenan nada y sólo
 * hacen que el vendedor trabaje con datos falsos:
 *
 *  1. LA FECHA DEL PRÓXIMO PASO. Guardada a medianoche UTC se pinta un día
 *     ANTES en México y el seguimiento aparece vencido cuando no lo está.
 *     Aquí se fija el mediodía UTC y se comprueba el ida y vuelta.
 *  2. EL SEMÁFORO SE COMPARA POR DÍA MEXICANO. A las 19:00 de México ya es
 *     otro día en UTC: comparar instantes vaciaría la lista de "hoy toca"
 *     cada tarde.
 *  3. EL ENLACE DE WHATSAPP. Un 52 de más (o de menos) abre WhatsApp con un
 *     número que no existe, y eso se descubre frente al cliente.
 *  4. LA IMPORTACIÓN PEGADA. Lee por CONTENIDO, no por posición; si eso se
 *     rompe, los teléfonos entran en la columna de la ciudad y nadie lo ve
 *     hasta que hay que marcar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crmDiaMx,
  crmDiasEntre,
  crmDiasSinContacto,
  crmEstaFrio,
  crmEstadoParaAfiliado,
  crmEtapa,
  crmEtapaEsTerminal,
  crmEtapaSiguiente,
  crmFechaDeCalendario,
  crmInicioDelDiaMx,
  crmLeerImportacion,
  crmMailLink,
  crmNormalizarEtiquetas,
  crmNumeroOpcional,
  crmPlantillaWhatsapp,
  crmPrioridad,
  crmResumen,
  crmSemaforo,
  crmSemaforoTexto,
  crmTelLink,
  crmTelefonoLegible,
  crmCoincide,
  crmTextoPlano,
  crmValidarProspecto,
  crmValorDeInput,
  crmWhatsappLink,
  crmWhatsappNumero,
  CRM_ETAPAS,
  CRM_IMPORT_MAX,
} from "../crm-core";

// ── 1. Fechas de calendario ─────────────────────────────────────────────

test("el próximo paso se guarda al MEDIODÍA UTC, no a medianoche", () => {
  const d = crmFechaDeCalendario("2026-09-15");
  assert.equal(d?.toISOString(), "2026-09-15T12:00:00.000Z");
});

test("medianoche UTC habría pintado el día anterior en México (el bug que se evita)", () => {
  assert.equal(crmDiaMx(new Date("2026-09-15T00:00:00.000Z")), "2026-09-14");
  assert.equal(crmDiaMx(new Date("2026-09-15T12:00:00.000Z")), "2026-09-15");
});

test("la fecha va y vuelve del <input type=date> sin moverse", () => {
  const guardada = crmFechaDeCalendario("2026-01-01");
  assert.equal(crmValorDeInput(guardada), "2026-01-01");
  // Y otra vuelta más: es donde el bug de medianoche iba restando un día.
  assert.equal(crmValorDeInput(crmFechaDeCalendario(crmValorDeInput(guardada))), "2026-01-01");
});

test("una fecha basura no se guarda", () => {
  assert.equal(crmFechaDeCalendario("15/09/2026"), null);
  assert.equal(crmFechaDeCalendario(""), null);
  assert.equal(crmFechaDeCalendario(null), null);
  assert.equal(crmValorDeInput(null), "");
});

test("el día mexicano no se adelanta con el UTC de la noche", () => {
  // 01:00 UTC del 2 = 19:00 del 1 en México.
  assert.equal(crmDiaMx(new Date("2026-09-02T01:00:00.000Z")), "2026-09-01");
  assert.equal(crmInicioDelDiaMx(new Date("2026-09-02T01:00:00.000Z")).toISOString(), "2026-09-01T06:00:00.000Z");
});

// ── 2. Semáforo del seguimiento ─────────────────────────────────────────

const NOCHE_MX = new Date("2026-09-02T01:00:00.000Z"); // 19:00 del 1 en México

test("un seguimiento para HOY sigue siendo de hoy a las 7 de la noche", () => {
  // Comparando instantes daría "vencido": 01-09 12:00Z ya pasó a las 02-09 01:00Z.
  assert.equal(crmSemaforo(crmFechaDeCalendario("2026-09-01"), NOCHE_MX), "hoy");
});

test("vencido, próximo y sin fecha", () => {
  assert.equal(crmSemaforo(crmFechaDeCalendario("2026-08-30"), NOCHE_MX), "vencido");
  assert.equal(crmSemaforo(crmFechaDeCalendario("2026-09-05"), NOCHE_MX), "proximo");
  assert.equal(crmSemaforo(null, NOCHE_MX), "sin-fecha");
  assert.equal(crmSemaforo("no es fecha", NOCHE_MX), "sin-fecha");
});

test("el texto del semáforo cuenta días naturales", () => {
  assert.equal(crmSemaforoTexto(crmFechaDeCalendario("2026-09-01"), NOCHE_MX), "Hoy");
  assert.equal(crmSemaforoTexto(crmFechaDeCalendario("2026-08-31"), NOCHE_MX), "Venció ayer");
  assert.equal(crmSemaforoTexto(crmFechaDeCalendario("2026-08-29"), NOCHE_MX), "Venció hace 3 días");
  assert.equal(crmSemaforoTexto(crmFechaDeCalendario("2026-09-02"), NOCHE_MX), "Mañana");
  assert.equal(crmSemaforoTexto(crmFechaDeCalendario("2026-09-04"), NOCHE_MX), "En 3 días");
  assert.equal(crmSemaforoTexto(null, NOCHE_MX), "");
});

test("los días se cuentan por calendario, no por 24 horas", () => {
  // Ayer a las 23:00 de México y hoy a las 08:00: son 9 horas, pero 1 día.
  const ayerTarde = new Date("2026-09-02T05:00:00.000Z"); // 23:00 del 1
  const hoyTemprano = new Date("2026-09-02T14:00:00.000Z"); // 08:00 del 2
  assert.equal(crmDiasEntre(ayerTarde, hoyTemprano), 1);
});

// ── Enfriamiento ────────────────────────────────────────────────────────

test("sin contacto nunca registrado NO cuenta como frío", () => {
  // Es un prospecto que jamás se ha tocado; su problema es otro (está en
  // "Sin contactar") y contarlo aquí escondería a los que sí se enfriaron.
  assert.equal(crmDiasSinContacto(null), null);
  assert.equal(crmEstaFrio({ stage: "CONTACTADO", lastContactAt: null }), false);
});

test("14 días sin anotar nada lo vuelve frío; un cerrado nunca lo es", () => {
  const ahora = new Date("2026-09-20T18:00:00.000Z");
  const hace15 = new Date("2026-09-05T18:00:00.000Z");
  assert.equal(crmEstaFrio({ stage: "INTERESADO", lastContactAt: hace15 }, ahora), true);
  assert.equal(crmEstaFrio({ stage: "GANADO", lastContactAt: hace15 }, ahora), false);
  assert.equal(crmEstaFrio({ stage: "PERDIDO", lastContactAt: hace15 }, ahora), false);
  const hace3 = new Date("2026-09-17T18:00:00.000Z");
  assert.equal(crmEstaFrio({ stage: "INTERESADO", lastContactAt: hace3 }, ahora), false);
});

// ── 3. Enlaces de contacto ──────────────────────────────────────────────

test("wa.me antepone 52 a los diez dígitos mexicanos", () => {
  assert.equal(crmWhatsappNumero("5512345678"), "525512345678");
  assert.equal(crmWhatsappNumero("55 1234 5678"), "525512345678");
  assert.equal(crmWhatsappNumero("(55) 1234-5678"), "525512345678");
});

test("un +52 (o +521) que ya venía NO se duplica", () => {
  assert.equal(crmWhatsappNumero("+52 55 1234 5678"), "525512345678");
  assert.equal(crmWhatsappNumero("+521 55 1234 5678"), "525512345678");
});

test("un número extranjero se respeta tal cual", () => {
  assert.equal(crmWhatsappNumero("+1 415 555 0132"), "14155550132");
});

test("un fijo incompleto NO arma enlace de WhatsApp", () => {
  assert.equal(crmWhatsappNumero("12345678"), null);
  assert.equal(crmWhatsappNumero(""), null);
  assert.equal(crmWhatsappNumero(null), null);
  assert.equal(crmWhatsappLink(null, "hola"), null);
});

test("el mensaje viaja escapado en el enlace", () => {
  const url = crmWhatsappLink("5512345678", "Hola, ¿cómo está? #DaleControl");
  assert.ok(url?.startsWith("https://wa.me/525512345678?text="));
  assert.ok(url?.includes("%23DaleControl"), "el # tiene que ir escapado o corta el enlace");
  assert.equal(crmWhatsappLink("5512345678", "   "), "https://wa.me/525512345678");
});

test("tel: es más permisivo que WhatsApp (conmutadores a 8 dígitos)", () => {
  assert.equal(crmTelLink("5512345678"), "tel:+525512345678");
  assert.equal(crmTelLink("12345678"), "tel:+5212345678");
  assert.equal(crmTelLink("123"), null);
});

test("el correo sólo arma mailto si es un correo", () => {
  assert.equal(crmMailLink("hola@clinica.mx"), "mailto:hola@clinica.mx");
  assert.equal(crmMailLink("hola@clinica"), null);
  assert.equal(crmMailLink(""), null);
  assert.ok(crmMailLink("a@b.mx", "Propuesta")?.includes("subject=Propuesta"));
});

test("el teléfono se lee agrupado cuando son diez dígitos", () => {
  assert.equal(crmTelefonoLegible("5512345678"), "55 1234 5678");
  assert.equal(crmTelefonoLegible("ext. 402"), "ext. 402");
});

// ── Catálogo de etapas ──────────────────────────────────────────────────

test("una etapa desconocida se pinta, no truena", () => {
  const e = crmEtapa("ETAPA_QUE_ALGUIEN_BORRO");
  assert.equal(e.id, "ETAPA_QUE_ALGUIEN_BORRO");
  assert.equal(e.tono, "neutral");
  assert.equal(crmEtapaEsTerminal("ETAPA_QUE_ALGUIEN_BORRO"), false);
});

test("ganado y perdido son las únicas terminales", () => {
  const terminales = CRM_ETAPAS.filter((e) => e.terminal).map((e) => e.id);
  assert.deepEqual(terminales, ["GANADO", "PERDIDO"]);
});

test("avanzar nunca cierra el prospecto solo", () => {
  assert.equal(crmEtapaSiguiente("NUEVO"), "CONTACTADO");
  assert.equal(crmEtapaSiguiente("PROPUESTA"), "NEGOCIACION");
  // Después de NEGOCIACION viene GANADO: ganar se decide a mano, jamás con
  // el botón de avanzar.
  assert.equal(crmEtapaSiguiente("NEGOCIACION"), null);
  assert.equal(crmEtapaSiguiente("GANADO"), null);
});

// ── Validación ──────────────────────────────────────────────────────────

test("sin nombre no se guarda", () => {
  assert.ok(crmValidarProspecto({ name: "   " }));
  assert.equal(crmValidarProspecto({ name: "Clínica Sonrisa" }), null);
});

test("no se aceptan valores fuera del catálogo", () => {
  assert.ok(crmValidarProspecto({ name: "X", stage: "INVENTADA" }));
  assert.ok(crmValidarProspecto({ name: "X", vertical: "VETERINARIA" }));
  assert.ok(crmValidarProspecto({ name: "X", source: "TIKTOK" }));
  assert.equal(crmValidarProspecto({ name: "X", stage: "DEMO", vertical: "INSTITUCION", source: "EVENTO" }), null);
});

test("correo y fecha mal escritos se rechazan antes de tocar la base", () => {
  assert.ok(crmValidarProspecto({ name: "X", email: "arroba-falta.mx" }));
  assert.ok(crmValidarProspecto({ name: "X", nextActionAt: "mañana" }));
  assert.equal(crmValidarProspecto({ name: "X", email: "a@b.mx", nextActionAt: "2026-09-15" }), null);
});

test("los números aceptan lo que la gente teclea", () => {
  assert.equal(crmNumeroOpcional("$1,500"), 1500);
  assert.equal(crmNumeroOpcional(""), null);
  assert.equal(crmNumeroOpcional(null), null);
  assert.equal(crmNumeroOpcional("abc"), null);
  assert.equal(crmNumeroOpcional(3), 3);
});

test("las etiquetas se normalizan y no se repiten", () => {
  assert.deepEqual(crmNormalizarEtiquetas("Congreso, congreso ,  Referido "), ["congreso", "referido"]);
  assert.equal(crmNormalizarEtiquetas(Array(30).fill("x").map((_, i) => `t${i}`)).length, 12);
  assert.deepEqual(crmNormalizarEtiquetas(null), []);
});

// ── 4. Importación pegada ───────────────────────────────────────────────

test("con encabezado, las columnas se mapean por nombre", () => {
  const { filas } = crmLeerImportacion(
    ["Nombre\tTeléfono\tCiudad\tCorreo", "Clínica Sonrisa\t5512345678\tPuebla\thola@sonrisa.mx"].join("\n"),
  );
  assert.equal(filas.length, 1);
  assert.equal(filas[0].name, "Clínica Sonrisa");
  assert.equal(filas[0].phone, "5512345678");
  assert.equal(filas[0].city, "Puebla");
  assert.equal(filas[0].email, "hola@sonrisa.mx");
});

test("sin encabezado, cada celda se clasifica por lo que ES, no por dónde está", () => {
  // El teléfono va antes que el nombre, y el correo al final: da igual.
  const { filas } = crmLeerImportacion("55 1234 5678, Dental Norte, hola@norte.mx, Monterrey");
  assert.equal(filas.length, 1);
  assert.equal(filas[0].name, "Dental Norte");
  assert.equal(filas[0].phone, "55 1234 5678");
  assert.equal(filas[0].email, "hola@norte.mx");
  assert.equal(filas[0].city, "Monterrey");
});

test("una línea de datos NO se confunde con un encabezado", () => {
  // "Nombre" y "Ciudad" son palabras de encabezado, pero la línea trae un
  // teléfono real: es una fila, y perderla sería perder un prospecto.
  const { filas } = crmLeerImportacion("Nombre Dental\t5512345678\tCiudad Juárez");
  assert.equal(filas.length, 1);
  assert.equal(filas[0].phone, "5512345678");
});

test("lo que no tiene nombre se aparta con su motivo, no se guarda a medias", () => {
  const { filas, ignoradas } = crmLeerImportacion(["Clínica A\t5512345678", "\t\t"].join("\n"));
  assert.equal(filas.length, 1);
  assert.equal(ignoradas.length, 0, "las líneas en blanco se descartan antes, sin ruido");

  const soloCorreo = crmLeerImportacion("solo@correo.mx");
  assert.equal(soloCorreo.filas.length, 0);
  assert.equal(soloCorreo.ignoradas.length, 1);
  assert.match(soloCorreo.ignoradas[0].motivo, /nombre/i);
});

test("hay tope por pegada y lo que sobra se dice, no se traga", () => {
  const texto = Array.from({ length: CRM_IMPORT_MAX + 5 }, (_, i) => `Clinica ${i}`).join("\n");
  const { filas, ignoradas } = crmLeerImportacion(texto);
  assert.equal(filas.length, CRM_IMPORT_MAX);
  assert.equal(ignoradas.length, 5);
});

test("pegar nada no truena", () => {
  assert.deepEqual(crmLeerImportacion(""), { filas: [], ignoradas: [] });
  assert.deepEqual(crmLeerImportacion(null), { filas: [], ignoradas: [] });
});

// ── Resumen del embudo ──────────────────────────────────────────────────

const AHORA = new Date("2026-09-02T18:00:00.000Z"); // mediodía en México

test("el valor del embudo sólo cuenta lo que sigue abierto", () => {
  const r = crmResumen(
    [
      { stage: "INTERESADO", monthlyValue: 700 },
      { stage: "PROPUESTA", monthlyValue: 1700 },
      { stage: "GANADO", monthlyValue: 5000 },
      { stage: "PERDIDO", monthlyValue: 9000 },
    ],
    AHORA,
  );
  assert.equal(r.abiertos, 2);
  assert.equal(r.valorAbierto, 2400, "ganado y perdido NO suman al embudo");
  assert.equal(r.ganados, 1);
  assert.equal(r.perdidos, 1);
});

test("los pendientes de un cerrado no cuentan (ya no hay nada que hacerle)", () => {
  const r = crmResumen(
    [
      { stage: "DEMO", nextActionAt: crmFechaDeCalendario("2026-08-25") },
      { stage: "DEMO", nextActionAt: crmFechaDeCalendario("2026-09-02") },
      { stage: "GANADO", nextActionAt: crmFechaDeCalendario("2026-08-01") },
    ],
    AHORA,
  );
  assert.equal(r.vencidos, 1);
  assert.equal(r.paraHoy, 1);
});

test("el resumen trae SIEMPRE las ocho columnas, aunque estén vacías", () => {
  const r = crmResumen([], AHORA);
  assert.equal(r.porEtapa.length, CRM_ETAPAS.length);
  assert.equal(r.porEtapa.every((c) => c.cuantos === 0), true);
  assert.equal(r.abiertos, 0);
});

test("lo vencido más viejo va primero, y lo que no tiene fecha al final", () => {
  const viejo = { nextActionAt: crmFechaDeCalendario("2026-08-20") };
  const reciente = { nextActionAt: crmFechaDeCalendario("2026-09-01") };
  const hoy = { nextActionAt: crmFechaDeCalendario("2026-09-02") };
  const futuro = { nextActionAt: crmFechaDeCalendario("2026-09-10") };
  const sinFecha = { nextActionAt: null };
  const orden = [futuro, sinFecha, hoy, viejo, reciente]
    .sort((a, b) => crmPrioridad(a, AHORA) - crmPrioridad(b, AHORA))
    .map((p) => crmValorDeInput(p.nextActionAt));
  assert.deepEqual(orden, ["2026-08-20", "2026-09-01", "2026-09-02", "2026-09-10", ""]);
});

// ── Plantillas ──────────────────────────────────────────────────────────

test("cada giro ofrece SU producto, no el dental para todos", () => {
  assert.match(crmPlantillaWhatsapp("INSTITUCION"), /Institucional/);
  assert.match(crmPlantillaWhatsapp("BARBERIA"), /Barber/);
  assert.match(crmPlantillaWhatsapp("INMOBILIARIA"), /Inmuebles/);
  assert.match(crmPlantillaWhatsapp("DENTAL"), /Dental/);
  assert.match(crmPlantillaWhatsapp(null), /Dental/, "sin giro, el mensaje por omisión es el dental");
});

test("la plantilla saluda por su nombre a quien contesta", () => {
  const con = crmPlantillaWhatsapp("DENTAL", { contacto: "Dra. Ruiz", negocio: "Clínica Sonrisa" });
  assert.match(con, /^Hola Dra\. Ruiz,/);
  assert.match(con, /Clínica Sonrisa/);
  assert.match(crmPlantillaWhatsapp("DENTAL"), /^Hola, buen día:/);
});

// ── Buscador ────────────────────────────────────────────────────────────

const SONRISA = {
  name: "Clínica Dental Sonrisa",
  contactName: "Dra. Ana Ruiz",
  phone: "(55) 1234-5678",
  email: "hola@sonrisa.mx",
  city: "Puebla",
  notes: "Tiene dos sucursales",
  tags: ["congreso"],
};

test("buscar sin acentos encuentra lo acentuado", () => {
  assert.equal(crmCoincide(SONRISA, "clinica"), true);
  assert.equal(crmCoincide(SONRISA, "CLÍNICA"), true);
  // La ñ se aplana a n. Es a propósito: quien teclea rápido escribe
  // "canada" buscando "Cañada", y el buscador tiene que perdonarlo.
  assert.equal(crmTextoPlano("Clínica CAÑADA"), "clinica canada");
});

test("varias palabras se exigen TODAS", () => {
  assert.equal(crmCoincide(SONRISA, "sonrisa puebla"), true);
  assert.equal(crmCoincide(SONRISA, "sonrisa monterrey"), false);
});

test("el teléfono se busca por dígitos, no por cómo se escribió", () => {
  assert.equal(crmCoincide(SONRISA, "5512345678"), true);
  assert.equal(crmCoincide(SONRISA, "1234"), true);
  assert.equal(crmCoincide(SONRISA, "9999"), false);
});

test("busca también en notas y etiquetas, y sin consulta pasa todo", () => {
  assert.equal(crmCoincide(SONRISA, "sucursales"), true);
  assert.equal(crmCoincide(SONRISA, "congreso"), true);
  assert.equal(crmCoincide(SONRISA, ""), true);
  assert.equal(crmCoincide(SONRISA, "   "), true);
});

test("un comodín de LIKE es texto, no un patrón (por eso NO se busca en la base)", () => {
  assert.equal(crmCoincide(SONRISA, "%"), false);
});

// ── Lo que ve el socio que recomendó ────────────────────────────────────

test("al afiliado NO se le enseña el embudo interno, sólo cuatro estados", () => {
  // Propuesta, negociación y demo son conversación de ventas de
  // DaleControl: al socio le dicen lo mismo, "en seguimiento".
  const enProceso = ["CONTACTADO", "INTERESADO", "DEMO", "PROPUESTA", "NEGOCIACION"];
  for (const e of enProceso) {
    assert.equal(crmEstadoParaAfiliado(e).label, "En seguimiento", e);
  }
  assert.equal(crmEstadoParaAfiliado("NUEVO").label, "Recibido");
  assert.equal(crmEstadoParaAfiliado("GANADO").label, "Ya es cliente");
  assert.equal(crmEstadoParaAfiliado("PERDIDO").label, "No prosperó");
});

test("una etapa desconocida cae en seguimiento, no truena la pantalla del socio", () => {
  assert.equal(crmEstadoParaAfiliado("ETAPA_RARA").label, "En seguimiento");
  assert.equal(crmEstadoParaAfiliado(null).label, "Recibido");
});

test("ganado y perdido son los únicos estados que cierran para el socio", () => {
  assert.equal(crmEstadoParaAfiliado("GANADO").tono, "success");
  assert.equal(crmEstadoParaAfiliado("PERDIDO").tono, "danger");
});
