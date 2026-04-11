"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AlertToast } from "./AlertToast";

export type Alert = {
  title?: string;
  message: string;
};

type AlertContextValue = {
  pushAlert: (alert: Alert) => void;
};

const AlertContext = createContext<AlertContextValue | null>(null);

export function useAlert(): AlertContextValue {
  const ctx = useContext(AlertContext);
  if (!ctx) {
    throw new Error("useAlert must be used within an AlertProvider");
  }
  return ctx;
}

export function AlertProvider({ children }: { children: ReactNode }) {
  const queueRef = useRef<Alert[]>([]);
  const [current, setCurrent] = useState<Alert | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNext = useCallback(() => {
    if (queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      setCurrent(next);
    } else {
      setCurrent(null);
    }
  }, []);

  const dismiss = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    showNext();
  }, [showNext]);

  const pushAlert = useCallback((alert: Alert) => {
    queueRef.current.push(alert);
    // If nothing is currently displayed, show immediately
    setCurrent((prev) => {
      if (prev === null) {
        return queueRef.current.shift()!;
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    if (current) {
      timerRef.current = setTimeout(() => {
        showNext();
      }, 3000);
      return () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      };
    }
  }, [current, showNext]);

  return (
    <AlertContext.Provider value={{ pushAlert }}>
      {children}
      {current && <AlertToast alert={current} onDismiss={dismiss} />}
    </AlertContext.Provider>
  );
}
