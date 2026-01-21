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
  const user = await DB.prepare('SELECT id, email, name, bio, avatar_url, church, pastor, denomination, location, position, gender, faith_answers, role, created_at, updated_at FROM users WHERE id = ?').bind(id).first()
  
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
  const { name, gender, church, pastor, position, faith_answers } = await c.req.json()
  
  await DB.prepare(
    'UPDATE users SET name = ?, gender = ?, church = ?, pastor = ?, position = ?, faith_answers = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(name, gender || null, church || null, pastor || null, position || null, faith_answers || null, id).run()
  
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
      sp.id as shared_post_id,
      sp.content as shared_content,
      sp.image_url as shared_image_url,
      sp.video_url as shared_video_url,
      sp.verse_reference as shared_verse_reference,
      sp.created_at as shared_created_at,
      su.name as shared_user_name,
      su.avatar_url as shared_user_avatar,
      su.church as shared_user_church,
      su.role as shared_user_role
    FROM posts p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN posts sp ON p.shared_post_id = sp.id
    LEFT JOIN users su ON sp.user_id = su.id
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
  const { user_id, content, image_url, verse_reference, shared_post_id } = await c.req.json()
  
  const result = await DB.prepare(
    'INSERT INTO posts (user_id, content, image_url, verse_reference, shared_post_id) VALUES (?, ?, ?, ?, ?)'
  ).bind(user_id, content, image_url || null, verse_reference || null, shared_post_id || null).run()
  
  return c.json({ id: result.meta.last_row_id, user_id, content }, 201)
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
// User Scores API Routes
// =====================

// Get user scores
app.get('/api/users/:id/scores', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('id')
  
  const user = await DB.prepare(
    'SELECT typing_score, video_score, completed_videos, completed_verses FROM users WHERE id = ?'
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
  
  const totalScore = (user.typing_score || 0) + (user.video_score || 0)
  
  return c.json({
    typing_score: user.typing_score || 0,
    video_score: user.video_score || 0,
    total_score: totalScore,
    completed_videos: completedVideos,
    completed_verses: completedVerses
  })
})

// Update typing score
app.post('/api/users/:id/scores/typing', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('id')
  const { score, completed_verses } = await c.req.json()
  
  // Prepare SQL update
  if (completed_verses !== undefined) {
    // Update both score and completed verses
    await DB.prepare(
      'UPDATE users SET typing_score = ?, completed_verses = ? WHERE id = ?'
    ).bind(score, JSON.stringify(completed_verses), userId).run()
  } else {
    // Update only score
    await DB.prepare(
      'UPDATE users SET typing_score = ? WHERE id = ?'
    ).bind(score, userId).run()
  }
  
  return c.json({ success: true, typing_score: score })
})

// Update video score and completed videos (when fully completed)
app.post('/api/users/:id/scores/video', async (c) => {
  const { DB } = c.env
  const userId = c.req.param('id')
  const { score, video_id } = await c.req.json()
  
  // Get current completed videos
  const user = await DB.prepare(
    'SELECT completed_videos, video_score FROM users WHERE id = ?'
  ).bind(userId).first()
  
  let completedVideos = []
  try {
    completedVideos = JSON.parse(user?.completed_videos || '[]')
  } catch (e) {
    completedVideos = []
  }
  
  // Find if this video already exists
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
  
  await DB.prepare(
    'UPDATE users SET video_score = ?, completed_videos = ? WHERE id = ?'
  ).bind(score, JSON.stringify(completedVideos), userId).run()
  
  return c.json({ 
    success: true, 
    video_score: score,
    completed_videos: completedVideos
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
    // Delete all users with fake email addresses
    const result = await DB.prepare("DELETE FROM users WHERE email LIKE 'fake%@cf.com'").run()
    
    return c.json({
      success: true,
      deleted_count: result.meta.changes || 0
    })
  } catch (error) {
    console.error('Error deleting fake users:', error)
    return c.json({ success: false, error: 'Failed to delete fake users' }, 500)
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
            <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
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
                
                <div class="bg-orange-500 text-white rounded-xl shadow-lg p-6">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-orange-100 text-sm">기도 제목</p>
                            <p class="text-3xl font-bold" id="totalPrayers">0</p>
                        </div>
                        <i class="fas fa-praying-hands text-4xl opacity-50"></i>
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
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">ID</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">이메일</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">이름</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">교회</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">역할</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">게시물</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">가입일</th>
                                <th class="px-4 py-3 text-left text-sm font-semibold text-gray-600">작업</th>
                            </tr>
                        </thead>
                        <tbody id="usersTableBody" class="divide-y divide-gray-200">
                            <!-- Users will be loaded here -->
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
                    document.getElementById('totalPrayers').textContent = response.data.prayers;
                } catch (error) {
                    console.error('Failed to load stats:', error);
                    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
                        alert('관리자 권한이 필요합니다.');
                        window.location.href = '/';
                    }
                }
            }

            async function loadUsers() {
                try {
                    const response = await axios.get('/api/admin/users', {
                        headers: { 'X-Admin-ID': adminId }
                    });
                    
                    const tbody = document.getElementById('usersTableBody');
                    tbody.innerHTML = response.data.users.map(user => \`
                        <tr class="hover:bg-gray-50">
                            <td class="px-4 py-3 text-sm">\${user.id}</td>
                            <td class="px-4 py-3 text-sm">\${user.email}</td>
                            <td class="px-4 py-3 text-sm font-semibold">\${user.name}</td>
                            <td class="px-4 py-3 text-sm">\${user.church || '-'}</td>
                            <td class="px-4 py-3 text-sm">
                                <span class="px-2 py-1 rounded-full text-xs \${user.role === 'admin' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}">
                                    \${user.role}
                                </span>
                            </td>
                            <td class="px-4 py-3 text-sm">\${user.post_count}</td>
                            <td class="px-4 py-3 text-sm">\${new Date(user.created_at).toLocaleDateString('ko-KR')}</td>
                            <td class="px-4 py-3 text-sm">
                                \${user.role === 'admin' 
                                    ? '<span class="text-gray-400" title="관리자는 삭제할 수 없습니다"><i class="fas fa-lock"></i></span>' 
                                    : \`<button onclick="deleteUser(\${user.id}, '\${user.role}')" class="text-red-600 hover:text-red-800"><i class="fas fa-trash"></i></button>\`
                                }
                            </td>
                        </tr>
                    \`).join('');
                } catch (error) {
                    console.error('Failed to load users:', error);
                }
            }


            async function createFakeUsers() {
                const count = prompt('생성할 테스트 사용자 수를 입력하세요 (최대 50명):', '10');
                if (!count) return;
                
                try {
                    const response = await axios.post('/api/admin/create-fake-users', 
                        { count: parseInt(count) },
                        { headers: { 'X-Admin-ID': adminId } }
                    );
                    alert(\`\${response.data.count}명의 테스트 사용자가 생성되었습니다.\`);
                    loadStats();
                    loadUsers();
                } catch (error) {
                    console.error('Failed to create fake users:', error);
                    alert('테스트 사용자 생성에 실패했습니다.');
                }
            }

            async function deleteFakeUsers() {
                if (!confirm('모든 테스트 사용자를 삭제하시겠습니까?')) return;
                
                try {
                    const response = await axios.delete('/api/admin/delete-fake-users', {
                        headers: { 'X-Admin-ID': adminId }
                    });
                    alert(\`\${response.data.deleted_count}명의 테스트 사용자가 삭제되었습니다.\`);
                    loadStats();
                    loadUsers();
                } catch (error) {
                    console.error('Failed to delete fake users:', error);
                    alert('테스트 사용자 삭제에 실패했습니다.');
                }
            }

            async function deleteUser(userId, userRole) {
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


            // Initialize
            if (!adminId) {
                alert('로그인이 필요합니다.');
                window.location.href = '/';
            } else {
                loadStats();
                loadUsers();
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
                    <div class="flex flex-col">
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
                        <div class="bg-gradient-to-r from-blue-50 to-blue-100 px-4 py-2 rounded-lg border-2 border-blue-300">
                            <div class="flex items-center space-x-2">
                                <i class="fas fa-bible text-blue-600"></i>
                                <span class="text-sm font-semibold text-blue-800">성경 점수:</span>
                                <span id="typingScore" class="text-lg font-bold text-blue-900">0</span>
                            </div>
                        </div>
                        <button onclick="showLoginModal()" class="text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-100 transition">
                            로그인
                        </button>
                        <button onclick="showSignupModal()" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition">
                            회원가입
                        </button>
                    </div>
                    <div class="flex items-center space-x-4 hidden" id="userMenu">
                        <div id="scriptureScoreBtn" class="bg-gradient-to-r from-blue-50 to-blue-100 px-4 py-2 rounded-lg border-2 border-blue-300">
                            <div class="flex items-center space-x-2">
                                <i class="fas fa-bible text-blue-600"></i>
                                <span class="text-sm font-semibold text-blue-800">성경 점수:</span>
                                <span id="typingScoreUser" class="text-lg font-bold text-blue-900">0</span>
                            </div>
                        </div>
                        <button onclick="goToAdmin()" id="adminPanelBtn" class="hidden text-red-600 hover:text-red-800 px-3 py-2 rounded-lg hover:bg-red-50 transition" title="관리자 패널">
                            <i class="fas fa-shield-alt mr-1"></i>
                            <span class="hidden md:inline">관리자 모드</span>
                        </button>
                        <div class="relative">
                            <div class="flex items-center space-x-3 bg-gray-100 px-4 py-2 rounded-lg cursor-pointer hover:bg-gray-200 transition" onclick="toggleProfileMenu()">
                                <div class="admin-badge-container">
                                    <div id="userAvatarContainer" class="w-8 h-8 rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white text-sm flex-shrink-0">
                                        <i class="fas fa-user"></i>
                                    </div>
                                    <!-- Admin/Moderator badge will be added here dynamically -->
                                </div>
                                <span id="userName" class="text-gray-800 font-medium whitespace-nowrap"></span>
                                <i class="fas fa-chevron-down text-gray-500 text-xs"></i>
                            </div>
                            <!-- Profile Dropdown Menu -->
                            <div id="profileMenu" class="hidden absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                                <button onclick="showViewProfileModal(); toggleProfileMenu();" class="w-full text-left px-4 py-3 hover:bg-gray-50 transition flex items-center">
                                    <i class="fas fa-user-circle text-blue-600 mr-3"></i>
                                    <span>내 프로필 보기</span>
                                </button>
                                <hr class="my-1">
                                <button onclick="logout()" class="w-full text-left px-4 py-3 hover:bg-gray-50 transition flex items-center text-red-600">
                                    <i class="fas fa-sign-out-alt mr-3"></i>
                                    <span>로그아웃</span>
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
                                <p class="font-bold text-blue-600 mb-2">요한복음 3:16</p>
                                <p id="verseText" class="text-gray-800 leading-relaxed">
                                    하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니 이는 그를 믿는 자마다 멸망하지 않고 영생을 얻게 하려 하심이라
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
                    
                        <!-- Today's Sermon Section -->
                        <div class="bg-white rounded-xl shadow-md border-2 border-gray-300 p-6 transition-all duration-300 hover:shadow-lg hover:border-gray-500">
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
                                <!-- Login Required Overlay -->
                                <div id="videoLoginOverlay" class="hidden absolute top-0 left-0 w-full h-full bg-black bg-opacity-70 rounded-lg flex items-center justify-center cursor-not-allowed z-10" title="로그인 필요">
                                    <div class="text-center text-white">
                                        <i class="fas fa-lock text-4xl mb-2"></i>
                                        <p class="text-base font-semibold">로그인 필요</p>
                                    </div>
                                </div>
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

                <!-- Main Feed -->
                <div class="lg:col-span-2 space-y-4">
                    <!-- New Post Card -->
                    <div id="newPostCard" class="bg-white rounded-xl shadow-md border-2 border-gray-300 p-6 transition-all duration-300 hover:shadow-lg hover:border-gray-500">
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
                                            id="prayerRequestBtn"
                                            onclick="togglePrayerRequest()"
                                            class="bg-purple-100 text-purple-700 px-4 py-2 rounded-lg hover:bg-purple-200 transition border-2 border-transparent"
                                            title="기도부탁으로 전환">
                                            <i class="fas fa-praying-hands mr-2"></i>기도부탁
                                        </button>
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
                            <option value="구도자">구도자</option>
                            <option value="새가족">새가족</option>
                            <option value="잘모름">잘모름</option>
                            <option value="기타">기타</option>
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
        <script src="/static/app_new.js?v=1769019838"></script>
    </body>
    </html>
  `)
})


export default app
