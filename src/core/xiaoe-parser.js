/**
 * XiaoE Tech course parser — extracted from opencli xiaoe adapter.
 * Runs inside Electron BrowserWindow via executeJavaScript().
 *
 * Two core scripts:
 *   1. CATALOG_SCRIPT  — returns [{title, resource_id, type, url, ...}]
 *   2. PLAY_URL_SCRIPT — returns [{title, resource_id, m3u8_url, duration_sec, method}]
 */

// ─── Catalog: get all episodes from a course/column page ───

const CATALOG_SCRIPT = `(async () => {
  function sleep(ms) {
    return new Promise(function(r) { setTimeout(r, ms); });
  }

  // Click the "目录" tab
  var tabs = document.querySelectorAll('span, div');
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].children.length === 0 && tabs[i].textContent.trim() === '目录') {
      tabs[i].click(); break;
    }
  }
  await sleep(2000);

  async function expandAllSections() {
    for (var round = 0; round < 10; round++) {
      var clicked = 0;
      var nodes = document.querySelectorAll('span, div, p, button');
      for (var ni = 0; ni < nodes.length; ni++) {
        var text = (nodes[ni].textContent || '').trim();
        if ((text === '展开'
          || text === '展开更多'
          || text === '点击加载更多'
          || text === '加载更多'
          || text === '查看更多'
          || text === '查看更多')
          && nodes[ni].clientHeight > 0) {
          try {
            nodes[ni].click();
            clicked++;
          } catch(e) {}
        }
      }
      if (!clicked) break;
      await sleep(800);
    }
  }

  // Scroll to load all lazy-loaded items
  var prevScrollHeight = 0;
  for (var sc = 0; sc < 40; sc++) {
    window.scrollTo(0, 999999);
    var scrollers = document.querySelectorAll('.scroll-view, .list-wrap, .scroller, #app');
    for (var si = 0; si < scrollers.length; si++) {
      if (scrollers[si].scrollHeight > scrollers[si].clientHeight) {
        scrollers[si].scrollTop = scrollers[si].scrollHeight;
      }
    }
    await sleep(1000);

    await expandAllSections();

    var h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    var loadDone = document.body && /已加载完成/.test(document.body.innerText || '');
    if (sc > 5 && h === prevScrollHeight && loadDone) break;
    prevScrollHeight = h;
  }
  await expandAllSections();
  await sleep(1500);

  var el = document.querySelector('#app');
  var store = (el && el.__vue__) ? el.__vue__.$store : null;
  if (!store) return [];
  var coreInfo = store.state.coreInfo || {};
  var resourceType = coreInfo.resource_type || 0;
  var origin = window.location.origin;
  var courseName = coreInfo.resource_name || '';

  function typeLabel(t) {
    return {1:'图文',2:'直播',3:'音频',4:'视频',6:'专栏',8:'大专栏'}[Number(t)] || String(t||'');
  }
  function buildUrl(item) {
    var u = item.jump_url || item.h5_url || item.url || '';
    return (u && !u.startsWith('http')) ? origin + u : u;
  }
  function inferType(rawType, url, resourceId) {
    var known = typeLabel(rawType);
    var normalizedUrl = String(url || '').toLowerCase();
    if (normalizedUrl.includes('/course/video/') || normalizedUrl.includes('.m3u8')) return '视频';
    if (normalizedUrl.includes('/course/audio/')) return '音频';
    if (normalizedUrl.includes('/course/alive/')) return '直播';
    if (normalizedUrl.includes('/course/text/')) return '图文';

    if (/^v_/i.test(resourceId || '')) return '视频';
    if (/^a_/i.test(resourceId || '')) return '音频';
    if (/^l_/i.test(resourceId || '')) return '直播';
    if (/^i_/i.test(resourceId || '')) return '图文';

    if (known && known !== String(rawType || '')) return known;
    return known || String(rawType || '');
  }
  function buildLessonUrl(item, resourceId, inferredType) {
    var directUrl = buildUrl(item);
    if (directUrl) return directUrl;

    var urlPath = {
      '图文': '/v1/course/text/',
      '直播': '/v2/course/alive/',
      '音频': '/v1/course/audio/',
      '视频': '/v1/course/video/',
    }[inferredType];
    return (urlPath && resourceId) ? origin + urlPath + resourceId + '?type=2' : '';
  }

  // ===== 专栏 / 大专栏 =====
  if (resourceType === 6 || resourceType === 8) {
    await expandAllSections();
    await sleep(1000);
    var listData = [];
    var walkList = function(vm, depth) {
      if (!vm || depth > 6 || listData.length > 0) return;
      var d = vm.$data || {};
      var keys = ['columnList', 'SingleItemList', 'chapterChildren'];
      for (var ki = 0; ki < keys.length; ki++) {
        var arr = d[keys[ki]];
        if (arr && Array.isArray(arr) && arr.length > 0 && arr[0].resource_id) {
          for (var j = 0; j < arr.length; j++) {
            var item = arr[j];
            var resourceId = item.resource_id || '';
            if (!resourceId || !/^[pvlai]_/.test(resourceId)) continue;
            var rawUrl = buildUrl(item);
            var rawType = item.resource_type || item.chapter_type || item.type || 0;
            var inferredType = inferType(rawType, rawUrl, resourceId);
            listData.push({
              ch: 1, chapter: courseName, no: j + 1,
              title: item.resource_title || item.title || item.chapter_title || '',
              type: inferredType,
              raw_type: rawType,
              resource_id: resourceId,
              url: buildLessonUrl(item, resourceId, inferredType),
              raw_url: rawUrl,
            });
          }
          return;
        }
      }
      if (vm.$children) {
        for (var c = 0; c < vm.$children.length; c++) walkList(vm.$children[c], depth + 1);
      }
    };
    walkList(el.__vue__, 0);
    return listData;
  }

  // ===== 普通课程 =====
  var chapters = document.querySelectorAll('.chapter_box');
  for (var ci = 0; ci < chapters.length; ci++) {
    var vue = chapters[ci].__vue__;
    if (vue && typeof vue.getSecitonList === 'function' && (!vue.isShowSecitonsList || !vue.chapterChildren.length)) {
      if (vue.isShowSecitonsList) vue.isShowSecitonsList = false;
      try { vue.getSecitonList(); } catch(e) {}
      await new Promise(function(r) { setTimeout(r, 1500); });
    }
  }
  await new Promise(function(r) { setTimeout(r, 3000); });

  var result = [];
  chapters = document.querySelectorAll('.chapter_box');
  for (var cj = 0; cj < chapters.length; cj++) {
    var v = chapters[cj].__vue__;
    if (!v) continue;
    var chTitle = (v.chapterItem && v.chapterItem.chapter_title) || '';
    var children = v.chapterChildren || [];
    for (var ck = 0; ck < children.length; ck++) {
      var child = children[ck];
      var resId = child.resource_id || child.chapter_id || '';
      var chType = child.chapter_type || child.resource_type || 0;
      var inferredType = inferType(chType, '', resId);
      var urlPath = {'图文':'/v1/course/text/','直播':'/v2/course/alive/','音频':'/v1/course/audio/','视频':'/v1/course/video/'}[inferredType];
      result.push({
        ch: cj + 1, chapter: chTitle, no: ck + 1,
        title: child.chapter_title || child.resource_title || '',
        type: inferredType,
        raw_type: chType,
        resource_id: resId,
        url: urlPath ? origin + urlPath + resId + '?type=2' : '',
      });
    }
  }
  return result;
})()`;

// ─── Play URL: extract m3u8 from a single lesson page ───

const PLAY_URL_SCRIPT = `(async () => {
  var pageUrl = window.location.href;
  var origin = window.location.origin;
  function parseContentPageMeta(url) {
    try {
      var token = (url.match(/\\/content_page\\/([^?#]+)/) || [])[1] || '';
      if (!token) return null;
      token = token.replace(/-/g, '+').replace(/_/g, '/');
      while (token.length % 4) token += '=';
      return JSON.parse(atob(token));
    } catch (e) {
      return null;
    }
  }
  function deriveAppId() {
    try {
      var host = window.location.hostname || '';
      var direct = (host.match(/^(app[a-z0-9]+)/i) || [])[1] || '';
      if (direct) return direct;
    } catch (e) {}
    try {
      var el = document.querySelector('#app');
      var store = (el && el.__vue__ && el.__vue__.$store) ? el.__vue__.$store : null;
      var coreInfo = store && store.state ? (store.state.coreInfo || {}) : {};
      if (coreInfo.app_id) return coreInfo.app_id;
      if (coreInfo.appId) return coreInfo.appId;
    } catch (e) {}
    try {
      if (window.pushData && window.pushData.payload) {
        if (window.pushData.payload.app_id) return window.pushData.payload.app_id;
        if (window.pushData.payload.appId) return window.pushData.payload.appId;
      }
    } catch (e) {}
    return '';
  }
  function cleanUrl(url) {
    return String(url || '')
      .replace(/\\\\u0026/g, '&')
      .replace(/\\\\\\\\\\//g, '/')
      .replace(/\\\\\\//g, '/')
      .trim();
  }
  function deepExtractM3u8(value) {
    if (!value) return '';
    try {
      var candidates = collectCandidateUrls(value);
      for (var ci = 0; ci < candidates.length; ci++) {
        if (candidates[ci].indexOf('.m3u8') >= 0) return candidates[ci];
      }
      if (typeof value === 'string') {
        if (value.indexOf('.m3u8') >= 0) return cleanUrl(value);
        return '';
      }
      var json = JSON.stringify(value);
      var matches = json.match(/https?:[^"'\\\\\\s]*\\\\.m3u8[^"'\\\\\\s]*/g);
      if (matches && matches.length > 0) {
        return cleanUrl(matches[0]);
      }
    } catch (e) {}
    return '';
  }
  async function triggerPlayback() {
    var selectors = [
      'button',
      '[role="button"]',
      '.play-btn',
      '.play-button',
      '.btn-play',
      '.icon-play',
      '.xe-player-icon-play',
      '.xgplayer-play',
      'video',
      'audio'
    ];
    var nodes = document.querySelectorAll(selectors.join(','));
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var text = ((node.textContent || '') + ' ' + (node.className || '') + ' ' + (node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('title') || ''))).toLowerCase();
      if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO' || text.indexOf('play') >= 0 || text.indexOf('播放') >= 0) {
        try { node.click(); } catch (e) {}
      }
    }
    var vid = document.querySelector('video');
    var aud = document.querySelector('audio');
    try { if (vid) { vid.muted = true; await vid.play(); } } catch (e) {}
    try { if (aud) { aud.muted = true; await aud.play(); } } catch (e) {}
  }

  var contentMeta = parseContentPageMeta(pageUrl) || {};
  var resourceId = contentMeta.resource_id || (pageUrl.match(/[val]_[a-f0-9]+/) || [])[0] || '';
  var productId = contentMeta.product_id || (pageUrl.match(/product_id=([^&]+)/) || [])[1] || '';
  var appId = contentMeta.app_id || deriveAppId();
  var resourceType = Number(contentMeta.resource_type || 0);
  var isLive = resourceId.startsWith('l_') || pageUrl.includes('/alive/') || resourceType === 2;
  var m3u8Url = '', method = '', title = document.title, duration = 0;
  function safeKeys(value) {
    try {
      return value && typeof value === 'object' ? Object.keys(value).slice(0, 12) : [];
    } catch (e) {
      return [];
    }
  }
  function safeSnippet(value) {
    try {
      if (value == null) return '';
      var text = typeof value === 'string' ? value : JSON.stringify(value);
      return text.length > 280 ? text.slice(0, 280) + '...' : text;
    } catch (e) {
      return '';
    }
  }
  function collectCandidateUrls(value) {
    try {
      var text = typeof value === 'string' ? value : JSON.stringify(value);
      var matches = text.match(/https?:[^"'\\s]+/g) || [];
      var cleaned = [];
      for (var i = 0; i < matches.length; i++) {
        var u = cleanUrl(matches[i]);
        if (!u) continue;
        if (cleaned.indexOf(u) >= 0) continue;
        cleaned.push(u);
        if (cleaned.length >= 5) break;
      }
      return cleaned;
    } catch (e) {
      return [];
    }
  }
  var debug = {
    product_id: productId,
    app_id: appId,
    resource_type: resourceType,
    has_play_sign: false,
    play_data_code: '',
    detail_code: '',
    detail_error: '',
    play_error: '',
    host: window.location.hostname || '',
    detail_keys: [],
    detail_video_info_keys: [],
    play_data_keys: [],
    detail_candidates: [],
    play_candidates: [],
    perf_candidates: [],
    detail_snippet: '',
    play_snippet: ''
  };

  // Deep search Vue component tree for m3u8
  function searchVueM3u8() {
    var el = document.querySelector('#app');
    if (!el || !el.__vue__) return '';
    var walk = function(vm, d) {
      if (!vm || d > 10) return '';
      var data = vm.$data || {};
      for (var k in data) {
        if (k[0] === '_' || k[0] === '$') continue;
        var v = data[k];
        if (typeof v === 'string' && v.includes('.m3u8')) return v;
        if (typeof v === 'object' && v) {
          try {
            var s = JSON.stringify(v);
            var m = s.match(/https?:[^"]*\\\\.m3u8[^"]*/);
            if (m) return m[0].replace(/\\\\\\\\\\\\\//g, '/');
          } catch(e) {}
        }
      }
      if (vm.$children) {
        for (var c = 0; c < vm.$children.length; c++) {
          var f = walk(vm.$children[c], d + 1);
          if (f) return f;
        }
      }
      return '';
    };
    return walk(el.__vue__, 0);
  }

  // ===== Video: detail_info → getPlayUrl =====
  if (!isLive && resourceId.startsWith('v_')) {
    try {
      var detailRes = await fetch(origin + '/xe.course.business.video.detail_info.get/2.0.0', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          'bizData[resource_id]': resourceId,
          'bizData[product_id]': productId || resourceId,
          'bizData[opr_sys]': 'MacIntel',
        }),
      });
      var detail = await detailRes.json();
      debug.detail_code = String(detail.code || '');
      var detailData = detail.data || {};
      var vi = detailData.video_info || detailData.resource_info || {};
      debug.detail_keys = safeKeys(detailData);
      debug.detail_video_info_keys = safeKeys(vi);
      debug.detail_candidates = collectCandidateUrls(detailData);
      debug.detail_snippet = safeSnippet(detailData);
      title = title || vi.file_name || '';
      duration = vi.video_length || 0;
      var playSign = vi.play_sign || '';
      if (!playSign) {
        try {
          var playSignMatch = JSON.stringify(detailData).match(/"play_sign":"([^"]+)"/);
          if (playSignMatch) playSign = playSignMatch[1];
        } catch (e) {}
      }
      debug.has_play_sign = !!playSign;
      m3u8Url = deepExtractM3u8(detailData);
      if (m3u8Url) method = 'detail_payload';
      if (playSign && !m3u8Url) {
        var userId = (document.cookie.match(/ctx_user_id=([^;]+)/) || [])[1] || window.__user_id || '';
        var playRes = await fetch(origin + '/xe.material-center.play/getPlayUrl', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            org_app_id: appId, app_id: vi.material_app_id || appId,
            user_id: userId, play_sign: [playSign],
            play_line: 'A', opr_sys: 'MacIntel',
          }),
        });
        var playData = await playRes.json();
        var playPayload = (playData && typeof playData === 'object' && playData.data) ? playData.data : playData;
        debug.play_data_code = String((playData && playData.code) || '');
        debug.play_data_keys = safeKeys(playPayload);
        debug.play_candidates = collectCandidateUrls(playPayload);
        debug.play_snippet = safeSnippet(playPayload);
        m3u8Url = deepExtractM3u8(playPayload);
        if (m3u8Url) method = 'api_direct';
      }
    } catch(e) {
      debug.play_error = String((e && e.message) || e || '');
    }
  }

  // ===== Fallback: Performance API + Vue search polling =====
  if (!m3u8Url) {
    await triggerPlayback();
    for (var attempt = 0; attempt < 30; attempt++) {
      var entries = performance.getEntriesByType('resource');
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].name.includes('.m3u8')) { m3u8Url = entries[i].name; method = 'perf_api'; break; }
      }
      if (!debug.perf_candidates.length && entries && entries.length) {
        var perfMatches = [];
        for (var pi = 0; pi < entries.length; pi++) {
          var name = entries[pi].name || '';
          if (name.indexOf('/play') >= 0 || name.indexOf('/drm') >= 0 || name.indexOf('.m3u8') >= 0 || name.indexOf('.mp4') >= 0) {
            if (perfMatches.indexOf(name) < 0) perfMatches.push(name);
          }
          if (perfMatches.length >= 5) break;
        }
        debug.perf_candidates = perfMatches;
      }
      if (!m3u8Url) { m3u8Url = searchVueM3u8(); if (m3u8Url) method = 'vue_search'; }
      if (!m3u8Url && debug.play_candidates && debug.play_candidates.length) {
        for (var pci = 0; pci < debug.play_candidates.length; pci++) {
          if (debug.play_candidates[pci].indexOf('.m3u8') >= 0) {
            m3u8Url = debug.play_candidates[pci];
            method = 'play_candidates';
            break;
          }
        }
      }
      if (!m3u8Url && debug.perf_candidates && debug.perf_candidates.length) {
        for (var pfi = 0; pfi < debug.perf_candidates.length; pfi++) {
          if (debug.perf_candidates[pfi].indexOf('.m3u8') >= 0) {
            m3u8Url = debug.perf_candidates[pfi];
            method = 'perf_candidates';
            break;
          }
        }
      }
      if (m3u8Url) break;
      await new Promise(function(r) { setTimeout(r, 500); });
    }
  }

  if (!duration) {
    var vid = document.querySelector('video'), aud = document.querySelector('audio');
    if (vid && vid.duration && !isNaN(vid.duration)) duration = Math.round(vid.duration);
    if (aud && aud.duration && !isNaN(aud.duration)) duration = Math.round(aud.duration);
  }

  return { title: title, resource_id: resourceId, m3u8_url: m3u8Url, duration_sec: duration, method: method, debug: debug };
})()`;

module.exports = { CATALOG_SCRIPT, PLAY_URL_SCRIPT };
