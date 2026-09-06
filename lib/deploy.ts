import { spawn } from "node:child_process";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DEPLOYMENTS_DIR, DEPLOY_TIMEOUT_MS, ROOT_DIR } from "@/lib/config";
import { prepareUploadedSite } from "@/lib/upload";
import {
  CardRecord,
  recordFailedDeployment,
  recordSuccessfulDeployment,
} from "@/lib/cards";
import { ensureSiteForCard } from "@/lib/site-allocation";

const denoCandidates = [
  process.env.DENO_PATH,
  path.join(process.env.USERPROFILE || "", ".deno", "bin", "deno.exe"),
  "deno",
].filter(Boolean) as string[];

let deploymentQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>) {
  const result = deploymentQueue.then(task, task);
  deploymentQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function readApiKey() {
  const envKey = process.env.RTH_API_KEY?.trim();
  if (envKey) return envKey;
  return (await readFile(path.join(ROOT_DIR, "key.txt"), "utf8")).trim();
}

async function resolveDenoPath() {
  for (const candidate of denoCandidates) {
    if (candidate === "deno") return candidate;
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error("未找到 Deno。请安装 Deno 或设置 DENO_PATH。");
}

async function resolveRetieheCliSource() {
  const configuredPath = process.env.RTH_CLI_PATH?.trim();
  const localCandidates = [
    configuredPath
      ? (path.isAbsolute(configuredPath) ? configuredPath : path.join(ROOT_DIR, configuredPath))
      : "",
    path.join(DEPLOYMENTS_DIR, "vendor", "retiehe-cli.mjs"),
  ].filter(Boolean);

  for (const candidate of localCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }

  if (configuredPath) {
    throw new Error("\u672c\u5730\u70ed\u94c1\u76d2 CLI \u6587\u4ef6\u4e0d\u5b58\u5728\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458\u3002");
  }
  return process.env.RTH_CLI_URL?.trim() || "https://host.retiehe.com/cli";
}

function cleanCliOutput(output: string) {
  return output
    .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .trim();
}

async function runRetieheDeploy(publicDir: string, apiKey: string, siteName: string) {
  const denoPath = await resolveDenoPath();
  const cliSource = await resolveRetieheCliSource();
  const relativePublicDir = path.relative(ROOT_DIR, publicDir);
  if (!relativePublicDir || path.isAbsolute(relativePublicDir)
    || relativePublicDir === ".." || relativePublicDir.startsWith(`..${path.sep}`)) {
    throw new Error("\u90e8\u7f72\u76ee\u5f55\u4e0d\u5728\u5e94\u7528\u5de5\u4f5c\u76ee\u5f55\u5185\u3002");
  }
  const cliOutDir = relativePublicDir.split(path.sep).join("/");

  return new Promise<void>((resolve, reject) => {
    const args = [
      "run", "-A", cliSource, "deploy",
      "--site", siteName,
      "--outdir", cliOutDir,
    ];
    const child = spawn(denoPath, args, {
      cwd: ROOT_DIR,
      shell: false,
      windowsHide: true,
      env: { ...process.env, RTH_API_KEY: apiKey },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("部署超过 180 秒，已停止。请稍后重试。")));
    }, DEPLOY_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      finish(() => reject(new Error(`无法启动热铁盒 CLI：${error.message}`)));
    });
    child.once("close", (code) => {
      finish(() => {
        if (code === 0) resolve();
        else reject(new Error(`热铁盒部署失败：${cleanCliOutput(stderr || stdout).slice(-1200) || `退出码 ${code}`}`));
      });
    });
  });
}

async function verifyOnline(deploymentId: string, publicUrl: string) {
  const headers = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36",
    "cache-control": "no-cache",
  };
  let lastError = "";

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const marker = await fetch(`${publicUrl}/__eecohub_deploy.json?t=${Date.now()}`, { headers, cache: "no-store" });
      if (!marker.ok) throw new Error(`部署标记返回 HTTP ${marker.status}`);
      const body = await marker.json() as { deploymentId?: string };
      if (body.deploymentId !== deploymentId) throw new Error("线上仍是旧版本");

      const homepage = await fetch(`${publicUrl}/?t=${Date.now()}`, { headers, cache: "no-store" });
      const contentType = homepage.headers.get("content-type") || "";
      if (!homepage.ok) throw new Error(`首页返回 HTTP ${homepage.status}`);
      if (!contentType.includes("text/html")) throw new Error("首页没有返回 HTML 内容");
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "未知验证错误";
      await new Promise((resolve) => setTimeout(resolve, attempt * 900));
    }
  }
  throw new Error(`文件已提交，但线上验证失败：${lastError}`);
}

export function deployUploadedFile(file: File, sessionCard: CardRecord) {
  return enqueue(async () => {
    const apiKey = await readApiKey();
    if (!apiKey) throw new Error("热铁盒 API Key 为空。");
    const currentCard = await ensureSiteForCard(sessionCard.id, apiKey);
    if (!currentCard.siteName || !currentCard.publicUrl) {
      throw new Error("未能为卡密分配网站，请联系管理员。");
    }

    const deploymentId = `dep_${randomUUID().replaceAll("-", "")}`;
    const workDir = path.join(DEPLOYMENTS_DIR, deploymentId);
    const publicDir = path.join(workDir, "public");
    const currentDir = path.join(DEPLOYMENTS_DIR, "current", currentCard.siteName);
    const deployedAt = new Date().toISOString();

    await mkdir(publicDir, { recursive: true });
    try {
      const upload = await prepareUploadedSite(file, publicDir);
      await writeFile(
        path.join(publicDir, "__eecohub_deploy.json"),
        JSON.stringify({ deploymentId, deployedAt, site: currentCard.siteName }, null, 2),
        "utf8",
      );

      await runRetieheDeploy(publicDir, apiKey, currentCard.siteName);
      await verifyOnline(deploymentId, currentCard.publicUrl);
      await rm(currentDir, { recursive: true, force: true });
      await mkdir(path.dirname(currentDir), { recursive: true });
      await cp(publicDir, currentDir, { recursive: true });
      const card = recordSuccessfulDeployment({
        cardId: currentCard.id,
        deploymentId,
        deployedAt,
        fileName: file.name,
        fileCount: upload.fileCount,
        extractedBytes: upload.extractedBytes,
      });
      await rm(workDir, { recursive: true, force: true });

      return {
        deploymentId,
        deployedAt,
        publicUrl: card.publicUrl,
        site: card.siteName,
        upload,
        deploymentCount: card.deploymentCount,
        expiresAt: card.expiresAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知部署错误";
      recordFailedDeployment({ cardId: currentCard.id, deploymentId, fileName: file.name, errorMessage: message });
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  });
}
