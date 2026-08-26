"use client";

// ═══════════════════════════════════════════════════════════════════════
// BÓVEDA — /inmobiliaria/contratos/boveda
//
// Todo lo FIRMADO, agrupado por el expediente al que pertenece: el del
// inmueble y el de la persona. Cada uno con su PDF descargable.
//
// 🔴 AQUÍ NO HAY BOTÓN DE BORRAR, Y ES EL PUNTO DE LA PANTALLA. Un
// contrato firmado es la prueba de lo que se pactó, y borrarlo es
// exactamente lo que habría que hacer para tapar un problema. Lo que sí
// hay es ARCHIVAR, que lo saca del tablero de trabajo y lo deja aquí. La
// regla no vive en esta pantalla: `deleteDraft` lleva `sealedAt IS NULL`
// en el WHERE, así que la base tampoco lo permitiría.
//
// Los ARCHIVADOS SÍ salen aquí. Es la diferencia entre archivar y
// desaparecer: el tablero no los quiere, el expediente sí.
//
// La agrupación se hace en el navegador sobre las filas que ya bajó el
// servidor. No es pereza: son las MISMAS filas de las dos vistas, y
// pedirlas dos veces agrupadas de distinta forma sería el doble de
// consultas para pintar exactamente lo mismo.
//
// i18n CONVENCIÓN B: el servidor ya recortó el sub-árbol; prefijo VACÍO.
// ═══════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Download } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { Card, EmptyState, Note, Pill, Tabs } from "../rentals/ui";
import "../rentals/rentals.css";
import "./contracts.css";
import { CONTRACT_STATUS_TONE, type ContractRowDTO } from "./shared";

type Eje = "inmueble" | "contacto";

interface Grupo {
  key: string;
  label: string;
  rows: ContractRowDTO[];
}

export function VaultClient({
  dict,
  contracts,
  contactNames,
  timeZone,
}: {
  dict: Dictionary;
  contracts: ContractRowDTO[];
  /** id → nombre. Lo resuelve el servidor: el DTO solo trae el id. */
  contactNames: Record<string, string>;
  timeZone: string;
}) {
  const t = makeRealtyT(dict);
  const [eje, setEje] = useState<Eje>("inmueble");

  function fechaCorta(iso: string | null): string {
    if (!iso) return t("comun.sinDato");
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return t("comun.sinDato");
    try {
      return new Intl.DateTimeFormat("es-MX", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone,
      }).format(d);
    } catch {
      return iso.slice(0, 10);
    }
  }

  // 🔴 `t` NO va en las dependencias. makeRealtyT devuelve una FUNCIÓN
  // NUEVA en cada render, así que un hook que dependa de ella se recalcula
  // siempre y el memo no memoriza nada. Se sacan los dos textos ANTES: son
  // strings, y un string igual es igual entre renders.
  const sinInmueble = t("boveda.sinInmueble");
  const sinContacto = t("boveda.sinContacto");

  const grupos = useMemo<Grupo[]>(() => {
    const porClave = new Map<string, Grupo>();
    for (const c of contracts) {
      const id = eje === "inmueble" ? c.propertyId : c.contactId;
      const key = id ?? "__sin__";
      const label =
        eje === "inmueble"
          ? c.propertyTitle || sinInmueble
          : (id ? contactNames[id] : null) || sinContacto;
      const grupo = porClave.get(key);
      if (grupo) grupo.rows.push(c);
      else porClave.set(key, { key, label, rows: [c] });
    }
    // "Sin ligar" hasta el final: es el cajón de sastre, no lo primero que
    // alguien quiere ver al abrir un expediente.
    return Array.from(porClave.values()).sort((a, b) => {
      if (a.key === "__sin__") return 1;
      if (b.key === "__sin__") return -1;
      return a.label.localeCompare(b.label, "es");
    });
  }, [contracts, eje, contactNames, sinInmueble, sinContacto]);

  return (
    <div className="ctr">
      <header className="rnt-head">
        <div className="rnt-head__row">
          <div style={{ minWidth: 0 }}>
            <h1 className="rnt-head__title">{t("boveda.title")}</h1>
            <p className="rnt-head__sub">{t("boveda.subtitle")}</p>
          </div>
          <div className="rnt-head__actions">
            <Link className="rnt-btn" href="/inmobiliaria/contratos">
              <ArrowLeft size={14} />
              {t("detalle.volver")}
            </Link>
          </div>
        </div>
      </header>

      <Note tone="info">{t("boveda.nota")}</Note>

      <div className="rnt-toolbar">
        <div className="rnt-toolbar__grow">
          <Tabs<Eje>
            label={t("boveda.title")}
            value={eje}
            onChange={setEje}
            tabs={[
              { key: "inmueble" as Eje, label: t("boveda.porInmueble") },
              { key: "contacto" as Eje, label: t("boveda.porContacto") },
            ]}
          />
        </div>
      </div>

      {grupos.length === 0 ? (
        <EmptyState title={t("boveda.vacio")} body={t("boveda.subtitle")} />
      ) : (
        grupos.map((g) => (
          <Card
            key={g.key}
            title={g.label}
            sub={t("boveda.cuantos", { n: String(g.rows.length) })}
            flush
          >
            <div className="rnt-tablewrap">
              <table className="rnt-table">
                <tbody>
                  {g.rows.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.folio}</strong>
                        <div className="rnt-card__sub">{t(`kinds.${c.kind}`)}</div>
                      </td>
                      <td>
                        <div>{c.title}</div>
                        <div className="rnt-card__sub">
                          {t("boveda.firmadoEl")} {fechaCorta(c.signedAt)}
                        </div>
                      </td>
                      <td>
                        <Pill tone={CONTRACT_STATUS_TONE[c.status]} dot>
                          {t(`status.${c.status}`)}
                        </Pill>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div
                          style={{
                            display: "inline-flex",
                            gap: 6,
                            flexWrap: "wrap",
                            justifyContent: "flex-end",
                          }}
                        >
                          <a
                            className="rnt-btn rnt-btn--sm"
                            href={`/api/realty/contracts/${c.id}/pdf?descargar=1`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Download size={13} />
                            {t("boveda.descargar")}
                          </a>
                          <Link
                            className="rnt-btn rnt-btn--sm"
                            href={`/inmobiliaria/contratos/${c.id}`}
                          >
                            {t("boveda.abrir")}
                            <ArrowRight size={13} />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
