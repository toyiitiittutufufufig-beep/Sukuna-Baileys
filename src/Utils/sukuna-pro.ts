/* eslint-disable @typescript-eslint/no-explicit-any */
// 🍷 Sukuna Pro — دوال متقدمة فوق Baileys (محادثات تفاعلية، تعديل رسائل حية، طابور إرسال ذكي ...)
import { extractInteractiveResponse } from './interactive-responses.js'
import { buildNativeFlowMessage } from './interactive-builders.js'
import { jidToNumber, sleep, type SukunaButton } from './sukuna-helpers.js'

/** الحد الأدنى من السوكيت اللي بنحتاجه (متوافق مع makeWASocket) */
export type ProSock = {
    ev: { on: (event: any, fn: (...a: any[]) => void) => void; off: (event: any, fn: (...a: any[]) => void) => void }
    sendMessage: (jid: string, content: any, opts?: any) => Promise<any>
    sendPresenceUpdate?: (type: any, jid?: string) => Promise<void>
    relayMessage?: (jid: string, msg: any, opts: any) => Promise<any>
}

const textOf = (msg: any): string =>
    msg?.message?.conversation ||
    msg?.message?.extendedTextMessage?.text ||
    msg?.message?.imageMessage?.caption ||
    msg?.message?.videoMessage?.caption ||
    ''

const senderOf = (msg: any): string => msg?.key?.participant || msg?.key?.remoteJid || ''

/* ═════════════ 1) انتظار رد المستخدم (محادثة تفاعلية) ═════════════ */

export type WaitOptions = {
    /** مين لازم يرد (jid). لو فاضي: أي حد في المحادثة */
    from?: string
    timeoutMs?: number
    /** فلتر إضافي على الرسالة */
    filter?: (msg: any, text: string) => boolean
}

/**
 * يستنى الرسالة النصية الجاية من شخص في محادثة. بيرجّع { text, msg } أو null لو انتهى الوقت.
 * مثال:  await sock.sendMessage(jid,{text:'اسمك؟'});  const r = await waitForReply(sock, jid, { from: sender })
 */
export function waitForReply(sock: ProSock, chat: string, opts: WaitOptions = {}): Promise<{ text: string; msg: any } | null> {
    return new Promise(resolve => {
        const timer = setTimeout(() => { sock.ev.off('messages.upsert', handler); resolve(null) }, opts.timeoutMs ?? 60_000)
        const handler = ({ messages }: { messages: any[] }) => {
            for (const msg of messages ?? []) {
                if (msg?.key?.fromMe || msg?.key?.remoteJid !== chat) continue
                if (opts.from && jidToNumber(senderOf(msg)) !== jidToNumber(opts.from)) continue
                const text = textOf(msg)
                if (!text) continue
                if (opts.filter && !opts.filter(msg, text)) continue
                clearTimeout(timer); sock.ev.off('messages.upsert', handler)
                return resolve({ text, msg })
            }
        }
        sock.ev.on('messages.upsert', handler)
    })
}

/** يسأل سؤال ويستنى الإجابة بخيارات (مثلاً ['نعم','لا']) — بيرجّع الاختيار أو null */
export async function ask(sock: ProSock, chat: string, question: string, choices?: string[], opts: WaitOptions = {}) {
    await sock.sendMessage(chat, { text: choices?.length ? `${question}\n${choices.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : question })
    const r = await waitForReply(sock, chat, {
        ...opts,
        filter: (m, t) => (choices?.length ? choices.some((c, i) => t.trim() === c || t.trim() === String(i + 1)) : true) && (opts.filter?.(m, t) ?? true)
    })
    if (!r) return null
    if (!choices?.length) return r.text
    const t = r.text.trim()
    return choices.find((c, i) => t === c || t === String(i + 1)) ?? null
}

/** يستنى ضغطة زر/قائمة محددة (بالـ id). بيرجّع الـ id اللي اتضغط أو null */
export function waitForButton(sock: ProSock, chat: string, ids: string[], opts: WaitOptions = {}): Promise<{ id: string; msg: any } | null> {
    return new Promise(resolve => {
        const timer = setTimeout(() => { sock.ev.off('messages.upsert', handler); resolve(null) }, opts.timeoutMs ?? 60_000)
        const handler = ({ messages }: { messages: any[] }) => {
            for (const msg of messages ?? []) {
                if (msg?.key?.fromMe || msg?.key?.remoteJid !== chat) continue
                if (opts.from && jidToNumber(senderOf(msg)) !== jidToNumber(opts.from)) continue
                const r = extractInteractiveResponse(msg.message ?? {})
                let id = r?.id ?? ''
                if (!id && r?.params && typeof r.params === 'object') id = String((r.params as any).id ?? '')
                if (id && ids.includes(id)) { clearTimeout(timer); sock.ev.off('messages.upsert', handler); return resolve({ id, msg }) }
            }
        }
        sock.ev.on('messages.upsert', handler)
    })
}

/* ═════════════ 2) رسائل حية: شريط تقدّم يتعدّل ═════════════ */

export const progressBar = (pct: number, width = 12, fill = '🟥', empty = '⬛') => {
    const p = Math.max(0, Math.min(100, pct))
    const n = Math.round((p / 100) * width)
    return `${fill.repeat(n)}${empty.repeat(width - n)} ${Math.round(p)}%`
}

/**
 * رسالة واحدة بتتعدّل لوحدها (مش رسايل كتير). تحديثات متباعدة 700ms كحد أدنى عشان ما يحصلش ضغط.
 *   const p = await liveMessage(sock, jid, '⏳ جاري...');  await p.progress(40,'تحميل');  await p.done('✅ خلص')
 */
export async function liveMessage(sock: ProSock, chat: string, initial: string, quoted?: any) {
    const sent = await sock.sendMessage(chat, { text: initial }, quoted ? { quoted } : undefined)
    const key = sent?.key
    let last = 0
    const edit = async (text: string, force = false) => {
        const wait = 700 - (Date.now() - last)
        if (wait > 0 && !force) return false
        if (wait > 0) await sleep(wait)
        last = Date.now()
        await sock.sendMessage(chat, { text, edit: key })
        return true
    }
    return {
        key,
        edit,
        progress: (pct: number, label = '') => edit(`${label ? label + '\n' : ''}${progressBar(pct)}`),
        done: (text: string) => edit(text, true),
        remove: () => sock.sendMessage(chat, { delete: key })
    }
}

/* ═════════════ 3) إرسال "بشري" (typing + تأخير حسب طول النص) ═════════════ */

/** يظهر "يكتب..." لمدة تناسب طول النص قبل الإرسال — بيقلّل شكل البوت الآلي */
export async function sendHuman(sock: ProSock, chat: string, content: any, opts: { cps?: number; maxMs?: number; quoted?: any } = {}) {
    const len = String(content?.text ?? content?.caption ?? '').length
    const ms = Math.min(opts.maxMs ?? 4000, Math.max(400, (len / (opts.cps ?? 22)) * 1000))
    try { await sock.sendPresenceUpdate?.('composing', chat) } catch { /* */ }
    await sleep(ms)
    try { await sock.sendPresenceUpdate?.('paused', chat) } catch { /* */ }
    return sock.sendMessage(chat, content, opts.quoted ? { quoted: opts.quoted } : undefined)
}

/* ═════════════ 4) طابور إرسال ذكي (Token Bucket) ═════════════ */

/**
 * طابور بيرتّب الإرسال: حد أقصى للثانية على كل البوت + فاصل أدنى لكل محادثة، من غير ما تضيع رسالة.
 *   const q = createSendQueue(sock, { perSecond: 4, perChatMs: 1200 });  q.send(jid, {text:'..'})
 */
export function createSendQueue(sock: ProSock, opts: { perSecond?: number; perChatMs?: number } = {}) {
    const gap = 1000 / (opts.perSecond ?? 5)
    const perChat = opts.perChatMs ?? 1000
    const lastChat = new Map<string, number>()
    const jobs: { jid: string; content: any; o?: any; res: (v: any) => void; rej: (e: unknown) => void }[] = []
    let running = false
    let lastAny = 0
    const pump = async () => {
        if (running) return
        running = true
        while (jobs.length) {
            // أول شغلانة محادثتها جاهزة، وإلا نستنى أقرب واحدة
            const now = Date.now()
            let idx = jobs.findIndex(j => now - (lastChat.get(j.jid) ?? 0) >= perChat)
            if (idx < 0) { await sleep(60); continue }
            const w = gap - (now - lastAny)
            if (w > 0) await sleep(w)
            const j = jobs.splice(idx, 1)[0]!
            lastAny = Date.now(); lastChat.set(j.jid, lastAny)
            try { j.res(await sock.sendMessage(j.jid, j.content, j.o)) } catch (e) { j.rej(e) }
        }
        running = false
    }
    return {
        send: (jid: string, content: any, o?: any) => new Promise<any>((res, rej) => { jobs.push({ jid, content, o, res, rej }); void pump() }),
        get pending() { return jobs.length },
        clear: () => { for (const j of jobs.splice(0)) j.rej(new Error('queue cleared')) }
    }
}

/* ═════════════ 5) صفحات بأزرار (Pager) ═════════════ */

/**
 * يعرض قائمة طويلة صفحة صفحة بأزرار (التالي / السابق / إغلاق) ويستنى الضغط.
 * مثال: await paginate(sock, jid, pages, { from: sender })   حيث pages = ['صفحة 1', 'صفحة 2', ...]
 */
export async function paginate(sock: ProSock, chat: string, pages: string[], opts: WaitOptions & { footer?: string; title?: string } = {}) {
    if (!pages.length) return
    let i = 0
    const stamp = Date.now().toString(36)
    const ids = { prev: `pg_prev_${stamp}`, next: `pg_next_${stamp}`, stop: `pg_stop_${stamp}` }
    const mk = (): SukunaButton[] => {
        const b: SukunaButton[] = []
        if (i > 0) b.push({ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '⬅️ السابق', id: ids.prev }) })
        if (i < pages.length - 1) b.push({ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'التالي ➡️', id: ids.next }) })
        b.push({ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '✖️ إغلاق', id: ids.stop }) })
        return b
    }
    const send = () => {
        const msg = buildNativeFlowMessage({ title: opts.title, body: `${pages[i]}\n\n📄 ${i + 1}/${pages.length}`, footer: opts.footer, buttons: mk() })
        return sock.relayMessage?.(chat, { viewOnceMessage: { message: { messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 }, interactiveMessage: msg } } }, {})
    }
    await send()
    for (;;) {
        const r = await waitForButton(sock, chat, Object.values(ids), { from: opts.from, timeoutMs: opts.timeoutMs ?? 120_000 })
        if (!r || r.id === ids.stop) return
        i += r.id === ids.next ? 1 : -1
        i = Math.max(0, Math.min(pages.length - 1, i))
        await send()
    }
}

/* ═════════════ 6) كولداون + منع التكرار + جدولة ═════════════ */

/** كولداون لكل (مستخدم/أمر): cd.check('user:cmd') بيرجّع الثواني المتبقية (0 = مسموح) ويبدأ العدّاد */
export function createCooldown(defaultMs = 5000) {
    const m = new Map<string, number>()
    return {
        check(key: string, ms = defaultMs): number {
            const now = Date.now()
            const until = m.get(key) ?? 0
            if (until > now) return Math.ceil((until - now) / 1000)
            m.set(key, now + ms)
            if (m.size > 5000) for (const [k, v] of m) if (v < now) m.delete(k)
            return 0
        },
        reset: (key: string) => void m.delete(key)
    }
}

/** منع معالجة نفس الرسالة مرتين (مفيد مع إعادة الاتصال): seen(id) → true لو اتشافت قبل كده */
export function createDeduper(max = 2000) {
    const s = new Set<string>()
    return (id?: string | null): boolean => {
        if (!id) return false
        if (s.has(id)) return true
        s.add(id)
        if (s.size > max) s.delete(s.values().next().value as string)
        return false
    }
}

/** تشغيل دالة في وقت محدد (Date أو ms من دلوقتي). بيرجّع دالة إلغاء */
export function scheduleAt(when: Date | number, fn: () => void | Promise<void>): () => void {
    const ms = Math.max(0, (when instanceof Date ? when.getTime() : Date.now() + when) - Date.now())
    const t = setTimeout(() => { void Promise.resolve(fn()).catch(() => undefined) }, Math.min(ms, 2 ** 31 - 1))
    return () => clearTimeout(t)
}

/* ═════════════ 7) راوتر أوامر خفيف ═════════════ */

export type CommandCtx = { sock: ProSock; msg: any; chat: string; sender: string; text: string; args: string[]; command: string; prefix: string }

/**
 * راوتر أوامر بدون مكتبات: بيفصل البريفكس والأمر والـ args ويشغّل الدالة المناسبة.
 *   const r = createRouter({ prefixes: ['.', '!'] });  r.on(['ping','بنج'], ctx => ...);  sock.ev.on('messages.upsert', ({messages}) => messages.forEach(m => r.handle(sock, m)))
 */
export function createRouter(opts: { prefixes?: string[]; onError?: (e: unknown, ctx: CommandCtx) => void } = {}) {
    const prefixes = opts.prefixes ?? ['.']
    const table = new Map<string, (ctx: CommandCtx) => unknown>()
    return {
        on(names: string | string[], fn: (ctx: CommandCtx) => unknown) { for (const n of [names].flat()) table.set(n.toLowerCase(), fn); return this },
        async handle(sock: ProSock, msg: any): Promise<boolean> {
            if (msg?.key?.fromMe) return false
            const text = textOf(msg).trim()
            const prefix = prefixes.find(p => text.startsWith(p))
            if (!prefix) return false
            const [command = '', ...args] = text.slice(prefix.length).trim().split(/\s+/)
            const fn = table.get(command.toLowerCase())
            if (!fn) return false
            const ctx: CommandCtx = { sock, msg, chat: msg.key.remoteJid, sender: senderOf(msg), text: args.join(' '), args, command: command.toLowerCase(), prefix }
            try { await fn(ctx) } catch (e) { opts.onError?.(e, ctx) }
            return true
        }
    }
}

/* ═════════════ 8) زخرفة نصوص ═════════════ */

const mapRange = (s: string, up: number, low: number, dig?: number) =>
    [...s].map(c => {
        const x = c.codePointAt(0)!
        if (x >= 65 && x <= 90) return String.fromCodePoint(up + x - 65)
        if (x >= 97 && x <= 122) return String.fromCodePoint(low + x - 97)
        if (dig && x >= 48 && x <= 57) return String.fromCodePoint(dig + x - 48)
        return c
    }).join('')

export const fancy = {
    bold: (s: string) => mapRange(s, 0x1d400, 0x1d41a, 0x1d7ce),
    italic: (s: string) => mapRange(s, 0x1d434, 0x1d44e),
    boldItalic: (s: string) => mapRange(s, 0x1d468, 0x1d482),
    script: (s: string) => mapRange(s, 0x1d4d0, 0x1d4ea),
    mono: (s: string) => mapRange(s, 0x1d670, 0x1d68a, 0x1d7f6),
    double: (s: string) => mapRange(s, 0x1d538, 0x1d552, 0x1d7d8),
    circled: (s: string) => mapRange(s, 0x24b6, 0x24d0)
}

/** صندوق نص بإطار:  ╭━━ عنوان ━━╮ ... */
export function boxText(title: string, lines: string[], edge = '🍷') {
    return [`${edge}━─────━ ${title} ━─────━${edge}`, ...lines.map(l => `┃ ${l}`), `${edge}━═▓▒░░▒▓═━${edge}`].join('\n')
}

/* ═════════════ 9) إعادة اتصال بتأخير ذكي ═════════════ */

/** تأخير إعادة الاتصال (exponential backoff + jitter) — حاجة زي: await sleep(reconnectDelay(attempt)) */
export const reconnectDelay = (attempt: number, baseMs = 1000, maxMs = 60_000) =>
    Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 10)) * (0.75 + Math.random() * 0.5)
