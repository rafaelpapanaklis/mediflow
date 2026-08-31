export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduPatient } from "@/lib/edu/pacientes";
import { getEduPatientResumen } from "@/lib/edu/resumen";
import { eduMoney } from "@/lib/edu/dinero-core";
import { EDU_CASE_STATUS_LABELS } from "@/lib/edu/types";

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
                con {r.ultimaVisita.studentMatricula} · {r.ultimaVisita.studentName}
              </span>
            )}
          </div>
          <div className={`edu-kpi ${r.proximaCita ? "" : "edu-kpi--alerta"}`}>
            <span className="edu-kpi__label">Próxima cita</span>
            <span className="edu-kpi__value edu-kpi__value--texto">
              {r.proximaCita ? r.proximaCita.label : "No tiene"}
            </span>
            <span className="edu-kpi__sub">
              {r.proximaCita
                ? [
                    r.proximaCita.chairName,
                    r.proximaCita.campusName,
                    `${r.proximaCita.studentMatricula} · ${r.proximaCita.studentName}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Nadie lo tiene agendado: se le agenda desde aquí arriba o se le pierde la pista."}
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
              No tiene casos abiertos que te toquen. Un caso se abre en el tamizaje — o con el
              botón «Abrir caso» de arriba, si te corresponde.
            </p>
          ) : (
            <div className="edu-stack edu-stack--tight">
              {r.casos!.map((c) => (
                <div key={c.id} className="edu-assign">
                  <span>
                    <strong>{c.programName}</strong> · {c.studentMatricula} · {c.studentName}
                    {c.supervisorName ? ` · supervisa ${c.supervisorName}` : " · sin docente en el caso"}
                    {` · desde ${c.abiertoLabel}`}
                  </span>
                  <span className="edu-tag edu-tag--ok">{EDU_CASE_STATUS_LABELS[c.status]}</span>
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
