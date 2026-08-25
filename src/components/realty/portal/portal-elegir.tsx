"use client";

import { useMemo, useState } from "react";
import { portalT } from "@/components/realty/portal/portal-i18n";

/* ═══════════════════════════════════════════════════════════════════════
   Las dos caras del portal.

   El mismo teléfono puede ser INQUILINO de una inmobiliaria y PROPIETARIO
   de otra (o de la misma: quien renta una casa y tiene otra en renta). Son
   dos experiencias distintas y no se mezclan, así que después de validar
   el código se le pregunta con cuál entrar.

   Con UNA sola cara esta pantalla no se pinta: el servidor manda directo a
   donde toca. Se ve solo cuando de verdad hay que elegir.

   La elección NO otorga permisos por sí sola: el servidor comprueba que
   esa cara siga siendo suya antes de fijarla, y la vuelve a comprobar en
   cada petición.
   ═══════════════════════════════════════════════════════════════════════ */

export interface PortalChoice {
  key: string;
  role: "INQUILINO" | "PROPIETARIO";
  accountName: string;
  accountLogoUrl: string | null;
  count: number;
}

export function PortalElegir({ opciones }: { opciones: PortalChoice[] }) {
  const t = useMemo(() => portalT(), []);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const elegir = async (key: string) => {
    setError(null);
    setOcupado(key);
    try {
      const res = await fetch("/api/realty/portal/auth/elegir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; next?: string; error?: string }
        | null;
      if (!res.ok || !data?.ok || !data.next) {
        setError(data?.error ?? t("elegir.error"));
        return;
      }
      window.location.href = data.next;
    } catch {
      setError(t("login.sinRed"));
    } finally {
      setOcupado(null);
    }
  };

  return (
    <section className="dcr-card">
      <h1 className="dcr-h1" style={{ marginTop: 0 }}>
        {t("elegir.title")}
      </h1>
      {/* Con una sola opción el texto de "tu número está en más de un lugar"
          sería mentira. Pasa cuando la cookie quedó a medias y entretanto se
          le acabó una de sus dos caras. */}
      <p className="dcr-sub">{t(opciones.length === 1 ? "elegir.subUna" : "elegir.sub")}</p>

      {error ? (
        <p className="dcr-alert dcr-alert--error" role="alert">
          {error}
        </p>
      ) : null}

      {opciones.map((o) => (
        <button
          key={o.key}
          type="button"
          className="dcr-choice"
          onClick={() => void elegir(o.key)}
          disabled={ocupado !== null}
        >
          <span className="dcr-choice__mark" aria-hidden="true">
            {o.accountLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={o.accountLogoUrl} alt="" />
            ) : (
              o.accountName.charAt(0).toUpperCase()
            )}
          </span>
          <span className="dcr-choice__body">
            <span className="dcr-choice__name">{o.accountName}</span>
            <span className="dcr-choice__role">
              {t(`elegir.${o.role}`)} ·{" "}
              {o.role === "INQUILINO"
                ? t("elegir.contratos", { count: o.count })
                : t("elegir.inmuebles", { count: o.count })}
            </span>
          </span>
          {ocupado === o.key ? <span className="dcr-spin" aria-hidden="true" /> : null}
        </button>
      ))}
    </section>
  );
}
