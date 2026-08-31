"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_BLOOD_TYPES,
  eduAntecedentesEstado,
  formatEduDate,
  type EduAntecedentes,
} from "@/lib/edu/pacientes-core";

/**
 * ANTECEDENTES MÉDICOS del paciente: ver y capturar (ola de Casos).
 *
 * Es EL ÚNICO formulario de antecedentes del vertical, a propósito — la
 * misma regla que dejó la pestaña Datos de solo lectura: dos formularios
 * para el mismo campo es cómo uno de los dos se queda sin el campo nuevo.
 * Vive en la ficha (y no en el modal de la lista de pacientes) porque
 * quien más lo llena está DE PIE con el paciente en el sillón.
 *
 * 🔴 EL TRI-ESTADO SE DICE CON TODAS SUS LETRAS:
 *   · "Sin antecedentes registrados"  = nadie ha preguntado (ámbar).
 *   · "No refiere"                    = se preguntó y no hay (verde).
 * Confundirlos es cómo se infiltra anestesia a un cardiópata. Guardar el
 * formulario VACÍO es exactamente cómo se registra el segundo estado.
 *
 * ⚠️ `canEdit` esconde el formulario y eso NO cierra nada: el PATCH exige
 * pacientes.manage O expediente.write en el servidor. Esconder es
 * cortesía; cerrar es el guard.
 */
export interface EduAntecedentesCardProps {
  patientId: string;
  antecedentes: EduAntecedentes;
  canEdit: boolean;
}

function listaATexto(items: string[]): string {
  return items.join(", ");
}

export function EduAntecedentesCard({ patientId, antecedentes, canEdit }: EduAntecedentesCardProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [bloodType, setBloodType] = useState(antecedentes.bloodType ?? "");
  const [alergias, setAlergias] = useState(listaATexto(antecedentes.allergies));
  const [padecimientos, setPadecimientos] = useState(listaATexto(antecedentes.chronicConditions));
  const [medicamentos, setMedicamentos] = useState(listaATexto(antecedentes.currentMedications));
  const [emName, setEmName] = useState(antecedentes.emergencyContactName ?? "");
  const [emPhone, setEmPhone] = useState(antecedentes.emergencyContactPhone ?? "");
  const [emRelation, setEmRelation] = useState(antecedentes.emergencyContactRelation ?? "");

  const estado = eduAntecedentesEstado({
    allergies: antecedentes.allergies,
    chronicConditions: antecedentes.chronicConditions,
    currentMedications: antecedentes.currentMedications,
    recordedAt: antecedentes.recordedAt,
  });

  function abrir() {
    // El formulario arranca de lo GUARDADO, no de lo que quedó en un
    // intento anterior: reabrir tras un error a medias no debe mezclar.
    setBloodType(antecedentes.bloodType ?? "");
    setAlergias(listaATexto(antecedentes.allergies));
    setPadecimientos(listaATexto(antecedentes.chronicConditions));
    setMedicamentos(listaATexto(antecedentes.currentMedications));
    setEmName(antecedentes.emergencyContactName ?? "");
    setEmPhone(antecedentes.emergencyContactPhone ?? "");
    setEmRelation(antecedentes.emergencyContactRelation ?? "");
    setError(null);
    setFlash(null);
    setEditando(true);
  }

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      // Las listas van como TEXTO con comas y el servidor las parte (el
      // mismo patrón del dental): recorta, descarta vacíos y deduplica.
      await eduRequest(`/api/instituto/pacientes/${patientId}/antecedentes`, {
        method: "PATCH",
        body: {
          bloodType: bloodType || null,
          allergies: alergias,
          chronicConditions: padecimientos,
          currentMedications: medicamentos,
          emergencyContactName: emName,
          emergencyContactPhone: emPhone,
          emergencyContactRelation: emRelation,
        },
      });
      setEditando(false);
      setFlash("Antecedentes guardados. Quedó registrado que los revisaste hoy.");
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron guardar los antecedentes.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="edu-section" id="antecedentes">
      <div className="edu-section__head">
        <h2 className="edu-section__title">Antecedentes médicos</h2>
        {canEdit && !editando && (
          <button type="button" className="edu-btn edu-btn--ghost edu-btn--sm" onClick={abrir}>
            {estado === "SIN_REGISTRAR" ? "Capturar" : "Editar"}
          </button>
        )}
      </div>

      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}

      {!editando && estado === "SIN_REGISTRAR" && (
        <div className="edu-banner edu-banner--warn" role="alert">
          <div>
            <p className="edu-banner__title">Sin antecedentes registrados</p>
            <p className="edu-banner__detail">
              Nadie le ha preguntado a este paciente por alergias, padecimientos ni medicamentos.
              Eso NO significa que no tenga: significa que no se sabe.
              {canEdit
                ? " Captúralos — guardar el formulario vacío también cuenta: registra que se le preguntó y no refiere."
                : " Pídele a recepción o al estudiante del caso que los capture."}
            </p>
          </div>
        </div>
      )}

      {!editando && estado !== "SIN_REGISTRAR" && (
        <>
          <div className="edu-kv edu-kv--2">
            <div>
              <span className="edu-kv__k">Alergias</span>
              <span className="edu-kv__v">
                {antecedentes.allergies.length > 0
                  ? antecedentes.allergies.join(", ")
                  : "No refiere"}
              </span>
            </div>
            <div>
              <span className="edu-kv__k">Padecimientos crónicos</span>
              <span className="edu-kv__v">
                {antecedentes.chronicConditions.length > 0
                  ? antecedentes.chronicConditions.join(", ")
                  : "No refiere"}
              </span>
            </div>
            <div>
              <span className="edu-kv__k">Medicamentos actuales</span>
              <span className="edu-kv__v">
                {antecedentes.currentMedications.length > 0
                  ? antecedentes.currentMedications.join(", ")
                  : "No refiere"}
              </span>
            </div>
            <div>
              <span className="edu-kv__k">Tipo de sangre</span>
              <span className="edu-kv__v">{antecedentes.bloodType ?? "No registrado"}</span>
            </div>
            <div>
              <span className="edu-kv__k">Contacto de emergencia</span>
              <span className="edu-kv__v">
                {antecedentes.emergencyContactName || antecedentes.emergencyContactPhone
                  ? [
                      antecedentes.emergencyContactName,
                      antecedentes.emergencyContactPhone,
                      antecedentes.emergencyContactRelation,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "No registrado"}
              </span>
            </div>
          </div>
          {antecedentes.recordedAt && (
            <p className="edu-note">
              Revisados el {formatEduDate(antecedentes.recordedAt)}
              {antecedentes.recordedByName ? ` por ${antecedentes.recordedByName}` : ""}.
            </p>
          )}
        </>
      )}

      {editando && (
        <div className="edu-stack edu-stack--tight">
          {error && (
            <div className="edu-alert" role="alert">
              {error}
            </div>
          )}

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="ant-alergias">
              Alergias (separadas por comas)
            </label>
            <input
              id="ant-alergias"
              className="edu-input"
              value={alergias}
              onChange={(e) => setAlergias(e.target.value)}
              placeholder="Ej.: penicilina, látex, lidocaína"
            />
            <p className="edu-field__hint">
              Lo que CONTRAINDICA. Se pinta en rojo arriba de la ficha, en todas las pestañas.
            </p>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="ant-padecimientos">
              Padecimientos crónicos (separados por comas)
            </label>
            <input
              id="ant-padecimientos"
              className="edu-input"
              value={padecimientos}
              onChange={(e) => setPadecimientos(e.target.value)}
              placeholder="Ej.: hipertensión, diabetes tipo 2"
            />
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="ant-medicamentos">
              Medicamentos actuales (separados por comas)
            </label>
            <input
              id="ant-medicamentos"
              className="edu-input"
              value={medicamentos}
              onChange={(e) => setMedicamentos(e.target.value)}
              placeholder="Ej.: losartán 50 mg, metformina"
            />
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="ant-sangre">
              Tipo de sangre
            </label>
            <select
              id="ant-sangre"
              className="edu-input"
              value={bloodType}
              onChange={(e) => setBloodType(e.target.value)}
            >
              <option value="">No registrado</option>
              {EDU_BLOOD_TYPES.map((bt) => (
                <option key={bt} value={bt}>
                  {bt}
                </option>
              ))}
            </select>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="ant-em-nombre">
              Contacto de emergencia
            </label>
            <input
              id="ant-em-nombre"
              className="edu-input"
              value={emName}
              onChange={(e) => setEmName(e.target.value)}
              placeholder="Nombre"
            />
          </div>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="ant-em-tel">
              Teléfono de emergencia
            </label>
            <input
              id="ant-em-tel"
              className="edu-input"
              value={emPhone}
              onChange={(e) => setEmPhone(e.target.value)}
              placeholder="+52 55…"
              inputMode="tel"
            />
          </div>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="ant-em-parentesco">
              Parentesco
            </label>
            <input
              id="ant-em-parentesco"
              className="edu-input"
              value={emRelation}
              onChange={(e) => setEmRelation(e.target.value)}
              placeholder="Ej.: cónyuge, madre"
            />
          </div>

          <p className="edu-note">
            Guardar registra que revisaste el bloque COMPLETO hoy, con tu nombre. Guardarlo vacío
            también es un dato: «se le preguntó y no refiere».
          </p>

          <div className="edu-form-acciones">
            <button
              type="button"
              className="edu-btn edu-btn--quiet"
              onClick={() => setEditando(false)}
              disabled={guardando}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="edu-btn edu-btn--primary"
              onClick={guardar}
              disabled={guardando}
            >
              {guardando ? "Guardando…" : "Guardar antecedentes"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
