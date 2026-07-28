import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";
import { config } from "./config.js";

const rest = new REST({ version: "10" }).setToken(config.token);

await rest.put(
  Routes.applicationGuildCommands(config.clientId, config.guildId),
  { body: commands.map((command) => command.toJSON()) },
);

console.log(
  `Registered /event and /movie for guild ${config.guildId}`,
);
