// ==UserScript==
// @name         PT2MP - PT 站种子一键推送 MoviePilot
// @namespace    https://github.com/redfofo/PT2MP
// @version      1.0.0
// @description  在 PT 站点详情页识别种子并显示媒体信息、入库与订阅状态，一键推送到 MoviePilot。兼容 MoviePilot V2 / moviepilot-neo / V3。
// @author       redfofo
// @homepageURL  https://github.com/redfofo/PT2MP
// @supportURL   https://github.com/redfofo/PT2MP/issues
// @match        https://*/details.php?id=*
// @match        https://*/details_movie.php?id=*
// @match        https://*/details_tv.php?id=*
// @match        https://*/details_animate.php?id=*
// @match        https://totheglory.im/t/*
// @match        https://*.m-team.cc/detail/*
// @match        https://sunnypt.top/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      *
// @license      MIT
// ==/UserScript==

// 基于 yubanmeiqin9048 与 虚静道长 的 MIT 授权脚本重写，许可详情见 LICENSE。

'use strict';

GM_addStyle(`
  .mp-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; line-height: 1.2; word-break: normal; }
  .mp-tag, .mp-btn { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border: 0; border-radius: 6px; font-size: 12px; color: #fff; white-space: nowrap; }
  .mp-btn { background: #007bff; cursor: pointer; }
  .mp-btn:disabled { background: #999; cursor: not-allowed; }
  .mp-center .mp-tags { justify-content: center; }
  .mp-panel-sunnypt { margin-top: 8px; }
  .mp-panel-mteam { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--mt-line-color, #e5e7eb); }
  .mp-panel-title { margin-bottom: 8px; font-size: 12px; font-weight: 600; color: #6b7280; }

  .mp-modal { position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,.5); font-family: sans-serif; }
  .mp-modal-box { position: relative; width: min(600px, 90%); margin: 10vh auto 0; padding: 20px; border-radius: 8px; background: #fff; color: #333; box-shadow: 0 4px 12px rgba(0,0,0,.2); }
  .mp-modal-box h3 { margin: 0 0 12px; color: #333; }
  .mp-close { position: absolute; top: 5px; right: 15px; font-size: 28px; color: #aaa; cursor: pointer; }
  .mp-field { display: block; margin-bottom: 15px; font-size: 14px; font-weight: bold; }
  .mp-field input { display: block; width: 100%; margin-top: 5px; padding: 10px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; font-size: 14px; font-weight: normal; }
  .mp-primary { padding: 8px 16px; border: 0; border-radius: 4px; background: #007bff; color: #fff; font-size: 14px; cursor: pointer; }
  .mp-results { max-height: 300px; margin-top: 16px; overflow-y: auto; }
  .mp-result { margin-bottom: 8px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; }
  .mp-result:hover { border-color: #007bff; background: #f0f8ff; }
  .mp-muted { color: #666; font-size: 13px; }

  #mp-toasts { position: fixed; top: 20px; right: 20px; z-index: 10001; display: flex; flex-direction: column; gap: 10px; }
  .mp-toast { min-width: 280px; max-width: 400px; padding: 12px 16px; border-left: 5px solid #007bff; border-radius: 4px; background: #fff; color: #333; font: 13px/1.4 sans-serif; box-shadow: 0 4px 15px rgba(0,0,0,.2); word-break: break-all; }
  .mp-toast.success { border-color: #28a745; }
  .mp-toast.error { border-color: #dc3545; }
`);

// ---------- 基础工具 ----------
const config = {
    url: GM_getValue('mp_url', ''),
    key: GM_getValue('mp_api_key', ''),
    debug: GM_getValue('mp_debug', false),
};
const log = (...args) => config.debug && console.log('[MoviePilot]', ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value) => String(value ?? '').replace(/[​-‏‪-‮⁠-⁩﻿]/g, '').replace(/\s+/g, ' ').trim();
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const textOf = (el) => clean(el?.innerText ?? el?.textContent);

// 所有文本都走 DOM 节点，不拼 innerHTML，站点和接口返回的内容不会被当作 HTML 执行
function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key in el) el[key] = value;
        else el.setAttribute(key, value);
    }
    el.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
    return el;
}

function parseSize(text) {
    const match = String(text || '').match(/(\d+(?:\.\d+)?)\s*([KMGT])i?B/i);
    if (!match) return 0;
    return parseFloat(match[1]) * 1024 ** ('KMGT'.indexOf(match[2].toUpperCase()) + 1);
}

// ---------- MoviePilot 接口（所有请求只会发往用户配置的 MP 地址） ----------
function request(base, key, path, { method = 'GET', query, body, timeout } = {}) {
    const search = query ? `?${new URLSearchParams(query)}` : '';
    return new Promise((resolve) => {
        const done = (status, res) => {
            let json = res?.response;
            if (json === undefined || json === null || typeof json === 'string') {
                try { json = JSON.parse(res?.responseText ?? json); } catch { json = null; }
            }
            // V3 统一包装 {success, message, data}，V2 / neo 部分接口返回裸数据
            const wrapped = json && typeof json === 'object' && !Array.isArray(json) && 'data' in json && ('success' in json || 'message' in json);
            log(method, path, search, status, json);
            resolve({ ok: status >= 200 && status < 300, status, body: json, data: wrapped ? json.data : json });
        };
        GM_xmlhttpRequest({
            method,
            url: `${base}/api/v1${path}${search}`,
            headers: { 'X-Api-Key': key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
            data: body ? JSON.stringify(body) : undefined,
            responseType: 'json',
            timeout,
            onload: (res) => done(res.status, res),
            onerror: () => done(0),
            ontimeout: () => done(0),
        });
    });
}
const api = (path, options) => request(config.url, config.key, path, options);

// V3 以 media_source + media_id 为主身份，tmdb_id 只是辅助字段；这里统一补齐，后续无需区分版本
function normalizeMedia(info) {
    if (!info || typeof info !== 'object' || info.tmdb_id) return info;
    const isTmdb = ['themoviedb', 'tmdb'].includes(String(info.media_source || info.source).toLowerCase());
    if (isTmdb && /^\d+$/.test(String(info.media_id))) info.tmdb_id = Number(info.media_id);
    else if (info.tmdbid) info.tmdb_id = info.tmdbid;
    return info;
}

const mediaType = (info) => (info?.type === '电视剧' ? '电视剧' : '电影');

const mp = {
    async recognize(title, subtitle) {
        const res = await api('/media/recognize', { query: { title, subtitle: subtitle || '' } });
        const media = res.ok ? normalizeMedia(res.data?.media_info) : null;
        return media ? { media, meta: res.data.meta_info || {} } : null;
    },
    async search(title) {
        const res = await api('/media/search', { query: { title, page: 1, count: 10 } });
        return res.ok && Array.isArray(res.data) ? res.data.map(normalizeMedia) : [];
    },
    // 详情接口差异 —— V2 / neo：/media/tmdb:{id}?type_name=  V3：/media/{id}?media_source=themoviedb&type_name=
    async detail(tmdbId, typeName) {
        const styles = {
            v2: [`/media/tmdb:${encodeURIComponent(tmdbId)}`, { type_name: typeName }],
            v3: [`/media/${encodeURIComponent(tmdbId)}`, { media_source: 'themoviedb', type_name: typeName }],
        };
        const remembered = GM_getValue('mp_media_detail_style', 'v2');
        for (const style of remembered === 'v3' ? ['v3', 'v2'] : ['v2', 'v3']) {
            const [path, query] = styles[style];
            const res = await api(path, { query });
            const media = res.ok ? normalizeMedia(res.data) : null;
            if (media?.tmdb_id) {
                GM_setValue('mp_media_detail_style', style);
                return media;
            }
        }
        return null;
    },
    // 先查 MP 数据库（依赖媒体服务器同步任务），未命中再实时询问媒体服务器。返回 yes | partial | no
    async exists(media) {
        const { tmdb_id: id, title, year } = media;
        const local = await api('/mediaserver/exists', {
            query: {
                media_source: 'themoviedb', media_id: id, // V3
                tmdbid: id, // V2 / neo
                mtype: mediaType(media),
                ...(title ? { title } : {}),
                ...(year ? { year } : {}),
            },
        });
        if (local.ok && local.body?.data?.item?.id) return 'yes';

        const remote = await api('/mediaserver/notexists', { method: 'POST', body: media });
        if (!remote.ok || !Array.isArray(remote.data)) return 'no';
        if (!remote.data.length) return 'yes';
        const partial = remote.data.some(({ episodes, total_episode: total }) => total > 0 && episodes?.length > 0 && episodes.length < total);
        return partial ? 'partial' : 'no';
    },
    async isSubscribed(tmdbId) {
        const res = await api('/subscribe/');
        return res.ok && Array.isArray(res.data) && res.data.some((sub) => String(sub.tmdbid) === String(tmdbId) || String(sub.media_id) === String(tmdbId));
    },
    async subscribe(media) {
        const res = await api('/subscribe/', {
            method: 'POST',
            body: {
                name: media.title, type: mediaType(media), year: media.year || '',
                tmdbid: media.tmdb_id || 0, media_source: 'themoviedb', media_id: String(media.tmdb_id || ''),
            },
        });
        return res.ok && res.body?.success !== false;
    },
    async download(media, torrent, link) {
        const site = await api(`/site/domain/${encodeURIComponent(location.hostname)}`);
        if (!site.status) return { success: false, message: '无法连接 MoviePilot，请检查地址或网络' };
        const siteInfo = site.ok ? site.data || {} : {}; // 站点未添加到 MP 时也允许继续推送
        const res = await api('/download/', {
            method: 'POST',
            body: {
                media_in: media,
                torrent_in: {
                    site: siteInfo.id || 0, site_name: siteInfo.name || '', site_cookie: siteInfo.cookie || '',
                    site_ua: navigator.userAgent, site_proxy: siteInfo.proxy || null, site_order: siteInfo.pri || null,
                    title: torrent.name, description: torrent.desc || '', imdbid: null,
                    enclosure: link, page_url: location.href, size: torrent.size || 0,
                    seeders: 0, peers: 0, grabs: 0,
                    pubdate: new Date().toISOString().replace('T', ' ').replace(/\..+/, ''),
                    date_elapsed: null, uploadvolumefactor: 1, downloadvolumefactor: 0,
                    hit_and_run: false, labels: [], pri_order: 0, volume_factor: '普通',
                },
            },
        });
        if (res.ok && res.body?.success) return { success: true, message: res.body.message || '任务已成功接管' };
        return { success: false, message: res.body?.message || res.body?.msg || res.body?.detail || `HTTP ${res.status} 状态异常` };
    },
};

// ---------- 标题候选 ----------
const VIDEO_EXT = /\.(mkv|mp4|avi|ts|m2ts|flv|wmv)$/i;
const RELEASE_NOISE = /\b(?:4320p|2160p|1080p|720p|480p|web[-\s]?dl|webrip|bluray|bdrip|hdtv|dvdrip|remux|h\.?26[45]|x26[45]|hevc|avc|aac(?:\d\.\d)?|ddp?\d(?:\.\d)?|dts(?:-hd)?|atmos|hdr10\+?|dolby[\s-]?vision|10bit|8bit)\b/i;

function normalizeTitle(raw) {
    let title = String(raw || '').replace(/\s+/g, ' ').trim().replace(/\.torrent$/i, '').replace(VIDEO_EXT, '');
    // 去掉开头的 [组名] (xx) 【xx】 <xx>
    for (let prev; prev !== title;) {
        prev = title;
        title = title.replace(/^\s*(?:\[[^\]]{1,30}\]|\([^)]{1,30}\)|【[^】]{1,30}】|<[^>]{1,30}>)(?:[\s._-]+|$)/, '');
    }
    title = title
        .replace(/^[^A-Za-z0-9一-龥]+/, '')
        .replace(/^[A-Za-z0-9]{2,10}\]\s*/, '')
        .replace(/^[\])】}]+/, '')
        .replace(/[._]+/g, ' ');
    const noise = title.match(RELEASE_NOISE);
    if (noise?.index > 0) title = title.slice(0, noise.index);
    return title
        .replace(/\s+free\s+\d+\s*h(?:\s+\d+\s*min)?$/i, '')
        .replace(/\s+-[A-Za-z0-9][A-Za-z0-9._-]*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function subtitleCandidates(subtitle) {
    const parts = String(subtitle || '')
        .replace(/\*[^*]{1,40}\*/g, ' ')
        .replace(/\[[^\]]{1,40}\]/g, ' ')
        .replace(/[|｜]/g, '/')
        .split('/')
        .map((part) => part.replace(/(?:评论音轨|多国语字幕|字幕|中字|簡繁|简繁|国语|日语|英语|粤语|双语|音轨|內封|外挂|內嵌).*/gi, '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    return [...new Set(parts.flatMap((part) => [part, ...(part.match(/\b[A-Za-z][A-Za-z0-9'’-]{3,}\b/g) || [])]))].slice(0, 8);
}

function titleCandidates(raw, subtitle) {
    const normalized = normalizeTitle(raw);
    const noEpisode = normalized.replace(/\bS\d{1,2}E\d{1,3}\b/ig, ' ').replace(/\bE\d{1,3}\b/ig, ' ').replace(/\b第\s*\d+\s*[季集]\b/g, ' ');
    const isTv = /\bS\d{1,2}E\d{1,3}\b|\bE\d{1,3}\b|第\s*\d+\s*[季集]/i.test(normalized);
    const list = [raw, normalized, normalized.split(/\s*\/\s*/)[0], noEpisode, ...subtitleCandidates(subtitle)];
    const year = !isTv && normalized.match(/\b(?:19|20)\d{2}\b/)?.[0];
    if (year) {
        const noYear = normalized.replace(new RegExp(`\\b${year}\\b`, 'g'), ' ').replace(/\(\s*\)/g, ' ').replace(/\s+/g, ' ').trim();
        list.push(noYear);
        if (noYear) list.push(`${noYear} ${year}`, `${noYear} (${year})`);
    }
    const cleaned = list.map((title) => String(title || '').replace(/\s+/g, ' ').replace(/\.torrent$/i, '').replace(VIDEO_EXT, '').replace(/^[A-Za-z0-9]{2,10}\]\s*/, '').trim());
    return [...new Set(cleaned.filter(Boolean))];
}

// ---------- 站点适配 ----------
// 每个站点实现：match() 是否当前站点模板；extract() 返回种子信息（尚未就绪返回 null）；mount(info) 插入面板并返回内容容器
// 种子信息：{ name, desc, size, link } ；下载链接需临时获取的站点改为提供 getLink()
const mounted = (el) => { el.classList.add('mp-mounted'); return el; };

// M-Team：前端单页应用，下载链接要点击原生按钮后才生成，这里监听页面请求拿到链接，并拦截实际下载
const mteam = {
    tid: () => location.pathname.match(/^\/detail\/(\d+)/)?.[1],
    captured: {},

    link(raw) {
        const text = String(raw || '').replace(/\\\//g, '/').replace(/&amp;/g, '&');
        const found = text.match(/https?:\/\/[^\s"'`<>\\]+|\/api\/rss\/dlv2\?[^\s"'`<>\\]+|\/api\/torrent\/download\?[^\s"'`<>\\]+/i)?.[0];
        if (!found) return '';
        let url;
        try { url = new URL(found, location.origin).href; } catch { return ''; }
        const allowedHost = /(^|\.)(m-team\.cc|m-team\.io|halomt\.com)$/i.test(new URL(url).hostname);
        const looksLikeTorrent = /\/api\/rss\/dlv2\?|\/api\/torrent\/download\?|\.torrent(?:\?|$)/i.test(url)
            || (/[?&]sign=/i.test(url) && (/halomt\.com/i.test(url) || (/[?&](?:app_id|payload|playload)=/i.test(url) && /[?&]t=/i.test(url))));
        const otherTid = url.match(/[?&]tid=(\d+)/)?.[1];
        return allowedHost && looksLikeTorrent && (!otherTid || otherTid === mteam.tid()) ? url : '';
    },

    installHook() {
        if ($('#mp-mteam-hook')) return;
        document.addEventListener('mp-mteam-link', (event) => {
            const url = mteam.link(event.detail);
            if (url) mteam.captured[mteam.tid()] = url;
        }, true);
        // 需要运行在页面上下文才能拦截站点自己的 fetch / XHR / window.open
        (document.head || document.documentElement).append(h('script', { id: 'mp-mteam-hook', textContent: `(() => {
            let silentUntil = 0;
            const matches = (url) => /dlv2|torrent\\/download|\\.torrent|sign=/i.test(String(url || ''));
            const emit = (url) => matches(url) && document.dispatchEvent(new CustomEvent('mp-mteam-link', { detail: String(url) }));
            const silent = (url) => Date.now() < silentUntil && matches(url);
            document.addEventListener('mp-mteam-silent', (e) => { silentUntil = Date.now() + e.detail; }, true);
            const { open } = window, { fetch } = window, xhrOpen = XMLHttpRequest.prototype.open, click = HTMLAnchorElement.prototype.click;
            window.open = function (url) { emit(url); return silent(url) ? null : open.apply(this, arguments); };
            window.fetch = function (input) { emit(typeof input === 'string' ? input : input && input.url); return fetch.apply(this, arguments); };
            XMLHttpRequest.prototype.open = function (method, url) { emit(url); return xhrOpen.apply(this, arguments); };
            HTMLAnchorElement.prototype.click = function () { emit(this.href); return silent(this.href) ? undefined : click.apply(this, arguments); };
            document.addEventListener('click', (e) => {
                for (const node of e.composedPath()) if (node.getAttribute) ['href', 'data-url', 'data-href', 'onclick'].forEach((a) => emit(node.getAttribute(a)));
            }, true);
        })();` }));
    },

    nativeButton() {
        const isDownload = (el) => /下載|下载|download/i.test(`${el.textContent} ${el.getAttribute('title')} ${el.getAttribute('aria-label')}`);
        return $$('div.flex.justify-between button, div.flex.justify-between a, div.flex.justify-between [role="button"]').find(isDownload)
            || $('div.flex-grow.w-1.flex.flex-col.justify-between > div.flex.justify-between > div > div > div > div:nth-child(4)');
    },

    findLink() {
        const seen = [
            mteam.captured[mteam.tid()],
            ...performance.getEntriesByType('resource').map((entry) => entry.name).reverse(),
            ...$$('a[href]').map((a) => a.href),
        ];
        for (const raw of seen) {
            const url = mteam.link(raw);
            if (url) return url;
        }
        return '';
    },

    // 只在用户点击推送时才触发原生按钮，避免打开详情页就产生下载记录
    async getLink() {
        document.dispatchEvent(new CustomEvent('mp-mteam-silent', { detail: 15000 }));
        for (let i = 0; i < 20; i++) {
            const url = mteam.findLink();
            if (url) return url;
            if (i % 6 === 0) {
                const button = mteam.nativeButton();
                ($('a,button,[role="button"]', button || document.createElement('div')) || button)?.click();
            }
            await sleep(700);
        }
        return '';
    },

    titleScore(title) {
        const pipes = (title.match(/\|/g) || []).length;
        const words = title.split(' ');
        const isTagCloud = (pipes >= 5 && !/\bS\d{1,2}E\d{1,3}\b/i.test(title))
            || (words.length >= 8 && words.filter((w) => /^[A-Z0-9]{2,10}$/.test(w)).length / words.length > 0.65);
        return (title.length >= 6 && title.length <= 220 ? 2 : 0)
            + (/[A-Za-z一-龥]/.test(title) ? 1 : 0)
            + (/\bS\d{1,2}E\d{1,3}\b/i.test(title) ? 3 : 0)
            + (/\b(?:4320p|2160p|1080p|720p|web[-\s]?dl|webrip|bluray|h\.?26[45]|x26[45]|hevc)\b/i.test(title) ? 2 : 0)
            + (/\b(?:19|20)\d{2}\b/.test(title) ? 1 : 0)
            - (pipes >= 3 ? 3 : 0) - (isTagCloud ? 4 : 0)
            - (!title.includes(' ') && title.length < 8 ? 2 : 0);
    },

    anchor() {
        return $('#app-content div.flex-grow.w-1.flex.flex-col.justify-between > div:nth-child(2) > div.ant-space') || $('h2 > span:nth-child(3), h2 > span, h2');
    },
};

const SITES = [
    {
        name: 'm-team',
        spa: () => /(^|\.)m-team\.cc$/i.test(location.hostname),
        match: () => mteam.tid() && /(^|\.)m-team\.cc$/i.test(location.hostname),
        extract() {
            const anchorText = clean(mteam.anchor()?.textContent);
            if (anchorText.length < 6 || /^m-team$/i.test(anchorText)) return null;
            const fields = $$('.ant-descriptions-item-label').map((label) => [clean(label.textContent), clean(label.nextElementSibling?.textContent)]);
            if (!mteam.nativeButton() && fields.length < 2 && !/detail|種子詳情|torrent/i.test(document.title)) return null;
            const field = (pattern) => fields.find(([key, value]) => value && pattern.test(key))?.[1] || '';

            const titles = [
                fields[0]?.[1].replace(/\.torrent$/i, ''),
                ...fields.filter(([key]) => /(标题|標題|名称|名稱|片名|title|name)/i.test(key)).map(([, value]) => value.replace(/\.torrent$/i, '')),
                ...$$('.ant-page-header-heading-title, .ant-page-header-heading .ant-typography, h1, h2, [class*="title"], [class*="Title"]').map((el) => clean(el.textContent)),
                clean(document.title).replace(/\s*[-|_]\s*M[\s-]?Team.*$/i, ''),
            ].filter((title) => title && !/^m-team$/i.test(title));
            const name = titles.reduce((best, title) => (mteam.titleScore(title) > mteam.titleScore(best) ? title : best), titles[0] || '');

            mteam.installHook();
            return {
                name,
                desc: field(/(副标题|副標題|简介|簡介|描述|description|剧情|劇情|small\s*descr)/i),
                size: parseSize(field(/(大小|體積|体积|size)/i)),
                getLink: mteam.getLink,
            };
        },
        mount() {
            const slot = h('div');
            mteam.anchor().after(mounted(h('div', { className: 'mp-panel-mteam' }, h('div', { className: 'mp-panel-title' }, 'MoviePilot'), slot)));
            return slot;
        },
    },
    {
        // 改版 NexusPHP（HDWinG 等）：顶部用 table.movie_details + ul/li 排版，没有 h1
        name: 'movie_details',
        match: () => $('table.movie_details .m_name h2#top'),
        extract() {
            const title = $('table.movie_details .m_name h2#top');
            const box = $('table.movie_details .info_box');
            if (!box) return null;
            // 只取直接文本，排除促销图标和文字
            const own = Array.from(title.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(' ');
            const lists = $$(':scope > ul', box);
            return {
                name: clean(own || title.textContent),
                desc: clean($('h3', title.parentElement)?.textContent),
                size: parseSize($$('li.bspace i', box).find((i) => /^大小/.test(clean(i.textContent)))?.textContent),
                link: ($('a#clip_target[href*="download"]', box) || $('a.torrentdown_button[href*="download"]', box) || $('a[href*="download.php"]', box))?.href || '',
                box,
                after: lists.find((ul) => clean($('li.left', ul)?.textContent) === '基本信息') || lists[lists.length - 1],
            };
        },
        mount({ box, after }) {
            const slot = h('li', { className: 'right' });
            // 站点左栏只有 60px，放不下 MoviePilot
            const row = mounted(h('ul', {}, h('li', { className: 'left' }, 'MP'), slot));
            if (after) after.after(row);
            else box.append(row);
            return slot;
        },
    },
    {
        // SunnyPT：Next.js 自研站点，下载链接由接口临时生成
        name: 'sunnypt',
        spa: () => /(^|\.)sunnypt\.top$/i.test(location.hostname),
        match: () => /(^|\.)sunnypt\.top$/i.test(location.hostname) && /^\/torrent\/\d+\/?$/.test(location.pathname),
        extract() {
            const title = $('main h1');
            if (!title) return null;
            const sub = $(':scope > p', title.parentElement);
            const size = $$('main span').find((el) => clean(el.textContent) === '种子总大小')?.previousElementSibling;
            return {
                // h1 是中文标题，p 是英文种子名，优先用种子名识别
                name: clean(sub?.textContent || title.textContent).replace(/@Sunny\s*$/i, '').trim(),
                desc: sub ? clean(title.textContent) : '',
                size: parseSize(size?.textContent),
                getLink: this.getLink,
                after: sub || title,
            };
        },
        async getLink() {
            try {
                const id = location.pathname.match(/^\/torrent\/(\d+)/)[1];
                const session = await (await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' })).json();
                const token = session?.data?.accessToken;
                if (!token) throw new Error('SunnyPT 未登录或会话已失效');
                const url = 'https://api.sunnypt.top/api/v1/torrent/download-link';
                const json = { 'Content-Type': 'application/json' };
                // 接口参数写法未从前端确认，依次尝试
                const attempts = [
                    [`${url}?id=${id}`], [`${url}?torrent_id=${id}`],
                    [url, json, JSON.stringify({ id: Number(id) })], [url, json, JSON.stringify({ torrent_id: Number(id) })],
                ];
                for (const [target, headers, body] of attempts) {
                    const res = await fetch(target, { method: 'POST', body, headers: { Authorization: `Bearer ${token}`, ...headers } }).catch(() => null);
                    const data = await res?.json().catch(() => null);
                    log('sunnypt download-link', target, body, res?.status, data);
                    if (res?.ok && data?.data?.download_url) return data.data.download_url;
                }
            } catch (error) {
                console.error('[MoviePilot] SunnyPT 获取下载链接失败:', error);
            }
            return '';
        },
        mount({ after }) {
            const slot = h('div');
            after.after(mounted(h('div', { className: 'mp-panel-sunnypt mp-center' }, slot)));
            return slot;
        },
    },
    {
        // 常规 NexusPHP：左列 .rowhead，字段按固定行序排列（个别站点行序不同）
        name: 'nexusphp',
        match: () => $('.rowhead') && $('h1'),
        extract() {
            const rows = $$('.rowhead');
            const cell = (index) => rows[index]?.nextElementSibling;
            const cellText = (index) => cell(index)?.innerText ?? cell(index)?.textContent ?? '';
            const cellLink = (index) => ($('a[href*="download"]', cell(index) || document.createElement('div')) || cell(index)?.firstElementChild)?.href;
            const host = location.hostname;
            let torrent;

            if (host.includes('hdsky')) {
                torrent = { link: cellLink(1), desc: cellText(2), size: parseSize(cellText(3)) };
            } else if (/(^|\.)(springsunday\.net|keepfrds\.com)$|(^|\.)qingwa\./i.test(host) || ($('#qingwa-head') && $('h1#top'))) {
                torrent = {
                    link: $('a[href*="download.php?id="], a[href*="download.php"], a[href*="download"], a[href*=".torrent"]')?.href || cellLink(0),
                    desc: cellText(1) || clean($('#titleEditBox input[type="text"]')?.value),
                    size: parseSize(cellText(2)),
                };
            } else if (host.includes('totheglory')) {
                const headings = $$('.heading');
                torrent = { link: headings[0]?.nextElementSibling?.firstElementChild?.href, desc: '', size: parseSize(headings[5]?.nextElementSibling?.textContent) };
            } else {
                torrent = { link: cellLink(0), desc: cellText(1), size: parseSize(cellText(2)) };
            }
            return { ...torrent, name: textOf($('h1')), table: rows[0].closest('table') };
        },
        mount({ table }) {
            const row = mounted(table.insertRow(Math.min(2, table.rows.length)));
            const slot = h('td', { className: 'rowfollow' });
            row.append(h('td', { className: 'rowhead nowrap' }, 'MoviePilot'), slot);
            return slot;
        },
    },
    {
        // 卡片式模板：字段用 div.font-bold.leading-6 排版，种子文件链接为 a.index
        name: 'card',
        match: () => $('a.index') && $('.font-bold.leading-6'),
        extract() {
            const fields = $$('.font-bold.leading-6');
            const file = $('a.index');
            if (fields.length < 6) return null;
            return { name: clean(file.textContent), desc: textOf(fields[3]), link: file.href, size: parseSize(fields[5].nextElementSibling?.textContent), after: fields[3] };
        },
        mount({ after }) {
            const slot = h('div', { className: 'font-light leading-6' });
            const value = mounted(h('div', { className: 'font-light leading-6' }, slot));
            after.after(mounted(h('div', { className: 'font-bold leading-6' }, 'MoviePilot')), value);
            return slot;
        },
    },
];

// ---------- 通用 UI ----------
const tag = (text, color) => h('span', { className: 'mp-tag', style: `background:${color}` }, String(text));
const button = (text, onclick) => h('button', { className: 'mp-btn', type: 'button', onclick }, text);
const render = (slot, ...nodes) => slot.replaceChildren(h('div', { className: 'mp-tags' }, nodes));

function toast(title, message, type = 'info') {
    let box = $('#mp-toasts');
    if (!box) document.body.append(box = h('div', { id: 'mp-toasts' }));
    const titleEl = h('b');
    const messageEl = h('div', { className: 'mp-muted' });
    const el = h('div', {}, titleEl, messageEl);
    box.append(el);
    const update = (nextTitle, nextMessage, nextType = 'info') => {
        el.className = `mp-toast ${nextType}`;
        titleEl.textContent = nextTitle;
        messageEl.textContent = nextMessage;
    };
    update(title, message, type);
    el.title = '点击关闭';
    el.onclick = () => el.remove();
    return { update, remove: () => el.remove() };
}

function modal(title, ...content) {
    const el = h('div', { className: 'mp-modal' },
        h('div', { className: 'mp-modal-box' },
            h('span', { className: 'mp-close', onclick: () => el.remove() }, '×'),
            h('h3', {}, title),
            content));
    document.body.append(el);
    return el;
}

function showConfig() {
    $('.mp-config')?.remove();
    const url = h('input', { type: 'text', placeholder: '例如：http://192.168.1.100:3000', value: config.url });
    const key = h('input', { type: 'text', placeholder: 'MoviePilot 设置中的 API_TOKEN', value: config.key });
    const status = h('p', { className: 'mp-muted' });

    const save = async () => {
        const base = url.value.trim().replace(/\/$/, '');
        const token = key.value.trim();
        if (!base || !token) { status.textContent = '请填写 MoviePilot 地址和 API Key'; return; }
        status.textContent = '正在验证连接...';
        const res = await request(base, token, '/user/current', { timeout: 8000 });
        if (!res.ok) {
            status.textContent = res.status ? `❌ 验证失败 (HTTP ${res.status})，请检查地址和 API Key` : '❌ 无法连接到服务器，请检查地址';
            return;
        }
        GM_setValue('mp_url', config.url = base);
        GM_setValue('mp_api_key', config.key = token);
        status.textContent = `✅ 连接成功，当前用户: ${res.data?.name || res.data?.user_name || 'unknown'}`;
        setTimeout(() => { el.remove(); tick(); }, 1000);
    };

    const el = modal('⚙️ MoviePilot 配置（仅保存在本地）',
        h('label', { className: 'mp-field' }, 'MoviePilot 地址（需带 http/https 及端口）', url),
        h('label', { className: 'mp-field' }, 'API Key（设定 → 系统 → 基础设置 中查看）', key),
        status,
        h('button', { className: 'mp-primary', type: 'button', onclick: save }, '保存配置'));
    el.classList.add('mp-config');
}

GM_registerMenuCommand('⚙️ 设置 MoviePilot 账号', showConfig);
GM_registerMenuCommand('🧪 切换调试日志', () => {
    GM_setValue('mp_debug', config.debug = !config.debug);
    alert(`调试日志已${config.debug ? '开启' : '关闭'}`);
});

// ---------- 识别与推送 ----------
async function autoRecognize(slot, torrent) {
    const candidates = titleCandidates(torrent.name, torrent.desc);
    log('候选标题', candidates);
    for (const [index, title] of candidates.entries()) {
        render(slot, index ? `自动识别重试中 (${index + 1}/${candidates.length})...` : '正在自动识别种子名称...');
        const result = await mp.recognize(title, index ? '' : torrent.desc);
        if (result) return result;
    }

    render(slot, '自动识别失败，尝试智能搜索匹配...');
    for (const query of [...new Set([...candidates, ...subtitleCandidates(torrent.desc)])].slice(0, 4)) {
        const [best] = await mp.search(query);
        if (!best) continue;
        const id = best.tmdb_id || best.id;
        const media = id ? await mp.detail(id, mediaType(best)) : null;
        return best.tmdb_id || media ? { media: media || best, meta: {} } : null;
    }
    return null;
}

function showResult(slot, torrent, media, meta = {}) {
    const id = String(media.tmdb_id || '').replace(/\D/g, '');
    const existsSlot = h('span');
    const subscribeSlot = h('span');

    const push = button(torrent.link || torrent.getLink ? '下载种子' : '无下载链接', async () => {
        push.disabled = true;
        push.textContent = '获取链接中...';
        const link = torrent.link || await Promise.resolve().then(torrent.getLink).catch((error) => {
            console.error('[MoviePilot] 获取下载链接失败:', error);
            return '';
        });
        if (!link) {
            push.disabled = false;
            push.textContent = '获取链接失败，点击重试';
            return;
        }
        push.textContent = '推送中...';
        const note = toast('⏳ 正在下发到下载器', '后端解析与防重需要一定时间，请稍等...');
        const result = await mp.download(media, torrent, link);
        push.disabled = false;
        push.textContent = result.success ? '下载完成' : '下载失败';
        push.style.background = result.success ? '#28a745' : '#dc3545';
        note.update(result.success ? '✅ 推送成功' : '❌ 推送失败', result.message, result.success ? 'success' : 'error');
        if (result.success) setTimeout(note.remove, 3000);
    });
    push.disabled = !torrent.link && !torrent.getLink;

    render(slot,
        media.type && tag(media.type, '#2775b6'),
        media.category && tag(media.category, '#2775b6'),
        media.title && tag(media.title, '#c54640'),
        media.year && tag(media.year, '#e6702e'),
        meta.season_episode && tag(meta.season_episode, '#ff9f43'),
        meta.edition && tag(meta.edition, '#ee5253'),
        meta.resource_pix && tag(meta.resource_pix, '#0abde3'),
        meta.video_encode && tag(meta.video_encode, '#1dd1a1'),
        meta.audio_encode && tag(meta.audio_encode, '#5f27cd'),
        id && h('a', { href: `https://www.themoviedb.org/${media.type === '电视剧' ? 'tv' : 'movie'}/${id}`, target: '_blank', rel: 'noopener noreferrer' }, tag(`TMDB:${id}`, '#5bb053')),
        existsSlot, subscribeSlot, push,
        button('重新识别', () => showManualSearch(slot, torrent)));

    if (!id) return;
    mp.exists(media).then((state) => {
        const [text, color] = { yes: ['已入库', '#28a745'], partial: ['部分入库', '#ffa502'], no: ['未入库', '#6c757d'] }[state];
        existsSlot.replaceChildren(tag(text, color));
    });
    mp.isSubscribed(id).then((subscribed) => {
        if (subscribed) { subscribeSlot.replaceChildren(tag('已订阅', '#17a2b8')); return; }
        const action = tag('订阅', '#ff6348');
        action.style.cursor = 'pointer';
        action.onclick = async () => {
            subscribeSlot.replaceChildren(tag('订阅中...', '#ffa502'));
            subscribeSlot.replaceChildren(await mp.subscribe(media) ? tag('已订阅', '#17a2b8') : tag('订阅失败', '#dc3545'));
        };
        subscribeSlot.replaceChildren(action);
    });
}

function showManualSearch(slot, torrent) {
    const candidates = titleCandidates(torrent.name, torrent.desc);
    const input = h('input', { type: 'text', value: candidates[1] || candidates[0] || '' });
    const results = h('div', { className: 'mp-results' });

    const search = async () => {
        const query = input.value.trim();
        if (!query) return;
        results.replaceChildren(h('p', { className: 'mp-muted' }, '搜索中...'));
        const items = await mp.search(query);
        results.replaceChildren(...(items.length ? items.slice(0, 10).map((item) => {
            const id = item.tmdb_id || item.id;
            return h('div', {
                className: 'mp-result',
                onclick: async () => {
                    el.remove();
                    render(slot, '正在精确匹配...');
                    const media = await mp.detail(id, mediaType(item));
                    if (media) showResult(slot, torrent, media);
                    else render(slot, tag('后端拉取信息失败，该条目可能未收录', '#dc3545'));
                },
            }, h('b', {}, `[${mediaType(item)}] ${item.title || item.name || ''}`), h('div', { className: 'mp-muted' }, `年份: ${item.year || 'N/A'} | TMDB ID: ${id || ''}`));
        }) : [h('p', {}, '未找到相关结果')]));
    };

    const el = modal('手动关联识别',
        h('label', { className: 'mp-field' }, '输入影视名称搜索', input),
        h('button', { className: 'mp-primary', type: 'button', onclick: search }, '搜索'),
        results);
}

async function process(slot, torrent) {
    render(slot, '正在连接 MoviePilot 接口...');
    log('种子信息', torrent);
    const result = await autoRecognize(slot, torrent);
    if (!slot.isConnected) return; // 单页站点已跳转到其他页面
    if (result) showResult(slot, torrent, result.media, result.meta);
    else render(slot, h('button', { className: 'mp-btn', type: 'button', style: 'background:#ff6b6b', onclick: () => showManualSearch(slot, torrent) }, '识别失败（调试日志见 F12），点此手动识别'));
}

// ---------- 调度 ----------
let currentPage = location.pathname + location.search;
let configPrompted = false;

function tick() {
    const page = location.pathname + location.search;
    if (page !== currentPage) {
        currentPage = page;
        $$('.mp-mounted, .mp-modal').forEach((el) => el.remove());
    }
    if ($('.mp-mounted')) return true;

    const site = SITES.find((candidate) => candidate.match());
    if (!site) return false;
    try {
        const torrent = site.extract();
        if (!torrent?.name) return false;
        if (!config.url || !config.key) {
            if (!configPrompted) showConfig();
            configPrompted = true;
            return true;
        }
        process(site.mount(torrent), torrent);
        return true;
    } catch (error) {
        console.error(`[MoviePilot] ${site.name} 适配出错:`, error);
        return false;
    }
}

// 单页站点持续监听路由变化；普通页面成功插入或重试 10 次后停止，不再空转
function start() {
    const isSpa = SITES.some((site) => site.spa?.());
    let attempts = 0;
    if (tick() && !isSpa) return;
    const timer = setInterval(() => {
        const done = tick();
        if (!isSpa && (done || ++attempts >= 10)) clearInterval(timer);
    }, 1000);
}

start();
