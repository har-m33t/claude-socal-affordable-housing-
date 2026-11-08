// Pure reducer: the editor's state is a fold over agent events plus the applicant's
// accept/reject decisions. The report page reuses it, so the editor and the report always agree.
import { normalizeCitation, type AgentEvent, type CityConfig, type Citation, type ItemStatus, type StatuteRef } from "./contract";

/** The ids an event may name: a city checklist, or a plan's targets. Both have `{ id }` entries. */
export interface TargetScope {
  checklist: ReadonlyArray<{ id: string }>;
}

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
  /** Law Lens: the confirmed statute this item's text cites, as rendered by the server. */
  statute?: StatuteRef;
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

export function applyEvent(state: RunState, event: AgentEvent, index: number, city: TargetScope): RunState {
  const citation = normalizeCitation(event.citation);
  // Security: item IDs must exist in the loaded city file, otherwise the event is ignored.
  if (!city.checklist.some((c) => c.id === event.item_id)) {
    return { ...state, log: [...state.log, { index, event, citation, rejected: `unknown item_id "${event.item_id}"` }] };
  }
  const prev = state.items[event.item_id] ?? emptyItem();
  const lawSource: Citation | undefined = event.statute_ref
    ? { title: event.statute_ref.title, url: event.statute_ref.source_url, checked_date: event.statute_ref.checked_date }
    : undefined;
  const sources = [citation, lawSource].filter((c): c is Citation => Boolean(c));
  const item: ItemState = { ...prev, citations: sources.length ? [...prev.citations, ...sources] : prev.citations };
  let pointedItem = state.pointedItem;

  switch (event.tool) {
    case "point_to":
      pointedItem = event.item_id;
      break;
    case "highlight":
      pointedItem = event.item_id;
      item.highlighted = true;
      item.highlightText = event.text;
      if (event.statute_ref) item.statute = event.statute_ref;
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

export function foldEvents(events: AgentEvent[], city: TargetScope): RunState {
  return events.reduce((s, e, i) => applyEvent(s, e, i, city), initialRunState());
}

export interface Readiness {
  complete: string[];
  missing: string[];
  unknown: string[];
  /** Pointer drafted a value the homeowner hasn't accepted or rejected yet. */
  drafted: string[];
  notReviewed: string[];
  flagged: string[];
}

export function readiness(state: RunState, city: TargetScope): Readiness {
  const r: Readiness = { complete: [], missing: [], unknown: [], drafted: [], notReviewed: [], flagged: [] };
  for (const c of city.checklist) {
    const it = state.items[c.id];
    if (it?.highlighted) r.flagged.push(c.id);
    if (it?.status) r[it.status].push(c.id);
    // A form field is filled in once the homeowner accepts a drafted value; until then it waits on them.
    else if (it?.suggestions.some((s) => s.decision === "accepted")) r.complete.push(c.id);
    else if (it?.suggestions.some((s) => s.decision === "pending")) r.drafted.push(c.id);
    else r.notReviewed.push(c.id);
  }
  return r;
}
