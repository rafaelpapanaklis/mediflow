"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, History, Merge, ShieldOff, Undo2 } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * ARCO Y FUSIÓN, DESDE LA FICHA (fila 31 del informe · H-05).
 *
 * Tres actos, y son tres porque tienen tres consecuencias distintas:
 *
 *   1. BAJA (`deletedAt`) — la ficha sale de las listas y del buscador.
 *      REVERSIBLE: es una columna que se pone y se quita. Nada de la
 *      persona cambia.
 *   2. ANONIMIZACIÓN — el PII se sustituye por marcadores.
 *      IRREVERSIBLE. Lo clínico (odontograma, notas, estudios, recetas)
 *      se queda intacto: la NOM-004 obliga a conservar el expediente
 *      cinco años desde el último acto médico, y una solicitud de
 *      cancelación NO derrota a esa obligación.
 *   3. FUSIÓN — dos fichas de la misma persona pasan a ser una. MUEVE, no
 *      borra: el perdedor queda con `mergedIntoId` y su fila sobrevive,
 *      porque ese folio se imprimió en un consentimiento.
 *
 * 🔴 DOBLE CONFIRMACIÓN EN LA ANONIMIZACIÓN, Y NO ES CEREMONIA. El primer
 * paso enseña LA LISTA EXACTA de qué se sustituye y qué se conserva —la
 * trae el servidor, no está escrita a mano aquí, así que no se puede
 * desincronizar cuando una ola añada una columna de contacto—. El segundo
 * pide TECLEAR EL FOLIO: es lo único que distingue «quiero anonimizar esta
 * ficha» de «pulsé el botón rojo de la pantalla que tenía abierta».
 *
 * 🔴 Y ANTES DE ANONIMIZAR HAY QUE DAR DE BAJA. Lo exige el servidor y
 * esta pantalla lo dice: la baja se deshace y esto no, así que pasar por
 * ella convierte un clic de más en la única marcha atrás del flujo.
 *
 * 🔴 LAS DOS LLAVES (`pacientes.manage` + `direccion.panel`) las resuelve
 * el servidor y llegan en `canArco`. Esconder los botones no cierra nada
 * —el candado es `eduArcoAsegurarPermiso` dentro de la capa de datos—:
 * lo que se evita es pintarle a caja un botón que va a rebotar con 403.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduPacienteArcoProps {
  patientId: string;
  folio: string;
  nombre: string;
  canArco: boolean;
  /**
   * `direccion.panel` a secas: leer la bitácora de este paciente. Es una
   * llave MENOS que ARCO a propósito — mirar quién abrió un expediente no
   * es lo mismo que anonimizarlo.
   */
  canBitacora: boolean;
  /** Con fecha = la ficha está dada de baja. */
  deletedAt: string | null;
  deleteReason: string | null;
  /** Con fecha = ya está anonimizada. Irreversible. */
  anonymizedAt: string | null;
}

interface Preview {
  folio: string;
  sustituye: string[];
  conserva: Record<string, string>;
  ultimoActoAt: string | null;
  retencionHasta: string | null;
  bloqueo: string | null;
}

interface Candidato {
  id: string;
  folio: string;
  nombre: string;
  motivo: string;
}

interface FusionPreview {
  ganador: { id: string; folio: string; nombre: string };
  perdedor: { id: string; folio: string; nombre: string };
  mueve: { label: string; n: number }[];
  sePierdenPorChoque: number;
  cuestionarios: number;
  bloqueo: string | null;
}

const dia = (iso: string | null) =>
  iso ? new Date(iso).toISOString().slice(0, 10) : "—";

export function EduPacienteArco(props: EduPacienteArcoProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [baja, setBaja] = useState(false);
  const [motivo, setMotivo] = useState("");

  const [anon, setAnon] = useState<Preview | null>(null);
  const [paso2, setPaso2] = useState(false);
  const [folioTecleado, setFolioTecleado] = useState("");

  const [fusion, setFusion] = useState(false);
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [preview, setPreview] = useState<FusionPreview | null>(null);
  const [motivoFusion, setMotivoFusion] = useState("");

  /**
   * 🔴 EL AVISO DE QUE VIENES DE UNA FICHA FUSIONADA.
   *
   * El perdedor de una fusión REDIRIGE aquí (lo hace el layout), y sin
   * este aviso quien tecleó el folio viejo aterrizaría en otra ficha, con
   * otro folio y otro nombre, sin saber por qué. Se lee de
   * `window.location` y no de `useSearchParams()`: el hook obliga a
   * envolver el componente en un <Suspense> para que Next prerenderice, y
   * esto lo monta un layout de servidor que no lo tiene — el build
   * fallaría por un parámetro que solo se usa una vez.
   */
  const [vieneDe, setVieneDe] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const f = sp.get("fusionadaDe");
    // 🔴 `?fusionar=1` ABRE EL DIÁLOGO DE FUSIÓN AL LLEGAR. Es cómo entran
    // los dos sitios donde alguien DESCUBRE un duplicado y que no son esta
    // ficha: la lista de pacientes y el aviso de duplicado del alta. Los
    // dos enlazan aquí en vez de montar su propia copia del diálogo — una
    // segunda copia es la que se queda sin la previsualización el día que
    // ésta gane un campo.
    // Solo se abre para quien de verdad puede fusionar: sin las dos llaves
    // el diálogo se abriría para enseñar un 403, que es peor que no
    // abrirse. El enlace tampoco se le pinta a nadie más.
    const abrir = sp.get("fusionar") === "1" && props.canArco;
    if (!f && !abrir) return;
    if (f) setVieneDe(f.slice(0, 40));
    if (abrir) void abrirFusion();
    // Se limpia la URL: si no, quedaría en la barra, el aviso volvería a
    // salir en cada recarga y el diálogo se reabriría al compartir el
    // enlace.
    sp.delete("fusionadaDe");
    sp.delete("fusionar");
    const qs = sp.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    // Solo al montar: es un parámetro de llegada, no un estado que siga
    // cambiando. `abrirFusion` no va en las dependencias a propósito —
    // meterlo obligaría a memoizarla y no cambia lo que hace este efecto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function darDeBaja() {
    if (motivo.trim().length < 3) {
      setError(
        "Escribe por qué se da de baja esta ficha. Queda en el expediente y es lo que contesta la pregunta dentro de un año.",
      );
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/pacientes/${props.patientId}/arco`, {
        method: "POST",
        body: { reason: motivo.trim() },
      });
      setBaja(false);
      setMotivo("");
      setFlash(
        "La ficha quedó dada de baja: sale de las listas y del buscador. Nada de la persona cambió — esto se deshace.",
      );
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo dar de baja la ficha.");
    } finally {
      setBusy(false);
    }
  }

  async function reactivar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/pacientes/${props.patientId}/arco`, { method: "PATCH" });
      setFlash("La ficha vuelve a estar activa y a salir en las listas.");
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo reactivar la ficha.");
    } finally {
      setBusy(false);
    }
  }

  async function abrirAnonimizar() {
    setError(null);
    setBusy(true);
    try {
      const p = await eduRequest<Preview>(`/api/instituto/pacientes/${props.patientId}/arco`);
      setAnon(p);
      setPaso2(false);
      setFolioTecleado("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer qué pasaría al anonimizar.");
    } finally {
      setBusy(false);
    }
  }

  async function anonimizar() {
    setError(null);
    setBusy(true);
    try {
      const r = await eduRequest<{ folio: string; campos: number }>(
        `/api/instituto/pacientes/${props.patientId}/arco/anonimizar`,
        { method: "POST" },
      );
      setAnon(null);
      setPaso2(false);
      setFlash(
        `Listo: se sustituyeron ${r.campos} datos personales y la ficha quedó como ${r.folio}. El expediente clínico se conserva entero, como obliga la NOM-004.`,
      );
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo anonimizar la ficha.");
    } finally {
      setBusy(false);
    }
  }

  async function abrirFusion() {
    setError(null);
    setBusy(true);
    setFusion(true);
    setPreview(null);
    setMotivoFusion("");
    try {
      const r = await eduRequest<{ rows: Candidato[] }>(
        `/api/instituto/pacientes/${props.patientId}/fusion`,
      );
      setCandidatos(r.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron buscar los duplicados.");
      setCandidatos([]);
    } finally {
      setBusy(false);
    }
  }

  async function previsualizar(perdedorId: string) {
    setError(null);
    setBusy(true);
    try {
      const p = await eduRequest<FusionPreview>(
        `/api/instituto/pacientes/${props.patientId}/fusion?perdedorId=${encodeURIComponent(perdedorId)}`,
      );
      setPreview(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo previsualizar la fusión.");
    } finally {
      setBusy(false);
    }
  }

  async function fusionar() {
    if (!preview) return;
    if (motivoFusion.trim().length < 3) {
      setError(
        "Escribe por qué son la misma persona. Queda en la bitácora y es lo que contesta la pregunta dentro de un año.",
      );
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const r = await eduRequest<{ movido: Record<string, number> }>(
        `/api/instituto/pacientes/${props.patientId}/fusion`,
        {
          method: "POST",
          body: { perdedorId: preview.perdedor.id, reason: motivoFusion.trim() },
        },
      );
      const total = Object.values(r.movido).reduce((a, b) => a + b, 0);
      setFusion(false);
      setPreview(null);
      setFlash(
        `Fusionadas. Se movieron ${total} registros de ${preview.perdedor.folio} a esta ficha. La ficha ${preview.perdedor.folio} no se borró: queda apuntando aquí, y quien teclee ese folio aterriza en ésta.`,
      );
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo fusionar.");
    } finally {
      setBusy(false);
    }
  }

  // Sin las dos llaves no hay barra ARCO. Pero el AVISO de que vienes de
  // una ficha fusionada sí se pinta: le pasa a cualquiera que teclee el
  // folio viejo, tenga los permisos que tenga.
  const hayAvisos = Boolean(vieneDe || props.deletedAt || props.anonymizedAt);
  if (!props.canArco && !props.canBitacora && !hayAvisos) return null;

  return (
    <>
      {vieneDe && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">
              La ficha {vieneDe} se fusionó con ésta.
            </p>
            <p className="edu-banner__detail">
              Su expediente —citas, casos, notas, estudios, fotos, consentimientos, recetas y
              cobros— vive aquí. La ficha {vieneDe} no se borró: sigue existiendo como constancia
              de que ese folio se usó.
            </p>
          </div>
        </div>
      )}

      {props.anonymizedAt && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">
              Ficha ANONIMIZADA por una solicitud ARCO el {dia(props.anonymizedAt)}.
            </p>
            <p className="edu-banner__detail">
              Sus datos personales se sustituyeron y no vuelven. El expediente clínico se conserva
              cinco años desde el último acto médico, como obliga la NOM-004: el odontograma, las
              notas, los estudios y las recetas siguen enteros.
            </p>
          </div>
        </div>
      )}

      {props.deletedAt && !props.anonymizedAt && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">
              Ficha dada de baja el {dia(props.deletedAt)}.
            </p>
            <p className="edu-banner__detail">
              No sale en las listas ni en el buscador ni en el desplegable de agendar.
              {props.deleteReason ? ` Motivo: ${props.deleteReason}` : ""} Esto se deshace.
            </p>
          </div>
        </div>
      )}

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

      {(props.canArco || props.canBitacora) && (
        <div className="edu-acciones-ficha" role="group" aria-label="Derechos ARCO de la ficha">
          {/* 🔴 LA BITÁCORA DE ESTE PACIENTE (NOM-024). Va aquí y no en el
              menú porque la pregunta se hace DELANTE DE LA FICHA: «¿quién
              abrió el expediente de esta señora?». Lleva el `patientId` en
              la URL, así que la pantalla de bitácora llega ya filtrada.
              (La entrada del sidebar vive en `EDU_NAV_ITEMS`, un archivo
              compartido fuera del área de esta casilla — queda en el punto
              6 del reporte.) */}
          {props.canBitacora && (
            <Link
              href={`/instituto/direccion/bitacora?patientId=${props.patientId}`}
              className="edu-btn edu-btn--ghost edu-btn--sm"
            >
              <History size={15} />
              Bitácora de este paciente
            </Link>
          )}

          {props.canArco && !props.deletedAt && !props.anonymizedAt && (
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              onClick={() => {
                setError(null);
                setFlash(null);
                setMotivo("");
                setBaja(true);
              }}
              disabled={busy}
            >
              <ShieldOff size={15} />
              Dar de baja (solicitud ARCO)
            </button>
          )}

          {props.canArco && props.deletedAt && !props.anonymizedAt && (
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              onClick={() => void reactivar()}
              disabled={busy}
            >
              <Undo2 size={15} />
              Reactivar la ficha
            </button>
          )}

          {props.canArco &&
            !props.anonymizedAt &&
            (props.deletedAt ? (
              <button
                type="button"
                className="edu-btn edu-btn--danger edu-btn--sm"
                onClick={() => void abrirAnonimizar()}
                disabled={busy}
              >
                <AlertTriangle size={15} />
                Anonimizar (solicitud ARCO)
              </button>
            ) : (
              /* 🔴 DESHABILITADO **CON MOTIVO**, nunca un no-op silencioso:
                 quien ve el botón gris tiene que saber qué le falta y por
                 qué el orden importa. */
              <button
                type="button"
                className="edu-btn edu-btn--ghost edu-btn--sm"
                disabled
                title="Antes de anonimizar hay que dar de baja la ficha. La baja se deshace; la anonimización no."
              >
                <AlertTriangle size={15} />
                Anonimizar (solicitud ARCO)
              </button>
            ))}

          {props.canArco && !props.anonymizedAt && (
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              onClick={() => void abrirFusion()}
              disabled={busy}
            >
              <Merge size={15} />
              Fusionar con…
            </button>
          )}
        </div>
      )}

      {/* ── LA BAJA ─────────────────────────────────────────────────── */}
      {baja && (
        <EduModal
          title="Dar de baja la ficha"
          subtitle="La ficha sale de las listas, del buscador y del desplegable de agendar. Nada de la persona cambia, y esto se deshace."
          busy={busy}
          onClose={() => setBaja(false)}
          footer={
            <>
              <button
                type="button"
                className="edu-btn edu-btn--quiet"
                onClick={() => setBaja(false)}
                disabled={busy}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="edu-btn edu-btn--danger"
                onClick={() => void darDeBaja()}
                disabled={busy}
              >
                {busy ? "Guardando…" : "Dar de baja"}
              </button>
            </>
          }
        >
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="arco-motivo">
              ¿Por qué se da de baja? (obligatorio)
            </label>
            <textarea
              id="arco-motivo"
              className="edu-input"
              rows={3}
              value={motivo}
              autoFocus
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej.: solicitud ARCO recibida el 12/03 por escrito · duplicado de P-0031"
            />
            <span className="edu-field__hint">
              Queda en el expediente con tu nombre y la fecha. Es lo que contesta la pregunta
              dentro de un año.
            </span>
          </div>
          <p className="edu-note">
            El expediente clínico NO se toca: la NOM-004 obliga a conservarlo cinco años desde el
            último acto médico. Para sustituir los datos personales hay un segundo paso —
            «Anonimizar»— que sí es irreversible.
          </p>
        </EduModal>
      )}

      {/* ── LA ANONIMIZACIÓN, EN DOS PASOS ──────────────────────────── */}
      {anon && (
        <EduModal
          title={paso2 ? "Confirma la anonimización" : "Qué pasa si anonimizas esta ficha"}
          subtitle={
            paso2
              ? "Esto no se deshace. No se guarda una copia «por si acaso» en ningún sitio."
              : "La lista la trae el servidor, no está escrita en esta pantalla: lo que ves es exactamente lo que se va a sustituir."
          }
          busy={busy}
          onClose={() => setAnon(null)}
          footer={
            paso2 ? (
              <>
                <button
                  type="button"
                  className="edu-btn edu-btn--quiet"
                  onClick={() => setPaso2(false)}
                  disabled={busy}
                >
                  Volver
                </button>
                <button
                  type="button"
                  className="edu-btn edu-btn--danger"
                  onClick={() => void anonimizar()}
                  disabled={busy || folioTecleado.trim() !== props.folio}
                >
                  {busy ? "Anonimizando…" : "Sí, anonimizar para siempre"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="edu-btn edu-btn--quiet"
                  onClick={() => setAnon(null)}
                  disabled={busy}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="edu-btn edu-btn--danger"
                  onClick={() => setPaso2(true)}
                  disabled={busy || Boolean(anon.bloqueo)}
                  title={anon.bloqueo ?? undefined}
                >
                  Continuar
                </button>
              </>
            )
          }
        >
          {anon.bloqueo && (
            <div className="edu-alert" role="alert">
              {anon.bloqueo}
            </div>
          )}

          {!paso2 ? (
            <>
              <div className="edu-kv">
                <div>
                  <span className="edu-kv__k">Último acto médico</span>
                  <span className="edu-kv__v">
                    {anon.ultimoActoAt ? dia(anon.ultimoActoAt) : "No consta ninguna nota clínica"}
                  </span>
                </div>
                <div>
                  <span className="edu-kv__k">Hay que conservar el expediente hasta</span>
                  <span className="edu-kv__v">
                    {anon.retencionHasta
                      ? dia(anon.retencionHasta)
                      : "cinco años desde el primer acto que se registre"}
                  </span>
                </div>
              </div>

              <div className="edu-fichab-grupo">
                <p className="edu-fichab-grupo__title">
                  Se SUSTITUYE ({anon.sustituye.length} campos)
                </p>
                <p className="edu-fichab-grupo__lead">
                  Todo lo que identifica a una persona o permite contactarla, incluidas las tres
                  columnas del tutor —es otra persona física, con sus propios derechos— y el
                  número de póliza del seguro.
                </p>
                <ul className="edu-chiplist">
                  {anon.sustituye.map((c) => (
                    <li key={c} className="edu-assign">
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="edu-fichab-grupo">
                <p className="edu-fichab-grupo__title">Se CONSERVA, y por qué</p>
                <p className="edu-fichab-grupo__lead">
                  El expediente clínico entero —odontograma, notas, estudios, fotos,
                  consentimientos, recetas y cobros— más estos campos de la ficha:
                </p>
                <div className="edu-kv">
                  {Object.entries(anon.conserva).map(([campo, porque]) => (
                    <div key={campo}>
                      <span className="edu-kv__k">{campo}</span>
                      <span className="edu-kv__v">{porque}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="edu-banner edu-banner--warn" role="status">
                <div>
                  <p className="edu-banner__title">Esto es irreversible.</p>
                  <p className="edu-banner__detail">
                    Se van a sustituir {anon.sustituye.length} datos personales de{" "}
                    <strong>{props.nombre}</strong>. No hay botón para deshacerlo y no se guarda
                    una copia en ninguna otra tabla — una copia escondida es exactamente lo que la
                    solicitud pedía que dejara de existir.
                  </p>
                </div>
              </div>

              <div className="edu-field">
                <label className="edu-field__label" htmlFor="arco-folio">
                  Teclea el folio <strong>{props.folio}</strong> para confirmar
                </label>
                <input
                  id="arco-folio"
                  className="edu-input edu-input--sm"
                  value={folioTecleado}
                  autoFocus
                  autoComplete="off"
                  onChange={(e) => setFolioTecleado(e.target.value)}
                  placeholder={props.folio}
                />
                <span className="edu-field__hint">
                  Es lo único que distingue «quiero anonimizar esta ficha» de «pulsé el botón rojo
                  de la pantalla que tenía abierta».
                </span>
              </div>
            </>
          )}
        </EduModal>
      )}

      {/* ── LA FUSIÓN ───────────────────────────────────────────────── */}
      {fusion && (
        <EduModal
          title="Fusionar con otra ficha"
          subtitle={`Esta ficha (${props.folio}) es la GANADORA: se queda con todo. La otra queda apuntando aquí y no se borra.`}
          busy={busy}
          onClose={() => {
            setFusion(false);
            setPreview(null);
          }}
          footer={
            preview ? (
              <>
                <button
                  type="button"
                  className="edu-btn edu-btn--quiet"
                  onClick={() => setPreview(null)}
                  disabled={busy}
                >
                  Elegir otra
                </button>
                <button
                  type="button"
                  className="edu-btn edu-btn--danger"
                  onClick={() => void fusionar()}
                  disabled={busy || Boolean(preview.bloqueo)}
                >
                  {busy ? "Fusionando…" : `Fusionar ${preview.perdedor.folio} en ${props.folio}`}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="edu-btn edu-btn--quiet"
                onClick={() => setFusion(false)}
                disabled={busy}
              >
                Cerrar
              </button>
            )
          }
        >
          {!preview ? (
            <>
              <p className="edu-note">
                Se proponen las fichas con el MISMO nombre y apellido o el mismo teléfono. Esto
                sugiere; no decide: dos hermanas con el apellido de su padre y el teléfono de su
                madre salen aquí y <strong>no</strong> son la misma persona.
              </p>
              {candidatos === null ? (
                <p className="edu-note">Buscando…</p>
              ) : candidatos.length === 0 ? (
                <div className="edu-empty">
                  <p className="edu-empty__title">Ninguna ficha se le parece</p>
                  <p className="edu-empty__detail">
                    No hay otra con el mismo nombre y apellido ni con el mismo teléfono dentro de
                    lo que alcanzas.
                  </p>
                </div>
              ) : (
                <ul className="edu-chiplist">
                  {candidatos.map((c) => (
                    <li key={c.id} className="edu-assign">
                      <span>
                        <strong>{c.folio}</strong> · {c.nombre} · {c.motivo}
                      </span>
                      <button
                        type="button"
                        className="edu-btn edu-btn--ghost edu-btn--sm"
                        onClick={() => void previsualizar(c.id)}
                        disabled={busy}
                      >
                        Ver qué se movería
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              {preview.bloqueo && (
                <div className="edu-alert" role="alert">
                  {preview.bloqueo}
                </div>
              )}

              <div className="edu-kv">
                <div>
                  <span className="edu-kv__k">Se queda (ganadora)</span>
                  <span className="edu-kv__v">
                    {preview.ganador.folio} · {preview.ganador.nombre}
                  </span>
                </div>
                <div>
                  <span className="edu-kv__k">Se fusiona (perdedora)</span>
                  <span className="edu-kv__v">
                    {preview.perdedor.folio} · {preview.perdedor.nombre}
                  </span>
                </div>
              </div>

              <div className="edu-fichab-grupo">
                <p className="edu-fichab-grupo__title">Qué se mueve</p>
                <p className="edu-fichab-grupo__lead">
                  Todo en UNA transacción: a media fusión el expediente estaría partido entre dos
                  fichas y las dos se verían completas por separado.
                </p>
                <div className="edu-lineas">
                  {preview.mueve.map((m) => (
                    <div key={m.label} className="edu-linea">
                      <span className="edu-linea__name">{m.label}</span>
                      <span className="edu-linea__total">{m.n}</span>
                    </div>
                  ))}
                  <div className="edu-linea">
                    <span className="edu-linea__name">versiones del cuestionario (renumeradas)</span>
                    <span className="edu-linea__total">{preview.cuestionarios}</span>
                  </div>
                </div>
                {preview.sePierdenPorChoque > 0 && (
                  <p className="edu-note">
                    {preview.sePierdenPorChoque}{" "}
                    {preview.sePierdenPorChoque === 1
                      ? "hallazgo del odontograma se QUEDA"
                      : "hallazgos del odontograma se QUEDAN"}{" "}
                    en la ficha perdedora: el ganador ya tiene ese mismo hallazgo marcado. No se
                    borran — son dos personas que miraron la misma boca en dos momentos.
                  </p>
                )}
                <p className="edu-note">
                  Los números son los de AHORA. El resumen de lo que de verdad se movió sale al
                  terminar: entre esta pantalla y el botón alguien puede escribir una nota más.
                </p>
              </div>

              <div className="edu-field">
                <label className="edu-field__label" htmlFor="fusion-motivo">
                  ¿Por qué son la misma persona? (obligatorio)
                </label>
                <textarea
                  id="fusion-motivo"
                  className="edu-input"
                  rows={2}
                  value={motivoFusion}
                  autoFocus
                  onChange={(e) => setMotivoFusion(e.target.value)}
                  placeholder="Ej.: mismo CURP y misma fecha de nacimiento; se registró dos veces el 3 de marzo."
                />
              </div>
            </>
          )}
        </EduModal>
      )}
    </>
  );
}
