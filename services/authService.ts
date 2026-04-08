import { Session, User } from "@supabase/supabase-js";
import { getSupabaseMobileConfigError, supabase } from "@/lib/supabase";
import { AuthUser } from "@/types";

type AuthSession = {
  user: AuthUser;
  accessToken: string;
};

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

function normalizeAuthError(error: unknown, fallbackMessage: string) {
  const message = error instanceof Error ? error.message : fallbackMessage;
  if (message.toLowerCase().includes("invalid login credentials")) {
    return new Error("Invalid email or password.");
  }
  if (message.toLowerCase().includes("email not confirmed")) {
    return new Error("Check your email and confirm your account before signing in.");
  }
  if (message.toLowerCase().includes("password should be")) {
    return new Error(message);
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

export const authService = {
  async signIn(email: string, password: string): Promise<AuthUser> {
    ensureAuthListener();
    if (getSupabaseMobileConfigError()) {
      throw authConfigError();
    }

    const normalizedEmail = normalizeEmail(email);
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

  async signUp(email: string, password: string): Promise<AuthUser> {
    ensureAuthListener();
    if (getSupabaseMobileConfigError()) {
      throw authConfigError();
    }

    const normalizedEmail = normalizeEmail(email);
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
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
      throw new Error("Account created. Check your email to confirm the account, then sign in.");
    }

    currentSession = session;
    hasLoadedInitialSession = true;
    await resetClientAuthState();
    return session.user;
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
    const token = (await loadSession())?.accessToken ?? null;
    if (__DEV__) {
      console.log(`[auth] accessToken ${token ? "present" : "missing"}`);
    }
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
