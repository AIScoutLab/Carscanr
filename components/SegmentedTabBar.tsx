import { Pressable, StyleSheet, Text, View } from "react-native";
import { Colors, Radius, Typography } from "@/constants/theme";

type Props = {
  tabs: string[];
  activeTab: string;
  onChange: (tab: string) => void;
};

export function SegmentedTabBar({ tabs, activeTab, onChange }: Props) {
  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const active = activeTab === tab;
        return (
          <Pressable key={tab} style={[styles.tab, active && styles.activeTab]} onPress={() => onChange(tab)}>
            <Text style={[styles.label, active && styles.activeLabel]}>{tab}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: "row", backgroundColor: Colors.cardAlt, borderRadius: Radius.pill, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: Radius.pill, alignItems: "center" },
  activeTab: { backgroundColor: Colors.card },
  label: { ...Typography.caption, color: Colors.textMuted },
  activeLabel: { color: Colors.text, fontWeight: "700" },
});
