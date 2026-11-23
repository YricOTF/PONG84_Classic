"use strict";

const PONG84_CONFIG = Object.freeze({
  supabaseUrl: 'https://grfhbtszcrwdbrphaiaw.supabase.co',
  supabaseKey: 'sb_publishable_1FoCHLurAbMImr14Vnruaw_xMPoUTa6',
  turnstileSiteKey: ''
});

function createPong84Client(storageKey, persistSession = true) {
  try {
    return window.supabase?.createClient(PONG84_CONFIG.supabaseUrl, PONG84_CONFIG.supabaseKey, {
      auth: { storageKey, persistSession }
    }) || null;
  } catch (error) {
    console.warn('[PONG-84] Supabase 初始化失败', error);
    return null;
  }
}
