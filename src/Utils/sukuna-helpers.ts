import { proto } from '../../WAProto/index.js'
import { buildRichHtmlMessage, type RichHtmlResponseOptions } from './rich-response.js'
import { buildNativeFlowMessage } from './interactive-builders.js'

/* ───────────── أزرار Native Flow جاهزة ───────────── */

export type SukunaButton = { name: string; buttonParamsJson: string }

const btn = (name: string, params: Record<string, unknown>): SukunaButton => ({
    name,
    buttonParamsJson: JSON.stringify(params)
})

/** زر رد سريع */
export const replyButton = (displayText: string, id: string) =>
    btn('quick_reply', { display_text: displayText, id })

/** زر يفتح رابط */
export const urlButton = (displayText: string, url: string) =>
    btn('cta_url', { display_text: displayText, url, merchant_url: url })

/** زر نسخ نص */
export const copyButton = (displayText: string, copyCode: string) =>
    btn('cta_copy', { display_text: displayText, copy_code: copyCode })

/** زر اتصال برقم */
export const callButton = (displayText: string, phoneNumber: string) =>
    btn('cta_call', { display_text: displayText, phone_number: phoneNumber })

/** زر قائمة منسدلة (single_select) */
export const listButton = (
    title: string,
    sections: { title: string; rows: { title: string; id: string; description?: string; header?: string }[] }[]
) => btn('single_select', { title, sections })

/* ───────────── بناء وإرسال رسائل جاهزة ───────────── */

export type SukunaCardOptions = {
    title?: string
    body: string
    footer?: string
    buttons: SukunaButton[]
}

/** يبني رسالة تفاعلية (viewOnce) جاهزة للإرسال بـ relayMessage */
export function buildInteractivePayload(options: SukunaCardOptions): proto.IMessage {
    const interactiveMessage = buildNativeFlowMessage(options)
    return {
        viewOnceMessage: {
            message: {
                messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                interactiveMessage
            }
        }
    } as proto.IMessage
}

type RelaySock = {
    relayMessage: (jid: string, message: proto.IMessage, opts: { messageId?: string }) => Promise<string>
    generateMessageTag?: () => string
}

/** إرسال كارت أزرار بسطر واحد: sendButtons(sock, jid, { body, buttons }) */
export async function sendButtons(sock: RelaySock, jid: string, options: SukunaCardOptions) {
    return sock.relayMessage(jid, buildInteractivePayload(options), { messageId: sock.generateMessageTag?.() })
}

/** إرسال لعبة/صفحة HTML داخل المحادثة (Rich HTML) بسطر واحد */
export async function sendRichHtml(sock: RelaySock, jid: string, options: RichHtmlResponseOptions) {
    return sock.relayMessage(jid, buildRichHtmlMessage(options), { messageId: sock.generateMessageTag?.() })
}

/* ───────────── JID وأرقام ───────────── */

/** يرجّع الرقم فقط من أي jid (حتى لو فيه :device) */
export const jidToNumber = (jid?: string | null) =>
    String(jid ?? '').split('@')[0]!.split(':')[0]!.replace(/\D/g, '')

/** يحوّل رقم لـ jid شخصي */
export const numberToJid = (num: string | number) => `${String(num).replace(/\D/g, '')}@s.whatsapp.net`

export const isGroupJid = (jid?: string | null) => !!jid && jid.endsWith('@g.us')
export const isNewsletterJid = (jid?: string | null) => !!jid && jid.endsWith('@newsletter')
export const isLidJid = (jid?: string | null) => !!jid && jid.endsWith('@lid')

/** يطلّع كل المنشنات (@رقم) من نص كـ jids */
export function parseMentions(text: string): string[] {
    const out = new Set<string>()
    for (const m of String(text ?? '').matchAll(/@(\d{5,16})/g)) out.add(numberToJid(m[1]!))
    return [...out]
}

/* ───────────── نصوص وتنسيق ───────────── */

/** يقسّم نص طويل لأجزاء (بدون قطع وسط سطر قدر الإمكان) */
export function chunkText(text: string, size = 3500): string[] {
    const parts: string[] = []
    let cur = ''
    for (const line of String(text ?? '').split('\n')) {
        if ((cur + '\n' + line).length > size && cur) { parts.push(cur); cur = line }
        else cur = cur ? cur + '\n' + line : line
        while (cur.length > size) { parts.push(cur.slice(0, size)); cur = cur.slice(size) }
    }
    if (cur) parts.push(cur)
    return parts
}

export function formatBytes(bytes: number, digits = 1): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
    const u = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.min(u.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
    return `${(bytes / 1024 ** i).toFixed(i ? digits : 0)} ${u[i]}`
}

/** 3725 → "1س 2د 5ث" */
export function formatDuration(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds))
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
    return [d && `${d}ي`, h && `${h}س`, m && `${m}د`, `${s % 60}ث`].filter(Boolean).join(' ')
}

/* ───────────── تحكّم وتوقيت ───────────── */

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** يرفض لو الوعد خد أكتر من ms */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
    let t: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms) })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(t)) as Promise<T>
}

/** إعادة محاولة بتأخير متزايد */
export async function retry<T>(fn: (attempt: number) => Promise<T>, tries = 3, baseMs = 500): Promise<T> {
    let last: unknown
    for (let i = 1; i <= tries; i++) {
        try { return await fn(i) } catch (e) { last = e; if (i < tries) await sleep(baseMs * 2 ** (i - 1)) }
    }
    throw last
}

/** يرسل لعدة محادثات بفاصل (حماية من الضغط). بيرجّع نتيجة كل واحدة */
export async function sendToMany<T>(
    jids: string[],
    send: (jid: string) => Promise<T>,
    delayMs = 3000
): Promise<{ jid: string; ok: boolean; error?: string }[]> {
    const res: { jid: string; ok: boolean; error?: string }[] = []
    for (const jid of jids) {
        try { await send(jid); res.push({ jid, ok: true }) }
        catch (e) { res.push({ jid, ok: false, error: e instanceof Error ? e.message : String(e) }) }
        await sleep(delayMs)
    }
    return res
}

/** كاش بسيط بمدة صلاحية (بدون مكتبات) */
export class TTLCache<V> {
    private m = new Map<string, { v: V; exp: number }>()
    constructor(private ttlMs = 60_000, private max = 500) {}
    get(k: string): V | undefined {
        const e = this.m.get(k)
        if (!e) return undefined
        if (e.exp < Date.now()) { this.m.delete(k); return undefined }
        return e.v
    }
    set(k: string, v: V) {
        if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value as string)
        this.m.set(k, { v, exp: Date.now() + this.ttlMs })
    }
    delete(k: string) { this.m.delete(k) }
    clear() { this.m.clear() }
}

/* ───────────── تحويل LID / يوزر مجموعة ← رقم هاتف ───────────── */

export type ResolveNumberOptions = {
    /** لو المعرّف جاي من رسالة جروب، مرّر jid الجروب عشان نبحث في قائمة الأعضاء (بتحتوي الرقم غالباً) */
    groupJid?: string
    /** m.key من الرسالة: بنقرأ منه participantAlt / remoteJidAlt لو واتساب باعتهم */
    key?: { participant?: string | null; participantAlt?: string | null; remoteJid?: string | null; remoteJidAlt?: string | null } | null
    /** السماح بسؤال سيرفرات واتساب (USync) لو الربط مش متخزّن. الافتراضي true */
    allowNetwork?: boolean
}

export type ResolvedNumber = {
    /** الرقم بصيغة أرقام فقط (بدون +) أو null لو مش معروف */
    number: string | null
    /** jid الشخصي @s.whatsapp.net أو null */
    jid: string | null
    /** المعرّف الأصلي (lid) لو اتدخل lid */
    lid: string | null
    /** المصدر اللي اتعرف منه الرقم */
    source: 'pn' | 'key' | 'group' | 'mapping' | 'none'
}

type ResolveSock = {
    signalRepository?: { lidMapping?: { getPNForLID?: (lid: string) => Promise<string | null> } }
    groupMetadata?: (jid: string) => Promise<{ participants?: Array<Record<string, any>> }>
}

const stripDevice = (jid: string) => jid.replace(/:\d+(?=@)/, '')

/**
 * يجيب رقم الهاتف الحقيقي من معرّف المستخدم:
 *  - لو @s.whatsapp.net ← بيرجّع الرقم علطول
 *  - لو @lid ← بيدوّر في: مفاتيح الرسالة، أعضاء الجروب، جدول ربط LID↔PN (محلي ثم سيرفر واتساب)
 *  ملاحظة: يوزرنيم واتساب (@username) متقفّل عمداً ومفيش طريقة رسمية يتحوّل لرقم؛ بنرجّع number:null.
 */
export async function resolveNumber(sock: ResolveSock, id: string | null | undefined, opts: ResolveNumberOptions = {}): Promise<ResolvedNumber> {
    const none: ResolvedNumber = { number: null, jid: null, lid: null, source: 'none' }
    if (!id) return none
    const raw = stripDevice(String(id).trim())
    const pn = (jid: string, source: ResolvedNumber['source'], lid: string | null): ResolvedNumber => {
        const number = jidToNumber(jid)
        return number ? { number, jid: numberToJid(number), lid, source } : { ...none, lid }
    }
    if (raw.endsWith('@s.whatsapp.net') || raw.endsWith('@c.us')) return pn(raw, 'pn', null)
    if (!isLidJid(raw)) return /^\+?\d{6,16}$/.test(raw) ? pn(raw, 'pn', null) : none

    // 1) مفاتيح الرسالة
    const k = opts.key
    for (const alt of [k?.participantAlt, k?.remoteJidAlt]) {
        if (alt && alt.endsWith('@s.whatsapp.net')) {
            const main = stripDevice(String(k?.participant || k?.remoteJid || ''))
            if (!main || main === raw) return pn(alt, 'key', raw)
        }
    }
    // 2) أعضاء الجروب
    if (opts.groupJid && sock.groupMetadata) {
        try {
            const md = await sock.groupMetadata(opts.groupJid)
            const p = md.participants?.find(x => stripDevice(String(x.id || x.lid || '')) === raw || stripDevice(String(x.lid || '')) === raw)
            const cand = String(p?.phoneNumber || (p?.jid && !isLidJid(p.jid) ? p.jid : '') || (p?.id && !isLidJid(p.id) ? p.id : '') || '')
            if (cand) return pn(cand, 'group', raw)
        } catch { /* نكمّل للمصدر الجاي */ }
    }
    // 3) جدول الربط (محلي، ولو مش موجود بيسأل واتساب)
    const map = sock.signalRepository?.lidMapping
    if (map?.getPNForLID && opts.allowNetwork !== false) {
        try {
            const found = await map.getPNForLID(raw)
            if (found) return pn(found, 'mapping', raw)
        } catch { /* مفيش ربط */ }
    }
    return { ...none, lid: raw }
}

/** نسخة سريعة: ترجّع الرقم (أرقام فقط) أو null */
export const getUserNumber = async (sock: ResolveSock, id: string | null | undefined, opts?: ResolveNumberOptions) =>
    (await resolveNumber(sock, id, opts)).number
