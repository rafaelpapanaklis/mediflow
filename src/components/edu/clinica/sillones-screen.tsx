"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Armchair, Clock, Plus, Trash2 } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_WEEKDAY_SHORT,
  EDU_WEEK_ORDER,
  eduDescribeSchedule,
  eduMinutesToLabel,
  parseEduMinuteOfDay,
  type EduChairRow,
  type EduChairScheduleRow,
} from "@/lib/edu/agenda-core";

/**
 * /instituto/sillones — las unidades dentales y su horario.
 *
 * 🔴 CUÁNTOS HAY LO DECIDE CADA INSTITUTO. Esta pantalla nace VACÍA a
 * propósito: no hay doce sillones de ejemplo ni un "por defecto son 8".
 * Una escuela tiene 40 y otra tiene 6, y el producto no puede opinar.
 *
 * 🔴 SIN HORARIO = SIEMPRE ABIERTO, y está escrito con todas sus letras en
 * la pantalla porque es lo contrario de lo que la gente supone. Un sillón
 * recién dado de alta acepta cualquier hora; en cuanto tiene UNA franja,
 * solo acepta lo que cae dentro.
 *
 * `canManage` llega ya resuelto y CADA endpoint lo vuelve a exigir: si
 * alguien fabrica el botón desde la consola, el servidor contesta 403.
 */
export interface EduSillonesScreenProps {
  rows: EduChairRow[];
  canManage: boolean;
}

export function EduSillonesScreen({ rows, canManage }: EduSillonesScreenProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [alta, setAlta] = useState(false);
  const [editando, setEditando] = useState<EduChairRow | null>(null);
  const [horario, setHorario] = useState<EduChairRow | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  function recargar(mensaje: string) {
    setFlash(mensaje);
    startNav(() => router.refresh());
  }

  return (
    <>
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {rows.length} {rows.length === 1 ? "sillón" : "sillones"}
        </span>
        {canManage && (
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            onClick={() => {
              setFlash(null);
              setAlta(true);
            }}
          >
            <Plus size={16} />
            Nuevo sillón
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Todavía no hay sillones</p>
          <p className="edu-empty__detail">
            Cuántas unidades tiene la clínica lo decide tu escuela: da de alta las que
            existan de verdad, con el número que está pintado en la pared. Sin al menos un
            sillón no se puede agendar a nadie.
          </p>
        </div>
      ) : (
        <div className="edu-table edu-table--sillones">
          <div className="edu-rowhead" aria-hidden="true">
            <span>Número</span>
            <span>Sillón</span>
            <span>Horario</span>
            <span>Citas</span>
            <span />
          </div>

          {rows.map((c) => (
            <div key={c.id} className={`edu-row ${c.isActive ? "" : "edu-row--off"}`}>
              <div className="edu-cell">
                <span className="edu-cell__label">Número</span>
                <span className="edu-cell__value edu-cell__value--strong">{c.number}</span>
              </div>

              <div className="edu-cell edu-cell--wide">
                <span className="edu-cell__label">Sillón</span>
                <span className="edu-cell__value edu-cell__value--strong">{c.name}</span>
                {!c.isActive && <span className="edu-tag edu-tag--muted">Dado de baja</span>}
              </div>

              <div className="edu-cell edu-cell--wide">
                <span className="edu-cell__label">Horario</span>
                <span className="edu-cell__value">{eduDescribeSchedule(c.schedules)}</span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Citas próximas</span>
                <span className="edu-cell__value">{c.upcoming}</span>
              </div>

              <div className="edu-cell__actions">
                {canManage && (
                  <>
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm"
                      onClick={() => {
                        setFlash(null);
                        setHorario(c);
                      }}
                    >
                      <Clock size={15} />
                      Horario
                    </button>
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm"
                      onClick={() => {
                        setFlash(null);
                        setEditando(c);
                      }}
                    >
                      Editar
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {alta && (
        <AltaSillon
          siguiente={rows.reduce((max, c) => Math.max(max, c.number), 0) + 1}
          onClose={() => setAlta(false)}
          onDone={(nombre) => {
            setAlta(false);
            recargar(`${nombre} quedó dado de alta.`);
          }}
        />
      )}

      {editando && (
        <EditarSillon
          chair={editando}
          onClose={() => setEditando(null)}
          onDone={(mensaje) => {
            setEditando(null);
            recargar(mensaje);
          }}
        />
      )}

      {horario && (
        <EditarHorario
          chair={horario}
          onClose={() => setHorario(null)}
          onDone={(mensaje) => {
            setHorario(null);
            recargar(mensaje);
          }}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Alta
// ═══════════════════════════════════════════════════════════════════════

function AltaSillon({
  siguiente,
  onClose,
  onDone,
}: {
  siguiente: number;
  onClose: () => void;
  onDone: (nombre: string) => void;
}) {
  const [numero, setNumero] = useState(String(siguiente));
  const [nombre, setNombre] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest("/api/instituto/sillones", {
        method: "POST",
        body: { number: numero, name: nombre.trim() || undefined },
      });
      onDone(nombre.trim() || `Sillón ${numero}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo dar de alta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Nuevo sillón"
      subtitle="El número es el que está pintado en la pared: es el que la clínica usa para hablar."
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
            disabled={busy || !numero.trim()}
          >
            {busy ? "Guardando…" : "Dar de alta"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-formgrid edu-formgrid--2">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-sillon-num">
            Número
          </label>
          <input
            id="edu-sillon-num"
            className="edu-input"
            type="number"
            min={1}
            max={999}
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
          />
          <span className="edu-field__hint">No se puede repetir en el instituto.</span>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-sillon-nombre">
            Nombre (opcional)
          </label>
          <input
            id="edu-sillon-nombre"
            className="edu-input"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder={`Sillón ${numero || "…"}`}
            autoComplete="off"
          />
          <span className="edu-field__hint">
            Si lo dejas vacío se llama &quot;Sillón {numero || "…"}&quot;.
          </span>
        </div>
      </div>

      <p className="edu-note">
        Un sillón nuevo nace <strong>sin horario</strong>, y eso significa que acepta
        cualquier hora. Cuando le captures uno, solo aceptará lo que caiga dentro.
      </p>
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Editar
// ═══════════════════════════════════════════════════════════════════════

function EditarSillon({
  chair,
  onClose,
  onDone,
}: {
  chair: EduChairRow;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [nombre, setNombre] = useState(chair.name);
  const [numero, setNumero] = useState(String(chair.number));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(body: Record<string, unknown>, mensaje: string) {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/sillones/${chair.id}`, { method: "PATCH", body });
      onDone(mensaje);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={chair.name}
      subtitle="Cambia cómo se llama o qué número lleva."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cerrar
          </button>
          <button
            type="button"
            className="edu-btn edu-btn--primary"
            onClick={() =>
              enviar({ name: nombre, number: numero }, `${nombre} quedó actualizado.`)
            }
            disabled={busy || !nombre.trim() || !numero.trim()}
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-formgrid edu-formgrid--2">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-ed-nombre">
            Nombre
          </label>
          <input
            id="edu-ed-nombre"
            className="edu-input"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </div>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-ed-numero">
            Número
          </label>
          <input
            id="edu-ed-numero"
            className="edu-input"
            type="number"
            min={1}
            max={999}
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
          />
        </div>
      </div>

      <div className="edu-section">
        <p className="edu-note">
          {chair.isActive
            ? `Dar de baja este sillón NO cancela sus citas ni las mueve: solo deja de ofrecerse al agendar. ${
                chair.upcoming > 0
                  ? `Ojo: tiene ${chair.upcoming} ${chair.upcoming === 1 ? "cita próxima" : "citas próximas"} que habrá que reagendar a mano.`
                  : "Ahora mismo no tiene citas próximas."
              }`
            : "Está dado de baja: no aparece al agendar. Reactívalo para volver a usarlo."}
        </p>
        <div className="edu-actions">
          <button
            type="button"
            className={`edu-btn ${chair.isActive ? "edu-btn--danger" : "edu-btn--ghost"} edu-btn--sm`}
            onClick={() =>
              enviar(
                { isActive: !chair.isActive },
                chair.isActive ? `${chair.name} quedó dado de baja.` : `${chair.name} está activo otra vez.`,
              )
            }
            disabled={busy}
          >
            <Armchair size={15} />
            {chair.isActive ? "Dar de baja" : "Reactivar"}
          </button>
        </div>
      </div>
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Horario
// ═══════════════════════════════════════════════════════════════════════

interface Franja {
  key: string;
  dias: number[];
  desde: string;
  hasta: string;
}

/**
 * El editor agrupa por FRANJA y no por fila de la base: la escuela piensa
 * "lunes a viernes de 8 a 2", no "siete filas". Al guardar se despliega a
 * una fila por día, que es lo que la base entiende.
 */
function franjasDesde(schedules: EduChairScheduleRow[]): Franja[] {
  const mapa = new Map<string, Franja>();
  for (const s of schedules) {
    const key = `${s.startMinute}-${s.endMinute}`;
    const ya = mapa.get(key);
    if (ya) ya.dias.push(s.weekday);
    else {
      mapa.set(key, {
        key,
        dias: [s.weekday],
        desde: eduMinutesToLabel(s.startMinute),
        hasta: eduMinutesToLabel(s.endMinute),
      });
    }
  }
  return Array.from(mapa.values());
}

function EditarHorario({
  chair,
  onClose,
  onDone,
}: {
  chair: EduChairRow;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [franjas, setFranjas] = useState<Franja[]>(() => franjasDesde(chair.schedules));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function agregar() {
    setFranjas((f) => [
      ...f,
      { key: `nueva-${Date.now()}-${f.length}`, dias: [1, 2, 3, 4, 5], desde: "08:00", hasta: "14:00" },
    ]);
  }

  function actualizar(key: string, cambio: Partial<Franja>) {
    setFranjas((f) => f.map((x) => (x.key === key ? { ...x, ...cambio } : x)));
  }

  function alternarDia(key: string, dia: number) {
    setFranjas((f) =>
      f.map((x) =>
        x.key === key
          ? { ...x, dias: x.dias.includes(dia) ? x.dias.filter((d) => d !== dia) : [...x.dias, dia] }
          : x,
      ),
    );
  }

  async function guardar() {
    setError(null);

    const slots: { weekday: number; startMinute: number; endMinute: number }[] = [];
    for (const f of franjas) {
      const desde = parseEduMinuteOfDay(f.desde);
      const hasta = parseEduMinuteOfDay(f.hasta);
      if (desde === null || hasta === null) {
        setError("Revisa las horas: van en formato HH:MM.");
        return;
      }
      if (hasta <= desde) {
        setError("Una franja no puede terminar antes de empezar.");
        return;
      }
      if (f.dias.length === 0) {
        setError("Cada franja necesita al menos un día. Si no la quieres, bórrala.");
        return;
      }
      for (const dia of f.dias) slots.push({ weekday: dia, startMinute: desde, endMinute: hasta });
    }

    setBusy(true);
    try {
      await eduRequest(`/api/instituto/sillones/${chair.id}/horario`, {
        method: "PUT",
        body: { slots },
      });
      onDone(
        slots.length === 0
          ? `${chair.name} se quedó sin horario: acepta cualquier hora.`
          : `El horario de ${chair.name} quedó guardado.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el horario.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={`Horario de ${chair.name}`}
      subtitle="En qué días y a qué horas se puede agendar en esta unidad."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="edu-btn edu-btn--primary" onClick={guardar} disabled={busy}>
            {busy ? "Guardando…" : "Guardar horario"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-banner" role="note">
        <div>
          <p className="edu-banner__title">Sin franjas = siempre abierto</p>
          <p className="edu-banner__detail">
            Si borras todas las franjas, este sillón vuelve a aceptar cualquier hora. Es al
            revés de lo que suena: un sillón sin horario no está cerrado, está sin restringir.
            Y una cita tiene que caber <strong>entera</strong> en una sola franja.
          </p>
        </div>
      </div>

      <div className="edu-hours">
        {franjas.map((f) => (
          <div key={f.key} className="edu-hour">
            <div className="edu-field">
              <span className="edu-field__label">Días</span>
              <div className="edu-daypick">
                {EDU_WEEK_ORDER.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`edu-daypick__btn ${f.dias.includes(d) ? "edu-daypick__btn--on" : ""}`}
                    aria-pressed={f.dias.includes(d)}
                    onClick={() => alternarDia(f.key, d)}
                  >
                    {EDU_WEEKDAY_SHORT[d]}
                  </button>
                ))}
              </div>
            </div>

            <div className="edu-field">
              <label className="edu-field__label" htmlFor={`edu-desde-${f.key}`}>
                Desde
              </label>
              <input
                id={`edu-desde-${f.key}`}
                className="edu-input"
                type="time"
                value={f.desde}
                onChange={(e) => actualizar(f.key, { desde: e.target.value })}
              />
            </div>

            <div className="edu-field">
              <label className="edu-field__label" htmlFor={`edu-hasta-${f.key}`}>
                Hasta
              </label>
              <input
                id={`edu-hasta-${f.key}`}
                className="edu-input"
                type="time"
                value={f.hasta}
                onChange={(e) => actualizar(f.key, { hasta: e.target.value })}
              />
            </div>

            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              onClick={() => setFranjas((prev) => prev.filter((x) => x.key !== f.key))}
              aria-label="Quitar franja"
            >
              <Trash2 size={15} />
              Quitar
            </button>
          </div>
        ))}
      </div>

      <div className="edu-actions">
        <button type="button" className="edu-btn edu-btn--ghost edu-btn--sm" onClick={agregar}>
          <Plus size={15} />
          Agregar franja
        </button>
      </div>
    </EduModal>
  );
}
