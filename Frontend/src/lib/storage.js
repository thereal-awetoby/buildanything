// Drop-in replacement for the Claude-artifact `window.storage` API so the
// rest of the app didn't need to change. Backed by localStorage, so it's
// per-browser, not per-account — swap the implementation for a real
// backend (Postgres, Supabase, etc.) if you need data to follow a user
// across devices.

const PREFIX = "vibeforge:";

export const storage = {
  async get(key) {
    try {
      const raw = window.localStorage.getItem(PREFIX + key);
      return raw === null ? null : { key, value: raw };
    } catch (e) {
      return null;
    }
  },
  async set(key, value) {
    try {
      window.localStorage.setItem(PREFIX + key, value);
      return { key, value };
    } catch (e) {
      return null;
    }
  },
  async delete(key) {
    try {
      window.localStorage.removeItem(PREFIX + key);
      return { key, deleted: true };
    } catch (e) {
      return null;
    }
  },
};
