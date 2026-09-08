export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import {
  EDU_ARCO_MAX_ROWS,
  EDU_ARCO_TIPO_LABELS,
  listEduPatientsArco,
  type EduArcoTipo,
} from "@/lib/edu/arco";
import {
  eduFormatDayShort,
  eduSafeTimeZone,
  eduUtcToZoned,
} from "@/lib/edu/agenda-core";
import { EduDenied } from "@/components/edu/edu-denied";

export const metadata: Metadata = {
  title: "Fichas dadas de baja · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/pacientes/arco — LAS FICHAS QUE SALIERON DE LA LISTA.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EXISTE PORQUE UNA BAJA QUE NO SE PUEDE VER NO SE PUEDE DESHACER.
 *
 * Dar de baja y anonimizar sacan la ficha de la lista de pacientes y del
 * buscador — que es justo lo que la solicitud ARCO pide. Sin esta pantalla
 * nadie podría volver a encontrarla: ni para reactivarla, ni para
 * contestar «¿anonimizaron a fulano?» en una auditoría. La constancia está
 * en la bitácora, pero un renglón de bitácora no tiene botón de deshacer.
 *
 * 🔴 LAS DOS LLAVES (`pacientes.manage` + `direccion.panel`), las mismas
 * que el resto de ARCO y comprobadas OTRA VEZ en la capa de datos: esta
 * lista dice quién pidió la cancelación de sus datos y por qué, que es tan
 * personal como los datos que se cancelaron.
 *
 * ⚠️ SIN «ver más». Son las fichas dadas de baja de una escuela: decenas,
 * no miles. El techo existe igual (200) y se DICE cuándo muerde, en vez de
 * cortar en silencio.
 * ═══════════════════════════════════════════════════════════════════════
 */
export default async function PacientesArcoPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (
    !hasEduPermission(permUser, "pacientes.manage") ||
    !hasEduPermission(permUser, "direccion.panel")
  ) {
    return (
      <EduDenied
        permission="direccion.panel"
        what="Las fichas dadas de baja, anonimizadas y fusionadas: quién ejerció un derecho ARCO, cuándo y por qué. Pide pacientes.manage Y direccion.panel — es una decisión de dirección, no de mostrador."
      />
    );
  }

  const crudo = searchParams?.tipo;
  const tipo = typeof crudo === "string" ? crudo : "";
  const q = typeof searchParams?.q === "string" ? searchParams.q : "";

  const { rows, truncated } = await listEduPatientsArco(ctx, { tipo, q });

  const tz = eduSafeTimeZone(ctx.institution.timezone);
  const dia = (iso: string | null) =>
    iso ? eduFormatDayShort(eduUtcToZoned(new Date(iso), tz).dayISO) : "—";

  const TONO: Record<EduArcoTipo, string> = {
    BAJA: "edu-tag--warn",
    ANONIMIZADO: "edu-tag--danger",
    FUSIONADO: "edu-tag--muted",
  };

  const filtros: { valor: string; label: string }[] = [
    { valor: "", label: "Todas" },
    { valor: "BAJA", label: EDU_ARCO_TIPO_LABELS.BAJA },
    { valor: "ANONIMIZADO", label: EDU_ARCO_TIPO_LABELS.ANONIMIZADO },
    { valor: "FUSIONADO", label: EDU_ARCO_TIPO_LABELS.FUSIONADO },
  ];

  return (
    <div className="edu-page">
      <p>
        <Link href="/instituto/pacientes" className="edu-btn edu-btn--ghost edu-btn--sm">
          <ArrowLeft size={15} />
          Pacientes
        </Link>
      </p>

      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Fichas fuera de la lista</h1>
          <p className="edu-page__lead">
            Las que se dieron de baja, las que se anonimizaron por una solicitud ARCO y las que se
            fusionaron con otra. Ninguna se borró: el expediente clínico se conserva cinco años
            desde el último acto médico, como obliga la NOM-004.
          </p>
        </div>
      </header>

      {/* Los filtros son ENLACES y no un <select> con JavaScript: esta
          pantalla no tiene ni un `use client`, se puede compartir el
          enlace de «los anonimizados» y funciona sin JS. */}
      <div className="edu-filtros" role="group" aria-label="Tipo de baja">
        {filtros.map((f) => (
          <Link
            key={f.valor || "todas"}
            href={f.valor ? `/instituto/pacientes/arco?tipo=${f.valor}` : "/instituto/pacientes/arco"}
            className={`edu-filtro ${tipo === f.valor ? "edu-filtro--on" : ""}`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {truncated && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">
              Hay más de {EDU_ARCO_MAX_ROWS} fichas fuera de la lista.
            </p>
            <p className="edu-banner__detail">
              Se enseñan las {EDU_ARCO_MAX_ROWS} más recientes. Se avisa porque una lista que se
              corta en silencio se lee como una lista completa.
            </p>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Ninguna ficha está fuera de la lista</p>
          <p className="edu-empty__detail">
            Aquí aparecen las fichas dadas de baja desde la propia ficha del paciente
            («Dar de baja»), las anonimizadas por una solicitud ARCO y los duplicados que se
            fusionaron con otra.
          </p>
        </div>
      ) : (
        /* `.edu-tablewrap` no es decoración: es lo que hace que esta lista
           se mida a SÍ MISMA (`@container`) y lo que la hace DESPLAZARSE
           en vez de recortar si algún día no cabe (reglas 2 y 4). */
        <div className="edu-tablewrap">
          <div className="edu-table">
            <div className="edu-rowhead" aria-hidden="true">
              <span>Folio</span>
              <span>Ficha</span>
              <span>Qué pasó</span>
              <span>Cuándo</span>
              <span>Quién</span>
              <span />
            </div>

            {rows.map((r) => (
              <div key={r.id} className="edu-row edu-row--off">
                <div className="edu-cell">
                  <span className="edu-cell__label">Folio</span>
                  <span className="edu-cell__value edu-cell__value--strong">{r.folio}</span>
                </div>

                <div className="edu-cell edu-cell--wide">
                  <span className="edu-cell__label">Ficha</span>
                  <span className="edu-cell__value">{r.nombre}</span>
                  {r.motivo && <span className="edu-cell__sub">{r.motivo}</span>}
                  {r.tipo === "FUSIONADO" && r.ganadorId && (
                    <span className="edu-cell__sub">
                      Su expediente vive en{" "}
                      <Link href={`/instituto/pacientes/${r.ganadorId}`} className="edu-link">
                        {r.ganadorFolio}
                      </Link>
                    </span>
                  )}
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Qué pasó</span>
                  <span className={`edu-tag ${TONO[r.tipo]}`}>
                    {r.tipo === "BAJA"
                      ? "Dada de baja"
                      : r.tipo === "ANONIMIZADO"
                        ? "Anonimizada"
                        : "Fusionada"}
                  </span>
                  {r.tipo === "ANONIMIZADO" && (
                    <span className="edu-cell__sub">
                      Irreversible. El expediente clínico se conserva.
                    </span>
                  )}
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Cuándo</span>
                  <span className="edu-cell__value">{dia(r.cuandoISO)}</span>
                </div>

                <div className="edu-cell">
                  <span className="edu-cell__label">Quién</span>
                  <span className="edu-cell__value">{r.quien ?? "—"}</span>
                </div>

                <div className="edu-cell__actions">
                  {/* 🔴 Una FUSIONADA no tiene ficha propia que abrir: el
                      layout redirige a la ganadora. Se enlaza directo a
                      ella para no dar un paseo con rebote. */}
                  <Link
                    href={
                      r.tipo === "FUSIONADO" && r.ganadorId
                        ? `/instituto/pacientes/${r.ganadorId}`
                        : `/instituto/pacientes/${r.id}`
                    }
                    className="edu-btn edu-btn--ghost edu-btn--sm"
                  >
                    Ver
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="edu-note">
        Reactivar una ficha dada de baja se hace desde su propia ficha, con el botón «Reactivar».
        Una ficha ANONIMIZADA no se reactiva: sus datos personales ya se sustituyeron y volver a
        encenderla no los devuelve.
      </p>
    </div>
  );
}
