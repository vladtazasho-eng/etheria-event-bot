import path from "node:path";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import type {
  EventTemplate,
  Occurrence,
  OccurrenceStatus,
  TemplateKind,
  TemplateSnapshot,
} from "../domain/types.js";
import { kindTitle } from "../domain/types.js";
import type { MediaStorage } from "../media/storage.js";

const colors: Record<TemplateKind, number> = {
  EVENT: 0x8b5cf6,
  MOVIE: 0x3b82f6,
};

function mediaFileName(relativePath: string): string {
  return path.basename(relativePath);
}

interface TemplateLike {
  kind: TemplateKind;
  name: string;
  description: string;
  genre: string | null;
  releaseYear: string | null;
  duration: string | null;
  thumbnailPath: string | null;
  bannerPath: string;
}

export function applyTemplateMedia(
  embed: EmbedBuilder,
  template: TemplateLike,
): EmbedBuilder {
  embed.setThumbnail(
    template.thumbnailPath
      ? `attachment://${mediaFileName(template.thumbnailPath)}`
      : null,
  );
  embed.setImage(`attachment://${mediaFileName(template.bannerPath)}`);
  return embed;
}

export function buildTemplateEmbed(template: TemplateLike): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(colors[template.kind])
    .setTitle(template.name.slice(0, 256))
    .setDescription(template.description.slice(0, 4_096));

  if (template.kind === "MOVIE") {
    if (template.genre) {
      embed.addFields({ name: "Жанр", value: template.genre.slice(0, 1_024) });
    }
    if (template.releaseYear) {
      embed.addFields({
        name: "Рік",
        value: template.releaseYear.slice(0, 1_024),
        inline: true,
      });
    }
    if (template.duration) {
      embed.addFields({
        name: "Серії / тривалість",
        value: template.duration.slice(0, 1_024),
        inline: true,
      });
    }
  }

  return applyTemplateMedia(embed, template);
}

export function buildTemplateFiles(
  template: TemplateLike,
  media: MediaStorage,
): AttachmentBuilder[] {
  const files: AttachmentBuilder[] = [];

  if (template.thumbnailPath) {
    files.push(
      new AttachmentBuilder(media.absolutePath(template.thumbnailPath), {
        name: mediaFileName(template.thumbnailPath),
      }),
    );
  }

  files.push(
    new AttachmentBuilder(media.absolutePath(template.bannerPath), {
      name: mediaFileName(template.bannerPath),
    }),
  );

  return files;
}

export function buildTemplatePreview(
  template: EventTemplate | TemplateSnapshot,
  media: MediaStorage,
): { embeds: EmbedBuilder[]; files: AttachmentBuilder[] } {
  return {
    embeds: [buildTemplateEmbed(template)],
    files: buildTemplateFiles(template, media),
  };
}

export interface AnnouncementView {
  snapshot: TemplateSnapshot;
  hostUserId: string;
  startsAt: number;
  voiceChannelId: string;
  scheduledEventId: string;
  guildId: string;
}

export function buildAnnouncement(
  view: AnnouncementView,
  media: MediaStorage,
): {
  embeds: EmbedBuilder[];
  files: AttachmentBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const unix = Math.floor(view.startsAt / 1_000);
  const embed = buildTemplateEmbed(view.snapshot).addFields(
    { name: "🎧 Ведучий", value: `<@${view.hostUserId}>`, inline: true },
    { name: "🫧 Коли", value: `<t:${unix}:F>\n<t:${unix}:R>`, inline: true },
    { name: "☕ Де", value: `<#${view.voiceChannelId}>`, inline: true },
  );

  const eventUrl = `https://discord.com/events/${view.guildId}/${view.scheduledEventId}`;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Переглянути подію")
      .setEmoji("📅")
      .setStyle(ButtonStyle.Link)
      .setURL(eventUrl),
  );

  return {
    embeds: [embed],
    files: buildTemplateFiles(view.snapshot, media),
    components: [row],
  };
}

function statusLabel(status: OccurrenceStatus): string {
  switch (status) {
    case "LOCKED":
      return "🔒 Очікує відкриття";
    case "OPEN":
      return "🟢 Канал відкритий";
    case "ACTIVE":
      return "🔴 Триває";
    case "FINISHED":
      return "✅ Завершено";
    case "CANCELLED":
      return "❌ Скасовано";
  }
}

export function buildHostPanel(
  occurrence: Occurrence,
  userLimit: number,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const unix = Math.floor(occurrence.startsAt / 1_000);
  const embed = new EmbedBuilder()
    .setColor(colors[occurrence.kind])
    .setTitle(`Панель ведучого · ${occurrence.templateSnapshot.name}`.slice(0, 256))
    .setDescription(
      `Цією панеллю може користуватися лише ведучий <@${occurrence.hostUserId}>.`,
    )
    .addFields(
      { name: "Статус", value: statusLabel(occurrence.status), inline: true },
      { name: "Початок", value: `<t:${unix}:F>`, inline: true },
      {
        name: "Ліміт",
        value: userLimit === 0 ? "Без обмежень" : String(userLimit),
        inline: true,
      },
      {
        name: "Повторний пінг",
        value: occurrence.boostUsedAt ? "Використано" : "Доступний",
        inline: true,
      },
    );

  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`occ:slots:${occurrence.id}`)
      .setLabel("Змінити слоти")
      .setEmoji("👥")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`occ:kick:${occurrence.id}`)
      .setLabel("Викинути учасника")
      .setEmoji("🚪")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`occ:boost:${occurrence.id}`)
      .setLabel("Збільшити онлайн")
      .setEmoji("📣")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(occurrence.boostUsedAt !== null),
  );

  const finish = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`occ:finish:${occurrence.id}`)
      .setLabel("Завершити івент")
      .setEmoji("⏹️")
      .setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [controls, finish] };
}
