import AdmZip from "adm-zip";
import path from "node:path";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import {
  MAX_EXTRACTED_BYTES,
  MAX_FILE_COUNT,
  MAX_SINGLE_FILE_BYTES,
} from "@/lib/config";

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

function invalid(message: string): never {
  throw new UploadValidationError(message);
}

const BLOCKED_EXTENSIONS = new Set([
  ".php", ".php3", ".php4", ".php5", ".phtml", ".phar", ".py", ".pyc",
  ".pl", ".cgi", ".asp", ".aspx", ".jsp", ".jar", ".exe", ".dll", ".bat",
  ".cmd", ".com", ".msi", ".ps1", ".sh", ".bash", ".zsh", ".apk", ".ipa",
  ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz",
]);

function normalizedEntryName(name: string) {
  return name.replaceAll("\\", "/").replace(/^\.\//, "");
}

function assertSafeRelativePath(name: string) {
  const normalized = normalizedEntryName(name);
  if (!normalized || normalized.includes("\0")) invalid("压缩包包含无效文件名。");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    invalid("压缩包不能包含绝对路径。");
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "..")) {
    invalid("压缩包包含不安全的 ../ 路径。");
  }

  const ext = path.extname(normalized).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    invalid(`不支持文件类型 ${ext}。请只上传静态网站文件。`);
  }
  return parts.join("/");
}

function isSymlink(entry: AdmZip.IZipEntry) {
  const unixMode = (entry.header.attr >>> 16) & 0xffff;
  return (unixMode & 0xf000) === 0xa000;
}

function inspectHtml(html: string, fileName: string) {
  const checks: Array<[RegExp, string]> = [
    [/<input\b[^>]*\btype\s*=\s*["']?password/i, "包含密码输入框"],
    [/<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i, "包含自动刷新或跳转"],
    [/<iframe\b/i, "包含 iframe 嵌入页面"],
    [/<form\b[^>]*\baction\s*=\s*["']?https?:\/\//i, "包含向外部网址提交的表单"],
    [/\b(?:window\.)?location(?:\.href)?\s*=/i, "包含自动跳转脚本"],
    [/\blocation\.(?:assign|replace)\s*\(/i, "包含自动跳转脚本"],
    [/javascript\s*:/i, "包含 javascript: 链接"],
  ];

  for (const [pattern, reason] of checks) {
    if (pattern.test(html)) {
      invalid(`文件 ${fileName} ${reason}，为防止钓鱼或恶意跳转，本平台不允许发布。`);
    }
  }
}

function inspectJavaScript(source: string, fileName: string) {
  const redirects = [
    /\b(?:window\.)?location(?:\.href)?\s*=/i,
    /\blocation\.(?:assign|replace)\s*\(/i,
    /\bwindow\.open\s*\(/i,
  ];
  if (redirects.some((pattern) => pattern.test(source))) {
    invalid("\u6587\u4ef6 " + fileName + " \u5305\u542b\u81ea\u52a8\u8df3\u8f6c\u6216\u5f39\u7a97\u811a\u672c\uff0c\u4e3a\u9632\u6b62\u6076\u610f\u8df3\u8f6c\uff0c\u672c\u5e73\u53f0\u4e0d\u5141\u8bb8\u53d1\u5e03\u3002");
  }
}

export async function prepareUploadedSite(file: File, publicDir: string) {
  const lowerName = file.name.toLowerCase();
  const bytes = Buffer.from(await file.arrayBuffer());
  await mkdir(publicDir, { recursive: true });

  if (lowerName.endsWith(".html") || lowerName.endsWith(".htm")) {
    if (bytes.length > MAX_SINGLE_FILE_BYTES) invalid("HTML 文件不能超过 10MB。");
    inspectHtml(bytes.toString("utf8"), file.name);
    await writeFile(path.join(publicDir, "index.html"), bytes);
    return { fileCount: 1, extractedBytes: bytes.length, mode: "html" as const };
  }

  if (!lowerName.endsWith(".zip")) {
    invalid("目前只支持单个 HTML 文件或 ZIP 静态网站压缩包。");
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(bytes);
  } catch {
    invalid("ZIP 文件无法读取，请重新压缩后再上传。");
  }

  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  if (!entries.length) invalid("ZIP 中没有可部署的文件。");
  if (entries.length > MAX_FILE_COUNT) invalid(`ZIP 文件数不能超过 ${MAX_FILE_COUNT} 个。`);

  let totalBytes = 0;
  const inspected = entries.map((entry) => {
    if (isSymlink(entry)) invalid("ZIP 不能包含符号链接。");
    const safeName = assertSafeRelativePath(entry.entryName);
    const size = entry.header.size;
    if (size > MAX_SINGLE_FILE_BYTES) invalid(`文件 ${safeName} 超过 10MB。`);
    totalBytes += size;
    if (totalBytes > MAX_EXTRACTED_BYTES) invalid("ZIP 解压后的总大小不能超过 50MB。");
    return { entry, safeName };
  });

  const rootNames = new Set(inspected.map(({ safeName }) => safeName.split("/")[0]));
  const hasRootIndex = inspected.some(({ safeName }) => safeName.toLowerCase() === "index.html");
  let stripPrefix = "";

  if (!hasRootIndex && rootNames.size === 1) {
    const onlyRoot = [...rootNames][0];
    if (inspected.some(({ safeName }) => safeName.toLowerCase() === `${onlyRoot.toLowerCase()}/index.html`)) {
      stripPrefix = `${onlyRoot}/`;
    }
  }

  for (const { entry, safeName } of inspected) {
    const relativeName = stripPrefix && safeName.startsWith(stripPrefix)
      ? safeName.slice(stripPrefix.length)
      : safeName;
    if (!relativeName) continue;

    const destination = path.resolve(publicDir, relativeName);
    const relativeDestination = path.relative(publicDir, destination);
    if (relativeDestination.startsWith("..") || path.isAbsolute(relativeDestination)) {
      invalid("ZIP 解压路径不安全。");
    }

    const data = entry.getData();
    if (/\.html?$/i.test(relativeName)) inspectHtml(data.toString("utf8"), relativeName);
    if (/\.(?:js|mjs)$/i.test(relativeName)) inspectJavaScript(data.toString("utf8"), relativeName);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, data);
  }

  await ensureIndexHtml(publicDir);
  return { fileCount: entries.length, extractedBytes: totalBytes, mode: "zip" as const };
}

async function ensureIndexHtml(publicDir: string) {
  const entries = await readdir(publicDir, { withFileTypes: true });
  const index = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === "index.html");
  if (!index) invalid("网站根目录必须包含 index.html。");
  const indexStat = await stat(path.join(publicDir, index.name));
  if (!indexStat.size) invalid("index.html 不能为空。");
}
