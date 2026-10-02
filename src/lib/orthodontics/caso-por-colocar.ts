// ws1-t8 (decisión 13 de Rafael, 2-oct): firmar un control en un caso «Por colocar» (sin aparatología
// registrada) AVISA con dos botones —«Registrar la colocación primero» / «Firmar el control de todos modos»—
// y NO bloquea: el servidor firma igual que siempre.

/** «Por colocar» = el caso está planeado y la colocación no se ha registrado (`OrthoTreatmentStatus.PLANNED`). */
export function esCasoPorColocar(status: string | null | undefined): boolean {
  return status === "PLANNED";
}

/** Qué hace «Firmar control»: firmar ya, o preguntar primero (una sola vez por hoja abierta). */
export function pasoAlFirmar(p: { casoPorColocar?: boolean | null; firmarIgualAceptado: boolean }): "firmar" | "preguntar" {
  return p.casoPorColocar && !p.firmarIgualAceptado ? "preguntar" : "firmar";
}
