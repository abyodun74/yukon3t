export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ context?: string }>;
}) {
  const { context } = await searchParams;
  const isVerify = context === "verify";

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Check your email</h1>
      <p className="mt-3 text-sm text-foreground-soft">
        {isVerify
          ? "We sent you a confirmation link to finish creating your account. It expires in 24 hours."
          : "We sent you a secure sign-in link. It expires shortly, so use it soon."}{" "}
        You can close this tab.
      </p>
    </div>
  );
}
