import type { AutocompleteInteraction } from "discord.js";
import type { EventBotConfig } from "../config.js";
import type { EventDatabase } from "../db/database.js";
import type { TemplateKind } from "../domain/types.js";
import { formatLocalDateTime } from "../time/local-time.js";

export async function handleAutocomplete(
  interaction: AutocompleteInteraction,
  db: EventDatabase,
  config: EventBotConfig,
): Promise<void> {
  const kind: TemplateKind =
    interaction.commandName === "movie" ? "MOVIE" : "EVENT";
  const focused = interaction.options.getFocused(true);
  const query = String(focused.value);

  if (focused.name === "template") {
    const templates = db.searchTemplates(config.guildId, kind, query);
    await interaction.respond(
      templates.map((template) => ({
        name: template.name.slice(0, 100),
        value: template.id,
      })),
    );
    return;
  }

  if (focused.name === "event") {
    const occurrences = db.searchCancelableOccurrences(
      config.guildId,
      kind,
      query,
    );
    await interaction.respond(
      occurrences.map((occurrence) => ({
        name: `${occurrence.templateSnapshot.name} · ${formatLocalDateTime(
          occurrence.startsAt,
          config.timeZone,
        )}`.slice(0, 100),
        value: occurrence.id,
      })),
    );
    return;
  }

  await interaction.respond([]);
}
