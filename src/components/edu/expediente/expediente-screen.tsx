"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FilePlus2, PenLine, Send, Signature, Trash2, Undo2 } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { EduRetirados } from "@/components/edu/estudios/retirados";
import type { EduRetiradoRow } from "@/lib/edu/estudios-core";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_RECORD_DIAGNOSIS_MAX,
  EDU_RECORD_TEXT_MAX,
  EDU_SOAP_FIELDS,
  EDU_SOAP_HINTS,
  EDU_SOAP_LABELS,
  eduRecordCanTransition,
  eduRecordCanWithdraw,
  type EduCaseOption,
  type EduRecordRow,
  type EduSoapField,
} from "@/lib/edu/expediente-core";
import {
  EDU_RECORD_STATUS_DESCRIPTIONS,
  EDU_RECORD_STATUS_LABELS,
  type EduRecordStatus,
} from "@/lib/edu/types";
import type { EduIaEstado } from "@/lib/edu/ia-core";
import { EduDictadoMic } from "@/components/edu/expediente/dictado-mic";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";

/**
 * /instituto/pacientes/[id]/expediente — las notas clínicas.
 *
 * QUÉ DECIDE ESTA PANTALLA Y QUÉ NO:
 *  · NO decide qué notas se ven. Eso lo resolvió el servidor con el alcance
 *    del expediente (recurso "cases"): un alumno recibe las de SUS casos y
 *    aquí no hay forma de pedir más.
 *  · NO decide quién escribe. `canWrite` llega resuelto y el endpoint lo
 *    vuelve a exigir.
 *
 * 🔴 UNA NOTA FIRMADA NO SE EDITA — y la pantalla no ofrece el botón, pero
 * eso es cortesía: quien la cierra de verdad es el servidor, que rebota un
 * PATCH sobre una firmada con 409 aunque venga de la dirección. Aquí se
 * ofrece "Corregir", que abre una nota NUEVA apuntando a la anterior. Las
 * dos quedan, y ésa es la idea.
 */
export interface EduExpedienteScreenProps {
  patientId: string;
  patientName: string;
  rows: EduRecordRow[];
  /**
   * true = la consulta se topó con el techo y hay notas MÁS VIEJAS que no
   * viajaron. No es decoración: sin este aviso, un expediente de 240 notas
   * y uno de 200 se ven idénticos, y quien busca la primera sesión de un
   * caso largo concluye que nunca se escribió.
   */
  truncated: boolean;
  /** El techo, para poder decir el número en vez de "hay más". */
  maxRows: number;
  cases: EduCaseOption[];
  /**
   * H-20 · El caso por el que está filtrada la lista, o null = todas.
   *
   * Sale de `?caso=` y lo VALIDA el servidor contra los casos que le tocan
   * a quien mira: aquí llega o un id suyo o null. La pantalla no decide
   * qué se filtra, solo pinta el desplegable y navega.
   */
  casoFiltro: string | null;
  canWrite: boolean;
  /**
   * Cierre (P2-13): ¿puede FIRMAR (expediente.sign)? El alumno escribe y
   * ENTREGA; la firma es de su docente. Esconder el botón es cortesía —
   * quien cierra de verdad es el servidor, que rebota la FIRMADA sin la
   * key aunque la petición se fabrique a mano.
   */
  canSign: boolean;
  /** El id del EduUser de la sesión, para saber qué notas escribió. */
  meUserId: string;
  /**
   * Si el dictado por voz está disponible, y si no, POR QUÉ. Lo resuelve
   * el SERVIDOR (eduIaEstadoActual), y desde la Ola 8 eso incluye leer el
   * CUPO de IA del instituto y lo que lleva consumido del mes. El
   * navegador no puede decidirlo: ni ve `process.env` ni tiene por qué
   * consultar el presupuesto de la escuela. Llega ya decidido, con el
   * motivo escrito para una persona.
   */
  iaDictado: EduIaEstado;
  /**
   * Ola C·2 · LAS NOTAS RETIRADAS, con su motivo (N-16 en el expediente).
   *
   * 🔴 Un motivo que ninguna pantalla lee no es una constancia. Es
   * exactamente el hallazgo que se cerró en estudios y en fotos: se pedía
   * el motivo, se guardaba, y la única forma de leerlo era abrir Postgres.
   * Solo viajan para quien puede ESCRIBIR el expediente — quien no puede
   * retirar tampoco necesita el registro de quién retiró qué.
   */
  retiradas: EduRetiradoRow[];
}

const TAG_BY_STATUS: Record<EduRecordStatus, string> = {
  BORRADOR: "edu-tag--muted",
  ENVIADA: "edu-tag--warn",
  FIRMADA: "edu-tag--ok",
};

const CLASS_BY_STATUS: Record<EduRecordStatus, string> = {
  BORRADOR: "edu-nota--borrador",
  ENVIADA: "edu-nota--enviada",
  FIRMADA: "edu-nota--firmada",
};

type SoapDraft = Record<EduSoapField, string> & { diagnostico: string };

const DRAFT_VACIO: SoapDraft = {
  subjetivo: "",
  objetivo: "",
  analisis: "",
  plan: "",
  diagnostico: "",
};

export function EduExpedienteScreen({
  patientId,
  patientName,
  rows,
  truncated,
  maxRows,
  cases,
  casoFiltro,
  canWrite,
  canSign,
  meUserId,
  iaDictado,
  retiradas,
}: EduExpedienteScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, startNav] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nueva, setNueva] = useState<{ corrects: EduRecordRow | null } | null>(null);
  const [editar, setEditar] = useState<EduRecordRow | null>(null);
  /** S-1: la nota que se está a punto de firmar, esperando el "sí". */
  const [firmando, setFirmando] = useState<EduRecordRow | null>(null);
  /** H-23: el BORRADOR que se está a punto de retirar, esperando el "sí". */
  const [retirando, setRetirando] = useState<EduRecordRow | null>(null);
  /** Ola C·2: el motivo de ese retiro. OPCIONAL — ver el modal. */
  const [motivoRetiro, setMotivoRetiro] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const casosAbiertos = useMemo(() => cases.filter((c) => c.isOpen), [cases]);

  // Índice id → nota, para poder decir a QUÉ nota corrige una corrección.
  //
  // 🔴 Hace falta porque la lista va de la MÁS RECIENTE a la más vieja, y
  // una corrección es siempre posterior a lo que corrige: sale ARRIBA de su
  // nota. El sangrado sugiere "cuelga de la de encima", que es justo la de
  // al lado equivocada. Escribir la fecha de la nota corregida quita la
  // ambigüedad sin invertir el orden — que un expediente clínico se lee
  // empezando por lo último.
  const porId = useMemo(() => {
    const m = new Map<string, EduRecordRow>();
    for (const r of rows) m.set(r.id, r);
    return m;
  }, [rows]);

  function recargar(mensaje: string) {
    setFlash(mensaje);
    setError(null);
    startNav(() => router.refresh());
  }

  /** S-1: firmar no se dispara al primer clic; abre la confirmación. */
  function confirmarRetiro(nota: EduRecordRow) {
    setFlash(null);
    setError(null);
    setMotivoRetiro("");
    setRetirando(nota);
  }

  function confirmarFirma(nota: EduRecordRow) {
    setFlash(null);
    setError(null);
    setFirmando(nota);
  }

  /**
   * H-23 · RETIRA un BORRADOR. Baja lógica: la nota sale del expediente y
   * queda constancia de quién la sacó. El servidor rebota una ENVIADA o
   * una FIRMADA con 409 aunque se fabrique la petición a mano.
   */
  async function retirar(nota: EduRecordRow, motivo: string) {
    setError(null);
    setBusyId(nota.id);
    try {
      // 🔴 OLA C·2 · EL MOTIVO VIAJA Y ES OPCIONAL. La columna
      // (`edu_records.deleteReason`) llegó con el SQL de la Ola C; se PIDE
      // y no se EXIGE, porque retirar un borrador vacío no es un acto
      // clínico que haya que justificar por escrito y un campo obligatorio
      // en el sitio equivocado solo produce "asdf". Y ahora SE LEE, en la
      // sección «Retiradas»: un motivo que ninguna pantalla enseña no es
      // una constancia (N-16).
      await eduRequest(`/api/instituto/expediente/${nota.id}`, {
        method: "DELETE",
        body: { reason: motivo.trim() || undefined },
      });
      recargar(
        motivo.trim()
          ? "El borrador quedó retirado del expediente, con el motivo escrito."
          : "El borrador quedó retirado del expediente.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo retirar la nota.");
    } finally {
      setBusyId(null);
    }
  }

  /** Mueve una nota de estado (entregar, firmar, devolver). */
  async function mover(nota: EduRecordRow, to: EduRecordStatus, mensaje: string) {
    setError(null);
    setBusyId(nota.id);
    try {
      await eduRequest(`/api/instituto/expediente/${nota.id}`, {
        method: "PATCH",
        body: { status: to },
      });
      recargar(mensaje);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="edu-stack">
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {navigating
            ? "Actualizando…"
            : `${rows.length} ${rows.length === 1 ? "nota" : "notas"}${
                truncated ? ` (se muestran las ${maxRows} más recientes)` : ""
              }`}
        </span>

        {/* H-20 · EL FILTRO POR CASO QUE EL BANNER PROMETE.
            Navega con `?caso=`, que la API y la página ya leían. Antes el
            aviso de "filtra por caso para ver las notas viejas" mandaba a
            usar algo que no existía en ninguna pantalla. */}
        {cases.length > 1 && (
          <label className="edu-integ-filtro" htmlFor="edu-exp-filtro">
            <span className="edu-field__label">Caso</span>
            <select
              id="edu-exp-filtro"
              className="edu-input edu-input--sm"
              value={casoFiltro ?? ""}
              disabled={navigating}
              onChange={(e) => {
                const v = e.target.value;
                startNav(() =>
                  router.push(v ? `${pathname}?caso=${encodeURIComponent(v)}` : pathname, {
                    scroll: false,
                  }),
                );
              }}
            >
              <option value="">Todos los casos</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.programName} · {c.studentMatricula}
                  {c.isOpen ? "" : " (cerrado)"}
                </option>
              ))}
            </select>
          </label>
        )}

        {canWrite && (
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            onClick={() => {
              setFlash(null);
              setError(null);
              setNueva({ corrects: null });
            }}
            // 🔴 H-19 · Se cuentan los casos ABIERTOS, no los casos.
            // Con `cases.length` el botón se pintaba activo para un
            // paciente con un único caso ya cerrado: el modal abría, la
            // única opción del desplegable salía deshabilitada y "Guardar
            // borrador" quedaba muerto para siempre, sin un solo mensaje.
            disabled={casosAbiertos.length === 0}
          >
            <FilePlus2 size={16} />
            Nota nueva
          </button>
        )}
      </div>

      {/* El motivo se ESCRIBE, no se deja en un tooltip: en un teléfono no
          hay `hover`. Mismo patrón que la pestaña de WhatsApp. */}
      {canWrite && casosAbiertos.length === 0 && cases.length > 0 && (
        <p className="edu-note">
          No se puede escribir una nota nueva: este paciente no tiene ningún caso ABIERTO tuyo, y una
          nota clínica cuelga de un caso vivo. Sus notas viejas se siguen leyendo, y una nota firmada
          se corrige con otra desde su propia tarjeta. Si el paciente volvió, ábrele caso.
        </p>
      )}

      {truncated && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">
              Se muestran las {maxRows} notas más recientes, no todas.
            </p>
            <p className="edu-banner__detail">
              Este expediente tiene más historia de la que cabe en una pantalla. Filtra por caso
              para ver las notas viejas: dentro de un caso concreto entran completas. Se avisa
              porque un expediente que corta en silencio se lee como un expediente que no tiene
              esa nota.
            </p>
          </div>
        </div>
      )}

      {cases.length === 0 && (
        <div className="edu-empty">
          <p className="edu-empty__title">Este paciente todavía no tiene un caso tuyo</p>
          <p className="edu-empty__detail">
            Una nota clínica cuelga de un CASO —este paciente, contigo, en esta especialidad—
            porque es el registro de un acto clínico y un acto clínico tiene responsable. El caso se
            abre en la valoración.
          </p>
        </div>
      )}

      {cases.length > 0 && rows.length === 0 && (
        <div className="edu-empty">
          <p className="edu-empty__title">Todavía no hay notas</p>
          <p className="edu-empty__detail">
            Aquí queda lo que pasó en cada sesión, en formato SOAP y con el autor identificable.
            Una nota firmada ya no se edita: se corrige con una nota nueva.
          </p>
        </div>
      )}

      {rows.map((n) => {
        const mia = n.authorUserId === meUserId;
        const trabajando = busyId === n.id;
        const corregida = n.correctsId ? porId.get(n.correctsId) : null;
        return (
          <article
            key={n.id}
            className={`edu-nota ${CLASS_BY_STATUS[n.status]} ${n.correctsId ? "edu-nota--correccion" : ""}`}
          >
            <div className="edu-nota__head">
              <div>
                <span className="edu-nota__when">
                  {n.correctsId ? "Corrección · " : ""}
                  {n.appointmentLabel ?? n.createdLabel}
                </span>
                <span className="edu-nota__who">
                  {n.caseProgramName} ·{" "}
                  <EduPersonaLink kind="estudiante" id={n.studentId}>
                    {n.studentMatricula}
                  </EduPersonaLink>{" "}
                  · escribió {n.authorName} (
                  {n.authorRoleLabel}
                  {mia ? ", tú" : ""})
                </span>
                {n.correctsId && (
                  // La lista va de lo más nuevo a lo más viejo, así que una
                  // corrección sale ARRIBA de la nota que corrige. Sin esta
                  // línea, el sangrado la haría parecer hija de la de encima.
                  <span className="edu-nota__who">
                    Corrige la nota firmada
                    {corregida ? ` del ${corregida.appointmentLabel ?? corregida.createdLabel}` : ""}.
                    Aquella no se borró: se leen las dos.
                  </span>
                )}
              </div>
              <span className={`edu-tag ${TAG_BY_STATUS[n.status]}`}>
                {EDU_RECORD_STATUS_LABELS[n.status]}
              </span>
            </div>

            {n.diagnostico && (
              <div className="edu-nota__dx">
                <span className="edu-kv__k">Diagnóstico</span>
                <span className="edu-kv__v">{n.diagnostico}</span>
              </div>
            )}

            <dl className="edu-nota__soap">
              {EDU_SOAP_FIELDS.map((f) =>
                n[f] ? (
                  <div className="edu-nota__campo" key={f}>
                    <dt>{EDU_SOAP_LABELS[f]}</dt>
                    <dd>{n[f]}</dd>
                  </div>
                ) : null,
              )}
            </dl>

            <div className="edu-nota__foot">
              <span className="edu-nota__firma">
                {n.status === "FIRMADA"
                  ? `Firmada por ${n.signedByName ?? "—"}`
                  : EDU_RECORD_STATUS_DESCRIPTIONS[n.status]}
                {n.correctionsCount > 0
                  ? ` · ${n.correctionsCount} ${n.correctionsCount === 1 ? "corrección" : "correcciones"}`
                  : ""}
              </span>

              {canWrite && (
                <div className="edu-actions">
                  {/* Editar y entregar solo mientras se puede: el servidor
                      rebota igual, pero un botón que siempre falla es peor
                      que no tenerlo. */}
                  {n.status !== "FIRMADA" && (
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm"
                      onClick={() => {
                        setFlash(null);
                        setError(null);
                        setEditar(n);
                      }}
                      disabled={trabajando}
                    >
                      <PenLine size={15} />
                      Editar
                    </button>
                  )}

                  {eduRecordCanTransition(n.status, "ENVIADA") && (
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm"
                      onClick={() => mover(n, "ENVIADA", "La nota quedó entregada para revisión.")}
                      disabled={trabajando}
                    >
                      <Send size={15} />
                      Entregar
                    </button>
                  )}

                  {n.status === "ENVIADA" && (
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm"
                      onClick={() => mover(n, "BORRADOR", "La nota volvió a borrador.")}
                      disabled={trabajando}
                    >
                      <Undo2 size={15} />
                      Devolver
                    </button>
                  )}

                  {/* P2-13: firmar solo quien tiene expediente.sign. Al
                      alumno la pantalla le ofrece "Entregar" — su nota la
                      cierra el docente que responde por él.

                      🔴 S-1 · Y NO SOBRE UN BORRADOR AJENO. Firmar es
                      irreversible: la nota queda cerrada para siempre y a
                      partir de ahí solo se corrige con otra. Sobre un
                      BORRADOR de otra persona sería firmar algo que su
                      autor todavía está escribiendo y que ni siquiera ha
                      entregado — el docente cerraría a media frase lo que
                      su alumno pensaba terminar. Una ENVIADA sí: entregarla
                      ES pedir la firma. Y la propia, en cualquiera de los
                      dos estados: quien escribe y firma en un solo acto (la
                      dirección) no se está adelantando a nadie.

                      El servidor no lo rebota, y está bien: no es una fuga
                      ni un permiso que falte, es un botón que no se ofrece
                      donde no toca. */}
                  {canSign &&
                    eduRecordCanTransition(n.status, "FIRMADA") &&
                    (n.status === "ENVIADA" || mia) && (
                    <button
                      type="button"
                      className="edu-btn edu-btn--primary edu-btn--sm"
                      onClick={() => confirmarFirma(n)}
                      disabled={trabajando}
                    >
                      <Signature size={15} />
                      Firmar
                    </button>
                  )}

                  {n.status === "FIRMADA" && (
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm"
                      onClick={() => {
                        setFlash(null);
                        setError(null);
                        setNueva({ corrects: n });
                      }}
                      disabled={trabajando}
                    >
                      <PenLine size={15} />
                      Corregir
                    </button>
                  )}

                  {/* 🔴 H-23 · RETIRAR, y SOLO sobre un BORRADOR.
                      `eduRecordCanWithdraw` es la MISMA función que usa el
                      servidor: dos copias de esa regla es como se llega a
                      un botón que la pantalla ofrece y el endpoint rechaza.
                      Sobre una ENVIADA no se pinta a propósito —está en la
                      bandeja de un docente que puede haberla leído; se
                      devuelve primero— y sobre una FIRMADA no existe. */}
                  {eduRecordCanWithdraw(n.status) && (
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm edu-btn--danger"
                      onClick={() => confirmarRetiro(n)}
                      disabled={trabajando}
                    >
                      <Trash2 size={15} />
                      Retirar
                    </button>
                  )}
                </div>
              )}
            </div>
          </article>
        );
      })}

      {nueva && (
        <NotaNueva
          patientId={patientId}
          patientName={patientName}
          cases={cases}
          casosAbiertos={casosAbiertos}
          corrige={nueva.corrects}
          iaDictado={iaDictado}
          onClose={() => setNueva(null)}
          onDone={(msg) => {
            setNueva(null);
            recargar(msg);
          }}
        />
      )}

      {/* 🔴 S-1 · FIRMAR PIDE CONFIRMACIÓN. Era un clic suelto, sin vuelta
          atrás, entre otros tres botones del mismo tamaño y a un pixel del
          de "Devolver". Firmada, la nota ya no se edita ni se borra nunca:
          lo único que queda es escribir otra que la corrija, y las dos se
          leen para siempre. Un acto así no se hace sin decir que se hace. */}
      {firmando && (
        <EduModal
          title="Firmar la nota"
          subtitle={`${firmando.caseProgramName} · ${firmando.appointmentLabel ?? firmando.createdLabel}`}
          busy={busyId === firmando.id}
          onClose={() => setFirmando(null)}
          footer={
            <>
              <button
                type="button"
                className="edu-btn edu-btn--ghost"
                onClick={() => setFirmando(null)}
                disabled={busyId === firmando.id}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="edu-btn edu-btn--primary"
                onClick={() => {
                  const n = firmando;
                  setFirmando(null);
                  void mover(n, "FIRMADA", "La nota quedó firmada. Ya no se edita.");
                }}
                disabled={busyId === firmando.id}
              >
                <Signature size={15} />
                Sí, firmarla
              </button>
            </>
          }
        >
          <div className="edu-banner edu-banner--warn">
            <div>
              <p className="edu-banner__title">Esto no se deshace</p>
              <p className="edu-banner__detail">
                Al firmar, esta nota queda cerrada: no se vuelve a editar ni se borra, ni por la
                dirección. Si después hay algo que corregir, se escribe una nota NUEVA que apunte a
                ésta y en el expediente se leen las dos. Es la NOM-004.
              </p>
            </div>
          </div>
          <p className="edu-note">
            Firmas tú, y tu nombre queda en la nota:{" "}
            {firmando.authorUserId === meUserId
              ? "la escribiste tú."
              : `la escribió ${firmando.authorName}. Firmarla es hacerte responsable de lo que dice.`}
          </p>
        </EduModal>
      )}

      {/* 🔴 H-23 · RETIRAR PIDE CONFIRMACIÓN, y el modal dice las dos cosas
          que importan: que la nota sale del expediente, y que NO se borra.
          Lo segundo no es un detalle legal: es lo que evita que alguien
          use "Retirar" creyendo que hace desaparecer un error, y lo que
          responde después a "¿aquí había una nota?". */}
      {retirando && (
        <EduModal
          title="Retirar el borrador"
          subtitle={`${retirando.caseProgramName} · ${retirando.appointmentLabel ?? retirando.createdLabel}`}
          busy={busyId === retirando.id}
          onClose={() => setRetirando(null)}
          footer={
            <>
              <button
                type="button"
                className="edu-btn edu-btn--ghost"
                onClick={() => setRetirando(null)}
                disabled={busyId === retirando.id}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="edu-btn edu-btn--danger"
                onClick={() => {
                  const n = retirando;
                  const m = motivoRetiro;
                  setRetirando(null);
                  setMotivoRetiro("");
                  void retirar(n, m);
                }}
                disabled={busyId === retirando.id}
              >
                <Trash2 size={15} />
                Sí, retirarla
              </button>
            </>
          }
        >
          <div className="edu-banner edu-banner--warn">
            <div>
              <p className="edu-banner__title">Sale del expediente, pero no se borra</p>
              <p className="edu-banner__detail">
                El borrador deja de verse aquí, deja de contar como nota en el Resumen y deja de
                poder mandarse a autorizar. La fila se queda en la base con tu nombre y la fecha:
                un expediente del que se puede hacer desaparecer una página deja de ser el
                registro de lo que pasó. Esto es para el borrador que nunca debió existir —el que
                se abrió en el paciente equivocado, o el que quedó vacío—, no para deshacer
                trabajo hecho.
              </p>
            </div>
          </div>
          {/* 🔴 EL MOTIVO ES OPCIONAL, Y ESTÁ AQUÍ POR LO QUE DICE EL
              HINT. Exigirlo en el borrador vacío que alguien abrió de un
              doble clic solo produce "asdf"; ofrecerlo en el que se abrió
              en el paciente equivocado es lo que contesta la pregunta
              dentro de un año. Se lee después en «Retiradas». */}
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="retirar-motivo">
              ¿Por qué se retira? (opcional)
            </label>
            <textarea
              id="retirar-motivo"
              className="edu-input"
              rows={2}
              maxLength={500}
              value={motivoRetiro}
              onChange={(e) => setMotivoRetiro(e.target.value)}
              placeholder="Ej.: se abrió en el paciente equivocado · quedó vacía de un doble clic."
            />
            <span className="edu-field__hint">
              Queda escrito con tu nombre y la fecha, y se lee en la sección «Retiradas» de abajo.
            </span>
          </div>

          <p className="edu-note">
            Solo se retiran BORRADORES. Una nota entregada se devuelve primero a borrador; una
            firmada no se retira nunca: se corrige con una nota nueva y se leen las dos.
          </p>
        </EduModal>
      )}

      {/* ══ N-16 · «RETIRADAS» ═════════════════════════════════════════
          El MISMO componente que Estudios y Fotos, y el mismo criterio: va
          PLEGADA, porque lo retirado no es parte del expediente vivo — si
          se pintara abierto, la pestaña empezaría por lo que ya no está. Se
          abre cuando alguien pregunta «¿y la nota de ayer?», que es
          exactamente cuando hace falta.

          🔴 El QUÉ de cada renglón NO es el texto de la nota: es de qué
          caso era y de cuándo. Esta sección la ve todo el que ve el
          expediente y una SOAP es dato clínico; lo que hace falta aquí es
          identificar la nota, no volver a contarla. */}
      {canWrite && retiradas.length > 0 && (
        <EduRetirados
          rows={retiradas}
          titulo="Retiradas"
          vacio="Ninguna nota se ha retirado de este expediente."
          detalle="Borradores que alguien sacó del expediente. La fila no se borró: queda con quién la retiró, cuándo y por qué. Una nota entregada se devuelve primero a borrador; una firmada no se retira nunca."
        />
      )}

      {editar && (
        <NotaEditar
          nota={editar}
          canSign={canSign}
          iaDictado={iaDictado}
          onClose={() => setEditar(null)}
          onDone={(msg) => {
            setEditar(null);
            recargar(msg);
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// El formulario SOAP, compartido por el alta y la edición
// ═══════════════════════════════════════════════════════════════════════

/**
 * Agrega lo dictado AL FINAL de lo que ya había, sin pisarlo.
 *
 * 🔴 Nunca reemplaza. Un dictado que borra el párrafo que el alumno acababa
 * de teclear es la forma más rápida de que nadie vuelva a tocar el
 * micrófono. Se separa con un espacio si el campo tenía algo, y el tope del
 * campo se respeta aquí y no en el `maxLength` del textarea, que no aplica a
 * un cambio por código.
 */
function agregarDictado(actual: string, dictado: string, max: number): string {
  const base = actual.trimEnd();
  const junto = base ? `${base} ${dictado}` : dictado;
  return junto.slice(0, max);
}

function CamposSoap({
  draft,
  setDraft,
  disabled,
  idPrefix,
  iaDictado,
  caseId,
}: {
  draft: SoapDraft;
  setDraft: (d: SoapDraft) => void;
  disabled: boolean;
  idPrefix: string;
  iaDictado: EduIaEstado;
  /**
   * Ola 8: a qué CASO se le imputa el gasto del dictado. Viaja solo para
   * el libro de consumo de IA —no cambia lo que se transcribe— y el
   * servidor lo vuelve a comprobar dentro del alcance antes de guardarlo.
   * null en una nota que todavía no tiene caso elegido: se dicta igual.
   */
  caseId: string | null;
}) {
  return (
    <>
      <div className="edu-field">
        <div className="edu-field__head">
          <label className="edu-field__label" htmlFor={`${idPrefix}-dx`}>
            Diagnóstico
          </label>
          <EduDictadoMic
            estado={iaDictado}
            caseId={caseId}
            disabled={disabled}
            onText={(t) =>
              setDraft({
                ...draft,
                diagnostico: agregarDictado(draft.diagnostico, t, EDU_RECORD_DIAGNOSIS_MAX),
              })
            }
          />
        </div>
        <input
          id={`${idPrefix}-dx`}
          className="edu-input"
          value={draft.diagnostico}
          maxLength={EDU_RECORD_DIAGNOSIS_MAX}
          onChange={(e) => setDraft({ ...draft, diagnostico: e.target.value })}
          disabled={disabled}
          autoComplete="off"
        />
      </div>

      {EDU_SOAP_FIELDS.map((f) => (
        <div className="edu-field" key={f}>
          {/* El micrófono va POR CAMPO y no uno solo arriba: el SOAP son
              cuatro apartados distintos y un dictado que cae siempre en el
              mismo sitio obligaría a cortar y pegar cuatro veces. */}
          <div className="edu-field__head">
            <label className="edu-field__label" htmlFor={`${idPrefix}-${f}`}>
              {EDU_SOAP_LABELS[f]}
            </label>
            <EduDictadoMic
              estado={iaDictado}
              caseId={caseId}
              disabled={disabled}
              onText={(t) =>
                setDraft({ ...draft, [f]: agregarDictado(draft[f], t, EDU_RECORD_TEXT_MAX) })
              }
            />
          </div>
          <textarea
            id={`${idPrefix}-${f}`}
            className="edu-input"
            rows={3}
            value={draft[f]}
            maxLength={EDU_RECORD_TEXT_MAX}
            onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
            disabled={disabled}
          />
          <span className="edu-field__hint">{EDU_SOAP_HINTS[f]}</span>
        </div>
      ))}
    </>
  );
}

function tieneAlgo(d: SoapDraft): boolean {
  return EDU_SOAP_FIELDS.some((f) => d[f].trim().length > 0) || d.diagnostico.trim().length > 0;
}

// ═══════════════════════════════════════════════════════════════════════
// Alta
// ═══════════════════════════════════════════════════════════════════════

function NotaNueva({
  patientId,
  patientName,
  cases,
  casosAbiertos,
  corrige,
  iaDictado,
  onClose,
  onDone,
}: {
  patientId: string;
  patientName: string;
  cases: EduCaseOption[];
  casosAbiertos: EduCaseOption[];
  corrige: EduRecordRow | null;
  iaDictado: EduIaEstado;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  // Corregir es una nota del MISMO caso, y no se elige: dejar cambiarlo
  // convertiría "corrección de la nota X" en "nota suelta que dice que
  // corrige a X", que es otra cosa.
  const casoFijo = corrige?.caseId ?? null;
  const [caseId, setCaseId] = useState(
    casoFijo ?? (casosAbiertos.length === 1 ? casosAbiertos[0].id : ""),
  );
  const [draft, setDraft] = useState<SoapDraft>(DRAFT_VACIO);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/pacientes/${patientId}/expediente`, {
        method: "POST",
        body: {
          caseId: casoFijo ?? caseId,
          correctsId: corrige?.id,
          subjetivo: draft.subjetivo.trim() || null,
          objetivo: draft.objetivo.trim() || null,
          analisis: draft.analisis.trim() || null,
          plan: draft.plan.trim() || null,
          diagnostico: draft.diagnostico.trim() || null,
        },
      });
      onDone(
        corrige
          ? "La corrección quedó guardada como borrador. Fírmala cuando esté lista."
          : "La nota quedó guardada como borrador.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={corrige ? "Corregir una nota firmada" : "Nota clínica nueva"}
      subtitle={
        <EduPersonaLink kind="paciente" id={patientId}>
          {patientName}
        </EduPersonaLink>
      }
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="edu-btn edu-btn--primary"
            onClick={guardar}
            disabled={busy || !(casoFijo ?? caseId) || !tieneAlgo(draft)}
          >
            {busy ? "Guardando…" : "Guardar borrador"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {corrige && (
        <div className="edu-banner edu-banner--warn">
          <div>
            <p className="edu-banner__title">Esto NO borra la nota anterior</p>
            <p className="edu-banner__detail">
              Una nota firmada no se edita ni se elimina: queda tal cual y esta nueva se guarda
              apuntando a ella. En el expediente se leerán las dos, en ese orden. Es la NOM-004, y
              es lo mismo que hacer una anotación aclaratoria en papel.
            </p>
          </div>
        </div>
      )}

      {!casoFijo && (
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-nota-caso">
            Caso
          </label>
          <select
            id="edu-nota-caso"
            className="edu-input"
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
          >
            <option value="">Elige el caso</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.isOpen}>
                {c.programName} · {c.studentMatricula}
                {c.isOpen ? "" : " (cerrado)"}
              </option>
            ))}
          </select>
          <span className="edu-field__hint">
            La nota cuelga del caso, no del paciente: es el registro de un acto clínico y un acto
            clínico tiene responsable.
          </span>
        </div>
      )}

      <CamposSoap
        draft={draft}
        setDraft={setDraft}
        disabled={busy}
        idPrefix="edu-nueva"
        iaDictado={iaDictado}
        caseId={casoFijo ?? caseId ?? null}
      />
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Edición
// ═══════════════════════════════════════════════════════════════════════

function NotaEditar({
  nota,
  canSign,
  iaDictado,
  onClose,
  onDone,
}: {
  nota: EduRecordRow;
  canSign: boolean;
  iaDictado: EduIaEstado;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [draft, setDraft] = useState<SoapDraft>({
    subjetivo: nota.subjetivo ?? "",
    objetivo: nota.objetivo ?? "",
    analisis: nota.analisis ?? "",
    plan: nota.plan ?? "",
    diagnostico: nota.diagnostico ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(firmar: boolean) {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/expediente/${nota.id}`, {
        method: "PATCH",
        body: {
          subjetivo: draft.subjetivo.trim() || null,
          objetivo: draft.objetivo.trim() || null,
          analisis: draft.analisis.trim() || null,
          plan: draft.plan.trim() || null,
          diagnostico: draft.diagnostico.trim() || null,
          // El texto y la firma van en la MISMA petición cuando se firma:
          // guardar y firmar por separado deja una ventana en la que la
          // nota quedó firmada con el texto viejo si la segunda falla.
          ...(firmar ? { status: "FIRMADA" } : {}),
        },
      });
      onDone(firmar ? "La nota quedó firmada. Ya no se edita." : "La nota quedó guardada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Editar la nota"
      subtitle={`${nota.caseProgramName} · ${EDU_RECORD_STATUS_LABELS[nota.status]}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          {/* 🔴 H-23 · EXIGE CONTENIDO, igual que el "Guardar borrador" del
              alta y que "Guardar y firmar" de al lado. Con `disabled={busy}`
              a secas se podía vaciar una nota entera y guardarla: quedaba
              una tarjeta permanente, sin diagnóstico y sin SOAP, en el
              expediente del paciente. Y no se podía quitar — no hay borrado
              de notas y `createEduRecord` se niega a corregir lo que no
              está FIRMADA, así que vaciarla era el único "remedio" y dejaba
              exactamente eso. */}
          <button
            type="button"
            className={`edu-btn ${canSign ? "edu-btn--ghost" : "edu-btn--primary"}`}
            onClick={() => guardar(false)}
            disabled={busy || !tieneAlgo(draft)}
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
          {/* P2-13: "Guardar y firmar" solo con expediente.sign. El texto y
              la firma van juntos en la MISMA petición (ver guardar). Sin la
              key, "Guardar" pasa a ser el botón primario y la nota se
              entrega con "Entregar" desde la lista. */}
          {canSign && (
            <button
              type="button"
              className="edu-btn edu-btn--primary"
              onClick={() => guardar(true)}
              disabled={busy || !tieneAlgo(draft)}
            >
              Guardar y firmar
            </button>
          )}
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}
      <p className="edu-note">
        {canSign
          ? "Al firmar, esta nota queda cerrada: no se vuelve a editar ni a borrar. Si después hay algo que corregir, se escribe una nota nueva que apunte a ésta."
          : "Cuando esté lista, entrégala desde la lista de notas: la firma tu docente, y firmada ya no se edita."}
      </p>
      {!tieneAlgo(draft) && (
        <p className="edu-note">
          Escribe algo antes de guardar. Una nota clínica no se puede dejar en blanco: en este
          expediente las notas no se borran, así que una vacía se queda para siempre en la historia
          del paciente sin decir nada.
        </p>
      )}
      <CamposSoap
        draft={draft}
        setDraft={setDraft}
        disabled={busy}
        idPrefix="edu-editar"
        iaDictado={iaDictado}
        caseId={nota.caseId ?? null}
      />
    </EduModal>
  );
}
