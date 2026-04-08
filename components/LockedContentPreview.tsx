import { PropsWithChildren } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Colors, Radius, Typography } from "@/constants/theme";

type Props = PropsWithChildren<{
  locked: boolean;
  title?: string;
  description?: string;
}>;

export function LockedContentPreview({
  locked,
  title = "Preview available",
  description = "Upgrade to reveal the full view.",
  children,
}: Props) {
  return (
    <View style={styles.container}>
      <View style={[styles.content, locked && styles.contentLocked]}>{children}</View>
      {locked ? (
        <View style={styles.overlay}>
          <View style={styles.blur}>
            <View style={styles.callout}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.description}>{description}</Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
    overflow: "hidden",
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
    backgroundColor: Colors.cardTint,
  },
  content: {
    minHeight: 140,
  },
  contentLocked: {
    opacity: 0.38,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  blur: {
    flex: 1,
    justifyContent: "center",
    padding: 18,
    backgroundColor: "rgba(255,255,255,0.74)",
  },
  callout: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  title: { ...Typography.heading, color: Colors.textStrong },
  description: { ...Typography.caption, color: Colors.textMuted },
});
