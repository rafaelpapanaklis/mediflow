// Nombre de archivo de los PDF de ortodoncia (ws1-t4): legible y seguro para
// la cabecera Content-Disposition — sin acentos, sin comillas, sin espacios.
// «convenio-de-pago-diego-hernandez-CONV-F-0012.pdf» en vez de «…-cm1x9….pdf».

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function nombreDeArchivoPdf(documento: string, paciente: string, sufijo?: string | null): string {
  const partes = [slug(documento).toLowerCase(), slug(paciente).toLowerCase(), sufijo ? slug(sufijo) : ""].filter(Boolean);
  return `${partes.join("-") || "documento"}.pdf`;
}
