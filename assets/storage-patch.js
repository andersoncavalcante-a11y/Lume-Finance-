// Lume Finance — Supabase Storage Patch
// Intercepta localStorage para redirecionar dados financeiros ao Supabase

(async function () {
  const SUPABASE_URL = "https://pbazxjtlzucgxieesjqu.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBiYXp4anRsenVjZ3hpZWVzanF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNDIyOTAsImV4cCI6MjA5MzgxODI5MH0.BbLwAtOp-LxmzrC3KIIV4a8hGqn4YlLtpyfKRC2ue4s";

  const headers = () => ({
    "Content-Type": "application/json",
    "apikey": SUPABASE_KEY,
    "Authorization": `Bearer ${_getToken()}`,
    "Prefer": "return=representation"
  });

  function _getToken() {
    // Pega o token da sessão atual do Supabase (salvo pelo cliente JS)
    try {
      const raw = localStorage.getItem(`sb-pbazxjtlzucgxieesjqu-auth-token`);
      if (raw) return JSON.parse(raw).access_token;
    } catch {}
    // Fallback: anon key
    return SUPABASE_KEY;
  }

  async function _getUserId() {
    try {
      const raw = localStorage.getItem(`sb-pbazxjtlzucgxieesjqu-auth-token`);
      if (raw) return JSON.parse(raw).user.id;
    } catch {}
    return null;
  }

  // ─── Mapeamento de chaves localStorage → tabelas Supabase ───
  const KEY_MAP = {
    "caixa:despesas:v2":       { table: "despesas",    idField: "id" },
    "caixa:receitas:v1":       { table: "receitas",    idField: "id" },
    "caixa:poupanca:v1":       { table: "poupanca",    idField: "id" },
    "caixa:fixas:v1":          { table: "fixas",       idField: "id" },
    "caixa:caju:v1":           { table: "caju_gastos", idField: "id" },
  };

  // caixa:fixasAplicadas e caixa:cajuSaldo ficam no localStorage
  // pois são estruturas simples de config, não dados financeiros por usuário

  // ─── Funções de acesso ao Supabase ───

  async function sbSelect(table) {
    const userId = await _getUserId();
    if (!userId) return [];
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?user_id=eq.${userId}&order=criado_em.asc`,
      { headers: headers() }
    );
    if (!res.ok) return [];
    return res.json();
  }

  async function sbUpsert(table, rows) {
    const userId = await _getUserId();
    if (!userId) return;
    const data = rows.map(r => ({ ...r, user_id: userId }));
    await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...headers(), "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(data)
    });
  }

  async function sbDelete(table, ids) {
    if (!ids.length) return;
    const userId = await _getUserId();
    if (!userId) return;
    // deleta por id IN (...)
    const inList = ids.map(id => `"${id}"`).join(",");
    await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?id=in.(${inList})&user_id=eq.${userId}`,
      { method: "DELETE", headers: headers() }
    );
  }

  // ─── Cache em memória para evitar múltiplas chamadas ───
  const _cache = {};
  const _loaded = {};

  async function readKey(key, fallback) {
    const map = KEY_MAP[key];
    if (!map) {
      // localStorage normal
      try {
        const r = localStorage.getItem(key);
        return r ? JSON.parse(r) : fallback;
      } catch { return fallback; }
    }
    if (!_loaded[map.table]) {
      _cache[map.table] = await sbSelect(map.table);
      _loaded[map.table] = true;
    }
    return _cache[map.table] ?? fallback;
  }

  async function writeKey(key, newData) {
    const map = KEY_MAP[key];
    if (!map) {
      // localStorage normal
      try { localStorage.setItem(key, JSON.stringify(newData)); } catch {}
      return;
    }

    const prev = _cache[map.table] ?? [];
    const prevIds = new Set(prev.map(r => String(r.id)));
    const newIds  = new Set(newData.map(r => String(r.id)));

    // Itens deletados
    const deleted = prev.filter(r => !newIds.has(String(r.id))).map(r => r.id);

    // Itens novos ou modificados
    const upserts = newData.filter(r => {
      if (!prevIds.has(String(r.id))) return true; // novo
      const old = prev.find(p => String(p.id) === String(r.id));
      return JSON.stringify(old) !== JSON.stringify(r); // modificado
    });

    if (deleted.length) await sbDelete(map.table, deleted);
    if (upserts.length)  await sbUpsert(map.table, upserts);

    // Atualiza cache
    _cache[map.table] = newData;
  }

  // ─── Aguarda o bundle carregar e então sobrescreve as funções ───
  // O bundle define globalmente Ni (read) e at (write) — mas como são
  // variáveis de módulo ES, não ficam em window. Usamos um MutationObserver
  // para detectar quando o React montou e então patcheamos via prototype do Storage.

  // Abordagem: Monkey-patch do localStorage para as chaves financeiras
  const _origGetItem = Storage.prototype.getItem;
  const _origSetItem = Storage.prototype.setItem;

  // Mapa de promessas pendentes para sincronizar leitura assíncrona
  const _pending = {};

  Storage.prototype.getItem = function(key) {
    const map = KEY_MAP[key];
    if (!map) return _origGetItem.call(this, key);

    // Se já temos no cache, retorna síncrono
    if (_loaded[map.table]) {
      return JSON.stringify(_cache[map.table] ?? []);
    }

    // Dispara carga assíncrona em background
    if (!_pending[map.table]) {
      _pending[map.table] = sbSelect(map.table).then(data => {
        _cache[map.table] = data;
        _loaded[map.table] = true;
        // Força re-render disparando evento de storage
        window.dispatchEvent(new Event("lume-storage-ready"));
      });
    }

    // Retorna localStorage enquanto carrega (pode ser null)
    return _origGetItem.call(this, key);
  };

  Storage.prototype.setItem = function(key, value) {
    _origSetItem.call(this, key, value);
    const map = KEY_MAP[key];
    if (!map) return;
    try {
      const data = JSON.parse(value);
      writeKey(key, data);
    } catch {}
  };

  // ─── Pré-carrega todos os dados assim que o usuário está autenticado ───
  async function preload() {
    const userId = await _getUserId();
    if (!userId) return;
    console.log("[Lume Patch] Pré-carregando dados do Supabase...");
    for (const [key, map] of Object.entries(KEY_MAP)) {
      if (!_loaded[map.table]) {
        const data = await sbSelect(map.table);
        _cache[map.table] = data;
        _loaded[map.table] = true;
        // Sincroniza no localStorage para o bundle ler corretamente
        _origSetItem.call(localStorage, key, JSON.stringify(data));
      }
    }
    console.log("[Lume Patch] Dados carregados!", _cache);
    // Dispara evento para forçar re-render
    window.dispatchEvent(new Event("lume-storage-ready"));
  }

  // Aguarda auth e pré-carrega
  window.addEventListener("lume-auth-ready", preload);

  // Tenta pré-carregar imediatamente se já há sessão
  setTimeout(preload, 500);
  setTimeout(preload, 2000); // retry

  console.log("[Lume Patch] Storage patch ativo ✓");
})();
