import JSZip from "jszip";
import { createExtractorFromData } from "node-unrar-js";
import { phoneFromAccountZipName } from "@/lib/proxy-line";
import type { AccountFormat } from "@/lib/telegram-accounts";

export type ParsedAccountZip = {
  phone: string;
  name: string;
  twoFA: string;
  zipBase64: string;
  format: AccountFormat;
  apiId?: number;
  apiHash?: string;
};

export const MAX_ACCOUNT_ARCHIVE_BYTES = 1_048_576; // 1 МБ как в TGLab
export const ACCOUNT_ARCHIVE_ACCEPT = ".zip,.rar,application/zip,application/x-rar-compressed,application/vnd.rar";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function archiveExt(name: string): "zip" | "rar" | null {
  const n = name.toLowerCase();
  if (n.endsWith(".zip")) return "zip";
  if (n.endsWith(".rar")) return "rar";
  return null;
}

function findEntry(
  zip: JSZip,
  names: string[],
  pred: (n: string) => boolean,
) {
  const hit = names.find(pred);
  return hit ? zip.file(hit) : null;
}

async function readTwoFA(zip: JSZip, names: string[]): Promise<string> {
  const entry =
    zip.file("twoFA.txt") ||
    zip.file("2fa.txt") ||
    findEntry(
      zip,
      names,
      (n) => /(^|\/)twoFA\.txt$/i.test(n) || /(^|\/)2fa\.txt$/i.test(n),
    );
  if (!entry) return "";
  return (await entry.async("string")).replace(/\r?\n$/, "").trim();
}

function phoneFromJson(raw: unknown, filename: string): string | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const phone =
    (typeof o.phone === "string" && o.phone) ||
    (typeof o.phone_number === "string" && o.phone_number) ||
    "";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  try {
    return phoneFromAccountZipName(filename);
  } catch {
    return null;
  }
}

let cachedWasm: ArrayBuffer | null = null;

async function loadUnrarWasm(): Promise<ArrayBuffer> {
  if (cachedWasm) return cachedWasm;
  const res = await fetch("/unrar.wasm");
  if (!res.ok) throw new Error("Не удалось загрузить модуль RAR (/unrar.wasm)");
  cachedWasm = await res.arrayBuffer();
  return cachedWasm;
}

/** RAR → ZIP (воркер читает только zip). */
async function rarToZipBytes(data: ArrayBuffer): Promise<Uint8Array> {
  const wasmBinary = await loadUnrarWasm();
  const extractor = await createExtractorFromData({ data, wasmBinary });
  const { fileHeaders } = extractor.getFileList();
  const headers = [...fileHeaders];
  if (!headers.length) throw new Error("RAR пустой");
  const extracted = extractor.extract({ files: headers.map((h) => h.name) });
  const files = [...extracted.files];
  const zip = new JSZip();
  let added = 0;
  for (const f of files) {
    if (f.fileHeader.flags.directory) continue;
    const extraction = f.extraction;
    if (!extraction) continue;
    zip.file(f.fileHeader.name, extraction);
    added++;
  }
  if (!added) throw new Error("В RAR нет файлов для импорта");
  return zip.generateAsync({ type: "uint8array" });
}

async function loadAsZipBytes(file: File): Promise<Uint8Array> {
  const ext = archiveExt(file.name);
  if (!ext) throw new Error(`«${file.name}»: нужен .zip или .rar`);
  if (file.size > MAX_ACCOUNT_ARCHIVE_BYTES) {
    throw new Error(
      `«${file.name}»: архив больше 1 МБ — уберите лишние файлы (как в TGLab)`,
    );
  }
  const buf = await file.arrayBuffer();
  if (ext === "zip") return new Uint8Array(buf);
  try {
    return await rarToZipBytes(buf);
  } catch (e) {
    const msg = String((e as Error).message || e);
    if (/password|encrypt/i.test(msg)) {
      throw new Error(`«${file.name}»: RAR с паролем не поддерживается`);
    }
    throw new Error(`«${file.name}»: не удалось разобрать RAR — ${msg.slice(0, 160)}`);
  }
}

async function parseZipBytes(
  zipBytes: Uint8Array,
  filename: string,
): Promise<ParsedAccountZip> {
  const zip = await JSZip.loadAsync(zipBytes);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n]?.dir);

  const hasTdata = names.some(
    (n) =>
      n === "tdata/key_datas" ||
      n.endsWith("/tdata/key_datas") ||
      /(^|\/)tdata\/key_datas$/.test(n),
  );

  const sessionEntry = findEntry(zip, names, (n) =>
    /(^|\/)[^/]+\.session$/i.test(n),
  );
  const jsonEntry = findEntry(zip, names, (n) => {
    if (!/(^|\/)[^/]+\.json$/i.test(n)) return false;
    if (/(^|\/)tdata\//i.test(n)) return false;
    return true;
  });

  const twoFA = await readTwoFA(zip, names);
  let phone = "";
  let format: AccountFormat = "manual";
  let apiId: number | undefined;
  let apiHash: string | undefined;

  if (hasTdata) {
    format = "tdata";
    phone = phoneFromAccountZipName(filename);
  } else if (sessionEntry && jsonEntry) {
    format = "session_json";
    const jsonText = await jsonEntry.async("string");
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new Error(`«${filename}»: повреждённый json`);
    }
    const o = parsed as Record<string, unknown>;
    if (typeof o.api_id === "number") apiId = o.api_id;
    else if (typeof o.api_id === "string" && /^\d+$/.test(o.api_id)) {
      apiId = Number(o.api_id);
    }
    if (typeof o.api_hash === "string") apiHash = o.api_hash;
    if (!apiId || !apiHash) {
      throw new Error(`«${filename}»: в json нужны api_id и api_hash`);
    }
    const fromJson = phoneFromJson(parsed, filename);
    if (!fromJson) {
      throw new Error(
        `«${filename}»: укажите телефон в имени файла или в json`,
      );
    }
    phone = fromJson;
  } else if (sessionEntry) {
    format = "session";
    try {
      phone = phoneFromAccountZipName(filename);
    } catch {
      throw new Error(
        `«${filename}»: для session без json имя файла должно быть номером`,
      );
    }
  } else {
    throw new Error(
      `«${filename}»: в архиве нет tdata, session или session+json`,
    );
  }

  return {
    phone,
    name: `Аккаунт ${phone}`,
    twoFA,
    zipBase64: bytesToBase64(zipBytes),
    format,
    apiId,
    apiHash,
  };
}

/**
 * ZIP/RAR как в TGLab.
 * Содержимое: tdata/ | session+json | только session.
 * RAR распаковывается в браузере и перепаковывается в ZIP для воркера.
 */
export async function parseAccountZip(file: File): Promise<ParsedAccountZip> {
  const zipBytes = await loadAsZipBytes(file);
  return parseZipBytes(zipBytes, file.name);
}

export function accountSessionSecret(parsed: ParsedAccountZip): string {
  return JSON.stringify({
    kind: parsed.format,
    twoFA: parsed.twoFA,
    zipBase64: parsed.zipBase64,
    sourceName: parsed.name,
    apiId: parsed.apiId,
    apiHash: parsed.apiHash,
  });
}

export function formatArchiveSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 2 : 0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`;
}
