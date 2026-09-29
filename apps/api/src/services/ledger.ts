import { riyadhDate, type JournalEntry, type JournalLine, type JournalSourceType } from "@cooffeup/shared";
import { newId, now, type AppContext } from "../context.js";
import { emit } from "./events.js";

export function postJournal(ctx: AppContext, input: { description: string; source: { type: JournalSourceType; id: string }; lines: JournalLine[]; createdBy: string; date?: string }): JournalEntry | undefined {
  if (input.lines.length === 0) return undefined;
  const createdAt = now();
  const entry: JournalEntry = {
    id: newId(), number: ctx.store.nextJournalNumber(), date: input.date ?? riyadhDate(createdAt),
    description: input.description, source: input.source, lines: input.lines, createdBy: input.createdBy, createdAt
  };
  ctx.store.journal.push(entry);
  emit(ctx, "journal.posted", entry);
  return entry;
}
