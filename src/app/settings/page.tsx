import Link from "next/link";
import { BackButton } from "@/components/back-button";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { getPasswordHash, isPasswordResetRequired } from "@/lib/auth-guards";
import { updatePrivacy, updateRingtone, updateNewMemberAlerts, updateAutoTranslate, setPassword } from "@/app/actions/profile";
import { isTranslationConfigured } from "@/lib/translation-server";
import { listBlockedUsers } from "@/app/actions/blocks";
import { AccountDangerZone } from "@/components/account-danger-zone";
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
import { aroundPlaceholder, byCode } from "@/lib/i18n/locales";
import { getDictionary, getLocale } from "@/lib/i18n/server";

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
  const locale = await getLocale();
  const dictionary = await getDictionary();
  const t = dictionary.settings;
  const offlineMessage = dictionary.shared.submitButton.offline;
  const { error, saved } = await searchParams;
  const blocked = await listBlockedUsers();
  const hasPassword = Boolean(await getPasswordHash(user.id));
  const passwordResetRequired = hasPassword && (await isPasswordResetRequired(user.id));
  const translationAvailable = isTranslationConfigured();

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
          {byCode(t.errors, error)}
        </p>
      )}

      <div>
        <h2 className="text-lg font-semibold">{t.privacy.heading}</h2>
        <p className="mt-1 text-sm text-foreground-soft">{t.privacy.intro}</p>
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
      </div>

      <div>
        <h2 className="text-lg font-semibold">{t.notifications.heading}</h2>
        <p className="mt-1 text-sm text-foreground-soft">{t.notifications.intro}</p>
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
      </div>

      <div>
        <h2 className="text-lg font-semibold">{t.language.heading}</h2>
        <p className="mt-1 text-sm text-foreground-soft">{t.language.body}</p>
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
      </div>

      <div>
        <h2 className="text-lg font-semibold">{t.emoji.heading}</h2>
        <p className="mt-1 text-sm text-foreground-soft">{t.emoji.intro}</p>
        <div className="mt-4">
          <EmojiStyleSetting />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold">{t.dataSaver.heading}</h2>
        <p className="mt-1 text-sm text-foreground-soft">{t.dataSaver.intro}</p>
        <div className="mt-4">
          <DataSaverSetting />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold">{t.ambient.heading}</h2>
        <p className="mt-1 text-sm text-foreground-soft">{t.ambient.intro}</p>
        <Link
          href="/settings/ambient"
          className="mt-3 inline-block rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
        >
          {t.ambient.manage}
        </Link>
      </div>

      <div>
        <h2 className="text-lg font-semibold">{t.invite.heading}</h2>
        <p className="mt-1 text-sm text-foreground-soft">{t.invite.intro}</p>
        <div className="mt-4">
          <InvitePanel defaultCountry={await getRequestCountry()} />
        </div>
      </div>

      {blocked.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold">{t.blocked.heading}</h2>
          <p className="mt-1 text-sm text-foreground-soft">{t.blocked.intro}</p>
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
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold">{t.calls.heading}</h2>
        <p className="mt-1 text-sm text-foreground-soft">{t.calls.intro}</p>
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
      </div>

      <div id="sign-in-method" className="scroll-mt-24">
        <h2 className="text-lg font-semibold">{t.signInMethod.heading}</h2>
        <p className="mt-1 text-sm text-foreground-soft">
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
      </div>

      <div>
        <h2 className="text-lg font-semibold">{t.phone.heading}</h2>
        <p className="mt-1 text-sm text-foreground-soft">{t.phone.intro}</p>
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
      </div>

      <AccountDangerZone />
    </div>
  );
}
