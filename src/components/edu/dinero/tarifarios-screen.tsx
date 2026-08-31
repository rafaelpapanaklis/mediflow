"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import {
  eduMoney,
  eduMoneyInputValue,
  type EduFeeScheduleRow,
  type EduTarifario,
} from "@/lib/edu/dinero-core";
import {
  EDU_FEE_RULES,
  EDU_FEE_RULE_DESCRIPTIONS,
  EDU_FEE_RULE_LABELS,
  type EduFeeRule,
} from "@/lib/edu/types";

/**
 * /instituto/tarifarios — LAS LISTAS DE PRECIOS Y LA TABLA COMPARATIVA.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 N LISTAS, NO DOS. Ésta es la pantalla que lo hace verdad: las
 * columnas se generan a partir de las listas que existan. Añadir "Convenio
 * sindicato" no toca ni esta pantalla ni el schema — sale una columna más.
 *
 * 🔴 NI UN PRECIO ESCRITO EN EL CÓDIGO. Todo lo que se pinta aquí viene
 * del servidor; este componente solo formatea centavos a pesos.
 *
 * ── LA TABLA, EN UN TELÉFONO ────────────────────────────────────────────
 * Una tabla comparativa de 40 renglones × 4 columnas no cabe en 375 px, y
 * un scroll horizontal en una tabla de precios es cómo se lee mal un
 * precio. Así que se reusa el mecanismo del resto del vertical: UN solo
 * marcado, y la rejilla cambia. En el teléfono cada procedimiento es una
 * tarjeta y cada lista es un par etiqueta/valor ("PACIENTE DE ALUMNO ·
 * $300") — que es exactamente una comparativa, leída en vertical. A partir
 * de 1180 px las etiquetas se esconden y aparece el renglón con su
 * encabezado.
 *
 * La rejilla se calcula EN LÍNEA (`--edu-cols`) porque el número de
 * columnas es dato, no diseño. Va sobre el contenedor y no sobre cada
 * fila: el encabezado y los renglones leen la MISMA variable, así que no
 * pueden desalinearse.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduTarifariosScreenProps {
  tarifario: EduTarifario;
  maxRows: number;
  canManage: boolean;
}

export function EduTarifariosScreen({
  tarifario,
  maxRows,
  canManage,
}: EduTarifariosScreenProps) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [nuevaLista, setNuevaLista] = useState(false);
  const [editarLista, setEditarLista] = useState<EduFeeScheduleRow | null>(null);
  const [precios, setPrecios] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const { schedules, rows, truncated } = tarifario;
  const activas = schedules.filter((s) => s.isActive);
  const hayDefault = activas.some((s) => s.isDefault);

  function recargar(mensaje: string) {
    setFlash(mensaje);
    startNav(() => router.refresh());
  }

  // Una columna para el procedimiento y una por lista. Se acota el mínimo
  // a 104 px para que un precio de seis cifras no parta el renglón.
  const cols = `minmax(180px, 2fr) ${schedules.map(() => "minmax(104px, 1fr)").join(" ")} 96px`;

  return (
    <>
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}

      {/* 🔴 Sin lista predeterminada NO se puede cobrar: el servidor no
          sabría qué precio poner. Se avisa arriba y con el nombre exacto de
          lo que falta, no con un "configura tu tarifario". */}
      {!hayDefault && (
        <div className="edu-banner edu-banner--warn" role="alert">
          <div>
            <p className="edu-banner__title">Ninguna lista está marcada como predeterminada</p>
            <p className="edu-banner__detail">
              Mientras no la haya, caja no puede cobrar: el servidor no sabe qué precio aplicarle a
              un paciente que llegó solo a la clínica. Marca una con "Es la predeterminada".
            </p>
          </div>
        </div>
      )}

      {/* ── Las listas ─────────────────────────────────────────────── */}
      <section className="edu-section">
        <div className="edu-section__head">
          <div>
            <h2 className="edu-section__title">Listas de precios</h2>
            <p className="edu-section__lead">
              Son las que quieras. El instituto arranca con dos —público general y paciente de
              estudiante— y mañana agrega convenios, personal o campañas sin tocar nada más.
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-btn--sm"
              onClick={() => {
                setFlash(null);
                setNuevaLista(true);
              }}
            >
              <Plus size={16} />
              Nueva lista
            </button>
          )}
        </div>

        {schedules.length === 0 ? (
          <div className="edu-empty">
            <p className="edu-empty__title">Todavía no hay listas de precios</p>
            <p className="edu-empty__detail">
              Crea al menos dos: una predeterminada (&quot;Público general&quot;) y una con la regla
              &quot;paciente que trajo un estudiante&quot;. Esa segunda es la que hace que el paciente
              que trae un estudiante pague distinto, sin que nadie tenga que acordarse en el
              mostrador.
            </p>
          </div>
        ) : (
          <ul className="edu-listas">
            {schedules.map((s) => (
              <li key={s.id} className={`edu-lista ${s.isActive ? "" : "edu-lista--off"}`}>
                <div className="edu-lista__head">
                  <span className="edu-lista__name">{s.name}</span>
                  {s.isDefault && <span className="edu-tag edu-tag--ok">Predeterminada</span>}
                  {s.rule !== "MANUAL" && (
                    <span className="edu-tag edu-tag--info">{EDU_FEE_RULE_LABELS[s.rule]}</span>
                  )}
                  {!s.isActive && <span className="edu-tag edu-tag--muted">Inactiva</span>}
                </div>
                <p className="edu-lista__sub">
                  <code>{s.key}</code> · {s.itemCount}{" "}
                  {s.itemCount === 1 ? "precio capturado" : "precios capturados"}
                </p>
                {s.notes && <p className="edu-note">{s.notes}</p>}
                {canManage && (
                  <button
                    type="button"
                    className="edu-btn edu-btn--ghost edu-btn--sm"
                    onClick={() => {
                      setFlash(null);
                      setEditarLista(s);
                    }}
                  >
                    Editar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── La tabla comparativa ───────────────────────────────────── */}
      <section className="edu-section">
        <div className="edu-section__head">
          <div>
            <h2 className="edu-section__title">Precio de cada procedimiento</h2>
            <p className="edu-section__lead">
              Una columna por lista. Un guion quiere decir que esa lista no cubre ese
              procedimiento — y entonces el precio sale de la predeterminada, y caja lo ve escrito.
            </p>
          </div>
          <span className="edu-count">
            {navigating ? "Actualizando…" : `${rows.length} procedimientos`}
            {truncated ? ` (se muestran los primeros ${maxRows})` : ""}
          </span>
        </div>

        {schedules.length === 0 || rows.length === 0 ? (
          <div className="edu-empty">
            <p className="edu-empty__title">
              {schedules.length === 0 ? "Primero crea una lista" : "Todavía no hay procedimientos"}
            </p>
            <p className="edu-empty__detail">
              {schedules.length === 0
                ? "La tabla compara precios entre listas: sin listas no hay nada que comparar."
                : "Da de alta el catálogo en Procedimientos y vuelve aquí a ponerle precio."}
            </p>
          </div>
        ) : (
          <div
            className="edu-table edu-table--tarifas"
            style={{ ["--edu-cols" as string]: cols }}
          >
            <div className="edu-rowhead" aria-hidden="true">
              <span>Procedimiento</span>
              {schedules.map((s) => (
                <span key={s.id}>{s.name}</span>
              ))}
              <span />
            </div>

            {rows.map((r) => (
              <div
                key={r.procedure.id}
                className={`edu-row ${r.procedure.isActive ? "" : "edu-row--off"}`}
              >
                <div className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Procedimiento</span>
                  <span className="edu-cell__value edu-cell__value--strong">
                    {r.procedure.name}
                  </span>
                  <span className="edu-cell__sub">
                    {r.procedure.code}
                    {r.procedure.category ? ` · ${r.procedure.category}` : ""}
                    {r.procedure.isActive ? "" : " · dado de baja"}
                  </span>
                </div>

                {r.cells.map((c, i) => (
                  <div className="edu-cell" key={c.feeScheduleId}>
                    <span className="edu-cell__label">{schedules[i]?.name}</span>
                    {c.priceCents === null ? (
                      <span className="edu-cell__value edu-precio--vacio">—</span>
                    ) : (
                      <span className="edu-cell__value edu-precio">{eduMoney(c.priceCents)}</span>
                    )}
                  </div>
                ))}

                <div className="edu-cell__actions">
                  {canManage && (
                    <button
                      type="button"
                      className="edu-btn edu-btn--ghost edu-btn--sm"
                      onClick={() => {
                        setFlash(null);
                        setPrecios(r.procedure.id);
                      }}
                    >
                      Precios
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {(nuevaLista || editarLista) && (
        <FormLista
          actual={editarLista ?? undefined}
          onClose={() => {
            setNuevaLista(false);
            setEditarLista(null);
          }}
          onDone={(mensaje) => {
            setNuevaLista(false);
            setEditarLista(null);
            recargar(mensaje);
          }}
        />
      )}

      {precios && (
        <FormPrecios
          fila={rows.find((r) => r.procedure.id === precios) ?? null}
          schedules={schedules}
          onClose={() => setPrecios(null)}
          onDone={() => {
            setPrecios(null);
            recargar("Precios guardados. Los cobros ya emitidos no cambian.");
          }}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Alta / edición de una lista
// ═══════════════════════════════════════════════════════════════════════

function FormLista({
  actual,
  onClose,
  onDone,
}: {
  actual?: EduFeeScheduleRow;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [name, setName] = useState(actual?.name ?? "");
  const [key, setKey] = useState(actual?.key ?? "");
  const [rule, setRule] = useState<EduFeeRule>(actual?.rule ?? "MANUAL");
  const [isDefault, setIsDefault] = useState(actual?.isDefault ?? false);
  const [isActive, setIsActive] = useState(actual?.isActive ?? true);
  const [notes, setNotes] = useState(actual?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        // Sin clave tecleada, el servidor la deriva del nombre. Nadie
        // debería tener que inventarse una clave para poner un precio.
        key: key.trim() || undefined,
        rule,
        isDefault,
        notes: notes.trim() || null,
        ...(actual ? { isActive } : {}),
      };
      if (actual) {
        await eduRequest(`/api/instituto/tarifarios/${actual.id}`, { method: "PATCH", body });
        onDone("Lista actualizada.");
      } else {
        await eduRequest("/api/instituto/tarifarios", { method: "POST", body });
        onDone("Lista creada. Ahora ponle precios en la tabla de abajo.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={actual ? "Editar lista de precios" : "Nueva lista de precios"}
      subtitle="Las listas son las que quieras: público, estudiante, convenios, personal, campañas."
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
            disabled={busy || !name.trim()}
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

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-lista-name">
          Nombre
        </label>
        <input
          id="edu-lista-name"
          className="edu-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          placeholder="Paciente de estudiante"
        />
        <span className="edu-field__hint">
          Es lo que se imprime en el recibo del paciente. Que se entienda.
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-lista-key">
          Clave (opcional)
        </label>
        <input
          id="edu-lista-key"
          className="edu-input"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
          placeholder="estudiante"
        />
        <span className="edu-field__hint">
          Corta y estable: es la que sale en los reportes y la que NO cambia si mañana renombras la
          lista. Si la dejas vacía se deriva del nombre.
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-lista-rule">
          ¿Cuándo se aplica sola?
        </label>
        <select
          id="edu-lista-rule"
          className="edu-input"
          value={rule}
          onChange={(e) => setRule(e.target.value as EduFeeRule)}
        >
          {EDU_FEE_RULES.map((r) => (
            <option key={r} value={r}>
              {EDU_FEE_RULE_LABELS[r]}
            </option>
          ))}
        </select>
        <span className="edu-field__hint">{EDU_FEE_RULE_DESCRIPTIONS[rule]}</span>
      </div>

      <label className="edu-check">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
        />
        <span className="edu-check__body">
          <span className="edu-check__label">Es la predeterminada</span>
          <span className="edu-check__hint">
            La lista a la que se cae cuando ninguna regla dispara. Solo puede haber una: marcar
            ésta desmarca la que estuviera.
          </span>
        </span>
      </label>

      {actual && (
        <label className="edu-check">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span className="edu-check__body">
            <span className="edu-check__label">Activa</span>
            <span className="edu-check__hint">
              Desactivarla la saca de caja. Los precios no se borran y los cobros que la aplicaron
              siguen diciendo su nombre.
            </span>
          </span>
        </label>
      )}

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-lista-notas">
          Para qué es (opcional)
        </label>
        <textarea
          id="edu-lista-notas"
          className="edu-input"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Pacientes que trae un estudiante de la escuela."
        />
      </div>
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Precios de UN procedimiento en TODAS las listas
// ═══════════════════════════════════════════════════════════════════════

function FormPrecios({
  fila,
  schedules,
  onClose,
  onDone,
}: {
  fila: EduTarifario["rows"][number] | null;
  schedules: EduFeeScheduleRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [valores, setValores] = useState<Record<string, string>>(() => {
    const inicial: Record<string, string> = {};
    for (const c of fila?.cells ?? []) {
      inicial[c.feeScheduleId] = c.priceCents === null ? "" : eduMoneyInputValue(c.priceCents);
    }
    return inicial;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!fila) return null;

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest("/api/instituto/tarifarios/precios", {
        method: "PUT",
        body: {
          procedureId: fila!.procedure.id,
          precios: schedules.map((s) => ({
            feeScheduleId: s.id,
            // Vacío = BORRA el precio: esa lista deja de cubrir el
            // procedimiento, que NO es lo mismo que costar cero.
            priceCents: (valores[s.id] ?? "").trim() === "" ? null : valores[s.id],
          })),
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron guardar los precios.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={`Precios de ${fila.procedure.name}`}
      subtitle="Uno por lista. Déjalo vacío si esa lista no cubre este procedimiento."
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
            disabled={busy}
          >
            {busy ? "Guardando…" : "Guardar precios"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <p className="edu-note">
        Cambiar un precio aquí NO reescribe ningún cobro ya emitido: el precio de un cobro vive
        congelado en su renglón. Esto decide lo que costará el próximo.
      </p>

      <div className="edu-formgrid">
        {schedules.map((s) => (
          <div className="edu-field" key={s.id}>
            <label className="edu-field__label" htmlFor={`edu-precio-${s.id}`}>
              {s.name}
              {s.isDefault ? " · predeterminada" : ""}
              {s.isActive ? "" : " · inactiva"}
            </label>
            <input
              id={`edu-precio-${s.id}`}
              className="edu-input"
              inputMode="decimal"
              value={valores[s.id] ?? ""}
              onChange={(e) => setValores((v) => ({ ...v, [s.id]: e.target.value }))}
              placeholder="0.00"
              autoComplete="off"
            />
          </div>
        ))}
      </div>
    </EduModal>
  );
}
