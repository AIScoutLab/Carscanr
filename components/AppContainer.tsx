import { PropsWithChildren } from "react";
import { SafeAreaView, ScrollView, StyleSheet, ViewStyle } from "react-native";
import { Colors } from "@/constants/theme";

type Props = PropsWithChildren<{
  scroll?: boolean;
  contentContainerStyle?: ViewStyle;
}>;

export function AppContainer({ children, scroll = true, contentContainerStyle }: Props) {
  if (scroll) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, contentContainerStyle]} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }
  return <SafeAreaView style={[styles.safeArea, styles.content, contentContainerStyle]}>{children}</SafeAreaView>;
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
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 20,
  },
});
