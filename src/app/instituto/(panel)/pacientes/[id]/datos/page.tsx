export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { eduPatientEditAbilities, hasEduPermission } from "@/lib/edu/permissions";
import { getEduPatient } from "@/lib/edu/pacientes";
import { getEduPatientTaxProfile } from "@/lib/edu/facturacion";
// Las claves del SAT se pintan con su descripción, no en crudo: «601» no le
// dice nada a nadie en el mostrador. Los describe el módulo puro de
// facturación, que es donde vive el catálogo.
import { eduDescribeRegimen, eduDescribeUsoCfdi } from "@/lib/edu/facturacion-core";
import { eduVisibility, eduScopeIsEmpty } from "@/lib/edu/visibility";
import { formatEduDate } from "@/lib/edu/pacientes-core";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";
import { EduAntecedentesCard } from "@/components/edu/expediente/antecedentes-card";
import { EduPacienteDatosCard } from "@/components/edu/clinica/paciente-datos-form";

/**
 * Pestaña DATOS de la ficha del paciente.
 *
 * Hasta la Ola 12 era la PORTADA de la ficha (vivía en /pacientes/[id]);
 * ahora la portada es el Resumen y estos datos de contacto se mudaron
 * aquí, intactos. La ruta vieja no se rompe: quien abra la ficha ve el
 * Resumen y esta pestaña queda a un toque.
 *
 * ── AQUÍ SE EDITA (H-01, H-03) ──────────────────────────────────────────
 * Esta pestaña fue de solo lectura durante cuatro olas, y el porqué estaba
 * escrito y era bueno: dos formularios para la misma ficha es cómo uno de
 * los dos se queda sin el campo nuevo. Lo que fallaba no era esa decisión,
 * eran las dos cosas que colgaban de ella:
 *
 *   1. el formulario único al que remitía —el modal de /instituto/pacientes—
 *      mandaba CINCO campos de nueve. Nombre, apellidos, folio y sexo se
 *      capturaban en el alta y no se corregían nunca, desde ningún sitio del
 *      producto, aunque el servidor supiera hacerlo desde la Ola 2;
 *   2. y el botón de esta pestaña era un enlace a la LISTA COMPLETA, sin
 *      folio y sin `?q=`: recepción, que venía de la ficha de P-0412, caía
 *      en la lista entera y tenía que volver a teclear el nombre. Con más
 *      de 300 pacientes, ese paciente podía no estar ni en la lista.
 *
 * La regla se respeta y el botón desaparece: el formulario sigue siendo UNO
 * —`EduPacienteDatosCard`, en src/components/edu/clinica/paciente-datos-form.tsx—
 * y se MONTA en los dos sitios donde hace falta. Un campo nuevo se agrega
 * allí y aparece en la pestaña y en el modal, o en ninguno de los dos.
 *
 * ── LOS ANTECEDENTES ────────────────────────────────────────────────────
 * Siguen teniendo su propia tarjeta y su propio endpoint, y no es
 * duplicación: es OTRO bloque de datos con OTRA puerta (`expediente.write`
 * de la historia clínica) y un rastro propio de quién los revisó y cuándo.
 * Van ARRIBA de todo: en esta pestaña lo que puede matar a alguien es una
 * alergia sin capturar, no un teléfono.
 *
 * ── LOS DATOS FISCALES (H-27) ───────────────────────────────────────────
 * Se ENSEÑAN, no se editan. El paciente pide factura en el mostrador y caja
 * estaba en su ficha sin poder ni consultar el RFC: tenía que salir a
 * /instituto/facturacion, buscar el cobro y capturarlo desde el flujo de
 * timbrado. Ahora se ven aquí, y el enlace lleva a donde se corrigen. NO se
 * duplica el formulario fiscal: un RFC mal capturado en dos sitios es un
 * CFDI rechazado por el SAT.
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

  // 🔴 DOS LLAVES (H-02), resueltas en el punto único de permissions.ts:
  // `manage` abre los nueve campos y `contacto` abre teléfono y correo
  // también para el alumno y el docente. El endpoint las vuelve a exigir —
  // esto solo decide qué se pinta deshabilitado.
  const { manage: canManage, contacto: canContacto } = eduPatientEditAbilities(permUser);
  // Ola de Casos: los antecedentes los captura recepción (pacientes.manage)
  // Y quien hace la historia clínica (expediente.write) — dos llaves, una
  // puerta (el endpoint /antecedentes comprueba las mismas dos).
  const canAntecedentes = canManage || hasEduPermission(permUser, "expediente.write");

  // Los datos fiscales se leen SOLO para quien ve el dinero. La doble
  // cerradura del vertical: el permiso (facturacion.view) y el ALCANCE, que
  // para docente y alumno devuelve "none" pase lo que pase — sin el segundo
  // check, `getEduPatientTaxProfile` lanzaría un 403 y tumbaría la pestaña
  // entera de un docente al que alguien le encendiera la casilla por error.
  const veDinero =
    hasEduPermission(permUser, "facturacion.view") &&
    !eduScopeIsEmpty(eduVisibility(ctx, "charges"));
  const fiscal = veDinero ? await getEduPatientTaxProfile(ctx, p.id) : null;

  return (
    <div className="edu-stack">
      {/* ── Ola de Casos · ANTECEDENTES, PRIMERO ───────────────────────────
          Van arriba de los datos de contacto: en esta pestaña lo que puede
          matar a alguien es una alergia sin capturar, no un teléfono. */}
      <EduAntecedentesCard
        patientId={p.id}
        antecedentes={p.antecedentes}
        canEdit={canAntecedentes}
      />

      {/* Los NUEVE campos. El MISMO componente que monta el modal de la
          lista de pacientes: una sola definición, dos montajes. */}
      <EduPacienteDatosCard
        row={p}
        canManage={canManage}
        canContacto={canContacto}
        idPrefix="edu-datos"
      />

      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Origen</h2>
        </div>
        <div className="edu-kv">
          <div>
            <span className="edu-kv__k">Lo trajo</span>
            <span className="edu-kv__v">
              {p.origin.studentName ? (
                <EduPersonaLink kind="estudiante" id={p.origin.studentId}>
                  {p.origin.studentMatricula} · {p.origin.studentName}
                </EduPersonaLink>
              ) : (
                "Llegó solo a la clínica"
              )}
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
        {/* El ORIGEN no entra en el formulario de arriba y no es un olvido:
            tiene su propio permiso (`pacientes.origen`) porque decide la
            tarifa del paciente, y su propio endpoint, que además guarda
            quién lo marcó y cuándo. Se corrige desde el modal de la lista. */}
        <p className="edu-note">
          Quién trajo al paciente decide su tarifa, así que se marca aparte y queda registrado
          quién lo puso. Se corrige desde{" "}
          <Link href="/instituto/pacientes" className="edu-link">
            la lista de pacientes
          </Link>
          , con el permiso «pacientes.origen».
        </p>
      </section>

      {/* ── H-27 · DATOS FISCALES, EN SOLO LECTURA ─────────────────────── */}
      {veDinero && (
        <section className="edu-section">
          <div className="edu-section__head">
            <div>
              <h2 className="edu-section__title">Datos fiscales</h2>
              <p className="edu-section__lead">
                Con lo que se le timbra la factura. Se capturan y se corrigen en{" "}
                <Link href="/instituto/facturacion" className="edu-link">
                  Facturación
                </Link>
                , que es donde el CFDI se emite.
              </p>
            </div>
          </div>

          {fiscal ? (
            <>
              <div className="edu-kv edu-kv--2">
                <div>
                  <span className="edu-kv__k">RFC</span>
                  <span className="edu-kv__v">{fiscal.rfc}</span>
                </div>
                <div>
                  <span className="edu-kv__k">Razón social</span>
                  <span className="edu-kv__v">{fiscal.legalName}</span>
                </div>
                <div>
                  <span className="edu-kv__k">Régimen fiscal</span>
                  <span className="edu-kv__v">
                    {fiscal.taxRegime} · {eduDescribeRegimen(fiscal.taxRegime)}
                  </span>
                </div>
                <div>
                  <span className="edu-kv__k">Código postal</span>
                  <span className="edu-kv__v">{fiscal.zipCode}</span>
                </div>
                <div>
                  <span className="edu-kv__k">Uso del CFDI</span>
                  <span className="edu-kv__v">
                    {fiscal.usoCfdi} · {eduDescribeUsoCfdi(fiscal.usoCfdi)}
                  </span>
                </div>
                <div>
                  <span className="edu-kv__k">Correo para la factura</span>
                  <span className="edu-kv__v">{fiscal.email ?? "—"}</span>
                </div>
              </div>
              {/* Corregirlos NO cambia ninguna factura ya emitida: el
                  receptor se congela al timbrar. Decirlo aquí evita que
                  alguien "arregle" un CFDI editando esto. */}
              <p className="edu-note">
                Los capturó {fiscal.updatedByName ?? "—"} · {formatEduDate(fiscal.updatedAt)}.
                Corregirlos no cambia una factura ya timbrada: el receptor queda congelado en el
                CFDI que se emitió.
              </p>
            </>
          ) : (
            <p className="edu-note">
              Este paciente todavía no tiene datos fiscales capturados. Se piden la primera vez
              que pide factura, en el flujo de timbrado.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
