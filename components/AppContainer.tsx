import { PropsWithChildren } from "react";
import { ScrollView, StyleSheet, View, ViewStyle } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/theme";

type Props = PropsWithChildren<{
  scroll?: boolean;
  contentContainerStyle?: ViewStyle;
}>;

export function AppContainer({ children, scroll = true, contentContainerStyle }: Props) {
  const insets = useSafeAreaInsets();
  const contentPadding = {
    paddingTop: Math.max(insets.top, 8) + 12,
    paddingBottom: Math.max(insets.bottom, 12) + 16,
    paddingHorizontal: 20,
  } satisfies ViewStyle;

  if (scroll) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "right", "bottom", "left"]}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, contentPadding, contentContainerStyle]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "right", "bottom", "left"]}>
      <View style={[styles.content, contentPadding, contentContainerStyle]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: 20,
  },
});
