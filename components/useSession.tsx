"use client";

import { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { api } from "@/trpc/react";

type SessionContextType = {
  session: Session | null;
  user: any; // Type from your TRPC user query
  isLoading: boolean;
  error: any;
  refetch: () => void;
};

const SessionContext = createContext<SessionContextType | undefined>(undefined);

const supabase = createClient();

export const SessionProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const utils = api.useUtils();

  const {
    data: user,
    isLoading,
    error,
    refetch,
  } = api.user.currentUser.useQuery(undefined, {
    enabled: !!session,
    refetchOnWindowFocus: false,
  });

  // Preload critical data when user is authenticated
  useEffect(() => {
    if (!user || isLoading) return;

    // Preload only the most critical data immediately
    // Less critical data will be loaded on-demand with caching
    void Promise.all([
      // Critical: Team members - needed immediately for assignee dropdowns
      utils.mailbox.members.list.ensureData(),
      // Critical: Issue groups - needed immediately for filters
      utils.mailbox.issueGroups.listAll.ensureData(),
      // Less critical: Open counts can load slightly later (500ms delay)
      new Promise<void>((resolve) => setTimeout(() => resolve(), 500)).then(() => utils.mailbox.openCount.ensureData()),
    ]);
  }, [user, isLoading, utils]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        setSession(session);
        refetch();
      }
    });

    return () => subscription.unsubscribe();
  }, [refetch]);

  return (
    <SessionContext.Provider
      value={{
        session,
        user,
        isLoading,
        error,
        refetch,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error("useSessionContext must be used within a SessionProvider");
  }
  return context;
};
