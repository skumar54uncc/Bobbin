import { describe, expect, it } from "vitest";
import { looksSensitiveHostname } from "../src/lib/privacy";

describe("looksSensitiveHostname", () => {
  it("still treats a bank website as sensitive", () => {
    expect(looksSensitiveHostname("www.chase.com", "/account")).toBe(true);
    expect(looksSensitiveHostname("online.example-bank.com", "/")).toBe(true);
  });

  it("indexes a public LinkedIn company page whose slug contains bank", () => {
    expect(looksSensitiveHostname("www.linkedin.com", "/company/fifth-third-bank/home/")).toBe(false);
    expect(looksSensitiveHostname("www.linkedin.com", "/in/swatika-siva/")).toBe(false);
  });
});
