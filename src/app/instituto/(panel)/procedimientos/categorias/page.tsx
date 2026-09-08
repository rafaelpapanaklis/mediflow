export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduCategoriasPanel } from "@/lib/edu/categorias";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduCategoriasScreen } from "@/components/edu/evaluacion/categorias-screen";

export const metadata: Metadata = {
  title: "Categorías · DaleControl Institucional",
  robots: { index: false, follow: false },
};

/**
 * /instituto/procedimientos/categorias — EL CATÁLOGO DE CATEGORÍAS (H-90).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ ES UNA SUBRUTA DE PROCEDIMIENTOS Y NO UN ITEM DEL MENÚ
 *
 * Una entrada más en el menú exigiría una key de permiso nueva o dejaría un
 * item vacío a media escuela — y en esta ola no se crea ninguna key
 * (una key nueva NO le llega a nadie con `permissionsOverride` guardado,
 * porque el override REEMPLAZA al default, así que habría hecho falta un
 * backfill en SQL contra la base de cada escuela). La categoría ES del
 * catálogo de procedimientos: vive detrás de la MISMA llave
 * (`tarifarios.view` / `tarifarios.manage`) y a un clic de él.
 *
 * 🔴 EXIGE "tarifarios.view" AQUÍ, no solo en el enlace: esconder un enlace
 * no cierra ninguna puerta, basta con teclear la URL.
 * ═══════════════════════════════════════════════════════════════════════
 */
export default async function InstitutoCategoriasPage() {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasEduPermission(permUser, "tarifarios.view")) {
    return (
      <EduDenied
        permission="tarifarios.view"
        what="Las categorías del catálogo de procedimientos: cómo se agrupa lo que la clínica hace, y con qué se comparan los requisitos que cuentan «toda una categoría»."
      />
    );
  }

  const canManage = hasEduPermission(permUser, "tarifarios.manage");
  const panel = await getEduCategoriasPanel(ctx);

  return (
    <div className="edu-page">
      <header className="edu-pagehead">
        <div>
          <h1 className="edu-page__title">Categorías</h1>
          <p className="edu-page__lead">
            Agrupan lo que la clínica hace, y son con lo que se comparan los requisitos del plan de
            estudios que cuentan «toda una categoría». Hasta ahora esa comparación era por TEXTO: si
            alguien renombraba la categoría, el avance de la especialidad pasaba a cero en silencio.
            Con este catálogo se compara por una <strong>clave que no cambia</strong>.
          </p>
        </div>
        <div className="edu-pagehead__actions">
          <Link
            href="/instituto/procedimientos"
            className="edu-btn edu-btn--ghost edu-btn--sm"
          >
            Procedimientos
          </Link>
        </div>
      </header>

      <EduCategoriasScreen
        rows={panel.rows}
        procedimientos={panel.procedimientos}
        requisitos={panel.requisitos}
        sinPareja={panel.sinPareja}
        canManage={canManage}
      />
    </div>
  );
}
