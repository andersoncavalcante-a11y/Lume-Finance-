// Lume Finance — Storage Patch v3 (sem interceptação de fetch)
(async function () {

  const SUPABASE_URL = "https://pbazxjtlzucgxieesjqu.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBiYXp4anRsenVjZ3hpZWVzanF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNDIyOTAsImV4cCI6MjA5MzgxODI5MH0.BbLwAtOp-LxmzrC3KIIV4a8hGqn4YlLtpyfKRC2ue4s";

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
      "Authorization": "Bearer " + _getToken(),
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
    const uid = await _getUserId();
    if (!uid) return [];
    try {
      const r = await fetch(SUPABASE_URL + "/rest/v1/" + table + "?user_id=eq." + uid + "&order=criado_em.asc", { headers: _h() });
      return r.ok ? r.json() : [];
    } catch { return []; }
  }

  async function sbUpsert(table, rows) {
    const uid = await _getUserId();
    if (!uid || !rows.length) return;
    try {
      await fetch(SUPABASE_URL + "/rest/v1/" + table, {
        method: "POST",
        headers: Object.assign({}, _h(), { "Prefer": "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify(rows.map(function(r) { return Object.assign({}, r, { user_id: uid }); }))
      });
    } catch {}
  }

  async function sbDel(table, ids) {
    if (!ids.length) return;
    const uid = await _getUserId();
    if (!uid) return;
    try {
      await fetch(SUPABASE_URL + "/rest/v1/" + table + "?id=in.(" + ids.map(function(i){ return '"' + i + '"'; }).join(",") + ")&user_id=eq." + uid, { method: "DELETE", headers: _h() });
    } catch {}
  }

  Storage.prototype.getItem = function(key) {
    var table = KEY_MAP[key];
    if (!table) return _orig.get.call(this, key);
    if (_loaded[table]) return JSON.stringify(_cache[table] || []);
    if (!_pending[table]) {
      _pending[table] = sbGet(table).then(function(data) {
        _cache[table] = data;
        _loaded[table] = true;
        _orig.set.call(localStorage, key, JSON.stringify(data));
        window.dispatchEvent(new Event("lume-storage-ready"));
      });
    }
    return _orig.get.call(this, key);
  };

  Storage.prototype.setItem = function(key, value) {
    _orig.set.call(this, key, value);
    var table = KEY_MAP[key];
    if (!table) return;
    try {
      var nd = JSON.parse(value);
      var prev = _cache[table] || [];
      var pids = new Set(prev.map(function(r){ return String(r.id); }));
      var nids = new Set(nd.map(function(r){ return String(r.id); }));
      var del = prev.filter(function(r){ return !nids.has(String(r.id)); }).map(function(r){ return r.id; });
      var ups = nd.filter(function(r){ return !pids.has(String(r.id)) || JSON.stringify(prev.find(function(p){ return String(p.id)===String(r.id); })) !== JSON.stringify(r); });
      if (del.length) sbDel(table, del);
      if (ups.length) sbUpsert(table, ups);
      _cache[table] = nd;
    } catch {}
  };

  async function preload() {
    var uid = await _getUserId();
    if (!uid) return;
    for (var key in KEY_MAP) {
      var table = KEY_MAP[key];
      if (_loaded[table]) continue;
      var data = await sbGet(table);
      _cache[table] = data;
      _loaded[table] = true;
      _orig.set.call(localStorage, key, JSON.stringify(data));
    }
    window.dispatchEvent(new Event("lume-storage-ready"));
    console.log("[Lume] Dados carregados do Supabase");
  }

  setTimeout(preload, 1000);
  setTimeout(preload, 4000);

  // ── MODO DUPLO ADMIN ──
  // Sem interceptar fetch — usa localStorage para override
  var MODE_KEY = "lume-admin-mode";

  var style = document.createElement("style");
  style.textContent = "#lm-btn{position:fixed;top:14px;right:14px;z-index:9999;display:flex;align-items:center;gap:6px;padding:6px 14px;border-radius:20px;border:1px solid rgba(0,212,255,.4);background:rgba(2,4,8,.9);backdrop-filter:blur(14px);color:#00d4ff;font-family:'Space Grotesk',sans-serif;font-size:.76rem;font-weight:700;cursor:pointer;box-shadow:0 2px 14px rgba(0,212,255,.2);} #lm-btn:hover{background:rgba(0,212,255,.15);}";
  document.head.appendChild(style);

  function showBtn(mode) {
    var btn = document.getElementById("lm-btn");
    if (!btn) { btn = document.createElement("button"); btn.id = "lm-btn"; document.body.appendChild(btn); }
    var isAdmin = mode === "admin";
    btn.textContent = isAdmin ? "👤 Usar como usuário" : "⚙️ Painel Admin";
    btn.onclick = function() {
      localStorage.setItem(MODE_KEY, isAdmin ? "app" : "admin");
      window.location.reload();
    };
  }

  // Detecta tela e mostra botão
  var obs = new MutationObserver(function() {
    var root = document.getElementById("root");
    if (!root) return;
    var txt = root.textContent || "";
    if (txt.includes("Painel Admin")) showBtn("admin");
    else if (txt.includes("Lançar") && txt.includes("Histórico")) showBtn("app");
  });

  function startObs() {
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) startObs();
  else document.addEventListener("DOMContentLoaded", startObs);

  console.log("[Lume Patch v3] ativo");

})();
