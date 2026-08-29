import Link from "next/link";

/**
 * Lo que ve alguien que tecleó la URL de una pantalla que no le toca.
 *
 * 🔴 NO se redirige. Un redirect a Inicio le dice a la persona "esto no
 * existe" cuando la verdad es "esto existe y no es para ti", y además
 * puede acabar en un bucle si tampoco tiene inicio.view. Se pinta el
 * motivo, con el nombre EXACTO del permiso, porque eso es lo que la
 * dirección necesita leer para arreglarlo en dos minutos.
 *
 * Este componente NO es "use client": no hay nada interactivo que ganar y
 * así no viaja ni un byte de más al navegador.
 */
export function EduDenied({
  permission,
  what,
}: {
  /** La key del catálogo, tal cual, para que se pueda buscar. */
  permission: string;
  /** Qué es esta pantalla, en una frase. */
  what: string;
}) {
  return (
    <div className="edu-page">
      <div className="edu-banner edu-banner--warn" role="alert">
        <div>
          <p className="edu-banner__title">No tienes acceso a esta pantalla</p>
          <p className="edu-banner__detail">
            {what} Hace falta el permiso <code>{permission}</code>, y tu cuenta no lo tiene.
            Pídeselo a la dirección del instituto: es un interruptor, no un trámite.
          </p>
        </div>
      </div>
      <p>
        <Link href="/instituto/inicio" className="edu-btn edu-btn--ghost">
          Volver al inicio
        </Link>
      </p>
    </div>
  );
}
