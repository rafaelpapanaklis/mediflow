"use client";
// Contratar Ortodoncia — la tarjeta del precio (ws1-t3). Selector Mensual /
// Anual y botón «Contratar». Los precios llegan ya leídos de la base (tabla
// `modules`) por la página; aquí no hay ningún número escrito a mano: el
// ahorro y el «equivale a» salen de comparar esos dos precios
// (`resumirPrecios`).
//
// El botón llama a POST /api/marketplace/module-checkout (ws1-t2) con el ciclo
// elegido y manda a la clínica a Stripe. Quien no es dueño ni administrador no
// ve el botón; el endpoint, además, se lo niega (403).

import { useId, useState } from "react";
import { CreditCard, Lock, LockOpen, RefreshCw, Users } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import {
  pesos,
  type CicloCobro,
  type ResumenDePrecios,
} from "@/lib/orthodontics/contratar";
import { ORTHODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import s from "./contratar.module.css";

const NOMBRE_CICLO: Record<CicloCobro, string> = { monthly: "Mensual", annual: "Anual" };
const UNIDAD: Record<CicloCobro, string> = { monthly: "al mes", annual: "al año" };

export function TarjetaPrecio({
  precios,
  cicloInicial,
  puedeContratar,
}: {
  precios: ResumenDePrecios;
  /** null = no hay ningún precio configurado. */
  cicloInicial: CicloCobro | null;
  puedeContratar: boolean;
}) {
  const grupo = useId();
  const [ciclo, setCiclo] = useState<CicloCobro | null>(cicloInicial);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ciclo === null) {
    return (
      <section className={s.precio} aria-label="Precio">
        <h2 className={s.precioTitulo}>Contratar Ortodoncia</h2>
        <p className={s.error} role="alert">
          Este módulo todavía no tiene precio configurado. Escríbenos desde Soporte y lo activamos contigo.
        </p>
      </section>
    );
  }

  const importe = ciclo === "annual" ? precios.anualMxn : precios.mensualMxn;
  const hayAhorro = precios.ahorroAnualMxn > 0;

  async function contratar() {
    if (enviando || ciclo === null) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch("/api/marketplace/module-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moduleKey: ORTHODONTICS_MODULE_KEY,
          billing: ciclo,
          method: "card",
          origin: "contratar",
        }),
      });
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !data?.url) {
        setError(data?.error ?? "No se pudo abrir el pago. Inténtalo otra vez en un momento.");
        setEnviando(false);
        return;
      }
      // Sin soltar `enviando`: la página se va a Stripe y el botón no debe
      // poder pulsarse dos veces mientras tanto.
      window.location.assign(data.url);
    } catch {
      setError("No se pudo abrir el pago. Revisa tu conexión e inténtalo otra vez.");
      setEnviando(false);
    }
  }

  return (
    <section className={s.precio} aria-label="Precio">
      <h2 className={s.precioTitulo}>Contratar Ortodoncia</h2>

      {precios.ciclos.length > 1 && (
        <fieldset className={s.ciclos}>
          <legend className="sr-only">Cada cuánto se paga</legend>
          {precios.ciclos.map((c) => (
            <label key={c} className={s.ciclo}>
              <input
                type="radio"
                name={grupo}
                value={c}
                checked={ciclo === c}
                onChange={() => {
                  setCiclo(c);
                  setError(null);
                }}
                disabled={enviando}
                className={s.cicloRadio}
              />
              <span className={s.cicloCara}>
                {NOMBRE_CICLO[c]}
                {c === "annual" && hayAhorro && <span className={s.ahorro}>Ahorras {precios.ahorroPct}%</span>}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <div aria-live="polite">
        <div className={s.importe}>
          <span className={s.importeCifra}>{importe !== null ? pesos(importe) : "—"}</span>
          <span className={s.importeUnidad}>{UNIDAD[ciclo]}</span>
          <span className={s.importeIva}>+ IVA</span>
        </div>
        <p className={s.detalle}>
          {ciclo === "annual" && precios.anualPorMesMxn !== null && (
            <>
              Equivale a <strong>{pesos(precios.anualPorMesMxn)} al mes</strong>.
              {hayAhorro && (
                <>
                  {" "}
                  Ahorras <strong>{pesos(precios.ahorroAnualMxn)}</strong> frente a pagar doce meses.
                </>
              )}
            </>
          )}
          {ciclo === "monthly" &&
            (hayAhorro ? (
              <>
                Con el pago anual ahorras <strong>{pesos(precios.ahorroAnualMxn)}</strong> al año ({precios.ahorroPct}%).
              </>
            ) : (
              <>Un solo precio para toda la clínica.</>
            ))}
        </p>
      </div>

      {puedeContratar ? (
        <>
          <ButtonNew
            type="button"
            variant="primary"
            className={s.boton}
            icon={<LockOpen size={16} strokeWidth={1.9} aria-hidden />}
            onClick={contratar}
            disabled={enviando}
          >
            {enviando ? "Abriendo el pago…" : `Contratar · pago ${NOMBRE_CICLO[ciclo].toLowerCase()}`}
          </ButtonNew>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <div className={s.sinPermiso} role="note">
          <Lock size={16} strokeWidth={1.9} aria-hidden />
          <div>
            <strong>Pídeselo al administrador de tu clínica</strong>
            Solo el dueño o un administrador puede contratar módulos. Aquí puedes ver el precio y lo que incluye para
            enseñárselo.
          </div>
        </div>
      )}

      <ul className={s.letraChica}>
        <li>
          <CreditCard size={14} strokeWidth={1.9} aria-hidden />
          Pago con tarjeta. El precio no incluye IVA; el total con IVA lo ves antes de pagar.
        </li>
        <li>
          <RefreshCw size={14} strokeWidth={1.9} aria-hidden />
          Se renueva solo cada {ciclo === "annual" ? "año" : "mes"}.
        </li>
        <li>
          <Users size={14} strokeWidth={1.9} aria-hidden />
          Es para toda la clínica, no por usuario.
        </li>
      </ul>
    </section>
  );
}
