import { create } from "zustand";
import { persist } from "zustand/middleware";

export type VncClient = "system" | "internal";

interface VncClientSettings {
  client: VncClient;
  remembered: boolean;
  rememberClient: (client: VncClient) => void;
}

export const useVncClientSettings = create<VncClientSettings>()(
  persist(
    (set) => ({
      client: "internal",
      remembered: false,
      rememberClient: (client) => set({ client, remembered: true }),
    }),
    {
      name: "oria-tunnel.vnc-client.v1",
      partialize: ({ client, remembered }) => ({ client, remembered }),
      merge: (saved, current) => {
        const prefs = saved as Partial<VncClientSettings> | null;
        if (
          prefs?.remembered !== true ||
          (prefs.client !== "internal" && prefs.client !== "system")
        )
          return current;
        return {
          ...current,
          client: prefs.client,
          remembered: true,
        };
      },
    },
  ),
);
