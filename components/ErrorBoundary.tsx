import { Component, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Radius, Typography } from "@/constants/theme";

type Props = {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
};

type State = {
  hasError: boolean;
  errorMessage: string | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: null };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unexpected render error.";
    console.log("[error-boundary] render error", {
      error,
      errorInfo,
      errorMessage,
    });
    this.setState({ errorMessage });
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.fallback}>
          <View style={styles.badge}>
            <Ionicons name="alert-circle-outline" size={18} color={Colors.danger} />
            <Text style={styles.badgeLabel}>Render fallback</Text>
          </View>
          <Text style={styles.title}>{this.props.fallbackTitle ?? "Result unavailable"}</Text>
          <Text style={styles.message}>
            {this.props.fallbackMessage ?? "We hit an unexpected issue while rendering this result. Please go back and try again."}
          </Text>
          {this.state.errorMessage ? <Text style={styles.detail}>{this.state.errorMessage}</Text> : null}
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
    borderWidth: 1,
    borderColor: Colors.border,
  },
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: Colors.dangerSoft,
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  badgeLabel: {
    ...Typography.caption,
    color: Colors.danger,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  title: { ...Typography.heading, color: Colors.text },
  message: { ...Typography.body, color: Colors.textMuted },
  detail: { ...Typography.caption, color: Colors.textMuted },
});
