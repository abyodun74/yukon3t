/**
 * Whether onboarding is finished: a name, a country and at least one interest. Pages use it to send an unfinished
 * profile to /onboarding (getOnboardedUserOrRedirect) and a finished one away from it; completeOnboarding only runs for
 * a profile it says isn't finished. Pure, so a Server Action can use it without the page guards.
 */
export function isProfileComplete(user: { name: string | null; country: string | null; interests: string[] }) {
  return Boolean(user.name && user.country && user.interests.length > 0);
}
