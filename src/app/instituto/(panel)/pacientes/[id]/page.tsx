export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduPatient } from "@/lib/edu/pacientes";
import { formatEduDate } from "@/lib/edu/pacientes-core";
import { EDU_PATIENT_STATUS_LABELS, EDU_SEX_LABELS } from "@/lib/edu/types";

/**
 * Pestaña DATOS de la ficha del paciente.
 *
 * Es de LECTURA a propósito. La edición ya existe —y funciona— en el modal
 * de /instituto/pacientes (Ola 2), con su permiso `pacientes.manage` y su
 * endpoint aparte para el ORIGEN, que decide el precio. Volver a
 * escribirla aquí habría dado dos formularios para la misma ficha, y el
 * día que alguien agregue un campo lo agregaría a uno de los dos.
 *
 * El botón de abajo lleva a esa lista. Es un paso más, y se prefiere a la
 * duplicación: esta pestaña se abre cien veces al día para MIRAR y unas
 * pocas para corregir un teléfono.
 */
export default async function PacienteDatosPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  // El layout ya exigió pacientes.view; se vuelve a comprobar porque una
  // página no puede DEPENDER de que su layout la protegió: si un día el
  // layout cambia, el que se queda abierto es este archivo.
  if (!hasEduPermission(permUser, "pacientes.view")) notFound();

  const p = await getEduPatient(ctx, params.id);
  if (!p) notFound();

  const canManage = hasEduPermission(permUser, "pacientes.manage");

  return (
    <div className="edu-stack">
      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Datos del paciente</h2>
        </div>

        <div className="edu-kv edu-kv--2">
          <div>
            <span className="edu-kv__k">Teléfono</span>
            <span className="edu-kv__v">{p.phone ?? "—"}</span>
          </div>
          <div>
            <span className="edu-kv__k">Correo</span>
            <span className="edu-kv__v">{p.email ?? "—"}</span>
          </div>
          <div>
            <span className="edu-kv__k">Nacimiento</span>
            <span className="edu-kv__v">
              {/* Fecha de CALENDARIO: se formatea en UTC. En la zona local
                  un nacimiento del 1 de enero saldría "31 de diciembre". */}
              {p.birthDate ? formatEduDate(p.birthDate) : "—"}
            </span>
          </div>
          <div>
            <span className="edu-kv__k">Sexo</span>
            <span className="edu-kv__v">{EDU_SEX_LABELS[p.sex]}</span>
          </div>
          <div>
            <span className="edu-kv__k">Estado</span>
            <span className="edu-kv__v">{EDU_PATIENT_STATUS_LABELS[p.status]}</span>
          </div>
          <div>
            <span className="edu-kv__k">Registrado</span>
            <span className="edu-kv__v">{formatEduDate(p.createdAt)}</span>
          </div>
        </div>
      </section>

      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Origen</h2>
        </div>
        <div className="edu-kv">
          <div>
            <span className="edu-kv__k">Lo trajo</span>
            <span className="edu-kv__v">
              {p.origin.studentName
                ? `${p.origin.studentMatricula} · ${p.origin.studentName}`
                : "Llegó solo a la clínica"}
            </span>
          </div>
          {p.origin.setByName && (
            <div>
              <span className="edu-kv__k">Lo marcó</span>
              <span className="edu-kv__v">
                {p.origin.setByName}
                {p.origin.setAt ? ` · ${formatEduDate(p.origin.setAt)}` : ""}
              </span>
            </div>
          )}
        </div>
      </section>

      {p.notes && (
        <section className="edu-section">
          <div className="edu-section__head">
            <h2 className="edu-section__title">Notas de recepción</h2>
          </div>
          {/* Notas de RECEPCIÓN, no clínicas. Las clínicas están en la
              pestaña Expediente y tienen autor, estado y firma. */}
          <p className="edu-note" style={{ whiteSpace: "pre-wrap" }}>
            {p.notes}
          </p>
        </section>
      )}

      {canManage && (
        <p>
          <Link href="/instituto/pacientes" className="edu-btn edu-btn--ghost edu-btn--sm">
            Editar en la lista de pacientes
          </Link>
        </p>
      )}
    </div>
  );
}
