import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Check, CheckCircle2, Loader2, Lock, Sparkles } from "lucide-react";
import s from "./pago.module.css";

/**
 * Piezas de SERVIDOR de la pantalla de pago (Clínica suspendida) rediseñada con
 * la marca del registro (pago.module.css): el encabezado (avisos + píldora +
 * título + texto + recorrido del alta), el enlace de vuelta al login, y las dos
 * caras de la vuelta de Stripe (/success).
 *
 * Los TEXTOS los decide la página, igual que hoy (`suspended/page.tsx` elige
 * el tono según el estado de la suscripción y `success/page.tsx` traduce con
 * `getServerT`): aquí solo se pintan. Ni una frase nueva, ni una sección que
 * la pantalla de hoy no tenga.
 */

export function CabeceraSuspendida({
  avisoPendiente,
  avisoRechazo = null,
  avisoTransferencia = null,
  reactivacion,
  pildora,
  titulo,
  texto,
}: {
  /** Texto del aviso de SPEI/OXXO pendiente, o null si no aplica. */
  avisoPendiente: string | null;
  /** «Tu transferencia no se pudo confirmar: …» (SPEI directo rechazado), o null. */
  avisoRechazo?: string | null;
  /** «Tienes una transferencia esperando confirmación» + enlace para volver a ella, o null. */
  avisoTransferencia?: ReactNode;
  /** Cuenta que ya tuvo acceso y se pausó (candado) vs. compra nueva (destello). */
  reactivacion: boolean;
  pildora: string;
  titulo: string;
  texto: string;
}) {
  return (
    <>
      {avisoPendiente && (
        <div className={s.aviso} role="status">
          {avisoPendiente}
        </div>
      )}
      {avisoRechazo && (
        <div className={`${s.aviso} ${s.avisoPeligro}`} role="alert">
          {avisoRechazo}
        </div>
      )}
      {avisoTransferencia && (
        <div className={`${s.aviso} ${s.avisoInfo}`} role="status">
          {avisoTransferencia}
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
        {/* Recorrido del alta (cuenta ✓ → clínica ✓ → pago ●), solo en la
            compra nueva: la reactivación no viene del registro. Decorativo:
            el título ya dice en qué paso se está. */}
        {!reactivacion && (
          <ol className={s.recorrido} aria-hidden="true">
            <li className={`${s.recorridoPaso} ${s.recorridoPasoHecho}`}>
              <span className={s.recorridoBarra} />
              <span className={s.recorridoTexto}><Check size={13} strokeWidth={3} /> Cuenta</span>
            </li>
            <li className={`${s.recorridoPaso} ${s.recorridoPasoHecho}`}>
              <span className={s.recorridoBarra} />
              <span className={s.recorridoTexto}><Check size={13} strokeWidth={3} /> Clínica</span>
            </li>
            <li className={`${s.recorridoPaso} ${s.recorridoPasoActual}`}>
              <span className={s.recorridoBarra} />
              <span className={s.recorridoTexto}>Pago</span>
            </li>
          </ol>
        )}
      </div>
    </>
  );
}

export function VolverAlLogin({ texto }: { texto: string }) {
  // El texto traducido ya trae su flecha («← Volver al login»): aquí se
  // dibuja con el ícono y se quita la del texto para no repetirla.
  return (
    <p className={s.volver}>
      <Link href="/login">
        <ArrowLeft size={14} aria-hidden />
        {texto.replace(/^←\s*/, "")}
      </Link>
    </p>
  );
}

/** Contenedor de la pantalla de planes: mismo ancho máximo que hoy (1000 px) y los tokens de la marca. */
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
      <div className={s.resultadoTarjeta}>
        <div className={`${s.resultadoIcono} ${activada ? s.resultadoIconoExito : s.resultadoIconoEspera}`}>
          {activada ? (
            <CheckCircle2 size={40} aria-hidden />
          ) : (
            <Loader2 size={36} aria-hidden className={s.girando} />
          )}
        </div>
        <h1 className={s.resultadoTitulo}>{titulo}</h1>
        <p className={s.resultadoTexto}>{texto}</p>
        <div className={s.resultadoAcciones}>{acciones}</div>
        {referencia && <div className={s.referencia}>{referencia}</div>}
      </div>
    </div>
  );
}

/** Clase del enlace dentro de un aviso (lo monta la página). */
export const AVISO_ENLACE = s.avisoEnlace;

/** Clases de botón para lo que la página monta dentro de `acciones`. */
export const CLASE_BOTON = s.boton;
export const CLASE_BOTON_PRINCIPAL = `${s.boton} ${s.botonPrincipal}`;
