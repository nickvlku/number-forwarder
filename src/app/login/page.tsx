"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form action={action} className="w-full max-w-sm surface p-6 flex flex-col gap-4">
        <div>
          <div className="wordmark">THE VLKU</div>
          <p className="muted text-sm mt-1">Sign in to the call dashboard.</p>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="label">Password</span>
          <input name="password" type="password" autoFocus required className="input" />
        </label>
        {state.error && <p className="text-sm text-danger" role="alert">{state.error}</p>}
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
