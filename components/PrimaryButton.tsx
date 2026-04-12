import { StyleSheet, Text, TouchableOpacity } from "react-native";
import { Colors, Typography } from "@/constants/theme";
import { buttonStyles } from "@/design/patterns";

type Props = {
  label: string;
  onPress?: () => void;
  secondary?: boolean;
  disabled?: boolean;
};

export function PrimaryButton({ label, onPress, secondary = false, disabled = false }: Props) {
  return (
    <TouchableOpacity
      activeOpacity={0.86}
      style={[
        styles.button,
        secondary && styles.secondary,
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <Text style={[styles.label, secondary && styles.secondaryLabel]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: buttonStyles.primary,
  secondary: buttonStyles.secondary,
  disabled: { opacity: 0.6 },
  label: { ...Typography.bodyStrong, color: "#FFFFFF" },
  secondaryLabel: { color: Colors.text },
});
