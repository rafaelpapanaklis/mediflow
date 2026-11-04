export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { PostEditor } from "../post-editor";
import { requireAdminPage } from "@/lib/admin-page-guard";

export const metadata: Metadata = { title: "Nuevo artículo — Admin DaleControl" };

// Segmento ESTÁTICO bajo /admin/blog: gana sobre /admin/blog/[id], así que
// "nuevo" nunca se interpreta como el id de un artículo.
export default async function AdminBlogNewPage() {
  await requireAdminPage();
  return <PostEditor post={null} />;
}
