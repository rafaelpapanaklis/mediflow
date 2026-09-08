export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { listEduAuditActores, listEduAuditLog } from "@/lib/edu/auditoria";
import {
  EDU_AUDIT_ACTIONS,
  EDU_AUDIT_ACTION_LABELS,
  EDU_AUDIT_ENTITIES,
  EDU_AUDIT_ENTITY_LABELS,
  EDU_AUDIT_PAGE_SIZE,
} from "@/lib/edu/auditoria-core";
import { getEduPatient } from "@/lib/edu/pacientes";
import { eduPatientFullName } from "@/lib/edu/pacientes-core";
import {
  eduFormatDayShort,
  eduFormatTime,
  eduSafeTimeZone,
  eduUtcToZoned,
} from "@/lib/edu/agenda-core";
import { EduDenied } from "@/components/edu/edu-denied";

export const metadata: Metadata = {
  title: "Bitácora · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * ═══════════════════════════════════════════════════════════════════════
 * /instituto/direccion/bitacora — LA BITÁCORA DEL INSTITUTO (NOM-024).
 *
 * 🔴 QUÉ CONTESTA, Y POR QUÉ NO LO CONTESTABA NADIE (fila 21 del informe).
 * «No hay ningún modelo EduAudit* en el esquema: 45 modelos Edu*, ninguno
 * de bitácora. Hay atribución por fila dispersa —`historyRecordedBy`,
 * `authorUserId`, `uploadedById`— pero ninguna pantalla que las junte, y
 * NO SE REGISTRAN LAS LECTURAS.» La tabla la creó la Ola C·base; ésta es
 * la pantalla que la lee.
 *
 * 🔴 PERMISO `direccion.panel`, que solo lleva DIRECCION por defecto.
 * Ninguna key nueva: una key nueva NO le llega a nadie con
 * `permissionsOverride` guardado —el override REEMPLAZA al default— y
 * habría exigido un backfill en SQL contra la base de cada escuela.
 *
 * 🔴 SIN RECORTE POR ALCANCE CLÍNICO, y es deliberado: quien abre esto ya
 * ve la escuela entera, y una bitácora recortada tendría huecos que se
 * leen como «no pasó». Una bitácora incompleta es peor que ninguna.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 NI UNA LÍNEA DE `"use client"`, Y ES UNA DECISIÓN.
 *
 * Los filtros son un `<form method="get">` de HTML y la paginación es un
 * ENLACE con el cursor dentro. Tres cosas salen gratis con eso: se puede
 * COMPARTIR el enlace de una búsqueda («mira los accesos al expediente de
 * P-0042 de esta semana»), funciona con el JavaScript caído, y no hay un
 * segundo sitio donde el recorte pudiera equivocarse — el `where` vive
 * entero en `listEduAuditLog`.
 *
 * 🔴 SÍ HAY ENTRADA EN EL MENÚ desde la integración de la Ola C·2:
 * `bitacora` en `EDU_NAV_ITEMS` (`src/lib/edu/types.ts`), sección
 * Administración y con ESTE MISMO permiso `direccion.panel` — item y
 * pantalla comparten candado, así que el menú no puede ofrecer algo que
 * esta página niegue. Cuando se escribió, ese archivo era compartido y
 * quedaba fuera del área de la casilla; se cerró al juntar la ola.
 * Los dos caminos de antes siguen abiertos y son los útiles en el día a
 * día: desde la lista de pacientes y desde la ficha (ya filtrada).
 * ═══════════════════════════════════════════════════════════════════════
 */
export default async function DireccionBitacoraPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "direccion.panel")) {
    return (
      <EduDenied
        permission="direccion.panel"
        what="La bitácora del instituto (NOM-024): quién abrió un expediente, quién lo cambió, qué cambió y cuándo."
      />
    );
  }

  const uno = (k: string) => {
    const v = searchParams?.[k];
    return typeof v === "string" ? v : "";
  };

  const filtros = {
    patientId: uno("patientId"),
    actorUserId: uno("actorUserId"),
    entity: uno("entity"),
    action: uno("action"),
    desde: uno("desde"),
    hasta: uno("hasta"),
  };
  const cursor = uno("cursor");
  const hayFiltros = Object.values(filtros).some(Boolean);

  // Dos consultas y no más. Los actores salen de la PROPIA bitácora
  // (`distinct`) y no del padrón: el filtro solo debe ofrecer a gente que
  // TIENE renglones —ofrecer 120 cuentas de las que 4 escribieron es una
  // lista inútil— y una cuenta dada de baja sigue teniendo su historia
  // aquí, así que tiene que poder filtrarse aunque ya no esté en el padrón.
  const [page, actores] = await Promise.all([
    listEduAuditLog(ctx, { ...filtros, cursor: cursor || undefined, take: EDU_AUDIT_PAGE_SIZE }),
    listEduAuditActores(ctx),
  ]);

  // Si se filtra por un paciente se dice CUÁL: un filtro que enseña un id
  // de 25 caracteres no es un filtro que nadie pueda leer.
  const paciente = filtros.patientId ? await getEduPatient(ctx, filtros.patientId) : null;

  // 🔴 EL INSTANTE SE ESCRIBE EN EL SERVIDOR y en la zona del INSTITUTO.
  // En el navegador saldría en la zona de quien mira, y un acceso de las
  // 19:00 en Tijuana se fecharía al día siguiente.
  const tz = eduSafeTimeZone(ctx.institution.timezone);
  const sello = (iso: string) => {
    const d = new Date(iso);
    return `${eduFormatDayShort(eduUtcToZoned(d, tz).dayISO)} ${eduFormatTime(d, tz)}`;
  };

  // El enlace de «siguiente» conserva los filtros y cambia el cursor.
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filtros)) if (v) qs.set(k, v);
  const siguiente = page.nextCursor
    ? `/instituto/direccion/bitacora?${new URLSearchParams({
        ...Object.fromEntries(qs),
        cursor: page.nextCursor,
      }).toString()}`
    : null;

  return (
    <div className="edu-page">
      <p>
        <Link href="/instituto/direccion" className="edu-btn edu-btn--ghost edu-btn--sm">
          <ArrowLeft size={15} />
          Dirección
        </Link>
      </p>

      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Bitácora</h1>
          <p className="edu-page__lead">
            Quién hizo qué, cuándo y desde dónde — incluidas las <strong>lecturas</strong> del
            expediente, que es lo que la NOM-024 pide con nombre propio y lo que este producto no
            podía contestar hasta ahora.
          </p>
        </div>
      </header>

      {/* ── LOS FILTROS ─────────────────────────────────────────────────
          `method="get"` y sin JavaScript: la búsqueda queda en la URL y se
          puede pegar en un correo. Cada envío empieza en la PRIMERA página
          porque el `cursor` no viaja en el formulario — que es justo lo
          que tiene que pasar al cambiar un filtro. */}
      <form className="edu-toolbar" method="get" action="/instituto/direccion/bitacora">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="bit-quien">
            Quién
          </label>
          <select
            id="bit-quien"
            name="actorUserId"
            className="edu-input edu-input--sm"
            defaultValue={filtros.actorUserId}
          >
            <option value="">Cualquiera</option>
            {actores.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.role}
              </option>
            ))}
          </select>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="bit-accion">
            Acción
          </label>
          <select
            id="bit-accion"
            name="action"
            className="edu-input edu-input--sm"
            defaultValue={filtros.action}
          >
            <option value="">Cualquiera</option>
            {EDU_AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {EDU_AUDIT_ACTION_LABELS[a]}
              </option>
            ))}
          </select>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="bit-entidad">
            Sobre qué
          </label>
          <select
            id="bit-entidad"
            name="entity"
            className="edu-input edu-input--sm"
            defaultValue={filtros.entity}
          >
            <option value="">Cualquier cosa</option>
            {EDU_AUDIT_ENTITIES.map((e) => (
              <option key={e} value={e}>
                {EDU_AUDIT_ENTITY_LABELS[e]}
              </option>
            ))}
          </select>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="bit-desde">
            Desde
          </label>
          <input
            id="bit-desde"
            name="desde"
            type="date"
            className="edu-input edu-input--sm"
            defaultValue={filtros.desde}
          />
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="bit-hasta">
            Hasta
          </label>
          <input
            id="bit-hasta"
            name="hasta"
            type="date"
            className="edu-input edu-input--sm"
            defaultValue={filtros.hasta}
          />
        </div>

        {/* El paciente NO es un desplegable: una escuela tiene miles y el
            filtro se usa llegando DESDE su ficha, con el id ya puesto. Se
            conserva escondido para que cambiar otro filtro no lo pierda. */}
        {filtros.patientId && <input type="hidden" name="patientId" value={filtros.patientId} />}

        <button type="submit" className="edu-btn edu-btn--primary edu-btn--sm">
          Filtrar
        </button>
      </form>

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {page.rows.length} {page.rows.length === 1 ? "movimiento" : "movimientos"}
          {page.nextCursor ? " (hay más)" : ""}
        </span>
        {paciente && (
          <span className="edu-fichaform__motivo">
            Solo los de <strong>{paciente.folio} · {eduPatientFullName(paciente)}</strong>.
          </span>
        )}
        {hayFiltros && (
          <Link href="/instituto/direccion/bitacora" className="edu-btn edu-btn--ghost edu-btn--sm">
            Limpiar filtros
          </Link>
        )}
      </div>

      <p className="edu-note">
        El rango de fechas se aplica en UTC y no en la zona del instituto: un movimiento de última
        hora de la tarde puede caer en el día siguiente. Cada renglón trae SU hora escrita en la
        zona de la escuela, que es el dato con el que se responde de verdad.
      </p>

      {page.rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">
            {hayFiltros ? "Ningún movimiento coincide" : "La bitácora está vacía"}
          </p>
          <p className="edu-empty__detail">
            {hayFiltros
              ? "Prueba con menos filtros o con un rango de fechas más amplio."
              : "Se llena sola conforme se trabaja: cada alta, cada corrección, cada firma y cada vez que alguien abre un expediente dejan aquí su renglón."}
          </p>
        </div>
      ) : (
        /* `.edu-tablewrap` no es decoración: hace que esta lista se mida a
           SÍ MISMA (`@container`) y que se DESPLACE en vez de recortar si
           algún día no cabe (reglas 2 y 4 de edu-theme.css). */
        <div className="edu-tablewrap">
          <div className="edu-table">
            <div className="edu-rowhead" aria-hidden="true">
              <span>Cuándo</span>
              <span>Quién</span>
              <span>Qué hizo</span>
              <span>Sobre qué</span>
              <span>Desde</span>
            </div>

            {page.rows.map((r) => (
              <div key={r.id} className="edu-row">
                <div className="edu-cell">
                  <span className="edu-cell__label">Cuándo</span>
                  <span className="edu-cell__value edu-cell__value--strong">
                    {sello(r.createdAt)}
                  </span>
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Quién</span>
                  <span className="edu-cell__value">{r.actorName}</span>
                  {/* El ROL va CONGELADO en el renglón: ascender a alguien
                      —o darlo de baja— no puede reescribir con qué sombrero
                      hizo algo el año pasado. */}
                  <span className="edu-cell__sub">{r.actorRole}</span>
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Qué hizo</span>
                  <span
                    className={`edu-tag ${
                      r.action === "view"
                        ? "edu-tag--info"
                        : r.action === "arco" || r.action === "delete"
                          ? "edu-tag--danger"
                          : r.action === "sign"
                            ? "edu-tag--ok"
                            : "edu-tag--muted"
                    }`}
                  >
                    {r.actionLabel}
                  </span>
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Sobre qué</span>
                  <span className="edu-cell__value">{r.entityLabel}</span>
                  {r.patientId && (
                    <span className="edu-cell__sub">
                      <Link href={`/instituto/pacientes/${r.patientId}`} className="edu-link">
                        Ver al paciente
                      </Link>
                    </span>
                  )}
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Desde</span>
                  <span className="edu-cell__value">{r.ip ?? "—"}</span>
                </div>

                {/* ── EL DIFF, ANTES / DESPUÉS ─────────────────────────
                    🔴 SOLO LOS CAMPOS QUE CAMBIARON. Guardar la fila entera
                    en cada renglón convertiría la bitácora en una copia de
                    la tabla —y de una copia el derecho ARCO no puede sacar
                    el dato personal— y leer «¿qué cambió?» en un ejercicio
                    de comparar dos párrafos a ojo. El recorte lo hace
                    `eduAuditDiff` al ESCRIBIR, así que aquí solo se pinta. */}
                {r.campos.length > 0 && (
                  <div className="edu-cell edu-cell--wide">
                    <span className="edu-cell__label">Qué cambió</span>
                    <div className="edu-kv">
                      {r.campos.map((c) => (
                        <div key={c.campo}>
                          <span className="edu-kv__k">{c.campo}</span>
                          {/* ⚠️ `display: inline-block` EN LÍNEA, y no es
                              pereza de no tocar la hoja de estilo:
                              `.edu-dif` nació como un PÁRRAFO del diff de
                              otra pantalla y trae 10 px de relleno
                              vertical. Como caja en línea, ese relleno no
                              cuenta para la altura de la línea y la píldora
                              se sube por encima del rótulo de arriba —se
                              ve, y es feo, en la primera captura. Con
                              `inline-block` sí cuenta. La regla general
                              vive en edu-theme.css, que es un archivo
                              compartido fuera del área de esta casilla; el
                              cambio queda propuesto en el punto 6. */}
                          <span className="edu-kv__v">
                            <span
                              className="edu-dif edu-dif--mal"
                              style={{ display: "inline-block" }}
                            >
                              {c.antes === null || c.antes === "" ? "—" : String(c.antes)}
                            </span>{" "}
                            →{" "}
                            <span
                              className="edu-dif edu-dif--ok"
                              style={{ display: "inline-block" }}
                            >
                              {c.despues === null || c.despues === "" ? "—" : String(c.despues)}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {r.action === "view" && (
                  <div className="edu-cell edu-cell--wide">
                    <span className="edu-cell__sub">
                      Una LECTURA no tiene diff: lo que registra es el acceso, que es lo que la
                      NOM-024 §6.3.5 pide poder contestar.
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── LA PÁGINA SIGUIENTE ─────────────────────────────────────────
          Por CURSOR y no por `skip`/OFFSET: a la bitácora se le escriben
          renglones MIENTRAS alguien la recorre, y con un offset un
          movimiento nuevo empuja una fila hacia abajo y esa fila sale dos
          veces (o, al revés, una se salta y nadie se entera). */}
      {siguiente && (
        <div className="edu-actions">
          <Link href={siguiente} className="edu-btn edu-btn--ghost">
            Ver los {EDU_AUDIT_PAGE_SIZE} siguientes
          </Link>
          <span className="edu-fichaform__motivo">
            Se pagina por cursor: lo que ya pasó no vuelve a salir, aunque se escriban movimientos
            nuevos mientras la lees.
          </span>
        </div>
      )}
      {cursor && (
        <p className="edu-note">
          Estás en una página siguiente.{" "}
          <Link
            href={`/instituto/direccion/bitacora${qs.toString() ? `?${qs.toString()}` : ""}`}
            className="edu-link"
          >
            Volver a la primera
          </Link>
          .
        </p>
      )}
    </div>
  );
}
