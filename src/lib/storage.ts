// Convierte una signed URL heredada (`/storage/v1/object/sign/...?token=...`)
// a la public URL equivalente. El bucket "patient-files" es público, por lo que
// las signed URLs con expiración (legacy) quedaban rotas al vencer.
export function toPublicFileUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (!url.includes("/storage/v1/object/sign/")) return url;
  return url
    .replace("/storage/v1/object/sign/", "/storage/v1/object/public/")
    .split("?")[0];
}
