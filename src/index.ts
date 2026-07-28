import path from "node:path";
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type Interaction,
} from "discord.js";
import { config } from "./config.js";
import { EventDatabase } from "./db/database.js";
import { handleAutocomplete } from "./interactions/autocomplete.js";
import { MediaStorage } from "./media/storage.js";
import {
  handleDeleteTemplateButton,
  handleTemplateCommand,
  handleTemplateModal,
} from "./templates/handler.js";
import {
  handleCancelOccurrenceButton,
  handleFinishButton,
  handleHostPanelButton,
  handleKickSelect,
  handleOccurrenceCommand,
  handlePlanButton,
  handleSlotsModal,
} from "./occurrences/handler.js";
import { startOccurrenceScheduler } from "./occurrences/scheduler.js";
import { OccurrenceService } from "./occurrences/service.js";
import type { TemplateKind } from "./domain/types.js";

const database = new EventDatabase(
  path.join(config.dataDir, "event-bot.sqlite"),
);
const media = new MediaStorage(config.dataDir);
await media.initialize();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

let occurrenceService: OccurrenceService | null = null;
let stopScheduler: (() => void) | null = null;

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Event bot is online as ${readyClient.user.tag}`);
  occurrenceService = new OccurrenceService(
    readyClient,
    database,
    media,
    config,
  );
  stopScheduler = startOccurrenceScheduler(
    database,
    occurrenceService,
    config,
  );
});

function commandKind(commandName: string): TemplateKind | null {
  if (commandName === "event") {
    return "EVENT";
  }
  if (commandName === "movie") {
    return "MOVIE";
  }
  return null;
}

async function dispatchInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction, database, config);
    return;
  }

  if (interaction.isChatInputCommand()) {
    const kind = commandKind(interaction.commandName);
    if (!kind) {
      return;
    }

    if (
      await handleTemplateCommand(
        interaction,
        kind,
        database,
        media,
        config,
      )
    ) {
      return;
    }
    await handleOccurrenceCommand(
      interaction,
      kind,
      database,
      media,
      config,
    );
    return;
  }

  if (interaction.isModalSubmit()) {
    if (
      await handleTemplateModal(interaction, database, media, config)
    ) {
      return;
    }

    if (!occurrenceService) {
      throw new Error("Бот ще запускається. Спробуйте через кілька секунд.");
    }
    await handleSlotsModal(interaction, database, occurrenceService);
    return;
  }

  if (interaction.isButton()) {
    if (await handleDeleteTemplateButton(interaction, database, config)) {
      return;
    }
    if (!occurrenceService) {
      throw new Error("Бот ще запускається. Спробуйте через кілька секунд.");
    }
    if (await handlePlanButton(interaction, occurrenceService)) {
      return;
    }
    if (
      await handleCancelOccurrenceButton(
        interaction,
        database,
        occurrenceService,
      )
    ) {
      return;
    }
    if (
      await handleFinishButton(interaction, database, occurrenceService)
    ) {
      return;
    }
    await handleHostPanelButton(
      interaction,
      database,
      occurrenceService,
    );
    return;
  }

  if (interaction.isUserSelectMenu()) {
    if (!occurrenceService) {
      throw new Error("Бот ще запускається. Спробуйте через кілька секунд.");
    }
    await handleKickSelect(interaction, database, occurrenceService);
  }
}

async function reportInteractionError(
  interaction: Interaction,
  error: unknown,
): Promise<void> {
  console.error("Interaction error:", error);
  const content =
    error instanceof Error
      ? error.message
      : "Сталася внутрішня помилка. Перевірте журнал бота.";

  if (interaction.isAutocomplete()) {
    await interaction.respond([]).catch(() => undefined);
    return;
  }

  if (!interaction.isRepliable()) {
    return;
  }

  const reply = { content, flags: MessageFlags.Ephemeral } as const;
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(reply).catch(() => undefined);
  } else {
    await interaction.reply(reply).catch(() => undefined);
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await dispatchInteraction(interaction);
  } catch (error) {
    await reportInteractionError(interaction, error);
  }
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down...`);
  stopScheduler?.();
  client.destroy();
  database.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await client.login(config.token);
