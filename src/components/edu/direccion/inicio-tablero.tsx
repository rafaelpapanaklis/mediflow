"use client";

import { useCallback, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";
import {
  EDU_DIR_INICIO_PERIODOS,
  EDU_DIR_PERIODO_LABELS,
  type EduDirInicio,
  type EduDirInicioAcceso,
  type EduDirInicioPeriodo,
  type EduDirSemaforo,
  type EduDirSerie,
} from "@/lib/edu/direccion-core";

/**
 * EL INICIO DE QUIEN DIRIGE LA ESCUELA.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 SOLO PARA DIRECCIÓN. Un DOCENTE, un ALUMNO y CAJA ven el Inicio de
 * siempre: este componente ni siquiera se monta para ellos, y los datos no
 * llegan a pedirse — el servidor los NIEGA antes (eduDirAlcance, que
 * pregunta a visibility.ts). Pegar la URL no sirve de nada.
 *
 * 🔴 LAS TRES GRÁFICAS SON EL TABLERO DE DIRECCIÓN PARTIDO POR DÍA, no un
 * segundo cálculo: mismo periodo, mismos topes, misma variación y mismo
 * alcance. Por eso los totales de aquí y los del tablero son el MISMO
 * número, y por eso cada gráfica lleva debajo el enlace a la lista que hay
 * detrás.
 *
 * 🔴 EL CONMUTADOR NAVEGA, no guarda estado en el cliente. Cambiar de
 * semana a mes es cambiar la consulta, así que se hace donde vive la
 * consulta: `?periodo=` en la URL, que además deja el mes compartible y
 * recargable. Es el mismo mecanismo que usa el tablero de Dirección.
 * ═══════════════════════════════════════════════════════════════════════
 */

// recharts pesa ~95 kB: se carga aparte y solo cuando esta pantalla se
// pinta de verdad. `ssr: false` porque mide el ancho del contenedor, que en
// el servidor no existe. Mismo patrón que revenue-trend-card.tsx del dental.
const EduInicioGrafica = dynamic(
  () => import("@/components/edu/direccion/inicio-grafica").then((m) => m.EduInicioGrafica),
  { ssr: false, loading: () => <div className="edu-ini-chart edu-ini-chart--cargando" /> },
);

const BORDE_POR_SEMAFORO: Record<EduDirSemaforo, string> = {
  ACTUAR: "edu-dir-cifra--actuar",
  VIGILAR: "edu-dir-cifra--vigilar",
  OK: "edu-dir-cifra--ok",
  NEUTRO: "",
};

export function EduInicioTablero({ inicio }: { inicio: EduDirInicio }) {
  const router = useRouter();
  const [navegando, startNav] = useTransition();

  const irA = useCallback(
    (periodo: EduDirInicioPeriodo) => {
      startNav(() => {
        router.replace(`/instituto/inicio?periodo=${periodo}`, { scroll: false });
      });
    },
    [router],
  );

  return (
    <>
      <section className="edu-dir-bloque">
        <div className="edu-dir-bloque__head">
          <h2 className="edu-dir-bloque__title">Cómo va la clínica</h2>
          <div className="edu-seg" role="group" aria-label="Periodo">
            {EDU_DIR_INICIO_PERIODOS.map((p) => (
              <button
                key={p}
                type="button"
                className={`edu-seg__btn ${inicio.periodo === p ? "edu-seg__btn--on" : ""}`}
                aria-pressed={inicio.periodo === p}
                disabled={navegando}
                onClick={() => irA(p)}
              >
                {EDU_DIR_PERIODO_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        <p className="edu-dir-bloque__lead">
          {inicio.ventana.label}
          {inicio.sede ? ` · ${inicio.sede}` : ""}. Cada total se compara {inicio.ventana.compara}.
          Los mismos números, abiertos por especialidad y por estudiante, están en{" "}
          <Link href="/instituto/direccion" className="edu-link">
            Dirección
          </Link>
          .
        </p>

        {inicio.avisos.length > 0 && (
          <div className="edu-banner" role="status">
            <div>
              <p className="edu-banner__title">Lo que estas gráficas no pueden saber</p>
              {inicio.avisos.map((a) => (
                <p key={a} className="edu-banner__detail">
                  {a}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="edu-ini-graficas">
          {inicio.series.map((s) => (
            <Grafica key={s.key} serie={s} periodo={inicio.periodo} />
          ))}
        </div>
      </section>

      <section className="edu-dir-bloque">
        <div className="edu-dir-bloque__head">
          <h2 className="edu-dir-bloque__title">Lo que está esperando</h2>
        </div>
        <p className="edu-dir-bloque__lead">
          Esto no es del periodo de arriba: es lo que hay ahora mismo sin resolver. Cada tarjeta
          lleva a la pantalla donde se resuelve.
        </p>
        <div className="edu-dir-cifras">
          {inicio.esperando.map((a) => (
            <Acceso key={a.key} acceso={a} />
          ))}
        </div>
      </section>
    </>
  );
}

function Grafica({ serie, periodo }: { serie: EduDirSerie; periodo: EduDirInicioPeriodo }) {
  const v = serie.variacion;
  const Flecha = v.sentido === 1 ? ArrowUpRight : v.sentido === -1 ? ArrowDownRight : Minus;

  return (
    <article className="edu-ini-grafica">
      <div className="edu-ini-grafica__head">
        <div style={{ minWidth: 0 }}>
          <h3 className="edu-ini-grafica__titulo">{serie.titulo}</h3>
          <p className="edu-ini-grafica__detalle">{serie.detalle}</p>
        </div>
        <span
          className={`edu-ini-grafica__total ${serie.unidad === "dinero" ? "edu-ini-grafica__total--dinero" : ""}`}
        >
          {serie.totalLabel}
        </span>
      </div>

      {/* La variación va en su PROPIO renglón y no al lado del total: en
          dinero el texto es largo ("antes no entró nada ($0.00 → …)") y
          arriba a la derecha empujaba el total a otra línea, dejando las
          tres tarjetas con el número a distinta altura.

          La flecha dice la DIRECCIÓN y nada más: el color se reserva para
          lo que hay que atender, igual que en el tablero — subir no
          siempre es bueno y bajar no siempre es malo. */}
      <span className="edu-dir-cifra__var">
        <Flecha size={14} aria-hidden="true" />
        {v.texto}
      </span>

      <EduInicioGrafica serie={serie} />

      {serie.maximo === 0 && (
        <p className="edu-ini-grafica__vacio">
          {periodo === "semana"
            ? "Ni un solo día del periodo tiene nada que contar. Prueba con el mes."
            : "Ni un solo día del periodo tiene nada que contar."}
        </p>
      )}

      {serie.nota && <p className="edu-ini-grafica__nota">{serie.nota}</p>}

      {/* Al tablero CON EL MISMO PERIODO. Ahí la misma cifra se abre por
          especialidad, por estudiante y en la lista de registros que hay
          detrás. No se enlaza a una lista concreta porque el tablero no
          abre modales desde la URL: prometer aquí un enlace que llega a
          una pantalla sin abrir nada es peor que no ponerlo. */}
      <Link href={`/instituto/direccion?periodo=${periodo}`} className="edu-ini-grafica__link">
        Abrir en Dirección
        <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </article>
  );
}

function Acceso({ acceso }: { acceso: EduDirInicioAcceso }) {
  return (
    <Link
      href={acceso.href}
      className={`edu-dir-cifra edu-ini-acceso ${BORDE_POR_SEMAFORO[acceso.semaforo]}`}
    >
      <span className="edu-dir-cifra__label">{acceso.titulo}</span>
      <span
        className={`edu-dir-cifra__n ${acceso.key === "por-cobrar" ? "edu-dir-cifra__n--dinero" : ""}`}
      >
        {acceso.valor}
      </span>
      <span className="edu-dir-cifra__note">{acceso.detalle}</span>
    </Link>
  );
}
