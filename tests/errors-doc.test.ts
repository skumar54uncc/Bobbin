import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SYNC_ABSENT_MESSAGE,
  SYNC_FORBIDDEN_MESSAGE,
  SYNC_MISSING_MESSAGE,
  SYNC_REJECTED_MESSAGE,
  SYNC_TRASHED_MESSAGE,
} from "../src/assistant-sync/sync-engine";
import { CADENCE_SENTENCE, RECONNECT_LINE } from "../src/assistant-sync/schedule";
import { ERROR_MESSAGES } from "../src/lib/errors";
import { INSERT_ERRORS } from "../src/attach/attach-view";

const doc = readFileSync(join(__dirname, "..", "docs", "errors.md"), "utf8");

describe("docs/errors.md", () => {
  it("lists every catalog user message and the sync sentences", () => {
    for (const row of Object.values(ERROR_MESSAGES)) {
      expect(doc).toContain(row.userMessage);
    }
    for (const line of [
      SYNC_MISSING_MESSAGE,
      SYNC_TRASHED_MESSAGE,
      SYNC_ABSENT_MESSAGE,
      SYNC_REJECTED_MESSAGE,
      SYNC_FORBIDDEN_MESSAGE,
      CADENCE_SENTENCE,
      RECONNECT_LINE,
      INSERT_ERRORS.nofield,
      INSERT_ERRORS.rejected,
      INSERT_ERRORS.blocked,
    ]) {
      expect(doc).toContain(line);
    }
    expect(doc).toMatch(/never in the UI/i);
  });
});
