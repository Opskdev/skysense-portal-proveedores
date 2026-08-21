/* ============================================================================
   SkySense Portal Proveedores — Asistente "Skybot"
   asistente.js  ·  v1.4
   ----------------------------------------------------------------------------
   Requisitos en la página que lo carga:
     · window.sb  → cliente de Supabase ya inicializado (createClient)
     · Scripts 07_asistente_avatar.sql y 08_carga_manual.sql ejecutados
   Opcional:
     · window.user → perfil ya cargado (si existe, evita una consulta)
     · window.toast → para avisos; si no existe, se ignora

   Se integra solo: usa tus variables CSS, así que respeta tema claro/oscuro.
   Un solo archivo para los 9 HTML. No requiere build ni dependencias.
   ============================================================================ */
(function () {
  'use strict';

  if (window.SkyAsistente) return;            // no duplicar si se incluye 2 veces

  /* ── Configuración ─────────────────────────────────────────────────────── */
  const CFG = {
    nombre: 'Skybot',
    maxResultados: 3,
    llaveBienvenida: 'skysense_asistente_bienvenida_v1',
    telefono: '+52 (55) 7487 4062',
    /* Canalización según la Guía para Proveedores (Agosto 2026) */
    contactoPagos:   { nombre: 'Ricardo Sotelo Ornelas', mail: 'ricardo.sotelo@skysense.com.mx' },
    contactoTecnico: { nombre: 'Julio Sánchez',          mail: 'julio.sanchez@skysense.com.mx' }
  };

  /* Texto de canalización reutilizable */
  function canalizacion() {
    return '- **Estatus de facturas y pagos:** ' + CFG.contactoPagos.nombre +
           ' · ' + CFG.contactoPagos.mail + '\n' +
           '- **Problemas técnicos del portal:** ' + CFG.contactoTecnico.nombre +
           ' · ' + CFG.contactoTecnico.mail + '\n' +
           '- **Torre de Control:** ' + CFG.telefono;
  }

  /* Documentos requeridos por concepto.
     La fuente de verdad es la tabla `configuracion` (key `conceptos`), igual
     que en skysense_portal_registro.html. Escribirlo aquí a mano era el mismo
     error que tiene docsReq() en el dashboard: al agregar un concepto nuevo
     desde Configuración, la copia local queda desfasada en silencio. */
  let DOCS_REQ = null;

  const DOCS_REQ_RESPALDO = {
    'Entrega de Materiales': 3,
    'Anticipo': 2,
    'Logística': 2,
    'Avance de Obra': 3
  };

  async function cargarConceptos() {
    const cli = cliente();
    if (!cli) return;
    try {
      const { data, error } = await cli.from('configuracion')
        .select('value').eq('key', 'conceptos').maybeSingle();
      if (error || !data || !data.value) return;
      const mapa = {};
      (data.value || []).forEach(c => {
        if (typeof c === 'string') mapa[c] = 2;
        else if (c && c.nombre) mapa[c.nombre] = (c.docs || []).length || 2;
      });
      if (Object.keys(mapa).length) DOCS_REQ = mapa;
    } catch (e) {
      console.warn('[Skybot] No pude leer conceptos de configuración:', e.message);
    }
  }

  /* ── Estado interno ────────────────────────────────────────────────────── */
  let perfil = null;         // {id, role, company_name, is_supercompras}
  let rol = null;            // proveedor | compras | super-compras | admin
  let modulo = null;
  let abierto = false;
  let ocupado = false;
  let ultimaConvId = null;
  let cacheFacturas = null;

  /* ── Resolución del cliente Supabase ───────────────────────────────────── */
  /* En los HTML del portal el cliente se declara como:
       const sb = createClient(SURL, SKEY);
     Un `const` de nivel superior NO se publica en window (crea una vinculación
     léxica global). Por eso window.sb es undefined aunque `sb` sí exista.
     Este resolver cubre ambos casos. */
  function cliente() {
    try { if (window.sb) return window.sb; } catch (e) {}
    try { if (typeof sb !== 'undefined' && sb) return sb; } catch (e) {}
    return null;
  }

  function perfilGlobal() {
    try { if (window.user && window.user.id) return window.user; } catch (e) {}
    try { if (typeof user !== 'undefined' && user && user.id) return user; } catch (e) {}
    return null;
  }

  /* ── Utilidades ────────────────────────────────────────────────────────── */
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const norm = s => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  /* Estado normalizado: el portal usa 'Borrador', 'Pendiente', 'En Revisión',
     'Procesada', 'Rechazada'. Se compara en minúsculas y sin acentos para no
     depender de cómo esté capitalizado en la base. */
  const est = f => norm(f && f.status);
  const esBorrador = f => est(f).indexOf('borrador') >= 0;

  /* Corte semanal: domingos 11:59 pm. Regla fija, así que se calcula
     en el cliente sin consultar nada. */
  function corteInfo() {
    const ahora = new Date();
    const corte = new Date(ahora);
    corte.setDate(ahora.getDate() + ((7 - ahora.getDay()) % 7));
    corte.setHours(23, 59, 0, 0);
    if (corte <= ahora) corte.setDate(corte.getDate() + 7);

    const ms = corte - ahora;
    const dias = Math.floor(ms / 86400000);
    const horas = Math.floor((ms % 86400000) / 3600000);

    let texto;
    if (dias >= 1) {
      texto = 'faltan **' + dias + ' día' + (dias === 1 ? '' : 's') + '**';
    } else if (horas >= 1) {
      texto = 'faltan **' + horas + ' hora' + (horas === 1 ? '' : 's') + '**';
    } else {
      texto = 'cierra en **menos de una hora**';
    }
    return { corte: corte, dias: dias, horas: horas, texto: texto, urgente: dias < 2 };
  }

  const money = (n, mo) => (mo === 'USD' ? 'US$' : '$') +
    Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function aviso(msg, tipo) {
    if (typeof window.toast === 'function') { try { window.toast(msg, tipo || 'ok'); } catch (e) {} }
  }

  /* Markdown mínimo y seguro: se escapa TODO antes de aplicar formato.
     El contenido viene de la base, pero nunca se inyecta HTML crudo. */
  function md(txt) {
    const lineas = String(txt || '').split('\n');
    let out = '', enUl = false, enOl = false, buffTabla = [];

    const cerrarListas = () => {
      if (enUl) { out += '</ul>'; enUl = false; }
      if (enOl) { out += '</ol>'; enOl = false; }
    };
    const inline = t => esc(t)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

    const volcarTabla = () => {
      if (!buffTabla.length) return;
      const filas = buffTabla
        .filter(l => !/^\s*\|[\s:|-]+\|\s*$/.test(l))
        .map(l => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim()));
      if (filas.length) {
        out += '<table class="sa-tbl"><thead><tr>' +
          filas[0].map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
          filas.slice(1).map(f => '<tr>' + f.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table>';
      }
      buffTabla = [];
    };

    lineas.forEach(l => {
      if (/^\s*\|.*\|\s*$/.test(l)) { cerrarListas(); buffTabla.push(l); return; }
      volcarTabla();

      const mUl = l.match(/^\s*[-•]\s+(.*)$/);
      const mOl = l.match(/^\s*(\d+)[.)]\s+(.*)$/);

      if (mUl) {
        if (enOl) { out += '</ol>'; enOl = false; }
        if (!enUl) { out += '<ul>'; enUl = true; }
        out += '<li>' + inline(mUl[1]) + '</li>';
      } else if (mOl) {
        if (enUl) { out += '</ul>'; enUl = false; }
        if (!enOl) { out += '<ol>'; enOl = true; }
        out += '<li>' + inline(mOl[2]) + '</li>';
      } else if (!l.trim()) {
        cerrarListas();
      } else {
        cerrarListas();
        out += '<p>' + inline(l) + '</p>';
      }
    });
    volcarTabla(); cerrarListas();
    return out;
  }

  function detectarModulo() {
    const f = (location.pathname.split('/').pop() || '').toLowerCase();
    const m = f.match(/skysense_portal_([a-z_]+)\.html/);
    if (!m) return null;
    return m[1].replace('auditoria', 'auditoria').replace('_', '');
  }

  /* ── Estilos (usa tus variables CSS: el tema funciona solo) ────────────── */
  const CSS = `
  .sa-fab{position:fixed;right:22px;bottom:22px;width:58px;height:58px;border-radius:50%;
    border:none;cursor:pointer;z-index:9998;padding:0;
    background:linear-gradient(135deg,var(--sky-accent,#2D7DD2),var(--sky-glow,#7EC8E3));
    box-shadow:0 6px 24px rgba(45,125,210,.45);transition:transform .18s,box-shadow .18s;
    display:flex;align-items:center;justify-content:center}
  .sa-fab:hover{transform:translateY(-3px) scale(1.04);box-shadow:0 10px 30px rgba(45,125,210,.6)}
  .sa-fab.oculto{display:none}
  .sa-fab svg{width:36px;height:36px}
  .sa-dot{position:absolute;top:2px;right:2px;width:13px;height:13px;border-radius:50%;
    background:var(--red,#EF4444);border:2px solid var(--sky-deep,#0A1628);display:none}
  .sa-dot.on{display:block;animation:sa-pulse 2s infinite}
  @keyframes sa-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.25)}}

  .sa-panel{position:fixed;right:22px;bottom:22px;width:380px;max-width:calc(100vw - 32px);
    height:560px;max-height:calc(100vh - 44px);z-index:9999;
    background:var(--surface,#111E33);border:1px solid var(--border,rgba(45,125,210,.2));
    border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.5);
    display:none;flex-direction:column;overflow:hidden;
    font-family:'Inter',-apple-system,sans-serif;color:var(--text,#E8F0FE)}
  .sa-panel.on{display:flex;animation:sa-in .2s ease}
  @keyframes sa-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}

  .sa-head{display:flex;align-items:center;gap:10px;padding:12px 14px;
    border-bottom:1px solid var(--border2,rgba(45,125,210,.1));flex-shrink:0}
  .sa-head-av{width:38px;height:38px;flex-shrink:0}
  .sa-head-t{font-size:13px;font-weight:700;line-height:1.25}
  .sa-head-s{font-size:10px;color:var(--text-muted,#7A9CC4)}
  .sa-x{margin-left:auto;background:none;border:none;color:var(--text-dim,#4A6A8A);
    cursor:pointer;font-size:18px;line-height:1;padding:4px 6px;border-radius:6px;font-family:inherit}
  .sa-x:hover{background:rgba(239,68,68,.12);color:#F87171}

  .sa-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px}
  .sa-body::-webkit-scrollbar{width:4px}
  .sa-body::-webkit-scrollbar-thumb{background:var(--border,rgba(45,125,210,.2));border-radius:2px}

  .sa-msg{max-width:88%;font-size:12.5px;line-height:1.55;border-radius:12px;padding:10px 12px;
    word-wrap:break-word;overflow-wrap:break-word}
  .sa-msg.bot{background:var(--surface3,#1E2E4A);border:1px solid var(--border2,rgba(45,125,210,.1));
    align-self:flex-start;border-bottom-left-radius:4px}
  .sa-msg.me{background:linear-gradient(135deg,var(--sky-blue,#1B4B8A),var(--sky-accent,#2D7DD2));
    color:#fff;align-self:flex-end;border-bottom-right-radius:4px}
  .sa-msg p{margin:0 0 7px}.sa-msg p:last-child{margin-bottom:0}
  .sa-msg ul,.sa-msg ol{margin:6px 0 8px 18px;padding:0}
  .sa-msg li{margin-bottom:4px}
  .sa-msg strong{color:var(--sky-light,#5BA4F5)}
  .sa-msg.me strong{color:#fff}
  .sa-msg code{background:rgba(0,0,0,.25);padding:1px 5px;border-radius:4px;font-size:11px}
  .sa-tbl{width:100%;border-collapse:collapse;margin:8px 0;font-size:11px}
  .sa-tbl th,.sa-tbl td{border:1px solid var(--border2,rgba(45,125,210,.1));padding:5px 7px;text-align:left}
  .sa-tbl th{background:rgba(45,125,210,.12);font-weight:700;font-size:10px;
    text-transform:uppercase;letter-spacing:.04em}

  .sa-src{font-size:9.5px;color:var(--text-dim,#4A6A8A);margin-top:7px;
    padding-top:6px;border-top:1px solid var(--border2,rgba(45,125,210,.1))}
  .sa-cta{display:inline-block;margin-top:8px;padding:6px 12px;border-radius:7px;font-size:11px;
    font-weight:600;text-decoration:none;color:#fff;
    background:linear-gradient(135deg,var(--sky-accent,#2D7DD2),var(--sky-light,#5BA4F5))}

  .sa-chips{display:flex;flex-wrap:wrap;gap:6px;align-self:flex-start;max-width:100%}
  .sa-chip{background:rgba(45,125,210,.12);border:1px solid var(--border,rgba(45,125,210,.2));
    color:var(--sky-light,#5BA4F5);font-size:11px;padding:6px 10px;border-radius:14px;
    cursor:pointer;font-family:inherit;transition:all .15s;text-align:left}
  .sa-chip:hover{background:rgba(45,125,210,.24)}

  .sa-fb{display:flex;align-items:center;gap:8px;align-self:flex-start;
    font-size:10.5px;color:var(--text-dim,#4A6A8A);padding-left:2px}
  .sa-fb button{background:none;border:1px solid var(--border2,rgba(45,125,210,.1));
    border-radius:6px;padding:3px 8px;cursor:pointer;font-size:11px;
    color:var(--text-muted,#7A9CC4);font-family:inherit}
  .sa-fb button:hover{border-color:var(--sky-accent,#2D7DD2);color:var(--sky-light,#5BA4F5)}
  .sa-fb.listo{color:var(--green,#10B981)}

  .sa-typing{display:flex;gap:4px;align-self:flex-start;padding:12px}
  .sa-typing i{width:6px;height:6px;border-radius:50%;background:var(--sky-light,#5BA4F5);
    animation:sa-bounce 1.3s infinite}
  .sa-typing i:nth-child(2){animation-delay:.15s}
  .sa-typing i:nth-child(3){animation-delay:.3s}
  @keyframes sa-bounce{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-4px)}}

  .sa-foot{padding:10px 12px;border-top:1px solid var(--border2,rgba(45,125,210,.1));flex-shrink:0}
  .sa-inrow{display:flex;gap:8px;align-items:flex-end}
  .sa-in{flex:1;background:var(--sky-deep,#0A1628);border:1px solid var(--border,rgba(45,125,210,.2));
    border-radius:9px;padding:9px 11px;color:var(--text,#E8F0FE);font-size:12.5px;
    font-family:inherit;resize:none;max-height:88px;line-height:1.4}
  .sa-in:focus{outline:none;border-color:var(--sky-accent,#2D7DD2)}
  .sa-send{width:38px;height:38px;flex-shrink:0;border:none;border-radius:9px;cursor:pointer;
    background:linear-gradient(135deg,var(--sky-accent,#2D7DD2),var(--sky-light,#5BA4F5));
    color:#fff;font-size:15px;display:flex;align-items:center;justify-content:center}
  .sa-send:disabled{opacity:.4;cursor:not-allowed}
  .sa-legal{font-size:9px;color:var(--text-dim,#4A6A8A);text-align:center;margin-top:7px}

  .sa-eye{animation:sa-blink 5s infinite}
  @keyframes sa-blink{0%,94%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}
  .sa-panel.pensando .sa-head-av{animation:sa-think 1.1s ease-in-out infinite}
  @keyframes sa-think{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}

  @media(max-width:520px){
    .sa-panel{right:8px;left:8px;bottom:8px;width:auto;height:calc(100vh - 16px);max-height:none}
    .sa-fab{right:14px;bottom:14px}
  }`;

  /* ── Avatar SVG (el personaje) ─────────────────────────────────────────── */
  function avatarSVG(size) {
    return `
    <svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
      <defs>
        <linearGradient id="sa-g1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#EAF4FF"/><stop offset="1" stop-color="#9FCBF5"/>
        </linearGradient>
      </defs>
      <rect x="12" y="16" width="40" height="34" rx="12" fill="url(#sa-g1)"/>
      <rect x="30.4" y="7" width="3.2" height="8" rx="1.6" fill="#EAF4FF"/>
      <circle cx="32" cy="6" r="3" fill="#FFD166"/>
      <g class="sa-eye" style="transform-origin:32px 31px">
        <circle cx="24.5" cy="31" r="3.4" fill="#0F2347"/>
        <circle cx="39.5" cy="31" r="3.4" fill="#0F2347"/>
        <circle cx="25.6" cy="29.9" r="1.15" fill="#fff"/>
        <circle cx="40.6" cy="29.9" r="1.15" fill="#fff"/>
      </g>
      <path d="M27 39q5 4.2 10 0" stroke="#0F2347" stroke-width="2.1"
            stroke-linecap="round" fill="none"/>
      <path d="M32 44.2l3.1 3.1L32 50.4l-3.1-3.1z" fill="#1B4B8A" opacity=".85"/>
      <rect x="6" y="27" width="5" height="11" rx="2.5" fill="#7EC8E3"/>
      <rect x="53" y="27" width="5" height="11" rx="2.5" fill="#7EC8E3"/>
    </svg>`;
  }

  /* ── Construcción del DOM ──────────────────────────────────────────────── */
  const st = document.createElement('style'); st.textContent = CSS;
  document.head.appendChild(st);

  const fab = document.createElement('button');
  fab.className = 'sa-fab'; fab.type = 'button';
  fab.setAttribute('aria-label', 'Abrir asistente');
  fab.innerHTML = avatarSVG(36) + '<span class="sa-dot" id="sa-dot"></span>';

  const panel = document.createElement('div');
  panel.className = 'sa-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Asistente del portal');
  panel.innerHTML = `
    <div class="sa-head">
      <div class="sa-head-av">${avatarSVG(38)}</div>
      <div>
        <div class="sa-head-t">${CFG.nombre} · Asistente del Portal</div>
        <div class="sa-head-s" id="sa-sub">SkySense Proveedores</div>
      </div>
      <button class="sa-x" type="button" id="sa-x" aria-label="Cerrar">✕</button>
    </div>
    <div class="sa-body" id="sa-body"></div>
    <div class="sa-foot">
      <div class="sa-inrow">
        <textarea class="sa-in" id="sa-in" rows="1" placeholder="Escribe tu duda…"
                  maxlength="500" aria-label="Escribe tu duda"></textarea>
        <button class="sa-send" type="button" id="sa-send" aria-label="Enviar">➤</button>
      </div>
      <div class="sa-legal">Sky orienta sobre el uso del portal. No da asesoría fiscal ni compromete pagos.</div>
    </div>`;

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  const $body = panel.querySelector('#sa-body');
  const $in = panel.querySelector('#sa-in');
  const $send = panel.querySelector('#sa-send');
  const $sub = panel.querySelector('#sa-sub');
  const $dot = fab.querySelector('#sa-dot');

  /* ── Render de mensajes ────────────────────────────────────────────────── */
  function scroll() { $body.scrollTop = $body.scrollHeight; }

  function msgYo(txt) {
    const d = document.createElement('div');
    d.className = 'sa-msg me'; d.textContent = txt;
    $body.appendChild(d); scroll();
  }

  function msgBot(html, extra) {
    const d = document.createElement('div');
    d.className = 'sa-msg bot';
    d.innerHTML = html + (extra || '');
    $body.appendChild(d); scroll();
    return d;
  }

  function typing(on) {
    const prev = $body.querySelector('.sa-typing');
    if (prev) prev.remove();
    panel.classList.toggle('pensando', !!on);
    if (on) {
      const d = document.createElement('div');
      d.className = 'sa-typing';
      d.innerHTML = '<i></i><i></i><i></i>';
      $body.appendChild(d); scroll();
    }
  }

  function chips(lista) {
    const prev = $body.querySelector('.sa-chips');
    if (prev) prev.remove();
    if (!lista || !lista.length) return;
    const w = document.createElement('div');
    w.className = 'sa-chips';
    lista.forEach(t => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sa-chip'; b.textContent = t;
      b.onclick = () => { w.remove(); preguntar(t); };
      w.appendChild(b);
    });
    $body.appendChild(w); scroll();
  }

  function feedback(convId) {
    const w = document.createElement('div');
    w.className = 'sa-fb';
    w.innerHTML = '<span>¿Te sirvió?</span>';
    const marcar = async (ok) => {
      w.className = 'sa-fb listo';
      w.textContent = ok ? '✓ Gracias por confirmar' : 'Anotado, lo revisamos';
      try { await sb.from('asistente_conversaciones').update({ resuelto: ok }).eq('id', convId); } catch (e) {}
      if (!ok) escalar();
    };
    const b1 = document.createElement('button'); b1.type = 'button'; b1.textContent = '👍';
    b1.onclick = () => marcar(true);
    const b2 = document.createElement('button'); b2.type = 'button'; b2.textContent = '👎';
    b2.onclick = () => marcar(false);
    w.appendChild(b1); w.appendChild(b2);
    $body.appendChild(w); scroll();
  }

  function escalar() {
    msgBot(md(
      'Entonces esto lo debe ver una persona.\n\n' +
      'Si es sobre **una factura específica**, escríbelo en sus **Comentarios**: ' +
      'el analista lo ve junto a los documentos.\n\n' +
      'Si no, canalízalo con Torre de Control:\n' + canalizacion()
    ));
    if (ultimaConvId) {
      sb.from('asistente_conversaciones').update({ escalado: true })
        .eq('id', ultimaConvId).then(() => {}, () => {});
    }
  }

  /* ── Bitácora ──────────────────────────────────────────────────────────── */
  async function registrar(pregunta, respuesta, ids, motor, ms) {
    try {
      const { data } = await sb.from('asistente_conversaciones').insert({
        user_id: perfil.id,
        rol: rol,
        company_name: perfil.company_name || null,
        modulo: modulo,
        pregunta: pregunta.slice(0, 2000),
        respuesta: (respuesta || '').slice(0, 6000),
        conocimiento_ids: ids || [],
        motor: motor,
        ms_respuesta: ms
      }).select('id').single();
      ultimaConvId = data ? data.id : null;
      return ultimaConvId;
    } catch (e) { return null; }
  }

  /* ── Contexto de facturas (datos reales, aislados por RLS) ─────────────── */
  async function traerFacturas() {
    if (cacheFacturas) return cacheFacturas;
    try {
      const { data, error } = await sb.from('facturas')
        .select('id,numero,status,concepto,total,moneda,fecha_factura,documentos(id,deleted)')
        .order('created_at', { ascending: false }).limit(300);
      if (error) return null;
      cacheFacturas = data || [];
      return cacheFacturas;
    } catch (e) { return null; }
  }

  function docsFaltantes(f) {
    const mapa = DOCS_REQ || DOCS_REQ_RESPALDO;
    const req = mapa[f.concepto] != null ? mapa[f.concepto] : (DOCS_REQ_RESPALDO[f.concepto] || 0);
    const hay = (f.documentos || []).filter(d => !d.deleted).length;
    return Math.max(0, req - hay);
  }

  async function resumenFacturas() {
    const fs = await traerFacturas();
    if (!fs) return null;
    if (!fs.length) {
      return 'Todavía no tienes facturas registradas en el portal. ' +
             'Cuando registres la primera, aquí te doy su seguimiento.';
    }
    const c = e => fs.filter(f => est(f).indexOf(e) >= 0).length;
    const borradores = fs.filter(esBorrador);
    const enviadas = fs.filter(f => !esBorrador(f));
    const incompletas = enviadas.filter(f => docsFaltantes(f) > 0 &&
      est(f).indexOf('procesada') < 0 && est(f).indexOf('rechazada') < 0);

    let t = 'Esto es lo que veo en **tus** facturas ahora mismo:\n\n' +
      '- Borrador (sin enviar): **' + borradores.length + '**\n' +
      '- Pendiente: **' + c('pendiente') + '**\n' +
      '- En Revisión: **' + c('revision') + '**\n' +
      '- Procesada: **' + c('procesada') + '**\n' +
      '- Rechazada: **' + c('rechazada') + '**\n';

    if (borradores.length) {
      const ci = corteInfo();
      t += '\n🚨 Los **borradores no existen para Compras**: no están enviados, ' +
           'así que no entran a revisión ni al ciclo de pago.\n' +
           borradores.slice(0, 4).map(f => '- ' + (f.numero || 's/folio') +
             ' · ' + money(f.total, f.moneda) +
             (docsFaltantes(f) ? ' · faltan ' + docsFaltantes(f) + ' documento(s)' : '')
           ).join('\n') +
           '\n\nPara el corte del domingo 11:59 pm ' + ci.texto + '.\n';
    }
    if (c('rechazada')) {
      const r = fs.filter(f => est(f).indexOf('rechazada') >= 0).slice(0, 4)
        .map(f => f.numero || 's/folio').join(', ');
      t += '\nTienes rechazos que requieren tu acción: **' + r + '**. ' +
           'El motivo está en los Comentarios de cada una.\n';
    }
    if (incompletas.length) {
      t += '\n⚠️ **' + incompletas.length + '** factura(s) enviadas con documentos incompletos: ' +
           incompletas.slice(0, 4).map(f => (f.numero || 's/folio') +
             ' (falta ' + docsFaltantes(f) + ')').join(', ') +
           '. Mientras falten documentos, la revisión no avanza.\n';
    }
    return t;
  }

  async function detalleFactura(folio) {
    const fs = await traerFacturas();
    if (!fs) return null;
    const f = fs.find(x => norm(x.numero) === norm(folio)) ||
              fs.find(x => norm(x.numero).indexOf(norm(folio)) >= 0);
    if (!f) {
      return 'No encuentro una factura con folio **' + folio + '** entre las tuyas. ' +
             'Revisa el folio en *Mis Facturas*; si crees que es un error, avísale a la Torre de Control.';
    }
    const falta = docsFaltantes(f);
    let t = 'Factura **' + (f.numero || 's/folio') + '**\n\n' +
      '- Estado: **' + f.status + '**\n' +
      '- Concepto: ' + f.concepto + '\n' +
      '- Total: ' + money(f.total, f.moneda) + ' ' + (f.moneda || '') + '\n' +
      '- Documentos: ' + (falta ? '**faltan ' + falta + '**' : 'completos ✓') + '\n\n';

    if (esBorrador(f)) {
      const ci = corteInfo();
      t += '⚠️ Está en **Borrador**: guardada, pero **no enviada**. ' +
           'Compras no la ve y no entra al ciclo de pago.\n\n' +
           (falta ? 'Adjunta los ' + falta + ' documento(s) que faltan y pulsa **Enviar factura**.'
                  : 'Ya tiene sus documentos completos: solo falta pulsar **Enviar factura**.') +
           '\n\nPara el corte del domingo 11:59 pm ' + ci.texto + '.';
    } else if (est(f).indexOf('rechazada') >= 0) {
      t += 'Está **Rechazada**: abre sus Comentarios, ahí está el motivo exacto. ' +
           'Corrige y vuelve a enviarla.';
    } else if (est(f).indexOf('revision') >= 0) {
      t += 'Está **En Revisión**, por eso no la puedes editar (candado). ' +
           'Un analista la está validando.';
    } else if (est(f).indexOf('pendiente') >= 0) {
      t += falta
        ? 'Está **Pendiente** y le faltan documentos. Adjúntalos: la revisión no avanza sin ellos.'
        : 'Está **Pendiente** con documentos completos, en la fila de revisión.';
    } else if (est(f).indexOf('procesada') >= 0) {
      t += 'Ya está **Procesada** y sigue su flujo de pago. Los abonos que recibas ' +
           'aparecen en su barra de abonado, con comprobante descargable.';
    }
    return t;
  }

  /* ── Motor de respuesta ────────────────────────────────────────────────── */
  const RX_FOLIO = /\b(fac[\s-]?\d{4}[\s-]?\d{2,6}|[A-Z]{2,4}-\d{4}-\d{2,6})\b/i;

  async function responder(q) {
    const t0 = Date.now();
    const n = norm(q);
    const esProveedor = rol === 'proveedor';

    /* 1. Intención: folio explícito */
    const mf = q.match(RX_FOLIO);
    if (mf) {
      const r = await detalleFactura(mf[0]);
      if (r) return { html: md(r), ids: [], motor: 'reglas', ms: Date.now() - t0 };
    }

    /* 2. Intención: estado general de mis facturas */
    const pideEstado = /(mis|mi) factura|como van|estado de mis|cuantas facturas|resumen|situacion/.test(n) ||
      (/(no me han pagado|no me pagan|adeudo|me deben)/.test(n) && esProveedor);
    if (pideEstado && esProveedor) {
      const r = await resumenFacturas();
      if (r) {
        // Complementa con la explicación del manual sobre pagos
        const extra = await buscar(q);
        const bloque = extra.length
          ? '\n\n---\n\n**' + extra[0].titulo + '**\n' + extra[0].contenido
          : '';
        return {
          html: md(r + bloque),
          ids: extra.length ? [extra[0].id] : [],
          motor: 'reglas', ms: Date.now() - t0
        };
      }
    }

    /* 3. Búsqueda en el manual */
    const res = await buscar(q);
    if (res.length) {
      const p = res[0];
      let html = md('**' + p.titulo + '**\n\n' + p.contenido);
      if (p.accion_texto && p.accion_url) {
        html += '<a class="sa-cta" href="' + esc(p.accion_url) + '">' + esc(p.accion_texto) + ' →</a>';
      }
      if (p.seccion === 'manual_v1_pagos' && esProveedor) {
        const ci = corteInfo();
        html += md('\n---\n\n⏰ **Próximo corte:** domingo 11:59 pm — ' + ci.texto + '.');
      }
      html += '<div class="sa-src">Manual de Usuario · sección ' + esc(p.seccion.replace('manual_v1_', '')) + '</div>';
      return { html: html, ids: res.map(r => r.id), motor: 'reglas', ms: Date.now() - t0, otros: res.slice(1) };
    }

    /* 4a. Falla técnica: NO es lo mismo que no tener la respuesta */
    if (ultimoError) {
      return {
        html: md('No pude consultar la base de conocimiento en este momento ' +
          '(problema técnico, no es tu pregunta).\n\n' +
          'Intenta de nuevo en un momento. Si sigue igual, avísale al equipo de sistemas ' +
          'y mientras tanto escribe a **' + CFG.contactoTecnico.mail + '**.\n\n' +
          '*Detalle técnico: ' + (ultimoError.message || 'error en asist_buscar') + '*'),
        ids: [], motor: 'sin_resultado', ms: Date.now() - t0
      };
    }

    /* 4b. Sin resultado real */
    return {
      html: md('No encontré eso en el manual, y prefiero decírtelo antes que inventarte una respuesta.\n\n' +
        'Puedes reformularlo con otras palabras, o llevarlo con una persona:\n' +
        '- Duda de **una factura**: escríbela en sus **Comentarios**\n' +
        canalizacion()),
      ids: [], motor: 'sin_resultado', ms: Date.now() - t0
    };
  }

  let ultimoError = null;

  async function buscar(q) {
    ultimoError = null;
    try {
      const { data, error } = await sb.rpc('asist_buscar', {
        p_texto: q, p_modulo: modulo, p_limite: CFG.maxResultados
      });
      if (error) {
        ultimoError = error;
        console.error('[Sky] Falló asist_buscar:', error.message || error, error);
        return [];
      }
      return data || [];
    } catch (e) {
      ultimoError = e;
      console.error('[Sky] Excepción en asist_buscar:', e);
      return [];
    }
  }

  /* ── Flujo de la conversación ──────────────────────────────────────────── */
  async function preguntar(txt) {
    const q = String(txt || '').trim();
    if (!q || ocupado) return;
    ocupado = true; $send.disabled = true;
    const prevChips = $body.querySelector('.sa-chips');
    if (prevChips) prevChips.remove();

    msgYo(q);
    typing(true);

    let r;
    try { r = await responder(q); }
    catch (e) {
      r = { html: md('Algo falló al consultar. Intenta de nuevo en un momento.'),
            ids: [], motor: 'sin_resultado', ms: 0 };
    }
    typing(false);
    msgBot(r.html);

    const convId = await registrar(q, r.html.replace(/<[^>]+>/g, ' '), r.ids, r.motor, r.ms);
    if (convId) feedback(convId);

    if (r.otros && r.otros.length) {
      chips(r.otros.map(o => o.titulo));
    }
    ocupado = false; $send.disabled = false; $in.focus();
  }

  /* ── Sugerencias por módulo ────────────────────────────────────────────── */
  function sugerencias() {
    if (rol === 'proveedor') {
      const base = ['¿Qué documentos necesito?', '¿Qué significa cada estado?'];
      if (modulo === 'registro') return ['¿Qué documentos necesito?', '¿Guardar borrador o enviar?', '¿Cuándo es el corte?'];
      if (modulo === 'proveedor') return ['¿Cómo van mis facturas?', '¿Cuándo es el corte?', '¿Por qué se retrasó mi pago?'];
      return base.concat(['¿Cómo van mis facturas?']);
    }
    if (modulo === 'usuarios') return ['¿Cómo doy de alta un proveedor?', '¿Qué efecto tiene la empresa?'];
    return ['¿Cuál es el criterio de revisión?', '¿Qué ve el proveedor al cambiar el estado?', '¿Qué documentos pide cada concepto?'];
  }

  async function bienvenida() {
    const llave = CFG.llaveBienvenida + ':' + perfil.id;
    const primera = !localStorage.getItem(llave);

    try {
      const { data } = await sb.rpc('asist_ayuda_modulo', { p_modulo: modulo });
      if (data && data.length) {
        msgBot(md('¡Hola! Soy **' + CFG.nombre + '**, el asistente del portal.\n\n' + data[0].contenido));
      } else {
        msgBot(md('¡Hola! Soy **' + CFG.nombre + '**. Pregúntame cómo usar el portal ' +
          'y te respondo con lo que dice el manual.'));
      }
    } catch (e) {
      msgBot(md('¡Hola! Soy **' + CFG.nombre + '**. ¿En qué te ayudo?'));
    }

    if (rol === 'proveedor') {
      const fs = await traerFacturas();
      if (fs && fs.length) {
        const bor  = fs.filter(esBorrador);
        const rech = fs.filter(f => est(f).indexOf('rechazada') >= 0).length;
        const inc  = fs.filter(f => !esBorrador(f) && docsFaltantes(f) > 0 &&
                                    est(f).indexOf('pendiente') >= 0).length;

        if (bor.length || rech || inc) {
          const ci = corteInfo();
          let a = '';
          if (bor.length) {
            const suma = bor.reduce((x, f) => x + Number(f.total || 0), 0);
            a += '- 🚨 **' + bor.length + '** factura(s) en **borrador sin enviar**' +
                 (suma > 0 ? ' (' + money(suma) + ')' : '') +
                 ' — Compras todavía no las ve\n';
          }
          if (rech) a += '- **' + rech + '** factura(s) **Rechazada(s)** esperando tu corrección\n';
          if (inc)  a += '- **' + inc + '** factura(s) con **documentos incompletos**\n';

          a += '\n⏰ Corte semanal: **domingo 11:59 pm** — ' + ci.texto + '. ' +
               'Lo que no esté enviado y completo antes del corte se recorre a la semana siguiente.';

          msgBot(md('Antes de nada, algo que requiere tu atención:\n\n' + a));
          if (bor.length && ci.urgente) $dot.classList.add('on');
        }
      }
    }

    chips(sugerencias());
    if (primera) localStorage.setItem(llave, new Date().toISOString());
  }

  /* ── Abrir / cerrar ────────────────────────────────────────────────────── */
  let iniciado = false;
  async function abrir() {
    panel.classList.add('on'); fab.classList.add('oculto');
    $dot.classList.remove('on'); abierto = true;
    if (!iniciado) { iniciado = true; await bienvenida(); }
    setTimeout(() => $in.focus(), 120);
  }
  function cerrar() {
    panel.classList.remove('on'); fab.classList.remove('oculto'); abierto = false;
  }

  fab.onclick = abrir;
  panel.querySelector('#sa-x').onclick = cerrar;
  $send.onclick = () => { const v = $in.value; $in.value = ''; $in.style.height = 'auto'; preguntar(v); };
  $in.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $send.click(); }
  });
  $in.addEventListener('input', () => {
    $in.style.height = 'auto';
    $in.style.height = Math.min($in.scrollHeight, 88) + 'px';
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && abierto) cerrar(); });

  /* ── Arranque ──────────────────────────────────────────────────────────── */
  async function init() {
    const cli = cliente();
    if (!cli) {
      console.warn('[Sky] No encontré el cliente de Supabase (sb). El asistente no arranca.');
      fab.remove(); panel.remove(); return;
    }

    try {
      const pg = perfilGlobal();
      if (pg) {
        perfil = pg;
      } else {
        const { data: { session } } = await cli.auth.getSession();
        if (!session) {
          console.warn('[Sky] Sin sesión activa. El asistente no se muestra.');
          fab.remove(); panel.remove(); return;
        }
        const { data: p, error } = await cli.from('profiles')
          .select('id,role,company_name,is_supercompras').eq('id', session.user.id).single();
        if (error) console.warn('[Sky] No pude leer profiles:', error.message);
        perfil = p || { id: session.user.id, role: 'proveedor' };
      }
    } catch (e) {
      console.error('[Sky] Falló la inicialización:', e);
      fab.remove(); panel.remove(); return;
    }

    rol = (perfil.role === 'compras' && perfil.is_supercompras === true)
      ? 'super-compras' : perfil.role;
    modulo = detectarModulo();
    await cargarConceptos();
    $sub.textContent = perfil.company_name || 'SkySense Proveedores';

    // Punto rojo la primera vez, para que la gente lo descubra
    const llave = CFG.llaveBienvenida + ':' + perfil.id;
    if (!localStorage.getItem(llave)) $dot.classList.add('on');
  }

  /* El cliente y el perfil se pueblan en el script de cada página, que puede
     tardar (getSession + consulta a profiles). Se espera activamente hasta
     6 segundos en lugar de asumir un tiempo fijo. */
  let intentos = 0;
  function arrancar() {
    intentos++;
    if (cliente() && (perfilGlobal() || intentos > 8)) { init(); return; }
    if (intentos > 20) {
      console.warn('[Sky] No se pudo inicializar: cliente Supabase no disponible.');
      fab.remove(); panel.remove(); return;
    }
    setTimeout(arrancar, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(arrancar, 400));
  } else {
    setTimeout(arrancar, 400);
  }

  /* ── API pública ───────────────────────────────────────────────────────── */
  window.SkyAsistente = {
    abrir: abrir,
    cerrar: cerrar,
    preguntar: function (t) { if (!abierto) abrir(); setTimeout(() => preguntar(t), 300); },
    version: '1.4',

    /* Diagnóstico: ejecutar en la consola del navegador con
       SkyAsistente.diagnostico()   */
    diagnostico: async function () {
      const cli = cliente();
      const r = { perfil_id: perfil && perfil.id, rol: rol, modulo: modulo,
                  cliente_sb: !!cli, perfil_global: !!perfilGlobal() };
      if (!cli) { console.table(r); return r; }
      try {
        const b = await cli.rpc('asist_buscar',
          { p_texto: 'documentos anticipo', p_modulo: null, p_limite: 3 });
        r.asist_buscar = b.error ? ('ERROR: ' + b.error.message) : (b.data || []).length + ' filas';
      } catch (e) { r.asist_buscar = 'EXCEPCION: ' + e.message; }
      try {
        const a = await cli.rpc('asist_ayuda_modulo', { p_modulo: modulo });
        r.asist_ayuda_modulo = a.error ? ('ERROR: ' + a.error.message) : (a.data || []).length + ' filas';
      } catch (e) { r.asist_ayuda_modulo = 'EXCEPCION: ' + e.message; }
      try {
        const c = await cli.from('asistente_conocimiento').select('id', { count: 'exact', head: true });
        r.filas_visibles = c.error ? ('ERROR: ' + c.error.message) : c.count;
      } catch (e) { r.filas_visibles = 'EXCEPCION: ' + e.message; }
      try {
        const f = await cli.from('facturas').select('id', { count: 'exact', head: true });
        r.facturas_visibles = f.error ? ('ERROR: ' + f.error.message) : f.count;
      } catch (e) { r.facturas_visibles = 'EXCEPCION: ' + e.message; }
      r.conceptos = DOCS_REQ ? JSON.stringify(DOCS_REQ) : 'respaldo local (configuración no leída)';
      console.table(r);
      return r;
    }
  };
})();
