(function () {
  'use strict';

  const API_URL = 'https://chentao-homepage-api.c708978499.workers.dev/api/likes';
  const SITE = 'chentao-homepage';
  const VISITOR_KEY = SITE + '.visitor-id.v1';
  const NOTICE_KEY = SITE + '.like-confirmed.v1';
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const TIMEOUT_MS = 8000;
  const messages = {
    en: {
      like: 'Like', liked: 'Liked', loading: 'Loading…', sending: 'Liking…', retry: 'Retry',
      loadingStatus: 'Loading likes…', sendingStatus: 'Saving your like…',
      likedStatus: 'Thank you for your like.',
      unavailable: 'Likes are temporarily unavailable. Please try again.',
      storageUnavailable: 'This browser cannot save your like, so liking is unavailable.',
      likedStorageUnavailable: 'Your like was received, but this browser could not save the update.'
    },
    zh: {
      like: '点赞', liked: '已点赞', loading: '读取中…', sending: '提交中…', retry: '重试',
      loadingStatus: '正在读取点赞状态…', sendingStatus: '正在保存点赞…',
      likedStatus: '感谢你的点赞。',
      unavailable: '点赞暂时不可用，请稍后重试。',
      storageUnavailable: '当前浏览器无法保存点赞状态，暂不能点赞。',
      likedStorageUnavailable: '已收到你的点赞，但当前浏览器无法保存此次更新。'
    }
  };

  const views = Array.from(document.querySelectorAll('[data-likes]')).map(function (container) {
    return {
      container: container,
      button: container.querySelector('[data-like-button]'),
      label: container.querySelector('[data-like-label]'),
      count: container.querySelector('[data-like-count]'),
      status: container.querySelector('[data-like-status]') || document.querySelector('[data-like-status]'),
      language: container.getAttribute('data-lang') === 'zh' ? 'zh' : 'en'
    };
  }).filter(function (view) { return view.button && view.label && view.count; });

  if (!views.length) return;

  let busy = false;
  let refreshPending = false;
  const state = {
    mode: 'loading', count: null, liked: false, visitorId: null, storageAvailable: null
  };

  class StorageUnavailable extends Error {}

  function randomVisitorId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
      throw new Error('Secure randomness unavailable');
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, function (value) { return value.toString(16).padStart(2, '0'); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function readOrCreateVisitor() {
    let storage;
    let existing;
    try {
      storage = window.localStorage;
      existing = storage.getItem(VISITOR_KEY);
    } catch (_) {
      throw new StorageUnavailable();
    }
    const candidate = UUID_V4.test(existing || '') ? existing : randomVisitorId();
    try {
      // Verify that storage is writable even when an earlier ID can still be read.
      storage.setItem(VISITOR_KEY, candidate);
      const persisted = storage.getItem(VISITOR_KEY);
      if (!UUID_V4.test(persisted || '')) throw new StorageUnavailable();
      return persisted;
    } catch (_) {
      throw new StorageUnavailable();
    }
  }

  async function visitorId() {
    if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
      let acquired = false;
      try {
        return await navigator.locks.request(VISITOR_KEY, function () {
          acquired = true;
          return readOrCreateVisitor();
        });
      } catch (error) {
        if (acquired) throw error;
        // If Web Locks itself is unavailable, use the same synchronous storage transaction.
      }
    }
    const candidate = readOrCreateVisitor();
    // Best effort without Web Locks: adopt a competing tab's persisted ID before any request.
    await Promise.resolve();
    try {
      const persisted = window.localStorage.getItem(VISITOR_KEY);
      if (!UUID_V4.test(persisted || '')) throw new StorageUnavailable();
      return persisted || candidate;
    } catch (_) {
      throw new StorageUnavailable();
    }
  }

  async function request(method, id) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    const options = {
      method: method, mode: 'cors', credentials: 'omit', cache: 'no-store',
      referrerPolicy: 'no-referrer', signal: controller.signal, headers: {}
    };
    if (method === 'POST') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify({ visitorId: id });
    } else if (id) {
      options.headers['X-Visitor-Id'] = id;
    }
    try {
      const response = await fetch(API_URL, options);
      const validStatus = method === 'POST' ? response.status === 200 || response.status === 201 : response.status === 200;
      if (!validStatus) throw new Error('Service unavailable');
      const value = await response.json();
      if (!value || value.site !== SITE || !Number.isSafeInteger(value.count) || value.count < 0 || typeof value.liked !== 'boolean') {
        throw new Error('Invalid service response');
      }
      if (method === 'POST' && (value.liked !== true || typeof value.added !== 'boolean' || value.added !== (response.status === 201))) {
        throw new Error('Invalid confirmation');
      }
      if (method === 'GET' && !id && value.liked) throw new Error('Invalid anonymous response');
      return value;
    } finally {
      clearTimeout(timer);
    }
  }

  function render() {
    views.forEach(function (view) {
      const text = messages[view.language];
      const labelKey = state.mode === 'error' ? 'retry' : state.mode === 'loading' ? 'loading' : state.mode === 'sending' ? 'sending' : state.liked ? 'liked' : 'like';
      view.label.textContent = text[labelKey];
      view.count.textContent = state.count === null ? '—' : state.count.toLocaleString(view.language === 'zh' ? 'zh-CN' : 'en-US');
      // An error button retries GET. It never submits a like without a confirmed usable state.
      view.button.disabled = busy || (state.mode !== 'error' && (state.storageAvailable !== true || state.liked || state.mode !== 'ready'));
      view.button.setAttribute('aria-pressed', state.liked ? 'true' : 'false');
      view.container.setAttribute('aria-busy', busy ? 'true' : 'false');
      if (view.status) {
        let status = '';
        if (state.mode === 'loading') status = text.loadingStatus;
        else if (state.mode === 'sending') status = text.sendingStatus;
        else if (state.mode === 'error') status = text.unavailable + (state.storageAvailable === false ? ' ' + text.storageUnavailable : '');
        else if (state.mode === 'likedStorageUnavailable') status = text.likedStorageUnavailable;
        else if (state.storageAvailable === false) status = text.storageUnavailable;
        else if (state.liked) status = text.likedStatus;
        view.status.textContent = status;
      }
    });
  }

  function applyServerState(value, id) {
    state.count = value.count;
    state.liked = value.liked;
    state.visitorId = id;
    state.mode = 'ready';
  }

  function finishRequest() {
    busy = false;
    if (refreshPending && document.visibilityState !== 'hidden') {
      refreshPending = false;
      void refresh();
    } else {
      render();
    }
  }

  function showFailure() {
    state.mode = 'error';
    state.count = null;
    state.liked = false;
  }

  async function refresh() {
    if (busy) { refreshPending = true; return; }
    busy = true;
    state.mode = 'loading';
    render();
    try {
      let id = null;
      try {
        id = await visitorId();
        state.storageAvailable = true;
      } catch (error) {
        if (!(error instanceof StorageUnavailable)) throw error;
        state.storageAvailable = false;
      }
      applyServerState(await request('GET', id), id);
    } catch (_) {
      showFailure();
    } finally {
      finishRequest();
    }
  }

  function notifyOtherTabs(id) {
    try {
      if (window.localStorage.getItem(VISITOR_KEY) !== id) return;
      // This is a refresh signal only. Counts and liked state always come from the service.
      window.localStorage.setItem(NOTICE_KEY, JSON.stringify({ visitorId: id, confirmedAt: Date.now() }));
    } catch (_) {
      state.storageAvailable = false;
      state.mode = 'likedStorageUnavailable';
    }
  }

  async function like() {
    if (busy) return;
    if (state.mode === 'error') { void refresh(); return; }
    if (state.mode !== 'ready' || state.liked || state.storageAvailable !== true) return;
    busy = true;
    state.mode = 'sending';
    render();
    try {
      const id = await visitorId();
      // A cleared or replaced identity must be checked before it can be used for POST.
      if (id !== state.visitorId) {
        const latest = await request('GET', id);
        applyServerState(latest, id);
        if (latest.liked) return;
      }
      const confirmed = await request('POST', id);
      applyServerState(confirmed, id);
      notifyOtherTabs(id);
    } catch (error) {
      if (error instanceof StorageUnavailable) {
        state.storageAvailable = false;
        state.mode = 'ready';
      } else {
        showFailure();
      }
    } finally {
      finishRequest();
    }
  }

  function synchronize() {
    if (busy || document.visibilityState === 'hidden') {
      refreshPending = true;
      return;
    }
    refreshPending = false;
    void refresh();
  }

  views.forEach(function (view) {
    view.button.addEventListener('click', function (event) {
      event.preventDefault();
      void like();
    });
  });
  window.addEventListener('storage', function (event) {
    if (event.key === null || event.key === VISITOR_KEY || event.key === NOTICE_KEY) synchronize();
  });
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) synchronize();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') synchronize();
  });
  void refresh();
}());
