import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface DiscordImageAttachment {
  url: string;
  name: string;
  contentType: string | null;
  size: number;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const extensionsByContentType: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export class MediaStorage {
  constructor(private readonly dataDir: string) {}

  async initialize(): Promise<void> {
    await mkdir(path.join(this.dataDir, "media"), { recursive: true });
  }

  validateImage(attachment: DiscordImageAttachment): void {
    const contentType = attachment.contentType?.toLowerCase() ?? "";
    if (!extensionsByContentType[contentType]) {
      throw new Error(
        `Файл «${attachment.name}» має бути PNG, JPEG, WEBP або GIF.`,
      );
    }

    if (attachment.size > MAX_IMAGE_BYTES) {
      throw new Error(
        `Файл «${attachment.name}» завеликий. Максимальний розмір — 10 МБ.`,
      );
    }
  }

  async saveImage(attachment: DiscordImageAttachment): Promise<string> {
    this.validateImage(attachment);

    const contentType = attachment.contentType!.toLowerCase();
    const extension = extensionsByContentType[contentType]!;
    const relativePath = path.posix.join("media", `${randomUUID()}${extension}`);
    const absolutePath = this.resolve(relativePath);

    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(
        `Не вдалося завантажити «${attachment.name}» з Discord.`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(
        `Файл «${attachment.name}» завеликий. Максимальний розмір — 10 МБ.`,
      );
    }

    await writeFile(absolutePath, buffer, { flag: "wx" });
    return relativePath;
  }

  async read(relativePath: string): Promise<Buffer> {
    return readFile(this.resolve(relativePath));
  }

  absolutePath(relativePath: string): string {
    return this.resolve(relativePath);
  }

  async remove(relativePath: string): Promise<void> {
    await unlink(this.resolve(relativePath)).catch(() => undefined);
  }

  private resolve(relativePath: string): string {
    const absolutePath = path.resolve(this.dataDir, relativePath);
    const relative = path.relative(this.dataDir, absolutePath);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Invalid media path");
    }

    return absolutePath;
  }
}
