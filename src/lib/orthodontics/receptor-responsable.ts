// Ortodoncia — ws1-t10, punto 9: el CFDI de un caso se precarga con los datos
// del RESPONSABLE DE PAGO (el tutor) cuando lo hay, no con los del niño. Puro,
// sin Prisma ni React: lo usan el servidor, el formulario y las pruebas.

export interface DatosFiscales {
  rfc: string;
  nombre: string;
  regimen: string;
  cp: string;
}

export interface ResponsableParaCfdi {
  guardianId: string;
  /** Nombre completo del tutor, como está en el alta. */
  nombreCompleto: string;
  /** «madre», «padre»… ya legible (o vacío). */
  parentesco: string;
  email: string | null;
  /** Los fiscales guardados del tutor (RFC vacío = todavía no se capturaron). */
  fiscales: DatosFiscales;
}

export const REGIMEN_POR_DEFECTO = "612";

/** RFC en mayúsculas, sin espacios; CP de cinco dígitos; el resto, recortado. */
export function normalizarFiscales(d: Partial<DatosFiscales>): DatosFiscales {
  return {
    rfc: String(d.rfc ?? "").replace(/\s+/g, "").toUpperCase().slice(0, 13),
    nombre: String(d.nombre ?? "").trim(),
    regimen: String(d.regimen ?? "").trim().slice(0, 10),
    cp: String(d.cp ?? "").replace(/\D+/g, "").slice(0, 5),
  };
}

/**
 * Los datos con los que arranca el formulario del CFDI. Con responsable: SUS
 * fiscales; si aún no tiene RFC, al menos su nombre (nunca el del niño); y los
 * del paciente NO se mezclan (un RFC del niño con el nombre del tutor sería un
 * comprobante inconsistente). Sin responsable: los del paciente, como siempre.
 */
export function receptorInicial(
  paciente: Partial<DatosFiscales> | null | undefined,
  responsable: ResponsableParaCfdi | null | undefined,
): { datos: DatosFiscales; origen: "responsable" | "paciente" } {
  if (responsable) {
    const f = normalizarFiscales(responsable.fiscales);
    return {
      origen: "responsable",
      datos: {
        rfc: f.rfc,
        nombre: f.nombre || responsable.nombreCompleto,
        regimen: f.regimen || REGIMEN_POR_DEFECTO,
        cp: f.cp,
      },
    };
  }
  const p = normalizarFiscales(paciente ?? {});
  return { origen: "paciente", datos: { ...p, regimen: p.regimen || REGIMEN_POR_DEFECTO } };
}
