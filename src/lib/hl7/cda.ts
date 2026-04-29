/**
 * Generador de HL7 CDA Release 2 — export del expediente clínico.
 *
 * Sigue la estructura mínima requerida por NOM-024 sección 6.6:
 *  - ClinicalDocument header
 *  - recordTarget (paciente)
 *  - author (médico)
 *  - custodian (clínica)
 *  - structuredBody con secciones de antecedentes, diagnósticos, plan,
 *    recetas y exploración.
 *
 * NO usa una librería HL7 completa — construimos el XML directo con
 * xmlbuilder2. Suficiente para cumplir el formato de export.
 */

import { create } from "xmlbuilder2";

// OID raíz reservado para MediFlow (ejemplo). En producción registrar
// uno oficial con HL7 México.
const OID_MEDIFLOW_ROOT = "2.16.840.1.113883.3.7777.1";
const OID_MEDIFLOW_PATIENT = "2.16.840.1.113883.3.7777.1.1";
const OID_MEDIFLOW_CLINIC = "2.16.840.1.113883.3.7777.1.2";
const OID_CIE10 = "2.16.840.1.113883.6.3";
const OID_CUMS_MX = "2.16.840.1.113883.3.7777.2.1"; // local CUMS
const TEMPLATE_ID_NOM024 = "2.16.840.1.113883.3.7777.10.1";

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "00000000";
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "00000000000000";
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

interface BuildInput {
  documentId: string;
  effectiveTime: Date;
  clinic: {
    id: string;
    name: string;
    clues: string | null;
    address: string | null;
    phone: string | null;
  };
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    dob: Date | null;
    gender: string;
    curp: string | null;
    passportNo: string | null;
    address: string | null;
    familyHistory: string | null;
    personalNonPathologicalHistory: string | null;
    chronicConditions: string[];
    allergies: string[];
    currentMedications: string[];
  };
  doctor: {
    id: string;
    firstName: string;
    lastName: string;
    cedulaProfesional: string | null;
    especialidad: string | null;
  };
  records: Array<{
    id: string;
    visitDate: Date;
    subjective: string | null;
    objective: string | null;
    assessment: string | null;
    plan: string | null;
    diagnoses: Array<{ code: string; description: string }>;
  }>;
  prescriptions: Array<{
    id: string;
    issuedAt: Date;
    items: Array<{ cumsKey: string; descripcion: string; dosage: string }>;
  }>;
}

export function buildCdaXml(input: BuildInput): string {
  const doc = create({ version: "1.0", encoding: "UTF-8" })
    .ele("ClinicalDocument", {
      xmlns: "urn:hl7-org:v3",
      "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
      "xmlns:mediflow": "urn:mediflow:cda",
    });

  // ── Header ─────────────────────────────────────────────────────────
  doc.ele("realmCode",   { code: "MX" });
  doc.ele("typeId",      { root: "2.16.840.1.113883.1.3", extension: "POCD_HD000040" });
  doc.ele("templateId",  { root: TEMPLATE_ID_NOM024 });
  doc.ele("id",          { root: OID_MEDIFLOW_ROOT, extension: input.documentId });
  doc.ele("code",        {
    code: "11488-4", codeSystem: "2.16.840.1.113883.6.1",
    codeSystemName: "LOINC", displayName: "Consult note",
  });
  doc.ele("title").txt(`Expediente clínico — ${input.patient.firstName} ${input.patient.lastName}`);
  doc.ele("effectiveTime", { value: fmtDateTime(input.effectiveTime) });
  doc.ele("confidentialityCode", { code: "N", codeSystem: "2.16.840.1.113883.5.25" });
  doc.ele("languageCode", { code: "es-MX" });

  // ── recordTarget (paciente) ─────────────────────────────────────────
  const rt = doc.ele("recordTarget").ele("patientRole");
  if (input.patient.curp) {
    rt.ele("id", { root: "2.16.840.1.113883.3.7777.curp", extension: input.patient.curp });
  } else if (input.patient.passportNo) {
    rt.ele("id", { root: "2.16.840.1.113883.3.7777.passport", extension: input.patient.passportNo });
  } else {
    rt.ele("id", { root: OID_MEDIFLOW_PATIENT, extension: input.patient.id });
  }
  if (input.patient.address) {
    rt.ele("addr").txt(input.patient.address);
  }
  const patient = rt.ele("patient");
  patient.ele("name")
    .ele("given").txt(input.patient.firstName).up()
    .ele("family").txt(input.patient.lastName).up();
  const genderCode = input.patient.gender === "M" ? "M" : input.patient.gender === "F" ? "F" : "UN";
  patient.ele("administrativeGenderCode", {
    code: genderCode, codeSystem: "2.16.840.1.113883.5.1",
  });
  if (input.patient.dob) {
    patient.ele("birthTime", { value: fmtDate(input.patient.dob) });
  }

  // ── author (médico) ─────────────────────────────────────────────────
  const author = doc.ele("author");
  author.ele("time", { value: fmtDateTime(input.effectiveTime) });
  const aPerson = author.ele("assignedAuthor");
  aPerson.ele("id", {
    root: "2.16.840.1.113883.3.7777.cedula",
    extension: input.doctor.cedulaProfesional ?? input.doctor.id,
  });
  const aName = aPerson.ele("assignedPerson").ele("name");
  aName.ele("given").txt(input.doctor.firstName).up()
       .ele("family").txt(input.doctor.lastName).up();
  if (input.doctor.especialidad) {
    aPerson.ele("code").txt(input.doctor.especialidad);
  }

  // ── custodian (clínica) ─────────────────────────────────────────────
  const cust = doc.ele("custodian").ele("assignedCustodian").ele("representedCustodianOrganization");
  cust.ele("id", {
    root: "2.16.840.1.113883.3.7777.clues",
    extension: input.clinic.clues ?? input.clinic.id,
  });
  cust.ele("name").txt(input.clinic.name);
  if (input.clinic.phone) {
    cust.ele("telecom", { value: `tel:${input.clinic.phone}` });
  }
  if (input.clinic.address) {
    cust.ele("addr").txt(input.clinic.address);
  }

  // ── component / structuredBody ──────────────────────────────────────
  const body = doc.ele("component").ele("structuredBody");

  // Sección 1 — Antecedentes
  const antecedentes = body.ele("component").ele("section");
  antecedentes.ele("code", {
    code: "11369-6", codeSystem: "2.16.840.1.113883.6.1",
    displayName: "Historia personal",
  });
  antecedentes.ele("title").txt("Antecedentes");
  const antecedentesText: string[] = [];
  if (input.patient.familyHistory) antecedentesText.push(`Heredofamiliares: ${input.patient.familyHistory}`);
  if (input.patient.personalNonPathologicalHistory) antecedentesText.push(`Personales no patológicos: ${input.patient.personalNonPathologicalHistory}`);
  if (input.patient.chronicConditions.length) antecedentesText.push(`Enfermedades crónicas: ${input.patient.chronicConditions.join(", ")}`);
  if (input.patient.allergies.length) antecedentesText.push(`Alergias: ${input.patient.allergies.join(", ")}`);
  if (input.patient.currentMedications.length) antecedentesText.push(`Medicación actual: ${input.patient.currentMedications.join(", ")}`);
  antecedentes.ele("text").txt(antecedentesText.join("\n") || "Sin antecedentes registrados.");

  // Sección 2 — Notas / Padecimiento actual / Exploración / Plan
  for (const r of input.records) {
    const sec = body.ele("component").ele("section");
    sec.ele("code", { code: "11488-4", codeSystem: "2.16.840.1.113883.6.1", displayName: "Consult note" });
    sec.ele("title").txt(`Consulta ${r.visitDate.toLocaleDateString("es-MX")}`);
    const noteText: string[] = [];
    if (r.subjective) noteText.push(`Padecimiento: ${r.subjective}`);
    if (r.objective)  noteText.push(`Exploración: ${r.objective}`);
    if (r.assessment) noteText.push(`Diagnóstico: ${r.assessment}`);
    if (r.plan)       noteText.push(`Plan: ${r.plan}`);
    sec.ele("text").txt(noteText.join("\n") || "Sin contenido clínico.");

    // Diagnósticos estructurados (CIE-10)
    if (r.diagnoses.length) {
      const dxEntry = sec.ele("entry");
      const obs = dxEntry.ele("observation", { classCode: "OBS", moodCode: "EVN" });
      for (const dx of r.diagnoses) {
        obs.ele("value", {
          "xsi:type": "CD",
          code: dx.code, codeSystem: OID_CIE10,
          codeSystemName: "ICD-10",
          displayName: dx.description,
        });
      }
    }
  }

  // Sección 3 — Recetas / Medicaciones
  if (input.prescriptions.length) {
    const sec = body.ele("component").ele("section");
    sec.ele("code", { code: "10160-0", codeSystem: "2.16.840.1.113883.6.1", displayName: "Medications" });
    sec.ele("title").txt("Recetas / Medicación prescrita");
    const lines: string[] = [];
    for (const rx of input.prescriptions) {
      lines.push(`Receta ${rx.id} (${rx.issuedAt.toLocaleDateString("es-MX")}):`);
      for (const it of rx.items) {
        lines.push(`  - ${it.descripcion} — ${it.dosage}`);
      }
    }
    sec.ele("text").txt(lines.join("\n"));

    // Entradas estructuradas
    for (const rx of input.prescriptions) {
      for (const it of rx.items) {
        const entry = sec.ele("entry");
        const subAdmin = entry.ele("substanceAdministration", { classCode: "SBADM", moodCode: "INT" });
        subAdmin.ele("text").txt(it.dosage);
        const product = subAdmin.ele("consumable").ele("manufacturedProduct").ele("manufacturedMaterial");
        product.ele("code", {
          code: it.cumsKey, codeSystem: OID_CUMS_MX,
          codeSystemName: "CUMS",
          displayName: it.descripcion,
        });
      }
    }
  }

  return doc.end({ prettyPrint: true });
}

export const CDA_OIDS = {
  ROOT: OID_MEDIFLOW_ROOT,
  PATIENT: OID_MEDIFLOW_PATIENT,
  CLINIC: OID_MEDIFLOW_CLINIC,
  CIE10: OID_CIE10,
  CUMS: OID_CUMS_MX,
  TEMPLATE_NOM024: TEMPLATE_ID_NOM024,
};
