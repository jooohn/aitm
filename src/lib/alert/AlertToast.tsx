"use client";

import type { Alert } from "./AlertContext";

type AlertToastProps = {
  alert: Alert;
  onDismiss: () => void;
};

export function AlertToast({ alert, onDismiss }: AlertToastProps) {
  return (
    <div
      role="alert"
      className="fixed top-4 right-4 z-50 max-w-sm rounded-lg border border-red-200 bg-red-50 p-4 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {alert.title && (
            <p className="text-sm font-semibold text-red-800">{alert.title}</p>
          )}
          <p className="text-sm text-red-700">{alert.message}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded p-1 text-red-400 hover:bg-red-100 hover:text-red-600"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
