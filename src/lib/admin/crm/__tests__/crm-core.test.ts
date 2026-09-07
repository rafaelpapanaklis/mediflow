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
 *  5. LOS FILTROS DE LA URL. Desde que la lista filtra y pagina en la
 *     BASE, la querystring es lo que decide qué consulta se hace. Un
 *     valor que se cuela sin validar llega hasta el `where`; una página
 *     mal contada salta filas entre la 1 y la 2, y nadie lo nota hasta
 *     que falta un prospecto.
 *  6. QUE LA BASE Y LA MEMORIA DIGAN LO MISMO. El servicio filtra en SQL
 *     cuando no hay búsqueda de texto y con estas funciones cuando sí la
 *     hay. Si los dos caminos discreparan, buscar dentro de un filtro
 *     daría otra lista que no buscar — y no habría forma de entenderlo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crmColumnasDesplegadas,
  crmCupoColumnas,
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
  crmComparar,
  crmFiltrosActivos,
  crmFiltrosAQuery,
  crmFiltrosCon,
  crmFiltrosDesdeQuery,
  crmFiltrosLimpios,
  crmHayFiltros,
  crmLimiteFrio,
  crmNumerosDePagina,
  crmPaginaValida,
  crmRangoTexto,
  crmTextoPlano,
  crmTotalPaginas,
  crmVistaARecordar,
  crmVistaEfectiva,
  crmValidarProspecto,
  crmValorDeInput,
  crmWhatsappLink,
  crmWhatsappNumero,
  CRM_DIAS_PARA_ENFRIARSE,
  CRM_ETAPAS,
  CRM_FILTROS_VACIOS,
  CRM_IMPORT_MAX,
  CRM_ORIGEN_AFILIADOS,
  CRM_ORIGEN_DALECONTROL,
  CRM_POR_PAGINA,
  CRM_COL_ANCHO_MIN,
  CRM_COL_HUECO,
  CRM_COL_PLEGADA,
  CRM_TABLERO_COMODO,
  CRM_TABLERO_VERTICAL,
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

// ── 10. Los filtros que viajan en la URL ────────────────────────────────
//
// La querystring la escribe cualquiera: se teclea, se pega, se manda por
// WhatsApp y se retoca a mano. Nada de lo que salga de aquí puede llegar
// crudo a un `where` de Prisma.

test("un valor fuera de catálogo se ignora en vez de llegar a la consulta", () => {
  const f = crmFiltrosDesdeQuery({
    giro: "NO_EXISTE",
    fuente: "'; --",
    estado: "loquesea",
    orden: "por_las_ganas",
    vista: "carrusel",
  });
  assert.equal(f.vertical, "");
  assert.equal(f.fuente, "");
  assert.equal(f.estado, "");
  assert.equal(f.orden, "prioridad");
  assert.equal(f.vista, "");
});

test("la etapa SÍ acepta un valor fuera del catálogo, y es a propósito", () => {
  // La columna es TEXT y el catálogo se retoca desde TypeScript: una fila
  // editada a mano en Supabase puede tener una etapa que hoy no aparece en
  // la lista, y el tablero le pinta su propia columna. Si aquí se
  // descartara, el botón "y N más — verlos en la lista" de esa columna
  // llevaría a la lista SIN filtro y enseñaría la libreta entera.
  assert.equal(crmFiltrosDesdeQuery({ etapa: "NEGOCIACION_2" }).etapa, "NEGOCIACION_2");
  assert.equal(crmFiltrosDesdeQuery({ etapa: "DEMO" }).etapa, "DEMO");
  // Pero acotada: no se convierte en un campo de texto libre sin límite.
  assert.equal(crmFiltrosDesdeQuery({ etapa: "x".repeat(500) }).etapa.length, 60);
});

test("lo que sí está en catálogo pasa tal cual", () => {
  const f = crmFiltrosDesdeQuery({
    q: "sonrisa",
    giro: "DENTAL",
    etapa: "PROPUESTA",
    fuente: "GOOGLE_MAPS",
    estado: "frios",
    orden: "valor",
    vista: "lista",
    origen: CRM_ORIGEN_AFILIADOS,
  });
  assert.equal(f.q, "sonrisa");
  assert.equal(f.vertical, "DENTAL");
  assert.equal(f.etapa, "PROPUESTA");
  assert.equal(f.fuente, "GOOGLE_MAPS");
  assert.equal(f.estado, "frios");
  assert.equal(f.orden, "valor");
  assert.equal(f.vista, "lista");
  assert.equal(f.origen, CRM_ORIGEN_AFILIADOS);
});

test("la página nunca es cero, negativa ni un texto", () => {
  assert.equal(crmFiltrosDesdeQuery({ pag: "0" }).pagina, 1);
  assert.equal(crmFiltrosDesdeQuery({ pag: "-7" }).pagina, 1);
  assert.equal(crmFiltrosDesdeQuery({ pag: "hola" }).pagina, 1);
  assert.equal(crmFiltrosDesdeQuery({ pag: "3.9" }).pagina, 3);
  assert.equal(crmFiltrosDesdeQuery({ pag: "12" }).pagina, 12);
});

test("el tamaño de página sólo acepta los de la lista", () => {
  assert.equal(crmFiltrosDesdeQuery({ n: "100" }).porPagina, 100);
  // 5000 filas de golpe es justo lo que se está evitando.
  assert.equal(crmFiltrosDesdeQuery({ n: "5000" }).porPagina, CRM_POR_PAGINA);
  assert.equal(crmFiltrosDesdeQuery({ n: "37" }).porPagina, CRM_POR_PAGINA);
});

test("un parámetro repetido (?q=a&q=b) se queda con el primero, no revienta", () => {
  assert.equal(crmFiltrosDesdeQuery({ q: ["primero", "segundo"] }).q, "primero");
});

test("sin querystring salen los filtros de fábrica", () => {
  assert.deepEqual(crmFiltrosDesdeQuery(undefined), CRM_FILTROS_VACIOS);
  assert.deepEqual(crmFiltrosDesdeQuery({}), CRM_FILTROS_VACIOS);
});

test("la URL de la pantalla recién abierta no lleva querystring", () => {
  assert.equal(crmFiltrosAQuery(CRM_FILTROS_VACIOS), "");
});

test("la URL sólo lleva lo que NO es el valor de fábrica", () => {
  const q = crmFiltrosAQuery({ ...CRM_FILTROS_VACIOS, estado: "frios", pagina: 3 });
  assert.equal(q, "?estado=frios&pag=3");
});

test("filtros → URL → filtros devuelve exactamente lo mismo", () => {
  const original = {
    ...CRM_FILTROS_VACIOS,
    q: "clínica puebla",
    vertical: "BARBERIA",
    fuente: "REFERIDO",
    etapa: "DEMO",
    origen: CRM_ORIGEN_DALECONTROL,
    estado: "vencidos" as const,
    orden: "sin-contacto" as const,
    vista: "tablero" as const,
    porPagina: 200,
    pagina: 4,
  };
  const url = new URLSearchParams(crmFiltrosAQuery(original).slice(1));
  const vuelta = crmFiltrosDesdeQuery(Object.fromEntries(url.entries()));
  assert.deepEqual(vuelta, original);
});

test("cambiar un filtro vuelve a la página 1; cambiar de página, no", () => {
  const base = { ...CRM_FILTROS_VACIOS, pagina: 7 };
  assert.equal(crmFiltrosCon(base, { estado: "frios" }).pagina, 1);
  assert.equal(crmFiltrosCon(base, { orden: "valor" }).pagina, 1);
  assert.equal(crmFiltrosCon(base, { pagina: 8 }).pagina, 8);
});

test("quitar todos deja el orden, la vista y el tamaño de página", () => {
  const puesto = {
    ...CRM_FILTROS_VACIOS,
    q: "algo",
    vertical: "DENTAL",
    estado: "frios" as const,
    orden: "valor" as const,
    vista: "lista" as const,
    porPagina: 100,
    pagina: 5,
  };
  const limpio = crmFiltrosLimpios(puesto);
  assert.equal(crmHayFiltros(puesto), true);
  assert.equal(crmHayFiltros(limpio), false);
  assert.equal(limpio.orden, "valor");
  assert.equal(limpio.vista, "lista");
  assert.equal(limpio.porPagina, 100);
  assert.equal(limpio.pagina, 1);
});

test("el orden y la vista NO cuentan como filtro: no esconden filas", () => {
  assert.equal(crmHayFiltros({ ...CRM_FILTROS_VACIOS, orden: "nombre", vista: "lista" }), false);
  assert.equal(crmHayFiltros({ ...CRM_FILTROS_VACIOS, q: "  " }), false);
  assert.equal(crmHayFiltros({ ...CRM_FILTROS_VACIOS, q: "a" }), true);
});

test("cada filtro puesto trae su ficha, con su etiqueta y en castellano", () => {
  const fichas = crmFiltrosActivos(
    {
      ...CRM_FILTROS_VACIOS,
      q: "sonrisa",
      vertical: "DENTAL",
      fuente: "GOOGLE_MAPS",
      etapa: "DEMO",
      estado: "frios",
      origen: "af_1",
    },
    [{ id: "af_1", nombre: "María López" }],
  );
  assert.deepEqual(
    fichas.map((f) => `${f.etiqueta}: ${f.texto}`),
    [
      "Buscando: «sonrisa»",
      "Giro: Clínica dental",
      "Fuente: Google Maps",
      "Etapa: Junta / demo",
      "Estado: Enfriándose",
      "Origen: María López",
    ],
  );
  // Cada ficha sabe qué clave hay que vaciar para quitarse ella sola.
  assert.deepEqual(
    fichas.map((f) => f.clave),
    ["q", "vertical", "fuente", "etapa", "estado", "origen"],
  );
});

test("un socio dado de baja se dice, no se calla el origen", () => {
  const fichas = crmFiltrosActivos({ ...CRM_FILTROS_VACIOS, origen: "af_borrado" }, []);
  assert.equal(fichas[0].texto, "Un socio dado de baja");
});

// ── 11. Que la base y la memoria digan lo mismo ─────────────────────────

test("el límite de frío que usa la base coincide con crmEstaFrio, día por día", () => {
  const ahora = new Date("2026-09-15T18:00:00.000Z");
  const limite = crmLimiteFrio(ahora);
  const arranque = crmInicioDelDiaMx(ahora).getTime();

  for (let d = 0; d <= 30; d++) {
    // Un contacto a media mañana de hace `d` días mexicanos.
    const contacto = new Date(arranque - d * 24 * 60 * 60 * 1000 + 5 * 60 * 60 * 1000);
    const loQueDiriaLaBase = contacto.getTime() < limite.getTime();
    const loQueDiceLaMemoria = crmEstaFrio({ stage: "CONTACTADO", lastContactAt: contacto }, ahora);
    assert.equal(
      loQueDiriaLaBase,
      loQueDiceLaMemoria,
      `a ${d} días sin contacto la base y la memoria no coinciden`,
    );
  }

  // Y el umbral cae donde dice el catálogo, ni un día antes ni después.
  const justoAntes = new Date(arranque - (CRM_DIAS_PARA_ENFRIARSE - 1) * 24 * 60 * 60 * 1000);
  assert.equal(crmEstaFrio({ stage: "NUEVO", lastContactAt: justoAntes }, ahora), false);
  assert.equal(justoAntes.getTime() < limite.getTime(), false);
});

// ── 12. El orden, y que la página 2 no repita ni se salte filas ─────────

test("por atender: lo más vencido arriba y lo que no tiene fecha al final", () => {
  const ahora = new Date("2026-09-15T18:00:00.000Z");
  const filas = [
    { name: "Sin fecha", nextActionAt: null },
    { name: "Mañana", nextActionAt: "2026-09-16T12:00:00.000Z" },
    { name: "Vencido hace mucho", nextActionAt: "2026-08-01T12:00:00.000Z" },
    { name: "Hoy", nextActionAt: "2026-09-15T12:00:00.000Z" },
    { name: "Vencido ayer", nextActionAt: "2026-09-14T12:00:00.000Z" },
  ];
  assert.deepEqual(
    [...filas].sort(crmComparar("prioridad", ahora)).map((f) => f.name),
    ["Vencido hace mucho", "Vencido ayer", "Hoy", "Mañana", "Sin fecha"],
  );
});

test("más abandonados: el que NUNCA se ha contactado va primero", () => {
  const filas = [
    { name: "Hace poco", lastContactAt: "2026-09-14T12:00:00.000Z" },
    { name: "Nunca", lastContactAt: null },
    { name: "Hace un año", lastContactAt: "2025-09-14T12:00:00.000Z" },
  ];
  assert.deepEqual(
    [...filas].sort(crmComparar("sin-contacto")).map((f) => f.name),
    ["Nunca", "Hace un año", "Hace poco"],
  );
});

test("mayor valor: sin valor puesto NO es valor cero, va al final", () => {
  const filas = [
    { name: "Sin poner", monthlyValue: null },
    { name: "Cero", monthlyValue: 0 },
    { name: "Mil", monthlyValue: 1000 },
  ];
  assert.deepEqual(
    [...filas].sort(crmComparar("valor")).map((f) => f.name),
    ["Mil", "Cero", "Sin poner"],
  );
});

test("dos prospectos con el MISMO nombre siguen teniendo un orden fijo", () => {
  // El caso que rompe la paginación: el nombre no es único (la tabla no
  // tiene unique y dar de alta no deduplica), así que dos "Clínica Dental
  // Sonrisa" empatan en todos los criterios. Sin un desempate total, la
  // base puede resolverlos de una forma para la página 1 y de otra para la
  // 2: una fila sale dos veces y su gemela no sale nunca, con el contador
  // diciendo tan tranquilo "120 de 120".
  const gemelas = [
    { id: "ckz9", name: "Clínica Dental Sonrisa", nextActionAt: null, monthlyValue: null, lastContactAt: null },
    { id: "cka1", name: "Clínica Dental Sonrisa", nextActionAt: null, monthlyValue: null, lastContactAt: null },
  ];
  for (const orden of ["prioridad", "sin-contacto", "valor", "nombre", "reciente", "nuevos"] as const) {
    assert.deepEqual(
      [...gemelas].sort(crmComparar(orden)).map((f) => f.id),
      ["cka1", "ckz9"],
      `el orden "${orden}" no es total: dos filas con el mismo nombre quedan al azar`,
    );
    // Y da igual en qué orden lleguen: el resultado es el mismo.
    assert.deepEqual(
      [...gemelas].reverse().sort(crmComparar(orden)).map((f) => f.id),
      ["cka1", "ckz9"],
      `el orden "${orden}" depende de cómo venían las filas`,
    );
  }
});

test("todos los órdenes desempatan por nombre, o la página 2 repetiría filas", () => {
  const empate = [
    { name: "Zeta", nextActionAt: null, monthlyValue: null, lastContactAt: null, updatedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" },
    { name: "Alfa", nextActionAt: null, monthlyValue: null, lastContactAt: null, updatedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" },
  ];
  for (const orden of ["prioridad", "sin-contacto", "valor", "nombre", "reciente", "nuevos"] as const) {
    assert.deepEqual(
      [...empate].sort(crmComparar(orden)).map((f) => f.name),
      ["Alfa", "Zeta"],
      `el orden "${orden}" no desempata`,
    );
  }
});

test("el alfabético ordena como el español, no como la tabla ASCII", () => {
  // Las dos cosas que un `sort()` pelado se equivoca: la Ñ va DESPUÉS de
  // la N (es letra propia), y una vocal acentuada ordena junto a la suya
  // en vez de irse al final del alfabeto.
  const filas = [{ name: "Ozono" }, { name: "Óptica" }, { name: "Ñandú" }, { name: "Nueva" }];
  assert.deepEqual(
    [...filas].sort(crmComparar("nombre")).map((f) => f.name),
    ["Nueva", "Ñandú", "Óptica", "Ozono"],
  );
});

// ── 13. Paginación: no hay página en blanco ni página cero ──────────────

test("siempre hay al menos una página, aunque no haya ni una fila", () => {
  assert.equal(crmTotalPaginas(0, 50), 1);
  assert.equal(crmTotalPaginas(50, 50), 1);
  assert.equal(crmTotalPaginas(51, 50), 2);
  assert.equal(crmTotalPaginas(1240, 50), 25);
});

test("pedir la página 99 de 3 lleva a la 3, no a una pantalla en blanco", () => {
  assert.equal(crmPaginaValida(99, 120, 50), 3);
  assert.equal(crmPaginaValida(1, 120, 50), 1);
  assert.equal(crmPaginaValida(0, 120, 50), 1);
  assert.equal(crmPaginaValida(2, 0, 50), 1);
});

test("el rango dice los dos números, siempre", () => {
  assert.equal(crmRangoTexto(1, 50, 1240), "1–50 de 1,240");
  assert.equal(crmRangoTexto(25, 50, 1240), "1,201–1,240 de 1,240");
  assert.equal(crmRangoTexto(1, 50, 1), "1 de 1");
  assert.equal(crmRangoTexto(1, 50, 0), "Ninguno de 0");
});

test("el paginador siempre enseña la primera y la última página", () => {
  assert.deepEqual(crmNumerosDePagina(1, 5), [1, 2, 3, 4, 5]);
  const largo = crmNumerosDePagina(12, 25);
  assert.equal(largo[0], 1);
  assert.equal(largo[largo.length - 1], 25);
  assert.ok(largo.includes(12));
  assert.ok(largo.includes(null), "faltan los puntos suspensivos");
});

// ── 14. Qué vista se abre sola ──────────────────────────────────────────

test("con la libreta chica manda el tablero; en cuanto crece, la lista", () => {
  assert.equal(crmVistaEfectiva(CRM_FILTROS_VACIOS, 10), "tablero");
  assert.equal(crmVistaEfectiva(CRM_FILTROS_VACIOS, CRM_TABLERO_COMODO), "tablero");
  assert.equal(crmVistaEfectiva(CRM_FILTROS_VACIOS, CRM_TABLERO_COMODO + 1), "lista");
});

test("lo que elige la persona gana siempre sobre el tamaño", () => {
  assert.equal(crmVistaEfectiva({ ...CRM_FILTROS_VACIOS, vista: "tablero" }, 99999), "tablero");
  assert.equal(crmVistaEfectiva({ ...CRM_FILTROS_VACIOS, vista: "lista" }, 1), "lista");
});

// ── 15. La vista que se recuerda ────────────────────────────────────────
//
// El caso que lo motiva: pasando de CRM_TABLERO_COMODO la vista por
// defecto es la lista, y Rafael dijo que la que usa es el tablero. Sin
// esto tenía que pulsar "Tablero" cada mañana.

test("sin nada guardado no se toca nada: manda el corte de la libreta", () => {
  assert.equal(crmVistaARecordar(CRM_FILTROS_VACIOS, null), null);
  assert.equal(crmVistaARecordar(CRM_FILTROS_VACIOS, undefined), null);
});

test("lo guardado se aplica sólo cuando la URL no dice nada", () => {
  assert.equal(crmVistaARecordar(CRM_FILTROS_VACIOS, "tablero"), "tablero");
  assert.equal(crmVistaARecordar(CRM_FILTROS_VACIOS, "lista"), "lista");
});

test("un enlace con vista puesta GANA a lo guardado, o compartir no serviría", () => {
  const conLista = { ...CRM_FILTROS_VACIOS, vista: "lista" as const };
  assert.equal(crmVistaARecordar(conLista, "tablero"), null);
  const conTablero = { ...CRM_FILTROS_VACIOS, vista: "tablero" as const };
  assert.equal(crmVistaARecordar(conTablero, "lista"), null);
});

test("basura en el almacén del navegador se ignora, no rompe la pantalla", () => {
  assert.equal(crmVistaARecordar(CRM_FILTROS_VACIOS, "kanban"), null);
  assert.equal(crmVistaARecordar(CRM_FILTROS_VACIOS, ""), null);
  assert.equal(crmVistaARecordar(CRM_FILTROS_VACIOS, "{}"), null);
});

// ── 16. Cuántas columnas del tablero caben ──────────────────────────────
//
// Lo que se está protegiendo aquí es la queja literal de Rafael: ocho
// columnas de 258 px fijos dentro de un contenedor de 1.182 daban cuatro
// visibles y cuatro a ciegas. La comprobación de verdad es la de "todo
// lo que devuelve la función CABE", que es aritmética y no opinión.

/** Lo que ocupa de verdad un reparto, para poder afirmar que cabe. */
function anchoQueOcupa(total: number, desplegadas: number): number {
  return (
    desplegadas * CRM_COL_ANCHO_MIN +
    (total - desplegadas) * CRM_COL_PLEGADA +
    (total - 1) * CRM_COL_HUECO
  );
}

test("lo que el cupo dice que cabe, CABE — y una más ya no", () => {
  for (const ancho of [700, 860, 1022, 1182, 1440, 1900]) {
    const n = crmCupoColumnas(ancho, 8);
    assert.ok(
      anchoQueOcupa(8, n) <= ancho || n === 1,
      `a ${ancho} px dice que caben ${n} y no caben`,
    );
    if (n < 8) {
      assert.ok(
        anchoQueOcupa(8, n + 1) > ancho,
        `a ${ancho} px caben ${n + 1} y se está enseñando de menos`,
      );
    }
  }
});

test("en un portátil normal caben más de las cuatro de antes", () => {
  // 1.182 px es lo que queda en 1440 tras la barra lateral de /admin.
  assert.ok(
    crmCupoColumnas(1182, 8) >= 5,
    "el punto de la tarea era dejar de ver 4 de 8",
  );
});

test("nunca devuelve cero: un tablero sin ninguna abierta no es un tablero", () => {
  assert.equal(crmCupoColumnas(0, 8), 1);
  assert.equal(crmCupoColumnas(120, 8), 1);
  assert.equal(crmCupoColumnas(-500, 8), 1);
});

test("con sitio de sobra no se pliega ninguna", () => {
  assert.equal(crmCupoColumnas(4000, 8), 8);
});

test("sin columnas no hay cupo, y no truena", () => {
  assert.equal(crmCupoColumnas(1182, 0), 0);
});

// ── 17. Cuáles se pliegan ───────────────────────────────────────────────

// `string[]` y no `CrmEtapaId[]`: el tablero también pinta etapas fuera
// del catálogo (una fila editada a mano en Supabase), y las funciones que
// se prueban aquí trabajan con ids sueltos a propósito.
const OCHO: string[] = CRM_ETAPAS.map((e) => e.id);

/** Un embudo con forma de embudo: mucho arriba y poco abajo. */
const EMBUDO: Record<string, number> = {
  NUEVO: 812,
  CONTACTADO: 40,
  INTERESADO: 12,
  DEMO: 3,
  PROPUESTA: 2,
  NEGOCIACION: 1,
  GANADO: 8,
  PERDIDO: 30,
};

function desplegadas(ancho: number, totales = EMBUDO, elegidas?: string[]) {
  return crmColumnasDesplegadas({
    columnas: OCHO,
    totales,
    ancho,
    orientacion: ancho > 0 && ancho < CRM_TABLERO_VERTICAL ? "vertical" : "horizontal",
    elegidas,
  });
}

test("el reparto automático SIEMPRE cabe en el ancho que se le da", () => {
  for (const ancho of [800, 900, 1022, 1182, 1440, 1900]) {
    const abiertas = desplegadas(ancho).length;
    assert.ok(
      anchoQueOcupa(8, abiertas) <= ancho || abiertas === 1,
      `a ${ancho} px abre ${abiertas} columnas y no caben`,
    );
  }
});

test("nunca se quedan las ocho plegadas: siempre hay de dónde arrastrar", () => {
  for (const ancho of [0, 320, 390, 700, 1182, 4000]) {
    assert.ok(desplegadas(ancho).length >= 1, `a ${ancho} px no queda ninguna abierta`);
  }
});

test("lo que se pliega primero es el archivo, no el trabajo del día", () => {
  // A 1.182 px no caben las ocho. Las que se van son las de cerrar.
  const abiertas = desplegadas(1182);
  assert.ok(abiertas.indexOf("NUEVO") >= 0, "se plegó la columna más llena");
  assert.ok(abiertas.indexOf("CONTACTADO") >= 0);
  assert.ok(abiertas.indexOf("PERDIDO") === -1, "Perdido debería plegarse antes que nada");
});

test("una columna VACÍA se pliega antes que una con trabajo dentro", () => {
  // Mismo embudo, pero DEMO y NEGOCIACION sin nadie. Son las que sobran.
  const conHuecos = { ...EMBUDO, DEMO: 0, NEGOCIACION: 0 };
  const abiertas = desplegadas(1182, conHuecos);
  assert.ok(abiertas.indexOf("DEMO") === -1, "una columna vacía no tiene nada que enseñar");
  assert.ok(abiertas.indexOf("NEGOCIACION") === -1);
  assert.ok(abiertas.indexOf("INTERESADO") >= 0, "se plegó una que sí tenía tarjetas");
});

test("filtrando por una sola etapa, la que queda es la que tiene las filas", () => {
  const soloGanado: Record<string, number> = { GANADO: 300 };
  const abiertas = desplegadas(1182, soloGanado);
  assert.ok(abiertas.indexOf("GANADO") >= 0, "la única con filas tiene que verse");
});

test("el orden de salida es el del embudo, no el de plegado", () => {
  const abiertas = desplegadas(1182);
  const posiciones = abiertas.map((id) => OCHO.indexOf(id));
  const ordenadas = [...posiciones].sort((a, b) => a - b);
  assert.deepEqual(posiciones, ordenadas, "el embudo se lee de izquierda a derecha");
});

test("en el móvil se abre UNA y las otras siete siguen diciendo su número", () => {
  const abiertas = desplegadas(390);
  assert.equal(abiertas.length, 1, "en vertical se trabaja una etapa a la vez");
  // Las otras siete no desaparecen: siguen siendo columnas del tablero,
  // plegadas. Eso es lo que hace que el embudo entero quepa en un móvil.
  assert.equal(OCHO.length - abiertas.length, 7);
});

test("lo que se elige a mano gana sobre la cuenta", () => {
  const abiertas = desplegadas(1182, EMBUDO, ["PERDIDO"]);
  assert.deepEqual(abiertas, ["PERDIDO"]);
});

test("una elección de una etapa que ya no existe no deja el tablero vacío", () => {
  // Pasó de verdad: una etapa fuera de catálogo que después desaparece.
  const abiertas = desplegadas(1182, EMBUDO, ["ETAPA_QUE_YA_NO_ESTA"]);
  assert.ok(abiertas.length >= 1, "se vuelve al automático en vez de quedarse en blanco");
  assert.ok(abiertas.indexOf("ETAPA_QUE_YA_NO_ESTA") === -1);
});

test("una etapa fuera de catálogo tiene columna, y también se le hace sitio", () => {
  const columnas = [...OCHO, "ETAPA_VIEJA"];
  const abiertas = crmColumnasDesplegadas({
    columnas,
    totales: { ...EMBUDO, ETAPA_VIEJA: 300 },
    ancho: 1182,
    orientacion: "horizontal",
  });
  assert.ok(abiertas.length >= 1);
  assert.ok(
    abiertas.every((id) => columnas.indexOf(id) >= 0),
    "no se inventa columnas",
  );
});

test("sin columnas devuelve la lista vacía en vez de reventar", () => {
  assert.deepEqual(
    crmColumnasDesplegadas({ columnas: [], totales: {}, ancho: 1182, orientacion: "horizontal" }),
    [],
  );
});

test("con TODAS vacías se pliega sólo lo que hace falta, empezando por el final", () => {
  // Caso de laboratorio (la pantalla enseña "sin resultados" antes de
  // llegar aquí), pero fija la regla: estar vacía adelanta a una columna
  // en la cola de plegado, NO la pliega porque sí. Si se plegaran todas
  // las vacías siempre, sacar la última tarjeta de una columna
  // reacomodaría el tablero entero justo después de soltarla.
  const abiertas = desplegadas(1182, {});
  assert.equal(abiertas.length, crmCupoColumnas(1182, 8), "se pliega lo justo para caber");
  assert.equal(abiertas[0], "NUEVO", "el embudo se sigue leyendo desde el principio");
  assert.ok(abiertas.indexOf("PERDIDO") === -1, "y lo que se va es el final");
});
