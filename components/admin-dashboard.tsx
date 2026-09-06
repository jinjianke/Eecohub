"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Status = "UNUSED" | "ACTIVE" | "EXPIRED" | "DISABLED";
type Card = {
  id: string;
  codeLast4: string;
  buyerId: string | null;
  status: Status;
  siteName: string | null;
  publicUrl: string | null;
  createdAt: string;
  activatedAt: string | null;
  expiresAt: string | null;
  deploymentCount: number;
  lastDeployedAt: string | null;
};
type Stats = Record<Status | "TOTAL", number>;
type SiteStats = { TOTAL: number; AVAILABLE: number; ALLOCATED: number; DISABLED: number };
type GeneratedCard = { id: string; code: string; buyerId: string; createdAt: string };

const emptyStats: Stats = { TOTAL: 0, UNUSED: 0, ACTIVE: 0, EXPIRED: 0, DISABLED: 0 };
const emptySiteStats: SiteStats = { TOTAL: 0, AVAILABLE: 0, ALLOCATED: 0, DISABLED: 0 };
const labels: Record<Status, string> = {
  UNUSED: "未使用",
  ACTIVE: "使用中",
  EXPIRED: "已过期",
  DISABLED: "已停用",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

export default function AdminDashboard() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [password, setPassword] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [siteStats, setSiteStats] = useState<SiteStats>(emptySiteStats);
  const [count, setCount] = useState(10);
  const [buyerId, setBuyerId] = useState("");
  const [filter, setFilter] = useState<Status | "ALL">("ALL");
  const [generated, setGenerated] = useState<GeneratedCard[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadCards() {
    const response = await fetch("/api/admin/cards", { cache: "no-store" });
    if (response.status === 401) {
      setAuthenticated(false);
      return;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取卡密失败。");
    setCards(data.cards);
    setStats(data.stats);
    setSiteStats(data.siteStats || emptySiteStats);
  }

  useEffect(() => {
    fetch("/api/admin/session", { cache: "no-store" })
      .then((response) => response.json())
      .then(async (data) => {
        setConfigured(data.configured);
        setAuthenticated(data.authenticated);
        if (data.authenticated) await loadCards();
      })
      .catch(() => setError("无法连接管理服务。"))
      .finally(() => setChecking(false));
  }, []);

  const visibleCards = useMemo(
    () => filter === "ALL" ? cards : cards.filter((card) => card.status === filter),
    [cards, filter],
  );

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy("login"); setError("");
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "登录失败。");
      setAuthenticated(true); setPassword("");
      await loadCards();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败。");
    } finally { setBusy(""); }
  }

  async function logout() {
    await fetch("/api/admin/session", { method: "DELETE" });
    setAuthenticated(false); setCards([]); setGenerated([]);
  }

  async function createCards() {
    const normalizedBuyerId = buyerId.trim();
    if (!normalizedBuyerId) {
      setError("请填写买家 ID。");
      setNotice("");
      return;
    }
    setBusy("generate"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/cards", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ count, buyerId: normalizedBuyerId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "生成失败。");
      setGenerated(data.generated); setCards(data.cards); setStats(data.stats); setSiteStats(data.siteStats || emptySiteStats);
      setBuyerId("");
      setNotice(`已为买家 ${normalizedBuyerId} 生成 ${data.generated.length} 张卡密。完整卡密只在这里显示一次，请立即复制。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "生成失败。");
    } finally { setBusy(""); }
  }

  async function copyGenerated() {
    await navigator.clipboard.writeText(generated.map((item) => item.code).join("\n"));
    setNotice(`已复制 ${generated.length} 张卡密到剪贴板。`);
  }

  async function updateCard(card: Card, action: "disable" | "enable" | "expire" | "extend") {
    const confirmations: Record<typeof action, string> = {
      disable: "确定停用这张卡密吗？用户将无法继续部署。",
      enable: "确定恢复这张卡密吗？",
      expire: "确定立即将这张卡密设为过期吗？",
      extend: "确定为这张卡密延长 365 天吗？",
    };
    if (!window.confirm(confirmations[action])) return;
    setBusy(card.id + action); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/cards/${card.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, days: action === "extend" ? 365 : undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "操作失败。");
      await loadCards();
      setNotice("卡密状态已更新。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败。");
    } finally { setBusy(""); }
  }

  if (checking) return <main className="admin-shell"><div className="admin-loading">正在读取管理后台…</div></main>;

  if (!authenticated) {
    return <main className="admin-shell admin-login-shell">
      <section className="admin-login-card">
        <Link className="admin-brand" href="/"><span>EH</span><b>EecoHub</b></Link>
        <p className="admin-kicker">CARD MANAGEMENT</p>
        <h1>卡密管理后台</h1>
        <p className="admin-login-note">批量生成卡密、查看激活状态和管理 365 天有效期。</p>
        {!configured && <div className="admin-error">管理员密码尚未配置，请检查 .env.local。</div>}
        <form onSubmit={login}>
          <label>管理员密码</label>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus placeholder="输入管理员密码" />
          {error && <div className="admin-error">{error}</div>}
          <button className="admin-primary" disabled={busy === "login" || !configured}>{busy === "login" ? "登录中…" : "进入后台"}</button>
        </form>
        <Link className="admin-back" href="/">← 返回用户上传页面</Link>
      </section>
    </main>;
  }

  return <main className="admin-shell">
    <header className="admin-header">
      <div><Link className="admin-brand" href="/"><span>EH</span><b>EecoHub</b></Link><small>卡密管理</small></div>
      <div className="admin-header-actions"><Link href="/">用户页面</Link><button onClick={logout}>退出登录</button></div>
    </header>

    <section className="admin-hero">
      <div><p className="admin-kicker">SQLITE LICENSE CENTER</p><h1>卡密控制台</h1><p>首次成功部署时自动激活，有效期从激活时刻起计算 365 天。</p></div>
      <div className="admin-system-status">
        <div className="admin-db-pill"><i /> SQLite 已连接</div>
        <small>本地站点 {siteStats.TOTAL} · 已分配 {siteStats.ALLOCATED} · 可用 {siteStats.AVAILABLE}</small>
      </div>
    </section>

    {(error || notice) && <div className={error ? "admin-error admin-message" : "admin-notice admin-message"}>{error || notice}</div>}

    <section className="admin-stats">
      {(["TOTAL", "UNUSED", "ACTIVE", "EXPIRED", "DISABLED"] as const).map((key) =>
        <button key={key} className={filter === (key === "TOTAL" ? "ALL" : key) ? "selected" : ""} onClick={() => setFilter(key === "TOTAL" ? "ALL" : key)}>
          <span>{key === "TOTAL" ? "全部卡密" : labels[key]}</span><b>{stats[key]}</b>
        </button>
      )}
    </section>

    <section className="admin-panel generate-panel">
      <div><p className="admin-section-tag">BATCH GENERATE</p><h2>批量生成卡密</h2><p>填写买家 ID 后生成 1–100 张卡密，同一批卡密会绑定到该买家。</p></div>
      <div className="generate-controls">
        <input className="buyer-id-input" type="text" maxLength={100} value={buyerId} onChange={(event) => setBuyerId(event.target.value)} placeholder="买家 ID（必填）" aria-label="买家 ID" />
        <input className="card-count-input" type="number" min="1" max="100" value={count} onChange={(event) => setCount(Number(event.target.value))} aria-label="卡密数量" />
        <button className="admin-primary" onClick={createCards} disabled={busy === "generate" || !buyerId.trim()}>{busy === "generate" ? "生成中…" : "生成卡密"}</button>
      </div>
    </section>

    {generated.length > 0 && <section className="admin-panel generated-panel">
      <div className="panel-title"><div><p className="admin-section-tag">SHOW ONCE</p><h2>新生成的完整卡密</h2></div><button onClick={copyGenerated}>复制全部</button></div>
      <div className="generated-warning">请现在复制保存。离开或刷新页面后，只能看到卡密最后四位。</div>
      <div className="generated-grid">{generated.map((item) => <div className="generated-card-item" key={item.id}><code>{item.code}</code><small>买家：{item.buyerId}</small></div>)}</div>
      <button className="dismiss-generated" onClick={() => setGenerated([])}>我已保存，关闭列表</button>
    </section>}

    <section className="admin-panel card-list-panel">
      <div className="panel-title"><div><p className="admin-section-tag">LICENSES</p><h2>{filter === "ALL" ? "全部卡密" : labels[filter]}</h2></div><span>共 {visibleCards.length} 张</span></div>
      <div className="card-table-wrap"><table className="card-table"><thead><tr><th>卡密</th><th>买家 ID</th><th>状态</th><th>站点</th><th>激活 / 到期</th><th>部署</th><th>操作</th></tr></thead>
      <tbody>{visibleCards.map((card) => <tr key={card.id}>
        <td><strong>••••-{card.codeLast4}</strong><small>创建 {formatDate(card.createdAt)}</small></td>
        <td>{card.buyerId ? <strong className="buyer-id-value" title={card.buyerId}>{card.buyerId}</strong> : <span className="muted">历史卡密未记录</span>}</td>
        <td><span className={`status-badge status-${card.status.toLowerCase()}`}>{labels[card.status]}</span></td>
        <td>{card.publicUrl ? <><a href={card.publicUrl} target="_blank" rel="noreferrer">{card.siteName}</a><small>{card.publicUrl}</small></> : <span className="muted">首次部署后分配</span>}</td>
        <td><span>{formatDate(card.activatedAt)}</span><small>到期 {formatDate(card.expiresAt)}</small></td>
        <td><b>{card.deploymentCount}</b><small>最近 {formatDate(card.lastDeployedAt)}</small></td>
        <td><div className="row-actions">
          {card.status !== "DISABLED" && <button disabled={busy.startsWith(card.id)} onClick={() => updateCard(card, "disable")}>停用</button>}
          {card.status === "DISABLED" && <button disabled={busy.startsWith(card.id)} onClick={() => updateCard(card, "enable")}>恢复</button>}
          {(card.status === "UNUSED" || card.status === "ACTIVE") && <button disabled={busy.startsWith(card.id)} onClick={() => updateCard(card, "expire")}>过期</button>}
          {card.activatedAt && <button className="action-extend" disabled={busy.startsWith(card.id)} onClick={() => updateCard(card, "extend")}>+365天</button>}
        </div></td>
      </tr>)}{visibleCards.length === 0 && <tr><td colSpan={7}><div className="empty-cards">当前分类还没有卡密。</div></td></tr>}</tbody></table></div>
    </section>
  </main>;
}
