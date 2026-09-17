import Link from "next/link";
import { Smile } from "lucide-react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./bloques.module.css";

/**
 * Los UMBRALES hacia dos pantallas viejas poco transitadas (hallazgo 21):
 * la pestaña Ortodoncia del expediente y Mi Clínica 3D. La regla del
 * hallazgo es que la salida no desentone; esas dos pantallas NO se
 * rediseñan y aquí no se toca ni una regla de ellas.
 *
 * Son componentes sin hooks para que un server component los pueda montar.
 * Cada uno monta `CLASES_MENU` él mismo porque ninguno cuelga de una raíz
 * que le preste los tokens: la banda de Ortodoncia vive entre el menú de la
 * ficha y el módulo viejo (la raíz del expediente solo pone los `--pr-*`), y
 * las dos piezas del 3D se pintan en una página que no tiene raíz nueva.
 */

/**
 * La banda que presenta el módulo de Ortodoncia dentro del expediente
 * nuevo: el mismo icono y el mismo nombre que la entrada del menú de la
 * ficha, y el paciente debajo. Con ella, al pasar del expediente nuevo al
 * módulo (que conserva su cabecera y su ropa) hay un escalón en el idioma
 * nuevo en vez de un corte.
 */
export function SalidaOrtodoncia({ titulo, paciente }: { titulo: string; paciente: string }) {
  return (
    <div className={`${CLASES_MENU} ${s.salidaOrto}`}>
      <span className={`${s.iconoCaja} ${s.iconoCajaGrande}`}>
        <Smile size={17} strokeWidth={1.75} aria-hidden />
      </span>
      <div className={s.salidaOrtoTextos}>
        <h2 className={s.salidaOrtoTitulo}>{titulo}</h2>
        <p className={s.salidaOrtoSub}>{paciente}</p>
      </div>
    </div>
  );
}

/** Lo que se ve mientras baja el visor 3D (`next/dynamic`, solo cliente). */
export function Cargando3D({ texto }: { texto: string }) {
  return (
    <div className={`${CLASES_MENU} ${s.cargando3d}`} role="status" aria-live="polite">
      <span className={s.girando3d} aria-hidden />
      <span>{texto}</span>
    </div>
  );
}

/** El aviso de la página 3D cuando el servidor no pudo cargar el plano. */
export function Error3D({
  titulo,
  texto,
  reintentar,
  volver,
}: {
  titulo: string;
  texto: string;
  reintentar: { href: string; texto: string };
  volver: { href: string; texto: string };
}) {
  return (
    <div className={`${CLASES_MENU} ${s.error3d}`}>
      <div className={s.error3dCaja}>
        <h1 className={s.error3dTitulo}>{titulo}</h1>
        <p className={s.error3dTexto}>{texto}</p>
        <div className={s.error3dAcciones}>
          <a href={reintentar.href} className={`${s.enlaceBoton} ${s.enlaceBotonAlto} ${s.enlaceBotonPrincipal}`}>
            {reintentar.texto}
          </a>
          <Link href={volver.href} className={`${s.enlaceBoton} ${s.enlaceBotonAlto}`}>
            {volver.texto}
          </Link>
        </div>
      </div>
    </div>
  );
}
