import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  EventTemplate,
  Occurrence,
  OccurrenceStatus,
  TemplateKind,
  TemplateSnapshot,
} from "../domain/types.js";

interface TemplateRow {
  id: string;
  guild_id: string;
  kind: TemplateKind;
  name: string;
  description: string;
  genre: string | null;
  release_year: string | null;
  duration: string | null;
  thumbnail_path: string | null;
  banner_path: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

interface OccurrenceRow {
  id: string;
  guild_id: string;
  kind: TemplateKind;
  template_id: string;
  template_snapshot: string;
  host_user_id: string;
  ping_role_id: string;
  starts_at: number;
  opens_at: number;
  status: OccurrenceStatus;
  voice_channel_id: string;
  scheduled_event_id: string;
  announcement_channel_id: string;
  announcement_message_id: string;
  panel_message_id: string;
  boost_used_at: number | null;
  created_by: string;
  created_at: number;
  finished_at: number | null;
}

export interface CreateTemplateInput {
  guildId: string;
  kind: TemplateKind;
  name: string;
  description: string;
  genre?: string | null;
  releaseYear?: string | null;
  duration?: string | null;
  thumbnailPath?: string | null;
  bannerPath: string;
  createdBy: string;
}

export interface UpdateTemplateInput {
  name: string;
  description: string;
  genre?: string | null;
  releaseYear?: string | null;
  duration?: string | null;
  thumbnailPath: string | null;
  bannerPath: string;
}

export interface CreateOccurrenceInput {
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
  createdBy: string;
}

function mapTemplate(row: TemplateRow): EventTemplate {
  return {
    id: row.id,
    guildId: row.guild_id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    genre: row.genre,
    releaseYear: row.release_year,
    duration: row.duration,
    thumbnailPath: row.thumbnail_path,
    bannerPath: row.banner_path,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function mapOccurrence(row: OccurrenceRow): Occurrence {
  return {
    id: row.id,
    guildId: row.guild_id,
    kind: row.kind,
    templateId: row.template_id,
    templateSnapshot: JSON.parse(row.template_snapshot) as TemplateSnapshot,
    hostUserId: row.host_user_id,
    pingRoleId: row.ping_role_id,
    startsAt: row.starts_at,
    opensAt: row.opens_at,
    status: row.status,
    voiceChannelId: row.voice_channel_id,
    scheduledEventId: row.scheduled_event_id,
    announcementChannelId: row.announcement_channel_id,
    announcementMessageId: row.announcement_message_id,
    panelMessageId: row.panel_message_id,
    boostUsedAt: row.boost_used_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

export class EventDatabase {
  readonly sqlite: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }

    this.sqlite = new DatabaseSync(databasePath);
    this.sqlite.exec("PRAGMA foreign_keys = ON;");
    this.sqlite.exec("PRAGMA busy_timeout = 5000;");

    if (databasePath !== ":memory:") {
      this.sqlite.exec("PRAGMA journal_mode = WAL;");
      this.sqlite.exec("PRAGMA synchronous = NORMAL;");
    }

    this.migrate();
  }

  close(): void {
    this.sqlite.close();
  }

  private migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('EVENT', 'MOVIE')),
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        genre TEXT,
        release_year TEXT,
        duration TEXT,
        thumbnail_path TEXT,
        banner_path TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS templates_active_search
      ON templates (guild_id, kind, archived_at, name);

      CREATE TABLE IF NOT EXISTS occurrences (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('EVENT', 'MOVIE')),
        template_id TEXT NOT NULL REFERENCES templates(id),
        template_snapshot TEXT NOT NULL,
        host_user_id TEXT NOT NULL,
        ping_role_id TEXT NOT NULL,
        starts_at INTEGER NOT NULL,
        opens_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('LOCKED', 'OPEN', 'ACTIVE', 'FINISHED', 'CANCELLED')
        ),
        voice_channel_id TEXT NOT NULL,
        scheduled_event_id TEXT NOT NULL,
        announcement_channel_id TEXT NOT NULL,
        announcement_message_id TEXT NOT NULL,
        panel_message_id TEXT NOT NULL,
        boost_used_at INTEGER,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        finished_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS occurrences_due
      ON occurrences (guild_id, status, opens_at);

      CREATE INDEX IF NOT EXISTS occurrences_active
      ON occurrences (guild_id, kind, status, starts_at);

      CREATE TABLE IF NOT EXISTS occurrence_blocks (
        occurrence_id TEXT NOT NULL REFERENCES occurrences(id),
        user_id TEXT NOT NULL,
        blocked_by TEXT NOT NULL,
        blocked_at INTEGER NOT NULL,
        PRIMARY KEY (occurrence_id, user_id)
      );
    `);
  }

  createTemplate(input: CreateTemplateInput): EventTemplate {
    const now = Date.now();
    const id = randomUUID();

    this.sqlite
      .prepare(`
        INSERT INTO templates (
          id, guild_id, kind, name, description, genre, release_year,
          duration, thumbnail_path, banner_path, created_by, created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.guildId,
        input.kind,
        input.name,
        input.description,
        input.genre ?? null,
        input.releaseYear ?? null,
        input.duration ?? null,
        input.thumbnailPath ?? null,
        input.bannerPath,
        input.createdBy,
        now,
        now,
      );

    return this.getTemplate(id, input.guildId, input.kind)!;
  }

  updateTemplate(
    id: string,
    guildId: string,
    kind: TemplateKind,
    input: UpdateTemplateInput,
  ): EventTemplate | null {
    const result = this.sqlite
      .prepare(`
        UPDATE templates
        SET name = ?, description = ?, genre = ?, release_year = ?,
            duration = ?, thumbnail_path = ?, banner_path = ?, updated_at = ?
        WHERE id = ? AND guild_id = ? AND kind = ? AND archived_at IS NULL
      `)
      .run(
        input.name,
        input.description,
        input.genre ?? null,
        input.releaseYear ?? null,
        input.duration ?? null,
        input.thumbnailPath,
        input.bannerPath,
        Date.now(),
        id,
        guildId,
        kind,
      );

    return result.changes === 1
      ? this.getTemplate(id, guildId, kind)
      : null;
  }

  archiveTemplate(
    id: string,
    guildId: string,
    kind: TemplateKind,
  ): boolean {
    const result = this.sqlite
      .prepare(`
        UPDATE templates
        SET archived_at = ?, updated_at = ?
        WHERE id = ? AND guild_id = ? AND kind = ? AND archived_at IS NULL
      `)
      .run(Date.now(), Date.now(), id, guildId, kind);

    return result.changes === 1;
  }

  getTemplate(
    id: string,
    guildId: string,
    kind?: TemplateKind,
  ): EventTemplate | null {
    const row = kind
      ? this.sqlite
          .prepare(`
            SELECT * FROM templates
            WHERE id = ? AND guild_id = ? AND kind = ? AND archived_at IS NULL
          `)
          .get(id, guildId, kind)
      : this.sqlite
          .prepare(`
            SELECT * FROM templates
            WHERE id = ? AND guild_id = ? AND archived_at IS NULL
          `)
          .get(id, guildId);

    return row ? mapTemplate(row as unknown as TemplateRow) : null;
  }

  searchTemplates(
    guildId: string,
    kind: TemplateKind,
    query: string,
    limit = 25,
  ): EventTemplate[] {
    const rows = this.sqlite
      .prepare(`
        SELECT * FROM templates
        WHERE guild_id = ? AND kind = ? AND archived_at IS NULL
          AND LOWER(name) LIKE LOWER(?)
        ORDER BY updated_at DESC
        LIMIT ?
      `)
      .all(guildId, kind, `%${query.trim()}%`, limit);

    return (rows as unknown as TemplateRow[]).map(mapTemplate);
  }

  listTemplates(
    guildId: string,
    kind: TemplateKind,
    page: number,
    pageSize: number,
  ): { templates: EventTemplate[]; total: number } {
    const safePage = Math.max(1, page);
    const totalRow = this.sqlite
      .prepare(`
        SELECT COUNT(*) AS count FROM templates
        WHERE guild_id = ? AND kind = ? AND archived_at IS NULL
      `)
      .get(guildId, kind) as unknown as { count: number };

    const rows = this.sqlite
      .prepare(`
        SELECT * FROM templates
        WHERE guild_id = ? AND kind = ? AND archived_at IS NULL
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(guildId, kind, pageSize, (safePage - 1) * pageSize);

    return {
      templates: (rows as unknown as TemplateRow[]).map(mapTemplate),
      total: totalRow.count,
    };
  }

  createOccurrence(input: CreateOccurrenceInput): Occurrence {
    const now = Date.now();

    this.sqlite
      .prepare(`
        INSERT INTO occurrences (
          id, guild_id, kind, template_id, template_snapshot, host_user_id,
          ping_role_id, starts_at, opens_at, status, voice_channel_id,
          scheduled_event_id, announcement_channel_id,
          announcement_message_id, panel_message_id, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.id,
        input.guildId,
        input.kind,
        input.templateId,
        JSON.stringify(input.templateSnapshot),
        input.hostUserId,
        input.pingRoleId,
        input.startsAt,
        input.opensAt,
        input.status,
        input.voiceChannelId,
        input.scheduledEventId,
        input.announcementChannelId,
        input.announcementMessageId,
        input.panelMessageId,
        input.createdBy,
        now,
      );

    return this.getOccurrence(input.id)!;
  }

  getOccurrence(id: string): Occurrence | null {
    const row = this.sqlite
      .prepare("SELECT * FROM occurrences WHERE id = ?")
      .get(id);

    return row ? mapOccurrence(row as unknown as OccurrenceRow) : null;
  }

  getDueToOpen(guildId: string, now: number): Occurrence[] {
    const rows = this.sqlite
      .prepare(`
        SELECT * FROM occurrences
        WHERE guild_id = ? AND status = 'LOCKED' AND opens_at <= ?
        ORDER BY opens_at ASC
      `)
      .all(guildId, now);

    return (rows as unknown as OccurrenceRow[]).map(mapOccurrence);
  }

  getDueToStart(guildId: string, now: number): Occurrence[] {
    const rows = this.sqlite
      .prepare(`
        SELECT * FROM occurrences
        WHERE guild_id = ? AND status IN ('LOCKED', 'OPEN')
          AND starts_at <= ?
        ORDER BY starts_at ASC
      `)
      .all(guildId, now);

    return (rows as unknown as OccurrenceRow[]).map(mapOccurrence);
  }

  markOpened(id: string): boolean {
    const result = this.sqlite
      .prepare(`
        UPDATE occurrences SET status = 'OPEN'
        WHERE id = ? AND status = 'LOCKED'
      `)
      .run(id);
    return result.changes === 1;
  }

  markActive(id: string): boolean {
    const result = this.sqlite
      .prepare(`
        UPDATE occurrences SET status = 'ACTIVE'
        WHERE id = ? AND status IN ('LOCKED', 'OPEN')
      `)
      .run(id);
    return result.changes === 1;
  }

  claimBoost(
    id: string,
  ): { occurrence: Occurrence; previousStatus: OccurrenceStatus } | null {
    const occurrence = this.getOccurrence(id);
    if (
      !occurrence ||
      occurrence.boostUsedAt !== null ||
      !["LOCKED", "OPEN", "ACTIVE"].includes(occurrence.status)
    ) {
      return null;
    }

    const previousStatus = occurrence.status;
    const result = this.sqlite
      .prepare(`
        UPDATE occurrences
        SET boost_used_at = ?, status = 'ACTIVE'
        WHERE id = ? AND boost_used_at IS NULL
          AND status IN ('LOCKED', 'OPEN', 'ACTIVE')
      `)
      .run(Date.now(), id);

    const updated = result.changes === 1 ? this.getOccurrence(id) : null;
    return updated ? { occurrence: updated, previousStatus } : null;
  }

  releaseBoost(id: string, previousStatus: OccurrenceStatus): void {
    this.sqlite
      .prepare(`
        UPDATE occurrences
        SET boost_used_at = NULL, status = ?
        WHERE id = ? AND status = 'ACTIVE'
      `)
      .run(previousStatus, id);
  }

  markFinished(id: string): boolean {
    const result = this.sqlite
      .prepare(`
        UPDATE occurrences
        SET status = 'FINISHED', finished_at = ?
        WHERE id = ? AND status IN ('LOCKED', 'OPEN', 'ACTIVE')
      `)
      .run(Date.now(), id);
    return result.changes === 1;
  }

  markCancelled(id: string): boolean {
    const result = this.sqlite
      .prepare(`
        UPDATE occurrences
        SET status = 'CANCELLED', finished_at = ?
        WHERE id = ? AND status IN ('LOCKED', 'OPEN')
      `)
      .run(Date.now(), id);
    return result.changes === 1;
  }

  searchCancelableOccurrences(
    guildId: string,
    kind: TemplateKind,
    query: string,
    now = Date.now(),
    limit = 25,
  ): Occurrence[] {
    const rows = this.sqlite
      .prepare(`
        SELECT * FROM occurrences
        WHERE guild_id = ? AND kind = ? AND status IN ('LOCKED', 'OPEN')
          AND starts_at > ?
          AND LOWER(template_snapshot) LIKE LOWER(?)
        ORDER BY starts_at ASC
        LIMIT ?
      `)
      .all(guildId, kind, now, `%${query.trim()}%`, limit);

    return (rows as unknown as OccurrenceRow[]).map(mapOccurrence);
  }

  recordBlock(occurrenceId: string, userId: string, blockedBy: string): void {
    this.sqlite
      .prepare(`
        INSERT INTO occurrence_blocks (
          occurrence_id, user_id, blocked_by, blocked_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT (occurrence_id, user_id)
        DO UPDATE SET blocked_by = excluded.blocked_by,
                      blocked_at = excluded.blocked_at
      `)
      .run(occurrenceId, userId, blockedBy, Date.now());
  }
}
