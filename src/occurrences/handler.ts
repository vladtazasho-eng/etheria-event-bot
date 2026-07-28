import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";
import type { EventBotConfig } from "../config.js";
import type { EventDatabase } from "../db/database.js";
import type { Occurrence, TemplateKind } from "../domain/types.js";
import { snapshotTemplate } from "../domain/types.js";
import {
  cancelOccurrenceSessions,
  planSessions,
} from "../interactions/sessions.js";
import type { MediaStorage } from "../media/storage.js";
import { buildTemplatePreview } from "../presentation/embeds.js";
import { parseLocalStartTime } from "../time/local-time.js";
import type { OccurrenceService } from "./service.js";

async function requireHost(
  interaction:
    | ButtonInteraction
    | ModalSubmitInteraction
    | UserSelectMenuInteraction,
  db: EventDatabase,
  occurrenceId: string,
): Promise<Occurrence> {
  const occurrence = db.getOccurrence(occurrenceId);
  if (!occurrence || occurrence.guildId !== interaction.guildId) {
    throw new Error("Подію не знайдено.");
  }
  if (occurrence.hostUserId !== interaction.user.id) {
    throw new Error("Цією панеллю може користуватися лише ведучий події.");
  }
  if (["FINISHED", "CANCELLED"].includes(occurrence.status)) {
    throw new Error("Цю подію вже завершено або скасовано.");
  }
  return occurrence;
}

export async function handleOccurrenceCommand(
  interaction: ChatInputCommandInteraction,
  kind: TemplateKind,
  db: EventDatabase,
  media: MediaStorage,
  config: EventBotConfig,
): Promise<boolean> {
  const subcommand = interaction.options.getSubcommand();
  if (!["start", "cancel"].includes(subcommand)) {
    return false;
  }

  if (!interaction.guild || interaction.guildId !== config.guildId) {
    throw new Error("Ця команда працює лише на налаштованому сервері.");
  }

  if (subcommand === "start") {
    const templateId = interaction.options.getString("template", true);
    const template = db.getTemplate(templateId, config.guildId, kind);
    if (!template) {
      throw new Error("Шаблон не знайдено або його вже видалено.");
    }

    const date = interaction.options.getString("date", true);
    const time = interaction.options.getString("time", true);
    const parsed = parseLocalStartTime(date, time, config.timeZone);
    if (parsed.timestamp < Date.now() + 60_000) {
      throw new Error("Час початку має бути щонайменше через одну хвилину.");
    }

    const selectedHost =
      interaction.options.getUser("host") ?? interaction.user;
    if (selectedHost.bot) {
      throw new Error("Бот не може бути ведучим події.");
    }

    const snapshot = snapshotTemplate(template);
    const session = planSessions.create({
      initiatorId: interaction.user.id,
      guildId: config.guildId,
      kind,
      snapshot,
      startsAt: parsed.timestamp,
      hostUserId: selectedHost.id,
    });
    const openAt =
      parsed.timestamp - config.openBeforeMinutes * 60 * 1_000;

    const preview = buildTemplatePreview(snapshot, media);
    preview.embeds[0]!.addFields(
      { name: "🎧 Ведучий", value: `<@${selectedHost.id}>`, inline: true },
      {
        name: "🫧 Коли",
        value: `<t:${parsed.unixSeconds}:F>\n<t:${parsed.unixSeconds}:R>`,
        inline: true,
      },
      {
        name: "Відкриття каналу",
        value:
          openAt <= Date.now()
            ? "Одразу після створення"
            : `<t:${Math.floor(openAt / 1_000)}:R>`,
        inline: true,
      },
    );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`plan:confirm:${session.id}`)
        .setLabel("Створити подію")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`plan:cancel:${session.id}`)
        .setLabel("Скасувати")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      content: "Перевірте майбутню подію перед створенням:",
      ...preview,
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const occurrenceId = interaction.options.getString("event", true);
  const occurrence = db.getOccurrence(occurrenceId);
  if (
    !occurrence ||
    occurrence.guildId !== config.guildId ||
    occurrence.kind !== kind ||
    !["LOCKED", "OPEN"].includes(occurrence.status) ||
    occurrence.startsAt <= Date.now()
  ) {
    throw new Error("Заплановану подію не знайдено.");
  }

  const session = cancelOccurrenceSessions.create({
    initiatorId: interaction.user.id,
    guildId: config.guildId,
    kind,
    occurrenceId,
    occurrenceName: occurrence.templateSnapshot.name,
  });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`occcancel:confirm:${session.id}`)
      .setLabel("Скасувати подію")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`occcancel:keep:${session.id}`)
      .setLabel("Залишити")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    content: `Скасувати **${occurrence.templateSnapshot.name}** — <t:${Math.floor(
      occurrence.startsAt / 1_000,
    )}:F>? Голосовий канал буде видалено.`,
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

export async function handlePlanButton(
  interaction: ButtonInteraction,
  service: OccurrenceService,
): Promise<boolean> {
  if (!interaction.customId.startsWith("plan:")) {
    return false;
  }

  const [, action, sessionId] = interaction.customId.split(":");
  if (!sessionId || !["confirm", "cancel"].includes(action ?? "")) {
    return false;
  }

  const session = planSessions.consume(sessionId);
  if (!session || session.initiatorId !== interaction.user.id) {
    throw new Error("Підтвердження застаріло. Запустіть команду ще раз.");
  }

  if (action === "cancel") {
    await interaction.update({
      content: "Створення події скасовано.",
      embeds: [],
      components: [],
      attachments: [],
    });
    return true;
  }

  await interaction.deferUpdate();
  const occurrence = await service.create({
    guildId: session.guildId,
    snapshot: session.snapshot,
    hostUserId: session.hostUserId,
    startsAt: session.startsAt,
    createdBy: session.initiatorId,
  });

  await interaction.editReply({
    content: `Подію **${occurrence.templateSnapshot.name}** створено: <#${occurrence.voiceChannelId}> · <t:${Math.floor(
      occurrence.startsAt / 1_000,
    )}:F>.`,
    embeds: [],
    components: [],
    attachments: [],
  });
  return true;
}

export async function handleCancelOccurrenceButton(
  interaction: ButtonInteraction,
  db: EventDatabase,
  service: OccurrenceService,
): Promise<boolean> {
  if (!interaction.customId.startsWith("occcancel:")) {
    return false;
  }

  const [, action, sessionId] = interaction.customId.split(":");
  if (!sessionId || !["confirm", "keep"].includes(action ?? "")) {
    return false;
  }

  const session = cancelOccurrenceSessions.consume(sessionId);
  if (!session || session.initiatorId !== interaction.user.id) {
    throw new Error("Підтвердження застаріло.");
  }

  if (action === "keep") {
    await interaction.update({
      content: `Подію **${session.occurrenceName}** залишено.`,
      components: [],
    });
    return true;
  }

  const occurrence = db.getOccurrence(session.occurrenceId);
  if (!occurrence) {
    throw new Error("Подію більше не знайдено.");
  }

  const confirmation = `Подію **${session.occurrenceName}** скасовано.`;
  const confirmationChannelWillBeDeleted =
    interaction.channelId === occurrence.voiceChannelId;

  await interaction.update({
    content: confirmationChannelWillBeDeleted
      ? `Скасовуємо подію **${session.occurrenceName}**…`
      : confirmation,
    components: [],
  });
  await service.cancel(occurrence);

  if (!confirmationChannelWillBeDeleted) {
    await interaction.editReply({ content: confirmation, components: [] });
  }
  return true;
}

export async function handleHostPanelButton(
  interaction: ButtonInteraction,
  db: EventDatabase,
  service: OccurrenceService,
): Promise<boolean> {
  if (!interaction.customId.startsWith("occ:")) {
    return false;
  }

  const [, action, occurrenceId] = interaction.customId.split(":");
  if (!action || !occurrenceId) {
    return false;
  }
  const occurrence = await requireHost(interaction, db, occurrenceId);

  if (action === "slots") {
    const input = new TextInputBuilder()
      .setCustomId("user_limit")
      .setLabel("Кількість слотів (0 — без обмежень)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(2)
      .setPlaceholder("0");
    const modal = new ModalBuilder()
      .setCustomId(`occslots:${occurrence.id}`)
      .setTitle("Змінити кількість слотів")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(input),
      );
    await interaction.showModal(modal);
    return true;
  }

  if (action === "kick") {
    const select = new UserSelectMenuBuilder()
      .setCustomId(`occkick:${occurrence.id}`)
      .setPlaceholder("Оберіть учасника з голосового каналу")
      .setMinValues(1)
      .setMaxValues(1);
    await interaction.reply({
      content:
        "Оберіть користувача. Бот перевірить, що він зараз перебуває в каналі події.",
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (action === "boost") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await service.boost(occurrence.id);
    await interaction.editReply(
      "Повторний пінг надіслано, а Discord-подію позначено активною.",
    );
    return true;
  }

  if (action === "finish") {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`occfinish:confirm:${occurrence.id}`)
        .setLabel("Так, завершити")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`occfinish:keep:${occurrence.id}`)
        .setLabel("Ні")
        .setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({
      content:
        "Завершити подію? Discord-подія отримає фінальний статус, а голосовий канал буде видалено.",
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  return false;
}

export async function handleSlotsModal(
  interaction: ModalSubmitInteraction,
  db: EventDatabase,
  service: OccurrenceService,
): Promise<boolean> {
  if (!interaction.customId.startsWith("occslots:")) {
    return false;
  }

  const occurrenceId = interaction.customId.slice("occslots:".length);
  const occurrence = await requireHost(interaction, db, occurrenceId);
  const raw = interaction.fields.getTextInputValue("user_limit").trim();
  const limit = Number.parseInt(raw, 10);

  if (!/^\d{1,2}$/.test(raw) || limit < 0 || limit > 99) {
    throw new Error("Вкажіть ціле число від 0 до 99.");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await service.changeUserLimit(occurrence, limit);
  await interaction.editReply(
    limit === 0
      ? "Обмеження учасників вимкнено."
      : `Встановлено ліміт: ${limit}.`,
  );
  return true;
}

export async function handleKickSelect(
  interaction: UserSelectMenuInteraction,
  db: EventDatabase,
  service: OccurrenceService,
): Promise<boolean> {
  if (!interaction.customId.startsWith("occkick:")) {
    return false;
  }

  const occurrenceId = interaction.customId.slice("occkick:".length);
  const occurrence = await requireHost(interaction, db, occurrenceId);
  const userId = interaction.values[0];
  if (!userId) {
    throw new Error("Користувача не обрано.");
  }

  const user = await interaction.client.users.fetch(userId);
  await interaction.deferUpdate();
  await service.blockAndDisconnect(occurrence, user, interaction.user.id);
  await interaction.editReply({
    content: `<@${user.id}> від’єднано і заблоковано для цієї події.`,
    components: [],
    allowedMentions: { parse: [] },
  });
  return true;
}

export async function handleFinishButton(
  interaction: ButtonInteraction,
  db: EventDatabase,
  service: OccurrenceService,
): Promise<boolean> {
  if (!interaction.customId.startsWith("occfinish:")) {
    return false;
  }

  const [, action, occurrenceId] = interaction.customId.split(":");
  if (!occurrenceId || !["confirm", "keep"].includes(action ?? "")) {
    return false;
  }

  const occurrence = await requireHost(interaction, db, occurrenceId);
  if (action === "keep") {
    await interaction.update({
      content: "Подія продовжується.",
      components: [],
    });
    return true;
  }

  const confirmation = "Подію завершено. Голосовий канал видалено.";
  const confirmationChannelWillBeDeleted =
    interaction.channelId === occurrence.voiceChannelId;

  await interaction.update({
    content: confirmationChannelWillBeDeleted
      ? "Завершуємо подію та видаляємо голосовий канал…"
      : confirmation,
    components: [],
  });
  await service.finish(occurrence);

  if (!confirmationChannelWillBeDeleted) {
    await interaction.editReply(confirmation);
  }
  return true;
}
