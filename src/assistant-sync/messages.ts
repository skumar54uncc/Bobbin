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
  action: v.picklist(["status", "enable", "now", "disable", "cleanup"]),
  token: v.optional(v.pipe(v.string(), v.maxLength(4096))),
  /** Enable again after Cortex asked: restore the trashed sheet, or create one in place of a deleted sheet. */
  choice: v.optional(v.picklist(["restore", "create"])),
  /** The answer to the old backups and archives prompt. */
  cleanup: v.optional(v.picklist(["trash", "keep"])),
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
  /** The other device visits sent with this pass are stored, so the service worker moves its cursor. */
  otherDeviceStored: v.optional(v.boolean()),
  reads: v.optional(v.number()),
  writes: v.optional(v.number()),
  /** Enable stopped to ask: the stored sheet is in the trash, or was deleted. */
  confirm: v.optional(v.picklist(["missing", "trashed"])),
  /** Which Google call failed and what Google said. */
  errorDetail: v.optional(
    v.object({
      call: v.pipe(v.string(), v.maxLength(32)),
      http_status: v.number(),
      status: v.pipe(v.string(), v.maxLength(64)),
      message: v.pipe(v.string(), v.maxLength(300)),
    })
  ),
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
