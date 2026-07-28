import { randomUUID } from "node:crypto";
import {
  ChannelType,
  Client,
  EmbedBuilder,
  GuildScheduledEventStatus,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  PermissionFlagsBits,
  type Guild,
  type GuildScheduledEvent,
  type Message,
  type TextBasedChannel,
  type User,
  type VoiceChannel,
} from "discord.js";
import type { EventBotConfig } from "../config.js";
import type { EventDatabase } from "../db/database.js";
import type {
  Occurrence,
  TemplateSnapshot,
} from "../domain/types.js";
import type { MediaStorage } from "../media/storage.js";
import {
  applyTemplateMedia,
  buildAnnouncement,
  buildHostPanel,
  buildTemplateFiles,
} from "../presentation/embeds.js";
import { fetchMember } from "../interactions/access.js";

export interface CreateOccurrenceRequest {
  guildId: string;
  snapshot: TemplateSnapshot;
  hostUserId: string;
  startsAt: number;
  createdBy: string;
}

function channelName(name: string): string {
  const normalized = name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-_]/gu, "")
    .slice(0, 85);
  return `🎉・${normalized || "event"}`.slice(0, 100);
}

function isGuildTextChannel(channel: unknown): channel is TextBasedChannel {
  return Boolean(
    channel &&
      typeof channel === "object" &&
      "isTextBased" in channel &&
      typeof channel.isTextBased === "function" &&
      channel.isTextBased(),
  );
}

export class OccurrenceService {
  constructor(
    private readonly client: Client<true>,
    private readonly db: EventDatabase,
    private readonly media: MediaStorage,
    private readonly config: EventBotConfig,
  ) {}

  async create(request: CreateOccurrenceRequest): Promise<Occurrence> {
    const guild = await this.client.guilds.fetch(request.guildId);
    const host = await fetchMember(guild, request.hostUserId);
    if (!host) {
      throw new Error("Ведучого не знайдено на сервері.");
    }

    const category = await guild.channels.fetch(this.config.voiceCategoryId);
    if (!category || category.type !== ChannelType.GuildCategory) {
      throw new Error("Категорію для голосових каналів не знайдено.");
    }

    const announcementChannel = await guild.channels.fetch(
      this.config.announcementChannelId,
    );
    if (!isGuildTextChannel(announcementChannel)) {
      throw new Error("Канал анонсів не знайдено або він не текстовий.");
    }

    const botMember = guild.members.me ?? (await guild.members.fetchMe());
    const occurrenceId = randomUUID();
    const opensAt =
      request.startsAt - this.config.openBeforeMinutes * 60 * 1_000;
    const isAlreadyOpen = opensAt <= Date.now();
    const pingRoleId =
      request.snapshot.kind === "MOVIE"
        ? this.config.moviePingRoleId
        : this.config.eventPingRoleId;

    let voiceChannel: VoiceChannel | null = null;
    let scheduledEvent: GuildScheduledEvent | null = null;
    let announcementMessage: Message | null = null;
    let panelMessage: Message | null = null;

    try {
      voiceChannel = await guild.channels.create({
        name: channelName(request.snapshot.name),
        type: ChannelType.GuildVoice,
        parent: category.id,
        userLimit: 0,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            ...(isAlreadyOpen
              ? { allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.ReadMessageHistory,
                  PermissionFlagsBits.Connect,
                ] }
              : {
                  allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.ReadMessageHistory,
                  ],
                  deny: [PermissionFlagsBits.Connect],
                }),
          },
          {
            id: host.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
          {
            id: botMember.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ManageMessages,
              PermissionFlagsBits.MoveMembers,
            ],
          },
        ],
        reason: `Подія «${request.snapshot.name}», ведучий ${host.user.tag}`,
      });

      const coverImage = await this.media.read(request.snapshot.bannerPath);
      scheduledEvent = await guild.scheduledEvents.create({
        name: request.snapshot.name.slice(0, 100),
        description: request.snapshot.description.slice(0, 1_000),
        scheduledStartTime: new Date(request.startsAt),
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.Voice,
        channel: voiceChannel.id,
        image: coverImage,
        reason: `Створено ${host.user.tag}`,
      });

      const announcement = buildAnnouncement(
        {
          snapshot: request.snapshot,
          hostUserId: host.id,
          startsAt: request.startsAt,
          voiceChannelId: voiceChannel.id,
          scheduledEventId: scheduledEvent.id,
          guildId: guild.id,
        },
        this.media,
      );

      announcementMessage = await announcementChannel.send({
        content: `<@&${pingRoleId}>`,
        allowedMentions: { roles: [pingRoleId] },
        ...announcement,
      });

      const provisional: Occurrence = {
        id: occurrenceId,
        guildId: guild.id,
        kind: request.snapshot.kind,
        templateId: request.snapshot.templateId,
        templateSnapshot: request.snapshot,
        hostUserId: host.id,
        pingRoleId,
        startsAt: request.startsAt,
        opensAt,
        status: isAlreadyOpen ? "OPEN" : "LOCKED",
        voiceChannelId: voiceChannel.id,
        scheduledEventId: scheduledEvent.id,
        announcementChannelId: announcementChannel.id,
        announcementMessageId: announcementMessage.id,
        panelMessageId: "",
        boostUsedAt: null,
        createdBy: request.createdBy,
        createdAt: Date.now(),
        finishedAt: null,
      };

      const panel = buildHostPanel(provisional, 0);
      panelMessage = await voiceChannel.send(panel);

      return this.db.createOccurrence({
        id: occurrenceId,
        guildId: guild.id,
        kind: request.snapshot.kind,
        templateId: request.snapshot.templateId,
        templateSnapshot: request.snapshot,
        hostUserId: host.id,
        pingRoleId,
        startsAt: request.startsAt,
        opensAt,
        status: isAlreadyOpen ? "OPEN" : "LOCKED",
        voiceChannelId: voiceChannel.id,
        scheduledEventId: scheduledEvent.id,
        announcementChannelId: announcementChannel.id,
        announcementMessageId: announcementMessage.id,
        panelMessageId: panelMessage.id,
        createdBy: request.createdBy,
      });
    } catch (error) {
      await panelMessage?.delete().catch(() => undefined);
      await announcementMessage?.delete().catch(() => undefined);
      await scheduledEvent?.delete().catch(() => undefined);
      await voiceChannel?.delete("Відкат невдалого створення події").catch(
        () => undefined,
      );
      throw error;
    }
  }

  async open(occurrence: Occurrence): Promise<void> {
    if (occurrence.status !== "LOCKED") {
      return;
    }

    const guild = await this.client.guilds.fetch(occurrence.guildId);
    const voiceChannel = await this.fetchVoiceChannel(guild, occurrence);

    await voiceChannel.permissionOverwrites.edit(
      guild.roles.everyone.id,
      { Connect: true, ViewChannel: true },
      { reason: `Відкриття за ${this.config.openBeforeMinutes} хв до події` },
    );

    if (this.db.markOpened(occurrence.id)) {
      await this.refreshPanel(occurrence.id);
    }
  }

  async start(occurrence: Occurrence): Promise<void> {
    if (!["LOCKED", "OPEN"].includes(occurrence.status)) {
      return;
    }

    const guild = await this.client.guilds.fetch(occurrence.guildId);
    const voiceChannel = await this.fetchVoiceChannel(guild, occurrence);

    await voiceChannel.permissionOverwrites.edit(
      guild.roles.everyone.id,
      { Connect: true, ViewChannel: true },
      { reason: "Автоматичний початок події" },
    );

    const scheduledEvent = await guild.scheduledEvents
      .fetch(occurrence.scheduledEventId)
      .catch(() => null);

    if (!scheduledEvent) {
      throw new Error("Заплановану Discord-подію не знайдено.");
    }
    if (scheduledEvent.isScheduled()) {
      await scheduledEvent.setStatus(
        GuildScheduledEventStatus.Active,
        "Автоматичний початок за розкладом",
      );
    }

    if (this.db.markActive(occurrence.id)) {
      await this.refreshPanel(occurrence.id);
    }
  }

  async changeUserLimit(
    occurrence: Occurrence,
    userLimit: number,
  ): Promise<void> {
    const guild = await this.client.guilds.fetch(occurrence.guildId);
    const voiceChannel = await this.fetchVoiceChannel(guild, occurrence);
    await voiceChannel.setUserLimit(userLimit, "Змінено ведучим події");
    await this.refreshPanel(occurrence.id);
  }

  async blockAndDisconnect(
    occurrence: Occurrence,
    user: User,
    blockedBy: string,
  ): Promise<void> {
    if (user.id === occurrence.hostUserId) {
      throw new Error("Ведучого не можна викинути з його власної події.");
    }
    if (user.id === this.client.user.id) {
      throw new Error("Бота не можна викинути з події.");
    }

    const guild = await this.client.guilds.fetch(occurrence.guildId);
    const voiceChannel = await this.fetchVoiceChannel(guild, occurrence);
    const member = await fetchMember(guild, user.id);

    if (!member || member.voice.channelId !== voiceChannel.id) {
      throw new Error("Цей користувач зараз не перебуває в каналі події.");
    }

    await member.voice.disconnect("Видалено ведучим події");
    await voiceChannel.permissionOverwrites.edit(
      member.id,
      { Connect: false },
      { reason: "Заблоковано ведучим події" },
    );
    this.db.recordBlock(occurrence.id, member.id, blockedBy);
  }

  async boost(occurrenceId: string): Promise<void> {
    const original = this.db.getOccurrence(occurrenceId);
    if (!original) {
      throw new Error("Подію не знайдено.");
    }
    if (Date.now() < original.startsAt) {
      throw new Error("Повторний пінг стане доступним у час початку події.");
    }

    const claim = this.db.claimBoost(occurrenceId);
    if (!claim) {
      throw new Error("Повторний пінг уже було використано.");
    }

    try {
      const guild = await this.client.guilds.fetch(
        claim.occurrence.guildId,
      );
      const voiceChannel = await this.fetchVoiceChannel(
        guild,
        claim.occurrence,
      );
      const scheduledEvent = await guild.scheduledEvents
        .fetch(claim.occurrence.scheduledEventId)
        .catch(() => null);

      if (scheduledEvent?.isScheduled()) {
        await scheduledEvent.setStatus(
          GuildScheduledEventStatus.Active,
          "Ведучий розпочав подію",
        );
      }

      await voiceChannel.send({
        content: `<@&${claim.occurrence.pingRoleId}> **${claim.occurrence.templateSnapshot.name}** уже почався — приєднуйтесь до <#${voiceChannel.id}>!`,
        allowedMentions: { roles: [claim.occurrence.pingRoleId] },
      });
      await this.refreshPanel(occurrenceId);
    } catch (error) {
      this.db.releaseBoost(occurrenceId, claim.previousStatus);
      throw error;
    }
  }

  async cancel(occurrence: Occurrence): Promise<void> {
    if (!["LOCKED", "OPEN"].includes(occurrence.status)) {
      throw new Error("Активну подію потрібно завершити через панель ведучого.");
    }
    if (occurrence.startsAt <= Date.now()) {
      throw new Error("Подія вже почалася. Завершіть її через панель ведучого.");
    }

    const guild = await this.client.guilds.fetch(occurrence.guildId);
    const scheduledEvent = await guild.scheduledEvents
      .fetch(occurrence.scheduledEventId)
      .catch(() => null);
    if (scheduledEvent?.isScheduled()) {
      await scheduledEvent.setStatus(
        GuildScheduledEventStatus.Canceled,
        "Подію скасовано івентором",
      );
    }

    await this.updateAnnouncementStatus(
      occurrence,
      "❌ Подію скасовано",
      0xef4444,
    );

    const voiceChannel = await guild.channels
      .fetch(occurrence.voiceChannelId)
      .catch(() => null);
    if (voiceChannel?.type === ChannelType.GuildVoice) {
      await voiceChannel.delete("Заплановану подію скасовано");
    }

    if (!this.db.markCancelled(occurrence.id)) {
      throw new Error("Подію вже було змінено.");
    }
  }

  async finish(occurrence: Occurrence): Promise<void> {
    if (!["LOCKED", "OPEN", "ACTIVE"].includes(occurrence.status)) {
      throw new Error("Цю подію вже завершено або скасовано.");
    }
    if (Date.now() < occurrence.startsAt) {
      throw new Error(
        "Подія ще не почалася. Майбутню подію можна скасувати командою /event cancel або /movie cancel.",
      );
    }

    const guild = await this.client.guilds.fetch(occurrence.guildId);
    const scheduledEvent = await guild.scheduledEvents
      .fetch(occurrence.scheduledEventId)
      .catch(() => null);

    if (scheduledEvent?.isActive()) {
      await scheduledEvent.setStatus(
        GuildScheduledEventStatus.Completed,
        "Завершено ведучим",
      );
    } else if (scheduledEvent?.isScheduled()) {
      if (Date.now() >= occurrence.startsAt) {
        const activeEvent = await scheduledEvent.setStatus(
          GuildScheduledEventStatus.Active,
          "Подія фактично відбулася",
        );
        await activeEvent.setStatus(
          GuildScheduledEventStatus.Completed,
          "Завершено ведучим",
        );
      } else {
        await scheduledEvent.setStatus(
          GuildScheduledEventStatus.Canceled,
          "Завершено ведучим до початку",
        );
      }
    }

    await this.updateAnnouncementStatus(
      occurrence,
      "✅ Подію завершено",
      0x22c55e,
    );

    const voiceChannel = await guild.channels
      .fetch(occurrence.voiceChannelId)
      .catch(() => null);

    if (voiceChannel?.type === ChannelType.GuildVoice) {
      await voiceChannel.permissionOverwrites
        .edit(
          guild.roles.everyone.id,
          { Connect: false },
          { reason: "Подію завершено" },
        )
        .catch(() => undefined);
      await voiceChannel.delete("Подію завершено ведучим");
    }

    if (!this.db.markFinished(occurrence.id)) {
      throw new Error("Подію вже було змінено.");
    }
  }

  async refreshPanel(occurrenceId: string): Promise<void> {
    const occurrence = this.db.getOccurrence(occurrenceId);
    if (!occurrence) {
      return;
    }

    const guild = await this.client.guilds.fetch(occurrence.guildId);
    const voiceChannel = await guild.channels
      .fetch(occurrence.voiceChannelId)
      .catch(() => null);
    if (voiceChannel?.type !== ChannelType.GuildVoice) {
      return;
    }

    const message = await voiceChannel.messages
      .fetch(occurrence.panelMessageId)
      .catch(() => null);
    if (!message) {
      return;
    }

    await message.edit(buildHostPanel(occurrence, voiceChannel.userLimit));
  }

  private async fetchVoiceChannel(
    guild: Guild,
    occurrence: Occurrence,
  ): Promise<VoiceChannel> {
    const channel = await guild.channels.fetch(occurrence.voiceChannelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      throw new Error("Голосовий канал цієї події більше не існує.");
    }
    return channel;
  }

  private async updateAnnouncementStatus(
    occurrence: Occurrence,
    status: string,
    color: number,
  ): Promise<void> {
    const guild = await this.client.guilds.fetch(occurrence.guildId);
    const channel = await guild.channels
      .fetch(occurrence.announcementChannelId)
      .catch(() => null);
    if (!isGuildTextChannel(channel)) {
      return;
    }

    const message = await channel.messages
      .fetch(occurrence.announcementMessageId)
      .catch(() => null);
    if (!message || !message.embeds[0]) {
      return;
    }

    const embed = applyTemplateMedia(
      EmbedBuilder.from(message.embeds[0]),
      occurrence.templateSnapshot,
    )
      .setColor(color)
      .setFooter({ text: status });

    await message.edit({
      content: "",
      allowedMentions: { parse: [] },
      embeds: [embed],
      components: [],
      attachments: [],
      files: buildTemplateFiles(occurrence.templateSnapshot, this.media),
    });
  }

}
