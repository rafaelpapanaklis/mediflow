export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { PostEditor } from "../post-editor";

export const metadata: Metadata = { title: "Nuevo artículo — Admin DaleControl" };

// Segmento ESTÁTICO bajo /admin/blog: gana sobre /admin/blog/[id], así que
// "nuevo" nunca se interpreta como el id de un artículo.
export default function AdminBlogNewPage() {
  return <PostEditor post={null} />;
}
