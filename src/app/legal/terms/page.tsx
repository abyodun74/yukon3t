export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-14 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Terms of Service</h1>
      <p className="mt-4 text-foreground-soft">
        By using YuKon3t you agree to our{" "}
        <a href="/legal/guidelines" className="text-accent">
          Community Guidelines
        </a>{" "}
        and{" "}
        <a href="/legal/privacy" className="text-accent">
          Privacy Policy
        </a>
        . YuKon3t is provided as-is during its early access period. You must
        be at least 18 years old to create an account. Accounts that violate
        the Community Guidelines may be warned or suspended, always with a
        stated reason and an appeal path.
      </p>
    </div>
  );
}
