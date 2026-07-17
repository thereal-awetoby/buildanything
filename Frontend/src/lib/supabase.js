import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// If the env vars aren't set, this stays null and the app just runs
// local-only, same as before — cloud sync is additive, not required.
export const supabase =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export async function loadCloudData(walletAddress) {
  if (!supabase || !walletAddress) return null;
  try {
    const { data, error } = await supabase
      .from("user_data")
      .select("data")
      .eq("wallet_address", walletAddress.toLowerCase())
      .maybeSingle();
    if (error) {
      console.error("Failed to load cloud data:", error);
      return null;
    }
    return data?.data || null;
  } catch (err) {
    console.error("Failed to load cloud data:", err);
    return null;
  }
}

export async function saveCloudData(walletAddress, payload) {
  if (!supabase || !walletAddress) return false;
  try {
    const { error } = await supabase.from("user_data").upsert(
      {
        wallet_address: walletAddress.toLowerCase(),
        data: payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet_address" }
    );
    if (error) {
      console.error("Failed to save cloud data:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Failed to save cloud data:", err);
    return false;
  }
}