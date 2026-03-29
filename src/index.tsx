import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import type { Bindings, Post, Comment, User, PrayerRequest, PrayerResponse } from './types'

const app = new Hono<{ Bindings: Bindings }>()

/** XSS 방지용 텍스트 이스케이프 */
function sanitizeText(s: string | null | undefined): string {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

/** R2 키에 쓸 파일명만 허용 (경로 조각·.. 제거) */
function sanitizeR2Filename(raw: string): string | null {
  const base = String(raw || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop() || ''
  const s = base.replace(/\.\./g, '').trim()
  if (!s || s.length > 220) return null
  return s
}

/** Workers 런타임에서 multipart 항목이 File이 아닌 Blob이거나 instanceof File이 실패하는 경우가 있어 Blob 기준으로 본다 */
function isUploadBlobPart(v: unknown): v is Blob {
  return (
    v != null &&
    typeof v === 'object' &&
    typeof (v as Blob).arrayBuffer === 'function' &&
    typeof (v as Blob).size === 'number'
  )
}

function mimeOrNameSuggestsImage(part: Blob): boolean {
  const t = (part.type || '').toLowerCase()
  if (t.startsWith('image/')) return true
  const n = 'name' in part && typeof (part as { name?: unknown }).name === 'string' ? String((part as File).name) : ''
  if (n && /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|svg)$/i.test(n)) return true
  return t === '' || t === 'application/octet-stream'
}

function uploadImageFilename(part: Blob, userId: string): string {
  const n = 'name' in part && typeof (part as { name?: unknown }).name === 'string' ? String((part as File).name || '') : ''
  const fromDot = n.includes('.') ? n.split('.').pop() || '' : ''
  if (fromDot && /^[a-z0-9]{2,8}$/i.test(fromDot)) return `${userId}-${Date.now()}.${fromDot}`
  const ct = (part.type || '').toLowerCase()
  if (ct.includes('png')) return `${userId}-${Date.now()}.png`
  if (ct.includes('webp')) return `${userId}-${Date.now()}.webp`
  if (ct.includes('gif')) return `${userId}-${Date.now()}.gif`
  if (ct.includes('svg')) return `${userId}-${Date.now()}.svg`
  if (ct.includes('heic')) return `${userId}-${Date.now()}.heic`
  if (ct.includes('heif')) return `${userId}-${Date.now()}.heif`
  return `${userId}-${Date.now()}.jpg`
}

/** R2 미바인딩·get 실패 시 예외 대신 404 (브라우저 콘솔 500 폭주 방지) */
function guessContentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
    heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml'
  }
  return map[ext] || 'image/jpeg'
}

async function serveR2Object(c: { env: Bindings; notFound: () => Response }, objectKey: string): Promise<Response> {
  const r2 = (c.env as unknown as { R2?: R2Bucket }).R2
  if (!r2) {
    console.warn('[R2] binding missing for', objectKey)
    return c.notFound()
  }
  try {
    const object = await r2.get(objectKey)
    if (!object) return c.notFound()
    const headers = new Headers()
    try {
      object.writeHttpMetadata(headers)
    } catch {
      // Miniflare 로컬에서 writeHttpMetadata 직렬화 오류 시 확장자로 추론
      headers.set('Content-Type', guessContentType(objectKey))
    }
    headers.set('Cache-Control', 'public, max-age=31536000')
    return new Response(object.body, { headers })
  } catch (err) {
    console.error('[R2] get failed', objectKey, err)
    return c.notFound()
  }
}

function blobDataToArrayBuffer(data: unknown): ArrayBuffer | null {
  if (data == null) return null
  if (data instanceof ArrayBuffer) return data
  if (data instanceof Uint8Array) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  }
  return null
}

async function readMediaFallbackRow(
  DB: D1Database,
  storageKey: string
): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  try {
    const row = (await DB.prepare(
      'SELECT blob_data, content_type FROM media_fallback WHERE storage_key = ?'
    )
      .bind(storageKey)
      .first()) as { blob_data?: unknown; content_type?: string } | null
    const body = row?.blob_data != null ? blobDataToArrayBuffer(row.blob_data) : null
    if (!body) return null
    return { body, contentType: row.content_type || 'application/octet-stream' }
  } catch (e) {
    console.warn('[media_fallback] read error', storageKey, e)
    return null
  }
}

/** R2 우선, 없거나 미스 시 D1 media_fallback (로컬 Vite·R2 미바인딩 대비) */
async function serveR2OrMediaFallback(
  c: { env: Bindings; notFound: () => Response },
  objectKey: string
): Promise<Response> {
  const r2 = (c.env as unknown as { R2?: R2Bucket }).R2
  if (r2) {
    try {
      const object = await r2.get(objectKey)
      if (object) {
        const headers = new Headers()
        try {
          object.writeHttpMetadata(headers)
        } catch {
          // Miniflare 로컬에서 writeHttpMetadata 직렬화 오류 시 확장자로 추론
          headers.set('Content-Type', guessContentType(objectKey))
        }
        headers.set('Cache-Control', 'public, max-age=31536000')
        return new Response(object.body, { headers })
      }
    } catch (err) {
      console.error('[R2] get failed', objectKey, err)
    }
  }
  const { DB } = c.env
  const fb = await readMediaFallbackRow(DB, objectKey)
  if (fb) {
    return new Response(fb.body, {
      headers: {
        'Content-Type': fb.contentType,
        'Cache-Control': 'public, max-age=3600'
      }
    })
  }
  return c.notFound()
}

/** 레거시 URL·키 불일치 시 여러 키를 순서대로 시도 (R2 + D1) */
async function serveFirstR2OrMediaFallback(
  c: { env: Bindings; notFound: () => Response },
  keys: string[]
): Promise<Response> {
  for (const objectKey of keys) {
    const res = await serveR2OrMediaFallback(c, objectKey)
    if (res.status !== 404) return res
  }
  return c.notFound()
}

/** 로컬 Miniflare D1에서 동시 요청 시 SQLITE_BUSY 발생 시 재시도 */
async function retryD1<T>(fn: () => Promise<T>, maxRetries = 5, delayMs = 60): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      const msg = String((e as Error)?.message || '')
      const isTransient =
        msg.includes('SQLITE_BUSY') ||
        msg.includes('database is locked') ||
        msg.includes('internal error')
      if (isTransient && i < maxRetries - 1) {
        await new Promise<void>(r => setTimeout(r, delayMs * (i + 1)))
        continue
      }
      throw e
    }
  }
  throw lastError
}

async function putR2OrMediaFallback(
  c: { env: Bindings },
  DB: D1Database,
  storageKey: string,
  arrayBuffer: ArrayBuffer,
  contentType: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const r2 = (c.env as unknown as { R2?: R2Bucket }).R2
  if (r2) {
    try {
      await r2.put(storageKey, arrayBuffer, {
        httpMetadata: { contentType }
      })
      return { ok: true }
    } catch (e) {
      console.error('[R2] put failed, falling back to D1', storageKey, e)
    }
  }
  try {
    await retryD1(() =>
      DB.prepare(
        'INSERT OR REPLACE INTO media_fallback (storage_key, blob_data, content_type) VALUES (?, ?, ?)'
      )
        .bind(storageKey, arrayBuffer, contentType)
        .run()
    )
    return { ok: true }
  } catch (e) {
    console.error('[media_fallback] INSERT failed', e)
    return {
      ok: false,
      message:
        '이미지 저장에 실패했습니다. 로컬이면 `npm run db:migrate:local` 로 DB를 최신으로 맞춘 뒤 다시 시도해 주세요. (또는 R2 바인딩을 확인하세요.)'
    }
  }
}

function bufToBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBuf(b64: string) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

async function derivePasswordHash(password: string, saltB64: string) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits'
  ])
  const salt = base64ToBuf(saltB64)
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: 150_000
    },
    keyMaterial,
    256
  )
  return bufToBase64(bits)
}

function randomSaltB64(bytes = 16) {
  const salt = new Uint8Array(bytes)
  crypto.getRandomValues(salt)
  return bufToBase64(salt.buffer)
}

async function verifyUserPassword(user: Record<string, unknown>, password: string): Promise<boolean> {
  if (!password || typeof password !== 'string') return false
  if (!user.password_salt) {
    if (user.plain_password && String(user.plain_password) === String(password)) return true
    return false
  }
  if (!user.password_hash) return false
  const derived = await derivePasswordHash(String(password), String(user.password_salt))
  return derived === String(user.password_hash)
}

/** 회원가입 폼과 동일한 비밀번호 규칙 */
function validateNewPasswordRules(pw: string): string | null {
  const p = String(pw || '')
  if (p.length < 8) return '비밀번호는 8자 이상이어야 합니다.'
  const lower = (p.match(/[a-z]/g) || []).length
  const digit = (p.match(/[0-9]/g) || []).length
  if (lower < 3) return '비밀번호는 영문 소문자 3개 이상 포함해야 합니다.'
  if (digit < 3) return '비밀번호는 숫자 3개 이상 포함해야 합니다.'
  if (/[A-Z]/.test(p) || /[^a-z0-9]/.test(p)) return '비밀번호는 대문자·특수문자를 사용할 수 없습니다.'
  return null
}

// Enable CORS for API routes
app.use('/api/*', cors())

// Serve static files
app.use('/static/*', serveStatic({ root: './public' }))

// =====================
// API Routes - Users
// =====================

// Login endpoint
app.post('/api/login', async (c) => {
  const { DB } = c.env
  let body: Record<string, unknown> = {}
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: '요청 형식이 올바르지 않습니다.' }, 400)
  }
  const email = body.email
  const password = body.password

  if (!email || typeof email !== 'string' || !email.trim()) {
    return c.json({ error: '이메일을 입력해주세요.' }, 400)
  }

  // Normalize email (trim and lowercase)
  const normalizedEmail = email.trim().toLowerCase()
  
  // Regular login for other users
  const user = await DB.prepare('SELECT * FROM users WHERE LOWER(email) = ?')
    .bind(normalizedEmail)
    .first()
  
  if (!user) {
    return c.json({ error: '등록되지 않은 이메일입니다. 회원가입을 진행해주세요.' }, 404)
  }

  if (!password) {
    return c.json({ error: '비밀번호를 입력해주세요.' }, 400)
  }

  // Legacy/local compatibility: if a plain_password exists, accept once then upgrade to salted hash.
  if (!user.password_salt) {
    if (user.plain_password && String(user.plain_password) === String(password)) {
      const saltB64 = randomSaltB64()
      const hashB64 = await derivePasswordHash(String(password), saltB64)
      await DB.prepare(
        'UPDATE users SET password_salt = ?, password_hash = ?, password_updated_at = CURRENT_TIMESTAMP, plain_password = NULL WHERE id = ?'
      )
        .bind(saltB64, hashB64, user.id)
        .run()
      user.password_salt = saltB64
      user.password_hash = hashB64
    } else {
      return c.json(
        { error: '이 계정은 비밀번호가 설정되어 있지 않습니다. 비밀번호 초기화를 진행해주세요.' },
        400
      )
    }
  }

  if (!user.password_hash) {
    return c.json({ error: '이 계정은 비밀번호가 설정되어 있지 않습니다. 비밀번호 초기화를 진행해주세요.' }, 400)
  }

  const derived = await derivePasswordHash(String(password), String(user.password_salt))
  if (derived !== String(user.password_hash)) {
    return c.json({ error: '비밀번호가 올바르지 않습니다.' }, 401)
  }
  
  return c.json({ 
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatar_url: user.avatar_url,
      church: user.church
    }
  })
})

// 비밀번호 변경 (로그인한 본인 — 현재 비밀번호 확인 후 갱신)
app.post('/api/users/:id/change-password', async (c) => {
  const { DB } = c.env
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) {
    return c.json({ error: '잘못된 요청입니다.' }, 400)
  }
  let body: Record<string, unknown> = {}
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: '요청 형식이 올바르지 않습니다.' }, 400)
  }
  const current_password = body.current_password
  const new_password = body.new_password
  if (typeof current_password !== 'string' || !current_password) {
    return c.json({ error: '현재 비밀번호를 입력해주세요.' }, 400)
  }
  if (typeof new_password !== 'string' || !new_password.trim()) {
    return c.json({ error: '새 비밀번호를 입력해주세요.' }, 400)
  }

  const user = await DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first()
  if (!user) {
    return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404)
  }

  const ok = await verifyUserPassword(user, current_password)
  if (!ok) {
    return c.json({ error: '현재 비밀번호가 올바르지 않습니다.' }, 401)
  }

  const ruleErr = validateNewPasswordRules(String(new_password))
  if (ruleErr) {
    return c.json({ error: ruleErr }, 400)
  }
  if (String(current_password) === String(new_password)) {
    return c.json({ error: '새 비밀번호는 현재 비밀번호와 달라야 합니다.' }, 400)
  }

  const saltB64 = randomSaltB64()
  const hashB64 = await derivePasswordHash(String(new_password), saltB64)
  await DB.prepare(
    'UPDATE users SET password_salt = ?, password_hash = ?, password_updated_at = CURRENT_TIMESTAMP, plain_password = NULL WHERE id = ?'
  )
    .bind(saltB64, hashB64, id)
    .run()

  return c.json({ success: true, message: '비밀번호가 변경되었습니다.' })
})

// Get all users
app.get('/api/users', async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare('SELECT id, email, name, bio, avatar_url, church, denomination, location, role, created_at FROM users ORDER BY created_at DESC').all()
  return c.json({ users: results })
})

// Get user by ID
// Get user by ID
app.get('/api/users/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const currentUserId = c.req.query('current_user_id') // To check if viewing own profile
  
  const user = await DB.prepare('SELECT id, email, name, bio, avatar_url, cover_url, church, pastor, denomination, location, position, gender, faith_answers, role, created_at, updated_at, scripture_score, prayer_score, activity_score, elementary_school, middle_school, high_school, university, university_major, masters, masters_major, phd, phd_major, universities, masters_degrees, phd_degrees, careers, marital_status, address, phone, privacy_settings FROM users WHERE id = ?').bind(id).first()
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }
  
  // If viewing own profile or no privacy settings, return all data (id 타입 불일치 방지)
  const viewer =
    currentUserId != null && String(currentUserId).trim() !== ''
      ? Number(currentUserId)
      : NaN
  const isOwnProfile = Number.isFinite(viewer) && viewer === Number(user.id)
  
  // Calculate ministry score (종합점수 = 성경점수 + 기도점수 + 활동점수)
  const ministryScore = (user.scripture_score || 0) + (user.prayer_score || 0) + (user.activity_score || 0)
  
  if (isOwnProfile || !user.privacy_settings) {
    return c.json({ user: { ...user, ministry_score: ministryScore } })
  }
  
  // Apply privacy filters for other users
  const privacySettings = JSON.parse(user.privacy_settings || '{}')
  const filteredUser = { ...user }
  
  // Hide basic info if private (including email) - hide ALL data regardless of input/empty
  if (privacySettings.basic_info === false) {
    filteredUser.email = null  // ALWAYS hide email when private
    filteredUser.gender = null
    filteredUser.marital_status = null
    filteredUser.phone = null
    filteredUser.address = null
    filteredUser.bio = null  // Also hide bio
  }
  
  // Hide church info if private - hide ALL data regardless of input/empty
  if (privacySettings.church_info === false) {
    filteredUser.church = null
    filteredUser.pastor = null
    filteredUser.denomination = null
    filteredUser.location = null
    filteredUser.position = null
  }
  
  // Hide faith answers if private - hide ALL data regardless of input/empty
  if (privacySettings.faith_answers === false) {
    filteredUser.faith_answers = null
  }
  
  // Hide education info if private - hide ALL data regardless of input/empty
  if (privacySettings.education_info === false) {
    filteredUser.elementary_school = null
    filteredUser.middle_school = null
    filteredUser.high_school = null
    filteredUser.university = null
    filteredUser.university_major = null
    filteredUser.masters = null
    filteredUser.masters_major = null
    filteredUser.phd = null
    filteredUser.phd_major = null
    filteredUser.universities = null
    filteredUser.masters_degrees = null
    filteredUser.phd_degrees = null
  }
  
  // Hide career info if private - hide ALL data regardless of input/empty
  if (privacySettings.career_info === false) {
    filteredUser.careers = null
  }
  
  // Hide scores if private - hide ALL data regardless of input/empty
  if (privacySettings.scores === false) {
    filteredUser.scripture_score = null
    filteredUser.prayer_score = null
    filteredUser.activity_score = null
  }
  
  // Calculate filtered ministry score (종합점수) - only if scores are visible
  const filteredMinistryScore = privacySettings.scores === false ? null : 
    (filteredUser.scripture_score || 0) + (filteredUser.prayer_score || 0) + (filteredUser.activity_score || 0)
  
  return c.json({ user: { ...filteredUser, ministry_score: filteredMinistryScore } })
})

// Get user by email
app.get('/api/users/email/:email', async (c) => {
  const { DB } = c.env
  const email = c.req.param('email')
  
  const user = await DB.prepare('SELECT id, email, name, bio, avatar_url, cover_url, church, pastor, denomination, location, position, gender, faith_answers, role, created_at, updated_at, scripture_score, prayer_score, activity_score FROM users WHERE email = ?').bind(email).first()
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }
  
  // Calculate ministry score
  const ministryScore = (user.scripture_score || 0) + (user.prayer_score || 0) + (user.activity_score || 0)
  
  return c.json({ user: { ...user, ministry_score: ministryScore } })
})

// View user profile (HTML page)
app.get('/users/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const user = await DB.prepare('SELECT id, email, name, bio, avatar_url, cover_url, church, pastor, denomination, location, position, gender, faith_answers, role, created_at, updated_at, scripture_score, prayer_score, activity_score, elementary_school, middle_school, high_school, university, university_major, masters, masters_major, phd, phd_major, universities, masters_degrees, phd_degrees, careers, marital_status, address, phone, privacy_settings FROM users WHERE id = ?').bind(id).first()
  
  if (!user) {
    return c.html('<h1>사용자를 찾을 수 없습니다</h1>')
  }
  
  // Parse JSON fields
  const privacySettings = JSON.parse(user.privacy_settings || '{}')
  const faithAnswers = JSON.parse(user.faith_answers || '{}')
  const careers = JSON.parse(user.careers || '[]')
  
  // Apply privacy filters - hide data if private
  const showBasicInfo = privacySettings.basic_info !== false
  const showChurchInfo = privacySettings.church_info !== false
  const showFaithAnswers = privacySettings.faith_answers !== false
  const showEducationInfo = privacySettings.education_info !== false
  const showCareerInfo = privacySettings.career_info !== false
  const showScores = privacySettings.scores !== false
  
  const careerHTML = (showCareerInfo && careers.length > 0) ? careers.map((career: any) => `
    <div class="bg-gray-50 p-3 rounded">
      <div class="font-semibold">${career.company}</div>
      <div class="text-sm text-gray-600">${career.position} • ${career.period}</div>
    </div>
  `).join('') : ''
  
  const mastersHTML = (showEducationInfo && user.masters) ? `<div><span class="font-semibold">석사:</span> ${user.masters} ${user.masters_major ? '(' + user.masters_major + ')' : ''}</div>` : ''
  const phdHTML = (showEducationInfo && user.phd) ? `<div><span class="font-semibold">박사:</span> ${user.phd} ${user.phd_major ? '(' + user.phd_major + ')' : ''}</div>` : ''
  const careerSectionHTML = (showCareerInfo && careers.length > 0) ? `
    <div class="border-b pb-4">
      <h2 class="text-xl font-semibold mb-3 text-gray-700">
        <i class="fas fa-briefcase mr-2"></i>직업 정보
      </h2>
      <div class="space-y-2">${careerHTML}</div>
    </div>
  ` : ''
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${ user.name} - 프로필</title>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg">
        <script src="https://cdn.tailwindcss.com"></script>
        <script>
            // Suppress Tailwind CDN warnings
            tailwind.config = { corePlugins: { preflight: true } }
        </script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-50 overflow-x-hidden">
        <div class="max-w-4xl mx-auto p-6">
            <div class="bg-white rounded-lg shadow-lg p-8">
                <!-- Header -->
                <div class="flex items-center justify-between mb-6">
                    <h1 class="text-3xl font-bold text-gray-800">${ user.name}</h1>
                    <button onclick="window.close()" class="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg">
                        <i class="fas fa-times mr-2"></i>닫기
                    </button>
                </div>
                
                <!-- Basic Info -->
                <div class="space-y-4">
                ${showBasicInfo ? `
                    <div class="border-b pb-4">
                        <h2 class="text-xl font-semibold mb-3 text-gray-700">
                            <i class="fas fa-user mr-2"></i>기본 정보
                        </h2>
                        <div class="grid grid-cols-2 gap-4">
                            <div><span class="font-semibold">이메일:</span> ${ user.email}</div>
                            <div><span class="font-semibold">성별:</span> ${ user.gender || '-'}</div>
                            <div><span class="font-semibold">결혼 여부:</span> ${ user.marital_status === 'single' ? '미혼' : user.marital_status === 'married' ? '기혼' : '-'}</div>
                            <div><span class="font-semibold">역할:</span> <span class="px-2 py-1 rounded-full text-xs ${ user.role === 'admin' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}">${ user.role}</span></div>
                        </div>
                    </div>
                ` : `
                    <div class="border-b pb-4">
                        <div class="text-gray-500 italic">
                            <i class="fas fa-lock mr-2"></i>기본 정보가 비공개로 설정되어 있습니다.
                        </div>
                    </div>
                `}
                    
                    <!-- Church Info -->
                    ${showChurchInfo ? `
                    <div class="border-b pb-4">
                        <h2 class="text-xl font-semibold mb-3 text-gray-700">
                            <i class="fas fa-church mr-2"></i>교회 정보
                        </h2>
                        <div class="grid grid-cols-2 gap-4">
                            <div><span class="font-semibold">교회:</span> ${ user.church || '-'}</div>
                            <div><span class="font-semibold">담임목사:</span> ${ user.pastor || '-'}</div>
                            <div><span class="font-semibold">교단:</span> ${ user.denomination || '-'}</div>
                            <div><span class="font-semibold">직분:</span> ${ user.position || '-'}</div>
                            <div><span class="font-semibold">지역:</span> ${ user.location || '-'}</div>
                        </div>
                    </div>
                    ` : `
                    <div class="border-b pb-4">
                        <div class="text-gray-500 italic">
                            <i class="fas fa-lock mr-2"></i>교회 정보가 비공개로 설정되어 있습니다.
                        </div>
                    </div>
                    `}
                    
                    <!-- Education Info -->
                    ${showEducationInfo ? `
                    <div class="border-b pb-4">
                        <h2 class="text-xl font-semibold mb-3 text-gray-700">
                            <i class="fas fa-graduation-cap mr-2"></i>학교 정보
                        </h2>
                        <div class="space-y-2">
                            <div><span class="font-semibold">초등학교:</span> ${ user.elementary_school || '-'}</div>
                            <div><span class="font-semibold">중학교:</span> ${ user.middle_school || '-'}</div>
                            <div><span class="font-semibold">고등학교:</span> ${ user.high_school || '-'}</div>
                            <div><span class="font-semibold">대학교:</span> ${ user.university || '-'} ${ user.university_major ? '(' + user.university_major + ')' : ''}</div>
                            ${ mastersHTML}
                            ${ phdHTML}
                        </div>
                    </div>
                    ` : `
                    <div class="border-b pb-4">
                        <div class="text-gray-500 italic">
                            <i class="fas fa-lock mr-2"></i>학력 정보가 비공개로 설정되어 있습니다.
                        </div>
                    </div>
                    `}
                    
                    <!-- Career Info -->
                    ${showCareerInfo ? careerSectionHTML : `
                    <div class="border-b pb-4">
                        <div class="text-gray-500 italic">
                            <i class="fas fa-lock mr-2"></i>직업 정보가 비공개로 설정되어 있습니다.
                        </div>
                    </div>
                    `}
                    
                    <!-- Scores -->
                    ${showScores ? `
                    <div class="border-b pb-4">
                        <h2 class="text-xl font-semibold mb-3 text-gray-700">
                            <i class="fas fa-chart-line mr-2"></i>점수
                        </h2>
                        
                        <!-- All Scores in Compact Single Line -->
                        <div class="flex items-center justify-center space-x-4 text-xs">
                            <div class="flex items-center space-x-1">
                                <i class="fas fa-book-bible text-yellow-600 text-xs"></i>
                                <span class="font-semibold text-yellow-600">${ user.scripture_score || 0}</span>
                            </div>
                            <span class="text-gray-300">|</span>
                            <div class="flex items-center space-x-1">
                                <i class="fas fa-praying-hands text-blue-600 text-xs"></i>
                                <span class="font-semibold text-blue-600">${ user.prayer_score || 0}</span>
                            </div>
                            <span class="text-gray-300">|</span>
                            <div class="flex items-center space-x-1">
                                <i class="fas fa-heart text-green-600 text-xs"></i>
                                <span class="font-semibold text-green-600">${ user.activity_score || 0}</span>
                            </div>
                            <span class="text-gray-300">|</span>
                            <div class="flex items-center space-x-1">
                                <i class="fas fa-trophy text-purple-600 text-xs"></i>
                                <span class="font-semibold text-purple-600">${ ((user.scripture_score || 0) + (user.prayer_score || 0) + (user.activity_score || 0))}</span>
                            </div>
                        </div>
                    </div>
                    ` : `
                    <div class="border-b pb-4">
                        <div class="text-gray-500 italic">
                            <i class="fas fa-lock mr-2"></i>점수 정보가 비공개로 설정되어 있습니다.
                        </div>
                    </div>
                    `}
                </div>
                    
                    <!-- Dates -->
                    <div>
                        <div class="text-sm text-gray-500">
                            <div>가입일: ${ new Date(user.created_at).toLocaleDateString('ko-KR')}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </body>
    </html>
  `)
})

// ── 비밀번호 유효성 검사 ─────────────────────────────────────────
function validatePassword(pw: string): string[] {
  const errs: string[] = []
  if (pw.length < 8) errs.push('8자 이상 입력해주세요.')
  if ((pw.match(/[a-z]/g) || []).length < 3) errs.push('영문 소문자를 3개 이상 포함해주세요.')
  if ((pw.match(/[0-9]/g) || []).length < 3) errs.push('숫자를 3개 이상 포함해주세요.')
  if (/[A-Z]/.test(pw) || /[^a-z0-9]/.test(pw)) errs.push('영문 소문자와 숫자만 사용할 수 있습니다.')
  return errs
}

// ── 이메일 인증 회원가입 요청 ────────────────────────────────────
app.post('/api/signup-request', async (c) => {
  const { DB, RESEND_API_KEY } = c.env
  if (!RESEND_API_KEY) return c.json({ error: '이메일 발송이 일시적으로 불가합니다. 잠시 후 다시 시도해주세요.' }, 503)

  const body = await c.req.json()
  const { email, name, password, church, pastor, denomination, location, position, gender, faith_answers, marital_status, address, phone, avatar_data_url } = body

  if (!email || !name || !password) return c.json({ error: '이름, 이메일, 비밀번호는 필수입니다.' }, 400)
  if (password.length < 4) return c.json({ error: '비밀번호는 4자 이상이어야 합니다.' }, 400)
  const pwErrs = validatePassword(password)
  if (pwErrs.length > 0) return c.json({ error: pwErrs[0] }, 400)

  const normalizedEmail = email.trim().toLowerCase()
  if (await DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?').bind(normalizedEmail).first()) {
    return c.json({ error: '이미 가입된 이메일입니다.' }, 409)
  }

  const avatarStr = typeof avatar_data_url === 'string' ? avatar_data_url.trim() : ''
  if (avatarStr) {
    if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+$/.test(avatarStr)) return c.json({ error: '프로필 이미지 형식이 올바르지 않습니다.' }, 400)
    if (avatarStr.length > 2_000_000) return c.json({ error: '프로필 이미지가 너무 큽니다. 더 작게 잘라주세요.' }, 400)
  }

  const saltB64 = randomSaltB64()
  const passwordHash = await derivePasswordHash(password, saltB64)
  const signupData = {
    email: normalizedEmail, name: sanitizeText(name), password_hash: passwordHash, password_salt: saltB64,
    church: church ? sanitizeText(church) : null, pastor: pastor ? sanitizeText(pastor) : null,
    denomination: denomination || null, location: location || null, position: position || null,
    gender: gender || null, faith_answers: faith_answers || null,
    marital_status: marital_status || null, address: address ? sanitizeText(address) : null,
    phone: phone || null, avatar_data_url: avatarStr || null,
  }

  const tokenBytes = crypto.getRandomValues(new Uint8Array(32))
  const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('')
  const expiresAt = new Date(Date.now() + 1440 * 60 * 1000).toISOString()

  await DB.prepare('INSERT INTO email_verification_tokens (email, token, signup_data, expires_at) VALUES (?, ?, ?, ?)')
    .bind(normalizedEmail, token, JSON.stringify(signupData), expiresAt).run()

  const verifyUrl = `${new URL(c.req.url).origin}/verify-email?token=${token}`
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Crossfriends <noreply@crossfriends.org>',
        to: [normalizedEmail],
        reply_to: 'no-reply@null.invalid',
        subject: '[CROSSfriends] 이메일 인증을 완료해주세요',
        html: `
          <p>안녕하세요, <strong>${sanitizeText(name)}</strong>님!</p>
          <p>CROSSfriends 회원가입을 완료하려면 아래 링크를 클릭해주세요.</p>
          <p><a href="${verifyUrl}" style="color:#3B82F6;text-decoration:underline;">이메일 인증하기</a></p>
          <p>링크는 24시간 동안 유효합니다.</p>
          <p>본인이 요청한 것이 아니라면 이 메일을 무시해주세요.</p>
          <p>— CROSSfriends</p>
        `,
      }),
    })
  } catch (e) {
    console.error('Resend error:', e)
    return c.json({ error: '이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.' }, 500)
  }
  return c.json({ success: true, message: '인증 메일을 발송했습니다. 이메일을 확인해주세요.' }, 200)
})

// ── 이메일 인증 완료 → 유저 생성 ─────────────────────────────────
app.post('/api/verify-email', async (c) => {
  const { DB, R2 } = c.env
  const { token } = await c.req.json()
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return c.json({ error: '유효하지 않은 인증 링크입니다.' }, 400)

  const row = await DB.prepare('SELECT id, email, signup_data, expires_at FROM email_verification_tokens WHERE token = ?').bind(token).first() as any
  if (!row) return c.json({ error: '만료되었거나 유효하지 않은 인증 링크입니다.' }, 400)
  if (new Date(row.expires_at) < new Date()) {
    await DB.prepare('DELETE FROM email_verification_tokens WHERE id = ?').bind(row.id).run()
    return c.json({ error: '인증 링크가 만료되었습니다. 회원가입을 다시 진행해주세요.' }, 400)
  }

  const data = JSON.parse(row.signup_data)
  if (await DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?').bind(data.email).first()) {
    await DB.prepare('DELETE FROM email_verification_tokens WHERE id = ?').bind(row.id).run()
    return c.json({ error: '이미 가입된 이메일입니다.' }, 409)
  }

  const countRow = await DB.prepare('SELECT COUNT(*) as count FROM users').first() as any
  const role = ((countRow?.count) || 0) === 0 ? 'admin' : 'user'

  const result = await DB.prepare(
    'INSERT INTO users (email, name, password_salt, password_hash, password_updated_at, church, pastor, denomination, location, position, gender, faith_answers, role, marital_status, address, phone) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(data.email, data.name, data.password_salt || null, data.password_hash, data.church, data.pastor, data.denomination, data.location, data.position, data.gender, data.faith_answers, role, data.marital_status, data.address, data.phone).run()

  const newUserId = Number(result.meta?.last_row_id || 0)

  // 아바타 업로드
  if (newUserId > 0 && data.avatar_data_url) {
    try {
      const m = String(data.avatar_data_url).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=]+)$/)
      if (m) {
        const mime = m[1].toLowerCase(), raw = atob(m[2])
        const buf = new Uint8Array(raw.length)
        for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i)
        if (buf.byteLength <= 5 * 1024 * 1024) {
          const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
          const key = `avatars/${newUserId}_${Date.now()}.${ext}`
          await R2.put(key, buf.buffer, { httpMetadata: { contentType: mime } })
          await DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(`/api/avatars/${key}`, newUserId).run()
        }
      }
    } catch (e) { console.error('Signup avatar save error:', e) }
  }

  await DB.prepare('DELETE FROM email_verification_tokens WHERE id = ?').bind(row.id).run()

  // QT 초대 처리
  const invitedEmail = data.email.trim().toLowerCase()
  const newUser = await DB.prepare('SELECT id, name FROM users WHERE LOWER(email) = ?').bind(invitedEmail).first() as any
  const invite = await DB.prepare('SELECT inviter_user_id FROM qt_invites WHERE LOWER(invited_email) = ? AND redeemed_at IS NULL').bind(invitedEmail).first() as any
  if (invite) {
    await DB.prepare('UPDATE qt_invites SET redeemed_at = datetime(\'now\') WHERE LOWER(invited_email) = ? AND redeemed_at IS NULL').bind(invitedEmail).run()
    const inviter = await DB.prepare('SELECT activity_score FROM users WHERE id = ?').bind(invite.inviter_user_id).first() as any
    if (inviter) {
      await DB.prepare('UPDATE users SET activity_score = ? WHERE id = ?').bind((inviter.activity_score || 0) + 40, invite.inviter_user_id).run()
    }
    if (newUser) {
      await DB.prepare('INSERT INTO notifications (user_id, from_user_id, type, created_at) VALUES (?, ?, \'invite_redeemed\', ?)').bind(invite.inviter_user_id, newUser.id, new Date().toISOString()).run()
    }
  }

  return c.json({ success: true, message: '회원가입이 완료되었습니다! 로그인해주세요.' }, 200)
})

// ── 이메일 인증 페이지 ───────────────────────────────────────────
app.get('/verify-email', (c) => {
  const token = c.req.query('token') || ''
  const safeToken = /^[a-f0-9]{64}$/.test(token) ? token : ''
  if (!safeToken) return c.html(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>이메일 인증 - CROSSfriends</title><script src="https://cdn.tailwindcss.com"></script><link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"></head><body class="bg-gray-100 min-h-screen flex items-center justify-center p-4"><div class="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center"><i class="fas fa-exclamation-circle text-red-500 text-5xl mb-4"></i><h1 class="text-xl font-bold text-gray-800 mb-2">유효하지 않은 링크</h1><p class="text-gray-600 mb-6">인증 링크가 없거나 만료되었습니다. 회원가입을 다시 진행해주세요.</p><a href="/" class="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700">홈으로</a></div></body></html>`)
  return c.html(`<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>이메일 인증 - CROSSfriends</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js"></script>
</head>
<body class="bg-gray-100 min-h-screen flex items-center justify-center p-4">
  <div class="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
    <div id="loading" class="py-8">
      <i class="fas fa-spinner fa-spin text-blue-600 text-4xl mb-4"></i>
      <h1 class="text-xl font-bold text-gray-800 mb-2">이메일 인증 중...</h1>
      <p class="text-gray-600 text-sm">잠시만 기다려주세요.</p>
    </div>
    <div id="success" class="hidden py-8">
      <i class="fas fa-check-circle text-green-500 text-5xl mb-4"></i>
      <h1 class="text-xl font-bold text-gray-800 mb-2">회원가입 완료!</h1>
      <p class="text-gray-600 mb-6">이제 로그인해주세요.</p>
      <a href="/" class="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700">로그인하기</a>
    </div>
    <div id="error" class="hidden py-8">
      <i class="fas fa-exclamation-circle text-red-500 text-5xl mb-4"></i>
      <h1 class="text-xl font-bold text-gray-800 mb-2">인증 실패</h1>
      <p id="errorMsg" class="text-gray-600 mb-6"></p>
      <a href="/" class="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700">홈으로</a>
    </div>
  </div>
  <script>
    (async function() {
      try {
        await axios.post('/api/verify-email', { token: ${JSON.stringify(safeToken)} });
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('success').classList.remove('hidden');
        setTimeout(function() { location.href = '/'; }, 2000);
      } catch (err) {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('error').classList.remove('hidden');
        document.getElementById('errorMsg').textContent = err.response?.data?.error || '인증에 실패했습니다.';
      }
    })();
  </script>
</body>
</html>`)
})

// ── 비밀번호 재설정 요청 ─────────────────────────────────────────
app.post('/api/password-reset-request', async (c) => {
  const { DB, RESEND_API_KEY } = c.env
  const { email } = await c.req.json()
  if (!email) return c.json({ error: '이메일을 입력해주세요.' }, 400)

  const normalizedEmail = email.trim().toLowerCase()
  const user = await DB.prepare('SELECT id, name FROM users WHERE LOWER(email) = ?').bind(normalizedEmail).first() as any
  if (!user) return c.json({ error: '등록되지 않은 이메일입니다.' }, 404)

  const tokenBytes = crypto.getRandomValues(new Uint8Array(32))
  const token = Array.from(tokenBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('')
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString()

  await DB.prepare('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)').bind(user.id, token, expiresAt).run()

  const resetUrl = `${new URL(c.req.url).origin}/reset-password?token=${token}`

  if (RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Crossfriends <noreply@crossfriends.org>',
          to: [normalizedEmail],
          subject: '[Crossfriends] 비밀번호 재설정',
          html: `
            <p>${user.name}님, 안녕하세요.</p>
            <p>비밀번호 재설정을 요청하셨습니다. 아래 버튼을 클릭하여 새 비밀번호를 설정해주세요.</p>
            <p><a href="${resetUrl}" style="display:inline-block;background:#3B82F6;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;margin:16px 0;">비밀번호 재설정하기</a></p>
            <p>링크는 1시간 후 만료됩니다.</p>
            <p>요청하지 않으셨다면 이 이메일을 무시해주세요.</p>
          `,
        }),
      })
      if (!res.ok) {
        await DB.prepare('DELETE FROM password_reset_tokens WHERE token = ?').bind(token).run()
        return c.json({ error: '이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.' }, 500)
      }
    } catch (e) {
      await DB.prepare('DELETE FROM password_reset_tokens WHERE token = ?').bind(token).run()
      return c.json({ error: '이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.' }, 500)
    }
    return c.json({ success: true, message: '등록된 이메일로 비밀번호 재설정 링크를 보냈습니다. 이메일을 확인해주세요.' })
  }

  // RESEND_API_KEY 없는 경우 관리자 알림
  const admin = await DB.prepare('SELECT id FROM users WHERE role = \'admin\' LIMIT 1').first() as any
  if (admin) {
    await DB.prepare('INSERT INTO notifications (user_id, type, from_user_id, message, created_at) VALUES (?, \'system\', ?, ?, datetime(\'now\'))').bind(admin.id, user.id, `${user.name}(${email})님이 비밀번호 초기화를 요청했습니다. 관리자 패널에서 초기화해주세요.`).run()
  }
  return c.json({ success: true, message: '관리자에게 비밀번호 초기화 요청이 전달되었습니다. 관리자가 처리 후 안내드리겠습니다.' })
})

// ── 비밀번호 재설정 확인 ─────────────────────────────────────────
app.post('/api/password-reset', async (c) => {
  const { DB } = c.env
  const { token, newPassword } = await c.req.json()
  if (!token || !newPassword) return c.json({ error: '토큰과 새 비밀번호를 입력해주세요.' }, 400)

  const errs = validatePassword(newPassword)
  if (errs.length > 0) return c.json({ error: errs[0] }, 400)

  const row = await DB.prepare('SELECT prt.user_id FROM password_reset_tokens prt WHERE prt.token = ? AND prt.expires_at > datetime(\'now\')').bind(token).first() as any
  if (!row) return c.json({ error: '만료되었거나 유효하지 않은 링크입니다. 비밀번호 찾기를 다시 요청해주세요.' }, 400)

  const user = await DB.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?').bind(row.user_id).first() as any
  if (user?.password_salt && user?.password_hash && await verifyUserPassword(user as any, newPassword)) {
    return c.json({ error: '이전 비밀번호와 같을 수 없습니다. 다른 비밀번호를 입력해주세요.' }, 400)
  }

  const newSalt = randomSaltB64()
  const newHash = await derivePasswordHash(newPassword, newSalt)
  await DB.prepare('UPDATE users SET password_salt = ?, password_hash = ?, password_updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(newSalt, newHash, row.user_id).run()
  await DB.prepare('DELETE FROM password_reset_tokens WHERE token = ?').bind(token).run()
  return c.json({ success: true, message: '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.' })
})

// ── 비밀번호 재설정 페이지 ───────────────────────────────────────
app.get('/reset-password', (c) => {
  const token = c.req.query('token') || ''
  const safeToken = /^[a-f0-9]{64}$/.test(token) ? token : ''
  if (!safeToken) return c.html(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>비밀번호 재설정 - CROSSfriends</title><script src="https://cdn.tailwindcss.com"></script><link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"></head><body class="bg-gray-100 min-h-screen flex items-center justify-center p-4"><div class="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center"><i class="fas fa-exclamation-circle text-red-500 text-5xl mb-4"></i><h1 class="text-xl font-bold text-gray-800 mb-2">유효하지 않은 링크</h1><p class="text-gray-600 mb-6">비밀번호 재설정 링크가 없거나 만료되었습니다.</p><a href="/" class="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700">홈으로</a></div></body></html>`)
  return c.html(`<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>비밀번호 재설정 - CROSSfriends</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js"></script>
</head>
<body class="bg-gray-100 min-h-screen flex items-center justify-center p-4">
  <div class="bg-white rounded-xl shadow-lg p-8 max-w-md w-full">
    <h1 class="text-xl font-bold text-gray-800 mb-2"><i class="fas fa-key mr-2"></i>새 비밀번호 설정</h1>
    <p class="text-gray-600 text-sm mb-4">회원가입과 동일한 비밀번호 규칙을 적용합니다. 이전 비밀번호는 사용할 수 없습니다.</p>
    <form id="resetForm" onsubmit="return submitReset(event)">
      <input type="hidden" id="token" value="${safeToken}">
      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-700 mb-1">새 비밀번호</label>
        <input type="password" id="newPassword" required minlength="8" placeholder="영문 소문자 + 숫자 혼합 8자"
          class="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" oninput="validateResetPw()">
        <div id="resetPwRules" class="mt-1.5 space-y-0.5 text-xs hidden">
          <div id="r-length" class="flex items-center text-gray-400"><i class="fas fa-circle text-[5px] mr-1.5"></i>8자 이상</div>
          <div id="r-lower" class="flex items-center text-gray-400"><i class="fas fa-circle text-[5px] mr-1.5"></i>영문 소문자 3개 이상</div>
          <div id="r-digit" class="flex items-center text-gray-400"><i class="fas fa-circle text-[5px] mr-1.5"></i>숫자 3개 이상</div>
          <div id="r-noUpper" class="flex items-center text-gray-400"><i class="fas fa-circle text-[5px] mr-1.5"></i>대문자·특수문자 사용 불가</div>
        </div>
      </div>
      <div class="mb-6">
        <label class="block text-sm font-medium text-gray-700 mb-1">비밀번호 확인</label>
        <input type="password" id="newPasswordConfirm" required minlength="8" placeholder="비밀번호 재입력"
          class="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" oninput="validateResetPw()">
        <p id="matchMsg" class="text-sm mt-1 hidden"></p>
      </div>
      <button type="submit" id="submitBtn" class="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 font-medium">비밀번호 변경</button>
    </form>
    <p class="text-center mt-4"><a href="/" class="text-blue-600 hover:underline">로그인으로 돌아가기</a></p>
  </div>
  <div id="toast" class="fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg hidden"></div>
  <script>
    function getPwErrors(pw) {
      const errs = [];
      if (pw.length < 8) errs.push('length');
      if ((pw.match(/[a-z]/g) || []).length < 3) errs.push('lower');
      if ((pw.match(/[0-9]/g) || []).length < 3) errs.push('digit');
      if (/[A-Z]/.test(pw) || /[^a-z0-9]/.test(pw)) errs.push('noUpper');
      return errs;
    }
    function validateResetPw() {
      const pw = document.getElementById('newPassword').value;
      const confirm = document.getElementById('newPasswordConfirm').value;
      const rules = document.getElementById('resetPwRules');
      const errs = getPwErrors(pw);
      if (pw.length > 0) {
        rules.classList.remove('hidden');
        ['length','lower','digit','noUpper'].forEach(id => {
          const el = document.getElementById('r-' + id);
          el.className = 'flex items-center text-xs ' + (errs.includes(id) ? 'text-gray-400' : 'text-green-600');
          el.querySelector('i').className = errs.includes(id) ? 'fas fa-circle text-[5px] mr-1.5' : 'fas fa-check-circle text-green-500 mr-1.5';
        });
      } else rules.classList.add('hidden');
      const msg = document.getElementById('matchMsg');
      if (confirm.length > 0) {
        msg.classList.remove('hidden');
        msg.textContent = pw === confirm ? '✓ 비밀번호가 일치합니다' : '✗ 비밀번호가 일치하지 않습니다';
        msg.className = 'text-sm mt-1 ' + (pw === confirm ? 'text-green-600' : 'text-red-500');
      } else msg.classList.add('hidden');
    }
    async function submitReset(e) {
      e.preventDefault();
      const token = document.getElementById('token').value;
      const newPassword = document.getElementById('newPassword').value;
      const confirm = document.getElementById('newPasswordConfirm').value;
      if (getPwErrors(newPassword).length > 0) { showToast('비밀번호 규칙을 확인해주세요.', 'error'); return false; }
      if (newPassword !== confirm) { showToast('비밀번호가 일치하지 않습니다.', 'error'); return false; }
      const btn = document.getElementById('submitBtn');
      btn.disabled = true; btn.textContent = '처리 중...';
      try {
        const res = await axios.post('/api/password-reset', { token, newPassword });
        showToast(res.data.message, 'success');
        setTimeout(() => location.href = '/', 1500);
      } catch (err) {
        showToast(err.response?.data?.error || '오류가 발생했습니다.', 'error');
        btn.disabled = false; btn.textContent = '비밀번호 변경';
      }
      return false;
    }
    function showToast(msg, type) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg ' + (type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white');
      el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 3000);
    }
  </script>
</body>
</html>`)
})

// Create new user
app.post('/api/users', async (c) => {
  const { DB } = c.env
  const { email, name, password, bio, church, pastor, denomination, location, position, gender, faith_answers, marital_status, address, phone } = await c.req.json()
  
  // Check if this is the first user (will become admin)
  const userCountResult = await DB.prepare('SELECT COUNT(*) as count FROM users').first()
  const userCount = userCountResult?.count || 0
  const role = userCount === 0 ? 'admin' : 'user'

  if (!password || typeof password !== 'string' || !password.trim()) {
    return c.json({ error: '비밀번호는 필수입니다.' }, 400)
  }

  const saltB64 = randomSaltB64()
  const hashB64 = await derivePasswordHash(password, saltB64)
  
  const result = await DB.prepare(
    'INSERT INTO users (email, name, password_salt, password_hash, password_updated_at, bio, church, pastor, denomination, location, position, gender, faith_answers, role, marital_status, address, phone) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(email, name, saltB64, hashB64, bio || null, church || null, pastor || null, denomination || null, location || null, position || null, gender || null, faith_answers || null, role, marital_status || null, address || null, phone || null).run()

  const rawId = result.meta.last_row_id
  const newUserId = rawId != null ? Number(rawId) : NaN
  if (!Number.isFinite(newUserId)) {
    console.error('[signup] invalid last_row_id:', rawId, result.meta)
    return c.json({ error: '가입 처리 중 오류가 발생했습니다. 다시 시도해 주세요.' }, 500)
  }

  return c.json({ id: newUserId, email, name, role }, 201)
})

// Update user
app.put('/api/users/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const { name, bio, gender, church, pastor, position, faith_answers, elementary_school, middle_school, high_school, university, university_major, masters, masters_major, phd, phd_major, universities, masters_degrees, phd_degrees, careers, marital_status, address, phone, privacy_settings } = await c.req.json()
  
  await retryD1(() =>
    DB.prepare(
      'UPDATE users SET name = ?, bio = ?, gender = ?, church = ?, pastor = ?, position = ?, faith_answers = ?, elementary_school = ?, middle_school = ?, high_school = ?, university = ?, university_major = ?, masters = ?, masters_major = ?, phd = ?, phd_major = ?, universities = ?, masters_degrees = ?, phd_degrees = ?, careers = ?, marital_status = ?, address = ?, phone = ?, privacy_settings = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(name, bio || null, gender || null, church || null, pastor || null, position || null, faith_answers || null, elementary_school || null, middle_school || null, high_school || null, university || null, university_major || null, masters || null, masters_major || null, phd || null, phd_major || null, universities || null, masters_degrees || null, phd_degrees || null, careers || null, marital_status || null, address || null, phone || null, privacy_settings || null, id).run()
  )

  return c.json({ success: true })
})

// Upload avatar
app.post('/api/users/:id/avatar', async (c) => {
  const { DB } = c.env
  const userIdRaw = c.req.param('id')
  const userId = Number.parseInt(String(userIdRaw), 10)
  if (!Number.isFinite(userId)) {
    return c.json({ error: 'Invalid user id' }, 400)
  }

  try {
    const formData = await c.req.formData()
    const file = formData.get('avatar')

    if (!isUploadBlobPart(file)) {
      return c.json({ error: 'No file uploaded' }, 400)
    }

    // Check file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      return c.json({ error: 'File too large (max 5MB)' }, 400)
    }

    if (!mimeOrNameSuggestsImage(file)) {
      return c.json({ error: 'Invalid file type' }, 400)
    }

    const filename = uploadImageFilename(file, String(userId))
    const fullPath = `avatars/${filename}`
    
    const arrayBuffer = await file.arrayBuffer()
    const avatarCt = file.type && String(file.type).trim() ? file.type : 'image/jpeg'
    const stored = await putR2OrMediaFallback(c, DB, fullPath, arrayBuffer, avatarCt)
    if (!stored.ok) {
      return c.json({ error: stored.message }, 500)
    }
    
    // Update user avatar_url in database
    const avatarUrl = `/api/avatars/avatars/${filename}`
    const upd = await retryD1(() =>
      DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(avatarUrl, userId).run()
    )
    const avatarRowChanges = (upd.meta as { changes?: number }).changes
    if (avatarRowChanges === 0) {
      return c.json({ error: 'User not found' }, 404)
    }

    return c.json({ avatar_url: avatarUrl }, 200)
  } catch (error) {
    console.error('Avatar upload error:', error)
    return c.json({ error: 'Upload failed' }, 500)
  }
})

// Delete avatar
app.delete('/api/users/:id/avatar', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('id')
  
  try {
    // Set avatar_url to null in database
    await DB.prepare(
      'UPDATE users SET avatar_url = NULL WHERE id = ?'
    ).bind(userId).run()
    
    return c.json({ message: 'Avatar deleted successfully' }, 200)
  } catch (error) {
    console.error('Avatar delete error:', error)
    return c.json({ error: 'Delete failed' }, 500)
  }
})

// Upload cover photo
app.post('/api/users/:id/cover', async (c) => {
  const { DB } = c.env
  const userIdRaw = c.req.param('id')
  const userId = Number.parseInt(String(userIdRaw), 10)
  if (!Number.isFinite(userId)) {
    return c.json({ error: 'Invalid user id' }, 400)
  }

  try {
    const formData = await c.req.formData()
    const file = formData.get('cover')

    if (!isUploadBlobPart(file)) {
      return c.json({ error: 'No file uploaded' }, 400)
    }

    // Check file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      return c.json({ error: 'File too large (max 10MB)' }, 400)
    }

    if (!mimeOrNameSuggestsImage(file)) {
      return c.json({ error: 'Invalid file type' }, 400)
    }

    const filename = uploadImageFilename(file, String(userId))
    const fullPath = `covers/${filename}`
    
    const arrayBuffer = await file.arrayBuffer()
    const coverCt = file.type && String(file.type).trim() ? file.type : 'image/jpeg'
    const stored = await putR2OrMediaFallback(c, DB, fullPath, arrayBuffer, coverCt)
    if (!stored.ok) {
      return c.json({ error: stored.message }, 500)
    }
    
    // Update user cover_url in database
    const coverUrl = `/api/covers/covers/${filename}`
    const upd = await retryD1(() =>
      DB.prepare('UPDATE users SET cover_url = ? WHERE id = ?').bind(coverUrl, userId).run()
    )
    const coverRowChanges = (upd.meta as { changes?: number }).changes
    if (coverRowChanges === 0) {
      return c.json({ error: 'User not found' }, 404)
    }

    return c.json({ cover_url: coverUrl }, 200)
  } catch (error) {
    console.error('Cover upload error:', error)
    return c.json({ error: 'Upload failed' }, 500)
  }
})

// Delete cover photo
app.delete('/api/users/:id/cover', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('id')
  
  try {
    // Set cover_url to null in database
    await DB.prepare(
      'UPDATE users SET cover_url = NULL WHERE id = ?'
    ).bind(userId).run()
    
    return c.json({ message: 'Cover deleted successfully' }, 200)
  } catch (error) {
    console.error('Cover delete error:', error)
    return c.json({ error: 'Delete failed' }, 500)
  }
})

// Get cover from R2
app.get('/api/covers/covers/:filename', async (c) => {
  const safe = sanitizeR2Filename(c.req.param('filename'))
  if (!safe) return c.notFound()
  return serveR2OrMediaFallback(c, `covers/${safe}`)
})

// 레거시: DB에 /api/covers/:filename (중간 covers 한 번만) 로 저장된 커버
app.get('/api/covers/:filename', async (c) => {
  const safe = sanitizeR2Filename(c.req.param('filename'))
  if (!safe || safe === 'covers') return c.notFound()
  return serveR2OrMediaFallback(c, `covers/${safe}`)
})

// Get avatar from R2
app.get('/api/avatars/avatars/:filename', async (c) => {
  const safe = sanitizeR2Filename(c.req.param('filename'))
  if (!safe) return c.notFound()
  return serveR2OrMediaFallback(c, `avatars/${safe}`)
})

// 레거시: DB에 /api/avatar/:filename 형태로 저장된 프로필 사진
app.get('/api/avatar/:filename', async (c) => {
  const safe = sanitizeR2Filename(c.req.param('filename'))
  if (!safe) return c.notFound()
  return serveFirstR2OrMediaFallback(c, [`avatars/${safe}`, `avatar/${safe}`])
})

// Get post image from R2
app.get('/api/images/posts/:filename', async (c) => {
  const safe = sanitizeR2Filename(c.req.param('filename'))
  if (!safe) return c.notFound()
  return serveR2Object(c, `posts/${safe}`)
})


// =====================
// API Routes - Posts
// =====================

// Get all posts with user info, likes count, and comments count
app.get('/api/posts', async (c) => {
  const { DB } = c.env
  try {
    await DB.prepare("ALTER TABLE posts ADD COLUMN visibility_scope TEXT NOT NULL DEFAULT 'public'").run()
  } catch (_) {
    // already exists
  }
  const currentUserId = c.req.query('user_id') // For checking if current user liked the post
  const filterUserId = c.req.query('filter_user_id') // For filtering by specific user
  const viewerId = Number(currentUserId || 0)
  
  console.log('🔍 API /api/posts called with:', { currentUserId, filterUserId });
  
  // Build WHERE clause and bind params
  // CRITICAL: Bind params must match the order of ? in SQL query
  // SQL order: is_liked (?), is_prayed (?), WHERE clause (?)
  let whereClause = `
    WHERE (
      COALESCE(p.visibility_scope, 'public') = 'public'
      OR p.user_id = ?
      OR (
        COALESCE(p.visibility_scope, 'public') = 'friends'
        AND EXISTS (
          SELECT 1
          FROM friendships f
          WHERE f.status = 'accepted'
            AND (
              (f.user_id = p.user_id AND f.friend_id = ?)
              OR (f.friend_id = p.user_id AND f.user_id = ?)
            )
        )
      )
    )
  `
  let bindParams: any[] = []
  
  // First two params are always for is_liked and is_prayed subqueries
  bindParams.push(currentUserId || 0, currentUserId || 0)
  bindParams.push(viewerId, viewerId, viewerId)
  
  if (filterUserId) {
    whereClause += ' AND p.user_id = ?'
    bindParams.push(filterUserId)
    console.log('✅ Applying filter for user_id:', filterUserId);
  } else {
    console.log('📋 No filter applied, returning all posts');
  }
  
  console.log('🔍 WHERE clause:', whereClause);
  console.log('🔍 Bind params:', bindParams);
  
  const { results } = await DB.prepare(`
    SELECT 
      p.*,
      u.name as user_name,
      u.avatar_url as user_avatar,
      u.church as user_church,
      u.role as user_role,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes_count,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) as is_liked,
      (SELECT COUNT(*) FROM prayer_clicks WHERE post_id = p.id) as prayer_clicks_count,
      (SELECT COUNT(*) FROM prayer_clicks WHERE post_id = p.id AND user_id = ?) as is_prayed,
      sp.id as shared_post_id,
      sp.content as shared_content,
      sp.image_url as shared_image_url,
      sp.video_url as shared_video_url,
      sp.verse_reference as shared_verse_reference,
      sp.created_at as shared_created_at,
      sp.user_id as shared_user_id,
      su.name as shared_user_name,
      su.avatar_url as shared_user_avatar,
      su.church as shared_user_church,
      su.role as shared_user_role
    FROM posts p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN posts sp ON p.shared_post_id = sp.id
    LEFT JOIN users su ON sp.user_id = su.id
    ${whereClause}
    ORDER BY p.created_at DESC
  `).bind(...bindParams).all()
  
  console.log(`✅ Returned ${results.length} posts`);
  
  return c.json({ posts: results })
})

// Get post by ID
app.get('/api/posts/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const currentUserId = c.req.query('user_id')
  
  const post = await DB.prepare(`
    SELECT 
      p.*,
      u.name as user_name,
      u.avatar_url as user_avatar,
      u.church as user_church,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes_count,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) as is_liked
    FROM posts p
    LEFT JOIN users u ON p.user_id = u.id
    WHERE p.id = ?
  `).bind(currentUserId || 0, id).first()
  
  if (!post) {
    return c.json({ error: 'Post not found' }, 404)
  }
  
  return c.json({ post })
})

// Create new post
app.post('/api/posts', async (c) => {
  const { DB } = c.env
  try {
    await DB.prepare("ALTER TABLE posts ADD COLUMN visibility_scope TEXT NOT NULL DEFAULT 'public'").run()
  } catch (_) {
    // already exists
  }
  const { user_id, content, image_url, verse_reference, shared_post_id, is_prayer_request, background_color, visibility_scope } = await c.req.json()
  const scope = visibility_scope === 'friends' ? 'friends' : 'public'
  
  const result = await DB.prepare(
    'INSERT INTO posts (user_id, content, image_url, verse_reference, shared_post_id, is_prayer_request, background_color, visibility_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(user_id, content, image_url || null, verse_reference || null, shared_post_id || null, is_prayer_request || 0, background_color || null, scope).run()
  
  let updatedScores = {}
  
  // 기도 포스팅(중보 기도 - 빨간색 배경)일 경우 기도 점수 10점 추가
  if (background_color === '#F87171') {
    const user = await DB.prepare('SELECT prayer_score FROM users WHERE id = ?').bind(user_id).first()
    const currentScore = user?.prayer_score || 0
    const newScore = currentScore + 10
    await DB.prepare('UPDATE users SET prayer_score = ? WHERE id = ?').bind(newScore, user_id).run()
    updatedScores.prayer_score = newScore
  }
  
  // 말씀 포스팅(노란색 배경)일 경우 성경 점수 10점 추가
  if (background_color === '#F5E398') {
    const user = await DB.prepare('SELECT scripture_score FROM users WHERE id = ?').bind(user_id).first()
    const currentScore = user?.scripture_score || 0
    const newScore = currentScore + 10
    await DB.prepare('UPDATE users SET scripture_score = ? WHERE id = ?').bind(newScore, user_id).run()
    updatedScores.scripture_score = newScore
  }
  
  // 일상, 사역, 찬양, 교회, 자유 포스팅일 경우 활동 점수 10점 추가
  const activityPostColors = ['#F5D4B3', '#B3EDD8', '#C4E5F8', '#E2DBFB', '#FFFFFF']
  if (activityPostColors.includes(background_color)) {
    const user = await DB.prepare('SELECT activity_score FROM users WHERE id = ?').bind(user_id).first()
    const currentScore = user?.activity_score || 0
    const newScore = currentScore + 10
    await DB.prepare('UPDATE users SET activity_score = ? WHERE id = ?').bind(newScore, user_id).run()
    updatedScores.activity_score = newScore
  }
  
  // 다른 사람의 포스팅을 공유한 경우 해당 카테고리 점수 5점 추가
  if (shared_post_id) {
    const originalPost = await DB.prepare('SELECT user_id, background_color FROM posts WHERE id = ?').bind(shared_post_id).first()
    
    // 원저자와 공유자가 다른 경우에만 점수 부여
    if (originalPost && originalPost.user_id !== user_id) {
      // 원본 포스트의 배경색에 따라 점수 카테고리 결정
      let scoreField = 'activity_score'
      if (originalPost.background_color === '#F87171') {
        // 기도 포스팅 공유 -> 기도 점수
        scoreField = 'prayer_score'
      } else if (originalPost.background_color === '#F5E398') {
        // 말씀 포스팅 공유 -> 성경 점수
        scoreField = 'scripture_score'
      } else {
        // 활동 포스팅 공유 -> 활동 점수
        scoreField = 'activity_score'
      }
      
      const user = await DB.prepare(`SELECT ${scoreField} FROM users WHERE id = ?`).bind(user_id).first()
      const currentScore = user?.[scoreField] || 0
      const newScore = currentScore + 5
      await DB.prepare(`UPDATE users SET ${scoreField} = ? WHERE id = ?`).bind(newScore, user_id).run()
      updatedScores[scoreField] = newScore
    }
  }
  
  return c.json({ id: result.meta.last_row_id, user_id, content, visibility_scope: scope, ...updatedScores }, 201)
})

// Upload post image
app.post('/api/posts/:id/image', async (c) => {
  const { DB, R2 } = c.env
  const postId = c.req.param('id')
  
  try {
    const formData = await c.req.formData()
    const file = formData.get('image')
    const orderRaw = formData.get('order')
    const order = Number(orderRaw)
    
    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file uploaded' }, 400)
    }
    
    // Check file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      return c.json({ error: 'File too large (max 10MB)' }, 400)
    }
    
    // Check file type
    if (!file.type.startsWith('image/')) {
      return c.json({ error: 'Invalid file type' }, 400)
    }
    
    // Generate unique filename
    const ext = file.name.split('.').pop()
    const filename = `${postId}-${Date.now()}.${ext}`
    const fullPath = `posts/${filename}`
    
    // Upload to R2
    const arrayBuffer = await file.arrayBuffer()
    await R2.put(fullPath, arrayBuffer, {
      httpMetadata: {
        contentType: file.type
      }
    })
    
    // Update post image_url in database (단일/다중 호환: 최대 4장 누적 저장)
    const imageUrl = `/api/images/posts/${filename}`
    const postRow = await DB.prepare('SELECT image_url FROM posts WHERE id = ?').bind(postId).first()
    const rawImageUrl = postRow?.image_url ? String(postRow.image_url) : ''
    let imageUrls: string[] = []
    if (rawImageUrl) {
      try {
        const parsed = JSON.parse(rawImageUrl)
        if (Array.isArray(parsed)) {
          imageUrls = parsed.map((v: any) => String(v || '')).filter(Boolean)
        } else {
          imageUrls = [rawImageUrl]
        }
      } catch (_) {
        imageUrls = [rawImageUrl]
      }
    }
    if (Number.isFinite(order) && order >= 0) {
      const idx = Math.min(3, Math.floor(order))
      while (imageUrls.length <= idx) imageUrls.push('')
      imageUrls[idx] = imageUrl
      imageUrls = imageUrls.filter(Boolean)
    } else {
      imageUrls.push(imageUrl)
    }
    imageUrls = imageUrls.slice(0, 4)
    const imageUrlForDb = imageUrls.length === 1 ? imageUrls[0] : JSON.stringify(imageUrls)
    await DB.prepare(
      'UPDATE posts SET image_url = ? WHERE id = ?'
    ).bind(imageUrlForDb, postId).run()
    
    return c.json({ success: true, image_url: imageUrl, image_urls: imageUrls })
  } catch (error) {
    console.error('Image upload error:', error)
    return c.json({ error: 'Upload failed' }, 500)
  }
})

// Upload post video
app.post('/api/posts/:id/video', async (c) => {
  const { DB, R2 } = c.env
  const postId = c.req.param('id')
  
  try {
    const formData = await c.req.formData()
    const file = formData.get('video')
    
    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file uploaded' }, 400)
    }
    
    // Check file size (100MB)
    if (file.size > 100 * 1024 * 1024) {
      return c.json({ error: 'File too large (max 100MB)' }, 400)
    }
    
    // Check file type
    if (!file.type.startsWith('video/')) {
      return c.json({ error: 'Invalid file type' }, 400)
    }
    
    // Generate unique filename
    const ext = file.name.split('.').pop()
    const filename = `${postId}-${Date.now()}.${ext}`
    const fullPath = `videos/${filename}`
    
    // Upload to R2
    const arrayBuffer = await file.arrayBuffer()
    await R2.put(fullPath, arrayBuffer, {
      httpMetadata: {
        contentType: file.type
      }
    })
    
    // Update post video_url in database
    const videoUrl = `/api/videos/posts/${filename}`
    await DB.prepare(
      'UPDATE posts SET video_url = ? WHERE id = ?'
    ).bind(videoUrl, postId).run()
    
    return c.json({ success: true, video_url: videoUrl })
  } catch (error) {
    console.error('Video upload error:', error)
    return c.json({ error: 'Upload failed' }, 500)
  }
})

// Get post video from R2
app.get('/api/videos/posts/:filename', async (c) => {
  const safe = sanitizeR2Filename(c.req.param('filename'))
  if (!safe) return c.notFound()
  return serveR2Object(c, `videos/${safe}`)
})

// 레거시: DB에 /api/videos/:filename (posts 세그먼트 없음) 로 저장된 동영상
app.get('/api/videos/:filename', async (c) => {
  const safe = sanitizeR2Filename(c.req.param('filename'))
  if (!safe) return c.notFound()
  if (safe === 'posts') return c.notFound()
  return serveR2Object(c, `videos/${safe}`)
})

// Update post
app.put('/api/posts/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const { content, verse_reference, background_color } = await c.req.json()
  
  await DB.prepare(
    'UPDATE posts SET content = ?, verse_reference = ?, background_color = ? WHERE id = ?'
  ).bind(content, verse_reference || null, background_color || null, id).run()
  
  return c.json({ success: true })
})

// Delete post
app.delete('/api/posts/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  // 삭제 전에 포스트 정보 조회 (기도 포스팅인지, 공유 포스팅인지 확인)
  const post = await DB.prepare('SELECT user_id, background_color, shared_post_id FROM posts WHERE id = ?').bind(id).first()
  
  if (post) {
    // 기도 포스팅(중보 기도 - 빨간색 배경)이면 점수 차감
    if (post.background_color === '#F87171') {
      const user = await DB.prepare('SELECT prayer_score FROM users WHERE id = ?').bind(post.user_id).first()
      const currentScore = user?.prayer_score || 0
      const newScore = Math.max(0, currentScore - 10) // 0점 이하로 내려가지 않도록
      await DB.prepare('UPDATE users SET prayer_score = ? WHERE id = ?').bind(newScore, post.user_id).run()
    }
    
    // 말씀 포스팅(노란색 배경)이면 성경 점수 차감
    if (post.background_color === '#F5E398') {
      const user = await DB.prepare('SELECT scripture_score FROM users WHERE id = ?').bind(post.user_id).first()
      const currentScore = user?.scripture_score || 0
      const newScore = Math.max(0, currentScore - 10) // 0점 이하로 내려가지 않도록
      await DB.prepare('UPDATE users SET scripture_score = ? WHERE id = ?').bind(newScore, post.user_id).run()
    }
    
    // 일상, 사역, 찬양, 교회, 자유 포스팅이면 활동 점수 차감
    const activityPostColors = ['#F5D4B3', '#B3EDD8', '#C4E5F8', '#E2DBFB', '#FFFFFF']
    if (activityPostColors.includes(post.background_color)) {
      const user = await DB.prepare('SELECT activity_score FROM users WHERE id = ?').bind(post.user_id).first()
      const currentScore = user?.activity_score || 0
      const newScore = Math.max(0, currentScore - 10) // 0점 이하로 내려가지 않도록
      await DB.prepare('UPDATE users SET activity_score = ? WHERE id = ?').bind(newScore, post.user_id).run()
    }
    
    // 다른 사람의 포스팅을 공유한 경우 해당 카테고리 점수 5점 차감
    if (post.shared_post_id) {
      const originalPost = await DB.prepare('SELECT user_id, background_color FROM posts WHERE id = ?').bind(post.shared_post_id).first()
      
      // 원저자와 공유자가 다른 경우에만 점수 차감
      if (originalPost && originalPost.user_id !== post.user_id) {
        // 원본 포스트의 배경색에 따라 점수 카테고리 결정
        let scoreField = 'activity_score'
        if (originalPost.background_color === '#F87171') {
          // 기도 포스팅 공유 -> 기도 점수
          scoreField = 'prayer_score'
        } else if (originalPost.background_color === '#F5E398') {
          // 말씀 포스팅 공유 -> 성경 점수
          scoreField = 'scripture_score'
        } else {
          // 활동 포스팅 공유 -> 활동 점수
          scoreField = 'activity_score'
        }
        
        const user = await DB.prepare(`SELECT ${scoreField} FROM users WHERE id = ?`).bind(post.user_id).first()
        const currentScore = user?.[scoreField] || 0
        const newScore = Math.max(0, currentScore - 5) // 0점 이하로 내려가지 않도록
        await DB.prepare(`UPDATE users SET ${scoreField} = ? WHERE id = ?`).bind(newScore, post.user_id).run()
      }
    }
  }
  
  // Delete related records first to avoid FOREIGN KEY constraint errors
  
  // 0. Remove shared_post_id references from other posts that share this post
  await DB.prepare('UPDATE posts SET shared_post_id = NULL WHERE shared_post_id = ?').bind(id).run()
  
  // 1. Delete comment likes for all comments on this post
  await DB.prepare(`
    DELETE FROM comment_likes 
    WHERE comment_id IN (SELECT id FROM comments WHERE post_id = ?)
  `).bind(id).run()
  
  // 2. Delete comments
  await DB.prepare('DELETE FROM comments WHERE post_id = ?').bind(id).run()
  
  // 3. Delete likes
  await DB.prepare('DELETE FROM likes WHERE post_id = ?').bind(id).run()
  
  // 4. Delete prayer clicks
  await DB.prepare('DELETE FROM prayer_clicks WHERE post_id = ?').bind(id).run()
  
  // 5. Delete notifications related to this post
  await DB.prepare('DELETE FROM notifications WHERE post_id = ?').bind(id).run()
  
  // 6. Finally, delete the post
  await DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run()
  
  return c.json({ success: true })
})

// =====================
// API Routes - Comments
// =====================

// Get comments for a post
app.get('/api/posts/:id/comments', async (c) => {
  const { DB } = c.env
  const postId = c.req.param('id')
  const currentUserId = c.req.query('user_id') // For checking if current user liked the comment
  
  const { results } = await DB.prepare(`
    SELECT 
      c.*,
      u.name as user_name,
      u.avatar_url as user_avatar,
      u.role as user_role,
      (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id) as likes_count,
      (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id AND user_id = ?) as is_liked
    FROM comments c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE c.post_id = ?
    ORDER BY c.created_at ASC
  `).bind(currentUserId || 0, postId).all()
  
  return c.json({ comments: results })
})

// Create new comment
app.post('/api/posts/:id/comments', async (c) => {
  const { DB } = c.env
  const postId = c.req.param('id')
  const { user_id, content } = await c.req.json()
  
  // Get post author and background color
  const post = await DB.prepare('SELECT user_id, background_color FROM posts WHERE id = ?').bind(postId).first()
  
  const result = await DB.prepare(
    'INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)'
  ).bind(postId, user_id, content).run()
  
  let updatedScores = {}
  
  // 포스트 타입에 따라 점수 카테고리 결정
  let scoreField = 'activity_score'
  if (post.background_color === '#F87171') {
    // 기도 포스팅 댓글 -> 기도 점수
    scoreField = 'prayer_score'
  } else if (post.background_color === '#F5E398') {
    // 말씀 포스팅 댓글 -> 성경 점수
    scoreField = 'scripture_score'
  } else {
    // 활동 포스팅 댓글 -> 활동 점수
    scoreField = 'activity_score'
  }
  
  // 댓글 작성자에게 해당 카테고리 점수 5점 추가
  const commenter = await DB.prepare(`SELECT ${scoreField} FROM users WHERE id = ?`).bind(user_id).first()
  const commenterScore = commenter?.[scoreField] || 0
  const newCommenterScore = commenterScore + 5
  await DB.prepare(`UPDATE users SET ${scoreField} = ? WHERE id = ?`).bind(newCommenterScore, user_id).run()
  updatedScores[scoreField] = newCommenterScore
  
  // 포스트 작성자에게도 해당 카테고리 점수 5점 추가 (자기 포스트에 댓글 단 경우 제외)
  if (post && post.user_id !== user_id) {
    const author = await DB.prepare(`SELECT ${scoreField} FROM users WHERE id = ?`).bind(post.user_id).first()
    const authorScore = author?.[scoreField] || 0
    const newAuthorScore = authorScore + 5
    await DB.prepare(`UPDATE users SET ${scoreField} = ? WHERE id = ?`).bind(newAuthorScore, post.user_id).run()
    
    // Create notification for post author
    const now = new Date().toISOString()
    await DB.prepare(`
      INSERT INTO notifications (user_id, from_user_id, type, post_id, comment_id, created_at)
      VALUES (?, ?, 'comment', ?, ?, ?)
    `).bind(post.user_id, user_id, postId, result.meta.last_row_id, now).run()
  }
  
  return c.json({ id: result.meta.last_row_id, post_id: postId, user_id, content, updated_scores: updatedScores }, 201)
})

// Update comment
app.put('/api/comments/:id', async (c) => {
  const { DB } = c.env
  const commentId = c.req.param('id')
  const { content } = await c.req.json()
  
  await DB.prepare(
    'UPDATE comments SET content = ? WHERE id = ?'
  ).bind(content, commentId).run()
  
  return c.json({ success: true })
})

// Delete comment
app.delete('/api/comments/:id', async (c) => {
  const { DB } = c.env
  const commentId = c.req.param('id')
  
  // 댓글 정보 조회 (사용자 ID와 포스트 ID 확인)
  const comment = await DB.prepare('SELECT user_id, post_id FROM comments WHERE id = ?').bind(commentId).first()
  
  // Get post author and background color
  let postAuthorId = null
  let postBackgroundColor = null
  if (comment) {
    const post = await DB.prepare('SELECT user_id, background_color FROM posts WHERE id = ?').bind(comment.post_id).first()
    if (post) {
      postAuthorId = post.user_id
      postBackgroundColor = post.background_color
    }
  }
  
  // Delete comment likes first
  await DB.prepare('DELETE FROM comment_likes WHERE comment_id = ?').bind(commentId).run()
  
  // Delete comment
  await DB.prepare('DELETE FROM comments WHERE id = ?').bind(commentId).run()
  
  // 포스트 타입에 따라 점수 카테고리 결정
  let scoreField = 'activity_score'
  if (postBackgroundColor === '#F87171') {
    // 기도 포스팅 댓글 -> 기도 점수
    scoreField = 'prayer_score'
  } else if (postBackgroundColor === '#F5E398') {
    // 말씀 포스팅 댓글 -> 성경 점수
    scoreField = 'scripture_score'
  } else {
    // 활동 포스팅 댓글 -> 활동 점수
    scoreField = 'activity_score'
  }
  
  // 댓글 작성자의 해당 카테고리 점수 5점 차감
  if (comment) {
    const commenter = await DB.prepare(`SELECT ${scoreField} FROM users WHERE id = ?`).bind(comment.user_id).first()
    const commenterScore = commenter?.[scoreField] || 0
    const newCommenterScore = Math.max(0, commenterScore - 5)
    await DB.prepare(`UPDATE users SET ${scoreField} = ? WHERE id = ?`).bind(newCommenterScore, comment.user_id).run()
    
    // 포스트 작성자의 해당 카테고리 점수 5점 차감 (자기 포스트에 댓글 단 경우 제외)
    if (postAuthorId && postAuthorId !== comment.user_id) {
      const author = await DB.prepare(`SELECT ${scoreField} FROM users WHERE id = ?`).bind(postAuthorId).first()
      const authorScore = author?.[scoreField] || 0
      const newAuthorScore = Math.max(0, authorScore - 5)
      await DB.prepare(`UPDATE users SET ${scoreField} = ? WHERE id = ?`).bind(newAuthorScore, postAuthorId).run()
    }
  }
  
  return c.json({ success: true })
})

// =====================
// API Routes - Likes
// =====================

// Toggle like on a post
app.post('/api/posts/:id/like', async (c) => {
  const { DB } = c.env
  const postId = c.req.param('id')
  const { user_id } = await c.req.json()
  
  // Get post's background color and author to determine which score to update
  const post = await DB.prepare('SELECT background_color, user_id FROM posts WHERE id = ?').bind(postId).first()
  
  // Check if already liked
  const existing = await DB.prepare(
    'SELECT id FROM likes WHERE post_id = ? AND user_id = ?'
  ).bind(postId, user_id).first()
  
  let updatedScores = {}
  
  if (existing) {
    // Unlike - deduct points from both liker and post author
    await DB.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').bind(postId, user_id).run()
    
    // 기도 포스팅이면 기도 점수 처리 (일반 반응 1점, 원저자 보너스 2점)
    if (post.background_color === '#F87171') {
      // Liker loses 1 point
      const liker = await DB.prepare('SELECT prayer_score FROM users WHERE id = ?').bind(user_id).first()
      const likerScore = liker?.prayer_score || 0
      const newLikerScore = Math.max(0, likerScore - 1)
      await DB.prepare('UPDATE users SET prayer_score = ? WHERE id = ?').bind(newLikerScore, user_id).run()
      updatedScores.prayer_score = newLikerScore
      
      // Post author loses 2 points (only if not liking own post)
      if (post.user_id !== user_id) {
        const author = await DB.prepare('SELECT prayer_score FROM users WHERE id = ?').bind(post.user_id).first()
        const authorScore = author?.prayer_score || 0
        const newAuthorScore = Math.max(0, authorScore - 2)
        await DB.prepare('UPDATE users SET prayer_score = ? WHERE id = ?').bind(newAuthorScore, post.user_id).run()
      }
    }
    // 말씀 포스팅이면 성경 점수 처리
    else if (post.background_color === '#F5E398') {
      // Liker loses 1 point
      const liker = await DB.prepare('SELECT scripture_score FROM users WHERE id = ?').bind(user_id).first()
      const likerScore = liker?.scripture_score || 0
      const newLikerScore = Math.max(0, likerScore - 1)
      await DB.prepare('UPDATE users SET scripture_score = ? WHERE id = ?').bind(newLikerScore, user_id).run()
      updatedScores.scripture_score = newLikerScore
      
      // Post author loses 2 points (only if not liking own post)
      if (post.user_id !== user_id) {
        const author = await DB.prepare('SELECT scripture_score FROM users WHERE id = ?').bind(post.user_id).first()
        const authorScore = author?.scripture_score || 0
        const newAuthorScore = Math.max(0, authorScore - 2)
        await DB.prepare('UPDATE users SET scripture_score = ? WHERE id = ?').bind(newAuthorScore, post.user_id).run()
      }
    }
    // 일상, 사역, 찬양, 교회, 자유 포스팅이면 활동 점수 처리
    else {
      const activityPostColors = ['#F5D4B3', '#B3EDD8', '#C4E5F8', '#E2DBFB', '#FFFFFF']
      if (activityPostColors.includes(post.background_color)) {
        // Liker loses 1 point
        const liker = await DB.prepare('SELECT activity_score FROM users WHERE id = ?').bind(user_id).first()
        const likerScore = liker?.activity_score || 0
        const newLikerScore = Math.max(0, likerScore - 1)
        await DB.prepare('UPDATE users SET activity_score = ? WHERE id = ?').bind(newLikerScore, user_id).run()
        updatedScores.activity_score = newLikerScore
        
        // Post author loses 2 points (only if not liking own post)
        if (post.user_id !== user_id) {
          const author = await DB.prepare('SELECT activity_score FROM users WHERE id = ?').bind(post.user_id).first()
          const authorScore = author?.activity_score || 0
          const newAuthorScore = Math.max(0, authorScore - 2)
          await DB.prepare('UPDATE users SET activity_score = ? WHERE id = ?').bind(newAuthorScore, post.user_id).run()
        }
      }
    }
    
    return c.json({ liked: false, ...updatedScores })
  } else {
    // Like - add points to both liker and post author
    await DB.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)').bind(postId, user_id).run()
    
    // 기도 포스팅이면 기도 점수 처리 (일반 반응 1점, 원저자 보너스 2점)
    if (post.background_color === '#F87171') {
      // Liker gains 1 point
      const liker = await DB.prepare('SELECT prayer_score FROM users WHERE id = ?').bind(user_id).first()
      const likerScore = liker?.prayer_score || 0
      const newLikerScore = likerScore + 1
      await DB.prepare('UPDATE users SET prayer_score = ? WHERE id = ?').bind(newLikerScore, user_id).run()
      updatedScores.prayer_score = newLikerScore
      
      // Post author gains 2 points (only if not liking own post)
      if (post.user_id !== user_id) {
        const author = await DB.prepare('SELECT prayer_score FROM users WHERE id = ?').bind(post.user_id).first()
        const authorScore = author?.prayer_score || 0
        const newAuthorScore = authorScore + 2
        await DB.prepare('UPDATE users SET prayer_score = ? WHERE id = ?').bind(newAuthorScore, post.user_id).run()
        
        // Create notification for post author
        const now = new Date().toISOString()
        await DB.prepare(`
          INSERT INTO notifications (user_id, from_user_id, type, post_id, created_at)
          VALUES (?, ?, 'like', ?, ?)
        `).bind(post.user_id, user_id, postId, now).run()
      }
    }
    // 말씀 포스팅이면 성경 점수 처리
    else if (post.background_color === '#F5E398') {
      // Liker gains 1 point
      const liker = await DB.prepare('SELECT scripture_score FROM users WHERE id = ?').bind(user_id).first()
      const likerScore = liker?.scripture_score || 0
      const newLikerScore = likerScore + 1
      await DB.prepare('UPDATE users SET scripture_score = ? WHERE id = ?').bind(newLikerScore, user_id).run()
      updatedScores.scripture_score = newLikerScore
      
      // Post author gains 2 points (only if not liking own post)
      if (post.user_id !== user_id) {
        const author = await DB.prepare('SELECT scripture_score FROM users WHERE id = ?').bind(post.user_id).first()
        const authorScore = author?.scripture_score || 0
        const newAuthorScore = authorScore + 2
        await DB.prepare('UPDATE users SET scripture_score = ? WHERE id = ?').bind(newAuthorScore, post.user_id).run()
        
        // Create notification for post author
        const now = new Date().toISOString()
        await DB.prepare(`
          INSERT INTO notifications (user_id, from_user_id, type, post_id, created_at)
          VALUES (?, ?, 'like', ?, ?)
        `).bind(post.user_id, user_id, postId, now).run()
      }
    }
    // 일상, 사역, 찬양, 교회, 자유 포스팅이면 활동 점수 처리
    else {
      const activityPostColors = ['#F5D4B3', '#B3EDD8', '#C4E5F8', '#E2DBFB', '#FFFFFF']
      if (activityPostColors.includes(post.background_color)) {
        // Liker gains 1 point
        const liker = await DB.prepare('SELECT activity_score FROM users WHERE id = ?').bind(user_id).first()
        const likerScore = liker?.activity_score || 0
        const newLikerScore = likerScore + 1
        await DB.prepare('UPDATE users SET activity_score = ? WHERE id = ?').bind(newLikerScore, user_id).run()
        updatedScores.activity_score = newLikerScore
        
        // Post author gains 2 points (only if not liking own post)
        if (post.user_id !== user_id) {
          const author = await DB.prepare('SELECT activity_score FROM users WHERE id = ?').bind(post.user_id).first()
          const authorScore = author?.activity_score || 0
          const newAuthorScore = authorScore + 2
          await DB.prepare('UPDATE users SET activity_score = ? WHERE id = ?').bind(newAuthorScore, post.user_id).run()
          
          // Create notification for post author
          const now = new Date().toISOString()
          await DB.prepare(`
            INSERT INTO notifications (user_id, from_user_id, type, post_id, created_at)
            VALUES (?, ?, 'like', ?, ?)
          `).bind(post.user_id, user_id, postId, now).run()
        }
      }
    }
    
    return c.json({ liked: true, ...updatedScores })
  }
})

// Toggle like on a comment
app.post('/api/comments/:id/like', async (c) => {
  const { DB } = c.env
  const commentId = c.req.param('id')
  const { user_id } = await c.req.json()
  
  // Check if already liked
  const existing = await DB.prepare(
    'SELECT id FROM comment_likes WHERE comment_id = ? AND user_id = ?'
  ).bind(commentId, user_id).first()
  
  if (existing) {
    // Unlike
    await DB.prepare('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?').bind(commentId, user_id).run()
    return c.json({ liked: false })
  } else {
    // Like
    await DB.prepare('INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)').bind(commentId, user_id).run()
    return c.json({ liked: true })
  }
})

// Toggle prayer on a post (for prayer request posts) - Can toggle on/off
app.post('/api/posts/:id/pray', async (c) => {
  const { DB } = c.env
  const postId = c.req.param('id')
  const { user_id } = await c.req.json()
  
  // Get post author
  const post = await DB.prepare('SELECT user_id FROM posts WHERE id = ?').bind(postId).first()
  
  // Check if already prayed
  const existing = await DB.prepare(
    'SELECT id FROM prayer_clicks WHERE post_id = ? AND user_id = ?'
  ).bind(postId, user_id).first()
  
  if (existing) {
    // Cancel prayer - remove from database and deduct points
    await DB.prepare('DELETE FROM prayer_clicks WHERE post_id = ? AND user_id = ?').bind(postId, user_id).run()
    
    // Deduct 20 points from prayer clicker's prayer score
    const clicker = await DB.prepare('SELECT prayer_score FROM users WHERE id = ?').bind(user_id).first()
    const clickerScore = clicker?.prayer_score || 0
    const newClickerScore = Math.max(0, clickerScore - 20) // Don't go below 0
    await DB.prepare('UPDATE users SET prayer_score = ? WHERE id = ?').bind(newClickerScore, user_id).run()
    
    // Deduct 2 points from post author (only if not praying for own post)
    if (post.user_id !== user_id) {
      const author = await DB.prepare('SELECT prayer_score FROM users WHERE id = ?').bind(post.user_id).first()
      const authorScore = author?.prayer_score || 0
      const newAuthorScore = Math.max(0, authorScore - 2)
      await DB.prepare('UPDATE users SET prayer_score = ? WHERE id = ?').bind(newAuthorScore, post.user_id).run()
    }
    
    return c.json({ prayed: false, prayer_score: newClickerScore })
  } else {
    // Pray (기도하기) - add to database and add points
    await DB.prepare('INSERT INTO prayer_clicks (post_id, user_id) VALUES (?, ?)').bind(postId, user_id).run()
    
    // Add 20 points to prayer clicker's prayer score
    const clicker = await DB.prepare('SELECT prayer_score FROM users WHERE id = ?').bind(user_id).first()
    const clickerScore = clicker?.prayer_score || 0
    const newClickerScore = clickerScore + 20
    await DB.prepare('UPDATE users SET prayer_score = ? WHERE id = ?').bind(newClickerScore, user_id).run()
    
    // Add 2 points to post author (only if not praying for own post)
    if (post.user_id !== user_id) {
      const author = await DB.prepare('SELECT prayer_score FROM users WHERE id = ?').bind(post.user_id).first()
      const authorScore = author?.prayer_score || 0
      const newAuthorScore = authorScore + 2
      await DB.prepare('UPDATE users SET prayer_score = ? WHERE id = ?').bind(newAuthorScore, post.user_id).run()
    }
    
    return c.json({ prayed: true, prayer_score: newClickerScore })
  }
})

// =====================
// API Routes - Prayer Requests
// =====================

// Get all prayer requests
app.get('/api/prayers', async (c) => {
  const { DB } = c.env
  const status = c.req.query('status') || 'active'
  
  const { results } = await DB.prepare(`
    SELECT 
      pr.*,
      u.name as user_name,
      u.avatar_url as user_avatar,
      (SELECT COUNT(*) FROM prayer_responses WHERE prayer_request_id = pr.id) as responses_count
    FROM prayer_requests pr
    LEFT JOIN users u ON pr.user_id = u.id
    WHERE pr.status = ?
    ORDER BY pr.created_at DESC
  `).bind(status).all()
  
  return c.json({ prayers: results })
})

// Get prayer request by ID
app.get('/api/prayers/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const prayer = await DB.prepare(`
    SELECT 
      pr.*,
      u.name as user_name,
      u.avatar_url as user_avatar,
      (SELECT COUNT(*) FROM prayer_responses WHERE prayer_request_id = pr.id) as responses_count
    FROM prayer_requests pr
    LEFT JOIN users u ON pr.user_id = u.id
    WHERE pr.id = ?
  `).bind(id).first()
  
  if (!prayer) {
    return c.json({ error: 'Prayer request not found' }, 404)
  }
  
  return c.json({ prayer })
})

// Create new prayer request
app.post('/api/prayers', async (c) => {
  const { DB } = c.env
  const { user_id, title, content, is_anonymous } = await c.req.json()
  
  const result = await DB.prepare(
    'INSERT INTO prayer_requests (user_id, title, content, is_anonymous) VALUES (?, ?, ?, ?)'
  ).bind(user_id, title, content, is_anonymous ? 1 : 0).run()
  
  return c.json({ id: result.meta.last_row_id, user_id, title, content }, 201)
})

// Get responses for a prayer request
app.get('/api/prayers/:id/responses', async (c) => {
  const { DB } = c.env
  const prayerId = c.req.param('id')
  
  const { results } = await DB.prepare(`
    SELECT 
      psr.*,
      u.name as user_name,
      u.avatar_url as user_avatar
    FROM prayer_responses psr
    LEFT JOIN users u ON psr.user_id = u.id
    WHERE psr.prayer_request_id = ?
    ORDER BY psr.created_at ASC
  `).bind(prayerId).all()
  
  return c.json({ responses: results })
})

// Create new prayer response
app.post('/api/prayers/:id/responses', async (c) => {
  const { DB } = c.env
  const prayerId = c.req.param('id')
  const { user_id, content } = await c.req.json()
  
  const result = await DB.prepare(
    'INSERT INTO prayer_responses (prayer_request_id, user_id, content) VALUES (?, ?, ?)'
  ).bind(prayerId, user_id, content).run()
  
  return c.json({ id: result.meta.last_row_id, prayer_request_id: prayerId, user_id, content }, 201)
})

// =====================
// QT Bible Proxy (Duranno) + 날짜 시뮬용 랜덤 본문 (bible-api.com WEB)
// =====================

const QT_SIM_BOOK_POOL: { slug: string; chapters: number }[] = [
  { slug: 'genesis', chapters: 50 },
  { slug: 'exodus', chapters: 40 },
  { slug: 'matthew', chapters: 28 },
  { slug: 'mark', chapters: 16 },
  { slug: 'luke', chapters: 24 },
  { slug: 'john', chapters: 21 },
  { slug: 'acts', chapters: 28 },
  { slug: 'romans', chapters: 16 },
  { slug: '1 corinthians', chapters: 16 },
  { slug: 'psalms', chapters: 150 },
  { slug: 'proverbs', chapters: 31 },
  { slug: 'philippians', chapters: 4 },
  { slug: 'colossians', chapters: 4 },
  { slug: 'ephesians', chapters: 6 },
  { slug: 'hebrews', chapters: 13 },
  { slug: 'james', chapters: 5 },
  { slug: '1 peter', chapters: 5 },
  { slug: 'revelation', chapters: 22 },
]

function qtSimSeededUnit(qtDate: string, salt: number): number {
  let h = 2166136261 ^ (salt * 2654435761)
  for (let i = 0; i < qtDate.length; i++) {
    h ^= qtDate.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 16
  h = Math.imul(h, 2246822507)
  h ^= h >>> 13
  h = Math.imul(h, 3266489909)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

async function fetchQtSimBibleFromWeb(qtDate: string): Promise<{
  passageRef: string
  passageTitle: string
  reference: string
  scripture: string
}> {
  const bi = Math.floor(qtSimSeededUnit(qtDate, 11) * QT_SIM_BOOK_POOL.length)
  const book = QT_SIM_BOOK_POOL[bi]!
  const ch = 1 + Math.floor(qtSimSeededUnit(qtDate, 12) * book.chapters)
  const vStart = 1 + Math.floor(qtSimSeededUnit(qtDate, 13) * 20)
  const nVerses = 3 + Math.floor(qtSimSeededUnit(qtDate, 14) * 6)
  const vEnd = vStart + nVerses
  const bookPath = book.slug.replace(/\s+/g, '+')
  const apiUrl = `https://bible-api.com/${bookPath}+${ch}:${vStart}-${vEnd}`

  const resp = await fetch(apiUrl)
  if (!resp.ok) {
    throw new Error(`bible-api.com HTTP ${resp.status}`)
  }
  const data = (await resp.json()) as {
    reference?: string
    text?: string
    verses?: Array<{ verse: number; text: string }>
  }

  const lines: string[] = []
  if (Array.isArray(data.verses) && data.verses.length) {
    for (const v of data.verses) {
      const t = String(v.text || '')
        .replace(/\s+/g, ' ')
        .trim()
      if (t) lines.push(`${v.verse} ${t}`)
    }
  }
  const scripture =
    lines.length > 0 ? lines.join('\n') : String(data.text || '').replace(/\s+/g, ' ').trim()

  const ref = String(data.reference || '').trim()
  const passageRef = ref || `${book.slug} ${ch}:${vStart}~${vEnd}`
  const passageTitle = '날짜 시뮬 본문 (bible-api.com · World English Bible)'
  const reference = `(시뮬 · WEB 영문) ${passageRef}`

  return { passageRef, passageTitle, reference, scripture }
}

// 채널 전체 영상을 D1에 동기화 (페이지네이션으로 전체 수집)
async function syncSermonVideos(DB: D1Database, apiKey: string): Promise<number> {
  const chRes = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=hayongjo&key=${apiKey}`
  )
  const chData = await chRes.json() as { items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }
  const uploadsId = chData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
  if (!uploadsId) throw new Error('Channel not found')

  let pageToken = ''
  let totalSynced = 0

  do {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=50&key=${apiKey}${pageToken ? `&pageToken=${pageToken}` : ''}`
    const res = await fetch(url)
    const data = await res.json() as {
      nextPageToken?: string
      items?: { snippet?: { resourceId?: { videoId?: string }; title?: string; publishedAt?: string } }[]
    }
    const items = (data.items || []).filter(v => v.snippet?.resourceId?.videoId)

    if (items.length > 0) {
      const stmts = items.map(item =>
        DB.prepare('INSERT OR IGNORE INTO sermon_videos (video_id, title, published_at) VALUES (?, ?, ?)')
          .bind(
            item.snippet!.resourceId!.videoId,
            item.snippet!.title || '하용조 목사 설교',
            item.snippet!.publishedAt || ''
          )
      )
      await DB.batch(stmts)
      totalSynced += items.length
    }

    pageToken = data.nextPageToken || ''
  } while (pageToken)

  return totalSynced
}

// 오늘의 설교: D1에서 중복 없이 랜덤 선택, 없으면 YouTube API 전체 동기화
app.get('/api/sermon/today', async (c) => {
  const { DB } = c.env
  const apiKey = c.env.YOUTUBE_API_KEY
  const today = new Date().toISOString().slice(0, 10)

  try {
    // 1. 오늘 이미 배정된 영상이 있으면 바로 반환
    const assigned = await DB.prepare(
      'SELECT sv.video_id, sv.title, sv.published_at FROM sermon_daily sd JOIN sermon_videos sv ON sd.video_id = sv.video_id WHERE sd.sermon_date = ?'
    ).bind(today).first() as { video_id: string; title: string; published_at: string } | null

    if (assigned) {
      return c.json({ videoId: assigned.video_id, title: assigned.title, preacher: '하용조 목사 (온누리교회)', publishedAt: assigned.published_at })
    }

    // 2. sermon_videos 비어 있으면 YouTube API로 전체 동기화
    const countRow = await DB.prepare('SELECT COUNT(*) as cnt FROM sermon_videos').first() as { cnt: number } | null
    if (!countRow || countRow.cnt === 0) {
      if (!apiKey) return c.json({ error: 'YouTube API key not configured' }, 500)
      await syncSermonVideos(DB, apiKey)
    }

    // 3. 아직 배정 안 된 영상 중 랜덤 선택
    let chosen = await DB.prepare(
      'SELECT video_id, title, published_at FROM sermon_videos WHERE video_id NOT IN (SELECT video_id FROM sermon_daily) ORDER BY RANDOM() LIMIT 1'
    ).first() as { video_id: string; title: string; published_at: string } | null

    // 4. 모두 소진되면 sermon_daily 초기화 후 재선택
    if (!chosen) {
      await DB.prepare('DELETE FROM sermon_daily').run()
      chosen = await DB.prepare(
        'SELECT video_id, title, published_at FROM sermon_videos ORDER BY RANDOM() LIMIT 1'
      ).first() as { video_id: string; title: string; published_at: string } | null
    }

    if (!chosen) return c.json({ error: 'No videos available' }, 404)

    // 5. 오늘 날짜에 배정 저장
    await retryD1(() =>
      DB.prepare('INSERT OR REPLACE INTO sermon_daily (sermon_date, video_id) VALUES (?, ?)').bind(today, chosen!.video_id).run()
    )

    return c.json({ videoId: chosen.video_id, title: chosen.title, preacher: '하용조 목사 (온누리교회)', publishedAt: chosen.published_at })
  } catch (e) {
    console.error('[sermon/today]', e)
    return c.json({ error: 'Failed to fetch sermon' }, 500)
  }
})

app.get('/api/qt/bible', async (c) => {
  const qtDateRaw = c.req.query('qtDate')
  if (!qtDateRaw || typeof qtDateRaw !== 'string') {
    return c.json({ error: 'qtDate is required' }, 400)
  }

  // Accept: YYYY-MM-DD or YYYYMMDD
  let qtDate = qtDateRaw.trim()
  if (/^\d{8}$/.test(qtDate)) {
    qtDate = `${qtDate.slice(0, 4)}-${qtDate.slice(4, 6)}-${qtDate.slice(6, 8)}`
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(qtDate)) {
    return c.json({ error: 'qtDate format must be YYYY-MM-DD' }, 400)
  }

  const simRaw = c.req.query('sim')
  const useSim = simRaw === '1' || simRaw === 'true'
  if (useSim) {
    try {
      const parts = await fetchQtSimBibleFromWeb(qtDate)
      c.header('Cache-Control', 'private, no-store')
      return c.json({ qtDate, ...parts, sim: true })
    } catch (e) {
      console.error('qt sim bible', e)
      return c.json(
        {
          error: 'Failed to fetch sim bible',
          qtDate,
          detail: e instanceof Error ? e.message : String(e),
        },
        502
      )
    }
  }

  const url = `https://www.duranno.com/qt/view/bible.asp?qtDate=${encodeURIComponent(qtDate)}`

  const resp = await fetch(url)
  if (!resp.ok) {
    return c.json({ error: 'Failed to fetch duranno bible', status: resp.status, qtDate }, 502)
  }

  const buf = await resp.arrayBuffer()
  // Duranno uses EUC-KR
  const decoded = new TextDecoder('euc-kr').decode(buf)

  function decodeHtmlText(s: string) {
    return String(s || '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
  }

  // Page header passage reference (e.g. "마태복음 26 : 14~25") + title (optional)
  // e.g. <div class="font-size"><h1><span>마태복음  26 : 14~25</span><em>...</em></h1>
  const h1Match = decoded.match(/<div[^>]*class="font-size"[^>]*>[\s\S]*?<h1[^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>\s*<em>([\s\S]*?)<\/em>[\s\S]*?<\/h1>/i)
  const passageRef = h1Match ? decodeHtmlText(h1Match[1]) : ''
  const passageTitle = h1Match ? decodeHtmlText(h1Match[2]) : ''

  // Reference title (e.g. "예수님과 은 삼십 26:14~16")
  const titleMatch = decoded.match(/<p class="title">([\s\S]*?)<\/p>/)
  const reference = titleMatch ? decodeHtmlText(titleMatch[1]) : ''

  // Extract only bible tables area
  const bibleStart = decoded.indexOf('<div class="bible">')
  if (bibleStart < 0) return c.json({ error: 'Bible block not found', qtDate }, 502)

  const bibleEnd = decoded.indexOf('아멘하기', bibleStart)
  const bibleHtml = decoded.slice(bibleStart, bibleEnd > bibleStart ? bibleEnd : undefined)

  const tableRe =
    /<table>\s*<tr>\s*<th>\s*([^<]+)\s*<\/th>\s*<td[^>]*>\s*([\s\S]*?)<\/td>\s*<\/tr>\s*<\/table>/g

  const lines: string[] = []
  let m: RegExpExecArray | null
  while ((m = tableRe.exec(bibleHtml)) && lines.length < 500) {
    const verseNo = String(m[1] || '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    let td = String(m[2] || '')
    td = td.replace(/<[^>]+>/g, '') // strip tags inside td
    td = td
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()

    if (verseNo && td) lines.push(`${verseNo} ${td}`)
  }

  // Fallback: if parsing failed, just strip tags from the extracted bible block
  const scripture = lines.length
    ? lines.join('\n')
    : bibleHtml
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim()

  return c.json({ qtDate, passageRef, passageTitle, reference, scripture })
})

// =====================
// QT diary logs (적용 / 마침기도)
// =====================
app.get('/api/qt/logs', async (c) => {
  const { DB } = c.env
  const userId = Number(c.req.query('user_id') || 0)
  if (!userId) return c.json({ error: 'user_id required' }, 400)

  const { results } = await DB.prepare(
    `SELECT id, user_id, qt_date, apply_text, closing_prayer_text, verse_reference_raw, apply_post_id, closing_post_id, created_at, updated_at
     FROM qt_logs WHERE user_id = ? ORDER BY qt_date DESC`
  )
    .bind(userId)
    .all()

  const logs = (results || []).map((row: Record<string, unknown>) => ({
    ...row,
    qt_date: String(row.qt_date ?? '')
      .trim()
      .slice(0, 10)
  }))

  c.header('Cache-Control', 'private, no-store, max-age=0')
  c.header('Pragma', 'no-cache')
  return c.json({ logs })
})

app.post('/api/qt/logs/upsert', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const userId = Number(body.user_id || 0)
  const qtDate = String(body.qt_date || '').trim()
  if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(qtDate)) {
    return c.json({ error: 'user_id and qt_date (YYYY-MM-DD) required' }, 400)
  }

  const existing = (await DB.prepare('SELECT * FROM qt_logs WHERE user_id = ? AND qt_date = ?').bind(userId, qtDate).first()) as Record<string, unknown> | null

  const nextApply = body.apply_text !== undefined ? String(body.apply_text) : (existing?.apply_text != null ? String(existing.apply_text) : '')
  const nextClose =
    body.closing_prayer_text !== undefined
      ? String(body.closing_prayer_text)
      : existing?.closing_prayer_text != null
        ? String(existing.closing_prayer_text)
        : ''
  const nextVerse =
    body.verse_reference_raw !== undefined
      ? String(body.verse_reference_raw || '')
      : existing?.verse_reference_raw != null
        ? String(existing.verse_reference_raw)
        : ''
  const nextApplyPost =
    body.apply_post_id !== undefined ? (body.apply_post_id == null ? null : Number(body.apply_post_id)) : existing?.apply_post_id != null ? Number(existing.apply_post_id) : null
  const nextClosePost =
    body.closing_post_id !== undefined
      ? body.closing_post_id == null
        ? null
        : Number(body.closing_post_id)
      : existing?.closing_post_id != null
        ? Number(existing.closing_post_id)
        : null

  if (!nextApply.trim() && !nextClose.trim()) {
    return c.json({ error: 'apply_text or closing_prayer_text required' }, 400)
  }

  if (existing) {
    await DB.prepare(
      `UPDATE qt_logs SET apply_text = ?, closing_prayer_text = ?, verse_reference_raw = ?, apply_post_id = ?, closing_post_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(
        nextApply || null,
        nextClose || null,
        nextVerse || null,
        nextApplyPost,
        nextClosePost,
        existing.id
      )
      .run()
    const row = await DB.prepare(
      `SELECT id, user_id, qt_date, apply_text, closing_prayer_text, verse_reference_raw, apply_post_id, closing_post_id, created_at, updated_at FROM qt_logs WHERE id = ?`
    )
      .bind(existing.id)
      .first()
    c.header('Cache-Control', 'private, no-store')
    return c.json({ log: row })
  }

  const ins = await DB.prepare(
    `INSERT INTO qt_logs (user_id, qt_date, apply_text, closing_prayer_text, verse_reference_raw, apply_post_id, closing_post_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  )
    .bind(userId, qtDate, nextApply || null, nextClose || null, nextVerse || null, nextApplyPost, nextClosePost)
    .run()

  const row = await DB.prepare(
    `SELECT id, user_id, qt_date, apply_text, closing_prayer_text, verse_reference_raw, apply_post_id, closing_post_id, created_at, updated_at FROM qt_logs WHERE id = ?`
  )
    .bind(ins.meta.last_row_id)
    .first()
  c.header('Cache-Control', 'private, no-store')
  return c.json({ log: row })
})

/** JSON POST 삭제 — 일부 환경에서 DELETE/쿼리가 불안정할 때 사용 */
app.post('/api/qt/logs/remove', async (c) => {
  const { DB } = c.env
  const body = (await c.req.json().catch(() => ({}))) as { id?: number | string; actor_user_id?: number | string }
  const id = Number(body?.id || 0)
  const actorId = Number(body?.actor_user_id || 0)
  if (!id || !actorId) return c.json({ error: 'id and actor_user_id required' }, 400)

  const log = (await DB.prepare('SELECT user_id FROM qt_logs WHERE id = ?').bind(id).first()) as { user_id: number } | null
  if (!log) return c.json({ error: 'Not found' }, 404)

  const actor = (await DB.prepare('SELECT role FROM users WHERE id = ?').bind(actorId).first()) as { role: string } | null
  if (!actor) return c.json({ error: 'Actor not found' }, 404)

  const logOwnerId = Number(log.user_id)
  const isOwner = logOwnerId === actorId
  const isStaff = actor.role === 'admin' || actor.role === 'moderator'
  if (!isOwner && !isStaff) return c.json({ error: 'Forbidden' }, 403)

  await DB.prepare('DELETE FROM qt_logs WHERE id = ?').bind(id).run()
  c.header('Cache-Control', 'private, no-store')
  return c.json({ success: true })
})

app.delete('/api/qt/logs/:id', async (c) => {
  const { DB } = c.env
  const id = Number(c.req.param('id') || 0)
  let actorId = Number(c.req.query('actor_user_id') || 0)
  if (!actorId) {
    try {
      const body = (await c.req.json()) as { actor_user_id?: number | string }
      actorId = Number(body?.actor_user_id || 0)
    } catch {
      // DELETE 본문이 없거나 JSON이 아닌 환경 대비
    }
  }
  if (!id || !actorId) return c.json({ error: 'id and actor_user_id required' }, 400)

  const log = (await DB.prepare('SELECT user_id FROM qt_logs WHERE id = ?').bind(id).first()) as { user_id: number } | null
  if (!log) return c.json({ error: 'Not found' }, 404)

  const actor = (await DB.prepare('SELECT role FROM users WHERE id = ?').bind(actorId).first()) as { role: string } | null
  if (!actor) return c.json({ error: 'Actor not found' }, 404)

  const logOwnerId = Number(log.user_id)
  const isOwner = logOwnerId === actorId
  const isStaff = actor.role === 'admin' || actor.role === 'moderator'
  if (!isOwner && !isStaff) return c.json({ error: 'Forbidden' }, 403)

  await DB.prepare('DELETE FROM qt_logs WHERE id = ?').bind(id).run()
  c.header('Cache-Control', 'private, no-store')
  return c.json({ success: true })
})

// =====================
// User Scores API Routes
// =====================

// Get user scores
app.get('/api/users/:id/scores', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('id')
  
  const user = await DB.prepare(
    'SELECT scripture_score, prayer_score, activity_score, completed_videos, completed_verses FROM users WHERE id = ?'
  ).bind(userId).first()
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }
  
  // Parse completed_videos JSON
  let completedVideos = []
  try {
    completedVideos = JSON.parse(user.completed_videos || '[]')
  } catch (e) {
    completedVideos = []
  }
  
  // Parse completed_verses JSON
  let completedVerses = []
  try {
    completedVerses = JSON.parse(user.completed_verses || '[]')
  } catch (e) {
    completedVerses = []
  }
  
  const totalScore = (user.scripture_score || 0) + (user.prayer_score || 0)
  
  return c.json({
    scripture_score: user.scripture_score || 0,
    prayer_score: user.prayer_score || 0,
    activity_score: user.activity_score || 0,
    total_score: totalScore,
    completed_videos: completedVideos,
    completed_verses: completedVerses
  })
})

// Update scripture (typing) score
app.post('/api/users/:id/scores/typing', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('id')
  const { score, completed_verses } = await c.req.json()
  
  // Prepare SQL update
  if (completed_verses !== undefined) {
    // Update both score and completed verses
    await DB.prepare(
      'UPDATE users SET scripture_score = ?, completed_verses = ? WHERE id = ?'
    ).bind(score, JSON.stringify(completed_verses), userId).run()
  } else {
    // Update only score
    await DB.prepare(
      'UPDATE users SET scripture_score = ? WHERE id = ?'
    ).bind(score, userId).run()
  }
  
  return c.json({ success: true, scripture_score: score })
})

// Update video score and completed videos (when fully completed)
app.post('/api/users/:id/scores/video', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('id')
  const { video_id } = await c.req.json()
  
  // Get current completed videos and score
  const user = await DB.prepare(
    'SELECT completed_videos, scripture_score FROM users WHERE id = ?'
  ).bind(userId).first()
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }
  
  let completedVideos = []
  try {
    completedVideos = JSON.parse(user?.completed_videos || '[]')
  } catch (e) {
    completedVideos = []
  }
  
  // Check if this video is already completed
  const existingVideo = completedVideos.find((v: any) => 
    typeof v === 'string' ? v === video_id : v.video_id === video_id
  )
  
  // If already completed, return current score without adding points
  if (existingVideo && existingVideo.completed) {
    return c.json({ 
      success: true, 
      scripture_score: user.scripture_score,
      completed_videos: completedVideos,
      already_completed: true,
      message: '이미 시청 완료한 설교입니다. 점수는 한 번만 지급됩니다.'
    })
  }
  
  // Calculate new score (add 100 points)
  const currentScore = parseInt(user.scripture_score) || 0
  const newScore = currentScore + 100
  
  const existingIndex = completedVideos.findIndex((v: any) => 
    typeof v === 'string' ? v === video_id : v.video_id === video_id
  )
  
  if (existingIndex >= 0) {
    // Update existing entry to completed
    completedVideos[existingIndex] = {
      video_id,
      progress: 100,
      max_watched: 100,
      completed: true,
      completed_at: new Date().toISOString()
    }
  } else {
    // Add new completed video
    completedVideos.push({
      video_id,
      progress: 100,
      max_watched: 100,
      completed: true,
      completed_at: new Date().toISOString()
    })
  }
  
  // Update with new score
  await DB.prepare(
    'UPDATE users SET scripture_score = ?, completed_videos = ? WHERE id = ?'
  ).bind(newScore, JSON.stringify(completedVideos), userId).run()
  
  return c.json({ 
    success: true, 
    scripture_score: newScore,
    completed_videos: completedVideos,
    already_completed: false,
    points_earned: 100,
    message: '설교 시청 완료! 성경 점수 +100점'
  })
})

// Update video progress (for tracking ongoing progress)
app.post('/api/users/:id/videos/:videoId/progress', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('id')
  const videoId = c.req.param('videoId')
  const { progress, max_watched } = await c.req.json()
  
  // Get current completed videos
  const user = await DB.prepare(
    'SELECT completed_videos FROM users WHERE id = ?'
  ).bind(userId).first()
  
  let completedVideos = []
  try {
    completedVideos = JSON.parse(user?.completed_videos || '[]')
  } catch (e) {
    completedVideos = []
  }
  
  // Find if this video already exists
  const existingIndex = completedVideos.findIndex((v: any) => 
    typeof v === 'string' ? v === videoId : v.video_id === videoId
  )
  
  if (existingIndex >= 0) {
    // Update existing entry
    const existing = completedVideos[existingIndex]
    if (typeof existing === 'string') {
      // Old format, convert to new format
      completedVideos[existingIndex] = {
        video_id: videoId,
        progress,
        max_watched,
        completed: true,
        completed_at: new Date().toISOString()
      }
    } else {
      // Update progress
      existing.progress = progress
      existing.max_watched = Math.max(existing.max_watched || 0, max_watched)
      existing.updated_at = new Date().toISOString()
    }
  } else {
    // Add new progress entry
    completedVideos.push({
      video_id: videoId,
      progress,
      max_watched,
      completed: false,
      started_at: new Date().toISOString()
    })
  }
  
  await DB.prepare(
    'UPDATE users SET completed_videos = ? WHERE id = ?'
  ).bind(JSON.stringify(completedVideos), userId).run()
  
  return c.json({ 
    success: true,
    video_id: videoId,
    progress,
    max_watched
  })
})

// Add prayer points
app.post('/api/users/:id/scores/prayer', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('id')
  const { points } = await c.req.json()
  
  // Get current prayer score
  const user = await DB.prepare(
    'SELECT prayer_score FROM users WHERE id = ?'
  ).bind(userId).first()
  
  const currentScore = user?.prayer_score || 0
  const newScore = currentScore + points
  
  // Update prayer score
  await DB.prepare(
    'UPDATE users SET prayer_score = ? WHERE id = ?'
  ).bind(newScore, userId).run()
  
  return c.json({ 
    success: true, 
    prayer_score: newScore,
    points_earned: points
  })
})

// Add activity points
app.post('/api/users/:id/scores/activity', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('id')
  const { points } = await c.req.json()
  
  // Get current activity score
  const user = await DB.prepare(
    'SELECT activity_score FROM users WHERE id = ?'
  ).bind(userId).first()
  
  const currentScore = user?.activity_score || 0
  const newScore = currentScore + points
  
  // Update activity score
  await DB.prepare(
    'UPDATE users SET activity_score = ? WHERE id = ?'
  ).bind(newScore, userId).run()
  
  return c.json({ 
    success: true, 
    activity_score: newScore,
    points_earned: points
  })
})

// Add scripture (bible) points
app.post('/api/users/:id/scores/scripture', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('id')
  const { points } = await c.req.json()
  
  // Get current scripture score
  const user = await DB.prepare(
    'SELECT scripture_score FROM users WHERE id = ?'
  ).bind(userId).first()
  
  const currentScore = user?.scripture_score || 0
  const newScore = currentScore + points
  
  // Update scripture score
  await DB.prepare(
    'UPDATE users SET scripture_score = ? WHERE id = ?'
  ).bind(newScore, userId).run()
  
  return c.json({ 
    success: true, 
    scripture_score: newScore,
    points_earned: points
  })
})

// =====================
// Admin API Routes
// =====================

// Middleware: Check if user is admin
const requireAdmin = async (c: any, next: any) => {
  const adminId = c.req.header('X-Admin-ID')
  
  if (!adminId) {
    return c.json({ error: 'Unauthorized - Admin ID required' }, 401)
  }
  
  const { DB } = c.env
  const user = await DB.prepare('SELECT role FROM users WHERE id = ?').bind(adminId).first()
  
  if (!user || user.role !== 'admin') {
    return c.json({ error: 'Forbidden - Admin access required' }, 403)
  }
  
  await next()
}

// 관리자용: 채널 영상 수동 동기화
app.post('/api/sermon/sync', requireAdmin, async (c) => {
  const apiKey = c.env.YOUTUBE_API_KEY
  if (!apiKey) return c.json({ error: 'YouTube API key not configured' }, 500)
  try {
    const count = await syncSermonVideos(c.env.DB, apiKey)
    const total = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM sermon_videos').first() as { cnt: number }
    return c.json({ synced: count, total: total.cnt })
  } catch (e) {
    console.error('[sermon/sync]', e)
    return c.json({ error: String(e) }, 500)
  }
})

// Push notification endpoints
app.get('/api/push/vapid-public', (c) => {
  const key = c.env.VAPID_PUBLIC_KEY
  return key ? c.json({ publicKey: key }) : c.json({ error: 'Push not configured' }, 503)
})

app.post('/api/push/subscribe', async (c) => {
  const { DB } = c.env
  const body = await c.req.json().catch(() => ({})) as any
  const { userId, subscription } = body
  if (!userId || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return c.json({ error: 'userId and subscription required' }, 400)
  }
  try {
    await DB.prepare(`
      INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, p256dh, auth)
      VALUES (?, ?, ?, ?)
    `).bind(userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth).run()
    return c.json({ success: true })
  } catch (e) {
    console.error('Push subscribe failed:', e)
    return c.json({ error: 'Failed to save subscription' }, 500)
  }
})

app.post('/api/push/unsubscribe', async (c) => {
  const { DB } = c.env
  const body = await c.req.json().catch(() => ({})) as any
  const { userId, endpoint } = body
  if (!userId || !endpoint) return c.json({ error: 'userId and endpoint required' }, 400)
  await DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').bind(userId, endpoint).run()
  return c.json({ success: true })
})

app.get('/api/push/check/:userId', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('userId')
  const { results } = await DB.prepare(
    "SELECT id, user_id, substr(endpoint,1,50) as endpoint_preview FROM push_subscriptions WHERE user_id = ?"
  ).bind(userId).all()
  return c.json({ userId, count: results?.length ?? 0, subscriptions: results ?? [] })
})

app.delete('/api/push/reset/:userId', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('userId')
  await DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').bind(userId).run()
  return c.json({ ok: true, message: '구독 초기화됨. 알림 탭에서 푸시 켜기를 다시 눌러주세요.' })
})

// QT invite - send today's QT sample + signup link to a friend
const qtInviteVerseRef = '오늘의 QT 본문'

app.post('/api/qt-invite', async (c) => {
  const { DB, RESEND_API_KEY } = c.env
  if (!RESEND_API_KEY) return c.json({ error: '이메일 발송이 일시적으로 불가합니다. 잠시 후 다시 시도해주세요.' }, 503)
  const body = await c.req.json().catch(() => ({})) as any
  const email = (body.email || '').trim().toLowerCase()
  const inviterUserId = body.inviterUserId ? parseInt(String(body.inviterUserId), 10) : null
  if (!email) return c.json({ error: '이메일을 입력해주세요.' }, 400)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: '올바른 이메일 주소를 입력해주세요.' }, 400)
  if (!inviterUserId) return c.json({ error: '로그인 후 이용해주세요.' }, 401)

  const now = new Date()
  const kstNow = new Date(now.getTime() + 540 * 60 * 1000)
  const weekDays = ['일', '월', '화', '수', '목', '금', '토']
  const dateStr = `${kstNow.getUTCFullYear()}.${kstNow.getUTCMonth() + 1}.${kstNow.getUTCDate()} (${weekDays[kstNow.getUTCDay()]})`
  const todayDate = `${kstNow.getUTCFullYear()}-${String(kstNow.getUTCMonth() + 1).padStart(2, '0')}-${String(kstNow.getUTCDate()).padStart(2, '0')}`
  const reqOrigin = new URL(c.req.url).origin
  const origin = `${reqOrigin}/`

  // Fetch today's real QT passage reference from internal endpoint
  let verseRef = qtInviteVerseRef
  try {
    const bibleResp = await fetch(`${reqOrigin}/api/qt/bible?qtDate=${todayDate}`)
    if (bibleResp.ok) {
      const bibleData = await bibleResp.json() as any
      if (bibleData.passageRef) verseRef = bibleData.passageRef
    }
  } catch (e) {
    console.error('qt-invite bible fetch failed:', e)
  }

  const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;padding:20px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
    <div style="background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);padding:20px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:1.5rem;">📖 CROSSfriends QT</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:0.9rem;">친구가 QT를 추천해드렸습니다</p>
    </div>
    <div style="padding:24px;">
      <p style="color:#374151;margin:0 0 16px;line-height:1.6;">안녕하세요! CROSSfriends의 QT(Quiet Time)를 소개합니다. 오늘의 말씀으로 하루를 시작해보세요.</p>
      <div style="border-left:4px solid #dc2626;padding:12px 16px;margin:20px 0;background:#fef2f2;border-radius:0 8px 8px 0;">
        <p style="margin:0 0 4px;font-size:0.75rem;color:#6b7280;">${dateStr}</p>
        <p style="margin:0;font-weight:700;color:#dc2626;font-size:0.95rem;">${sanitizeText(verseRef)}</p>
      </div>
      <p style="color:#6b7280;font-size:0.875rem;margin:16px 0;">이것은 오늘의 샘플 QT입니다. 매일 새로운 말씀과 함께 찬양, 묵상, 적용, 기도까지 완전한 QT를 경험하세요.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${origin}" style="display:inline-block;background:#dc2626;color:#fff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:600;font-size:1rem;">무료 회원가입하고 QT 시작하기</a>
      </div>
      <p style="color:#9ca3af;font-size:0.8rem;margin:16px 0 0;text-align:center;">— CROSSfriends</p>
    </div>
  </div>
</body>
</html>`

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Crossfriends <noreply@crossfriends.org>',
        to: [email],
        reply_to: 'no-reply@null.invalid',
        subject: '[CROSSfriends] 친구가 QT를 추천해드렸습니다 📖',
        html: htmlBody
      })
    })
    if (!resp.ok) {
      const errText = await resp.text()
      console.error('Resend qt-invite error:', resp.status, errText)
      return c.json({ error: '이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.' }, 500)
    }
    await DB.prepare('INSERT INTO qt_invites (inviter_user_id, invited_email) VALUES (?, ?)').bind(inviterUserId, email).run()
    const inviter = await DB.prepare('SELECT activity_score FROM users WHERE id = ?').bind(inviterUserId).first() as any
    if (inviter) {
      await DB.prepare('UPDATE users SET activity_score = ? WHERE id = ?').bind((inviter.activity_score || 0) + 20, inviterUserId).run()
    }
    return c.json({ success: true, message: '초대 메일을 발송했습니다. +20μ 획득!' })
  } catch (e) {
    console.error('qt-invite error:', e)
    return c.json({ error: '이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.' }, 500)
  }
})

// General CROSSfriends invite
app.post('/api/invite', async (c) => {
  const { DB, RESEND_API_KEY } = c.env
  if (!RESEND_API_KEY) return c.json({ error: '이메일 발송이 일시적으로 불가합니다. 잠시 후 다시 시도해주세요.' }, 503)
  const body = await c.req.json().catch(() => ({})) as any
  const email = (body.email || '').trim().toLowerCase()
  const inviterUserId = body.inviterUserId ? parseInt(String(body.inviterUserId), 10) : null
  if (!email) return c.json({ error: '이메일을 입력해주세요.' }, 400)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: '올바른 이메일 주소를 입력해주세요.' }, 400)
  if (!inviterUserId) return c.json({ error: '로그인 후 이용해주세요.' }, 401)

  const inviter = await DB.prepare('SELECT name FROM users WHERE id = ?').bind(inviterUserId).first() as any
  const inviterName = inviter?.name || '친구'
  const origin = `${new URL(c.req.url).origin}/`
  const safeName = sanitizeText(inviterName)

  const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;font-family:'Segoe UI',system-ui,sans-serif;background:linear-gradient(135deg,#fef3c7 0%,#fde68a 50%,#fcd34d 100%);min-height:100vh;padding:24px;box-sizing:border-box;">
  <div style="max-width:400px;margin:0 auto;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.12);">
      <div style="background:linear-gradient(135deg,#A55148 0%,#8b3d35 100%);padding:28px 24px;text-align:center;">
        <div style="font-size:2.5rem;margin-bottom:8px;">✉️</div>
        <h1 style="margin:0;color:#fff;font-size:1.4rem;font-weight:700;letter-spacing:-0.5px;">CROSSfriends</h1>
        <p style="margin:8px 0 0;color:rgba(255,255,255,0.95);font-size:0.95rem;">${safeName}님이 초대했습니다</p>
      </div>
      <div style="padding:28px 24px;">
        <p style="color:#374151;margin:0 0 20px;line-height:1.7;font-size:0.95rem;">안녕하세요,<br><br><strong>${safeName}</strong>님이 <strong>CROSSfriends</strong>에 초대해주셨습니다. 함께 말씀을 나누고, 기도하며, 교회 친구들과 소통해보세요.</p>
        <div style="text-align:center;margin:28px 0;">
          <a href="${origin}" style="display:inline-block;background:linear-gradient(135deg,#A55148,#8b3d35);color:#fff!important;padding:14px 32px;text-decoration:none;border-radius:10px;font-weight:600;font-size:1rem;box-shadow:0 4px 14px rgba(165,81,72,0.4);">CROSSfriends와 함께</a>
        </div>
        <p style="color:#9ca3af;font-size:0.75rem;margin:16px 0 0;text-align:center;line-height:1.5;">회원가입 후 언제든 탈퇴할 수 있습니다.</p>
        <p style="color:#9ca3af;font-size:0.8rem;margin:20px 0 0;text-align:center;">— CROSSfriends</p>
      </div>
    </div>
  </div>
</body>
</html>`

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'CROSSfriends <noreply@crossfriends.org>',
        to: [email],
        reply_to: 'no-reply@null.invalid',
        subject: `[CROSSfriends] ${inviterName}님이 초대했습니다 ✉️`,
        html: htmlBody
      })
    })
    if (!resp.ok) {
      const errText = await resp.text()
      console.error('Resend invite error:', resp.status, errText)
      return c.json({ error: '이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.' }, 500)
    }
    await DB.prepare('INSERT INTO qt_invites (inviter_user_id, invited_email) VALUES (?, ?)').bind(inviterUserId, email).run()
    const inviterScore = await DB.prepare('SELECT activity_score FROM users WHERE id = ?').bind(inviterUserId).first() as any
    if (inviterScore) {
      await DB.prepare('UPDATE users SET activity_score = ? WHERE id = ?').bind((inviterScore.activity_score || 0) + 20, inviterUserId).run()
    }
    return c.json({ success: true, message: '초대 메일을 발송했습니다. +20μ 획득!' })
  } catch (e) {
    console.error('invite error:', e)
    return c.json({ error: '이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.' }, 500)
  }
})

// Admin: Get all users with statistics
app.get('/api/admin/users', requireAdmin, async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare(`
    SELECT 
      u.id, u.email, u.name, u.church, u.denomination, u.location, u.role, u.created_at,
      u.scripture_score, u.prayer_score, u.activity_score,
      (SELECT COUNT(*) FROM posts WHERE user_id = u.id) as post_count,
      (SELECT COUNT(*) FROM comments WHERE user_id = u.id) as comment_count,
      (SELECT COUNT(*) FROM prayer_requests WHERE user_id = u.id) as prayer_count
    FROM users u
    ORDER BY u.created_at DESC
  `).all()
  
  return c.json({ users: results })
})

// Admin: Update user role
app.put('/api/admin/users/:id/role', requireAdmin, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const { role } = await c.req.json()
  
  if (!['user', 'admin', 'moderator'].includes(role)) {
    return c.json({ error: 'Invalid role' }, 400)
  }
  
  await DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, id).run()
  
  return c.json({ success: true, id, role })
})

// Admin: Update user scores
app.put('/api/admin/users/:id/scores', requireAdmin, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const { scripture_score, prayer_score, activity_score } = await c.req.json()
  
  // Validate scores are numbers
  if (scripture_score !== undefined && (typeof scripture_score !== 'number' || scripture_score < 0)) {
    return c.json({ error: 'Invalid scripture_score' }, 400)
  }
  if (prayer_score !== undefined && (typeof prayer_score !== 'number' || prayer_score < 0)) {
    return c.json({ error: 'Invalid prayer_score' }, 400)
  }
  if (activity_score !== undefined && (typeof activity_score !== 'number' || activity_score < 0)) {
    return c.json({ error: 'Invalid activity_score' }, 400)
  }
  
  // Update scores
  await DB.prepare(
    'UPDATE users SET scripture_score = ?, prayer_score = ?, activity_score = ? WHERE id = ?'
  ).bind(
    scripture_score !== undefined ? scripture_score : 0,
    prayer_score !== undefined ? prayer_score : 0,
    activity_score !== undefined ? activity_score : 0,
    id
  ).run()
  
  return c.json({ 
    success: true, 
    id, 
    scripture_score, 
    prayer_score, 
    activity_score 
  })
})

// Admin: Reset all user scores to 0
app.post('/api/admin/users/reset-scores', requireAdmin, async (c) => {
  const { DB } = c.env
  
  try {
    // Reset all scores to 0 for all users
    const result = await DB.prepare(
      'UPDATE users SET scripture_score = 0, prayer_score = 0, activity_score = 0'
    ).run()
    
    // Get count of affected users
    const userCount = await DB.prepare('SELECT COUNT(*) as count FROM users').first()
    
    return c.json({ 
      success: true, 
      affected_users: userCount?.count || 0,
      message: '모든 회원의 점수가 0으로 초기화되었습니다.'
    })
  } catch (error) {
    console.error('Failed to reset scores:', error)
    return c.json({ error: '점수 초기화에 실패했습니다.' }, 500)
  }
})

// Admin: Delete user
app.delete('/api/admin/users/:id', requireAdmin, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  // Check if the user to be deleted is an admin
  const userToDelete = await DB.prepare('SELECT role FROM users WHERE id = ?').bind(id).first()
  
  if (!userToDelete) {
    return c.json({ error: 'User not found' }, 404)
  }
  
  if (userToDelete.role === 'admin') {
    return c.json({ error: '관리자 계정은 삭제할 수 없습니다.' }, 403)
  }
  
  // Delete user's data first (foreign key constraints)
  await DB.prepare('DELETE FROM prayer_responses WHERE user_id = ?').bind(id).run()
  await DB.prepare('DELETE FROM prayer_requests WHERE user_id = ?').bind(id).run()
  await DB.prepare('DELETE FROM comments WHERE user_id = ?').bind(id).run()
  await DB.prepare('DELETE FROM likes WHERE user_id = ?').bind(id).run()
  await DB.prepare('DELETE FROM posts WHERE user_id = ?').bind(id).run()
  await DB.prepare('DELETE FROM friendships WHERE user_id = ? OR friend_id = ?').bind(id, id).run()
  await DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run()
  
  return c.json({ success: true, deleted_user_id: id })
})

// Admin: Get all posts with details
app.get('/api/admin/posts', requireAdmin, async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare(`
    SELECT 
      p.*,
      u.name as user_name,
      u.email as user_email,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes_count,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count
    FROM posts p
    LEFT JOIN users u ON p.user_id = u.id
    ORDER BY p.created_at DESC
  `).all()
  
  return c.json({ posts: results })
})

// Admin: Delete post
app.delete('/api/admin/posts/:id', requireAdmin, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  // Delete related data first
  await DB.prepare('DELETE FROM comments WHERE post_id = ?').bind(id).run()
  await DB.prepare('DELETE FROM likes WHERE post_id = ?').bind(id).run()
  await DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run()
  
  return c.json({ success: true, deleted_post_id: id })
})

// Admin: Delete all posts
app.delete('/api/admin/posts', requireAdmin, async (c) => {
  const { DB } = c.env
  
  // Get count before deletion
  const countResult = await DB.prepare('SELECT COUNT(*) as count FROM posts').first()
  const deletedCount = countResult?.count || 0
  
  // Delete all related data first
  await DB.prepare('DELETE FROM comments').run()
  await DB.prepare('DELETE FROM likes').run()
  await DB.prepare('DELETE FROM comment_likes').run()
  await DB.prepare('DELETE FROM posts').run()
  
  return c.json({ success: true, deleted_count: deletedCount })
})

// Admin: Get statistics
app.get('/api/admin/stats', requireAdmin, async (c) => {
  const { DB } = c.env
  
  const userCount = await DB.prepare('SELECT COUNT(*) as count FROM users').first()
  const postCount = await DB.prepare('SELECT COUNT(*) as count FROM posts').first()
  const commentCount = await DB.prepare('SELECT COUNT(*) as count FROM comments').first()
  const prayerCount = await DB.prepare('SELECT COUNT(*) as count FROM prayer_requests').first()
  const friendshipCount = await DB.prepare('SELECT COUNT(*) as count FROM friendships').first()
  
  // Post type counts by background color
  const prayerPostCount = await DB.prepare("SELECT COUNT(*) as count FROM posts WHERE background_color = '#F87171'").first()
  const versePostCount = await DB.prepare("SELECT COUNT(*) as count FROM posts WHERE background_color = '#F5E398'").first()
  const dailyPostCount = await DB.prepare("SELECT COUNT(*) as count FROM posts WHERE background_color = '#F5D4B3'").first()
  const ministryPostCount = await DB.prepare("SELECT COUNT(*) as count FROM posts WHERE background_color = '#B3EDD8'").first()
  const praisePostCount = await DB.prepare("SELECT COUNT(*) as count FROM posts WHERE background_color = '#C4E5F8'").first()
  const churchPostCount = await DB.prepare("SELECT COUNT(*) as count FROM posts WHERE background_color = '#E2DBFB'").first()
  const freePostCount = await DB.prepare("SELECT COUNT(*) as count FROM posts WHERE background_color = '#FFFFFF' OR background_color IS NULL").first()
  
  return c.json({
    users: userCount?.count || 0,
    posts: postCount?.count || 0,
    comments: commentCount?.count || 0,
    prayers: prayerCount?.count || 0,
    friendships: friendshipCount?.count || 0,
    postTypes: {
      prayer: prayerPostCount?.count || 0,      // 중보 기도
      verse: versePostCount?.count || 0,        // 말씀
      daily: dailyPostCount?.count || 0,        // 일상
      ministry: ministryPostCount?.count || 0,  // 사역
      praise: praisePostCount?.count || 0,      // 찬양
      church: churchPostCount?.count || 0,      // 교회
      free: freePostCount?.count || 0           // 자유
    }
  })
})

// Admin: Create fake users
app.post('/api/admin/create-fake-users', requireAdmin, async (c) => {
  const { DB } = c.env
  const { count = 1 } = await c.req.json()
  
  // Korean names pool
  const lastNames = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍']
  const firstNames = ['민준', '서연', '지훈', '지우', '하은', '도윤', '서준', '수아', '예준', '시우', '하준', '윤서', '민서', '유준', '소율', '지호', '채원', '수빈', '연우', '주원']
  
  // Churches pool
  const churches = [
    '은혜교회', '사랑교회', '평강교회', '소망교회', '빛과소금교회',
    '새생명교회', '온누리교회', '영락교회', '명성교회', '충현교회',
    '광림교회', '금란교회', '강남교회', '분당교회', '안양교회'
  ]
  
  // Positions pool
  const positions = ['일반 성도', '집사', '권사', '장로', '청년부', '구역장']
  
  // Locations pool
  const locations = ['서울특별시 강남구', '서울특별시 서초구', '경기도 성남시', '경기도 수원시', '인천광역시 남동구']
  
  const createdUsers = []
  
  for (let i = 0; i < Math.min(count, 50); i++) {
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)]
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)]
    const name = lastName + firstName
    
    // 짧은 이메일 형식: fake1@cf.com, fake2@cf.com, ...
    const randomNum = Math.floor(Math.random() * 999999)
    const email = `fake${randomNum}@cf.com`
    const church = churches[Math.floor(Math.random() * churches.length)]
    const position = positions[Math.floor(Math.random() * positions.length)]
    const location = locations[Math.floor(Math.random() * locations.length)]
    const gender = Math.random() > 0.5 ? '남성' : '여성'
    
    // 랜덤 신앙 고백 생성
    const answers = ['예', '아니오', '잘모름']
    const faithAnswers = {
      q1: answers[Math.floor(Math.random() * answers.length)],
      q2: answers[Math.floor(Math.random() * answers.length)],
      q3: answers[Math.floor(Math.random() * answers.length)],
      q4: answers[Math.floor(Math.random() * answers.length)],
      q5: answers[Math.floor(Math.random() * answers.length)],
      q6: answers[Math.floor(Math.random() * answers.length)],
      q7: answers[Math.floor(Math.random() * answers.length)],
      q8: answers[Math.floor(Math.random() * answers.length)],
      q9: answers[Math.floor(Math.random() * answers.length)],
      q10: answers[Math.floor(Math.random() * answers.length)]
    }
    const faithAnswersJson = JSON.stringify(faithAnswers)
    
    try {
      const result = await DB.prepare('INSERT INTO users (email, name, church, position, location, gender, faith_answers, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(email, name, church, position, location, gender, faithAnswersJson, 'user').run()
      
      createdUsers.push({
        id: result.meta.last_row_id,
        name,
        email,
        church
      })
    } catch (error) {
      console.error('Error creating fake user:', error)
    }
  }
  
  return c.json({
    success: true,
    count: createdUsers.length,
    users: createdUsers
  })
})

// Admin: Delete fake users
app.delete('/api/admin/delete-fake-users', requireAdmin, async (c) => {
  const { DB } = c.env
  
  try {
    // Delete all users with fake or test email addresses
    const result = await DB.prepare("DELETE FROM users WHERE email LIKE 'fake%@cf.com' OR email LIKE 'test%@cf.com'").run()
    
    return c.json({
      success: true,
      deleted_count: result.meta.changes || 0
    })
  } catch (error) {
    console.error('Error deleting fake users:', error)
    return c.json({ success: false, error: 'Failed to delete fake users' }, 500)
  }
})

// Admin: Create fake posts
app.post('/api/admin/create-fake-posts', requireAdmin, async (c) => {
  const { DB } = c.env
  const { count = 1 } = await c.req.json()
  
  // Post categories with background colors
  const categories = [
    { name: '중보 기도', color: '#F87171', contents: [
      '힘든 시기를 보내고 있는 친구를 위해 기도해주세요.',
      '가족의 건강을 위해 함께 기도 부탁드립니다.',
      '취업을 준비하는 청년들을 위해 기도합니다.',
      '코로나로 어려움을 겪는 이웃을 위해 기도해요.',
      '북한 주민들의 자유를 위해 함께 기도합시다.'
    ]},
    { name: '말씀', color: '#F5E398', contents: [
      '요한복음 3:16 - 하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니',
      '시편 23:1 - 여호와는 나의 목자시니 내게 부족함이 없으리로다',
      '빌립보서 4:13 - 내게 능력 주시는 자 안에서 내가 모든 것을 할 수 있느니라',
      '로마서 8:28 - 우리가 알거니와 하나님을 사랑하는 자 곧 그의 뜻대로 부르심을 입은 자들에게는 모든 것이 합력하여 선을 이루느니라',
      '잠언 3:5-6 - 너는 마음을 다하여 여호와를 신뢰하고 네 명철을 의지하지 말라'
    ]},
    { name: '일상', color: '#F5D4B3', contents: [
      '오늘 날씨가 정말 좋네요! 산책하기 딱 좋은 날입니다.',
      '아침에 일어나서 맛있는 커피 한 잔 마셨어요 ☕',
      '주말에 가족들과 맛있는 식사 했습니다!',
      '오랜만에 친구들을 만나서 행복한 시간 보냈어요.',
      '새로운 취미를 시작했습니다. 기대되네요!'
    ]},
    { name: '사역', color: '#B3EDD8', contents: [
      '다음 주 토요일에 지역 봉사활동이 있습니다. 많은 참여 부탁드립니다!',
      '청년부 여름 수련회를 준비하고 있습니다.',
      '어린이 성경학교 교사를 모집합니다.',
      '노숙자 급식 봉사에 함께하실 분들을 찾습니다.',
      '해외 선교 후원을 위한 바자회를 진행합니다.'
    ]},
    { name: '찬양', color: '#C4E5F8', contents: [
      '오늘 예배 찬양이 너무 은혜로웠습니다! 할렐루야!',
      '이 찬양을 들으면 힘이 납니다 - "주님의 마음"',
      '새벽 기도회 찬양팀을 모집합니다.',
      '찬양으로 하루를 시작하니 마음이 평안합니다.',
      '이번 주 금요일 찬양집회에 초대합니다!'
    ]},
    { name: '교회', color: '#E2DBFB', contents: [
      '다음 주일 특별 찬양예배가 있습니다.',
      '교회 창립 30주년 감사예배 안내',
      '새가족 환영회를 준비하고 있습니다.',
      '수요 예배 시간이 변경되었습니다.',
      '교회 건축 헌금에 동참해주세요.'
    ]},
    { name: '자유', color: '#FFFFFF', contents: [
      '오늘 하루도 감사합니다!',
      '여러분의 기도 제목을 나누어주세요.',
      '추천할 만한 좋은 책이 있나요?',
      '이번 주말 날씨가 어떨까요?',
      '좋은 하루 되세요! 함께 힘내요!'
    ]}
  ]
  
  // Get all users to assign as post authors
  const users = await DB.prepare('SELECT id FROM users ORDER BY RANDOM() LIMIT 50').all()
  
  if (!users.results || users.results.length === 0) {
    return c.json({ success: false, error: 'No users found. Create users first.' }, 400)
  }
  
  const createdPosts = []
  
  for (let i = 0; i < Math.min(count, 100); i++) {
    // Randomly select category
    const category = categories[Math.floor(Math.random() * categories.length)]
    const content = category.contents[Math.floor(Math.random() * category.contents.length)]
    const user = users.results[Math.floor(Math.random() * users.results.length)]
    
    // Add verse reference for scripture posts
    const verseReference = category.name === '말씀' 
      ? content.split(' - ')[0] 
      : null
    
    try {
      const result = await DB.prepare(
        'INSERT INTO posts (user_id, content, verse_reference, background_color) VALUES (?, ?, ?, ?)'
      ).bind(user.id, content, verseReference, category.color).run()
      
      // 포스팅 생성 시 점수 업데이트 (10점)
      if (category.color === '#F87171') {
        // 중보 포스팅: 기도 점수 +10점
        const userScore = await DB.prepare('SELECT prayer_score FROM users WHERE id = ?').bind(user.id).first()
        const newScore = (userScore?.prayer_score || 0) + 10
        await DB.prepare('UPDATE users SET prayer_score = ? WHERE id = ?').bind(newScore, user.id).run()
      } else if (category.color === '#F5E398') {
        // 말씀 포스팅: 성경 점수 +10점
        const userScore = await DB.prepare('SELECT scripture_score FROM users WHERE id = ?').bind(user.id).first()
        const newScore = (userScore?.scripture_score || 0) + 10
        await DB.prepare('UPDATE users SET scripture_score = ? WHERE id = ?').bind(newScore, user.id).run()
      } else {
        // 일상/사역/찬양/교회/자유 포스팅: 활동 점수 +10점
        const userScore = await DB.prepare('SELECT activity_score FROM users WHERE id = ?').bind(user.id).first()
        const newScore = (userScore?.activity_score || 0) + 10
        await DB.prepare('UPDATE users SET activity_score = ? WHERE id = ?').bind(newScore, user.id).run()
      }
      
      createdPosts.push({
        id: result.meta.last_row_id,
        content: content.substring(0, 50) + '...',
        category: category.name
      })
    } catch (error) {
      console.error('Error creating fake post:', error)
    }
  }
  
  return c.json({
    success: true,
    count: createdPosts.length,
    posts: createdPosts
  })
})

// Admin: Create fake comments
app.post('/api/admin/create-fake-comments', requireAdmin, async (c) => {
  const { DB } = c.env
  const { count = 1 } = await c.req.json()
  
  // Comment templates
  const comments = [
    '아멘! 함께 기도합니다.',
    '은혜로운 말씀 감사합니다.',
    '좋은 글 잘 읽었습니다!',
    '저도 동감합니다.',
    '정말 공감이 가네요.',
    '축복합니다!',
    '할렐루야! 주님께 영광!',
    '감사한 나눔이네요.',
    '함께 응원합니다!',
    '기도하겠습니다.',
    '너무 좋은 내용이에요.',
    '감동받았습니다.',
    '이 글 너무 좋아요!',
    '저도 참여하고 싶습니다.',
    '정말 필요한 말씀이었어요.',
    '주님의 은혜가 함께하시길!',
    '멋진 생각입니다!',
    '감사한 마음으로 읽었습니다.',
    '하나님의 축복이 가득하시길!',
    '정말 귀한 나눔입니다.'
  ]
  
  // Get all posts
  const posts = await DB.prepare('SELECT id FROM posts ORDER BY RANDOM() LIMIT 50').all()
  
  if (!posts.results || posts.results.length === 0) {
    return c.json({ success: false, error: 'No posts found. Create posts first.' }, 400)
  }
  
  // Get all users
  const users = await DB.prepare('SELECT id FROM users ORDER BY RANDOM() LIMIT 50').all()
  
  if (!users.results || users.results.length === 0) {
    return c.json({ success: false, error: 'No users found. Create users first.' }, 400)
  }
  
  const createdComments = []
  
  for (let i = 0; i < Math.min(count, 200); i++) {
    const post = posts.results[Math.floor(Math.random() * posts.results.length)]
    const user = users.results[Math.floor(Math.random() * users.results.length)]
    const content = comments[Math.floor(Math.random() * comments.length)]
    
    try {
      const result = await DB.prepare(
        'INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)'
      ).bind(post.id, user.id, content).run()
      
      // 댓글 작성 시 활동 점수 +5점
      const userScore = await DB.prepare('SELECT activity_score FROM users WHERE id = ?').bind(user.id).first()
      const newScore = (userScore?.activity_score || 0) + 5
      await DB.prepare('UPDATE users SET activity_score = ? WHERE id = ?').bind(newScore, user.id).run()
      
      createdComments.push({
        id: result.meta.last_row_id,
        post_id: post.id,
        content
      })
    } catch (error) {
      console.error('Error creating fake comment:', error)
    }
  }
  
  return c.json({
    success: true,
    count: createdComments.length
  })
})

// Admin: Create fake likes (reactions)
app.post('/api/admin/create-fake-likes', requireAdmin, async (c) => {
  const { DB } = c.env
  const { count = 1 } = await c.req.json()
  
  // Get all posts with their background colors
  const posts = await DB.prepare('SELECT id, background_color FROM posts ORDER BY RANDOM() LIMIT 100').all()
  
  if (!posts.results || posts.results.length === 0) {
    return c.json({ success: false, error: 'No posts found. Create posts first.' }, 400)
  }
  
  // Get all users
  const users = await DB.prepare('SELECT id FROM users ORDER BY RANDOM() LIMIT 100').all()
  
  if (!users.results || users.results.length === 0) {
    return c.json({ success: false, error: 'No users found. Create users first.' }, 400)
  }
  
  const createdLikes = []
  
  for (let i = 0; i < Math.min(count, 500); i++) {
    const post = posts.results[Math.floor(Math.random() * posts.results.length)]
    const user = users.results[Math.floor(Math.random() * users.results.length)]
    
    try {
      // Check if like already exists
      const existing = await DB.prepare(
        'SELECT id FROM likes WHERE post_id = ? AND user_id = ?'
      ).bind(post.id, user.id).first()
      
      if (!existing) {
        await DB.prepare(
          'INSERT INTO likes (post_id, user_id) VALUES (?, ?)'
        ).bind(post.id, user.id).run()
        
        // 좋아요 클릭 시 점수 +1점
        if (post.background_color === '#F5E398') {
          // 말씀 포스팅: 성경 점수 +1점
          const userScore = await DB.prepare('SELECT scripture_score FROM users WHERE id = ?').bind(user.id).first()
          const newScore = (userScore?.scripture_score || 0) + 1
          await DB.prepare('UPDATE users SET scripture_score = ? WHERE id = ?').bind(newScore, user.id).run()
        } else {
          // 기타 포스팅: 활동 점수 +1점
          const activityColors = ['#F5D4B3', '#B3EDD8', '#C4E5F8', '#E2DBFB', '#FFFFFF']
          if (activityColors.includes(post.background_color)) {
            const userScore = await DB.prepare('SELECT activity_score FROM users WHERE id = ?').bind(user.id).first()
            const newScore = (userScore?.activity_score || 0) + 1
            await DB.prepare('UPDATE users SET activity_score = ? WHERE id = ?').bind(newScore, user.id).run()
          }
        }
        
        createdLikes.push({
          post_id: post.id,
          user_id: user.id
        })
      }
    } catch (error) {
      console.error('Error creating fake like:', error)
    }
  }
  
  // Also create some prayer clicks for prayer posts
  const prayerPosts = await DB.prepare(
    'SELECT id FROM posts WHERE background_color = ? ORDER BY RANDOM() LIMIT 20'
  ).bind('#F87171').all()
  
  if (prayerPosts.results && prayerPosts.results.length > 0) {
    for (let i = 0; i < Math.min(50, count / 2); i++) {
      const post = prayerPosts.results[Math.floor(Math.random() * prayerPosts.results.length)]
      const user = users.results[Math.floor(Math.random() * users.results.length)]
      
      try {
        const existing = await DB.prepare(
          'SELECT id FROM prayer_clicks WHERE post_id = ? AND user_id = ?'
        ).bind(post.id, user.id).first()
        
        if (!existing) {
          await DB.prepare(
            'INSERT INTO prayer_clicks (post_id, user_id) VALUES (?, ?)'
          ).bind(post.id, user.id).run()
          
          // 기도 반응 클릭 시 기도 점수 +20점
          const userScore = await DB.prepare('SELECT prayer_score FROM users WHERE id = ?').bind(user.id).first()
          const newScore = (userScore?.prayer_score || 0) + 20
          await DB.prepare('UPDATE users SET prayer_score = ? WHERE id = ?').bind(newScore, user.id).run()
        }
      } catch (error) {
        console.error('Error creating prayer click:', error)
      }
    }
  }
  
  return c.json({
    success: true,
    count: createdLikes.length
  })
})

// Admin: Realistic time pass simulation with organic data growth
app.post('/api/admin/simulate-time-pass', requireAdmin, async (c) => {
  const { DB } = c.env
  const { days } = await c.req.json()
  
  if (!days || days < 1 || days > 365) {
    return c.json({ success: false, error: 'Days must be between 1 and 365' }, 400)
  }
  
  const stats = {
    users_created: 0,
    posts_created: 0,
    comments_created: 0,
    likes_created: 0,
    prayers_created: 0
  }
  
  // Get existing users for content generation
  const existingUsers = await DB.prepare('SELECT id FROM users ORDER BY RANDOM() LIMIT 50').all()
  
  if (!existingUsers.results || existingUsers.results.length === 0) {
    return c.json({ success: false, error: 'No users found. Create users first.' }, 400)
  }
  
  // Helper: Random Korean names
  const lastNames = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임']
  const firstNames = ['민준', '서연', '지훈', '지우', '하은', '도윤', '서준', '수아', '예준', '시우']
  const churches = ['은혜교회', '사랑교회', '평강교회', '소망교회', '빛과소금교회', '새생명교회']
  const positions = ['평신도', '집사', '권사', '장로', '청년부']
  const genders = ['남성', '여성']
  
  // Post content templates by category
  const postTemplates = {
    prayer: ['힘든 시기를 보내고 있는 친구를 위해 기도해주세요.', '가족의 건강을 위해 함께 기도 부탁드립니다.', '취업을 준비하는 청년들을 위해 기도합니다.'],
    verse: ['요한복음 3:16 - 하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니', '시편 23:1 - 여호와는 나의 목자시니 내게 부족함이 없으리로다', '빌립보서 4:13 - 내게 능력 주시는 자 안에서 내가 모든 것을 할 수 있느니라'],
    daily: ['오늘 날씨가 정말 좋네요!', '아침에 일어나서 맛있는 커피 한 잔 마셨어요', '주말에 가족들과 맛있는 식사 했습니다!'],
    ministry: ['다음 주 토요일에 지역 봉사활동이 있습니다.', '청년부 여름 수련회를 준비하고 있습니다.', '어린이 성경학교 교사를 모집합니다.'],
    praise: ['오늘 예배 찬양이 너무 은혜로웠습니다!', '이 찬양을 들으면 힘이 납니다', '새벽 기도회 찬양팀을 모집합니다.'],
    church: ['다음 주일 특별 찬양예배가 있습니다.', '교회 창립 기념 감사예배 안내', '새가족 환영회를 준비하고 있습니다.'],
    free: ['오늘 하루도 감사합니다!', '여러분의 기도 제목을 나누어주세요.', '좋은 하루 되세요!']
  }
  
  const commentTemplates = [
    '아멘! 함께 기도합니다.', '은혜로운 말씀 감사합니다.', '좋은 글 잘 읽었습니다!',
    '저도 동감합니다.', '축복합니다!', '할렐루야!', '기도하겠습니다.', '감사한 나눔이네요.'
  ]
  
  const categories = [
    { name: 'prayer', color: '#F87171', weight: 2 },
    { name: 'verse', color: '#F5E398', weight: 3 },
    { name: 'daily', color: '#F5D4B3', weight: 2 },
    { name: 'ministry', color: '#B3EDD8', weight: 1 },
    { name: 'praise', color: '#C4E5F8', weight: 1 },
    { name: 'church', color: '#E2DBFB', weight: 1 },
    { name: 'free', color: '#FFFFFF', weight: 2 }
  ]
  
  // Simulate each day from past to present
  for (let dayOffset = days; dayOffset >= 0; dayOffset--) {
    // Organic user growth: 1-3 new users every 3-7 days
    if (dayOffset % (3 + Math.floor(Math.random() * 5)) === 0 && Math.random() > 0.3) {
      const numUsers = 1 + Math.floor(Math.random() * 3)
      
      for (let u = 0; u < numUsers; u++) {
        const name = lastNames[Math.floor(Math.random() * lastNames.length)] + 
                     firstNames[Math.floor(Math.random() * firstNames.length)]
        const email = `fake${Date.now()}${Math.floor(Math.random() * 9999)}@cf.com`
        const church = churches[Math.floor(Math.random() * churches.length)]
        const position = positions[Math.floor(Math.random() * positions.length)]
        const gender = genders[Math.floor(Math.random() * genders.length)]
        
        try {
          const result = await DB.prepare(`
            INSERT INTO users (email, name, church, position, gender, role, created_at) 
            VALUES (?, ?, ?, ?, ?, 'user', datetime('now', '-' || ? || ' days'))
          `).bind(email, name, church, position, gender, dayOffset).run()
          
          existingUsers.results.push({ id: result.meta.last_row_id })
          stats.users_created++
        } catch (error) {
          console.error('Failed to create user:', error)
        }
      }
    }
    
    // Organic post creation: 2-8 posts per day
    const dailyPosts = 2 + Math.floor(Math.random() * 7)
    
    for (let p = 0; p < dailyPosts; p++) {
      // Weighted random category selection
      const totalWeight = categories.reduce((sum, cat) => sum + cat.weight, 0)
      let random = Math.random() * totalWeight
      let selectedCategory = categories[0]
      
      for (const cat of categories) {
        random -= cat.weight
        if (random <= 0) {
          selectedCategory = cat
          break
        }
      }
      
      const user = existingUsers.results[Math.floor(Math.random() * existingUsers.results.length)]
      const templates = postTemplates[selectedCategory.name]
      const content = templates[Math.floor(Math.random() * templates.length)]
      const verseRef = selectedCategory.name === 'verse' ? content.split(' - ')[0] : null
      
      try {
        const result = await DB.prepare(`
          INSERT INTO posts (user_id, content, verse_reference, background_color, created_at)
          VALUES (?, ?, ?, ?, datetime('now', '-' || ? || ' days', '-' || ? || ' hours', '-' || ? || ' minutes'))
        `).bind(
          user.id, 
          content, 
          verseRef, 
          selectedCategory.color,
          dayOffset,
          Math.floor(Math.random() * 24), // Random hour
          Math.floor(Math.random() * 60)  // Random minute
        ).run()
        
        const postId = result.meta.last_row_id
        stats.posts_created++
        
        // Update user scores for post
        if (selectedCategory.color === '#F87171') {
          await DB.prepare('UPDATE users SET prayer_score = prayer_score + 10 WHERE id = ?').bind(user.id).run()
        } else if (selectedCategory.color === '#F5E398') {
          await DB.prepare('UPDATE users SET scripture_score = scripture_score + 10 WHERE id = ?').bind(user.id).run()
        } else {
          await DB.prepare('UPDATE users SET activity_score = activity_score + 10 WHERE id = ?').bind(user.id).run()
        }
        
        // Organic comments: 30% chance of 1-5 comments
        if (Math.random() > 0.7) {
          const numComments = 1 + Math.floor(Math.random() * 5)
          
          for (let cm = 0; cm < numComments; cm++) {
            const commenter = existingUsers.results[Math.floor(Math.random() * existingUsers.results.length)]
            const comment = commentTemplates[Math.floor(Math.random() * commentTemplates.length)]
            
            try {
              await DB.prepare(`
                INSERT INTO comments (post_id, user_id, content, created_at)
                VALUES (?, ?, ?, datetime('now', '-' || ? || ' days', '+' || ? || ' hours'))
              `).bind(
                postId,
                commenter.id,
                comment,
                dayOffset,
                Math.floor(Math.random() * 12) // Comment within 12 hours of post
              ).run()
              
              stats.comments_created++
              
              // Update commenter activity score
              await DB.prepare('UPDATE users SET activity_score = activity_score + 5 WHERE id = ?').bind(commenter.id).run()
            } catch (error) {
              console.error('Failed to create comment:', error)
            }
          }
        }
        
        // Organic likes: 40% chance of 1-10 likes
        if (Math.random() > 0.6) {
          const numLikes = 1 + Math.floor(Math.random() * 10)
          
          for (let lk = 0; lk < numLikes; lk++) {
            const liker = existingUsers.results[Math.floor(Math.random() * existingUsers.results.length)]
            
            try {
              // Check if already liked
              const existing = await DB.prepare('SELECT id FROM likes WHERE post_id = ? AND user_id = ?').bind(postId, liker.id).first()
              
              if (!existing) {
                await DB.prepare(`
                  INSERT INTO likes (post_id, user_id, created_at)
                  VALUES (?, ?, datetime('now', '-' || ? || ' days', '+' || ? || ' hours'))
                `).bind(
                  postId,
                  liker.id,
                  dayOffset,
                  Math.floor(Math.random() * 24)
                ).run()
                
                stats.likes_created++
                
                // Update liker score
                if (selectedCategory.color === '#F5E398') {
                  await DB.prepare('UPDATE users SET scripture_score = scripture_score + 1 WHERE id = ?').bind(liker.id).run()
                } else {
                  await DB.prepare('UPDATE users SET activity_score = activity_score + 1 WHERE id = ?').bind(liker.id).run()
                }
              }
            } catch (error) {
              console.error('Failed to create like:', error)
            }
          }
        }
        
        // Prayer clicks for prayer posts: 50% chance of 1-8 prayers
        if (selectedCategory.name === 'prayer' && Math.random() > 0.5) {
          const numPrayers = 1 + Math.floor(Math.random() * 8)
          
          for (let pr = 0; pr < numPrayers; pr++) {
            const prayer = existingUsers.results[Math.floor(Math.random() * existingUsers.results.length)]
            
            try {
              const existing = await DB.prepare('SELECT id FROM prayer_clicks WHERE post_id = ? AND user_id = ?').bind(postId, prayer.id).first()
              
              if (!existing) {
                await DB.prepare(`
                  INSERT INTO prayer_clicks (post_id, user_id, created_at)
                  VALUES (?, ?, datetime('now', '-' || ? || ' days', '+' || ? || ' hours'))
                `).bind(
                  postId,
                  prayer.id,
                  dayOffset,
                  Math.floor(Math.random() * 24)
                ).run()
                
                stats.prayers_created++
                
                // Update prayer score
                await DB.prepare('UPDATE users SET prayer_score = prayer_score + 20 WHERE id = ?').bind(prayer.id).run()
              }
            } catch (error) {
              console.error('Failed to create prayer click:', error)
            }
          }
        }
        
      } catch (error) {
        console.error('Failed to create post:', error)
      }
    }
  }
  
  return c.json({
    success: true,
    days: days,
    stats: stats,
    message: `${days}일간의 자연스러운 활동이 시뮬레이션되었습니다.`
  })
})

// Admin: Delete fake posts (optional - delete all posts created by fake users)
app.delete('/api/admin/delete-fake-posts', requireAdmin, async (c) => {
  const { DB } = c.env
  
  try {
    // Delete posts from fake users
    const result = await DB.prepare(`
      DELETE FROM posts WHERE user_id IN (
        SELECT id FROM users WHERE email LIKE 'fake%@cf.com'
      )
    `).run()
    
    return c.json({
      success: true,
      deleted_count: result.meta.changes || 0
    })
  } catch (error) {
    console.error('Error deleting fake posts:', error)
    return c.json({ success: false, error: 'Failed to delete fake posts' }, 500)
  }
})

// =====================
// Friendship Management APIs
// =====================

// Get user's friends list
app.get('/api/friends/:userId', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('userId')
  
  try {
    const { results } = await DB.prepare(`
      SELECT 
        u.id,
        u.name,
        u.email,
        u.avatar_url,
        u.church,
        u.denomination
      FROM friendships f
      JOIN users u ON (
        CASE 
          WHEN f.user_id = ? THEN u.id = f.friend_id
          WHEN f.friend_id = ? THEN u.id = f.user_id
        END
      )
      WHERE (f.user_id = ? OR f.friend_id = ?)
        AND f.status = 'accepted'
      ORDER BY u.name ASC
    `).bind(userId, userId, userId, userId).all()
    
    return c.json({ friends: results })
  } catch (error) {
    console.error('Failed to fetch friends:', error)
    return c.json({ error: 'Failed to fetch friends', friends: [] }, 500)
  }
})

// Check friendship status between two users
app.get('/api/friendship/status', async (c) => {
  const { DB } = c.env
  const fromUserId = Number(c.req.query('fromUserId'))
  const toUserId = Number(c.req.query('toUserId'))

  if (!Number.isFinite(fromUserId) || !Number.isFinite(toUserId)) {
    return c.json({ error: 'Invalid user ids', status: 'none' }, 400)
  }

  try {
    const row = await DB.prepare(`
      SELECT id, user_id, friend_id, status
      FROM friendships
      WHERE (user_id = ? AND friend_id = ?)
         OR (user_id = ? AND friend_id = ?)
      ORDER BY id DESC
      LIMIT 1
    `).bind(fromUserId, toUserId, toUserId, fromUserId).first()

    if (!row) {
      return c.json({ status: 'none', direction: null })
    }

    const direction = row.user_id === fromUserId ? 'outgoing' : 'incoming'
    return c.json({ status: row.status, direction, requestId: row.id })
  } catch (error) {
    console.error('Failed to fetch friendship status:', error)
    return c.json({ error: 'Failed to fetch friendship status', status: 'none' }, 500)
  }
})

// Get user's notifications
app.get('/api/notifications/:userId', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('userId')

  const mapDbNotificationRow = (n: any, extras: { preview_text?: string; friend_message_id?: number | null }) => ({
    id: n.id,
    type: n.type,
    from_user_id: n.from_user_id,
    from_user_name: n.from_user_name,
    from_user_avatar: n.from_user_avatar,
    post_id: n.post_id,
    comment_id: n.comment_id,
    post_content: n.post_content,
    preview_text: extras.preview_text ?? '',
    friend_message_id: extras.friend_message_id ?? null,
    created_at: n.created_at,
    is_read: n.is_read === 1
  })

  try {
    let dbNotifications: any[] = []
    try {
      const { results } = await DB.prepare(`
      SELECT 
        n.id,
        n.type,
        n.from_user_id,
        n.post_id,
        n.comment_id,
        n.is_read,
        n.created_at,
        n.preview_text,
        n.friend_message_id,
        u.name as from_user_name,
        u.avatar_url as from_user_avatar,
        p.content as post_content
      FROM notifications n
      JOIN users u ON u.id = n.from_user_id
      LEFT JOIN posts p ON p.id = n.post_id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 50
    `).bind(userId).all()
      dbNotifications = results || []
    } catch {
      try {
        const { results } = await DB.prepare(`
      SELECT 
        n.id,
        n.type,
        n.from_user_id,
        n.post_id,
        n.comment_id,
        n.is_read,
        n.created_at,
        n.preview_text,
        u.name as from_user_name,
        u.avatar_url as from_user_avatar,
        p.content as post_content
      FROM notifications n
      JOIN users u ON u.id = n.from_user_id
      LEFT JOIN posts p ON p.id = n.post_id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 50
    `).bind(userId).all()
        dbNotifications = results || []
      } catch {
        const { results } = await DB.prepare(`
      SELECT 
        n.id,
        n.type,
        n.from_user_id,
        n.post_id,
        n.comment_id,
        n.is_read,
        n.created_at,
        u.name as from_user_name,
        u.avatar_url as from_user_avatar,
        p.content as post_content
      FROM notifications n
      JOIN users u ON u.id = n.from_user_id
      LEFT JOIN posts p ON p.id = n.post_id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 50
    `).bind(userId).all()
        dbNotifications = results || []
      }
    }
    
    // Get friend requests (pending friendships)
    const { results: friendRequests } = await DB.prepare(`
      SELECT 
        f.id,
        f.user_id,
        f.friend_id,
        f.created_at,
        u.name,
        u.email,
        u.avatar_url
      FROM friendships f
      JOIN users u ON u.id = f.user_id
      WHERE f.friend_id = ? AND f.status = 'pending'
      ORDER BY f.created_at DESC
    `).bind(userId).all()
    
    // Convert friend requests to notification format
    const friendRequestNotifications = friendRequests.map((req: any) => ({
      id: req.id,
      type: 'friend_request',
      from_user_id: req.user_id,
      from_user_name: req.name,
      from_user_avatar: req.avatar_url,
      created_at: req.created_at,
      is_read: false
    }))
    
    const notifications = dbNotifications.map((n: any) =>
      mapDbNotificationRow(n, {
        preview_text: n.preview_text != null ? String(n.preview_text) : '',
        friend_message_id:
          n.friend_message_id != null && n.friend_message_id !== ''
            ? Number(n.friend_message_id)
            : null
      })
    )
    
    // Combine all notifications and sort by date
    const allNotifications = [...notifications, ...friendRequestNotifications]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    
    return c.json({ notifications: allNotifications })
  } catch (error) {
    console.error('Failed to fetch notifications:', error)
    return c.json({ error: 'Failed to fetch notifications', notifications: [] }, 500)
  }
})

// =====================
// Friend Messenger APIs
// =====================
async function ensureFriendMessagesTable(DB: any) {
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS friend_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT,
      video_url TEXT,
      created_at TEXT NOT NULL
    )
  `).run()

  // Local DBs created before media support: add columns if missing.
  try {
    await DB.prepare('ALTER TABLE friend_messages ADD COLUMN image_url TEXT').run()
  } catch (_) {
    // already exists
  }
  try {
    await DB.prepare('ALTER TABLE friend_messages ADD COLUMN video_url TEXT').run()
  } catch (_) {
    // already exists
  }
}

// Get friend message media from R2
app.get('/api/messages/media/:filename', async (c) => {
  const safe = sanitizeR2Filename(c.req.param('filename'))
  if (!safe) return c.notFound()
  return serveR2Object(c, `messages/${safe}`)
})

// Get 1:1 messages between two users
app.get('/api/messages/:userId/:friendId', async (c) => {
  const { DB } = c.env
  const userId = Number(c.req.param('userId'))
  const friendId = Number(c.req.param('friendId'))

  if (!Number.isFinite(userId) || !Number.isFinite(friendId)) {
    return c.json({ error: 'Invalid user ids', messages: [] }, 400)
  }

  try {
    await ensureFriendMessagesTable(DB)

    const { results } = await DB.prepare(`
      SELECT id, sender_id, receiver_id, content, image_url, video_url, created_at
      FROM friend_messages
      WHERE (sender_id = ? AND receiver_id = ?)
         OR (sender_id = ? AND receiver_id = ?)
      ORDER BY datetime(created_at) ASC, id ASC
      LIMIT 200
    `).bind(userId, friendId, friendId, userId).all()

    return c.json({ messages: results || [] })
  } catch (error) {
    console.error('Failed to fetch friend messages:', error)
    return c.json({ error: 'Failed to fetch friend messages', messages: [] }, 500)
  }
})

// Web version compatibility: same as /api/messages/:userId/:friendId
app.get('/api/messages/:userId/with/:friendId', async (c) => {
  const userId = c.req.param('userId')
  const friendId = c.req.param('friendId')
  // Delegate by rewriting params via manual call
  return await app.fetch(new Request(new URL(`/api/messages/${userId}/${friendId}`, c.req.url).toString(), c.req.raw), c.env, c.executionCtx)
})

// Send 1:1 message
app.post('/api/messages', async (c) => {
  const { DB, R2 } = c.env
  const ct = String(c.req.header('content-type') || '').toLowerCase()
  const isMultipart = ct.includes('multipart/form-data')

  try {
    await ensureFriendMessagesTable(DB)

    let senderId = NaN
    let receiverId = NaN
    let content = ''
    let imageUrl: string | null = null
    let videoUrl: string | null = null

    if (isMultipart) {
      const form = await c.req.formData()
      const sid = form.get('senderId') ?? form.get('sender_id')
      const rid = form.get('receiverId') ?? form.get('receiver_id')
      senderId = Number(sid)
      receiverId = Number(rid)
      content = String(form.get('content') || '').trim()

      const image = form.get('image')
      const video = form.get('video')

      if (image && image instanceof File) {
        if (!image.type.startsWith('image/')) return c.json({ error: 'Invalid file type' }, 400)
        if (image.size > 10 * 1024 * 1024) return c.json({ error: 'File too large (max 10MB)' }, 400)
        const ext = image.name.split('.').pop() || 'png'
        const filename = `${senderId}-${receiverId}-${Date.now()}-${crypto.randomUUID()}.${ext}`
        const fullPath = `messages/${filename}`
        const arrayBuffer = await image.arrayBuffer()
        await R2.put(fullPath, arrayBuffer, { httpMetadata: { contentType: image.type } })
        imageUrl = `/api/messages/media/${filename}`
      }

      if (video && video instanceof File) {
        if (!video.type.startsWith('video/')) return c.json({ error: 'Invalid file type' }, 400)
        if (video.size > 100 * 1024 * 1024) return c.json({ error: 'File too large (max 100MB)' }, 400)
        const ext = video.name.split('.').pop() || 'mp4'
        const filename = `${senderId}-${receiverId}-${Date.now()}-${crypto.randomUUID()}.${ext}`
        const fullPath = `messages/${filename}`
        const arrayBuffer = await video.arrayBuffer()
        await R2.put(fullPath, arrayBuffer, { httpMetadata: { contentType: video.type } })
        videoUrl = `/api/messages/media/${filename}`
      }
    } else {
      const body = await c.req.json()
      // Support both local (senderId/receiverId) and web (sender_id/receiver_id)
      senderId = Number(body?.senderId ?? body?.sender_id)
      receiverId = Number(body?.receiverId ?? body?.receiver_id)
      const contentRaw = typeof body?.content === 'string' ? body.content : ''
      content = contentRaw.trim()
    }

    if (!Number.isFinite(senderId) || !Number.isFinite(receiverId)) {
      return c.json({ error: 'senderId and receiverId are required' }, 400)
    }
    if (!content && !imageUrl && !videoUrl) {
      return c.json({ error: 'content or media is required' }, 400)
    }

    const now = new Date().toISOString()
    await DB.prepare(`
      INSERT INTO friend_messages (sender_id, receiver_id, content, image_url, video_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(senderId, receiverId, content || '', imageUrl, videoUrl, now).run()

    return c.json({ success: true, message: '메시지를 보냈습니다' })
  } catch (error) {
    console.error('Failed to send friend message:', error)
    return c.json({ error: 'Failed to send friend message' }, 500)
  }
})

/** 피드백 → 관리자(또는 운영자) 앱 내 메신저(friend_messages)로 전달. 수신자 id는 클라이언트에 노출하지 않음 */
app.post('/api/feedback', async (c) => {
  const { DB, R2 } = c.env
  const ct = String(c.req.header('content-type') || '').toLowerCase()
  const isMultipart = ct.includes('multipart/form-data')

  try {
    await ensureFriendMessagesTable(DB)

    let userId = NaN
    let content = ''
    let imageUrl: string | null = null
    let videoUrl: string | null = null

    if (isMultipart) {
      const form = await c.req.formData()
      userId = Number(form.get('user_id') ?? form.get('userId'))
      content = String(form.get('content') || '').trim()

      const image = form.get('image')
      const video = form.get('video')

      if (image && image instanceof File) {
        if (!image.type.startsWith('image/')) return c.json({ error: 'Invalid file type' }, 400)
        if (image.size > 10 * 1024 * 1024) return c.json({ error: 'File too large (max 10MB)' }, 400)
        const ext = image.name.split('.').pop() || 'png'
        const filename = `feedback-${userId}-${Date.now()}-${crypto.randomUUID()}.${ext}`
        const fullPath = `messages/${filename}`
        const arrayBuffer = await image.arrayBuffer()
        await R2.put(fullPath, arrayBuffer, { httpMetadata: { contentType: image.type } })
        imageUrl = `/api/messages/media/${filename}`
      }

      if (video && video instanceof File) {
        if (!video.type.startsWith('video/')) return c.json({ error: 'Invalid file type' }, 400)
        if (video.size > 100 * 1024 * 1024) return c.json({ error: 'File too large (max 100MB)' }, 400)
        const ext = video.name.split('.').pop() || 'mp4'
        const filename = `feedback-${userId}-${Date.now()}-${crypto.randomUUID()}.${ext}`
        const fullPath = `messages/${filename}`
        const arrayBuffer = await video.arrayBuffer()
        await R2.put(fullPath, arrayBuffer, { httpMetadata: { contentType: video.type } })
        videoUrl = `/api/messages/media/${filename}`
      }
    } else {
      const body = await c.req.json()
      userId = Number(body?.user_id ?? body?.userId)
      const contentRaw = typeof body?.content === 'string' ? body.content : ''
      content = contentRaw.trim()
    }

    if (!Number.isFinite(userId)) {
      return c.json({ error: 'user_id required' }, 400)
    }
    const senderOk = await DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()
    if (!senderOk) {
      return c.json({ error: 'Invalid user' }, 401)
    }

    if (!content && !imageUrl && !videoUrl) {
      return c.json({ error: '내용 또는 첨부가 필요합니다' }, 400)
    }

    const adminRow = (await DB.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`).first()) as { id: number } | null
    let receiverId = adminRow?.id
    if (receiverId == null) {
      const modRow = (await DB.prepare(`SELECT id FROM users WHERE role = 'moderator' ORDER BY id ASC LIMIT 1`).first()) as {
        id: number
      } | null
      receiverId = modRow?.id
    }
    if (receiverId == null) {
      return c.json({ error: '관리자 수신 계정이 없습니다' }, 503)
    }
    if (Number(receiverId) === userId) {
      return c.json({ error: '관리자 전용 기능입니다' }, 400)
    }

    const bodyText =
      content.trim().length > 0 ? `[피드백]\n${content.trim()}` : '[피드백]\n(첨부만 전송)'

    let previewText = ''
    if (content.trim().length > 0) {
      const t = content.trim().replace(/\s+/g, ' ')
      previewText = t.length > 140 ? `${t.slice(0, 140)}…` : t
    } else if (imageUrl && videoUrl) {
      previewText = '사진·동영상 첨부'
    } else if (imageUrl) {
      previewText = '사진 첨부'
    } else if (videoUrl) {
      previewText = '동영상 첨부'
    }

    const now = new Date().toISOString()
    const msgIns = await DB.prepare(`
      INSERT INTO friend_messages (sender_id, receiver_id, content, image_url, video_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .bind(userId, receiverId, bodyText, imageUrl, videoUrl, now)
      .run()

    const friendMessageId = Number(msgIns.meta?.last_row_id) || 0

    const insFull = async () => {
      await DB.prepare(`
        INSERT INTO notifications (user_id, from_user_id, type, post_id, comment_id, is_read, created_at, preview_text, friend_message_id)
        VALUES (?, ?, 'feedback', NULL, NULL, 0, ?, ?, ?)
      `)
        .bind(receiverId, userId, now, previewText || null, friendMessageId || null)
        .run()
    }
    const insPreview = async () => {
      await DB.prepare(`
        INSERT INTO notifications (user_id, from_user_id, type, post_id, comment_id, is_read, created_at, preview_text)
        VALUES (?, ?, 'feedback', NULL, NULL, 0, ?, ?)
      `)
        .bind(receiverId, userId, now, previewText || null)
        .run()
    }
    const insLegacy = async () => {
      await DB.prepare(`
        INSERT INTO notifications (user_id, from_user_id, type, post_id, comment_id, is_read, created_at)
        VALUES (?, ?, 'feedback', NULL, NULL, 0, ?)
      `)
        .bind(receiverId, userId, now)
        .run()
    }

    try {
      await insFull()
    } catch {
      try {
        await insPreview()
      } catch {
        try {
          await insLegacy()
        } catch (notifErr) {
          console.error('Feedback notification insert failed:', notifErr)
        }
      }
    }

    c.header('Cache-Control', 'private, no-store')
    return c.json({ success: true, message: '피드백이 전달되었습니다' })
  } catch (error) {
    console.error('Failed to send feedback:', error)
    return c.json({ error: '피드백 전송에 실패했습니다' }, 500)
  }
})

// Send friend request
app.post('/api/friend-request', async (c) => {
  const { DB } = c.env
  const { fromUserId, toUserId } = await c.req.json()
  const fromId = Number(fromUserId)
  const toId = Number(toUserId)
  if (!Number.isFinite(fromId) || !Number.isFinite(toId)) {
    return c.json({ error: '사용자 정보가 올바르지 않습니다' }, 400)
  }
  if (fromId === toId) {
    return c.json({ error: '본인에게 친구 제안을 보낼 수 없습니다' }, 400)
  }
  
  try {
    // FK 오류 대신 명확한 안내를 위해 사용자 존재를 먼저 확인
    const sender = await DB.prepare('SELECT id FROM users WHERE id = ?').bind(fromId).first()
    const receiver = await DB.prepare('SELECT id FROM users WHERE id = ?').bind(toId).first()
    if (!sender) {
      return c.json({ error: '로그인 정보가 유효하지 않습니다. 다시 로그인해 주세요.' }, 401)
    }
    if (!receiver) {
      return c.json({ error: '대상 가입자를 찾을 수 없습니다.' }, 404)
    }

    // Check if friendship already exists
    const { results: existing } = await DB.prepare(`
      SELECT id, status FROM friendships
      WHERE (user_id = ? AND friend_id = ?)
         OR (user_id = ? AND friend_id = ?)
    `).bind(fromId, toId, toId, fromId).all()
    
    if (existing && existing.length > 0) {
      const friendship = existing[0] as any
      if (friendship.status === 'accepted') {
        return c.json({ error: '이미 친구입니다' }, 400)
      } else if (friendship.status === 'pending') {
        if (Number(friendship.user_id) !== fromId) {
          return c.json({ error: '상대방이 먼저 보낸 친구 요청이 있습니다. 알림에서 승인하거나 거절해 주세요.' }, 400)
        }
        return c.json({ error: '이미 친구 제안을 보냈습니다' }, 400)
      } else if (friendship.status === 'rejected') {
        // 예전에 거절된 요청은 재사용해서 재요청 가능하게 처리
        const now = new Date().toISOString()
        await DB.prepare(`
          UPDATE friendships
          SET user_id = ?, friend_id = ?, status = 'pending', updated_at = ?
          WHERE id = ?
        `).bind(fromId, toId, now, friendship.id).run()
        return c.json({ success: true, message: '친구 제안을 다시 보냈습니다' })
      }
    }
    
    // Create friend request
    const now = new Date().toISOString()
    await DB.prepare(`
      INSERT INTO friendships (user_id, friend_id, status, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?)
    `).bind(fromId, toId, now, now).run()
    
    return c.json({ success: true, message: '친구 제안을 보냈습니다' })
  } catch (error) {
    console.error('Failed to send friend request:', error)
    return c.json({ error: 'Failed to send friend request' }, 500)
  }
})

// Accept friend request
app.post('/api/friend-request/accept', async (c) => {
  const { DB } = c.env
  const { requestId, actionUserId } = await c.req.json()
  const actionId = Number(actionUserId)
  if (!Number.isFinite(actionId)) {
    return c.json({ error: '로그인 정보가 유효하지 않습니다. 다시 로그인해 주세요.' }, 401)
  }
  
  try {
    const now = new Date().toISOString()
    const result = await DB.prepare(`
      UPDATE friendships
      SET status = 'accepted', updated_at = ?
      WHERE id = ? AND status = 'pending' AND friend_id = ?
    `).bind(now, requestId, actionId).run()
    if (!result.success || (result.meta?.changes ?? 0) === 0) {
      return c.json({ error: '승인 가능한 친구 요청이 없습니다.' }, 404)
    }
    
    return c.json({ success: true, message: '친구 제안을 승인했습니다' })
  } catch (error) {
    console.error('Failed to accept friend request:', error)
    return c.json({ error: 'Failed to accept friend request' }, 500)
  }
})

// Reject friend request
app.post('/api/friend-request/reject', async (c) => {
  const { DB } = c.env
  const { requestId, actionUserId } = await c.req.json()
  const actionId = Number(actionUserId)
  if (!Number.isFinite(actionId)) {
    return c.json({ error: '로그인 정보가 유효하지 않습니다. 다시 로그인해 주세요.' }, 401)
  }
  
  try {
    const result = await DB.prepare(`
      DELETE FROM friendships
      WHERE id = ? AND status = 'pending' AND friend_id = ?
    `).bind(requestId, actionId).run()
    if (!result.success || (result.meta?.changes ?? 0) === 0) {
      return c.json({ error: '거절 가능한 친구 요청이 없습니다.' }, 404)
    }
    
    return c.json({ success: true, message: '친구 제안을 거절했습니다' })
  } catch (error) {
    console.error('Failed to reject friend request:', error)
    return c.json({ error: 'Failed to reject friend request' }, 500)
  }
})

// Mark all notifications as read
app.post('/api/notifications/mark-read', async (c) => {
  const { DB } = c.env
  const { userId } = await c.req.json()
  
  try {
    await DB.prepare(`
      UPDATE notifications
      SET is_read = 1
      WHERE user_id = ? AND is_read = 0
    `).bind(userId).run()
    
    return c.json({ success: true, message: '모든 알림을 읽음으로 표시했습니다' })
  } catch (error) {
    console.error('Failed to mark notifications as read:', error)
    return c.json({ error: 'Failed to mark notifications as read' }, 500)
  }
})

/** 단일 알림 읽음 (피드백 알림 클릭 후 메신저 이동 등) */
app.post('/api/notifications/read-one', async (c) => {
  const { DB } = c.env
  const body = (await c.req.json().catch(() => ({}))) as { userId?: number | string; notificationId?: number | string }
  const uid = Number(body.userId)
  const nid = Number(body.notificationId)
  if (!Number.isFinite(uid) || !Number.isFinite(nid)) {
    return c.json({ error: 'userId and notificationId required' }, 400)
  }
  try {
    await DB.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`).bind(nid, uid).run()
    return c.json({ success: true })
  } catch (error) {
    console.error('Failed to mark notification read:', error)
    return c.json({ error: 'Failed to mark notification read' }, 500)
  }
})

// Admin: Get all friendships
app.get('/api/admin/friendships', requireAdmin, async (c) => {
  const { DB } = c.env
  
  try {
    const friendships = await DB.prepare(`
      SELECT 
        f.id,
        f.user_id,
        f.friend_id,
        f.status,
        f.created_at,
        u1.name as user_name,
        u1.email as user_email,
        u1.church as user_church,
        u2.name as friend_name,
        u2.email as friend_email,
        u2.church as friend_church
      FROM friendships f
      JOIN users u1 ON f.user_id = u1.id
      JOIN users u2 ON f.friend_id = u2.id
      ORDER BY f.created_at DESC
    `).all()
    
    return c.json({
      success: true,
      friendships: friendships.results || []
    })
  } catch (error) {
    console.error('Error loading friendships:', error)
    return c.json({ success: false, error: 'Failed to load friendships' }, 500)
  }
})

// Admin: Create random friendships with realistic distribution
app.post('/api/admin/create-fake-friendships', requireAdmin, async (c) => {
  const { DB } = c.env
  const { count = 20 } = await c.req.json()
  
  try {
    // Get all users
    const users = await DB.prepare('SELECT id FROM users').all()
    
    if (!users.results || users.results.length < 2) {
      return c.json({ 
        success: false, 
        error: '최소 2명 이상의 사용자가 필요합니다.' 
      }, 400)
    }
    
    const userIds = users.results.map((u: any) => u.id)
    let created = 0
    const maxAttempts = count * 3 // Prevent infinite loop
    let attempts = 0
    
    while (created < count && attempts < maxAttempts) {
      attempts++
      
      // Pick two random users
      const userId = userIds[Math.floor(Math.random() * userIds.length)]
      const friendId = userIds[Math.floor(Math.random() * userIds.length)]
      
      // Skip if same user
      if (userId === friendId) continue
      
      // Realistic status distribution
      // 80% accepted, 10% pending, 10% rejected
      const rand = Math.random()
      let status = 'accepted'
      if (rand > 0.9) status = 'pending'
      else if (rand > 0.8) status = 'rejected'
      
      try {
        // Try to insert (will fail if duplicate due to UNIQUE constraint)
        await DB.prepare(`
          INSERT INTO friendships (user_id, friend_id, status)
          VALUES (?, ?, ?)
        `).bind(userId, friendId, status).run()
        
        created++
      } catch (err) {
        // Duplicate or other error, just continue
        continue
      }
    }
    
    return c.json({
      success: true,
      count: created,
      message: `${created}개의 친구 관계가 생성되었습니다.`
    })
  } catch (error) {
    console.error('Error creating friendships:', error)
    return c.json({ 
      success: false, 
      error: '친구 관계 생성에 실패했습니다: ' + (error as Error).message 
    }, 500)
  }
})

// Admin: Delete individual friendship
app.delete('/api/admin/friendships/:id', requireAdmin, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  try {
    await DB.prepare('DELETE FROM friendships WHERE id = ?').bind(id).run()
    
    return c.json({
      success: true,
      message: '친구 관계가 삭제되었습니다.'
    })
  } catch (error) {
    console.error('Error deleting friendship:', error)
    return c.json({ 
      success: false, 
      error: '친구 관계 삭제에 실패했습니다.' 
    }, 500)
  }
})

// Admin: Delete all friendships
app.delete('/api/admin/friendships', requireAdmin, async (c) => {
  const { DB } = c.env
  
  try {
    const result = await DB.prepare('DELETE FROM friendships').run()
    
    return c.json({
      success: true,
      deleted_count: result.meta.changes || 0,
      message: `${result.meta.changes || 0}개의 친구 관계가 삭제되었습니다.`
    })
  } catch (error) {
    console.error('Error deleting all friendships:', error)
    return c.json({ 
      success: false, 
      error: '친구 관계 삭제에 실패했습니다.' 
    }, 500)
  }
})

// =====================
// Frontend Routes
// =====================

// Admin Panel
app.get('/admin', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>관리자 패널 - CROSSfriends</title>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg">
        <script src="https://cdn.tailwindcss.com"></script>
        <script>
            // Suppress Tailwind CDN warnings
            tailwind.config = { corePlugins: { preflight: true } }
        </script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
            // Define global functions immediately for onclick handlers
            window.createFakeUsers = function() { console.log('Function will be replaced after DOM loads'); };
            window.deleteFakeUsers = function() { console.log('Function will be replaced after DOM loads'); };
            window.deleteUser = function() { console.log('Function will be replaced after DOM loads'); };
            window.editUserScore = function() { console.log('Function will be replaced after DOM loads'); };
            window.resetAllScores = function() { console.log('Function will be replaced after DOM loads'); };
            window.loadAdminPosts = function() { console.log('Function will be replaced after DOM loads'); };
            window.deleteAdminPost = function() { console.log('Function will be replaced after DOM loads'); };
            window.deleteAllPosts = function() { console.log('Function will be replaced after DOM loads'); };
            window.createFakePosts = function() { console.log('Function will be replaced after DOM loads'); };
            window.createFakeComments = function() { console.log('Function will be replaced after DOM loads'); };
            window.createFakeLikes = function() { console.log('Function will be replaced after DOM loads'); };
            window.simulateTimePass = function() { console.log('Function will be replaced after DOM loads'); };
            window.createRandomFriendships = function() { console.log('Function will be replaced after DOM loads'); };
            window.deleteFriendship = function() { console.log('Function will be replaced after DOM loads'); };
            window.deleteAllFriendships = function() { console.log('Function will be replaced after DOM loads'); };
            window.showFriendshipGraph = function() { console.log('Function will be replaced after DOM loads'); };
            window.closeGraphModal = function() { console.log('Function will be replaced after DOM loads'); };
        </script>
    </head>
    <body class="bg-gray-50 overflow-x-hidden">
        <nav class="bg-red-600 text-white shadow-lg">
            <div class="max-w-7xl mx-auto px-4 py-4">
                <div class="flex justify-between items-center">
                    <h1 class="text-2xl font-bold">
                        <i class="fas fa-shield-alt mr-2"></i>관리자 패널
                    </h1>
                    <a href="/" class="bg-white text-red-600 px-4 py-2 rounded-lg hover:bg-gray-100 transition">
                        <i class="fas fa-home"></i>
                    </a>
                </div>
            </div>
        </nav>

        <div class="max-w-7xl mx-auto px-4 py-8">
            <!-- Stats Cards -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div class="bg-blue-500 text-white rounded-xl shadow-lg p-6">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-blue-100 text-sm">총 회원</p>
                            <p class="text-3xl font-bold" id="totalUsers">0</p>
                        </div>
                        <i class="fas fa-users text-4xl opacity-50"></i>
                    </div>
                </div>
                
                <div class="bg-blue-500 text-white rounded-xl shadow-lg p-6">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-blue-100 text-sm">총 게시물</p>
                            <p class="text-3xl font-bold" id="totalPosts">0</p>
                        </div>
                        <i class="fas fa-file-alt text-4xl opacity-50"></i>
                    </div>
                </div>
                
                <div class="bg-purple-500 text-white rounded-xl shadow-lg p-6">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-purple-100 text-sm">총 댓글</p>
                            <p class="text-3xl font-bold" id="totalComments">0</p>
                        </div>
                        <i class="fas fa-comments text-4xl opacity-50"></i>
                    </div>
                </div>
                <div class="bg-pink-500 text-white rounded-xl shadow-lg p-6">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-pink-100 text-sm">총 친구 관계</p>
                            <p class="text-3xl font-bold" id="totalFriendships">0</p>
                        </div>
                        <i class="fas fa-user-friends text-4xl opacity-50"></i>
                    </div>
                </div>
            </div>

            <!-- Post Type Statistics -->
            <div class="bg-white rounded-xl shadow-lg p-6 mb-8">
                <h2 class="text-2xl font-bold text-gray-800 mb-6">
                    <i class="fas fa-chart-pie text-blue-600 mr-2"></i>포스팅 유형별 통계
                </h2>
                <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                    <!-- 중보 기도 -->
                    <div class="bg-red-50 border-2 border-red-200 rounded-lg p-4 text-center hover:shadow-md transition">
                        <div class="text-red-600 text-2xl font-bold mb-1" id="prayerPostCount">0</div>
                        <div class="text-red-700 text-sm font-medium">중보 기도</div>
                        <div class="w-8 h-8 bg-red-200 rounded-full mx-auto mt-2"></div>
                    </div>
                    
                    <!-- 말씀 -->
                    <div class="bg-yellow-50 border-2 border-yellow-200 rounded-lg p-4 text-center hover:shadow-md transition">
                        <div class="text-yellow-600 text-2xl font-bold mb-1" id="versePostCount">0</div>
                        <div class="text-yellow-700 text-sm font-medium">말씀</div>
                        <div class="w-8 h-8 bg-yellow-200 rounded-full mx-auto mt-2"></div>
                    </div>
                    
                    <!-- 일상 -->
                    <div class="bg-orange-50 border-2 border-orange-200 rounded-lg p-4 text-center hover:shadow-md transition">
                        <div class="text-orange-600 text-2xl font-bold mb-1" id="dailyPostCount">0</div>
                        <div class="text-orange-700 text-sm font-medium">일상</div>
                        <div class="w-8 h-8 bg-orange-200 rounded-full mx-auto mt-2"></div>
                    </div>
                    
                    <!-- 사역 -->
                    <div class="bg-green-50 border-2 border-green-200 rounded-lg p-4 text-center hover:shadow-md transition">
                        <div class="text-green-600 text-2xl font-bold mb-1" id="ministryPostCount">0</div>
                        <div class="text-green-700 text-sm font-medium">사역</div>
                        <div class="w-8 h-8 bg-green-200 rounded-full mx-auto mt-2"></div>
                    </div>
                    
                    <!-- 찬양 -->
                    <div class="bg-sky-50 border-2 border-sky-200 rounded-lg p-4 text-center hover:shadow-md transition">
                        <div class="text-sky-600 text-2xl font-bold mb-1" id="praisePostCount">0</div>
                        <div class="text-sky-700 text-sm font-medium">찬양</div>
                        <div class="w-8 h-8 bg-sky-200 rounded-full mx-auto mt-2"></div>
                    </div>
                    
                    <!-- 교회 -->
                    <div class="bg-violet-50 border-2 border-violet-200 rounded-lg p-4 text-center hover:shadow-md transition">
                        <div class="text-violet-600 text-2xl font-bold mb-1" id="churchPostCount">0</div>
                        <div class="text-violet-700 text-sm font-medium">교회</div>
                        <div class="w-8 h-8 bg-violet-200 rounded-full mx-auto mt-2"></div>
                    </div>
                    
                    <!-- 자유 -->
                    <div class="bg-white border-2 border-gray-300 rounded-lg p-4 text-center hover:shadow-md transition">
                        <div class="text-gray-700 text-2xl font-bold mb-1" id="freePostCount">0</div>
                        <div class="text-gray-600 text-sm font-medium">자유</div>
                        <div class="w-8 h-8 bg-white border-2 border-gray-300 rounded-full mx-auto mt-2"></div>
                    </div>
                </div>
            </div>

            <!-- Users Table -->
            <div class="bg-white rounded-xl shadow-lg p-6 mb-8">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold text-gray-800">
                        <i class="fas fa-users text-red-600 mr-2"></i>회원 관리
                    </h2>
                    <div class="flex space-x-2">
                        <button onclick="resetAllScores()" class="bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600 transition">
                            <i class="fas fa-undo mr-2"></i>모든 점수 초기화
                        </button>
                        <button onclick="createFakeUsers()" class="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition">
                            <i class="fas fa-user-plus mr-2"></i>테스트 사용자 생성
                        </button>
                        <button onclick="deleteFakeUsers()" class="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition">
                            <i class="fas fa-trash mr-2"></i>테스트 사용자 삭제
                        </button>
                    </div>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full">
                        <thead class="bg-gray-100">
                            <tr>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600 cursor-pointer hover:bg-gray-200 transition" data-sort="id" onclick="sortUsers('id')">
                                    ID
                                </th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">이메일</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600 cursor-pointer hover:bg-gray-200 transition" data-sort="name" onclick="sortUsers('name')">
                                    이름 (가나다순)
                                </th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">교회</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">역할</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600 cursor-pointer hover:bg-gray-200 transition" data-sort="post_count" onclick="sortUsers('post_count')">
                                    게시물
                                </th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600 cursor-pointer hover:bg-gray-200 transition" data-sort="scripture_score" onclick="sortUsers('scripture_score')">
                                    성경점수
                                </th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600 cursor-pointer hover:bg-gray-200 transition" data-sort="prayer_score" onclick="sortUsers('prayer_score')">
                                    기도점수
                                </th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600 cursor-pointer hover:bg-gray-200 transition" data-sort="activity_score" onclick="sortUsers('activity_score')">
                                    활동점수
                                </th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600 cursor-pointer hover:bg-gray-200 transition" data-sort="ministry_score" onclick="sortUsers('ministry_score')">
                                    종합점수
                                </th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600 cursor-pointer hover:bg-gray-200 transition" data-sort="created_at" onclick="sortUsers('created_at')">
                                    가입일
                                </th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">작업</th>
                            </tr>
                        </thead>
                        <tbody id="usersTableBody" class="divide-y divide-gray-200">
                            <!-- Users will be loaded here -->
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Friendships Management -->
            <div class="bg-white rounded-xl shadow-lg p-6 mb-8">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold text-gray-800">
                        <i class="fas fa-user-friends text-purple-600 mr-2"></i>친구 관계 관리
                    </h2>
                    <div class="flex space-x-2">
                        <button onclick="createRandomFriendships()" class="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition">
                            <i class="fas fa-random mr-2"></i>랜덤 친구 생성
                        </button>
                        <button onclick="loadFriendships()" class="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition">
                            <i class="fas fa-sync-alt mr-2"></i>새로고침
                        </button>
                        <button onclick="deleteAllFriendships()" class="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition">
                            <i class="fas fa-trash-alt mr-2"></i>모두 삭제
                        </button>
                    </div>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full">
                        <thead class="bg-gray-100">
                            <tr>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">ID</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">친구 신청</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">친구 승인</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">상태</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">생성일</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">작업</th>
                            </tr>
                        </thead>
                        <tbody id="friendshipsTableBody" class="divide-y divide-gray-200">
                            <!-- Friendships will be loaded here -->
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Friendship Graph Modal -->
            <div id="graphModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
                <div class="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden">
                    <div class="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 flex justify-between items-center">
                        <div>
                            <h2 class="text-2xl font-bold" id="graphTitle">친구 네트워크</h2>
                            <p class="text-blue-100 text-sm mt-1" id="graphSubtitle"></p>
                        </div>
                        <button onclick="closeGraphModal()" class="text-white hover:text-gray-200 transition">
                            <i class="fas fa-times text-2xl"></i>
                        </button>
                    </div>
                    <div class="p-6 overflow-auto" style="max-height: calc(90vh - 120px);">
                        <div class="mb-4 flex gap-4 text-sm">
                            <div class="flex items-center gap-2">
                                <div class="w-4 h-4 rounded-full bg-blue-500"></div>
                                <span>선택된 사용자</span>
                            </div>
                            <div class="flex items-center gap-2">
                                <div class="w-4 h-4 rounded-full bg-green-500"></div>
                                <span>친구 (수락됨)</span>
                            </div>
                            <div class="flex items-center gap-2">
                                <div class="w-4 h-4 rounded-full bg-yellow-500"></div>
                                <span>대기 중</span>
                            </div>
                            <div class="flex items-center gap-2">
                                <div class="w-4 h-4 rounded-full bg-red-500"></div>
                                <span>거절됨</span>
                            </div>
                        </div>
                        <div class="flex justify-center">
                            <canvas id="friendshipCanvas" width="900" height="600" class="border border-gray-300 rounded-lg bg-white"></canvas>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Posts Management -->
            <div class="bg-white rounded-xl shadow-lg p-6 mb-8">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold text-gray-800">
                        <i class="fas fa-newspaper text-blue-600 mr-2"></i>게시물 관리
                    </h2>
                    <div class="flex flex-wrap gap-2">
                        <button onclick="createFakePosts()" class="bg-green-500 text-white px-3 py-2 rounded-lg hover:bg-green-600 transition text-sm">
                            <i class="fas fa-plus mr-1"></i>게시물 생성
                        </button>
                        <button onclick="createFakeComments()" class="bg-purple-500 text-white px-3 py-2 rounded-lg hover:bg-purple-600 transition text-sm">
                            <i class="fas fa-comment mr-1"></i>댓글 생성
                        </button>
                        <button onclick="createFakeLikes()" class="bg-pink-500 text-white px-3 py-2 rounded-lg hover:bg-pink-600 transition text-sm">
                            <i class="fas fa-heart mr-1"></i>반응 생성
                        </button>
                        <button onclick="simulateTimePass()" class="bg-gradient-to-r from-orange-500 to-red-500 text-white px-4 py-2 rounded-lg hover:from-orange-600 hover:to-red-600 transition text-sm font-semibold shadow-lg">
                            <i class="fas fa-magic mr-2"></i>🌱 활동 시뮬레이션
                        </button>
                        <button onclick="loadAdminPosts()" class="bg-blue-500 text-white px-3 py-2 rounded-lg hover:bg-blue-600 transition text-sm">
                            <i class="fas fa-sync-alt mr-1"></i>새로고침
                        </button>
                        <button onclick="deleteAllPosts()" class="bg-red-500 text-white px-3 py-2 rounded-lg hover:bg-red-600 transition text-sm">
                            <i class="fas fa-trash-alt mr-1"></i>모두 삭제
                        </button>
                    </div>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full">
                        <thead class="bg-gray-100">
                            <tr>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">ID</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">작성자</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">내용</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">유형</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">좋아요</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">댓글</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">작성일</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">작업</th>
                            </tr>
                        </thead>
                        <tbody id="postsTableBody" class="divide-y divide-gray-200">
                            <!-- Posts will be loaded here -->
                        </tbody>
                    </table>
                </div>
            </div>


        </div>

        <script>
            let adminId = localStorage.getItem('currentUserId');

            async function loadStats() {
                try {
                    const response = await axios.get('/api/admin/stats', {
                        headers: { 'X-Admin-ID': adminId }
                    });
                    
                    document.getElementById('totalUsers').textContent = response.data.users;
                    document.getElementById('totalPosts').textContent = response.data.posts;
                    document.getElementById('totalComments').textContent = response.data.comments;
                    document.getElementById('totalFriendships').textContent = response.data.friendships || 0;
                    
                    // Post type statistics
                    if (response.data.postTypes) {
                        document.getElementById('prayerPostCount').textContent = response.data.postTypes.prayer;
                        document.getElementById('versePostCount').textContent = response.data.postTypes.verse;
                        document.getElementById('dailyPostCount').textContent = response.data.postTypes.daily;
                        document.getElementById('ministryPostCount').textContent = response.data.postTypes.ministry;
                        document.getElementById('praisePostCount').textContent = response.data.postTypes.praise;
                        document.getElementById('churchPostCount').textContent = response.data.postTypes.church;
                        document.getElementById('freePostCount').textContent = response.data.postTypes.free;
                    }
                } catch (error) {
                    console.error('Failed to load stats:', error);
                    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
                        alert('관리자 권한이 필요합니다.');
                        window.location.href = '/';
                    }
                }
            }

            // User sorting state
            let usersData = [];
            let currentSortField = 'id';
            let currentSortOrder = 'asc';

            async function loadUsers() {
                try {
                    const tbody = document.getElementById('usersTableBody');
                    
                    // Show loading state
                    tbody.innerHTML = '<tr><td colspan="12" class="text-center py-8 text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>사용자 목록을 불러오는 중...</td></tr>';
                    
                    const response = await axios.get('/api/admin/users', {
                        headers: { 'X-Admin-ID': adminId }
                    });
                    
                    // Store users data for sorting
                    usersData = response.data.users;
                    
                    // Render with current sort
                    renderUsers();
                    
                    console.log('사용자 목록 로드 완료:', usersData.length, '명');
                } catch (error) {
                    console.error('Failed to load users:', error);
                    const tbody = document.getElementById('usersTableBody');
                    tbody.innerHTML = '<tr><td colspan="12" class="text-center py-8 text-red-500"><i class="fas fa-exclamation-triangle mr-2"></i>사용자 목록을 불러오는데 실패했습니다.</td></tr>';
                }
            }

            function sortUsers(field) {
                // Toggle sort order if clicking same field
                if (currentSortField === field) {
                    currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSortField = field;
                    currentSortOrder = 'asc';
                }
                
                // Sort the data
                usersData.sort((a, b) => {
                    let aVal, bVal;
                    
                    switch(field) {
                        case 'id':
                            aVal = a.id;
                            bVal = b.id;
                            break;
                        case 'name':
                            // Korean alphabetical sort
                            aVal = a.name || '';
                            bVal = b.name || '';
                            return currentSortOrder === 'asc' 
                                ? aVal.localeCompare(bVal, 'ko-KR')
                                : bVal.localeCompare(aVal, 'ko-KR');
                        case 'email':
                            aVal = a.email || '';
                            bVal = b.email || '';
                            return currentSortOrder === 'asc'
                                ? aVal.localeCompare(bVal)
                                : bVal.localeCompare(aVal);
                        case 'church':
                            aVal = a.church || '';
                            bVal = b.church || '';
                            return currentSortOrder === 'asc'
                                ? aVal.localeCompare(bVal, 'ko-KR')
                                : bVal.localeCompare(aVal, 'ko-KR');
                        case 'post_count':
                            aVal = a.post_count || 0;
                            bVal = b.post_count || 0;
                            break;
                        case 'scripture_score':
                            aVal = a.scripture_score || 0;
                            bVal = b.scripture_score || 0;
                            break;
                        case 'prayer_score':
                            aVal = a.prayer_score || 0;
                            bVal = b.prayer_score || 0;
                            break;
                        case 'activity_score':
                            aVal = a.activity_score || 0;
                            bVal = b.activity_score || 0;
                            break;
                        case 'ministry_score':
                            aVal = (a.scripture_score || 0) + (a.prayer_score || 0) + (a.activity_score || 0);
                            bVal = (b.scripture_score || 0) + (b.prayer_score || 0) + (b.activity_score || 0);
                            break;
                        case 'created_at':
                            aVal = new Date(a.created_at).getTime();
                            bVal = new Date(b.created_at).getTime();
                            break;
                        default:
                            aVal = a[field];
                            bVal = b[field];
                    }
                    
                    if (currentSortOrder === 'asc') {
                        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
                    } else {
                        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
                    }
                });
                
                renderUsers();
                updateSortIndicators();
            }

            function renderUsers() {
                const tbody = document.getElementById('usersTableBody');
                    
                tbody.innerHTML = usersData.map(user => \`
                        <tr class="hover:bg-gray-50">
                            <td class="px-4 py-3 text-sm">\${user.id}</td>
                            <td class="px-4 py-3 text-sm">\${user.email}</td>
                            <td class="px-4 py-3 text-sm font-semibold">
                                <a href="#" onclick="viewUserProfile(\${user.id}); return false;" class="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer transition-colors">
                                    \${user.name}
                                </a>
                            </td>
                            <td class="px-4 py-3 text-sm">\${user.church || '-'}</td>
                            <td class="px-4 py-3 text-sm">
                                <span class="px-2 py-1 rounded-full text-xs \${user.role === 'admin' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}">
                                    \${user.role}
                                </span>
                            </td>
                            <td class="px-4 py-3 text-sm">\${user.post_count}</td>
                            <td class="px-4 py-3 text-sm">
                                <button 
                                    onclick="editUserScore(\${user.id}, 'scripture_score', \${user.scripture_score || 0}, '성경점수')"
                                    class="inline-flex items-center px-2 py-1 rounded bg-yellow-100 text-yellow-800 hover:bg-yellow-200 cursor-pointer transition">
                                    <i class="fas fa-bible text-xs mr-1"></i>
                                    \${user.scripture_score || 0}
                                    <i class="fas fa-edit text-xs ml-1 opacity-50"></i>
                                </button>
                            </td>
                            <td class="px-4 py-3 text-sm">
                                <button 
                                    onclick="editUserScore(\${user.id}, 'prayer_score', \${user.prayer_score || 0}, '기도점수')"
                                    class="inline-flex items-center px-2 py-1 rounded bg-blue-100 text-blue-800 hover:bg-blue-200 cursor-pointer transition">
                                    <i class="fas fa-praying-hands text-xs mr-1"></i>
                                    \${user.prayer_score || 0}
                                    <i class="fas fa-edit text-xs ml-1 opacity-50"></i>
                                </button>
                            </td>
                            <td class="px-4 py-3 text-sm">
                                <button 
                                    onclick="editUserScore(\${user.id}, 'activity_score', \${user.activity_score || 0}, '활동점수')"
                                    class="inline-flex items-center px-2 py-1 rounded bg-green-100 text-green-800 hover:bg-green-200 cursor-pointer transition">
                                    <i class="fas fa-chart-line text-xs mr-1"></i>
                                    \${user.activity_score || 0}
                                    <i class="fas fa-edit text-xs ml-1 opacity-50"></i>
                                </button>
                            </td>
                            <td class="px-4 py-3 text-sm">
                                <span class="inline-flex items-center px-2 py-1 rounded bg-purple-100 text-purple-800 font-semibold">
                                    <i class="fas fa-trophy text-xs mr-1"></i>
                                    \${(user.scripture_score || 0) + (user.prayer_score || 0) + (user.activity_score || 0)}
                                </span>
                            </td>
                            <td class="px-4 py-3 text-sm">\${new Date(user.created_at).toLocaleDateString('ko-KR')}</td>
                            <td class="px-4 py-3 text-sm">
                                \${user.role === 'admin' 
                                    ? '<span class="text-gray-400" title="관리자는 삭제할 수 없습니다"><i class="fas fa-lock"></i></span>' 
                                    : \`<button onclick="deleteUser(\${user.id}, '\${user.role}')" class="text-red-600 hover:text-red-800"><i class="fas fa-trash"></i></button>\`
                                }
                            </td>
                        </tr>
                    \`).join('');
            }

            function updateSortIndicators() {
                // Remove all sort indicators
                document.querySelectorAll('.sort-indicator').forEach(el => el.remove());
                
                // Add indicator to current sort column
                const headers = {
                    'id': document.querySelector('[data-sort="id"]'),
                    'name': document.querySelector('[data-sort="name"]'),
                    'post_count': document.querySelector('[data-sort="post_count"]'),
                    'scripture_score': document.querySelector('[data-sort="scripture_score"]'),
                    'prayer_score': document.querySelector('[data-sort="prayer_score"]'),
                    'activity_score': document.querySelector('[data-sort="activity_score"]'),
                    'ministry_score': document.querySelector('[data-sort="ministry_score"]'),
                    'created_at': document.querySelector('[data-sort="created_at"]')
                };
                
                const currentHeader = headers[currentSortField];
                if (currentHeader) {
                    const icon = currentSortOrder === 'asc' ? '↑' : '↓';
                    const indicator = document.createElement('span');
                    indicator.className = 'sort-indicator ml-1 text-blue-600';
                    indicator.textContent = icon;
                    currentHeader.appendChild(indicator);
                }
            }


            window.editUserScore = async function(userId, scoreType, currentScore, scoreName) {
                const newScore = prompt(\`\${scoreName} 변경\\n\\n현재 점수: \${currentScore}\\n새로운 점수를 입력하세요:\`, currentScore);
                
                if (newScore === null) return; // 취소
                
                const score = parseInt(newScore);
                if (isNaN(score) || score < 0) {
                    alert('올바른 점수를 입력해주세요 (0 이상의 숫자)');
                    return;
                }
                
                try {
                    const scores = {
                        scripture_score: scoreType === 'scripture_score' ? score : undefined,
                        prayer_score: scoreType === 'prayer_score' ? score : undefined,
                        activity_score: scoreType === 'activity_score' ? score : undefined
                    };
                    
                    // Get current scores first
                    const userResponse = await axios.get('/api/admin/users', {
                        headers: { 'X-Admin-ID': adminId }
                    });
                    const user = userResponse.data.users.find(u => u.id === userId);
                    
                    if (!user) {
                        alert('사용자를 찾을 수 없습니다.');
                        return;
                    }
                    
                    // Set all scores (keep existing ones for other score types)
                    const updateData = {
                        scripture_score: scoreType === 'scripture_score' ? score : (user.scripture_score || 0),
                        prayer_score: scoreType === 'prayer_score' ? score : (user.prayer_score || 0),
                        activity_score: scoreType === 'activity_score' ? score : (user.activity_score || 0)
                    };
                    
                    await axios.put(\`/api/admin/users/\${userId}/scores\`, updateData, {
                        headers: { 'X-Admin-ID': adminId }
                    });
                    
                    alert(\`\${scoreName}가 \${score}점으로 변경되었습니다.\`);
                    loadUsers();
                } catch (error) {
                    console.error('Failed to update score:', error);
                    alert('점수 변경에 실패했습니다.');
                }
            }

            window.createFakeUsers = async function() {
                const count = prompt('생성할 테스트 사용자 수를 입력하세요 (최대 50명):', '10');
                if (!count) return;
                
                try {
                    const response = await axios.post('/api/admin/create-fake-users', 
                        { count: parseInt(count) },
                        { headers: { 'X-Admin-ID': adminId } }
                    );
                    
                    const createdCount = response.data.count;
                    
                    // Show success message
                    alert(\`✅ \${createdCount}명의 테스트 사용자가 생성되었습니다.\\n\\n사용자 목록을 새로고침합니다...\`);
                    
                    // Force reload data
                    await loadStats();
                    await loadUsers();
                    
                    // Visual confirmation with console log
                    console.log('테스트 사용자 생성 완료:', createdCount, '명');
                    console.log('현재 사용자 수:', document.getElementById('totalUsers').textContent);
                } catch (error) {
                    console.error('Failed to create fake users:', error);
                    alert('테스트 사용자 생성에 실패했습니다.');
                }
            }

            window.deleteFakeUsers = async function() {
                if (!confirm('모든 테스트 사용자를 삭제하시겠습니까?')) return;
                
                try {
                    const response = await axios.delete('/api/admin/delete-fake-users', {
                        headers: { 'X-Admin-ID': adminId }
                    });
                    
                    const deletedCount = response.data.deleted_count;
                    
                    // Show success message
                    alert(\`✅ \${deletedCount}명의 테스트 사용자가 삭제되었습니다.\\n\\n사용자 목록을 새로고침합니다...\`);
                    
                    // Force reload data
                    await loadStats();
                    await loadUsers();
                    
                    // Visual confirmation with console log
                    console.log('테스트 사용자 삭제 완료:', deletedCount, '명');
                    console.log('현재 사용자 수:', document.getElementById('totalUsers').textContent);
                } catch (error) {
                    console.error('Failed to delete fake users:', error);
                    alert('테스트 사용자 삭제에 실패했습니다.');
                }
            }

            window.viewUserProfile = function(userId) {
                // Open user profile HTML page in new tab
                window.open(\`/users/\${userId}\`, '_blank');
            }

            window.deleteUser = async function(userId, userRole) {
                if (userRole === 'admin') {
                    alert('관리자 계정은 삭제할 수 없습니다.');
                    return;
                }
                
                if (!confirm('이 사용자를 삭제하시겠습니까?')) return;
                
                try {
                    await axios.delete(\`/api/admin/users/\${userId}\`, {
                        headers: { 'X-Admin-ID': adminId }
                    });
                    alert('사용자가 삭제되었습니다.');
                    loadStats();
                    loadUsers();
                } catch (error) {
                    console.error('Failed to delete user:', error);
                    if (error.response && error.response.status === 403) {
                        alert(error.response.data.error || '관리자 계정은 삭제할 수 없습니다.');
                    } else {
                        alert('사용자 삭제에 실패했습니다.');
                    }
                }
            }

            window.resetAllScores = async function() {
                if (!confirm('⚠️ 경고: 모든 회원의 모든 점수를 0으로 초기화하시겠습니까?\\n\\n이 작업은 되돌릴 수 없습니다.\\n- 성경점수 (scripture_score)\\n- 기도점수 (prayer_score)\\n- 활동점수 (activity_score)')) {
                    return;
                }
                
                // Double confirmation
                const confirmText = prompt('정말로 초기화하시려면 "RESET"을 입력하세요:');
                if (confirmText !== 'RESET') {
                    alert('초기화가 취소되었습니다.');
                    return;
                }
                
                try {
                    const response = await axios.post('/api/admin/users/reset-scores', {}, {
                        headers: { 'X-Admin-ID': adminId }
                    });
                    
                    alert(\`✅ \${response.data.message}\\n\\n영향받은 회원 수: \${response.data.affected_users}명\`);
                    loadUsers();
                } catch (error) {
                    console.error('Failed to reset scores:', error);
                    alert('점수 초기화에 실패했습니다.');
                }
            }

            async function loadAdminPosts() {
                try {
                    const response = await axios.get('/api/admin/posts', {
                        headers: { 'X-Admin-ID': adminId }
                    });
                    
                    const tbody = document.getElementById('postsTableBody');
                    tbody.innerHTML = response.data.posts.map(post => {
                        // Determine post type based on background color
                        let postType = '자유';
                        let typeColor = 'bg-gray-100 text-gray-800';
                        
                        if (post.background_color === '#F87171') {
                            postType = '중보 기도';
                            typeColor = 'bg-red-100 text-red-800';
                        } else if (post.background_color === '#F5E398') {
                            postType = '말씀';
                            typeColor = 'bg-yellow-100 text-yellow-800';
                        } else if (post.background_color === '#F5D4B3') {
                            postType = '일상';
                            typeColor = 'bg-orange-100 text-orange-800';
                        } else if (post.background_color === '#B3EDD8') {
                            postType = '사역';
                            typeColor = 'bg-green-100 text-green-800';
                        } else if (post.background_color === '#C4E5F8') {
                            postType = '찬양';
                            typeColor = 'bg-sky-100 text-sky-800';
                        } else if (post.background_color === '#E2DBFB') {
                            postType = '교회';
                            typeColor = 'bg-violet-100 text-violet-800';
                        }
                        
                        // Truncate content for display
                        const truncatedContent = post.content.length > 50 
                            ? post.content.substring(0, 50) + '...' 
                            : post.content;
                        
                        // Format date
                        const date = new Date(post.created_at);
                        const formattedDate = date.toLocaleDateString('ko-KR', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        
                        return \`
                            <tr class="hover:bg-gray-50">
                                <td class="px-4 py-3 text-sm">\${post.id}</td>
                                <td class="px-4 py-3 text-sm">
                                    <div class="font-semibold">\${post.user_name}</div>
                                    <div class="text-xs text-gray-500">\${post.user_email}</div>
                                </td>
                                <td class="px-4 py-3 text-sm max-w-xs">
                                    <div class="truncate" title="\${post.content}">\${truncatedContent}</div>
                                    \${post.verse_reference ? \`<div class="text-xs text-blue-600 mt-1"><i class="fas fa-bible mr-1"></i>\${post.verse_reference}</div>\` : ''}
                                </td>
                                <td class="px-4 py-3 text-sm">
                                    <span class="px-2 py-1 rounded-full text-xs \${typeColor}">
                                        \${postType}
                                    </span>
                                </td>
                                <td class="px-4 py-3 text-sm">
                                    <span class="text-red-600"><i class="fas fa-heart mr-1"></i>\${post.likes_count}</span>
                                </td>
                                <td class="px-4 py-3 text-sm">
                                    <span class="text-blue-600"><i class="fas fa-comment mr-1"></i>\${post.comments_count}</span>
                                </td>
                                <td class="px-4 py-3 text-sm text-gray-500">\${formattedDate}</td>
                                <td class="px-4 py-3 text-sm">
                                    <button 
                                        onclick="deleteAdminPost(\${post.id})"
                                        class="text-red-600 hover:text-red-800 transition">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </td>
                            </tr>
                        \`;
                    }).join('');
                } catch (error) {
                    console.error('Failed to load posts:', error);
                    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
                        alert('관리자 권한이 필요합니다.');
                    }
                }
            }

            window.deleteAdminPost = async function(postId) {
                if (!confirm('이 게시물을 삭제하시겠습니까? 관련된 댓글과 좋아요도 함께 삭제됩니다.')) return;
                
                try {
                    await axios.delete(\`/api/admin/posts/\${postId}\`, {
                        headers: { 'X-Admin-ID': adminId }
                    });
                    alert('게시물이 삭제되었습니다.');
                    loadStats();
                    loadAdminPosts();
                } catch (error) {
                    console.error('Failed to delete post:', error);
                    alert('게시물 삭제에 실패했습니다.');
                }
            }

            window.deleteAllPosts = async function() {
                if (!confirm('⚠️ 경고: 모든 게시물을 삭제하시겠습니까?\\n\\n이 작업은 되돌릴 수 없으며, 모든 게시물과 관련된 댓글, 좋아요가 함께 삭제됩니다.')) {
                    return;
                }
                
                // Double confirmation
                const confirmText = prompt('정말로 삭제하시려면 "DELETE"를 입력하세요:');
                if (confirmText !== 'DELETE') {
                    alert('삭제가 취소되었습니다.');
                    return;
                }
                
                try {
                    const response = await axios.delete('/api/admin/posts', {
                        headers: { 'X-Admin-ID': adminId }
                    });
                    alert(\`\${response.data.deleted_count}개의 게시물이 삭제되었습니다.\`);
                    loadStats();
                    loadAdminPosts();
                } catch (error) {
                    console.error('Failed to delete all posts:', error);
                    alert('게시물 삭제에 실패했습니다.');
                }
            }

            window.createFakePosts = async function() {
                const count = prompt('생성할 테스트 게시물 수를 입력하세요 (최대 100개):', '20');
                if (!count) return;
                
                try {
                    const response = await axios.post('/api/admin/create-fake-posts', 
                        { count: parseInt(count) },
                        { headers: { 'X-Admin-ID': adminId } }
                    );
                    alert(\`\${response.data.count}개의 테스트 게시물이 생성되었습니다.\\n\\n7가지 카테고리로 랜덤 생성되었습니다:\\n- 중보 기도\\n- 말씀\\n- 일상\\n- 사역\\n- 찬양\\n- 교회\\n- 자유\`);
                    loadStats();
                    loadAdminPosts();
                } catch (error) {
                    console.error('Failed to create fake posts:', error);
                    if (error.response && error.response.status === 400) {
                        alert(error.response.data.error || '게시물 생성에 실패했습니다. 먼저 사용자를 생성해주세요.');
                    } else {
                        alert('테스트 게시물 생성에 실패했습니다.');
                    }
                }
            }

            window.createFakeComments = async function() {
                const count = prompt('생성할 테스트 댓글 수를 입력하세요 (최대 200개):', '50');
                if (!count) return;
                
                try {
                    const response = await axios.post('/api/admin/create-fake-comments', 
                        { count: parseInt(count) },
                        { headers: { 'X-Admin-ID': adminId } }
                    );
                    alert(\`\${response.data.count}개의 테스트 댓글이 생성되었습니다.\\n\\n랜덤으로 게시물에 배치되었습니다.\`);
                    loadStats();
                    loadAdminPosts();
                } catch (error) {
                    console.error('Failed to create fake comments:', error);
                    if (error.response && error.response.status === 400) {
                        alert(error.response.data.error || '댓글 생성에 실패했습니다. 먼저 게시물을 생성해주세요.');
                    } else {
                        alert('테스트 댓글 생성에 실패했습니다.');
                    }
                }
            }

            window.createFakeLikes = async function() {
                const count = prompt('생성할 테스트 반응(좋아요/아멘/할렐루야 등) 수를 입력하세요 (최대 500개):', '100');
                if (!count) return;
                
                try {
                    const response = await axios.post('/api/admin/create-fake-likes', 
                        { count: parseInt(count) },
                        { headers: { 'X-Admin-ID': adminId } }
                    );
                    alert(\`\${response.data.count}개의 테스트 반응이 생성되었습니다.\\n\\n7가지 포스팅 타입에 맞는 반응:\\n- 중보 기도: 기도했어요\\n- 말씀: 아멘\\n- 일상: 좋아요\\n- 사역: 하나님 함께하시길\\n- 찬양: 할렐루야\\n- 교회: Body of Christ\\n- 자유: 좋아요\`);
                    loadStats();
                    loadAdminPosts();
                } catch (error) {
                    console.error('Failed to create fake likes:', error);
                    if (error.response && error.response.status === 400) {
                        alert(error.response.data.error || '반응 생성에 실패했습니다. 먼저 게시물을 생성해주세요.');
                    } else {
                        alert('테스트 반응 생성에 실패했습니다.');
                    }
                }
            }

            window.simulateTimePass = async function() {
                const days = prompt('🕐 몇 일간의 활동을 시뮬레이션할까요? (1-365일)\\n\\n✨ 자동으로 다음이 생성됩니다:\\n• 신규 회원 가입 (3-7일마다 1-3명)\\n• 일일 포스팅 (하루 2-8개)\\n• 댓글 (포스팅의 30%)\\n• 좋아요/반응 (포스팅의 40%)\\n• 기도 클릭 (기도 포스팅의 50%)\\n\\n추천: 7-30일', '14');
                if (!days) return;
                
                const daysNum = parseInt(days);
                if (isNaN(daysNum) || daysNum < 1 || daysNum > 365) {
                    alert('❌ 1-365 사이의 숫자를 입력해주세요.');
                    return;
                }
                
                // Estimate data to be created
                const estimatedUsers = Math.floor(daysNum / 5) * 2;
                const estimatedPosts = daysNum * 5;
                const estimatedComments = Math.floor(estimatedPosts * 0.3) * 3;
                const estimatedLikes = Math.floor(estimatedPosts * 0.4) * 5;
                
                if (!confirm(\`🌱 \${daysNum}일간의 자연스러운 활동을 시뮬레이션합니다\\n\\n📊 예상 생성량:\\n• 신규 회원: 약 \${estimatedUsers}명\\n• 포스팅: 약 \${estimatedPosts}개\\n• 댓글: 약 \${estimatedComments}개\\n• 좋아요/반응: 약 \${estimatedLikes}개\\n\\n⏱️ 소요 시간: 약 \${Math.ceil(daysNum / 10)}분\\n\\n⚠️ 이 작업은 되돌릴 수 없습니다!\\n\\n계속하시겠습니까?\`)) {
                    return;
                }
                
                // Show loading indicator
                const loadingDiv = document.createElement('div');
                loadingDiv.id = 'simulationLoading';
                loadingDiv.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
                loadingDiv.innerHTML = \`
                    <div class="bg-white rounded-lg p-8 max-w-md">
                        <div class="text-center">
                            <i class="fas fa-spinner fa-spin text-4xl text-blue-600 mb-4"></i>
                            <h3 class="text-xl font-bold mb-2">시뮬레이션 진행 중...</h3>
                            <p class="text-gray-600 text-sm">잠시만 기다려주세요.</p>
                            <p class="text-gray-500 text-xs mt-4">⏱️ \${daysNum}일치 데이터를 생성하고 있습니다</p>
                        </div>
                    </div>
                \`;
                document.body.appendChild(loadingDiv);
                
                try {
                    const response = await axios.post('/api/admin/simulate-time-pass', 
                        { days: daysNum },
                        { headers: { 'X-Admin-ID': adminId } }
                    );
                    
                    // Remove loading
                    document.getElementById('simulationLoading')?.remove();
                    
                    const stats = response.data.stats;
                    alert(\`✅ \${daysNum}일간의 활동 시뮬레이션 완료!\\n\\n📊 생성된 데이터:\\n• 신규 회원: \${stats.users_created}명\\n• 포스팅: \${stats.posts_created}개\\n• 댓글: \${stats.comments_created}개\\n• 좋아요: \${stats.likes_created}개\\n• 기도 반응: \${stats.prayers_created}개\\n\\n🎉 \${daysNum}일간의 자연스러운 커뮤니티 활동이 재현되었습니다!\\n\\n💡 메인 페이지를 새로고침하여 결과를 확인하세요!\`);
                    
                    loadStats();
                    loadAdminPosts();
                } catch (error) {
                    console.error('Failed to simulate time pass:', error);
                    document.getElementById('simulationLoading')?.remove();
                    alert(\`❌ 시뮬레이션 실패\\n\\n오류: \${error.response?.data?.error || error.message}\\n\\n최소 1명 이상의 회원이 필요합니다.\`);
                }
            }

            // Edit post functions (for main app)
            window.editPost = async function(postId) {
                try {
                    // Fetch post data
                    const response = await axios.get(\`/api/posts/\${postId}\`);
                    const post = response.data;
                    
                    // Fill modal with current data
                    document.getElementById('editPostId').value = postId;
                    document.getElementById('editPostContent').value = post.content || '';
                    document.getElementById('editPostVerseReference').value = post.verse_reference || '';
                    document.getElementById('editPostBackgroundColor').value = post.background_color || '#FFFFFF';
                    
                    // Update color selection display
                    selectEditBackgroundColor(post.background_color || '#FFFFFF');
                    
                    // Show modal
                    document.getElementById('editPostModal').classList.remove('hidden');
                } catch (error) {
                    console.error('Failed to load post:', error);
                    alert('게시물을 불러오는데 실패했습니다.');
                }
            }

            window.hideEditPostModal = function() {
                document.getElementById('editPostModal').classList.add('hidden');
            }

            window.selectEditBackgroundColor = function(color) {
                document.getElementById('editPostBackgroundColor').value = color;
                
                // Update UI to show selected color
                const colorButtons = document.querySelectorAll('#editPostModal button[onclick^="selectEditBackgroundColor"]');
                colorButtons.forEach(btn => {
                    if (btn.style.backgroundColor.toLowerCase() === color.toLowerCase() || 
                        (color === '#FFFFFF' && btn.classList.contains('bg-white'))) {
                        btn.classList.remove('border-transparent');
                        btn.classList.add('border-blue-500');
                    } else {
                        btn.classList.add('border-transparent');
                        btn.classList.remove('border-blue-500');
                    }
                });
                
                // Update color name
                const colorNames = {
                    '#F87171': '중보 기도',
                    '#F5E398': '말씀',
                    '#F5D4B3': '일상',
                    '#B3EDD8': '사역',
                    '#C4E5F8': '찬양',
                    '#E2DBFB': '교회',
                    '#FFFFFF': '자유'
                };
                document.getElementById('editSelectedColorName').textContent = colorNames[color] || '자유';
            }

            window.saveEditedPost = async function() {
                const postId = document.getElementById('editPostId').value;
                const content = document.getElementById('editPostContent').value.trim();
                const verseReference = document.getElementById('editPostVerseReference').value.trim();
                const backgroundColor = document.getElementById('editPostBackgroundColor').value;
                
                if (!content) {
                    alert('내용을 입력해주세요.');
                    return;
                }
                
                try {
                    await axios.put(\`/api/posts/\${postId}\`, {
                        content,
                        verse_reference: verseReference || null,
                        background_color: backgroundColor
                    });
                    
                    // Show success message
                    showToast('게시물이 수정되었습니다.', 'success');
                    
                    // Hide modal
                    hideEditPostModal();
                    
                    // Reload posts to show updated content
                    loadPosts();
                } catch (error) {
                    console.error('Failed to update post:', error);
                    alert('게시물 수정에 실패했습니다.');
                }
            }


            // Friendships Management Functions
            async function loadFriendships() {
                try {
                    const response = await axios.get('/api/admin/friendships', {
                        headers: { 'X-Admin-ID': adminId }
                    });
                    
                    const tbody = document.getElementById('friendshipsTableBody');
                    tbody.innerHTML = response.data.friendships.map(friendship => {
                        const statusBadge = friendship.status === 'accepted' 
                            ? '<span class="px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">수락됨</span>'
                            : friendship.status === 'pending'
                            ? '<span class="px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">대기중</span>'
                            : '<span class="px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">거절됨</span>';
                        
                        const date = new Date(friendship.created_at);
                        const formattedDate = date.toLocaleDateString('ko-KR', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        
                        return \`
                            <tr class="hover:bg-gray-50">
                                <td class="px-4 py-3 text-sm">\${friendship.id}</td>
                                <td class="px-4 py-3 text-sm">
                                    <div class="font-semibold text-blue-600 hover:text-blue-800 cursor-pointer" onclick="showFriendshipGraph(\${friendship.user_id}, '\${friendship.user_name}')">\${friendship.user_name}</div>
                                    <div class="text-xs text-gray-500">\${friendship.user_email}</div>
                                    <div class="text-xs text-gray-400">\${friendship.user_church || '-'}</div>
                                </td>
                                <td class="px-4 py-3 text-sm">
                                    <div class="font-semibold text-blue-600 hover:text-blue-800 cursor-pointer" onclick="showFriendshipGraph(\${friendship.friend_id}, '\${friendship.friend_name}')">\${friendship.friend_name}</div>
                                    <div class="text-xs text-gray-500">\${friendship.friend_email}</div>
                                    <div class="text-xs text-gray-400">\${friendship.friend_church || '-'}</div>
                                </td>
                                <td class="px-4 py-3 text-sm">\${statusBadge}</td>
                                <td class="px-4 py-3 text-sm text-gray-500">\${formattedDate}</td>
                                <td class="px-4 py-3 text-sm">
                                    <button 
                                        onclick="deleteFriendship(\${friendship.id})"
                                        class="text-red-600 hover:text-red-800 transition">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </td>
                            </tr>
                        \`;
                    }).join('');
                } catch (error) {
                    console.error('Failed to load friendships:', error);
                    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
                        alert('관리자 권한이 필요합니다.');
                        window.location.href = '/';
                    }
                }
            }

            window.deleteFriendship = async function(friendshipId) {
                if (!confirm('이 친구 관계를 삭제하시겠습니까?')) return;
                
                try {
                    await axios.delete(\`/api/admin/friendships/\${friendshipId}\`, {
                        headers: { 'X-Admin-ID': adminId }
                    });
                    alert('친구 관계가 삭제되었습니다.');
                    loadStats();
                    loadFriendships();
                } catch (error) {
                    console.error('Failed to delete friendship:', error);
                    alert('친구 관계 삭제에 실패했습니다.');
                }
            }

            window.deleteAllFriendships = async function() {
                if (!confirm('⚠️ 경고: 모든 친구 관계를 삭제하시겠습니까?\\n\\n이 작업은 되돌릴 수 없습니다.')) {
                    return;
                }
                
                // Double confirmation
                const confirmText = prompt('정말로 삭제하시려면 "DELETE"를 입력하세요:');
                if (confirmText !== 'DELETE') {
                    alert('삭제가 취소되었습니다.');
                    return;
                }
                
                try {
                    const response = await axios.delete('/api/admin/friendships', {
                        headers: { 'X-Admin-ID': adminId }
                    });
                    alert(\`\${response.data.deleted_count}개의 친구 관계가 삭제되었습니다.\`);
                    loadStats();
                    loadFriendships();
                } catch (error) {
                    console.error('Failed to delete all friendships:', error);
                    alert('친구 관계 삭제에 실패했습니다.');
                }
            }

            window.createRandomFriendships = async function() {
                const count = prompt('생성할 랜덤 친구 관계 개수를 입력하세요:', '20');
                if (!count || isNaN(count)) {
                    alert('올바른 숫자를 입력해주세요.');
                    return;
                }
                
                try {
                    // Show loading message
                    const originalText = event.target.innerHTML;
                    event.target.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>생성 중...';
                    event.target.disabled = true;
                    
                    const response = await axios.post('/api/admin/create-fake-friendships', 
                        { count: parseInt(count) },
                        {
                            headers: { 'X-Admin-ID': adminId }
                        }
                    );
                    
                    // Restore button
                    event.target.innerHTML = originalText;
                    event.target.disabled = false;
                    
                    alert(\`✅ \${response.data.count}개의 랜덤 친구 관계가 생성되었습니다!\\n\\n- 수락됨: 약 80%\\n- 대기중: 약 10%\\n- 거절됨: 약 10%\`);
                    loadStats();
                    loadFriendships();
                } catch (error) {
                    console.error('Failed to create friendships:', error);
                    alert('친구 관계 생성에 실패했습니다: ' + (error.response?.data?.error || error.message));
                    event.target.innerHTML = originalText;
                    event.target.disabled = false;
                }
            }

            // Friendship Graph Functions
            window.showFriendshipGraph = async function(userId, userName) {
                try {
                    // Get all friendships for this user
                    const response = await axios.get('/api/admin/friendships', {
                        headers: { 'X-Admin-ID': adminId }
                    });
                    
                    const allFriendships = response.data.friendships || [];
                    
                    // Filter friendships related to this user
                    const userFriendships = allFriendships.filter(f => 
                        f.user_id === userId || f.friend_id === userId
                    );
                    
                    // Build nodes and edges
                    const nodes = new Map();
                    const edges = [];
                    
                    // Add center node (selected user)
                    nodes.set(userId, {
                        id: userId,
                        name: userName,
                        x: 450,
                        y: 300,
                        isCenter: true
                    });
                    
                    // Add connected nodes
                    userFriendships.forEach(f => {
                        const friendId = f.user_id === userId ? f.friend_id : f.user_id;
                        const friendName = f.user_id === userId ? f.friend_name : f.user_name;
                        
                        if (!nodes.has(friendId)) {
                            nodes.set(friendId, {
                                id: friendId,
                                name: friendName,
                                x: 0, // Will be calculated
                                y: 0,
                                isCenter: false
                            });
                        }
                        
                        edges.push({
                            from: f.user_id,
                            to: f.friend_id,
                            status: f.status
                        });
                    });
                    
                    // Get friendships between connected nodes (2nd degree)
                    const connectedIds = Array.from(nodes.keys()).filter(id => id !== userId);
                    const secondDegree = allFriendships.filter(f => 
                        connectedIds.includes(f.user_id) && connectedIds.includes(f.friend_id)
                    );
                    
                    secondDegree.forEach(f => {
                        edges.push({
                            from: f.user_id,
                            to: f.friend_id,
                            status: f.status
                        });
                    });
                    
                    // Position nodes in a circle around center
                    const connectedNodes = Array.from(nodes.values()).filter(n => !n.isCenter);
                    const angleStep = (2 * Math.PI) / Math.max(connectedNodes.length, 1);
                    const radius = 200;
                    
                    connectedNodes.forEach((node, i) => {
                        const angle = i * angleStep;
                        node.x = 450 + radius * Math.cos(angle);
                        node.y = 300 + radius * Math.sin(angle);
                    });
                    
                    // Show modal and draw graph
                    document.getElementById('graphModal').classList.remove('hidden');
                    document.getElementById('graphTitle').textContent = \`\${userName}의 친구 네트워크\`;
                    document.getElementById('graphSubtitle').textContent = \`\${connectedNodes.length}명의 친구 • \${edges.length}개의 관계\`;
                    
                    drawFriendshipGraph(Array.from(nodes.values()), edges);
                    
                } catch (error) {
                    console.error('Failed to load friendship graph:', error);
                    alert('친구 네트워크를 불러오는데 실패했습니다.');
                }
            }
            
            window.closeGraphModal = function() {
                document.getElementById('graphModal').classList.add('hidden');
            }
            
            function drawFriendshipGraph(nodes, edges) {
                const canvas = document.getElementById('friendshipCanvas');
                const ctx = canvas.getContext('2d');
                
                // Clear canvas
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                // Calculate dynamic sizing based on number of nodes
                const nodeCount = nodes.length;
                let nodeRadius, fontSize, centerFontSize;
                
                // Dynamic sizing logic
                if (nodeCount <= 10) {
                    nodeRadius = 12;
                    fontSize = 11;
                    centerFontSize = 13;
                } else if (nodeCount <= 20) {
                    nodeRadius = 10;
                    fontSize = 10;
                    centerFontSize = 12;
                } else if (nodeCount <= 30) {
                    nodeRadius = 8;
                    fontSize = 9;
                    centerFontSize = 10;
                } else if (nodeCount <= 50) {
                    nodeRadius = 7;
                    fontSize = 8;
                    centerFontSize = 9;
                } else if (nodeCount <= 100) {
                    nodeRadius = 6;
                    fontSize = 7;
                    centerFontSize = 8;
                } else {
                    nodeRadius = 5;
                    fontSize = 6;
                    centerFontSize = 7;
                }
                
                // Draw edges first
                edges.forEach(edge => {
                    const fromNode = nodes.find(n => n.id === edge.from);
                    const toNode = nodes.find(n => n.id === edge.to);
                    
                    if (fromNode && toNode) {
                        ctx.beginPath();
                        ctx.moveTo(fromNode.x, fromNode.y);
                        ctx.lineTo(toNode.x, toNode.y);
                        
                        // Color based on status
                        if (edge.status === 'accepted') {
                            ctx.strokeStyle = '#10b981'; // green
                            ctx.lineWidth = 2;
                        } else if (edge.status === 'pending') {
                            ctx.strokeStyle = '#f59e0b'; // yellow
                            ctx.lineWidth = 2;
                            ctx.setLineDash([5, 5]); // dashed
                        } else {
                            ctx.strokeStyle = '#ef4444'; // red
                            ctx.lineWidth = 1;
                            ctx.setLineDash([2, 2]);
                        }
                        
                        ctx.stroke();
                        ctx.setLineDash([]); // reset dash
                        
                        // Draw arrow
                        const angle = Math.atan2(toNode.y - fromNode.y, toNode.x - fromNode.x);
                        const arrowLength = 8;
                        const arrowX = toNode.x - (nodeRadius + 2) * Math.cos(angle);
                        const arrowY = toNode.y - (nodeRadius + 2) * Math.sin(angle);
                        
                        ctx.beginPath();
                        ctx.moveTo(arrowX, arrowY);
                        ctx.lineTo(
                            arrowX - arrowLength * Math.cos(angle - Math.PI / 6),
                            arrowY - arrowLength * Math.sin(angle - Math.PI / 6)
                        );
                        ctx.moveTo(arrowX, arrowY);
                        ctx.lineTo(
                            arrowX - arrowLength * Math.cos(angle + Math.PI / 6),
                            arrowY - arrowLength * Math.sin(angle + Math.PI / 6)
                        );
                        ctx.stroke();
                    }
                });
                
                // Draw nodes
                nodes.forEach(node => {
                    // Node circle - dynamic size based on node count
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, nodeRadius, 0, 2 * Math.PI);
                    
                    if (node.isCenter) {
                        ctx.fillStyle = '#3b82f6'; // blue
                    } else {
                        ctx.fillStyle = '#10b981'; // green
                    }
                    ctx.fill();
                    
                    // White border
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    
                    // Node label - dynamic font size
                    ctx.fillStyle = '#1f2937';
                    const nodeFontSize = node.isCenter ? centerFontSize : fontSize;
                    ctx.font = node.isCenter ? 'bold ' + nodeFontSize + 'px Arial' : nodeFontSize + 'px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    
                    // Text with background
                    const textWidth = ctx.measureText(node.name).width;
                    const textY = node.y + nodeRadius + 3;
                    const textHeight = nodeFontSize + 4;
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                    ctx.fillRect(node.x - textWidth / 2 - 2, textY, textWidth + 4, textHeight);
                    
                    ctx.fillStyle = '#1f2937';
                    ctx.fillText(node.name, node.x, textY + 2);
                });
            }

            // Initialize
            if (!adminId) {
                alert('로그인이 필요합니다.');
                window.location.href = '/';
            } else {
                loadStats();
                loadUsers();
                loadAdminPosts();
                loadFriendships();
            }
        </script>
    </body>
    </html>
  `)
})

app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="theme-color" content="#A55148">
        <meta name="color-scheme" content="light only">
        <title>CROSSfriends - 기독교인 소셜 네트워크</title>
        <link rel="manifest" href="/static/manifest.json">
        <link rel="icon" type="image/png" href="/static/icon-192.png">
        <link rel="icon" type="image/png" sizes="192x192" href="/static/icon-192.png">
        <link rel="apple-touch-icon" href="/static/apple-touch-icon.png">
        <script src="https://cdn.tailwindcss.com"></script>
        <script>
            // Suppress Tailwind CDN warnings
            tailwind.config = { corePlugins: { preflight: true } }
        </script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <link href="https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.css" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>
            /* Prevent horizontal scroll on mobile */
            html, body {
                overflow-x: hidden;
                max-width: 100vw;
                position: relative;
                height: 100%;
                min-height: 100vh;
                background-color: #f9fafb;
                color: #111827;
                color-scheme: light;
            }
            body {
                -webkit-overflow-scrolling: touch;
                overflow-y: auto;
            }
            
            /* CROSSfriends Color System - 7 Colors */
            :root {
                --color-primary: #3B82F6;
                --color-primary-dark: #2563EB;
                --color-primary-light: #60A5FA;
                --color-accent: #DC2626;
                --color-accent-dark: #B91C1C;
                --color-accent-light: #EF4444;
                --color-success: #16A34A;
                --color-warning: #CA8A04;
                --color-warning-light: #FACC15;
                --color-info: #0891B2;
                --color-neutral: #6B7280;
                --color-neutral-light: #9CA3AF;
                --color-neutral-dark: #374151;
            }
            
            .cross-icon {
                position: relative;
                display: inline-block;
                width: 24px;
                height: 24px;
            }
            .cross-icon::before,
            .cross-icon::after {
                content: '';
                position: absolute;
                background-color: var(--color-accent);
            }
            .cross-icon::before {
                width: 2.5px;
                height: 24px;
                left: 50%;
                transform: translateX(-50%);
            }
            .cross-icon::after {
                width: 24px;
                height: 2.5px;
                top: 50%;
                transform: translateY(-50%);
            }
            .cross-dot {
                position: absolute;
                width: 7px;
                height: 7px;
                background-color: var(--color-accent);
                border-radius: 50%;
            }
            .cross-dot.top { top: -2.5px; left: 50%; transform: translateX(-50%); }
            .cross-dot.bottom { bottom: -2.5px; left: 50%; transform: translateX(-50%); }
            .cross-dot.left { left: -2.5px; top: 50%; transform: translateY(-50%); }
            .cross-dot.right { right: -2.5px; top: 50%; transform: translateY(-50%); }
            .logo-cross-img {
                /* Match brand-red feel of original cross icon */
                filter: saturate(1.35) contrast(1.05) brightness(0.95);
            }
            /* Unified typography scale (mobile + desktop) */
            .font-size-title { font-size: 1.15rem; }
            .font-size-base { font-size: 1.03rem; }
            .font-size-desc { font-size: 0.88rem; }
            .font-size-mini1 { font-size: 0.78rem; }
            .basic-reward-badge,
            .reward-one-badge,
            .reward-two-badge,
            .reward-three-badge {
                display: inline-flex;
                align-items: center;
                white-space: nowrap;
            }
            .reward-card-collapsible {
                cursor: pointer;
            }
            .reward-card-header-line {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 0.55rem;
                margin-bottom: 0.65rem;
            }
            .reward-card-header-title {
                display: inline-flex;
                align-items: center;
                min-width: 0;
                font-size: 1rem;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .reward-card-header-right {
                display: inline-flex;
                align-items: center;
                gap: 0.35rem;
                color: #1d4ed8;
                flex-shrink: 0;
            }
            .reward-card-chevron {
                font-size: 0.88rem;
                transition: transform 0.2s ease;
                display: inline-block;
            }
            #typingToggleIcon {
                display: none !important; /* 말씀 타이핑 버튼 우측 삼각형 숨김 */
            }
            .reward-card-content {
                display: block;
            }
            .reward-card-collapsed .reward-card-content {
                display: none;
            }
            .reward-card-collapsible.reward-card-collapsed {
                /* slightly tighter collapsed height */
                padding-top: 12px !important;
                padding-bottom: 12px !important;
                display: flex;
                align-items: center;
            }
            .reward-card-collapsed .reward-card-header-line {
                margin-bottom: 0;
                width: 100%;
            }
            @media (min-width: 1024px) {
                /* Keep left sidebar width identical pre/post login (fixed scrollbar lane) */
                #leftSidebar {
                    overflow-y: scroll !important;
                    overflow-x: hidden !important;
                    scrollbar-gutter: stable both-edges;
                }
                #leftSidebar .sidebar-scroll {
                    overflow-y: visible !important;
                    padding-left: 0 !important;
                    margin-left: 0 !important;
                }
                /* Lock reward cards to same X-position pre/post login */
                #verseRewardSection,
                #sermonRewardSection,
                #qtWorshipRewardSection,
                #qtAlarmRewardSection {
                    margin-left: 0 !important;
                    transform: none !important;
                }
                .pc-logo-hover:hover .pc-logo-cross-spin {
                    animation: logoCrossGlow 1.4s ease-in-out infinite;
                }
            }
            @keyframes logoCrossGlow {
                0%, 100% {
                    filter: saturate(1.35) contrast(1.05) brightness(0.95) drop-shadow(0 0 0px rgba(220,38,38,0));
                }
                50% {
                    filter: saturate(1.6) contrast(1.1) brightness(1.15) drop-shadow(0 0 8px rgba(220,38,38,0.85)) drop-shadow(0 0 16px rgba(220,38,38,0.45));
                }
            }
            
            /* Admin Badge Styles */
            .admin-badge-container {
                position: relative;
            }
            .admin-badge {
                position: absolute;
                bottom: -2px;
                right: -2px;
                width: 20px;
                height: 20px;
                background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
                border: 2px solid white;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                z-index: 10;
            }
            .admin-badge i {
                color: white;
                font-size: 10px;
            }
            .admin-badge-crown {
                position: absolute;
                bottom: -2px;
                right: -2px;
                width: 22px;
                height: 22px;
                background: linear-gradient(135deg, var(--color-warning-light) 0%, var(--color-warning) 100%);
                border: 2.5px solid white;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 6px rgba(251, 191, 36, 0.4);
                z-index: 10;
                animation: pulse-crown 2s infinite;
            }
            .admin-badge-crown i {
                color: white;
                font-size: 11px;
                filter: drop-shadow(0 1px 1px rgba(0,0,0,0.3));
            }
            @keyframes pulse-crown {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.1); }
            }

            /* 종합 μ 마일스톤 축하 모달 (200 / 1000 / 1400) */
            #scoreMilestoneCelebrationModal .milestone-modal-card {
                transform: scale(0.9) translateY(12px);
                opacity: 0;
                transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s ease;
            }
            #scoreMilestoneCelebrationModal.milestone-modal-active .milestone-modal-card {
                transform: scale(1) translateY(0);
                opacity: 1;
            }
            @keyframes milestoneJackpotGlow {
                0% {
                    opacity: 0;
                    box-shadow: inset 0 0 0 0 rgba(99, 102, 241, 0);
                }
                40% {
                    opacity: 1;
                    box-shadow:
                        inset 0 0 60px 20px rgba(99, 102, 241, 0.35),
                        0 0 50px 18px rgba(139, 92, 246, 0.4),
                        0 0 100px 36px rgba(59, 130, 246, 0.2);
                }
                100% {
                    opacity: 0.55;
                    box-shadow:
                        inset 0 0 30px 10px rgba(99, 102, 241, 0.12),
                        0 0 28px 10px rgba(139, 92, 246, 0.15);
                }
            }
            .milestone-glow-burst {
                animation: milestoneJackpotGlow 1.35s ease-out forwards;
            }
            @keyframes milestoneSparkFloat {
                0% { transform: translateY(0) scale(0.6); opacity: 0; }
                20% { opacity: 1; }
                100% { transform: translateY(-48px) scale(1); opacity: 0; }
            }
            .milestone-spark {
                position: absolute;
                width: 8px;
                height: 8px;
                border-radius: 50%;
                animation: milestoneSparkFloat 1.4s ease-out forwards;
            }
            .milestone-spark-1 { left: 12%; bottom: 28%; background: #60a5fa; animation-delay: 0.05s; }
            .milestone-spark-2 { left: 42%; bottom: 18%; background: #a78bfa; animation-delay: 0.15s; width: 6px; height: 6px; }
            .milestone-spark-3 { right: 18%; bottom: 32%; background: #f472b6; animation-delay: 0.1s; }
            .milestone-spark-4 { right: 38%; bottom: 22%; background: #34d399; animation-delay: 0.22s; width: 5px; height: 5px; }
            .milestone-spark-5 { left: 72%; bottom: 40%; background: #fbbf24; animation-delay: 0.18s; }

            /* 로그인 시 리워드·μ 축하 패널 (매 접속) */
            #loginRewardCelebrationModal .login-reward-celeb-card {
                transform: scale(0.88) translateY(20px);
                opacity: 0;
                transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.45s ease;
            }
            #loginRewardCelebrationModal.login-reward-celeb-active .login-reward-celeb-card {
                transform: scale(1) translateY(0);
                opacity: 1;
            }
            @keyframes loginRewardSparkFloat {
                0% { transform: translateY(0) scale(0.5) rotate(0deg); opacity: 0; }
                15% { opacity: 1; }
                100% { transform: translateY(-56px) scale(1) rotate(180deg); opacity: 0; }
            }
            @keyframes loginRewardConfettiDrift {
                0% { transform: translateY(0) rotate(0deg); opacity: 0.9; }
                100% { transform: translateY(12px) rotate(360deg); opacity: 0.4; }
            }
            .login-reward-spark {
                position: absolute;
                width: 9px;
                height: 9px;
                border-radius: 50%;
                animation: loginRewardSparkFloat 1.5s ease-out forwards;
            }
            .login-reward-spark.lr-s1 { left: 8%; bottom: 22%; background: #fbbf24; animation-delay: 0.02s; }
            .login-reward-spark.lr-s2 { left: 28%; bottom: 12%; background: #60a5fa; animation-delay: 0.1s; width: 7px; height: 7px; }
            .login-reward-spark.lr-s3 { left: 52%; bottom: 18%; background: #f472b6; animation-delay: 0.06s; }
            .login-reward-spark.lr-s4 { right: 22%; bottom: 14%; background: #34d399; animation-delay: 0.14s; width: 6px; height: 6px; }
            .login-reward-spark.lr-s5 { right: 10%; bottom: 28%; background: #a78bfa; animation-delay: 0.11s; }
            .login-reward-spark.lr-s6 { left: 70%; bottom: 8%; background: #fb923c; animation-delay: 0.18s; width: 5px; height: 5px; }
            .login-reward-confetti {
                position: absolute;
                width: 10px;
                height: 6px;
                border-radius: 1px;
                opacity: 0.85;
                animation: loginRewardConfettiDrift 2.5s ease-in-out infinite alternate;
            }
            .login-reward-confetti.c1 { top: 12%; left: 15%; background: #fde047; animation-delay: 0s; }
            .login-reward-confetti.c2 { top: 18%; right: 20%; background: #93c5fd; width: 8px; height: 5px; animation-delay: 0.4s; }
            .login-reward-confetti.c3 { top: 8%; left: 45%; background: #fda4af; animation-delay: 0.2s; }
            @keyframes loginRewardFireworkBurst {
                0% { transform: translate(-50%, -50%) scale(0.18); opacity: 0; }
                24% { opacity: 1; }
                100% { transform: translate(-50%, -50%) scale(1.18); opacity: 0; }
            }
            .login-reward-firework {
                position: absolute;
                width: 30px;
                height: 30px;
                border-radius: 9999px;
                pointer-events: none;
                opacity: 0;
                background:
                    radial-gradient(circle, rgba(255,255,255,0.98) 0 6%, rgba(255,255,255,0) 7%),
                    repeating-conic-gradient(
                        from 0deg,
                        rgba(250,204,21,0.98) 0deg 8deg,
                        rgba(96,165,250,0.98) 8deg 16deg,
                        rgba(244,114,182,0.98) 16deg 24deg,
                        rgba(52,211,153,0.98) 24deg 32deg,
                        rgba(167,139,250,0.98) 32deg 40deg
                    ),
                    repeating-radial-gradient(
                        circle,
                        rgba(255,255,255,0.75) 0 2px,
                        rgba(255,255,255,0) 2px 6px
                    );
                mix-blend-mode: screen;
                filter: blur(0.2px) drop-shadow(0 0 16px rgba(167, 139, 250, 0.75));
            }
            .login-reward-firework.fw-left { left: 18%; top: 14%; animation-delay: 0.06s; }
            .login-reward-firework.fw-right { right: 14%; top: 11%; animation-delay: 0.22s; }
            .login-reward-firework.fw-mid { left: 50%; top: 6%; animation-delay: 0.34s; width: 34px; height: 34px; }
            .login-reward-firework.fw-left2 { left: 34%; top: 10%; animation-delay: 0.14s; width: 32px; height: 32px; }
            .login-reward-firework.fw-right2 { right: 30%; top: 9%; animation-delay: 0.28s; width: 32px; height: 32px; }
            /* 고정 불꽃은 숨기고, JS로 랜덤 불꽃만 사용 */
            #loginRewardCelebrationModal .login-reward-firework.fw-left,
            #loginRewardCelebrationModal .login-reward-firework.fw-right,
            #loginRewardCelebrationModal .login-reward-firework.fw-mid,
            #loginRewardCelebrationModal .login-reward-firework.fw-left2,
            #loginRewardCelebrationModal .login-reward-firework.fw-right2 {
                display: none;
            }
            #loginRewardCelebrationModal.login-reward-celeb-active .login-reward-firework {
                animation: loginRewardFireworkBurst 0.85s ease-out forwards;
            }
            @keyframes loginRewardConfettiFall {
                0% { transform: translateY(-35px) rotate(0deg); opacity: 0; }
                15% { opacity: 1; }
                100% { transform: translateY(175px) rotate(360deg); opacity: 0; }
            }
            .login-reward-fall {
                position: absolute;
                top: 6%;
                width: 7px;
                height: 12px;
                border-radius: 2px;
                opacity: 0;
                pointer-events: none;
                --fall-duration: 1.95s;
            }
            #loginRewardCelebrationModal.login-reward-celeb-active .login-reward-fall {
                animation: loginRewardConfettiFall var(--fall-duration) ease-out forwards;
            }
            /* 카드(낙하 컨페티)+작은 불꽃만 표시 */
            #loginRewardCelebrationModal .login-reward-spark,
            #loginRewardCelebrationModal .login-reward-fanfare,
            #loginRewardCelebrationModal .login-reward-confetti {
                display: none;
            }
            @keyframes loginRewardFanfareFloat {
                0% { transform: translateY(8px) scale(0.88); opacity: 0; }
                18% { opacity: 1; }
                100% { transform: translateY(-34px) scale(1.08); opacity: 0; }
            }
            .login-reward-fanfare {
                position: absolute;
                pointer-events: none;
                opacity: 0;
                font-weight: 900;
                text-shadow: 0 0 8px rgba(255,255,255,0.75), 0 0 14px rgba(99,102,241,0.4);
                z-index: 40;
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 3px 7px;
                border-radius: 9999px;
                border: 1px solid rgba(255,255,255,0.9);
                background: rgba(255,255,255,0.95);
                box-shadow: 0 6px 18px rgba(79, 70, 229, 0.25);
            }
            .login-reward-fanfare i { font-size: 14px; }
            .login-reward-fanfare .hit { font-size: 10px; line-height: 1; font-weight: 800; letter-spacing: 0.2px; }
            .login-reward-fanfare.t1 { left: 7%; top: 22%; color: #d97706; animation-delay: 0.1s; }
            .login-reward-fanfare.t2 { right: 8%; top: 24%; color: #2563eb; animation-delay: 0.22s; }
            .login-reward-fanfare.n1 { left: 16%; top: 17%; color: #7c3aed; animation-delay: 0.18s; }
            .login-reward-fanfare.n2 { right: 17%; top: 16%; color: #db2777; animation-delay: 0.3s; }
            #loginRewardCelebrationModal.login-reward-celeb-active .login-reward-fanfare {
                animation: loginRewardFanfareFloat 1.2s ease-out forwards;
            }
            @keyframes loginRewardMuPulse {
                0%, 100% { filter: drop-shadow(0 0 0 transparent); transform: scale(1); }
                50% { filter: drop-shadow(0 0 12px rgba(99, 102, 241, 0.35)); transform: scale(1.02); }
            }
            #loginRewardCelebrationModal.login-reward-celeb-active #loginRewardCelebrationTotal {
                animation: loginRewardMuPulse 2s ease-in-out 0.3s 2;
            }
            @keyframes loginRewardFanfarePop {
                0% { transform: scale(0.82); opacity: 0; }
                55% { transform: scale(1.08); opacity: 1; }
                100% { transform: scale(1); opacity: 1; }
            }
            @keyframes loginRewardFanfareGlow {
                0%, 100% { filter: drop-shadow(0 0 0 rgba(99, 102, 241, 0)); }
                45% { filter: drop-shadow(0 0 14px rgba(129, 140, 248, 0.45)); }
            }
            #loginRewardCelebrationModal.login-reward-celeb-active .login-reward-fanfare-title {
                animation: loginRewardFanfarePop 0.72s cubic-bezier(0.2, 0.95, 0.2, 1) 0.08s both,
                           loginRewardFanfareGlow 1.05s ease-out 0.12s both;
            }
            #loginRewardCelebrationModal.login-reward-celeb-active .login-reward-fanfare-btn {
                animation: loginRewardFanfarePop 0.68s cubic-bezier(0.2, 0.95, 0.2, 1) 0.22s both,
                           loginRewardFanfareGlow 1.1s ease-out 0.26s both;
            }

            .moderator-badge {
                position: absolute;
                bottom: -2px;
                right: -2px;
                width: 20px;
                height: 20px;
                background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
                border: 2px solid white;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                z-index: 10;
            }
            .moderator-badge i {
                color: white;
                font-size: 10px;
            }
            
            /* Custom Scrollbar for Sidebar */
            ::-webkit-scrollbar {
                width: 8px;
                height: 8px;
            }
            ::-webkit-scrollbar-button {
                display: none;
                width: 0;
                height: 0;
            }
            ::-webkit-scrollbar-track {
                background: #F3F4F6;
            }
            ::-webkit-scrollbar-thumb {
                background: #D1D5DB;
                border-radius: 10px;
            }
            ::-webkit-scrollbar-thumb:hover {
                background: #9CA3AF;
            }
            .sidebar-scroll::-webkit-scrollbar,
            .panel-scroll::-webkit-scrollbar {
                width: 8px;
            }
            .sidebar-scroll::-webkit-scrollbar-button,
            .panel-scroll::-webkit-scrollbar-button {
                width: 0;
                height: 0;
                display: none;
            }
            .sidebar-scroll::-webkit-scrollbar-track,
            .panel-scroll::-webkit-scrollbar-track {
                background: #F3F4F6;
                border-radius: 10px;
            }
            .sidebar-scroll::-webkit-scrollbar-thumb,
            .panel-scroll::-webkit-scrollbar-thumb {
                background: #D1D5DB;
                border-radius: 10px;
            }
            .sidebar-scroll::-webkit-scrollbar-thumb:hover,
            .panel-scroll::-webkit-scrollbar-thumb:hover {
                background: #9CA3AF;
            }
            .sidebar-scroll {
                /* Keep content width stable when scrollbar appears/disappears */
                scrollbar-gutter: stable;
            }
            :root {
                --panel-scrollbar-gap: 8px; /* 좌/중/우 패널 스크롤바-콘텐츠 공통 간격 (프로덕션과 동일) */
                --panel-scrollbar-width: 8px; /* 커스텀 스크롤바 폭 */
            }
            /* Right sidebar: unify spacing between content and vertical scrollbar */
            #sidebarFriendsList,
            #sidebarNotificationsList,
            #sidebarReactorsList {
                box-sizing: border-box;
                padding-right: var(--panel-scrollbar-gap);
                scrollbar-gutter: stable;
            }
            /* Mobile: full-screen overlay for friends/notifications - same width as posting panel (px-3) */
            #rightSidebar.mobile-fullscreen-overlay {
                position: fixed !important;
                left: 50% !important;
                right: auto !important;
                width: min(480px, calc(100vw - 24px)) !important;
                transform: translateX(-50%);
                bottom: 0 !important;
                z-index: 50;
                background: white;
                overflow: hidden;
                touch-action: pan-y;
                overscroll-behavior: contain;
            }
            #rightSidebar.mobile-fullscreen-overlay #rightSidebarInner {
                padding-right: 0 !important;
            }
            #rightSidebar.mobile-fullscreen-overlay > div {
                height: 100% !important;
                max-height: 100% !important;
            }
            #rightSidebar.mobile-fullscreen-overlay #friendsTabContent,
            #rightSidebar.mobile-fullscreen-overlay #notificationsTabContent,
            #rightSidebar.mobile-fullscreen-overlay #reactorsTabContent {
                padding-bottom: calc(1.25rem + 10px) !important; /* p-5 + 10px extra */
            }
            /* Mobile: friends/notifications panel body must scroll inside fixed overlay */
            #rightSidebar.mobile-fullscreen-overlay #friendsTabContent:not(.hidden),
            #rightSidebar.mobile-fullscreen-overlay #notificationsTabContent:not(.hidden) {
                height: 100% !important;
                max-height: 100% !important;
                overflow-y: auto !important;
                -webkit-overflow-scrolling: touch !important;
                touch-action: pan-y;
                overscroll-behavior: contain;
            }
            #rightSidebar.mobile-fullscreen-overlay #friendsTabContent.hidden,
            #rightSidebar.mobile-fullscreen-overlay #notificationsTabContent.hidden {
                display: none !important;
            }
            #rightSidebar.mobile-fullscreen-overlay #sidebarFriendsList,
            #rightSidebar.mobile-fullscreen-overlay #sidebarNotificationsList {
                flex: 1 1 auto !important;
                min-height: 0 !important;
                overflow-y: auto !important;
                -webkit-overflow-scrolling: touch !important;
                overscroll-behavior: contain !important;
                padding-right: 8px !important;
                padding-bottom: 10px;
            }
            /* 친구/알림 패널: (요청) 내용만큼 확장, 스크롤은 추후 */
            #rightSidebar.mobile-fullscreen-overlay {
                height: auto !important;
                max-height: none !important;
                overflow: visible !important;
            }
            #rightSidebar.mobile-fullscreen-overlay > div {
                height: auto !important;
                max-height: none !important;
            }
            #rightSidebar.mobile-fullscreen-overlay #friendsTabContent:not(.hidden),
            #rightSidebar.mobile-fullscreen-overlay #notificationsTabContent:not(.hidden) {
                height: auto !important;
                max-height: none !important;
                overflow: visible !important;
            }
            #rightSidebar.mobile-fullscreen-overlay #sidebarFriendsList,
            #rightSidebar.mobile-fullscreen-overlay #sidebarNotificationsList {
                overflow: visible !important;
                max-height: none !important;
            }
            /* 반응/댓글/공유 패널: 모바일 - 헤더 아래 간격, 웹 배경 노출 */
            #rightSidebar.mobile-fullscreen-overlay.reactors-only {
                left: 12px !important;
                right: 12px !important;
                width: auto !important;
                transform: none !important;
                bottom: auto !important;
                height: auto !important;
                background: transparent !important;
                display: flex !important;
                align-items: flex-start !important;
                justify-content: center !important;
                padding: 0 !important;
                overflow: visible !important;
                box-shadow: none !important;
                border-radius: 0 !important;
            }
            #rightSidebar.mobile-fullscreen-overlay.reactors-only > div {
                width: 100% !important;
                max-width: 400px !important;
                height: auto !important;
                max-height: min(70vh, 450px) !important;
                flex: 0 0 auto !important;
                display: flex !important;
                flex-direction: column !important;
                overflow: hidden !important;
                background: transparent !important;
                border-radius: 0 !important;
                box-shadow: none !important;
                padding-right: 0 !important;
            }
            #rightSidebar.reactors-only #friendsTabContent,
            #rightSidebar.reactors-only #notificationsTabContent,
            #rightSidebar.mobile-fullscreen-overlay.reactors-only #friendsTabContent,
            #rightSidebar.mobile-fullscreen-overlay.reactors-only #notificationsTabContent {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
                position: absolute !important;
                left: -9999px !important;
                width: 0 !important;
                height: 0 !important;
                overflow: hidden !important;
            }
            #rightSidebar.reactors-only #reactorsTabContent,
            #rightSidebar.mobile-fullscreen-overlay.reactors-only #reactorsTabContent {
                display: flex !important;
                flex: 1 !important;
                min-height: 0 !important;
                max-height: 75vh !important;
            }
            
            /* Friends & Notifications panels: compact height when empty - same shape and size */
            #friendsTabContent.friends-empty,
            #notificationsTabContent.notifications-empty {
                inset: auto;
                top: 0;
                left: 0;
                right: 0;
                height: 195px;
                overflow: hidden;
            }
            
            /* Mobile posts carousel styles - Removed for vertical scroll */
            .hide-scrollbar::-webkit-scrollbar {
                display: none;
            }
            .hide-scrollbar {
                -ms-overflow-style: none;
                scrollbar-width: none;
            }
            
            /* PC: 좌/중앙/우 독립 스크롤 - 포스팅 스크롤해도 사이드바 고정 */
            @media (min-width: 1024px) {
                .main-content-wrapper {
                    height: calc(100vh - 4rem);
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                }
                .main-content-grid {
                    flex: 1;
                    min-height: 0;
                    align-items: stretch;
                    grid-template-rows: minmax(0, 1fr);
                }
                .main-content-grid .scroll-independent {
                    overflow-y: auto;
                    min-height: 0;
                    overscroll-behavior: contain;
                }
                /* 좌/중/우 스크롤 영역 간격을 오른쪽 기준으로 통일 (crossfriends.org 레이아웃과 동일) */
                #leftSidebar .sidebar-scroll,
                #centerFeedColumn,
                #rightSidebar {
                    scrollbar-gutter: stable;
                }
                #leftSidebar .sidebar-scroll {
                    padding-right: var(--panel-scrollbar-gap) !important;
                    box-sizing: border-box;
                }
                #centerFeedColumn {
                    padding-right: var(--panel-scrollbar-gap);
                    box-sizing: border-box;
                }
                #rightSidebarInner {
                    padding-right: var(--panel-scrollbar-gap) !important;
                    box-sizing: border-box;
                }
                /* 왼쪽 사이드바 리워드 영역 = 오른쪽 사이드바와 동일 높이 */
                #leftSidebar .sidebar-scroll {
                    min-height: 100%;
                    max-height: none;
                }
                /* Desktop messenger composer: compact like mobile */
                #friendMessengerComposerWrap {
                    padding: 0.5rem 0.75rem 0.5rem 0.75rem !important;
                }
                #friendMessengerModal,
                #friendMessengerMessages,
                #friendMessengerComposerWrap,
                #feedbackModal {
                    overflow-x: hidden !important;
                }
                #friendMessengerComposerRow {
                    gap: 0.2rem !important;
                    min-width: 0 !important;
                }
                #friendMessengerInput {
                    min-height: 2.2rem !important;
                    padding-top: 0.25rem !important;
                    padding-bottom: 0.25rem !important;
                    font-size: 0.95rem !important;
                    line-height: 1.35 !important;
                    overflow-y: hidden !important;
                }
                #friendMessengerImageBtn,
                #friendMessengerVideoBtn,
                #friendMessengerSendBtn {
                    height: 2.2rem !important;
                }
                #friendMessengerImageBtn { width: 2.15rem !important; }
                #friendMessengerVideoBtn { width: 1.95rem !important; margin-left: -2px !important; }
                #friendMessengerSendBtn { width: 2.3rem !important; min-width: 2.3rem !important; }
            }
            
            /* Mobile: center column uses display:contents so post card & posts keep original order */
            @media (max-width: 1023px) {
                .center-feed-mobile-contents { display: contents; }
            }
            
            /* Mobile (390x844) optimizations - PC unaffected */
            @media (max-width: 1023px) {
                .safe-area-top { padding-top: env(safe-area-inset-top, 0); }
                .safe-area-bottom { padding-bottom: env(safe-area-inset-bottom, 0); }
                /* Mobile: comment composer right-edge alignment */
                .comment-compose-row {
                    width: calc(100% + 8px) !important;
                    max-width: calc(100% + 8px) !important;
                    margin-right: -8px !important;
                    gap: 4px !important;
                    box-sizing: border-box !important;
                }
                .comment-compose-input {
                    flex: 1 1 auto !important;
                    min-width: 0 !important;
                    padding-right: 0 !important;
                }
                .comment-compose-submit {
                    margin-left: auto !important;
                    width: 2.5rem !important;
                    height: 2.5rem !important;
                    padding: 0 !important;
                }
                /* Messenger compose row: force compact height (mobile) */
                #friendMessengerComposerWrap {
                    padding-top: 0.35rem !important;
                    padding-bottom: max(0.5rem, env(safe-area-inset-bottom)) !important;
                    overflow-x: hidden !important;
                }
                #friendMessengerComposerRow {
                    gap: 0.15rem !important;
                    min-width: 0 !important;
                }
                #friendMessengerInput {
                    min-height: 2.15rem !important;
                    padding-top: 0.2rem !important;
                    padding-bottom: 0.2rem !important;
                    font-size: 0.94rem !important;
                    line-height: 1.35 !important;
                    overflow-y: hidden !important;
                }
                #friendMessengerImageBtn,
                #friendMessengerVideoBtn,
                #friendMessengerSendBtn {
                    height: 2.15rem !important;
                }
                #friendMessengerImageBtn { width: 2.05rem !important; }
                #friendMessengerVideoBtn { width: 1.85rem !important; margin-left: -2px !important; }
                #friendMessengerSendBtn { width: 2.2rem !important; min-width: 2.2rem !important; }
                /* Shared post frame parity (compose preview === posted card) */
                .shared-post-frame {
                    width: 100% !important;
                    box-sizing: border-box !important;
                }
                .shared-post-frame .shared-post-card {
                    width: 100% !important;
                    max-width: 100% !important;
                    margin-left: 0 !important;
                    margin-right: 0 !important;
                    box-sizing: border-box !important;
                }
                .shared-post-frame-compose {
                    /* Compose preview width baseline */
                    width: calc(100% + 42px) !important;
                    margin-left: -40px !important;
                    margin-right: -2px !important;
                }
                .shared-post-frame-feed {
                    margin-top: calc(1.15rem + 20px) !important;
                    width: calc(100% + 78.5px) !important;
                    margin-left: -70px !important;
                    margin-right: -8.5px !important;
                }
                .shared-post-frame-feed .shared-post-card-feed {
                    padding-top: calc(1rem + 5px) !important;
                    padding-right: calc(1rem + 5px) !important;
                    padding-left: calc(1rem + 5px) !important;
                    padding-bottom: calc(1rem + 9px) !important;
                }
                /* Min 44px touch targets for mobile */
                .min-touch { min-height: 44px; min-width: 44px; }
                /* Post action icon buttons: force perfect circles on mobile */
                .post-action-icon-btn {
                    width: 2.25rem !important;
                    height: 2.25rem !important;
                    min-width: 2.25rem !important;
                    min-height: 2.25rem !important;
                    max-width: 2.25rem !important;
                    max-height: 2.25rem !important;
                    flex: 0 0 2.25rem !important;
                    padding: 0 !important;
                    border-radius: 9999px !important;
                    display: inline-flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    overflow: hidden !important;
                    box-sizing: border-box !important;
                    line-height: 1 !important;
                    -webkit-appearance: none;
                    appearance: none;
                    -webkit-tap-highlight-color: transparent;
                }
                .post-action-slot {
                    position: relative;
                    width: 2.25rem;
                    min-width: 2.25rem;
                    justify-content: center;
                }
                .post-action-count-trigger,
                .post-action-count-placeholder {
                    position: absolute !important;
                    left: 100%;
                    top: 50%;
                    transform: translateY(-50%);
                    margin: 0 !important;
                }
                /* New-post 7 color circles: mobile one-row centered */
                .new-post-color-row {
                    width: 100%;
                }
                /* Mobile only: extend color row to full post-card width (including avatar column) */
                .new-post-color-row {
                    margin-left: -2.5rem;
                    width: calc(100% + 2.5rem);
                    max-width: calc(100% + 2.5rem);
                }
                .new-post-color-item {
                    min-width: 0;
                }
                .new-post-color-item .color-selector-btn {
                    flex-shrink: 0;
                }
                .new-post-color-item span {
                    white-space: nowrap;
                    font-size: clamp(11px, 3.2vw, 13px) !important;
                    line-height: 1.2 !important;
                    margin-top: 2px;
                }
                .new-post-color-row {
                    display: grid !important;
                    grid-template-columns: repeat(7, minmax(0, 1fr));
                    justify-items: center;
                    align-items: start;
                    column-gap: 20px;
                    row-gap: 0;
                    padding-left: 10px;
                    padding-right: clamp(2px, 1vw, 8px);
                    box-sizing: border-box;
                    /* exact: each pair gap +5% of one slot width */
                    --mobile-color-gap-expand-step: calc((100% / 7) * 0.12);
                }
                /* Mobile only: keep 1(중보) fixed, expand 1-2...6-7 gaps by ~5% */
                .new-post-color-row .new-post-color-item:nth-child(2) { transform: translateX(calc(var(--mobile-color-gap-expand-step) * 1 + 5px)) !important; }
                .new-post-color-row .new-post-color-item:nth-child(3) { transform: translateX(calc(var(--mobile-color-gap-expand-step) * 2 + 10px)) !important; }
                .new-post-color-row .new-post-color-item:nth-child(4) { transform: translateX(calc(var(--mobile-color-gap-expand-step) * 3 + 15px)) !important; }
                .new-post-color-row .new-post-color-item:nth-child(5) { transform: translateX(calc(var(--mobile-color-gap-expand-step) * 4 + 20px)) !important; }
                .new-post-color-row .new-post-color-item:nth-child(6) { transform: translateX(calc(var(--mobile-color-gap-expand-step) * 5 + 25px)) !important; }
                .new-post-color-row .new-post-color-item:nth-child(7) { transform: translateX(calc(var(--mobile-color-gap-expand-step) * 6 + 30px)) !important; }
                /* Friends/Notifications: fixed header + scrollable body (mobile) */
                #friendsPanelHeader,
                #notificationsPanelHeader {
                    position: sticky;
                    top: 0;
                    z-index: 5;
                    background: #fff;
                }
                /* Reward panels: no scroll on mobile */
                #leftSidebar .sidebar-scroll {
                    overflow-y: visible !important;
                    max-height: none !important;
                }
            }
        </style>
    </head>
    <body class="bg-gray-50 overflow-x-hidden" style="min-height: 100vh; overflow-y: auto;">
        <!-- Header -->
        <nav id="mainHeader" class="bg-white shadow-md sticky top-0 z-50 safe-area-top overflow-x-hidden">
            <div class="max-w-7xl lg:max-w-[92rem] mx-auto px-3 sm:px-4 pt-1 pb-2">
                <!-- Mobile: 2 rows - Logo top, buttons bottom -->
                <div class="flex flex-col gap-2 lg:hidden">
                    <div id="mobileLogoRow" class="relative flex items-center justify-center overflow-visible">
                        <div id="mobileLogoBlock" class="flex flex-col cursor-pointer hover:opacity-80 transition flex-shrink-0" onclick="goToHome()" style="font-size: 150%; transform: scale(1.26); transform-origin: center;">
                            <h1 class="mt-2 text-base sm:text-2xl font-bold text-gray-800 flex items-center justify-center" title="전체 포스팅 보기" style="font-family: 'Poppins', sans-serif; letter-spacing: -0.5px; transform: scale(1.2); transform-origin: center;">
                                <span>CROSS</span>
                                <img src="/static/logo-cross.png" alt="" class="logo-cross-img mx-0 sm:mx-0.5 scale-[0.6] sm:scale-90 w-[2.646rem] h-[2.646rem] object-contain rounded-full border border-red-300 p-0.5" />
                                <span>friends</span>
                            </h1>
                            <p class="text-[10px] sm:text-sm text-gray-600 -mt-1 sm:mt-1 text-center" style="font-family: 'Poppins', sans-serif; letter-spacing: 0.3px;">
                                <span class="whitespace-nowrap">기독교인들을</span> <span class="whitespace-nowrap">위한</span> <span class="whitespace-nowrap">행복한</span> <span class="whitespace-nowrap">소셜미디어</span>
                            </p>
                        </div>
                        <button id="installAppBtnMobile" type="button" onclick="triggerAppInstall()" class="hidden absolute top-1/2 -translate-y-1/2 text-gray-500 hover:text-blue-600 w-10 h-10 rounded-full hover:bg-blue-50 transition flex items-center justify-center" title="앱처럼 설치">
                            <i class="fas fa-download text-lg"></i>
                        </button>
                    </div>
                    <div class="w-full flex justify-center">
                        <div class="inline-flex items-center justify-center mx-auto w-fit gap-2" id="authButtons">
                            <button onclick="showHowToUse()" class="text-gray-500 hover:text-gray-800 px-2 py-2 rounded-full hover:bg-gray-100 transition text-xs flex items-center gap-1" title="사용법">
                                <i class="fas fa-question-circle text-[2.25rem] leading-none"></i>
                            </button>
                            <div class="flex items-center gap-0">
                                <button onclick="showLoginModal()" class="text-gray-700 hover:text-blue-600 border border-gray-300 px-[0.95rem] py-[0.48rem] rounded-full transition text-[0.97rem] font-medium">로그인</button>
                                <button onclick="showSignupModal()" class="ml-2 bg-blue-600 text-white px-[1.1rem] py-[0.48rem] rounded-full hover:bg-blue-700 transition text-[0.97rem] font-semibold">가입</button>
                            </div>
                        </div>
                        <div class="flex items-center gap-1.5 sm:gap-1.5 hidden" id="userMenuMobile">
                            <button id="qtBtnMobile" onclick="toggleQtPanel()" class="text-gray-500 w-9 h-9 flex items-center justify-center rounded-full border-2 border-gray-500 bg-transparent font-bold text-sm transition hover:border-red-600 hover:text-red-600" title="QT">
                                QT
                            </button>
                            <button id="friendsListBtnMobile" onclick="toggleFriendsList()" class="text-gray-500 hover:text-blue-600 w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-200" title="친구 목록">
                                <i class="fas fa-user-friends text-lg"></i>
                            </button>
                            <button id="notificationBtnMobile" onclick="toggleNotifications()" class="relative text-gray-500 hover:text-blue-600 w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-200" title="알림">
                                <i class="fas fa-bell text-lg"></i>
                                <span id="notificationDotMobile" class="hidden absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 rounded-full border border-white"></span>
                            </button>
                            <button type="button" id="qtDaySimBtnMobile" onclick="advanceQtDaySimulation(event)" class="hidden relative text-violet-600 hover:text-violet-800 w-10 h-10 rounded-full hover:bg-violet-50 flex items-center justify-center transition" title="">
                                <i class="fas fa-calendar-day text-lg"></i>
                                <span data-qt-sim-badge class="hidden absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-4 px-0.5 rounded-full bg-violet-600 text-white text-[9px] leading-4 font-bold text-center"></span>
                            </button>
                            <button onclick="goToAdmin()" id="adminPanelBtnMobile" class="hidden text-red-600 hover:text-red-800 w-10 h-10 rounded-full hover:bg-red-50 flex items-center justify-center" title="관리자 패널">
                                <i class="fas fa-shield-alt text-lg"></i>
                            </button>
                            <div id="userAvatarContainerMobile" class="w-8 h-8 rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white text-xs cursor-pointer hover:ring-2 hover:ring-blue-300" onclick="showMyProfile()">
                                <i class="fas fa-user"></i>
                            </div>
                            <span id="userNameMobile" class="text-gray-800 text-base font-semibold cursor-default truncate max-w-[80px]"></span>
                            <button id="feedbackBtnMobile" onclick="showFeedbackModal()" class="text-gray-500 hover:text-amber-600 w-8 h-8 flex items-center justify-center rounded-full hover:bg-amber-50 transition" title="피드백 요청">
                                <i class="fas fa-lightbulb text-base"></i>
                            </button>
                        </div>
                    </div>
                </div>
                <!-- PC: single row - Logo left, Friends+Notification center, Admin+Name right -->
                <div class="hidden lg:grid lg:grid-cols-[1fr_1.1115fr_1.1115fr_1fr] lg:items-center lg:gap-x-[2%]">
                    <div class="lg:col-start-1 flex justify-start">
                        <div class="pc-logo-hover flex flex-col items-center cursor-pointer hover:opacity-80 transition" onclick="goToHome()">
                            <h1 class="text-xl md:text-2xl font-bold text-gray-800 flex items-center" title="전체 포스팅 보기" style="font-family: 'Poppins', sans-serif; letter-spacing: -0.5px;">
                                <span>CROSS</span>
                                <img src="/static/logo-cross.png" alt="" class="logo-cross-img pc-logo-cross-spin mx-0.5 md:mx-1.5 scale-90 md:scale-100 w-[2.646rem] h-[2.646rem] object-contain" />
                                <span>friends</span>
                            </h1>
                            <p class="w-full text-[10px] text-gray-600 mt-1 text-center" style="font-family: 'Poppins', sans-serif; letter-spacing: 0.3px;">
                                <span class="whitespace-nowrap">기독교인들을</span> <span class="whitespace-nowrap">위한</span> <span class="whitespace-nowrap">행복한</span> <span class="whitespace-nowrap">소셜미디어</span>
                            </p>
                        </div>
                    </div>
                    <div class="lg:col-start-2 lg:col-span-2 flex items-center justify-center gap-2">
                        <div class="flex flex-nowrap items-center gap-2 md:gap-3" id="authButtonsPC">
                            <button onclick="showHowToUse()" class="text-gray-500 hover:text-gray-800 px-3 py-2 rounded-full hover:bg-gray-100 transition flex items-center justify-center" title="사용법">
                                <i class="fas fa-question-circle text-[2rem] leading-none"></i>
                            </button>
                            <button onclick="showLoginModal()" class="text-gray-700 hover:text-blue-600 border border-gray-300 hover:border-blue-400 px-5 py-2 rounded-full transition text-base font-medium">로그인</button>
                            <button onclick="showSignupModal()" class="bg-blue-600 text-white px-6 py-2 rounded-full hover:bg-blue-700 transition text-base font-semibold shadow-sm">가입</button>
                        </div>
                        <div class="flex items-center gap-2 hidden" id="userMenuCenterPC">
                            <button id="qtBtn" onclick="toggleQtPanel()" class="text-gray-500 w-10 h-10 flex items-center justify-center rounded-full border-2 border-gray-500 bg-transparent transition font-bold text-sm hover:border-red-600 hover:text-red-600" title="QT">
                                QT
                            </button>
                            <button id="friendsListBtn" onclick="toggleFriendsList()" class="text-gray-500 hover:text-blue-600 w-11 h-11 flex items-center justify-center rounded-full hover:bg-gray-200 transition" title="친구 목록">
                                <i class="fas fa-user-friends text-xl"></i>
                            </button>
                            <button id="notificationBtn" onclick="toggleNotifications()" class="relative text-gray-500 hover:text-blue-600 w-11 h-11 flex items-center justify-center rounded-full hover:bg-gray-200 transition" title="알림">
                                <i class="fas fa-bell text-xl"></i>
                                <span id="notificationDot" class="hidden absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border border-white"></span>
                            </button>
                        </div>
                    </div>
                    <div class="lg:col-start-4 flex items-center justify-end gap-2">
                        <div class="flex items-center gap-2 hidden" id="userMenuRightPC">
                            <button type="button" id="qtDaySimBtn" onclick="advanceQtDaySimulation(event)" class="hidden relative text-violet-600 hover:text-violet-800 w-11 h-11 rounded-full hover:bg-violet-50 transition flex items-center justify-center" title="">
                                <i class="fas fa-calendar-day text-xl"></i>
                                <span data-qt-sim-badge class="hidden absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-4 px-0.5 rounded-full bg-violet-600 text-white text-[9px] leading-4 font-bold text-center"></span>
                            </button>
                            <button onclick="goToAdmin()" id="adminPanelBtn" class="hidden text-red-600 hover:text-red-800 w-11 h-11 rounded-full hover:bg-red-50 transition flex items-center justify-center" title="관리자 패널">
                                <i class="fas fa-shield-alt text-xl"></i>
                            </button>
                            <div class="admin-badge-container flex-shrink-0">
                                <div id="userAvatarContainer" class="w-8 h-8 rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white text-xs cursor-pointer hover:ring-2 hover:ring-blue-300 transition" onclick="showMyProfile()">
                                    <i class="fas fa-user"></i>
                                </div>
                            </div>
                            <span id="userName" class="text-gray-800 text-base font-semibold whitespace-nowrap cursor-default"></span>
                            <button id="feedbackBtn" onclick="showFeedbackModal()" class="text-gray-500 hover:text-amber-600 w-9 h-9 flex items-center justify-center rounded-full hover:bg-amber-50 transition" title="피드백 요청">
                                <i class="fas fa-lightbulb text-lg"></i>
                            </button>
                            <button id="installAppBtn" type="button" onclick="triggerAppInstall()" class="hidden text-gray-500 hover:text-blue-600 w-10 h-10 rounded-full hover:bg-blue-50 transition flex items-center justify-center" title="앱처럼 설치">
                                <i class="fas fa-download text-lg"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </nav>

        <!-- Main Content -->
        <div class="max-w-7xl lg:max-w-[92rem] mx-auto pl-[5px] pr-0 sm:px-4 py-3 sm:py-6 pb-10 sm:pb-12 safe-area-bottom main-content-wrapper">
            <div class="flex flex-col gap-3 sm:gap-6 lg:grid lg:grid-cols-[1.188fr_1.0715fr_1.0715fr_1fr] lg:gap-x-[2%] main-content-grid">
                <!-- Left Sidebar - order-first on mobile: reward content at top -->
                <div id="leftSidebar" class="lg:col-span-1 order-first lg:order-none lg:col-start-1 lg:row-start-1 lg:row-span-2 scroll-independent">
                        <div class="sticky top-20 space-y-2 sm:space-y-3 lg:min-h-full max-h-[calc(100vh-6rem)] lg:max-h-none overflow-y-auto sidebar-scroll pr-0.5 sm:pr-2">
                        <!-- Today's Bible Verse -->
                        <div id="verseRewardSection" class="relative bg-white rounded-2xl shadow-md border border-blue-200 p-4 sm:p-5 transition-all duration-300 reward-card-collapsible" data-reward-card="basic" data-reward-key="basic" data-reward-target="verseRewardContent">
                            <div class="reward-card-header-line">
                                <h3 class="font-size-title font-bold text-blue-800 reward-card-header-title">
                                    <i class="fas fa-book-open font-size-title text-blue-600 mr-2"></i>오늘의 성경 구절
                                </h3>
                                <div class="reward-card-header-right">
                                    <span class="basic-reward-badge font-size-mini1 font-bold text-blue-800">🎁 기본 리워드</span>
                                    <i class="fas fa-chevron-up text-xs reward-card-chevron"></i>
                                </div>
                            </div>
                            <div id="verseRewardContent" class="reward-card-content">
                            <div class="border-l-2 sm:border-l-4 border-blue-600 pl-1 sm:pl-3 py-0.5 sm:py-1.5 mb-3 sm:mb-4">
                                <p class="font-size-base font-bold text-blue-600 mb-0.5 sm:mb-1.5" id="verseReference">시편 23:1</p>
                                <p id="verseText" class="font-size-base text-gray-800 leading-snug" style="transition: opacity 0.5s ease-in-out;">
                                    여호와는 나의 목자시니 내게 부족함이 없으리로다
                                </p>
                            </div>
                            
                            <!-- Typing Toggle Button -->
                            <div class="relative">
                                <button 
                                    id="typingToggleBtn"
                                    onclick="toggleTypingArea()"
                                    class="w-full py-3 px-4 bg-blue-50 hover:bg-blue-100 border-2 border-blue-300 rounded-lg transition-all flex items-center justify-center space-x-2 text-blue-800 font-bold text-base">
                                    <i class="fas fa-keyboard text-lg"></i>
                                    <span class="font-size-desc">말씀 타이핑</span>
                                </button>
                                
                                <!-- Typing Input Area (Initially Hidden) -->
                                <div id="typingArea" class="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t-2 border-blue-100 hidden">
                                    <div class="mb-3">
                                        <label class="text-sm sm:text-base font-bold text-gray-800 flex items-center gap-1.5">
                                            <i class="fas fa-keyboard text-blue-600 text-base"></i>말씀 타이핑
                                        </label>
                                    </div>
                                    <div class="flex gap-2 items-stretch">
                                        <textarea
                                            id="typingInput"
                                            placeholder="성경구절을 입력하세요..."
                                            class="flex-1 p-3 border-2 border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none font-size-base"
                                            rows="3"
                                            onkeydown="handleTypingEnter(event)"
                                        ></textarea>
                                        <button
                                            onclick="checkTyping()"
                                            title="제출"
                                            class="flex-shrink-0 w-12 sm:w-14 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white rounded-lg flex items-center justify-center transition-colors shadow-sm touch-manipulation">
                                            <i class="fas fa-paper-plane text-lg sm:text-xl"></i>
                                        </button>
                                    </div>
                                    <div id="typingResult" class="mt-2 font-size-base hidden"></div>
                                </div>
                                
                                <!-- Login Required Overlay (Same style as 200pt unlock) -->
                                <div id="typingLoginOverlay" class="hidden absolute top-0 left-0 w-full h-full bg-white bg-opacity-95 backdrop-blur-sm rounded-lg flex items-center justify-center z-10">
                                    <button 
                                        disabled
                                        class="w-full py-3 px-4 bg-gray-300 text-gray-500 rounded-lg font-bold font-size-desc cursor-not-allowed flex items-center justify-center space-x-2 transition-all">
                                        <i class="fas fa-lock text-lg"></i>
                                        <span>로그인 후 이용 가능</span>
                                    </button>
                                </div>
                            </div>
                            
                            <!-- Script to show/hide login overlay -->
                            <script>
                                (function() {
                                    const userId = localStorage.getItem('currentUserId');
                                    const overlay = document.getElementById('typingLoginOverlay');
                                    
                                    if (!userId) {
                                        // Not logged in - show overlay
                                        if (overlay) {
                                            overlay.classList.remove('hidden');
                                        }
                                    }
                                })();
                            </script>
                            </div>
                        </div>
                    
                        <!-- Reward1: Today's Sermon Section -->
                        <div id="sermonRewardSection" class="relative bg-white rounded-2xl shadow-md border border-blue-200 p-4 sm:p-5 transition-all duration-300 reward-card-collapsible" data-reward-card="reward1" data-reward-key="reward1" data-reward-target="sermonRewardContent">
                            <div class="reward-card-header-line">
                                <h3 class="font-size-title font-bold text-blue-700 reward-card-header-title">
                                    <i class="fas fa-video font-size-title text-blue-600 mr-2"></i>오늘의 설교 말씀
                                </h3>
                                <div class="reward-card-header-right">
                                    <span class="reward-one-badge font-size-mini1 font-bold text-blue-700">🎁 리워드1</span>
                                    <i class="fas fa-chevron-up text-xs text-blue-600 reward-card-chevron"></i>
                                </div>
                            </div>
                            <div id="sermonRewardContent" class="reward-card-content">
                            <p id="sermonQueueNotice" class="hidden mt-1 mb-2 text-[11px] sm:text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                준비된 하용조 목사 설교 목록이 모두 소진되었습니다. 새 링크를 보내주세요.
                            </p>
                            <!-- Locked State (< 200 points) — 로그아웃 시에도 동일 UI -->
                            <div id="sermonLocked">
                                <div class="rounded-xl bg-blue-50/90 border border-blue-100 p-3 mb-3">
                                    <div class="flex items-center justify-between mb-2">
                                        <span class="font-size-base font-semibold text-slate-700">현재 종합점수</span>
                                        <span id="rewardTotalScore" class="font-size-base font-bold text-blue-600 tabular-nums">0</span>
                                    </div>
                                    <div class="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                        <div id="rewardProgressBar" class="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-500" style="width: 0%"></div>
                                    </div>
                                </div>

                                <button
                                    id="unlockSermonBtn"
                                    type="button"
                                    disabled
                                    class="w-full py-3 px-4 bg-gray-300 text-gray-600 rounded-xl font-bold font-size-desc cursor-not-allowed flex items-center justify-center gap-2 transition-all">
                                    <i class="fas fa-lock text-base text-gray-500"></i>
                                    <span>200μ 달성 후 공개 가능</span>
                                </button>
                            </div>
                            
                            <!-- Unlocked State (≥ 200 points) -->
                            <div id="sermonUnlocked" class="hidden">
                                <div class="border-l-4 border-red-600 pl-3 py-2 mb-3">
                                    <p id="sermonTitleText" class="font-size-base font-bold text-red-600 mb-1">
                                        나의 사랑 안에 거하라
                                    </p>
                                    <p id="sermonReferenceText" class="font-size-base text-gray-700 mb-1">
                                        요한복음 15:9-15
                                    </p>
                                    <p id="sermonPreacherText" class="font-size-desc text-gray-500">
                                        <i class="fas fa-user-tie mr-1"></i>하용조 목사 (온누리교회)
                                    </p>
                                </div>
                                
                                <!-- YouTube Embedded Video -->
                                <div class="relative w-full" style="padding-bottom: 56.25%;">
                                    <div id="sermonPlayer" class="absolute top-0 left-0 w-full h-full rounded-lg"></div>
                                </div>
                                
                                <!-- Video Progress Indicator -->
                                <div id="videoProgressContainer" class="mt-3 bg-blue-50 border-2 border-blue-300 rounded-lg p-3 hidden">
                                    <div class="flex items-center justify-between mb-2">
                                        <span class="text-sm font-semibold text-blue-800">
                                            <i class="fas fa-play-circle mr-1"></i>시청 진행도
                                        </span>
                                        <span id="videoProgressPercent" class="text-sm font-bold text-blue-600">0%</span>
                                    </div>
                                    <div class="w-full bg-blue-200 rounded-full h-2.5">
                                        <div id="videoProgressBar" class="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style="width: 0%"></div>
                                    </div>
                                    <p class="text-xs text-blue-700 mt-2">
                                        <i class="fas fa-info-circle mr-1"></i>영상을 90% 이상 시청하면 40μ을 받습니다!
                                    </p>
                                </div>
                                
                                <!-- Video Completion Result -->
                                <div id="videoCompletionResult" class="mt-3 hidden"></div>
                            </div>
                            </div>
                        </div>

                        <!-- Reward2: QT Worship Unlock Section -->
                        <div id="qtWorshipRewardSection" class="relative bg-white rounded-2xl shadow-md border border-blue-200 p-4 sm:p-5 transition-all duration-300 reward-card-collapsible" data-reward-card="reward2" data-reward-key="reward2" data-reward-target="qtWorshipRewardContent">
                            <div class="reward-card-header-line">
                                <h3 class="font-size-title font-bold text-blue-800 reward-card-header-title">
                                    <i class="fas fa-music font-size-title text-blue-600 mr-2"></i>QT 찬양
                                </h3>
                                <div class="reward-card-header-right">
                                    <span class="reward-two-badge font-size-mini1 font-bold text-blue-800">🎁 리워드2</span>
                                    <i class="fas fa-chevron-up text-xs reward-card-chevron"></i>
                                </div>
                            </div>
                            <div id="qtWorshipRewardContent" class="reward-card-content">

                            <div id="qtWorshipLocked">
                                <p class="font-size-desc text-gray-600 mb-3">
                                    왼쪽 사이드바 안내: 총점 <span class="font-bold text-blue-700">1000μ</span> 달성 시 QT 찬양 기능이 공개됩니다.
                                </p>

                                <div class="bg-blue-50 rounded-lg p-3 mb-3">
                                    <div class="flex items-center justify-between mb-2">
                                        <span class="font-size-base font-semibold text-gray-700">현재 종합점수</span>
                                        <span id="reward2TotalScore" class="font-size-base font-bold text-blue-600">0</span>
                                    </div>
                                    <div class="w-full bg-gray-200 rounded-full h-2">
                                        <div id="reward2ProgressBar" class="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-500" style="width: 0%"></div>
                                    </div>
                                </div>

                                <button
                                    id="unlockQtWorshipBtn"
                                    disabled
                                    class="w-full py-3 px-4 bg-gray-300 text-gray-500 rounded-lg font-bold font-size-desc cursor-not-allowed flex items-center justify-center space-x-2 transition-all">
                                    <i class="fas fa-lock text-lg"></i>
                                    <span>1000μ 달성 후 공개 가능</span>
                                </button>
                            </div>

                            <div id="qtWorshipUnlocked" class="hidden">
                                <div class="bg-green-50 border-2 border-green-300 rounded-lg p-4">
                                    <div class="flex items-center gap-2 mb-1">
                                        <i class="fas fa-gift text-green-600"></i>
                                        <p class="font-size-base font-bold text-green-700">1000μ 달성 축하합니다!</p>
                                    </div>
                                    <p class="font-size-desc text-gray-700">
                                        점수 획득 축하 카드와 함께 QT 패널 상단의 <span class="font-bold text-red-600">찬양 버튼</span>이 공개되었습니다.
                                    </p>
                                </div>
                            </div>
                            </div>
                        </div>

                        <!-- Reward3: QT Alarm Unlock Section -->
                        <div id="qtAlarmRewardSection" class="relative bg-white rounded-2xl shadow-md border border-blue-200 p-4 sm:p-5 transition-all duration-300 reward-card-collapsible" data-reward-card="reward3" data-reward-key="reward3" data-reward-target="qtAlarmRewardContent">
                            <div class="reward-card-header-line">
                                <h3 class="font-size-title font-bold text-blue-800 reward-card-header-title">
                                    <i class="fas fa-bell font-size-title text-blue-600 mr-2"></i>QT 예약
                                </h3>
                                <div class="reward-card-header-right">
                                    <span class="reward-three-badge font-size-mini1 font-bold text-blue-800">🎁 리워드3</span>
                                    <i class="fas fa-chevron-up text-xs reward-card-chevron"></i>
                                </div>
                            </div>
                            <div id="qtAlarmRewardContent" class="reward-card-content">

                            <div id="qtAlarmLocked">
                                <p class="font-size-desc text-gray-600 mb-3">
                                    총점 <span class="font-bold text-blue-700">1400μ</span> 달성 시 QT 예약(알람) 기능이 공개됩니다.
                                </p>

                                <div class="bg-blue-50 rounded-lg p-3 mb-3">
                                    <div class="flex items-center justify-between mb-2">
                                        <span class="font-size-base font-semibold text-gray-700">현재 종합점수</span>
                                        <span id="reward3TotalScore" class="font-size-base font-bold text-blue-600">0</span>
                                    </div>
                                    <div class="w-full bg-gray-200 rounded-full h-2">
                                        <div id="reward3ProgressBar" class="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-500" style="width: 0%"></div>
                                    </div>
                                </div>

                                <button
                                    id="unlockQtAlarmBtn"
                                    disabled
                                    class="w-full py-3 px-4 bg-gray-300 text-gray-500 rounded-lg font-bold font-size-desc cursor-not-allowed flex items-center justify-center space-x-2 transition-all">
                                    <i class="fas fa-lock text-lg"></i>
                                    <span>1400μ 달성 후 공개 가능</span>
                                </button>
                            </div>

                            <div id="qtAlarmUnlocked" class="hidden">
                                <div class="bg-green-50 border-2 border-green-300 rounded-lg p-4">
                                    <div class="flex items-center gap-2 mb-1">
                                        <i class="fas fa-gift text-green-600"></i>
                                        <p class="font-size-base font-bold text-green-700">1400μ 달성 축하합니다!</p>
                                    </div>
                                    <p class="font-size-desc text-gray-700">
                                        QT 패널 상단의 <span class="font-bold text-red-600">알람 버튼</span>이 공개되었습니다.
                                    </p>
                                </div>
                            </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Center Column: Post Card + Posts (scroll together on PC) -->
                <div id="centerFeedColumn" class="lg:col-span-2 lg:col-start-2 lg:row-start-1 lg:row-span-2 flex flex-col scroll-independent mx-auto w-full max-w-none lg:max-w-none space-y-4 center-feed-mobile-contents">
                <!-- Main Feed Part 1: Post Card - order-2 on mobile (after reward) -->
                <div id="mainFeedPart1" class="space-y-4 order-2 lg:order-none">
                    <!-- User Profile Cover Card (Hidden by default, shown when filtering by user) -->
                    <div id="userProfileCover" class="hidden bg-white rounded-xl shadow-lg border-2 border-gray-300 overflow-hidden">
                        <!-- Cover Photo -->
                        <div id="profileCoverPhoto" class="h-48 bg-blue-500 relative bg-cover bg-center">
                        </div>
                        
                        <!-- Profile Info -->
                        <div class="relative px-4 pb-4 sm:px-6 sm:pb-6">
                            <!-- Profile Picture (Overlapping cover) -->
                            <div class="-mt-16 mb-4">
                                <div class="relative inline-block">
                                    <div id="profileCoverAvatar" class="w-32 h-32 rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white border-4 border-white shadow-lg">
                                        <i class="fas fa-user text-5xl"></i>
                                    </div>
                                    <!-- Admin/Moderator Badge -->
                                    <div id="profileCoverBadge" class="absolute bottom-2 right-2"></div>
                                </div>
                            </div>
                            
                            <!-- User Info -->
                            <div class="space-y-3">
                                <div>
                                    <h2 id="profileCoverName" class="text-2xl font-bold text-gray-800">사용자 이름</h2>
                                </div>
                                
                                <p id="profileCoverBio" class="text-gray-700 leading-relaxed">
                                    <i class="fas fa-quote-left text-gray-400 mr-1"></i>
                                    <span>사용자 소개글이 여기에 표시됩니다.</span>
                                    <i class="fas fa-quote-right text-gray-400 ml-1"></i>
                                </p>
                                
                                <!-- Stats -->
                                <div class="flex items-center flex-wrap gap-4 pt-3 border-t border-gray-200">
                                    <div class="flex items-center space-x-2">
                                        <i class="fas fa-clipboard-list text-blue-600"></i>
                                        <span class="text-sm text-gray-700">
                                            <span id="profileCoverPostCount" class="font-bold text-gray-800">0</span> 포스팅
                                        </span>
                                    </div>
                                    <div class="flex items-center space-x-2">
                                        <i class="fas fa-user-friends text-pink-600"></i>
                                        <span class="text-sm text-gray-700">
                                            <span id="profileCoverFriendCount" class="font-bold text-pink-600">0</span> 친구
                                        </span>
                                    </div>
                                    <div class="flex items-center space-x-2">
                                        <i class="fas fa-church text-purple-600"></i>
                                        <span id="profileCoverChurch" class="text-sm text-gray-700">교회 정보</span>
                                    </div>
                                    <div id="profileCoverPosition" class="hidden">
                                        <!-- 직분 정보가 동적으로 삽입됩니다 -->
                                    </div>
                                    <div id="profileCoverLocation" class="hidden">
                                        <!-- 지역 정보가 동적으로 삽입됩니다 -->
                                    </div>
                                </div>
                                
                                <!-- Scores (if not private) - Compact inline display -->
                                <div id="profileCoverScores" class="flex items-center gap-3 sm:gap-4 pt-2 text-xs text-gray-600">
                                    <div class="flex items-center gap-1">
                                        <i class="fas fa-book-open text-blue-500"></i>
                                        <span class="text-gray-500">성경</span>
                                        <span id="profileCoverScriptureScore" class="font-bold text-blue-600">0</span>
                                    </div>
                                    <span class="text-gray-300">|</span>
                                    <div class="flex items-center gap-1">
                                        <i class="fas fa-praying-hands text-purple-500"></i>
                                        <span class="text-gray-500">기도</span>
                                        <span id="profileCoverPrayerScore" class="font-bold text-purple-600">0</span>
                                    </div>
                                    <span class="text-gray-300">|</span>
                                    <div class="flex items-center gap-1">
                                        <i class="fas fa-heart text-red-500"></i>
                                        <span class="text-gray-500">활동</span>
                                        <span id="profileCoverActivityScore" class="font-bold text-red-600">0</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Profile View (below cover when viewing a member) -->
                    <div id="profileView" class="hidden">
                        <div class="bg-white border-2 border-gray-300 rounded-xl shadow-sm p-5 sm:p-6 mt-4">
                            <div class="flex items-center justify-between mb-6">
                                <h2 class="text-2xl font-bold text-gray-800">
                                    <i class="fas fa-user-circle text-blue-600 mr-2"></i>프로필
                                </h2>
                                <div class="flex items-center gap-1.5">
                                    <div id="profileEditBtnContainer"></div>
                                    <button id="profileViewLogoutBtn" type="button" onclick="logout()" class="text-gray-500 hover:text-red-500 transition px-3 py-1.5 rounded-lg hover:bg-red-50 flex items-center gap-1.5 text-sm" title="로그아웃">
                                        <i class="fas fa-sign-out-alt"></i>
                                        <span class="hidden sm:inline">로그아웃</span>
                                    </button>
                                </div>
                            </div>
                            <div id="profileViewContent">
                                <!-- Profile content will be loaded here -->
                            </div>
                        </div>
                    </div>

                    <!-- New Post Card -->
                    <div id="newPostCard" class="bg-white rounded-xl sm:rounded-xl shadow-md border-2 border-gray-300 p-4 sm:p-6 transition-all duration-300 hover:shadow-lg hover:border-gray-500">
                        <div class="flex items-start space-x-2 sm:space-x-4">
                            <div class="admin-badge-container">
                                <div id="newPostAvatar" class="w-8 h-8 sm:w-10 sm:h-10 rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white text-xs sm:text-base flex-shrink-0 cursor-pointer hover:ring-2 sm:hover:ring-4 hover:ring-blue-300 transition" onclick="showMyProfile()">
                                    <i class="fas fa-user"></i>
                                </div>
                                <!-- Badge will be added here dynamically -->
                            </div>
                            <div class="flex-1">
                                <textarea 
                                    id="newPostContent"
                                    placeholder="무엇을 나누고 싶으신가요?"
                                    class="w-full p-2 sm:p-3 border rounded font-size-base resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none transition-colors duration-200"
                                    rows="3"
                                    oninput="createPostAutoGrow(this)"
                                ></textarea>
                                
                                <!-- Background Color Selector -->
                                <div class="mt-2 sm:mt-3">
                                    <div class="new-post-color-row flex flex-nowrap justify-between items-start w-full">
                                        <div class="new-post-color-item flex flex-col items-center space-y-0.5 sm:space-y-1">
                                            <button
                                                onclick="selectBackgroundColor('#F87171', this)"
                                                class="color-selector-btn w-7 h-7 sm:w-10 sm:h-10 rounded-full border-2 border-gray-300 hover:border-gray-500 transition-all"
                                                style="background-color: #F87171;"
                                                title="중보">
                                            </button>
                                            <span class="text-[10px] sm:text-xs font-medium text-gray-600">중보</span>
                                        </div>
                                        <div class="new-post-color-item flex flex-col items-center space-y-0.5 sm:space-y-1">
                                            <button
                                                onclick="selectBackgroundColor('#F5D4B3', this)"
                                                class="color-selector-btn w-7 h-7 sm:w-10 sm:h-10 rounded-full border-2 border-gray-300 hover:border-gray-500 transition-all"
                                                style="background-color: #FED7B0;"
                                                title="일상">
                                            </button>
                                            <span class="text-[10px] sm:text-xs font-medium text-gray-600">일상</span>
                                        </div>
                                        <div class="new-post-color-item flex flex-col items-center space-y-0.5 sm:space-y-1">
                                            <button
                                                onclick="selectBackgroundColor('#F5E398', this)"
                                                class="color-selector-btn w-7 h-7 sm:w-10 sm:h-10 rounded-full border-2 border-gray-300 hover:border-gray-500 transition-all"
                                                style="background-color: #FEF08A;"
                                                title="말씀">
                                            </button>
                                            <span class="text-[10px] sm:text-xs font-medium text-gray-600">말씀</span>
                                        </div>
                                        <div class="new-post-color-item flex flex-col items-center space-y-0.5 sm:space-y-1">
                                            <button
                                                onclick="selectBackgroundColor('#B3EDD8', this)"
                                                class="color-selector-btn w-7 h-7 sm:w-10 sm:h-10 rounded-full border-2 border-gray-300 hover:border-gray-500 transition-all"
                                                style="background-color: #BBF7D0;"
                                                title="사역">
                                            </button>
                                            <span class="text-[10px] sm:text-xs font-medium text-gray-600">사역</span>
                                        </div>
                                        <div class="new-post-color-item flex flex-col items-center space-y-0.5 sm:space-y-1">
                                            <button
                                                onclick="selectBackgroundColor('#C4E5F8', this)"
                                                class="color-selector-btn w-7 h-7 sm:w-10 sm:h-10 rounded-full border-2 border-gray-300 hover:border-gray-500 transition-all"
                                                style="background-color: #BAE6FD;"
                                                title="찬양">
                                            </button>
                                            <span class="text-[10px] sm:text-xs font-medium text-gray-600">찬양</span>
                                        </div>
                                        <div class="new-post-color-item flex flex-col items-center space-y-0.5 sm:space-y-1">
                                            <button
                                                onclick="selectBackgroundColor('#E2DBFB', this)"
                                                class="color-selector-btn w-7 h-7 sm:w-10 sm:h-10 rounded-full border-2 border-gray-300 hover:border-gray-500 transition-all"
                                                style="background-color: #DDD6FE;"
                                                title="교회">
                                            </button>
                                            <span class="text-[10px] sm:text-xs font-medium text-gray-600">교회</span>
                                        </div>
                                        <div class="new-post-color-item flex flex-col items-center space-y-0.5 sm:space-y-1">
                                            <button
                                                onclick="selectBackgroundColor('#FFFFFF', this)"
                                                class="color-selector-btn w-7 h-7 sm:w-10 sm:h-10 rounded-full bg-white border-2 border-gray-300 hover:border-gray-500 transition-all"
                                                title="자유">
                                            </button>
                                            <span class="text-[10px] sm:text-xs font-medium text-gray-600">자유</span>
                                        </div>
                                    </div>
                                </div>
                                
                                <!-- Image Preview (최대 4장) -->
                                <div id="postImagePreviewContainer" class="hidden mt-3">
                                    <div class="rounded-2xl border border-gray-200/90 bg-gradient-to-br from-slate-50 via-white to-blue-50/40 p-3 shadow-md ring-1 ring-gray-100/80">
                                        <div class="mb-2 flex items-center justify-between gap-2">
                                            <div class="flex min-w-0 items-center gap-2">
                                                <span class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md">
                                                    <i class="fas fa-images text-sm"></i>
                                                </span>
                                                <div class="min-w-0 leading-tight">
                                                    <div class="text-xs font-bold text-gray-800">첨부 사진</div>
                                                    <div id="postImagePreviewCount" class="text-[10px] font-semibold text-blue-600">0/4</div>
                                                </div>
                                            </div>
                                            <button type="button" onclick="removePostImage()" class="flex-shrink-0 rounded-lg px-2 py-1 text-[10px] font-medium text-gray-500 transition hover:bg-red-50 hover:text-red-600" title="모든 사진 제거">
                                                전체 삭제
                                            </button>
                                        </div>
                                        <div id="postImagePreviewList"></div>
                                    </div>
                                </div>
                                
                                <!-- Video Preview -->
                                <div id="postVideoPreviewContainer" class="hidden mt-3">
                                    <div class="relative inline-block">
                                        <video id="postVideoPreview" controls class="max-h-48 rounded-lg border"></video>
                                        <button 
                                            onclick="removePostVideo()"
                                            class="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600 transition">
                                            <i class="fas fa-times text-xs"></i>
                                        </button>
                                    </div>
                                </div>
                                
                                <!-- Shared Post Card Preview (액자 안의 액자 - 첨부파일처럼) -->
                                <div id="sharedPostPreview" class="hidden mt-3">
                                    <!-- Shared post card will be inserted here -->
                                </div>
                                
                                <!-- Upload Progress -->
                                <div id="uploadProgressContainer" class="hidden mt-3">
                                    <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                        <div class="flex items-center justify-between mb-2">
                                            <span class="text-sm font-medium text-blue-900">
                                                <i class="fas fa-cloud-upload-alt mr-2"></i><span id="uploadStatus">업로드 중...</span>
                                            </span>
                                            <span id="uploadPercent" class="text-sm font-bold text-blue-600">0%</span>
                                        </div>
                                        <div class="w-full bg-blue-200 rounded-full h-2.5">
                                            <div id="uploadProgressBar" class="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style="width: 0%"></div>
                                        </div>
                                        <p class="text-xs text-blue-700 mt-2">
                                            <i class="fas fa-info-circle mr-1"></i>동영상을 업로드하는 중입니다. 잠시만 기다려주세요.
                                        </p>
                                    </div>
                                </div>
                                
                                <div class="mt-3 flex w-full items-end justify-between">
                                    <div class="flex items-center gap-2">
                                        <input 
                                            id="postImageFile"
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            onchange="previewPostImage(event)"
                                            class="hidden"
                                        />
                                        <label 
                                            for="postImageFile"
                                            class="cursor-pointer inline-flex items-center justify-center w-10 h-10 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition min-touch lg:min-h-0 lg:min-w-0"
                                            title="여러 장은 원하는 순서대로 한 장씩 첨부해 주세요. (최대 4장)">
                                            <i class="fas fa-image"></i>
                                        </label>
                                        
                                        <input 
                                            id="postVideoFile"
                                            type="file"
                                            accept="video/*"
                                            onchange="previewPostVideo(event)"
                                            class="hidden"
                                        />
                                        <label 
                                            for="postVideoFile"
                                            class="cursor-pointer inline-flex items-center justify-center w-10 h-10 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition min-touch lg:min-h-0 lg:min-w-0"
                                            title="동영상 첨부">
                                            <i class="fas fa-video"></i>
                                        </label>
                                    </div>
                                    <div class="flex items-center space-x-3">
                                        <div class="flex flex-col items-end w-[108px] sm:w-[126px]">
                                            <select id="newPostVisibility" class="w-full h-7 px-2 border border-gray-300 rounded-md text-[10px] sm:text-xs font-medium text-gray-600 leading-none bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
                                                <option value="public">전체 공개</option>
                                                <option value="friends">친구에게만</option>
                                            </select>
                                            <button 
                                                id="createPostBtn"
                                                onclick="createPost()"
                                                class="mt-2 w-full h-7 sm:h-8 bg-blue-600 text-white px-3 rounded-lg hover:bg-blue-700 transition flex items-center justify-center text-xs sm:text-sm whitespace-nowrap leading-none">
                                                <i class="fas fa-paper-plane mr-2"></i>게시하기
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>

                <!-- Main Feed Part 2: Posts Feed & QT Panel - order-3 on mobile (after reward, post card) -->
                <div id="postsFeedColumn" class="order-3 lg:order-none">
                    <template id="qtPanelTemplate">
                        <div class="qt-panel-instance bg-white rounded-xl shadow-lg border-2 border-red-400 p-4 sm:p-6" data-qt-date="" data-qt-log-id="">
                            <div class="flex items-start justify-between gap-2 mb-4 flex-wrap">
                                <h2 class="text-xl font-bold text-red-600"><i class="fas fa-book-open text-red-600 mr-2"></i>QT</h2>
                                <div class="flex items-center gap-2 flex-wrap justify-end">
                                    <div class="text-sm text-gray-600" data-qt-field="dateLabel"></div>
                                    <div class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-50 text-red-700 border border-red-200" title="오늘 본문(시작 절)">
                                        <span data-qt-field="passageShort">-</span>
                                    </div>
                                    <button type="button" data-qt-field="qtWorshipBtn" data-qt-act="worship" class="hidden inline-flex items-center justify-center h-7 min-w-[1.75rem] px-2 rounded-lg text-xs font-medium leading-none transition bg-red-50 text-red-600 border border-red-300 hover:bg-red-100" title="QT 찬양">
                                        <i class="fas fa-music text-[13px] leading-none" aria-hidden="true"></i>
                                    </button>
                                    <button type="button" data-qt-field="qtAlarmBtn" data-qt-act="alarm" class="hidden inline-flex items-center justify-center h-7 min-w-[1.75rem] px-2 rounded-lg text-xs font-medium leading-none transition bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200" title="QT 알람 설정">
                                        <i class="fas fa-bell text-[13px] leading-none" aria-hidden="true"></i>
                                    </button>
                                    <button type="button" data-qt-act="invite" class="inline-flex items-center justify-center h-7 min-w-[1.75rem] px-2 rounded-lg text-xs font-medium leading-none transition bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200" title="친구에게 QT 추천">
                                        <i class="fas fa-envelope text-[13px] leading-none" aria-hidden="true"></i>
                                    </button>
                                    <button type="button" data-qt-act="delete-log" data-qt-field="deleteLogBtn" class="hidden inline-flex items-center justify-center h-7 min-w-[1.75rem] px-2 rounded-lg text-xs font-medium leading-none transition bg-white text-red-600 border border-red-300 hover:bg-red-50" title="저장된 QT 로그 삭제" aria-label="QT 로그 삭제">
                                        <i class="fas fa-trash text-[12px] leading-none" aria-hidden="true"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="border-l-4 border-red-600 pl-3 py-1 mb-4">
                                <span data-qt-field="verseRefRaw" class="hidden" aria-hidden="true"></span>
                                <p class="font-bold text-red-600 text-sm whitespace-pre-line leading-relaxed" data-qt-field="verseRef"></p>
                            </div>
                            <div class="flex flex-nowrap gap-1 sm:gap-2 mb-4 overflow-x-auto">
                                <button type="button" data-qt-act="toggle-section" data-section="prayer" data-qt-sec-btn="prayer" class="flex-1 min-w-0 px-2 py-1.5 sm:px-4 sm:py-2 rounded-lg font-medium text-xs sm:text-sm transition bg-gray-100 text-gray-700 border-2 border-gray-300 hover:bg-red-200 hover:border-red-300 hover:text-red-800 whitespace-nowrap">
                                    시작기도
                                </button>
                                <button type="button" data-qt-act="toggle-section" data-section="read" data-qt-sec-btn="read" class="flex-1 min-w-0 px-2 py-1.5 sm:px-4 sm:py-2 rounded-lg font-medium text-xs sm:text-sm transition bg-gray-100 text-gray-700 border-2 border-gray-300 hover:bg-red-200 hover:border-red-300 hover:text-red-800 whitespace-nowrap">
                                    <span class="sm:hidden">읽기·묵상</span>
                                    <span class="hidden sm:inline">읽기와 묵상</span>
                                </button>
                                <button type="button" data-qt-act="toggle-section" data-section="apply" data-qt-sec-btn="apply" class="flex-1 min-w-0 px-2 py-1.5 sm:px-4 sm:py-2 rounded-lg font-medium text-xs sm:text-sm transition bg-gray-100 text-gray-700 border-2 border-gray-300 hover:bg-red-200 hover:border-red-300 hover:text-red-800 whitespace-nowrap">
                                    적용
                                </button>
                                <button type="button" data-qt-act="toggle-section" data-section="prayer2" data-qt-sec-btn="prayer2" class="flex-1 min-w-0 px-2 py-1.5 sm:px-4 sm:py-2 rounded-lg font-medium text-xs sm:text-sm transition bg-gray-100 text-gray-700 border-2 border-gray-300 hover:bg-red-200 hover:border-red-300 hover:text-red-800 whitespace-nowrap">
                                    마침기도
                                </button>
                            </div>
                            <div class="qt-section hidden p-4 bg-red-50 rounded-lg border border-red-200 mb-4" data-qt-section="prayer">
                                <p class="text-gray-800 text-sm leading-relaxed">오늘 당신을 위한 생명의 양식입니다. 먼저 기도하며 오늘의 말씀을 잘 깨닿고 하나님의 인도함과 보호하심을 구하는 기도를 먼저 하십시오.</p>
                            </div>
                            <div class="qt-section hidden p-4 bg-gray-50 rounded-lg border border-gray-200 mb-4" data-qt-section="read">
                                <div class="text-gray-800 text-sm leading-relaxed whitespace-pre-line" data-qt-field="scriptureText"></div>
                            </div>
                            <div class="qt-section hidden" data-qt-section="apply">
                                <div class="flex items-end gap-3" data-qt-field="applyComposer">
                                    <div class="flex-1 min-w-0 bg-white rounded-xl border-2 border-gray-200 px-3 py-2">
                                        <textarea rows="1" placeholder="오늘 묵상한 말씀을 적용하는 내용을 기록하세요..." class="w-full p-0 text-sm border-0 focus:ring-0 focus:outline-none resize-none overflow-hidden leading-relaxed" data-qt-field="applyInput" oninput="qtAutoGrow(this)"></textarea>
                                    </div>
                                    <button type="button" data-qt-act="send-apply" class="shrink-0 w-12 h-12 rounded-2xl bg-red-600 hover:bg-red-700 text-white flex items-center justify-center transition shadow-sm" title="전송">
                                        <i class="fas fa-paper-plane"></i>
                                    </button>
                                </div>
                                <div class="hidden relative bg-white rounded-xl border-2 border-red-200 p-3 mb-2" data-qt-field="applySavedView">
                                    <p class="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap" data-qt-field="applySavedText"></p>
                                    <button type="button" data-qt-act="edit-apply" class="absolute -bottom-4 right-3 px-3.5 py-1.5 rounded-full border border-red-300 text-red-700 bg-white hover:bg-red-50 text-xs font-semibold transition shadow-md">
                                        <i class="fas fa-pen mr-1"></i>수정
                                    </button>
                                </div>
                            </div>
                            <div class="qt-section hidden mt-5" data-qt-section="prayer2">
                                <div class="flex items-end gap-3" data-qt-field="prayerComposer">
                                    <div class="flex-1 min-w-0 bg-white rounded-xl border-2 border-gray-200 px-3 py-2">
                                        <textarea rows="1" placeholder="오늘 묵상한 말씀을 하루에 적용하는 기도 제목을 적어보세요..." class="w-full p-0 text-sm border-0 focus:ring-0 focus:outline-none resize-none overflow-hidden leading-relaxed" data-qt-field="prayerInput" oninput="qtAutoGrow(this)"></textarea>
                                    </div>
                                    <button type="button" data-qt-act="send-prayer" class="shrink-0 w-12 h-12 rounded-2xl bg-red-600 hover:bg-red-700 text-white flex items-center justify-center transition shadow-sm" title="전송">
                                        <i class="fas fa-paper-plane"></i>
                                    </button>
                                </div>
                                <div class="hidden relative bg-white rounded-xl border-2 border-red-200 p-3" data-qt-field="prayerSavedView">
                                    <p class="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap" data-qt-field="prayerSavedText"></p>
                                    <button type="button" data-qt-act="edit-prayer" class="absolute -bottom-4 right-3 px-3.5 py-1.5 rounded-full border border-red-300 text-red-700 bg-white hover:bg-red-50 text-xs font-semibold transition shadow-md">
                                        <i class="fas fa-pen mr-1"></i>수정
                                    </button>
                                </div>
                            </div>
                            <div class="hidden mt-2 relative" data-qt-field="worshipWrap">
                                <div class="flex items-center gap-3 p-3 bg-gray-100 rounded-xl border border-gray-200">
                                    <button type="button" data-qt-act="worship-play" class="w-12 h-12 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 transition flex-shrink-0">
                                        <i class="fas fa-play" data-qt-field="worshipPlayIcon"></i>
                                    </button>
                                    <div class="flex-1 min-w-0">
                                        <div class="text-sm font-medium text-gray-800 truncate">찬양</div>
                                        <div class="flex items-center gap-2 mt-1">
                                            <button type="button" data-qt-act="worship-mute" class="text-gray-600 hover:text-gray-800 p-0.5 flex-shrink-0" title="음소거">
                                                <i class="fas fa-volume-up text-sm" data-qt-field="worshipMuteIcon"></i>
                                            </button>
                                            <input type="range" min="0" max="100" value="80" data-qt-field="worshipVolumeBar" oninput="setQtWorshipVolumeFromPanel(this)" class="flex-1 h-2 accent-red-500 cursor-pointer" />
                                            <span class="text-xs text-gray-500 w-8" data-qt-field="worshipVolumeLabel">80%</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </template>
                    <!-- 찬양 YT 플레이어 전역 마운트 (화면 밖 고정, 이동 금지) -->
                    <div id="qtWorshipYtGlobal" class="fixed -left-[9999px] top-0 w-1 h-1 overflow-hidden" aria-hidden="true"></div>
                    <div id="qtPanelsWrap" class="hidden flex flex-col gap-4 mb-4">
                        <div id="qtPanelsStack" class="flex flex-col gap-4"></div>
                    </div>
                    <!-- Posts Feed -->
                    <div class="relative" id="postsFeedWrapper">
                        <!-- Posts Container -->
                        <div id="postsFeed" class="space-y-3 sm:space-y-4 flex flex-col gap-3 sm:gap-4 lg:gap-0 pb-4 lg:pb-0">
                            <!-- Posts will be loaded here -->
                        </div>
                    </div>
                </div>

                </div>
                <!-- /Center Column -->

                <!-- Right Sidebar - Friend List & Notifications (same position, toggle content) -->
                <div id="rightSidebar" class="lg:col-span-1 hidden lg:block lg:order-4 lg:col-start-4 lg:row-start-1 lg:row-span-2 scroll-independent sidebar-scroll" onclick="if(this.classList.contains('reactors-only')&&event.target===this)closePostReactors()">
                    <div id="rightSidebarInner" class="relative min-h-[200px] pr-0 lg:pr-2">
                        <!-- Friend List Card -->
                        <div id="friendsTabContent" class="bg-white rounded-xl shadow-md border-2 border-gray-300 p-5 friends-empty flex flex-col min-h-0">
                            <!-- Header -->
                            <div id="friendsPanelHeader" class="flex items-center justify-between mb-4 pb-3 border-b-2 border-gray-200">
                                <div class="flex items-center">
                                    <i class="fas fa-user-friends text-blue-600 text-xl mr-2"></i>
                                    <h3 class="text-base font-bold text-gray-800">친구 목록</h3>
                                </div>
                                <button onclick="showFriendInviteModal()" class="text-sm px-2.5 py-1.5 flex items-center justify-center rounded-lg border border-gray-300 text-gray-600 bg-white hover:bg-gray-50 hover:border-blue-300 hover:text-blue-700 transition" title="지인 초대하기">
                                    <i class="fas fa-envelope"></i>
                                </button>
                            </div>
                            
                            <!-- Friends List Container -->
                            <div id="sidebarFriendsList" class="space-y-3">
                                <!-- Friends will be loaded here dynamically -->
                                <div class="text-center py-4 text-gray-400">
                                    <i class="fas fa-user-friends text-3xl mb-2 opacity-40"></i>
                                    <p class="text-sm">친구가 없습니다</p>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Reactors Panel (반응한 사람/댓글 단 사람/공유한 사람) -->
                        <div id="reactorsTabContent" class="hidden bg-white rounded-xl shadow-md border-2 border-gray-300 p-5 flex flex-col relative">
                            <button type="button" onclick="closePostReactors()" class="absolute top-3 right-3 z-10 w-10 h-10 rounded-full flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 border border-gray-300 transition shrink-0" title="닫기">
                                <i class="fas fa-times text-lg"></i>
                            </button>
                            <div class="flex items-center mb-4 pb-3 border-b-2 border-gray-200 shrink-0 pr-12">
                                <div class="flex items-center">
                                    <i id="reactorsPanelIcon" class="fas fa-users text-blue-600 text-xl mr-2"></i>
                                    <h3 id="reactorsPanelTitle" class="text-base font-bold text-gray-800">반응한 사람</h3>
                                </div>
                            </div>
                            <div id="sidebarReactorsList" class="space-y-3 flex-1 min-h-0 overflow-y-auto">
                                <div class="text-center py-4 text-gray-400">
                                    <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
                                    <p class="text-sm">불러오는 중...</p>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Notifications Card (same position as friends, visibility toggle) -->
                        <div id="notificationsTabContent" class="hidden bg-white rounded-xl shadow-md border-2 border-gray-300 p-5 notifications-empty flex flex-col min-h-0">
                            <!-- Header -->
                            <div id="notificationsPanelHeader" class="flex items-center justify-between mb-4 pb-3 border-b-2 border-gray-200">
                                <div class="flex items-center">
                                    <i class="fas fa-bell text-blue-600 text-xl mr-2"></i>
                                    <h3 class="text-base font-bold text-gray-800">알림</h3>
                                </div>
                                <button type="button" id="pushNotifyBtn" class="text-sm px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-600 bg-white hover:bg-gray-50 hover:border-blue-300 hover:text-blue-700 transition cursor-pointer" title="푸시 꺼짐 (클릭하여 켜기)">
                                    <i class="fas fa-bell-slash"></i>
                                </button>
                            </div>
                            
                            <!-- Notifications List Container -->
                            <div id="sidebarNotificationsList" class="space-y-3">
                                <!-- Notifications will be loaded here dynamically -->
                                <div class="text-center py-4 text-gray-400">
                                    <i class="fas fa-bell text-3xl mb-2 opacity-40"></i>
                                    <p class="text-sm">알림이 없습니다</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Post Focus Overlay -->
        <div id="postFocusOverlay" class="hidden fixed inset-0 z-[60] bg-black bg-opacity-95 overflow-y-auto" style="top:0;padding-top:60px;" onclick="closePostFocus()">
            <div class="w-full max-w-[100vw] sm:max-w-[95vw] lg:max-w-6xl mx-auto px-1 sm:px-4 py-4" id="postFocusContent" onclick="event.stopPropagation()">
            </div>
        </div>
        <div id="friendMessengerModal" class="hidden fixed inset-0 z-[130] bg-black/55 flex items-end sm:items-center justify-center p-0 sm:p-4" onclick="if(event.target===this) closeFriendMessenger()">
            <div class="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl border border-gray-200 overflow-hidden">
                <div class="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                    <div class="flex items-center gap-2 min-w-0">
                        <div id="friendMessengerAvatar" class="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center overflow-hidden">
                            <i class="fas fa-user text-xs"></i>
                        </div>
                        <h3 id="friendMessengerTitle" class="font-bold text-gray-800 truncate">메시지</h3>
                    </div>
                    <button type="button" onclick="closeFriendMessenger()" class="w-8 h-8 rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-800 transition">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div id="friendMessengerMessages" class="h-[52vh] sm:h-[420px] overflow-y-auto px-3 py-3 space-y-2 bg-gray-50"></div>
                <div id="friendMessengerComposerWrap" class="border-t border-gray-200 bg-white px-3 py-2">
                    <div id="friendMessengerPreview" class="hidden mb-2 p-2 rounded-xl border border-gray-200 bg-gray-50">
                        <div class="flex items-center justify-between gap-2">
                            <div class="text-xs font-semibold text-gray-600 truncate">
                                <i class="fas fa-paperclip mr-1 text-blue-500"></i>첨부 미리보기
                            </div>
                            <button type="button" onclick="removeFriendMessengerAttachment()" class="w-7 h-7 rounded-full hover:bg-white text-gray-500 hover:text-gray-800 transition" title="첨부 제거">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <img id="friendMessengerImagePreview" class="hidden mt-2 max-w-full max-h-52 rounded-lg border border-gray-200 bg-white object-contain" alt="첨부 이미지 미리보기" />
                        <video id="friendMessengerVideoPreview" class="hidden mt-2 max-w-full max-h-52 rounded-lg border border-gray-200 bg-white" controls controlsList="nodownload"></video>
                    </div>
                    <div id="friendMessengerComposerRow" class="flex items-center gap-2">
                        <input id="friendMessengerImageInput" type="file" accept="image/*" class="hidden" />
                        <input id="friendMessengerVideoInput" type="file" accept="video/*" class="hidden" />
                        <button id="friendMessengerImageBtn" type="button" onclick="pickFriendMessengerImage()" class="w-9 h-9 rounded-full border border-gray-300 text-gray-500 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 transition" title="사진 보내기">
                            <i class="fas fa-image text-sm"></i>
                        </button>
                        <button id="friendMessengerVideoBtn" type="button" onclick="pickFriendMessengerVideo()" class="w-9 h-9 rounded-full border border-gray-300 text-gray-500 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 transition" title="동영상 보내기">
                            <i class="fas fa-video text-sm"></i>
                        </button>
                        <textarea id="friendMessengerInput" rows="1" maxlength="500" placeholder="메시지를 입력하세요" class="flex-1 min-w-0 border border-gray-300 rounded-2xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400" oninput="friendMessengerAutoGrow(this)" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendFriendMessage()}"></textarea>
                        <button id="friendMessengerSendBtn" type="button" onclick="sendFriendMessage()" class="w-10 h-9 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition">
                            <i class="fas fa-paper-plane text-sm"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 피드백 요청 → 관리자 앱 내 메신저로 전달 -->
        <div id="feedbackModal" class="hidden fixed inset-0 z-[116] bg-black/55 flex items-end sm:items-center justify-center p-0 sm:p-4" onclick="if(event.target===this) hideFeedbackModal()">
            <div class="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl border border-amber-100 overflow-hidden flex flex-col max-h-[92vh]" onclick="event.stopPropagation()">
                <div class="px-5 py-4 border-b border-amber-100 flex items-center justify-between shrink-0 bg-gradient-to-r from-white to-amber-50/30">
                    <h3 class="font-bold text-gray-900 text-lg flex items-center gap-2.5">
                        <span class="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                            <i class="fas fa-lightbulb"></i>
                        </span>
                        피드백 요청
                    </h3>
                    <button type="button" onclick="hideFeedbackModal()" class="w-9 h-9 rounded-full hover:bg-amber-50 text-gray-500 hover:text-gray-800 transition" title="닫기" aria-label="닫기">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>
                <div class="px-5 py-4 overflow-y-auto flex-1 min-h-0">
                    <p class="text-sm text-gray-600 leading-relaxed mb-4">
                        관리자에게 전달할 의견/문의 내용을 입력해주세요. 앱 내 메신저로 전달됩니다.
                    </p>
                    <label for="feedbackModalText" class="sr-only">피드백 내용</label>
                    <textarea
                        id="feedbackModalText"
                        rows="6"
                        maxlength="2000"
                        class="w-full px-4 py-3 rounded-xl border-2 border-amber-400 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-500 resize-y min-h-[140px]"
                        placeholder="예) 모바일 UI 점검 부탁드립니다."
                    ></textarea>
                    <div id="feedbackAttachmentPreview" class="hidden mt-4 p-3 rounded-xl border border-amber-200 bg-amber-50/50">
                        <div class="flex items-center justify-between gap-2 mb-2">
                            <span class="text-xs font-semibold text-amber-900/80">
                                <i class="fas fa-paperclip mr-1 text-amber-600"></i>첨부 미리보기
                            </span>
                            <button type="button" onclick="removeFeedbackAttachment()" class="text-xs font-medium text-red-600 hover:text-red-800">제거</button>
                        </div>
                        <img id="feedbackAttachmentImagePreview" class="hidden mt-1 max-w-full max-h-48 rounded-lg border border-amber-200/80 object-contain bg-white" alt="첨부 이미지" />
                        <video id="feedbackAttachmentVideoPreview" class="hidden mt-1 max-w-full max-h-48 rounded-lg border border-amber-200/80 bg-black" controls controlsList="nodownload"></video>
                    </div>
                    <div class="flex flex-wrap items-center gap-2 mt-4">
                        <input type="file" id="feedbackImageInput" accept="image/*" class="hidden" />
                        <input type="file" id="feedbackVideoInput" accept="video/*" class="hidden" />
                        <button type="button" onclick="pickFeedbackImage()" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-amber-300 text-amber-900 bg-white hover:bg-amber-50 transition shadow-sm">
                            <i class="fas fa-image text-amber-600"></i>사진
                        </button>
                        <button type="button" onclick="pickFeedbackVideo()" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-amber-300 text-amber-900 bg-white hover:bg-amber-50 transition shadow-sm">
                            <i class="fas fa-video text-amber-600"></i>동영상
                        </button>
                    </div>
                </div>
                <div class="px-5 py-4 border-t border-gray-100 flex justify-end gap-2 shrink-0 bg-white">
                    <button type="button" onclick="hideFeedbackModal()" class="px-4 py-2.5 rounded-xl text-sm font-medium border border-gray-300 text-gray-800 bg-white hover:bg-gray-50 transition">
                        취소
                    </button>
                    <button type="button" id="feedbackModalSubmitBtn" onclick="submitFeedbackToAdmin()" class="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 shadow-sm transition">
                        관리자에게 전송
                    </button>
                </div>
            </div>
        </div>

        <!-- Edit Post Modal -->
        <div id="editPostModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div class="bg-white rounded-xl shadow-2xl p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold text-gray-800">
                        <i class="fas fa-edit text-blue-600 mr-2"></i>게시물 수정
                    </h2>
                    <button onclick="hideEditPostModal()" class="text-gray-500 hover:text-gray-700 transition">
                        <i class="fas fa-times text-xl"></i>
                    </button>
                </div>
                
                <input type="hidden" id="editPostId" />
                <input type="hidden" id="editPostBackgroundColor" value="#FFFFFF" />
                
                <div class="space-y-4">
                    <!-- Content -->
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">
                            <i class="fas fa-pen mr-2"></i>내용
                        </label>
                        <textarea 
                            id="editPostContent"
                            rows="6"
                            class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                            placeholder="무슨 생각을 하고 계신가요?"></textarea>
                    </div>
                    
                    <!-- Current Media Preview -->
                    <div id="editCurrentMedia" class="hidden">
                        <label class="block text-sm font-semibold text-gray-700 mb-2">
                            <i class="fas fa-image mr-2"></i>현재 첨부된 미디어
                        </label>
                        <div id="editCurrentMediaPreview" class="relative">
                            <!-- Will be filled by JavaScript -->
                        </div>
                    </div>
                    
                    <!-- Image Upload -->
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">
                            <i class="fas fa-image mr-2"></i>이미지 업로드 (새로운 이미지로 교체)
                        </label>
                        <div id="editImagePreview" class="hidden mb-3">
                            <img id="editImagePreviewImg" class="max-w-full h-auto rounded-lg border border-gray-300" />
                            <button 
                                onclick="removeEditImage()"
                                class="mt-2 text-sm text-red-600 hover:text-red-700">
                                <i class="fas fa-times mr-1"></i>이미지 제거
                            </button>
                        </div>
                        <input 
                            type="file" 
                            id="editImageInput" 
                            accept="image/*"
                            onchange="handleEditImageSelect(event)"
                            class="hidden" />
                        <label 
                            for="editImageInput"
                            class="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 cursor-pointer transition">
                            <i class="fas fa-upload mr-2"></i>이미지 선택
                        </label>
                        <p class="text-xs text-gray-500 mt-1">새 이미지를 선택하면 기존 이미지를 대체합니다</p>
                    </div>
                    
                    <!-- Video Upload -->
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">
                            <i class="fas fa-video mr-2"></i>동영상 업로드 (새로운 동영상으로 교체)
                        </label>
                        <div id="editVideoPreview" class="hidden mb-3">
                            <video id="editVideoPreviewVideo" class="max-w-full h-auto rounded-lg border border-gray-300" controls></video>
                            <button 
                                onclick="removeEditVideo()"
                                class="mt-2 text-sm text-red-600 hover:text-red-700">
                                <i class="fas fa-times mr-1"></i>동영상 제거
                            </button>
                        </div>
                        <input 
                            type="file" 
                            id="editVideoInput" 
                            accept="video/*"
                            onchange="handleEditVideoSelect(event)"
                            class="hidden" />
                        <label 
                            for="editVideoInput"
                            class="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 cursor-pointer transition">
                            <i class="fas fa-upload mr-2"></i>동영상 선택
                        </label>
                        <p class="text-xs text-gray-500 mt-1">새 동영상을 선택하면 기존 동영상을 대체합니다</p>
                    </div>
                    
                    <!-- Upload Progress -->
                    <div id="editUploadProgress" class="hidden">
                        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <p class="text-sm text-blue-800 mb-2" id="editUploadStatus">업로드 중...</p>
                            <div class="w-full bg-blue-200 rounded-full h-2">
                                <div id="editUploadProgressBar" class="bg-blue-600 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
                            </div>
                            <p class="text-xs text-blue-600 mt-1" id="editUploadPercent">0%</p>
                        </div>
                    </div>
                    
                    <!-- Buttons -->
                    <div class="flex justify-end space-x-3 pt-4">
                        <button 
                            onclick="hideEditPostModal()"
                            class="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition">
                            <i class="fas fa-times mr-2"></i>취소
                        </button>
                        <button 
                            onclick="saveEditedPost()"
                            id="editPostSaveBtn"
                            class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                            <i class="fas fa-save mr-2"></i>저장
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Signup Modal -->
        <div id="signupModal" class="hidden fixed inset-0 z-50 bg-black bg-opacity-50 pt-[4vh] sm:pt-[10vh]">
            <div class="bg-white rounded-lg shadow-xl p-3 w-[88vw] max-w-[330px] sm:max-w-md max-h-[88vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-2 sticky top-0 bg-white z-10 pb-2 border-b border-gray-100">
                    <h2 class="text-base font-bold text-gray-800">
                        <i class="fas fa-user-plus text-blue-600 mr-1.5"></i>회원가입
                    </h2>
                    <button onclick="hideSignupModal()" class="text-gray-500 hover:text-gray-700">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>
                
                <div id="signupFormContent">
                <div id="signupEmailVerifyBanner" class="mb-3 p-2.5 rounded-lg bg-blue-50 border border-blue-100 text-xs text-blue-800 flex items-start gap-2">
                    <i class="fas fa-envelope-circle-check mt-0.5 flex-shrink-0"></i>
                    <div>
                        <span class="font-semibold">이메일 인증이 필요합니다.</span>
                        <span class="block mt-0.5 text-blue-700">가입 완료 후 입력하신 이메일로 인증 링크가 발송됩니다. 링크를 클릭하면 가입이 완료됩니다.</span>
                    </div>
                </div>

                <div class="space-y-2">
                    <div>
                        <label class="block text-xs font-semibold text-gray-700 mb-1">이름 <span class="text-red-500">*</span></label>
                        <input 
                            id="signupName"
                            type="text"
                            placeholder="홍길동"
                            class="w-full p-2 text-sm border rounded focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                    </div>
                    
                    <div>
                        <label class="block text-xs font-semibold text-gray-700 mb-1">성별 <span class="text-red-500">*</span></label>
                        <select 
                            id="signupGender"
                            class="w-full p-2 text-sm border rounded focus:ring-2 focus:ring-blue-600 focus:outline-none">
                            <option value="">선택하세요</option>
                            <option value="남성">남성</option>
                            <option value="여성">여성</option>
                        </select>
                    </div>
                    
                    <div>
                        <label class="block text-xs font-semibold text-gray-700 mb-1">이메일 <span class="text-red-500">*</span></label>
                        <input 
                            id="signupEmail"
                            type="email"
                            placeholder="email@example.com"
                            list="emailHistory"
                            autocomplete="email"
                            class="w-full p-2 text-sm border rounded focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                    </div>

                    <div>
                        <label class="block text-xs font-semibold text-gray-700 mb-1">전화번호 <span class="text-gray-400 text-xs font-normal">(선택)</span></label>
                        <input
                            id="signupPhone"
                            type="tel"
                            placeholder="예) 01012345678"
                            autocomplete="off"
                            readonly
                            onfocus="this.removeAttribute('readonly')"
                            class="w-full p-2 text-sm border rounded focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                    </div>

                    <div>
                        <label class="block text-xs font-semibold text-gray-700 mb-1">비밀번호 <span class="text-red-500">*</span></label>
                        <input
                            id="signupPassword"
                            type="password"
                            placeholder="영문 소문자 + 숫자 혼합 8자"
                            autocomplete="new-password"
                            oninput="validatePasswordRealtime()"
                            class="w-full p-2 text-sm border rounded focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                        <div id="passwordRules" class="mt-1.5 space-y-0.5 text-[11px] hidden">
                            <div id="rule-length" class="flex items-center text-gray-400"><i class="fas fa-circle text-[5px] mr-1.5"></i>8자 이상</div>
                            <div id="rule-lower" class="flex items-center text-gray-400"><i class="fas fa-circle text-[5px] mr-1.5"></i>영문 소문자 3개 이상</div>
                            <div id="rule-digit" class="flex items-center text-gray-400"><i class="fas fa-circle text-[5px] mr-1.5"></i>숫자 3개 이상</div>
                            <div id="rule-noUpper" class="flex items-center text-gray-400"><i class="fas fa-circle text-[5px] mr-1.5"></i>대문자·특수문자 사용 불가</div>
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-semibold text-gray-700 mb-1">비밀번호 확인 <span class="text-red-500">*</span></label>
                        <input
                            id="signupPasswordConfirm"
                            type="password"
                            placeholder="비밀번호 재입력"
                            autocomplete="new-password"
                            oninput="validatePasswordRealtime()"
                            class="w-full p-2 text-sm border rounded focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                        <div id="passwordMatchMsg" class="mt-1 text-[11px] hidden"></div>
                    </div>
                    
                    <div>
                        <label class="block text-xs font-semibold text-gray-700 mb-1">프로필 사진 <span class="text-gray-400 text-xs font-normal">(선택)</span></label>
                        <div class="flex items-center space-x-3">
                            <div id="avatarPreview" class="w-14 h-14 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
                                <i class="fas fa-user text-gray-400 text-base"></i>
                            </div>
                            <div class="flex-1">
                                <input 
                                    id="signupAvatar"
                                    type="file"
                                    accept="image/*"
                                    onchange="previewAvatar(event)"
                                    class="hidden"
                                />
                                <label 
                                    for="signupAvatar"
                                    class="cursor-pointer inline-block px-3 py-1.5 bg-gray-100 text-gray-700 text-xs rounded hover:bg-gray-200 transition">
                                    <i class="fas fa-upload mr-1"></i>사진 선택
                                </label>
                                <p class="text-xs text-gray-500 mt-1">JPG, PNG</p>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-semibold text-gray-700 mb-1">커버 사진 <span class="text-gray-400 text-xs font-normal">(선택)</span></label>
                        <div class="space-y-2">
                            <input
                                id="signupCover"
                                type="file"
                                accept="image/*"
                                onchange="previewSignupCover(event)"
                                class="hidden"
                            />
                            <label
                                for="signupCover"
                                class="cursor-pointer inline-block px-3 py-1.5 bg-gray-100 text-gray-700 text-xs rounded hover:bg-gray-200 transition">
                                <i class="fas fa-image mr-1"></i>커버 선택
                            </label>
                            <p class="text-xs text-gray-500">가로형 권장 · 최대 10MB</p>
                            <div id="signupCoverPreview" class="w-full h-20 rounded-lg bg-gradient-to-r from-blue-100 to-purple-100 border border-gray-200 flex items-center justify-center overflow-hidden">
                                <span class="text-gray-500 text-xs">미리보기</span>
                            </div>
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">교단 <span class="text-xs text-gray-500">(선택)</span></label>
                        <select 
                            id="signupDenomination"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none">
                            <option value="">선택하세요</option>
                            
                            <!-- 장로교 -->
                            <optgroup label="장로교">
                                <option value="예장(통합)">예장(통합) - 대한예수교장로회(통합)</option>
                                <option value="예장(합동)">예장(합동) - 대한예수교장로회(합동)</option>
                                <option value="예장(고신)">예장(고신) - 대한예수교장로회(고신)</option>
                                <option value="예장(합신)">예장(합신) - 대한예수교장로회(합동신학)</option>
                                <option value="예장(백석)">예장(백석) - 대한예수교장로회(백석)</option>
                                <option value="예장(대신)">예장(대신) - 대한예수교장로회(대신)</option>
                                <option value="예장(개혁)">예장(개혁) - 대한예수교장로회(개혁)</option>
                                <option value="예장(개혁신학)">예장(개혁신학) - 대한예수교장로회(개혁신학)</option>
                                <option value="예장(기독)">예장(기독) - 기독교대한예수교장로회</option>
                                <option value="예장(총신)">예장(총신) - 대한예수교장로회(총신)</option>
                                <option value="예장(피어선)">예장(피어선) - 대한예수교장로회(피어선)</option>
                                <option value="예장(기타)">예장(기타) - 기타 장로교</option>
                            </optgroup>
                            
                            <!-- 감리교 -->
                            <optgroup label="감리교">
                                <option value="기독교대한감리회">기독교대한감리회</option>
                                <option value="기독교대한감리회(새생명)">기독교대한감리회(새생명)</option>
                                <option value="예수교대한감리회">예수교대한감리회</option>
                            </optgroup>
                            
                            <!-- 성결교 -->
                            <optgroup label="성결교">
                                <option value="기독교대한성결교회">기독교대한성결교회</option>
                                <option value="예수교대한성결교회">예수교대한성결교회</option>
                                <option value="나사렛성결교회">나사렛성결교회</option>
                            </optgroup>
                            
                            <!-- 순복음 -->
                            <optgroup label="순복음">
                                <option value="대한예수교장로회(순복음)">대한예수교장로회(순복음)</option>
                                <option value="기독교대한하나님의성회">기독교대한하나님의성회(순복음)</option>
                                <option value="여의도순복음교회">여의도순복음교회</option>
                            </optgroup>
                            
                            <!-- 침례교 -->
                            <optgroup label="침례교">
                                <option value="기독교한국침례회">기독교한국침례회</option>
                                <option value="대한예수교침례회">대한예수교침례회</option>
                            </optgroup>
                            
                            <!-- 성공회/루터교 -->
                            <optgroup label="성공회/루터교">
                                <option value="대한성공회">대한성공회</option>
                                <option value="기독교대한루터회">기독교대한루터회</option>
                            </optgroup>
                            
                            <!-- 구세군/복음교회 -->
                            <optgroup label="기타 교단">
                                <option value="구세군">구세군</option>
                                <option value="기독교대한복음교회">기독교대한복음교회</option>
                                <option value="한국독립교회">한국독립교회</option>
                                <option value="국제교회">국제교회(International Church)</option>
                                <option value="가정교회">가정교회/셀교회</option>
                                <option value="기타">기타</option>
                            </optgroup>
                        </select>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">소속 교회 <span class="text-xs text-gray-500">(선택)</span></label>
                        <input 
                            id="signupChurch"
                            type="text"
                            placeholder="예) 서울중앙교회"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">담임목사 이름 <span class="text-xs text-gray-500">(선택)</span></label>
                        <input 
                            id="signupPastor"
                            type="text"
                            placeholder="예) 김철수 목사"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">교회 위치 <span class="text-xs text-gray-500">(선택)</span></label>
                        <div class="grid grid-cols-2 gap-2">
                            <select 
                                id="signupProvince"
                                onchange="updateCities()"
                                class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none text-sm">
                                <option value="">도/시 선택</option>
                                <option value="서울특별시">서울특별시</option>
                                <option value="부산광역시">부산광역시</option>
                                <option value="대구광역시">대구광역시</option>
                                <option value="인천광역시">인천광역시</option>
                                <option value="광주광역시">광주광역시</option>
                                <option value="대전광역시">대전광역시</option>
                                <option value="울산광역시">울산광역시</option>
                                <option value="세종특별자치시">세종특별자치시</option>
                                <option value="경기도">경기도</option>
                                <option value="강원특별자치도">강원특별자치도</option>
                                <option value="충청북도">충청북도</option>
                                <option value="충청남도">충청남도</option>
                                <option value="전북특별자치도">전북특별자치도</option>
                                <option value="전라남도">전라남도</option>
                                <option value="경상북도">경상북도</option>
                                <option value="경상남도">경상남도</option>
                                <option value="제주특별자치도">제주특별자치도</option>
                            </select>
                            
                            <select 
                                id="signupCity"
                                class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none text-sm"
                                disabled>
                                <option value="">시/군/구 선택</option>
                            </select>
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">교회 직분 <span class="text-xs text-gray-500">(선택)</span></label>
                        <select 
                            id="signupPosition"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none">
                            <option value="">선택하세요</option>
                            <option value="구도자">구도자</option>
                            <option value="새가족">새가족</option>
                            <option value="담임목사">담임목사</option>
                            <option value="부목사">부목사</option>
                            <option value="전도사">전도사</option>
                            <option value="강도사">강도사</option>
                            <option value="목사">목사</option>
                            <option value="선교사">선교사</option>
                            <option value="성가사">성가사</option>
                            <option value="장로">장로</option>
                            <option value="권사">권사</option>
                            <option value="안수집사">안수집사</option>
                            <option value="집사">집사</option>
                            <option value="서리집사">서리집사</option>
                            <option value="감리사">감리사</option>
                            <option value="순장">순장</option>
                            <option value="성가대원">성가대원</option>
                            <option value="성가대지휘자">성가대 지휘자</option>
                            <option value="찬양팀">찬양팀</option>
                            <option value="찬양인도자">찬양인도자</option>
                            <option value="오케스트라단원">오케스트라 단원</option>
                            <option value="챔버팀">챔버팀</option>
                            <option value="반주자">반주자</option>
                            <option value="피아노반주자">피아노 반주자</option>
                            <option value="오르간반주자">오르간 반주자</option>
                            <option value="주일학교교사">주일학교 교사</option>
                            <option value="구역장">구역장</option>
                            <option value="셀리더">셀리더</option>
                            <option value="초등부">초등부</option>
                            <option value="중등부">중등부</option>
                            <option value="고등부">고등부</option>
                            <option value="대학부">대학부</option>
                            <option value="청년부">청년부</option>
                            <option value="장년부">장년부</option>
                            <option value="잘모름">잘모름</option>
                            <option value="기타">기타</option>
                        </select>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">결혼 <span class="text-xs text-gray-500">(선택)</span></label>
                        <select 
                            id="signupMaritalStatus"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none">
                            <option value="">선택하세요</option>
                            <option value="single">미혼</option>
                            <option value="married">기혼</option>
                            <option value="other">기타</option>
                        </select>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">주소 <span class="text-xs text-gray-500">(선택)</span></label>
                        <input 
                            id="signupAddress"
                            type="text"
                            placeholder="예) 서울특별시 강남구 테헤란로 123"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                        <p class="text-xs text-gray-500 mt-1">도로명 주소 또는 지번 주소를 입력해주세요</p>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">전화번호 <span class="text-xs text-gray-500">(선택)</span></label>
                        <input 
                            id="signupPhone"
                            type="tel"
                            placeholder="예) 010-1234-5678"
                            pattern="[0-9]{2,3}-[0-9]{3,4}-[0-9]{4}"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                        <p class="text-xs text-gray-500 mt-1">하이픈(-)을 포함하여 입력해주세요</p>
                    </div>
                    
                    <!-- 신앙 고백 질문 섹션 -->
                    <div class="border-t pt-4 mt-6">
                        <h3 class="text-lg font-bold text-gray-800 mb-4">
                            <i class="fas fa-cross text-blue-600 mr-2"></i>신앙 고백 <span class="text-xs text-gray-500 font-normal">(선택사항)</span>
                        </h3>
                        <p class="text-sm text-gray-600 mb-4">신앙 고백 질문은 선택사항입니다. 원하시는 질문에만 답변하셔도 됩니다.</p>
                        <div class="space-y-3">
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">1. 당신은 예수님이 창조주 하나님임을 믿습니까?</label>
                                <select id="faith_q1" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                            
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">2. 당신은 예수님이 당신의 죄로 인해 대신 십자가에서 죽으신 것을 믿습니까?</label>
                                <select id="faith_q2" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                            
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">3. 당신은 예수님이 부활하신 것을 믿습니까?</label>
                                <select id="faith_q3" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                            
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">4. 당신은 예수님을 주님으로 영접했습니까?</label>
                                <select id="faith_q4" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                            
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">5. 당신 안에 성령님이 계십니까?</label>
                                <select id="faith_q5" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                            
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">6. 당신은 죽으면 천국 갈 것을 확신 합니까?</label>
                                <select id="faith_q6" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                            
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">7. 당신은 성경을 진리로 믿습니까?</label>
                                <select id="faith_q7" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                            
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">8. 당신은 정기적으로 예배에 참석합니까?</label>
                                <select id="faith_q8" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                            
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">9. 당신은 정기적으로 기도합니까?</label>
                                <select id="faith_q9" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                            
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">10. 당신은 가끔 전도 합니까?</label>
                                <select id="faith_q10" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                        </div>

                <button 
                    onclick="handleSignup()"
                    class="w-full mt-3 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition font-semibold text-sm">
                    가입
                </button>
                
                <p class="mt-3 sm:mt-4 text-center text-xs sm:text-sm text-gray-600">
                    이미 계정이 있으신가요? 
                    <button onclick="hideSignupModal(); showLoginModal();" class="text-blue-600 hover:underline">로그인</button>
                </p>
                </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- How To Use Modal -->
        <div id="howToUseModal" class="hidden fixed inset-0 z-50 bg-black bg-opacity-50 p-4">
            <div class="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-4xl max-h-[70vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-3xl font-bold text-gray-800 flex items-center">
                        <div class="cross-icon mr-3" style="width: 28px; height: 28px;">
                            <div class="cross-dot top"></div>
                            <div class="cross-dot bottom"></div>
                            <div class="cross-dot left"></div>
                            <div class="cross-dot right"></div>
                        </div>
                        크로스프렌즈 사용법
                    </h2>
                    <button onclick="hideHowToUse()" class="text-gray-500 hover:text-gray-700 transition">
                        <i class="fas fa-times text-2xl"></i>
                    </button>
                </div>
                
                <div class="space-y-6">
                    <!-- Welcome Section -->
                    <div class="bg-white rounded-xl p-6 shadow-md">
                        <h3 class="text-xl font-bold text-gray-800 mb-3">
                            환영합니다!
                        </h3>
                        <p class="text-gray-700 leading-relaxed mb-4">
                            크로스프렌즈는 기독교인들을 위한 행복하고 재미있는 소셜 미디어입니다. 
                            말씀, 기도, 활동을 통해 신앙 생활을 풍성하게 하고, 형제 자매들과 소통하세요!
                        </p>
                        
                        <!-- Bible Verse about Reward -->
                        <div class="bg-blue-50 border-l-4 border-blue-600 rounded-r-lg p-4 mt-4">
                            <div class="flex items-start">
                                <i class="fas fa-book-open text-blue-600 mt-1 mr-3 text-lg"></i>
                                <div>
                                    <p class="font-bold text-blue-800 mb-2">마태복음 5:12</p>
                                    <p class="text-gray-700 leading-relaxed italic">
                                        "기뻐하고 즐거워하라 하늘에서 너희의 상이 큼이라"
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Score System -->
                    <div class="bg-white rounded-xl p-6 shadow-md">
                        <h3 class="text-xl font-bold text-gray-800 mb-4">
                            점수 시스템
                        </h3>
                        
                        <!-- Score Table -->
                        <div class="overflow-x-auto">
                            <table class="w-full border-collapse">
                                <thead>
                                    <tr class="bg-gray-50">
                                        <th class="border border-gray-300 px-4 py-3 text-left font-bold text-gray-800">행동</th>
                                        <th class="border border-gray-300 px-4 py-3 text-center font-bold text-gray-800">점수</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr class="hover:bg-gray-50 transition">
                                        <td class="border border-gray-300 px-4 py-3 text-gray-700">7종 포스팅 반응하기 (기도 제외)</td>
                                        <td class="border border-gray-300 px-4 py-3 text-center">
                                            <span class="inline-block bg-green-100 text-green-800 px-3 py-1 rounded-full font-bold">1μ</span>
                                        </td>
                                    </tr>
                                    <tr class="hover:bg-gray-50 transition">
                                        <td class="border border-gray-300 px-4 py-3 text-gray-700">7종 포스팅 반응받기</td>
                                        <td class="border border-gray-300 px-4 py-3 text-center">
                                            <span class="inline-block bg-blue-100 text-blue-800 px-3 py-1 rounded-full font-bold">2μ</span>
                                        </td>
                                    </tr>
                                    <tr class="hover:bg-gray-50 transition">
                                        <td class="border border-gray-300 px-4 py-3 text-gray-700">댓글 작성</td>
                                        <td class="border border-gray-300 px-4 py-3 text-center">
                                            <span class="inline-block bg-green-100 text-green-800 px-3 py-1 rounded-full font-bold">5μ</span>
                                        </td>
                                    </tr>
                                    <tr class="hover:bg-gray-50 transition">
                                        <td class="border border-gray-300 px-4 py-3 text-gray-700">댓글 받기</td>
                                        <td class="border border-gray-300 px-4 py-3 text-center">
                                            <span class="inline-block bg-green-100 text-green-800 px-3 py-1 rounded-full font-bold">5μ</span>
                                        </td>
                                    </tr>
                                    <tr class="hover:bg-gray-50 transition">
                                        <td class="border border-gray-300 px-4 py-3 text-gray-700">다른 사람 포스팅 공유</td>
                                        <td class="border border-gray-300 px-4 py-3 text-center">
                                            <span class="inline-block bg-orange-100 text-orange-800 px-3 py-1 rounded-full font-bold">5μ</span>
                                        </td>
                                    </tr>
                                    <tr class="hover:bg-gray-50 transition">
                                        <td class="border border-gray-300 px-4 py-3 text-gray-700">포스팅 작성</td>
                                        <td class="border border-gray-300 px-4 py-3 text-center">
                                            <span class="inline-block bg-blue-100 text-blue-800 px-3 py-1 rounded-full font-bold">10μ</span>
                                        </td>
                                    </tr>
                                    <tr class="hover:bg-gray-50 transition">
                                        <td class="border border-gray-300 px-4 py-3 text-gray-700 font-semibold">기도 포스팅 반응하기 (중보)</td>
                                        <td class="border border-gray-300 px-4 py-3 text-center">
                                            <span class="inline-block bg-purple-100 text-purple-800 px-3 py-1 rounded-full font-bold">20μ</span>
                                        </td>
                                    </tr>
                                    <tr class="hover:bg-gray-50 transition">
                                        <td class="border border-gray-300 px-4 py-3 text-gray-700 font-semibold">QT 친구 초대 이메일 발송</td>
                                        <td class="border border-gray-300 px-4 py-3 text-center">
                                            <span class="inline-block bg-red-100 text-red-800 px-3 py-1 rounded-full font-bold">20μ</span>
                                        </td>
                                    </tr>
                                    <tr class="hover:bg-gray-50 transition">
                                        <td class="border border-gray-300 px-4 py-3 text-gray-700 font-semibold">오늘의 말씀 타이핑</td>
                                        <td class="border border-gray-300 px-4 py-3 text-center">
                                            <span class="inline-block bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full font-bold">40μ</span>
                                        </td>
                                    </tr>
                                    <tr class="hover:bg-gray-50 transition">
                                        <td class="border border-gray-300 px-4 py-3 text-gray-700 font-semibold">오늘의 말씀 시청</td>
                                        <td class="border border-gray-300 px-4 py-3 text-center">
                                            <span class="inline-block bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full font-bold">40μ</span>
                                        </td>
                                    </tr>
                                    <tr class="hover:bg-gray-50 transition">
                                        <td class="border border-gray-300 px-4 py-3 text-gray-700 font-semibold">초대한 친구가 회원가입</td>
                                        <td class="border border-gray-300 px-4 py-3 text-center">
                                            <span class="inline-block bg-red-100 text-red-800 px-3 py-1 rounded-full font-bold">40μ</span>
                                        </td>
                                    </tr>
                                    <tr class="hover:bg-gray-50 transition">
                                        <td class="border border-gray-300 px-4 py-3 text-gray-700 font-semibold">QT 하루 달성</td>
                                        <td class="border border-gray-300 px-4 py-3 text-center">
                                            <span class="inline-block bg-red-100 text-red-800 px-3 py-1 rounded-full font-bold">60μ</span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        
                        <div class="mt-4 bg-yellow-50 rounded-lg p-4 border-2 border-yellow-300">
                            <p class="text-center text-gray-800 font-semibold">
                                <i class="fas fa-trophy text-yellow-500 mr-2"></i>
                                총 점수 200μ 이상 달성 시 리워드1 공개
                            </p>
                        </div>
                    </div>

                    <!-- Main Features -->
                    <div class="bg-white rounded-xl p-6 shadow-md">
                        <h3 class="text-xl font-bold text-gray-800 mb-4">
                            주요 기능
                        </h3>
                        <div class="space-y-3">
                            <div class="flex items-start">
                                <i class="fas fa-check-circle text-blue-500 mt-1 mr-3"></i>
                                <div>
                                    <h4 class="font-semibold text-gray-800">포스팅 작성</h4>
                                    <p class="text-sm text-gray-600">말씀(파란색), 기도(보라색), 활동(초록색) 카테고리로 포스팅을 작성하세요.</p>
                                </div>
                            </div>
                            <div class="flex items-start">
                                <i class="fas fa-check-circle text-purple-500 mt-1 mr-3"></i>
                                <div>
                                    <h4 class="font-size-desc font-semibold text-gray-800">말씀 타이핑 <span class="font-semibold text-gray-800">(기본 리워드)</span></h4>
                                    <p class="text-sm text-gray-600">성경 말씀을 따라 쓰며 타이핑 연습을 하고 점수를 획득하세요.</p>
                                </div>
                            </div>
                            <div class="flex items-start">
                                <i class="fas fa-check-circle text-green-500 mt-1 mr-3"></i>
                                <div>
                                    <h4 class="font-semibold text-gray-800">소통하기</h4>
                                    <p class="text-sm text-gray-600">댓글, 좋아요, 기도하기 기능으로 형제 자매들과 교제하세요.</p>
                                </div>
                            </div>
                            <div class="flex items-start">
                                <i class="fas fa-check-circle text-red-500 mt-1 mr-3"></i>
                                <div>
                                    <h4 class="font-semibold text-gray-800">나의 홈페이지</h4>
                                    <p class="text-sm text-gray-600">헤더의 <strong>원형 프사</strong>를 클릭하면 커버, 프로필, 내 포스팅이 표시됩니다.</p>
                                </div>
                            </div>
                            <div class="flex items-start">
                                <i class="fas fa-check-circle text-teal-500 mt-1 mr-3"></i>
                                <div>
                                    <h4 class="font-semibold text-gray-800">메인으로 돌아가기</h4>
                                    <p class="text-sm text-gray-600"><strong>로고</strong>를 누르면 QT, 친구 목록, 알림, 프로필 등이 모두 닫히고 전체 메인 화면으로 돌아갑니다.</p>
                                </div>
                            </div>
                            <div class="flex items-start">
                                <i class="fas fa-check-circle text-indigo-500 mt-1 mr-3"></i>
                                <div>
                                    <h4 class="font-semibold text-gray-800">헤더 버튼 (QT, 친구, 알림, 관리자, 프사)</h4>
                                    <p class="text-sm text-gray-600">첫 번째 클릭 시 해당 기능이 열립니다. 닫으려면 <strong>로고</strong>를 클릭하세요.</p>
                                </div>
                            </div>
                            <div class="flex items-start">
                                <i class="fas fa-check-circle text-yellow-500 mt-1 mr-3"></i>
                                <div>
                                    <h4 class="font-semibold text-gray-800">놀라운 보상</h4>
                                    <p class="text-sm text-gray-600">특정 점수 이상 획득 시 놀라운 리워드가 계속 주어집니다.</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Tips -->
                    <div class="bg-blue-50 border-2 border-blue-200 rounded-xl p-6 shadow-md">
                        <h3 class="text-xl font-bold mb-3 text-blue-800">
                            <i class="fas fa-lightbulb mr-2 text-blue-600"></i>Tips
                        </h3>
                        <ul class="space-y-2 text-sm text-gray-700">
                            <li class="flex items-start">
                                <i class="fas fa-arrow-right mr-2 mt-1 text-blue-600"></i>
                                <span>매일 조금씩 활동하여 꾸준히 점수를 쌓아보세요!</span>
                            </li>
                            <li class="flex items-start">
                                <i class="fas fa-arrow-right mr-2 mt-1 text-blue-600"></i>
                                <span>다른 형제 자매의 기도 제목에 기도해주고 격려해주세요.</span>
                            </li>
                            <li class="flex items-start">
                                <i class="fas fa-arrow-right mr-2 mt-1 text-blue-600"></i>
                                <span>말씀 타이핑으로 성경 구절을 암송하세요.</span>
                            </li>
                            <li class="flex items-start">
                                <i class="fas fa-arrow-right mr-2 mt-1 text-blue-600"></i>
                                <span>프로필을 자세히 작성하면 더 깊은 교제가 가능해요!</span>
                            </li>
                            <li class="flex items-start">
                                <i class="fas fa-lock mr-2 mt-1 text-gray-500"></i>
                                <span>QT 내용(시작기도, 묵상, 적용, 마침기도)은 관리자도 열람하지 않는 개인정보입니다.</span>
                            </li>
                        </ul>
                    </div>

                    <!-- μ 설명 -->
                    <div class="bg-gray-50 border-2 border-gray-200 rounded-xl p-4 shadow-md">
                        <p class="text-sm text-gray-700 leading-relaxed">
                            <strong>μ</strong>는 뮤라고 발음하며, μισθός(미스토스)의 첫글자로 성경에 나오는 상급을 의미합니다. 100μ는 100뮤라고 하고, 말하자면 100점을 의미합니다.
                        </p>
                    </div>
                </div>
                
                <div class="mt-6 text-center">
                    <button onclick="hideHowToUse(); showSignupModal();" class="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition font-semibold shadow-lg">
                        <i class="fas fa-user-plus mr-2"></i><span class="inline sm:inline">지금 가입하고<br class="sm:hidden">시작하기</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- Login Modal -->
        <div id="forgotPasswordModal" class="hidden fixed inset-0 z-[110] bg-black bg-opacity-50 pt-[5vh] sm:pt-[15vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            <div class="bg-white rounded-lg shadow-xl p-4 w-[85vw] max-w-[320px] sm:max-w-sm sm:p-6 my-auto sm:my-0 shrink-0">
                <div class="flex justify-between items-center mb-3">
                    <h2 class="text-base font-bold text-gray-800">
                        <i class="fas fa-unlock-keyhole text-blue-600 mr-1.5"></i>비밀번호 초기화
                    </h2>
                    <button onclick="hideForgotPasswordModal()" class="text-gray-500 hover:text-gray-700">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>

                <div class="space-y-2.5">
                    <div>
                        <label class="block text-xs font-semibold text-gray-700 mb-1.5">이메일</label>
                        <input
                            id="forgotPasswordEmail"
                            type="email"
                            placeholder="이메일 주소"
                            class="w-full p-2 text-sm border rounded focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                    </div>
                </div>
                <button onclick="requestPasswordReset()" class="w-full mt-3 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition font-semibold text-sm">
                    비밀번호 초기화 요청
                </button>
                <p class="mt-2 text-center text-xs text-gray-500">
                    <button type="button" onclick="hideForgotPasswordModal(); showLoginModal();" class="text-blue-600 hover:underline">로그인으로 돌아가기</button>
                </p>
            </div>
        </div>

        <div id="loginModal" class="hidden fixed inset-0 z-[100] bg-black/50 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            <div class="bg-white rounded-2xl shadow-xl border border-gray-100 w-full max-w-[17.5rem] sm:max-w-[18.5rem] p-4 sm:p-5 shrink-0">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-base font-bold text-gray-900 flex items-center gap-2">
                        <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                            <i class="fas fa-right-to-bracket text-base"></i>
                        </span>
                        로그인
                    </h2>
                    <button type="button" onclick="hideLoginModal()" class="text-gray-400 hover:text-gray-600 p-1.5 -mr-1 rounded-lg hover:bg-gray-100 touch-manipulation" aria-label="닫기">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>

                <form onsubmit="event.preventDefault(); handleLogin(); return false;" class="space-y-3.5" autocomplete="on">
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1" for="loginEmail">이메일</label>
                        <input
                            id="loginEmail"
                            name="username"
                            type="email"
                            inputmode="email"
                            placeholder="email@example.com"
                            list="emailHistory"
                            autocomplete="username"
                            class="w-full px-3 py-2.5 text-sm bg-slate-100 border-0 rounded-lg text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 focus:outline-none min-h-[42px] touch-manipulation"
                        />
                        <datalist id="emailHistory">
                            <!-- Email suggestions will be loaded here -->
                        </datalist>
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1" for="loginPassword">비밀번호</label>
                        <div class="relative">
                            <input
                                id="loginPassword"
                                name="password"
                                type="password"
                                placeholder="비밀번호 입력"
                                autocomplete="current-password"
                                class="w-full px-3 py-2.5 pr-10 text-sm bg-slate-100 border-0 rounded-lg text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 focus:outline-none min-h-[42px] touch-manipulation"
                            />
                            <button type="button" onclick="toggleLoginPasswordVisibility()" class="absolute inset-y-0 right-0 flex items-center justify-center px-2.5 text-gray-400 hover:text-gray-600 touch-manipulation" title="비밀번호 보기">
                                <i id="loginPasswordToggleIcon" class="fas fa-eye text-sm leading-none"></i>
                            </button>
                        </div>
                    </div>

                    <label class="flex items-center gap-2 cursor-pointer select-none group">
                        <input type="checkbox" id="loginRememberCredentials" class="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 shrink-0" />
                        <span class="text-xs font-medium text-gray-700 group-hover:text-gray-900">이 기기에서 비밀번호 저장</span>
                    </label>

                    <button
                        type="submit"
                        class="w-full bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 transition font-semibold text-sm min-h-[42px] touch-manipulation">
                        로그인
                    </button>

                    <p class="text-center text-xs pt-0.5">
                        <button type="button" onclick="showForgotPasswordModal()" class="text-blue-500 hover:text-blue-600 hover:underline py-0.5 touch-manipulation">비밀번호를 잊으셨나요?</button>
                    </p>
                    <p class="text-center text-xs text-gray-600 leading-relaxed">
                        <span>계정이 없으신가요? </span>
                        <button type="button" onclick="hideLoginModal(); showSignupModal();" class="text-blue-500 font-semibold hover:text-blue-600 hover:underline py-0.5 touch-manipulation">회원가입</button>
                    </p>
                </form>
            </div>
        </div>

        <!-- 로그인·자동 로그인 시: 달성 μ·언락 리워드 축하 (매번 표시) -->
        <div id="loginRewardCelebrationModal" class="hidden fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-[3px]" onclick="if (event.target === this) hideLoginRewardCelebrationModal()">
            <div class="relative bg-white rounded-2xl shadow-2xl border-2 border-violet-200/90 max-w-md w-full overflow-hidden login-reward-celeb-card max-h-[90vh] flex flex-col" onclick="event.stopPropagation()">
                <div id="loginRewardCelebrationGlow" class="pointer-events-none absolute inset-0 rounded-2xl z-0" aria-hidden="true"></div>
                <div id="loginRewardParticleLayer" class="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl z-[30]" aria-hidden="true">
                    <span class="login-reward-firework fw-left"></span>
                    <span class="login-reward-firework fw-right"></span>
                    <span class="login-reward-firework fw-mid"></span>
                    <span class="login-reward-firework fw-left2"></span>
                    <span class="login-reward-firework fw-right2"></span>
                    <span class="login-reward-confetti c1"></span>
                    <span class="login-reward-confetti c2"></span>
                    <span class="login-reward-confetti c3"></span>
                    <span class="login-reward-fanfare t1"><i class="fas fa-bullhorn"></i><span class="hit">빰!</span></span>
                    <span class="login-reward-fanfare t2"><i class="fas fa-bullhorn"></i><span class="hit">빰!</span></span>
                    <span class="login-reward-fanfare n1"><i class="fas fa-music"></i><span class="hit">팡</span></span>
                    <span class="login-reward-fanfare n2"><i class="fas fa-music"></i><span class="hit">파레</span></span>
                    <span class="login-reward-spark lr-s1"></span>
                    <span class="login-reward-spark lr-s2"></span>
                    <span class="login-reward-spark lr-s3"></span>
                    <span class="login-reward-spark lr-s4"></span>
                    <span class="login-reward-spark lr-s5"></span>
                    <span class="login-reward-spark lr-s6"></span>
                </div>
                <div class="relative z-10 bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700 px-4 py-3.5 text-white text-center border-b border-white/20">
                    <h2 id="loginRewardCelebrationTitle" class="login-reward-fanfare-title text-lg sm:text-xl font-bold leading-snug drop-shadow-sm">환영합니다</h2>
                </div>
                <div class="relative z-10 p-5 sm:p-6 space-y-4 bg-gradient-to-b from-white to-indigo-50/40 overflow-y-auto flex-1">
                    <div class="text-center rounded-xl bg-white/80 border border-blue-100 px-3 py-3 shadow-sm">
                        <p class="text-sm text-gray-600 mb-1">
                            종합 μ <span class="text-gray-400">(성경+기도+활동)</span>
                        </p>
                        <div id="loginRewardCelebrationTotal" class="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 tabular-nums">0</div>
                        <p id="loginRewardCelebrationNextHint" class="text-xs text-violet-800 font-medium mt-2"></p>
                    </div>

                    <div>
                        <p class="text-xs font-bold text-gray-700 mb-2 flex items-center gap-1.5">
                            <i class="fas fa-chart-column text-indigo-600"></i> μ 구성 · 상승 그래프
                        </p>
                        <div class="flex items-end justify-center gap-2 sm:gap-3 px-1 rounded-xl bg-white/70 border border-indigo-100 py-3">
                            <div class="flex flex-col items-center flex-1 max-w-[5rem]">
                                <div class="w-full h-28 flex flex-col justify-end rounded-t-lg bg-slate-100 border border-slate-200 overflow-hidden">
                                    <div id="loginRewardBarScripture" class="w-full rounded-t-lg bg-gradient-to-t from-amber-500 to-amber-400 min-h-0 shadow-sm" style="height:0%"></div>
                                </div>
                                <span class="text-[10px] text-amber-900 font-bold mt-1.5 tabular-nums"><span id="loginRewardCelebrationScripture">0</span>μ</span>
                                <span class="text-[10px] text-amber-800/90 font-medium">성경</span>
                            </div>
                            <div class="flex flex-col items-center flex-1 max-w-[5rem]">
                                <div class="w-full h-28 flex flex-col justify-end rounded-t-lg bg-slate-100 border border-slate-200 overflow-hidden">
                                    <div id="loginRewardBarPrayer" class="w-full rounded-t-lg bg-gradient-to-t from-purple-500 to-purple-400 min-h-0 shadow-sm" style="height:0%"></div>
                                </div>
                                <span class="text-[10px] text-purple-900 font-bold mt-1.5 tabular-nums"><span id="loginRewardCelebrationPrayer">0</span>μ</span>
                                <span class="text-[10px] text-purple-800/90 font-medium">기도</span>
                            </div>
                            <div class="flex flex-col items-center flex-1 max-w-[5rem]">
                                <div class="w-full h-28 flex flex-col justify-end rounded-t-lg bg-slate-100 border border-slate-200 overflow-hidden">
                                    <div id="loginRewardBarActivity" class="w-full rounded-t-lg bg-gradient-to-t from-rose-500 to-rose-400 min-h-0 shadow-sm" style="height:0%"></div>
                                </div>
                                <span class="text-[10px] text-rose-900 font-bold mt-1.5 tabular-nums"><span id="loginRewardCelebrationActivity">0</span>μ</span>
                                <span class="text-[10px] text-rose-800/90 font-medium">활동</span>
                            </div>
                        </div>
                    </div>

                    <div>
                        <p class="text-xs font-bold text-gray-700 mb-2 flex items-center gap-1.5">
                            <i class="fas fa-check-circle text-emerald-600"></i> 달성한 리워드
                        </p>
                        <ul id="loginRewardUnlockList" class="space-y-2 text-left list-none p-0 m-0"></ul>
                    </div>

                    <div class="text-center px-1 space-y-1.5">
                        <p class="text-xs text-gray-700 leading-relaxed">
                            "기뻐하고 즐거워하라 하늘에서 너희의 상이 큼이라"
                        </p>
                        <p class="text-[11px] text-gray-500">마태복음 5:12</p>
                    </div>
                    <button type="button" onclick="hideLoginRewardCelebrationModal()" class="login-reward-fanfare-btn w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white font-bold hover:from-blue-700 hover:to-violet-700 transition shadow-lg shadow-indigo-500/25">
                        함께 지어져가요
                    </button>
                </div>
            </div>
        </div>

        <!-- 종합 μ 200 / 1000 / 1400 마일스톤 축하 (세션 중 임계값 돌파 시) -->
        <div id="scoreMilestoneCelebrationModal" class="hidden fixed inset-0 z-[125] flex items-center justify-center p-4 bg-black/55" onclick="if (event.target === this) hideScoreMilestoneCelebrationModal()">
            <div class="relative bg-white rounded-2xl shadow-2xl border-2 border-blue-200 max-w-md w-full overflow-hidden milestone-modal-card max-h-[90vh] flex flex-col" onclick="event.stopPropagation()">
                <div id="milestoneJackpotGlow" class="pointer-events-none absolute inset-0 rounded-2xl z-0" aria-hidden="true"></div>
                <div class="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl z-[5]" aria-hidden="true">
                    <span class="milestone-spark milestone-spark-1"></span>
                    <span class="milestone-spark milestone-spark-2"></span>
                    <span class="milestone-spark milestone-spark-3"></span>
                    <span class="milestone-spark milestone-spark-4"></span>
                    <span class="milestone-spark milestone-spark-5"></span>
                </div>
                <div id="milestoneCelebrationHeader" class="relative z-10 px-5 py-4 text-white text-center rounded-t-2xl border-b border-white/20 bg-gradient-to-r from-blue-600 to-indigo-600">
                    <p class="text-sm opacity-90">마일스톤 달성</p>
                    <h2 id="milestoneCelebrationTitle" class="text-xl font-bold mt-1">200μ 달성!</h2>
                    <p id="milestoneCelebrationSubtitle" class="text-xs opacity-90 mt-1 leading-snug">리워드가 열렸습니다</p>
                </div>
                <div class="p-5 sm:p-6 space-y-4 relative z-10 overflow-y-auto flex-1">
                    <div class="text-center">
                        <p class="text-sm text-gray-600 mb-1">종합 μ <span class="text-gray-400">(성경+기도+활동)</span></p>
                        <div id="milestoneCelebrationBigMu" class="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-violet-600 tabular-nums">0μ</div>
                    </div>
                    <div class="relative z-10 flex items-end justify-center gap-2 sm:gap-3 px-1">
                        <div class="flex flex-col items-center flex-1 max-w-[5rem]">
                            <div class="w-full h-28 flex flex-col justify-end rounded-t-lg bg-gray-100 border border-gray-200 overflow-hidden">
                                <div id="milestoneBarScripture" class="w-full rounded-t-lg bg-gradient-to-t from-amber-500 to-amber-400 min-h-0" style="height:0%"></div>
                            </div>
                            <span class="text-[10px] text-amber-800 font-semibold mt-1.5">성경</span>
                        </div>
                        <div class="flex flex-col items-center flex-1 max-w-[5rem]">
                            <div class="w-full h-28 flex flex-col justify-end rounded-t-lg bg-gray-100 border border-gray-200 overflow-hidden">
                                <div id="milestoneBarPrayer" class="w-full rounded-t-lg bg-gradient-to-t from-purple-500 to-purple-400 min-h-0" style="height:0%"></div>
                            </div>
                            <span class="text-[10px] text-purple-800 font-semibold mt-1.5">기도</span>
                        </div>
                        <div class="flex flex-col items-center flex-1 max-w-[5rem]">
                            <div class="w-full h-28 flex flex-col justify-end rounded-t-lg bg-gray-100 border border-gray-200 overflow-hidden">
                                <div id="milestoneBarActivity" class="w-full rounded-t-lg bg-gradient-to-t from-rose-500 to-rose-400 min-h-0" style="height:0%"></div>
                            </div>
                            <span class="text-[10px] text-rose-800 font-semibold mt-1.5">활동</span>
                        </div>
                    </div>
                    <p id="milestoneCelebrationRewardHint" class="text-center text-xs text-gray-500 leading-relaxed"></p>
                    <button type="button" onclick="hideScoreMilestoneCelebrationModal()" class="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition shadow-md">확인</button>
                </div>
            </div>
        </div>

        <!-- View Profile Modal -->
        <div id="viewProfileModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div class="bg-white rounded-lg shadow-xl p-8 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold text-gray-800">
                        <i class="fas fa-user-circle text-blue-600 mr-2"></i>내 프로필
                    </h2>
                    <button onclick="hideViewProfileModal()" class="text-gray-500 hover:text-gray-700">
                        <i class="fas fa-times text-xl"></i>
                    </button>
                </div>
                
                <div id="viewProfileContent" class="space-y-6">
                    <!-- Profile details will be loaded here -->
                </div>
                
                <div class="mt-6 flex justify-end">
                    <button onclick="hideViewProfileModal(); void showEditProfileModal();" class="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition">
                        <i class="fas fa-edit mr-2"></i>프로필 수정하기
                    </button>
                </div>
            </div>
        </div>

        <!-- Edit Profile Modal -->
        <div id="editProfileModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div class="bg-white rounded-lg shadow-xl p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-6 sticky top-0 bg-white z-10 pb-4">
                    <h2 class="text-2xl font-bold text-gray-800">
                        <i class="fas fa-user-edit text-blue-600 mr-2"></i>회원정보 수정
                    </h2>
                    <button onclick="hideEditProfileModal()" class="text-gray-500 hover:text-gray-700">
                        <i class="fas fa-times text-xl"></i>
                    </button>
                </div>
                
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">이메일</label>
                        <input 
                            id="editEmail"
                            type="email"
                            disabled
                            class="w-full p-3 border rounded-lg bg-gray-100 cursor-not-allowed"
                        />
                        <p class="text-xs text-gray-500 mt-1">이메일은 변경할 수 없습니다.</p>
                    </div>

                    <div class="border border-slate-200 rounded-lg p-4 bg-slate-50">
                        <h3 class="text-sm font-bold text-gray-800 mb-1">
                            <i class="fas fa-key text-blue-600 mr-2"></i>비밀번호 변경
                        </h3>
                        <p class="text-xs text-gray-500 mb-3">가입 시와 동일 규칙(소문자·숫자 각 3자 이상, 8자 이상, 대문자·특수문자 불가)</p>
                        <div class="space-y-2">
                            <div>
                                <label class="block text-xs font-medium text-gray-700 mb-1" for="editPasswordCurrent">현재 비밀번호</label>
                                <input type="password" id="editPasswordCurrent" autocomplete="current-password" class="w-full p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            </div>
                            <div>
                                <label class="block text-xs font-medium text-gray-700 mb-1" for="editPasswordNew">새 비밀번호</label>
                                <input type="password" id="editPasswordNew" autocomplete="new-password" placeholder="예: abc12345" class="w-full p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            </div>
                            <div>
                                <label class="block text-xs font-medium text-gray-700 mb-1" for="editPasswordConfirm">새 비밀번호 확인</label>
                                <input type="password" id="editPasswordConfirm" autocomplete="new-password" class="w-full p-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            </div>
                            <button type="button" onclick="submitChangePasswordLegacy()" class="w-full sm:w-auto px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition">
                                비밀번호 변경
                            </button>
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">이름</label>
                        <input 
                            id="editName"
                            type="text"
                            placeholder="홍길동"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">성별</label>
                        <select 
                            id="editGender"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none">
                            <option value="">선택하세요</option>
                            <option value="남성">남성</option>
                            <option value="여성">여성</option>
                        </select>
                    </div>
                    
                    <div class="border-t pt-4">
                        <label class="block text-sm font-semibold text-gray-700 mb-2">
                            <i class="fas fa-user-circle text-blue-600 mr-2"></i>프로필 사진
                        </label>
                        <div class="flex items-center space-x-4">
                            <div id="editAvatarPreview" class="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden border-2 border-gray-300">
                                <i class="fas fa-user text-gray-400 text-2xl"></i>
                            </div>
                            <div class="flex-1">
                                <input 
                                    id="editAvatar"
                                    type="file"
                                    accept="image/*"
                                    onchange="previewEditAvatar(event)"
                                    class="hidden"
                                />
                                <input 
                                    id="editCover"
                                    type="file"
                                    accept="image/*"
                                    onchange="previewEditCover(event)"
                                    class="hidden"
                                />
                                <div class="space-y-2">
                                    <!-- 프로필 사진 버튼들 -->
                                    <div class="flex space-x-2">
                                        <label 
                                            for="editAvatar"
                                            class="cursor-pointer inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold">
                                            <i class="fas fa-upload mr-2"></i>프로필 사진 변경
                                        </label>
                                        <button 
                                            type="button"
                                            onclick="deleteAvatar()"
                                            class="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition font-semibold">
                                            <i class="fas fa-trash mr-2"></i>프로필 사진 삭제
                                        </button>
                                    </div>
                                    
                                    <!-- 커버 사진 버튼들 -->
                                    <div class="flex space-x-2">
                                        <label 
                                            for="editCover"
                                            class="cursor-pointer inline-block px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-semibold">
                                            <i class="fas fa-image mr-2"></i>커버 사진 변경
                                        </label>
                                        <button 
                                            type="button"
                                            onclick="deleteCover()"
                                            class="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition font-semibold">
                                            <i class="fas fa-trash mr-2"></i>커버 사진 삭제
                                        </button>
                                    </div>
                                </div>
                                <p id="editAvatarNote" class="text-xs text-gray-500 mt-2">
                                    프로필: JPG, PNG (최대 5MB) / 커버: JPG, PNG (최대 10MB)
                                </p>
                                <div id="editCoverPreview" class="w-full h-32 rounded-lg bg-gradient-to-r from-blue-400 to-purple-500 flex items-center justify-center overflow-hidden relative border-2 border-gray-300 mt-3">
                                    <span class="text-white text-sm font-semibold drop-shadow-lg">📸 커버 사진 미리보기</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">소속 교회</label>
                        <input 
                            id="editChurch"
                            type="text"
                            placeholder="예) 서울중앙교회"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">담임목사 이름</label>
                        <input 
                            id="editPastor"
                            type="text"
                            placeholder="예) 김철수 목사"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">교회 직분</label>
                        <select 
                            id="editPosition"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none">
                            <option value="">선택하세요</option>
                            <option value="담임목사">담임목사</option>
                            <option value="부목사">부목사</option>
                            <option value="전도사">전도사</option>
                            <option value="강도사">강도사</option>
                            <option value="목사">목사</option>
                            <option value="선교사">선교사</option>
                            <option value="성가사">성가사</option>
                            <option value="장로">장로</option>
                            <option value="권사">권사</option>
                            <option value="안수집사">안수집사</option>
                            <option value="집사">집사</option>
                            <option value="서리집사">서리집사</option>
                            <option value="감리사">감리사</option>
                            <option value="순장">순장</option>
                            <option value="성가대원">성가대원</option>
                            <option value="성가대지휘자">성가대 지휘자</option>
                            <option value="찬양팀">찬양팀</option>
                            <option value="찬양인도자">찬양인도자</option>
                            <option value="오케스트라단원">오케스트라 단원</option>
                            <option value="챔버팀">챔버팀</option>
                            <option value="반주자">반주자</option>
                            <option value="피아노반주자">피아노 반주자</option>
                            <option value="오르간반주자">오르간 반주자</option>
                            <option value="주일학교교사">주일학교 교사</option>
                            <option value="구역장">구역장</option>
                            <option value="셀리더">셀리더</option>
                            <option value="초등부">초등부</option>
                            <option value="중등부">중등부</option>
                            <option value="고등부">고등부</option>
                            <option value="대학부">대학부</option>
                            <option value="청년부">청년부</option>
                            <option value="장년부">장년부</option>
                            <option value="구도자">구도자</option>
                            <option value="새가족">새가족</option>
                            <option value="잘모름">잘모름</option>
                            <option value="기타">기타</option>
                        </select>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">결혼</label>
                        <select 
                            id="editMaritalStatus"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none">
                            <option value="">선택하세요</option>
                            <option value="single">미혼</option>
                            <option value="married">기혼</option>
                            <option value="other">기타</option>
                        </select>
                    </div>
                    
                    <!-- 신앙 고백 질문 섹션 -->
                    <div class="border-t pt-4 mt-6">
                        <h3 class="text-lg font-bold text-gray-800 mb-4">
                            <i class="fas fa-cross text-blue-600 mr-2"></i>신앙 고백 <span class="text-xs text-gray-500 font-normal">(선택사항)</span>
                        </h3>
                        <p class="text-sm text-gray-600 mb-4">신앙 고백 질문은 선택사항입니다. 원하시는 질문에만 답변하셔도 됩니다.</p>
                        <div class="space-y-3">
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">1. 당신은 예수님이 창조주 하나님임을 믿습니까?</label>
                                <select id="edit_faith_q1" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                            
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">2. 당신은 예수님이 당신의 죄로 인해 대신 십자가에서 죽으신 것을 믿습니까?</label>
                                <select id="edit_faith_q2" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                            
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">3. 당신은 예수님이 부활하신 것을 믿습니까?</label>
                                <select id="edit_faith_q3" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                            
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">4. 당신은 성경이 하나님의 말씀임을 믿습니까?</label>
                                <select id="edit_faith_q4" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                            
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">5. 당신은 사람들에게 복음을 전해야 한다고 믿습니까?</label>
                                <select id="edit_faith_q5" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                            
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">6. 당신은 십일조를 드리고 있습니까?</label>
                                <select id="edit_faith_q6" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                            
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">7. 당신은 성경을 읽습니까?</label>
                                <select id="edit_faith_q7" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                            
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">8. 정기적으로 예배에 참석합니까?</label>
                                <select id="edit_faith_q8" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                            
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">9. 정기적으로 기도합니까?</label>
                                <select id="edit_faith_q9" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                            
                            <div class="flex items-center justify-between">
                                <label class="text-sm text-gray-700 flex-1">10. 가끔 전도합니까?</label>
                                <select id="edit_faith_q10" class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none">
                                    <option value="">선택</option>
                                    <option value="예">예</option>
                                    <option value="아니오">아니오</option>
                                    <option value="잘모름">잘모름</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
                
                <button 
                    onclick="handleEditProfile()"
                    class="w-full mt-6 bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition font-semibold">
                    저장하기
                </button>
            </div>
        </div>

        <!-- QT 친구 추천 모달 -->
        <div id="qtInviteModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div class="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-lg font-bold text-gray-800">
                        <i class="fas fa-envelope text-red-600 mr-2"></i>친구에게 QT 추천하기
                    </h2>
                    <button onclick="hideQtInviteModal()" class="text-gray-500 hover:text-gray-700">
                        <i class="fas fa-times text-xl"></i>
                    </button>
                </div>
                <p class="text-sm text-gray-600 mb-4">이메일을 입력하면 오늘의 샘플 QT 카드와 함께 회원가입 링크가 발송됩니다.</p>
                <div class="flex flex-col sm:flex-row gap-2">
                    <input type="email" id="qtInviteEmail" placeholder="친구 이메일" class="w-full min-w-0 flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500">
                    <button id="qtInviteBtn" onclick="sendQtInvite()" class="w-full sm:w-auto px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium whitespace-nowrap">초대 보내기</button>
                </div>
                <p id="qtInviteMsg" class="text-xs mt-2 hidden"></p>
            </div>
        </div>

        <!-- CROSSfriends 지인 초대 모달 (친구목록 패널) -->
        <div id="friendInviteModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div class="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-lg font-bold text-gray-800">
                        <i class="fas fa-envelope text-amber-600 mr-2"></i>지인 초대하기
                    </h2>
                    <button onclick="hideFriendInviteModal()" class="text-gray-500 hover:text-gray-700">
                        <i class="fas fa-times text-xl"></i>
                    </button>
                </div>
                <p class="text-sm text-gray-600 mb-4">이메일을 입력하면 CROSSfriends 초대 메일이 발송됩니다. 가입 시 +20μ, 친구가 가입하면 +40μ를 받아요!</p>
                <div class="flex flex-col sm:flex-row gap-2">
                    <input type="email" id="friendInviteEmail" placeholder="초대할 이메일 주소" class="w-full min-w-0 flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500">
                    <button id="friendInviteBtn" onclick="sendFriendInvite()" class="w-full sm:w-auto px-3 py-2 border-2 border-gray-500 bg-white text-gray-500 rounded-lg hover:border-blue-600 hover:text-blue-600 text-sm font-medium whitespace-nowrap">초대 보내기</button>
                </div>
                <p id="friendInviteMsg" class="text-xs mt-2 hidden"></p>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js"></script>
        <script src="/static/app.js?v=${Date.now()}"></script>
        <script>
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('/sw.js?v=2', { scope: '/' }).catch(() => {});
            }
        </script>
        <script>
            // Toggle Typing Area
            window.toggleTypingArea = function() {
                const typingArea = document.getElementById('typingArea');
                
                if (typingArea) {
                    const isHidden = typingArea.classList.contains('hidden');
                    
                    if (isHidden) {
                        // Show typing area
                        typingArea.classList.remove('hidden');
                    } else {
                        // Hide typing area
                        typingArea.classList.add('hidden');
                    }
                }
            };
            
            // Handle Typing Enter
            window.handleTypingEnter = async function(event) {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    
                    const input = document.getElementById('typingInput');
                    const result = document.getElementById('typingResult');
                    const verseText = document.getElementById('verseText');
                    
                    if (!input || !result || !verseText) return;
                    
                    const userInput = input.value.trim();
                    const correctVerse = verseText.textContent.trim();
                    
                    if (!userInput) {
                        result.classList.remove('hidden');
                        result.className = 'mt-2 text-sm text-yellow-600';
                        result.textContent = '⚠️ 구절을 입력해주세요.';
                        return;
                    }
                    
                    // Simple comparison
                    const isCorrect = userInput === correctVerse;
                    
                    if (isCorrect) {
                        result.classList.remove('hidden');
                        result.className = 'mt-2 text-sm text-green-600 font-bold';
                        result.textContent = '✅ 정확합니다! 말씀을 마음에 새기셨습니다.';
                        
                        // Clear input after success
                        setTimeout(() => {
                            input.value = '';
                            result.classList.add('hidden');
                        }, 3000);
                        
                        // TODO: Award points if needed
                        console.log('말씀 타이핑 성공!');
                    } else {
                        result.classList.remove('hidden');
                        result.className = 'mt-2 text-sm text-red-600';
                        result.textContent = '❌ 다시 한 번 확인해보세요.';
                    }
                }
            };
            
            // Auto-login on page load
            (async function() {
                const storedUserId = localStorage.getItem('currentUserId');
                const storedEmail = localStorage.getItem('currentUserEmail');
                
                if (storedUserId && storedEmail) {
                    try {
                        const response = await axios.get(\`/api/users/email/\${storedEmail}\`);
                        
                        if (response.data.user) {
                            currentUserId = response.data.user.id;
                            currentUser = response.data.user;
                            
                            localStorage.setItem('currentUserId', response.data.user.id);
                            
                            updateAuthUI();
                            
                            await loadUserScores();
                            await loadFriendsList();
                            await loadNotifications();
                            
                            // Start notification polling
                            startNotificationPolling();
                            
                            loadPosts();
                            console.log('자동 로그인 성공:', currentUser.name);
                        }
                    } catch (error) {
                        console.error('자동 로그인 실패:', error);
                        localStorage.removeItem('currentUserId');
                        localStorage.removeItem('currentUserEmail');
                        localStorage.removeItem('currentUser');
                    }
                }
            })();
        </script>
    </body>
    </html>
  `)
})


export default app
