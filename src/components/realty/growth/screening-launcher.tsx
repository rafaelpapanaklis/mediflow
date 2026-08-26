"use client";

// ═══════════════════════════════════════════════════════════════════════
// ⭐ EL BOTÓN "INVESTIGAR A ESTE PROSPECTO" — para enchufar donde NACE.
//
// La investigación de inquilino no empieza en una lista: empieza en la
// ficha del CONTACTO o en el CONTRATO EN BORRADOR, que es donde alguien
// mira a un candidato y decide averiguar si paga. Esas dos pantallas son de
// otras terminales y esta no las toca.
//
// ASÍ SE MONTA (tres líneas, en la pantalla que sea):
//
//   import { RealtyScreeningLauncher } from
//     "@/components/realty/growth/screening-launcher";
//   import growthDict from "@/i18n/dictionaries/realty/growth.json";
//
//   <RealtyScreeningLauncher
//     dict={(growthDict as any)[locale]}   // "es" | "en"
//     timeZone={ctx.account.timezone}
//     accountName={ctx.account.name}
//     contacto={{ id, name, phone, email }}
//     leaseId={leaseId ?? null}            // si sale del contrato
//     propertyId={propertyId ?? null}
//   />
//
// Requisitos del que lo monta: NINGUNO más. El componente trae su propio
// estado, su propio modal y sus propias llamadas; el permiso
// (`leases.manage`) y la feature (`rentals`) los vuelve a exigir la ruta,
// así que montarlo en una pantalla que ve alguien sin permiso no abre nada
// — solo enseña el error del servidor.
//
// El botón se pinta cerrado y no consulta nada hasta que lo abren: montarlo
// en una ficha que casi nadie usa no cuesta una consulta por render.
// ═══════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { FileSearch } from "lucide-react";
import { makeRealtyT } from "@/lib/realty/i18n";
import type { Dictionary } from "@/i18n/t";
import { RealtyScreeningPanel } from "./screening-panel";
import { Boton, Modal } from "./growth-ui";

export function RealtyScreeningLauncher({
  dict,
  timeZone,
  accountName,
  contacto,
  leaseId = null,
  propertyId = null,
  pequeno = true,
}: {
  dict: Dictionary;
  timeZone: string;
  accountName: string;
  contacto: { id: string; name: string; phone: string | null; email: string | null };
  leaseId?: string | null;
  propertyId?: string | null;
  pequeno?: boolean;
}) {
  // Convención B: sub-árbol ya recortado → prefijo VACÍO.
  const t = makeRealtyT(dict);
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <Boton pequeno={pequeno} onClick={() => setAbierto(true)}>
        <FileSearch size={pequeno ? 12 : 14} aria-hidden="true" />
        {t("screening.investigarA")}
      </Boton>

      {/* El panel entero dentro del modal: la ficha del contacto no tiene por
          qué aprenderse el flujo de cuatro pasos, solo abrir la puerta. */}
      <Modal
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        titulo={t("screening.title")}
        cerrarLabel={t("comun.cerrar")}
        ancho={780}
      >
        <RealtyScreeningPanel
          dict={dict}
          timeZone={timeZone}
          accountName={accountName}
          contactoFijo={contacto}
          leaseId={leaseId}
          propertyId={propertyId}
        />
      </Modal>
    </>
  );
}
