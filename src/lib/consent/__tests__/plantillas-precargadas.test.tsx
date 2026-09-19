/**
 * CONSENTIMIENTO INFORMADO DESDE PLANTILLAS — y las cartas viejas, intactas.
 *
 * Run: npm run test:consent-plantillas
 *
 * Rafael quitó la pestaña «Consentimientos» de los documentos y la quiere en lo
 * clínico, creando desde plantillas precargadas que la clínica edita. Lo que
 * aquí se fija es lo que ese cambio NO puede romper:
 *   · un consentimiento firmado con el sistema VIEJO sigue en la lista y se abre
 *     igual que se firmó (son documentos legales: NOM-004, 5 años);
 *   · sembrar dos veces no duplica ni pisa una plantilla que la clínica editó;
 *   · en «Nuevo consentimiento» salen SOLO las de kind CONSENTIMIENTO de ESA
 *     clínica;
 *   · la pestaña vieja ya no está con los documentos, y su permiso sigue
 *     mandando sobre la nueva.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToBuffer } from "@react-pdf/renderer";
import { CONSENT_TEMPLATES, buildConsentContent, buildConsentTemplateText, fillConsentTemplate } from "../templates";
import { consentHtmlToText, consentTextToHtml } from "../template-html";
import { consentSeedTemplates, ensureConsentTemplates } from "../seed-templates";
import {
  listClinicConsentTemplates,
  resolveClinicConsentTemplate,
  type ClinicTemplatesDb,
} from "../clinic-templates";
import { toConsentDTO } from "../types";
import { buildSignatureBlocks } from "../signers";
import { parseConsentText } from "../render";
import { ConsentDocument } from "@/lib/pdf/consent-document";
import { textoVisiblePorPagina } from "@/lib/pdf/__tests__/_texto-del-pdf";
import { buildPatientNavItems } from "@/components/dashboard/patient-detail/patient-nav-items";
import { construirMenuFicha } from "@/components/dashboard/pacientes-rediseno/menu-estructura";

// ── Base de mentira: aplica el `where` DE VERDAD, que es lo que se prueba ────
interface Row {
  id: string; clinicId: string; kind: string; name: string; body: string;
  isActive: boolean; deletedAt: Date | null;
}

function fakeDb(rows: Row[] = []) {
  let seq = rows.length;
  const matches = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v);
  const db = {
    rows,
    documentTemplate: {
      async count({ where }: { where: Record<string, unknown> }) {
        return rows.filter((r) => matches(r, where)).length;
      },
      async createMany({ data, skipDuplicates }: { data: Array<Omit<Row, "id" | "isActive" | "deletedAt">>; skipDuplicates: boolean }) {
        let count = 0;
        for (const d of data) {
          // El @@unique([clinicId, kind, name]) de la tabla.
          const dup = rows.some((r) => r.clinicId === d.clinicId && r.kind === d.kind && r.name === d.name);
          if (dup) { if (skipDuplicates) continue; throw new Error("unique"); }
          rows.push({ ...d, id: `tpl_${++seq}`, isActive: true, deletedAt: null });
          count++;
        }
        return { count };
      },
      async findMany({ where }: { where: Record<string, unknown> }) {
        return rows
          .filter((r) => matches(r, where))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(({ id, name }) => ({ id, name }));
      },
      async findFirst({ where }: { where: Record<string, unknown> }) {
        const r = rows.find((x) => matches(x, where));
        return r ? { name: r.name, body: r.body } : null;
      },
    },
  };
  return db as typeof db & ClinicTemplatesDb;
}

const VARS = {
  fullIdentification: true,
  clinicName: "Clínica Demo",
  clinicAddress: "Av. Reforma 100",
  clinicCity: "Ciudad de México",
  timezone: "America/Mexico_City",
  date: "18 de septiembre de 2026",
  patientName: "Ana López",
  patientAge: 34,
  patientNumber: "P-0042",
  patientCurp: "LOAA900101MDFPNN09",
  doctorName: "Dra. Marta Ruiz",
  doctorLicense: "1234567",
  doctorSpecialty: "Endodoncia",
};

describe("un consentimiento firmado con el sistema VIEJO", () => {
  // Tal como lo guardó el generador anterior: catálogo fijo, sin CURP, con
  // «Número de expediente» y la dirección pegada al nombre.
  const { fullIdentification: _omit, ...legacyVars } = VARS;
  const LEGACY_CONTENT = buildConsentContent("extraccion-simple", legacyVars);
  const signedAt = new Date("2026-08-13T23:43:00Z");

  it("sigue apareciendo en la lista, como FIRMADO y con su acto", () => {
    const dto = toConsentDTO({
      id: "cf_1", patientId: "p_1", procedure: "Extracción dental simple",
      procedureKey: "extraccion-simple", doctorId: "u_1", token: "tok",
      signerName: null, signerRelation: null,
      createdAt: new Date("2026-08-13T23:40:00Z"), expiresAt: new Date("2026-08-20T23:40:00Z"),
      viewedAt: null, sentAt: null, signedAt, signatureUrl: "consents/cf_1/patient.png",
      doctorSignedAt: null, doctorSignatureUrl: null,
      witness1Name: null, witness1SignedAt: null, witness2Name: null, witness2SignedAt: null,
      revokedAt: null, revokedReason: null,
    } as unknown as Parameters<typeof toConsentDTO>[0], new Date("2026-09-19T12:00:00Z"));
    assert.equal(dto.status, "SIGNED");
    assert.equal(dto.procedure, "Extracción dental simple");
    assert.equal(dto.signedAt, signedAt.toISOString());
  });

  it("se abre igual que se firmó: el PDF imprime SU texto, no uno regenerado", async () => {
    const pdf = await renderToBuffer(
      <ConsentDocument
        clinicName="Clínica Demo" clinicAddress="Av. Reforma 100" clinicCity="Ciudad de México"
        clinicPhone={null} clinicEmail={null} logoDataUrl={null}
        procedure="Extracción dental simple" place="Ciudad de México"
        issuedAt="2026-08-13T23:40:00Z" timeZone="America/Mexico_City"
        patientName="Ana López" patientNumber="P-0042" patientCurp={null}
        signerName={null} signerRelation={null}
        doctorName="Dra. Marta Ruiz" doctorLicense="1234567"
        doctorSpecialtyLicense={null} doctorSpecialty={null}
        content={LEGACY_CONTENT}
        signatures={buildSignatureBlocks({
          patientName: "Ana López", signerName: null, signerRelation: null,
          doctorName: "Dra. Marta Ruiz", signedAt, doctorSignedAt: null,
          witness1Name: null, witness1SignedAt: null, witness2Name: null, witness2SignedAt: null,
          patientSig: null, doctorSig: null, witness1Sig: null, witness2Sig: null,
        })}
        contentHash="abc123" signedIp="187.1.2.3" signedUserAgent="Safari iPad"
        signedAt={signedAt.toISOString()} revokedAt={null} revokedReason={null}
      />,
    );
    const texto = textoVisiblePorPagina(pdf).join(" ");
    assert.match(texto, /Establecimiento: Clínica Demo, Av\. Reforma 100, Ciudad de México/);
    assert.match(texto, /Número de expediente: P-0042/);
    assert.match(texto, /firmado electrónicamente/i);
    assert.match(texto, /SHA-256\): abc123/);
  });
});

describe("plantillas precargadas", () => {
  it("son las del catálogo, con el MISMO texto: HTML → texto es una ida y vuelta exacta", () => {
    const seeds = consentSeedTemplates();
    assert.deepEqual(seeds.map((s) => s.name), CONSENT_TEMPLATES.map((p) => p.label));
    for (const seed of seeds) {
      assert.equal(consentHtmlToText(seed.body), buildConsentTemplateText(seed.key), seed.key);
      assert.doesNotMatch(seed.body, /<script|<style|on\w+=/i);
    }
  });

  it("una plantilla llenada dice lo mismo que la carta del catálogo", () => {
    const viaTemplate = fillConsentTemplate(buildConsentTemplateText("resina"), VARS);
    const viaCatalog = buildConsentContent("resina", VARS);
    const secciones = (t: string) => parseConsentText(t).sections;
    // Las secciones clínicas (3 a 11) son idénticas palabra por palabra.
    assert.deepEqual(secciones(viaTemplate).slice(2, 11), secciones(viaCatalog).slice(2, 11));
    assert.match(viaTemplate, /^CURP: LOAA900101MDFPNN09$/m);
    assert.match(viaTemplate, /^ID del paciente: P-0042$/m);
    // Sin cédula de especialidad ni representante, esos renglones NO salen.
    assert.doesNotMatch(viaTemplate, /Cédula de especialidad|Representante legal que firma|Parentesco/);
    assert.doesNotMatch(viaTemplate, /\[[A-Z_]+\]|undefined|null/);
  });

  it("con representante y cédula de especialidad, sus renglones sí salen", () => {
    const carta = fillConsentTemplate(buildConsentTemplateText("resina"), {
      ...VARS, doctorSpecialtyLicense: "7654321", signerName: "Luis López", signerRelation: "padre",
    });
    assert.match(carta, /^Cédula de especialidad: 7654321$/m);
    assert.match(carta, /^Representante legal que firma en su nombre: Luis López$/m);
    assert.match(carta, /^Parentesco o relación con el paciente: padre$/m);
  });

  it("un marcador opcional en MITAD de un párrafo no se lleva el párrafo por delante", () => {
    const carta = fillConsentTemplate(
      "11. DECLARACIÓN\nDeclaro, por mí o por [NOMBRE_REPRESENTANTE], que se me explicó todo. Acepto el procedimiento.\nRepresentante: [NOMBRE_REPRESENTANTE]",
      VARS,
    );
    assert.match(carta, /Acepto el procedimiento\./);
    assert.doesNotMatch(carta, /^Representante:/m);
  });

  it("las viñetas de un editor tipo TipTap (<li><p>…</p></li>) no se quedan huérfanas", () => {
    assert.equal(
      consentHtmlToText("<p>Riesgos:</p><ul><li><p>Dolor pasajero.</p></li><li><p>Sangrado leve.</p></li></ul><p>Fin.</p>"),
      "Riesgos:\n• Dolor pasajero.\n• Sangrado leve.\nFin.",
    );
  });

  it("lo que la clínica escriba en su editor llega como texto, sin etiquetas ni scripts", () => {
    const text = consentHtmlToText(
      '<h1>CARTA</h1><div><p>Paciente:&nbsp;<strong>[NOMBRE_PACIENTE]</strong> &amp; tutor</p>' +
      "<script>alert(1)</script><ol><li>Uno</li><li>Dos</li></ol></div>",
    );
    assert.equal(text, "CARTA\n\nPaciente: [NOMBRE_PACIENTE] & tutor\n• Uno\n• Dos");
    assert.equal(consentHtmlToText(consentTextToHtml("a < b & c")), "a < b & c");
  });
});

describe("sembrar dos veces", () => {
  it("no duplica: la segunda vez no crea nada", async () => {
    const db = fakeDb();
    assert.equal(await ensureConsentTemplates("clinic_a", db), CONSENT_TEMPLATES.length);
    assert.equal(await ensureConsentTemplates("clinic_a", db), 0);
    assert.equal(db.rows.length, CONSENT_TEMPLATES.length);
  });

  it("no pisa una plantilla que la clínica ya editó", async () => {
    const db = fakeDb();
    await ensureConsentTemplates("clinic_a", db);
    const edited = db.rows.find((r) => r.name === "Extracción dental simple")!;
    edited.body = "<p>Texto propio de la clínica</p>";
    await ensureConsentTemplates("clinic_a", db);
    assert.equal(edited.body, "<p>Texto propio de la clínica</p>");
    assert.equal(db.rows.filter((r) => r.name === "Extracción dental simple").length, 1);
  });

  it("no resucita las que la clínica borró ni la que renombró", async () => {
    const db = fakeDb();
    await ensureConsentTemplates("clinic_a", db);
    for (const r of db.rows) r.deletedAt = new Date();
    db.rows[0]!.name = "Mi extracción";
    assert.equal(await ensureConsentTemplates("clinic_a", db), 0);
    assert.equal(db.rows.length, CONSENT_TEMPLATES.length);
  });

  it("cada clínica recibe las suyas, y sin clinicId no se toca nada", async () => {
    const db = fakeDb();
    await ensureConsentTemplates("clinic_a", db);
    assert.equal(await ensureConsentTemplates("clinic_b", db), CONSENT_TEMPLATES.length);
    assert.equal(await ensureConsentTemplates("", db), 0);
    assert.equal(db.rows.length, CONSENT_TEMPLATES.length * 2);
  });
});

describe("«Nuevo consentimiento»: SOLO las de kind CONSENTIMIENTO de ESA clínica", () => {
  const row = (over: Partial<Row>): Row => ({
    id: "x", clinicId: "clinic_a", kind: "CONSENTIMIENTO", name: "x", body: "<p>x</p>",
    isActive: true, deletedAt: null, ...over,
  });
  const rows = () => [
    row({ id: "ok_1", name: "Endodoncia propia", body: "<h1>CARTA</h1><p>Hola [NOMBRE_PACIENTE]</p>" }),
    row({ id: "nota", name: "Nota de evolución general", kind: "NOTA_EVOLUCION" }),
    row({ id: "ajena", name: "Implante de otra clínica", clinicId: "clinic_b" }),
    row({ id: "inactiva", name: "Inactiva", isActive: false }),
    row({ id: "borrada", name: "Borrada", deletedAt: new Date() }),
  ];

  it("la lista trae la suya y nada más", async () => {
    const out = await listClinicConsentTemplates("clinic_a", fakeDb(rows()));
    assert.deepEqual(out, { templates: [{ id: "ok_1", name: "Endodoncia propia" }], fallback: false });
  });

  it("por id tampoco se cuela una nota, una ajena, una inactiva ni una borrada", async () => {
    const db = fakeDb(rows());
    for (const id of ["nota", "ajena", "inactiva", "borrada", "no-existe"]) {
      assert.equal(await resolveClinicConsentTemplate("clinic_a", id, db), null, id);
    }
    assert.deepEqual(await resolveClinicConsentTemplate("clinic_a", "ok_1", db), {
      name: "Endodoncia propia", text: "CARTA\n\nHola [NOMBRE_PACIENTE]", procedureKey: null,
    });
  });

  it("sin clinicId no se consulta (clinicId: undefined no filtra nada en Prisma)", async () => {
    const db = fakeDb(rows());
    assert.deepEqual(await listClinicConsentTemplates("", db), { templates: [], fallback: false });
    assert.equal(await resolveClinicConsentTemplate("", "ok_1", db), null);
  });

  it("si la tabla no responde, ofrece el catálogo del código y no revienta", async () => {
    const roto = { documentTemplate: { count: async () => { throw new Error("relation does not exist"); } } };
    const out = await listClinicConsentTemplates("clinic_a", roto as unknown as ClinicTemplatesDb);
    assert.equal(out.fallback, true);
    assert.deepEqual(out.templates.map((t) => t.name), CONSENT_TEMPLATES.map((p) => p.label));
    const uno = await resolveClinicConsentTemplate("clinic_a", out.templates[0]!.id, roto as unknown as ClinicTemplatesDb);
    assert.equal(uno?.procedureKey, CONSENT_TEMPLATES[0]!.key);
  });

  it("con la tabla viva, un id `catalogo:` escrito a mano NO salta lo que la clínica desactivó", async () => {
    const db = fakeDb(rows());
    assert.equal(await resolveClinicConsentTemplate("clinic_a", "catalogo:extraccion-simple", db), null);
  });

  it("con la tabla caída, un id real da «no existe», no una excepción", async () => {
    const roto = { documentTemplate: {
      count: async () => { throw new Error("down"); },
      findFirst: async () => { throw new Error("down"); },
    } };
    assert.equal(await resolveClinicConsentTemplate("clinic_a", "tpl_real", roto as unknown as ClinicTemplatesDb), null);
  });
});

describe("el menú de la ficha", () => {
  const TODO = {
    pediatrics: { state: "hidden" as const },
    showPeriodontics: false, showEndodontics: false, showImplants: true, showOrthodontics: false,
    showBilling: true, showConsents: true, showXrays: true, showPrescriptions: true,
  };

  it("la pestaña vieja ya no está con los documentos: va en CLÍNICO, una sola vez", () => {
    const items = buildPatientNavItems(TODO).filter((i) => i.id === "consentimientos");
    assert.equal(items.length, 1);
    assert.equal(items[0]!.section, "clinico");
    assert.equal(items[0]!.labelKey, "patients.tabs.consentimientos");
    assert.ok(!buildPatientNavItems(TODO).some((i) => i.section === "imagen-docs" && /consent/i.test(i.id)));
  });

  it("en el menú rediseñado cae en «Clínico», no en «Más»", () => {
    const menu = construirMenuFicha(buildPatientNavItems(TODO));
    const clinico = menu.grupos.find((g) => g.id === "clinico")!;
    assert.ok(clinico.items.some((i) => i.id === "consentimientos"));
    assert.ok(!menu.grupos.some((g) => g.id === "mas"));
  });

  it("su permiso sigue mandando: sin consents.view no sale en ningún menú", () => {
    const items = buildPatientNavItems({ ...TODO, showConsents: false });
    assert.ok(!items.some((i) => i.id === "consentimientos"));
    const menu = construirMenuFicha(items);
    assert.ok(!menu.grupos.some((g) => g.items.some((i) => i.id === "consentimientos")));
  });
});
