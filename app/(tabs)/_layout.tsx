import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { StyleSheet, View } from "react-native";

const tabColors = {
  background: "#070707",
  active: "#D8A05F",
  inactive: "#7B808A",
  border: "rgba(255,255,255,0.08)",
};

function TabIcon({
  name,
  color,
  size,
  focused,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  size: number;
  focused: boolean;
}) {
  return (
    <View style={styles.iconWrap}>
      <Ionicons name={name} size={size} color={color} />
      {focused ? <View style={styles.indicator} /> : null}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: tabColors.active,
        tabBarInactiveTintColor: tabColors.inactive,
        tabBarStyle: {
          backgroundColor: tabColors.background,
          height: 88,
          paddingTop: 8,
          paddingBottom: 10,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: tabColors.border,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarItemStyle: {
          paddingTop: 4,
        },
        tabBarIconStyle: {
          marginBottom: 5,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          lineHeight: 16,
          fontWeight: "700",
          marginTop: 2,
        },
        tabBarIcon: ({ color, size, focused }) => {
          const iconMap: Record<string, keyof typeof Ionicons.glyphMap> = {
            scan: "scan-outline",
            garage: "car-sport-outline",
            search: "search-outline",
            profile: "person-circle-outline",
          };
          return <TabIcon name={iconMap[route.name] ?? "ellipse-outline"} size={size} color={color} focused={focused} />;
        },
      })}
    >
      <Tabs.Screen name="scan" options={{ title: "Scan" }} />
      <Tabs.Screen name="garage" options={{ title: "Garage" }} />
      <Tabs.Screen name="search" options={{ title: "Search" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    minWidth: 42,
    minHeight: 31,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  indicator: {
    width: 14,
    height: 2,
    borderRadius: 999,
    backgroundColor: tabColors.active,
  },
});
