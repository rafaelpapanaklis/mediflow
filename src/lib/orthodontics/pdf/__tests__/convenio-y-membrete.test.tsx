/**
 * CONVENIO DE PAGO Y MEMBRETE COMÚN DE LOS PDF DE ORTODONCIA (ws1-t4).
 *
 * Run: npm run test:orto-pdf
 *
 * Lo que vio Rafael: «Imprimir convenio» abría un about:blank con HTML plano,
 * sin logo, sin clínica, sin doctor y con fechas sin año («23-sep»); y el PDF
 * del plan de tratamiento tampoco traía logo, dirección ni fecha. Aquí se
 * prueba sobre el PDF DE VERDAD (`renderToBuffer` + el texto que queda
 * pintado dentro de la hoja), no sobre el árbol de React:
 *   · los datos que salen (clínica, folio, paciente, responsable, doctor con
 *     cédula, resumen, calendario, condiciones, firmas, «Página N de M»);
 *   · fechas dd/mm/aaaa CON AÑO en la zona de la clínica;
 *   · sin logo no rompe, con logo lo pinta;
 *   · modo «Pago por control»: precio por control en vez de mensualidades;
 *   · las condiciones: el ejemplo, las de la clínica y el blanco a propósito;
 *   · los otros PDF del módulo llevan el mismo membrete y pie.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToBuffer } from "@react-pdf/renderer";
import { textoVisiblePorPagina } from "@/lib/pdf/__tests__/_texto-del-pdf";
import { makePng } from "@/lib/pdf/__tests__/_imagenes-de-prueba";
import type { CuotaConEstado } from "@/lib/invoices/plan-de-pagos";
import { configDeCobroPorDefecto } from "@/lib/orthodontics/cobro/reglas";
import { CONDICIONES_CONVENIO_EJEMPLO, SIN_CONDICIONES_CONVENIO, condicionesParaImprimir } from "@/lib/orthodontics/cobro/condiciones-convenio";
import { FinancialAgreementPdf } from "../../pdf-templates/financial-agreement";
import { TreatmentPlanPdf } from "../../pdf-templates/treatment-plan";
import { DischargeLetterPdf } from "../../pdf-templates/discharge-letter";
import { ReferralProgressLetterPdf } from "../../pdf-templates/referral-progress-letter";
import { ProgressReportPdf } from "../../pdf-templates/progress-report";
import { ComparisonPdf } from "../../pdf-templates/comparison-pdf";
import { armarConvenio, diaDePago, folioDelConvenio, type EntradaConvenio } from "../convenio";
import { fechaDMA, edadEnAnios, especialidadDelDoctor } from "../formato";
import { motivoParaNoEmitirCartaDeAvance, casoConFaseActivaTerminada } from "../reglas-de-emision";
import { techniqueLabel } from "../../consent-texts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatosDelMembreteOrto } from "../membrete-orto";
import { nombreDeArchivoPdf } from "../nombre-de-archivo";

// ── Datos de ejemplo ───────────────────────────────────────────────────

const LOGO = `data:image/png;base64,${makePng(240, 80).toString("base64")}`;

function membrete(extra: Partial<DatosDelMembreteOrto> = {}): DatosDelMembreteOrto {
  return {
    clinicName: "Clínica Sonrisa Norte",
    clinicAddress: "Av. Juárez 123, Col. Centro",
    clinicCity: "Guadalajara",
    clinicState: "Jalisco",
    clinicPhone: "33 1234 5678",
    clinicEmail: "hola@sonrisanorte.mx",
    clinicTaxId: "SNO010101AB1",
    clinicLogoDataUrl: LOGO,
    clinicLogoAspect: 3,
    zonaHoraria: "America/Mexico_City",
    // 29/09/2026 02:33 en México (08:33 UTC).
    emitidoEl: "2026-09-29T08:33:00.000Z",
    lugar: "Guadalajara, Jalisco",
    paciente: { nombre: "Diego Hernández", fechaNacimiento: "2012-05-14T00:00:00.000Z", folio: "P-0042" },
    doctor: { nombre: "Ana Ruiz", cedula: "7654321", cedulaEspecialidad: "1122334", especialidad: "Ortodoncia" },
    ...extra,
  };
}

function cuota(numero: number, importe: number, vencimiento: string, estado: CuotaConEstado["estado"], abonado = 0): CuotaConEstado {
  return {
    numero,
    esEnganche: numero === 0,
    importe,
    vencimiento,
    abonado: estado === "pagada" ? importe : abonado,
    falta: estado === "pagada" ? 0 : importe - abonado,
    estado,
  };
}

function entrada(extra: Partial<EntradaConvenio> = {}): EntradaConvenio {
  return {
    membrete: membrete(),
    treatmentPlanId: "cmcaso0000000000abcd1234",
    modo: "PRECIO_TOTAL",
    tecnica: "brackets metálicos",
    duracionMeses: 18,
    colocacion: "2026-09-23T16:00:00.000Z",
    factura: { numero: "F-0012", total: 35000, pagado: 12000, saldo: 23000 },
    condicionesPago: {
      modo: "plazos", metodo: null, enganche: 10000, numPagos: 10, frecuencia: "MONTHLY",
      primerPago: "2026-09-23", difiereConSuBanco: false,
    },
    cuotas: [
      cuota(0, 10000, "2026-09-23", "pagada"),
      cuota(1, 2500, "2026-08-23", "vencida", 2000),
      cuota(2, 2500, "2026-11-23", "porVencer"),
      cuota(3, 2500, "2027-01-23", "porVencer"),
    ],
    saldoAFavor: 0,
    precioPorControl: null,
    cargosDeControl: [],
    hoy: "2026-09-29",
    descuento: null,
    recargo: configDeCobroPorDefecto().lateFee,
    reposicionesIncluidas: 2,
    responsable: {
      esElPaciente: false, nombre: "María Hernández López", relacion: "Madre",
      telefono: "33 9999 0000", correo: "maria@correo.mx", direccion: "Calle Luna 45, Zapopan",
      rfc: "HELM800101AB1", razonSocial: "MARIA HERNANDEZ LOPEZ", regimenFiscal: "612", cp: "45000",
    },
    condicionesGuardadas: null,
    ...extra,
  };
}

/**
 * El texto pintado DENTRO de la hoja, en minúsculas: los rótulos van con
 * `textTransform: uppercase` y en el archivo quedan en mayúsculas.
 */
async function textoDelPdf(
  el: Parameters<typeof renderToBuffer>[0],
  horizontal = false,
): Promise<{ paginas: string[]; todo: string; tiene: (s: string) => boolean }> {
  const buf = await renderToBuffer(el);
  assert.ok(buf.subarray(0, 5).toString("latin1") === "%PDF-", "sale un PDF de verdad");
  const paginas = horizontal ? textoVisiblePorPagina(buf, 792, 612) : textoVisiblePorPagina(buf);
  const todo = paginas.join(" \n ");
  const bajo = todo.toLocaleLowerCase("es-MX");
  return { paginas, todo, tiene: (s) => bajo.includes(s.toLocaleLowerCase("es-MX")) };
}

// ── Formato ────────────────────────────────────────────────────────────

describe("fechas dd/mm/aaaa con año", () => {
  it("un día de calendario sale tal cual, sin correrse", () => {
    assert.equal(fechaDMA("2026-09-23"), "23/09/2026");
  });
  it("un instante se lee en la zona de la clínica (no la del servidor)", () => {
    // 30/09 03:00 UTC = 29/09 21:00 en México.
    assert.equal(fechaDMA("2026-09-30T03:00:00.000Z", "America/Mexico_City"), "29/09/2026");
  });
  it("sin fecha, raya; nunca «Invalid Date»", () => {
    assert.equal(fechaDMA(null), "—");
    assert.equal(fechaDMA("no es fecha"), "—");
  });
  it("edad cumplida", () => {
    assert.equal(edadEnAnios("2012-05-14T00:00:00.000Z", new Date("2026-09-29T00:00:00Z")), 14);
    assert.equal(edadEnAnios("2012-10-14T00:00:00.000Z", new Date("2026-09-29T00:00:00Z")), 13);
  });
  it("nombre de archivo legible y sin acentos", () => {
    assert.equal(nombreDeArchivoPdf("convenio-de-pago", "Diego Hernández", "CONV-F-0012"), "convenio-de-pago-diego-hernandez-CONV-F-0012.pdf");
  });
});

// ── Convenio: los datos ────────────────────────────────────────────────

describe("armarConvenio — precio total a plazos", () => {
  const c = armarConvenio(entrada());

  it("folio de la factura; sin factura, uno estable del caso", () => {
    assert.equal(c.folio, "CONV-F-0012");
    assert.equal(folioDelConvenio(null, "cmcaso0000000000abcd1234"), "CONV-ABCD1234");
  });

  it("calendario con fechas CON AÑO y estado de cada pago", () => {
    assert.deepEqual(
      c.calendario.map((f) => [f.concepto, f.vence, f.estado]),
      [
        ["Enganche", "23/09/2026", "Pagado"],
        ["Pago 1 de 3", "23/08/2026", "Vencido · abonado $2,000"],
        ["Pago 2 de 3", "23/11/2026", "Por vencer"],
        ["Pago 3 de 3", "23/01/2027", "Por vencer"],
      ],
    );
  });

  it("resumen económico: total, enganche, pagos, monto, día de pago, pagado y saldo", () => {
    const r = Object.fromEntries(c.resumen.map((x) => [x.etiqueta, x.valor]));
    assert.equal(r["Costo total del tratamiento"], "$35,000");
    assert.equal(r["Enganche"], "$10,000");
    assert.equal(r["Número de pagos"], "3");
    assert.equal(r["Monto de cada pago"], "$2,500");
    assert.equal(r["Día de pago"], "Día 23 de cada mes");
    assert.equal(r["Pagado a la fecha"], "$12,000");
    assert.equal(r["Saldo pendiente"], "$23,000");
  });

  it("tratamiento: técnica, duración y colocación con año", () => {
    const t = Object.fromEntries(c.tratamiento.map((x) => [x.etiqueta, x.valor]));
    assert.equal(t["Técnica"], "brackets metálicos");
    assert.equal(t["Duración estimada"], "18 meses");
    assert.equal(t["Fecha de colocación"], "23/09/2026");
  });

  it("paciente menor → firma el responsable, con su parentesco", () => {
    assert.equal(c.pacienteEsMenor, true);
    assert.equal(c.firmas[0].rol, "Responsable del pago");
    assert.equal(c.firmas[0].nombre, "María Hernández López");
    assert.equal(c.firmas[1].nombre, "Ana Ruiz");
    assert.match(c.firmas[1].detalle ?? "", /7654321/);
    assert.equal(c.lugarYFecha, "Guadalajara, Jalisco, a 29/09/2026");
  });

  it("día de pago por frecuencia", () => {
    assert.equal(diaDePago(null), null);
    assert.equal(diaDePago({ ...entrada().condicionesPago!, frecuencia: "WEEKLY" }), "Cada semana");
  });
});

describe("armarConvenio — pago por control", () => {
  const c = armarConvenio(
    entrada({
      modo: "PAGO_POR_CONTROL",
      factura: { numero: "F-0020", total: 3000, pagado: 3000, saldo: 0 },
      condicionesPago: null,
      cuotas: [],
      precioPorControl: 650,
      cargosDeControl: [
        { folio: "F-0031", vencimiento: "2026-10-20", total: 650, pagado: 0 },
        { folio: "F-0025", vencimiento: "2026-08-20", total: 650, pagado: 650 },
        { folio: "F-0028", vencimiento: "2026-09-20", total: 650, pagado: 0 },
      ],
    }),
  );

  it("refleja el precio por control, no mensualidades", () => {
    const r = Object.fromEntries(c.resumen.map((x) => [x.etiqueta, x.valor]));
    assert.equal(r["Precio por control"], "$650");
    assert.equal(r["Controles facturados"], "3");
    assert.equal(r["Pagado a la fecha"], "$3,650");
    assert.equal(r["Saldo pendiente"], "$1,300");
    assert.equal(r["Enganche"], undefined);
    assert.equal(r["Número de pagos"], undefined);
    assert.equal(c.tratamiento.find((t) => t.etiqueta === "Forma de pago")?.valor, "Pago por control");
  });

  it("los controles en orden, con año y su estado", () => {
    assert.deepEqual(
      c.calendario.map((f) => [f.concepto, f.vence, f.estado]),
      [
        ["Colocación / enganche", "23/09/2026", "Pagado"],
        ["Control 1 · F-0025", "20/08/2026", "Pagado"],
        ["Control 2 · F-0028", "20/09/2026", "Vencido"],
        ["Control 3 · F-0031", "20/10/2026", "Por vencer"],
      ],
    );
  });
});

it("pago por control: la colocación sin pagar y con fecha pasada sale «Vencido», no «Por vencer»", () => {
  const c = armarConvenio(
    entrada({
      modo: "PAGO_POR_CONTROL",
      factura: { numero: "F-0020", total: 3000, pagado: 0, saldo: 3000 },
      condicionesPago: null,
      cuotas: [],
      precioPorControl: 650,
    }),
  );
  assert.deepEqual(c.calendario.map((f) => [f.concepto, f.vence, f.estado]), [["Colocación / enganche", "23/09/2026", "Vencido"]]);
});

describe("condiciones del convenio", () => {
  it("nunca editadas → el ejemplo de DaleControl, marcado como ejemplo", () => {
    const r = condicionesParaImprimir(null);
    assert.equal(r.esEjemplo, true);
    assert.equal(r.clausulas.length, CONDICIONES_CONVENIO_EJEMPLO.split("\n").length);
    // El ejemplo no inventa montos ni intereses.
    assert.doesNotMatch(CONDICIONES_CONVENIO_EJEMPLO, /\$|\d+\s*%|inter[eé]s/i);
  });
  it("las de la clínica, sin doble numeración", () => {
    const r = condicionesParaImprimir("1. Primera condición\n\n2) Segunda\n- Tercera");
    assert.deepEqual(r.clausulas, ["Primera condición", "Segunda", "Tercera"]);
    assert.equal(r.esEjemplo, false);
  });
  it("en blanco a propósito → una línea neutra, no el ejemplo", () => {
    assert.deepEqual(condicionesParaImprimir("   ").clausulas, [SIN_CONDICIONES_CONVENIO]);
  });
  it("el recargo sale solo si la política de cobro lo tiene activo, con sus números", () => {
    assert.deepEqual(armarConvenio(entrada()).politica, []);
    const c = armarConvenio(entrada({ recargo: { activo: true, tipo: "PCT", valor: 5, diasDeGracia: 3 } }));
    assert.deepEqual(c.politica, ["Recargo por atraso: 5% del pago atrasado después de 3 días de tolerancia, según la política de cobro de la clínica."]);
  });
});

// ── Convenio: el PDF de verdad ─────────────────────────────────────────

describe("FinancialAgreementPdf — el archivo", () => {
  it("lleva membrete, folio, fecha, paciente, responsable, doctor con cédula, calendario con año, condiciones, firmas y paginación", async () => {
    const { todo, paginas, tiene } = await textoDelPdf(<FinancialAgreementPdf data={armarConvenio(entrada())} />);
    for (const esperado of [
      "Clínica Sonrisa Norte",
      "Av. Juárez 123, Col. Centro",
      "Tel: 33 1234 5678",
      "RFC: SNO010101AB1",
      "Convenio de pago",
      "CONV-F-0012",
      "29/09/2026",
      "Diego Hernández",
      "14/05/2012",
      "María Hernández López",
      "HELM800101AB1",
      "Ana Ruiz",
      "7654321",
      "Ortodoncia",
      "brackets metálicos",
      "23/09/2026",
      "23/01/2027",
      "Vencido",
      "Por vencer",
      "Los pagos se realizan en las fechas pactadas",
      "Responsable del pago",
      "Por la clínica",
      `Página 1 de ${paginas.length}`,
    ]) {
      assert.ok(tiene(esperado), `falta «${esperado}» en el PDF`);
    }
    assert.ok(!todo.includes("about:blank"));
    assert.ok(!/\b\d{1,2}-(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\b/.test(todo), "ninguna fecha sin año");
  });

  it("sin logo no rompe: sale el nombre de la clínica en su sitio", async () => {
    const data = armarConvenio(entrada({ membrete: membrete({ clinicLogoDataUrl: null, clinicLogoAspect: null }) }));
    const { todo } = await textoDelPdf(<FinancialAgreementPdf data={data} />);
    assert.ok(todo.includes("Clínica Sonrisa Norte"));
    assert.ok(todo.includes("CONV-F-0012"));
  });

  it("sin doctor asignado lo dice, y firma la clínica", async () => {
    const data = armarConvenio(entrada({ membrete: membrete({ doctor: null }) }));
    const { todo } = await textoDelPdf(<FinancialAgreementPdf data={data} />);
    assert.ok(todo.includes("Sin doctor asignado"));
  });

  it("modo pago por control: el PDF dice el precio por control", async () => {
    const data = armarConvenio(
      entrada({
        modo: "PAGO_POR_CONTROL",
        condicionesPago: null,
        cuotas: [],
        precioPorControl: 650,
        cargosDeControl: [{ folio: "F-0031", vencimiento: "2026-10-20", total: 650, pagado: 0 }],
      }),
    );
    const { todo } = await textoDelPdf(<FinancialAgreementPdf data={data} />);
    assert.ok(todo.includes("Precio por control"));
    assert.ok(todo.includes("$650"));
    assert.ok(todo.includes("20/10/2026"));
    assert.ok(!todo.includes("Número de pagos"));
  });

  it("un calendario largo pagina y el pie sale en todas las hojas", async () => {
    const cuotas = [cuota(0, 5000, "2026-09-23", "pagada")];
    for (let i = 1; i <= 36; i++) {
      const mes = ((8 + i) % 12) + 1;
      const anio = 2026 + Math.floor((8 + i) / 12);
      cuotas.push(cuota(i, 1000, `${anio}-${String(mes).padStart(2, "0")}-23`, "porVencer"));
    }
    const { paginas } = await textoDelPdf(<FinancialAgreementPdf data={armarConvenio(entrada({ cuotas }))} />);
    assert.ok(paginas.length >= 2, "36 pagos no caben en una hoja");
    paginas.forEach((p, i) => assert.ok(p.includes(`Página ${i + 1} de ${paginas.length}`), `pie en la hoja ${i + 1}`));
  });
});

// ── Los otros PDF del módulo: el mismo membrete ────────────────────────

describe("membrete común en los PDF de ortodoncia", () => {
  const COMUNES = ["Clínica Sonrisa Norte", "Av. Juárez 123, Col. Centro", "Tel: 33 1234 5678", "Diego Hernández", "Ana Ruiz", "7654321", "29/09/2026", "Página 1 de"];
  const comprobar = (tiene: (s: string) => boolean, doc: string) => {
    for (const e of COMUNES) assert.ok(tiene(e), `${doc}: falta «${e}»`);
  };

  it("plan de tratamiento", async () => {
    const { todo, tiene } = await textoDelPdf(
      <TreatmentPlanPdf
        data={{
          treatmentPlanId: "c1",
          membrete: membrete(),
          patient: { firstName: "Diego", lastName: "Hernández", dob: null },
          clinic: { name: "Clínica Sonrisa Norte" },
          doctor: { firstName: "Ana", lastName: "Ruiz", cedulaProfesional: "7654321" },
          diagnosis: { angleClassRight: "II", angleClassLeft: "II", overbiteMm: "4", overjetMm: "5", clinicalSummary: "Clase II división 1." },
          plan: {
            technique: "METAL_BRACKETS", techniqueName: null, techniqueNotes: null, estimatedDurationMonths: 18,
            totalCostMxn: "35000", anchorageType: "MODERATE", extractionsRequired: false, extractionsTeethFdi: [],
            treatmentObjectives: "FULL_CORRECTION", retentionPlanText: "Retenedor fijo inferior.",
          },
          phases: [{ phaseKey: "ALIGNMENT", orderIndex: 0, status: "IN_PROGRESS" }],
          generatedAt: "2026-09-29T08:33:00.000Z",
        }}
      />,
    );
    comprobar(tiene, "Plan de tratamiento");
    assert.ok(todo.includes("$35,000 MXN"));
  });

  it("carta de alta", async () => {
    const { todo, tiene } = await textoDelPdf(
      <DischargeLetterPdf
        membrete={membrete()}
        techniqueLabel="brackets metálicos"
        startDate="2025-01-10T16:00:00.000Z"
        endDate="2026-09-01T16:00:00.000Z"
        durationMonths={19}
        retentionPlanText={null}
        revisiones={[{ meses: 3, fecha: "2026-12-01T16:00:00.000Z" }]}
      />,
    );
    comprobar(tiene, "Carta de alta");
    assert.ok(todo.includes("10/01/2025") && todo.includes("01/12/2026"));
  });

  it("carta de avance", async () => {
    const { todo, tiene } = await textoDelPdf(
      <ReferralProgressLetterPdf
        data={{
          stage: "inicio",
          membrete: membrete(),
          patient: { firstName: "Diego", lastName: "Hernández" },
          clinic: { name: "Clínica Sonrisa Norte", phone: null, email: null },
          treatingDoctor: { firstName: "Ana", lastName: "Ruiz", cedulaProfesional: "7654321" },
          referredByDoctor: { fullName: "Dr. Luis Pérez", clinicName: null },
          diagnosis: { angleClassRight: "CLASS_II", angleClassLeft: "CLASS_II", clinicalSummary: "" },
          plan: { technique: "METAL_BRACKETS", techniqueName: null, estimatedDurationMonths: 18, installedAt: null, retentionPlanText: "", status: "ACTIVE" },
          generatedAt: "2026-09-29T08:33:00.000Z",
        }}
      />,
    );
    comprobar(tiene, "Carta de avance");
  });

  it("reporte de progreso (sin fotos no rompe)", async () => {
    const { todo, tiene } = await textoDelPdf(
      <ProgressReportPdf
        data={{
          membrete: membrete(),
          patientName: "Diego Hernández",
          doctorName: "Ana Ruiz",
          clinicName: "Clínica Sonrisa Norte",
          durationMonthsActual: 12,
          techniqueLabel: "brackets metálicos",
          retentionPlanText: "Retenedor fijo.",
          beforeLabel: "T0 · 10/01/2025",
          afterLabel: "T2 · 01/09/2026",
          pairs: [],
          hasPhotoUseConsent: true,
        }}
      />,
      true,
    );
    comprobar(tiene, "Reporte de progreso");
  });

  it("antes y después", async () => {
    const { todo, tiene } = await textoDelPdf(
      <ComparisonPdf
        data={{
          membrete: membrete(),
          patientName: "Diego Hernández",
          patientDobIso: null,
          doctorName: "Ana Ruiz",
          doctorCedula: "7654321",
          clinicName: "Clínica Sonrisa Norte",
          techniqueLabel: "brackets metálicos",
          durationMonthsActual: 12,
          estimatedDurationMonths: 18,
          diagnosisSummary: "Clase II.",
          retentionPlanText: "Retenedor fijo.",
          initialSet: null,
          midSets: [],
          finalSet: null,
          generatedAtIso: "2026-09-29T08:33:00.000Z",
          hasPhotoUseConsent: true,
        }}
      />,
    );
    comprobar(tiene, "Antes y después");
  });
});

// ── Revisión en panel.108 (ws1-t9): 5e, 5d, 5j ─────────────────────────

describe("5e — la técnica en español en todos los PDF", () => {
  it("el nombre del tipo base es el del plan y el convenio, no el enum", () => {
    assert.equal(techniqueLabel("METAL_BRACKETS"), "brackets metálicos");
    assert.equal(techniqueLabel("METAL_BRACKETS", "QA Brackets de zafiro"), "QA Brackets de zafiro");
  });
  it("ni el comparativo ni el resumen de referencia pintan el enum en crudo", () => {
    const src = join(__dirname, "..", "..", "..", "..");
    for (const rel of ["app/actions/orthodontics/exportComparisonPdf.ts", "lib/clinical-shared/referral/summary-orthodontics.ts", "components/specialties/orthodontics/plan/TreatmentPlanView.tsx"]) {
      const f = readFileSync(join(src, rel), "utf8");
      assert.doesNotMatch(f, /technique\.replaceAll\("_", " "\)/, rel);
      assert.match(f, /techniqueLabel\(/, rel);
    }
  });
  it("el PDF de antes y después dice «brackets metálicos»", async () => {
    const { tiene } = await textoDelPdf(
      <ComparisonPdf
        data={{
          membrete: membrete(), patientName: "Diego Hernández", patientDobIso: null, doctorName: "Ana Ruiz", doctorCedula: null,
          clinicName: "Clínica Sonrisa Norte", techniqueLabel: techniqueLabel("METAL_BRACKETS"), durationMonthsActual: 3,
          estimatedDurationMonths: 18, diagnosisSummary: "", retentionPlanText: "", initialSet: null, midSets: [], finalSet: null,
          generatedAtIso: "2026-09-29T08:33:00.000Z", hasPhotoUseConsent: true,
        }}
      />,
    );
    assert.ok(tiene("brackets metálicos · duración estimada 18 meses"));
    assert.ok(!tiene("metal brackets"));
  });
});

describe("5d — la carta «de término» solo con el caso en retención o terminado", () => {
  it("en curso se niega con un mensaje claro; inicio siempre se puede", () => {
    for (const status of ["PLANNED", "IN_PROGRESS", "ON_HOLD", null]) {
      assert.match(motivoParaNoEmitirCartaDeAvance("termino", status) ?? "", /retención o terminado/);
      assert.equal(motivoParaNoEmitirCartaDeAvance("inicio", status), null);
    }
    assert.equal(motivoParaNoEmitirCartaDeAvance("termino", "RETENTION"), null);
    assert.equal(motivoParaNoEmitirCartaDeAvance("termino", "COMPLETED"), null);
    assert.equal(casoConFaseActivaTerminada("IN_PROGRESS"), false);
  });
  it("la action lo comprueba en el servidor, antes de armar la carta", () => {
    const f = readFileSync(join(__dirname, "..", "..", "..", "..", "app/actions/orthodontics/exportReferralProgressLetterPdf.ts"), "utf8");
    assert.match(f, /motivoParaNoEmitirCartaDeAvance\(parsed\.data\.stage, plan\.status\)/);
  });
});

describe("5j — especialidad del doctor en el membrete", () => {
  it("la oficial NOM-024 si existe; si no, la del selector de Equipo", () => {
    assert.equal(especialidadDelDoctor("Ortodoncia y Ortopedia Maxilar", "Ortodoncia"), "Ortodoncia y Ortopedia Maxilar");
    assert.equal(especialidadDelDoctor(null, "Ortodoncia"), "Ortodoncia");
    assert.equal(especialidadDelDoctor("  ", "Ortodoncia"), "Ortodoncia");
    assert.equal(especialidadDelDoctor(null, "Otra"), null);
    assert.equal(especialidadDelDoctor(null, null), null);
  });
});
