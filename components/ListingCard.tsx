import { useEffect, useRef } from "react";
import { Animated, Image, StyleSheet, Text, View } from "react-native";
import { SILHOUETTE_IMAGES, toVehicleImageSource } from "@/constants/vehicleImages";
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

  const title = safeListingText(listing.title, "Sample vehicle listing");
  const price = safeListingText(listing.price, "Price unavailable");
  const mileage = safeListingText(listing.mileage, "Mileage unavailable");
  const distance = safeListingText(listing.distance, "Distance unavailable");
  const dealer = safeListingText(listing.dealer, listing.isSampleListing ? "Sample seller" : "Seller unavailable");
  const location = safeListingText(listing.location, "Location unavailable");
  const imageSource =
    typeof listing.imageUrl === "string" && listing.imageUrl.trim().length > 0
      ? { uri: listing.imageUrl.trim() }
      : toVehicleImageSource(SILHOUETTE_IMAGES.neutral_vehicle);
  const distanceNumber = Number(distance.replace(/[^\d.]/g, ""));
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
          <Image source={imageSource} style={styles.image} />
          <View style={styles.imageOverlay} />
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.price}>{price}</Text>
          <Text style={styles.meta}>{mileage} • {distance}</Text>
          <Text style={styles.meta}>{dealer} • {location}</Text>
          <View style={styles.matchRow}>
            <Text style={styles.matchLabel}>Match</Text>
            <Text style={styles.matchValue}>{matchLabel}</Text>
          </View>
          {listing.sourceLabel ? <Text style={styles.sourceLabel}>{listing.sourceLabel} — demo data, not live market data</Text> : null}
        </View>
      </View>
    </Animated.View>
  );
}

function safeListingText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

const styles = StyleSheet.create({
  card: {
    ...cardStyles.standard,
    padding: 0,
    overflow: "hidden",
  },
  bestCard: {
    borderColor: Colors.accent,
  },
  imageWrap: { backgroundColor: Colors.cardAlt },
  image: { width: "100%", height: 168 },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(4, 8, 18, 0.16)",
  },
  body: { padding: 16, gap: 8 },
  title: { ...Typography.bodyStrong, color: Colors.textStrong },
  price: { ...Typography.price, color: Colors.premium },
  meta: { ...Typography.caption, color: Colors.textSoft },
  matchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  matchLabel: { ...Typography.caption, color: Colors.textFaint },
  matchValue: { ...Typography.caption, color: Colors.accent, fontWeight: "700" },
  sourceLabel: { ...Typography.caption, color: Colors.textMuted },
});
