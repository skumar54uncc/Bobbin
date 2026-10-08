import { assistantSyncDb, type SyncWarningRecord } from "./db";

/**
 * Text that reads like instructions to an AI model. Titles and excerpts are copied from
 * websites, so a page can try to steer the assistant that reads the sheet. Matches are
 * listed locally for review and never deleted or rewritten.
 */
const PATTERNS: readonly [string, RegExp][] = [
  ["ignore previous", /\b(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+|your\s+)*(previous|prior|above|earlier|preceding)\s+(instructions?|prompts?|messages?|rules|directions)\b/i],
  ["system prompt", /\bsystem\s+prompts?\b/i],
  ["role tag", /<\/?\s*(system|assistant|user|developer)\s*>|\[\/?(system|assistant|INST)\]|<\|\s*(im_start|im_end|system|assistant|user|endoftext)\s*\|>/i],
  ["role line", /(^|[\n.!?]\s*)(system|assistant|developer)\s*:\s*\S/i],
];

export function instructionFlags(text: string): { flags: string[]; at: number } {
  const flags: string[] = [];
  let at = -1;
  for (const [name, pattern] of PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    flags.push(name);
    if (at < 0 || match.index < at) at = match.index;
  }
  return { flags, at };
}

function snippet(text: string, at: number): string {
  const start = Math.max(0, at - 40);
  return text.slice(start, start + 160).replace(/\s+/g, " ").trim();
}

/** Records or clears the warning for one field of a visit. */
export async function flagInstructionText(
  visitId: string,
  field: SyncWarningRecord["field"],
  url: string,
  text: string,
  now: number
): Promise<boolean> {
  const key = `${visitId}:${field}`;
  const { flags, at } = instructionFlags(text);
  if (!flags.length) {
    await assistantSyncDb.warnings.delete(key);
    return false;
  }
  await assistantSyncDb.warnings.put({ key, visitId, field, url, snippet: snippet(text, at), flags, at: now });
  return true;
}
