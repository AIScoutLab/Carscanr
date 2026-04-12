import { useEffect, useRef } from "react";
import { Animated, Image, StyleSheet, Text, View } from "react-native";
import { Colors, Radius, Typography } from "@/constants/theme";
import { cardStyles } from "@/design/patterns";
import { ListingResult } from "@/types";

export function ListingCard({ listing, isBest = false }: { listing: ListingResult; isBest?: boolean }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY]);

  const distanceNumber = Number(listing.distance.replace(/[^\d.]/g, ""));
  const matchLabel =
    Number.isFinite(distanceNumber) && distanceNumber <= 10
      ? "High"
      : Number.isFinite(distanceNumber) && distanceNumber <= 25
        ? "Good"
        : "Fair";

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <View style={[styles.card, isBest && styles.bestCard]}>
        <View style={styles.imageWrap}>
          <Image source={{ uri: listing.imageUrl }} style={styles.image} />
          <View style={styles.imageOverlay} />
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>{listing.title}</Text>
          <Text style={styles.price}>{listing.price}</Text>
          <Text style={styles.meta}>{listing.mileage} • {listing.distance}</Text>
          <Text style={styles.meta}>{listing.dealer} • {listing.location}</Text>
          <View style={styles.matchRow}>
            <Text style={styles.matchLabel}>Match</Text>
            <Text style={styles.matchValue}>{matchLabel}</Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...cardStyles.standard,
    padding: 0,
    overflow: "hidden",
  },
  bestCard: {
    backgroundColor: Colors.cardSoft,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  imageWrap: { backgroundColor: Colors.cardAlt },
  image: { width: "100%", height: 168 },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
  },
  body: { padding: 16, gap: 8 },
  title: { ...Typography.bodyStrong, color: Colors.textStrong },
  price: { ...Typography.price, color: Colors.textStrong },
  meta: { ...Typography.caption, color: Colors.textMuted },
  matchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  matchLabel: { ...Typography.caption, color: Colors.textFaint },
  matchValue: { ...Typography.caption, color: Colors.textSoft, fontWeight: "600" },
});
