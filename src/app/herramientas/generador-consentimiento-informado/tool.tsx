"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, FileSignature, Lock } from "lucide-react";
import { DocActions } from "@/components/herramientas/doc-actions";
import { CONSENT_PROCEDURES, getConsentProcedure } from "@/lib/herramientas/consent-procedures";

// ─────────────────────────────────────────────────────────────────────────────
// Generador de consentimiento informado — 100% cliente.
//
// Mismo patrón que el generador de aviso de privacidad: el documento es UN SOLO
// STRING, se pinta con white-space: pre-wrap y es exactamente lo que se copia y
// lo que se imprime. Sin fetch, sin storage, sin librerías de PDF.
//
// El contenido clínico es deliberadamente general: son los riesgos frecuentes y
// documentados del procedimiento, no una lista exhaustiva. El disclaimer viaja
// en la página, en la herramienta y DENTRO del documento, porque este formato
// sale del consultorio impreso y ahí también tiene que quedar claro.
// ─────────────────────────────────────────────────────────────────────────────

const LEGAL_DISCLAIMER =
  "Formato base orientativo. El contenido clínico debe revisarlo, completarlo y validarlo el doctor tratante; no sustituye su criterio ni asesoría legal.";

function slot(value: string, placeholder: string): string {
  const v = value.trim();
  return v === "" ? placeholder : v;
}

export function ConsentFormTool() {
  const [procedureKey, setProcedureKey] = useState(CONSENT_PROCEDURES[0].key);
  const [clinic, setClinic] = useState("");
  const [doctor, setDoctor] = useState("");

  const doc = useMemo(() => {
    const p = getConsentProcedure(procedureKey);
    const clinicName = slot(clinic, "[NOMBRE DE LA CLÍNICA O CONSULTORIO]");
    const doctorName = slot(doctor, "[NOMBRE DEL DOCTOR TRATANTE]");

    const risks = p.risks.map((r) => `• ${r}`).join("\n");
    const alternatives = p.alternatives.map((a) => `• ${a}`).join("\n");
    const care = p.care.map((c) => `• ${c}`).join("\n");

    return `CONSENTIMIENTO INFORMADO
${clinicName}

Procedimiento: ${p.label}
Doctor tratante: ${doctorName}

Paciente: ______________________________________________  Edad: ________
Tutor o representante legal (si el paciente es menor de edad o no puede otorgar
su consentimiento): _____________________________________________________

1. EN QUÉ CONSISTE EL PROCEDIMIENTO

${p.description}

El doctor tratante me explicó cómo se aplica este procedimiento a mi caso
particular, en qué dientes o zonas se realizará y qué resultado se busca.

Observaciones del caso (a completar por el doctor tratante):

_________________________________________________________________________

_________________________________________________________________________

2. MOLESTIAS Y RIESGOS FRECUENTES

Todo procedimiento odontológico implica molestias y riesgos, incluso cuando se
realiza correctamente. Los más frecuentes en este procedimiento son:

${risks}

También pueden presentarse reacciones a la anestesia o a los medicamentos
indicados, y complicaciones poco frecuentes que el doctor tratante me explicará
si aplican a mi caso. Ningún tratamiento odontológico puede garantizar un
resultado exacto, porque depende también de la respuesta de cada organismo y
de los cuidados posteriores.

3. ALTERNATIVAS

${alternatives}
• No realizar ningún tratamiento: se me explicó que el problema puede
  mantenerse igual, avanzar o agravarse, y que en ese caso el tratamiento
  posterior podría ser más complejo, más costoso o ya no ser posible.

4. QUÉ SE ESPERA DE MÍ

${care}

5. DUDAS RESUELTAS

Declaro que la información anterior me fue explicada en lenguaje claro, que
tuve oportunidad de preguntar todo lo que quise saber sobre el procedimiento,
sus riesgos, sus alternativas y su costo, y que todas mis preguntas fueron
respondidas de forma satisfactoria.

Informé al doctor tratante de mis antecedentes médicos, alergias, medicamentos
que tomo y padecimientos que tengo, y me comprometo a avisar de cualquier
cambio antes de continuar con el tratamiento.

Sé que puedo revocar este consentimiento en cualquier momento antes de que el
procedimiento se realice, sin que eso afecte la atención que reciba.

6. AUTORIZACIÓN Y FIRMAS

Con base en lo anterior, autorizo la realización del procedimiento descrito.


_________________________________         _________________________________
Nombre y firma del paciente,              Nombre y firma del doctor tratante
tutor o representante legal               ${doctorName}
                                          Cédula profesional: ______________

Lugar y fecha: ______________________________  ____ / ____ / ________


Testigo (opcional): ______________________________________________________


NOTA: ${LEGAL_DISCLAIMER}
`;
  }, [procedureKey, clinic, doctor]);

  return (
    <div className="tool-panel">
      <div className="tool-panel__head">
        <FileSignature aria-hidden="true" style={{ width: 18, height: 18, color: "var(--b)" }} />
        <h2 className="tool-panel__title">Genera tu consentimiento informado</h2>
        <span className="tool-panel__badge">
          <Lock aria-hidden="true" /> En tu navegador
        </span>
      </div>

      <div className="tool-panel__body">
        <div className="tool-alert tool-alert--legal" style={{ marginTop: 0 }}>
          <AlertTriangle aria-hidden="true" />
          <span>{LEGAL_DISCLAIMER}</span>
        </div>

        <div className="tool-fields" style={{ marginTop: 22 }}>
          <div className="tool-field tool-field--wide">
            <label className="tool-label" htmlFor="ci-procedimiento">
              Procedimiento
            </label>
            <select
              id="ci-procedimiento"
              className="tool-select"
              value={procedureKey}
              onChange={(e) => setProcedureKey(e.target.value)}
            >
              {CONSENT_PROCEDURES.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="tool-hint">
              Cambia los riesgos y las alternativas del formato. Revísalos: son los frecuentes del
              procedimiento, no los de tu paciente.
            </span>
          </div>

          <div className="tool-field">
            <label className="tool-label" htmlFor="ci-clinica">
              Nombre de la clínica
            </label>
            <input
              id="ci-clinica"
              className="tool-input"
              type="text"
              value={clinic}
              placeholder="Clínica Dental Sonrisa"
              onChange={(e) => setClinic(e.target.value)}
            />
          </div>

          <div className="tool-field">
            <label className="tool-label" htmlFor="ci-doctor">
              Nombre del doctor tratante
            </label>
            <input
              id="ci-doctor"
              className="tool-input"
              type="text"
              value={doctor}
              placeholder="Dr. Luis Herrera"
              onChange={(e) => setDoctor(e.target.value)}
            />
          </div>
        </div>

        <div className="tool-out">
          <p className="tool-bars__title" style={{ marginBottom: 4 }}>
            Vista previa del formato
          </p>
          <DocActions text={doc} />
          <div
            className="tool-doc"
            tabIndex={0}
            role="document"
            aria-label="Consentimiento informado generado"
          >
            {doc}
          </div>
          <div className="tool-alert tool-alert--legal">
            <AlertTriangle aria-hidden="true" />
            <span>{LEGAL_DISCLAIMER}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
