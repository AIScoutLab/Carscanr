import * as Updates from "expo-updates";
import { StyleSheet, Text, View } from "react-native";
import { mobileBuildInfo, mobileEnv } from "@/lib/env";

type RuntimeDebugStampProps = {
  screen: string;
  lines?: Array<string | null | undefined | false>;
};

function shortValue(value: string | null | undefined, fallback = "unknown") {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 12) : fallback;
}

export function RuntimeDebugStamp({ screen, lines = [] }: RuntimeDebugStampProps) {
  const showQaDebug = mobileEnv.showQaDebug === "1" || mobileEnv.showQaDebug.toLowerCase() === "true";
  const showRuntimeDebugStamp = __DEV__ || (mobileEnv.appEnv !== "production" && showQaDebug);
  if (!showRuntimeDebugStamp) {
    return null;
  }

  const updateId = typeof Updates.updateId === "string" ? Updates.updateId : "";
  const channel = typeof Updates.channel === "string" ? Updates.channel : "";

  return (
    <View style={styles.container} pointerEvents="none">
      <Text style={styles.text}>
        {screen} | commit {shortValue(mobileBuildInfo.gitCommit)} | OTA {shortValue(updateId, "embedded")}
        {channel ? ` | ${channel}` : ""}
      </Text>
      {lines.filter(Boolean).map((line, index) => (
        <Text key={`${index}-${line}`} style={styles.text}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: "stretch",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.34)",
    backgroundColor: "rgba(216, 163, 107, 0.12)",
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 2,
  },
  text: {
    color: "#E8C18B",
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "700",
  },
});
