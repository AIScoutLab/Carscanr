import { Image, ImageResizeMode, ImageStyle, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { CANONICAL_BRAND_MARK_SOURCE } from "@/constants/branding";
import { Colors, Radius } from "@/constants/theme";

export function BrandMark({
  size = 72,
  style,
  imageStyle,
  resizeMode = "contain",
  contentScale = 0.8,
}: {
  size?: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
  contentScale?: number;
}) {
  const safeScale = Math.max(0.6, Math.min(contentScale, 1));
  const contentSize = Math.round(size * safeScale);

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
            width: contentSize,
            height: contentSize,
            borderRadius: Math.round(contentSize * 0.34),
          },
          imageStyle,
        ]}
        resizeMode={resizeMode}
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
