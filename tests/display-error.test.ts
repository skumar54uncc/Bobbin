import { describe, expect, it } from "vitest";
import { displayError, ERROR_CODES, ERROR_MESSAGES } from "../src/lib/errors";

describe("displayError", () => {
  it("maps known codes and hides unknown snake_case codes", () => {
    expect(displayError(ERROR_CODES.STORAGE_FULL, "fallback")).toBe(ERROR_MESSAGES[ERROR_CODES.STORAGE_FULL].userMessage);
    expect(displayError("foreign_sender", "Could not delete data.")).toBe(ERROR_MESSAGES[ERROR_CODES.FOREIGN_SENDER].userMessage);
    expect(displayError("already_running", "Could not start scan.")).toBe("Could not start scan.");
    expect(displayError("status_failed", "Sync did not start.")).toBe("Sync did not start.");
    expect(displayError(undefined, "Could not start chat.")).toBe("Could not start chat.");
  });

  it("keeps a full sentence that is not a code", () => {
    expect(displayError("Google did not accept the sign-in. Press Enable to reconnect Google Drive.", "x")).toBe(
      "Google did not accept the sign-in. Press Enable to reconnect Google Drive."
    );
  });

  it("never uses an em dash in catalog copy", () => {
    for (const row of Object.values(ERROR_MESSAGES)) {
      expect(row.userMessage).not.toMatch(/\u2014/);
      expect(row.userAction ?? "").not.toMatch(/\u2014/);
      expect(row.userMessage).not.toBe(row.code);
    }
  });
});
