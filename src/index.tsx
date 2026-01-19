import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import type { Bindings, Post, Comment, User, PrayerRequest, PrayerResponse } from './types'

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS for API routes
app.use('/api/*', cors())

// Serve static files
app.use('/static/*', serveStatic({ root: './public' }))

// =====================
// API Routes - Users
// =====================

// Get all users
app.get('/api/users', async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare('SELECT id, email, name, bio, avatar_url, church, denomination, location, created_at FROM users ORDER BY created_at DESC').all()
  return c.json({ users: results })
})

// Get user by ID
app.get('/api/users/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const user = await DB.prepare('SELECT id, email, name, bio, avatar_url, church, pastor, denomination, location, position, gender, faith_answers, created_at FROM users WHERE id = ?').bind(id).first()
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }
  
  return c.json({ user })
})

// Create new user
app.post('/api/users', async (c) => {
  const { DB } = c.env
  const { email, name, bio, church, pastor, denomination, location, position, gender, faith_answers } = await c.req.json()
  
  const result = await DB.prepare(
    'INSERT INTO users (email, name, bio, church, pastor, denomination, location, position, gender, faith_answers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(email, name, bio || null, church || null, pastor || null, denomination || null, location || null, position || null, gender || null, faith_answers || null).run()
  
  return c.json({ id: result.meta.last_row_id, email, name }, 201)
})

// Update user
app.put('/api/users/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const { name, gender, church, pastor, position } = await c.req.json()
  
  await DB.prepare(
    'UPDATE users SET name = ?, gender = ?, church = ?, pastor = ?, position = ? WHERE id = ?'
  ).bind(name, gender || null, church || null, pastor || null, position || null, id).run()
  
  return c.json({ success: true })
})

// Upload avatar
app.post('/api/users/:id/avatar', async (c) => {
  const { DB, R2 } = c.env
  const userId = c.req.param('id')
  
  try {
    const formData = await c.req.formData()
    const file = formData.get('avatar')
    
    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file uploaded' }, 400)
    }
    
    // Check file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      return c.json({ error: 'File too large (max 5MB)' }, 400)
    }
    
    // Check file type
    if (!file.type.startsWith('image/')) {
      return c.json({ error: 'Invalid file type' }, 400)
    }
    
    // Generate unique filename
    const ext = file.name.split('.').pop()
    const filename = `${userId}-${Date.now()}.${ext}`
    const fullPath = `avatars/${filename}`
    
    // Upload to R2
    const arrayBuffer = await file.arrayBuffer()
    await R2.put(fullPath, arrayBuffer, {
      httpMetadata: {
        contentType: file.type
      }
    })
    
    // Update user avatar_url in database
    const avatarUrl = `/api/avatars/avatars/${filename}`
    await DB.prepare(
      'UPDATE users SET avatar_url = ? WHERE id = ?'
    ).bind(avatarUrl, userId).run()
    
    return c.json({ avatar_url: avatarUrl }, 200)
  } catch (error) {
    console.error('Avatar upload error:', error)
    return c.json({ error: 'Upload failed' }, 500)
  }
})

// Get avatar from R2
app.get('/api/avatars/avatars/:filename', async (c) => {
  const { R2 } = c.env
  const filename = c.req.param('filename')
  
  const object = await R2.get(`avatars/${filename}`)
  if (!object) {
    return c.notFound()
  }
  
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Cache-Control', 'public, max-age=31536000')
  
  return new Response(object.body, { headers })
})


// =====================
// API Routes - Posts
// =====================

// Get all posts with user info, likes count, and comments count
app.get('/api/posts', async (c) => {
  const { DB } = c.env
  const currentUserId = c.req.query('user_id') // For checking if current user liked the post
  
  const { results } = await DB.prepare(`
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
    ORDER BY p.created_at DESC
  `).bind(currentUserId || 0).all()
  
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
  const { user_id, content, image_url, verse_reference } = await c.req.json()
  
  const result = await DB.prepare(
    'INSERT INTO posts (user_id, content, image_url, verse_reference) VALUES (?, ?, ?, ?)'
  ).bind(user_id, content, image_url || null, verse_reference || null).run()
  
  return c.json({ id: result.meta.last_row_id, user_id, content }, 201)
})

// Delete post
app.delete('/api/posts/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
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
  
  const { results } = await DB.prepare(`
    SELECT 
      c.*,
      u.name as user_name,
      u.avatar_url as user_avatar
    FROM comments c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE c.post_id = ?
    ORDER BY c.created_at ASC
  `).bind(postId).all()
  
  return c.json({ comments: results })
})

// Create new comment
app.post('/api/posts/:id/comments', async (c) => {
  const { DB } = c.env
  const postId = c.req.param('id')
  const { user_id, content } = await c.req.json()
  
  const result = await DB.prepare(
    'INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)'
  ).bind(postId, user_id, content).run()
  
  return c.json({ id: result.meta.last_row_id, post_id: postId, user_id, content }, 201)
})

// =====================
// API Routes - Likes
// =====================

// Toggle like on a post
app.post('/api/posts/:id/like', async (c) => {
  const { DB } = c.env
  const postId = c.req.param('id')
  const { user_id } = await c.req.json()
  
  // Check if already liked
  const existing = await DB.prepare(
    'SELECT id FROM likes WHERE post_id = ? AND user_id = ?'
  ).bind(postId, user_id).first()
  
  if (existing) {
    // Unlike
    await DB.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').bind(postId, user_id).run()
    return c.json({ liked: false })
  } else {
    // Like
    await DB.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)').bind(postId, user_id).run()
    return c.json({ liked: true })
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
// Frontend Route
// =====================

app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>CROSSfriends - 기독교인 소셜 네트워크</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>
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
                background-color: #dc2626;
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
                background-color: #dc2626;
                border-radius: 50%;
            }
            .cross-dot.top { top: -2.5px; left: 50%; transform: translateX(-50%); }
            .cross-dot.bottom { bottom: -2.5px; left: 50%; transform: translateX(-50%); }
            .cross-dot.left { left: -2.5px; top: 50%; transform: translateY(-50%); }
            .cross-dot.right { right: -2.5px; top: 50%; transform: translateY(-50%); }
        </style>
    </head>
    <body class="bg-gray-50">
        <!-- Header -->
        <nav class="bg-white shadow-md sticky top-0 z-50">
            <div class="max-w-7xl mx-auto px-4 py-3">
                <div class="flex justify-between items-center">
                    <h1 class="text-2xl font-bold text-gray-800 flex items-center" style="font-family: 'Poppins', sans-serif; letter-spacing: -0.5px;">
                        <span>CROSS</span>
                        <div class="cross-icon mx-3">
                            <div class="cross-dot top"></div>
                            <div class="cross-dot bottom"></div>
                            <div class="cross-dot left"></div>
                            <div class="cross-dot right"></div>
                        </div>
                        <span>friends</span>
                    </h1>
                    <div class="flex items-center space-x-4" id="authButtons">
                        <button onclick="showLoginModal()" class="text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-100 transition">
                            로그인
                        </button>
                        <button onclick="showSignupModal()" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition">
                            회원가입
                        </button>
                    </div>
                    <div class="flex items-center space-x-4 hidden" id="userMenu">
                        <div class="flex items-center space-x-3 bg-gray-100 px-4 py-2 rounded-lg cursor-pointer hover:bg-gray-200 transition" onclick="showEditProfileModal()">
                            <div id="userAvatarContainer" class="w-8 h-8 rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white text-sm flex-shrink-0">
                                <i class="fas fa-user"></i>
                            </div>
                            <span id="userName" class="text-gray-800 font-medium whitespace-nowrap"></span>
                        </div>
                        <button onclick="logout()" class="text-gray-500 hover:text-gray-800" title="로그아웃">
                            <i class="fas fa-sign-out-alt"></i>
                        </button>
                    </div>
                </div>
            </div>
        </nav>

        <!-- Main Content -->
        <div class="max-w-7xl mx-auto px-4 py-6">
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <!-- Left Sidebar -->
                <div class="lg:col-span-1 space-y-4">
                    <div class="bg-white rounded-lg shadow p-6">
                        <h3 class="text-lg font-bold mb-4 text-gray-800">
                            <i class="fas fa-book-open text-blue-600 mr-2"></i>오늘의 성경 구절
                        </h3>
                        <div class="border-l-4 border-blue-600 pl-4 py-2">
                            <p class="font-bold text-blue-600 mb-2">요한복음 3:16</p>
                            <p class="text-gray-800 leading-relaxed">
                                하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니 이는 그를 믿는 자마다 멸망하지 않고 영생을 얻게 하려 하심이라
                            </p>
                        </div>
                    </div>
                </div>

                <!-- Main Feed -->
                <div class="lg:col-span-2 space-y-4">
                    <!-- New Post Card -->
                    <div class="bg-white rounded-lg shadow p-6">
                        <div class="flex items-start space-x-4">
                            <div class="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white">
                                <i class="fas fa-user"></i>
                            </div>
                            <div class="flex-1">
                                <textarea 
                                    id="newPostContent"
                                    placeholder="무엇을 나누고 싶으신가요?"
                                    class="w-full p-3 border rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    rows="3"
                                ></textarea>
                                <div class="mt-3 flex justify-end">
                                    <button 
                                        onclick="createPost()"
                                        class="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition">
                                        <i class="fas fa-paper-plane mr-2"></i>게시하기
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Posts Feed -->
                    <div id="postsFeed" class="space-y-4">
                        <!-- Posts will be loaded here -->
                    </div>
                </div>
            </div>
        </div>

        <!-- Signup Modal -->
        <div id="signupModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div class="bg-white rounded-lg shadow-xl p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-6 sticky top-0 bg-white z-10 pb-4">
                    <h2 class="text-2xl font-bold text-gray-800">
                        <i class="fas fa-user-plus text-blue-600 mr-2"></i>회원가입
                    </h2>
                    <button onclick="hideSignupModal()" class="text-gray-500 hover:text-gray-700">
                        <i class="fas fa-times text-xl"></i>
                    </button>
                </div>
                
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">이름</label>
                        <input 
                            id="signupName"
                            type="text"
                            placeholder="홍길동"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">성별</label>
                        <select 
                            id="signupGender"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none">
                            <option value="">선택하세요</option>
                            <option value="남성">남성</option>
                            <option value="여성">여성</option>
                        </select>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">이메일</label>
                        <input 
                            id="signupEmail"
                            type="email"
                            placeholder="email@example.com"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">프로필 사진</label>
                        <div class="flex items-center space-x-4">
                            <div id="avatarPreview" class="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
                                <i class="fas fa-user text-gray-400 text-2xl"></i>
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
                                    class="cursor-pointer inline-block px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition">
                                    <i class="fas fa-upload mr-2"></i>사진 선택
                                </label>
                                <p class="text-xs text-gray-500 mt-2">JPG, PNG (최대 5MB)</p>
                            </div>
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">교단</label>
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
                        <label class="block text-sm font-semibold text-gray-700 mb-2">소속 교회</label>
                        <input 
                            id="signupChurch"
                            type="text"
                            placeholder="예) 서울중앙교회"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">담임목사 이름</label>
                        <input 
                            id="signupPastor"
                            type="text"
                            placeholder="예) 김철수 목사"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">교회 위치</label>
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
                        <label class="block text-sm font-semibold text-gray-700 mb-2">교회 직분</label>
                        <select 
                            id="signupPosition"
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
                            <option value="새가족">새가족</option>
                            <option value="기타">기타</option>
                        </select>
                    </div>
                    
                    <!-- 신앙 고백 질문 섹션 -->
                    <div class="border-t pt-4 mt-6">
                        <h3 class="text-lg font-bold text-gray-800 mb-4">
                            <i class="fas fa-cross text-blue-600 mr-2"></i>신앙 고백
                        </h3>
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
                    </div>
                </div>
                
                <button 
                    onclick="handleSignup()"
                    class="w-full mt-6 bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition font-semibold">
                    회원가입 완료
                </button>
                
                <p class="mt-4 text-center text-sm text-gray-600">
                    이미 계정이 있으신가요? 
                    <button onclick="hideSignupModal(); showLoginModal();" class="text-blue-600 hover:underline">로그인</button>
                </p>
            </div>
        </div>

        <!-- Login Modal -->
        <div id="loginModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div class="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold text-gray-800">
                        <i class="fas fa-sign-in-alt text-blue-600 mr-2"></i>로그인
                    </h2>
                    <button onclick="hideLoginModal()" class="text-gray-500 hover:text-gray-700">
                        <i class="fas fa-times text-xl"></i>
                    </button>
                </div>
                
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">이메일</label>
                        <input 
                            id="loginEmail"
                            type="email"
                            placeholder="email@example.com"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                    </div>
                </div>
                
                <button 
                    onclick="handleLogin()"
                    class="w-full mt-6 bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition font-semibold">
                    로그인
                </button>
                
                <p class="mt-4 text-center text-sm text-gray-600">
                    계정이 없으신가요? 
                    <button onclick="hideLoginModal(); showSignupModal();" class="text-blue-600 hover:underline">회원가입</button>
                </p>
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
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">프로필 사진</label>
                        <div class="flex items-center space-x-4">
                            <div id="editAvatarPreview" class="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
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
                                <label 
                                    for="editAvatar"
                                    class="cursor-pointer inline-block px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition">
                                    <i class="fas fa-upload mr-2"></i>사진 변경
                                </label>
                                <p class="text-xs text-gray-500 mt-2">JPG, PNG (최대 5MB)</p>
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
                            <option value="새가족">새가족</option>
                            <option value="기타">기타</option>
                        </select>
                    </div>
                </div>
                
                <button 
                    onclick="handleEditProfile()"
                    class="w-full mt-6 bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition font-semibold">
                    저장하기
                </button>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
            let currentUserId = null;
            let currentUser = null;

            // Location data
            // 도 → 시 2단계 교회 위치 데이터
            const locationData = {
                '서울특별시': ['강남구', '강동구', '강북구', '강서구', '관악구', '광진구', '구로구', '금천구', '노원구', '도봉구', '동대문구', '동작구', '마포구', '서대문구', '서초구', '성동구', '성북구', '송파구', '양천구', '영등포구', '용산구', '은평구', '종로구', '중구', '중랑구'],
                '부산광역시': ['강서구', '금정구', '기장군', '남구', '동구', '동래구', '부산진구', '북구', '사상구', '사하구', '서구', '수영구', '연제구', '영도구', '중구', '해운대구'],
                '대구광역시': ['남구', '달서구', '달성군', '동구', '북구', '서구', '수성구', '중구'],
                '인천광역시': ['강화군', '계양구', '남동구', '동구', '미추홀구', '부평구', '서구', '연수구', '옹진군', '중구'],
                '광주광역시': ['광산구', '남구', '동구', '북구', '서구'],
                '대전광역시': ['대덕구', '동구', '서구', '유성구', '중구'],
                '울산광역시': ['남구', '동구', '북구', '울주군', '중구'],
                '세종특별자치시': ['세종특별자치시'],
                '경기도': ['가평군', '고양시', '과천시', '광명시', '광주시', '구리시', '군포시', '김포시', '남양주시', '동두천시', '부천시', '성남시', '수원시', '시흥시', '안san시', '안성시', '안양시', '양주시', '양평군', '여주시', '연천군', '오산시', '용인시', '의왕시', '의정부시', '이천시', '파주시', '평택시', '포천시', '하남시', '화성시'],
                '강원특별자치도': ['강릉시', '고성군', '동해시', '삼척시', '속초시', '양구군', '양양군', '영월군', '원주시', '인제군', '정선군', '철원군', '춘천시', '태백시', '평창군', '홍천군', '화천군', '횡성군'],
                '충청북도': ['괴산군', '단양군', '보은군', '영동군', '옥천군', '음성군', '제천시', '증평군', '진천군', '청주시', '충주시'],
                '충청남도': ['계룡시', '공주시', '금산군', '논산시', '당진시', '보령시', '부여군', '서산시', '서천군', '아산시', '예산군', '천안시', '청양군', '태안군', '홍성군'],
                '전북특별자치도': ['고창군', '군산시', '김제시', '남원시', '무주군', '부안군', '순창군', '완주군', '익산시', '임실군', '장수군', '전주시', '정읍시', '진안군'],
                '전라남도': ['강진군', '고흥군', '곡성군', '광양시', '구례군', '나주시', '담양군', '목포시', '무안군', '보성군', '순천시', '신안군', '여수시', '영광군', '영암군', '완도군', '장성군', '장흥군', '진도군', '함평군', '해남군', '화순군'],
                '경상북도': ['경산시', '경주시', '고령군', '구미시', '군위군', '김천시', '문경시', '봉화군', '상주시', '성주군', '안동시', '영덕군', '영양군', '영주시', '영천시', '예천군', '울릉군', '울진군', '의성군', '청도군', '청송군', '칠곡군', '포항시'],
                '경상남도': ['거제시', '거창군', '고성군', '김해시', '남해군', '밀양시', '사천시', '산청군', '양산시', '의령군', '진주시', '창녕군', '창원시', '통영시', '하동군', '함안군', '함양군', '합천군'],
                '제주특별자치도': ['서귀포시', '제주시']
            };

            // Update cities based on province selection
            // Update cities based on province selection (도→시 2단계)
            function updateCities() {
                const province = document.getElementById('signupProvince').value;
                const citySelect = document.getElementById('signupCity');
                
                // Reset city dropdown
                citySelect.innerHTML = '<option value="">시/군/구 선택</option>';
                
                if (province && locationData[province]) {
                    const cities = locationData[province];
                    cities.forEach(city => {
                        const option = document.createElement('option');
                        option.value = city;
                        option.textContent = city;
                        citySelect.appendChild(option);
                    });
                    citySelect.disabled = false;
                } else {
                    citySelect.disabled = true;
                }
            }

            // Avatar preview
            function previewAvatar(event) {
                const file = event.target.files[0];
                if (file) {
                    // Check file size (5MB limit)
                    if (file.size > 5 * 1024 * 1024) {
                        alert('파일 크기는 5MB를 초과할 수 없습니다.');
                        event.target.value = '';
                        return;
                    }
                    
                    // Preview image
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        const preview = document.getElementById('avatarPreview');
                        preview.innerHTML = '<img src="' + e.target.result + '" class="w-full h-full object-cover" />';
                    };
                    reader.readAsDataURL(file);
                }
            }

            // Modal functions
            function showSignupModal() {
                document.getElementById('signupModal').classList.remove('hidden');
            }

            function hideSignupModal() {
                document.getElementById('signupModal').classList.add('hidden');
                // Clear form
                document.getElementById('signupEmail').value = '';
                document.getElementById('signupName').value = '';
                document.getElementById('signupChurch').value = '';
                document.getElementById('signupPastor').value = '';
                document.getElementById('signupDenomination').value = '';
                document.getElementById('signupProvince').value = '';
                document.getElementById('signupCity').value = '';
                document.getElementById('signupGender').value = '';
                document.getElementById('signupPosition').value = '';
                document.getElementById('signupAvatar').value = '';
                // Clear faith answers
                for (let i = 1; i <= 10; i++) {
                    document.getElementById('faith_q' + i).value = '';
                }
                // Reset avatar preview
                document.getElementById('avatarPreview').innerHTML = '<i class="fas fa-user text-gray-400 text-2xl"></i>';
            }

            function showLoginModal() {
                document.getElementById('loginModal').classList.remove('hidden');
            }

            function hideLoginModal() {
                document.getElementById('loginModal').classList.add('hidden');
                document.getElementById('loginEmail').value = '';
            }

            // Edit Profile Modal functions
            function showEditProfileModal() {
                if (!currentUser) return;
                
                document.getElementById('editProfileModal').classList.remove('hidden');
                
                // Populate form with current user data
                document.getElementById('editEmail').value = currentUser.email || '';
                document.getElementById('editName').value = currentUser.name || '';
                document.getElementById('editGender').value = currentUser.gender || '';
                document.getElementById('editChurch').value = currentUser.church || '';
                document.getElementById('editPastor').value = currentUser.pastor || '';
                document.getElementById('editPosition').value = currentUser.position || '';
                
                // Show current avatar
                const editAvatarPreview = document.getElementById('editAvatarPreview');
                if (currentUser.avatar_url) {
                    editAvatarPreview.innerHTML = '<img src="' + currentUser.avatar_url + '" class="w-full h-full object-cover" />';
                } else {
                    editAvatarPreview.innerHTML = '<i class="fas fa-user text-gray-400 text-2xl"></i>';
                }
            }

            function hideEditProfileModal() {
                document.getElementById('editProfileModal').classList.add('hidden');
                document.getElementById('editAvatar').value = '';
            }

            function previewEditAvatar(event) {
                const file = event.target.files[0];
                if (file) {
                    if (file.size > 5 * 1024 * 1024) {
                        alert('파일 크기는 5MB를 초과할 수 없습니다.');
                        event.target.value = '';
                        return;
                    }
                    
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        const preview = document.getElementById('editAvatarPreview');
                        preview.innerHTML = '<img src="' + e.target.result + '" class="w-full h-full object-cover" />';
                    };
                    reader.readAsDataURL(file);
                }
            }

            async function handleEditProfile() {
                const name = document.getElementById('editName').value;
                const gender = document.getElementById('editGender').value;
                const church = document.getElementById('editChurch').value;
                const pastor = document.getElementById('editPastor').value;
                const position = document.getElementById('editPosition').value;
                const avatarFile = document.getElementById('editAvatar').files[0];

                if (!name || !gender || !church || !pastor || !position) {
                    alert('모든 항목을 입력해주세요.');
                    return;
                }

                try {
                    // Update user info (except avatar)
                    await axios.put('/api/users/' + currentUserId, {
                        name,
                        gender,
                        church,
                        pastor,
                        position
                    });

                    // Upload new avatar if selected
                    if (avatarFile) {
                        const formData = new FormData();
                        formData.append('avatar', avatarFile);
                        
                        try {
                            await axios.post('/api/users/' + currentUserId + '/avatar', formData, {
                                headers: { 'Content-Type': 'multipart/form-data' }
                            });
                        } catch (uploadError) {
                            console.error('Avatar upload error:', uploadError);
                        }
                    }

                    // Refresh user data
                    const userResponse = await axios.get('/api/users/' + currentUserId);
                    currentUser = userResponse.data.user;
                    updateAuthUI();
                    
                    alert('회원정보가 수정되었습니다! 👍');
                    hideEditProfileModal();
                    loadPosts();
                } catch (error) {
                    console.error('Edit profile error:', error);
                    alert('회원정보 수정에 실패했습니다. 다시 시도해주세요.');
                }
            }


            // Signup handler
            async function handleSignup() {
                const email = document.getElementById('signupEmail').value;
                const name = document.getElementById('signupName').value;
                const church = document.getElementById('signupChurch').value;
                const pastor = document.getElementById('signupPastor').value;
                const denomination = document.getElementById('signupDenomination').value;
                const province = document.getElementById('signupProvince').value;
                const city = document.getElementById('signupCity').value;
                const gender = document.getElementById('signupGender').value;
                const position = document.getElementById('signupPosition').value;
                const avatarFile = document.getElementById('signupAvatar').files[0];
                
                // 신앙 고백 답변 수집
                const faithAnswers = {
                    q1: document.getElementById('faith_q1').value,
                    q2: document.getElementById('faith_q2').value,
                    q3: document.getElementById('faith_q3').value,
                    q4: document.getElementById('faith_q4').value,
                    q5: document.getElementById('faith_q5').value,
                    q6: document.getElementById('faith_q6').value,
                    q7: document.getElementById('faith_q7').value,
                    q8: document.getElementById('faith_q8').value,
                    q9: document.getElementById('faith_q9').value,
                    q10: document.getElementById('faith_q10').value
                };

                // 도→시 2단계 모두 선택 확인 (성별 포함)
                if (!email || !name || !church || !pastor || !denomination || !province || !city || !gender || !position) {
                    alert('모든 기본 정보를 입력해주세요.');
                    return;
                }
                
                // 신앙 고백 답변 확인
                for (let i = 1; i <= 10; i++) {
                    if (!faithAnswers['q' + i]) {
                        alert('모든 신앙 고백 질문에 답변해주세요.');
                        return;
                    }
                }

                // Email validation
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(email)) {
                    alert('올바른 이메일 형식을 입력해주세요.');
                    return;
                }

                // 교회 위치 조합: 도 + 시
                const location = province + ' ' + city;

                try {
                    // 1. Create user
                    const response = await axios.post('/api/users', {
                        email,
                        name,
                        church,
                        pastor,
                        denomination,
                        location,
                        position,
                        gender,
                        faith_answers: JSON.stringify(faithAnswers)
                    });

                    const newUserId = response.data.id;

                    // 2. Upload avatar if selected
                    if (avatarFile) {
                        const formData = new FormData();
                        formData.append('avatar', avatarFile);
                        
                        try {
                            await axios.post('/api/users/' + newUserId + '/avatar', formData, {
                                headers: { 'Content-Type': 'multipart/form-data' }
                            });
                        } catch (uploadError) {
                            console.error('Avatar upload error:', uploadError);
                            // Continue even if avatar upload fails
                        }
                    }

                    alert('회원가입이 완료되었습니다! 환영합니다! 🎉');
                    hideSignupModal();
                    
                    // Auto login - Fetch complete user info
                    const userResponse = await axios.get('/api/users/' + newUserId);
                    currentUserId = newUserId;
                    currentUser = userResponse.data.user;
                    updateAuthUI();
                    loadPosts();
                } catch (error) {
                    console.error('Signup error:', error);
                    if (error.response && error.response.status === 500) {
                        alert('이미 가입된 이메일입니다.');
                    } else {
                        alert('회원가입에 실패했습니다. 다시 시도해주세요.');
                    }
                }
            }

            // Login handler
            async function handleLogin() {
                const email = document.getElementById('loginEmail').value;

                if (!email) {
                    alert('이메일을 입력해주세요.');
                    return;
                }

                try {
                    // Find user by email
                    const response = await axios.get('/api/users');
                    const user = response.data.users.find(u => u.email === email);

                    if (user) {
                        currentUserId = user.id;
                        currentUser = user;
                        updateAuthUI();
                        hideLoginModal();
                        loadPosts();
                        alert(\`환영합니다, \${user.name}님! 😊\`);
                    } else {
                        alert('가입되지 않은 이메일입니다. 회원가입을 먼저 해주세요.');
                    }
                } catch (error) {
                    console.error('Login error:', error);
                    alert('로그인에 실패했습니다.');
                }
            }

            // Logout
            function logout() {
                currentUserId = null;
                currentUser = null;
                updateAuthUI();
                document.getElementById('postsFeed').innerHTML = '<div class="text-center text-gray-500 py-10">로그인하여 게시물을 확인하세요</div>';
            }

            // Update UI based on auth state
            function updateAuthUI() {
                const authButtons = document.getElementById('authButtons');
                const userMenu = document.getElementById('userMenu');
                const userName = document.getElementById('userName');
                const userAvatarContainer = document.getElementById('userAvatarContainer');

                if (currentUserId) {
                    authButtons.classList.add('hidden');
                    userMenu.classList.remove('hidden');
                    
                    // Update user name
                    userName.textContent = currentUser.name;
                    
                    // Update user avatar
                    if (currentUser.avatar_url) {
                        // Create image element with proper error handling
                        const img = document.createElement('img');
                        img.src = currentUser.avatar_url;
                        img.alt = 'Profile';
                        img.className = 'w-full h-full object-cover';
                        img.onerror = function() {
                            // If image fails to load, show default icon
                            userAvatarContainer.innerHTML = '<i class="fas fa-user"></i>';
                        };
                        userAvatarContainer.innerHTML = '';
                        userAvatarContainer.appendChild(img);
                    } else {
                        userAvatarContainer.innerHTML = '<i class="fas fa-user"></i>';
                    }
                } else {
                    authButtons.classList.remove('hidden');
                    userMenu.classList.add('hidden');
                }
            }

            // Create new post
            async function createPost() {
                if (!currentUserId) {
                    alert('로그인이 필요합니다.');
                    showLoginModal();
                    return;
                }

                const content = document.getElementById('newPostContent').value;

                if (!content) {
                    alert('내용을 입력해주세요.');
                    return;
                }

                try {
                    await axios.post('/api/posts', {
                        user_id: currentUserId,
                        content,
                        verse_reference: null
                    });
                    document.getElementById('newPostContent').value = '';
                    loadPosts();
                } catch (error) {
                    console.error('Error creating post:', error);
                    alert('게시물 작성에 실패했습니다.');
                }
            }

            // Toggle like
            async function toggleLike(postId) {
                try {
                    const response = await axios.post(\`/api/posts/\${postId}/like\`, {
                        user_id: currentUserId
                    });
                    loadPosts();
                } catch (error) {
                    console.error('Error toggling like:', error);
                }
            }

            // Load comments
            async function loadComments(postId) {
                const commentsDiv = document.getElementById(\`comments-\${postId}\`);
                if (commentsDiv.classList.contains('hidden')) {
                    try {
                        const response = await axios.get(\`/api/posts/\${postId}/comments\`);
                        const comments = response.data.comments;
                        
                        let html = '<div class="mt-4 space-y-3 pl-4 border-l-2 border-gray-200">';
                        comments.forEach(comment => {
                            html += \`
                                <div class="flex space-x-3">
                                    <div class="w-8 h-8 bg-gray-400 rounded-full flex items-center justify-center text-white text-sm">
                                        <i class="fas fa-user"></i>
                                    </div>
                                    <div class="flex-1">
                                        <div class="bg-gray-50 rounded-lg p-3">
                                            <p class="font-semibold text-sm text-gray-800">\${comment.user_name}</p>
                                            <p class="text-sm text-gray-700 mt-1">\${comment.content}</p>
                                        </div>
                                        <p class="text-xs text-gray-500 mt-1">\${formatDate(comment.created_at)}</p>
                                    </div>
                                </div>
                            \`;
                        });
                        
                        html += \`
                            <div class="flex space-x-2 mt-3">
                                <input 
                                    id="comment-input-\${postId}"
                                    type="text"
                                    placeholder="댓글을 작성하세요..."
                                    class="flex-1 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none"
                                />
                                <button 
                                    id="comment-submit-\${postId}"
                                    class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm">
                                    <i class="fas fa-paper-plane"></i>
                                </button>
                            </div>
                        </div>
                        \`;
                        
                        commentsDiv.innerHTML = html;
                        commentsDiv.classList.remove('hidden');
                        
                        // Add event listeners after HTML is inserted
                        const submitBtn = document.getElementById(\`comment-submit-\${postId}\`);
                        const inputField = document.getElementById(\`comment-input-\${postId}\`);
                        
                        if (submitBtn) {
                            submitBtn.addEventListener('click', () => createComment(postId));
                        }
                        
                        if (inputField) {
                            inputField.addEventListener('keypress', (e) => {
                                if (e.key === 'Enter') createComment(postId);
                            });
                        }
                    } catch (error) {
                        console.error('Error loading comments:', error);
                    }
                } else {
                    commentsDiv.classList.add('hidden');
                }
            }

            // Create comment
            async function createComment(postId) {
                const input = document.getElementById(\`comment-input-\${postId}\`);
                const content = input.value;

                if (!content) {
                    alert('댓글 내용을 입력해주세요.');
                    return;
                }

                try {
                    await axios.post(\`/api/posts/\${postId}/comments\`, {
                        user_id: currentUserId,
                        content
                    });
                    input.value = '';
                    loadComments(postId);
                    loadPosts();
                } catch (error) {
                    console.error('Error creating comment:', error);
                    alert('댓글 작성에 실패했습니다.');
                }
            }

            // Load posts
            async function loadPosts() {
                try {
                    const response = await axios.get(\`/api/posts?user_id=\${currentUserId}\`);
                    const posts = response.data.posts;
                    const feed = document.getElementById('postsFeed');
                    
                    let html = '';
                    posts.forEach(post => {
                        const isLiked = post.is_liked > 0;
                        html += \`
                            <div class="bg-white rounded-lg shadow p-6">
                                <div class="flex items-start space-x-4">
                                    <div class="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white">
                                        <i class="fas fa-user"></i>
                                    </div>
                                    <div class="flex-1">
                                        <div class="flex justify-between items-start">
                                            <div>
                                                <h4 class="font-bold text-gray-800">\${post.user_name}</h4>
                                                <p class="text-sm text-gray-500">\${post.user_church || ''}</p>
                                            </div>
                                            <p class="text-xs text-gray-500">\${formatDate(post.created_at)}</p>
                                        </div>
                                        <p class="mt-3 text-gray-800 whitespace-pre-wrap">\${post.content}</p>
                                        \${post.verse_reference ? \`
                                            <div class="mt-3 bg-gray-50 border-l-4 border-blue-600 p-3 rounded">
                                                <p class="text-sm text-blue-600 font-semibold">
                                                    <i class="fas fa-bible mr-2"></i>\${post.verse_reference}
                                                </p>
                                            </div>
                                        \` : ''}
                                        <div class="mt-4 flex items-center space-x-6 text-gray-600">
                                            <button onclick="toggleLike(\${post.id})" class="flex items-center space-x-2 hover:text-red-600 transition">
                                                <i class="fas fa-heart \${isLiked ? 'text-red-600' : ''} text-lg"></i>
                                                <span class="text-sm">\${post.likes_count || 0}</span>
                                            </button>
                                            <button onclick="loadComments(\${post.id})" class="flex items-center space-x-2 hover:text-blue-600 transition">
                                                <i class="fas fa-comment text-lg"></i>
                                                <span class="text-sm">\${post.comments_count || 0}</span>
                                            </button>
                                            <button class="flex items-center space-x-2 hover:text-blue-600 transition">
                                                <i class="fas fa-share text-lg"></i>
                                                <span class="text-sm">공유</span>
                                            </button>
                                        </div>
                                        <div id="comments-\${post.id}" class="hidden"></div>
                                    </div>
                                </div>
                            </div>
                        \`;
                    });
                    
                    feed.innerHTML = html;
                } catch (error) {
                    console.error('Error loading posts:', error);
                }
            }

            // Format date
            function formatDate(dateString) {
                const date = new Date(dateString);
                const now = new Date();
                const diff = Math.floor((now - date) / 1000); // seconds

                if (diff < 60) return '방금 전';
                if (diff < 3600) return \`\${Math.floor(diff / 60)}분 전\`;
                if (diff < 86400) return \`\${Math.floor(diff / 3600)}시간 전\`;
                if (diff < 604800) return \`\${Math.floor(diff / 86400)}일 전\`;
                
                return date.toLocaleDateString('ko-KR');
            }

            // Initialize
            updateAuthUI();
            // Don't load posts initially - user needs to login first
        </script>
    </body>
    </html>
  `)
})

export default app
