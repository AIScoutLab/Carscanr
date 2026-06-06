import { StyleSheet, Text, View } from "react-native";
import { AppContainer } from "@/components/AppContainer";
import { BackButton } from "@/components/BackButton";
import { Colors, Radius, Typography } from "@/constants/theme";
import { LegalDocument, LegalSection } from "@/constants/legalContent";

type Props = {
  document: LegalDocument;
};

export function LegalDocumentScreen({ document }: Props) {
  return (
    <AppContainer contentContainerStyle={styles.content}>
      <BackButton fallbackHref="/(tabs)/profile" label="Profile" />
      <View style={styles.header}>
        <Text style={styles.eyebrow}>LEGAL</Text>
        <Text style={styles.title}>{document.title}</Text>
        <Text style={styles.updated}>{document.updatedLabel}</Text>
        <Text style={styles.summary}>{document.summary}</Text>
      </View>
      <View style={styles.sections}>
        {document.sections.map((section) => (
          <DocumentSection key={section.heading} section={section} />
        ))}
      </View>
    </AppContainer>
  );
}

function DocumentSection({ section }: { section: LegalSection }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeading}>{section.heading}</Text>
      {section.paragraphs?.map((paragraph) => (
        <Text key={paragraph} style={styles.body}>
          {paragraph}
        </Text>
      ))}
      {section.items?.map((item) => (
        <Text key={item} style={styles.body}>
          {`- ${item}`}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 18,
  },
  header: {
    borderRadius: Radius.xl,
    padding: 20,
    gap: 9,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  eyebrow: {
    ...Typography.caption,
    fontWeight: "900",
    letterSpacing: 0,
    color: Colors.premium,
  },
  title: {
    ...Typography.title,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "900",
    letterSpacing: 0,
    color: Colors.textStrong,
  },
  updated: {
    ...Typography.caption,
    letterSpacing: 0,
    color: Colors.textMuted,
  },
  summary: {
    ...Typography.body,
    letterSpacing: 0,
    color: Colors.textSoft,
  },
  sections: {
    gap: 14,
  },
  section: {
    borderRadius: Radius.lg,
    padding: 17,
    gap: 9,
    backgroundColor: Colors.cardSoft,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sectionHeading: {
    ...Typography.heading,
    letterSpacing: 0,
    color: Colors.textStrong,
  },
  body: {
    ...Typography.body,
    letterSpacing: 0,
    color: Colors.textSoft,
  },
});
