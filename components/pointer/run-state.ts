// Pure reducer: the editor's state is a fold over agent events plus the applicant's
// accept/reject decisions. The report page reuses it, so the editor and the report always agree.
import { normalizeCitation, type AgentEvent, type CityConfig, type Citation, type ItemStatus } from "./contract";

export interface Suggestion {
  id: string; // event index, unique within a run
  text: string;
  citation?: Citation;
  decision: "pending" | "accepted" | "rejected";
}

export interface ItemState {
  status?: ItemStatus;
  statusText?: string;
  highlighted: boolean;
  highlightText?: string;
  notes: string[];
  suggestions: Suggestion[];
  citations: Citation[];
}

export interface LogEntry {
  index: number;
  event: AgentEvent;
  citation?: Citation;
  rejected?: string; // why the UI refused this event
}

export interface RunState {
  items: Record<string, ItemState>;
  pointedItem?: string;
  log: LogEntry[];
}

export function emptyItem(): ItemState {
  return { highlighted: false, notes: [], suggestions: [], citations: [] };
}

export function initialRunState(): RunState {
  return { items: {}, log: [] };
}

export function applyEvent(state: RunState, event: AgentEvent, index: number, city: CityConfig): RunState {
  const citation = normalizeCitation(event.citation);
  // Security: item IDs must exist in the loaded city file, otherwise the event is ignored.
  if (!city.checklist.some((c) => c.id === event.item_id)) {
    return { ...state, log: [...state.log, { index, event, citation, rejected: `unknown item_id "${event.item_id}"` }] };
  }
  const prev = state.items[event.item_id] ?? emptyItem();
  const item: ItemState = { ...prev, citations: citation ? [...prev.citations, citation] : prev.citations };
  let pointedItem = state.pointedItem;

  switch (event.tool) {
    case "point_to":
      pointedItem = event.item_id;
      break;
    case "highlight":
      pointedItem = event.item_id;
      item.highlighted = true;
      item.highlightText = event.text;
      break;
    case "mark_item":
      if (!event.status) {
        return { ...state, log: [...state.log, { index, event, citation, rejected: "mark_item without status" }] };
      }
      item.status = event.status;
      item.statusText = event.text;
      break;
    case "draft_field":
      if (!event.text) {
        return { ...state, log: [...state.log, { index, event, citation, rejected: "draft_field without text" }] };
      }
      item.suggestions = [...prev.suggestions, { id: `s${index}`, text: event.text, citation, decision: "pending" }];
      break;
    case "add_note":
      if (event.text) item.notes = [...prev.notes, event.text];
      break;
  }
  return {
    items: { ...state.items, [event.item_id]: item },
    pointedItem,
    log: [...state.log, { index, event, citation }],
  };
}

export function decide(state: RunState, itemId: string, suggestionId: string, decision: "accepted" | "rejected"): RunState {
  const item = state.items[itemId];
  if (!item) return state;
  return {
    ...state,
    items: {
      ...state.items,
      [itemId]: {
        ...item,
        suggestions: item.suggestions.map((s) => (s.id === suggestionId ? { ...s, decision } : s)),
      },
    },
  };
}

export function foldEvents(events: AgentEvent[], city: CityConfig): RunState {
  return events.reduce((s, e, i) => applyEvent(s, e, i, city), initialRunState());
}

export interface Readiness {
  complete: string[];
  missing: string[];
  unknown: string[];
  notReviewed: string[];
  flagged: string[];
}

export function readiness(state: RunState, city: CityConfig): Readiness {
  const r: Readiness = { complete: [], missing: [], unknown: [], notReviewed: [], flagged: [] };
  for (const c of city.checklist) {
    const it = state.items[c.id];
    if (it?.highlighted) r.flagged.push(c.id);
    if (!it?.status) r.notReviewed.push(c.id);
    else r[it.status].push(c.id);
  }
  return r;
}

// Accept/reject decisions survive the move from editor to report within a tab (sessionStorage).
// That's a convenience only: the report still renders without it.
const DECISIONS_KEY = "pointer:decisions";
export type Decisions = Record<string, "accepted" | "rejected">;

export function saveDecisions(state: RunState): void {
  const d: Decisions = {};
  for (const it of Object.values(state.items)) for (const s of it.suggestions) if (s.decision !== "pending") d[s.id] = s.decision;
  try {
    sessionStorage.setItem(DECISIONS_KEY, JSON.stringify(d));
  } catch {}
}

export function loadDecisions(): Decisions {
  try {
    return JSON.parse(sessionStorage.getItem(DECISIONS_KEY) ?? "{}") as Decisions;
  } catch {
    return {};
  }
}

export function withDecisions(state: RunState, d: Decisions): RunState {
  const items: Record<string, ItemState> = {};
  for (const [id, it] of Object.entries(state.items)) {
    items[id] = { ...it, suggestions: it.suggestions.map((s) => (d[s.id] ? { ...s, decision: d[s.id] } : s)) };
  }
  return { ...state, items };
}
