-- Reset all scores to 0 first
UPDATE users SET scripture_score = 0, prayer_score = 0, activity_score = 0;

-- Calculate and add scores for each user based on their posts

-- 중보 포스팅: 기도점수 +10점
UPDATE users
SET prayer_score = prayer_score + (
    SELECT COUNT(*) * 10
    FROM posts
    WHERE posts.user_id = users.id
    AND posts.background_color = '#F87171'
);

-- 말씀 포스팅: 성경점수 +10점
UPDATE users
SET scripture_score = scripture_score + (
    SELECT COUNT(*) * 10
    FROM posts
    WHERE posts.user_id = users.id
    AND posts.background_color = '#F5E398'
);

-- 일상 포스팅: 활동점수 +10점
UPDATE users
SET activity_score = activity_score + (
    SELECT COUNT(*) * 10
    FROM posts
    WHERE posts.user_id = users.id
    AND posts.background_color = '#F5D4B3'
);

-- 사역 포스팅: 활동점수 +10점
UPDATE users
SET activity_score = activity_score + (
    SELECT COUNT(*) * 10
    FROM posts
    WHERE posts.user_id = users.id
    AND posts.background_color = '#B3EDD8'
);

-- 찬양 포스팅: 활동점수 +10점
UPDATE users
SET activity_score = activity_score + (
    SELECT COUNT(*) * 10
    FROM posts
    WHERE posts.user_id = users.id
    AND posts.background_color = '#C4E5F8'
);

-- 교회 포스팅: 활동점수 +10점
UPDATE users
SET activity_score = activity_score + (
    SELECT COUNT(*) * 10
    FROM posts
    WHERE posts.user_id = users.id
    AND posts.background_color = '#E2DBFB'
);

-- 자유 포스팅: 활동점수 +10점
UPDATE users
SET activity_score = activity_score + (
    SELECT COUNT(*) * 10
    FROM posts
    WHERE posts.user_id = users.id
    AND posts.background_color = '#FFFFFF'
);

-- Add scores for prayer clicks (중보 반응버튼: 기도점수 +20점)
UPDATE users
SET prayer_score = prayer_score + (
    SELECT COUNT(*) * 20
    FROM prayer_clicks
    WHERE prayer_clicks.user_id = users.id
);

-- Add scores for likes on 말씀 posts (성경점수 +1점)
UPDATE users
SET scripture_score = scripture_score + (
    SELECT COUNT(*) * 1
    FROM likes
    JOIN posts ON likes.post_id = posts.id
    WHERE likes.user_id = users.id
    AND posts.background_color = '#F5E398'
);

-- Add scores for likes on other posts (활동점수 +1점)
UPDATE users
SET activity_score = activity_score + (
    SELECT COUNT(*) * 1
    FROM likes
    JOIN posts ON likes.post_id = posts.id
    WHERE likes.user_id = users.id
    AND posts.background_color IN ('#F5D4B3', '#B3EDD8', '#C4E5F8', '#E2DBFB', '#FFFFFF')
);

-- Add scores for comments (댓글 작성: 활동점수 +5점)
UPDATE users
SET activity_score = activity_score + (
    SELECT COUNT(*) * 5
    FROM comments
    WHERE comments.user_id = users.id
);

-- Show results
SELECT id, name, scripture_score, prayer_score, activity_score, 
       (scripture_score + prayer_score + activity_score) as total_score
FROM users
WHERE scripture_score > 0 OR prayer_score > 0 OR activity_score > 0
ORDER BY total_score DESC;
