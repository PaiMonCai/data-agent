"use client";

import { BarChart3 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Cloud } from "@/lib/api";
import type { User } from "@/lib/types";

export default function AuthView({ onAuthed }: { onAuthed: (user: User) => void }) {
  const [mode, setMode] = useState<"password" | "otp" | "signup" | "reset">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [verificationId, setVerificationId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    if (!email) return setMessage("åå¡«åé®ç®±");
    setBusy(true); setMessage("");
    try {
      const purpose = mode === "signup" ? "signup" : mode === "reset" ? "reset" : "login";
      const r = await Cloud.auth.sendOtp({ email, purpose });
      if (r.error || !r.data) throw r.error || new Error("åéå¤±è´¥");
      setVerificationId(r.data.verificationId);
      setMessage("éªè¯ç å·²åéï¼è¯·æ£æ¥é®ç®±");
    } catch (e) {
      setMessage(Cloud.errText(e));
    } finally { setBusy(false); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMessage("");
    try {
      if (mode === "password") {
        const r = await Cloud.auth.signInWithPassword({ email, password });
        if (r.error || !r.data?.user) throw r.error || new Error("ç»å½å¤±è´¥");
        onAuthed(r.data.user);
        return;
      }

      if (!verificationId) throw new Error("è¯·ååééªè¯ç ");
      if (!code) throw new Error("è¯·è¾å¥éªè¯ç ");

      if (mode === "reset") {
        const r = await Cloud.auth.resetPassword({
          email, verificationId, nonce: code, password,
        });
        if (r.error || !r.data?.user) throw r.error || new Error("éç½®å¤±è´¥");
        onAuthed(r.data.user);
        return;
      }

      const purpose = mode === "signup" ? "signup" : "login";
      const r = await Cloud.auth.verifyOtp({
        verificationId, token: code, email, purpose,
        ...(mode === "signup" ? { password } : {}),
      });
      if (r.error || !r.data?.user) throw r.error || new Error("éªè¯å¤±è´¥");
      onAuthed(r.data.user);
    } catch (e) {
      setMessage(Cloud.errText(e));
    } finally { setBusy(false); }
  };

  const tabs = [
    ["password", "å¯ç ç»å½"],
    ["otp", "éªè¯ç "],
    ["signup", "æ³¨å"],
  ] as const;

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="surface w-full max-w-md rounded-3xl border p-7 shadow-[0_24px_70px_rgba(15,23,42,.10)]">
        <div className="mb-7 flex items-center gap-3">
          <div className="brand-bg grid size-11 place-items-center rounded-2xl text-white"><BarChart3 size={22} /></div>
          <div>
            <h1 className="text-xl font-semibold">Data Agent</h1>
            <p className="muted mt-1 text-sm">ä¸ä¼ æ°æ®ï¼ç¨èªç¶è¯­è¨å®æåæä¸æ¸æ´</p>
          </div>
        </div>

        <div className="surface-2 mb-6 grid grid-cols-3 rounded-xl p-1">
          {tabs.map(([value, label]) => (
            <button key={value} type="button" onClick={() => { setMode(value); setMessage(""); }}
              className={`rounded-lg px-3 py-2 text-sm transition ${mode === value ? "surface shadow-sm" : "muted"}`}>
              {label}
            </button>
          ))}
        </div>

        {mode === "reset" && (
          <button className="muted mb-4 text-sm hover:underline" onClick={() => setMode("password")}>â è¿åç»å½</button>
        )}

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">é®ç®±</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="surface-2 border-ui w-full rounded-xl border px-3.5 py-3 outline-none focus:border-[var(--brand)]"
              placeholder="you@example.com" />
          </label>

          {(mode === "password" || mode === "signup" || mode === "reset") && (
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">{mode === "reset" ? "æ°å¯ç " : "å¯ç "}</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                className="surface-2 border-ui w-full rounded-xl border px-3.5 py-3 outline-none focus:border-[var(--brand)]"
                placeholder="è³å° 8 ä½" />
            </label>
          )}

          {mode !== "password" && (
            <div>
              <span className="mb-1.5 block text-sm font-medium">é®ç®±éªè¯ç </span>
              <div className="flex gap-2">
                <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric"
                  className="surface-2 border-ui min-w-0 flex-1 rounded-xl border px-3.5 py-3 outline-none focus:border-[var(--brand)]"
                  placeholder="6 ä½éªè¯ç " />
                <button type="button" disabled={busy} onClick={sendCode}
                  className="surface border-ui rounded-xl border px-4 text-sm font-medium hover:brand-soft">
                  åé
                </button>
              </div>
            </div>
          )}

          {message && <p className="text-sm text-[var(--danger)]">{message}</p>}

          <button disabled={busy} className="brand-bg w-full rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50">
            {busy ? "å¤çä¸­â¦" : mode === "password" ? "ç»å½" : mode === "reset" ? "éç½®å¹¶ç»å½" : mode === "signup" ? "åå»ºè´¦å·" : "éªè¯å¹¶ç»å½"}
          </button>

          {mode === "password" && (
            <button type="button" onClick={() => setMode("reset")} className="muted w-full text-sm hover:underline">
              å¿è®°å¯ç ï¼
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
