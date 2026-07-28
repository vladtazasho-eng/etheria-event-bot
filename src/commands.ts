import {
  SlashCommandBuilder,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { TemplateKind } from "./domain/types.js";

function addCreateSubcommand(
  subcommand: SlashCommandSubcommandBuilder,
  kind: TemplateKind,
): SlashCommandSubcommandBuilder {
  return subcommand
    .setName("create")
    .setDescription(
      kind === "MOVIE"
        ? "Створити шаблон фільму"
        : "Створити шаблон івенту",
    )
    .addAttachmentOption((option) =>
      option
        .setName("main_image")
        .setDescription("Основна картинка знизу")
        .setRequired(true),
    )
    .addAttachmentOption((option) =>
      option
        .setName("side_image")
        .setDescription("Необов’язкова бокова картинка")
        .setRequired(false),
    );
}

function addEditSubcommand(
  subcommand: SlashCommandSubcommandBuilder,
  kind: TemplateKind,
): SlashCommandSubcommandBuilder {
  return subcommand
    .setName("edit")
    .setDescription(
      kind === "MOVIE"
        ? "Редагувати шаблон фільму"
        : "Редагувати шаблон івенту",
    )
    .addStringOption((option) =>
      option
        .setName("template")
        .setDescription("Шаблон для редагування")
        .setAutocomplete(true)
        .setRequired(true),
    )
    .addAttachmentOption((option) =>
      option
        .setName("main_image")
        .setDescription("Нова основна картинка")
        .setRequired(false),
    )
    .addAttachmentOption((option) =>
      option
        .setName("side_image")
        .setDescription("Нова бокова картинка")
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName("remove_side_image")
        .setDescription("Прибрати поточну бокову картинку")
        .setRequired(false),
    );
}

function buildKindCommand(name: "event" | "movie", kind: TemplateKind) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(
      kind === "MOVIE" ? "Керування фільмами" : "Керування івентами",
    )
    .setDMPermission(false)
    .addSubcommand((subcommand) => addCreateSubcommand(subcommand, kind))
    .addSubcommand((subcommand) => addEditSubcommand(subcommand, kind))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("delete")
        .setDescription("Видалити збережений шаблон")
        .addStringOption((option) =>
          option
            .setName("template")
            .setDescription("Шаблон для видалення")
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("Показати збережені шаблони")
        .addIntegerOption((option) =>
          option
            .setName("page")
            .setDescription("Номер сторінки")
            .setMinValue(1)
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("start")
        .setDescription("Запланувати і створити конкретну подію")
        .addStringOption((option) =>
          option
            .setName("template")
            .setDescription("Збережений шаблон")
            .setAutocomplete(true)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("date")
            .setDescription("Дата у форматі ДД.ММ.РРРР")
            .setRequired(true)
            .setMinLength(10)
            .setMaxLength(10),
        )
        .addStringOption((option) =>
          option
            .setName("time")
            .setDescription("Час у форматі ГГ:ХХ")
            .setRequired(true)
            .setMinLength(5)
            .setMaxLength(5),
        )
        .addUserOption((option) =>
          option
            .setName("host")
            .setDescription("Інший івентор-ведучий (необов’язково)")
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("cancel")
        .setDescription("Скасувати заплановану подію")
        .addStringOption((option) =>
          option
            .setName("event")
            .setDescription("Подія для скасування")
            .setAutocomplete(true)
            .setRequired(true),
        ),
    );
}

export const eventCommand = buildKindCommand("event", "EVENT");
export const movieCommand = buildKindCommand("movie", "MOVIE");
export const commands = [eventCommand, movieCommand];
