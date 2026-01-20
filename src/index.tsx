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
  const { results } = await DB.prepare('SELECT id, email, name, bio, avatar_url, church, denomination, location, role, created_at FROM users ORDER BY created_at DESC').all()
  return c.json({ users: results })
})

// Get user by ID
app.get('/api/users/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const user = await DB.prepare('SELECT id, email, name, bio, avatar_url, church, pastor, denomination, location, position, gender, faith_answers, role, created_at FROM users WHERE id = ?').bind(id).first()
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }
  
  return c.json({ user })
})

// Create new user
app.post('/api/users', async (c) => {
  const { DB } = c.env
  const { email, name, bio, church, pastor, denomination, location, position, gender, faith_answers } = await c.req.json()
  
  // Check if this is the first user (will become admin)
  const userCountResult = await DB.prepare('SELECT COUNT(*) as count FROM users').first()
  const userCount = userCountResult?.count || 0
  const role = userCount === 0 ? 'admin' : 'user'
  
  const result = await DB.prepare(
    'INSERT INTO users (email, name, bio, church, pastor, denomination, location, position, gender, faith_answers, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(email, name, bio || null, church || null, pastor || null, denomination || null, location || null, position || null, gender || null, faith_answers || null, role).run()
  
  return c.json({ id: result.meta.last_row_id, email, name, role }, 201)
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
      u.role as user_role,
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
      u.avatar_url as user_avatar,
      u.role as user_role
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

// Admin: Get all users with statistics
app.get('/api/admin/users', requireAdmin, async (c) => {
  const { DB } = c.env
  const { results } = await DB.prepare(`
    SELECT 
      u.id, u.email, u.name, u.church, u.denomination, u.location, u.role, u.created_at,
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

// Admin: Delete user
app.delete('/api/admin/users/:id', requireAdmin, async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
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

// Admin: Get statistics
app.get('/api/admin/stats', requireAdmin, async (c) => {
  const { DB } = c.env
  
  const userCount = await DB.prepare('SELECT COUNT(*) as count FROM users').first()
  const postCount = await DB.prepare('SELECT COUNT(*) as count FROM posts').first()
  const commentCount = await DB.prepare('SELECT COUNT(*) as count FROM comments').first()
  const prayerCount = await DB.prepare('SELECT COUNT(*) as count FROM prayer_requests').first()
  
  return c.json({
    users: userCount?.count || 0,
    posts: postCount?.count || 0,
    comments: commentCount?.count || 0,
    prayers: prayerCount?.count || 0
  })
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
                        <button onclick="goToAdmin()" id="adminPanelBtn" class="hidden text-red-600 hover:text-red-800 px-3 py-2 rounded-lg hover:bg-red-50 transition" title="관리자 패널">
                            <i class="fas fa-shield-alt mr-1"></i>
                            <span class="hidden md:inline">관리자 모드</span>
                        </button>
                        <div class="flex items-center space-x-3 bg-gray-100 px-4 py-2 rounded-lg cursor-pointer hover:bg-gray-200 transition" onclick="showEditProfileModal()">
                            <div class="admin-badge-container">
                                <div id="userAvatarContainer" class="w-8 h-8 rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white text-sm flex-shrink-0">
                                    <i class="fas fa-user"></i>
                                </div>
                                <!-- Admin/Moderator badge will be added here dynamically -->
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
                            <div class="admin-badge-container">
                                <div id="newPostAvatar" class="w-10 h-10 rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white flex-shrink-0">
                                    <i class="fas fa-user"></i>
                                </div>
                                <!-- Badge will be added here dynamically -->
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
                            list="emailHistory"
                            autocomplete="email"
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
                            list="emailHistory"
                            autocomplete="email"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                        <datalist id="emailHistory">
                            <!-- Email suggestions will be loaded here -->
                        </datalist>
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

            // Email History Management
            function loadEmailHistory() {
                const history = localStorage.getItem('emailHistory');
                return history ? JSON.parse(history) : [];
            }

            function saveEmailToHistory(email) {
                let history = loadEmailHistory();
                
                // Add email to history if not already present
                if (!history.includes(email)) {
                    history.unshift(email); // Add to beginning
                    
                    // Keep only last 10 emails
                    if (history.length > 10) {
                        history = history.slice(0, 10);
                    }
                    
                    localStorage.setItem('emailHistory', JSON.stringify(history));
                }
                
                // Update datalist
                updateEmailDatalist();
            }

            function updateEmailDatalist() {
                const history = loadEmailHistory();
                const datalist = document.getElementById('emailHistory');
                
                if (datalist) {
                    datalist.innerHTML = '';
                    history.forEach(email => {
                        const option = document.createElement('option');
                        option.value = email;
                        datalist.appendChild(option);
                    });
                }
            }

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
                    
                    // Save email to history
                    saveEmailToHistory(email);
                    
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

                // Trim whitespace
                const trimmedEmail = email.trim();

                if (!trimmedEmail) {
                    alert('이메일을 입력해주세요.');
                    return;
                }

                console.log('로그인 시도:', trimmedEmail);

                try {
                    // Find user by email
                    const response = await axios.get('/api/users');
                    console.log('사용자 목록 조회 성공:', response.data.users.length, '명');
                    
                    const user = response.data.users.find(u => u.email.toLowerCase() === trimmedEmail.toLowerCase());

                    if (user) {
                        console.log('사용자 찾음:', user);
                        currentUserId = user.id;
                        currentUser = user;
                        
                        // Save email to history
                        saveEmailToHistory(trimmedEmail);
                        
                        updateAuthUI();
                        hideLoginModal();
                        loadPosts();
                        alert(\`환영합니다, \${user.name}님! 😊\`);
                    } else {
                        console.log('사용자를 찾을 수 없음. 입력된 이메일:', trimmedEmail);
                        console.log('등록된 이메일 목록:', response.data.users.map(u => u.email));
                        alert('가입되지 않은 이메일입니다. 회원가입을 먼저 해주세요.');
                    }
                } catch (error) {
                    console.error('Login error:', error);
                    alert('로그인에 실패했습니다. 콘솔을 확인해주세요.');
                }
            }

            // Logout
            function logout() {
                currentUserId = null;
                currentUser = null;
                localStorage.removeItem('currentUserId');
                localStorage.removeItem('currentUser');
                updateAuthUI();
                document.getElementById('postsFeed').innerHTML = '<div class="text-center text-gray-500 py-10">로그인하여 게시물을 확인하세요</div>';
            }

            // Go to admin panel
            function goToAdmin() {
                window.location.href = '/admin';
            }

            // Update UI based on auth state
            function updateAuthUI() {
                const authButtons = document.getElementById('authButtons');
                const userMenu = document.getElementById('userMenu');
                const userName = document.getElementById('userName');
                const userAvatarContainer = document.getElementById('userAvatarContainer');
                const newPostAvatar = document.getElementById('newPostAvatar');
                const adminPanelBtn = document.getElementById('adminPanelBtn');

                if (currentUserId) {
                    authButtons.classList.add('hidden');
                    userMenu.classList.remove('hidden');
                    
                    // Update user name
                    userName.textContent = currentUser.name;
                    
                    // Show admin panel button if user is admin
                    if (currentUser.role === 'admin') {
                        adminPanelBtn.classList.remove('hidden');
                    } else {
                        adminPanelBtn.classList.add('hidden');
                    }
                    
                    // Save to localStorage for admin panel access
                    localStorage.setItem('currentUserId', currentUserId);
                    localStorage.setItem('currentUser', JSON.stringify(currentUser));
                    
                    // Update user avatar in header
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
                        
                        // Update new post avatar
                        const postImg = document.createElement('img');
                        postImg.src = currentUser.avatar_url;
                        postImg.alt = 'Profile';
                        postImg.className = 'w-full h-full object-cover';
                        postImg.onerror = function() {
                            newPostAvatar.innerHTML = '<i class="fas fa-user"></i>';
                        };
                        newPostAvatar.innerHTML = '';
                        newPostAvatar.appendChild(postImg);
                    } else {
                        userAvatarContainer.innerHTML = '<i class="fas fa-user"></i>';
                        newPostAvatar.innerHTML = '<i class="fas fa-user"></i>';
                    }
                    
                    // Add role badge
                    addRoleBadge(userAvatarContainer.parentElement, currentUser.role);
                    addRoleBadge(newPostAvatar.parentElement, currentUser.role);
                } else {
                    authButtons.classList.remove('hidden');
                    userMenu.classList.add('hidden');
                }
            }
            
            // Add role badge to avatar container
            function addRoleBadge(container, role) {
                if (!container) return;
                
                // Remove existing badge
                const existingBadge = container.querySelector('.admin-badge-crown, .admin-badge, .moderator-badge');
                if (existingBadge) {
                    existingBadge.remove();
                }
                
                if (role === 'admin') {
                    const badge = document.createElement('div');
                    badge.className = 'admin-badge-crown';
                    badge.innerHTML = '<i class="fas fa-crown"></i>';
                    badge.title = '관리자';
                    container.appendChild(badge);
                } else if (role === 'moderator') {
                    const badge = document.createElement('div');
                    badge.className = 'moderator-badge';
                    badge.innerHTML = '<i class="fas fa-shield-alt"></i>';
                    badge.title = '운영자';
                    container.appendChild(badge);
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

            // Delete post (Admin only)
            async function deletePost(postId) {
                if (!currentUser || currentUser.role !== 'admin') {
                    alert('권한이 없습니다.');
                    return;
                }

                if (!confirm('정말로 이 게시물을 삭제하시겠습니까?')) {
                    return;
                }

                try {
                    await axios.delete(\`/api/posts/\${postId}\`);
                    alert('게시물이 삭제되었습니다.');
                    loadPosts();
                } catch (error) {
                    console.error('Error deleting post:', error);
                    alert('게시물 삭제에 실패했습니다.');
                }
            }

            // Load comments
            async function loadComments(postId) {
                const commentsDiv = document.getElementById(\`comments-\${postId}\`);
                if (commentsDiv.classList.contains('hidden')) {
                    try {
                        const response = await axios.get(\`/api/posts/\${postId}/comments\`);
                        const comments = response.data.comments;
                        
                        let commentsHtml = '';
                        comments.forEach(comment => {
                            const avatarHtml = comment.user_avatar 
                                ? \`<img src="\${comment.user_avatar}" alt="Profile" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=&quot;fas fa-user&quot;></i>'" />\`
                                : '<i class="fas fa-user"></i>';
                            
                            // Role badge for comments
                            let roleBadgeHtml = '';
                            if (comment.user_role === 'admin') {
                                roleBadgeHtml = '<div class="admin-badge-crown" title="관리자"><i class="fas fa-crown"></i></div>';
                            } else if (comment.user_role === 'moderator') {
                                roleBadgeHtml = '<div class="moderator-badge" title="운영자"><i class="fas fa-shield-alt"></i></div>';
                            }
                            
                            commentsHtml += \`
                                <div class="flex space-x-3">
                                    <div class="admin-badge-container">
                                        <div class="w-8 h-8 rounded-full overflow-hidden bg-gray-400 flex items-center justify-center text-white text-sm flex-shrink-0">\${avatarHtml}</div>
                                        \${roleBadgeHtml}
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
                        
                        const html = \`
                            <div class="mt-4 space-y-3 pl-4 border-l-2 border-gray-200">
                                \${commentsHtml}
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
                    
                    let postsHtml = '';
                    posts.forEach(post => {
                        const isLiked = post.is_liked > 0;
                        const avatarHtml = post.user_avatar 
                            ? \`<img src="\${post.user_avatar}" alt="Profile" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=&quot;fas fa-user&quot;></i>'" />\`
                            : '<i class="fas fa-user"></i>';
                        
                        // Role badge HTML
                        let roleBadgeHtml = '';
                        if (post.user_role === 'admin') {
                            roleBadgeHtml = '<div class="admin-badge-crown" title="관리자"><i class="fas fa-crown"></i></div>';
                        } else if (post.user_role === 'moderator') {
                            roleBadgeHtml = '<div class="moderator-badge" title="운영자"><i class="fas fa-shield-alt"></i></div>';
                        }
                        
                        const verseHtml = post.verse_reference ? \`
                            <div class="mt-3 bg-gray-50 border-l-4 border-blue-600 p-3 rounded">
                                <p class="text-sm text-blue-600 font-semibold">
                                    <i class="fas fa-bible mr-2"></i>\${post.verse_reference}
                                </p>
                            </div>
                        \` : '';
                        
                        postsHtml += \`
                            <div class="bg-white rounded-lg shadow p-6">
                                <div class="flex items-start space-x-4">
                                    <div class="admin-badge-container">
                                        <div class="w-12 h-12 rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white flex-shrink-0">\${avatarHtml}</div>
                                        \${roleBadgeHtml}
                                    </div>
                                    <div class="flex-1">
                                        <div class="flex justify-between items-start">
                                            <div>
                                                <h4 class="font-bold text-gray-800">\${post.user_name}</h4>
                                                <p class="text-sm text-gray-500">\${post.user_church || ''}</p>
                                            </div>
                                            <div class="flex items-center space-x-2">
                                                <p class="text-xs text-gray-500">\${formatDate(post.created_at)}</p>
                                                \${currentUser && currentUser.role === 'admin' ? \`
                                                    <button 
                                                        onclick="deletePost(\${post.id})" 
                                                        class="text-red-500 hover:text-red-700 transition ml-2" 
                                                        title="게시물 삭제">
                                                        <i class="fas fa-trash-alt text-sm"></i>
                                                    </button>
                                                \` : ''}
                                            </div>
                                        </div>
                                        <p class="mt-3 text-gray-800 whitespace-pre-wrap">\${post.content}</p>
                                        \${verseHtml}
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
                    
                    feed.innerHTML = postsHtml;
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

            // Auto-login from localStorage
            async function autoLogin() {
                const savedUserId = localStorage.getItem('currentUserId');
                const savedUser = localStorage.getItem('currentUser');
                
                if (savedUserId && savedUser) {
                    try {
                        // Verify user still exists in database
                        const response = await axios.get('/api/users/' + savedUserId);
                        
                        if (response.data.user) {
                            // User exists, restore session
                            currentUserId = parseInt(savedUserId);
                            currentUser = response.data.user;
                            updateAuthUI();
                            loadPosts();
                            console.log('자동 로그인 성공:', currentUser.name);
                        } else {
                            // User doesn't exist, clear localStorage
                            localStorage.removeItem('currentUserId');
                            localStorage.removeItem('currentUser');
                        }
                    } catch (error) {
                        // Error fetching user, clear localStorage
                        console.error('자동 로그인 실패:', error);
                        localStorage.removeItem('currentUserId');
                        localStorage.removeItem('currentUser');
                    }
                }
            }

            // Initialize
            updateAuthUI();
            updateEmailDatalist(); // Load email history
            autoLogin(); // Auto-login if session exists
        </script>
    </body>
    </html>
  `)
})

// =====================
// Admin Frontend Route
// =====================

app.get('/admin', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>관리자 패널 - CROSSfriends</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
            /* CROSSfriends Color System */
            :root {
                --color-primary: #3B82F6;
                --color-primary-dark: #2563EB;
                --color-accent: #DC2626;
                --color-warning: #CA8A04;
                --color-warning-light: #FACC15;
            }
            
            .admin-badge-container {
                position: relative;
                display: inline-block;
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
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
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
        </style>
    </head>
    <body class="bg-gray-100">
        <nav class="bg-white shadow-md">
            <div class="max-w-7xl mx-auto px-4 py-3">
                <div class="flex justify-between items-center">
                    <h1 class="text-2xl font-bold text-gray-800">
                        <i class="fas fa-shield-alt text-red-600 mr-2"></i>
                        관리자 패널
                    </h1>
                    <div class="flex items-center space-x-4">
                        <div class="flex items-center space-x-3 bg-gray-100 px-4 py-2 rounded-lg">
                            <div class="admin-badge-container">
                                <div id="adminAvatarContainer" class="w-8 h-8 rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white text-sm flex-shrink-0">
                                    <i class="fas fa-user"></i>
                                </div>
                                <div class="admin-badge-crown" title="관리자"><i class="fas fa-crown"></i></div>
                            </div>
                            <span id="adminName" class="text-gray-800 font-medium"></span>
                        </div>
                        <button onclick="goHome()" class="text-gray-600 hover:text-gray-800">
                            <i class="fas fa-home mr-1"></i>홈으로
                        </button>
                        <button onclick="logout()" class="text-red-600 hover:text-red-800">
                            <i class="fas fa-sign-out-alt mr-1"></i>로그아웃
                        </button>
                    </div>
                </div>
            </div>
        </nav>

        <div class="max-w-7xl mx-auto px-4 py-6">
            <!-- Statistics Cards -->
            <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div class="bg-white rounded-lg shadow p-6">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-gray-500 text-sm">총 회원 수</p>
                            <p id="userCount" class="text-3xl font-bold text-blue-600">0</p>
                        </div>
                        <i class="fas fa-users text-blue-600 text-4xl opacity-20"></i>
                    </div>
                </div>
                <div class="bg-white rounded-lg shadow p-6">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-gray-500 text-sm">총 게시물</p>
                            <p id="postCount" class="text-3xl font-bold text-green-600">0</p>
                        </div>
                        <i class="fas fa-file-alt text-green-600 text-4xl opacity-20"></i>
                    </div>
                </div>
                <div class="bg-white rounded-lg shadow p-6">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-gray-500 text-sm">총 댓글</p>
                            <p id="commentCount" class="text-3xl font-bold text-purple-600">0</p>
                        </div>
                        <i class="fas fa-comments text-purple-600 text-4xl opacity-20"></i>
                    </div>
                </div>
                <div class="bg-white rounded-lg shadow p-6">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-gray-500 text-sm">기도 제목</p>
                            <p id="prayerCount" class="text-3xl font-bold text-yellow-600">0</p>
                        </div>
                        <i class="fas fa-praying-hands text-yellow-600 text-4xl opacity-20"></i>
                    </div>
                </div>
            </div>

            <!-- Tabs -->
            <div class="bg-white rounded-lg shadow mb-6">
                <div class="border-b">
                    <nav class="flex space-x-4 px-4">
                        <button onclick="showTab('users')" id="tab-users" class="py-4 px-2 border-b-2 border-blue-600 text-blue-600 font-medium">
                            <i class="fas fa-users mr-2"></i>회원 관리
                        </button>
                        <button onclick="showTab('posts')" id="tab-posts" class="py-4 px-2 border-b-2 border-transparent text-gray-500 hover:text-gray-700">
                            <i class="fas fa-file-alt mr-2"></i>게시물 관리
                        </button>
                    </nav>
                </div>

                <!-- Users Tab -->
                <div id="content-users" class="p-6">
                    <div class="overflow-x-auto">
                        <table class="w-full">
                            <thead>
                                <tr class="bg-gray-50">
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">이름</th>
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">이메일</th>
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">교회</th>
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">역할</th>
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">게시물</th>
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">가입일</th>
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">작업</th>
                                </tr>
                            </thead>
                            <tbody id="usersTableBody" class="bg-white divide-y divide-gray-200">
                                <!-- Users will be loaded here -->
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Posts Tab -->
                <div id="content-posts" class="p-6 hidden">
                    <div class="overflow-x-auto">
                        <table class="w-full">
                            <thead>
                                <tr class="bg-gray-50">
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">작성자</th>
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">내용</th>
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">좋아요</th>
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">댓글</th>
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">작성일</th>
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">작업</th>
                                </tr>
                            </thead>
                            <tbody id="postsTableBody" class="bg-white divide-y divide-gray-200">
                                <!-- Posts will be loaded here -->
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
            let currentAdminId = null;
            let currentAdmin = null;

            // Check admin authentication
            function checkAuth() {
                const adminId = localStorage.getItem('currentUserId');
                const admin = localStorage.getItem('currentUser');
                
                if (!adminId || !admin) {
                    alert('로그인이 필요합니다.');
                    window.location.href = '/';
                    return false;
                }
                
                currentAdminId = adminId;
                currentAdmin = JSON.parse(admin);
                
                if (currentAdmin.role !== 'admin') {
                    alert('관리자 권한이 필요합니다.');
                    window.location.href = '/';
                    return false;
                }
                
                // Update admin name
                document.getElementById('adminName').textContent = currentAdmin.name;
                
                // Update admin avatar
                const adminAvatarContainer = document.getElementById('adminAvatarContainer');
                if (currentAdmin.avatar_url) {
                    const img = document.createElement('img');
                    img.src = currentAdmin.avatar_url;
                    img.alt = 'Profile';
                    img.className = 'w-full h-full object-cover';
                    img.onerror = function() {
                        adminAvatarContainer.innerHTML = '<i class="fas fa-user"></i>';
                    };
                    adminAvatarContainer.innerHTML = '';
                    adminAvatarContainer.appendChild(img);
                } else {
                    adminAvatarContainer.innerHTML = '<i class="fas fa-user"></i>';
                }
                
                return true;
            }

            // Navigate to home
            function goHome() {
                window.location.href = '/';
            }

            // Logout
            function logout() {
                localStorage.removeItem('currentUserId');
                localStorage.removeItem('currentUser');
                window.location.href = '/';
            }

            // Tab switching
            function showTab(tab) {
                // Update tab buttons
                document.querySelectorAll('[id^="tab-"]').forEach(btn => {
                    btn.classList.remove('border-blue-600', 'text-blue-600');
                    btn.classList.add('border-transparent', 'text-gray-500');
                });
                document.getElementById('tab-' + tab).classList.remove('border-transparent', 'text-gray-500');
                document.getElementById('tab-' + tab).classList.add('border-blue-600', 'text-blue-600');
                
                // Update content
                document.querySelectorAll('[id^="content-"]').forEach(content => {
                    content.classList.add('hidden');
                });
                document.getElementById('content-' + tab).classList.remove('hidden');
                
                // Load data
                if (tab === 'users') loadUsers();
                if (tab === 'posts') loadPosts();
            }

            // Load statistics
            async function loadStats() {
                try {
                    const response = await axios.get('/api/admin/stats', {
                        headers: { 'X-Admin-ID': currentAdminId }
                    });
                    
                    document.getElementById('userCount').textContent = response.data.users;
                    document.getElementById('postCount').textContent = response.data.posts;
                    document.getElementById('commentCount').textContent = response.data.comments;
                    document.getElementById('prayerCount').textContent = response.data.prayers;
                } catch (error) {
                    console.error('Failed to load stats:', error);
                }
            }

            // Load users
            async function loadUsers() {
                try {
                    const response = await axios.get('/api/admin/users', {
                        headers: { 'X-Admin-ID': currentAdminId }
                    });
                    
                    const tbody = document.getElementById('usersTableBody');
                    tbody.innerHTML = '';
                    
                    response.data.users.forEach(user => {
                        const roleColor = user.role === 'admin' ? 'text-red-600' : user.role === 'moderator' ? 'text-yellow-600' : 'text-gray-600';
                        const tr = document.createElement('tr');
                        tr.innerHTML = \`
                            <td class="px-4 py-3 text-sm">\${user.id}</td>
                            <td class="px-4 py-3 text-sm font-medium">\${user.name}</td>
                            <td class="px-4 py-3 text-sm">\${user.email}</td>
                            <td class="px-4 py-3 text-sm">\${user.church || '-'}</td>
                            <td class="px-4 py-3 text-sm \${roleColor} font-semibold">\${user.role || 'user'}</td>
                            <td class="px-4 py-3 text-sm">\${user.post_count}</td>
                            <td class="px-4 py-3 text-sm">\${new Date(user.created_at).toLocaleDateString('ko-KR')}</td>
                            <td class="px-4 py-3 text-sm">
                                <button onclick="changeRole(\${user.id}, '\${user.role}')" class="text-blue-600 hover:text-blue-800 mr-2" title="역할 변경">
                                    <i class="fas fa-user-cog"></i>
                                </button>
                                \${user.id !== parseInt(currentAdminId) ? \`
                                    <button onclick="deleteUser(\${user.id}, '\${user.name}')" class="text-red-600 hover:text-red-800" title="삭제">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                \` : ''}
                            </td>
                        \`;
                        tbody.appendChild(tr);
                    });
                } catch (error) {
                    console.error('Failed to load users:', error);
                    alert('회원 목록을 불러오는데 실패했습니다.');
                }
            }

            // Load posts
            async function loadPosts() {
                try {
                    const response = await axios.get('/api/admin/posts', {
                        headers: { 'X-Admin-ID': currentAdminId }
                    });
                    
                    const tbody = document.getElementById('postsTableBody');
                    tbody.innerHTML = '';
                    
                    response.data.posts.forEach(post => {
                        const tr = document.createElement('tr');
                        const contentPreview = post.content.length > 50 ? post.content.substring(0, 50) + '...' : post.content;
                        tr.innerHTML = \`
                            <td class="px-4 py-3 text-sm">\${post.id}</td>
                            <td class="px-4 py-3 text-sm">\${post.user_name}<br><span class="text-xs text-gray-500">\${post.user_email}</span></td>
                            <td class="px-4 py-3 text-sm">\${contentPreview}</td>
                            <td class="px-4 py-3 text-sm">\${post.likes_count || 0}</td>
                            <td class="px-4 py-3 text-sm">\${post.comments_count || 0}</td>
                            <td class="px-4 py-3 text-sm">\${new Date(post.created_at).toLocaleDateString('ko-KR')}</td>
                            <td class="px-4 py-3 text-sm">
                                <button onclick="deletePost(\${post.id})" class="text-red-600 hover:text-red-800" title="삭제">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </td>
                        \`;
                        tbody.appendChild(tr);
                    });
                } catch (error) {
                    console.error('Failed to load posts:', error);
                    alert('게시물 목록을 불러오는데 실패했습니다.');
                }
            }

            // Change user role
            async function changeRole(userId, currentRole) {
                const roles = ['user', 'moderator', 'admin'];
                const newRole = prompt(\`역할을 선택하세요 (현재: \${currentRole})\n\n사용 가능한 역할:\n- user (일반 사용자)\n- moderator (운영자)\n- admin (관리자)\`, currentRole);
                
                if (!newRole || !roles.includes(newRole)) {
                    return;
                }
                
                try {
                    await axios.put(\`/api/admin/users/\${userId}/role\`, 
                        { role: newRole },
                        { headers: { 'X-Admin-ID': currentAdminId } }
                    );
                    
                    alert('역할이 변경되었습니다.');
                    loadUsers();
                } catch (error) {
                    console.error('Failed to change role:', error);
                    alert('역할 변경에 실패했습니다.');
                }
            }

            // Delete user
            async function deleteUser(userId, userName) {
                if (!confirm(\`정말로 "\${userName}" 회원을 삭제하시겠습니까?\\n\\n이 작업은 되돌릴 수 없으며, 해당 회원의 모든 데이터(게시물, 댓글 등)가 삭제됩니다.\`)) {
                    return;
                }
                
                try {
                    await axios.delete(\`/api/admin/users/\${userId}\`, {
                        headers: { 'X-Admin-ID': currentAdminId }
                    });
                    
                    alert('회원이 삭제되었습니다.');
                    loadStats();
                    loadUsers();
                } catch (error) {
                    console.error('Failed to delete user:', error);
                    alert('회원 삭제에 실패했습니다.');
                }
            }

            // Delete post
            async function deletePost(postId) {
                if (!confirm('정말로 이 게시물을 삭제하시겠습니까?')) {
                    return;
                }
                
                try {
                    await axios.delete(\`/api/admin/posts/\${postId}\`, {
                        headers: { 'X-Admin-ID': currentAdminId }
                    });
                    
                    alert('게시물이 삭제되었습니다.');
                    loadStats();
                    loadPosts();
                } catch (error) {
                    console.error('Failed to delete post:', error);
                    alert('게시물 삭제에 실패했습니다.');
                }
            }

            // Initialize
            if (checkAuth()) {
                loadStats();
                loadUsers();
            }
        </script>
    </body>
    </html>
  `)
})


export default app
