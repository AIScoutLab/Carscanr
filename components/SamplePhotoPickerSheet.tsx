import { Modal, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Radius, Typography } from "@/constants/theme";
import { SampleScanPhoto } from "@/features/scan/useScanActions";

type Props = {
  visible: boolean;
  samples: SampleScanPhoto[];
  loadingSampleId?: string | null;
  onClose: () => void;
  onOpenLibrary: () => void;
  onSelectSample: (sampleId: string) => void;
};

export function SamplePhotoPickerSheet({
  visible,
  samples,
  loadingSampleId,
  onClose,
  onOpenLibrary,
  onSelectSample,
}: Props) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.scrim} onPress={onClose} activeOpacity={1} />
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.78} accessibilityRole="button" accessibilityLabel="Close photo source picker">
              <Ionicons name="close" size={20} color={photoSourceColors.textSoft} />
            </TouchableOpacity>
            <View style={styles.heroBadge}>
              <View style={styles.badgeDot} />
              <Text style={styles.heroBadgeLabel}>Photo source</Text>
            </View>
          </View>

          <View style={styles.titleBlock}>
            <Text style={styles.title}>Choose a photo source</Text>
            <Text style={styles.subtitle}>Use your library or try a sample vehicle to experience the full scan flow.</Text>
          </View>

          <TouchableOpacity style={styles.libraryButton} onPress={onOpenLibrary} activeOpacity={0.86} accessibilityRole="button">
            <LinearGradient colors={["#E7B77C", "#D29A5F"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.libraryButtonFill}>
              <Ionicons name="images-outline" size={19} color="#090705" />
              <Text style={styles.libraryButtonText}>Open Photo Library</Text>
            </LinearGradient>
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>Or try a sample</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sample Vehicles</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {samples.map((sample) => {
                const isLoading = loadingSampleId === sample.id;
                const yearLabel = sample.title.match(/\b(?:19|20)\d{2}\b/)?.[0] ?? "";
                const displayTitle = yearLabel ? sample.title.replace(yearLabel, "").trim() : sample.title;
                return (
                  <TouchableOpacity key={sample.id} style={styles.card} onPress={() => onSelectSample(sample.id)} activeOpacity={0.86} accessibilityRole="button">
                    <Image source={{ uri: sample.previewUrl }} style={styles.image} />
                    <LinearGradient colors={["rgba(0,0,0,0.0)", "rgba(0,0,0,0.46)", "rgba(0,0,0,0.94)"]} style={styles.cardOverlay} />
                    <View style={styles.cardBody}>
                      {yearLabel ? <Text style={styles.cardYear}>{yearLabel}</Text> : null}
                      <Text style={styles.cardTitle} numberOfLines={2}>{displayTitle}</Text>
                      <Text style={styles.cardSubtitle} numberOfLines={1}>{sample.subtitle}</Text>
                      <View style={styles.cardCtaPill}>
                        <Text style={styles.cardCta}>{isLoading ? "Preparing..." : "Use this photo"}</Text>
                        <Ionicons name="chevron-forward" size={13} color={photoSourceColors.goldLight} />
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const photoSourceColors = {
  background: "#050607",
  panel: "#090A0C",
  text: "#F6F3EE",
  textSoft: "#B8BBC4",
  textMuted: "#757B89",
  line: "rgba(255,255,255,0.09)",
  lineWarm: "rgba(214,158,93,0.26)",
  gold: "#D69E5D",
  goldLight: "#E9B878",
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0, 0, 0, 0.64)" },
  sheet: {
    maxHeight: "94%",
    backgroundColor: photoSourceColors.background,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 28,
    gap: 22,
    shadowColor: "#000000",
    shadowOpacity: 0.48,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -12 },
    elevation: 12,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "rgba(214,158,93,0.12)",
    borderRadius: Radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: photoSourceColors.lineWarm,
  },
  badgeDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: photoSourceColors.goldLight,
  },
  heroBadgeLabel: {
    ...Typography.caption,
    color: photoSourceColors.goldLight,
    textTransform: "uppercase",
    letterSpacing: 2,
    fontSize: 10,
    fontWeight: "900",
  },
  titleBlock: {
    gap: 8,
  },
  title: {
    fontFamily: Typography.title.fontFamily,
    fontSize: 29,
    lineHeight: 34,
    fontWeight: "900",
    color: photoSourceColors.text,
    letterSpacing: 0,
  },
  subtitle: {
    ...Typography.body,
    color: photoSourceColors.textSoft,
    lineHeight: 22,
  },
  libraryButton: {
    borderRadius: 13,
    shadowColor: photoSourceColors.gold,
    shadowOpacity: 0.27,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  libraryButtonFill: {
    minHeight: 55,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  libraryButtonText: {
    ...Typography.bodyStrong,
    color: "#080604",
    fontWeight: "900",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 2,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: photoSourceColors.line,
  },
  dividerText: {
    ...Typography.caption,
    color: photoSourceColors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 2,
    fontSize: 10,
    fontWeight: "900",
  },
  section: {
    gap: 14,
  },
  sectionTitle: {
    ...Typography.caption,
    color: photoSourceColors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 2,
    fontSize: 10,
    fontWeight: "900",
  },
  row: {
    gap: 15,
    paddingRight: 28,
  },
  card: {
    width: 232,
    height: 288,
    backgroundColor: photoSourceColors.panel,
    borderRadius: 17,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    shadowColor: "#000000",
    shadowOpacity: 0.36,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 7,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  cardOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  cardBody: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 17,
    paddingBottom: 17,
    gap: 5,
  },
  cardYear: {
    ...Typography.caption,
    color: photoSourceColors.goldLight,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  cardTitle: {
    fontFamily: Typography.title.fontFamily,
    color: photoSourceColors.text,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "900",
    letterSpacing: 0,
  },
  cardSubtitle: {
    ...Typography.caption,
    color: photoSourceColors.textSoft,
    lineHeight: 17,
  },
  cardCtaPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "rgba(214,158,93,0.13)",
    borderWidth: 1,
    borderColor: "rgba(214,158,93,0.34)",
  },
  cardCta: {
    ...Typography.caption,
    color: photoSourceColors.goldLight,
    fontSize: 11,
    fontWeight: "900",
  },
});
