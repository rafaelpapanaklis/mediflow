"use client";

// «Nuevo consentimiento» como HOJA EN BLANCO, igual que la nota de evolución.
//
// Rafael: «Necesito que esté por default en blanco así como la nota de evolución
// y luego te deje elegir plantilla.» Antes el alta era un modal que OBLIGABA a
// elegir un procedimiento del catálogo antes de escribir, y una clínica sin
// plantillas no podía crear ninguna carta. Ahora:
//   · se abre la hoja con la cabecera que calcula el servidor (paciente, CURP,
//     doctor, cédula, especialidad, clínica, logo, fecha) y el texto vacío. La
//     cabecera NO es una plantilla: es lo que hace válida la carta, y sale siempre;
//   · la plantilla es un botón dentro del editor («Cargar plantilla»), el MISMO
//     menú que usa la nota (`documentos-paciente/menu-plantillas`);
//   · lo ya escrito no se pisa nunca: con texto, la plantilla va DEBAJO y se
//     avisa. Es la regla de la nota (`combinarConPlantilla`), no una propia.
// Aquí no hay ningún enlace a Administración → Plantillas a propósito.
//
// Lo que NO se comparte con la nota, y por qué: el cuerpo. La nota se escribe en
// HTML (`contentEditable` con negritas y listas); la carta se guarda en TEXTO
// PLANO, porque ese texto es el snapshot que sella `contentHash`, el que lee el
// paciente en su teléfono y el que imprime el PDF. Por eso aquí el cuerpo es un
// <textarea> sin barra de formato: una negrita que no llega al papel sería
// enseñarle al doctor algo distinto de lo que firma el paciente.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ArrowLeft, Check, Eye, Loader2, Pencil } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import {
  DocumentoCuerpo, DocumentoHoja, DocumentoMesa, DocumentoRaiz, clasesDocumento,
} from "@/components/dashboard/documentos-paciente/documento-hoja";
import { MenuPlantillas, type PlantillaDeMenu } from "@/components/dashboard/documentos-paciente/menu-plantillas";
import type { EncabezadoDocumento } from "@/components/dashboard/documentos-paciente/tipos";
import { combinarConPlantilla } from "@/lib/patient-documents/combinar-plantilla";
import { ageYears, isMinor } from "@/lib/consent/signers";
import { consentTextToBodyHtml } from "@/lib/consent/template-html";
import { parseConsentText } from "@/lib/consent/render";
import type { ConsentMissingItem } from "@/lib/consent/document-data";
import { ConsentMissingNotice } from "./consent-missing-notice";
import s from "./consent-documento.module.css";

/** Lo que devuelve GET /api/consent/preview. */
export interface PreviewCarta {
  /** `null` = hoja en blanco: no salió de ninguna plantilla. */
  templateId: string | null;
  /** El nombre de la plantilla; vacío en la hoja en blanco. */
  procedure: string;
  /** El texto ya rellenado con los datos del caso; vacío en la hoja en blanco. */
  content: string;
  missing: ConsentMissingItem[];
  encabezado: EncabezadoDocumento;
}

export interface DoctorDeCarta {
  id: string;
  firstName: string;
  lastName: string;
}

/** El mismo tope que el título de la nota y que el servidor. */
const MAX_ACTO = 120;

/** El 4xx/5xx del servidor con su frase, o el código si no trae ninguna. */
async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error((json && json.error) || `HTTP ${res.status}`);
  return json as T;
}

/** URL de la vista previa. Sin `templateId` es la hoja en blanco. */
export function urlPreviewCarta(datos: {
  patientId: string;
  doctorId: string;
  templateId?: string | null;
  representante?: { nombre: string; relacion: string } | null;
}): string {
  const q = new URLSearchParams({ patientId: datos.patientId });
  if (datos.templateId) q.set("templateId", datos.templateId);
  if (datos.doctorId) q.set("doctorId", datos.doctorId);
  if (datos.representante?.nombre) {
    q.set("signerName", datos.representante.nombre);
    q.set("signerRelation", datos.representante.relacion);
  }
  return `/api/consent/preview?${q.toString()}`;
}

export function ConsentEditor({
  hoja, patientId, patientDob, doctors, doctorInicial, onVolver, onCreado,
}: {
  /** La hoja en blanco con la que se abre, ya pedida con `doctorInicial`. */
  hoja: PreviewCarta;
  patientId: string;
  patientDob: string | null;
  doctors: DoctorDeCarta[];
  doctorInicial: string;
  onVolver: () => void;
  onCreado: (creada: { id: string; signUrl: string }) => void | Promise<void>;
}) {
  const t = useT();
  const confirm = useConfirm();

  const [encabezado, setEncabezado] = useState(hoja.encabezado);
  const [missing, setMissing] = useState<ConsentMissingItem[]>(hoja.missing);
  const [acto, setActo] = useState(hoja.procedure);
  const [texto, setTexto] = useState(hoja.content);
  const [doctorId, setDoctorId] = useState(doctorInicial);
  // Con un menor la casilla del representante se marca sola y no se puede
  // quitar: la carta de un niño la firma su madre, padre o tutor, y el servidor
  // la rechaza sin ese dato (misma regla, `minorSignerError`).
  const menor = isMinor(patientDob);
  const edad = ageYears(patientDob);
  const [porRepresentante, setPorRepresentante] = useState(menor);
  const [firmanteNombre, setFirmanteNombre] = useState("");
  const [firmanteRelacion, setFirmanteRelacion] = useState("");
  const [viendo, setViendo] = useState(false);
  const [trayendo, setTrayendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `null` = todavía no se sabe. Si la lista falla se trata como vacía: la
  // plantilla es una comodidad y su fallo no puede impedir escribir.
  const [plantillas, setPlantillas] = useState<PlantillaDeMenu[] | null>(null);

  const tocado = useRef(false);
  /** La última plantilla que se usó, o `null` si la carta es libre. */
  const plantillaUsada = useRef<string | null>(hoja.templateId);
  /**
   * El texto es, TAL CUAL, el de una plantilla cargada sobre la hoja vacía (nadie
   * lo ha tocado después). Solo entonces se vuelve a pedir al cambiar el doctor o
   * el representante: la plantilla nombra al doctor, y sin esto la carta diría
   * uno y la cabecera otro. En cuanto se escribe, el texto es del doctor y ya no
   * se regenera nunca.
   */
  const textoDePlantilla = useRef(false);
  /**
   * Sube con cada plantilla que se carga. Una regeneración que salió ANTES de la
   * última carga llega tarde y no vale: sin esto podía volver a poner el texto de
   * la plantilla anterior encima de la nueva.
   */
  const cargas = useRef(0);
  const caja = useRef<HTMLTextAreaElement>(null);
  const campoActo = useRef<HTMLInputElement>(null);

  const representante = porRepresentante && firmanteNombre.trim()
    ? { nombre: firmanteNombre.trim(), relacion: firmanteRelacion.trim() }
    : null;

  useEffect(() => {
    let vivo = true;
    pedir<{ templates?: PlantillaDeMenu[] }>("/api/consent/templates")
      .then((d) => vivo && setPlantillas(Array.isArray(d?.templates) ? d.templates : []))
      .catch(() => vivo && setPlantillas([]));
    return () => {
      vivo = false;
    };
  }, []);

  // La hoja en blanco se abre lista para escribir: primero el acto que se autoriza.
  useEffect(() => {
    campoActo.current?.focus();
  }, []);

  // La caja crece con el texto: una carta de plantilla son cuatro pantallas, y un
  // textarea con su propio scroll dentro de la hoja no deja ver dónde se está.
  useLayoutEffect(() => {
    const c = caja.current;
    if (!c) return;
    c.style.height = "auto";
    c.style.height = `${c.scrollHeight + 2}px`;
  }, [texto, viendo]);

  // Cambiar de doctor o de representante cambia la CABECERA (y lo que falta).
  // Con retardo: el nombre del representante se escribe letra a letra y sin
  // esperar saldría una petición por tecla. La primera vuelta no pide nada: la
  // hoja ya llegó con estos mismos datos.
  const primera = useRef(true);
  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    let cancelado = false;
    const conPlantilla = textoDePlantilla.current ? plantillaUsada.current : null;
    const carga = cargas.current;
    const reloj = setTimeout(() => {
      pedir<PreviewCarta>(urlPreviewCarta({ patientId, doctorId, templateId: conPlantilla, representante }))
        .then((p) => {
          if (cancelado || carga !== cargas.current) return;
          setEncabezado(p.encabezado);
          setMissing(Array.isArray(p.missing) ? p.missing : []);
          // Se vuelve a mirar AHORA: si el doctor escribió mientras llegaba, gana él.
          if (conPlantilla && textoDePlantilla.current && p.content) setTexto(p.content);
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      cancelado = true;
      clearTimeout(reloj);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `representante` se deriva de estos tres
  }, [patientId, doctorId, porRepresentante, firmanteNombre, firmanteRelacion]);

  // Lo tecleado vive solo aquí: salir sin crear lo pierde. Se pregunta.
  const salir = async () => {
    if (tocado.current && (texto.trim() || acto.trim())) {
      const ok = await confirm({
        title: t("patients.consents.editor.leaveTitle"),
        description: t("patients.consents.editor.leaveBody"),
      });
      if (!ok) return;
    }
    onVolver();
  };

  // Lo ya escrito NO se pisa: con texto, la plantilla se añade debajo y se dice.
  const cargarPlantilla = async (p: PlantillaDeMenu) => {
    cargas.current += 1;
    setTrayendo(true);
    try {
      const rellena = await pedir<PreviewCarta>(
        urlPreviewCarta({ patientId, doctorId, templateId: p.id, representante }),
      );
      // Texto plano: entre lo escrito y la plantilla, una línea en blanco.
      const r = combinarConPlantilla(texto, texto, rellena.content, "\n\n");
      setTexto(r.html);
      setEncabezado(rellena.encabezado);
      setMissing(Array.isArray(rellena.missing) ? rellena.missing : []);
      plantillaUsada.current = rellena.templateId ?? p.id;
      textoDePlantilla.current = !r.anadida;
      tocado.current = true;
      if (!r.anadida && !acto.trim()) setActo(rellena.procedure || p.name);
      setViendo(false);
      toast.success(
        r.anadida
          ? t("patients.consents.editor.templateAppended")
          : t("patients.consents.editor.templateApplied", { name: p.name }),
      );
      // Tras cargarla se sigue en la caja; con la plantilla añadida, al FINAL.
      requestAnimationFrame(() => {
        const c = caja.current;
        if (!c) return;
        c.focus();
        if (r.anadida) c.setSelectionRange(c.value.length, c.value.length);
        else c.setSelectionRange(0, 0);
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setTrayendo(false);
    }
  };

  async function crear() {
    setError(null);
    if (!acto.trim()) {
      setError(t("patients.consents.editor.missingProcedure"));
      campoActo.current?.focus();
      return;
    }
    if (!texto.trim()) {
      setError(t("patients.consents.editor.empty"));
      setViendo(false);
      requestAnimationFrame(() => caja.current?.focus());
      return;
    }
    if (porRepresentante && (!firmanteNombre.trim() || !firmanteRelacion.trim())) {
      setError(t("patients.consents.errorRepresentative"));
      return;
    }
    setGuardando(true);
    try {
      const out = await pedir<{ id: string; signUrl: string }>("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          // `templateId` solo viaja si el doctor usó una plantilla; sin ella la carta es libre.
          ...(plantillaUsada.current ? { templateId: plantillaUsada.current } : {}),
          doctorId: doctorId || undefined,
          // Se manda EXACTAMENTE el acto y el texto que la hoja está enseñando:
          // es el snapshot que firmará el paciente.
          procedure: acto.trim(),
          content: texto,
          signerName: porRepresentante ? firmanteNombre.trim() : undefined,
          signerRelation: porRepresentante ? firmanteRelacion.trim() : undefined,
        }),
      });
      await onCreado({ id: out.id, signUrl: out.signUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }

  const quieto = guardando || trayendo;

  return (
    <DocumentoRaiz className="space-y-3">
      {/* El aviso va ARRIBA y fuera de la hoja: se lee antes de escribir, no al crear. */}
      <ConsentMissingNotice missing={missing} patientId={patientId} />
      <DocumentoMesa>
        <div className={clasesDocumento.barra}>
          <ButtonNew variant="ghost" size="sm" onClick={() => void salir()}>
            <ArrowLeft size={14} aria-hidden /> {t("consentDoc.back")}
          </ButtonNew>
          <div className={clasesDocumento.barraAcciones}>
            <ButtonNew
              variant="primary"
              size="sm"
              disabled={quieto}
              onClick={() => void crear()}
              icon={guardando
                ? <Loader2 size={13} className="animate-spin" aria-hidden />
                : <Check size={13} aria-hidden />}
            >
              {t("patients.consents.createCta")}
            </ButtonNew>
          </div>
          {error ? (
            <p className={`${clasesDocumento.estado} ${clasesDocumento.estadoAviso}`} role="alert">{error}</p>
          ) : null}
        </div>

        {/* Quién responde y quién firma: son datos de la CABECERA y del pie, no del texto. */}
        <div className={s.ajustes}>
          <label className="field-new">
            <span className="field-new__label">{t("patients.consents.fieldDoctor")}</span>
            <select
              value={doctorId}
              disabled={quieto}
              onChange={(e) => setDoctorId(e.target.value)}
              className="input-new"
            >
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>
              ))}
            </select>
          </label>

          <label className={s.ajustesCasilla}>
            <input
              type="checkbox"
              checked={porRepresentante}
              disabled={menor || quieto}
              onChange={(e) => setPorRepresentante(e.target.checked)}
            />
            <span>
              <b>{t("patients.consents.fieldRepresentative")}</b>
              <br />
              {menor
                ? t("patients.consents.minorNotice", { age: edad ?? 0 })
                : t("patients.consents.representativeHint")}
            </span>
          </label>

          {porRepresentante ? (
            <div className={s.ajustesPar}>
              <label className="field-new">
                <span className="field-new__label">{t("patients.consents.fieldSignerName")}</span>
                <input
                  value={firmanteNombre}
                  // Mientras llega una plantilla, quieto: la plantilla se pidió con
                  // el representante de ESE momento y el pie de firma saldría con otro.
                  disabled={quieto}
                  onChange={(e) => setFirmanteNombre(e.target.value)}
                  className="input-new"
                  placeholder={t("patients.consents.signerNamePlaceholder")}
                />
              </label>
              <label className="field-new">
                <span className="field-new__label">{t("patients.consents.fieldSignerRelation")}</span>
                <input
                  value={firmanteRelacion}
                  disabled={quieto}
                  onChange={(e) => setFirmanteRelacion(e.target.value)}
                  className="input-new"
                  placeholder={t("patients.consents.signerRelationPlaceholder")}
                />
              </label>
            </div>
          ) : null}
        </div>

        <DocumentoHoja
          encabezado={encabezado}
          titulo={acto.trim() || t("patients.consents.editor.procedureFallback")}
          // Como la carta guardada (`ConsentHoja`): el título del propio texto va de sello.
          tipo={parseConsentText(texto).title || t("consentDoc.kind")}
          firmado={null}
        >
          <input
            ref={campoActo}
            type="text"
            value={acto}
            maxLength={MAX_ACTO}
            disabled={quieto}
            onChange={(ev) => {
              setActo(ev.target.value);
              tocado.current = true;
            }}
            placeholder={t("patients.consents.editor.procedurePlaceholder")}
            aria-label={t("patients.consents.editor.procedureLabel")}
            aria-required="true"
            className={clasesDocumento.tituloEditable}
          />
          <div
            className={`${clasesDocumento.herramientas} ${clasesDocumento.trasTitulo}`}
            role="toolbar"
            aria-label={t("patients.consents.editor.toolbar")}
          >
            <button
              type="button"
              className={`${clasesDocumento.herramienta} ${s.herramientaTexto}`}
              disabled={quieto || !texto.trim()}
              aria-pressed={viendo}
              onClick={() => setViendo((v) => !v)}
            >
              {viendo ? <Pencil size={15} aria-hidden /> : <Eye size={15} aria-hidden />}{" "}
              {viendo ? t("patients.consents.editor.write") : t("patients.consents.editor.preview")}
            </button>
            {trayendo ? <Loader2 size={15} className="animate-spin" aria-hidden style={{ alignSelf: "center" }} /> : null}
            <MenuPlantillas
              plantillas={plantillas ?? []}
              ocupado={quieto}
              etiqueta={t("patients.consents.editor.loadTemplate")}
              titulo={t("patients.consents.editor.templatesTitle")}
              onUsar={(p) => void cargarPlantilla(p)}
            />
          </div>
          {viendo ? (
            // La misma maqueta que la carta guardada (`ConsentHoja`): secciones y viñetas.
            <div className={`${clasesDocumento.cuerpoEditable} ${s.textoVista}`}>
              <DocumentoCuerpo html={consentTextToBodyHtml(texto)} />
            </div>
          ) : (
            <textarea
              ref={caja}
              value={texto}
              readOnly={quieto}
              onChange={(ev) => {
                setTexto(ev.target.value);
                tocado.current = true;
                textoDePlantilla.current = false;
              }}
              aria-label={t("patients.consents.editor.label")}
              placeholder={t("patients.consents.editor.placeholder")}
              className={`${clasesDocumento.cuerpo} ${clasesDocumento.cuerpoEditable} ${s.textoCarta}`}
            />
          )}
          {plantillas !== null && plantillas.length === 0 ? (
            <p className={clasesDocumento.pista}>{t("patients.consents.editor.templatesEmpty")}</p>
          ) : null}
          <p className={clasesDocumento.pista}>{t("patients.consents.editor.headerHint")}</p>
          <p className={clasesDocumento.pista}>{t("patients.consents.editor.signHint")}</p>
        </DocumentoHoja>
      </DocumentoMesa>
    </DocumentoRaiz>
  );
}
