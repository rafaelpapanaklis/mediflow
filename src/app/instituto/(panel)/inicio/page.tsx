export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2, Clock3 } from "lucide-react";
import { getEduContext, eduUserDisplayName } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import {
  eduContractNotice,
  eduContractNoticeIsFor,
  formatEduContractDate,
} from "@/lib/edu/contract";
import {
  EDU_ROLE_DESCRIPTIONS,
  EDU_ROLE_LABELS,
  EDU_UPCOMING_AREAS,
} from "@/lib/edu/types";
import { getEduCampusScope, listEduCampusToday } from "@/lib/edu/campus";

export const metadata: Metadata = {
  title: "Inicio · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * Inicio del panel del instituto.
 *
 * EXIGE "inicio.view". El layout ya comprobó la SESIÓN; el permiso se
 * comprueba aquí, que es donde vive el contenido — si solo lo mirara el
 * sidebar, esconder el item no cerraría la puerta y bastaría con teclear la
 * URL.
 *
 * Sin el permiso NO se redirige: en la Ola 0 ésta es la única pantalla del
 * vertical, así que mandar a /instituto haría un bucle (ese router manda
 * justo aquí). Se pinta el motivo, que además es lo que la dirección
 * necesita leer para arreglarlo.
 */
export default async function InstitutoInicioPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permitido = hasEduPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    "inicio.view",
  );

  if (!permitido) {
    return (
      <div className="edu-page">
        <div className="edu-banner edu-banner--warn" role="alert">
          <div>
            <p className="edu-banner__title">Tu cuenta no tiene acceso al panel</p>
            <p className="edu-banner__detail">
              Alguien te quitó el permiso <code>inicio.view</code> desde la administración
              del instituto. Pídele a la dirección que vuelva a activártelo.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 🔴 Ola 11 · LAS SEDES. El bloque de abajo solo existe cuando hay más de
  // una: en una escuela de un edificio, un resumen "por sede" con una sola
  // fila no le dice nada a nadie y ocupa la mitad de la pantalla de inicio.
  const sede = await getEduCampusScope(ctx);
  const porSede = sede.showPicker ? await listEduCampusToday(ctx, sede) : [];

  const nombre = eduUserDisplayName(ctx.user);
  const rol = EDU_ROLE_LABELS[ctx.role] ?? ctx.role;
  const aviso = eduContractNoticeIsFor(ctx.role)
    ? eduContractNotice(ctx.institution)
    : null;

  return (
    <div className="edu-page">
      <header>
        <h1 className="edu-page__title">Hola, {ctx.user.firstName || nombre}</h1>
        <p className="edu-page__lead">
          Estás en {ctx.institution.name} como <strong>{rol}</strong>.
        </p>
      </header>

      {aviso && (
        <div
          className={`edu-banner ${aviso.level === "expired" || aviso.level === "inactive" ? "edu-banner--warn" : ""}`}
          role="status"
        >
          <div>
            <p className="edu-banner__title">{aviso.title}</p>
            <p className="edu-banner__detail">{aviso.detail}</p>
          </div>
        </div>
      )}

      <div className="edu-grid">
        <section className="edu-card">
          <p className="edu-card__label">Instituto</p>
          <p className="edu-card__value">{ctx.institution.name}</p>
          <p className="edu-card__note">
            {[ctx.institution.city, ctx.institution.state].filter(Boolean).join(", ") ||
              "Sin ciudad registrada"}
          </p>
        </section>

        <section className="edu-card">
          <p className="edu-card__label">Tu cuenta</p>
          <p className="edu-card__value">{nombre}</p>
          <p className="edu-card__note">{ctx.user.email}</p>
        </section>

        <section className="edu-card">
          <p className="edu-card__label">Tu rol</p>
          <p className="edu-card__value">{rol}</p>
          <p className="edu-card__note">{EDU_ROLE_DESCRIPTIONS[ctx.role] ?? ""}</p>
        </section>

        {sede.active && (
          <section className="edu-card">
            <p className="edu-card__label">Sede que estás viendo</p>
            <p className="edu-card__value">{sede.active.name}</p>
            <p className="edu-card__note">
              Hora local: {sede.timezone}. La agenda, los sillones y la caja de abajo están
              recortados a esta sede.
            </p>
          </section>
        )}
      </div>

      {/* ── Cómo va hoy cada sede ───────────────────────────────────────
          🔴 "HOY" ES DISTINTO EN CADA SEDE cuando están en husos distintos,
          y por eso cada renglón trae su propia fecha: contar las dos con la
          misma ventana le pondría a una las citas de la madrugada de la
          otra. Solo se pinta con más de una sede. */}
      {porSede.length > 0 && (
        <section>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h2 className="edu-page__title" style={{ fontSize: 18 }}>
              Tus sedes hoy
            </h2>
            <span className="edu-chip">
              <Building2 size={12} aria-hidden="true" />
              {porSede.length}
            </span>
          </div>
          <p className="edu-page__lead" style={{ marginBottom: 14 }}>
            {sede.active
              ? `Estás filtrando por ${sede.active.name}. Cambia arriba para ver otra, o vuelve a "${sede.allLabel}".`
              : `Estás viendo ${sede.allLabel.toLowerCase()}. Elige una arriba para recortar la agenda, los sillones y la caja.`}
          </p>
          <div className="edu-grid">
            {porSede.map((s) => (
              <article
                key={s.id}
                className="edu-card"
                aria-current={s.id === sede.activeId ? "true" : undefined}
              >
                <p className="edu-card__label">
                  {s.code}
                  {s.isActive ? "" : " · cerrada"}
                </p>
                <p className="edu-card__value">{s.name}</p>
                <p className="edu-card__note">
                  {s.appointments} {s.appointments === 1 ? "cita hoy" : "citas hoy"} ·{" "}
                  {s.chairs} {s.chairs === 1 ? "sillón activo" : "sillones activos"}
                </p>
                <p className="edu-card__note">
                  Su hoy: {s.dayISO} ({s.timezone})
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* El bloque entero desaparece cuando no queda ningún área anunciada
          —y desde la Ola 6 no queda ninguna—. Un encabezado
          "Próximamente" con nada debajo se lee como una app rota, que es
          justo lo contrario de para lo que existía esta lista. Si una ola
          futura anuncia algo, vuelve solo. */}
      {EDU_UPCOMING_AREAS.length > 0 && (
        <section>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h2 className="edu-page__title" style={{ fontSize: 18 }}>
              Próximamente
            </h2>
            <span className="edu-chip">
              <Clock3 size={12} aria-hidden="true" />
              En construcción
            </span>
          </div>
          <p className="edu-page__lead" style={{ marginBottom: 14 }}>
            Estas áreas todavía no existen. Aparecerán en el menú de la izquierda cuando se
            entreguen — no antes, para que nadie las busque y no las encuentre.
          </p>
          <div className="edu-grid">
            {EDU_UPCOMING_AREAS.map((area) => (
              <article key={area.key} className="edu-soon">
                <span className="edu-chip">Pronto</span>
                <h3 className="edu-soon__title">{area.title}</h3>
                <p className="edu-soon__detail">{area.detail}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <p style={{ fontSize: 12.5, color: "var(--edu-text-3)", margin: 0 }}>
        Zona horaria del instituto: {ctx.institution.timezone}
        {ctx.institution.contractEndsAt
          ? ` · Contrato vigente hasta el ${formatEduContractDate(ctx.institution.contractEndsAt)}`
          : ""}
      </p>
    </div>
  );
}
