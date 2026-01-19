# Crossfriends - 기독교인 소셜 네트워크

## 프로젝트 개요
- **이름**: Crossfriends
- **목표**: 기독교인들만을 위한 소셜 네트워크 플랫폼
- **주요 기능**:
  - 게시물 작성 및 공유 (성경 구절 첨부 가능)
  - 댓글 및 좋아요 기능
  - 기도 제목 작성 및 응답
  - 사용자 프로필 관리
  - 친구 관계 관리

## 🌐 URLs
- **개발 서버**: https://3000-iqlzv7b987x0tbhluw43c-5c13a017.sandbox.novita.ai
- **로컬**: http://localhost:3000

## ⚙️ 기술 스택
- **프론트엔드**: HTML, TailwindCSS, Vanilla JavaScript
- **백엔드**: Hono Framework (TypeScript)
- **데이터베이스**: Cloudflare D1 (SQLite)
- **배포**: Cloudflare Pages + Workers
- **프로세스 관리**: PM2

## 📊 데이터 모델

### 사용자 (Users)
- 이메일, 이름, 소개, 아바타
- 소속 교회, 교단, 지역 정보

### 게시물 (Posts)
- 내용, 이미지, 성경 구절 참조
- 작성자 정보, 좋아요/댓글 수

### 댓글 (Comments)
- 게시물에 대한 댓글
- 작성자 정보, 작성 시간

### 좋아요 (Likes)
- 게시물 좋아요 기능
- 중복 방지 (UNIQUE 제약)

### 기도 제목 (Prayer Requests)
- 제목, 내용, 익명 여부
- 상태 (진행중/응답됨/종료)
- 기도 응답 수 추적

### 기도 응답 (Prayer Responses)
- 기도 제목에 대한 응답
- 격려와 함께 기도

### 친구 관계 (Friendships)
- 친구 요청 및 수락/거절
- 상태 관리 (대기/수락/거절)

## 🎯 완료된 기능

### ✅ 백엔드 API
- **사용자 관리**
  - `GET /api/users` - 모든 사용자 조회
  - `GET /api/users/:id` - 특정 사용자 조회
  - `POST /api/users` - 새 사용자 생성

- **게시물 관리**
  - `GET /api/posts` - 모든 게시물 조회 (좋아요/댓글 수 포함)
  - `GET /api/posts/:id` - 특정 게시물 조회
  - `POST /api/posts` - 새 게시물 작성
  - `DELETE /api/posts/:id` - 게시물 삭제

- **댓글 관리**
  - `GET /api/posts/:id/comments` - 게시물의 댓글 조회
  - `POST /api/posts/:id/comments` - 댓글 작성

- **좋아요 기능**
  - `POST /api/posts/:id/like` - 좋아요 토글 (좋아요/취소)

- **기도 제목 관리**
  - `GET /api/prayers` - 모든 기도 제목 조회
  - `GET /api/prayers/:id` - 특정 기도 제목 조회
  - `POST /api/prayers` - 새 기도 제목 작성
  - `GET /api/prayers/:id/responses` - 기도 응답 조회
  - `POST /api/prayers/:id/responses` - 기도 응답 작성

### ✅ 프론트엔드 UI
- **메인 피드**
  - 게시물 목록 표시
  - 실시간 좋아요/댓글 수
  - 성경 구절 하이라이트
  - 댓글 작성 및 조회

- **게시물 작성**
  - 텍스트 입력
  - 성경 구절 참조 추가
  - 실시간 피드 업데이트

- **기도 제목 섹션**
  - 기도 제목 카드 표시
  - 익명/실명 구분
  - 응답 수 표시
  - 모달 기반 작성

- **사용자 전환**
  - 테스트용 사용자 전환 기능
  - 각 사용자별 좋아요 상태 관리

## ✅ 최근 구현된 기능

### 사용자 인증 시스템
- **로그인**: 이메일 기반 간단 로그인
  - 이메일만으로 로그인 가능
  - 대소문자 구분 없음
  - 자동 공백 제거
  - 디버깅 콘솔 로그 포함
  
- **회원가입**: 상세한 프로필 정보 수집
  - 이름, 이메일, 성별
  - 프로필 사진 업로드 (R2 Storage)
  - 교단 선택 (장로교, 감리교, 성결교 등)
  - 소속 교회 및 담임목사
  - 교회 위치 (도/시 2단계)
  - 교회 직분 (목사, 장로, 집사 등)
  - 신앙 고백 10가지 질문
  
- **프로필 수정**: 회원정보 수정 기능
  - 이름, 성별, 교회, 목사, 직분 수정
  - 프로필 사진 변경
  - 이메일은 변경 불가 (고유 식별자)

## 🚧 미구현 기능

### 향후 추가 예정
- [ ] 친구 요청 및 관리 UI
- [ ] 이미지 업로드 (게시물)
- [ ] 실시간 알림
- [ ] 검색 기능 (사용자/게시물)
- [ ] 교회 커뮤니티 그룹
- [ ] 성경 읽기 계획 공유
- [ ] 찬양/예배 일정 공유
- [ ] 모바일 반응형 최적화

## 📖 사용자 가이드

### 🔐 로그인 및 회원가입

#### 로그인 방법
1. 우측 상단의 "로그인" 버튼 클릭
2. 이메일 주소 입력 (등록된 이메일)
3. "로그인" 버튼 클릭

**테스트 계정:**
- `john@example.com` (John Kim)
- `sarah@example.com` (Sarah Park)
- `david@example.com` (David Lee)
- `grace@example.com` (Grace Choi)
- `holofa@pcu.ac.kr` (황성곤)
- `test@crossfriends.com` (테스트유저)

#### 회원가입 방법
1. 우측 상단의 "회원가입" 버튼 클릭
2. 모든 기본 정보 입력:
   - 이름, 성별, 이메일
   - 프로필 사진 (선택, 최대 5MB)
   - 교단 선택
   - 소속 교회, 담임목사
   - 교회 위치 (도→시 2단계 선택)
   - 교회 직분
3. 신앙 고백 10가지 질문에 답변
4. "회원가입 완료" 버튼 클릭
5. 자동으로 로그인됩니다

#### 프로필 수정 방법
1. 로그인 후 우측 상단의 프로필 클릭
2. 수정할 정보 입력
3. "저장하기" 버튼 클릭

**주의사항:**
- 이메일은 고유 식별자로 변경할 수 없습니다
- 프로필 사진은 JPG, PNG만 가능 (최대 5MB)
- 회원가입 시 이미 등록된 이메일은 사용할 수 없습니다

### 📝 게시물 작성
1. 상단의 텍스트 입력 창에 내용을 작성합니다
2. (선택) 성경 구절 참조를 입력합니다 (예: 시편 23:1)
3. "게시하기" 버튼을 클릭합니다

### 댓글 작성
1. 게시물의 댓글 아이콘을 클릭합니다
2. 댓글 입력창에 내용을 작성합니다
3. 전송 버튼을 클릭합니다

### 좋아요
- 게시물의 하트 아이콘을 클릭하면 좋아요/취소가 됩니다
- 빨간 하트는 좋아요 상태를 나타냅니다

### 기도 제목 작성
1. 우측 상단의 "기도 요청" 버튼을 클릭합니다
2. 제목과 내용을 작성합니다
3. (선택) 익명으로 게시할 수 있습니다
4. "기도 요청 올리기" 버튼을 클릭합니다

### 사용자 전환 (테스트용)
- 우측 상단의 드롭다운에서 다른 사용자를 선택할 수 있습니다
- 각 사용자별로 다른 좋아요 상태가 유지됩니다

## 🛠️ 개발 가이드

### 로컬 개발 환경 설정

```bash
# 의존성 설치
cd /home/user/webapp
npm install

# 데이터베이스 마이그레이션
npm run db:migrate:local

# 시드 데이터 추가
npm run db:seed

# 프로젝트 빌드
npm run build

# 개발 서버 시작
pm2 start ecosystem.config.cjs

# 서버 상태 확인
pm2 list

# 로그 확인
pm2 logs crossfriends --nostream

# 서버 재시작
fuser -k 3000/tcp 2>/dev/null || true
pm2 restart crossfriends

# 데이터베이스 리셋 (개발용)
npm run db:reset
```

### API 테스트

```bash
# 게시물 목록 조회
curl http://localhost:3000/api/posts

# 새 게시물 작성
curl -X POST http://localhost:3000/api/posts \
  -H "Content-Type: application/json" \
  -d '{"user_id": 1, "content": "테스트 게시물", "verse_reference": "요한복음 3:16"}'

# 기도 제목 조회
curl http://localhost:3000/api/prayers

# 좋아요 토글
curl -X POST http://localhost:3000/api/posts/1/like \
  -H "Content-Type: application/json" \
  -d '{"user_id": 1}'
```

### Git 커밋

```bash
cd /home/user/webapp
git add .
git commit -m "커밋 메시지"
```

## 🚀 배포

### Cloudflare Pages 배포 (프로덕션)

```bash
# 1. Cloudflare API 키 설정 (최초 1회)
# Deploy 탭에서 API 키를 설정하세요

# 2. 프로덕션 데이터베이스 생성 (최초 1회)
npx wrangler d1 create crossfriends-production
# 출력된 database_id를 wrangler.jsonc에 추가

# 3. 프로덕션 마이그레이션
npm run db:migrate:prod

# 4. Pages 프로젝트 생성 (최초 1회)
npx wrangler pages project create crossfriends --production-branch main

# 5. 배포
npm run deploy:prod

# 배포 URL: https://crossfriends.pages.dev
```

## 📝 프로젝트 구조

```
webapp/
├── src/
│   ├── index.tsx          # 메인 애플리케이션 (API + UI)
│   └── types.ts           # TypeScript 타입 정의
├── migrations/
│   └── 0001_initial_schema.sql  # 데이터베이스 스키마
├── public/                # 정적 파일 (없음 - CDN 사용)
├── dist/                  # 빌드 결과물
├── seed.sql              # 테스트 데이터
├── ecosystem.config.cjs   # PM2 설정
├── wrangler.jsonc        # Cloudflare 설정
├── package.json          # 프로젝트 설정
├── tsconfig.json         # TypeScript 설정
├── vite.config.ts        # Vite 빌드 설정
└── README.md             # 프로젝트 문서
```

## 🎨 UI 특징

- **TailwindCSS**: 유틸리티 기반 스타일링
- **FontAwesome**: 아이콘 라이브러리
- **반응형 디자인**: 모바일/데스크톱 대응
- **그라데이션 효과**: 기도 제목 섹션
- **인터랙티브 피드백**: 호버 효과, 트랜지션

## 📅 배포 상태
- **플랫폼**: Cloudflare Pages
- **상태**: ✅ 개발 서버 활성
- **마지막 업데이트**: 2026-01-19

## 🙏 기독교 특화 기능

### 성경 구절 참조
- 게시물에 성경 구절을 첨부할 수 있습니다
- 파란색 하이라이트로 강조 표시
- 성경 아이콘으로 시각적 구분

### 기도 제목
- 커뮤니티 기도 요청 기능
- 익명/실명 선택 가능
- 기도 응답 및 격려 메시지
- 상태 관리 (진행중/응답됨/종료)

### 교회 정보
- 사용자 프로필에 소속 교회 표시
- 교단 정보 저장
- 지역 기반 커뮤니티 형성

## 💡 다음 개발 단계

1. **인증 시스템**: 실제 로그인/회원가입 구현
2. **프로필 관리**: 사용자 프로필 편집 기능
3. **이미지 업로드**: Cloudflare R2 연동
4. **알림 시스템**: 실시간 알림 기능
5. **검색 기능**: 사용자/게시물 검색
6. **그룹 기능**: 교회별/관심사별 그룹

---

**Made with ❤️ for Christian Community**
