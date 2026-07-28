import assert from "node:assert/strict";
import test from "node:test";
import { EventDatabase } from "./database.js";
import { snapshotTemplate } from "../domain/types.js";

test("stores templates, snapshots, and occurrence state", () => {
  const db = new EventDatabase(":memory:");

  try {
    const template = db.createTemplate({
      guildId: "guild",
      kind: "EVENT",
      name: "Code Names",
      description: "Командна гра",
      bannerPath: "media/banner.png",
      createdBy: "user",
    });

    const occurrence = db.createOccurrence({
      id: "occurrence",
      guildId: "guild",
      kind: "EVENT",
      templateId: template.id,
      templateSnapshot: snapshotTemplate(template),
      hostUserId: "host",
      pingRoleId: "role",
      startsAt: 2_000,
      opensAt: 1_000,
      status: "LOCKED",
      voiceChannelId: "voice",
      scheduledEventId: "scheduled",
      announcementChannelId: "announcement",
      announcementMessageId: "message",
      panelMessageId: "panel",
      createdBy: "user",
    });

    assert.equal(occurrence.templateSnapshot.name, "Code Names");
    assert.equal(db.getDueToOpen("guild", 1_500).length, 1);
    assert.equal(db.markOpened(occurrence.id), true);
    assert.equal(db.getOccurrence(occurrence.id)?.status, "OPEN");
    assert.equal(db.getDueToStart("guild", 1_999).length, 0);
    assert.equal(db.getDueToStart("guild", 2_000).length, 1);
    assert.equal(db.markActive(occurrence.id), true);
    assert.equal(db.getOccurrence(occurrence.id)?.status, "ACTIVE");

    const boost = db.claimBoost(occurrence.id);
    assert.ok(boost);
    assert.equal(db.getOccurrence(occurrence.id)?.status, "ACTIVE");
    assert.equal(db.claimBoost(occurrence.id), null);
  } finally {
    db.close();
  }
});
