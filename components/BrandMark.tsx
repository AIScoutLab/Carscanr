import { Image, ImageStyle, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { CANONICAL_BRAND_MARK_SOURCE } from "@/constants/branding";
import { Colors, Radius } from "@/constants/theme";

export function BrandMark({
  size = 72,
  style,
  imageStyle,
}: {
  size?: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
}) {
  return (
    <View
      style={[
        styles.shell,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.34),
        },
        style,
      ]}
    >
      <Image
        source={CANONICAL_BRAND_MARK_SOURCE}
        style={[
          styles.image,
          {
            width: size,
            height: size,
            borderRadius: Math.round(size * 0.34),
          },
          imageStyle,
        ]}
        resizeMode="cover"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.accentGlow,
    overflow: "hidden",
  },
  image: {
    backgroundColor: Colors.card,
  },
});

