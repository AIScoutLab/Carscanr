import { Modal, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Colors, Radius, Shadows, Typography } from "@/constants/theme";
import { PrimaryButton } from "@/components/PrimaryButton";
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
          <View style={styles.handle} />
          <LinearGradient colors={["rgba(29,140,255,0.18)", "rgba(94,231,255,0.05)", "rgba(4,8,18,0.12)"]} style={styles.heroCard}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeLabel}>Photo source</Text>
            </View>
            <Text style={styles.title}>Choose a photo source</Text>
            <Text style={styles.subtitle}>Use your library or try a few sample vehicles so the scan flow still feels real in the simulator.</Text>
          </LinearGradient>
          <PrimaryButton label="Open Photo Library" onPress={onOpenLibrary} secondary />
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sample Vehicles</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {samples.map((sample) => {
                const isLoading = loadingSampleId === sample.id;
                return (
                  <TouchableOpacity key={sample.id} style={styles.card} onPress={() => onSelectSample(sample.id)} activeOpacity={0.86} accessibilityRole="button">
                    <Image source={{ uri: sample.previewUrl }} style={styles.image} />
                    <View style={styles.cardBody}>
                      <Text style={styles.cardTitle}>{sample.title}</Text>
                      <Text style={styles.cardSubtitle}>{sample.subtitle}</Text>
                      <Text style={styles.cardCta}>{isLoading ? "Preparing sample..." : "Use this photo"}</Text>
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

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(4, 8, 18, 0.52)" },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: 20,
    gap: 18,
    ...Shadows.card,
    borderTopWidth: 1,
    borderColor: Colors.border,
  },
  handle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
  },
  heroCard: {
    borderRadius: Radius.xl,
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heroBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(0, 194, 255, 0.12)",
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.cyanGlow,
  },
  heroBadgeLabel: {
    ...Typography.caption,
    color: Colors.premium,
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  title: { ...Typography.title, color: Colors.text },
  subtitle: { ...Typography.body, color: Colors.textSoft },
  section: { gap: 12 },
  sectionTitle: { ...Typography.heading, color: Colors.textStrong },
  row: { gap: 14, paddingRight: 20 },
  card: {
    width: 240,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    overflow: "hidden",
    ...Shadows.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  image: { width: "100%", height: 144 },
  cardBody: { padding: 14, gap: 6 },
  cardTitle: { ...Typography.heading, color: Colors.textStrong },
  cardSubtitle: { ...Typography.caption, color: Colors.textSoft },
  cardCta: { ...Typography.caption, color: Colors.premium },
});
