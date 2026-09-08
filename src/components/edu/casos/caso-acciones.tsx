"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { eduRequest } from "@/components/edu/edu-http";
import { EduModal } from "@/components/edu/edu-modal";
import { EDU_APPROVAL_NOTE_MIN, type EduApprovalRow } from "@/lib/edu/autorizaciones-core";
import type { EduSupervisorOption } from "@/lib/edu/agenda-core";
import type { EduCaseStatus } from "@/lib/edu/types";

/**
 * LAS ACCIONES DEL CASO, en su ficha (ola de Casos).
 *
 * Hasta esta ola, desde el caso no se podía HACER nada: el gate de la
 * Ola 4 existía en el servidor y ninguna pantalla mandaba `{ status }` —
 * los casos se quedaban en "Asignado" para siempre. Aquí viven:
 *
 *   · INICIAR TRATAMIENTO / DAR DE ALTA — el PATCH que dispara el gate.
 *     El botón solo se pinta ACTIVO cuando la puerta ya está firmada; si
 *     falta la firma, se dice qué falta en vez de pintar un botón que va
 *     a rebotar con 409.
 *   · PAUSAR / REANUDAR / MARCAR ABANDONADO — sin firma, a propósito
 *     (pedir permiso para PARAR es cómo nadie registra que paró).
 *   · FIRMAR — decidir una autorización PENDIENTE sin ir a la bandeja.
 *     Lo propio no se ofrece (nadie firma su propia petición) MENOS a la
 *     dirección, que está exenta por rol y firma lo suyo dejándolo
 *     marcado; y la RECETA tampoco (pide cédula: se firma en la bandeja,
 *     que tiene ese campo).
 *   · REGISTRAR SESIÓN — una nota SOAP que nace BORRADOR en el
 *     expediente, colgada de ESTE caso.
 *   · TRASPASAR — cierra este caso como TRANSFERRED y abre uno nuevo con
 *     el alumno destino (el servidor exige misma especialidad, y desde
 *     H-39 el `<select>` ya solo ofrece los que la cumplen).
 *   · PRESUPUESTAR — el POST a /api/instituto/presupuestos con este
 *     `caseId`, que lleva al presupuesto recién creado. Solo lo ve quien
 *     puede armar dinero (`caja.charge` + el alcance de "charges"), que en
 *     esta pantalla es la DIRECCIÓN: caja no ve casos, y por eso el botón
 *     tiene que vivir aquí y no en la pantalla de Presupuestos.
 *   · CAMBIAR EL DOCENTE RESPONSABLE (H-34) — el PATCH de
 *     `supervisorUserId`, que el core aceptaba desde la Ola 2 y que
 *     ninguna pantalla mandaba: un caso abierto con el docente equivocado
 *     se quedaba así para siempre.
 *
 * ⚠️ Cada `can*` viene DERIVADO DEL SERVIDOR (permiso + estado): esconder
 * no cierra nada — el candado es el guard de cada endpoint — pero a nadie
 * se le pinta un botón que va a rebotar con 403.
 */
export interface EduCasoAccionesProps {
  caseId: string;
  patientId: string;
  caseLabel: string;
  status: EduCaseStatus;
  cerrado: boolean;
  /** ¿La puerta del PLAN ya está firmada? (verdict del gate, del server). */
  gatePlanOk: boolean;
  /** ¿La puerta del ALTA ya está firmada? */
  gateAltaOk: boolean;
  canMoverEstado: boolean;
  canRegistrarSesion: boolean;
  canTraspasar: boolean;
  canFirmar: boolean;
  /** Las PENDIENTES del caso (sin recetas), tal como las armó el server. */
  pendientes: EduApprovalRow[];
  /**
   * H-39 · La especialidad DEL CASO. El filtro del `<select>` de traspaso
   * vive aquí dentro y no en la página a propósito: es UN solo sitio y
   * vale para cualquier página que monte este componente. El servidor
   * sigue siendo el candado —`/api/instituto/traspasos` exige que
   * coincidan— y esto solo evita ofrecer lo que va a rebotar.
   */
  programId: string;
  programName: string;
  alumnosDestino: { id: string; matricula: string; name: string; programId: string }[];
  /**
   * H-34 · Los docentes del instituto, para CORREGIR el responsable.
   * Llega vacío si quien mira no tiene `casos.assign` — que es el mismo
   * permiso que exige el PATCH.
   */
  docentes: EduSupervisorOption[];
  supervisorUserId: string | null;
  supervisorName: string | null;
  /**
   * ¿Puede armar dinero? (`caja.charge` MÁS el alcance de "charges", los
   * dos comprobados en el servidor). El botón «Presupuestar» de este caso.
   */
  canPresupuestar: boolean;
}

type Decision = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

export function EduCasoAcciones({
  caseId,
  patientId,
  caseLabel,
  status,
  cerrado,
  gatePlanOk,
  gateAltaOk,
  canMoverEstado,
  canRegistrarSesion,
  canTraspasar,
  canFirmar,
  pendientes,
  programId,
  programName,
  alumnosDestino,
  docentes,
  supervisorUserId,
  supervisorName,
  canPresupuestar,
}: EduCasoAccionesProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Confirmación en dos pasos para lo que no tiene vuelta fácil
  // (abandonar). Sin window.confirm: un diálogo del navegador no explica
  // nada y no se puede leer con calma en un teléfono.
  // "REOPEN" no es un estado del caso: es la confirmación de reabrirlo
  // (H-36), que aterriza en ASSIGNED.
  const [confirmando, setConfirmando] = useState<EduCaseStatus | "REOPEN" | null>(null);

  const [modalSesion, setModalSesion] = useState(false);
  const [subjetivo, setSubjetivo] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [analisis, setAnalisis] = useState("");
  const [plan, setPlan] = useState("");

  const [modalTraspaso, setModalTraspaso] = useState(false);
  const [destino, setDestino] = useState("");
  const [motivoTraspaso, setMotivoTraspaso] = useState("");

  // H-34 · corregir el docente responsable del caso.
  const [modalDocente, setModalDocente] = useState(false);
  const [docenteNuevo, setDocenteNuevo] = useState(supervisorUserId ?? "");

  // La decisión de una pendiente: cuál está abierta y qué se escribe.
  const [decidiendo, setDecidiendo] = useState<string | null>(null);
  const [nota, setNota] = useState("");

  async function moverEstado(nuevo: EduCaseStatus, mensaje: string) {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/casos/${caseId}`, {
        method: "PATCH",
        body: { status: nuevo },
      });
      setFlash(mensaje);
      setConfirmando(null);
      startNav(() => router.refresh());
    } catch (err) {
      // El 409 del gate llega con su texto ("Falta la autorización de…"):
      // se enseña tal cual, que para eso está escrito.
      setError(err instanceof Error ? err.message : "No se pudo mover el caso.");
      setConfirmando(null);
    } finally {
      setBusy(false);
    }
  }

  async function registrarSesion() {
    setError(null);
    if (!subjetivo.trim() && !objetivo.trim() && !analisis.trim() && !plan.trim()) {
      setError("Escribe al menos un campo de la nota: una sesión sin nada escrito no se registra.");
      return;
    }
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/pacientes/${patientId}/expediente`, {
        method: "POST",
        body: { caseId, subjetivo, objetivo, analisis, plan },
      });
      setModalSesion(false);
      setSubjetivo("");
      setObjetivo("");
      setAnalisis("");
      setPlan("");
      setFlash(
        "Sesión registrada como nota en BORRADOR. Desde la pestaña Expediente se envía y se firma.",
      );
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la sesión.");
    } finally {
      setBusy(false);
    }
  }

  async function traspasar() {
    setError(null);
    if (!destino) {
      setError("Elige al estudiante que recibe el caso.");
      return;
    }
    setBusy(true);
    try {
      await eduRequest("/api/instituto/traspasos", {
        method: "POST",
        body: { caseId, toStudentId: destino, reason: motivoTraspaso.trim() || undefined },
      });
      setModalTraspaso(false);
      setFlash(
        "Caso traspasado: éste queda como Transferido y el estudiante nuevo abre el suyo con el mismo paciente.",
      );
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo traspasar el caso.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════════
   * PRESUPUESTAR ESTE CASO.
   *
   * 🔴 POR QUÉ EL BOTÓN VIVE AQUÍ Y NO EN LA PANTALLA DE PRESUPUESTOS.
   * `POST /api/instituto/presupuestos` acepta `caseId` desde la C·2, pero
   * la pantalla de Caja no puede ofrecer un selector de casos: CAJA NO VE
   * CASOS, y esa es una línea del contrato escrita desde la Ola 2
   * (visibility.ts, recurso "cases" → "none" para caja). El botón tiene
   * que salir de donde el caso SE VE, que es esta ficha.
   *
   * Consecuencia, y es la correcta: en esta pantalla el botón solo le sale
   * a la DIRECCIÓN, que es la única que ve un caso Y arma dinero.
   *
   * NO se mandan partidas: las siembra el servidor con el procedimiento
   * principal del caso y su precio de la tarifa DEL PACIENTE. Un precio
   * calculado en el navegador es un precio que el navegador puede cambiar.
   * ═══════════════════════════════════════════════════════════════════
   */
  async function presupuestar() {
    setError(null);
    setBusy(true);
    try {
      const r = await eduRequest<{ folio: string }>("/api/instituto/presupuestos", {
        method: "POST",
        body: {
          patientId,
          caseId,
          notes: `Sale del caso «${caseLabel}».`,
        },
      });
      setFlash(`Quedó el presupuesto ${r.folio}. Te llevamos a él.`);
      // El filtro por folio deja UNO en la lista: presentarlo y aceptarlo
      // se hace allí, que es el paso siguiente de quien acaba de pulsar.
      router.push(`/instituto/caja/presupuestos?q=${encodeURIComponent(r.folio)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el presupuesto.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * H-34 · CORREGIR EL DOCENTE RESPONSABLE.
   *
   * El core (`updateEduCase`) aceptaba `supervisorUserId` desde la Ola 2 —
   * comprueba que sea DOCENTE de este instituto y que esté vigente— y el
   * endpoint le pasa el body entero. Lo que faltaba era la pantalla: un
   * caso abierto en el tamizaje con el docente equivocado no se corregía
   * por ninguna vía, y el nombre mal puesto es el que firma las
   * autorizaciones del alumno.
   *
   * Cadena vacía = quitarlo, que el core traduce a NULL. Se ofrece a
   * propósito: un caso sin responsable se ve, y uno con el responsable
   * equivocado no.
   */
  async function cambiarDocente() {
    setError(null);
    if (docenteNuevo === (supervisorUserId ?? "")) {
      setError("Ese ya es el docente responsable del caso.");
      return;
    }
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/casos/${caseId}`, {
        method: "PATCH",
        body: { supervisorUserId: docenteNuevo || null },
      });
      setModalDocente(false);
      setFlash(
        docenteNuevo
          ? "Docente responsable corregido. Queda registrado en la bitácora del caso."
          : "El caso se quedó sin docente responsable. Asígnale uno antes de que pida autorización.",
      );
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar el docente responsable.");
    } finally {
      setBusy(false);
    }
  }

  async function decidir(approvalId: string, decision: Decision) {
    setError(null);
    if (decision !== "APPROVED" && nota.trim().length < EDU_APPROVAL_NOTE_MIN) {
      setError(
        "Escribe el motivo (mínimo " +
          EDU_APPROVAL_NOTE_MIN +
          " caracteres): un rechazo sin motivo deja al estudiante adivinando.",
      );
      return;
    }
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/autorizaciones/${approvalId}`, {
        method: "PATCH",
        body: { decision, note: nota.trim() || undefined },
      });
      setDecidiendo(null);
      setNota("");
      setFlash(
        decision === "APPROVED"
          ? "Firmado. El estudiante ya puede avanzar con lo autorizado."
          : "Decisión registrada con tu motivo.",
      );
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la decisión.");
    } finally {
      setBusy(false);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 🔴 H-39 — EL DESTINO DEL TRASPASO, SOLO DE LA MISMA ESPECIALIDAD.
  //
  // `/api/instituto/traspasos` lo exige y contesta 409 si no coincide,
  // pero el `<select>` ofrecía el padrón entero que le tocara a quien
  // mira: dirección veía a los 200 alumnos del instituto y elegía entre
  // ellos, y solo al pulsar "Traspasar" —con el modal ya lleno y el motivo
  // escrito— descubría que ese alumno es de otra especialidad.
  //
  // Se filtra AQUÍ y no en la página porque es un solo sitio para
  // cualquier página que monte este componente. El candado sigue siendo el
  // servidor; esto es no ofrecer lo que va a rebotar.
  // ═══════════════════════════════════════════════════════════════════
  const destinos = alumnosDestino.filter((a) => a.programId === programId);

  const firmables = canFirmar
    ? // Lo PROPIO no se ofrece SALVO a la dirección: el server marca con
      // batchSkip "propia" (rol + id de la sesión) lo que quien mira no
      // puede firmar, y a la dirección ya no se lo marca. La RECETA se
      // firma en la bandeja, donde está el campo de la cédula.
      pendientes.filter((p) => p.stage !== "PRESCRIPTION")
    : [];

  // H-34: corregir el responsable NO se ofrece en un caso cerrado, igual
  // que el resto de la barra — un caso terminado es historia, y su
  // responsable de entonces es parte de esa historia. Se corrige mientras
  // está vivo, que es cuando el error todavía hace daño.
  const puedeCambiarDocente = canMoverEstado && docentes.length > 0;

  const hayAcciones =
    (!cerrado && (canMoverEstado || canRegistrarSesion || canTraspasar || canPresupuestar)) ||
    firmables.length > 0;
  if (!hayAcciones && !flash && !error) return null;

  return (
    <div className="edu-caso-acciones">
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

      {/* ── Firmar lo pendiente, sin ir a la bandeja ──────────────────── */}
      {firmables.length > 0 && (
        <ul className="edu-caso-firmas">
          {firmables.map((p) => (
            <li key={p.id} className="edu-caso-firmas__item">
              <div className="edu-caso-firmas__que">
                <strong>{p.stageLabel}</strong>
                {p.isEmergency ? " · URGENCIA" : ""} · pedida por {p.requestedByName} el{" "}
                {p.requestedAtLabel}
                <span className="edu-caso-firmas__detalle">{p.summary.title}</span>
                {/* La dirección SÍ puede decidir lo suyo. Se le dice aquí
                    lo mismo que en la bandeja: firmarla la deja marcada. */}
                {p.own && p.batchSkip !== "propia" && (
                  <span className="edu-caso-firmas__detalle">
                    La mandaste tú. Al decidirla quedará marcada como una petición propia.
                  </span>
                )}
              </div>
              {p.batchSkip === "propia" ? (
                <p className="edu-note">La mandaste tú: la firma tu docente supervisor.</p>
              ) : decidiendo === p.id ? (
                <div className="edu-caso-firmas__decidir">
                  <textarea
                    className="edu-input"
                    rows={2}
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    placeholder="Motivo (obligatorio para pedir cambios o rechazar)"
                  />
                  <div className="edu-form-acciones">
                    <button
                      type="button"
                      className="edu-btn edu-btn--quiet edu-btn--sm"
                      disabled={busy}
                      onClick={() => {
                        setDecidiendo(null);
                        setNota("");
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm"
                      disabled={busy}
                      onClick={() => decidir(p.id, "REJECTED")}
                    >
                      Rechazar
                    </button>
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm"
                      disabled={busy}
                      onClick={() => decidir(p.id, "CHANGES_REQUESTED")}
                    >
                      Pedir cambios
                    </button>
                    <button
                      type="button"
                      className="edu-btn edu-btn--primary edu-btn--sm"
                      disabled={busy}
                      onClick={() => decidir(p.id, "APPROVED")}
                    >
                      Autorizar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="edu-btn edu-btn--primary edu-btn--sm"
                  disabled={busy}
                  onClick={() => {
                    setDecidiendo(p.id);
                    setNota("");
                    setError(null);
                  }}
                >
                  Firmar / decidir
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ── Mover el caso: los botones del gate ───────────────────────── */}
      {!cerrado && (
        <div className="edu-caso-acciones__fila">
          {canMoverEstado && (status === "ASSIGNED" || status === "SCREENING") && (
            <>
              {gatePlanOk ? (
                <button
                  type="button"
                  className="edu-btn edu-btn--primary edu-btn--sm"
                  disabled={busy}
                  onClick={() =>
                    moverEstado("IN_TREATMENT", "El caso pasó a EN TRATAMIENTO con su plan firmado.")
                  }
                >
                  Iniciar tratamiento
                </button>
              ) : (
                <span className="edu-note">
                  {/* 🔴 OLA C · H-45 — el estudiante puede no existir ya. Si
                      se dio de baja, el docente lee "el estudiante lo
                      manda" y NO puede hacerlo él: no lleva
                      "autorizaciones.request" por diseño. Quien sí puede es
                      la dirección, y eso no estaba escrito en ninguna
                      parte. El repo tomó esta misma decisión para el
                      mensaje del gate (autorizaciones-core.ts). */}
                  Para iniciar el tratamiento falta el plan autorizado — lo manda el estudiante con
                  «Enviar a autorización», aquí arriba. Si ya no está activo, quien puede mandarlo
                  es la dirección.
                </span>
              )}
            </>
          )}

          {canMoverEstado && status === "IN_TREATMENT" && (
            <>
              {gateAltaOk ? (
                <button
                  type="button"
                  className="edu-btn edu-btn--primary edu-btn--sm"
                  disabled={busy}
                  onClick={() =>
                    moverEstado("COMPLETED", "Caso TERMINADO. Su alta quedó firmada y con fecha.")
                  }
                >
                  Dar de alta
                </button>
              ) : (
                <span className="edu-note">
                  Para dar de alta falta la autorización del alta — la manda el estudiante con
                  «Enviar a autorización», aquí arriba. Si ya no está activo, quien puede mandarla
                  es la dirección.
                </span>
              )}
              <button
                type="button"
                className="edu-btn edu-btn--ghost edu-btn--sm"
                disabled={busy}
                onClick={() => moverEstado("ON_HOLD", "El caso quedó EN PAUSA.")}
              >
                Pausar
              </button>
            </>
          )}

          {canMoverEstado && status === "ON_HOLD" && (
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-btn--sm"
              disabled={busy}
              onClick={() => moverEstado("IN_TREATMENT", "El caso volvió a EN TRATAMIENTO.")}
            >
              Reanudar tratamiento
            </button>
          )}

          {canMoverEstado &&
            (confirmando === "ABANDONED" ? (
              <span className="edu-caso-acciones__confirm">
                ¿Marcar ABANDONADO? El paciente dejó de venir; el caso se cierra sin alta.
                <button
                  type="button"
                  className="edu-btn edu-btn--danger edu-btn--sm"
                  disabled={busy}
                  onClick={() =>
                    moverEstado("ABANDONED", "Caso marcado como ABANDONADO. Reabrirlo es posible si el paciente vuelve.")
                  }
                >
                  Sí, marcarlo
                </button>
                <button
                  type="button"
                  className="edu-btn edu-btn--quiet edu-btn--sm"
                  disabled={busy}
                  onClick={() => setConfirmando(null)}
                >
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="edu-btn edu-btn--quiet edu-btn--sm"
                disabled={busy}
                onClick={() => setConfirmando("ABANDONED")}
              >
                Marcar abandonado
              </button>
            ))}

          {canRegistrarSesion && (
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              disabled={busy}
              onClick={() => {
                setModalSesion(true);
                setError(null);
              }}
            >
              Registrar sesión
            </button>
          )}

          {canTraspasar && (
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              disabled={busy}
              onClick={() => {
                setModalTraspaso(true);
                setDestino("");
                setMotivoTraspaso("");
                setError(null);
              }}
            >
              Traspasar
            </button>
          )}

          {/* Presupuestar el caso. Va junto a Traspasar y no arriba con
              los estados: no mueve el caso, abre un papel al lado. */}
          {canPresupuestar && (
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              disabled={busy}
              onClick={() => void presupuestar()}
            >
              Presupuestar
            </button>
          )}

          {/* H-34 · el docente responsable, corregible. El rótulo dice
              "Cambiar docente" y no "Reasignar": reasignar es lo que se
              hace en Estudiantes con la supervisión del ALUMNO, y son dos
              cosas distintas — un caso puede tener otro responsable que el
              titular del alumno. */}
          {puedeCambiarDocente && (
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              disabled={busy}
              onClick={() => {
                setModalDocente(true);
                setDocenteNuevo(supervisorUserId ?? "");
                setError(null);
              }}
            >
              Cambiar docente
            </button>
          )}
        </div>
      )}

      {/* ── 🔴 OLA C · H-36 · REABRIR UN CASO CERRADO ──────────────────────
          `{!cerrado && …}` borraba TODOS los botones de estado, mientras la
          confirmación de ABANDONADO promete literalmente «Reabrirlo es
          posible si el paciente vuelve». No lo era por ninguna pantalla: un
          docente que marcaba el caso equivocado no tenía vuelta atrás.

          Vuelve a ASIGNADO y no a EN TRATAMIENTO a propósito: "en
          tratamiento" tiene puerta (el plan firmado) y saltársela por
          reabrir sería abrir el gate por la puerta de atrás. Desde
          ASIGNADO, el caso vuelve a pasar por donde tiene que pasar.

          TRANSFERIDO no se reabre y no es una omisión: ese caso se entregó
          a otro alumno, sigue vivo en la ficha del que lo recibió, y
          reabrirlo le devolvería el paciente a quien ya lo entregó (H-37,
          que el servidor también rebota). */}
      {cerrado && canMoverEstado && status !== "TRANSFERRED" && (
        <div className="edu-caso-acciones__fila">
          {confirmando === "REOPEN" ? (
            <span className="edu-caso-acciones__confirm">
              ¿Reabrir el caso? Vuelve a ASIGNADO y se le quita la fecha de cierre. Para volver a
              «en tratamiento» hace falta el plan autorizado, como la primera vez.
              <button
                type="button"
                className="edu-btn edu-btn--primary edu-btn--sm"
                disabled={busy}
                onClick={() =>
                  moverEstado("ASSIGNED", "El caso se reabrió: está ASIGNADO otra vez.")
                }
              >
                Sí, reabrirlo
              </button>
              <button
                type="button"
                className="edu-btn edu-btn--quiet edu-btn--sm"
                disabled={busy}
                onClick={() => setConfirmando(null)}
              >
                No
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              disabled={busy}
              onClick={() => setConfirmando("REOPEN")}
            >
              Reabrir el caso
            </button>
          )}
        </div>
      )}

      {modalSesion && (
        <EduModal
          title="Registrar sesión"
          subtitle={caseLabel}
          busy={busy}
          onClose={() => setModalSesion(false)}
          footer={
            <>
              <button
                type="button"
                className="edu-btn edu-btn--quiet"
                onClick={() => setModalSesion(false)}
                disabled={busy}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="edu-btn edu-btn--primary"
                onClick={registrarSesion}
                disabled={busy}
              >
                Guardar la nota
              </button>
            </>
          }
        >
          <p className="edu-note">
            La sesión se registra como nota SOAP del caso. Nace en BORRADOR: desde la pestaña
            Expediente se completa, se envía y se firma (NOM-004: nota por cada acto).
          </p>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="ses-s">
              Subjetivo — qué refiere el paciente
            </label>
            <textarea
              id="ses-s"
              className="edu-input"
              rows={2}
              value={subjetivo}
              onChange={(e) => setSubjetivo(e.target.value)}
            />
          </div>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="ses-o">
              Objetivo — qué se encontró
            </label>
            <textarea
              id="ses-o"
              className="edu-input"
              rows={2}
              value={objetivo}
              onChange={(e) => setObjetivo(e.target.value)}
            />
          </div>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="ses-a">
              Análisis
            </label>
            <textarea
              id="ses-a"
              className="edu-input"
              rows={2}
              value={analisis}
              onChange={(e) => setAnalisis(e.target.value)}
            />
          </div>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="ses-p">
              Plan — qué se hizo y qué sigue
            </label>
            <textarea
              id="ses-p"
              className="edu-input"
              rows={2}
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
            />
          </div>
        </EduModal>
      )}

      {modalTraspaso && (
        <EduModal
          title="Traspasar el caso"
          subtitle={caseLabel}
          busy={busy}
          onClose={() => setModalTraspaso(false)}
          footer={
            <>
              <button
                type="button"
                className="edu-btn edu-btn--quiet"
                onClick={() => setModalTraspaso(false)}
                disabled={busy}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="edu-btn edu-btn--primary"
                onClick={traspasar}
                disabled={busy}
              >
                Traspasar
              </button>
            </>
          }
        >
          <p className="edu-note">
            Esto NO reasigna: cierra este caso como TRANSFERIDO y abre uno nuevo con el estudiante
            destino. El estudiante que entrega pierde el acceso al paciente en el mismo acto; su
            expediente se queda donde ocurrió. La lista solo trae estudiantes de {programName},
            que es la especialidad de este caso: el servidor exige que coincida.
          </p>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="tras-destino">
              ¿Quién lo recibe?
            </label>
            <select
              id="tras-destino"
              className="edu-input"
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              disabled={destinos.length === 0}
            >
              <option value="">
                {destinos.length === 0 ? "No hay a quién traspasarlo" : "Elige un estudiante…"}
              </option>
              {destinos.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.matricula} · {a.name}
                </option>
              ))}
            </select>
            {destinos.length === 0 && (
              <p className="edu-field__hint">
                Ninguno de los estudiantes que ves cursa {programName}, que es la especialidad de
                este caso. Un traspaso a otra especialidad lo rechaza el servidor.
              </p>
            )}
          </div>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="tras-motivo">
              Motivo (opcional, queda en el caso nuevo)
            </label>
            <input
              id="tras-motivo"
              className="edu-input"
              value={motivoTraspaso}
              onChange={(e) => setMotivoTraspaso(e.target.value)}
              placeholder="Ej.: rotación de semestre, egreso"
            />
          </div>
        </EduModal>
      )}

      {/* ── H-34 · CORREGIR EL DOCENTE RESPONSABLE ───────────────────── */}
      {modalDocente && (
        <EduModal
          title="Docente responsable del caso"
          subtitle={caseLabel}
          busy={busy}
          onClose={() => setModalDocente(false)}
          footer={
            <>
              <button
                type="button"
                className="edu-btn edu-btn--quiet"
                onClick={() => setModalDocente(false)}
                disabled={busy}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="edu-btn edu-btn--primary"
                onClick={cambiarDocente}
                disabled={busy}
              >
                Guardar
              </button>
            </>
          }
        >
          <p className="edu-note">
            Quien responde por ESTE caso y firma sus autorizaciones. No es la supervisión del
            estudiante —esa se asigna en Estudiantes y puede ser otra persona—: un caso se abre en
            la valoración, y ahí es donde se pone el docente equivocado.
          </p>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="caso-docente">
              Docente responsable
            </label>
            <select
              id="caso-docente"
              className="edu-input"
              value={docenteNuevo}
              onChange={(e) => setDocenteNuevo(e.target.value)}
            >
              <option value="">Sin docente responsable</option>
              {/* Los dados de baja se marcan y NO se ofrecen para elegir:
                  el core los rechaza con "Ese docente está dado de baja".
                  Se pinta el que ya está puesto aunque esté de baja, para
                  que el desplegable no mienta sobre lo que hay hoy. */}
              {docentes
                .filter((d) => d.isActive || d.id === supervisorUserId)
                .map((d) => (
                  <option key={d.id} value={d.id} disabled={!d.isActive}>
                    {d.name}
                    {d.isActive ? "" : " · dado de baja"}
                  </option>
                ))}
            </select>
            <p className="edu-field__hint">
              Ahora mismo: {supervisorName ?? "sin docente responsable"}.
            </p>
          </div>
        </EduModal>
      )}
    </div>
  );
}
