// ╔══════════════════════════════════════════════════════════╗
// ║  Lume Finance — Supabase Patch v2                        ║
// ║  1. Storage financeiro: localStorage → Supabase          ║
// ║  2. Modo duplo admin: botão para alternar                ║
// ╚══════════════════════════════════════════════════════════╝
(async function () {

  const SUPABASE_URL = "https://pbazxjtlzucgxieesjqu.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBiYXp4anRsenVjZ3hpZWVzanF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNDIyOTAsImV4cCI6MjA5MzgxODI5MH0.BbLwAtOp-LxmzrC3KIIV4a8hGqn4YlLtpyfKRC2ue4s";

  // ─────────────────────────────────────────
  // PARTE 1 — SUPABASE STORAGE
  // ─────────────────────────────────────────

  function _getToken() {
    try {
      const raw = localStorage.getItem("sb-pbazxjtlzucgxieesjqu-auth-token");
      if (raw) return JSON.parse(raw).access_token;
    } catch {}
    return SUPABASE_KEY;
  }

  async function _getUserId() {
    try {
      const raw = localStorage.getItem("sb-pbazxjtlzucgxieesjqu-auth-token");
      if (raw) return JSON.parse(raw).user.id;
    } catch {}
    return null;
  }

  function _h() {
    return {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${_getToken()}`,
    };
  }

  const KEY_MAP = {
    "caixa:despesas:v2": "despesas",
    "caixa:receitas:v1": "receitas",
    "caixa:poupanca:v1": "poupanca",
    "caixa:fixas:v1":    "fixas",
    "caixa:caju:v1":     "caju_gastos",
  };

  const _cache = {}, _loaded = {}, _pending = {};
  const _orig = { get: Storage.prototype.getItem, set: Storage.prototype.setItem };

  async function sbGet(table) {
    const uid = await _getUserId(); if (!uid) return [];
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?user_id=eq.${uid}&order=criado_em.asc`, { headers: _h() });
    return r.ok ? r.json() : [];
  }
  async function sbUpsert(table, rows) {
    const uid = await _getUserId(); if (!uid) return;
    await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { ..._h(), "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.map(r => ({ ...r, user_id: uid })))
    });
  }
  async function sbDel(table, ids) {
    if (!ids.length) return;
    const uid = await _getUserId(); if (!uid) return;
    await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=in.(${ids.map(i=>`"${i}"`).join(",")})&user_id=eq.${uid}`, { method: "DELETE", headers: _h() });
  }

  Storage.prototype.getItem = function(key) {
    const table = KEY_MAP[key];
    if (!table) return _orig.get.call(this, key);
    if (_loaded[table]) return JSON.stringify(_cache[table] ?? []);
    if (!_pending[table]) {
      _pending[table] = sbGet(table).then(data => {
        _cache[table] = data; _loaded[table] = true;
        _orig.set.call(localStorage, key, JSON.stringify(data));
        window.dispatchEvent(new Event("lume-storage-ready"));
      });
    }
    return _orig.get.call(this, key);
  };

  Storage.prototype.setItem = function(key, value) {
    _orig.set.call(this, key, value);
    const table = KEY_MAP[key];
    if (!table) return;
    try {
      const nd = JSON.parse(value), prev = _cache[table] ?? [];
      const pids = new Set(prev.map(r => String(r.id)));
      const nids = new Set(nd.map(r => String(r.id)));
      const del  = prev.filter(r => !nids.has(String(r.id))).map(r => r.id);
      const ups  = nd.filter(r => !pids.has(String(r.id)) || JSON.stringify(prev.find(p=>String(p.id)===String(r.id))) !== JSON.stringify(r));
      if (del.length) sbDel(table, del);
      if (ups.length) sbUpsert(table, ups);
      _cache[table] = nd;
    } catch {}
  };

  async function preload() {
    if (!await _getUserId()) return;
    for (const [key, table] of Object.entries(KEY_MAP)) {
      if (_loaded[table]) continue;
      const data = await sbGet(table);
      _cache[table] = data; _loaded[table] = true;
      _orig.set.call(localStorage, key, JSON.stringify(data));
    }
    window.dispatchEvent(new Event("lume-storage-ready"));
  }
  setTimeout(preload, 800);
  setTimeout(preload, 3000);

  // ─────────────────────────────────────────
  // PARTE 2 — MODO DUPLO ADMIN
  // O bundle decide a tela lendo perfil.is_admin
  // Interceptamos o fetch ao Supabase e, quando
  // o modo "app" está ativo, retornamos is_admin=false
  // para que o bundle renderize o app normal.
  // ─────────────────────────────────────────

  const MODE_KEY = "lume-admin-mode"; // "admin" | "app"

  // Botão flutuante
  const BTN_CSS = `
    #lm-btn{position:fixed;top:14px;right:14px;z-index:9999;
      display:flex;align-items:center;gap:6px;padding:6px 13px;
      border-radius:20px;border:1px solid rgba(0,212,255,.4);
      background:rgba(2,4,8,.88);backdrop-filter:blur(14px);
      color:#00d4ff;font-family:'Space Grotesk',sans-serif;
      font-size:.76rem;font-weight:700;letter-spacing:.04em;
      cursor:pointer;box-shadow:0 2px 14px rgba(0,212,255,.18);
      transition:all .2s;user-select:none;}
    #lm-btn:hover{background:rgba(0,212,255,.14);box-shadow:0 2px 22px rgba(0,212,255,.35);}
    #lm-btn .lm-dot{width:7px;height:7px;border-radius:50%;background:#00d4ff;box-shadow:0 0 6px #00d4ff;}
  `;
  const styleEl = document.createElement("style");
  styleEl.textContent = BTN_CSS;
  document.head.appendChild(styleEl);

  function showModeButton(currentMode) {
    let btn = document.getElementById("lm-btn");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "lm-btn";
      document.body.appendChild(btn);
    }
    const isAdmin = currentMode !== "app";
    btn.innerHTML = `<span class="lm-dot"></span>${isAdmin ? "👤 Usar como usuário" : "⚙️ Painel Admin"}`;
    btn.onclick = () => {
      localStorage.setItem(MODE_KEY, isAdmin ? "app" : "admin");
      window.location.reload();
    };
  }

  // Intercepta o fetch para a tabela profiles
  // Quando modo=app, seta is_admin=false na resposta
  const _origFetch = window.fetch;
  window.fetch = async function(...args) {
    const res = await _origFetch.apply(this, args);
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
    const mode = localStorage.getItem(MODE_KEY);

    // Só intercepta chamada ao perfil do usuário atual E se modo=app
    if (mode === "app" && url.includes("/rest/v1/profiles") && url.includes("eq.")) {
      const clone = res.clone();
      const data  = await clone.json();
      // Retorna perfil com is_admin=false para o bundle cair no fluxo de usuário
      const patched = Array.isArray(data)
        ? data.map(p => ({ ...p, is_admin: false }))
        : { ...data, is_admin: false };
      return new Response(JSON.stringify(patched), {
        status: res.status,
        headers: res.headers,
      });
    }
    return res;
  };

  // Observa o DOM para saber quando a tela está renderizada e mostrar o botão
  const obs = new MutationObserver(() => {
    const root = document.getElementById("root");
    if (!root) return;
    const txt = root.textContent || "";
    const isAdminScreen = txt.includes("Painel Admin") && txt.includes("Gestão de usuários");
    const isAppScreen   = txt.includes("Lançar") && txt.includes("Histórico");
    const hasLogin      = txt.includes("Entrar") && txt.includes("Criar conta");

    if (isAdminScreen) showModeButton("admin");
    else if (isAppScreen) showModeButton("app");
    else if (hasLogin) {
      // Remove botão na tela de login
      const btn = document.getElementById("lm-btn");
      if (btn) btn.remove();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  console.log("[Lume Patch v2] ativo ✓ | modo:", localStorage.getItem(MODE_KEY) || "admin");

})();
