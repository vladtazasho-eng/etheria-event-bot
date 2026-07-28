import { DateTime } from "luxon";

export interface ParsedStartTime {
  timestamp: number;
  unixSeconds: number;
}

export function parseLocalStartTime(
  dateInput: string,
  timeInput: string,
  zone: string,
): ParsedStartTime {
  const normalizedDate = dateInput.trim();
  const normalizedTime = timeInput.trim();
  const formats = ["dd.MM.yyyy HH:mm", "yyyy-MM-dd HH:mm"];

  for (const format of formats) {
    const parsed = DateTime.fromFormat(
      `${normalizedDate} ${normalizedTime}`,
      format,
      { zone, locale: "uk", setZone: true },
    );

    if (parsed.isValid) {
      return {
        timestamp: parsed.toMillis(),
        unixSeconds: Math.floor(parsed.toSeconds()),
      };
    }
  }

  throw new Error(
    "Невірна дата або час. Використайте дату ДД.ММ.РРРР і час ГГ:ХХ.",
  );
}

export function formatLocalDateTime(timestamp: number, zone: string): string {
  return DateTime.fromMillis(timestamp, { zone })
    .setLocale("uk")
    .toFormat("dd.MM.yyyy HH:mm");
}
