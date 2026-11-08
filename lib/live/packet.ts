// The homeowner's packet as the documents a live run sends. Browser side.
//
// Privacy: text leaves this module only after a redactor has run over it. The
// made-up packet PDFs are read and redacted here with ONE redactor session, so
// one person gets one token across all three files; files the homeowner added
// were already redacted by the file board and are passed through as they are.
// The redactor stays with the caller, so drafts that come back carrying tokens
// can be restored on this device and never on the server.
import type { PacketFile } from "@/components/pointer/contract";
import type { AddedDocument } from "@/components/pointer/documents";
import { createRedactor, type Redactor } from "@/lib/redact";
import { FULL_RUN_QUESTION, type LiveDocument, type PreparedLiveRun } from "./run-client";

/** Where the made-up packet PDFs are served from (copied from data/packet/). */
export const PACKET_URL = "/data/packet/";

/** The route's caps (app/api/agent/route.ts BodySchema). */
export const MAX_DOCUMENTS = 20;
export const MAX_TOTAL_CHARS = 100_000;

const TRUNCATED = "\n[Truncated by Pointer: this run's text budget was used up.]";

export type ExtractText = (data: ArrayBuffer) => Promise<{ text: string }>;

export interface CappedDocuments {
  documents: LiveDocument[];
  /** Plain-language notes about anything cut, for the run note. Empty when nothing was. */
  notes: string[];
}

/** Fit documents to the route's caps: at most 20, at most 100,000 characters in all, truncating with a marker. */
export function capDocuments(docs: LiveDocument[]): CappedDocuments {
  const notes: string[] = [];
  const kept = docs.slice(0, MAX_DOCUMENTS);
  if (docs.length > MAX_DOCUMENTS) notes.push(`${docs.length - MAX_DOCUMENTS} file(s) left out (limit ${MAX_DOCUMENTS}).`);
  let budget = MAX_TOTAL_CHARS;
  const documents: LiveDocument[] = [];
  let cut = 0;
  for (const d of kept) {
    if (d.text.length <= budget) {
      documents.push(d);
      budget -= d.text.length;
      continue;
    }
    cut += 1;
    const room = Math.max(0, budget - TRUNCATED.length);
    const text = room > 0 ? d.text.slice(0, room) + TRUNCATED : "";
    documents.push({ ...d, text });
    budget -= text.length;
  }
  if (cut > 0) notes.push(`${cut} file(s) truncated to fit the ${MAX_TOTAL_CHARS.toLocaleString("en-US")}-character limit.`);
  return { documents, notes };
}

export interface PacketDocumentsInput {
  packet: PacketFile[];
  added: AddedDocument[];
  redactor: Redactor;
  extract: ExtractText;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** Read, extract and redact the packet PDFs, then append the added files. Throws if a packet file cannot be read. */
export async function buildPacketDocuments(input: PacketDocumentsInput): Promise<CappedDocuments> {
  const fetchImpl = input.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const packetDocs: LiveDocument[] = [];
  for (const f of input.packet) {
    const res = await fetchImpl(PACKET_URL + encodeURIComponent(f.name), { signal: input.signal });
    if (!res.ok) throw new Error(`could not read ${f.name} (${res.status})`);
    const { text } = await input.extract(await res.arrayBuffer());
    packetDocs.push({ name: f.name, declared_type: f.declared_type, text: input.redactor.redact(text).text });
  }
  const addedDocs = input.added.map((d) => ({ name: d.name, declared_type: d.declared_type, text: d.text }));
  return capDocuments([...packetDocs, ...addedDocs]);
}

/** A redactor for the made-up applicant, seeded with the names in data/packet/applicant.json. */
export function packetRedactor(applicant: { name?: string; co_owner?: string }): Redactor {
  return createRedactor({ knownNames: [applicant.name, applicant.co_owner].filter((n): n is string => Boolean(n)) });
}

/** The browser's PDF text extractor, loaded on demand (pdf.js must never load during SSR). */
export const extractInBrowser: ExtractText = async (data) => {
  const { extractPdfText } = await import("@/components/stage/pdfjs");
  return extractPdfText(data);
};

export interface PacketRunInput {
  city: string;
  projectType: string;
  packet: PacketFile[];
  added: AddedDocument[];
  applicant: { name?: string; co_owner?: string };
  signal?: AbortSignal;
  extract?: ExtractText;
  fetchImpl?: typeof fetch;
}

/**
 * Everything a full live run sends, plus a local `restore` for the drafts that
 * come back. Restoring is only safe when every token came from this one session:
 * a file the homeowner added was tokenized by the file board's own session, so
 * its [NAME_1] may be a different person. Then drafts keep their tokens.
 */
export async function preparePacketRun(input: PacketRunInput): Promise<PreparedLiveRun> {
  const redactor = packetRedactor(input.applicant);
  const { documents, notes } = await buildPacketDocuments({
    packet: input.packet,
    added: input.added,
    redactor,
    extract: input.extract ?? extractInBrowser,
    fetchImpl: input.fetchImpl,
    signal: input.signal,
  });
  const foreignTokens = input.added.some((d) => d.hidden > 0);
  return {
    request: { city: input.city, projectType: input.projectType, question: FULL_RUN_QUESTION, documents },
    restore: foreignTokens ? undefined : (text) => redactor.restore(text),
    notes,
  };
}
