#!/usr/bin/env node
/**
 * 앱(src/index.tsx)과 동일: PBKDF2-SHA256, 10_000회, 32바이트 출력, 솔트 16바이트 base64.
 * 프로덕션에서 구버전(15만 회) 해시는 Worker CPU 한도로 검증이 안 되므로,
 * 새 비밀번호로 salt/hash를 만들어 D1에 반영할 때 사용합니다.
 *
 * 사용:
 *   node scripts/hash-password.mjs <이메일> <새비밀번호>
 * 출력된 SQL을 복사한 뒤:
 *   npx wrangler d1 execute crossfriends-production --remote --command "..."
 */

import crypto from 'crypto'

const PBKDF2_ITERATIONS = 10_000

const email = process.argv[2]
const password = process.argv[3]

if (!email || !password) {
  console.error('사용법: node scripts/hash-password.mjs <이메일> <새비밀번호>')
  process.exit(1)
}

if (password.length < 8) {
  console.error('비밀번호는 8자 이상이어야 합니다(가입 규칙과 동일).')
  process.exit(1)
}

const salt = crypto.randomBytes(16)
const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256')
const saltB64 = salt.toString('base64')
const hashB64 = hash.toString('base64')

const esc = (s) => s.replace(/'/g, "''")

const sql = `UPDATE users SET password_salt = '${esc(saltB64)}', password_hash = '${esc(hashB64)}', password_updated_at = CURRENT_TIMESTAMP, plain_password = NULL WHERE LOWER(email) = LOWER('${esc(email)}');`

console.log('-- 아래 한 줄을 복사해 실행하세요 (프로덕션 D1):')
console.log('')
console.log(sql)
console.log('')
