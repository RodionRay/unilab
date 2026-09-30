export type ProxyProtocol = "socks5" | "http";

export type ParsedProxy = {
  host: string;
  port: number;
  protocol: ProxyProtocol;
  username: string;
  password: string;
  name: string;
};

const HOST_RE = /^[a-zA-Z0-9.-]+$/;

function assertHostPort(host: string, port: number, label: string) {
  if (!HOST_RE.test(host) || host.length > 253) {
    throw new Error(`${label}: некорректный хост`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label}: некорректный порт`);
  }
}

/**
 * TGLab: ip:port:login:password[:название]
 * Имя опционально; если сегментов > 4 и последний без спецсимволов пароля — это название.
 */
function parseColonLine(
  line: string,
  protocol: ProxyProtocol,
  label: string,
): ParsedProxy {
  const parts = line.split(":");
  if (parts.length < 4) {
    throw new Error(`${label}: нужен host:port:user:password`);
  }
  const host = parts[0]!;
  const port = Number(parts[1]);
  const username = parts[2]!;
  let password: string;
  let customName = "";
  if (parts.length === 4) {
    password = parts[3]!;
  } else {
    // host:port:user:pass:name  или  host:port:user:pass:with:colons
    // Если последний сегмент похож на короткое имя (буквы/цифры/пробелы) — отделяем.
    const last = parts[parts.length - 1]!;
    if (/^[\wа-яА-ЯёЁ .-]{1,40}$/.test(last) && parts.length >= 5) {
      customName = last.trim();
      password = parts.slice(3, -1).join(":");
    } else {
      password = parts.slice(3).join(":");
    }
  }
  assertHostPort(host, port, label);
  if (!username) throw new Error(`${label}: пустой логин`);
  if (!password) throw new Error(`${label}: пустой пароль`);
  return {
    host,
    port,
    protocol,
    username,
    password,
    name: customName || `Прокси ${host}:${port}`,
  };
}

/** socks5://user:pass@host:port или user:pass@host:port */
function parseUrlLine(
  line: string,
  fallbackProtocol: ProxyProtocol,
  label: string,
): ParsedProxy {
  let u: URL;
  try {
    u = new URL(line.includes("://") ? line : `${fallbackProtocol}://${line}`);
  } catch {
    throw new Error(`${label}: проверьте формат строки`);
  }
  const protocol = u.protocol.replace(":", "") as ProxyProtocol;
  if (protocol !== "socks5" && protocol !== "http") {
    throw new Error(`${label}: протокол только socks5 или http`);
  }
  const port = Number(u.port || (protocol === "http" ? "80" : ""));
  assertHostPort(u.hostname, port, label);
  if ((u.pathname && u.pathname !== "/") || u.search || u.hash) {
    throw new Error(`${label}: лишние символы в строке`);
  }
  const username = decodeURIComponent(u.username || "");
  const password = decodeURIComponent(u.password || "");
  return {
    host: u.hostname,
    port,
    protocol,
    username,
    password,
    name: `Прокси ${u.hostname}:${port}`,
  };
}

/**
 * Поддерживает:
 * - host:port:user:password
 * - socks5://user:pass@host:port / http://...
 * - user:pass@host:port
 */
export function parseProxyLine(
  raw: string,
  defaultProtocol: ProxyProtocol = "socks5",
  label = "Строка",
): ParsedProxy {
  const line = raw.trim();
  if (!line) throw new Error(`${label}: пустая строка`);

  if (line.includes("://") || line.includes("@")) {
    return parseUrlLine(line, defaultProtocol, label);
  }

  // IPv4/host:port:user:pass — не менее 4 сегментов через :
  if (line.split(":").length >= 4) {
    return parseColonLine(line, defaultProtocol, label);
  }

  throw new Error(
    `${label}: используйте host:port:user:password или socks5://user:pass@host:port`,
  );
}

export function parseProxyLines(
  text: string,
  defaultProtocol: ProxyProtocol = "socks5",
): ParsedProxy[] {
  // TGLab: строки и/или через запятую
  const lines = text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length || lines.length > 100) {
    throw new Error("Введите от 1 до 100 прокси");
  }
  return lines.map((line, i) =>
    parseProxyLine(line, defaultProtocol, `Строка ${i + 1}`),
  );
}

/** Телефон из имени zip: 10000000000.zip → +10000000000 */
export function phoneFromAccountZipName(filename: string): string {
  const base = filename.replace(/\.(zip|rar)$/i, "").trim();
  const digits = base.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    throw new Error(
      `Файл «${filename}»: имя должно содержать номер телефона (8–15 цифр)`,
    );
  }
  return `+${digits}`;
}
