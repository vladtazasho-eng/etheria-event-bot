import type { EventBotConfig } from "../config.js";
import type { EventDatabase } from "../db/database.js";
import type { OccurrenceService } from "./service.js";

export function startOccurrenceScheduler(
  db: EventDatabase,
  service: OccurrenceService,
  config: EventBotConfig,
): () => void {
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }
    running = true;

    try {
      const now = Date.now();
      const dueToOpen = db.getDueToOpen(config.guildId, now);
      for (const occurrence of dueToOpen) {
        try {
          await service.open(occurrence);
          console.log(
            `Opened voice channel for ${occurrence.templateSnapshot.name} (${occurrence.id})`,
          );
        } catch (error) {
          console.error(`Could not open occurrence ${occurrence.id}:`, error);
        }
      }

      const dueToStart = db.getDueToStart(config.guildId, now);
      for (const occurrence of dueToStart) {
        try {
          await service.start(occurrence);
          console.log(
            `Started scheduled event for ${occurrence.templateSnapshot.name}`,
          );
        } catch (error) {
          console.error(`Could not start occurrence ${occurrence.id}:`, error);
        }
      }
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), 15_000);
  timer.unref();

  return () => clearInterval(timer);
}
