export async function getDatabase() {
  const runtime = await import("cloudflare:workers");
  return runtime.env.DB;
}
