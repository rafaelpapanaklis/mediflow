"use client";
// Equipo → ficha → «Caja»: la casilla «Puede usar Caja», si el miembro ya creó
// su PIN (solo el estado, nunca el PIN) y, para el dueño, «Restablecer PIN de
// Caja». Presentacional: la confirmación y el POST viven en TeamClient, igual
// que «Restablecer contraseña».
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTextosEquipo } from "./textos-equipo";
import { estadoPinDeCaja, type MotivoCajaFija } from "./caja-miembro";

export function AccesoCaja({
  marcada, onCambiar, fija, tieneCajaPin, onRestablecerPin, deshabilitado, acento, bordeSuave,
}: {
  marcada: boolean;
  onCambiar: (v: boolean) => void;
  /** Por qué no se puede mover; `null` = se puede. */
  fija: MotivoCajaFija;
  tieneCajaPin: boolean;
  /** Solo para el dueño (SUPER_ADMIN). Sin él no hay botón. */
  onRestablecerPin?: () => void;
  deshabilitado?: boolean;
  acento: string;
  bordeSuave: string;
}) {
  const x = useTextosEquipo();
  const estado = estadoPinDeCaja(tieneCajaPin);
  const ayuda = fija === "super-admin" ? x.cajaSiempreSuper : fija === "yo" ? x.cajaYoNoCambia : x.cajaPuedeUsarDesc;
  return (
    <div className="space-y-2" data-acceso-caja>
      <label
        className={`flex items-start gap-3 ${fija ? "cursor-not-allowed" : "cursor-pointer"}`}
        style={{ padding: "10px 12px", borderRadius: "var(--radius)", border: `1px solid ${bordeSuave}`, opacity: fija ? 0.85 : 1 }}
      >
        <input
          type="checkbox"
          className="mt-0.5"
          data-puede-usar-caja
          checked={fija === "super-admin" ? true : marcada}
          disabled={fija !== null}
          onChange={e => onCambiar(e.target.checked)}
          style={{ width: 16, height: 16, accentColor: acento }}
        />
        <span className="flex flex-col">
          <span className="text-sm font-semibold">{x.cajaPuedeUsar}</span>
          <span className="text-xs text-muted-foreground leading-tight">{ayuda}</span>
        </span>
      </label>

      <div className="flex items-center gap-2 text-xs" data-pin-caja-estado={estado} style={{ padding: "0 2px" }}>
        <KeyRound size={14} strokeWidth={1.75} aria-hidden style={{ color: "var(--text-3)" }} />
        <span className="text-muted-foreground">
          {x.cajaPinEtiqueta}: <strong style={{ color: "var(--text-1)", fontWeight: 600 }}>{estado === "creado" ? x.cajaPinCreado : x.cajaPinSinCrear}</strong>
        </span>
      </div>
      {estado === "sin-crear" && (
        <p className="text-xs text-muted-foreground" style={{ margin: 0 }}>{x.cajaPinSinCrearHint}</p>
      )}

      {onRestablecerPin && (
        <>
          <p className="text-xs text-muted-foreground" style={{ margin: "4px 0 0" }}>{x.restablecerPinHint}</p>
          <Button type="button" variant="outline" onClick={onRestablecerPin} disabled={deshabilitado}
            className="w-full h-11 text-base" data-restablecer-pin-caja>
            {x.restablecerPinBtn}
          </Button>
        </>
      )}
    </div>
  );
}
