import { Pressable, StyleSheet, Text } from "react-native";
import { Colors, Motion, Typography } from "@/constants/theme";
import { buttonStyles } from "@/design/patterns";

type Props = {
  label: string;
  onPress?: () => void;
  secondary?: boolean;
  disabled?: boolean;
};

export function PrimaryButton({ label, onPress, secondary = false, disabled = false }: Props) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.label, secondary && styles.secondaryLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: buttonStyles.primary,
  secondary: buttonStyles.secondary,
  disabled: { opacity: 0.6 },
  pressed: { transform: [{ scale: Motion.pressInScale }] },
  label: { ...Typography.bodyStrong, color: "#FFFFFF" },
  secondaryLabel: { color: Colors.text },
});
