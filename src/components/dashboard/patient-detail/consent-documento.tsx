"use client";

// La carta de consentimiento vista como DOCUMENTO: la misma hoja, la misma barra
// (PDF, imprimir, WhatsApp, correo) y la misma copia de papel que la nota de
// evolución. Todo eso es lo COMÚN de `documentos-paciente/`; aquí solo se monta.
//
// Por qué no se usa `DocumentoVisor` tal cual y sí sus piezas: el visor pinta un
// pie con UNA firma (la del doctor) y no deja meter nada más en la hoja. La
// carta lleva dos firmas, testigos, representante, revocación y evidencia, así
// que se arma con `DocumentoHoja firmado={null}` (sin pie) y el pie propio va
// de hijo. La composición —barra arriba, hoja debajo, copia en un portal— es
// calcada a la del visor, para que el día que acepte un pie se cambie por él.
//
// IMPRIMIR aquí es las dos vías de la carta: sin firmar, la hoja sale con las
// líneas en blanco (paciente, doctor y dos testigos) para el bolígrafo; firmada,
// con las firmas que hubo. Quién sale lo decide `buildSignatureBlocks`, igual
// que en el PDF.

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BadgeCheck, Check, Clock, Loader2, PenLine } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { AvisoDatosFaltantes } from "@/components/dashboard/documentos-paciente/aviso-datos-faltantes";
import { DocumentoAcciones } from "@/components/dashboard/documentos-paciente/documento-acciones";
import {
  CLASES_DOCUMENTO, DocumentoCuerpo, DocumentoHoja, DocumentoMesa, DocumentoRaiz,
} from "@/components/dashboard/documentos-paciente/documento-hoja";
import { ATRIBUTO_IMPRESION, CSS_IMPRESION } from "@/components/dashboard/documentos-paciente/impresion";
import type { RutasDeDocumento } from "@/components/dashboard/documentos-paciente/tipos";
import type { ConsentDocumentoDTO, ConsentFirmaDTO } from "@/lib/consent/documento";
import type { ConsentDTO } from "@/lib/consent/types";
import s from "./consent-documento.module.css";

/** A dónde pega cada acción de la barra. Sin permiso, ese botón ni se pinta. */
export function rutasDeConsentimiento(
  id: string,
  puede: { whatsapp: boolean; correo: boolean },
): RutasDeDocumento {
  const base = `/api/consent/${encodeURIComponent(id)}`;
  return {
    pdf: `${base}/pdf`,
    whatsapp: puede.whatsapp ? `${base}/send-whatsapp` : null,
    correo: puede.correo ? `${base}/email` : null,
  };
}

function Firma({ firma, paraPapel }: { firma: ConsentFirmaDTO; paraPapel: boolean }) {
  const t = useT();
  return (
    <div className={s.firmaCelda}>
      <div className={s.firmaHueco}>
        {firma.imagen ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL de la firma, no pasa por el optimizador
          <img src={firma.imagen} alt={t("consentDoc.signatureAlt", { name: firma.name })} className={s.firmaImagen} />
        ) : null}
      </div>
      <div className={s.firmaLinea}>
        <span className={s.firmaRol}>{firma.role}</span>
        <span className={s.firmaNombre}>{firma.name}</span>
        {firma.firmadoEl ? (
          <span className={[s.firmaFecha, s.firmaFechaHecha].join(" ")}>
            <BadgeCheck size={13} aria-hidden /> {t("consentDoc.signedOn", { date: firma.firmadoEl })}
          </span>
        ) : (
          // La fecha por llenar es de la hoja que va a pasar por un bolígrafo. En
          // una carta ya firmada en digital, a quien falta le falta FIRMAR.
          <span className={s.firmaFecha}>
            {paraPapel ? t("consentDoc.dateBlank") : t("consentDoc.signaturePending")}
          </span>
        )}
      </div>
    </div>
  );
}

/** La hoja de la carta. Pinta SOLO lo que recibe: sirve en pantalla y en el papel. */
export function ConsentHoja({ doc }: { doc: ConsentDocumentoDTO }) {
  const t = useT();
  return (
    <DocumentoHoja
      encabezado={doc.encabezado}
      titulo={doc.titulo}
      tipo={doc.tipo ?? t("consentDoc.kind")}
      firmado={null}
    >
      {doc.revocado ? (
        <div className={s.revocado} role="note">
          <p className={s.revocadoTitulo}>{t("consentDoc.revokedOn", { date: doc.revocado.fecha })}</p>
          <p className={s.revocadoMotivo}>
            {t("consentDoc.revokedReason", { reason: doc.revocado.motivo ?? t("consentDoc.revokedNoReason") })}
          </p>
        </div>
      ) : null}

      {doc.representante ? (
        <p className={s.representante}>
          {t("consentDoc.representative")}: <b>{doc.representante.nombre}</b>
          {doc.representante.relacion ? ` (${doc.representante.relacion})` : ""}
        </p>
      ) : null}

      <DocumentoCuerpo html={doc.html} />

      <div className={s.firmas}>
        {doc.firmas.map((f, i) => (
          <Firma key={`${f.role}-${i}`} firma={f} paraPapel={doc.paraPapel} />
        ))}
      </div>

      <div className={s.evidencia}>
        <p>{doc.paraPapel ? t("consentDoc.evidencePaper") : t("consentDoc.evidenceDigital")}</p>
        {doc.evidencia.huella ? (
          <p className={s.huella}>{t("consentDoc.evidenceHash", { hash: doc.evidencia.huella })}</p>
        ) : null}
        {doc.evidencia.firmadoEl ? (
          <p>
            {t("consentDoc.evidenceSigned", { date: doc.evidencia.firmadoEl })}
            {doc.evidencia.ip ? ` · IP ${doc.evidencia.ip}` : ""}
          </p>
        ) : null}
      </div>
    </DocumentoHoja>
  );
}

/** Fuera de la hoja: quién ha firmado y qué toca hacer ahora. No se imprime. */
function TiraDeFirmas({
  doc, consent, canCountersign, onCountersign,
}: {
  doc: ConsentDocumentoDTO;
  consent: ConsentDTO;
  canCountersign: boolean;
  onCountersign: () => void;
}) {
  const t = useT();
  const quien = doc.representante ? t("consentDoc.strip.representative") : t("consentDoc.strip.patient");
  const filas: Array<[string, boolean]> = [
    [quien, doc.firmaPaciente],
    [t("consentDoc.strip.doctor"), doc.firmaDoctor],
  ];
  const pista =
    doc.status === "REVOKED" ? t("consentDoc.strip.hintRevoked")
    : doc.status === "EXPIRED" ? t("consentDoc.strip.hintExpired")
    : doc.status === "PENDING" ? t("consentDoc.strip.hintPending")
    : !doc.firmaDoctor ? t("consentDoc.strip.hintDoctor")
    : t("consentDoc.strip.hintComplete");

  return (
    <div className={s.tira}>
      <ul className={s.tiraFirmas}>
        {filas.map(([rotulo, hecha]) => (
          <li key={rotulo} className={[s.tiraFirma, hecha ? s.tiraHecha : ""].join(" ")}>
            {hecha ? <Check size={14} aria-hidden /> : <Clock size={14} aria-hidden />}
            {rotulo}: {hecha ? t("consentDoc.strip.signed") : t("consentDoc.strip.pending")}
          </li>
        ))}
        {consent.witnessCount > 0 ? (
          <li className={[s.tiraFirma, s.tiraHecha].join(" ")}>
            <Check size={14} aria-hidden /> {t("consentDoc.strip.witnesses", { count: consent.witnessCount })}
          </li>
        ) : null}
      </ul>
      <p className={s.tiraPista}>{pista}</p>
      <div className={s.tiraAcciones}>
        {doc.status === "PENDING" ? (
          <a
            href={`/consentimiento/${consent.token}`}
            target="_blank"
            rel="noreferrer"
            className="btn-new btn-new--primary btn-new--sm"
          >
            <PenLine size={13} aria-hidden /> {t("patients.consents.actionSign")}
          </a>
        ) : null}
        {canCountersign && doc.status === "SIGNED" && !doc.firmaDoctor ? (
          <ButtonNew variant="primary" size="sm" icon={<PenLine size={13} aria-hidden />} onClick={onCountersign}>
            {t("patients.consents.actionCountersign")}
          </ButtonNew>
        ) : null}
      </div>
    </div>
  );
}

export function ConsentVisor({
  consent, patientId, inicio, puedeWhatsApp, puedeCorreo, canCountersign, onCountersign,
}: {
  /** La fila de la lista. Cuando cambian sus firmas, la hoja se vuelve a pedir. */
  consent: ConsentDTO;
  patientId: string;
  inicio?: ReactNode;
  puedeWhatsApp: boolean;
  puedeCorreo: boolean;
  canCountersign: boolean;
  onCountersign: () => void;
}) {
  const t = useT();
  const [doc, setDoc] = useState<ConsentDocumentoDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  // El portal necesita <body>: solo en el cliente, después de montar.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  // La firma ocurre fuera de esta pantalla (la tableta, el teléfono del
  // paciente): la lista se refresca sola y, cuando trae una firma nueva, aquí se
  // vuelve a pedir la hoja para que aparezca sin recargar.
  const version = [consent.id, consent.signedAt, consent.doctorSignedAt, consent.witnessCount, consent.revokedAt].join("|");
  useEffect(() => {
    let cancelado = false;
    setError(null);
    fetch(`/api/consent/${encodeURIComponent(consent.id)}/documento`)
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (cancelado) return;
        if (res.ok && json) setDoc(json as ConsentDocumentoDTO);
        else setError((json && json.error) || t("consentDoc.loadError"));
      })
      .catch(() => { if (!cancelado) setError(t("consentDoc.loadError")); });
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` es estable por diccionario; `version` resume la fila
  }, [version]);

  if (!doc) {
    // Aunque la hoja no cargue, la barra SÍ: «Volver» y el PDF no dependen de
    // ella, y para una carta firmada este visor es el camino al PDF. Imprimir
    // necesita la hoja, así que ahí se ofrece el PDF.
    return (
      <DocumentoRaiz>
        <DocumentoMesa>
          <DocumentoAcciones
            rutas={rutasDeConsentimiento(consent.id, { whatsapp: false, correo: false })}
            puedeEnviar={false}
            inicio={inicio}
          />
          <div className={s.espera} role={error ? "alert" : "status"}>
            {error ? error : (<><Loader2 size={15} className="animate-spin" aria-hidden /> {t("consentDoc.loading")}</>)}
          </div>
        </DocumentoMesa>
      </DocumentoRaiz>
    );
  }

  const hoja = <ConsentHoja doc={doc} />;
  // Solo lo firmado y vigente sale de la clínica. La carta sin firmar se manda
  // con su liga para firmar, desde la lista; la revocada no se manda.
  const puedeEnviar = doc.status === "SIGNED";

  return (
    <DocumentoRaiz>
      {/* Sale casi siempre (ninguna clínica tiene dirección): es una lista de
          pendientes con su atajo. En una carta revocada ya no hay nada que completar. */}
      {doc.revocado ? null : (
        <div style={{ marginBottom: 14 }}>
          <AvisoDatosFaltantes faltantes={doc.faltantes} patientId={patientId} documento="carta" />
        </div>
      )}
      <DocumentoMesa>
        <DocumentoAcciones
          rutas={rutasDeConsentimiento(doc.id, { whatsapp: puedeWhatsApp, correo: puedeCorreo })}
          puedeEnviar={puedeEnviar}
          inicio={inicio}
        />
        <TiraDeFirmas doc={doc} consent={consent} canCountersign={canCountersign} onCountersign={onCountersign} />
        {hoja}
      </DocumentoMesa>
      {montado
        ? createPortal(
            // La copia de papel lleva SOLO la hoja: ni barra, ni tira, ni aviso.
            <div className={CLASES_DOCUMENTO} {...{ [ATRIBUTO_IMPRESION]: "" }}>
              <style dangerouslySetInnerHTML={{ __html: CSS_IMPRESION }} />
              {hoja}
            </div>,
            document.body,
          )
        : null}
    </DocumentoRaiz>
  );
}
