"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { CreditCard, Loader2, TrendingUp } from "lucide-react";
import { useLocale, useT } from "@/i18n/i18n-provider";
import {
  cobrarPendiente,
  formatoMonto,
  leerPagoPendiente,
  type LecturaPago,
  type OrdenDeCobro,
} from "@/lib/billing/pago-pendiente-cliente";
import { usePagarAhora } from "./pagar-ahora";
import s from "./pago-pendiente.module.css";

/**
 * Los DOS botones de una clínica con la tarjeta rechazada (solo dueño/administrador de facturación):
 *   A. «Pagar mi plan» — cobra lo pendiente del plan actual.
 *   B. «Cambiar a un plan más grande y pagar» — solo planes más grandes; anula lo pendiente y cobra el plan
 *      nuevo completo, a precio de lista (sin la promo del primer mes).
 * Antes de cobrar SIEMPRE se enseña el monto exacto («Vas a pagar $X») que devolvió el servidor, y hay que
 * confirmar. El cobro lo hace `/api/billing/pago-pendiente` (contrato en pago-pendiente-cliente.ts).
 * Mientras esa ruta no exista (404) o falle, se avisa y queda «Actualizar tarjeta / pagar» (portal de Stripe).
 */

type Eleccion = { accion: "pagar" } | { accion: "subir"; plan: string };

export function PagoPendienteVista({
  lectura,
  puedePagar,
  eleccion,
  eligiendoPlan,
  cobrando,
  idioma,
  respaldo,
  onPagarPlan,
  onVerPlanes,
  onElegirPlan,
  onConfirmar,
  onCancelar,
  onRecargar,
}: {
  /** null = todavía leyendo. */
  lectura: LecturaPago | null;
  puedePagar: boolean;
  eleccion: Eleccion | null;
  eligiendoPlan: boolean;
  cobrando: boolean;
  idioma: string;
  /** «Actualizar tarjeta / pagar» (portal): el camino de siempre cuando el pago directo no está. */
  respaldo: ReactNode;
  onPagarPlan: () => void;
  onVerPlanes: () => void;
  onElegirPlan: (plan: string) => void;
  onConfirmar: () => void;
  onCancelar: () => void;
  onRecargar: () => void;
}) {
  const t = useT();

  // Los demás roles no pagan ni consultan: solo se les dice quién puede.
  if (!puedePagar) {
    return (
      <section className={s.panel} data-pago-pendiente="sin-permiso">
        <p className={s.nota}>{t("shell.pagoPendiente.soloDueno")}</p>
      </section>
    );
  }

  if (lectura === null) {
    return (
      <section className={s.panel} data-pago-pendiente="cargando" aria-busy="true">
        <p className={s.nota}>
          <Loader2 size={14} className={s.girar} aria-hidden /> {t("shell.pagoPendiente.cargando")}
        </p>
      </section>
    );
  }

  if (lectura.tipo !== "listo") {
    return (
      <section className={s.panel} data-pago-pendiente={lectura.tipo === "no_disponible" ? "no-disponible" : "error"}>
        <p className={s.aviso} role="alert">
          {lectura.tipo === "error" && lectura.mensaje ? lectura.mensaje : t(lectura.tipo === "no_disponible" ? "shell.pagoPendiente.noDisponible" : "shell.pagoPendiente.errorLectura")}
        </p>
        <div className={s.fila}>{respaldo}</div>
      </section>
    );
  }

  if (lectura.datos.estado === "sin_pendiente") {
    return (
      <section className={s.panel} data-pago-pendiente="sin-pendiente">
        <p className={s.nota}>{t("shell.pagoPendiente.sinPendiente")}</p>
        <div className={s.fila}>
          {/* Nunca sin manera de pagar: el portal / checkout de siempre queda a la mano. */}
          {respaldo}
          <button type="button" className={s.boton} onClick={onRecargar}>
            {t("shell.pagoPendiente.recargar")}
          </button>
        </div>
      </section>
    );
  }

  const d = lectura.datos;
  const montoPendiente = formatoMonto(d.montoPendiente, d.moneda, idioma);
  // Un «subir de plan» a medias: no hay factura que pagar; se termina el cambio (POST subir) y «Pagar mi plan» no aplica.
  const cambio = d.cambioEnCurso ? d.opcionesSubir.find((o) => o.plan === d.cambioEnCurso!.plan) ?? null : null;
  const elegida = eleccion?.accion === "subir" ? d.opcionesSubir.find((o) => o.plan === eleccion.plan) ?? null : null;

  return (
    <section className={s.panel} data-pago-pendiente="pendiente">
      <h2 className={s.titulo}>{t("shell.pagoPendiente.titulo")}</h2>
      {d.cambioEnCurso && !cambio ? null : (
        <p className={s.monto}>
          {cambio ? (
            // Un cambio de plan a medias: lo que falta es el plan NUEVO, no la factura vieja ya anulada.
            t("shell.pagoPendiente.cambioEnCursoMonto", { plan: cambio.nombre, monto: formatoMonto(cambio.monto, d.moneda, idioma) })
          ) : (
            <>
              {t("shell.pagoPendiente.pendiente")} <strong>{montoPendiente}</strong>
            </>
          )}
        </p>
      )}

      <div className={s.fila}>
        {d.cambioEnCurso ? (
          cambio && (
            <button type="button" className={`${s.boton} ${s.principal}`} data-accion="terminar-cambio" onClick={() => onElegirPlan(cambio.plan)} disabled={cobrando}>
              <TrendingUp size={16} aria-hidden />
              {t("shell.pagoPendiente.terminarCambio", { plan: cambio.nombre })}
            </button>
          )
        ) : (
          <button type="button" className={`${s.boton} ${s.principal}`} data-accion="pagar-plan" onClick={onPagarPlan} disabled={cobrando}>
            <CreditCard size={16} aria-hidden />
            {t("shell.pagoPendiente.pagarPlan")}
          </button>
        )}
        {!d.cambioEnCurso && d.opcionesSubir.length > 0 && (
          <button type="button" className={s.boton} data-accion="subir-plan" onClick={onVerPlanes} disabled={cobrando} aria-expanded={eligiendoPlan}>
            <TrendingUp size={16} aria-hidden />
            {t("shell.pagoPendiente.subir")}
          </button>
        )}
      </div>

      {d.cambioEnCurso && !cambio && (
        <>
          <p className={s.aviso} role="alert">{t("shell.pagoPendiente.cambioNoDisponible")}</p>
          <div className={s.fila}>{respaldo}</div>
        </>
      )}

      {eligiendoPlan && !d.cambioEnCurso && d.opcionesSubir.length > 0 && (
        <>
          <p className={s.nota}>{t("shell.pagoPendiente.elegirPlan")}</p>
          <ul className={s.opciones}>
            {d.opcionesSubir.map((o) => (
              <li key={o.plan} className={s.opcion} data-plan={o.plan}>
                <span className={s.opcionTextos}>
                  {o.nombre}
                  <small>
                    {formatoMonto(o.monto, d.moneda, idioma)}
                    {o.ivaIncluido ? ` · ${t("shell.pagoPendiente.ivaIncluido")}` : ""}
                  </small>
                </span>
                <button type="button" className={s.boton} data-accion="elegir-plan" onClick={() => onElegirPlan(o.plan)} disabled={cobrando}>
                  {t("shell.pagoPendiente.elegir")}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {eleccion && (eleccion.accion === "pagar" || elegida) && (
        <div className={s.confirmar} role="alertdialog" aria-live="polite" data-confirmar={eleccion.accion}>
          <p>
            {eleccion.accion === "pagar"
              ? t("shell.pagoPendiente.vasAPagar", { monto: montoPendiente })
              : t("shell.pagoPendiente.vasAPagarPlan", { monto: formatoMonto(elegida!.monto, d.moneda, idioma), plan: elegida!.nombre })}
            {eleccion.accion === "subir" && elegida?.ivaIncluido ? ` (${t("shell.pagoPendiente.ivaIncluido")})` : ""}
          </p>
          <div className={s.fila}>
            <button type="button" className={`${s.boton} ${s.principal}`} data-accion="confirmar" onClick={onConfirmar} disabled={cobrando}>
              {cobrando ? <Loader2 size={16} className={s.girar} aria-hidden /> : <CreditCard size={16} aria-hidden />}
              {cobrando ? t("shell.pagoPendiente.pagando") : t("shell.pagoPendiente.confirmar")}
            </button>
            <button type="button" className={s.boton} data-accion="cancelar" onClick={onCancelar} disabled={cobrando}>
              {t("shell.pagoPendiente.cancelar")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function PagoPendiente({
  puedePagar,
  plan,
  suspendida,
  tarjetas,
}: {
  puedePagar: boolean;
  plan: string | null;
  /** true en /dashboard/suspended: al pagar se va a la pantalla que espera la reactivación. */
  suspendida: boolean;
  /**
   * Las tarjetas de plan de siempre (checkout / SPEI / OXXO). Se esconden mientras los dos botones aplican; si la
   * lectura da «sin pendiente», «no disponible» o error, se muestran: nunca se queda la clínica sin manera de pagar.
   */
  tarjetas?: ReactNode;
}) {
  const t = useT();
  const idioma = useLocale();
  const router = useRouter();
  const { pagar: portal, pagando: abriendoPortal } = usePagarAhora(plan);
  const [lectura, setLectura] = useState<LecturaPago | null>(null);
  const [eleccion, setEleccion] = useState<Eleccion | null>(null);
  const [eligiendoPlan, setEligiendoPlan] = useState(false);
  const [cobrando, setCobrando] = useState(false);

  useEffect(() => {
    // Quien no es dueño/administrador no consulta nada: la ruta tampoco le contestaría.
    if (!puedePagar) return;
    let vivo = true;
    void leerPagoPendiente().then((l) => {
      if (vivo) setLectura(l);
    });
    return () => {
      vivo = false;
    };
  }, [puedePagar]);

  async function confirmar() {
    if (!eleccion || cobrando) return;
    setCobrando(true);
    const orden: OrdenDeCobro = eleccion;
    const r = await cobrarPendiente(orden);
    if (r.tipo === "url") {
      window.location.href = r.url;
      return;
    }
    if (r.tipo === "pagado" || r.tipo === "ya_registrado") {
      // «Tu pago ya se registró» (otra pestaña ya lo pagó) es un éxito, no un error: mismo destino que un pago nuevo.
      toast.success(r.tipo === "ya_registrado" && r.mensaje ? r.mensaje : t("shell.pagoPendiente.pagoRecibido"));
      if (suspendida) router.push("/dashboard/suspended/success");
      else router.refresh();
      setCobrando(false);
      setEleccion(null);
      return;
    }
    if (r.tipo === "no_disponible") setLectura({ tipo: "no_disponible" });
    else toast.error(r.mensaje || t("shell.pagoPendiente.errorCobro"));
    setCobrando(false);
  }

  const sinDosBotones = lectura !== null && !(lectura.tipo === "listo" && lectura.datos.estado === "pendiente");
  return (
    <>
    <PagoPendienteVista
      lectura={lectura}
      puedePagar={puedePagar}
      eleccion={eleccion}
      eligiendoPlan={eligiendoPlan}
      cobrando={cobrando}
      idioma={idioma}
      respaldo={
        <button type="button" className={`${s.boton} ${s.principal}`} data-accion="portal" onClick={portal} disabled={abriendoPortal}>
          {abriendoPortal ? <Loader2 size={16} className={s.girar} aria-hidden /> : <CreditCard size={16} aria-hidden />}
          {abriendoPortal ? t("shell.pagoRechazado.abriendo") : t("shell.pagoRechazado.cta")}
        </button>
      }
      onPagarPlan={() => setEleccion({ accion: "pagar" })}
      onVerPlanes={() => {
        setEligiendoPlan((v) => !v);
        setEleccion(null);
      }}
      onElegirPlan={(p) => setEleccion({ accion: "subir", plan: p })}
      onConfirmar={confirmar}
      onCancelar={() => setEleccion(null)}
      onRecargar={() => router.refresh()}
    />
    {puedePagar && sinDosBotones && tarjetas}
    </>
  );
}
