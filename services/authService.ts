import { Session, User } from "@supabase/supabase-js";
import { getSupabaseMobileConfigError, supabase } from "@/lib/supabase";
import { mobileEnv } from "@/lib/env";
import { AuthSignUpResult, AuthUser } from "@/types";

type AuthSession = {
  user: AuthUser;
  accessToken: string;
};

const authEmailRedirectUrl = "carscanr://auth";
const resetPasswordRedirectUrl = "carscanr://reset-password";

let currentSession: AuthSession | null = null;
let hasLoadedInitialSession = false;
let authListenerInitialized = false;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function deriveDisplayName(email: string, rawFullName?: string | null) {
  const supplied = rawFullName?.trim();
  if (supplied) {
    return supplied;
  }

  const localPart = email.split("@")[0] ?? "User";
  const cleaned = localPart.replace(/[^a-z0-9]+/gi, " ").trim();
  if (!cleaned) return "User";
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mapSupabaseUser(user: User): AuthUser {
  const email = normalizeEmail(user.email ?? "");
  const metadata = user.user_metadata as { full_name?: string | null } | null;
  return {
    id: user.id,
    email,
    fullName: deriveDisplayName(email, metadata?.full_name),
  };
}

function mapSession(session: Session | null): AuthSession | null {
  if (!session?.user?.email || !session.access_token) {
    return null;
  }
  return {
    user: mapSupabaseUser(session.user),
    accessToken: session.access_token,
  };
}

function authConfigError() {
  return new Error(getSupabaseMobileConfigError() ?? "Supabase mobile auth is not configured.");
}

function getSupabaseTargetLabel() {
  try {
    return new URL(mobileEnv.supabaseUrl).origin;
  } catch {
    return mobileEnv.supabaseUrl || "invalid-supabase-url";
  }
}

function normalizeAuthError(error: unknown, fallbackMessage: string) {
  const message = error instanceof Error ? error.message : fallbackMessage;
  const lowered = message.toLowerCase();
  if (message.toLowerCase().includes("invalid login credentials")) {
    return new Error("Invalid email or password.");
  }
  if (message.toLowerCase().includes("email not confirmed")) {
    return new Error("Check your email and confirm your account before signing in.");
  }
  if (message.toLowerCase().includes("password should be")) {
    return new Error(message);
  }
  if (lowered.includes("network request failed") || lowered.includes("fetch failed") || lowered.includes("load failed")) {
    return new Error(`Unable to reach Supabase auth at ${getSupabaseTargetLabel()}. Check internet access, HTTPS configuration, and that the Supabase project URL is reachable from this build.`);
  }
  if (
    lowered.includes("error sending confirmation email") ||
    lowered.includes("email could not be sent") ||
    lowered.includes("smtp") ||
    lowered.includes("rate limit")
  ) {
    return new Error("Account created, but the verification email could not be sent. Check Supabase email settings, SMTP configuration, and rate limits.");
  }
  if (lowered.includes("invalid url")) {
    return new Error(`Supabase URL is invalid for this build: ${getSupabaseTargetLabel()}.`);
  }
  return new Error(message || fallbackMessage);
}

async function resetClientAuthState() {
  const [{ scanService }, { subscriptionService }] = await Promise.all([
    import("@/services/scanService"),
    import("@/services/subscriptionService"),
  ]);
  scanService.resetState();
  subscriptionService.resetStatus();
}

function ensureAuthListener() {
  if (authListenerInitialized) {
    return;
  }

  authListenerInitialized = true;
  supabase.auth.onAuthStateChange((event, session) => {
    currentSession = mapSession(session);
    hasLoadedInitialSession = true;
    if (__DEV__) {
      console.log(`[auth] supabase event=${event} session=${session ? "present" : "missing"}`);
    }
    if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
      void resetClientAuthState();
    }
  });
}

async function loadSession() {
  ensureAuthListener();

  if (hasLoadedInitialSession) {
    return currentSession;
  }

  const configError = getSupabaseMobileConfigError();
  if (configError) {
    hasLoadedInitialSession = true;
    currentSession = null;
    if (__DEV__) {
      console.log(`[auth] ${configError}`);
    }
    return null;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw normalizeAuthError(error, "Unable to restore your session.");
  }

  currentSession = mapSession(data.session);
  hasLoadedInitialSession = true;
  if (__DEV__) {
    console.log(`[auth] session restored=${currentSession ? "yes" : "no"}`);
  }
  return currentSession;
}

async function syncSessionFromSupabase() {
  ensureAuthListener();

  const configError = getSupabaseMobileConfigError();
  if (configError) {
    currentSession = null;
    hasLoadedInitialSession = true;
    if (__DEV__) {
      console.log(`[auth] ${configError}`);
    }
    return null;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw normalizeAuthError(error, "Unable to restore your session.");
  }

  currentSession = mapSession(data.session);
  hasLoadedInitialSession = true;
  if (__DEV__) {
    console.log(`[auth] supabase session sync=${currentSession ? "present" : "missing"}`);
  }
  return currentSession;
}

export const authService = {
  async signIn(email: string, password: string): Promise<AuthUser> {
    ensureAuthListener();
    if (getSupabaseMobileConfigError()) {
      throw authConfigError();
    }

    const normalizedEmail = normalizeEmail(email);
    console.log("[auth] sign-in request start", {
      target: "supabase",
      supabaseHost: getSupabaseTargetLabel(),
    });
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) {
      throw normalizeAuthError(error, "Unable to sign in.");
    }

    const session = mapSession(data.session);
    if (!session) {
      throw new Error("Sign-in succeeded, but no Supabase session was returned.");
    }

    currentSession = session;
    hasLoadedInitialSession = true;
    await resetClientAuthState();
    return session.user;
  },

  async signUp(email: string, password: string): Promise<AuthSignUpResult> {
    ensureAuthListener();
    if (getSupabaseMobileConfigError()) {
      throw authConfigError();
    }

    const normalizedEmail = normalizeEmail(email);
    console.log("[auth] sign-up request start", {
      target: "supabase",
      supabaseHost: getSupabaseTargetLabel(),
    });
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: authEmailRedirectUrl,
        data: {
          full_name: deriveDisplayName(normalizedEmail),
        },
      },
    });

    if (error) {
      throw normalizeAuthError(error, "Unable to create your account.");
    }

    const session = mapSession(data.session);
    if (!session) {
      return {
        outcome: "confirmation_required",
        user: data.user ? mapSupabaseUser(data.user) : null,
        message: "Account created. Check your email to verify your account.",
      };
    }

    currentSession = session;
    hasLoadedInitialSession = true;
    await resetClientAuthState();
    return {
      outcome: "signed_in",
      user: session.user,
    };
  },

  async resetPassword(email: string): Promise<void> {
    ensureAuthListener();
    if (getSupabaseMobileConfigError()) {
      throw authConfigError();
    }

    const normalizedEmail = normalizeEmail(email);
    console.log("[auth] password-reset request start", {
      target: "supabase",
      supabaseHost: getSupabaseTargetLabel(),
    });

    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: resetPasswordRedirectUrl,
    });

    if (error) {
      throw normalizeAuthError(error, "Unable to send password reset email.");
    }
  },

  async updatePassword(nextPassword: string): Promise<void> {
    ensureAuthListener();
    if (getSupabaseMobileConfigError()) {
      throw authConfigError();
    }

    const trimmedPassword = nextPassword.trim();
    if (!trimmedPassword) {
      throw new Error("Enter a new password to continue.");
    }

    const { error } = await supabase.auth.updateUser({
      password: trimmedPassword,
    });

    if (error) {
      throw normalizeAuthError(error, "Unable to update your password.");
    }
  },

  async signOut(): Promise<void> {
    ensureAuthListener();
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw normalizeAuthError(error, "Unable to sign out.");
    }
    currentSession = null;
    hasLoadedInitialSession = true;
    await resetClientAuthState();
  },

  async getAccessToken(): Promise<string | null> {
    const token = (await syncSessionFromSupabase())?.accessToken ?? (await loadSession())?.accessToken ?? null;
    console.log(`[auth] accessToken present: ${token ? "yes" : "no"}`);
    return token;
  },

  hasActiveSession(): boolean {
    return Boolean(currentSession?.accessToken);
  },

  async getCurrentUser(): Promise<AuthUser | null> {
    return (await loadSession())?.user ?? null;
  },

  getCurrentUserSync(): AuthUser | null {
    return currentSession?.user ?? null;
  },
};
