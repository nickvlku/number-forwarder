import { redirect } from "next/navigation";

export async function GET(_req: Request, ctx: { params: Promise<{ sid: string }> }) {
  const { sid } = await ctx.params;
  redirect(`/?item=${encodeURIComponent(sid)}`);
}
