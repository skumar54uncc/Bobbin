import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, it, expect } from "vitest";

/**
 * Dexie v6 -> v7. Person rows used to carry a LinkedIn photo URL that the
 * cards loaded on every view. v7 drops it and adds an empty photos store.
 */
const V6_STORES = {
  pages: "++id, url, visitedAt",
  visitLog: "++id, visitedAt, hostname, url",
  documents: "++id, url, domain, lastVisitedAt",
  chunks: "++id, documentId, ord, kind",
  conversations: "++id, createdAt, updatedAt, title",
  messages: "++id, conversationId, timestamp",
  digestCache: "range, generatedAt",
  people: "++id, &profileUrl, lastSeen, company",
  collections: "++id, &name, createdAt",
  collectionItems: "++id, collectionId, documentId, &[collectionId+documentId], addedAt",
  highlights: "++id, documentId, url, createdAt",
};

describe("Dexie v6 -> v7 migration", () => {
  it("removes stored photo URLs and keeps the rest of each person", async () => {
    const v6 = new Dexie("cortex-db");
    v6.version(6).stores(V6_STORES);
    await v6.open();
    await v6.table("people").add({
      kind: "person",
      name: "Mira Okafor",
      headline: "Head of Field Programs",
      company: "Tidora",
      profileUrl: "https://www.linkedin.com/in/mira/",
      lastSeen: 1,
      visitCount: 2,
      photoUrl: "https://media.licdn.com/dms/image/v2/D4E/profile-displayphoto-shrink_200_200/0/1",
    });
    v6.close();

    const { db } = await import("../src/db/schema");
    await db.open();
    expect(db.verno).toBe(7);
    const [row] = await db.people.toArray();
    expect(row).toMatchObject({ name: "Mira Okafor", company: "Tidora", visitCount: 2 });
    expect(row).not.toHaveProperty("photoUrl");
    expect(await db.photos.count()).toBe(0);
  });
});
