import { Component, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Colors, Radius, Typography } from "@/constants/theme";

type Props = {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
};

type State = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.log("[error-boundary] render error", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.fallback}>
          <Text style={styles.title}>{this.props.fallbackTitle ?? "Result unavailable"}</Text>
          <Text style={styles.message}>
            {this.props.fallbackMessage ?? "We hit an unexpected issue while rendering this result. Please go back and try again."}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    padding: 20,
    gap: 10,
  },
  title: { ...Typography.heading, color: Colors.text },
  message: { ...Typography.body, color: Colors.textMuted },
});
