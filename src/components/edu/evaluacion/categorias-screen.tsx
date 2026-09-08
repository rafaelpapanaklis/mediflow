"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_CATEGORIA_NAME_MAX,
  eduCategoriaKeyDesdeNombre,
} from "@/lib/edu/categorias-core";

/**
 * /instituto/procedimientos/categorias — EL CATÁLOGO DE CATEGORÍAS (H-90).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 QUÉ CIERRA
 *
 * «Un requisito por CATEGORÍA es texto libre sin llave. Renombrar la
 * categoría en el catálogo pone el avance a cero EN SILENCIO para toda la
 * especialidad. Y un dedazo al capturarlo cuenta 0 desde el primer día, sin
 * que la pantalla distinga "0 porque nadie lo ha hecho" de "0 porque la
 * categoría no existe".»
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LA CLAVE ES LO QUE NO CAMBIA, y por eso NO se edita. Renombrar
 * «Endodoncia» a «Endodoncia y retratamiento» cambia el nombre y deja la
 * clave («endodoncia») intacta: el requisito apunta al id, la pantalla lee
 * el nombre, y renombrar deja de mover un solo número.
 *
 * 🔴 AQUÍ NO SE MIGRA NADA SOLO. El emparejado del texto libre SUGIERE y
 * una persona confirma con un clic. Decidir si «Cirugía» y «Cirugía bucal»
 * son la misma categoría es un juicio humano; una migración automática que
 * se equivoque pone el avance de una generación a cero, en silencio, que es
 * exactamente el fallo que esto arregla.
 *
 * 🔴 Y UNA CATEGORÍA NO SE BORRA: se desactiva. Sale de los desplegables y
 * deja intacto todo lo que ya apunta a ella — igual que los sillones, las
 * especialidades y las sedes.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduCategoriaPendienteVista {
  id: string;
  name: string;
  texto: string | null;
  categoryId: string | null;
  sugerido: string | null;
}

export interface EduCategoriasScreenProps {
  rows: {
    id: string;
    name: string;
    key: string;
    isActive: boolean;
    orderIndex: number;
    procedimientos: number;
  }[];
  procedimientos: EduCategoriaPendienteVista[];
  requisitos: EduCategoriaPendienteVista[];
  sinPareja: string[];
  canManage: boolean;
}

export function EduCategoriasScreen({
  rows,
  procedimientos,
  requisitos,
  sinPareja,
  canManage,
}: EduCategoriasScreenProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<EduCategoriasScreenProps["rows"][number] | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function recargar(mensaje: string) {
    setFlash(mensaje);
    setError(null);
    startNav(() => router.refresh());
  }

  async function alternar(c: EduCategoriasScreenProps["rows"][number]) {
    setBusyId(c.id);
    setError(null);
    try {
      await eduRequest(`/api/instituto/categorias/${c.id}`, {
        method: "PATCH",
        body: { isActive: !c.isActive },
      });
      recargar(
        c.isActive
          ? `«${c.name}» deja de ofrecerse. Lo que ya apunta a ella sigue apuntando: desactivar no borra nada.`
          : `«${c.name}» vuelve a ofrecerse.`,
      );
    } catch (err) {
      setFlash(null);
      setError(err instanceof Error ? err.message : "No se pudo cambiar la categoría.");
    } finally {
      setBusyId(null);
    }
  }

  async function emparejar(
    tipo: "procedimiento" | "requisito",
    id: string,
    categoryId: string | null,
    nombre: string,
  ) {
    setBusyId(id);
    setError(null);
    try {
      await eduRequest("/api/instituto/categorias/asignar", {
        method: "POST",
        body:
          tipo === "procedimiento"
            ? { procedureId: id, categoryId }
            : { requirementId: id, categoryId },
      });
      recargar(
        categoryId
          ? `«${nombre}» queda emparejado. A partir de ahora se compara por llave: renombrar la categoría ya no le mueve el avance a nadie.`
          : `«${nombre}» vuelve a compararse por texto libre.`,
      );
    } catch (err) {
      setFlash(null);
      setError(err instanceof Error ? err.message : "No se pudo emparejar.");
    } finally {
      setBusyId(null);
    }
  }

  const activas = rows.filter((c) => c.isActive);
  const procPendientes = procedimientos.filter((p) => !p.categoryId && p.texto);
  const reqPendientes = requisitos.filter((r) => !r.categoryId && r.texto);

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
          {rows.length} {rows.length === 1 ? "categoría" : "categorías"}
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
            Nueva categoría
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Todavía no hay catálogo de categorías</p>
          <p className="edu-empty__detail">
            Mientras no lo haya, los requisitos que cuentan «toda una categoría» se comparan con el
            TEXTO que alguien tecleó en cada procedimiento. Eso funciona hasta que alguien renombra
            una categoría o escribe «endodoncias» con espacio al final: ese día el avance de la
            especialidad pasa a cero y nadie ve nada raro. Da de alta las categorías que use tu
            escuela y empareja los textos que ya tienes.
          </p>
        </div>
      ) : (
        <div className="edu-tablewrap">
          <div className="edu-table edu-table--categorias">
            <div className="edu-rowhead" aria-hidden="true">
              <span>Categoría</span>
              <span>Clave</span>
              <span>En uso</span>
              <span>Estado</span>
              <span />
            </div>
            {rows.map((c) => (
              <div key={c.id} className={`edu-row ${c.isActive ? "" : "edu-row--off"}`}>
                <div className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Categoría</span>
                  <span className="edu-cell__value edu-cell__value--strong">{c.name}</span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Clave</span>
                  <span className="edu-cell__value">
                    <code>{c.key}</code>
                  </span>
                  <span className="edu-cell__sub">No cambia nunca</span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">En uso</span>
                  <span className="edu-cell__value">
                    {c.procedimientos}{" "}
                    {c.procedimientos === 1 ? "procedimiento" : "procedimientos"}
                  </span>
                </div>
                <div className="edu-cell">
                  <span className="edu-cell__label">Estado</span>
                  {c.isActive ? (
                    <span className="edu-tag edu-tag--ok">Activa</span>
                  ) : (
                    <span className="edu-tag edu-tag--muted">Desactivada</span>
                  )}
                </div>
                <div className="edu-cell__actions">
                  {canManage ? (
                    <>
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
                      <button
                        type="button"
                        className="edu-btn edu-btn--quiet edu-btn--sm"
                        onClick={() => alternar(c)}
                        disabled={busyId === c.id}
                      >
                        {c.isActive ? "Desactivar" : "Activar"}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="edu-btn edu-btn--quiet edu-btn--sm"
                      disabled
                      title="Editar el catálogo pide el permiso de gestionar tarifarios, que por defecto solo lleva la dirección."
                    >
                      Editar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sinPareja.length > 0 && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">
              {sinPareja.length}{" "}
              {sinPareja.length === 1
                ? "texto de categoría no tiene pareja en el catálogo"
                : "textos de categoría no tienen pareja en el catálogo"}
            </p>
            <p className="edu-banner__detail">
              {sinPareja.join(" · ")}. El emparejado solo propone lo que puede afirmar sin
              equivocarse (mismo texto, sin acentos ni mayúsculas). Si alguno de éstos es una de tus
              categorías escrita de otra forma, dala de alta y empárejala abajo a mano — nadie más
              puede decidir si «Cirugía» y «Cirugía bucal» son lo mismo.
            </p>
          </div>
        </div>
      )}

      <Emparejar
        titulo="Procedimientos por emparejar"
        vacio="Todos los procedimientos con categoría ya están emparejados."
        filas={procPendientes}
        ya={procedimientos.filter((p) => p.categoryId)}
        activas={activas}
        canManage={canManage}
        busyId={busyId}
        onEmparejar={(id, categoryId, nombre) =>
          emparejar("procedimiento", id, categoryId, nombre)
        }
      />

      <Emparejar
        titulo="Requisitos por emparejar"
        vacio="Todos los requisitos que cuentan una categoría ya están emparejados."
        aviso="Emparejar un requisito PUEDE mover su avance en el momento: los casos cuyo procedimiento todavía no esté emparejado dejan de contar para él. Empareja primero los procedimientos de arriba."
        filas={reqPendientes}
        ya={requisitos.filter((r) => r.categoryId)}
        activas={activas}
        canManage={canManage}
        busyId={busyId}
        onEmparejar={(id, categoryId, nombre) => emparejar("requisito", id, categoryId, nombre)}
      />

      {(creando || editando) && (
        <EditorCategoria
          categoria={editando}
          onClose={() => {
            setCreando(false);
            setEditando(null);
          }}
          onDone={(mensaje) => {
            setCreando(false);
            setEditando(null);
            recargar(mensaje);
          }}
        />
      )}
    </>
  );
}

/**
 * La lista de lo que todavía se compara por texto, con la SUGERENCIA a un
 * clic. Se usa igual para procedimientos y para requisitos porque la
 * pregunta es la misma; lo único distinto es el aviso.
 */
function Emparejar({
  titulo,
  vacio,
  aviso,
  filas,
  ya,
  activas,
  canManage,
  busyId,
  onEmparejar,
}: {
  titulo: string;
  vacio: string;
  aviso?: string;
  filas: EduCategoriaPendienteVista[];
  ya: EduCategoriaPendienteVista[];
  activas: { id: string; name: string }[];
  canManage: boolean;
  busyId: string | null;
  onEmparejar: (id: string, categoryId: string | null, nombre: string) => void;
}) {
  return (
    <section className="edu-section">
      <div className="edu-section__head">
        <h2 className="edu-section__title">{titulo}</h2>
        <span className="edu-count">{filas.length}</span>
      </div>

      {aviso && <p className="edu-note">{aviso}</p>}

      {filas.length === 0 ? (
        <p className="edu-note">
          {vacio}
          {ya.length > 0 ? ` Hay ${ya.length} emparejado${ya.length === 1 ? "" : "s"}.` : ""}
        </p>
      ) : (
        <div className="edu-stack edu-stack--tight">
          {filas.map((f) => (
            <div key={f.id} className="edu-row">
              <div className="edu-cell edu-cell--wide">
                <span className="edu-cell__value edu-cell__value--strong">{f.name}</span>
                <span className="edu-cell__sub">
                  Hoy se compara con el texto «{f.texto}»
                  {f.sugerido
                    ? ` · el catálogo propone «${
                        activas.find((c) => c.id === f.sugerido)?.name ?? "una categoría"
                      }»`
                    : " · sin pareja propuesta"}
                </span>
              </div>
              <div className="edu-cell__actions">
                <select
                  className="edu-input edu-input--sm"
                  defaultValue={f.sugerido ?? ""}
                  disabled={!canManage || busyId === f.id}
                  aria-label={`Categoría para ${f.name}`}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    onEmparejar(f.id, v, f.name);
                  }}
                >
                  <option value="">Elige una categoría…</option>
                  {activas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EditorCategoria({
  categoria,
  onClose,
  onDone,
}: {
  categoria: { id: string; name: string; key: string; orderIndex: number } | null;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [name, setName] = useState(categoria?.name ?? "");
  const [orderIndex, setOrderIndex] = useState(String(categoria?.orderIndex ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      if (categoria) {
        await eduRequest(`/api/instituto/categorias/${categoria.id}`, {
          method: "PATCH",
          body: { name: name.trim(), orderIndex: orderIndex.trim() },
        });
        onDone(
          `«${name.trim()}» guardada. La clave sigue siendo «${categoria.key}»: renombrarla no mueve el avance de nadie.`,
        );
      } else {
        await eduRequest("/api/instituto/categorias", {
          method: "POST",
          body: { name: name.trim(), orderIndex: orderIndex.trim() },
        });
        onDone(`Categoría «${name.trim()}» capturada.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la categoría.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={categoria ? "Editar la categoría" : "Nueva categoría"}
      subtitle="Agrupa procedimientos para que un requisito pueda contarlos todos."
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
            disabled={busy || name.trim().length < 2}
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
        <label className="edu-field__label" htmlFor="edu-cat-name">
          Nombre
        </label>
        <input
          id="edu-cat-name"
          className="edu-input"
          value={name}
          maxLength={EDU_CATEGORIA_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="Endodoncia"
          autoComplete="off"
        />
      </div>

      <div className="edu-field">
        <span className="edu-field__label">Clave</span>
        <p className="edu-field__hint">
          {categoria ? (
            <>
              Es <code>{categoria.key}</code> y <strong>no se edita</strong>. Ése es el punto entero:
              la clave es lo que NO cambia cuando renombras la categoría, y por eso renombrarla deja
              de poner ningún avance a cero.
            </>
          ) : (
            <>
              Se deriva sola del nombre: <code>{eduCategoriaKeyDesdeNombre(name || "categoria")}</code>
              . Después ya no cambia nunca, aunque renombres la categoría.
            </>
          )}
        </p>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-cat-orden">
          Orden en las listas
        </label>
        <input
          id="edu-cat-orden"
          className="edu-input"
          inputMode="numeric"
          value={orderIndex}
          onChange={(e) => setOrderIndex(e.target.value)}
          autoComplete="off"
        />
        <p className="edu-field__hint">Menor primero. Con el mismo número, por nombre.</p>
      </div>
    </EduModal>
  );
}
