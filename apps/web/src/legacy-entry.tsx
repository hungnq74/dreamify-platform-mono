"use client";

import { useEffect } from "react";
import { BrowserRouter } from "@/lib/navigation";
import ReactGA from "react-ga4";

import App from "@/App";
import { DreamifyAuthProvider, useAuth } from "@/lib/clerk";
import { apiClient } from "@/services/api";
import { useNotificationStore } from "@/chat/useNotificationStore";


function TokenBridge() {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  useEffect(() => {
    apiClient.setAuthTokenProvider(async () => {
      try {
        return await getToken();
      } catch {
        return null;
      }
    });
  }, [getToken]);

  // Clear session-scoped polling and state on sign-out. Without this the
  // notification interval outlived the session and kept issuing requests that
  // could only 401, with the failures going to console.error and nowhere else.
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      useNotificationStore.getState().reset();
    }
  }, [isLoaded, isSignedIn]);

  return null;
}

export default function LegacyEntry() {
  useEffect(() => {
    const normalizedPathname = window.location.pathname.replace(/\/{2,}/g, "/");
    if (normalizedPathname !== window.location.pathname) {
      window.history.replaceState(window.history.state, "", `${normalizedPathname}${window.location.search}${window.location.hash}`);
    }

    const measurementId = process.env.NEXT_PUBLIC_GA_ID;
    if (measurementId) ReactGA.initialize(measurementId);
  }, []);

  return (
    <BrowserRouter>
      <DreamifyAuthProvider>
        <TokenBridge />
        <App />
      </DreamifyAuthProvider>
    </BrowserRouter>
  );
}
