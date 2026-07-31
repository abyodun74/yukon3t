import Link from "next/link";
import { signUpWithPassword } from "@/app/actions/password-auth";
import { PasswordInput } from "@/components/password-input";

function errorMessage(error: string | undefined) {
  switch (error) {
    case "underage":
      return "You must be at least 13 years old to use YuKon3t.";
    case "email_taken":
      return "An account with that email already exists.";
    case "username_taken":
      return "That username is taken — try another.";
    case "rate_limited":
      return "Too many attempts. Please wait a bit and try again.";
    case "invalid":
      return "Please check your inputs — username must be 3-20 letters, numbers, or underscores, and password at least 8 characters.";
    default:
      return null;
  }
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = errorMessage(error);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <h1 className="text-2xl font-semibold">Create an account</h1>
      <p className="mt-2 text-center text-sm text-foreground-soft">
        Sign up with a username and password. We&apos;ll email you a link to
        confirm your address before you can sign in.
      </p>

      {message && (
        <p className="mt-4 w-full rounded-lg bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          {message}
        </p>
      )}

      <form action={signUpWithPassword} className="mt-6 w-full space-y-3">
        <input
          type="text"
          name="username"
          required
          minLength={3}
          maxLength={20}
          pattern="[a-zA-Z0-9_]+"
          placeholder="Username"
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
        />
        <input
          type="email"
          name="email"
          required
          placeholder="you@example.com"
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
        />
        <PasswordInput
          name="password"
          required
          minLength={8}
          maxLength={72}
          placeholder="Password (min. 8 characters)"
          className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
        />
        <div>
          <label className="block text-xs font-medium text-foreground-soft">
            Date of birth
          </label>
          <input
            type="date"
            name="birthDate"
            required
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent"
          />
          <p className="mt-1 text-xs text-foreground-soft">
            You must be at least 13 to use YuKon3t.
          </p>
        </div>
        <button
          type="submit"
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        >
          Create account
        </button>
      </form>

      <p className="mt-6 text-sm text-foreground-soft">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
