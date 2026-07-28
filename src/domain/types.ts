export const templateKinds = ["EVENT", "MOVIE"] as const;
export type TemplateKind = (typeof templateKinds)[number];

export const occurrenceStatuses = [
  "LOCKED",
  "OPEN",
  "ACTIVE",
  "FINISHED",
  "CANCELLED",
] as const;
export type OccurrenceStatus = (typeof occurrenceStatuses)[number];

export interface EventTemplate {
  id: string;
  guildId: string;
  kind: TemplateKind;
  name: string;
  description: string;
  genre: string | null;
  releaseYear: string | null;
  duration: string | null;
  thumbnailPath: string | null;
  bannerPath: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface TemplateSnapshot {
  templateId: string;
  kind: TemplateKind;
  name: string;
  description: string;
  genre: string | null;
  releaseYear: string | null;
  duration: string | null;
  thumbnailPath: string | null;
  bannerPath: string;
}

export interface Occurrence {
  id: string;
  guildId: string;
  kind: TemplateKind;
  templateId: string;
  templateSnapshot: TemplateSnapshot;
  hostUserId: string;
  pingRoleId: string;
  startsAt: number;
  opensAt: number;
  status: OccurrenceStatus;
  voiceChannelId: string;
  scheduledEventId: string;
  announcementChannelId: string;
  announcementMessageId: string;
  panelMessageId: string;
  boostUsedAt: number | null;
  createdBy: string;
  createdAt: number;
  finishedAt: number | null;
}

export function snapshotTemplate(template: EventTemplate): TemplateSnapshot {
  return {
    templateId: template.id,
    kind: template.kind,
    name: template.name,
    description: template.description,
    genre: template.genre,
    releaseYear: template.releaseYear,
    duration: template.duration,
    thumbnailPath: template.thumbnailPath,
    bannerPath: template.bannerPath,
  };
}

export function kindLabel(kind: TemplateKind): string {
  return kind === "MOVIE" ? "фільм" : "івент";
}

export function kindTitle(kind: TemplateKind): string {
  return kind === "MOVIE" ? "Фільм" : "Івент";
}
