import { Redirect } from "expo-router";

export default function DeprecatedProcessingRoute() {
  console.log("[scan-processing] deprecated route hit; redirecting to scan tab");
  return <Redirect href={"/(tabs)/scan" as never} />;
}
