import { env } from "cloudflare:workers";
import { getDatabase, type D1LikeDatabase } from "@/lib/db";

export const database = (): D1LikeDatabase => getDatabase();

async function encryptionKey() {
  const value =
    (env as unknown as { ENCRYPTION_KEY?: string }).ENCRYPTION_KEY ||
    process.env.ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("Хранилище секретов не настроено");
  }
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(value.match(/../g)!.map((x) => parseInt(x, 16))),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

export async function seal(value: string, owner: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(owner),
    },
    await encryptionKey(),
    new TextEncoder().encode(value),
  );
  return JSON.stringify({
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(data)),
  });
}

export async function unseal(value: string, owner: string) {
  const v = JSON.parse(value) as { iv: number[]; data: number[] };
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(v.iv),
        additionalData: new TextEncoder().encode(owner),
      },
      await encryptionKey(),
      new Uint8Array(v.data),
    ),
  );
}
