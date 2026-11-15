"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { KeyRound } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { useBarberT } from "@/components/barber/cash/use-barber-t";
import { Btn, ErrorText, Field, TextInput } from "@/components/barber/team/admin-ui";
import { BARBER_PASSWORD_API, problemaContrasenaNueva } from "@/lib/barber/contrasena";
import { Card } from "./configuracion-screen";
import s from "./configuracion.module.css";

/** Los códigos que contesta /api/barber/auth/contrasena (más el 429 del freno). */
const CODIGOS = new Set([
  "sin_sesion",
  "debil",
  "larga",
  "no_coinciden",
  "falta_actual",
  "actual_incorrecta",
  "igual",
  "filtrada",
  "rechazada",
  "demasiados",
  "error",
]);

/**
 * «Tu contraseña» en Configuración: cualquier persona del panel, sea cual sea
 * su rol, cambia SU contraseña. Pide la actual (una sesión abierta en un
 * celular prestado no basta) y no cierra la sesión.
 *
 * El servidor contesta un `code` y aquí se traduce con el diccionario del
 * vertical (es/en): su `error` va en español y no se enseña tal cual.
 */
export function MiContrasenaCard({ dict }: { dict: Dictionary }) {
  const t = useBarberT(dict);
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problema = nueva ? problemaContrasenaNueva(nueva) : null;
  const noCoinciden = repetida.length > 0 && repetida !== nueva;
  const listo = !!actual && !!nueva && !problema && nueva === repetida;

  async function guardar() {
    if (!listo || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(BARBER_PASSWORD_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: actual, password: nueva, confirmacion: repetida }),
        cache: "no-store",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { code?: string } | null;
        const code = res.status === 429 ? "demasiados" : data?.code && CODIGOS.has(data.code) ? data.code : "error";
        setError(t(`configuracion.password.errors.${code}`));
        return;
      }
      setActual("");
      setNueva("");
      setRepetida("");
      toast.success(t("configuracion.password.saved"));
    } catch {
      setError(t("configuracion.password.errors.error"));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Card
      icon={<KeyRound size={18} />}
      title={t("configuracion.password.title")}
      sub={t("configuracion.password.sub")}
      foot={
        <>
          <ErrorText>{error}</ErrorText>
          <Btn variant="primary" onClick={guardar} disabled={!listo || guardando} data-barber-contrasena="guardar">
            {guardando ? t("common.saving") : t("configuracion.password.save")}
          </Btn>
        </>
      }
    >
      <form
        className={s.formGrid}
        onSubmit={(e) => {
          e.preventDefault();
          void guardar();
        }}
      >
        <div className={s.full}>
          <Field label={t("configuracion.password.current")}>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="current-password"
                value={actual}
                onChange={(e) => setActual(e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className={s.full}>
          <Field
            label={t("configuracion.password.new")}
            hint={problema ? t(`configuracion.password.errors.${problema}`) : t("configuracion.password.newHint")}
          >
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="new-password"
                value={nueva}
                aria-invalid={problema ? true : undefined}
                onChange={(e) => setNueva(e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className={s.full}>
          <Field
            label={t("configuracion.password.confirm")}
            hint={noCoinciden ? t("configuracion.password.errors.no_coinciden") : undefined}
          >
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="new-password"
                value={repetida}
                aria-invalid={noCoinciden ? true : undefined}
                onChange={(e) => setRepetida(e.target.value)}
              />
            )}
          </Field>
        </div>
        {/* Enter dentro de cualquier campo guarda; el botón visible vive en el pie. */}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Card>
  );
}

/**
 * Para quien NO tiene permiso de editar la barbería: la pantalla de
 * Configuración se queda solo con lo suyo (su contraseña) en vez de «sin
 * acceso».
 */
export function MiCuentaScreen({ dict }: { dict: Dictionary }) {
  const t = useBarberT(dict);
  return (
    <div className={s.page}>
      <header className={s.header}>
        <h1 className={s.title}>{t("configuracion.password.accountTitle")}</h1>
        <p className={s.subtitle}>{t("configuracion.password.accountSub")}</p>
      </header>
      <div className={s.gridWrap}>
        <div className={s.grid}>
          <MiContrasenaCard dict={dict} />
        </div>
      </div>
    </div>
  );
}
