"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, Plus } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_BLOCK_ALCANCE_LABELS,
  EDU_BLOCK_KINDS,
  EDU_BLOCK_KIND_DESCRIPTIONS,
  EDU_BLOCK_KIND_LABELS,
  EDU_BLOCK_REASON_MAX,
  eduBloqueoAlcance,
  eduBloqueoRangoLabel,
  type EduAgendaBlockKind,
  type EduBloqueoVista,
} from "@/lib/edu/agenda-bloqueos-core";

/**
 * LOS BLOQUEOS DE AGENDA (H-19) — festivo, puente y sillón en
 * mantenimiento, desde Sillones y desde la propia agenda.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 QUÉ CIERRA
 *
 * «No existe el BLOQUEO: no hay forma de cerrar un puente ni de sacar un
 * sillón por mantenimiento. El sillón 7 se descompone el martes: o cambias
 * el horario semanal (y afecta TODOS los martes), o das de baja el sillón
 * (que no cancela nada). La agenda ofrece huecos que no existen.»
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL ALCANCE LO DA LO QUE SE DEJE EN BLANCO, y la pantalla lo DICE en
 * vez de esconderlo detrás de tres desplegables:
 *   · sin sede y sin sillón → el instituto entero (un festivo nacional);
 *   · con sede y sin sillón → esa sede (el puente del campus norte);
 *   · con sillón            → ese sillón (el 7 en mantenimiento).
 *
 * 🔴 LOS DÍAS VIAJAN COMO DÍAS, no como instantes. El navegador NO convierte
 * «el 15» a UTC: lo haría con la zona del DISPOSITIVO, y la coordinadora
 * que abre el panel desde su casa en otro huso cerraría la clínica con dos
 * horas de desfase. Se manda `desdeDia`/`hastaDia` y la conversión la hace
 * el servidor con la zona de la SEDE (agenda-bloqueos-core.ts).
 *
 * ⚠️ UN BLOQUEO NO CANCELA LAS CITAS QUE YA ESTÁN, y el formulario lo dice
 * antes de guardar. Cierra el hueco para lo que venga; lo agendado se
 * reagenda a mano, con su aviso al paciente.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduBloqueoConAutor extends EduBloqueoVista {
  createdAt?: string;
}

export interface EduBloqueosPanelProps {
  bloqueos: EduBloqueoConAutor[];
  /** Las sedes a las que ENTRA quien mira. Vacío = instituto sin sedes. */
  campuses: { id: string; name: string }[];
  chairs: { id: string; name: string; campusId: string; campusName: string }[];
  canManage: boolean;
  /** La zona del instituto: con ella se rotulan los rangos. */
  timezone: string;
  /** El periodo que se está enseñando, para que la lista vacía no mienta. */
  periodoLabel?: string;
}

export function EduBloqueosPanel({
  bloqueos,
  campuses,
  chairs,
  canManage,
  timezone,
  periodoLabel,
}: EduBloqueosPanelProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [creando, setCreando] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function retirar(b: EduBloqueoConAutor) {
    setBusyId(b.id);
    setError(null);
    try {
      await eduRequest(`/api/instituto/bloqueos/${b.id}`, { method: "DELETE" });
      setFlash(
        `Se retiró «${b.reason}». La fila no se borra: un bloqueo que existió explica por qué esa tarde no hubo nadie en la clínica.`,
      );
      startNav(() => router.refresh());
    } catch (err) {
      setFlash(null);
      setError(err instanceof Error ? err.message : "No se pudo retirar el bloqueo.");
    } finally {
      setBusyId(null);
    }
  }

  const nombreSillon = (id: string | null) =>
    id ? (chairs.find((c) => c.id === id)?.name ?? "Un sillón que ya no está en la lista") : null;
  const nombreSede = (id: string | null) =>
    id ? (campuses.find((c) => c.id === id)?.name ?? "Una sede que ya no está en la lista") : null;

  return (
    <>
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
          {bloqueos.length} {bloqueos.length === 1 ? "bloqueo" : "bloqueos"}
          {periodoLabel ? ` · ${periodoLabel}` : ""}
        </span>
        {canManage && (
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            onClick={() => {
              setFlash(null);
              setCreando(true);
            }}
          >
            <Plus size={16} />
            Bloquear
          </button>
        )}
      </div>

      {bloqueos.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">
            {periodoLabel ? `Sin bloqueos ${periodoLabel}` : "No hay bloqueos capturados"}
          </p>
          <p className="edu-empty__detail">
            Un bloqueo cierra la agenda de un rango: el 16 de septiembre, el puente de una sede o el
            sillón que se descompuso el martes. Mientras no haya ninguno, la agenda ofrece todos los
            huecos del horario de cada sillón.
          </p>
        </div>
      ) : (
        <div className="edu-tablewrap">
          {/* `edu-tablewrap` no es decoración: hace que esta lista se mida a
              SÍ MISMA (`@container`) en vez de a la ventana, y que se
              DESPLACE en vez de recortar si no cabe. */}
          <div className="edu-table edu-table--bloqueos">
            <div className="edu-rowhead" aria-hidden="true">
              <span>Cuándo</span>
              <span>Qué</span>
              <span>A qué alcanza</span>
              <span>Lo puso</span>
              <span />
            </div>

            {bloqueos.map((b) => {
              const alcance = eduBloqueoAlcance(b);
              return (
                <div key={b.id} className="edu-row">
                  <div className="edu-cell edu-cell--wide">
                    <span className="edu-cell__label">Cuándo</span>
                    <span className="edu-cell__value edu-cell__value--strong">
                      {eduBloqueoRangoLabel(b.startsAt, b.endsAt, timezone)}
                    </span>
                  </div>

                  <div className="edu-cell">
                    <span className="edu-cell__label">Qué</span>
                    <span className="edu-cell__value">{b.reason}</span>
                    <span className="edu-cell__sub">{EDU_BLOCK_KIND_LABELS[b.kind]}</span>
                  </div>

                  <div className="edu-cell">
                    <span className="edu-cell__label">A qué alcanza</span>
                    <span className="edu-cell__value">
                      {alcance === "sillon"
                        ? nombreSillon(b.chairId)
                        : alcance === "sede"
                          ? nombreSede(b.campusId)
                          : EDU_BLOCK_ALCANCE_LABELS.instituto}
                    </span>
                    <span className="edu-cell__sub">{EDU_BLOCK_ALCANCE_LABELS[alcance]}</span>
                  </div>

                  <div className="edu-cell">
                    <span className="edu-cell__label">Lo puso</span>
                    <span className="edu-cell__value">{b.createdByName}</span>
                  </div>

                  <div className="edu-cell__actions">
                    {canManage ? (
                      <button
                        type="button"
                        className="edu-btn edu-btn--quiet edu-btn--sm"
                        onClick={() => retirar(b)}
                        disabled={busyId === b.id}
                      >
                        {busyId === b.id ? "Retirando…" : "Retirar"}
                      </button>
                    ) : (
                      // Deshabilitado CON motivo, nunca un botón que no hace
                      // nada: quien no puede retirarlo tiene que saber por qué.
                      <button
                        type="button"
                        className="edu-btn edu-btn--quiet edu-btn--sm"
                        disabled
                        title="Retirar un bloqueo pide el permiso de gestionar sillones, que por defecto solo lleva la dirección."
                      >
                        Retirar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {creando && (
        <EditorBloqueo
          campuses={campuses}
          chairs={chairs}
          onClose={() => setCreando(false)}
          onDone={(mensaje) => {
            setCreando(false);
            setFlash(mensaje);
            setError(null);
            startNav(() => router.refresh());
          }}
        />
      )}
    </>
  );
}

/** El día de hoy en formato AAAA-MM-DD, para el valor inicial del formulario. */
function hoyLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function EditorBloqueo({
  campuses,
  chairs,
  onClose,
  onDone,
}: {
  campuses: { id: string; name: string }[];
  chairs: { id: string; name: string; campusId: string; campusName: string }[];
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [kind, setKind] = useState<EduAgendaBlockKind>("FESTIVO");
  const [reason, setReason] = useState("");
  // El alcance es UN control y no dos: "instituto / sede / sillón" es la
  // pregunta que la persona se hace, y dos desplegables independientes
  // dejan capturar "sede sur + sillón del norte", que no significa nada.
  const [alcance, setAlcance] = useState<"instituto" | "sede" | "sillon">(
    campuses.length > 1 ? "sede" : "instituto",
  );
  const [campusId, setCampusId] = useState(campuses[0]?.id ?? "");
  const [chairId, setChairId] = useState(chairs[0]?.id ?? "");
  const [desdeDia, setDesdeDia] = useState(hoyLocalISO());
  const [hastaDia, setHastaDia] = useState(hoyLocalISO());
  const [conHoras, setConHoras] = useState(false);
  const [desdeHora, setDesdeHora] = useState("09:00");
  const [hastaHora, setHastaHora] = useState("14:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest("/api/instituto/bloqueos", {
        method: "POST",
        body: {
          kind,
          reason: reason.trim(),
          campusId: alcance === "sede" ? campusId : null,
          chairId: alcance === "sillon" ? chairId : null,
          desdeDia,
          hastaDia,
          // Sin horas, el último día entra ENTERO (lo resuelve el servidor).
          desdeHora: conHoras ? desdeHora : null,
          hastaHora: conHoras ? hastaHora : null,
        },
      });
      onDone(
        `Bloqueo capturado. Las citas que YA estaban siguen en la agenda: bloquear cierra el hueco para lo que venga, no cancela nada.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el bloqueo.");
    } finally {
      setBusy(false);
    }
  }

  // Un bloqueo de TODO el instituto solo lo puede poner quien entra a todas
  // las sedes; el servidor lo rebota con 403 y aquí se dice antes.
  const sillonesDeLaSede =
    alcance === "sillon" ? chairs : chairs.filter((c) => c.campusId === campusId);

  return (
    <EduModal
      title="Bloquear la agenda"
      subtitle="Un festivo, un puente o un sillón fuera de servicio. Cierra el hueco para lo que venga."
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
            disabled={
              busy ||
              reason.trim().length < 3 ||
              !desdeDia ||
              !hastaDia ||
              (alcance === "sede" && !campusId) ||
              (alcance === "sillon" && !chairId)
            }
          >
            {busy ? "Guardando…" : "Bloquear"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-blq-kind">
          Qué es
        </label>
        <select
          id="edu-blq-kind"
          className="edu-input"
          value={kind}
          onChange={(e) => setKind(e.target.value as EduAgendaBlockKind)}
        >
          {EDU_BLOCK_KINDS.map((k) => (
            <option key={k} value={k}>
              {EDU_BLOCK_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <p className="edu-field__hint">{EDU_BLOCK_KIND_DESCRIPTIONS[kind]}</p>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-blq-reason">
          Motivo
        </label>
        <input
          id="edu-blq-reason"
          className="edu-input"
          value={reason}
          maxLength={EDU_BLOCK_REASON_MAX}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Fiestas patrias"
          autoComplete="off"
        />
        <p className="edu-field__hint">
          Es lo que se lee EN la rejilla y lo que rebota cuando alguien intenta agendar ahí. Sin él,
          quien lo vea llama por teléfono a preguntar.
        </p>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-blq-alcance">
          A qué alcanza
        </label>
        <select
          id="edu-blq-alcance"
          className="edu-input"
          value={alcance}
          onChange={(e) => setAlcance(e.target.value as typeof alcance)}
        >
          <option value="instituto">Todo el instituto</option>
          <option value="sede" disabled={campuses.length === 0}>
            Una sede entera
          </option>
          <option value="sillon" disabled={chairs.length === 0}>
            Un solo sillón
          </option>
        </select>
        <p className="edu-field__hint">
          Cerrar el instituto entero solo lo puede hacer quien entra a todas las sedes: el servidor
          lo comprueba, no la pantalla.
        </p>
      </div>

      {alcance === "sede" && (
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-blq-sede">
            Sede
          </label>
          <select
            id="edu-blq-sede"
            className="edu-input"
            value={campusId}
            onChange={(e) => setCampusId(e.target.value)}
          >
            {campuses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {alcance === "sillon" && (
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-blq-sillon">
            Sillón
          </label>
          <select
            id="edu-blq-sillon"
            className="edu-input"
            value={chairId}
            onChange={(e) => setChairId(e.target.value)}
          >
            {sillonesDeLaSede.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.campusName}
              </option>
            ))}
          </select>
          <p className="edu-field__hint">
            La sede se toma DEL sillón: un bloqueo que dijera una sede y apuntara a un sillón de otra
            no alcanzaría a nada.
          </p>
        </div>
      )}

      <div className="edu-formgrid">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-blq-desde">
            Desde el día
          </label>
          <input
            id="edu-blq-desde"
            className="edu-input"
            type="date"
            value={desdeDia}
            onChange={(e) => setDesdeDia(e.target.value)}
          />
        </div>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-blq-hasta">
            Hasta el día
          </label>
          <input
            id="edu-blq-hasta"
            className="edu-input"
            type="date"
            value={hastaDia}
            onChange={(e) => setHastaDia(e.target.value)}
          />
          <p className="edu-field__hint">Ese día entra ENTERO en el bloqueo.</p>
        </div>
      </div>

      <label className="edu-check">
        <input
          className="edu-check__input"
          type="checkbox"
          checked={conHoras}
          onChange={(e) => setConHoras(e.target.checked)}
        />
        <span className="edu-check__body">
          <span className="edu-check__label">Solo unas horas, no el día completo</span>
          <span className="edu-check__hint">
            Para el sillón que se repara por la mañana y vuelve a servicio por la tarde.
          </span>
        </span>
      </label>

      {conHoras && (
        <div className="edu-formgrid">
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-blq-hdesde">
              De
            </label>
            <input
              id="edu-blq-hdesde"
              className="edu-input"
              type="time"
              value={desdeHora}
              onChange={(e) => setDesdeHora(e.target.value)}
            />
          </div>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-blq-hhasta">
              A
            </label>
            <input
              id="edu-blq-hhasta"
              className="edu-input"
              type="time"
              value={hastaHora}
              onChange={(e) => setHastaHora(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="edu-banner edu-banner--warn" role="status">
        <CalendarOff size={18} aria-hidden="true" />
        <div>
          <p className="edu-banner__title">Esto NO cancela las citas que ya están</p>
          <p className="edu-banner__detail">
            Bloquear cierra el hueco para lo que venga: la rejilla lo pinta y agendar o reagendar ahí
            rebota con este motivo. Lo que ya estaba agendado sigue en la agenda y se reagenda a
            mano, con su aviso al paciente — cancelar la tarde de alguien en cascada no lo puede
            decidir un botón.
          </p>
        </div>
      </div>
    </EduModal>
  );
}
