import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseMobileConfigError, isSupabaseMobileConfigured, mobileEnv } from "@/lib/env";

const fallbackSupabaseUrl = "https://your-project.supabase.co";
const fallbackSupabaseAnonKey = "public-anon-key-placeholder";

export const supabase = createClient(mobileEnv.supabaseUrl || fallbackSupabaseUrl, mobileEnv.supabaseAnonKey || fallbackSupabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: "carscanr.supabase.auth.token",
  },
});

export { isSupabaseMobileConfigured, getSupabaseMobileConfigError };
