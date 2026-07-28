import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
  type Attachment,
  type ButtonInteraction,
} from "discord.js";
import type { EventDatabase } from "../db/database.js";
import type { EventTemplate, TemplateKind } from "../domain/types.js";
import type { EventBotConfig } from "../config.js";
import type {
  DiscordImageAttachment,
  MediaStorage,
} from "../media/storage.js";
import { buildTemplatePreview } from "../presentation/embeds.js";
import {
  deleteTemplateSessions,
  templateFormSessions,
} from "../interactions/sessions.js";

function attachmentData(
  attachment: Attachment | null,
): DiscordImageAttachment | null {
  if (!attachment) {
    return null;
  }

  return {
    url: attachment.url,
    name: attachment.name,
    contentType: attachment.contentType,
    size: attachment.size,
  };
}

function textInput(
  customId: string,
  label: string,
  style: TextInputStyle,
  value: string | null,
  maxLength: number,
  required = true,
): ActionRowBuilder<TextInputBuilder> {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required)
    .setMaxLength(maxLength);

  if (value) {
    input.setValue(value.slice(0, maxLength));
  }

  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function buildTemplateModal(
  kind: TemplateKind,
  sessionId: string,
  template: EventTemplate | null,
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`tpl:form:${sessionId}`)
    .setTitle(
      `${template ? "Редагування" : "Новий шаблон"} ${
        kind === "MOVIE" ? "фільму" : "івенту"
      }`.slice(0, 45),
    )
    .addComponents(
      textInput(
        "name",
        "Назва",
        TextInputStyle.Short,
        template?.name ?? null,
        100,
      ),
    );

  if (kind === "MOVIE") {
    modal.addComponents(
      textInput(
        "genre",
        "Жанр",
        TextInputStyle.Short,
        template?.genre ?? null,
        200,
      ),
      textInput(
        "release_year",
        "Рік",
        TextInputStyle.Short,
        template?.releaseYear ?? null,
        20,
      ),
      textInput(
        "duration",
        "Серії або тривалість",
        TextInputStyle.Short,
        template?.duration ?? null,
        100,
      ),
    );
  }

  modal.addComponents(
    textInput(
      "description",
      "Опис",
      TextInputStyle.Paragraph,
      template?.description ?? null,
      4_000,
    ),
  );

  return modal;
}

export async function handleTemplateCommand(
  interaction: ChatInputCommandInteraction,
  kind: TemplateKind,
  db: EventDatabase,
  media: MediaStorage,
  config: EventBotConfig,
): Promise<boolean> {
  const subcommand = interaction.options.getSubcommand();
  if (!["create", "edit", "delete", "list"].includes(subcommand)) {
    return false;
  }

  if (!interaction.guild || interaction.guildId !== config.guildId) {
    throw new Error("Ця команда працює лише на налаштованому сервері.");
  }

  if (subcommand === "list") {
    const page = interaction.options.getInteger("page") ?? 1;
    const pageSize = 10;
    const result = db.listTemplates(config.guildId, kind, page, pageSize);
    const totalPages = Math.max(1, Math.ceil(result.total / pageSize));

    if (page > totalPages) {
      await interaction.reply({
        content: `Такої сторінки немає. Усього сторінок: ${totalPages}.`,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const lines = result.templates.map((template, index) => {
      const number = (page - 1) * pageSize + index + 1;
      const movieDetails =
        template.kind === "MOVIE"
          ? ` — ${[template.releaseYear, template.duration]
              .filter(Boolean)
              .join(", ")}`
          : "";
      return `**${number}. ${template.name}**${movieDetails}`;
    });

    const embed = new EmbedBuilder()
      .setColor(kind === "MOVIE" ? 0x3b82f6 : 0x8b5cf6)
      .setTitle(
        kind === "MOVIE" ? "Збережені фільми" : "Збережені івенти",
      )
      .setDescription(lines.join("\n\n") || "Шаблонів поки немає.")
      .setFooter({ text: `Сторінка ${page}/${totalPages} · Усього ${result.total}` });

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (subcommand === "delete") {
    const templateId = interaction.options.getString("template", true);
    const template = db.getTemplate(templateId, config.guildId, kind);
    if (!template) {
      throw new Error("Шаблон не знайдено або його вже видалено.");
    }

    const session = deleteTemplateSessions.create({
      initiatorId: interaction.user.id,
      guildId: config.guildId,
      kind,
      templateId: template.id,
      templateName: template.name,
    });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`tpldelete:confirm:${session.id}`)
        .setLabel("Видалити")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`tpldelete:cancel:${session.id}`)
        .setLabel("Залишити")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      content: `Видалити шаблон **${template.name}**? Уже створені події не зміняться.`,
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const operation = subcommand === "create" ? "CREATE" : "EDIT";
  const template =
    operation === "EDIT"
      ? db.getTemplate(
          interaction.options.getString("template", true),
          config.guildId,
          kind,
        )
      : null;

  if (operation === "EDIT" && !template) {
    throw new Error("Шаблон не знайдено або його вже видалено.");
  }

  const mainImage = attachmentData(
    interaction.options.getAttachment("main_image"),
  );
  const sideImage = attachmentData(
    interaction.options.getAttachment("side_image"),
  );
  const removeSideImage =
    interaction.options.getBoolean("remove_side_image") ?? false;

  if (operation === "CREATE" && !mainImage) {
    throw new Error("Основна картинка обов’язкова.");
  }
  if (sideImage && removeSideImage) {
    throw new Error(
      "Не можна одночасно завантажити нову бокову картинку і прибрати її.",
    );
  }

  if (mainImage) {
    media.validateImage(mainImage);
  }
  if (sideImage) {
    media.validateImage(sideImage);
  }

  const session = templateFormSessions.create({
    operation,
    initiatorId: interaction.user.id,
    guildId: config.guildId,
    kind,
    template,
    mainImage,
    sideImage,
    removeSideImage,
  });

  await interaction.showModal(buildTemplateModal(kind, session.id, template));
  return true;
}

export async function handleTemplateModal(
  interaction: ModalSubmitInteraction,
  db: EventDatabase,
  media: MediaStorage,
  config: EventBotConfig,
): Promise<boolean> {
  if (!interaction.customId.startsWith("tpl:form:")) {
    return false;
  }

  const sessionId = interaction.customId.slice("tpl:form:".length);
  const session = templateFormSessions.consume(sessionId);
  if (!session || session.initiatorId !== interaction.user.id) {
    throw new Error("Форма застаріла. Запустіть команду ще раз.");
  }
  if (!interaction.guild || interaction.guildId !== config.guildId) {
    throw new Error("Сервер не знайдено.");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const name = interaction.fields.getTextInputValue("name").trim();
  const description = interaction.fields
    .getTextInputValue("description")
    .trim();
  const genre =
    session.kind === "MOVIE"
      ? interaction.fields.getTextInputValue("genre").trim()
      : null;
  const releaseYear =
    session.kind === "MOVIE"
      ? interaction.fields.getTextInputValue("release_year").trim()
      : null;
  const duration =
    session.kind === "MOVIE"
      ? interaction.fields.getTextInputValue("duration").trim()
      : null;

  if (!name || !description) {
    throw new Error("Назва та опис не можуть бути порожніми.");
  }

  const newlySavedPaths: string[] = [];

  try {
    const newMainPath = session.mainImage
      ? await media.saveImage(session.mainImage)
      : null;
    if (newMainPath) {
      newlySavedPaths.push(newMainPath);
    }

    const newSidePath = session.sideImage
      ? await media.saveImage(session.sideImage)
      : null;
    if (newSidePath) {
      newlySavedPaths.push(newSidePath);
    }

    let template: EventTemplate | null;

    if (session.operation === "CREATE") {
      if (!newMainPath) {
        throw new Error("Не вдалося зберегти основну картинку.");
      }

      template = db.createTemplate({
        guildId: session.guildId,
        kind: session.kind,
        name,
        description,
        genre,
        releaseYear,
        duration,
        thumbnailPath: newSidePath,
        bannerPath: newMainPath,
        createdBy: interaction.user.id,
      });
    } else {
      const current = session.template;
      if (!current) {
        throw new Error("Шаблон більше не існує.");
      }

      template = db.updateTemplate(current.id, session.guildId, session.kind, {
        name,
        description,
        genre,
        releaseYear,
        duration,
        thumbnailPath: session.removeSideImage
          ? null
          : newSidePath ?? current.thumbnailPath,
        bannerPath: newMainPath ?? current.bannerPath,
      });
    }

    if (!template) {
      throw new Error("Не вдалося зберегти шаблон.");
    }

    const preview = buildTemplatePreview(template, media);
    await interaction.editReply({
      content:
        session.operation === "CREATE"
          ? "Шаблон створено."
          : "Шаблон оновлено.",
      ...preview,
    });
  } catch (error) {
    await Promise.all(newlySavedPaths.map((item) => media.remove(item)));
    throw error;
  }

  return true;
}

export async function handleDeleteTemplateButton(
  interaction: ButtonInteraction,
  db: EventDatabase,
  config: EventBotConfig,
): Promise<boolean> {
  if (!interaction.customId.startsWith("tpldelete:")) {
    return false;
  }

  const [, action, sessionId] = interaction.customId.split(":");
  if (!sessionId || (action !== "confirm" && action !== "cancel")) {
    return false;
  }

  const session = deleteTemplateSessions.consume(sessionId);
  if (!session || session.initiatorId !== interaction.user.id) {
    throw new Error("Підтвердження застаріло.");
  }

  if (action === "cancel") {
    await interaction.update({
      content: `Шаблон **${session.templateName}** залишено.`,
      components: [],
    });
    return true;
  }

  const deleted = db.archiveTemplate(
    session.templateId,
    session.guildId,
    session.kind,
  );

  await interaction.update({
    content: deleted
      ? `Шаблон **${session.templateName}** видалено зі списку.`
      : "Шаблон уже було видалено.",
    components: [],
  });
  return true;
}
