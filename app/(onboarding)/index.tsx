import { Redirect } from "expo-router";

export default function LegacyOnboardingRedirect() {
  return <Redirect href={"/onboarding" as never} />;
}
