import { signIn } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

async function sendMagicLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    redirect("/sign-in?error=invalid");
  }

  const ip = (await headers()).get("x-forwarded-for") ?? "unknown";
  const allowed = await checkRateLimit("signIn", `signin:${ip}:${email}`);
  if (!allowed) {
    redirect("/sign-in?error=rate_limited");
  }

  await signIn("resend", { email, redirectTo: "/discover" });
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20">
      <h1 className="text-2xl font-semibold">Sign in to YuKon3t</h1>
      <p className="mt-2 text-center text-sm text-foreground-soft">
        No passwords to leak or reuse. We&apos;ll email you a secure sign-in
        link.
      </p>

      {error === "rate_limited" && (
        <p className="mt-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          Too many attempts. Please wait a few minutes and try again.
        </p>
      )}
      {error === "invalid" && (
        <p className="mt-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          Enter a valid email address.
        </p>
      )}

      <form action={sendMagicLink} className="mt-6 w-full space-y-3">
        <input
          type="email"
          name="email"
          required
          placeholder="you@example.com"
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        >
          Send sign-in link
        </button>
      </form>
    </div>
  );
}
