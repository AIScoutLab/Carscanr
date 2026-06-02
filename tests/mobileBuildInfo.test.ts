import assert from "node:assert/strict";
import test from "node:test";
import { resolveMobileBuildInfo } from "../lib/buildInfo";

test("mobile build info prefers active OTA metadata over embedded build metadata", () => {
  const resolved = resolveMobileBuildInfo({
    activeBuildInfo: {
      gitCommit: "ota-commit",
      buildTimestamp: "2026-06-02T13:59:04.609Z",
      version: "1.0.2",
    },
    embeddedBuildInfo: {
      gitCommit: "embedded-commit",
      buildTimestamp: "2026-06-01T20:20:00.000Z",
      version: "1.0.2",
      iosBuildNumber: "96",
    },
    nativeAppVersion: "1.0.2",
    nativeBuildNumber: "96",
    runtimeVersion: "1.0.2",
    updateId: "019e88a1-7aa1-7da2-bb98-f2d5f8480ad0",
    channel: "production",
    createdAt: "2026-06-02T13:59:04.609Z",
    isEmbeddedLaunch: false,
    isEmergencyLaunch: false,
  });

  assert.equal(resolved.gitCommit, "ota-commit");
  assert.equal(resolved.activeOtaGitCommit, "ota-commit");
  assert.equal(resolved.embeddedGitCommit, "embedded-commit");
  assert.equal(resolved.activeOtaUpdateId, "019e88a1-7aa1-7da2-bb98-f2d5f8480ad0");
  assert.equal(resolved.channel, "production");
  assert.equal(resolved.runtimeVersion, "1.0.2");
  assert.equal(resolved.activeOtaCreatedAt, "2026-06-02T13:59:04.609Z");
  assert.equal(resolved.isEmbeddedLaunch, false);
  assert.equal(resolved.isEmergencyLaunch, false);
  assert.equal(resolved.nativeBuildNumber, "96");
});

test("mobile build info keeps embedded metadata separate during embedded launch", () => {
  const resolved = resolveMobileBuildInfo({
    activeBuildInfo: {
      gitCommit: "ota-commit-should-not-report",
    },
    embeddedBuildInfo: {
      gitCommit: "embedded-commit",
      buildTimestamp: "2026-06-01T20:20:00.000Z",
      version: "1.0.2",
      iosBuildNumber: "96",
    },
    nativeAppVersion: "1.0.2",
    nativeBuildNumber: "96",
    runtimeVersion: "1.0.2",
    updateId: "embedded-update-id",
    channel: "production",
    isEmbeddedLaunch: true,
    isEmergencyLaunch: false,
  });

  assert.equal(resolved.gitCommit, "embedded-commit");
  assert.equal(resolved.activeOtaGitCommit, "");
  assert.equal(resolved.activeOtaUpdateId, "");
  assert.equal(resolved.updateId, "embedded-update-id");
  assert.equal(resolved.embeddedGitCommit, "embedded-commit");
  assert.deepEqual(resolved.embeddedBuildInfo, {
    gitCommit: "embedded-commit",
    buildTimestamp: "2026-06-01T20:20:00.000Z",
    version: "1.0.2",
    iosBuildNumber: "96",
  });
  assert.equal(resolved.nativeAppVersion, "1.0.2");
  assert.equal(resolved.nativeBuildNumber, "96");
});
