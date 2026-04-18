import { useRef } from "react";
import { Animated, Pressable, StyleSheet, Text } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Colors, Typography } from "@/constants/theme";
import { buttonStyles } from "@/design/patterns";
import { Motion } from "@/constants/theme";

type Props = {
  label: string;
  onPress?: () => void;
  secondary?: boolean;
  disabled?: boolean;
};

export function PrimaryButton({ label, onPress, secondary = false, disabled = false }: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        style={[
          styles.button,
          secondary && styles.secondary,
          disabled && styles.disabled,
        ]}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        onPressIn={() => {
          Animated.timing(scale, {
            toValue: Motion.pressInScale,
            duration: Motion.quick,
            useNativeDriver: true,
          }).start();
        }}
        onPressOut={() => {
          Animated.timing(scale, {
            toValue: Motion.pressOutScale,
            duration: Motion.quick,
            useNativeDriver: true,
          }).start();
        }}
      >
        {secondary ? (
          <Text style={[styles.label, styles.secondaryLabel]}>{label}</Text>
        ) : (
          <LinearGradient colors={["#165FBA", "#0F4F9E", "#1E70C8"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.gradient}>
            <Text style={styles.label}>{label}</Text>
          </LinearGradient>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    ...buttonStyles.primary,
    overflow: "hidden",
  },
  secondary: {
    ...buttonStyles.secondary,
    backgroundColor: "rgba(12, 21, 36, 0.84)",
  },
  disabled: { opacity: 0.6 },
  gradient: {
    minHeight: 56,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    borderRadius: 999,
  },
  label: { ...Typography.bodyStrong, color: "#F8FCFF", letterSpacing: 0.2 },
  secondaryLabel: { color: Colors.textStrong },
});
