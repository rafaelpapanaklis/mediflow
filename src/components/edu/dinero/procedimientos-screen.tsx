"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import type { EduProcedureRow } from "@/lib/edu/dinero-core";

/**
 * /instituto/procedimientos — el catálogo de la escuela.
 *
 * 🔴 AQUÍ NO HAY PRECIOS, y no es un olvido: el precio es de la LISTA, no
 * del procedimiento. Poner un "precio base" en esta pantalla sería el
 * primer paso hacia "y el de alumno lo pongo en otra columna", que es
 * exactamente el diseño que esta ola no hace. Los precios se capturan en
 * /instituto/tarifarios, uno por lista.
 *
 * Un procedimiento NO se borra: se desactiva. Los cobros que lo
 * referencian ocurrieron, y su línea guarda la descripción congelada.
 */
export interface EduProcedimientosScreenProps {
  rows: EduProcedureRow[];
  schedulesCount: number;
  canManage: boolean;
}

export function EduProcedimientosScreen({
  rows,
  schedulesCount,
  canManage,
}: EduProcedimientosScreenProps) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [alta, setAlta] = useState(false);
  const [editar, setEditar] = useState<EduProcedureRow | null>(null);
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
          {navigating
            ? "Actualizando…"
            : `${rows.length} ${rows.length === 1 ? "procedimiento" : "procedimientos"}`}
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
            Nuevo procedimiento
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Todavía no hay procedimientos</p>
          <p className="edu-empty__detail">
            Da de alta lo que la clínica hace: una resina, una endodoncia, una radiografía. El
            precio no se captura aquí — se captura en Tarifarios, uno por cada lista de precios.
          </p>
        </div>
      ) : (
        <div className="edu-table edu-table--procedimientos">
          <div className="edu-rowhead" aria-hidden="true">
            <span>Clave</span>
            <span>Procedimiento</span>
            <span>Categoría</span>
            <span>Duración</span>
            <span>Precios</span>
            <span />
          </div>

          {rows.map((p) => (
            <div key={p.id} className={`edu-row ${p.isActive ? "" : "edu-row--off"}`}>
              <div className="edu-cell">
                <span className="edu-cell__label">Clave</span>
                <span className="edu-cell__value edu-cell__value--strong">{p.code}</span>
              </div>

              <div className="edu-cell edu-cell--wide">
                <span className="edu-cell__label">Procedimiento</span>
                <span className="edu-cell__value edu-cell__value--strong">{p.name}</span>
                {!p.isActive && <span className="edu-cell__sub">Dado de baja del catálogo</span>}
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Categoría</span>
                <span className="edu-cell__value">{p.category ?? "—"}</span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Duración</span>
                <span className="edu-cell__value">{p.durationMinutes} min</span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Precios</span>
                {p.pricedIn === 0 ? (
                  // Un procedimiento sin precio en NINGUNA lista no se
                  // puede cobrar. Se dice aquí, en el catálogo, y no
                  // cuando el paciente ya está en el mostrador.
                  <span className="edu-tag edu-tag--warn">Sin precio</span>
                ) : (
                  <span className="edu-cell__value">
                    {p.pricedIn} de {schedulesCount || p.pricedIn}
                  </span>
                )}
              </div>

              <div className="edu-cell__actions">
                {canManage && (
                  <button
                    type="button"
                    className="edu-btn edu-btn--ghost edu-btn--sm"
                    onClick={() => {
                      setFlash(null);
                      setEditar(p);
                    }}
                  >
                    Editar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {alta && (
        <FormProcedimiento
          onClose={() => setAlta(false)}
          onDone={() => {
            setAlta(false);
            recargar("El procedimiento quedó en el catálogo. Ponle precio en Tarifarios.");
          }}
        />
      )}

      {editar && (
        <FormProcedimiento
          actual={editar}
          onClose={() => setEditar(null)}
          onDone={() => {
            setEditar(null);
            recargar("Procedimiento actualizado.");
          }}
        />
      )}
    </>
  );
}

function FormProcedimiento({
  actual,
  onClose,
  onDone,
}: {
  actual?: EduProcedureRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [code, setCode] = useState(actual?.code ?? "");
  const [name, setName] = useState(actual?.name ?? "");
  const [category, setCategory] = useState(actual?.category ?? "");
  const [duration, setDuration] = useState(String(actual?.durationMinutes ?? 60));
  const [isActive, setIsActive] = useState(actual?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      const body = {
        code: code.trim(),
        name: name.trim(),
        category: category.trim() || null,
        durationMinutes: duration,
        ...(actual ? { isActive } : {}),
      };
      if (actual) {
        await eduRequest(`/api/instituto/procedimientos/${actual.id}`, { method: "PATCH", body });
      } else {
        await eduRequest("/api/instituto/procedimientos", { method: "POST", body });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={actual ? "Editar procedimiento" : "Nuevo procedimiento"}
      subtitle="El precio no va aquí: va en Tarifarios, uno por cada lista de precios."
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
            disabled={busy || !code.trim() || !name.trim()}
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
          <label className="edu-field__label" htmlFor="edu-proc-code">
            Clave
          </label>
          <input
            id="edu-proc-code"
            className="edu-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            placeholder="ENDO-1"
          />
          <span className="edu-field__hint">
            La que ya usa la escuela en sus papeles. Se guarda en mayúsculas.
          </span>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-proc-name">
            Nombre
          </label>
          <input
            id="edu-proc-name"
            className="edu-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            placeholder="Endodoncia unirradicular"
          />
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-proc-cat">
            Categoría (opcional)
          </label>
          <input
            id="edu-proc-cat"
            className="edu-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            autoComplete="off"
            placeholder="Endodoncia"
          />
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-proc-dur">
            Duración en el sillón (minutos)
          </label>
          <input
            id="edu-proc-dur"
            className="edu-input"
            type="number"
            min={5}
            max={480}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
          <span className="edu-field__hint">Sirve para proponer la duración de la cita.</span>
        </div>
      </div>

      {actual && (
        <label className="edu-check">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span className="edu-check__body">
            <span className="edu-check__label">Activo en el catálogo</span>
            <span className="edu-check__hint">
              Darlo de baja lo saca de caja y de los tarifarios. No borra nada: los cobros que ya
              lo llevan siguen diciendo lo que decían.
            </span>
          </span>
        </label>
      )}
    </EduModal>
  );
}
