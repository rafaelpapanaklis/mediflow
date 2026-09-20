/**
 * EL EXPEDIENTE CLÍNICO COMPLETO EN UN PDF — lo que tiene que salir IMPRESO.
 *
 * Run: npm run test:expediente-pdf
 *
 * Se lee el PDF DE VERDAD (`renderToBuffer`) y se mira qué texto cae DENTRO de
 * la hoja, no el árbol de React. La diferencia no es teórica: con `lineHeight`
 * en la página, @react-pdf 4.x ha escrito renglones del pie en el flujo pero
 * fuera del papel, y un árbol correcto no lo habría delatado.
 *
 * Lo que se fija aquí:
 *   · un paciente SIN cuestionario y SIN notas genera un PDF válido que dice
 *     «No capturado» donde toca, y no revienta;
 *   · la casilla de imágenes APAGADA lista las placas con su tipo, su fecha y
 *     quién las subió — y el documento AVISA de que las imágenes no van;
 *   · la casilla de administrativo APAGADA no deja pasar ni una factura;
 *   · una nota con adendas las imprime DEBAJO, separadas y numeradas, con el
 *     aviso de que la nota no está completa sin ellas;
 *   · el pie sale EN TODAS las páginas con el folio, el número de página y la
 *     leyenda de documento clínico confidencial;
 *   · los campos NOM-004 que ws1-t5 está añadiendo se pintan si están y se
 *     declaran ausentes si no — nunca un hueco mudo.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToBuffer } from "@react-pdf/renderer";
import {
  ExpedienteDocument,
  NO_CAPTURADO,
  leerAparatosSistemas,
  leerExploracionFisica,
  leerHeredoFamiliares,
  leerPronostico,
  noCapturado,
  pesoLegible,
  siNo,
  type ExpedienteDocumentProps,
  type ExpedienteNota,
} from "../expediente-document";
import { textoVisiblePorPagina } from "./_texto-del-pdf";
import { makePng } from "./_imagenes-de-prueba";

const TZ = "America/Mexico_City";

/** El expediente más pobre que existe: una ficha y nada más. */
function props(over: Partial<ExpedienteDocumentProps> = {}): ExpedienteDocumentProps {
  return {
    clinicName: "Clínica Demo",
    clinicAddress: null,
    clinicCity: null,
    clinicState: null,
    clinicPhone: null,
    clinicEmail: null,
    clinicTaxId: null,
    clinicClues: null,
    clinicLogoDataUrl: null,
    clinicLogoAspect: null,
    timeZone: TZ,
    paciente: {
      nombre: "Ana López",
      folio: "P0042",
      curp: null,
      dob: null,
      genero: null,
      tipoSangre: null,
      telefono: null,
      correo: null,
      direccion: null,
      contactoEmergencia: null,
      alergias: [],
      padecimientos: [],
      medicamentos: [],
      antecedentesFamiliares: null,
      antecedentesNoPatologicos: null,
      doctorDeCabecera: null,
      altaEnLaClinica: "2026-01-10T17:00:00.000Z",
    },
    emisor: { nombre: "Dra. Marta Ruiz", cedula: "1234567", rol: "ADMIN" },
    generadoEl: "2026-09-20T17:30:00.000Z",
    periodo: { desde: null, hasta: null },
    antecedentes: null,
    notas: [],
    notasPrivadasOmitidas: 0,
    odontograma: [],
    odontogramaActualizado: null,
    planes: [],
    recetas: [],
    consentimientos: [],
    firmasOmitidas: 0,
    estudios: [],
    citas: [],
    administrativo: null,
    opciones: { incluirImagenes: false, incluirAdministrativo: false },
    ...over,
  };
}

function nota(over: Partial<ExpedienteNota> = {}): ExpedienteNota {
  return {
    id: "rec_1",
    fecha: "2026-03-04T16:00:00.000Z",
    doctor: "Dr/a. Marta Ruiz",
    doctorCedula: "1234567",
    estado: "SIGNED",
    firmadaEl: "2026-03-04T16:40:00.000Z",
    subjetivo: "Refiere dolor en el cuadrante superior derecho.",
    objetivo: "Caries oclusal en la pieza 16.",
    analisis: "Caries dental de la dentina.",
    plan: "Resina compuesta en 16.",
    diagnosticos: [{ code: "K02.1", description: "Caries de la dentina" }],
    procedimientos: ["Resina compuesta"],
    signosVitales: [{ etiqueta: "Tensión arterial", valor: "120/80" }],
    exploracionFisica: null,
    pronostico: null,
    adendas: [],
    ...over,
  };
}

async function texto(p: ExpedienteDocumentProps): Promise<{ paginas: string[]; todo: string }> {
  const pdf = await renderToBuffer(<ExpedienteDocument {...p} />);
  const paginas = textoVisiblePorPagina(pdf);
  return { paginas, todo: paginas.join("   ") };
}

// ─────────────────────────────────────────────────────────────────────
// 1 · El expediente vacío — el caso que más se va a dar al principio
// ─────────────────────────────────────────────────────────────────────

describe("un paciente sin cuestionario y sin notas", () => {
  it("genera un PDF válido, con sus nueve secciones y sin romperse", async () => {
    const { paginas, todo } = await texto(props());
    assert.ok(paginas.length >= 1, "el PDF no tiene ni una página");
    assert.match(todo, /Expediente cl.nico/);
    assert.match(todo, /Ficha de identificaci.n/);
    assert.match(todo, /Antecedentes de salud/);
    assert.match(todo, /Notas de evoluci.n/);
    assert.match(todo, /Odontograma/);
    assert.match(todo, /Planes de tratamiento/);
    assert.match(todo, /Recetas/);
    assert.match(todo, /Consentimientos informados/);
    assert.match(todo, /Estudios/);
    assert.match(todo, /Historial de citas/);
  });

  it("dice «No capturado» donde el panel no tiene el dato, nunca un hueco mudo", async () => {
    const { todo } = await texto(props());
    // No basta con que la palabra aparezca una vez: tiene que estar en los
    // renglones que de verdad faltan (CURP, nacimiento, domicilio, teléfono…).
    const veces = todo.split(NO_CAPTURADO).length - 1;
    assert.ok(veces >= 8, `«${NO_CAPTURADO}» solo sale ${veces} veces; se esperaban al menos 8`);
    assert.match(todo, /CURP/i);
    assert.match(todo, /Fecha de nacimiento/i);
    assert.match(todo, /Domicilio/i);
  });

  it("no deja de imprimir el renglón: la etiqueta sigue ahí aunque el dato falte", async () => {
    const { todo } = await texto(props());
    // Si el renglón se omitiera, nadie notaría que el expediente está cojo.
    // Las etiquetas se pintan en MAYÚSCULAS, así que se busca sin caja.
    const enMayusculas = todo.toUpperCase();
    // «Pronóstico» no entra aquí a propósito: es un campo DE LA NOTA, y este
    // expediente no tiene ninguna. Se comprueba en la sección 6, con nota.
    for (const etiqueta of ["CURP", "TIPO DE SANGRE", "CONTACTO DE EMERGENCIA", "M\u00c9DICO DE CABECERA"]) {
      assert.ok(enMayusculas.includes(etiqueta), `falta la etiqueta «${etiqueta}» del expediente vacío`);
    }
  });

  it("las secciones vacías lo DICEN, no se quedan en blanco", async () => {
    const { todo } = await texto(props());
    assert.match(todo, /Sin notas de evoluci.n registradas/);
    assert.match(todo, /Sin hallazgos registrados en el odontograma/);
    assert.match(todo, /Sin planes de tratamiento registrados/);
    assert.match(todo, /Sin recetas emitidas/);
    assert.match(todo, /Sin consentimientos informados registrados/);
    assert.match(todo, /Sin radiograf.as ni fotograf.as registradas/);
    assert.match(todo, /Sin citas registradas/);
  });

  it("la fecha de nacimiento NO se corre un día por la zona horaria", async () => {
    // `Patient.dob` no es un instante, es un DÍA: se guarda como la medianoche
    // UTC de esa fecha. Leída en la zona de la clínica (UTC-6) sale seis horas
    // antes, o sea el día anterior, y el expediente le cambia el cumpleaños al
    // paciente. Se vio al abrir el PDF de muestra: decía «02 de mayo de 1990»
    // para una fecha guardada como el 3.
    const { todo } = await texto(
      props({ paciente: { ...props().paciente, dob: "1990-05-03T00:00:00.000Z" } }),
    );
    assert.match(todo, /03 de mayo de 1990/);
    assert.doesNotMatch(todo, /02 de mayo de 1990/);
  });

  it("las fechas que SÍ son instantes siguen en la zona de la clínica", async () => {
    // La visita es un momento, no un día: ahí la hora es parte del dato y se
    // lee en la zona de la clínica. 2026-03-04T16:00Z en México son las 10:00.
    const { todo } = await texto(props({ notas: [nota()] }));
    assert.match(todo, /04\/03\/2026 10:00/);
  });

  it("la portada se ve digna sin dirección y sin logo (el caso de las 15 clínicas de hoy)", async () => {
    const { paginas } = await texto(props());
    const portada = paginas[0];
    assert.match(portada, /Cl.nica Demo/);
    assert.match(portada, /Establecimiento/i);
    // La dirección no se omite: se declara ausente. Y el folio manda.
    assert.match(portada, /Direcci.n/i);
    assert.match(portada, /P0042/);
    assert.match(portada, /Emitido por/i);
    assert.match(portada, /Dra. Marta Ruiz/);
    assert.match(portada, /C.dula profesional 1234567/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2 · El pie, en TODAS las páginas
// ─────────────────────────────────────────────────────────────────────

describe("el pie de página", () => {
  it("lleva folio, número de página y la leyenda de confidencial EN CADA página", async () => {
    // Un expediente que ocupe más de una hoja: doce notas con texto.
    const notas = Array.from({ length: 12 }, (_, i) =>
      nota({
        id: `rec_${i}`,
        fecha: `2026-0${(i % 9) + 1}-0${(i % 9) + 1}T16:00:00.000Z`,
        subjetivo: `Visita ${i + 1}. ` + "Motivo de consulta detallado. ".repeat(12),
      }),
    );
    const { paginas } = await texto(props({ notas }));
    assert.ok(paginas.length >= 2, `se esperaban varias páginas, salieron ${paginas.length}`);
    paginas.forEach((pagina, i) => {
      assert.ok(pagina.includes("P0042"), `la página ${i + 1} no lleva el folio del paciente`);
      assert.ok(
        /Documento cl.nico confidencial/.test(pagina),
        `la página ${i + 1} no lleva la leyenda de confidencial`,
      );
      assert.ok(
        new RegExp(`P.gina ${i + 1} de ${paginas.length}`).test(pagina),
        `la página ${i + 1} no dice «Página ${i + 1} de ${paginas.length}»`,
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3 · Las adendas van DEBAJO de su nota, como en el PDF de nota suelta
// ─────────────────────────────────────────────────────────────────────

describe("una nota con adendas", () => {
  const conAdendas = props({
    notas: [
      nota({
        adendas: [
          {
            texto: "Donde dice pieza 26 debe decir pieza 27.",
            autor: "Dr/a. Marta Ruiz",
            fecha: "2026-03-05T18:00:00.000Z",
          },
          {
            texto: "Se añade control radiográfico a los seis meses.",
            autor: "Dr/a. Luis Paz",
            fecha: "2026-03-09T15:00:00.000Z",
          },
        ],
      }),
    ],
  });

  it("las imprime debajo, numeradas, con su fecha y su autor", async () => {
    const { todo } = await texto(conAdendas);
    assert.match(todo, /Adenda 1 de 2/);
    assert.match(todo, /Adenda 2 de 2/);
    assert.match(todo, /debe decir pieza 27/);
    assert.match(todo, /Dr\/a. Luis Paz/);
  });

  it("avisa ARRIBA de que la nota está corregida, antes de que se lea", async () => {
    const { todo } = await texto(conAdendas);
    const posAviso = todo.indexOf("Esta nota tiene 2 adendas");
    const posAdenda = todo.indexOf("Adenda 1 de 2");
    assert.ok(posAviso >= 0, "no aparece el aviso de que la nota tiene adendas");
    assert.ok(posAdenda > posAviso, "el aviso tiene que ir ANTES de las adendas, no después");
  });

  it("cada adenda cierra con su marca de fin: si se parte, se ve dónde acaba", async () => {
    const { todo } = await texto(conAdendas);
    assert.match(todo, /fin de la adenda 1 de 2/);
    assert.match(todo, /fin de la adenda 2 de 2/);
  });

  it("la nota original se reproduce SIN tachones: sigue diciendo lo que decía", async () => {
    const { todo } = await texto(conAdendas);
    assert.match(todo, /Caries oclusal en la pieza 16/);
  });

  it("una nota sin adendas no anuncia ninguna", async () => {
    const { todo } = await texto(props({ notas: [nota()] }));
    assert.doesNotMatch(todo, /Esta nota tiene/);
    assert.doesNotMatch(todo, /Adenda 1 de/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4 · La casilla de IMÁGENES
// ─────────────────────────────────────────────────────────────────────

const PNG = `data:image/png;base64,${makePng(80, 60).toString("base64")}`;

const ESTUDIOS = [
  {
    nombre: "panoramica-2026.png",
    tipo: "Radiografía panorámica",
    fecha: "2026-02-11T18:00:00.000Z",
    subidoPor: "Recepción Uno",
    diente: null,
    notas: null,
    bytes: 1_200_000,
    imagen: null as string | null,
    motivoSinImagen: null as string | null,
  },
  {
    nombre: "periapical-16.png",
    tipo: "Radiografía periapical",
    fecha: "2026-04-02T18:00:00.000Z",
    subidoPor: "Dr/a. Marta Ruiz",
    diente: 16,
    notas: null,
    bytes: 400_000,
    imagen: null as string | null,
    motivoSinImagen: null as string | null,
  },
];

describe("la casilla de imágenes APAGADA (el default)", () => {
  const apagada = props({
    estudios: ESTUDIOS,
    opciones: { incluirImagenes: false, incluirAdministrativo: false },
  });

  it("lista las placas con su tipo, su fecha y quién las subió", async () => {
    const { todo } = await texto(apagada);
    assert.match(todo, /panoramica-2026.png/);
    assert.match(todo, /Radiograf.a panor.mica/);
    assert.match(todo, /Recepci.n Uno/);
    assert.match(todo, /periapical-16.png/);
    assert.match(todo, /Dr\/a. Marta Ruiz/);
    // La cabecera de la tabla: es lo que convierte una lista en algo legible.
    assert.match(todo, /Subido por/i);
  });

  it("AVISA de que las imágenes no van, para que nadie crea que no hay placas", async () => {
    const { todo } = await texto(apagada);
    assert.match(todo, /NO incluye las im.genes/);
    assert.match(todo, /casilla .Incluir im.genes de radiograf.as y fotos. apagada/);
  });

  it("no incrusta NADA: el PDF pesa lo que pesa el texto", async () => {
    const conImagen = ESTUDIOS.map((e) => ({ ...e, imagen: PNG }));
    const sinIncrustar = await renderToBuffer(<ExpedienteDocument {...apagada} />);
    // Mismos estudios, misma casilla apagada, pero con la imagen resuelta en
    // las props: la casilla manda, no el dato. El tamaño no puede cambiar.
    const conDatosDeImagen = await renderToBuffer(
      <ExpedienteDocument {...props({ estudios: conImagen, opciones: apagada.opciones })} />,
    );
    const diferencia = Math.abs(conDatosDeImagen.byteLength - sinIncrustar.byteLength);
    assert.ok(
      diferencia < 2000,
      `con la casilla apagada el PDF cambió ${diferencia} bytes: se está incrustando algo`,
    );
  });
});

describe("la casilla de imágenes ENCENDIDA", () => {
  it("incrusta las placas y el PDF crece de verdad", async () => {
    const encendida = props({
      estudios: ESTUDIOS.map((e) => ({ ...e, imagen: PNG })),
      opciones: { incluirImagenes: true, incluirAdministrativo: false },
    });
    const apagada = props({
      estudios: ESTUDIOS,
      opciones: { incluirImagenes: false, incluirAdministrativo: false },
    });
    const conImg = await renderToBuffer(<ExpedienteDocument {...encendida} />);
    const sinImg = await renderToBuffer(<ExpedienteDocument {...apagada} />);
    assert.ok(
      conImg.byteLength > sinImg.byteLength,
      "con la casilla encendida el PDF tiene que pesar más: no se incrustó nada",
    );
    const todo = textoVisiblePorPagina(conImg).join(" ");
    assert.doesNotMatch(todo, /NO incluye las im.genes/);
  });

  it("una imagen que no se pudo traer lo DICE, con su motivo, y el estudio sigue", async () => {
    const encendida = props({
      estudios: [
        {
          ...ESTUDIOS[0],
          imagen: null,
          motivoSinImagen: "formato no imprimible (image/webp)",
        },
      ],
      opciones: { incluirImagenes: true, incluirAdministrativo: false },
    });
    const { todo } = await texto(encendida);
    assert.match(todo, /panoramica-2026.png/, "el estudio desapareció del expediente");
    assert.match(todo, /Imagen no incrustada: formato no imprimible/);
    assert.match(todo, /El archivo original est. en el sistema/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5 · La casilla de ADMINISTRATIVO
// ─────────────────────────────────────────────────────────────────────

const ADMIN = {
  facturas: [
    {
      folio: "F-0001",
      fecha: "2026-03-04T18:00:00.000Z",
      concepto: "Resina compuesta",
      total: "$1,200",
      pagado: "$1,200",
      estado: "Pagada",
    },
  ],
  presupuestos: [
    {
      folio: "Q-0007",
      fecha: "2026-02-20T18:00:00.000Z",
      concepto: "Rehabilitación superior",
      total: "$18,400",
      estado: "ACCEPTED",
    },
  ],
};

describe("la casilla de administrativo APAGADA (el default)", () => {
  it("no aparece NI UNA factura ni un presupuesto", async () => {
    const { todo } = await texto(props({ administrativo: null }));
    assert.doesNotMatch(todo, /Anexo administrativo/);
    assert.doesNotMatch(todo, /F-0001/);
    assert.doesNotMatch(todo, /Q-0007/);
    assert.doesNotMatch(todo, /Facturas/i);
    assert.doesNotMatch(todo, /Presupuestos/i);
  });

  it("tampoco cuela por la puerta de atrás: sin el anexo no hay importes", async () => {
    const { todo } = await texto(props({ administrativo: null }));
    assert.doesNotMatch(todo, /\$1,200/);
    assert.doesNotMatch(todo, /\$18,400/);
  });
});

describe("la casilla de administrativo ENCENDIDA", () => {
  it("añade el anexo y explica que NO forma parte del expediente clínico", async () => {
    const { todo } = await texto(
      props({
        administrativo: ADMIN,
        opciones: { incluirImagenes: false, incluirAdministrativo: true },
      }),
    );
    assert.match(todo, /Anexo administrativo/);
    assert.match(todo, /NO forma parte del expediente cl.nico/);
    assert.match(todo, /F-0001/);
    assert.match(todo, /Q-0007/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6 · Los campos NOM-004 que ws1-t5 está añadiendo en paralelo
// ─────────────────────────────────────────────────────────────────────

describe("los campos que el panel todavía puede no capturar", () => {
  it("si NO están, el expediente los declara ausentes (no los omite)", async () => {
    const { todo } = await texto(props({ notas: [nota()] }));
    assert.match(todo, /Antecedentes heredo-familiares/i);
    assert.match(todo, /Interrogatorio por aparatos y sistemas/i);
    assert.match(todo, /Exploraci.n f.sica/i);
    assert.match(todo, /Habitus exterior/i);
    assert.match(todo, /Pron.stico/i);
    assert.ok(todo.includes(NO_CAPTURADO), "no se declaró ningún campo ausente");
  });

  it("si ESTÁN, se pintan con su valor", async () => {
    const { todo } = await texto(
      props({
        antecedentes: {
          llenadoEl: "2026-01-15T17:00:00.000Z",
          llenadoPor: "Recepción Uno",
          padecimientos: [{ etiqueta: "Diabetes", valor: "Sí — tipo 2 controlada" }],
          alergias: [{ etiqueta: "Penicilina / antibióticos", valor: "Sí" }],
          habitos: [{ etiqueta: "Tabaco", valor: "No" }],
          medicamentos: ["Metformina 850 mg"],
          avisosDeRiesgo: ["Diabetes"],
          notas: null,
          heredoFamiliares: {
            diabetes: true,
            hipertension: false,
            cardiopatias: undefined,
            cancer: false,
            otros: "Abuela materna con cáncer de mama",
          },
          aparatosSistemas: {
            cardiovascular: "Sin alteraciones",
            respiratorio: "Sin alteraciones",
          },
        },
        notas: [
          nota({
            exploracionFisica: {
              habitus: "Íntegro, cooperador",
              cavidadOral: "Higiene regular",
            },
            pronostico: "Reservado",
          }),
        ],
      }),
    );
    assert.match(todo, /tipo 2 controlada/);
    assert.match(todo, /Abuela materna con c.ncer de mama/);
    assert.match(todo, /Sin alteraciones/);
    assert.match(todo, /.ntegro, cooperador/);
    assert.match(todo, /Reservado/);
    assert.match(todo, /Recepci.n Uno/);
  });

  it("distingue un «no» CONTESTADO de un dato que falta", async () => {
    // Es la mentira que este documento no puede contar: «Hipertensión: No»
    // dice que se preguntó; «No capturado» dice que no.
    assert.equal(siNo(false), "No");
    assert.equal(siNo(true), "Sí");
    assert.equal(siNo(undefined), NO_CAPTURADO);
    assert.equal(siNo(null), NO_CAPTURADO);
    assert.equal(siNo(""), NO_CAPTURADO);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7 · Los lectores puros de las dos columnas JSON
// ─────────────────────────────────────────────────────────────────────

describe("los lectores de las columnas JSON que comparten los dos trabajos", () => {
  it("devuelven null cuando la clave todavía no existe (el caso de hoy)", () => {
    assert.equal(leerHeredoFamiliares({}), null);
    assert.equal(leerHeredoFamiliares(null), null);
    assert.equal(leerAparatosSistemas({ otraCosa: 1 }), null);
    assert.equal(leerExploracionFisica(undefined), null);
    assert.equal(leerPronostico({}), null);
  });

  it("leen los nombres EXACTOS que fijó el gerente", () => {
    const hf = leerHeredoFamiliares({
      heredoFamiliares: { diabetes: true, hipertension: false, otros: "nada" },
    });
    assert.deepEqual(hf, {
      diabetes: true,
      hipertension: false,
      cardiopatias: undefined,
      cancer: undefined,
      otros: "nada",
    });

    const as = leerAparatosSistemas({ aparatosSistemas: { cardiovascular: "normal" } });
    assert.equal(as?.cardiovascular, "normal");
    assert.equal(as?.notas, undefined);

    const ef = leerExploracionFisica({ exploracionFisica: { atm: "sin chasquido" } });
    assert.equal(ef?.atm, "sin chasquido");
  });

  it("el pronóstico vacío es AUSENTE, no «bueno»", () => {
    assert.equal(leerPronostico({ pronostico: "" }), null);
    assert.equal(leerPronostico({ pronostico: "   " }), null);
    assert.equal(leerPronostico({ pronostico: "bueno" }), "Bueno");
    assert.equal(leerPronostico({ pronostico: "reservado" }), "Reservado");
    assert.equal(leerPronostico({ pronostico: "malo" }), "Malo");
    // Un valor fuera del catálogo se enseña tal cual: un dato raro no se esconde.
    assert.equal(leerPronostico({ pronostico: "incierto" }), "incierto");
    assert.equal(leerPronostico({ pronostico: 3 }), null);
  });

  it("un valor no booleano en heredo-familiares no se convierte a sí/no por accidente", () => {
    const hf = leerHeredoFamiliares({ heredoFamiliares: { diabetes: "sí" } });
    assert.equal(hf?.diabetes, undefined, "un string no puede pasar por un booleano");
    assert.equal(siNo(hf?.diabetes), NO_CAPTURADO);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8 · Ayudantes
// ─────────────────────────────────────────────────────────────────────

describe("los ayudantes del documento", () => {
  it("noCapturado nunca devuelve cadena vacía", () => {
    assert.equal(noCapturado(null), NO_CAPTURADO);
    assert.equal(noCapturado(undefined), NO_CAPTURADO);
    assert.equal(noCapturado(""), NO_CAPTURADO);
    assert.equal(noCapturado("   "), NO_CAPTURADO);
    assert.equal(noCapturado(" Ana "), "Ana");
  });

  it("pesoLegible dice kB y MB como los lee una persona", () => {
    assert.equal(pesoLegible(0), "0 kB");
    assert.equal(pesoLegible(-5), "0 kB");
    assert.equal(pesoLegible(2048), "2 kB");
    assert.equal(pesoLegible(1024 * 1024), "1,0 MB");
    assert.equal(pesoLegible(12 * 1024 * 1024 + 400 * 1024), "12,4 MB");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8b · Las firmas que no se pudieron traer
// ─────────────────────────────────────────────────────────────────────

describe("las imágenes de firma que no llegaron", () => {
  it("el documento lo DICE, para que una línea en blanco no parezca una carta sin firmar", async () => {
    const { todo } = await texto(
      props({
        firmasOmitidas: 2,
        consentimientos: [
          {
            procedimiento: "Extracción dental simple",
            creadoEl: "2026-03-04T15:40:00.000Z",
            firmadoEl: "2026-03-04T15:55:00.000Z",
            revocadoEl: null,
            motivoRevocacion: null,
            texto: "Autorizo el procedimiento descrito.",
            firmas: [
              { rol: "Paciente", nombre: "Ana López", firmadoEl: "2026-03-04T15:55:00.000Z", imagen: null },
            ],
            hashDelTexto: null,
          },
        ],
      }),
    );
    assert.match(todo, /2 im.genes de firma no se pudieron traer/);
    assert.match(todo, /NO significa que la carta no se firmara/);
  });

  it("sin firmas omitidas no aparece el aviso", async () => {
    const { todo } = await texto(props({ firmasOmitidas: 0 }));
    assert.doesNotMatch(todo, /im.genes de firma no se pudieron traer/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 9 · Notas privadas: se cuentan, no se esconden
// ─────────────────────────────────────────────────────────────────────

describe("las notas privadas de otro profesional", () => {
  it("no se imprimen, pero el documento dice cuántas quedaron fuera", async () => {
    const { todo } = await texto(props({ notas: [nota()], notasPrivadasOmitidas: 3 }));
    assert.match(todo, /3 notas marcadas como privadas/);
    assert.match(todo, /consta que existen/);
  });

  it("sin notas privadas no aparece el aviso", async () => {
    const { todo } = await texto(props({ notas: [nota()], notasPrivadasOmitidas: 0 }));
    assert.doesNotMatch(todo, /marcadas como privadas/);
  });
});
