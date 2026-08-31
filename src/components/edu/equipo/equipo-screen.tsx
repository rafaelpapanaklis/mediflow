"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Search, SlidersHorizontal, UserPlus, Users, X } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_ROLES,
  EDU_ROLE_DESCRIPTIONS,
  EDU_ROLE_LABELS,
  type EduRole,
} from "@/lib/edu/types";
// P2-8: el catálogo de permisos es client-safe (módulo puro) y de aquí
// salen los grupos, las descripciones y el cálculo de "qué tiene hoy".
import {
  EDU_ALL_PERMISSIONS,
  EDU_PERMISSION_GROUPS,
  EDU_ROLE_DEFAULTS,
  getEduEffectivePermissions,
  type EduPermissionKey,
} from "@/lib/edu/permissions";
import {
  EDU_TEAM_BULK_CHUNK,
  eduTeamCredentialsText,
  eduTeamRowsListas,
  parseEduTeamPaste,
  type EduTeamAltaResult,
  type EduTeamFilters,
  type EduTeamParsedRow,
  type EduTeamRow,
} from "@/lib/edu/equipo-core";

/**
 * /instituto/equipo — dar de alta y de baja las cuentas del instituto.
 *
 * QUÉ DECIDE ESTA PANTALLA Y QUÉ NO:
 *  · NO decide quién puede entrar aquí. La página ya exigió "equipo.manage"
 *    y los dos endpoints lo vuelven a exigir: si alguien fabrica la
 *    petición desde la consola, el servidor contesta 403.
 *  · NO valida de verdad. La vista previa del pegado usa EXACTAMENTE el
 *    mismo `parseEduTeamPaste` que corre en el servidor, pero el servidor
 *    no se fía: revalida cada fila antes de tocar Supabase.
 *
 * 🔴 LA CONTRASEÑA TEMPORAL SE VE UNA VEZ. No se guarda en ninguna parte, y
 * por eso el panel de credenciales NO se cierra solo: se queda hasta que
 * quien dio de alta pulse "Ya las copié". Un `router.refresh()` recarga la
 * lista del servidor sin tocar ese estado, que vive aquí.
 */
export interface EduEquipoScreenProps {
  rows: EduTeamRow[];
  truncated: boolean;
  maxRows: number;
  filters: EduTeamFilters;
}

const TAG_BY_ROLE: Record<EduRole, string> = {
  DIRECCION: "edu-tag--info",
  DOCENTE: "edu-tag--ok",
  ALUMNO: "edu-tag--muted",
  CAJA: "edu-tag--warn",
};

/**
 * Copia al portapapeles y avisa. Devuelve `false` si el navegador no dejó
 * —pasa en http sin certificado y en algunos móviles—, y entonces la
 * pantalla enseña el texto seleccionable para copiarlo a mano en vez de
 * mentir con una palomita.
 */
async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* cae al método de abajo */
  }
  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Botón de copiar con acuse: la palomita dura dos segundos y vuelve. */
function BotonCopiar({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [estado, setEstado] = useState<"listo" | "ok" | "falla">("listo");
  return (
    <button
      type="button"
      className="edu-btn edu-btn--ghost edu-btn--sm"
      onClick={async () => {
        const ok = await copiarAlPortapapeles(texto);
        setEstado(ok ? "ok" : "falla");
        window.setTimeout(() => setEstado("listo"), 2200);
      }}
    >
      {estado === "ok" ? <Check size={15} /> : <Copy size={15} />}
      {estado === "ok" ? "Copiado" : estado === "falla" ? "Cópialo a mano" : etiqueta}
    </button>
  );
}

/**
 * El panel de credenciales. Lo que ve quien acaba de dar de alta a una
 * persona o a una generación entera.
 *
 * 🔴 No se cierra solo ni al recargar la lista: estas contraseñas no están
 * guardadas en ningún sitio y no hay forma de volver a verlas.
 */
function PanelCredenciales({
  resultados,
  onListo,
}: {
  resultados: EduTeamAltaResult[];
  onListo: () => void;
}) {
  const creados = resultados.filter((r) => r.ok);
  const fallidos = resultados.filter((r) => !r.ok);
  const conPassword = creados.filter((r) => r.tempPassword);

  return (
    <div className="edu-creds" role="status">
      <div className="edu-creds__head">
        <div>
          <p className="edu-banner__title">
            {creados.length === 1
              ? "Cuenta creada"
              : `${creados.length} cuentas creadas`}
            {fallidos.length > 0 ? ` · ${fallidos.length} sin crear` : ""}
          </p>
          <p className="edu-banner__detail">
            {conPassword.length > 0
              ? "Éstas son las contraseñas temporales, y es la ÚNICA vez que se pueden ver. Cópialas antes de cerrar: no se guardan en ninguna parte."
              : "Nadie estrenó contraseña: todos estos correos ya tenían cuenta en DaleControl y entran con la suya de siempre."}
          </p>
        </div>
        <div className="edu-creds__acciones">
          {conPassword.length > 0 && (
            <BotonCopiar texto={eduTeamCredentialsText(resultados)} etiqueta="Copiar la tabla" />
          )}
          <button type="button" className="edu-btn edu-btn--primary edu-btn--sm" onClick={onListo}>
            Ya las copié
          </button>
        </div>
      </div>

      <div className="edu-table edu-table--creds">
        <div className="edu-rowhead" aria-hidden="true">
          <span>Persona</span>
          <span>Correo</span>
          <span>Rol</span>
          <span>Contraseña temporal</span>
        </div>
        {resultados.map((r, i) => (
          <div key={`${r.email}-${i}`} className={`edu-row ${r.ok ? "" : "edu-row--off"}`}>
            <div className="edu-cell edu-cell--wide">
              <span className="edu-cell__label">Persona</span>
              <span className="edu-cell__value edu-cell__value--strong">{r.name || "—"}</span>
            </div>
            <div className="edu-cell">
              <span className="edu-cell__label">Correo</span>
              <span className="edu-cell__value">{r.email}</span>
            </div>
            <div className="edu-cell">
              <span className="edu-cell__label">Rol</span>
              <span className="edu-cell__value">{r.role ? EDU_ROLE_LABELS[r.role] : "—"}</span>
            </div>
            <div className="edu-cell edu-cell--wide">
              <span className="edu-cell__label">Contraseña temporal</span>
              {r.ok && r.tempPassword ? (
                <span className="edu-creds__pass">
                  <code>{r.tempPassword}</code>
                  <BotonCopiar texto={r.tempPassword} etiqueta="Copiar" />
                </span>
              ) : r.ok && r.reused ? (
                <span className="edu-cell__sub">
                  Ya tenía cuenta en DaleControl: entra con su contraseña de siempre.
                </span>
              ) : (
                <span className="edu-cell__sub edu-creds__error">{r.error}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// LA PANTALLA
// ═══════════════════════════════════════════════════════════════════════

export function EduEquipoScreen({ rows, truncated, maxRows, filters }: EduEquipoScreenProps) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [q, setQ] = useState(filters.q ?? "");
  const [alta, setAlta] = useState<"individual" | "masiva" | null>(null);
  // P2-8: la persona cuyos permisos se están editando.
  const [permisosDe, setPermisosDe] = useState<EduTeamRow | null>(null);
  const [credenciales, setCredenciales] = useState<EduTeamAltaResult[] | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const hayFiltros = Boolean(filters.role || filters.estado || filters.q);

  function aplicar(next: Partial<Record<"rol" | "estado" | "q", string>>) {
    const actual: Record<string, string> = {};
    if (filters.role) actual.rol = filters.role;
    if (filters.estado) actual.estado = filters.estado;
    if (filters.q) actual.q = filters.q;

    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...actual, ...next })) {
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    startNav(() => {
      router.replace(qs ? `/instituto/equipo?${qs}` : "/instituto/equipo", { scroll: false });
    });
  }

  /**
   * Cierra el diálogo y enseña las credenciales.
   *
   * El `aviso` existe para UN caso concreto: el alta masiva que se corta a
   * la mitad. Ahí hay credenciales que enseñar Y un error que contar, y el
   * error tiene que vivir AQUÍ y no dentro del diálogo — el diálogo se
   * desmonta en esta misma función y el mensaje se perdería sin que nadie
   * lo viera.
   */
  function alCrear(resultados: EduTeamAltaResult[], aviso?: string | null) {
    setAlta(null);
    setError(aviso ?? null);
    setFlash(null);
    setCredenciales(resultados);
    startNav(() => router.refresh());
  }

  async function cambiarEstado(persona: EduTeamRow) {
    setError(null);
    setFlash(null);
    setBusyId(persona.id);
    try {
      await eduRequest(`/api/instituto/equipo/${persona.id}`, {
        method: "PATCH",
        body: { isActive: !persona.isActive },
      });
      setFlash(
        persona.isActive
          ? `${persona.name} queda dado de baja. Su historial no se toca: sigue siendo el autor de lo que escribió.`
          : `${persona.name} vuelve a tener acceso.`,
      );
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar el estado de la cuenta.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {credenciales && (
        <PanelCredenciales resultados={credenciales} onListo={() => setCredenciales(null)} />
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

      <form
        className="edu-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          aplicar({ q: q.trim() });
        }}
      >
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-eq-q">
            Buscar
          </label>
          <div className="edu-input-wrap">
            <input
              id="edu-eq-q"
              className="edu-input edu-input--sm"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nombre, correo o teléfono"
              autoComplete="off"
            />
            <button type="submit" className="edu-reveal" aria-label="Buscar">
              <Search size={17} />
            </button>
          </div>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-eq-rol">
            Rol
          </label>
          <select
            id="edu-eq-rol"
            className="edu-input edu-input--sm"
            value={filters.role ?? ""}
            onChange={(e) => aplicar({ rol: e.target.value })}
          >
            <option value="">Todos</option>
            {EDU_ROLES.map((r) => (
              <option key={r} value={r}>
                {EDU_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-eq-estado">
            Estado
          </label>
          <select
            id="edu-eq-estado"
            className="edu-input edu-input--sm"
            value={filters.estado ?? ""}
            onChange={(e) => aplicar({ estado: e.target.value })}
          >
            <option value="">Todas</option>
            <option value="activos">Con acceso</option>
            <option value="inactivos">Dadas de baja</option>
          </select>
        </div>

        {hayFiltros && (
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() => {
              setQ("");
              startNav(() => router.replace("/instituto/equipo", { scroll: false }));
            }}
          >
            <X size={15} />
            Limpiar
          </button>
        )}
      </form>

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {navigating
            ? "Buscando…"
            : `${rows.length} ${rows.length === 1 ? "cuenta" : "cuentas"}${truncated ? ` (se muestran las primeras ${maxRows})` : ""}`}
        </span>
        <div className="edu-actions">
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() => setAlta("masiva")}
          >
            <Users size={16} />
            Alta masiva
          </button>
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            onClick={() => setAlta("individual")}
          >
            <UserPlus size={16} />
            Dar de alta
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">
            {hayFiltros ? "Ninguna cuenta coincide" : "Todavía no hay nadie más en el instituto"}
          </p>
          <p className="edu-empty__detail">
            {hayFiltros
              ? "Prueba con menos filtros. El buscador ignora los acentos y las mayúsculas."
              : "Da de alta a la dirección, a los docentes, a los estudiantes y a caja. A cada persona se le crea el acceso y se te muestra su contraseña temporal una sola vez."}
          </p>
        </div>
      ) : (
        <div className="edu-table edu-table--equipo">
          <div className="edu-rowhead" aria-hidden="true">
            <span>Persona</span>
            <span>Correo</span>
            <span>Rol</span>
            <span>Matrícula</span>
            <span>Estado</span>
            <span />
          </div>

          {rows.map((p) => (
            <div key={p.id} className={`edu-row ${p.isActive ? "" : "edu-row--off"}`}>
              <div className="edu-cell edu-cell--wide">
                <span className="edu-cell__label">Persona</span>
                <span className="edu-cell__value edu-cell__value--strong">{p.name}</span>
                {p.phone && <span className="edu-cell__sub">{p.phone}</span>}
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Correo</span>
                <span className="edu-cell__value">{p.email}</span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Rol</span>
                <span className={`edu-tag ${TAG_BY_ROLE[p.role]}`}>{EDU_ROLE_LABELS[p.role]}</span>
                {/* P2-8: la fila DICE cuando alguien no usa el default del
                    rol — un override invisible es cómo la dirección olvida
                    quién tiene qué. */}
                {p.permissionsOverride.length > 0 && (
                  <span className="edu-cell__sub">Permisos personalizados</span>
                )}
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Matrícula</span>
                {p.role !== "ALUMNO" ? (
                  <span className="edu-cell__sub">No aplica</span>
                ) : p.hasStudentProfile ? (
                  <span className="edu-cell__value">{p.matricula}</span>
                ) : (
                  <span className="edu-cell__sub">Falta inscribirlo</span>
                )}
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Estado</span>
                <span className={`edu-tag ${p.isActive ? "edu-tag--ok" : "edu-tag--muted"}`}>
                  {p.isActive ? "Con acceso" : "Dada de baja"}
                </span>
              </div>

              <div className="edu-cell__actions">
                {/* P2-8: los permisos se editan por persona. Deshabilitado
                    para uno mismo — el servidor lo rebota igual; así, quien
                    edita conserva siempre su equipo.manage y el instituto
                    no se queda sin administrador por una casilla. */}
                <button
                  type="button"
                  className="edu-btn edu-btn--ghost edu-btn--sm"
                  onClick={() => {
                    setFlash(null);
                    setError(null);
                    setPermisosDe(p);
                  }}
                  disabled={busyId === p.id || p.isSelf}
                  title={
                    p.isSelf
                      ? "No puedes editar tus propios permisos."
                      : "Qué puede ver y hacer esta cuenta, casilla por casilla."
                  }
                >
                  <SlidersHorizontal size={15} />
                  Permisos
                </button>
                <button
                  type="button"
                  className={`edu-btn edu-btn--sm ${p.isActive ? "edu-btn--ghost" : "edu-btn--primary"}`}
                  onClick={() => cambiarEstado(p)}
                  disabled={busyId === p.id || p.isSelf}
                  // Nadie se da de baja a sí mismo: con una sola dirección
                  // en la escuela sería cerrar la puerta desde dentro. El
                  // servidor lo vuelve a rechazar, esto solo lo explica.
                  title={
                    p.isSelf
                      ? "No puedes darte de baja a ti mismo."
                      : p.isActive
                        ? "Le quita el acceso al panel. No borra nada de lo que hizo."
                        : "Le devuelve el acceso al panel."
                  }
                >
                  {busyId === p.id ? "…" : p.isActive ? "Dar de baja" : "Reactivar"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {alta === "individual" && (
        <ModalAlta onClose={() => setAlta(null)} onDone={alCrear} />
      )}
      {alta === "masiva" && <ModalMasiva onClose={() => setAlta(null)} onDone={alCrear} />}
      {permisosDe && (
        <ModalPermisos
          persona={permisosDe}
          onClose={() => setPermisosDe(null)}
          onDone={(mensaje) => {
            setPermisosDe(null);
            setError(null);
            setFlash(mensaje);
            startNav(() => router.refresh());
          }}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PERMISOS (P2-8) — la pantalla que el catálogo prometía desde la Ola 0
//
// EDU_PERMISSION_GROUPS y sanitizeEduPermissionKeys existían "para la
// pantalla de permisos del instituto" y ninguna tenía un llamador: el
// override solo se podía escribir por SQL, y todas las mitigaciones del
// estilo "se le enciende por override desde la pantalla de permisos" eran
// teóricas. Éste es el editor. Vive aquí y no en una pantalla propia
// porque los permisos son UN atributo de la cuenta, igual que el estado:
// quien administra el equipo los ve a un botón de distancia de la persona,
// no en otra sección del menú.
// ═══════════════════════════════════════════════════════════════════════

function ModalPermisos({
  persona,
  onClose,
  onDone,
}: {
  persona: EduTeamRow;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  // Arranca de lo EFECTIVO (override si hay; si no, el default del rol):
  // es lo que la persona puede hacer HOY, que es de donde se parte para
  // encender o apagar algo.
  const permUser = { role: persona.role, permissionsOverride: persona.permissionsOverride };
  const [keys, setKeys] = useState<Set<EduPermissionKey>>(
    () => new Set(getEduEffectivePermissions(permUser)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tieneOverride = persona.permissionsOverride.length > 0;
  const defaults = useMemo(
    () => new Set(EDU_ROLE_DEFAULTS[persona.role] ?? []),
    [persona.role],
  );
  // ¿Lo marcado es EXACTAMENTE el default? Entonces guardar como override
  // no aporta nada (y congelaría a la persona fuera de las keys que ganen
  // los roles en olas futuras): se guarda como "restaurar el rol".
  const igualAlDefault = useMemo(() => {
    if (keys.size !== defaults.size) return false;
    let igual = true;
    keys.forEach((k) => {
      if (!defaults.has(k)) igual = false;
    });
    return igual;
  }, [keys, defaults]);

  function alternar(key: EduPermissionKey) {
    setKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function guardar(restaurar: boolean) {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/equipo/${persona.id}`, {
        method: "PATCH",
        body: {
          // null = restaurar el rol. También cuando lo marcado ES el
          // default: un override idéntico al rol solo serviría para que la
          // persona no reciba las keys que su rol gane en olas futuras.
          permissionsOverride: restaurar || igualAlDefault ? null : Array.from(keys),
        },
      });
      onDone(
        restaurar || igualAlDefault
          ? `${persona.name} vuelve a los permisos de su rol (${EDU_ROLE_LABELS[persona.role]}).`
          : `Los permisos de ${persona.name} quedaron personalizados. La fila lo marca, para que no se olvide.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron guardar los permisos.");
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={`Permisos de ${persona.name}`}
      subtitle={`${EDU_ROLE_LABELS[persona.role]} · ${
        tieneOverride ? "con permisos personalizados" : "con los permisos de su rol"
      }`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          {tieneOverride && (
            <button
              type="button"
              className="edu-btn edu-btn--ghost"
              onClick={() => guardar(true)}
              disabled={busy}
              title="Borra la personalización: la cuenta vuelve a lo que diga su rol, hoy y en lo que gane mañana."
            >
              Restaurar el rol
            </button>
          )}
          <button
            type="button"
            className="edu-btn edu-btn--primary"
            onClick={() => guardar(false)}
            disabled={busy || keys.size === 0}
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

      <p className="edu-note">
        Lo marcado REEMPLAZA a los permisos del rol: si personalizas, esta cuenta deja de recibir
        en automático lo que su rol gane después — la fila queda marcada para que se recuerde. Y
        una casilla de más no abre datos cerrados por diseño: el dinero, el expediente para caja y
        el panel de dirección tienen un segundo candado que no está aquí.
      </p>
      {keys.size === 0 && (
        <div className="edu-alert" role="alert">
          Sin ninguna casilla no hay permisos que guardar. Para cerrarle el panel a alguien, dale
          de baja; para dejarlo como su rol, usa «Restaurar el rol».
        </div>
      )}

      {EDU_PERMISSION_GROUPS.map((grupo) => (
        <fieldset className="edu-field" key={grupo.title}>
          <legend className="edu-field__label">{grupo.title}</legend>
          {grupo.keys.map((key) => (
            <label
              key={key}
              style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "3px 0" }}
            >
              <input
                type="checkbox"
                checked={keys.has(key)}
                onChange={() => alternar(key)}
                disabled={busy}
                style={{ marginTop: 3 }}
              />
              <span style={{ minWidth: 0 }}>
                <span className="edu-cell__value">{EDU_ALL_PERMISSIONS[key]}</span>{" "}
                <span className="edu-cell__sub">
                  {key}
                  {defaults.has(key) ? "" : " · fuera del rol"}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      ))}
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ALTA INDIVIDUAL
// ═══════════════════════════════════════════════════════════════════════

function ModalAlta({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (resultados: EduTeamAltaResult[], aviso?: string | null) => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<EduRole | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      const res = await eduRequest<EduTeamAltaResult>("/api/instituto/equipo", {
        method: "POST",
        body: { firstName, lastName, email, role, phone: phone || null },
      });
      onDone([res]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo dar de alta a esa persona.");
    } finally {
      setBusy(false);
    }
  }

  const listo = Boolean(firstName.trim() && lastName.trim() && email.trim() && role);

  return (
    <EduModal
      title="Dar de alta"
      subtitle="Se le crea el acceso y se te muestra su contraseña temporal una sola vez."
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
            disabled={busy || !listo}
          >
            {busy ? "Creando…" : "Crear cuenta"}
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
          <label className="edu-field__label" htmlFor="edu-eq-nombre">
            Nombre
          </label>
          <input
            id="edu-eq-nombre"
            className="edu-input"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-eq-apellidos">
            Apellidos
          </label>
          <input
            id="edu-eq-apellidos"
            className="edu-input"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-eq-correo">
          Correo
        </label>
        <input
          id="edu-eq-correo"
          className="edu-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nombre@instituto.mx"
          autoComplete="off"
        />
        <span className="edu-field__hint">
          Es con lo que entra al panel. Si ya usa DaleControl con este correo —en el panel dental o
          en otro instituto— se le enlaza esa misma cuenta y sigue entrando con su contraseña de
          siempre.
        </span>
      </div>

      <div className="edu-formgrid edu-formgrid--2">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-eq-role">
            Rol
          </label>
          <select
            id="edu-eq-role"
            className="edu-input"
            value={role}
            onChange={(e) => setRole(e.target.value as EduRole | "")}
          >
            <option value="">Elige…</option>
            {EDU_ROLES.map((r) => (
              <option key={r} value={r}>
                {EDU_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          {role && <span className="edu-field__hint">{EDU_ROLE_DESCRIPTIONS[role]}</span>}
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-eq-tel">
            Teléfono (opcional)
          </label>
          <input
            id="edu-eq-tel"
            className="edu-input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>

      {role === "ALUMNO" && (
        <p className="edu-note">
          Crear la cuenta no lo inscribe: después hay que darle matrícula, especialidad y generación
          desde Estudiantes.
        </p>
      )}
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ALTA MASIVA
//
// Tres pasos, y el de en medio es el que importa: PEGAR → VER QUÉ SE VA A
// CREAR → crear. Sin la vista previa, un archivo con una columna de más
// crearía 200 cuentas con el apellido en el correo y no habría forma de
// deshacerlo (las cuentas no se borran).
// ═══════════════════════════════════════════════════════════════════════

function ModalMasiva({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (resultados: EduTeamAltaResult[], aviso?: string | null) => void;
}) {
  const [texto, setTexto] = useState("");
  const [rolPorDefecto, setRolPorDefecto] = useState<EduRole>("ALUMNO");
  const [busy, setBusy] = useState(false);
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // La MISMA función que corre en el servidor. Si fueran dos, la vista
  // previa acabaría diciendo que el renglón 12 está bien y el alta lo
  // rechazaría.
  const filas = useMemo(
    () => parseEduTeamPaste(texto, rolPorDefecto),
    [texto, rolPorDefecto],
  );
  const listas = useMemo(() => eduTeamRowsListas(filas), [filas]);
  const conError = filas.filter((f) => f.error);

  async function crear() {
    setError(null);
    setBusy(true);
    const acumulado: EduTeamAltaResult[] = [];
    try {
      // Se manda por TROZOS. No es un límite de cuánta gente cabe: es que
      // cada alta es una llamada a Supabase Auth de unos cientos de
      // milisegundos, y 200 en una sola petición se comerían el tiempo
      // máximo de la función a mitad de la generación.
      setProgreso({ hechas: 0, total: listas.length });
      for (let i = 0; i < listas.length; i += EDU_TEAM_BULK_CHUNK) {
        const trozo = listas.slice(i, i + EDU_TEAM_BULK_CHUNK);
        const res = await eduRequest<{ results: EduTeamAltaResult[] }>(
          "/api/instituto/equipo",
          {
            method: "POST",
            body: {
              rows: trozo.map((f) => ({
                firstName: f.firstName,
                lastName: f.lastName,
                email: f.email,
                role: f.role,
              })),
            },
          },
        );
        acumulado.push(...res.results);
        // Se cuenta lo REALMENTE contestado, no el índice del bucle: si un
        // trozo devuelve menos filas de las que se mandaron, el contador
        // tiene que decir la verdad.
        setProgreso({ hechas: acumulado.length, total: listas.length });
      }
      onDone(acumulado);
    } catch (err) {
      // Lo que ya se creó, se creó: no hay forma de deshacerlo (las cuentas
      // no se borran) y tampoco habría que hacerlo. Se enseñan esas
      // credenciales y se dice hasta dónde se llegó, en vez de perderlas
      // junto con el error.
      const mensaje = err instanceof Error ? err.message : "Se cortó el alta masiva.";
      if (acumulado.length > 0) {
        // 🔴 El aviso viaja al PADRE, no a este `setError`: onDone desmonta
        // este diálogo en el mismo tick y el mensaje no se vería nunca.
        onDone(
          acumulado,
          `${mensaje} Se alcanzaron a crear ${acumulado.length} de ${listas.length}: copia sus contraseñas y vuelve a pegar el resto.`,
        );
        return;
      }
      setError(mensaje);
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Alta masiva"
      subtitle="Pega la lista, revisa lo que se va a crear y confirma."
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
            onClick={crear}
            disabled={busy || listas.length === 0}
          >
            {busy
              ? `Creando ${progreso?.hechas ?? 0} de ${progreso?.total ?? listas.length}…`
              : listas.length === 0
                ? "Nada que crear"
                : `Crear ${listas.length} ${listas.length === 1 ? "cuenta" : "cuentas"}`}
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
        <label className="edu-field__label" htmlFor="edu-eq-pegado">
          Una persona por renglón
        </label>
        <textarea
          id="edu-eq-pegado"
          className="edu-input edu-textarea"
          rows={8}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={"María Elena, Rodríguez Gómez, maria@instituto.mx, Estudiante\nJuan, Pérez, juan@instituto.mx"}
          spellCheck={false}
        />
        <span className="edu-field__hint">
          Separado por comas o por tabuladores (se puede pegar directo de Excel):
          <strong> nombre, apellidos, correo, rol</strong>. Si el renglón no trae rol se usa el de
          abajo. Sin límite de renglones: una generación de 200 se manda sola, por partes.
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-eq-roldef">
          Rol para los renglones que no lo traigan
        </label>
        <select
          id="edu-eq-roldef"
          className="edu-input"
          value={rolPorDefecto}
          onChange={(e) => setRolPorDefecto(e.target.value as EduRole)}
        >
          {EDU_ROLES.map((r) => (
            <option key={r} value={r}>
              {EDU_ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      {filas.length > 0 && <VistaPrevia filas={filas} listas={listas.length} errores={conError.length} />}
    </EduModal>
  );
}

/** Lo que se va a crear, renglón por renglón, ANTES de crear nada. */
function VistaPrevia({
  filas,
  listas,
  errores,
}: {
  filas: EduTeamParsedRow[];
  listas: number;
  errores: number;
}) {
  return (
    <div className="edu-preview">
      <p className="edu-preview__resumen">
        <strong>{listas}</strong> {listas === 1 ? "cuenta lista" : "cuentas listas"}
        {errores > 0 && (
          <>
            {" · "}
            <span className="edu-preview__mal">
              {errores} {errores === 1 ? "renglón con problema" : "renglones con problema"}
            </span>
          </>
        )}
        . Los renglones con problema <strong>no se crean</strong>; el resto sí.
      </p>

      <ul className="edu-preview__lista">
        {filas.map((f) => (
          <li
            key={f.line}
            className={
              f.isHeader
                ? "edu-preview__fila edu-preview__fila--nota"
                : f.error
                  ? "edu-preview__fila edu-preview__fila--mal"
                  : "edu-preview__fila"
            }
          >
            <span className="edu-preview__num">{f.line}</span>
            {f.isHeader ? (
              <span className="edu-preview__detalle">
                Parece el encabezado de la tabla: se ignora.
              </span>
            ) : f.error ? (
              <span className="edu-preview__detalle">
                <span className="edu-preview__crudo">{f.raw.trim()}</span>
                <span className="edu-preview__mal">{f.error}</span>
              </span>
            ) : (
              <span className="edu-preview__detalle">
                <span className="edu-preview__nombre">
                  {f.firstName} {f.lastName}
                </span>
                <span className="edu-cell__sub">
                  {f.email} · {f.role ? EDU_ROLE_LABELS[f.role] : ""}
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
