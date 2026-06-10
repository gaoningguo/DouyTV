import { useEffect, useRef, useState, type ReactNode } from "react";

type DialogTone = "info" | "warning" | "danger";
type DialogMode = "alert" | "confirm";

export interface AppDialogOptions {
  title?: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: DialogTone;
}

interface DialogRequest extends AppDialogOptions {
  id: number;
  mode: DialogMode;
  resolve: (value: boolean) => void;
}

let nextId = 1;
let showDialog: ((request: DialogRequest) => void) | null = null;

function fallbackMessage(message: ReactNode): string {
  return typeof message === "string" ? message : "请确认当前操作";
}

function requestDialog(mode: DialogMode, message: ReactNode, options: AppDialogOptions = {}) {
  if (!showDialog) {
    if (mode === "confirm") {
      return Promise.resolve(window.confirm(fallbackMessage(message)));
    }
    window.alert(fallbackMessage(message));
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    showDialog?.({
      id: nextId++,
      mode,
      message,
      resolve,
      ...options,
    });
  });
}

export function appAlert(message: ReactNode, options?: AppDialogOptions) {
  return requestDialog("alert", message, options).then(() => undefined);
}

export function appConfirm(message: ReactNode, options?: AppDialogOptions) {
  return requestDialog("confirm", message, options);
}

function titleFor(request: DialogRequest) {
  if (request.title) return request.title;
  if (request.tone === "danger") return "危险操作";
  if (request.tone === "warning") return "确认操作";
  return request.mode === "confirm" ? "确认" : "提示";
}

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<DialogRequest | null>(null);
  const queueRef = useRef<DialogRequest[]>([]);
  const currentRef = useRef<DialogRequest | null>(null);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    showDialog = (request) => {
      if (currentRef.current) {
        queueRef.current.push(request);
        return;
      }
      setCurrent(request);
    };
    return () => {
      showDialog = null;
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const finish = (value: boolean) => {
    const request = currentRef.current;
    if (!request) return;
    request.resolve(value);
    const next = queueRef.current.shift() ?? null;
    currentRef.current = next;
    setCurrent(next);
  };

  return (
    <>
      {children}
      {current && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center px-4 animate-fade-in">
          <button
            type="button"
            aria-label="关闭弹窗"
            className="absolute inset-0 cursor-default"
            style={{ background: "rgba(0,0,0,0.62)" }}
            onClick={() => finish(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-[360px] rounded-xl p-4 animate-toast-in"
            style={{
              background: "rgba(22, 24, 29, 0.98)",
              border: "1px solid var(--cream-line)",
              boxShadow: "0 28px 70px -30px rgba(0,0,0,0.9)",
            }}
          >
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    background:
                      current.tone === "danger"
                        ? "#FF6B6B"
                        : current.tone === "warning"
                          ? "var(--ember)"
                          : "var(--phosphor)",
                    boxShadow:
                      current.tone === "danger"
                        ? "0 0 14px rgba(255,107,107,0.5)"
                        : current.tone === "warning"
                          ? "0 0 14px var(--ember-glow)"
                          : "0 0 14px rgba(124,255,178,0.35)",
                  }}
                />
                <h2 className="text-base font-display font-semibold text-cream">
                  {titleFor(current)}
                </h2>
              </div>
              <div className="text-sm leading-6 text-cream-dim break-words">
                {current.message}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              {current.mode === "confirm" && (
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg text-xs font-display text-cream-dim tap"
                  style={{
                    background: "var(--ink-3)",
                    border: "1px solid var(--cream-line)",
                  }}
                  onClick={() => finish(false)}
                >
                  {current.cancelText ?? "取消"}
                </button>
              )}
              <button
                type="button"
                className="px-4 py-2 rounded-lg text-xs font-display font-semibold tap"
                style={{
                  background: current.tone === "danger" ? "#FF6B6B" : "var(--ember)",
                  color: "var(--ink)",
                }}
                autoFocus
                onClick={() => finish(true)}
              >
                {current.confirmText ?? "确定"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
