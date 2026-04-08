import { Modal, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
        <Pressable style={styles.scrim} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Choose a photo source</Text>
          <Text style={styles.subtitle}>Use your library or try a few sample vehicles so the scan flow still feels real in the simulator.</Text>
          <PrimaryButton label="Open Photo Library" onPress={onOpenLibrary} secondary />
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sample Vehicles</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {samples.map((sample) => {
                const isLoading = loadingSampleId === sample.id;
                return (
                  <Pressable key={sample.id} style={styles.card} onPress={() => onSelectSample(sample.id)}>
                    <Image source={{ uri: sample.previewUrl }} style={styles.image} />
                    <View style={styles.cardBody}>
                      <Text style={styles.cardTitle}>{sample.title}</Text>
                      <Text style={styles.cardSubtitle}>{sample.subtitle}</Text>
                      <Text style={styles.cardCta}>{isLoading ? "Preparing sample..." : "Use this photo"}</Text>
                    </View>
                  </Pressable>
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
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15, 23, 42, 0.28)" },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: 20,
    gap: 18,
    ...Shadows.card,
  },
  handle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
  },
  title: { ...Typography.title, color: Colors.text },
  subtitle: { ...Typography.body, color: Colors.textMuted },
  section: { gap: 12 },
  sectionTitle: { ...Typography.heading, color: Colors.text },
  row: { gap: 14, paddingRight: 20 },
  card: {
    width: 240,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    overflow: "hidden",
    ...Shadows.card,
  },
  image: { width: "100%", height: 144 },
  cardBody: { padding: 14, gap: 6 },
  cardTitle: { ...Typography.heading, color: Colors.text },
  cardSubtitle: { ...Typography.caption, color: Colors.textMuted },
  cardCta: { ...Typography.caption, color: Colors.accent },
});
