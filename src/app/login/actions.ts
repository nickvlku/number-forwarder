"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { createSessionToken, passwordMatches, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const env = getEnv();
  const given = String(formData.get("password") ?? "");
  if (!passwordMatches(env.DASHBOARD_PASSWORD, given)) {
    await new Promise((r) => setTimeout(r, 500)); // slow down guessing
    return { error: "Wrong password." };
  }
  (await cookies()).set(SESSION_COOKIE, createSessionToken(env.SESSION_SECRET), {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  redirect("/");
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
