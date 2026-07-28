import { randomUUID } from "node:crypto";
import type { DiscordImageAttachment } from "../media/storage.js";
import type {
  EventTemplate,
  TemplateKind,
  TemplateSnapshot,
} from "../domain/types.js";

interface SessionBase {
  id: string;
  initiatorId: string;
  expiresAt: number;
}

export interface TemplateFormSession extends SessionBase {
  operation: "CREATE" | "EDIT";
  guildId: string;
  kind: TemplateKind;
  template: EventTemplate | null;
  mainImage: DiscordImageAttachment | null;
  sideImage: DiscordImageAttachment | null;
  removeSideImage: boolean;
}

export interface PlanSession extends SessionBase {
  guildId: string;
  kind: TemplateKind;
  snapshot: TemplateSnapshot;
  startsAt: number;
  hostUserId: string;
}

export interface DeleteTemplateSession extends SessionBase {
  guildId: string;
  kind: TemplateKind;
  templateId: string;
  templateName: string;
}

export interface CancelOccurrenceSession extends SessionBase {
  guildId: string;
  kind: TemplateKind;
  occurrenceId: string;
  occurrenceName: string;
}

class ExpiringSessionStore<T extends SessionBase> {
  private readonly sessions = new Map<string, T>();

  constructor(private readonly ttlMilliseconds = 15 * 60 * 1_000) {}

  create(input: Omit<T, "id" | "expiresAt">): T {
    const id = randomUUID().replaceAll("-", "");
    const session = {
      ...input,
      id,
      expiresAt: Date.now() + this.ttlMilliseconds,
    } as T;

    this.sessions.set(id, session);
    return session;
  }

  get(id: string): T | null {
    const session = this.sessions.get(id);
    if (!session) {
      return null;
    }

    if (session.expiresAt < Date.now()) {
      this.sessions.delete(id);
      return null;
    }

    return session;
  }

  consume(id: string): T | null {
    const session = this.get(id);
    if (session) {
      this.sessions.delete(id);
    }
    return session;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }
}

export const templateFormSessions =
  new ExpiringSessionStore<TemplateFormSession>();
export const planSessions = new ExpiringSessionStore<PlanSession>();
export const deleteTemplateSessions =
  new ExpiringSessionStore<DeleteTemplateSession>();
export const cancelOccurrenceSessions =
  new ExpiringSessionStore<CancelOccurrenceSession>();
