// Which conversation is currently on screen, so the in-app notification chime
// can stay quiet for messages in the thread the user is already reading.
// Module-level (not context) — it's read from a poll callback, never rendered.
let activeConversationId: string | null = null;

export function setActiveConversation(id: string | null): void {
  activeConversationId = id;
}

export function getActiveConversation(): string | null {
  return activeConversationId;
}
