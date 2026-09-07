export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduPatient } from "@/lib/edu/pacientes";
import { getEduPatientResumen } from "@/lib/edu/resumen";
import { eduMoney } from "@/lib/edu/dinero-core";
import { EDU_CASO_ESPERA_TAG } from "@/lib/edu/casos-core";
import {
  EDU_RESUMEN_TIMELINE_KIND_LABELS,
  EDU_RESUMEN_TIMELINE_TAB,
} from "@/lib/edu/resumen-core";
import { EDU_CASE_STATUS_LABELS } from "@/lib/edu/types";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";

/**
 * Pestaña RESUMEN — la portada de la ficha desde la Ola 12.
 *
 * Lo que un alumno (o recepción, o un docente) necesita al abrir la ficha
 * de pie, con guantes: cuántas veces ha venido, cuándo fue la última vez y
 * con quién, si tiene próxima cita —y si NO la tiene, que se note—, sus
 * casos abiertos, su saldo y los avisos que piden acción.
 *
 * 🔴 CADA BLOQUE SE RECORTA (O NI SE CONSULTA) SEGÚN QUIEN MIRA — eso lo
 * decide src/lib/edu/resumen.ts con los alcances de visibility.ts:
 *   · ALUMNO/DOCENTE → sus citas y sus casos; el bloque de DINERO no se
 *     consulta (no viaja ni en el payload).
 *   · CAJA → citas y saldo completos; NADA clínico: ni casos ni avisos.
 * Y encima del alcance, el PERMISO: el bloque de casos solo se pinta con
 * "casos.view" y el de saldo con "caja.view" — el alcance decide las
 * filas, el permiso decide la pantalla, y aquí se respetan los dos.
 */
export default async function PacienteResumenPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  // El layout ya exigió pacientes.view; se vuelve a comprobar porque una
  // página no puede depender de que su layout la protegió.
  if (!hasEduPermission(permUser, "pacientes.view")) notFound();

  const p = await getEduPatient(ctx, params.id);
  if (!p) notFound();

  const r = await getEduPatientResumen(ctx, p.id, ctx.institution.timezone);
  if (!r) notFound();

  const veCasos = r.casos !== null && hasEduPermission(permUser, "casos.view");
  const veSaldo = r.saldo !== null && hasEduPermission(permUser, "caja.view");
  /**
   * 🔴 N-11 · EL PERMISO, NO SOLO EL ALCANCE.
   *
   * `r.fotos` solo se anula por ALCANCE, nunca por permiso — igual que
   * `r.casos` y `r.saldo`, que por eso llevan su `hasEduPermission` desde
   * siempre. A quien le apagaron `estudios.view` con un override le
   * desaparecía la pestaña Fotos y seguía leyendo aquí «Fotos clínicas · 7
   * · última: …» con un enlace que le contestaba denegado.
   *
   * Y el enlace de SUBIR pide el permiso de escritura: ofrecerle «Subir la
   * primera» a quien no puede subir es mandarlo a un 403.
   */
  const veFotos = r.fotos !== null && hasEduPermission(permUser, "estudios.view");
  const subeFotos = hasEduPermission(permUser, "estudios.upload");
  const base = `/instituto/pacientes/${p.id}`;

  return (
    <div className="edu-stack">
      {/* ── Los avisos van PRIMERO: son lo que pide acción ─────────────── */}
      {r.avisos.length > 0 && (
        <div className="edu-stack edu-stack--tight" role="list" aria-label="Avisos del paciente">
          {r.avisos.map((a, i) => (
            <div key={`${a.kind}-${i}`} className="edu-banner edu-banner--warn" role="listitem">
              <div>
                <p className="edu-banner__title">{a.text}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Cuántas veces, la última y la próxima ──────────────────────── */}
      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Sus visitas</h2>
          {r.recortado && <span className="edu-count">las que te tocan</span>}
        </div>
        <div className="edu-kpis">
          <div className="edu-kpi">
            <span className="edu-kpi__label">Veces que ha venido</span>
            <span className="edu-kpi__value">{r.visitas}</span>
          </div>
          <div className="edu-kpi">
            <span className="edu-kpi__label">Última visita</span>
            <span className="edu-kpi__value edu-kpi__value--texto">
              {r.ultimaVisita ? r.ultimaVisita.label : "Nunca ha venido"}
            </span>
            {r.ultimaVisita && (
              <span className="edu-kpi__sub">
                con{" "}
                <EduPersonaLink kind="estudiante" id={r.ultimaVisita.studentId}>
                  {r.ultimaVisita.studentMatricula} · {r.ultimaVisita.studentName}
                </EduPersonaLink>
              </span>
            )}
          </div>
          <div className={`edu-kpi ${r.proximaCita ? "" : "edu-kpi--alerta"}`}>
            <span className="edu-kpi__label">Próxima cita</span>
            <span className="edu-kpi__value edu-kpi__value--texto">
              {r.proximaCita ? r.proximaCita.label : "No tiene"}
            </span>
            <span className="edu-kpi__sub">
              {r.proximaCita ? (
                <>
                  {[r.proximaCita.chairName, r.proximaCita.campusName].filter(Boolean).join(" · ")}
                  {r.proximaCita.chairName || r.proximaCita.campusName ? " · " : ""}
                  <EduPersonaLink kind="estudiante" id={r.proximaCita.studentId}>
                    {r.proximaCita.studentMatricula} · {r.proximaCita.studentName}
                  </EduPersonaLink>
                </>
              ) : (
                "Nadie lo tiene agendado: se le agenda desde aquí arriba o se le pierde la pista."
              )}
            </span>
          </div>
        </div>
        <p className="edu-note">
          <Link href={`${base}/agenda`} className="edu-link">
            Ver toda su agenda
          </Link>
        </p>
      </section>

      {/* ── Sus casos abiertos (solo quien ve expediente) ──────────────── */}
      {veCasos && (
        <section className="edu-section">
          <div className="edu-section__head">
            <h2 className="edu-section__title">Casos abiertos</h2>
            <span className="edu-count">{r.casos!.length}</span>
          </div>
          {r.casos!.length === 0 ? (
            <p className="edu-note">
              No tiene casos abiertos que te toquen. Un caso se abre en la valoración — o con el
              botón «Abrir caso» de arriba, si te corresponde.
            </p>
          ) : (
            <div className="edu-stack edu-stack--tight">
              {r.casos!.map((c) => (
                <div key={c.id} className="edu-assign">
                  <span>
                    <strong>{c.programName}</strong> ·{" "}
                    <EduPersonaLink kind="estudiante" id={c.studentId}>
                      {c.studentMatricula} · {c.studentName}
                    </EduPersonaLink>
                    {c.supervisorName ? (
                      <>
                        {" · supervisa "}
                        <EduPersonaLink kind="docente" id={c.supervisorUserId}>
                          {c.supervisorName}
                        </EduPersonaLink>
                      </>
                    ) : (
                      " · sin docente en el caso"
                    )}
                    {` · desde ${c.abiertoLabel}`}
                  </span>
                  <span className="edu-fichacaso__tags">
                    <span className="edu-tag edu-tag--ok">{EDU_CASE_STATUS_LABELS[c.status]}</span>
                    {/* Ola de Casos: en qué va y qué le falta FIRMAR, con la
                        misma derivación que la pantalla global de casos. */}
                    <span className={`edu-tag ${EDU_CASO_ESPERA_TAG[c.espera.kind]}`}>
                      {c.espera.label}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="edu-note">
            <Link href={`${base}/casos`} className="edu-link">
              Ver los casos con su detalle
            </Link>
          </p>
        </section>
      )}

      {/* ── Ola de Casos · la historia clínica reciente, en orden ──────────
          Notas, estudios, consentimientos y recetas mezclados del más
          reciente al más viejo, cada uno con QUIÉN lo hizo. Para caja
          `timeline` es null: el bloque no existe (ni se consultó). */}
      {r.timeline !== null && (
        <section className="edu-section">
          <div className="edu-section__head">
            <h2 className="edu-section__title">Historia reciente</h2>
            {r.recortado && <span className="edu-count">lo que te toca</span>}
          </div>
          {r.timeline.length === 0 ? (
            <p className="edu-note">
              Sin actividad clínica registrada todavía: ni notas, ni estudios, ni cartas, ni
              recetas que te toquen.
            </p>
          ) : (
            <ol className="edu-historia" aria-label="Historia clínica reciente">
              {r.timeline.map((t, i) => (
                <li key={`${t.kind}-${t.atISO}-${i}`} className="edu-historia__item">
                  <span
                    className={`edu-historia__punto edu-historia__punto--${t.kind}`}
                    aria-hidden
                  />
                  <div className="edu-historia__cuerpo">
                    <p className="edu-historia__titulo">
                      <Link
                        href={`${base}/${EDU_RESUMEN_TIMELINE_TAB[t.kind]}`}
                        className="edu-link"
                      >
                        {t.title}
                      </Link>
                    </p>
                    <p className="edu-historia__meta">
                      {t.whenLabel} · {t.who} ·{" "}
                      {EDU_RESUMEN_TIMELINE_KIND_LABELS[t.kind]}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {/* ── ws2-t2 · LAS FOTOS CLÍNICAS, en una línea ──────────────────────
          Hasta hoy, una foto de la sonrisa subida como estudio aparecía en
          «Últimos estudios» rotulada «Radiografía» —el servidor asume
          RADIOGRAFIA para TODA imagen— y no había ni una palabra sobre las
          fotos clínicas de verdad, que viven en su propia tabla y en su
          propia pestaña. Esto lo dice: cuántas hay y de cuándo es la
          última, con el enlace para verlas y compararlas.

          Una línea y no tres miniaturas a propósito: firmar tres URLs más
          de Storage en cada carga de la ficha para repetir lo que la
          pestaña Fotos enseña mejor no vale lo que cuesta. */}
      {veFotos && r.fotos !== null && (
        <section className="edu-section">
          <div className="edu-section__head">
            <h2 className="edu-section__title">Fotos clínicas</h2>
            <span className="edu-count">{r.fotos.total}</span>
          </div>
          {r.fotos.total === 0 ? (
            <p className="edu-note">
              Todavía no hay fotos de este paciente.{" "}
              {subeFotos ? (
                <>
                  <Link href={`${base}/fotos`} className="edu-link">
                    Subir la primera
                  </Link>{" "}
                  —{" "}
                </>
              ) : null}
              con dos, una de «Antes» y otra de «Después», el comparador enseña el cambio.
            </p>
          ) : (
            <p className="edu-note">
              <strong>
                {r.fotos.total} {r.fotos.total === 1 ? "foto clínica" : "fotos clínicas"}
              </strong>
              {r.fotos.ultimaLabel ? ` · última: ${r.fotos.ultimaLabel}` : ""} ·{" "}
              <Link href={`${base}/fotos`} className="edu-link">
                Verlas y comparar antes/después
              </Link>
            </p>
          )}
        </section>
      )}

      {/* ── Ola de Casos · los últimos estudios, con miniatura ───────────── */}
      {r.estudios !== null && r.estudios.length > 0 && (
        <section className="edu-section">
          <div className="edu-section__head">
            <h2 className="edu-section__title">Últimos estudios</h2>
            <span className="edu-count">{r.estudios.length}</span>
          </div>
          <div className="edu-minis">
            {r.estudios.map((e) => (
              <Link key={e.id} href={`${base}/estudios`} className="edu-mini">
                {e.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL
                  // firmada de Storage que caduca: next/image la cachearía.
                  <img src={e.thumbUrl} alt={e.name} className="edu-mini__img" loading="lazy" />
                ) : (
                  <span className="edu-mini__tipo" aria-hidden>
                    {e.kindLabel}
                  </span>
                )}
                <span className="edu-mini__pie">
                  <span className="edu-mini__nombre">{e.name}</span>
                  <span className="edu-mini__meta">
                    {e.whenLabel} · {e.byName}
                  </span>
                </span>
              </Link>
            ))}
          </div>
          <p className="edu-note">
            <Link href={`${base}/estudios`} className="edu-link">
              Ver todos sus estudios
            </Link>
          </p>
        </section>
      )}

      {/* ── El dinero (solo quien ve dinero: caja y dirección) ─────────── */}
      {veSaldo && (
        <section className="edu-section">
          <div className="edu-section__head">
            <h2 className="edu-section__title">Saldo</h2>
            <span className="edu-count">
              {r.saldo!.cobros} {r.saldo!.cobros === 1 ? "cobro" : "cobros"}
            </span>
          </div>
          <div className="edu-kpis">
            <div className="edu-kpi">
              <span className="edu-kpi__label">Pagado</span>
              <span className="edu-kpi__value">{eduMoney(r.saldo!.cobradoCents)}</span>
            </div>
            <div className={`edu-kpi ${r.saldo!.pendienteCents > 0 ? "edu-kpi--alerta" : ""}`}>
              <span className="edu-kpi__label">Pendiente</span>
              <span className="edu-kpi__value">{eduMoney(r.saldo!.pendienteCents)}</span>
            </div>
          </div>
          <p className="edu-note">
            <Link href={`/instituto/caja?q=${encodeURIComponent(p.folio)}&ver=todos`} className="edu-link">
              Ver sus cobros en caja
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}
