import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Image, StyleSheet, Text, TextInput, View } from "react-native";
import { AppContainer } from "@/components/AppContainer";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useSubscription } from "@/hooks/useSubscription";
import { authService } from "@/services/authService";
import { Colors, Radius, Typography } from "@/constants/theme";

export default function AuthScreen() {
  const params = useLocalSearchParams<{ mode?: "sign-in" | "sign-up" }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { refreshStatus } = useSubscription();

  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      const token = await authService.getAccessToken();
      if (!active) return;
      if (token) {
        await refreshStatus();
        router.replace("/(tabs)/scan");
      }
    };
    hydrate().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [refreshStatus]);

  useEffect(() => {
    if (params.mode === "sign-in" || params.mode === "sign-up") {
      setMode(params.mode);
      setEmail("");
      setPassword("");
    }
  }, [params.mode]);

  const submit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPassword = password.trim();

    if (!normalizedEmail || !normalizedPassword) {
      Alert.alert(mode === "sign-in" ? "Sign in required" : "Create account required", "Enter an email and password to continue.");
      return;
    }

    try {
      setIsSubmitting(true);
      if (mode === "sign-in") {
        await authService.signIn(normalizedEmail, normalizedPassword);
      } else {
        await authService.signUp(normalizedEmail, normalizedPassword);
      }
      await refreshStatus();
      router.replace("/(tabs)/scan");
    } catch (error) {
      Alert.alert(mode === "sign-in" ? "Unable to sign in" : "Unable to create account", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppContainer>
      <View style={styles.brandWrap}>
        <View style={styles.logoShell}>
          <Image source={require("@/carscanr_app_icon_1024.png")} style={styles.logoImage} resizeMode="cover" />
        </View>
        <View style={styles.brandTextWrap}>
          <View style={styles.brandPill}>
            <Text style={styles.brandEyebrow}>CarScanr</Text>
          </View>
          <Text style={styles.brandName}>Identify. Value. Shop.</Text>
          <Text style={styles.brandNote}>Photo-first vehicle recognition with pricing and listings in one flow.</Text>
        </View>
      </View>
      <Text style={styles.title}>{mode === "sign-in" ? "Welcome back." : "Create your account."}</Text>
      <Text style={styles.subtitle}>
        {mode === "sign-in"
          ? "Sign in to sync your Garage, usage, and future subscription access."
          : "Start free and save your Garage, usage, and subscription access to your account."}
      </Text>
      <View style={styles.card}>
        <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" style={styles.input} placeholder="Email" placeholderTextColor={Colors.textMuted} />
        <TextInput value={password} onChangeText={setPassword} secureTextEntry style={styles.input} placeholder="Password" placeholderTextColor={Colors.textMuted} />
        <PrimaryButton label={isSubmitting ? "Working..." : mode === "sign-in" ? "Sign In" : "Create Account"} onPress={submit} disabled={isSubmitting} />
        <PrimaryButton
          label="Continue with Apple"
          secondary
          onPress={() => {
            Alert.alert("Apple sign-in unavailable", "Apple sign-in is not wired yet. Please use email and password for now.");
          }}
        />
      </View>
      <Text style={styles.switchText} onPress={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}>
        {mode === "sign-in" ? "Need an account? Create one for free." : "Already have an account? Sign in."}
      </Text>
    </AppContainer>
  );
}

const styles = StyleSheet.create({
  brandWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 8,
  },
  logoShell: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  logoImage: {
    width: 72,
    height: 72,
    borderRadius: 24,
  },
  brandTextWrap: {
    gap: 4,
    flex: 1,
  },
  brandPill: {
    alignSelf: "flex-start",
    backgroundColor: Colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  brandEyebrow: {
    ...Typography.caption,
    color: Colors.accent,
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  brandName: {
    ...Typography.heading,
    color: Colors.text,
  },
  brandNote: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  title: { ...Typography.largeTitle, color: Colors.text, marginTop: 16 },
  subtitle: { ...Typography.body, color: Colors.textMuted },
  card: { backgroundColor: Colors.card, borderRadius: Radius.xl, padding: 20, gap: 14 },
  input: { backgroundColor: Colors.cardAlt, borderRadius: Radius.md, padding: 16, color: Colors.text, ...Typography.body },
  switchText: { ...Typography.body, color: Colors.accent, textAlign: "center" },
});
