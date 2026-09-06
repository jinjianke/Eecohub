"use client";

import { ChangeEvent, DragEvent, FormEvent, useMemo, useState } from "react";

type Stage = "card" | "upload" | "deploying" | "result";
type CardState = {
  status: string;
  publicUrl: string | null;
  deploymentCount: number;
  expiresAt: string | null;
  lastDeployedAt: string | null;
};
type DeployResult = {
  publicUrl: string;
  deploymentId: string;
  deployedAt: string;
  deploymentCount: number;
  expiresAt: string | null;
  upload: { fileCount: number; extractedBytes: number; mode: "html" | "zip" };
};

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value))
  : "—";

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export default function UploadFlow() {
  const [stage, setStage] = useState<Stage>("card");
  const [cardCode, setCardCode] = useState("");
  const [cardState, setCardState] = useState<CardState | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DeployResult | null>(null);
  const [copied, setCopied] = useState(false);

  const progress = useMemo(() => ({
    card: stage === "card" ? "active" : "done",
    upload: stage === "upload" ? "active" : ["deploying", "result"].includes(stage) ? "done" : "idle",
    publish: stage === "deploying" ? "active" : stage === "result" ? "done" : "idle",
  }), [stage]);

  async function verifyCard(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!cardCode.trim()) return setError("请输入卖家发送给你的卡密。 ");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardCode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "卡密验证失败。 ");
      setCardState(data.state);
      setStage("upload");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "卡密验证失败。 ");
    }
  }

  function pickFile(nextFile?: File) {
    setError("");
    if (!nextFile) return;
    const lower = nextFile.name.toLowerCase();
    if (!lower.endsWith(".html") && !lower.endsWith(".htm") && !lower.endsWith(".zip")) {
      setFile(null);
      return setError("请选择 .html、.htm 或 .zip 文件。 ");
    }
    if (nextFile.size > 20 * 1024 * 1024) {
      setFile(null);
      return setError("文件不能超过 20MB。 ");
    }
    setFile(nextFile);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    pickFile(event.dataTransfer.files[0]);
  }

  async function publish() {
    if (!file) return setError("请先选择要发布的网站文件。 ");
    setStage("deploying");
    setError("");
    const form = new FormData();
    form.append("website", file);

    try {
      const response = await fetch("/api/deploy", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "发布失败，请稍后重试。 ");
      setResult(data);
      setStage("result");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发布失败，请稍后重试。 ");
      setStage("upload");
    }
  }

  async function copyLink() {
    if (!result) return;
    await navigator.clipboard.writeText(result.publicUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="page-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <a className="brand" href="#" aria-label="EecoHub 首页">
          <span className="brand-mark"><span /></span>
          <span>EecoHub</span>
        </a>
        <span className="service-pill"><i /> 服务运行中</span>
      </header>

      <section className="hero">
        <div className="eyebrow">STATIC SITE PUBLISHING</div>
        <h1>把代码，变成<br /><em>可以打开的网址。</em></h1>
        <p>无需服务器配置。输入卡密，上传 HTML 或 ZIP，几分钟内完成发布。</p>
      </section>

      <section className="workspace-card">
        <div className="steps" aria-label="发布步骤">
          <Step number="01" label="验证卡密" state={progress.card} />
          <div className={`step-line ${progress.upload !== "idle" ? "lit" : ""}`} />
          <Step number="02" label="上传文件" state={progress.upload} />
          <div className={`step-line ${progress.publish !== "idle" ? "lit" : ""}`} />
          <Step number="03" label="获得网址" state={progress.publish} />
        </div>

        <div className="panel">
          {stage === "card" && (
            <form onSubmit={verifyCard} className="stage-content">
              <div className="stage-heading">
                <span className="stage-icon key-icon">⌁</span>
                <div><h2>验证你的卡密</h2><p>卡密由卖家发送，每张卡密绑定一个网站。</p></div>
              </div>
              <label className="field-label" htmlFor="card-code">卡密</label>
              <div className="code-field">
                <input
                  id="card-code"
                  value={cardCode}
                  onChange={(event) => setCardCode(event.target.value)}
                  placeholder="例如：EH-XXXX-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                />
                <span>ACCESS KEY</span>
              </div>
              {error && <p className="error-message" role="alert">{error}</p>}
              <button className="primary-button" type="submit">验证并继续 <span>→</span></button>
              <p className="privacy-note">卡密仅用于验证本次发布权限</p>
            </form>
          )}

          {stage === "upload" && (
            <div className="stage-content">
              <div className="stage-heading">
                <span className="stage-icon upload-icon">↑</span>
                <div>
                  <h2>{cardState?.status === "ACTIVE" ? "更新你的网站" : "上传你的网站"}</h2>
                  <p>{cardState?.status === "ACTIVE" ? "重新上传会覆盖旧内容，原网址保持不变。" : "支持单个 HTML，或包含 CSS、JS、图片的 ZIP。"}</p>
                </div>
              </div>

              {cardState?.status === "ACTIVE" && cardState.publicUrl && (
                <div className="existing-site"><span>当前网站</span><a href={cardState.publicUrl} target="_blank" rel="noreferrer">{cardState.publicUrl}</a></div>
              )}

              <label
                className={`dropzone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <input type="file" accept=".html,.htm,.zip" onChange={(event: ChangeEvent<HTMLInputElement>) => pickFile(event.target.files?.[0])} />
                <span className="file-glyph">{file ? "✓" : "↥"}</span>
                {file ? (
                  <><strong>{file.name}</strong><small>{formatBytes(file.size)} · 点击可更换文件</small></>
                ) : (
                  <><strong>拖放文件到这里</strong><small>或点击选择 · HTML / ZIP · 最大 20MB</small></>
                )}
              </label>
              {error && <p className="error-message" role="alert">{error}</p>}
              <button className="primary-button" type="button" disabled={!file} onClick={publish}>发布到云端 <span>↗</span></button>
              <div className="guardrails"><span>静态文件</span><span>HTTPS 访问</span><span>原网址可覆盖更新</span></div>
            </div>
          )}

          {stage === "deploying" && (
            <div className="stage-content status-stage" aria-live="polite">
              <div className="orbit-loader"><span /></div>
              <h2>正在发布到云端</h2>
              <p>正在检查文件、同步内容并验证网址，请不要关闭页面。</p>
              <div className="loading-track"><span /></div>
              <small>通常需要 10–60 秒</small>
            </div>
          )}

          {stage === "result" && result && (
            <div className="stage-content status-stage result-stage">
              <div className="success-mark">✓</div>
              <div><h2>网站发布成功</h2><p>链接已生效，现在可以发送给任何人访问。</p></div>
              <div className="result-link">
                <a href={result.publicUrl} target="_blank" rel="noreferrer">{result.publicUrl}</a>
                <button onClick={copyLink}>{copied ? "已复制" : "复制"}</button>
              </div>
              <div className="result-meta">
                <span><b>{result.upload.fileCount}</b> 个文件</span>
                <span><b>{result.deploymentCount}</b> 次发布</span>
                <span>有效至 <b>{formatDate(result.expiresAt)}</b></span>
              </div>
              <div className="result-actions">
                <a className="primary-button" href={result.publicUrl} target="_blank" rel="noreferrer">打开网站 <span>↗</span></a>
                <button className="secondary-button" onClick={() => { setFile(null); setError(""); setStage("upload"); }}>重新上传覆盖</button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="feature-strip">
        <article><span>01</span><div><h3>支持完整静态网站</h3><p>HTML、CSS、JavaScript、图片与字体资源。</p></div></article>
        <article><span>02</span><div><h3>链接保持不变</h3><p>修改代码后重新上传，直接覆盖旧版本。</p></div></article>
        <article><span>03</span><div><h3>自动 HTTPS</h3><p>发布完成即可在电脑和手机浏览器访问。</p></div></article>
      </section>

      <footer><span>© 2026 EecoHub</span><span>请勿上传违法、诈骗、钓鱼或侵权内容</span></footer>
    </main>
  );
}

function Step({ number, label, state }: { number: string; label: string; state: string }) {
  return (
    <div className={`step ${state}`}>
      <span className="step-number">{state === "done" ? "✓" : number}</span>
      <span>{label}</span>
    </div>
  );
}
