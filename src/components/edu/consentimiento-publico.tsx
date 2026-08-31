"use client";

import { useState } from "react";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { SignaturePad } from "@/components/ui/signature-pad";
import {
  EDU_CONSENT_ESTADO_LABELS,
  EDU_CONSENT_INTEGRIDAD_LABELS,
  EDU_CONSENT_NAME_MAX,
  type EduConsentPublicView,
} from "@/lib/edu/consentimientos-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * LA PÁGINA QUE VE EL PACIENTE — en su teléfono, sin cuenta y sin sesión.
 *
 * Quien lee esto no trabaja aquí: no sabe qué es un caso, ni un folio, ni
 * un tamizaje. Así que:
 *   · no hay jerga del panel ni ids en pantalla;
 *   · el texto de la carta se pinta tal cual, con `white-space: pre-wrap`,
 *     porque el documento que se firma es texto plano y tiene que verse
 *     IDÉNTICO aquí y en el papel;
 *   · el botón de firmar solo aparece cuando de verdad se puede firmar, y
 *     cuando no, la pantalla dice por qué en una frase.
 *
 * 🔴 NADA DE LO QUE SE DECIDE AQUÍ ES UNA GARANTÍA. El endpoint público
 * vuelve a comprobar TODO (que la carta exista, que no esté revocada, que
 * no esté firmada, que la liga no haya caducado, que los bytes sean de
 * verdad una imagen). Esta pantalla solo evita que la persona intente algo
 * que va a rebotar.
 * ═══════════════════════════════════════════════════════════════════════
 */
export function EduConsentimientoPublico({
  token,
  inicial,
}: {
  token: string;
  inicial: EduConsentPublicView;
}) {
  const [vista, setVista] = useState<EduConsentPublicView>(inicial);
  const [firma, setFirma] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  // Testigos: la escuela los captura desde el mismo teléfono, después de
  // que el paciente firmó. Están escondidos detrás de un enlace porque el
  // 90 % de las cartas no lleva testigo y no tiene por qué verlos.
  const [testigo, setTestigo] = useState<"testigo1" | "testigo2" | null>(null);
  const [testigoNombre, setTestigoNombre] = useState("");

  async function enviar(rol: "paciente" | "testigo1" | "testigo2") {
    if (!firma) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/instituto/consentimientos/publico/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rol,
          signatureDataUrl: firma,
          witnessName: rol === "paciente" ? undefined : testigoNombre.trim(),
        }),
      });
      const data = await res.json().catch(() => null as unknown);
      if (!res.ok) {
        const mensaje =
          data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "No se pudo registrar la firma.";
        setError(mensaje);
        return;
      }
      setListo(true);
      setFirma(null);
      setTestigo(null);
      setTestigoNombre("");
      // Se relee del servidor en vez de adivinar el estado nuevo: lo que
      // vale es lo que quedó guardado, no lo que este navegador cree.
      const fresco = await fetch(`/api/instituto/consentimientos/publico/${token}`, {
        cache: "no-store",
      });
      if (fresco.ok) setVista((await fresco.json()) as EduConsentPublicView);
    } catch {
      setError("No se pudo conectar. Revisa tu conexión y vuelve a intentarlo.");
    } finally {
      setBusy(false);
    }
  }

  const puedeFirmarPaciente = vista.puedeFirmar;
  const puedeFirmarTestigo = vista.estado === "FIRMADO" && !vista.revokedAt;

  return (
    <div className="edu-auth edu-publico">
      <main className="edu-publico__hoja">
        <header className="edu-publico__head">
          <p className="edu-publico__marca">{vista.institutionName}</p>
          <h1 className="edu-publico__title">Carta de consentimiento informado</h1>
          <p className="edu-publico__sub">
            {vista.procedure} · para {vista.patientName}
          </p>
        </header>

        {/* Lo primero, antes del documento: quién te va a atender. Es el
            dato que un paciente de clínica universitaria tiene derecho a
            leer antes que nada, y repetirlo aquí —además de dentro del
            texto— es a propósito. */}
        <div className="edu-banner">
          <div>
            <p className="edu-banner__title">Quién te va a atender</p>
            <p className="edu-banner__detail">
              Te atiende <strong>{vista.studentName}</strong>, estudiante en formación de{" "}
              {vista.institutionName}
              {vista.supervisorName ? (
                <>
                  , bajo la supervisión y la responsabilidad del docente{" "}
                  <strong>{vista.supervisorName}</strong>
                </>
              ) : (
                ", bajo la supervisión de un docente del instituto"
              )}
              .
            </p>
          </div>
        </div>

        {vista.estado === "REVOCADO" && (
          <div className="edu-alert" role="alert">
            <ShieldAlert size={16} aria-hidden /> Este consentimiento fue revocado
            {vista.revokedReason ? `: ${vista.revokedReason}` : "."} Si crees que es un error,
            comunícate con {vista.institutionName}
            {vista.institutionPhone ? ` al ${vista.institutionPhone}` : ""}.
          </div>
        )}

        {vista.estado === "VENCIDO" && (
          <div className="edu-alert" role="alert">
            Esta liga caducó y ya no se puede firmar desde aquí. Pídele al instituto que te mande una
            carta nueva
            {vista.institutionPhone ? ` (${vista.institutionPhone})` : ""}.
          </div>
        )}

        {vista.estado === "FIRMADO" && (
          <div className="edu-alert edu-alert--ok" role="status">
            {/* P2-14: la fecha llega YA formateada del servidor, en la zona
                del instituto. Formatearla aquí con toLocaleString rompía la
                hidratación (el servidor pinta en SU zona) y decía otra hora
                que la de la escuela — en un documento legal. */}
            <CheckCircle2 size={16} aria-hidden /> Firmado
            {vista.signedLabel ? ` el ${vista.signedLabel}` : ""}
            {vista.signerName ? ` por ${vista.signerName} (${vista.signerRelation ?? "—"})` : ""}.
            Esta es tu copia: guárdala o pide una impresa.
          </div>
        )}

        {listo && (
          <div className="edu-alert edu-alert--ok" role="status">
            Listo. Tu firma quedó registrada.
          </div>
        )}

        {/* 🔴 Si el texto guardado ya no cuadra con su huella, se avisa
            ANTES del documento y en rojo: quien está a punto de firmar
            tiene que saberlo antes de leerlo, no después. */}
        {vista.integridad === "alterado" && (
          <div className="edu-alert" role="alert">
            {EDU_CONSENT_INTEGRIDAD_LABELS.alterado}
          </div>
        )}

        <article className="edu-publico__texto">{vista.content}</article>

        {vista.integridad === "ok" && (
          <p className="edu-publico__nota">{EDU_CONSENT_INTEGRIDAD_LABELS.ok}</p>
        )}

        <section className="edu-publico__firmas">
          <p className="edu-kv__k">Firmas</p>
          <ul>
            <li>
              {/* P2-14: misma etiqueta del servidor que el aviso de arriba. */}
              Paciente: {vista.signedLabel ? `firmado el ${vista.signedLabel}` : "pendiente"}
            </li>
            <li>Estudiante: {vista.studentSignedAt ? "contrafirmado" : "pendiente"}</li>
            <li>Docente responsable: {vista.supervisorSignedAt ? "contrafirmado" : "pendiente"}</li>
            {vista.witness1Name && <li>Testigo 1: {vista.witness1Name}</li>}
            {vista.witness2Name && <li>Testigo 2: {vista.witness2Name}</li>}
          </ul>
          <p className="edu-publico__nota">
            El estudiante y su docente firman desde el sistema del instituto después de que tú firmes.
            Estado actual: {EDU_CONSENT_ESTADO_LABELS[vista.estado]}.
          </p>
        </section>

        {error && (
          <div className="edu-alert" role="alert">
            {error}
          </div>
        )}

        {puedeFirmarPaciente && !testigo && (
          <section className="edu-publico__pad">
            <p className="edu-kv__k">
              {vista.signerName
                ? `Firma ${vista.signerName}, representante legal (${vista.signerRelation ?? "—"})`
                : "Firma del paciente"}
            </p>
            <p className="edu-publico__nota">
              Al firmar declaras que leíste esta carta, que te la explicaron, que pudiste preguntar y
              que aceptas el procedimiento. Puedes revocarla en cualquier momento mientras el
              procedimiento no haya iniciado.
            </p>
            <SignaturePad
              theme="light"
              onChange={setFirma}
              ariaLabel="Firma del paciente"
              hintLabel="Firma aquí con el dedo"
            />
            <button
              type="button"
              className="edu-btn edu-btn--primary"
              onClick={() => enviar("paciente")}
              disabled={busy || !firma}
            >
              {busy ? "Registrando…" : "Firmar"}
            </button>
          </section>
        )}

        {puedeFirmarTestigo && !testigo && (
          <button
            type="button"
            className="edu-btn edu-btn--quiet edu-btn--sm"
            onClick={() => {
              setError(null);
              setFirma(null);
              setTestigo(vista.witness1SignedAt ? "testigo2" : "testigo1");
            }}
            disabled={Boolean(vista.witness1SignedAt && vista.witness2SignedAt)}
          >
            {vista.witness1SignedAt && vista.witness2SignedAt
              ? "Ya firmaron los dos testigos"
              : "Firmar como testigo"}
          </button>
        )}

        {testigo && (
          <section className="edu-publico__pad">
            <p className="edu-kv__k">
              Firma del {testigo === "testigo1" ? "primer" : "segundo"} testigo
            </p>
            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-testigo-nombre">
                Nombre completo del testigo
              </label>
              <input
                id="edu-testigo-nombre"
                className="edu-input"
                value={testigoNombre}
                maxLength={EDU_CONSENT_NAME_MAX}
                disabled={busy}
                autoComplete="off"
                onChange={(e) => setTestigoNombre(e.target.value)}
              />
            </div>
            <SignaturePad
              theme="light"
              onChange={setFirma}
              ariaLabel="Firma del testigo"
              hintLabel="Firma aquí"
            />
            <div className="edu-actions">
              <button
                type="button"
                className="edu-btn edu-btn--ghost"
                onClick={() => {
                  setTestigo(null);
                  setFirma(null);
                }}
                disabled={busy}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="edu-btn edu-btn--primary"
                onClick={() => enviar(testigo)}
                disabled={busy || !firma || testigoNombre.trim().length < 3}
              >
                {busy ? "Registrando…" : "Firmar como testigo"}
              </button>
            </div>
          </section>
        )}

        <footer className="edu-publico__pie">
          {vista.institutionName}
          {vista.institutionPhone ? ` · ${vista.institutionPhone}` : ""}
        </footer>
      </main>
    </div>
  );
}
