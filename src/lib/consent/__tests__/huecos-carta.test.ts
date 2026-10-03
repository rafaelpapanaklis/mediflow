// ws1-t3 (auditoría BEVADENT F2): «La carta está completa» solo miraba las dos firmas.
// Ahora se revisa el TEXTO: espacios «____», marcadores sin rellenar e instrucciones internas,
// y mandar a firmar o firmar con eso pide confirmación (el servidor lo exige con un 409).
//
// Con el código viejo fallan: el módulo no existía, las rutas firmaban sin preguntar y la tira
// decía «completa» con huecos.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CODIGO_CARTA_CON_HUECOS,
  avisoDeCarta,
  cartaConPendientes,
  conPendientesDeCarta,
  faltaConfirmarCarta,
  revisarCarta,
} from "../huecos-carta";
import { CONSENT_TEMPLATES, buildConsentTemplateText, fillConsentTemplate } from "../templates";
import { textosHuecosCarta } from "@/components/dashboard/patient-detail/textos-huecos-carta";

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

describe("revisarCarta", () => {
  it("cuenta cada raya de 3 o más guiones bajos", () => {
    const r = revisarCarta("Diente: ______\nZona: ___ y ____\nNota: a_b");
    assert.equal(r.huecos, 3);
  });
  it("cuenta los marcadores [EN_MAYÚSCULAS] que nadie rellenó, no un [sic] ni un [1]", () => {
    const r = revisarCarta("Fecha de cirugía: [FECHA_CIRUGIA]\nDijo [sic] que sí [1].");
    assert.equal(r.huecos, 1);
  });
  it("encuentra las instrucciones internas de una plantilla", () => {
    const r = revisarCarta(
      [
        "CARTA DE CONSENTIMIENTO",
        "INSTRUCCIONES PARA EL DOCTOR: llene los datos y borre esta sección antes de imprimir.",
        "Indicaciones para el paciente: no comer en 2 horas.",
        "Para uso interno de la clínica",
        "Instrucciones de llenado",
      ].join("\n"),
    );
    assert.equal(r.instrucciones.length, 3, JSON.stringify(r.instrucciones));
    assert.ok(r.instrucciones[0]!.startsWith("INSTRUCCIONES PARA EL DOCTOR"));
  });
  it("las cartas del catálogo con todos los datos salen limpias; sin datos, con sus 6 rayas", () => {
    const base = { fullIdentification: true, clinicName: "Clínica QA", patientName: "Paciente Ficticio", doctorName: "Dra. Prueba" };
    const completos = {
      ...base, clinicAddress: "Calle 1", clinicCity: "CDMX", patientAge: 30, patientNumber: "12",
      patientCurp: "AAAA000000HDFRRN09", doctorLicense: "123", doctorSpecialtyLicense: "456", doctorSpecialty: "Ortodoncia",
    };
    for (const p of CONSENT_TEMPLATES) {
      const plantilla = buildConsentTemplateText(p.key);
      const limpia = revisarCarta(fillConsentTemplate(plantilla, completos));
      assert.deepEqual(limpia, { huecos: 0, instrucciones: [] }, p.key);
      const conRayas = revisarCarta(fillConsentTemplate(plantilla, base));
      assert.equal(conRayas.huecos, 6, p.key);
      assert.equal(conRayas.instrucciones.length, 0, p.key);
    }
  });
});

describe("el aviso", () => {
  it("dice cuántos espacios quedan sin llenar", () => {
    assert.equal(avisoDeCarta({ huecos: 3, instrucciones: [] }), "La carta no está completa: quedan 3 espacios sin llenar (____).");
    assert.match(avisoDeCarta({ huecos: 1, instrucciones: [] }), /queda 1 espacio sin llenar/);
    assert.match(avisoDeCarta({ huecos: 2, instrucciones: [] }, "en"), /2 blanks are still empty/);
    assert.equal(avisoDeCarta({ huecos: 0, instrucciones: [] }), "");
  });
  it("nunca dice «completa» con huecos, en ninguno de los textos", () => {
    const r = { huecos: 2, instrucciones: ["Instrucciones internas"] };
    for (const locale of ["es", "en"]) {
      const tx = textosHuecosCarta(locale);
      for (const frase of [tx.tiraFirmada(r), tx.tiraPendiente(r), tx.editor(r), tx.crear(r), tx.mandar(r), tx.contrafirmar(r)]) {
        assert.doesNotMatch(frase, /(?<!no )está completa|(?<!not )is complete\b/, frase);
        assert.match(frase, locale === "es" ? /2 espacios sin llenar/ : /2 blanks/, frase);
      }
    }
  });
});

describe("confirmación en el servidor", () => {
  it("sin pendientes no pide nada; con pendientes, 409 hasta que se confirme", () => {
    assert.equal(faltaConfirmarCarta("Todo lleno", undefined), null);
    const falta = faltaConfirmarCarta("CURP: ______", undefined);
    assert.equal(falta?.code, CODIGO_CARTA_CON_HUECOS);
    assert.equal(falta?.revision.huecos, 1);
    assert.match(falta!.error, /queda 1 espacio sin llenar/);
    assert.notEqual(faltaConfirmarCarta("CURP: ______", "true"), null, "solo el booleano true confirma");
    assert.equal(faltaConfirmarCarta("CURP: ______", true), null);
  });
  it("Movimientos dice que se firmó con pendientes", () => {
    assert.equal(conPendientesDeCarta("Firmó", "sin huecos"), "Firmó");
    assert.equal(conPendientesDeCarta("Firmó", "a ___ b ___"), "Firmó (con 2 espacios sin llenar, confirmado antes de firmar)");
  });
  it("cartaConPendientes", () => {
    assert.equal(cartaConPendientes({ huecos: 0, instrucciones: [] }), false);
    assert.equal(cartaConPendientes({ huecos: 0, instrucciones: ["x"] }), true);
  });

  const ANTES_DE: Array<[string, string, RegExp]> = [
    ["la firma del paciente", "src/app/api/consent/public/[token]/route.ts", /uploadSignature\(/],
    ["la contrafirma del doctor", "src/app/api/consent/[id]/countersign/route.ts", /uploadSignature\(/],
    ["mandar a firmar por WhatsApp", "src/app/api/consent/[id]/send-whatsapp/route.ts", /sendWhatsAppLogged\(\{/],
  ];
  for (const [nombre, ruta, despues] of ANTES_DE) {
    it(`${nombre} pregunta ANTES de guardar o mandar nada`, () => {
      const src = leer(ruta);
      const i = src.indexOf("faltaConfirmarCarta(form.content");
      assert.ok(i > 0, `${ruta} no revisa la carta`);
      const j = src.search(despues);
      assert.ok(j > i, `${ruta}: la revisión va antes de ${despues}`);
    });
  }
});

describe("las pantallas", () => {
  it("la tira de firmas no dice «completa» con pendientes", () => {
    const src = leer("src/components/dashboard/patient-detail/consent-documento.tsx");
    assert.match(src, /: conPendientes \? null\s*: t\("consentDoc\.strip\.hintComplete"\)/);
  });
  it("el editor confirma antes de crear, y la lista y la contrafirma reintentan confirmando", () => {
    assert.match(leer("src/components/dashboard/patient-detail/consent-editor.tsx"), /txHuecos\.crear\(revision\)/);
    const tab = leer("src/components/dashboard/patient-detail/consents-tab.tsx");
    assert.match(tab, /txHuecos\.mandar\(r\)/);
    assert.match(tab, /txHuecos\.contrafirmar\(/);
  });
  it("la página del paciente pide la segunda casilla", () => {
    const src = leer("src/app/consentimiento/[token]/page.tsx");
    assert.match(src, /confirmarHuecos: true/);
    assert.match(src, /quiero firmarla así/);
  });
});
