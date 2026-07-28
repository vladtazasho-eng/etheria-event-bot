import "dotenv/config";
import path from "node:path";

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

const configuredDataDir =
  process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() ||
  process.env.DATA_DIR?.trim() ||
  "./data";

export const config = {
  token: requireEnvironmentVariable("DISCORD_TOKEN"),
  clientId: requireEnvironmentVariable("DISCORD_CLIENT_ID"),
  guildId: requireEnvironmentVariable("DISCORD_GUILD_ID"),
  announcementChannelId: requireEnvironmentVariable("ANNOUNCEMENT_CHANNEL_ID"),
  eventPingRoleId: requireEnvironmentVariable("EVENT_PING_ROLE_ID"),
  moviePingRoleId: requireEnvironmentVariable("MOVIE_PING_ROLE_ID"),
  voiceCategoryId: requireEnvironmentVariable("EVENT_VOICE_CATEGORY_ID"),
  openBeforeMinutes: positiveInteger("OPEN_BEFORE_MINUTES", 40),
  timeZone: process.env.TIMEZONE?.trim() || "Europe/Kyiv",
  dataDir: path.resolve(configuredDataDir),
};

export type EventBotConfig = typeof config;
