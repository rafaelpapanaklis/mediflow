"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Armchair, Building2, Plus, Users } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import { EDU_ROLE_LABELS } from "@/lib/edu/types";
import {
  EDU_CAMPUS_ADDRESS_MAX,
  EDU_CAMPUS_CODE_MAX,
  EDU_CAMPUS_NAME_MAX,
  suggestEduCampusCode,
  type EduCampusPersonRow,
  type EduCampusRow,
} from "@/lib/edu/campus-core";

/**
 * /instituto/sedes — las sedes del instituto y quién entra a cada una.
 *
 * 🔴 LA SEDE NO ES OTRO INSTITUTO. Es una división DENTRO de la escuela:
 * los alumnos, las generaciones y las especialidades son los mismos en
 * todas —un alumno rota entre sedes y su padrón es uno solo— y lo que
 * cambia de sede a sede son los SILLONES, y con ellos la agenda y la caja.
 * La pantalla lo dice arriba, porque es lo primero que alguien supone mal.
 *
 * 🔴 SIN SEDES MARCADAS = ENTRA A TODAS. Es al revés de lo que sugiere una
 * lista de accesos, y es lo que hace que aplicar esta ola no deje a nadie
 * fuera. Está escrito en el modal de acceso con todas sus letras, y cuando
 * se le quita a alguien su última sede la pantalla avisa de que acaba de
 * abrírselas todas.
 *
 * `canManage` llega ya resuelto y CADA endpoint lo vuelve a exigir: si
 * alguien fabrica el botón desde la consola, el servidor contesta 403.
 */
export interface EduSedesScreenProps {
  rows: EduCampusRow[];
  canManage: boolean;
  /** Zona del instituto: el default de una sede nueva. */
  institutionTimezone: string;
}

export function EduSedesScreen({ rows, canManage, institutionTimezone }: EduSedesScreenProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [alta, setAlta] = useState(false);
  const [editando, setEditando] = useState<EduCampusRow | null>(null);
  const [acceso, setAcceso] = useState<EduCampusRow | null>(null);
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
          {rows.length} {rows.length === 1 ? "sede" : "sedes"}
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
            Nueva sede
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Todavía no hay sedes</p>
          <p className="edu-empty__detail">
            Si tu escuela tiene un solo edificio, aquí habrá una sola sede y nadie verá nunca
            el selector de arriba: no se elige entre una opción. Da de alta una segunda
            cuando abras otro campus, y podrás colgarle sus propios sillones.
          </p>
        </div>
      ) : (
        <div className="edu-sedes">
          {rows.map((s) => (
            <article key={s.id} className={`edu-sede ${s.isActive ? "" : "edu-sede--off"}`}>
              <div className="edu-sede__head">
                <Building2 size={18} aria-hidden="true" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2 className="edu-sede__name">{s.name}</h2>
                  <span className="edu-sede__code">{s.code}</span>
                </div>
                {!s.isActive && <span className="edu-tag edu-tag--muted">Cerrada</span>}
              </div>

              <div className="edu-sede__data">
                <span>{s.address || "Sin dirección capturada"}</span>
                <span>{[s.city, s.state].filter(Boolean).join(", ") || "Sin ciudad"}</span>
                <span>
                  Hora local: <strong>{s.timezone}</strong>
                  {s.timezone !== institutionTimezone ? " · distinta a la del instituto" : ""}
                </span>
                {s.phone && <span>{s.phone}</span>}
                {s.notes && <span>{s.notes}</span>}
              </div>

              <div className="edu-sede__nums">
                <span className="edu-chip">
                  <Armchair size={12} aria-hidden="true" />
                  {s.chairs} {s.chairs === 1 ? "sillón" : "sillones"}
                  {s.chairs !== s.activeChairs ? ` (${s.activeChairs} activos)` : ""}
                </span>
                <span className="edu-chip">
                  {s.upcoming} {s.upcoming === 1 ? "cita próxima" : "citas próximas"}
                </span>
                <span className="edu-chip">
                  <Users size={12} aria-hidden="true" />
                  {s.people === 0
                    ? "Nadie restringido a ella"
                    : `${s.people} ${s.people === 1 ? "persona restringida" : "personas restringidas"}`}
                </span>
              </div>

              {canManage && (
                <div className="edu-actions">
                  <button
                    type="button"
                    className="edu-btn edu-btn--ghost edu-btn--sm"
                    onClick={() => {
                      setFlash(null);
                      setEditando(s);
                    }}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="edu-btn edu-btn--ghost edu-btn--sm"
                    onClick={() => {
                      setFlash(null);
                      setAcceso(s);
                    }}
                  >
                    <Users size={15} />
                    Quién entra
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {alta && (
        <FormularioSede
          institutionTimezone={institutionTimezone}
          onClose={() => setAlta(false)}
          onDone={(nombre) => {
            setAlta(false);
            recargar(`${nombre} quedó dada de alta.`);
          }}
        />
      )}

      {editando && (
        <FormularioSede
          sede={editando}
          institutionTimezone={institutionTimezone}
          onClose={() => setEditando(null)}
          onDone={(mensaje) => {
            setEditando(null);
            recargar(mensaje);
          }}
        />
      )}

      {acceso && (
        <AccesoSede
          sede={acceso}
          onClose={() => setAcceso(null)}
          onDone={(mensaje) => {
            setAcceso(null);
            recargar(mensaje);
          }}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Alta y edición — el MISMO formulario
//
// Un alta y una edición de sede piden exactamente los mismos datos, y dos
// formularios distintos son dos sitios donde olvidarse de un campo.
// ═══════════════════════════════════════════════════════════════════════

function FormularioSede({
  sede,
  institutionTimezone,
  onClose,
  onDone,
}: {
  sede?: EduCampusRow;
  institutionTimezone: string;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const editando = Boolean(sede);
  const [nombre, setNombre] = useState(sede?.name ?? "");
  const [clave, setClave] = useState(sede?.code ?? "");
  const [claveTocada, setClaveTocada] = useState(editando);
  const [direccion, setDireccion] = useState(sede?.address ?? "");
  const [ciudad, setCiudad] = useState(sede?.city ?? "");
  const [estado, setEstado] = useState(sede?.state ?? "");
  const [telefono, setTelefono] = useState(sede?.phone ?? "");
  const [zona, setZona] = useState(sede?.timezone ?? institutionTimezone);
  const [notas, setNotas] = useState(sede?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // La clave se propone a partir del nombre hasta que alguien la toca: sin
  // esto, dar de alta una sede empieza por inventarse un código.
  const claveFinal = claveTocada ? clave : suggestEduCampusCode(nombre);

  async function guardar() {
    setError(null);
    setBusy(true);
    const body = {
      name: nombre.trim(),
      code: claveFinal,
      address: direccion.trim(),
      city: ciudad.trim(),
      state: estado.trim(),
      phone: telefono.trim(),
      timezone: zona.trim(),
      notes: notas.trim(),
    };
    try {
      if (sede) {
        await eduRequest(`/api/instituto/sedes/${sede.id}`, { method: "PATCH", body });
        onDone(`${body.name} quedó actualizada.`);
      } else {
        await eduRequest("/api/instituto/sedes", { method: "POST", body });
        onDone(body.name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function cambiarEstado() {
    if (!sede) return;
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/sedes/${sede.id}`, {
        method: "PATCH",
        body: { isActive: !sede.isActive },
      });
      onDone(
        sede.isActive
          ? `${sede.name} quedó cerrada. Sus sillones y sus citas siguen ahí.`
          : `${sede.name} está abierta otra vez.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={sede ? sede.name : "Nueva sede"}
      subtitle="Una sede es un edificio de la escuela: tiene sus propios sillones y su propia hora local. Los estudiantes, en cambio, son los mismos en todas."
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
            disabled={busy || !nombre.trim() || !claveFinal}
          >
            {busy ? "Guardando…" : editando ? "Guardar" : "Dar de alta"}
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
          <label className="edu-field__label" htmlFor="edu-sede-nombre">
            Nombre
          </label>
          <input
            id="edu-sede-nombre"
            className="edu-input"
            value={nombre}
            maxLength={EDU_CAMPUS_NAME_MAX}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Campus Norte"
            autoComplete="off"
          />
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-sede-clave">
            Clave
          </label>
          <input
            id="edu-sede-clave"
            className="edu-input"
            value={claveFinal}
            maxLength={EDU_CAMPUS_CODE_MAX}
            onChange={(e) => {
              setClaveTocada(true);
              setClave(e.target.value);
            }}
            placeholder="NORTE"
            autoComplete="off"
          />
          <span className="edu-field__hint">
            La que tu escuela ya usa en sus papeles. Se guarda en mayúsculas y no se puede
            repetir en el instituto.
          </span>
        </div>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-sede-dir">
          Dirección
        </label>
        <input
          id="edu-sede-dir"
          className="edu-input"
          value={direccion}
          maxLength={EDU_CAMPUS_ADDRESS_MAX}
          onChange={(e) => setDireccion(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="edu-formgrid edu-formgrid--2">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-sede-ciudad">
            Ciudad
          </label>
          <input
            id="edu-sede-ciudad"
            className="edu-input"
            value={ciudad}
            maxLength={80}
            onChange={(e) => setCiudad(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-sede-estado">
            Estado
          </label>
          <input
            id="edu-sede-estado"
            className="edu-input"
            value={estado}
            maxLength={80}
            onChange={(e) => setEstado(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="edu-formgrid edu-formgrid--2">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-sede-tel">
            Teléfono
          </label>
          <input
            id="edu-sede-tel"
            className="edu-input"
            value={telefono}
            maxLength={30}
            onChange={(e) => setTelefono(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-sede-zona">
            Zona horaria
          </label>
          <input
            id="edu-sede-zona"
            className="edu-input"
            value={zona}
            maxLength={60}
            onChange={(e) => setZona(e.target.value)}
            placeholder={institutionTimezone}
            autoComplete="off"
          />
          <span className="edu-field__hint">
            Solo cámbiala si esta sede está en otro huso. La agenda de la sede se pinta y se
            guarda con esta hora.
          </span>
        </div>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-sede-notas">
          Notas
        </label>
        <input
          id="edu-sede-notas"
          className="edu-input"
          value={notas}
          maxLength={300}
          onChange={(e) => setNotas(e.target.value)}
          autoComplete="off"
        />
      </div>

      {sede && (
        <div className="edu-section">
          <p className="edu-note">
            {sede.isActive
              ? `Cerrar esta sede NO cancela sus citas ni mueve sus sillones: deja de ofrecerse al agendar y sale del selector. ${
                  sede.upcoming > 0
                    ? `Ojo: tiene ${sede.upcoming} ${
                        sede.upcoming === 1 ? "cita próxima" : "citas próximas"
                      } en sus ${sede.chairs} ${sede.chairs === 1 ? "sillón" : "sillones"}, y habrá que reagendarlas a mano.`
                    : "Ahora mismo no tiene citas próximas."
                }`
              : "Está cerrada: no aparece en el selector ni al agendar. Vuelve a abrirla para usarla."}
          </p>
          <p className="edu-note">
            Una sede no se borra nunca, y no es solo por su historia: los accesos de las
            personas cuelgan de ella, y quien se queda sin ninguna sede marcada pasa a entrar
            a <strong>todas</strong>. Borrarla le abriría el instituto entero a quien solo
            entraba aquí.
          </p>
          <div className="edu-actions">
            <button
              type="button"
              className={`edu-btn ${sede.isActive ? "edu-btn--danger" : "edu-btn--ghost"} edu-btn--sm`}
              onClick={cambiarEstado}
              disabled={busy}
            >
              <Building2 size={15} />
              {sede.isActive ? "Cerrar sede" : "Reabrir sede"}
            </button>
          </div>
        </div>
      )}
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Quién entra a esta sede
// ═══════════════════════════════════════════════════════════════════════

function AccesoSede({
  sede,
  onClose,
  onDone,
}: {
  sede: EduCampusRow;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [rows, setRows] = useState<EduCampusPersonRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [cambios, setCambios] = useState(0);

  useEffect(() => {
    let vivo = true;
    eduRequest<{ rows: EduCampusPersonRow[] }>(`/api/instituto/sedes/${sede.id}/acceso`)
      .then((data) => {
        if (vivo) setRows(data.rows ?? []);
      })
      .catch((err: unknown) => {
        if (vivo) setError(err instanceof Error ? err.message : "No se pudo leer la lista.");
      });
    return () => {
      vivo = false;
    };
  }, [sede.id]);

  async function alternar(p: EduCampusPersonRow) {
    if (guardando) return;
    setError(null);
    setAviso(null);
    setGuardando(p.userId);
    try {
      const out = await eduRequest<{ allowed: boolean; campusCount: number; abrioTodas: boolean }>(
        `/api/instituto/sedes/${sede.id}/acceso`,
        { method: "POST", body: { userId: p.userId, allowed: !p.allowed } },
      );
      setRows((prev) =>
        (prev ?? []).map((x) =>
          x.userId === p.userId
            ? { ...x, allowed: out.allowed, campusCount: out.campusCount }
            : x,
        ),
      );
      setCambios((n) => n + 1);
      if (out.abrioTodas) {
        setAviso(
          `${p.name} se quedó sin ninguna sede marcada, así que ahora entra a TODAS las del instituto. Si lo que querías es dejarlo solo en otra sede, márcasela ahí.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setGuardando(null);
    }
  }

  return (
    <EduModal
      title={`Quién entra a ${sede.name}`}
      subtitle="El acceso a una sede no es un permiso: dice DÓNDE trabaja una persona, no qué puede hacer."
      onClose={onClose}
      busy={Boolean(guardando)}
      footer={
        <button
          type="button"
          className="edu-btn edu-btn--primary"
          onClick={() =>
            onDone(
              cambios > 0
                ? `Se actualizó quién entra a ${sede.name}.`
                : `No cambiaste nada en ${sede.name}.`,
            )
          }
        >
          Listo
        </button>
      }
    >
      <div className="edu-banner" role="note">
        <div>
          <p className="edu-banner__title">Sin ninguna sede marcada = entra a todas</p>
          <p className="edu-banner__detail">
            Es al revés de lo que parece, y es a propósito: así nadie se quedó fuera el día
            que se activaron las sedes. En cuanto le marcas <strong>una</strong> sede a
            alguien, deja de entrar a las demás — y si se la quitas y era la única, vuelve a
            entrar a todas.
          </p>
        </div>
      </div>

      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {aviso && (
        <div className="edu-alert" role="status">
          {aviso}
        </div>
      )}

      {rows === null ? (
        <p className="edu-note">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="edu-note">Este instituto todavía no tiene cuentas dadas de alta.</p>
      ) : (
        <div className="edu-acceso">
          {rows.map((p) => (
            <div key={p.userId} className="edu-acceso__fila">
              <div className="edu-acceso__quien">
                <div className="edu-acceso__nombre">
                  {p.name}
                  {p.isActive ? "" : " · dada de baja"}
                </div>
                <div className="edu-acceso__detalle">
                  {EDU_ROLE_LABELS[p.role] ?? p.role} · {p.email}
                </div>
                <div className="edu-acceso__detalle">
                  {p.campusCount === 0
                    ? "Entra a todas las sedes"
                    : `Marcada en ${p.campusCount} ${p.campusCount === 1 ? "sede" : "sedes"}`}
                </div>
              </div>
              <button
                type="button"
                className={`edu-btn edu-btn--sm ${p.allowed ? "edu-btn--primary" : "edu-btn--ghost"}`}
                onClick={() => void alternar(p)}
                disabled={Boolean(guardando)}
                aria-pressed={p.allowed}
              >
                {guardando === p.userId ? "…" : p.allowed ? "Entra" : "No entra"}
              </button>
            </div>
          ))}
        </div>
      )}
    </EduModal>
  );
}
