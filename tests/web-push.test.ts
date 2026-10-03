import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  base64UrlToBytes,
  buildWebPushBody,
  bytesToBase64Url,
  importEcdhPrivate,
} from "@/lib/push/crypto";
import { notificationPath, shouldDropSubscription } from "@/lib/push/link";

const asPublic =
  "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
const asPrivate = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
const uaPublic =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const auth = "BTBZMqHH6r4Tts7J_aSIgg";
const salt = "DGv6ra1nlYgDCS1FRnbzlw";

describe("web push", () => {
  it("matches the RFC 8291 encryption vector", async () => {
    const body = await buildWebPushBody({
      plaintext: "When I grow up, I want to be a watermelon",
      p256dh: uaPublic,
      auth,
      localPublicKey: base64UrlToBytes(asPublic),
      localPrivateKey: await importEcdhPrivate(asPublic, asPrivate),
      salt: base64UrlToBytes(salt),
    });
    expect(bytesToBase64Url(body.slice(86))).toBe(
      "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
    );
  });

  it("treats expired endpoints as removable and keeps navigation local", () => {
    expect(shouldDropSubscription(404)).toBe(true);
    expect(shouldDropSubscription(410)).toBe(true);
    expect(shouldDropSubscription(500)).toBe(false);
    expect(notificationPath({ url: "/leagues/abc/trades/def" })).toBe(
      "/leagues/abc/trades/def",
    );
    expect(notificationPath({ url: "https://evil.example/phish" })).toBe("/");
  });

  it("opens a same-origin path when a notification is clicked", () => {
    const worker = readFileSync("public/sw.js", "utf8");
    expect(worker).toContain("notificationclick");
    expect(worker).toContain("openWindow");
    expect(worker).toContain('startsWith("/")');
    expect(worker).not.toContain("localStorage");
  });
});
