/** Greetings and thanks. These are not questions about the library. */

export function smalltalkReply(question: string): string | null {
  const q = question.trim().replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
  if (/^(hi|hello|hey|yo|good morning|good afternoon|good evening)$/i.test(q)) {
    return "Hello. Ask about a page you read, a person you opened, or what you looked at today.";
  }
  if (/^how are you( doing)?$/i.test(q)) {
    return "I'm here. Ask about a page you read, a person you opened, or what you looked at today.";
  }
  if (/^(thanks|thank you)$/i.test(q)) {
    return "You're welcome. Ask whenever you want something from your library.";
  }
  if (/^(who are you|what are you|what can you do)$/i.test(q)) {
    return "I'm Cortex. I answer from pages you have read on this device.";
  }
  return null;
}
