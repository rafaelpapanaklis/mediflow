"use client";

/**
 * «Colorear las citas por: Doctor / Procedimiento» — el ajuste de la clínica
 * en Configuración → Horarios y bloqueos, junto a los bloqueos (WS1-T5).
 *
 * Solo existe para las clínicas con la bandera `agenda-flexible`: si el GET
 * dice que está apagada, o falla, no pinta NADA (ni un hueco). Quien no puede
 * editar la configuración lo ve, pero con las opciones apagadas y una nota.
 * El endpoint está en `app/api/agenda/color-citas/route.ts`.
 */

import { useEffect, useState } from "react";
import { Loader2, Palette } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { mensajeDeError } from "@/components/dashboard/bloqueos/tipos";
import s from "@/components/dashboard/bloqueos/bloqueos.module.css";
import p from "./ajuste-color-citas.module.css";

type Modo = "doctor" | "procedimiento";

const RUTA = "/api/agenda/color-citas";

function parse(raw: unknown): { encendida: boolean; modoColor: Modo } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.encendida !== "boolean") return null;
  return { encendida: r.encendida, modoColor: r.modoColor === "procedimiento" ? "procedimiento" : "doctor" };
}

export function AjusteColorCitas({ puedeEditar }: { puedeEditar: boolean }) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [modo, setModo] = useState<Modo>("doctor");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch(RUTA, { credentials: "include" });
        const datos = await res.json().catch(() => null);
        if (!vivo) return;
        const ajuste = res.ok ? parse(datos) : null;
        if (!ajuste || !ajuste.encendida) return;
        setModo(ajuste.modoColor);
        setVisible(true);
      } catch {
        // Sin lectura no se enseña nada: no se finge un ajuste.
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  async function cambiar(nuevo: Modo) {
    if (guardando || !puedeEditar || nuevo === modo) return;
    const antes = modo;
    setModo(nuevo);
    setGuardando(true);
    try {
      const res = await fetch(RUTA, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ modo: nuevo }),
      });
      const datos = await res.json().catch(() => null);
      if (!res.ok) {
        setModo(antes);
        toast.error(mensajeDeError(datos, t("settings.agendaColor.guardarError")));
        return;
      }
      const vuelta = parse(datos);
      if (vuelta) setModo(vuelta.modoColor);
      toast.success(t("settings.agendaColor.guardadoToast"));
    } catch {
      setModo(antes);
      toast.error(t("settings.agendaColor.guardarError"));
    } finally {
      setGuardando(false);
    }
  }

  if (!visible) return null;

  const bloqueado = !puedeEditar || guardando;

  return (
    <div className={s.tarjeta}>
      <div className={s.tarjetaCabecera}>
        <span className={`${s.iconoCaja} ${s.iconoCajaMarca}`} aria-hidden>
          <Palette size={17} strokeWidth={2} />
        </span>
        <div className={s.tarjetaTextos}>
          <h3 className={s.tarjetaTitulo}>{t("settings.agendaColor.titulo")}</h3>
        </div>
        {guardando && <Loader2 size={16} className={p.girando} aria-label={t("common.saving")} />}
      </div>

      <div className={s.tarjetaCuerpo}>
        <fieldset className={p.opciones} disabled={bloqueado} aria-busy={guardando}>
          <legend className={p.titulo} style={{ marginBottom: 8 }}>
            {t("settings.agendaColor.pregunta")}
          </legend>

          <label className={`${p.opcion} ${modo === "doctor" ? p.opcionElegida : ""}`}>
            <input
              type="radio"
              name="agenda-color-citas"
              className={p.radio}
              checked={modo === "doctor"}
              onChange={() => cambiar("doctor")}
            />
            <span className={p.textos}>
              <span className={p.titulo}>{t("settings.agendaColor.doctor")}</span>
              <span className={p.ayuda}>{t("settings.agendaColor.doctorAyuda")}</span>
            </span>
          </label>

          <label className={`${p.opcion} ${modo === "procedimiento" ? p.opcionElegida : ""}`}>
            <input
              type="radio"
              name="agenda-color-citas"
              className={p.radio}
              checked={modo === "procedimiento"}
              onChange={() => cambiar("procedimiento")}
            />
            <span className={p.textos}>
              <span className={p.titulo}>{t("settings.agendaColor.procedimiento")}</span>
              <span className={p.ayuda}>{t("settings.agendaColor.procedimientoAyuda")}</span>
            </span>
          </label>
        </fieldset>

        {!puedeEditar && <p className={p.nota}>{t("settings.agendaColor.soloLectura")}</p>}
      </div>
    </div>
  );
}
