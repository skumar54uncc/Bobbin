import * as v from "valibot";

/** A tab reports measured attention on its page. `final` is sent on pagehide and SPA navigation. */
export const DwellMessageSchema = v.object({
  type: v.literal("CORTEX_DWELL"),
  url: v.pipe(v.string(), v.maxLength(8192)),
  activeMs: v.pipe(v.number(), v.minValue(0), v.maxValue(86_400_000)),
  maxScrollPct: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
  final: v.boolean(),
});
export type DwellMessage = v.InferOutput<typeof DwellMessageSchema>;

/** A tab asks whether its page may be measured. The same gate as indexing answers. */
export const DwellAllowedMessageSchema = v.object({
  type: v.literal("CORTEX_DWELL_ALLOWED"),
  url: v.pipe(v.string(), v.maxLength(8192)),
});

export const AssistantSyncMessageSchema = v.object({
  type: v.literal("CORTEX_ASSISTANT_SYNC"),
  action: v.picklist(["status", "enable", "now", "disable"]),
  token: v.optional(v.pipe(v.string(), v.maxLength(4096))),
});
export type AssistantSyncMessage = v.InferOutput<typeof AssistantSyncMessageSchema>;

/** Reply from the offscreen document after a sync pass. */
export const SyncWorkReplySchema = v.object({
  ok: v.optional(v.boolean()),
  error: v.optional(v.string()),
  status: v.optional(v.string()),
  appended: v.optional(v.number()),
  created: v.optional(v.boolean()),
  warning: v.optional(v.string()),
  authFailed: v.optional(v.boolean()),
  retryAt: v.optional(v.number()),
  more: v.optional(v.boolean()),
  reads: v.optional(v.number()),
  writes: v.optional(v.number()),
  ids: v.optional(
    v.object({
      folderId: v.optional(v.nullable(v.string())),
      fileId: v.optional(v.nullable(v.string())),
    })
  ),
});
export type SyncWorkReply = v.InferOutput<typeof SyncWorkReplySchema>;

export function parseMessage<T extends v.GenericSchema>(schema: T, value: unknown): v.InferOutput<T> | null {
  const out = v.safeParse(schema, value);
  return out.success ? out.output : null;
}
