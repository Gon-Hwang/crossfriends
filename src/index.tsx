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
  const user = await DB.prepare('SELECT id, email, name, bio, avatar_url, church, denomination, location, created_at FROM users WHERE id = ?').bind(id).first()
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }
  
  return c.json({ user })
})

// Create new user
app.post('/api/users', async (c) => {
  const { DB } = c.env
  const { email, name, bio, church, denomination, location } = await c.req.json()
  
  const result = await DB.prepare(
    'INSERT INTO users (email, name, bio, church, denomination, location) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(email, name, bio || null, church || null, denomination || null, location || null).run()
  
  return c.json({ id: result.meta.last_row_id, email, name }, 201)
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
        <title>Crossfriends - 기독교인 소셜 네트워크</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-50">
        <!-- Header -->
        <nav class="bg-white shadow-md sticky top-0 z-50">
            <div class="max-w-7xl mx-auto px-4 py-3">
                <div class="flex justify-between items-center">
                    <div class="flex items-center space-x-2">
                        <i class="fas fa-cross text-blue-600 text-2xl"></i>
                        <h1 class="text-2xl font-bold text-gray-800">Crossfriends</h1>
                    </div>
                    <div class="flex items-center space-x-4">
                        <button onclick="showPrayerModal()" class="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition">
                            <i class="fas fa-praying-hands mr-2"></i>기도 요청
                        </button>
                        <div class="relative">
                            <select id="userSelect" class="bg-gray-100 px-4 py-2 rounded-lg appearance-none pr-8">
                                <option value="1">John Kim</option>
                                <option value="2">Sarah Park</option>
                                <option value="3">David Lee</option>
                                <option value="4">Grace Choi</option>
                            </select>
                            <i class="fas fa-chevron-down absolute right-3 top-3 text-gray-600 pointer-events-none"></i>
                        </div>
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
                            <i class="fas fa-fire text-orange-500 mr-2"></i>인기 성경 구절
                        </h3>
                        <div class="space-y-3 text-sm text-gray-600">
                            <div class="border-l-4 border-blue-500 pl-3">
                                <p class="font-semibold">시편 23:1</p>
                                <p class="text-xs">여호와는 나의 목자시니...</p>
                            </div>
                            <div class="border-l-4 border-green-500 pl-3">
                                <p class="font-semibold">요한복음 3:16</p>
                                <p class="text-xs">하나님이 세상을 이처럼 사랑하사...</p>
                            </div>
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
                                <input 
                                    id="verseReference"
                                    type="text"
                                    placeholder="성경 구절 (예: 시편 23:1)"
                                    class="w-full mt-2 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                />
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

                    <!-- Prayer Requests Section -->
                    <div class="bg-gradient-to-r from-purple-500 to-purple-700 rounded-lg shadow p-6 text-white">
                        <h3 class="text-xl font-bold mb-4">
                            <i class="fas fa-praying-hands mr-2"></i>기도 제목
                        </h3>
                        <div id="prayersList" class="space-y-3">
                            <!-- Prayer requests will be loaded here -->
                        </div>
                    </div>

                    <!-- Posts Feed -->
                    <div id="postsFeed" class="space-y-4">
                        <!-- Posts will be loaded here -->
                    </div>
                </div>
            </div>
        </div>

        <!-- Prayer Modal -->
        <div id="prayerModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold text-gray-800">
                        <i class="fas fa-praying-hands text-purple-600 mr-2"></i>기도 요청 작성
                    </h3>
                    <button onclick="hidePrayerModal()" class="text-gray-500 hover:text-gray-700">
                        <i class="fas fa-times text-xl"></i>
                    </button>
                </div>
                <input 
                    id="prayerTitle"
                    type="text"
                    placeholder="기도 제목"
                    class="w-full mb-3 p-3 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none"
                />
                <textarea 
                    id="prayerContent"
                    placeholder="기도 내용을 작성해주세요"
                    class="w-full mb-3 p-3 border rounded-lg resize-none focus:ring-2 focus:ring-purple-500 focus:outline-none"
                    rows="4"
                ></textarea>
                <label class="flex items-center mb-4 text-sm text-gray-600">
                    <input id="prayerAnonymous" type="checkbox" class="mr-2">
                    익명으로 게시
                </label>
                <button 
                    onclick="createPrayer()"
                    class="w-full bg-purple-600 text-white py-3 rounded-lg hover:bg-purple-700 transition">
                    기도 요청 올리기
                </button>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
            let currentUserId = 1;

            // Update current user
            document.getElementById('userSelect').addEventListener('change', (e) => {
                currentUserId = parseInt(e.target.value);
                loadPosts();
            });

            // Prayer modal functions
            function showPrayerModal() {
                document.getElementById('prayerModal').classList.remove('hidden');
            }

            function hidePrayerModal() {
                document.getElementById('prayerModal').classList.add('hidden');
                document.getElementById('prayerTitle').value = '';
                document.getElementById('prayerContent').value = '';
                document.getElementById('prayerAnonymous').checked = false;
            }

            // Create new prayer
            async function createPrayer() {
                const title = document.getElementById('prayerTitle').value;
                const content = document.getElementById('prayerContent').value;
                const isAnonymous = document.getElementById('prayerAnonymous').checked;

                if (!title || !content) {
                    alert('제목과 내용을 입력해주세요.');
                    return;
                }

                try {
                    await axios.post('/api/prayers', {
                        user_id: currentUserId,
                        title,
                        content,
                        is_anonymous: isAnonymous
                    });
                    hidePrayerModal();
                    loadPrayers();
                    alert('기도 요청이 등록되었습니다.');
                } catch (error) {
                    console.error('Error creating prayer:', error);
                    alert('기도 요청 등록에 실패했습니다.');
                }
            }

            // Create new post
            async function createPost() {
                const content = document.getElementById('newPostContent').value;
                const verseReference = document.getElementById('verseReference').value;

                if (!content) {
                    alert('내용을 입력해주세요.');
                    return;
                }

                try {
                    await axios.post('/api/posts', {
                        user_id: currentUserId,
                        content,
                        verse_reference: verseReference || null
                    });
                    document.getElementById('newPostContent').value = '';
                    document.getElementById('verseReference').value = '';
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
                                    class="flex-1 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                />
                                <button 
                                    onclick="createComment(\${postId})"
                                    class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm">
                                    <i class="fas fa-paper-plane"></i>
                                </button>
                            </div>
                        </div>
                        \`;
                        
                        commentsDiv.innerHTML = html;
                        commentsDiv.classList.remove('hidden');
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
                                            <div class="mt-3 bg-blue-50 border-l-4 border-blue-500 p-3 rounded">
                                                <p class="text-sm text-blue-800 font-semibold">
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
                                            <button class="flex items-center space-x-2 hover:text-green-600 transition">
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

            // Load prayers
            async function loadPrayers() {
                try {
                    const response = await axios.get('/api/prayers?status=active');
                    const prayers = response.data.prayers;
                    const prayersList = document.getElementById('prayersList');
                    
                    let html = '';
                    prayers.slice(0, 3).forEach(prayer => {
                        const displayName = prayer.is_anonymous ? '익명' : prayer.user_name;
                        html += \`
                            <div class="bg-white bg-opacity-20 rounded-lg p-4 backdrop-blur">
                                <div class="flex justify-between items-start mb-2">
                                    <h4 class="font-semibold text-white">\${prayer.title}</h4>
                                    <span class="text-xs bg-white bg-opacity-30 px-2 py-1 rounded">\${prayer.responses_count || 0} 응답</span>
                                </div>
                                <p class="text-sm text-white text-opacity-90 line-clamp-2">\${prayer.content}</p>
                                <div class="mt-2 flex justify-between items-center text-xs text-white text-opacity-80">
                                    <span>\${displayName}</span>
                                    <span>\${formatDate(prayer.created_at)}</span>
                                </div>
                            </div>
                        \`;
                    });
                    
                    prayersList.innerHTML = html;
                } catch (error) {
                    console.error('Error loading prayers:', error);
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
            loadPosts();
            loadPrayers();
        </script>
    </body>
    </html>
  `)
})

export default app
