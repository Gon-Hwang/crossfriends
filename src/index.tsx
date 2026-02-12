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

// Login endpoint
app.post('/api/login', async (c) => {
  const { DB } = c.env
  const { email } = await c.req.json()
  
  // Normalize email (trim and lowercase)
  const normalizedEmail = email.trim().toLowerCase()
  
  // Special handling for admin email - auto-create if doesn't exist
  if (normalizedEmail === 'holofa518@gmail.com') {
    // Check if admin account exists
    let user = await DB.prepare('SELECT * FROM users WHERE LOWER(email) = ?').bind(normalizedEmail).first()
    
    if (!user) {
      // Create admin account automatically
      const result = await DB.prepare(
        'INSERT INTO users (email, name, role) VALUES (?, ?, ?)'
      ).bind('holofa518@gmail.com', '관리자', 'admin').run()
      
      // Fetch the newly created user
      user = await DB.prepare('SELECT * FROM users WHERE id = ?').bind(result.meta.last_row_id).first()
    } else {
      // Ensure this user is admin
      if (user.role !== 'admin') {
        await DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind('admin', user.id).run()
        user = await DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first()
      }
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
  }
  
  // Regular login for other users
  const user = await DB.prepare('SELECT * FROM users WHERE LOWER(email) = ?').bind(normalizedEmail).first()
  
  if (!user) {
    return c.json({ error: '등록되지 않은 이메일입니다. 회원가입을 진행해주세요.' }, 404)
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
  
  const user = await DB.prepare('SELECT id, email, name, bio, avatar_url, church, pastor, denomination, location, position, gender, faith_answers, role, created_at, updated_at, scripture_score, prayer_score, activity_score, elementary_school, middle_school, high_school, university, university_major, masters, masters_major, phd, phd_major, universities, masters_degrees, phd_degrees, careers, marital_status, address, phone, privacy_settings FROM users WHERE id = ?').bind(id).first()
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }
  
  // If viewing own profile or no privacy settings, return all data
  const isOwnProfile = currentUserId && parseInt(currentUserId) === user.id
  
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

// View user profile (HTML page)
app.get('/users/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const user = await DB.prepare('SELECT id, email, name, bio, avatar_url, church, pastor, denomination, location, position, gender, faith_answers, role, created_at, updated_at, scripture_score, prayer_score, activity_score, elementary_school, middle_school, high_school, university, university_major, masters, masters_major, phd, phd_major, universities, masters_degrees, phd_degrees, careers, marital_status, address, phone, privacy_settings FROM users WHERE id = ?').bind(id).first()
  
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
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-50">
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
                        
                        <!-- All Scores in Grid -->
                        <div class="grid grid-cols-4 gap-4">
                            <div class="bg-yellow-50 p-4 rounded-lg text-center border-2 border-yellow-200">
                                <i class="fas fa-book-bible text-yellow-600 text-2xl mb-2"></i>
                                <div class="text-2xl font-bold text-yellow-600">${ user.scripture_score || 0}</div>
                                <div class="text-sm text-gray-600">성경 점수</div>
                            </div>
                            <div class="bg-blue-50 p-4 rounded-lg text-center border-2 border-blue-200">
                                <i class="fas fa-praying-hands text-blue-600 text-2xl mb-2"></i>
                                <div class="text-2xl font-bold text-blue-600">${ user.prayer_score || 0}</div>
                                <div class="text-sm text-gray-600">기도 점수</div>
                            </div>
                            <div class="bg-green-50 p-4 rounded-lg text-center border-2 border-green-200">
                                <i class="fas fa-heart text-green-600 text-2xl mb-2"></i>
                                <div class="text-2xl font-bold text-green-600">${ user.activity_score || 0}</div>
                                <div class="text-sm text-gray-600">활동 점수</div>
                            </div>
                            <div class="bg-purple-50 p-4 rounded-lg text-center border-2 border-purple-200">
                                <i class="fas fa-trophy text-purple-600 text-2xl mb-2"></i>
                                <div class="text-2xl font-bold text-purple-600">${ ((user.scripture_score || 0) + (user.prayer_score || 0) + (user.activity_score || 0))}</div>
                                <div class="text-sm text-gray-600">종합점수</div>
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

// Create new user
app.post('/api/users', async (c) => {
  const { DB } = c.env
  const { email, name, bio, church, pastor, denomination, location, position, gender, faith_answers, marital_status, address, phone } = await c.req.json()
  
  // Check if this is the first user (will become admin)
  const userCountResult = await DB.prepare('SELECT COUNT(*) as count FROM users').first()
  const userCount = userCountResult?.count || 0
  const role = userCount === 0 ? 'admin' : 'user'
  
  const result = await DB.prepare(
    'INSERT INTO users (email, name, bio, church, pastor, denomination, location, position, gender, faith_answers, role, marital_status, address, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(email, name, bio || null, church || null, pastor || null, denomination || null, location || null, position || null, gender || null, faith_answers || null, role, marital_status || null, address || null, phone || null).run()
  
  return c.json({ id: result.meta.last_row_id, email, name, role }, 201)
})

// Update user
app.put('/api/users/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const { name, gender, church, pastor, position, faith_answers, elementary_school, middle_school, high_school, university, university_major, masters, masters_major, phd, phd_major, universities, masters_degrees, phd_degrees, careers, marital_status, address, phone, privacy_settings } = await c.req.json()
  
  await DB.prepare(
    'UPDATE users SET name = ?, gender = ?, church = ?, pastor = ?, position = ?, faith_answers = ?, elementary_school = ?, middle_school = ?, high_school = ?, university = ?, university_major = ?, masters = ?, masters_major = ?, phd = ?, phd_major = ?, universities = ?, masters_degrees = ?, phd_degrees = ?, careers = ?, marital_status = ?, address = ?, phone = ?, privacy_settings = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(name, gender || null, church || null, pastor || null, position || null, faith_answers || null, elementary_school || null, middle_school || null, high_school || null, university || null, university_major || null, masters || null, masters_major || null, phd || null, phd_major || null, universities || null, masters_degrees || null, phd_degrees || null, careers || null, marital_status || null, address || null, phone || null, privacy_settings || null, id).run()
  
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

// Get post image from R2
app.get('/api/images/posts/:filename', async (c) => {
  const { R2 } = c.env
  const filename = c.req.param('filename')
  
  const object = await R2.get(`posts/${filename}`)
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
    ORDER BY p.created_at DESC
  `).bind(currentUserId || 0, currentUserId || 0).all()
  
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
  const { user_id, content, image_url, verse_reference, shared_post_id, is_prayer_request, background_color } = await c.req.json()
  
  const result = await DB.prepare(
    'INSERT INTO posts (user_id, content, image_url, verse_reference, shared_post_id, is_prayer_request, background_color) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(user_id, content, image_url || null, verse_reference || null, shared_post_id || null, is_prayer_request || 0, background_color || null).run()
  
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
  
  return c.json({ id: result.meta.last_row_id, user_id, content, ...updatedScores }, 201)
})

// Upload post image
app.post('/api/posts/:id/image', async (c) => {
  const { DB, R2 } = c.env
  const postId = c.req.param('id')
  
  try {
    const formData = await c.req.formData()
    const file = formData.get('image')
    
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
    
    // Update post image_url in database
    const imageUrl = `/api/images/posts/${filename}`
    await DB.prepare(
      'UPDATE posts SET image_url = ? WHERE id = ?'
    ).bind(imageUrl, postId).run()
    
    return c.json({ success: true, image_url: imageUrl })
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
  const { R2 } = c.env
  const filename = c.req.param('filename')
  
  const object = await R2.get(`videos/${filename}`)
  if (!object) {
    return c.notFound()
  }
  
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Cache-Control', 'public, max-age=31536000')
  
  return new Response(object.body, { headers })
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
  
  // 삭제 전에 포스트 정보 조회 (기도 포스팅인지 확인)
  const post = await DB.prepare('SELECT user_id, background_color FROM posts WHERE id = ?').bind(id).first()
  
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
  }
  
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
  
  const result = await DB.prepare(
    'INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)'
  ).bind(postId, user_id, content).run()
  
  // 댓글 작성 시 활동 점수 5점 추가
  const user = await DB.prepare('SELECT activity_score FROM users WHERE id = ?').bind(user_id).first()
  const currentScore = user?.activity_score || 0
  const newScore = currentScore + 5
  await DB.prepare('UPDATE users SET activity_score = ? WHERE id = ?').bind(newScore, user_id).run()
  
  return c.json({ id: result.meta.last_row_id, post_id: postId, user_id, content, new_activity_score: newScore }, 201)
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
  
  // 댓글 정보 조회 (사용자 ID 확인)
  const comment = await DB.prepare('SELECT user_id FROM comments WHERE id = ?').bind(commentId).first()
  
  // Delete comment likes first
  await DB.prepare('DELETE FROM comment_likes WHERE comment_id = ?').bind(commentId).run()
  
  // Delete comment
  await DB.prepare('DELETE FROM comments WHERE id = ?').bind(commentId).run()
  
  // 댓글 삭제 시 활동 점수 5점 차감 (0점 이하로 내려가지 않도록)
  if (comment) {
    const user = await DB.prepare('SELECT activity_score FROM users WHERE id = ?').bind(comment.user_id).first()
    const currentScore = user?.activity_score || 0
    const newScore = Math.max(0, currentScore - 5)
    await DB.prepare('UPDATE users SET activity_score = ? WHERE id = ?').bind(newScore, comment.user_id).run()
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
  
  // Get post's background color to determine which score to update
  const post = await DB.prepare('SELECT background_color FROM posts WHERE id = ?').bind(postId).first()
  
  // Check if already liked
  const existing = await DB.prepare(
    'SELECT id FROM likes WHERE post_id = ? AND user_id = ?'
  ).bind(postId, user_id).first()
  
  let updatedScores = {}
  
  if (existing) {
    // Unlike - deduct 1 point
    await DB.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').bind(postId, user_id).run()
    
    // 말씀 포스팅이면 성경 점수 -1점
    if (post.background_color === '#F5E398') {
      const user = await DB.prepare('SELECT scripture_score FROM users WHERE id = ?').bind(user_id).first()
      const currentScore = user?.scripture_score || 0
      const newScore = Math.max(0, currentScore - 1)
      await DB.prepare('UPDATE users SET scripture_score = ? WHERE id = ?').bind(newScore, user_id).run()
      updatedScores.scripture_score = newScore
    }
    // 일상, 사역, 찬양, 교회, 자유 포스팅이면 활동 점수 -1점
    else {
      const activityPostColors = ['#F5D4B3', '#B3EDD8', '#C4E5F8', '#E2DBFB', '#FFFFFF']
      if (activityPostColors.includes(post.background_color)) {
        const user = await DB.prepare('SELECT activity_score FROM users WHERE id = ?').bind(user_id).first()
        const currentScore = user?.activity_score || 0
        const newScore = Math.max(0, currentScore - 1)
        await DB.prepare('UPDATE users SET activity_score = ? WHERE id = ?').bind(newScore, user_id).run()
        updatedScores.activity_score = newScore
      }
    }
    
    return c.json({ liked: false, ...updatedScores })
  } else {
    // Like - add 1 point
    await DB.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)').bind(postId, user_id).run()
    
    // 말씀 포스팅이면 성경 점수 +1점
    if (post.background_color === '#F5E398') {
      const user = await DB.prepare('SELECT scripture_score FROM users WHERE id = ?').bind(user_id).first()
      const currentScore = user?.scripture_score || 0
      const newScore = currentScore + 1
      await DB.prepare('UPDATE users SET scripture_score = ? WHERE id = ?').bind(newScore, user_id).run()
      updatedScores.scripture_score = newScore
    }
    // 일상, 사역, 찬양, 교회, 자유 포스팅이면 활동 점수 +1점
    else {
      const activityPostColors = ['#F5D4B3', '#B3EDD8', '#C4E5F8', '#E2DBFB', '#FFFFFF']
      if (activityPostColors.includes(post.background_color)) {
        const user = await DB.prepare('SELECT activity_score FROM users WHERE id = ?').bind(user_id).first()
        const currentScore = user?.activity_score || 0
        const newScore = currentScore + 1
        await DB.prepare('UPDATE users SET activity_score = ? WHERE id = ?').bind(newScore, user_id).run()
        updatedScores.activity_score = newScore
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
  
  // Check if already prayed
  const existing = await DB.prepare(
    'SELECT id FROM prayer_clicks WHERE post_id = ? AND user_id = ?'
  ).bind(postId, user_id).first()
  
  if (existing) {
    // Cancel prayer - remove from database and deduct points
    await DB.prepare('DELETE FROM prayer_clicks WHERE post_id = ? AND user_id = ?').bind(postId, user_id).run()
    
    // Deduct 20 points from user's prayer score
    const user = await DB.prepare('SELECT prayer_score FROM users WHERE id = ?').bind(user_id).first()
    const currentScore = user?.prayer_score || 0
    const newScore = Math.max(0, currentScore - 20) // Don't go below 0
    await DB.prepare('UPDATE users SET prayer_score = ? WHERE id = ?').bind(newScore, user_id).run()
    
    return c.json({ prayed: false, prayer_score: newScore })
  } else {
    // Pray (기도하기) - add to database and add points
    await DB.prepare('INSERT INTO prayer_clicks (post_id, user_id) VALUES (?, ?)').bind(postId, user_id).run()
    
    // Add 20 points to user's prayer score
    const user = await DB.prepare('SELECT prayer_score FROM users WHERE id = ?').bind(user_id).first()
    const currentScore = user?.prayer_score || 0
    const newScore = currentScore + 20
    await DB.prepare('UPDATE users SET prayer_score = ? WHERE id = ?').bind(newScore, user_id).run()
    
    return c.json({ prayed: true, prayer_score: newScore })
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
        <script src="https://cdn.tailwindcss.com"></script>
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
        </script>
    </head>
    <body class="bg-gray-50">
        <nav class="bg-red-600 text-white shadow-lg">
            <div class="max-w-7xl mx-auto px-4 py-4">
                <div class="flex justify-between items-center">
                    <h1 class="text-2xl font-bold">
                        <i class="fas fa-shield-alt mr-2"></i>관리자 패널
                    </h1>
                    <a href="/" class="bg-white text-red-600 px-4 py-2 rounded-lg hover:bg-gray-100 transition">
                        <i class="fas fa-home mr-2"></i>홈으로
                    </a>
                </div>
            </div>
        </nav>

        <div class="max-w-7xl mx-auto px-4 py-8">
            <!-- Stats Cards -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
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
                            <i class="fas fa-magic mr-2"></i>🌱 개연성 시뮬레이션
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


            // Initialize
            if (!adminId) {
                alert('로그인이 필요합니다.');
                window.location.href = '/';
            } else {
                loadStats();
                loadUsers();
                loadAdminPosts();
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
        <title>CROSSfriends - 기독교인 소셜 네트워크</title>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg">
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
            
            /* Custom Scrollbar for Sidebar */
            .sidebar-scroll::-webkit-scrollbar {
                width: 8px;
            }
            .sidebar-scroll::-webkit-scrollbar-track {
                background: #F3F4F6;
                border-radius: 10px;
            }
            .sidebar-scroll::-webkit-scrollbar-thumb {
                background: #D1D5DB;
                border-radius: 10px;
            }
            .sidebar-scroll::-webkit-scrollbar-thumb:hover {
                background: #9CA3AF;
            }
        </style>
    </head>
    <body class="bg-gray-50">
        <!-- Header -->
        <nav class="bg-white shadow-md sticky top-0 z-50">
            <div class="max-w-7xl mx-auto px-4 py-3">
                <div class="flex justify-between items-center">
                    <div class="flex flex-col cursor-pointer hover:opacity-80 transition" onclick="goToHome()">
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
                        <p class="text-xs text-gray-500 mt-1 ml-1" style="font-family: 'Poppins', sans-serif; letter-spacing: 0.3px;">
                            기독교인들을 위한 행복하고 재미있는 소셜 미디어
                        </p>
                    </div>
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
                        <div class="relative">
                            <div class="flex items-center space-x-3 bg-gray-100 px-4 py-2 rounded-lg">
                                <div class="admin-badge-container">
                                    <div id="userAvatarContainer" class="w-8 h-8 rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white text-sm flex-shrink-0 cursor-pointer hover:ring-4 hover:ring-blue-300 transition" onclick="showViewProfileModal()">
                                        <i class="fas fa-user"></i>
                                    </div>
                                    <!-- Admin/Moderator badge will be added here dynamically -->
                                </div>
                                <span id="userName" class="text-gray-800 font-medium whitespace-nowrap"></span>
                                <button onclick="logout()" class="text-red-600 hover:text-red-700 transition cursor-pointer ml-2" title="로그아웃">
                                    <i class="fas fa-sign-out-alt text-lg"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </nav>

        <!-- Main Content -->
        <div class="max-w-7xl mx-auto px-4 py-6">
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <!-- Left Sidebar -->
                <div class="lg:col-span-1">
                    <div class="sticky top-20 space-y-6 max-h-[calc(100vh-6rem)] overflow-y-auto sidebar-scroll pr-2">
                        <!-- Today's Bible Verse -->
                        <div class="bg-white rounded-xl shadow-md border-2 border-gray-300 p-6 transition-all duration-300 hover:shadow-lg hover:border-gray-500">
                            <h3 class="text-lg font-bold mb-4 text-gray-800">
                                <i class="fas fa-book-open text-blue-600 mr-2"></i>오늘의 성경 구절
                            </h3>
                            <div class="border-l-4 border-blue-600 pl-4 py-2 mb-4">
                                <p class="font-bold text-blue-600 mb-2" id="verseReference">시편 23:1</p>
                                <p id="verseText" class="text-gray-800 leading-relaxed" style="transition: opacity 0.5s ease-in-out;">
                                    여호와는 나의 목자시니 내게 부족함이 없으리로다
                                </p>
                            </div>
                            
                            <!-- Typing Toggle Button -->
                            <div class="relative">
                                <button 
                                    id="typingToggleBtn"
                                    onclick="toggleTypingArea()"
                                    class="w-full mt-2 py-2 px-4 bg-blue-50 hover:bg-blue-100 border-2 border-blue-300 rounded-lg transition-all flex items-center justify-center space-x-2 text-blue-800 font-semibold">
                                    <i class="fas fa-keyboard text-blue-600"></i>
                                    <span>말씀 타이핑</span>
                                    <i id="typingToggleIcon" class="fas fa-chevron-down text-sm"></i>
                                </button>
                                
                                <!-- Typing Input Area (Initially Hidden) -->
                                <div id="typingArea" class="mt-4 pt-4 border-t-2 border-gray-200 hidden">
                                    <div class="flex items-center justify-between mb-2">
                                        <label class="text-sm font-semibold text-gray-700">
                                            <i class="fas fa-keyboard text-blue-600 mr-1"></i>말씀 타이핑
                                        </label>
                                        <button onclick="resetTyping()" class="text-xs text-gray-500 hover:text-gray-700 underline">
                                            <i class="fas fa-redo mr-1"></i>초기화
                                        </button>
                                    </div>
                                    <textarea 
                                        id="typingInput"
                                        placeholder="위 성경구절을 입력하고 Enter를 누르세요..."
                                        class="w-full p-3 border-2 border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none text-sm"
                                        rows="3"
                                        onkeydown="handleTypingEnter(event)"
                                    ></textarea>
                                    <div id="typingResult" class="mt-2 text-sm hidden"></div>
                                </div>
                                
                                <!-- Login Required Overlay for Typing -->
                                <div id="typingLoginOverlay" class="hidden absolute top-0 left-0 w-full h-full bg-white bg-opacity-80 backdrop-blur-sm rounded-lg flex items-center justify-center cursor-not-allowed z-10" title="로그인 필요">
                                    <div class="text-center">
                                        <i class="fas fa-lock text-4xl text-gray-400 mb-2"></i>
                                        <p class="text-base font-semibold text-gray-600">로그인 필요</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    
                        <!-- Reward1: Today's Sermon Section -->
                        <div id="sermonRewardSection" class="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl shadow-lg border-2 border-purple-300 p-4 transition-all duration-300">
                            <!-- Locked State (< 500 points) -->
                            <div id="sermonLocked" class="text-center">
                                <div class="mb-3">
                                    <h3 class="text-base font-bold text-purple-800 leading-tight">
                                        🎁 리워드1:<br/>오늘의 설교 말씀
                                    </h3>
                                </div>
                                
                                <!-- Current Score Display -->
                                <div class="bg-gradient-to-r from-blue-100 to-purple-100 rounded-lg p-3 mb-3">
                                    <div class="flex items-center justify-between mb-2">
                                        <span class="text-sm font-semibold text-gray-700">현재 종합점수</span>
                                        <span id="rewardTotalScore" class="text-xl font-bold text-purple-600">0</span>
                                    </div>
                                    <div class="w-full bg-gray-200 rounded-full h-2">
                                        <div id="rewardProgressBar" class="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-500" style="width: 0%"></div>
                                    </div>
                                </div>
                                
                                <!-- Unlock Button (Disabled) -->
                                <button 
                                    id="unlockSermonBtn"
                                    disabled
                                    class="w-full py-3 px-4 bg-gray-300 text-gray-500 rounded-lg font-bold text-base cursor-not-allowed flex items-center justify-center space-x-2 transition-all">
                                    <i class="fas fa-lock text-lg"></i>
                                    <span>500점 달성 후 언락 가능</span>
                                </button>
                            </div>
                            
                            <!-- Unlocked State (≥ 500 points) -->
                            <div id="sermonUnlocked" class="hidden">
                                <div class="bg-gradient-to-r from-yellow-100 to-orange-100 rounded-lg p-4 mb-4 border-2 border-yellow-400">
                                    <div class="flex items-center justify-center space-x-2">
                                        <i class="fas fa-trophy text-yellow-600 text-2xl"></i>
                                        <h3 class="text-xl font-bold text-yellow-800">🎉 리워드1 언락 완료!</h3>
                                        <i class="fas fa-trophy text-yellow-600 text-2xl"></i>
                                    </div>
                                </div>
                                
                                <h3 class="text-lg font-bold mb-4 text-gray-800">
                                    <i class="fas fa-video text-red-600 mr-2"></i>오늘의 설교 말씀
                                </h3>
                                <div class="border-l-4 border-red-600 pl-4 py-2 mb-4">
                                    <p class="font-bold text-red-600 mb-2">
                                        <i class="fas fa-church mr-1"></i>낙망하고 불안해하지 말라
                                    </p>
                                    <p class="text-gray-700 text-sm mb-2">
                                        시편 42:5
                                    </p>
                                    <p class="text-xs text-gray-500 mb-3">
                                        <i class="fas fa-user-tie mr-1"></i>조용기 목사 (여의도순복음교회)
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
                                        <i class="fas fa-info-circle mr-1"></i>영상을 90% 이상 시청하면 100점을 받습니다!
                                    </p>
                                </div>
                                
                                <!-- Video Completion Result -->
                                <div id="videoCompletionResult" class="mt-3 hidden"></div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Main Feed -->
                <div class="lg:col-span-2 space-y-4">
                    <!-- New Post Card -->
                    <div id="newPostCard" class="bg-white rounded-xl shadow-md border-2 border-gray-300 p-6 transition-all duration-300 hover:shadow-lg hover:border-gray-500">
                        <div class="flex items-start space-x-4">
                            <div class="admin-badge-container">
                                <div id="newPostAvatar" class="w-10 h-10 rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white flex-shrink-0 cursor-pointer hover:ring-4 hover:ring-blue-300 transition" onclick="showViewProfileModal()">
                                    <i class="fas fa-user"></i>
                                </div>
                                <!-- Badge will be added here dynamically -->
                            </div>
                            <div class="flex-1">
                                <textarea 
                                    id="newPostContent"
                                    placeholder="무엇을 나누고 싶으신가요?"
                                    class="w-full p-3 border rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none transition-colors duration-200"
                                    rows="3"
                                ></textarea>
                                
                                <!-- Background Color Selector -->
                                <div class="mt-3">
                                    <div class="flex items-center justify-end mb-2">
                                        <button 
                                            onclick="resetBackgroundColor()" 
                                            class="text-xs text-gray-500 hover:text-gray-700 underline"
                                            title="초기화">
                                            <i class="fas fa-undo mr-1"></i>초기화
                                        </button>
                                    </div>
                                    <div class="flex items-start space-x-3">
                                        <div class="flex flex-col items-center space-y-1">
                                            <button 
                                                onclick="selectBackgroundColor('#F87171', this)" 
                                                class="color-selector-btn w-10 h-10 rounded-full border-2 border-gray-300 hover:border-gray-500 transition-all"
                                                style="background-color: #F87171;"
                                                title="중보">
                                            </button>
                                            <span class="text-xs font-medium text-gray-600">중보</span>
                                        </div>
                                        <div class="flex flex-col items-center space-y-1">
                                            <button 
                                                onclick="selectBackgroundColor('#F5D4B3', this)" 
                                                class="color-selector-btn w-10 h-10 rounded-full border-2 border-gray-300 hover:border-gray-500 transition-all"
                                                style="background-color: #FED7B0;"
                                                title="일상">
                                            </button>
                                            <span class="text-xs font-medium text-gray-600">일상</span>
                                        </div>
                                        <div class="flex flex-col items-center space-y-1">
                                            <button 
                                                onclick="selectBackgroundColor('#F5E398', this)" 
                                                class="color-selector-btn w-10 h-10 rounded-full border-2 border-gray-300 hover:border-gray-500 transition-all"
                                                style="background-color: #FEF08A;"
                                                title="말씀">
                                            </button>
                                            <span class="text-xs font-medium text-gray-600">말씀</span>
                                        </div>
                                        <div class="flex flex-col items-center space-y-1">
                                            <button 
                                                onclick="selectBackgroundColor('#B3EDD8', this)" 
                                                class="color-selector-btn w-10 h-10 rounded-full border-2 border-gray-300 hover:border-gray-500 transition-all"
                                                style="background-color: #BBF7D0;"
                                                title="사역">
                                            </button>
                                            <span class="text-xs font-medium text-gray-600">사역</span>
                                        </div>
                                        <div class="flex flex-col items-center space-y-1">
                                            <button 
                                                onclick="selectBackgroundColor('#C4E5F8', this)" 
                                                class="color-selector-btn w-10 h-10 rounded-full border-2 border-gray-300 hover:border-gray-500 transition-all"
                                                style="background-color: #BAE6FD;"
                                                title="찬양">
                                            </button>
                                            <span class="text-xs font-medium text-gray-600">찬양</span>
                                        </div>
                                        <div class="flex flex-col items-center space-y-1">
                                            <button 
                                                onclick="selectBackgroundColor('#E2DBFB', this)" 
                                                class="color-selector-btn w-10 h-10 rounded-full border-2 border-gray-300 hover:border-gray-500 transition-all"
                                                style="background-color: #DDD6FE;"
                                                title="교회">
                                            </button>
                                            <span class="text-xs font-medium text-gray-600">교회</span>
                                        </div>
                                        <div class="flex flex-col items-center space-y-1">
                                            <button 
                                                onclick="selectBackgroundColor('#FFFFFF', this)" 
                                                class="color-selector-btn w-10 h-10 rounded-full bg-white border-2 border-gray-300 hover:border-gray-500 transition-all"
                                                title="자유">
                                            </button>
                                            <span class="text-xs font-medium text-gray-600">자유</span>
                                        </div>
                                    </div>
                                </div>
                                
                                <!-- Image Preview -->
                                <div id="postImagePreviewContainer" class="hidden mt-3">
                                    <div class="relative inline-block">
                                        <img id="postImagePreview" src="" alt="Preview" class="max-h-48 rounded-lg border">
                                        <button 
                                            onclick="removePostImage()"
                                            class="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600 transition">
                                            <i class="fas fa-times text-xs"></i>
                                        </button>
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
                                
                                <div class="mt-3 flex justify-between items-center">
                                    <div class="flex space-x-2">
                                        <input 
                                            id="postImageFile"
                                            type="file"
                                            accept="image/*"
                                            onchange="previewPostImage(event)"
                                            class="hidden"
                                        />
                                        <label 
                                            for="postImageFile"
                                            class="cursor-pointer inline-flex items-center justify-center w-10 h-10 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                                            title="사진 첨부">
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
                                            class="cursor-pointer inline-flex items-center justify-center w-10 h-10 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition"
                                            title="동영상 첨부">
                                            <i class="fas fa-video"></i>
                                        </label>
                                    </div>
                                    <div class="flex items-center space-x-3">
                                        <button 
                                            id="createPostBtn"
                                            onclick="createPost()"
                                            class="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition">
                                            <i class="fas fa-paper-plane mr-2"></i>게시하기
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Profile View (Hidden by default) -->
                    <div id="profileView" class="hidden space-y-4">
                        <div class="bg-white rounded-xl shadow-md border-2 border-gray-300 p-6">
                            <div class="flex items-center justify-between mb-6">
                                <h2 class="text-2xl font-bold text-gray-800">
                                    <i class="fas fa-user-circle text-blue-600 mr-2"></i>프로필
                                </h2>
                                <button onclick="hideProfile()" class="text-gray-500 hover:text-gray-700 transition">
                                    <i class="fas fa-times text-xl"></i>
                                </button>
                            </div>
                            <div id="profileViewContent">
                                <!-- Profile content will be loaded here -->
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
                        <label class="block text-sm font-semibold text-gray-700 mb-2">이름 <span class="text-red-500">*</span></label>
                        <input 
                            id="signupName"
                            type="text"
                            placeholder="홍길동"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">성별 <span class="text-red-500">*</span></label>
                        <select 
                            id="signupGender"
                            class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-600 focus:outline-none">
                            <option value="">선택하세요</option>
                            <option value="남성">남성</option>
                            <option value="여성">여성</option>
                        </select>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">이메일 <span class="text-red-500">*</span></label>
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
                        <label class="block text-sm font-semibold text-gray-700 mb-2">프로필 사진 <span class="text-red-500">*</span></label>
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
                    <button onclick="hideViewProfileModal(); showEditProfileModal();" class="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition">
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
                                <div id="editAvatarButtons" class="flex space-x-2">
                                    <label 
                                        for="editAvatar"
                                        class="cursor-pointer inline-block px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition">
                                        <i class="fas fa-upload mr-2"></i>사진 변경
                                    </label>
                                    <button 
                                        type="button"
                                        onclick="deleteAvatar()"
                                        class="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition">
                                        <i class="fas fa-trash mr-2"></i>사진 삭제
                                    </button>
                                </div>
                                <p id="editAvatarNote" class="text-xs text-gray-500 mt-2">JPG, PNG (최대 5MB)</p>
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

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/static/app.js?v=${Date.now()}"></script>
    </body>
    </html>
  `)
})


export default app
