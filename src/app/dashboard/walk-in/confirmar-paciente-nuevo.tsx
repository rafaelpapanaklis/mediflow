"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/i18n/i18n-provider";
import { RaizRediseno } from "@/components/dashboard/piezas-rediseno/raiz";
import { Boton, Campo, clases as s } from "@/components/dashboard/piezas-rediseno/piezas";
import { leerNombreYApellidos, MAX_LARGO, textosPacienteNuevo, type NombreYApellidos } from "@/lib/walk-in/nombre-del-paciente-nuevo";

/**
 * «Paciente nuevo»: antes de que «Iniciar» dé de alta al paciente de la fila, recepción confirma su nombre y
 * sus apellidos POR SEPARADO (ws1-t1). Llegan prellenados con la propuesta de `sugerirNombreYApellidos`.
 * Con el rediseño encendido se viste con las piezas del menú de dos niveles; apagado, como el modal de siempre.
 */
export function ConfirmarPacienteNuevo({
  inicial,
  rediseno,
  enviando,
  onConfirmar,
  onCancelar,
}: {
  inicial: NombreYApellidos;
  rediseno?: boolean;
  enviando?: boolean;
  onConfirmar: (n: NombreYApellidos) => void;
  onCancelar: () => void;
}) {
  let locale = "es";
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    locale = useLocale();
  } catch { /* fuera del proveedor de idioma: español */ }
  const tx = textosPacienteNuevo(locale);
  const [firstName, setFirstName] = useState(inicial.firstName);
  const [lastName, setLastName] = useState(inicial.lastName);
  const [error, setError] = useState(false);
  const primero = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // El foco cae en el campo que falta (casi siempre los apellidos ya vienen bien; si no, el nombre).
    primero.current?.focus();
    primero.current?.select();
  }, []);

  function confirmar(e?: FormEvent) {
    e?.preventDefault();
    const n = leerNombreYApellidos({ firstName, lastName });
    if (!n) { setError(true); return; }
    onConfirmar(n);
  }

  function alTeclear(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onCancelar(); }
  }

  const campos = (entrada: string) => (
    <>
      {rediseno ? (
        <>
          <Campo etiqueta={tx.nombre} htmlFor="wi-nuevo-nombre">
            <input id="wi-nuevo-nombre" ref={primero} className={entrada} value={firstName} maxLength={MAX_LARGO}
              aria-invalid={error && !firstName.trim()} autoComplete="off"
              onChange={(e) => { setFirstName(e.target.value); setError(false); }} />
          </Campo>
          <Campo etiqueta={tx.apellidos} htmlFor="wi-nuevo-apellidos">
            <input id="wi-nuevo-apellidos" className={entrada} value={lastName} maxLength={MAX_LARGO}
              aria-invalid={error && !lastName.trim()} autoComplete="off"
              onChange={(e) => { setLastName(e.target.value); setError(false); }} />
          </Campo>
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label className="text-sm" htmlFor="wi-nuevo-nombre">{tx.nombre}</Label>
            <input id="wi-nuevo-nombre" ref={primero} className={entrada} value={firstName} maxLength={MAX_LARGO}
              aria-invalid={error && !firstName.trim()} autoComplete="off"
              onChange={(e) => { setFirstName(e.target.value); setError(false); }} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm" htmlFor="wi-nuevo-apellidos">{tx.apellidos}</Label>
            <input id="wi-nuevo-apellidos" className={entrada} value={lastName} maxLength={MAX_LARGO}
              aria-invalid={error && !lastName.trim()} autoComplete="off"
              onChange={(e) => { setLastName(e.target.value); setError(false); }} />
          </div>
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{tx.faltan}</p>}
    </>
  );

  const fondo = "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50";

  if (rediseno) {
    return (
      <div className={fondo} onKeyDown={alTeclear}>
        <RaizRediseno>
          <form role="dialog" aria-modal="true" aria-labelledby="wi-nuevo-titulo" onSubmit={confirmar}
            className="mx-auto w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl space-y-4">
            <div>
              <h2 id="wi-nuevo-titulo" className={s.nombre}>{tx.titulo}</h2>
              <p className={s.detalle}>{tx.explicacion}</p>
            </div>
            {campos(s.campoEntrada)}
            <div className="flex flex-wrap justify-end gap-2">
              <Boton onClick={onCancelar}>{tx.cancelar}</Boton>
              <Boton type="submit" variante="principal" disabled={enviando} icono={<UserPlus size={16} strokeWidth={2} />}>{tx.iniciar}</Boton>
            </div>
          </form>
        </RaizRediseno>
      </div>
    );
  }

  return (
    <div className={fondo} onKeyDown={alTeclear}>
      <form role="dialog" aria-modal="true" aria-labelledby="wi-nuevo-titulo" onSubmit={confirmar}
        className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-border shrink-0">
          <h2 id="wi-nuevo-titulo" className="text-lg font-bold">{tx.titulo}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{tx.explicacion}</p>
        </div>
        <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto min-h-0">
          {campos("flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20")}
        </div>
        <div className="px-6 py-4 flex gap-3 shrink-0 border-t border-border">
          <Button type="button" variant="outline" onClick={onCancelar} className="flex-1 h-11 text-base">{tx.cancelar}</Button>
          <Button type="submit" disabled={enviando} className="flex-1 h-11 text-base">{tx.iniciar}</Button>
        </div>
      </form>
    </div>
  );
}
