import { Lock } from "lucide-react";
import s from "./team.module.css";

/**
 * "Esto no es para ti". Se pinta cuando alguien llega por URL a un área que
 * su rol o su plan no incluyen.
 *
 * Recordatorio de que el candado REAL está en el servidor: cada endpoint
 * responde 403 aunque alguien se salte esta pantalla. Esconder un menú nunca
 * fue control de acceso.
 *
 * Server component a propósito: no necesita estado y así la página no manda
 * un bundle de JavaScript solo para decir "no".
 */
export function RealtyDenied({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className={s.root}>
      <div className={s.card}>
        <div className={s.empty}>
          <div className={s.emptyIcon}>
            <Lock size={20} />
          </div>
          <div className={s.emptyTitle}>{title}</div>
          <p className={s.emptyBody}>{body}</p>
          {cta ? (
            <a href={cta.href} className={[s.btn, s.btnPrimary].join(" ")}>
              {cta.label}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
