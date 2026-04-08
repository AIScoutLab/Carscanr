import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Colors } from "@/constants/theme";

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
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.card,
          height: 84,
          paddingTop: 10,
          borderTopColor: Colors.borderSoft,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
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
  iconWrap: { alignItems: "center", justifyContent: "center", gap: 6 },
  indicator: {
    width: 18,
    height: 3,
    borderRadius: 999,
    backgroundColor: Colors.accent,
  },
});
