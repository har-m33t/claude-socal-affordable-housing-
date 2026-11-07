// Serves the mock checklist PDF from fixtures/ so the UI lane needn't touch public/.
// Allowlisted names only, so no path traversal. Delete this route once Team 1's real
// checklist PDF is served.
import { readFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED: Record<string, string> = {
  "mock-checklist.pdf": "application/pdf",
};

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const type = ALLOWED[name];
  if (!type) return new Response("Not found", { status: 404 });
  const body = await readFile(path.join(process.cwd(), "fixtures", name));
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
