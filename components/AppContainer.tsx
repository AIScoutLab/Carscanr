import { PropsWithChildren } from "react";
import { Keyboard, ScrollView, StyleSheet, TouchableWithoutFeedback, View, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Colors } from "@/constants/theme";

type Props = PropsWithChildren<{
  scroll?: boolean;
  contentContainerStyle?: ViewStyle;
}>;

export function AppContainer({ children, scroll = true, contentContainerStyle }: Props) {
  const contentPadding = {
    paddingTop: 6,
    paddingBottom: 14,
    paddingHorizontal: 20,
  } satisfies ViewStyle;

  if (scroll) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "right", "bottom", "left"]}>
        <LinearGradient colors={[Colors.background, Colors.backgroundAlt, Colors.background]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
          <View style={styles.glowPrimary} pointerEvents="none" />
          <View style={styles.glowSecondary} pointerEvents="none" />
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[styles.content, contentPadding, contentContainerStyle]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            >
              {children}
            </ScrollView>
          </TouchableWithoutFeedback>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "right", "bottom", "left"]}>
      <LinearGradient colors={[Colors.background, Colors.backgroundAlt, Colors.background]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
        <View style={styles.glowPrimary} pointerEvents="none" />
        <View style={styles.glowSecondary} pointerEvents="none" />
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={[styles.content, contentPadding, contentContainerStyle]}>{children}</View>
        </TouchableWithoutFeedback>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  gradient: {
    flex: 1,
  },
  glowPrimary: {
    position: "absolute",
    top: -80,
    right: -40,
    width: 220,
    height: 220,
    borderRadius: 220,
    backgroundColor: Colors.accentGlow,
    opacity: 0.24,
  },
  glowSecondary: {
    position: "absolute",
    top: 120,
    left: -70,
    width: 180,
    height: 180,
    borderRadius: 180,
    backgroundColor: Colors.cyanGlow,
    opacity: 0.18,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: 20,
  },
});
