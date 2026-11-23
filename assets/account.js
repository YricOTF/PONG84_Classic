"use strict";

let turnstileScript;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  turnstileScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => {
      script.remove();
      turnstileScript = undefined;
      reject(new Error('人机验证加载失败'));
    };
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => {
      if (window.turnstile) window.turnstile.ready(() => resolve(window.turnstile));
      else fail();
    };
    script.onerror = fail;
    document.head.append(script);
  });
  return turnstileScript;
}

function bindAccountChallenge(container, status, retry, buttons) {
  let widget;
  let token = '';
  let enabled = false;
  let busy = false;
  let loading = false;
  let generation = 0;
  function update() {
    for (const button of buttons) button.disabled = !enabled || !token || busy;
  }
  function reset() {
    token = '';
    update();
    if (widget !== undefined) window.turnstile.reset(widget);
  }
  async function show() {
    enabled = true;
    if (loading || widget !== undefined) return;
    if (!PONG84_CONFIG.turnstileSiteKey) {
      status.textContent = '账号服务尚未配置人机验证';
      retry.hidden = true;
      update();
      return;
    }
    loading = true;
    const attempt = ++generation;
    retry.hidden = true;
    status.textContent = '正在加载人机验证…';
    try {
      const api = await loadTurnstile();
      if (!enabled || attempt !== generation) return;
      widget = api.render(container, {
        sitekey: PONG84_CONFIG.turnstileSiteKey,
        theme: 'dark',
        size: 'flexible',
        callback(value) {
          if (attempt !== generation) return;
          token = value;
          status.textContent = '';
          retry.hidden = true;
          update();
        },
        'expired-callback'() {
          if (attempt !== generation) return;
          token = '';
          status.textContent = '验证已过期，请重新验证';
          retry.hidden = false;
          update();
        },
        'error-callback'() {
          if (attempt !== generation) return;
          token = '';
          status.textContent = '人机验证失败，请重试';
          retry.hidden = false;
          update();
        }
      });
    } catch (error) {
      if (!enabled || attempt !== generation) return;
      status.textContent = error.message;
      retry.hidden = false;
    } finally {
      if (attempt === generation) loading = false;
    }
  }
  retry.addEventListener('click', () => {
    retry.hidden = true;
    if (widget === undefined) void show();
    else reset();
  });
  update();
  return {
    show,
    hide() {
      enabled = false;
      loading = false;
      generation++;
      token = '';
      status.textContent = '';
      retry.hidden = true;
      if (widget !== undefined) {
        window.turnstile.remove(widget);
        widget = undefined;
      }
      update();
    },
    get token() { return token; },
    setBusy(value) { busy = value; update(); },
    reset
  };
}

function pongAuthMessage(error) {
  if (error.code === 'captcha_failed') return '人机验证失败，请重新验证';
  if (error.code === 'email_not_confirmed') return '请先打开邮件确认账号';
  if (error.code === 'invalid_credentials') return '邮箱或密码错误';
  if (error.status === 429) return '操作太频繁，请稍后重试';
  return '账号操作失败，请稍后重试';
}
