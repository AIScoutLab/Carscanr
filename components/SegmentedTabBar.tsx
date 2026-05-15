import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
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
          <TouchableOpacity
            key={tab}
            style={[styles.tab, active && styles.activeTab]}
            onPress={() => onChange(tab)}
            activeOpacity={0.86}
            accessibilityRole="button"
          >
            {/* Keep tab labels on one line and evenly distribute the four final tabs. */}
            <Text style={[styles.label, active && styles.activeLabel]} numberOfLines={1} ellipsizeMode="tail">
              {tab}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    flexDirection: "row",
    backgroundColor: "#081521",
    borderRadius: Radius.pill,
    padding: 5,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  activeTab: {
    backgroundColor: "rgba(29, 140, 255, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(94, 231, 255, 0.22)",
  },
  label: {
    ...Typography.caption,
    color: Colors.textMuted,
    fontSize: 11.5,
    letterSpacing: 0.2,
  },
  activeLabel: {
    color: Colors.premium,
    fontWeight: "700",
  },
});
