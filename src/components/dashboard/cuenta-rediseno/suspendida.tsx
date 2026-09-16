import Link from "next/link";
import type { ReactNode } from "react";
import { CheckCircle2, Loader2, Lock, Sparkles } from "lucide-react";
import s from "./cuenta.module.css";

/**
 * Piezas de SERVIDOR de la pantalla de Clínica suspendida rediseñada: el
 * encabezado (aviso de pago pendiente + píldora + título + texto), el enlace
 * de vuelta al login, y las dos caras de la vuelta de Stripe (/success).
 *
 * Los TEXTOS los decide la página, igual que hoy (`suspended/page.tsx` elige
 * el tono según el estado de la suscripción y `success/page.tsx` traduce con
 * `getServerT`): aquí solo se pintan. Ni una frase nueva, ni una sección que
 * la pantalla de hoy no tenga.
 */

export function CabeceraSuspendida({
  avisoPendiente,
  reactivacion,
  pildora,
  titulo,
  texto,
}: {
  /** Texto del aviso de SPEI/OXXO pendiente, o null si no aplica. */
  avisoPendiente: string | null;
  /** Cuenta que ya tuvo acceso y se pausó (candado) vs. compra nueva (destello). */
  reactivacion: boolean;
  pildora: string;
  titulo: string;
  texto: string;
}) {
  return (
    <>
      {avisoPendiente && (
        <div className={s.avisoPendiente} role="status">
          {avisoPendiente}
        </div>
      )}
      <div className={s.cabecera}>
        <div className={s.pildora}>
          <span className={s.pildoraIcono}>
            {reactivacion ? <Lock size={13} aria-hidden /> : <Sparkles size={13} aria-hidden />}
          </span>
          {pildora}
        </div>
        <h1 className={s.titulo}>{titulo}</h1>
        <p className={s.subtitulo}>{texto}</p>
      </div>
    </>
  );
}

export function VolverAlLogin({ texto }: { texto: string }) {
  return (
    <p className={s.volver}>
      <Link href="/login">← {texto}</Link>
    </p>
  );
}

/** Contenedor de la pantalla de planes: mismo ancho máximo que hoy (1000 px). */
export function PaginaSuspendida({ children }: { children: ReactNode }) {
  return <div className={s.pagina}>{children}</div>;
}

/**
 * Vuelta de Stripe. `activada` la decide la página leyendo la BD (nunca se
 * afirma «activo» sin leerlo); mientras no llegue el webhook, `acciones` trae
 * el botón de «Volver a verificar» (<ConfirmingPoll/>) y el de soporte.
 */
export function ResultadoPago({
  activada,
  titulo,
  texto,
  acciones,
  referencia,
}: {
  activada: boolean;
  titulo: string;
  texto: string;
  acciones: ReactNode;
  /** «Referencia: …» ya armada por la página, o null. */
  referencia: string | null;
}) {
  return (
    <div className={s.resultado}>
      <div className={`${s.resultadoIcono} ${activada ? s.resultadoIconoExito : s.resultadoIconoEspera}`}>
        {activada ? (
          <CheckCircle2 size={36} aria-hidden />
        ) : (
          <Loader2 size={36} aria-hidden className={s.girando} />
        )}
      </div>
      <h1 className={s.resultadoTitulo}>{titulo}</h1>
      <p className={s.resultadoTexto}>{texto}</p>
      <div className={s.resultadoAcciones}>{acciones}</div>
      {referencia && <div className={s.referencia}>{referencia}</div>}
    </div>
  );
}

/** Clases de botón para lo que la página monta dentro de `acciones`. */
export const CLASE_BOTON = s.boton;
export const CLASE_BOTON_PRINCIPAL = `${s.boton} ${s.botonPrincipal}`;
