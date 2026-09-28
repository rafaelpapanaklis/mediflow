// Módulo de Ortodoncia — piezas de presentación (ws1-t3). Sin hooks ni
// manejadores: las montan tal cual las páginas de servidor del módulo.
// Solo pintan; no leen datos ni deciden permisos.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { RaizRediseno } from "@/components/dashboard/pacientes-rediseno/raiz";
import s from "./modulo.module.css";

export type Tono = "violeta" | "exito" | "alerta" | "peligro" | "neutro";

const CLASE_TONO: Record<Tono, string> = {
  violeta: "",
  exito: s.tonoExito,
  alerta: s.tonoAlerta,
  peligro: s.tonoPeligro,
  neutro: s.tonoNeutro,
};

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/**
 * La raíz del módulo: los tokens y la tipografía del rediseño
 * (`RaizRediseno`, los mismos de la ficha del paciente y de Caja) más la
 * hoja del módulo. Todo lo de Ortodoncia cuelga de aquí.
 */
export function RaizModulo({ children }: { children: ReactNode }) {
  return <RaizRediseno className={s.raiz}>{children}</RaizRediseno>;
}

/** Una pantalla del módulo: título, una línea de contexto, acciones y los bloques. */
export function Pantalla({
  titulo,
  sub,
  acciones,
  children,
}: {
  titulo: string;
  sub?: ReactNode;
  acciones?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={s.pantalla}>
      <header className={s.cabeza}>
        <div className={s.cabezaTextos}>
          <h1 className={s.titulo}>{titulo}</h1>
          {sub && <p className={s.subtitulo}>{sub}</p>}
        </div>
        {acciones && <div className={s.acciones}>{acciones}</div>}
      </header>
      {children}
    </div>
  );
}

export function Tarjeta({
  icono: Icono,
  tono = "violeta",
  titulo,
  sub,
  accion,
  id,
  children,
}: {
  icono: LucideIcon;
  tono?: Tono;
  titulo: string;
  sub?: ReactNode;
  /** Lo que va a la derecha del título: un enlace, un contador. */
  accion?: ReactNode;
  /** Ancla, para saltar a la tarjeta desde otro punto de la pantalla. */
  id?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx(s.tarjeta, id && s.ancla)} id={id} aria-labelledby={id ? `${id}-titulo` : undefined}>
      <header className={s.tarjetaCabeza}>
        <span className={cx(s.tarjetaIcono, CLASE_TONO[tono])} aria-hidden>
          <Icono size={15} strokeWidth={1.9} />
        </span>
        <div className={s.tarjetaTextos}>
          <h2 className={s.tarjetaTitulo} id={id ? `${id}-titulo` : undefined}>
            {titulo}
          </h2>
          {sub && <p className={s.tarjetaSub}>{sub}</p>}
        </div>
        {accion && <div className={s.tarjetaAccion}>{accion}</div>}
      </header>
      {children}
    </section>
  );
}

/** Estado vacío: qué pasa y qué se puede hacer, no un hueco en blanco. */
export function Vacio({
  icono: Icono,
  tono = "violeta",
  titulo,
  pista,
  alto,
  children,
}: {
  icono: LucideIcon;
  tono?: Tono;
  titulo: string;
  pista?: ReactNode;
  alto?: boolean;
  /** Botones o enlaces de salida. */
  children?: ReactNode;
}) {
  return (
    <div className={cx(s.vacio, alto && s.vacioAlto)}>
      <span className={cx(s.vacioIcono, CLASE_TONO[tono])} aria-hidden>
        <Icono size={18} strokeWidth={1.8} />
      </span>
      <p className={s.vacioTitulo}>{titulo}</p>
      {pista && <p className={s.vacioPista}>{pista}</p>}
      {children && <div className={s.vacioAcciones}>{children}</div>}
    </div>
  );
}
