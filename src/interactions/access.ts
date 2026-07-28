import type { Guild, GuildMember } from "discord.js";

export async function fetchMember(
  guild: Guild,
  userId: string,
): Promise<GuildMember | null> {
  return guild.members.fetch(userId).catch(() => null);
}
