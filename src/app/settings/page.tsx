import Link from "next/link";
import { BackButton } from "@/components/back-button";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { getPasswordHash, isPasswordResetRequired } from "@/lib/auth-guards";
import { updatePrivacy, updateRingtone, updateNewMemberAlerts, updateAutoTranslate, setPassword } from "@/app/actions/profile";
import { setBirthDateOnce, updateBirthdaySharing } from "@/app/actions/birthdays";
import { BIRTHDAY_DEFAULT_AUDIENCE, birthdaySettingsView } from "@/lib/birthdays";
import { MIN_AGE } from "@/lib/validation-constants";
import { BirthDateSelect } from "@/components/birth-date-select";
import { isTranslationConfigured } from "@/lib/translation-server";
import { listBlockedUsers } from "@/app/actions/blocks";
import { AccountDangerZone } from "@/components/account-danger-zone";
import { CollapsibleSection } from "@/components/collapsible-section";
import { BlockButton } from "@/components/block-button";
import { PasswordInput } from "@/components/password-input";
import { SubmitButton } from "@/components/submit-button";
import { RingtonePicker } from "@/components/ringtone-picker";
import { InvitePanel } from "@/components/invite-panel";
import { PushNotificationsToggle } from "@/components/push-notifications-toggle";
import { PhoneVerificationForm } from "@/components/phone-verification-form";
import { getRequestCountry } from "@/lib/request-country";
import { EmojiStyleSetting } from "@/components/emoji-style-setting";
import { DataSaverSetting } from "@/components/data-saver-setting";
import { LanguagePicker } from "@/components/language-picker";
import { aroundPlaceholder, byCode, format } from "@/lib/i18n/locales";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { GuestGatedScreen } from "@/components/guest-preview";

// Server Actions inherit the page's maxDuration (set at the page level, not
// the action file — see Next.js docs). AccountDangerZone's exportMyData is
// an intentionally unbounded full-account dump (posts, messages, Circle
// memberships, etc.) — it was silently capped at whatever the un-configured
// default was (10s on Hobby). Now that Vercel Pro allows raising this,
// giving it real headroom for accounts with a lot of history.
export const maxDuration = 60;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const user = await getSessionUserOrRedirect();
  // Members only: a guest preview session (src/lib/guest-preview.ts) sees why, and how to join.
  if (user.isGuestPreview) return <GuestGatedScreen kind="settings" />;
  const locale = await getLocale();
  const dictionary = await getDictionary();
  const t = dictionary.settings;
  const offlineMessage = dictionary.shared.submitButton.offline;
  const { error, saved } = await searchParams;
  const blocked = await listBlockedUsers();
  const hasPassword = Boolean(await getPasswordHash(user.id));
  const passwordResetRequired = hasPassword && (await isPasswordResetRequired(user.id));
  const translationAvailable = isTranslationConfigured();
  // "Share my birthday" is on by default (BOTH): "Turn off" is always there, and "Turn on" (or changing who is
  // reminded) only where it can apply now (birthdaySettingsView: a birth date on the account and BIRTHDAY_MIN_AGE).
  // An account with no birth date gets the one-time "Add your date of birth" form (setBirthDateOnce) instead.
  const birthday = birthdaySettingsView(user.birthdayAudience, user.birthDate, new Date());
  const birthdayAudienceLabels = {
    BOTH: t.birthday.both,
    CONNECTIONS: t.birthday.connections,
    CIRCLES: t.birthday.circles,
    NONE: t.birthday.statusOff,
  } as const;

  const [signedInBefore, signedInAfter] = aroundPlaceholder(t.signedInAs, "email");
  const [profileBefore, profileAfter] = aroundPlaceholder(t.editProfile, "link");
  const [faqBefore, faqAfter] = aroundPlaceholder(t.faq, "link");
  const [usernameBefore, usernameAfter] = aroundPlaceholder(t.signInMethod.usernameIs, "username");

  return (
    <div className="mx-auto max-w-xl space-y-10 px-4 py-10">
      <div>
        <BackButton href="/home" label={dictionary.shell.common.back} />
        <h1 className="font-display text-2xl font-semibold">{t.title}</h1>
        <p className="mt-1 text-sm text-foreground-soft">
          {signedInBefore}
          <bdi>{user.email}</bdi>
          {signedInAfter}
        </p>
        <p className="mt-2 text-sm text-foreground-soft">
          {profileBefore}
          <Link href={`/u/${user.id}`} className="text-accent hover:underline">
            {t.editProfileLink}
          </Link>
          {profileAfter}{" "}
          {faqBefore}
          <Link href="/faq" className="text-accent hover:underline">
            {t.faqLink}
          </Link>
          {faqAfter}
        </p>
      </div>

      {passwordResetRequired && (
        <Link
          href="#sign-in-method"
          className="block rounded-lg border border-accent bg-accent-soft px-4 py-3 text-sm font-medium hover:underline"
        >
          {t.passwordResetRequired}
        </Link>
      )}

      {saved && (
        <p role="status" className="rounded-lg bg-success/10 px-4 py-2 text-sm text-success">
          {t.saved}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {format(byCode(t.errors, error), { age: MIN_AGE })}
        </p>
      )}

      {/* Every section is collapsible, in the FAQ's look, and starts closed like the FAQ's questions. Section ids are
          anchors (/settings#notifications, #birthdays, #sign-in-method ...) that open their section; never rename one. */}
      <div className="space-y-2">
        <CollapsibleSection id="privacy" page="settings" title={t.privacy.heading}>
          <p className="text-sm text-foreground-soft">{t.privacy.intro}</p>
          <form action={updatePrivacy} className="mt-4 space-y-4">
            <div>
              <label htmlFor="settings-posts-visibility" className="block text-sm font-medium">
                {t.privacy.postsVisibility}
              </label>
              <select
                id="settings-posts-visibility"
                name="postsVisibility"
                defaultValue={user.postsVisibility}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
              >
                <option value="PUBLIC">{t.privacy.public}</option>
                <option value="CONNECTIONS_ONLY">{t.privacy.connectionsOnly}</option>
                {/* Admin-only, so it stays English like the rest of admin. */}
                {user.isAdmin && (
                  <option value="HIDDEN" lang="en">
                    Invisible to everyone (admin only)
                  </option>
                )}
              </select>
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <input
                type="checkbox"
                name="discoverable"
                defaultChecked={user.discoverable}
              />
              {t.privacy.discoverable}
            </label>
            <SubmitButton
              label={t.privacy.save}
              pendingLabel={t.saving}
              offlineMessage={offlineMessage}
              className="w-full rounded-lg border border-line px-4 py-3 text-sm font-semibold hover:border-accent hover:text-accent"
            />
          </form>
          {/* Always here and always worded the same, whether or not this account has a PIN or any hidden chat. */}
          <Link
            href="/messages/hidden"
            className="mt-4 flex items-center justify-between rounded-lg border border-line px-3 py-2.5 text-sm hover:border-accent hover:text-accent"
          >
            <span>{t.privacy.hiddenChats}</span>
            <span aria-hidden className="text-foreground-soft rtl:-scale-x-100">
              &rsaquo;
            </span>
          </Link>
          {/* #birthdays is the anchor the BIRTHDAY_SHARING_ON notice opens; keep it on this block. */}
          <div id="birthdays" className="mt-6 scroll-mt-24 space-y-3">
            <h3 className="text-sm font-semibold">{t.birthday.heading}</h3>
            <p className="flex items-center gap-2 text-sm font-medium">
              <span
                aria-hidden
                className={`inline-block size-2.5 shrink-0 rounded-full ${birthday.sharing ? "bg-success" : "bg-line"}`}
              />
              {birthday.sharing ? t.birthday.statusOn : t.birthday.statusOff}
            </p>
            {birthday.sharing ? (
              <>
                {birthday.audiences.length > 0 ? (
                  <form action={updateBirthdaySharing} className="space-y-3">
                    <div>
                      <label htmlFor="settings-birthday-audience" className="block text-sm font-medium">
                        {t.birthday.audience}
                      </label>
                      <select
                        id="settings-birthday-audience"
                        name="audience"
                        defaultValue={user.birthdayAudience}
                        aria-describedby="settings-birthday-hint"
                        className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
                      >
                        {birthday.audiences.map((audience) => (
                          <option key={audience} value={audience}>
                            {birthdayAudienceLabels[audience]}
                          </option>
                        ))}
                      </select>
                      <p id="settings-birthday-hint" className="mt-1 text-sm text-foreground-soft">
                        {t.birthday.hint}
                      </p>
                    </div>
                    <SubmitButton
                      label={t.birthday.save}
                      pendingLabel={t.saving}
                      offlineMessage={offlineMessage}
                      className="w-full rounded-lg border border-line px-4 py-3 text-sm font-semibold hover:border-accent hover:text-accent"
                    />
                  </form>
                ) : (
                  <p className="text-sm text-foreground-soft">
                    {birthday.needsBirthDate ? t.birthday.noBirthDate : t.birthday.unavailable}
                  </p>
                )}
                <form action={updateBirthdaySharing}>
                  <input type="hidden" name="audience" value="NONE" />
                  <SubmitButton
                    label={t.birthday.turnOff}
                    pendingLabel={t.saving}
                    offlineMessage={offlineMessage}
                    className="w-full rounded-lg border border-line px-4 py-3 text-sm font-semibold hover:border-danger hover:text-danger"
                  />
                </form>
              </>
            ) : birthday.canTurnOn ? (
              <form action={updateBirthdaySharing} className="space-y-3">
                <p id="settings-birthday-hint" className="text-sm text-foreground-soft">
                  {t.birthday.offHint}
                </p>
                <div>
                  <label htmlFor="settings-birthday-audience" className="block text-sm font-medium">
                    {t.birthday.audience}
                  </label>
                  <select
                    id="settings-birthday-audience"
                    name="audience"
                    defaultValue={BIRTHDAY_DEFAULT_AUDIENCE}
                    aria-describedby="settings-birthday-hint"
                    className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
                  >
                    {birthday.audiences.map((audience) => (
                      <option key={audience} value={audience}>
                        {birthdayAudienceLabels[audience]}
                      </option>
                    ))}
                  </select>
                </div>
                <SubmitButton
                  label={t.birthday.turnOn}
                  pendingLabel={t.saving}
                  offlineMessage={offlineMessage}
                  className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink hover:opacity-90"
                />
              </form>
            ) : (
              // Under 18, or no birth date on the account yet: Off stays Off until sharing can apply, and the page says
              // so (pointing to the form below when the birth date is missing) rather than offering a "Turn on" the
              // action would refuse.
              <p className="text-sm text-foreground-soft">
                {birthday.needsBirthDate ? t.birthday.offNoBirthDate : t.birthday.offUnavailable}
              </p>
            )}
            {birthday.needsBirthDate && (
              // One time only: setBirthDateOnce writes it only while the account has none, and nothing edits it later.
              <form action={setBirthDateOnce} className="space-y-3 rounded-lg border border-line p-3">
                <h4 className="text-sm font-semibold">{t.birthday.addBirthDate.heading}</h4>
                <p className="text-sm text-foreground-soft">{t.birthday.addBirthDate.intro}</p>
                <p
                  id="settings-birth-date-warning"
                  className="rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium"
                >
                  {t.birthday.addBirthDate.warning}
                </p>
                <div>
                  <label htmlFor="settings-birth-date" className="block text-sm font-medium">
                    {t.birthday.addBirthDate.label}
                  </label>
                  <div className="mt-1">
                    <BirthDateSelect
                      id="settings-birth-date"
                      minAge={MIN_AGE}
                      labels={dictionary.shared.birthDate}
                      describedBy="settings-birth-date-warning settings-birth-date-hint"
                    />
                  </div>
                  <p id="settings-birth-date-hint" className="mt-1 text-xs text-foreground-soft">
                    {format(t.birthday.addBirthDate.ageHint, { age: MIN_AGE })}
                  </p>
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="confirm" required className="mt-0.5 shrink-0" />
                  <span>{t.birthday.addBirthDate.confirm}</span>
                </label>
                <SubmitButton
                  label={t.birthday.addBirthDate.save}
                  pendingLabel={t.saving}
                  offlineMessage={offlineMessage}
                  className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink hover:opacity-90"
                />
              </form>
            )}
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="notifications" page="settings" title={t.notifications.heading}>
          <p className="text-sm text-foreground-soft">{t.notifications.intro}</p>
          <div className="mt-4">
            <PushNotificationsToggle />
          </div>
          <form action={updateNewMemberAlerts} className="mt-4 space-y-3">
            <label className="flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <input
                type="checkbox"
                name="newMemberAlerts"
                defaultChecked={user.newMemberAlerts}
                aria-describedby="settings-new-member-alerts-hint"
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">{t.notifications.newMembers}</span>
                <span id="settings-new-member-alerts-hint" className="mt-0.5 block text-foreground-soft">
                  {t.notifications.newMembersHint}
                </span>
              </span>
            </label>
            <SubmitButton
              label={t.notifications.save}
              pendingLabel={t.saving}
              offlineMessage={offlineMessage}
              className="w-full rounded-lg border border-line px-4 py-3 text-sm font-semibold hover:border-accent hover:text-accent"
            />
          </form>
        </CollapsibleSection>

        <CollapsibleSection id="language" page="settings" title={t.language.heading}>
          <p className="text-sm text-foreground-soft">{t.language.body}</p>
          {/* The one place a signed-in person can change it: the other pickers are on the signed-out screens. */}
          <LanguagePicker locale={locale} label={dictionary.languagePicker.label} className="mt-4 justify-start" />
          {/* Translating other people's text (src/lib/translation.ts). Without a provider configured it can't be turned on. */}
          <form action={updateAutoTranslate} className="mt-4 space-y-3">
            <label className="flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <input
                type="checkbox"
                name="autoTranslate"
                defaultChecked={user.autoTranslate}
                disabled={!translationAvailable}
                aria-describedby="settings-auto-translate-hint"
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">{t.language.autoTranslate}</span>
                <span id="settings-auto-translate-hint" className="mt-0.5 block text-foreground-soft">
                  {translationAvailable ? t.language.autoTranslateHint : t.language.autoTranslateUnavailable}
                </span>
              </span>
            </label>
            {translationAvailable && (
              <SubmitButton
                label={t.language.save}
                pendingLabel={t.saving}
                offlineMessage={offlineMessage}
                className="w-full rounded-lg border border-line px-4 py-3 text-sm font-semibold hover:border-accent hover:text-accent"
              />
            )}
          </form>
        </CollapsibleSection>

        <CollapsibleSection id="emoji-style" page="settings" title={t.emoji.heading}>
          <p className="text-sm text-foreground-soft">{t.emoji.intro}</p>
          <div className="mt-4">
            <EmojiStyleSetting />
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="data-saver" page="settings" title={t.dataSaver.heading}>
          <p className="text-sm text-foreground-soft">{t.dataSaver.intro}</p>
          <div className="mt-4">
            <DataSaverSetting />
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="ambient" page="settings" title={t.ambient.heading}>
          <p className="text-sm text-foreground-soft">{t.ambient.intro}</p>
          <Link
            href="/settings/ambient"
            className="mt-3 inline-block rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
          >
            {t.ambient.manage}
          </Link>
        </CollapsibleSection>

        <CollapsibleSection id="invite" page="settings" title={t.invite.heading}>
          <p className="text-sm text-foreground-soft">{t.invite.intro}</p>
          <div className="mt-4">
            <InvitePanel defaultCountry={await getRequestCountry()} />
          </div>
        </CollapsibleSection>

        {blocked.length > 0 && (
          <CollapsibleSection id="blocked" page="settings" title={t.blocked.heading}>
            <p className="text-sm text-foreground-soft">{t.blocked.intro}</p>
            <ul className="mt-4 space-y-2">
              {blocked.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm"
                >
                  <Link href={`/u/${b.blocked.id}`} dir="auto" className="min-w-0 break-words hover:text-accent">
                    {b.blocked.name ?? t.blocked.deleted}
                  </Link>
                  <BlockButton targetId={b.blocked.id} targetName={b.blocked.name} initiallyBlocked />
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        )}

        <CollapsibleSection id="calls" page="settings" title={t.calls.heading}>
          <p className="text-sm text-foreground-soft">{t.calls.intro}</p>
          <form action={updateRingtone} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium">{t.calls.ringtone}</label>
              <div className="mt-1">
                <RingtonePicker defaultValue={user.ringtone} />
              </div>
            </div>
            <SubmitButton
              label={t.calls.save}
              pendingLabel={t.saving}
              offlineMessage={offlineMessage}
              className="w-full rounded-lg border border-line px-4 py-3 text-sm font-semibold hover:border-accent hover:text-accent"
            />
          </form>
        </CollapsibleSection>

        <CollapsibleSection id="sign-in-method" page="settings" title={t.signInMethod.heading}>
          <p className="text-sm text-foreground-soft">
            {hasPassword ? t.signInMethod.withPassword : t.signInMethod.withoutPassword}
          </p>
          <form action={setPassword} className="mt-4 space-y-4">
            {!user.username && (
              <div>
                <label htmlFor="settings-username" className="block text-sm font-medium">
                  {t.signInMethod.username}
                </label>
                <input
                  id="settings-username"
                  name="username"
                  required
                  minLength={3}
                  maxLength={20}
                  pattern="[a-zA-Z0-9_]+"
                  autoComplete="username"
                  className="ltr-value mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
                />
              </div>
            )}
            {user.username && (
              <p className="text-sm">
                {usernameBefore}
                <bdi className="font-medium">{user.username}</bdi>
                {usernameAfter}
              </p>
            )}
            {hasPassword && (
              <div>
                <label htmlFor="settings-current-password" className="block text-sm font-medium">
                  {t.signInMethod.currentPassword}
                </label>
                <PasswordInput
                  id="settings-current-password"
                  name="currentPassword"
                  required
                  maxLength={72}
                  autoComplete="current-password"
                  className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
                  labels={dictionary.shared.passwordInput}
                />
              </div>
            )}
            <div>
              <label htmlFor="settings-new-password" className="block text-sm font-medium">
                {hasPassword ? t.signInMethod.newPassword : t.signInMethod.password}
              </label>
              <PasswordInput
                id="settings-new-password"
                name="password"
                required
                minLength={8}
                maxLength={72}
                autoComplete="new-password"
                className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
                labels={dictionary.shared.passwordInput}
              />
            </div>
            {hasPassword && <p className="text-xs text-foreground-soft">{t.signInMethod.signsOut}</p>}
            <SubmitButton
              label={hasPassword ? t.signInMethod.update : t.signInMethod.set}
              pendingLabel={hasPassword ? t.signInMethod.updating : t.signInMethod.setting}
              offlineMessage={offlineMessage}
              className="w-full rounded-lg border border-line px-4 py-3 text-sm font-semibold hover:border-accent hover:text-accent"
            />
          </form>
        </CollapsibleSection>

        <CollapsibleSection id="phone" page="settings" title={t.phone.heading}>
          <p className="text-sm text-foreground-soft">{t.phone.intro}</p>
          <div className="mt-4">
            <PhoneVerificationForm
              phone={user.phone}
              phoneVerifiedAt={user.phoneVerifiedAt}
              defaultCountry={await getRequestCountry()}
              locale={locale}
              t={dictionary.verifyPhone.form}
              shared={dictionary.shared}
              verifiedLabel={t.phone.verified}
            />
          </div>
        </CollapsibleSection>

        <CollapsibleSection id="your-data" page="settings" title={t.data.heading}>
          <AccountDangerZone showHeading={false} />
        </CollapsibleSection>
      </div>
    </div>
  );
}
