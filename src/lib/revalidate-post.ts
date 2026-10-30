import { revalidatePath } from "next/cache";

/** Revalidates every page that shows this post's counts: the post itself, its author's profile, Home and its Circle. */
export function revalidatePostViews(post: { id: string; authorId: string; circle: { slug: string } | null }) {
  revalidatePath(`/post/${post.id}`);
  revalidatePath(`/u/${post.authorId}`);
  revalidatePath("/home");
  if (post.circle) {
    revalidatePath(`/circles/${post.circle.slug}`);
  }
}
