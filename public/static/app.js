
let currentUserId = null;
let currentUser = null;
let selectedBackgroundColor = null; // 선택된 배경색

// =====================
// Modal Functions
// =====================

// Show login modal
function showLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    } else {
        console.error('Login modal not found');
    }
}

// Hide login modal
function hideLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

// Show signup modal
function showSignupModal() {
    // Hide login modal if open
    hideLoginModal();
    
    const modal = document.getElementById('signupModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    } else {
        console.error('Signup modal not found');
    }
}

// Hide signup modal
function hideSignupModal() {
    const modal = document.getElementById('signupModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

// Show edit profile modal
function showEditProfileModal() {
    const modal = document.getElementById('editProfileModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        // Load current user data
        loadEditProfileData();
    }
}

// Hide edit profile modal
function hideEditProfileModal() {
    const modal = document.getElementById('editProfileModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

// =====================
// Bible Verses Rotation
// =====================
const bibleVerses = [
    {
        reference: "요한복음 3:16",
        text: "하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니 이는 그를 믿는 자마다 멸망하지 않고 영생을 얻게 하려 하심이라"
    },
    {
        reference: "시편 23:1",
        text: "여호와는 나의 목자시니 내게 부족함이 없으리로다"
    },
    {
        reference: "빌립보서 4:13",
        text: "내게 능력 주시는 자 안에서 내가 모든 것을 할 수 있느니라"
    },
    {
        reference: "로마서 8:28",
        text: "우리가 알거니와 하나님을 사랑하는 자 곧 그의 뜻대로 부르심을 입은 자들에게는 모든 것이 합력하여 선을 이루느니라"
    },
    {
        reference: "잠언 3:5-6",
        text: "너는 마음을 다하여 여호와를 신뢰하고 네 명철을 의지하지 말라 너는 범사에 그를 인정하라 그리하면 네 길을 지도하시리라"
    },
    {
        reference: "이사야 40:31",
        text: "오직 여호와를 앙망하는 자는 새 힘을 얻으리니 독수리가 날개치며 올라감 같을 것이요 달음박질하여도 곤비하지 아니하겠고 걸어가도 피곤하지 아니하리로다"
    },
    {
        reference: "마태복음 11:28",
        text: "수고하고 무거운 짐 진 자들아 다 내게로 오라 내가 너희를 쉬게 하리라"
    },
    {
        reference: "시편 46:1",
        text: "하나님은 우리의 피난처시요 힘이시니 환난 중에 만날 큰 도움이시라"
    },
    {
        reference: "고린도후서 5:17",
        text: "그런즉 누구든지 그리스도 안에 있으면 새로운 피조물이라 이전 것은 지나갔으니 보라 새 것이 되었도다"
    },
    {
        reference: "요한복음 14:6",
        text: "예수께서 이르시되 내가 곧 길이요 진리요 생명이니 나로 말미암지 않고는 아버지께로 올 자가 없느니라"
    },
    {
        reference: "시편 119:105",
        text: "주의 말씀은 내 발에 등이요 내 길에 빛이니이다"
    },
    {
        reference: "예레미야 29:11",
        text: "여호와의 말씀이니라 너희를 향한 나의 생각을 내가 아나니 평안이요 재앙이 아니니라 너희에게 미래와 희망을 주는 것이니라"
    }
];

let currentVerseIndex = 0;

// Rotate bible verse
function rotateBibleVerse() {
    currentVerseIndex = (currentVerseIndex + 1) % bibleVerses.length;
    const verse = bibleVerses[currentVerseIndex];
    
    // Update verse reference
    const verseRefElement = document.getElementById('verseReference');
    if (verseRefElement) {
        verseRefElement.textContent = verse.reference;
    }
    
    // Update verse text with fade animation
    const verseTextElement = document.getElementById('verseText');
    if (verseTextElement) {
        // Fade out
        verseTextElement.style.opacity = '0';
        verseTextElement.style.transition = 'opacity 0.5s ease-in-out';
        
        setTimeout(() => {
            verseTextElement.textContent = verse.text;
            // Fade in
            verseTextElement.style.opacity = '1';
        }, 500);
    }
    
    console.log('성경 구절 변경:', verse.reference);
}

// Start bible verse rotation (every 5 minutes = 300000ms)
setInterval(rotateBibleVerse, 5 * 60 * 1000);

// =====================
// YouTube Video Tracking
// =====================
let player;
let videoCheckInterval;
let maxWatchedTime = 0;
let videoDuration = 0;
const CURRENT_VIDEO_ID = 'u13qcd4AePQ';
let completedVideos = new Set();
let lastCheckedTime = 0;

// Load YouTube IFrame API
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

// Called automatically when YouTube API is ready
function onYouTubeIframeAPIReady() {
    player = new YT.Player('sermonPlayer', {
        height: '100%',
        width: '100%',
        videoId: CURRENT_VIDEO_ID,
        playerVars: {
            'playsinline': 1,
            'rel': 0,
            'modestbranding': 1
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

// Player is ready
function onPlayerReady(event) {
    videoDuration = player.getDuration();
    console.log('Video duration:', videoDuration);
    
    // Check if video already completed
    if (completedVideos.has(CURRENT_VIDEO_ID)) {
        showVideoAlreadyCompleted();
    }
}

// Player state changed (playing, paused, ended, etc.)
function onPlayerStateChange(event) {
    if (event.data == YT.PlayerState.PLAYING) {
        // Show progress container when playing
        document.getElementById('videoProgressContainer').classList.remove('hidden');
        
        // Start tracking progress
        startVideoTracking();
    } else if (event.data == YT.PlayerState.PAUSED || event.data == YT.PlayerState.ENDED) {
        // Stop tracking
        stopVideoTracking();
        
        // Check completion on ended
        if (event.data == YT.PlayerState.ENDED) {
            checkVideoCompletion();
        }
    }
}

// Start tracking video progress
function startVideoTracking() {
    if (videoCheckInterval) {
        clearInterval(videoCheckInterval);
    }
    
    videoCheckInterval = setInterval(() => {
        if (player && player.getCurrentTime) {
            const currentTime = player.getCurrentTime();
            
            // Update max watched time
            if (currentTime > maxWatchedTime) {
                maxWatchedTime = currentTime;
            }
            
            lastCheckedTime = currentTime;
            
            // Update progress bar
            updateVideoProgress();
        }
    }, 1000);
}

// Stop tracking video progress
function stopVideoTracking() {
    if (videoCheckInterval) {
        clearInterval(videoCheckInterval);
        videoCheckInterval = null;
    }
}

// Update video progress display
function updateVideoProgress() {
    if (!videoDuration || videoDuration === 0) return;
    
    const progressPercent = Math.min((maxWatchedTime / videoDuration) * 100, 100);
    const progressBar = document.getElementById('videoProgressBar');
    const progressPercentText = document.getElementById('videoProgressPercent');
    
    if (progressBar) {
        progressBar.style.width = progressPercent + '%';
    }
    if (progressPercentText) {
        progressPercentText.textContent = Math.round(progressPercent) + '%';
    }
    
    // Auto-check completion when reaching 90%+
    if (progressPercent >= 90 && !completedVideos.has(CURRENT_VIDEO_ID)) {
        checkVideoCompletion();
    }
}

// Check if video is completed (90%+ watched)
async function checkVideoCompletion() {
    if (!videoDuration || videoDuration === 0) return;
    
    const watchedPercent = (maxWatchedTime / videoDuration) * 100;
    
    console.log('Checking completion:', {
        maxWatchedTime,
        videoDuration,
        watchedPercent,
        alreadyCompleted: completedVideos.has(CURRENT_VIDEO_ID)
    });
    
    // Check if already completed this video (client-side check)
    if (completedVideos.has(CURRENT_VIDEO_ID)) {
        showVideoAlreadyCompleted();
        return;
    }
    
    // 90% or more = completed
    if (watchedPercent >= 90) {
        // Save video completion to server
        const result = await saveVideoScore(CURRENT_VIDEO_ID);
        
        // Server will tell us if it was already completed
        if (result && result.already_completed) {
            showVideoAlreadyCompleted();
            return;
        }
        
        // Mark as completed locally
        completedVideos.add(CURRENT_VIDEO_ID);
        
        // Show reward with actual points earned from server
        const pointsEarned = result ? result.points_earned : 100;
        const totalScore = result ? result.scripture_score : (videoScore + 100);
        
        showVideoCompletionReward(pointsEarned, typingScore + totalScore);
        
        // Stop tracking
        stopVideoTracking();
    }
}

// Show video completion reward
function showVideoCompletionReward(points, totalScore) {
    const resultDiv = document.getElementById('videoCompletionResult');
    
    resultDiv.innerHTML = `
        <div class="bg-green-50 border-2 border-green-600 rounded-lg p-4">
            <div class="flex items-center justify-between mb-2">
                <div class="flex items-center space-x-2">
                    <i class="fas fa-check-circle text-green-600 text-xl"></i>
                    <span class="font-bold text-green-600">설교 시청 완료! 🎉</span>
                </div>
                <span class="text-sm text-gray-600">시청률: <strong>${Math.round((maxWatchedTime / videoDuration) * 100)}%</strong></span>
            </div>
            <div class="text-sm text-gray-700">
                <p class="mb-1">획득 점수: <strong class="text-green-600">+${points}점</strong></p>
                <p>총 성경 점수: <strong class="text-blue-600">${totalScore}점</strong></p>
            </div>
            <p class="text-xs text-gray-500 mt-2">
                <i class="fas fa-heart mr-1"></i>말씀을 끝까지 들으셨습니다. 은혜가 충만하시길!
            </p>
        </div>
    `;
    
    resultDiv.classList.remove('hidden');
    
    // Hide progress container
    document.getElementById('videoProgressContainer').classList.add('hidden');
}

// Show already completed message
function showVideoAlreadyCompleted() {
    const resultDiv = document.getElementById('videoCompletionResult');
    
    // Hide the message - no need to show already completed status
    resultDiv.classList.add('hidden');
}

// =====================
// Typing Game Functions
// =====================
let typingScore = 0;
let videoScore = 0;
let prayerScore = 0;
let activityScore = 0; // Activity score based on user engagement
let completedVerses = new Set(); // Track completed verses

// Load user scores from API
async function loadUserScores() {
    if (!currentUserId) {
        console.log('No user logged in, using localStorage');
        // Fallback to localStorage if not logged in
        const savedScore = localStorage.getItem('typingScore');
        typingScore = savedScore ? parseInt(savedScore) : 0;
        
        const savedPrayerScore = localStorage.getItem('prayerScore');
        prayerScore = savedPrayerScore ? parseInt(savedPrayerScore) : 0;
        
        const savedVerses = localStorage.getItem('completedVerses');
        if (savedVerses) {
            completedVerses = new Set(JSON.parse(savedVerses));
        }
        
        const savedVideos = localStorage.getItem('completedVideos');
        if (savedVideos) {
            completedVideos = new Set(JSON.parse(savedVideos));
        }
        
        activityScore = 0; // Not logged in, no activity score
        
        updateTypingScoreDisplay();
        return;
    }
    
    try {
        const response = await axios.get(`/api/users/${currentUserId}/scores`);
        const data = response.data;
        
        typingScore = data.scripture_score || 0;
        videoScore = 0; // Video score is already included in scripture_score
        prayerScore = data.prayer_score || 0;
        activityScore = data.activity_score || 0;
        
        // Load completed videos
        if (data.completed_videos && Array.isArray(data.completed_videos)) {
            completedVideos = new Set(data.completed_videos);
        }
        
        // Load completed verses
        if (data.completed_verses && Array.isArray(data.completed_verses)) {
            completedVerses = new Set(data.completed_verses);
        }
        
        updateTypingScoreDisplay();
        
        // Check if current video is already completed
        if (completedVideos.has(CURRENT_VIDEO_ID)) {
            showVideoAlreadyCompleted();
        }
    } catch (error) {
        console.error('Failed to load user scores:', error);
    }
}

// Calculate activity score based on user engagement (deprecated - now tracked directly)
async function calculateActivityScore() {
    // Activity score is now tracked directly in the database
    // No need to calculate from posts
    return;
}

// Save typing score to API
async function saveTypingScore(score) {
    typingScore = score;
    updateTypingScoreDisplay();
    
    if (!currentUserId) {
        // Fallback to localStorage if not logged in
        localStorage.setItem('typingScore', score.toString());
        localStorage.setItem('completedVerses', JSON.stringify([...completedVerses]));
        return;
    }
    
    try {
        await axios.post(`/api/users/${currentUserId}/scores/typing`, { 
            score,
            completed_verses: [...completedVerses]
        });
    } catch (error) {
        console.error('Failed to save typing score:', error);
    }
}

// Save video score to API
async function saveVideoScore(videoId) {
    if (!currentUserId) {
        // Fallback to localStorage if not logged in
        localStorage.setItem('completedVideos', JSON.stringify([...completedVideos]));
        return null;
    }
    
    try {
        const response = await axios.post(`/api/users/${currentUserId}/scores/video`, { 
            video_id: videoId 
        });
        
        // Update local score with the response
        videoScore = response.data.scripture_score;
        updateTypingScoreDisplay();
        
        // Show notification
        if (response.data.already_completed) {
            showToast(response.data.message, 'warning');
        } else {
            showToast(`${response.data.message} (총 ${response.data.scripture_score}점)`, 'success');
        }
        
        return response.data;
    } catch (error) {
        console.error('Failed to save video score:', error);
        showToast('점수 저장에 실패했습니다.', 'error');
        return null;
    }
}

// Toggle typing area visibility
function toggleTypingArea() {
    // Check if user is logged in
    if (!currentUserId) {
        // Do nothing when not logged in, tooltip will show the message
        return;
    }
    
    const typingArea = document.getElementById('typingArea');
    const toggleIcon = document.getElementById('typingToggleIcon');
    
    console.log('Toggle clicked', typingArea, toggleIcon);
    
    if (!typingArea || !toggleIcon) {
        console.error('Elements not found:', { typingArea, toggleIcon });
        return;
    }
    
    if (typingArea.classList.contains('hidden')) {
        typingArea.classList.remove('hidden');
        toggleIcon.classList.remove('fa-chevron-down');
        toggleIcon.classList.add('fa-chevron-up');
        console.log('Opened typing area');
    } else {
        typingArea.classList.add('hidden');
        toggleIcon.classList.remove('fa-chevron-up');
        toggleIcon.classList.add('fa-chevron-down');
        console.log('Closed typing area');
    }
}

// Update typing score display in header
function updateTypingScoreDisplay() {
    const totalScore = typingScore + videoScore;
    const scoreElement = document.getElementById('typingScore');
    const scoreUserElement = document.getElementById('typingScoreUser');
    const prayerScoreElement = document.getElementById('prayerScore');
    const prayerScoreUserElement = document.getElementById('prayerScoreUser');
    const activityScoreElement = document.getElementById('activityScore');
    const activityScoreUserElement = document.getElementById('activityScoreUser');
    
    if (scoreElement) {
        scoreElement.textContent = totalScore;
    }
    if (scoreUserElement) {
        scoreUserElement.textContent = totalScore;
    }
    if (prayerScoreElement) {
        prayerScoreElement.textContent = prayerScore;
    }
    if (prayerScoreUserElement) {
        prayerScoreUserElement.textContent = prayerScore;
    }
    if (activityScoreElement) {
        activityScoreElement.textContent = activityScore;
    }
    if (activityScoreUserElement) {
        activityScoreUserElement.textContent = activityScore;
    }
}

// Add prayer points for a post (10 points per click)
async function addPrayerForPost(postId) {
    if (!currentUserId) {
        alert('로그인이 필요합니다.');
        showLoginModal();
        return;
    }
    
    const pointsToAdd = 10;
    
    try {
        const response = await axios.post(`/api/users/${currentUserId}/scores/prayer`, {
            points: pointsToAdd
        });
        
        prayerScore = response.data.prayer_score;
        updateTypingScoreDisplay();
        
        // Save to localStorage as backup
        localStorage.setItem('prayerScore', prayerScore.toString());
        
        // Show success message
        const successMsg = document.createElement('div');
        successMsg.className = 'fixed top-20 right-4 bg-purple-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in';
        successMsg.innerHTML = '<i class="fas fa-praying-hands mr-2"></i>기도하셨습니다! +10점';
        document.body.appendChild(successMsg);
        
        setTimeout(() => {
            successMsg.remove();
        }, 2000);
        
    } catch (error) {
        console.error('Failed to add prayer points:', error);
        alert('기도 점수 추가에 실패했습니다.');
    }
}

// Add prayer points (10 points per click) - kept for backward compatibility
async function addPrayerPoints() {
    if (!currentUserId) {
        alert('로그인이 필요합니다.');
        return;
    }
    
    const pointsToAdd = 10;
    
    try {
        const response = await axios.post(`/api/users/${currentUserId}/scores/prayer`, {
            points: pointsToAdd
        });
        
        prayerScore = response.data.prayer_score;
        updateTypingScoreDisplay();
        
        // Save to localStorage as backup
        localStorage.setItem('prayerScore', prayerScore.toString());
        
        // Show success animation
        const btn = document.getElementById('prayerBtn');
        if (btn) {
            btn.classList.add('animate-pulse');
            
            // Show floating +10 animation
            showFloatingScore(btn, '+10');
            
            setTimeout(() => {
                btn.classList.remove('animate-pulse');
            }, 500);
        }
        
    } catch (error) {
        console.error('Failed to add prayer points:', error);
        alert('기도 점수 추가에 실패했습니다.');
    }
}

// Show floating score animation
function showFloatingScore(element, text) {
    const floatingDiv = document.createElement('div');
    floatingDiv.textContent = text;
    floatingDiv.style.cssText = `
        position: fixed;
        left: ${element.getBoundingClientRect().left + element.offsetWidth / 2}px;
        top: ${element.getBoundingClientRect().top}px;
        color: #9333ea;
        font-weight: bold;
        font-size: 24px;
        pointer-events: none;
        z-index: 9999;
        animation: floatUp 1s ease-out forwards;
    `;
    
    // Add animation keyframes if not exists
    if (!document.getElementById('floatUpStyle')) {
        const style = document.createElement('style');
        style.id = 'floatUpStyle';
        style.textContent = `
            @keyframes floatUp {
                0% { opacity: 1; transform: translateY(0); }
                100% { opacity: 0; transform: translateY(-50px); }
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(floatingDiv);
    
    setTimeout(() => {
        floatingDiv.remove();
    }, 1000);
}


// Calculate similarity between two strings (accuracy)
function calculateAccuracy(original, typed) {
    // Remove extra whitespaces and trim
    const cleanOriginal = original.replace(/\\s+/g, ' ').trim();
    const cleanTyped = typed.replace(/\\s+/g, ' ').trim();
    
    // Calculate Levenshtein distance
    const matrix = [];
    const n = cleanOriginal.length;
    const m = cleanTyped.length;
    
    if (n === 0) return m === 0 ? 100 : 0;
    if (m === 0) return 0;
    
    // Initialize matrix
    for (let i = 0; i <= n; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= m; j++) {
        matrix[0][j] = j;
    }
    
    // Fill matrix
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            const cost = cleanOriginal[i - 1] === cleanTyped[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // deletion
                matrix[i][j - 1] + 1,      // insertion
                matrix[i - 1][j - 1] + cost // substitution
            );
        }
    }
    
    const distance = matrix[n][m];
    const maxLength = Math.max(n, m);
    const accuracy = ((maxLength - distance) / maxLength) * 100;
    
    return Math.round(accuracy);
}

// Handle typing input when Enter is pressed
function handleTypingEnter(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        checkTyping();
    }
}

// Check typing accuracy and update score
function checkTyping() {
    const verseText = document.getElementById('verseText').textContent;
    const typingInput = document.getElementById('typingInput');
    const typingResult = document.getElementById('typingResult');
    const userInput = typingInput.value;
    
    if (!userInput.trim()) {
        alert('성경구절을 입력해주세요!');
        return;
    }
    
    // Create a unique ID for this verse (using the text content)
    const verseId = verseText.trim();
    
    // Check if this verse was already completed
    const isAlreadyCompleted = completedVerses.has(verseId);
    
    // Calculate accuracy
    const accuracy = calculateAccuracy(verseText, userInput);
    
    // Calculate points earned (only 100% accuracy = 100 points, saved permanently)
    let pointsEarned = 0;
    let bonusMessage = '';
    
    if (!isAlreadyCompleted && accuracy === 100) {
        // Only perfect match earns points and marks as completed
        pointsEarned = 100;
        completedVerses.add(verseId);
    } else if (isAlreadyCompleted) {
        bonusMessage = '<p class="text-xs text-gray-500 mt-1"><i class="fas fa-info-circle mr-1"></i>이미 완료한 구절입니다 (점수 미지급)</p>';
    }
    
    // Update total score only if points earned
    const newScore = typingScore + pointsEarned;
    if (pointsEarned > 0) {
        saveTypingScore(newScore);
    }
    
    // Show result with animation
    typingResult.classList.remove('hidden');
    
    let resultColor = 'text-red-600';
    let resultIcon = 'fa-times-circle';
    let resultMessage = '100% 정확해야 점수를 받습니다!';
    
    if (accuracy === 100) {
        if (isAlreadyCompleted) {
            resultColor = 'text-gray-600';
            resultIcon = 'fa-check-circle';
            resultMessage = '이미 완료한 구절입니다';
        } else {
            resultColor = 'text-green-600';
            resultIcon = 'fa-check-circle';
            resultMessage = '완벽합니다! 100점 획득! 🎉';
        }
    } else if (accuracy >= 90) {
        resultColor = 'text-blue-600';
        resultIcon = 'fa-meh';
        resultMessage = '아쉽습니다! 100%를 달성해보세요!';
    } else if (accuracy >= 70) {
        resultColor = 'text-yellow-600';
        resultIcon = 'fa-frown';
        resultMessage = '조금 더 정확하게 입력해주세요!';
    }
    
    typingResult.innerHTML = `
        <div class="bg-gray-50 border-2 border-gray-300 rounded-lg p-3">
            <div class="flex items-center justify-center ${resultColor}">
                <i class="fas ${resultIcon} text-xl mr-2"></i>
                <p class="text-sm font-semibold">${resultMessage}</p>
            </div>
            <p class="text-xs text-gray-600 mt-2 text-center">
                정확도: <strong class="${resultColor}">${accuracy}%</strong>
                ${pointsEarned > 0 ? ` | 획득 점수: <strong class="text-green-600">+${pointsEarned}점</strong>` : ' | 획득 점수: 0점'}
            </p>
            ${bonusMessage}
        </div>
    `;
    
    // Keep the input text until user clicks reset button
    // Don't auto-clear the input field
}

// Reset typing input and result
function resetTyping() {
    document.getElementById('typingInput').value = '';
    document.getElementById('typingResult').classList.add('hidden');
    document.getElementById('typingInput').focus();
}

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
window.showSignupModal = function() {
    document.getElementById('signupModal').classList.remove('hidden');
}

window.hideSignupModal = function() {
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

window.showLoginModal = function() {
    document.getElementById('loginModal').classList.remove('hidden');
}

window.hideLoginModal = function() {
    document.getElementById('loginModal').classList.add('hidden');
    document.getElementById('loginEmail').value = '';
}

// Profile Menu Toggle
function toggleProfileMenu() {
    const menu = document.getElementById('profileMenu');
    menu.classList.toggle('hidden');
}

// Close profile menu when clicking outside
document.addEventListener('click', function(event) {
    const profileMenu = document.getElementById('profileMenu');
    const userMenu = document.getElementById('userMenu');
    
    if (profileMenu && userMenu && !userMenu.contains(event.target)) {
        profileMenu.classList.add('hidden');
    }
});

// View Profile Modal functions
async function showViewProfileModal() {
    if (!currentUser) return;
    
    // Simply call showUserProfileModal with current user's ID
    showUserProfileModal(currentUserId);
}

window.hideViewProfileModal = function() {
    document.getElementById('viewProfileModal').classList.add('hidden');
}

// Edit Profile Modal functions
window.showEditProfileModal = async function() {
    if (!currentUser) return;
    
    try {
        // Fetch latest user data to get faith_answers and privacy_settings
        const response = await axios.get('/api/users/' + currentUserId);
        const user = response.data.user;
        
        // Parse faith answers if exists
        let faithAnswers = {};
        if (user.faith_answers) {
            try {
                faithAnswers = JSON.parse(user.faith_answers);
            } catch (e) {
                console.error('Failed to parse faith_answers:', e);
            }
        }
        
        // Parse privacy settings if exists (default to all public)
        let privacySettings = {
            basic_info: true,
            church_info: true,
            faith_answers: true,
            education_info: true,
            career_info: true,
            scores: true
        };
        if (user.privacy_settings) {
            try {
                const parsed = JSON.parse(user.privacy_settings);
                privacySettings = { ...privacySettings, ...parsed };
            } catch (e) {
                console.error('Failed to parse privacy_settings:', e);
            }
        }
        
        const roleColor = user.role === 'admin' ? 'text-red-600 bg-red-50' : user.role === 'moderator' ? 'text-yellow-600 bg-yellow-50' : 'text-gray-600 bg-gray-50';
        const roleName = user.role === 'admin' ? '관리자' : user.role === 'moderator' ? '운영자' : '일반 사용자';
        
        const content = `
            <form id="editProfileForm" onsubmit="handleEditProfileSubmit(event)" class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <!-- Profile Section -->
                <div class="md:col-span-1">
                    <div class="bg-gray-50 rounded-lg p-6 text-center">
                        <div 
                            class="w-32 h-32 mx-auto rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white text-4xl mb-4 cursor-pointer hover:ring-4 hover:ring-blue-300 transition" 
                            id="editAvatarPreviewInline"
                            onclick="cancelEditProfile()"
                            title="프로필 보기로 돌아가기">
                            ${user.role === 'admin' 
                                ? '<i class="fas fa-crown text-yellow-400"></i>'
                                : user.avatar_url 
                                    ? `<img src="${user.avatar_url}" alt="Profile" class="w-full h-full object-cover" />` 
                                    : '<i class="fas fa-user"></i>'}
                        </div>
                        
                        ${user.role !== 'admin' ? `
                        <div class="space-y-2">
                            <input 
                                type="file" 
                                id="editAvatarInline" 
                                accept="image/*"
                                onchange="previewEditAvatarInline(event)"
                                class="hidden" />
                            <label 
                                for="editAvatarInline"
                                class="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer transition text-sm">
                                <i class="fas fa-upload mr-2"></i>사진 변경
                            </label>
                            <button 
                                type="button"
                                onclick="deleteAvatarInline()"
                                class="block w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm">
                                <i class="fas fa-trash mr-2"></i>사진 삭제
                            </button>
                            <p class="text-xs text-gray-500 mt-2">JPG, PNG 파일 (최대 5MB)</p>
                        </div>
                        ` : ''}
                        
                        <h3 class="text-xl font-bold text-gray-800 mb-2 mt-4">${user.name}</h3>
                        <span class="inline-block px-3 py-1 rounded-full text-sm font-semibold ${roleColor}">
                            ${roleName}
                        </span>
                        <div class="mt-4 text-xs text-gray-500">
                            <p>회원 ID: #${user.id}</p>
                            <p>가입일: ${new Date(user.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                        </div>
                    </div>
                </div>
                
                <!-- Edit Form Section -->
                <div class="md:col-span-2 space-y-4">
                    <!-- Scores Info -->
                    <div class="bg-purple-50 border-l-4 border-purple-600 p-4 rounded">
                        <div class="flex items-center justify-between mb-3">
                            <h4 class="font-semibold text-purple-800">
                                <i class="fas fa-trophy mr-2"></i>나의 점수 <span class="text-xs text-gray-500 font-normal">(읽기 전용)</span>
                            </h4>
                            <label class="flex items-center text-sm cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    id="privacyScores"
                                    ${privacySettings.scores !== false ? 'checked' : ''}
                                    class="mr-2 w-4 h-4 text-purple-600 rounded focus:ring-2 focus:ring-purple-500" />
                                <span class="text-gray-700"><i class="fas fa-eye mr-1"></i>공개</span>
                            </label>
                        </div>
                        <div class="grid grid-cols-3 gap-4">
                            <div class="text-center bg-white p-3 rounded-lg">
                                <div class="flex flex-col items-center">
                                    <i class="fas fa-praying-hands text-purple-600 text-xl mb-2"></i>
                                    <span class="text-xs text-gray-600 mb-1">기도 점수</span>
                                    <span class="text-xl font-bold text-purple-900">${user.prayer_score || 0}</span>
                                </div>
                            </div>
                            <div class="text-center bg-white p-3 rounded-lg">
                                <div class="flex flex-col items-center">
                                    <i class="fas fa-bible text-purple-600 text-xl mb-2"></i>
                                    <span class="text-xs text-gray-600 mb-1">성경 점수</span>
                                    <span class="text-xl font-bold text-purple-900">${user.scripture_score || 0}</span>
                                </div>
                            </div>
                            <div class="text-center bg-white p-3 rounded-lg">
                                <div class="flex flex-col items-center">
                                    <i class="fas fa-chart-line text-purple-600 text-xl mb-2"></i>
                                    <span class="text-xs text-gray-600 mb-1">활동 점수</span>
                                    <span class="text-xl font-bold text-purple-900">${user.activity_score || 0}</span>
                                </div>
                            </div>
                        </div>
                        <p class="text-xs text-gray-500 mt-2 text-center">
                            <i class="fas fa-info-circle mr-1"></i>점수는 활동으로 자동 적립되며 수정할 수 없습니다.
                        </p>
                    </div>
                    
                    <!-- Basic Info -->
                    <div class="bg-blue-50 border-l-4 border-blue-600 p-4 rounded">
                        <div class="flex items-center justify-between mb-3">
                            <h4 class="font-semibold text-blue-800">
                                <i class="fas fa-info-circle mr-2"></i>기본 정보
                            </h4>
                            <label class="flex items-center text-sm cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    id="privacyBasicInfo"
                                    ${privacySettings.basic_info !== false ? 'checked' : ''}
                                    class="mr-2 w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500" />
                                <span class="text-gray-700"><i class="fas fa-eye mr-1"></i>공개</span>
                            </label>
                        </div>
                        <div class="space-y-3">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">이메일 (수정 불가)</label>
                                <input 
                                    type="email" 
                                    value="${user.email || ''}"
                                    disabled
                                    class="w-full p-2 border rounded-lg bg-gray-100 text-gray-600 text-sm" />
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">이름 *</label>
                                <input 
                                    type="text" 
                                    id="editNameInline"
                                    value="${user.name || ''}"
                                    required
                                    class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" />
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">성별</label>
                                <select 
                                    id="editGenderInline"
                                    class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 text-sm">
                                    <option value="">선택</option>
                                    <option value="남성" ${user.gender === '남성' ? 'selected' : ''}>남성</option>
                                    <option value="여성" ${user.gender === '여성' ? 'selected' : ''}>여성</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">결혼</label>
                                <select 
                                    id="editMaritalStatusInline"
                                    class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 text-sm">
                                    <option value="">선택</option>
                                    <option value="single" ${user.marital_status === 'single' ? 'selected' : ''}>미혼</option>
                                    <option value="married" ${user.marital_status === 'married' ? 'selected' : ''}>기혼</option>
                                    <option value="other" ${user.marital_status === 'other' ? 'selected' : ''}>기타</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">전화번호</label>
                                <input 
                                    type="tel" 
                                    id="editPhoneInline"
                                    placeholder="010-1234-5678"
                                    value="${user.phone || ''}"
                                    class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" />
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">주소</label>
                                <input 
                                    type="text" 
                                    id="editAddressInline"
                                    placeholder="서울특별시 강남구..."
                                    value="${user.address || ''}"
                                    class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" />
                            </div>
                        </div>
                    </div>
                    
                    <!-- Church Info -->
                    <div class="bg-green-50 border-l-4 border-green-600 p-4 rounded">
                        <div class="flex items-center justify-between mb-3">
                            <h4 class="font-semibold text-green-800">
                                <i class="fas fa-church mr-2"></i>교회 정보
                            </h4>
                            <label class="flex items-center text-sm cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    id="privacyChurchInfo"
                                    ${privacySettings.church_info !== false ? 'checked' : ''}
                                    class="mr-2 w-4 h-4 text-green-600 rounded focus:ring-2 focus:ring-green-500" />
                                <span class="text-gray-700"><i class="fas fa-eye mr-1"></i>공개</span>
                            </label>
                        </div>
                        <div class="space-y-3">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">소속 교회</label>
                                <input 
                                    type="text" 
                                    id="editChurchInline"
                                    value="${user.church || ''}"
                                    class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-green-500 text-sm" />
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">담임목사</label>
                                <input 
                                    type="text" 
                                    id="editPastorInline"
                                    value="${user.pastor || ''}"
                                    class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-green-500 text-sm" />
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">직분</label>
                                <select 
                                    id="editPositionInline"
                                    class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-green-500 text-sm">
                                    <option value="">선택</option>
                                    <option value="평신도" ${user.position === '평신도' ? 'selected' : ''}>평신도</option>
                                    <option value="새신자" ${user.position === '새신자' ? 'selected' : ''}>새신자</option>
                                    <option value="초신자" ${user.position === '초신자' ? 'selected' : ''}>초신자</option>
                                    <option value="청년부" ${user.position === '청년부' ? 'selected' : ''}>청년부</option>
                                    <option value="장년부" ${user.position === '장년부' ? 'selected' : ''}>장년부</option>
                                    <option value="권사" ${user.position === '권사' ? 'selected' : ''}>권사</option>
                                    <option value="집사" ${user.position === '집사' ? 'selected' : ''}>집사</option>
                                    <option value="안수집사" ${user.position === '안수집사' ? 'selected' : ''}>안수집사</option>
                                    <option value="서리집사" ${user.position === '서리집사' ? 'selected' : ''}>서리집사</option>
                                    <option value="장로" ${user.position === '장로' ? 'selected' : ''}>장로</option>
                                    <option value="전도사" ${user.position === '전도사' ? 'selected' : ''}>전도사</option>
                                    <option value="목사" ${user.position === '목사' ? 'selected' : ''}>목사</option>
                                    <option value="선교사" ${user.position === '선교사' ? 'selected' : ''}>선교사</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Faith Confession -->
                    <div class="bg-yellow-50 border-l-4 border-yellow-600 p-4 rounded">
                        <div class="flex items-center justify-between mb-3">
                            <h4 class="font-semibold text-yellow-800">
                                <i class="fas fa-cross mr-2"></i>신앙 고백
                            </h4>
                            <label class="flex items-center text-sm cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    id="privacyFaithAnswers"
                                    ${privacySettings.faith_answers !== false ? 'checked' : ''}
                                    class="mr-2 w-4 h-4 text-yellow-600 rounded focus:ring-2 focus:ring-yellow-500" />
                                <span class="text-gray-700"><i class="fas fa-eye mr-1"></i>공개</span>
                            </label>
                        </div>
                        <div class="space-y-2 text-sm">
                            ${Array.from({length: 10}, (_, i) => {
                                const questions = [
                                    '1. 예수님이 창조주 하나님임을 믿습니까?',
                                    '2. 십자가 대속을 믿습니까?',
                                    '3. 예수님의 부활을 믿습니까?',
                                    '4. 예수님을 주님으로 영접했습니까?',
                                    '5. 성령님이 계십니까?',
                                    '6. 천국 갈 것을 확신합니까?',
                                    '7. 성경을 진리로 믿습니까?',
                                    '8. 정기적으로 예배에 참석합니까?',
                                    '9. 정기적으로 기도합니까?',
                                    '10. 가끔 전도합니까?'
                                ];
                                const qNum = i + 1;
                                const qKey = 'q' + qNum;
                                return `
                                    <div class="flex items-center justify-between">
                                        <label class="text-gray-700 flex-1">${questions[i]}</label>
                                        <select 
                                            id="editFaithQ${qNum}Inline"
                                            class="ml-3 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-yellow-600">
                                            <option value="">선택</option>
                                            <option value="예" ${faithAnswers[qKey] === '예' ? 'selected' : ''}>예</option>
                                            <option value="아니오" ${faithAnswers[qKey] === '아니오' ? 'selected' : ''}>아니오</option>
                                            <option value="잘모름" ${faithAnswers[qKey] === '잘모름' ? 'selected' : ''}>잘모름</option>
                                        </select>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                    
                    <!-- Career Info -->
                    <div class="bg-purple-50 border-l-4 border-purple-600 p-4 rounded">
                        <div class="flex items-center justify-between mb-3">
                            <h4 class="font-semibold text-purple-800">
                                <i class="fas fa-briefcase mr-2"></i>직업 정보 <span class="text-xs text-gray-500 font-normal">(선택사항)</span>
                            </h4>
                            <label class="flex items-center text-sm cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    id="privacyCareerInfo"
                                    ${privacySettings.career_info !== false ? 'checked' : ''}
                                    class="mr-2 w-4 h-4 text-purple-600 rounded focus:ring-2 focus:ring-purple-500" />
                                <span class="text-gray-700"><i class="fas fa-eye mr-1"></i>공개</span>
                            </label>
                        </div>
                        <div class="space-y-3">
                            <div>
                                <div class="flex items-center justify-between mb-2">
                                    <label class="block text-sm font-medium text-gray-700">경력</label>
                                    <button 
                                        type="button"
                                        onclick="addCareerEntry()"
                                        class="text-xs px-2 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 transition">
                                        <i class="fas fa-plus mr-1"></i>추가
                                    </button>
                                </div>
                                <div id="careersContainer" class="space-y-2">
                                    ${(() => {
                                        const careers = user.careers ? JSON.parse(user.careers) : [];
                                        // 항목이 없으면 빈 항목 하나 추가
                                        if (careers.length === 0) {
                                            careers.push({ company: '', position: '', period: '' });
                                        }
                                        return careers.map((career, idx) => `
                                            <div class="career-entry border border-gray-200 rounded p-2" data-index="${idx}">
                                                <div class="flex items-start gap-2">
                                                    <div class="flex-1 space-y-2">
                                                        <input 
                                                            type="text" 
                                                            class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                                                            placeholder="회사/기관명 (예: 삼성전자)"
                                                            value="${career.company || ''}"
                                                            data-field="company" />
                                                        <input 
                                                            type="text" 
                                                            class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                                                            placeholder="직책/직위 (예: 책임연구원)"
                                                            value="${career.position || ''}"
                                                            data-field="position" />
                                                        <input 
                                                            type="text" 
                                                            class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                                                            placeholder="재직기간 (예: 2020-2023 또는 2020-현재)"
                                                            value="${career.period || ''}"
                                                            data-field="period" />
                                                    </div>
                                                    ${careers.length > 1 ? `
                                                        <button 
                                                            type="button"
                                                            onclick="removeCareerEntry(this)"
                                                            class="text-red-500 hover:text-red-700 p-2">
                                                            <i class="fas fa-trash text-sm"></i>
                                                        </button>
                                                    ` : ''}
                                                </div>
                                            </div>
                                        `).join('');
                                    })()}
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- School Info -->
                    <div class="bg-orange-50 border-l-4 border-orange-600 p-4 rounded">
                        <div class="flex items-center justify-between mb-3">
                            <h4 class="font-semibold text-orange-800">
                                <i class="fas fa-graduation-cap mr-2"></i>학교 정보 <span class="text-xs text-gray-500 font-normal">(선택사항)</span>
                            </h4>
                            <label class="flex items-center text-sm cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    id="privacyEducationInfo"
                                    ${privacySettings.education_info !== false ? 'checked' : ''}
                                    class="mr-2 w-4 h-4 text-orange-600 rounded focus:ring-2 focus:ring-orange-500" />
                                <span class="text-gray-700"><i class="fas fa-eye mr-1"></i>공개</span>
                            </label>
                        </div>
                        <div class="space-y-3">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">초등학교</label>
                                <input 
                                    type="text" 
                                    id="editElementarySchoolInline"
                                    value="${user.elementary_school || ''}"
                                    placeholder="예: 서울초등학교"
                                    class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 text-sm" />
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">중학교</label>
                                <input 
                                    type="text" 
                                    id="editMiddleSchoolInline"
                                    value="${user.middle_school || ''}"
                                    placeholder="예: 서울중학교"
                                    class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 text-sm" />
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">고등학교</label>
                                <input 
                                    type="text" 
                                    id="editHighSchoolInline"
                                    value="${user.high_school || ''}"
                                    placeholder="예: 서울고등학교"
                                    class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 text-sm" />
                            </div>
                            <div>
                                <div class="flex items-center justify-between mb-2">
                                    <label class="block text-sm font-medium text-gray-700">대학교</label>
                                    <button 
                                        type="button"
                                        onclick="addEducationEntry('university')"
                                        class="text-xs px-2 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 transition">
                                        <i class="fas fa-plus mr-1"></i>추가
                                    </button>
                                </div>
                                <div id="universitiesContainer" class="space-y-2">
                                    ${(() => {
                                        const universities = user.universities ? JSON.parse(user.universities) : [];
                                        // 기존 단일 필드 데이터가 있으면 첫 번째 항목으로 추가
                                        if (universities.length === 0 && (user.university || user.university_major)) {
                                            universities.push({ school: user.university || '', major: user.university_major || '' });
                                        }
                                        // 항목이 없으면 빈 항목 하나 추가
                                        if (universities.length === 0) {
                                            universities.push({ school: '', major: '' });
                                        }
                                        return universities.map((edu, idx) => `
                                            <div class="education-entry border border-gray-200 rounded p-2" data-type="university" data-index="${idx}">
                                                <div class="flex items-start gap-2">
                                                    <div class="flex-1 space-y-2">
                                                        <input 
                                                            type="text" 
                                                            class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 text-sm"
                                                            placeholder="예: 서울대학교"
                                                            value="${edu.school || ''}"
                                                            data-field="school" />
                                                        <input 
                                                            type="text" 
                                                            class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 text-sm"
                                                            placeholder="전공 (예: 컴퓨터공학)"
                                                            value="${edu.major || ''}"
                                                            data-field="major" />
                                                    </div>
                                                    ${universities.length > 1 ? `
                                                        <button 
                                                            type="button"
                                                            onclick="removeEducationEntry(this)"
                                                            class="text-red-500 hover:text-red-700 p-2">
                                                            <i class="fas fa-trash text-sm"></i>
                                                        </button>
                                                    ` : ''}
                                                </div>
                                            </div>
                                        `).join('');
                                    })()}
                                </div>
                            </div>
                            <div>
                                <div class="flex items-center justify-between mb-2">
                                    <label class="block text-sm font-medium text-gray-700">석사</label>
                                    <button 
                                        type="button"
                                        onclick="addEducationEntry('masters')"
                                        class="text-xs px-2 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 transition">
                                        <i class="fas fa-plus mr-1"></i>추가
                                    </button>
                                </div>
                                <div id="mastersContainer" class="space-y-2">
                                    ${(() => {
                                        const masters = user.masters_degrees ? JSON.parse(user.masters_degrees) : [];
                                        // 기존 단일 필드 데이터가 있으면 첫 번째 항목으로 추가
                                        if (masters.length === 0 && (user.masters || user.masters_major)) {
                                            masters.push({ school: user.masters || '', major: user.masters_major || '' });
                                        }
                                        // 항목이 없으면 빈 항목 하나 추가
                                        if (masters.length === 0) {
                                            masters.push({ school: '', major: '' });
                                        }
                                        return masters.map((edu, idx) => `
                                            <div class="education-entry border border-gray-200 rounded p-2" data-type="masters" data-index="${idx}">
                                                <div class="flex items-start gap-2">
                                                    <div class="flex-1 space-y-2">
                                                        <input 
                                                            type="text" 
                                                            class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 text-sm"
                                                            placeholder="예: 서울대학교 대학원"
                                                            value="${edu.school || ''}"
                                                            data-field="school" />
                                                        <input 
                                                            type="text" 
                                                            class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 text-sm"
                                                            placeholder="전공 (예: 신학)"
                                                            value="${edu.major || ''}"
                                                            data-field="major" />
                                                    </div>
                                                    ${masters.length > 1 ? `
                                                        <button 
                                                            type="button"
                                                            onclick="removeEducationEntry(this)"
                                                            class="text-red-500 hover:text-red-700 p-2">
                                                            <i class="fas fa-trash text-sm"></i>
                                                        </button>
                                                    ` : ''}
                                                </div>
                                            </div>
                                        `).join('');
                                    })()}
                                </div>
                            </div>
                            <div>
                                <div class="flex items-center justify-between mb-2">
                                    <label class="block text-sm font-medium text-gray-700">박사</label>
                                    <button 
                                        type="button"
                                        onclick="addEducationEntry('phd')"
                                        class="text-xs px-2 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 transition">
                                        <i class="fas fa-plus mr-1"></i>추가
                                    </button>
                                </div>
                                <div id="phdContainer" class="space-y-2">
                                    ${(() => {
                                        const phds = user.phd_degrees ? JSON.parse(user.phd_degrees) : [];
                                        // 기존 단일 필드 데이터가 있으면 첫 번째 항목으로 추가
                                        if (phds.length === 0 && (user.phd || user.phd_major)) {
                                            phds.push({ school: user.phd || '', major: user.phd_major || '' });
                                        }
                                        // 항목이 없으면 빈 항목 하나 추가
                                        if (phds.length === 0) {
                                            phds.push({ school: '', major: '' });
                                        }
                                        return phds.map((edu, idx) => `
                                            <div class="education-entry border border-gray-200 rounded p-2" data-type="phd" data-index="${idx}">
                                                <div class="flex items-start gap-2">
                                                    <div class="flex-1 space-y-2">
                                                        <input 
                                                            type="text" 
                                                            class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 text-sm"
                                                            placeholder="예: 하버드대학교"
                                                            value="${edu.school || ''}"
                                                            data-field="school" />
                                                        <input 
                                                            type="text" 
                                                            class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 text-sm"
                                                            placeholder="전공 (예: 조직신학)"
                                                            value="${edu.major || ''}"
                                                            data-field="major" />
                                                    </div>
                                                    ${phds.length > 1 ? `
                                                        <button 
                                                            type="button"
                                                            onclick="removeEducationEntry(this)"
                                                            class="text-red-500 hover:text-red-700 p-2">
                                                            <i class="fas fa-trash text-sm"></i>
                                                        </button>
                                                    ` : ''}
                                                </div>
                                            </div>
                                        `).join('');
                                    })()}
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Action Buttons -->
                    <div class="flex justify-end space-x-3">
                        <button 
                            type="button"
                            onclick="cancelEditProfile()"
                            class="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition">
                            <i class="fas fa-times mr-2"></i>취소
                        </button>
                        <button 
                            type="submit"
                            class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                            <i class="fas fa-save mr-2"></i>저장
                        </button>
                    </div>
                </div>
            </form>
        `;
        
        // Update profile view content
        document.getElementById('profileViewContent').innerHTML = content;
        
        // Update header title to "프로필 수정"
        const profileViewHeader = document.querySelector('#profileView .flex.items-center.justify-between h2');
        if (profileViewHeader) {
            profileViewHeader.innerHTML = '<i class="fas fa-user-edit text-blue-600 mr-2"></i>프로필 수정';
        }
        
        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
        console.error('Failed to load user data:', error);
        alert('사용자 정보를 불러오는데 실패했습니다.');
    }
}

// Preview avatar in inline edit
function previewEditAvatarInline(event) {
    const file = event.target.files[0];
    if (file) {
        if (file.size > 5 * 1024 * 1024) {
            alert('파일 크기는 5MB를 초과할 수 없습니다.');
            event.target.value = '';
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('editAvatarPreviewInline');
            if (preview) {
                preview.innerHTML = '<img src="' + e.target.result + '" class="w-full h-full object-cover" />';
                // Re-add click event after updating innerHTML
                preview.onclick = cancelEditProfile;
                preview.title = '프로필 보기로 돌아가기';
            }
        };
        reader.readAsDataURL(file);
    }
}

// Delete avatar in inline edit
async function deleteAvatarInline() {
    if (!currentUserId) {
        alert('로그인이 필요합니다.');
        return;
    }
    
    if (!confirm('프로필 사진을 삭제하시겠습니까?')) {
        return;
    }
    
    try {
        await axios.delete('/api/users/' + currentUserId + '/avatar');
        
        // Update preview to default
        const preview = document.getElementById('editAvatarPreviewInline');
        if (preview) {
            preview.innerHTML = '<i class="fas fa-user text-gray-400 text-4xl"></i>';
            // Re-add click event after updating innerHTML
            preview.onclick = cancelEditProfile;
            preview.title = '프로필 보기로 돌아가기';
        }
        
        // Clear file input
        const fileInput = document.getElementById('editAvatarInline');
        if (fileInput) {
            fileInput.value = '';
        }
        
        // Refresh user data
        const userResponse = await axios.get('/api/users/' + currentUserId);
        currentUser = userResponse.data.user;
        updateAuthUI();
        
        showToast('프로필 사진이 삭제되었습니다.', 'success');
    } catch (error) {
        console.error('Avatar delete error:', error);
        showToast('프로필 사진 삭제에 실패했습니다.', 'error');
    }
}

// Cancel edit and go back to profile view
function cancelEditProfile() {
    showUserProfileModal(currentUserId);
}

// Handle edit profile form submit
async function handleEditProfileSubmit(event) {
    event.preventDefault();
    
    const name = document.getElementById('editNameInline').value;
    const gender = document.getElementById('editGenderInline').value;
    const church = document.getElementById('editChurchInline').value;
    const pastor = document.getElementById('editPastorInline').value;
    const position = document.getElementById('editPositionInline').value;
    const maritalStatus = document.getElementById('editMaritalStatusInline').value;
    const phone = document.getElementById('editPhoneInline').value;
    const address = document.getElementById('editAddressInline').value;
    const avatarFile = document.getElementById('editAvatarInline')?.files[0];
    
    // 학교 정보 수집 (기존 방식)
    const elementary_school = document.getElementById('editElementarySchoolInline')?.value || '';
    const middle_school = document.getElementById('editMiddleSchoolInline')?.value || '';
    const high_school = document.getElementById('editHighSchoolInline')?.value || '';
    
    // 직업 정보 수집
    const collectCareerData = () => {
        const container = document.getElementById('careersContainer');
        if (!container) return [];
        
        const entries = container.querySelectorAll('.career-entry');
        const data = [];
        
        entries.forEach(entry => {
            const companyInput = entry.querySelector('[data-field="company"]');
            const positionInput = entry.querySelector('[data-field="position"]');
            const periodInput = entry.querySelector('[data-field="period"]');
            
            const company = companyInput?.value?.trim() || '';
            const position = positionInput?.value?.trim() || '';
            const period = periodInput?.value?.trim() || '';
            
            // 빈 항목은 제외
            if (company || position || period) {
                data.push({ company, position, period });
            }
        });
        
        return data;
    };
    
    const careers = collectCareerData();
    
    // 새로운 방식: 대학교, 석사, 박사 목록 수집
    const collectEducationData = (containerId) => {
        const container = document.getElementById(containerId);
        if (!container) return [];
        
        const entries = container.querySelectorAll('.education-entry');
        const data = [];
        
        entries.forEach(entry => {
            const schoolInput = entry.querySelector('[data-field="school"]');
            const majorInput = entry.querySelector('[data-field="major"]');
            
            const school = schoolInput?.value?.trim() || '';
            const major = majorInput?.value?.trim() || '';
            
            // 빈 항목은 제외
            if (school || major) {
                data.push({ school, major });
            }
        });
        
        return data;
    };
    
    const universities = collectEducationData('universitiesContainer');
    const masters_degrees = collectEducationData('mastersContainer');
    const phd_degrees = collectEducationData('phdContainer');
    
    // 하위 호환성을 위해 첫 번째 항목을 단일 필드로도 저장
    const university = universities.length > 0 ? universities[0].school : '';
    const university_major = universities.length > 0 ? universities[0].major : '';
    const masters = masters_degrees.length > 0 ? masters_degrees[0].school : '';
    const masters_major = masters_degrees.length > 0 ? masters_degrees[0].major : '';
    const phd = phd_degrees.length > 0 ? phd_degrees[0].school : '';
    const phd_major = phd_degrees.length > 0 ? phd_degrees[0].major : '';
    
    // 신앙 고백 답변 수집
    const faithAnswers = {};
    for (let i = 1; i <= 10; i++) {
        const element = document.getElementById('editFaithQ' + i + 'Inline');
        if (element) {
            faithAnswers['q' + i] = element.value;
        }
    }
    
    // 공개 설정 수집
    const privacySettings = {
        basic_info: document.getElementById('privacyBasicInfo')?.checked ?? true,
        church_info: document.getElementById('privacyChurchInfo')?.checked ?? true,
        faith_answers: document.getElementById('privacyFaithAnswers')?.checked ?? true,
        education_info: document.getElementById('privacyEducationInfo')?.checked ?? true,
        career_info: document.getElementById('privacyCareerInfo')?.checked ?? true,
        scores: document.getElementById('privacyScores')?.checked ?? true
    };

    if (!name) {
        showToast('이름은 필수 항목입니다.', 'error');
        return;
    }

    try {
        // Update user info including faith_answers, school info, and privacy_settings
        await axios.put('/api/users/' + currentUserId, {
            name,
            gender,
            church,
            pastor,
            position,
            marital_status: maritalStatus,
            phone,
            address,
            faith_answers: JSON.stringify(faithAnswers),
            elementary_school,
            middle_school,
            high_school,
            university,
            university_major,
            masters,
            masters_major,
            phd,
            phd_major,
            universities: JSON.stringify(universities),
            masters_degrees: JSON.stringify(masters_degrees),
            phd_degrees: JSON.stringify(phd_degrees),
            careers: JSON.stringify(careers),
            privacy_settings: JSON.stringify(privacySettings)
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
        
        showToast('프로필이 수정되었습니다! 👍', 'success');
        
        // Go back to profile view
        showUserProfileModal(currentUserId);
        
        // Reload posts to update user info in posts
        loadPosts();
    } catch (error) {
        console.error('Edit profile error:', error);
        showToast('프로필 수정에 실패했습니다.', 'error');
    }
}

window.hideEditProfileModal = function() {
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

// Delete avatar
async function deleteAvatar() {
    if (!currentUserId) {
        alert('로그인이 필요합니다.');
        return;
    }
    
    if (!confirm('프로필 사진을 삭제하시겠습니까?')) {
        return;
    }
    
    try {
        await axios.delete('/api/users/' + currentUserId + '/avatar');
        
        // Update preview to default
        const preview = document.getElementById('editAvatarPreview');
        preview.innerHTML = '<i class="fas fa-user text-gray-400 text-2xl"></i>';
        
        // Refresh user data
        const userResponse = await axios.get('/api/users/' + currentUserId);
        currentUser = userResponse.data.user;
        updateAuthUI();
        
        alert('프로필 사진이 삭제되었습니다.');
    } catch (error) {
        console.error('Avatar delete error:', error);
        alert('프로필 사진 삭제에 실패했습니다.');
    }
}

async function handleEditProfile() {
    const name = document.getElementById('editName').value;
    const gender = document.getElementById('editGender').value;
    const church = document.getElementById('editChurch').value;
    const pastor = document.getElementById('editPastor').value;
    const position = document.getElementById('editPosition').value;
    const maritalStatus = document.getElementById('editMaritalStatus').value;
    const avatarFile = document.getElementById('editAvatar').files[0];
    
    // 신앙 고백 답변 수집
    const faithAnswers = {
        q1: document.getElementById('edit_faith_q1').value,
        q2: document.getElementById('edit_faith_q2').value,
        q3: document.getElementById('edit_faith_q3').value,
        q4: document.getElementById('edit_faith_q4').value,
        q5: document.getElementById('edit_faith_q5').value,
        q6: document.getElementById('edit_faith_q6').value,
        q7: document.getElementById('edit_faith_q7').value,
        q8: document.getElementById('edit_faith_q8').value,
        q9: document.getElementById('edit_faith_q9').value,
        q10: document.getElementById('edit_faith_q10').value
    };

    if (!name) {
        alert('이름은 필수 항목입니다.');
        return;
    }

    try {
        // Update user info including faith_answers
        await axios.put('/api/users/' + currentUserId, {
            name,
            gender,
            church,
            pastor,
            position,
            marital_status: maritalStatus,
            faith_answers: JSON.stringify(faithAnswers)
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
    const maritalStatus = document.getElementById('signupMaritalStatus').value;
    const address = document.getElementById('signupAddress').value;
    const phone = document.getElementById('signupPhone').value;
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

    // 필수 항목 확인 (이름, 성별, 이메일, 프로필 사진)
    if (!email || !name) {
        alert('이름과 이메일은 필수 항목입니다.');
        return;
    }
    
    if (!gender) {
        alert('성별을 선택해주세요.');
        return;
    }
    
    if (!avatarFile) {
        alert('프로필 사진을 업로드해주세요.');
        return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        alert('올바른 이메일 형식을 입력해주세요.');
        return;
    }
    
    // Phone validation (optional, only if provided)
    if (phone) {
        const phoneRegex = /^[0-9]{2,3}-[0-9]{3,4}-[0-9]{4}$/;
        if (!phoneRegex.test(phone)) {
            alert('전화번호는 하이픈(-)을 포함하여 입력해주세요. 예) 010-1234-5678');
            return;
        }
    }

    // 교회 위치 조합: 도 + 시 (둘 다 있을 경우만)
    const location = (province && city) ? (province + ' ' + city) : '';

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
            marital_status: maritalStatus,
            address,
            phone,
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
        
        // Load user scores from API
        await loadUserScores();
        
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
        // Use /api/login endpoint (handles admin auto-creation)
        const response = await axios.post('/api/login', {
            email: trimmedEmail
        });
        
        if (response.data.user) {
            const user = response.data.user;
            console.log('로그인 성공:', user);
            
            currentUserId = user.id;
            currentUser = user;
            
            // Save to localStorage
            localStorage.setItem('currentUserId', user.id);
            localStorage.setItem('currentUserEmail', user.email);
            
            // Save email to history
            saveEmailToHistory(trimmedEmail);
            
            // Load user scores from API
            await loadUserScores();
            
            updateAuthUI();
            hideLoginModal();
            loadPosts();
            
            // Special welcome for admin
            if (user.role === 'admin') {
                alert(`🎉 관리자님 환영합니다! (${user.name})`);
            } else {
                alert(`환영합니다, ${user.name}님! 😊`);
            }
        }
    } catch (error) {
        console.error('Login error:', error);
        
        if (error.response && error.response.status === 404) {
            // User not found - redirect to signup
            alert('가입되지 않은 이메일입니다. 회원가입을 먼저 해주세요.');
        } else {
            alert('로그인에 실패했습니다. 다시 시도해주세요.');
        }
    }
}

// Logout
function logout() {
    currentUserId = null;
    currentUser = null;
    
    // Reset all scores
    typingScore = 0;
    videoScore = 0;
    prayerScore = 0;
    completedVerses = new Set();
    completedVideos = new Set();
    
    // Clear localStorage
    localStorage.removeItem('currentUserId');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('typingScore');
    localStorage.removeItem('videoScore');
    localStorage.removeItem('prayerScore');
    localStorage.removeItem('completedVerses');
    localStorage.removeItem('completedVideos');
    
    // Reset video tracking
    maxWatchedTime = 0;
    lastCheckedTime = 0;
    
    // Reset UI
    updateAuthUI();
    updateTypingScoreDisplay();
    
    // Clear posts feed
    document.getElementById('postsFeed').innerHTML = '<div class="text-center text-gray-500 py-10">로그인하여 게시물을 확인하세요</div>';
    
    // Clear typing input
    const typingInput = document.getElementById('typingInput');
    const typingResult = document.getElementById('typingResult');
    if (typingInput) typingInput.value = '';
    if (typingResult) typingResult.classList.add('hidden');
    
    // Hide typing area
    const typingArea = document.getElementById('typingArea');
    if (typingArea) typingArea.classList.add('hidden');
    
    // Hide video progress and completion
    const videoProgressContainer = document.getElementById('videoProgressContainer');
    const videoCompletionResult = document.getElementById('videoCompletionResult');
    if (videoProgressContainer) videoProgressContainer.classList.add('hidden');
    if (videoCompletionResult) videoCompletionResult.classList.add('hidden');
    
    // Reset video progress bar
    const videoProgressBar = document.getElementById('videoProgressBar');
    const videoProgressPercent = document.getElementById('videoProgressPercent');
    if (videoProgressBar) videoProgressBar.style.width = '0%';
    if (videoProgressPercent) videoProgressPercent.textContent = '0%';
    
    // Clear new post content
    const newPostContent = document.getElementById('newPostContent');
    if (newPostContent) newPostContent.value = '';
    
    // Remove image/video previews
    removePostImage();
    removePostVideo();
    removeSharedPost();
    
    // Reload page to ensure clean state
    setTimeout(() => {
        window.location.reload();
    }, 500);
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
    const typingToggleBtn = document.getElementById('typingToggleBtn');
    const typingLoginOverlay = document.getElementById('typingLoginOverlay');
    const videoLoginOverlay = document.getElementById('videoLoginOverlay');

    if (currentUserId) {
        authButtons.classList.add('hidden');
        userMenu.classList.remove('hidden');
        
        // Remove tooltip from typing button when logged in
        if (typingToggleBtn) {
            typingToggleBtn.removeAttribute('title');
        }
        
        // Hide login overlays when logged in
        if (typingLoginOverlay) {
            typingLoginOverlay.classList.add('hidden');
        }
        if (videoLoginOverlay) {
            videoLoginOverlay.classList.add('hidden');
        }
        
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
        if (currentUser.role === 'admin') {
            // Admin: Show crown icon filling the avatar
            userAvatarContainer.innerHTML = '<i class="fas fa-crown text-yellow-400 text-2xl"></i>';
            newPostAvatar.innerHTML = '<i class="fas fa-crown text-yellow-400 text-2xl"></i>';
        } else if (currentUser.avatar_url) {
            // Regular users: Show avatar image
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
        
        // Add role badge (skip for admin since they have crown icon as avatar)
        if (currentUser.role !== 'admin') {
            addRoleBadge(userAvatarContainer.parentElement, currentUser.role);
            addRoleBadge(newPostAvatar.parentElement, currentUser.role);
        }
    } else {
        authButtons.classList.remove('hidden');
        userMenu.classList.add('hidden');
        
        // Add tooltip to typing button when not logged in
        if (typingToggleBtn) {
            typingToggleBtn.setAttribute('title', '로그인 필요');
        }
        
        // Show login overlays when not logged in
        if (typingLoginOverlay) {
            typingLoginOverlay.classList.remove('hidden');
        }
        if (videoLoginOverlay) {
            videoLoginOverlay.classList.remove('hidden');
        }
        
        // Reset avatars to default
        if (userAvatarContainer) {
            userAvatarContainer.innerHTML = '<i class="fas fa-user"></i>';
        }
        if (newPostAvatar) {
            newPostAvatar.innerHTML = '<i class="fas fa-user"></i>';
        }
        
        // Reset scores to 0
        const scoreElement = document.getElementById('typingScore');
        const scoreUserElement = document.getElementById('typingScoreUser');
        const prayerScoreElement = document.getElementById('prayerScore');
        const prayerScoreUserElement = document.getElementById('prayerScoreUser');
        
        if (scoreElement) scoreElement.textContent = '0';
        if (scoreUserElement) scoreUserElement.textContent = '0';
        if (prayerScoreElement) prayerScoreElement.textContent = '0';
        if (prayerScoreUserElement) prayerScoreUserElement.textContent = '0';
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

// Toggle prayer request mode
// Create new post
async function createPost() {
    if (!currentUserId) {
        alert('로그인이 필요합니다.');
        showLoginModal();
        return;
    }

    const content = document.getElementById('newPostContent').value;
    const imageFile = document.getElementById('postImageFile').files[0];
    const videoFile = document.getElementById('postVideoFile').files[0];
    
    // Get shared post ID if exists
    const sharedPostPreview = document.getElementById('sharedPostPreview');
    const sharedPostId = sharedPostPreview.dataset.sharedPostId || null;

    if (!content && !imageFile && !videoFile && !sharedPostId) {
        alert('내용, 사진, 동영상 또는 공유할 포스팅을 입력해주세요.');
        return;
    }

    // Disable post button
    const postBtn = document.getElementById('createPostBtn');
    const originalBtnText = postBtn.innerHTML;
    postBtn.disabled = true;
    postBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>업로드 중...';
    postBtn.classList.add('opacity-50', 'cursor-not-allowed');

    try {
        // 1. Create post with shared_post_id and background_color
        const response = await axios.post('/api/posts', {
            user_id: currentUserId,
            content: content || '',
            verse_reference: null,
            shared_post_id: sharedPostId,
            is_prayer_request: 0,
            background_color: selectedBackgroundColor
        });

        const postId = response.data.id;

        // 기도 포스팅(중보)일 경우 기도 점수 +10점
        if (selectedBackgroundColor === '#F87171') {
            prayerScore += 10;
            updateTypingScoreDisplay();
            showToastWithColor('중보 포스팅 작성! 기도 점수 +10점', selectedBackgroundColor);
        }
        
        // 말씀 포스팅일 경우 성경 점수 +10점
        if (selectedBackgroundColor === '#F5E398') {
            typingScore += 10;
            updateTypingScoreDisplay();
            showToastWithColor('말씀 포스팅 작성! 성경 점수 +10점', selectedBackgroundColor);
        }
        
        // 일상, 사역, 찬양, 교회, 자유 포스팅일 경우 활동 점수 +10점
        const activityPostColors = ['#F5D4B3', '#B3EDD8', '#C4E5F8', '#E2DBFB', '#FFFFFF'];
        if (activityPostColors.includes(selectedBackgroundColor)) {
            activityScore += 10;
            updateTypingScoreDisplay();
            showToastWithColor('포스팅 작성! 활동 점수 +10점', selectedBackgroundColor);
        }

        // 2. Upload image if selected
        if (imageFile) {
            const formData = new FormData();
            formData.append('image', imageFile);
            
            try {
                await axios.post('/api/posts/' + postId + '/image', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
            } catch (uploadError) {
                console.error('Image upload error:', uploadError);
            }
        }

        // 3. Upload video if selected
        if (videoFile) {
            // Show progress bar
            const progressContainer = document.getElementById('uploadProgressContainer');
            const progressBar = document.getElementById('uploadProgressBar');
            const progressPercent = document.getElementById('uploadPercent');
            const uploadStatus = document.getElementById('uploadStatus');
            
            progressContainer.classList.remove('hidden');
            
            const formData = new FormData();
            formData.append('video', videoFile);
            
            try {
                await axios.post('/api/posts/' + postId + '/video', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                    onUploadProgress: function(progressEvent) {
                        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                        progressBar.style.width = percentCompleted + '%';
                        progressPercent.textContent = percentCompleted + '%';
                        
                        if (percentCompleted === 100) {
                            uploadStatus.textContent = '처리 중...';
                        }
                    }
                });
                
                uploadStatus.textContent = '업로드 완료!';
                uploadStatus.innerHTML = '<i class="fas fa-check-circle mr-2"></i>업로드 완료!';
                
                // Hide progress bar after 1 second
                setTimeout(function() {
                    progressContainer.classList.add('hidden');
                    progressBar.style.width = '0%';
                    progressPercent.textContent = '0%';
                    uploadStatus.textContent = '업로드 중...';
                }, 1000);
            } catch (uploadError) {
                console.error('Video upload error:', uploadError);
                uploadStatus.textContent = '업로드 실패';
                uploadStatus.innerHTML = '<i class="fas fa-exclamation-circle mr-2"></i>업로드 실패';
                
                setTimeout(function() {
                    progressContainer.classList.add('hidden');
                    progressBar.style.width = '0%';
                    progressPercent.textContent = '0%';
                    uploadStatus.textContent = '업로드 중...';
                }, 2000);
            }
        }

        document.getElementById('newPostContent').value = '';
        removePostImage();
        removePostVideo();
        removeSharedPost(); // Clear shared post preview
        resetBackgroundColor(); // Clear selected background color
        
        // Re-enable button
        postBtn.disabled = false;
        postBtn.innerHTML = originalBtnText;
        postBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        
        await loadPosts();
    } catch (error) {
        console.error('Error creating post:', error);
        alert('게시물 작성에 실패했습니다.');
        
        // Re-enable button
        postBtn.disabled = false;
        postBtn.innerHTML = originalBtnText;
        postBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
}

// Preview post image
function previewPostImage(event) {
    const file = event.target.files[0];
    if (file) {
        if (file.size > 10 * 1024 * 1024) {
            alert('파일 크기는 10MB를 초과할 수 없습니다.');
            event.target.value = '';
            return;
        }
        
        if (!file.type.startsWith('image/')) {
            alert('이미지 파일만 업로드할 수 있습니다.');
            event.target.value = '';
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('postImagePreview');
            const container = document.getElementById('postImagePreviewContainer');
            preview.src = e.target.result;
            container.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }
}

// Remove post image
function removePostImage() {
    document.getElementById('postImageFile').value = '';
    document.getElementById('postImagePreview').src = '';
    document.getElementById('postImagePreviewContainer').classList.add('hidden');
}

// Preview post video
function previewPostVideo(event) {
    const file = event.target.files[0];
    if (file) {
        if (file.size > 100 * 1024 * 1024) {
            alert('파일 크기는 100MB를 초과할 수 없습니다.');
            event.target.value = '';
            return;
        }
        
        if (!file.type.startsWith('video/')) {
            alert('동영상 파일만 업로드할 수 있습니다.');
            event.target.value = '';
            return;
        }
        
        // Hide image preview if shown
        document.getElementById('postImagePreviewContainer').classList.add('hidden');
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('postVideoPreview');
            const container = document.getElementById('postVideoPreviewContainer');
            preview.src = e.target.result;
            container.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }
}

// Remove post video
function removePostVideo() {
    document.getElementById('postVideoFile').value = '';
    document.getElementById('postVideoPreview').src = '';
    document.getElementById('postVideoPreviewContainer').classList.add('hidden');
}

// Toggle like
async function toggleLike(postId) {
    if (!currentUserId) {
        alert('로그인이 필요합니다.');
        showLoginModal();
        return;
    }
    
    try {
        // Get post info to determine background color
        const postResponse = await axios.get(`/api/posts/${postId}?user_id=${currentUserId}`);
        const post = postResponse.data.post;
        const backgroundColor = post.background_color;
        
        // Toggle like
        const response = await axios.post(`/api/posts/${postId}/like`, {
            user_id: currentUserId
        });
        
        const liked = response.data.liked;
        
        // Update scores based on post type
        if (liked) {
            // Liked: add points
            if (backgroundColor === '#F5E398') {
                // 말씀 포스팅 - 아멘 버튼: 성경 점수 +1점
                await axios.post(`/api/users/${currentUserId}/scores/scripture`, { points: 1 });
                typingScore += 1;
                updateTypingScoreDisplay();
                showToast('아멘! 성경 점수 +1점', 'success');
            } else if (backgroundColor === '#F5D4B3') {
                // 일상 포스팅 - 샬롬: 활동 점수 +1점
                await axios.post(`/api/users/${currentUserId}/scores/activity`, { points: 1 });
                activityScore += 1;
                updateTypingScoreDisplay();
                showToast('샬롬! 활동 점수 +1점', 'success');
            } else if (backgroundColor === '#B3EDD8') {
                // 사역 포스팅 - 응원합니다: 활동 점수 +1점
                await axios.post(`/api/users/${currentUserId}/scores/activity`, { points: 1 });
                activityScore += 1;
                updateTypingScoreDisplay();
                showToast('응원합니다! 활동 점수 +1점', 'success');
            } else if (backgroundColor === '#C4E5F8') {
                // 찬양 포스팅 - 할렐루야: 활동 점수 +1점
                await axios.post(`/api/users/${currentUserId}/scores/activity`, { points: 1 });
                activityScore += 1;
                updateTypingScoreDisplay();
                showToast('할렐루야! 활동 점수 +1점', 'success');
            } else if (backgroundColor === '#E2DBFB') {
                // 교회 포스팅 - 우리는 하나: 활동 점수 +1점
                await axios.post(`/api/users/${currentUserId}/scores/activity`, { points: 1 });
                activityScore += 1;
                updateTypingScoreDisplay();
                showToast('우리는 하나! 활동 점수 +1점', 'success');
            } else {
                // 자유 포스팅 - 좋아요: 활동 점수 +1점
                await axios.post(`/api/users/${currentUserId}/scores/activity`, { points: 1 });
                activityScore += 1;
                updateTypingScoreDisplay();
                showToast('좋아요! 활동 점수 +1점', 'success');
            }
        } else {
            // Unliked: subtract points
            if (backgroundColor === '#F5E398') {
                // 말씀 포스팅: 성경 점수 -1점
                await axios.post(`/api/users/${currentUserId}/scores/scripture`, { points: -1 });
                typingScore = Math.max(0, typingScore - 1);
                updateTypingScoreDisplay();
                showToast('취소: 성경 점수 -1점', 'warning');
            } else {
                // 다른 포스팅: 활동 점수 -1점
                await axios.post(`/api/users/${currentUserId}/scores/activity`, { points: -1 });
                activityScore = Math.max(0, activityScore - 1);
                updateTypingScoreDisplay();
                showToast('취소: 활동 점수 -1점', 'warning');
            }
        }
        
        updateTypingScoreDisplay();
        loadPosts();
    } catch (error) {
        console.error('Error toggling like:', error);
    }
}

// Toggle comment like
async function toggleCommentLike(commentId, postId) {
    if (!currentUserId) {
        alert('로그인이 필요합니다.');
        showLoginModal();
        return;
    }
    
    try {
        await axios.post(`/api/comments/${commentId}/like`, {
            user_id: currentUserId
        });
        // Refresh comments without toggling (keep them open)
        refreshComments(postId);
    } catch (error) {
        console.error('Error toggling comment like:', error);
    }
}

// Refresh comments (without toggling visibility)
async function refreshComments(postId) {
    const commentsDiv = document.getElementById(`comments-${postId}`);
    
    // Only refresh if comments are currently visible
    if (!commentsDiv.classList.contains('hidden')) {
        try {
            const response = await axios.get(`/api/posts/${postId}/comments?user_id=${currentUserId || 0}`);
            const comments = response.data.comments;
            
            let commentsHtml = '';
            comments.forEach(comment => {
                const isLiked = comment.is_liked > 0;
                
                // Avatar HTML - Admin shows crown icon
                const avatarHtml = comment.user_role === 'admin'
                    ? '<i class="fas fa-crown text-yellow-400 text-lg"></i>'
                    : comment.user_avatar 
                        ? `<img src="${comment.user_avatar}" alt="Profile" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=&quot;fas fa-user&quot;></i>'" />`
                        : '<i class="fas fa-user"></i>';
                
                // Role badge for comments (skip admin badge since they have crown icon as avatar)
                let roleBadgeHtml = '';
                if (comment.user_role === 'moderator') {
                    roleBadgeHtml = '<div class="moderator-badge" title="운영자"><i class="fas fa-shield-alt"></i></div>';
                }
                
                commentsHtml += `
                    <div class="flex space-x-3">
                        <div class="admin-badge-container">
                            <div onclick="showUserProfileModal(${comment.user_id})" class="w-8 h-8 rounded-full overflow-hidden bg-gray-400 flex items-center justify-center text-white text-sm flex-shrink-0 cursor-pointer hover:ring-4 hover:ring-blue-300 transition">${avatarHtml}</div>
                            ${roleBadgeHtml}
                        </div>
                        <div class="flex-1">
                            <div class="bg-gray-50 rounded-lg p-3">
                                <p class="font-semibold text-sm text-gray-800">${comment.user_name}</p>
                                <p class="text-sm text-gray-700 mt-1">${comment.content}</p>
                            </div>
                            <div class="flex items-center space-x-4 mt-1">
                                <p class="text-xs text-gray-500">${formatDate(comment.created_at)}</p>
                                <button 
                                    onclick="toggleCommentLike(${comment.id}, ${postId})" 
                                    class="flex items-center space-x-1 text-xs ${isLiked ? 'text-red-600' : 'text-gray-500 hover:text-red-600'} transition"
                                    title="좋아요">
                                    <i class="fas fa-heart"></i>
                                    <span>${comment.likes_count || 0}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            });
            
            const html = `
                <div class="mt-4 space-y-3 pl-4 border-l-2 border-gray-200">
                    ${commentsHtml}
                    <div class="flex space-x-2 mt-3">
                        <input 
                            id="comment-input-${postId}"
                            type="text"
                            placeholder="댓글을 작성하세요..."
                            class="flex-1 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                        <button 
                            id="comment-submit-${postId}"
                            class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </div>
                </div>
            `;
            
            commentsDiv.innerHTML = html;
            
            // Re-add event listeners after HTML is updated
            const submitBtn = document.getElementById(`comment-submit-${postId}`);
            const inputField = document.getElementById(`comment-input-${postId}`);
            
            if (submitBtn) {
                submitBtn.addEventListener('click', () => createComment(postId));
            }
            
            if (inputField) {
                inputField.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') createComment(postId);
                });
            }
        } catch (error) {
            console.error('Error refreshing comments:', error);
        }
    }
}

// Toggle pray (for prayer request posts)
async function togglePray(postId) {
    if (!currentUserId) {
        alert('로그인이 필요합니다.');
        showLoginModal();
        return;
    }
    
    try {
        const response = await axios.post(`/api/posts/${postId}/pray`, {
            user_id: currentUserId
        });
        
        // Update prayer score display
        prayerScore = response.data.prayer_score;
        updateTypingScoreDisplay();
        
        if (response.data.prayed) {
            // Prayer added: +20점
            const successMsg = document.createElement('div');
            successMsg.className = 'fixed top-20 right-4 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in';
            successMsg.innerHTML = '<i class="fas fa-praying-hands mr-2"></i>함께 기도합니다! +20점';
            document.body.appendChild(successMsg);
            
            setTimeout(() => {
                successMsg.remove();
            }, 2000);
        } else {
            // Prayer cancelled: -20점
            const cancelMsg = document.createElement('div');
            cancelMsg.className = 'fixed top-20 right-4 bg-gray-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in';
            cancelMsg.innerHTML = '<i class="fas fa-undo mr-2"></i>취소 -20점';
            document.body.appendChild(cancelMsg);
            
            setTimeout(() => {
                cancelMsg.remove();
            }, 2000);
        }
        
        loadPosts();
    } catch (error) {
        console.error('Error toggling pray:', error);
        alert('기도 처리에 실패했습니다.');
    }
}

// Delete post (Admin only)
// Toggle post menu
function togglePostMenu(postId) {
    const menu = document.getElementById(`post-menu-${postId}`);
    
    // Close all other menus
    document.querySelectorAll('[id^="post-menu-"]').forEach(m => {
        if (m.id !== `post-menu-${postId}`) {
            m.classList.add('hidden');
        }
    });
    
    // Toggle this menu
    menu.classList.toggle('hidden');
}

// Close post menus when clicking outside
document.addEventListener('click', function(event) {
    if (!event.target.closest('[id^="post-menu-"]') && !event.target.closest('button[onclick*="togglePostMenu"]')) {
        document.querySelectorAll('[id^="post-menu-"]').forEach(menu => {
            menu.classList.add('hidden');
        });
    }
});

// Copy post link
function copyPostLink(postId) {
    const url = `${window.location.origin}/#post-${postId}`;
    
    // Create temporary input element
    const tempInput = document.createElement('input');
    tempInput.value = url;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
    
    // Show success message
    const successMsg = document.createElement('div');
    successMsg.className = 'fixed top-20 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in';
    successMsg.innerHTML = '<i class="fas fa-check-circle mr-2"></i>링크가 복사되었습니다!';
    document.body.appendChild(successMsg);
    
    setTimeout(() => {
        successMsg.remove();
    }, 2000);
    
    // Close menu
    togglePostMenu(postId);
}

// Edit post
let currentEditingPostId = null;
let selectedEditBackgroundColor = null;

// Removed duplicate editPost function - using inline editing instead

function selectEditBackgroundColor(color, element) {
    selectedEditBackgroundColor = color;
    
    // Remove ring from all buttons
    document.querySelectorAll('.edit-color-selector-btn').forEach(btn => {
        btn.classList.remove('ring-4', 'ring-blue-500', 'ring-offset-2');
    });
    
    // Add ring to selected button
    element.classList.add('ring-4', 'ring-blue-500', 'ring-offset-2');
}

function closeEditPostModal() {
    document.getElementById('editPostModal').classList.add('hidden');
    currentEditingPostId = null;
    selectedEditBackgroundColor = null;
    
    // Reset form
    document.getElementById('editPostContent').value = '';
    document.getElementById('editPostVerse').value = '';
    document.querySelectorAll('.edit-color-selector-btn').forEach(btn => {
        btn.classList.remove('ring-4', 'ring-blue-500', 'ring-offset-2');
    });
}

async function submitEditPost() {
    if (!currentEditingPostId) {
        alert('수정할 게시물을 선택해주세요.');
        return;
    }
    
    const content = document.getElementById('editPostContent').value.trim();
    if (!content) {
        alert('내용을 입력해주세요.');
        return;
    }
    
    try {
        await axios.put(`/api/posts/${currentEditingPostId}`, {
            content: content,
            background_color: selectedEditBackgroundColor
        });
        
        // Show success message
        const successMsg = document.createElement('div');
        successMsg.className = 'fixed top-20 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50';
        successMsg.innerHTML = '<i class="fas fa-check-circle mr-2"></i>게시물이 수정되었습니다!';
        document.body.appendChild(successMsg);
        
        setTimeout(() => {
            successMsg.remove();
        }, 2000);
        
        // Close modal and reload posts
        closeEditPostModal();
        loadPosts();
    } catch (error) {
        console.error('Error updating post:', error);
        alert('게시물 수정에 실패했습니다.');
    }
}

// Delete post
// Edit post (inline editing)
async function editPost(postId) {
    // Close post menu
    togglePostMenu(postId);
    
    // Hide display, show edit form
    document.getElementById(`post-content-display-${postId}`).classList.add('hidden');
    document.getElementById(`post-content-edit-${postId}`).classList.remove('hidden');
    
    // Focus on textarea
    const textarea = document.getElementById(`post-edit-textarea-${postId}`);
    if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
}

// Cancel post edit
function cancelPostEdit(postId) {
    // Show display, hide edit form
    document.getElementById(`post-content-display-${postId}`).classList.remove('hidden');
    document.getElementById(`post-content-edit-${postId}`).classList.add('hidden');
}

// Save post edit
async function savePostEdit(postId) {
    const textarea = document.getElementById(`post-edit-textarea-${postId}`);
    const content = textarea.value.trim();
    
    if (!content) {
        showToast('내용을 입력해주세요.', 'error');
        return;
    }
    
    try {
        await axios.put(`/api/posts/${postId}`, {
            content
        });
        
        showToast('게시물이 수정되었습니다.', 'success');
        
        // Reload posts to show updated content
        loadPosts();
    } catch (error) {
        console.error('Failed to update post:', error);
        showToast('게시물 수정에 실패했습니다.', 'error');
    }
}


async function deletePost(postId) {
    // Permission check will be done on server side
    // Just confirm with user before deleting
    if (!confirm('정말로 이 게시물을 삭제하시겠습니까?')) {
        togglePostMenu(postId);
        return;
    }

    try {
        // 삭제 전에 포스트 정보 가져오기 (기도 포스팅인지 확인)
        const postResponse = await axios.get(`/api/posts/${postId}?user_id=${currentUserId}`);
        const post = postResponse.data.post;
        
        // 삭제 실행
        await axios.delete(`/api/posts/${postId}`);
        
        // 중보 포스팅이면 기도 점수 -10점
        if (post.background_color === '#F87171' && post.user_id === currentUserId) {
            prayerScore = Math.max(0, prayerScore - 10);
            updateTypingScoreDisplay();
            showToastWithColor('중보 포스팅 삭제! 기도 점수 -10점', post.background_color);
        } 
        // 말씀 포스팅이면 성경 점수 -10점
        else if (post.background_color === '#F5E398' && post.user_id === currentUserId) {
            typingScore = Math.max(0, typingScore - 10);
            updateTypingScoreDisplay();
            showToastWithColor('말씀 포스팅 삭제! 성경 점수 -10점', post.background_color);
        }
        // 일상, 사역, 찬양, 교회, 자유 포스팅이면 활동 점수 -10점
        else if (['#F5D4B3', '#B3EDD8', '#C4E5F8', '#E2DBFB', '#FFFFFF'].includes(post.background_color) && post.user_id === currentUserId) {
            activityScore = Math.max(0, activityScore - 10);
            updateTypingScoreDisplay();
            showToastWithColor('포스팅 삭제! 활동 점수 -10점', post.background_color);
        } 
        else {
            // 배경색이 없거나 다른 사용자의 포스팅일 경우
            if (post.background_color && post.user_id === currentUserId) {
                showToastWithColor('게시물이 삭제되었습니다.', post.background_color);
            } else {
                alert('게시물이 삭제되었습니다.');
            }
        }
        
        togglePostMenu(postId);
        loadPosts();
    } catch (error) {
        console.error('Error deleting post:', error);
        alert('게시물 삭제에 실패했습니다.');
    }
}

// Share post - creates new post with quoted original post
async function sharePost(postId) {
    if (!currentUserId) {
        alert('로그인이 필요합니다.');
        return;
    }

    try {
        // Get the original post details
        const response = await axios.get(`/api/posts/${postId}?user_id=${currentUserId}`);
        const post = response.data.post;
        
        // Scroll to new post area
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        // Focus textarea but don't clear it (user can write their opinion)
        const textarea = document.getElementById('newPostContent');
        textarea.focus();
        
        // Clear any existing image/video previews (shared post will replace them)
        const postImagePreviewContainer = document.getElementById('postImagePreviewContainer');
        const postVideoPreviewContainer = document.getElementById('postVideoPreviewContainer');
        postImagePreviewContainer.classList.add('hidden');
        postVideoPreviewContainer.classList.add('hidden');
        
        // Create shared post card preview (액자 안의 액자 - 첨부파일처럼)
        const sharedPostPreview = document.getElementById('sharedPostPreview');
        
        // Avatar HTML - Admin shows crown icon
        const avatarHtml = post.user_role === 'admin'
            ? '<i class="fas fa-crown text-yellow-400 text-xl"></i>'
            : post.user_avatar 
                ? `<img src="${post.user_avatar}" alt="Profile" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=&quot;fas fa-user&quot;></i>'" />`
                : '<i class="fas fa-user"></i>';
        
        // Role badge for shared post (skip admin badge since they have crown icon as avatar)
        let roleBadgeHtml = '';
        if (post.user_role === 'moderator') {
            roleBadgeHtml = '<div class="moderator-badge" title="운영자"><i class="fas fa-shield-alt"></i></div>';
        }
        
        // Verse reference removed - not a feature
        const verseHtml = '';
        
        const imageHtml = post.image_url ? `
            <div class="mt-2">
                <img src="${post.image_url}" alt="Post image" class="w-full rounded-lg max-h-48 object-cover" onerror="this.style.display='none'" />
            </div>
        ` : '';
        
        const videoHtml = post.video_url ? `
            <div class="mt-2">
                <video controls class="w-full rounded-lg max-h-48" controlsList="nodownload">
                    <source src="${post.video_url}" type="video/mp4">
                    동영상을 재생할 수 없습니다.
                </video>
            </div>
        ` : '';
        
        // Create the shared post card (inner frame) - looks like an attachment
        const sharedCardHtml = `
            <div class="bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg border-2 border-gray-400 p-4 relative shadow-sm">
                <div class="absolute top-2 right-2 z-10">
                    <button 
                        onclick="removeSharedPost()"
                        class="bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600 transition shadow-md">
                        <i class="fas fa-times text-xs"></i>
                    </button>
                </div>
                <div class="flex items-center space-x-2 mb-3 pb-2 border-b border-gray-300">
                    <i class="fas fa-quote-left text-blue-600 text-sm"></i>
                    <span class="text-xs font-bold text-gray-700">공유된 포스팅</span>
                </div>
                <div class="flex items-start space-x-3">
                    <div class="admin-badge-container">
                        <div class="w-10 h-10 rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white flex-shrink-0">
                            ${avatarHtml}
                        </div>
                        ${roleBadgeHtml}
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center space-x-2 flex-wrap">
                            <h4 class="font-bold text-sm text-gray-800">${post.user_name}</h4>
                            <span class="text-xs text-gray-500">•</span>
                            <p class="text-xs text-gray-500">${formatDate(post.created_at)}</p>
                        </div>
                        <p class="text-xs text-gray-600 mb-2">${post.user_church || ''}</p>
                        <p class="mt-2 text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed">${post.content}</p>
                        ${imageHtml}
                        ${videoHtml}
                        ${verseHtml}
                    </div>
                </div>
            </div>
        `;
        
        sharedPostPreview.innerHTML = sharedCardHtml;
        sharedPostPreview.classList.remove('hidden');
        
        // Store the shared post ID for later use
        sharedPostPreview.dataset.sharedPostId = postId;
        
        // Show success message
        const successMsg = document.createElement('div');
        successMsg.className = 'fixed top-20 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in';
        successMsg.innerHTML = '<i class="fas fa-check-circle mr-2"></i>포스팅이 공유되었습니다. 의견을 작성하고 게시하세요!';
        document.body.appendChild(successMsg);
        
        setTimeout(() => {
            successMsg.remove();
        }, 3000);
        
    } catch (error) {
        console.error('Error sharing post:', error);
        alert('포스팅 공유에 실패했습니다.');
    }
}

// Remove shared post preview
function removeSharedPost() {
    const sharedPostPreview = document.getElementById('sharedPostPreview');
    sharedPostPreview.innerHTML = '';
    sharedPostPreview.classList.add('hidden');
    delete sharedPostPreview.dataset.sharedPostId;
}

// Load comments
async function loadComments(postId) {
    const commentsDiv = document.getElementById(`comments-${postId}`);
    if (commentsDiv.classList.contains('hidden')) {
        try {
            const response = await axios.get(`/api/posts/${postId}/comments?user_id=${currentUserId || 0}`);
            const comments = response.data.comments;
            
            let commentsHtml = '';
            comments.forEach(comment => {
                const isLiked = comment.is_liked > 0;
                const canEdit = currentUser && (currentUser.id === comment.user_id || currentUser.role === 'admin');
                
                // Avatar HTML - Admin shows crown icon
                const avatarHtml = comment.user_role === 'admin'
                    ? '<i class="fas fa-crown text-yellow-400 text-lg"></i>'
                    : comment.user_avatar 
                        ? `<img src="${comment.user_avatar}" alt="Profile" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=&quot;fas fa-user&quot;></i>'" />`
                        : '<i class="fas fa-user"></i>';
                
                // Role badge for comments (skip admin badge since they have crown icon as avatar)
                let roleBadgeHtml = '';
                if (comment.user_role === 'moderator') {
                    roleBadgeHtml = '<div class="moderator-badge" title="운영자"><i class="fas fa-shield-alt"></i></div>';
                }
                
                commentsHtml += `
                    <div class="flex space-x-3" id="comment-${comment.id}">
                        <div class="admin-badge-container">
                            <div onclick="showUserProfileModal(${comment.user_id})" class="w-8 h-8 rounded-full overflow-hidden bg-gray-400 flex items-center justify-center text-white text-sm flex-shrink-0 cursor-pointer hover:ring-4 hover:ring-blue-300 transition">${avatarHtml}</div>
                            ${roleBadgeHtml}
                        </div>
                        <div class="flex-1">
                            <div class="bg-gray-50 rounded-lg p-3">
                                <div class="flex justify-between items-start">
                                    <p class="font-semibold text-sm text-gray-800">${comment.user_name}</p>
                                    ${canEdit ? `
                                        <div class="relative">
                                            <button 
                                                onclick="toggleCommentMenu(${comment.id})"
                                                class="text-gray-400 hover:text-gray-600 transition">
                                                <i class="fas fa-ellipsis-v text-sm"></i>
                                            </button>
                                            <div id="comment-menu-${comment.id}" class="hidden absolute right-0 mt-2 w-32 bg-white rounded-lg shadow-xl border border-gray-200 z-[9999] py-1">
                                                <button 
                                                    onclick="editComment(${comment.id}, ${postId})"
                                                    class="w-full text-left px-3 py-2 hover:bg-gray-50 transition flex items-center text-xs">
                                                    <i class="fas fa-edit text-blue-600 w-4"></i>
                                                    <span class="ml-2">수정</span>
                                                </button>
                                                <button 
                                                    onclick="deleteComment(${comment.id}, ${postId})"
                                                    class="w-full text-left px-3 py-2 hover:bg-gray-50 transition flex items-center text-xs">
                                                    <i class="fas fa-trash text-red-600 w-4"></i>
                                                    <span class="ml-2">삭제</span>
                                                </button>
                                            </div>
                                        </div>
                                    ` : ''}
                                </div>
                                <p class="text-sm text-gray-700 mt-1" id="comment-content-${comment.id}">${comment.content}</p>
                                <div id="comment-edit-form-${comment.id}" class="hidden mt-2">
                                    <input 
                                        type="text" 
                                        id="comment-edit-input-${comment.id}"
                                        value="${comment.content.replace(/"/g, '&quot;')}"
                                        class="w-full p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none"
                                    />
                                    <div class="flex space-x-2 mt-2">
                                        <button 
                                            onclick="saveCommentEdit(${comment.id}, ${postId})"
                                            class="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700 transition">
                                            <i class="fas fa-save mr-1"></i>저장
                                        </button>
                                        <button 
                                            onclick="cancelCommentEdit(${comment.id})"
                                            class="bg-gray-300 text-gray-700 px-3 py-1 rounded text-xs hover:bg-gray-400 transition">
                                            <i class="fas fa-times mr-1"></i>취소
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center space-x-4 mt-1">
                                <p class="text-xs text-gray-500">${formatDate(comment.created_at)}</p>
                                <button 
                                    onclick="toggleCommentLike(${comment.id}, ${postId})" 
                                    class="flex items-center space-x-1 text-xs ${isLiked ? 'text-red-600' : 'text-gray-500 hover:text-red-600'} transition"
                                    title="좋아요">
                                    <i class="fas fa-heart"></i>
                                    <span>${comment.likes_count || 0}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            });
            
            const html = `
                <div class="mt-4 space-y-3 pl-4 border-l-2 border-gray-200">
                    ${commentsHtml}
                    <div class="flex space-x-2 mt-3">
                        <input 
                            id="comment-input-${postId}"
                            type="text"
                            placeholder="댓글을 작성하세요..."
                            class="flex-1 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        />
                        <button 
                            id="comment-submit-${postId}"
                            class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </div>
                </div>
            `;
            
            commentsDiv.innerHTML = html;
            commentsDiv.classList.remove('hidden');
            
            // Add event listeners after HTML is inserted
            const submitBtn = document.getElementById(`comment-submit-${postId}`);
            const inputField = document.getElementById(`comment-input-${postId}`);
            
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
    const input = document.getElementById(`comment-input-${postId}`);
    const content = input.value;

    if (!content) {
        alert('댓글 내용을 입력해주세요.');
        return;
    }

    try {
        await axios.post(`/api/posts/${postId}/comments`, {
            user_id: currentUserId,
            content
        });
        input.value = '';
        refreshComments(postId); // Use refreshComments instead of loadComments to keep comments open
        // Don't call loadPosts() to keep comments section open
    } catch (error) {
        console.error('Error creating comment:', error);
        alert('댓글 작성에 실패했습니다.');
    }
}

// Toggle comment menu
function toggleCommentMenu(commentId) {
    const menu = document.getElementById(`comment-menu-${commentId}`);
    if (menu) {
        menu.classList.toggle('hidden');
        
        // Close other comment menus
        document.querySelectorAll('[id^="comment-menu-"]').forEach(m => {
            if (m.id !== `comment-menu-${commentId}`) {
                m.classList.add('hidden');
            }
        });
    }
}

// Edit comment
function editComment(commentId, postId) {
    // Hide menu
    toggleCommentMenu(commentId);
    
    // Hide display, show edit form
    document.getElementById(`comment-content-${commentId}`).classList.add('hidden');
    document.getElementById(`comment-edit-form-${commentId}`).classList.remove('hidden');
    
    // Focus on input
    const input = document.getElementById(`comment-edit-input-${commentId}`);
    if (input) {
        input.focus();
        input.select();
    }
}

// Cancel comment edit
function cancelCommentEdit(commentId) {
    // Show display, hide edit form
    document.getElementById(`comment-content-${commentId}`).classList.remove('hidden');
    document.getElementById(`comment-edit-form-${commentId}`).classList.add('hidden');
}

// Save comment edit
async function saveCommentEdit(commentId, postId) {
    const input = document.getElementById(`comment-edit-input-${commentId}`);
    const content = input.value.trim();
    
    if (!content) {
        showToast('댓글 내용을 입력해주세요.', 'error');
        return;
    }
    
    try {
        await axios.put(`/api/comments/${commentId}`, {
            content
        });
        
        showToast('댓글이 수정되었습니다.', 'success');
        
        // Refresh comments to show updated content
        refreshComments(postId);
    } catch (error) {
        console.error('Failed to update comment:', error);
        showToast('댓글 수정에 실패했습니다.', 'error');
    }
}

// Delete comment
async function deleteComment(commentId, postId) {
    if (!confirm('정말로 이 댓글을 삭제하시겠습니까?')) {
        toggleCommentMenu(commentId);
        return;
    }
    
    try {
        await axios.delete(`/api/comments/${commentId}`);
        showToast('댓글이 삭제되었습니다.', 'success');
        
        // Refresh comments
        refreshComments(postId);
    } catch (error) {
        console.error('Failed to delete comment:', error);
        showToast('댓글 삭제에 실패했습니다.', 'error');
    }
}

// Load posts
async function loadPosts() {
    try {
        const response = await axios.get(`/api/posts?user_id=${currentUserId}`);
        const posts = response.data.posts;
        const feed = document.getElementById('postsFeed');
        
        let postsHtml = '';
        posts.forEach(post => {
            console.log('🔍 Post ID:', post.id, 'is_prayer_request:', post.is_prayer_request, 'type:', typeof post.is_prayer_request);
            const isLiked = post.is_liked > 0;
            
            // Avatar HTML - Admin shows crown icon
            const avatarHtml = post.user_role === 'admin'
                ? '<i class="fas fa-crown text-yellow-400 text-2xl"></i>'
                : post.user_avatar 
                    ? `<img src="${post.user_avatar}" alt="Profile" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=&quot;fas fa-user&quot;></i>'" />`
                    : '<i class="fas fa-user"></i>';
            
            // Role badge HTML (skip admin badge since they have crown icon as avatar)
            let roleBadgeHtml = '';
            if (post.user_role === 'moderator') {
                roleBadgeHtml = '<div class="moderator-badge" title="운영자"><i class="fas fa-shield-alt"></i></div>';
            }
            
            // Verse reference removed - not a feature
            const verseHtml = '';
            
            const imageHtml = post.image_url ? `
                <div class="mt-3">
                    <img src="${post.image_url}" alt="Post image" class="w-full rounded-lg max-h-96 object-cover" onerror="this.style.display='none'" />
                </div>
            ` : '';
            
            const videoHtml = post.video_url ? `
                <div class="mt-3">
                    <video controls class="w-full rounded-lg max-h-96" controlsList="nodownload">
                        <source src="${post.video_url}" type="video/mp4">
                        동영상을 재생할 수 없습니다.
                    </video>
                </div>
            ` : '';
            
            // Shared post card (액자 안의 액자)
            let sharedPostHtml = '';
            if (post.shared_post_id) {
                // Shared Avatar HTML - Admin shows crown icon
                const sharedAvatarHtml = post.shared_user_role === 'admin'
                    ? '<i class="fas fa-crown text-yellow-400 text-lg"></i>'
                    : post.shared_user_avatar 
                        ? `<img src="${post.shared_user_avatar}" alt="Profile" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=&quot;fas fa-user&quot;></i>'" />`
                        : '<i class="fas fa-user"></i>';
                
                let sharedRoleBadgeHtml = '';
                if (post.shared_user_role === 'moderator') {
                    sharedRoleBadgeHtml = '<div class="moderator-badge" title="운영자"><i class="fas fa-shield-alt"></i></div>';
                }
                
                // Shared verse reference removed - not a feature
                const sharedVerseHtml = '';
                
                const sharedImageHtml = post.shared_image_url ? `
                    <div class="mt-2 max-w-full">
                        <img src="${post.shared_image_url}" alt="Shared post image" class="w-full rounded-lg max-h-48 object-cover" onerror="this.style.display='none'" />
                    </div>
                ` : '';
                
                const sharedVideoHtml = post.shared_video_url ? `
                    <div class="mt-2 max-w-full">
                        <video controls class="w-full rounded-lg max-h-48" controlsList="nodownload">
                            <source src="${post.shared_video_url}" type="video/mp4">
                            동영상을 재생할 수 없습니다.
                        </video>
                    </div>
                ` : '';
                
                sharedPostHtml = `
                    <div class="mt-3 bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg border-2 border-gray-400 p-4 shadow-sm max-w-full overflow-hidden">
                        <div class="flex items-center space-x-2 mb-3 pb-2 border-b border-gray-300">
                            <i class="fas fa-quote-left text-blue-600 text-sm"></i>
                            <span class="text-xs font-bold text-gray-700">공유된 포스팅</span>
                        </div>
                        <div class="flex items-start space-x-3">
                            <div class="admin-badge-container flex-shrink-0">
                                <div onclick="showUserProfileModal(${post.shared_user_id})" class="w-10 h-10 rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white flex-shrink-0 cursor-pointer hover:ring-4 hover:ring-blue-300 transition">
                                    ${sharedAvatarHtml}
                                </div>
                                ${sharedRoleBadgeHtml}
                            </div>
                            <div class="flex-1 min-w-0 overflow-hidden">
                                <div class="flex items-center space-x-2 flex-wrap">
                                    <h4 class="font-bold text-sm text-gray-800 truncate">${post.shared_user_name}</h4>
                                    <span class="text-xs text-gray-500 flex-shrink-0">•</span>
                                    <p class="text-xs text-gray-500 flex-shrink-0">${formatDate(post.shared_created_at)}</p>
                                </div>
                                <p class="text-xs text-gray-600 mb-2 truncate">${post.shared_user_church || ''}</p>
                                <p class="mt-2 text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed">${post.shared_content}</p>
                                ${sharedImageHtml}
                                ${sharedVideoHtml}
                                ${sharedVerseHtml}
                            </div>
                        </div>
                    </div>
                `;
            }
            
            // Background color style
            const backgroundStyle = post.background_color ? `style="background-color: ${post.background_color};"` : '';
            
            postsHtml += `
                <div class="bg-white rounded-xl shadow-md border-2 border-gray-300 p-6 transition-all duration-300 hover:shadow-xl hover:border-gray-500 hover:-translate-y-1" ${backgroundStyle}>
                    <div class="flex items-start space-x-4">
                        <div class="admin-badge-container">
                            <div onclick="showUserProfileModal(${post.user_id})" class="w-12 h-12 rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white flex-shrink-0 cursor-pointer hover:ring-4 hover:ring-blue-300 transition">${avatarHtml}</div>
                            ${roleBadgeHtml}
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="flex justify-between items-start">
                                <div>
                                    <h4 class="font-bold text-gray-800">${post.user_name}</h4>
                                    <p class="text-sm text-gray-500">${post.user_church || ''}</p>
                                </div>
                                <div class="flex items-center space-x-2">
                                    <p class="text-xs text-gray-500">${formatDate(post.created_at)}</p>
                                    ${currentUser ? `
                                        <div class="relative">
                                            <button 
                                                onclick="togglePostMenu(${post.id})"
                                                class="text-gray-500 hover:text-gray-700 transition p-1" 
                                                title="더보기">
                                                <i class="fas fa-ellipsis-v text-sm"></i>
                                            </button>
                                            <div id="post-menu-${post.id}" class="hidden absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-200 z-[9999] py-1">
                                                ${currentUser.id === post.user_id || currentUser.role === 'admin' ? `
                                                    <button 
                                                        onclick="editPost(${post.id})"
                                                        class="w-full text-left px-4 py-2 hover:bg-gray-50 transition flex items-center text-sm">
                                                        <i class="fas fa-edit text-blue-600 w-5"></i>
                                                        <span class="ml-2">게시물 수정</span>
                                                    </button>
                                                ` : ''}
                                                <button 
                                                    onclick="copyPostLink(${post.id})"
                                                    class="w-full text-left px-4 py-2 hover:bg-gray-50 transition flex items-center text-sm">
                                                    <i class="fas fa-link text-green-600 w-5"></i>
                                                    <span class="ml-2">링크 복사</span>
                                                </button>
                                                ${currentUser.id === post.user_id || currentUser.role === 'admin' ? `
                                                    <hr class="my-1">
                                                    <button 
                                                        onclick="deletePost(${post.id})"
                                                        class="w-full text-left px-4 py-2 hover:bg-gray-50 transition flex items-center text-sm text-red-600">
                                                        <i class="fas fa-trash-alt w-5"></i>
                                                        <span class="ml-2">게시물 삭제</span>
                                                    </button>
                                                ` : ''}
                                            </div>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                            
                            <!-- Post Content Display -->
                            <div id="post-content-display-${post.id}" class="mt-3">
                                <p class="text-gray-800 whitespace-pre-wrap">${post.content}</p>
                            </div>
                            
                            <!-- Post Content Edit Form (Hidden by default) -->
                            <div id="post-content-edit-${post.id}" class="hidden mt-3">
                                <textarea 
                                    id="post-edit-textarea-${post.id}"
                                    class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
                                    rows="4"
                                >${post.content}</textarea>
                                <div class="flex space-x-2 mt-2">
                                    <button 
                                        onclick="savePostEdit(${post.id})"
                                        class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm">
                                        <i class="fas fa-save mr-1"></i>저장
                                    </button>
                                    <button 
                                        onclick="cancelPostEdit(${post.id})"
                                        class="bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400 transition text-sm">
                                        <i class="fas fa-times mr-1"></i>취소
                                    </button>
                                </div>
                            </div>
                            
                            ${imageHtml}
                            ${videoHtml}
                            ${verseHtml}
                            ${sharedPostHtml}
                            <div class="mt-4 flex items-center space-x-6 text-gray-600">
                                ${post.background_color === '#F87171' ? `
                                    <!-- 중보 기도: 함께 기도합니다 -->
                                    <button onclick="togglePray(${post.id})" class="flex items-center space-x-2 ${post.is_prayed > 0 ? 'text-red-600' : 'hover:text-red-600'} transition group relative" title="함께 기도합니다">
                                        <i class="fas fa-praying-hands text-lg"></i>
                                        <span class="text-sm">${post.prayer_clicks_count || 0}</span>
                                        <span class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap">함께 기도합니다</span>
                                    </button>
                                ` : post.background_color === '#F5E398' ? `
                                    <!-- 말씀: 아멘! -->
                                    <button onclick="toggleLike(${post.id})" class="flex items-center space-x-2 ${isLiked ? 'text-yellow-600' : 'hover:text-yellow-600'} transition group relative" title="아멘!">
                                        <i class="fas fa-book-bible text-lg"></i>
                                        <span class="text-sm">${post.likes_count || 0}</span>
                                        <span class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap">아멘!</span>
                                    </button>
                                ` : post.background_color === '#F5D4B3' ? `
                                    <!-- 일상: 샬롬 -->
                                    <button onclick="toggleLike(${post.id})" class="flex items-center space-x-2 ${isLiked ? 'text-orange-600' : 'hover:text-orange-600'} transition group relative" title="샬롬">
                                        <i class="fas fa-dove text-lg"></i>
                                        <span class="text-sm">${post.likes_count || 0}</span>
                                        <span class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap">샬롬</span>
                                    </button>
                                ` : post.background_color === '#B3EDD8' ? `
                                    <!-- 사역: 응원합니다 -->
                                    <button onclick="toggleLike(${post.id})" class="flex items-center space-x-2 ${isLiked ? 'text-green-600' : 'hover:text-green-600'} transition group relative" title="응원합니다">
                                        <i class="fas fa-hands-helping text-lg"></i>
                                        <span class="text-sm">${post.likes_count || 0}</span>
                                        <span class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap">응원합니다</span>
                                    </button>
                                ` : post.background_color === '#C4E5F8' ? `
                                    <!-- 찬양: 할렐루야! -->
                                    <button onclick="toggleLike(${post.id})" class="flex items-center space-x-2 ${isLiked ? 'text-sky-600' : 'hover:text-sky-600'} transition group relative" title="할렐루야!">
                                        <i class="fas fa-music text-lg"></i>
                                        <span class="text-sm">${post.likes_count || 0}</span>
                                        <span class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap">할렐루야!</span>
                                    </button>
                                ` : post.background_color === '#E2DBFB' ? `
                                    <!-- 교회: 우리는 하나 -->
                                    <button onclick="toggleLike(${post.id})" class="flex items-center space-x-2 ${isLiked ? 'text-violet-600' : 'hover:text-violet-600'} transition group relative" title="우리는 하나">
                                        <i class="fas fa-church text-lg"></i>
                                        <span class="text-sm">${post.likes_count || 0}</span>
                                        <span class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap">우리는 하나</span>
                                    </button>
                                ` : `
                                    <!-- 자유: 좋아요 -->
                                    <button onclick="toggleLike(${post.id})" class="flex items-center space-x-2 ${isLiked ? 'text-pink-600' : 'hover:text-pink-600'} transition group relative" title="좋아요">
                                        <i class="fas fa-heart text-lg"></i>
                                        <span class="text-sm">${post.likes_count || 0}</span>
                                        <span class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap">좋아요</span>
                                    </button>
                                `}
                                <button onclick="loadComments(${post.id})" class="flex items-center space-x-2 hover:text-blue-600 transition group relative" title="댓글">
                                    <i class="fas fa-comment text-lg"></i>
                                    <span class="text-sm">${post.comments_count || 0}</span>
                                    <span class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap">댓글</span>
                                </button>
                                <button onclick="sharePost(${post.id})" class="flex items-center space-x-2 hover:text-blue-600 transition group relative" title="공유하기">
                                    <i class="fas fa-share text-lg"></i>
                                    <span class="text-sm">공유</span>
                                    <span class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap">공유하기</span>
                                </button>
                            </div>
                            <div id="comments-${post.id}" class="hidden"></div>
                        </div>
                    </div>
                </div>
            `;
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
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}일 전`;
    
    return date.toLocaleDateString('ko-KR');
}

// Show toast notification
function showToast(message, type = 'info') {
    // Remove existing toasts
    const existingToasts = document.querySelectorAll('.toast-notification');
    existingToasts.forEach(toast => toast.remove());
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'toast-notification fixed top-20 right-4 px-6 py-3 rounded-lg shadow-lg text-white z-[10000] transform transition-all duration-300 translate-x-0';
    
    // Set color based on type
    if (type === 'success') {
        toast.classList.add('bg-green-600');
        toast.innerHTML = `<i class="fas fa-check-circle mr-2"></i>${message}`;
    } else if (type === 'error') {
        toast.classList.add('bg-red-600');
        toast.innerHTML = `<i class="fas fa-exclamation-circle mr-2"></i>${message}`;
    } else if (type === 'warning') {
        toast.classList.add('bg-yellow-600');
        toast.innerHTML = `<i class="fas fa-exclamation-triangle mr-2"></i>${message}`;
    } else {
        toast.classList.add('bg-blue-600');
        toast.innerHTML = `<i class="fas fa-info-circle mr-2"></i>${message}`;
    }
    
    // Add to body
    document.body.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
        toast.style.transform = 'translateX(0)';
    }, 10);
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.transform = 'translateX(400px)';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

// Show toast notification with custom background color (matching post background)
function showToastWithColor(message, backgroundColor) {
    // Remove existing toasts
    const existingToasts = document.querySelectorAll('.toast-notification');
    existingToasts.forEach(toast => toast.remove());
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'toast-notification fixed top-20 right-4 px-6 py-3 rounded-lg shadow-lg z-[10000] transform transition-all duration-300 translate-x-0 border-2';
    
    // Set background color to match the post color
    toast.style.backgroundColor = backgroundColor;
    
    // Set text color based on background brightness for better readability
    // Dark text for light backgrounds, light text for dark backgrounds
    const isDarkBackground = ['#FCA5A5', '#A7F3D0', '#BAE6FD', '#DDD6FE'].includes(backgroundColor);
    const textColor = (backgroundColor === '#FFFFFF' || !isDarkBackground) ? '#1F2937' : '#1F2937';
    toast.style.color = textColor;
    
    // Set border color slightly darker than background
    const borderColors = {
        '#F87171': '#DC2626',  // 중보 기도 - 빨간색
        '#F5E398': '#CA8A04',  // 말씀 - 노란색
        '#F5D4B3': '#EA580C',  // 일상 - 주황색
        '#B3EDD8': '#059669',  // 사역 - 초록색
        '#C4E5F8': '#0284C7',  // 찬양 - 하늘색
        '#E2DBFB': '#7C3AED',  // 교회 - 보라색
        '#FFFFFF': '#D1D5DB'   // 자유 - 회색
    };
    toast.style.borderColor = borderColors[backgroundColor] || '#D1D5DB';
    
    // Add appropriate icon and message
    toast.innerHTML = `<i class="fas fa-check-circle mr-2"></i>${message}`;
    
    // Add to body
    document.body.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
        toast.style.transform = 'translateX(0)';
    }, 10);
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.transform = 'translateX(400px)';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

// Auto-login from localStorage
async function autoLogin() {
    const savedUserId = localStorage.getItem('currentUserId');
    const savedEmail = localStorage.getItem('currentUserEmail');
    
    if (savedUserId && savedEmail) {
        try {
            // Use /api/login endpoint (handles admin auto-creation)
            const response = await axios.post('/api/login', {
                email: savedEmail
            });
            
            if (response.data.user) {
                // User exists, restore session
                currentUserId = response.data.user.id;
                currentUser = response.data.user;
                
                // Update localStorage with latest data
                localStorage.setItem('currentUserId', response.data.user.id);
                
                updateAuthUI();
                
                // Load user scores from API
                await loadUserScores();
                
                loadPosts();
                console.log('자동 로그인 성공:', currentUser.name, '(역할:', currentUser.role + ')');
            }
        } catch (error) {
            // Error fetching user, clear localStorage
            console.error('자동 로그인 실패:', error);
            localStorage.removeItem('currentUserId');
            localStorage.removeItem('currentUserEmail');
            localStorage.removeItem('currentUser');
        }
    }
}

// Background Color Selection Functions
function selectBackgroundColor(color, element) {
    // Update selected color
    selectedBackgroundColor = color;
    
    // Remove 'selected' class from all color buttons
    const allColorButtons = document.querySelectorAll('.color-selector-btn');
    allColorButtons.forEach(btn => {
        btn.classList.remove('ring-4', 'ring-offset-2');
    });
    
    // Add 'selected' class to clicked button
    if (element) {
        element.classList.add('ring-4', 'ring-offset-2');
    }
    
    // Update post textarea background
    const textarea = document.getElementById('newPostContent');
    if (color) {
        textarea.style.backgroundColor = color;
        textarea.style.color = '#1F2937'; // Dark gray text for readability
    } else {
        textarea.style.backgroundColor = '';
        textarea.style.color = '';
    }
}

function resetBackgroundColor() {
    selectedBackgroundColor = null;
    
    // Remove selection highlight from all buttons
    const allColorButtons = document.querySelectorAll('.color-selector-btn');
    allColorButtons.forEach(btn => {
        btn.classList.remove('ring-4', 'ring-offset-2');
    });
    
    // Reset textarea background
    const textarea = document.getElementById('newPostContent');
    textarea.style.backgroundColor = '';
    textarea.style.color = '';
}

// Show any user's profile (for clicking avatars in posts)
async function showUserProfileModal(userId) {
    try {
        // Fetch user data with current user context for privacy filtering
        const url = currentUserId 
            ? `/api/users/${userId}?current_user_id=${currentUserId}`
            : `/api/users/${userId}`;
        const response = await axios.get(url);
        const user = response.data.user;
        
        // Parse faith answers if exists
        let faithAnswers = null;
        if (user.faith_answers) {
            try {
                faithAnswers = JSON.parse(user.faith_answers);
            } catch (e) {
                console.error('Failed to parse faith_answers:', e);
            }
        }
        
        const roleColor = user.role === 'admin' ? 'text-red-600 bg-red-50' : user.role === 'moderator' ? 'text-yellow-600 bg-yellow-50' : 'text-gray-600 bg-gray-50';
        const roleName = user.role === 'admin' ? '관리자' : user.role === 'moderator' ? '운영자' : '일반 사용자';
        
        // Check if viewing own profile
        const isOwnProfile = currentUserId && currentUserId === user.id;
        
        // Parse privacy settings
        const privacySettings = user.privacy_settings ? JSON.parse(user.privacy_settings) : {};
        const showBasicInfo = isOwnProfile || privacySettings.basic_info !== false;
        const showChurchInfo = isOwnProfile || privacySettings.church_info !== false;
        const showFaithAnswers = isOwnProfile || privacySettings.faith_answers !== false;
        const showEducationInfo = isOwnProfile || privacySettings.education_info !== false;
        const showCareerInfo = isOwnProfile || privacySettings.career_info !== false;
        const showScores = isOwnProfile || privacySettings.scores !== false;
        
        console.log('프로필 수정 아이콘 표시 체크:', {
            currentUserId,
            userId: user.id,
            isOwnProfile,
            currentUserRole: currentUser?.role,
            viewedUserRole: user.role
        });
        
        const content = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <!-- Profile Section -->
                <div class="md:col-span-1">
                    <div class="bg-gray-50 rounded-lg p-6 text-center">
                        <div class="w-32 h-32 mx-auto rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white text-4xl mb-4">
                            ${user.role === 'admin' 
                                ? '<i class="fas fa-crown text-yellow-400"></i>'
                                : user.avatar_url 
                                    ? `<img src="${user.avatar_url}" alt="Profile" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=&quot;fas fa-user&quot;></i>'" />` 
                                    : '<i class="fas fa-user"></i>'}
                        </div>
                        <h3 class="text-xl font-bold text-gray-800 mb-2">${user.name}</h3>
                        <span class="inline-block px-3 py-1 rounded-full text-sm font-semibold ${roleColor}">
                            ${roleName}
                        </span>
                        <div class="mt-4 text-xs text-gray-500">
                            <p>회원 ID: #${user.id}</p>
                            <p>가입일: ${new Date(user.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                        </div>
                    </div>
                </div>
                
                <!-- Details Section -->
                <div class="md:col-span-2 space-y-4">
                    ${showScores && (isOwnProfile || user.prayer_score !== null || user.scripture_score !== null || user.activity_score !== null) ? `
                    <div class="bg-purple-50 border-l-4 border-purple-600 p-4 rounded">
                        <h4 class="font-semibold text-purple-800 mb-3">
                            <i class="fas fa-trophy mr-2"></i>${isOwnProfile ? '나의 점수' : '점수 정보'}
                        </h4>
                        <div class="grid grid-cols-4 gap-3">
                            <div class="text-center bg-yellow-50 p-3 rounded-lg border-2 border-yellow-200">
                                <div class="flex flex-col items-center">
                                    <i class="fas fa-book-bible text-yellow-600 text-2xl mb-2"></i>
                                    <span class="text-xs text-gray-600 mb-1">성경 점수</span>
                                    <span class="text-2xl font-bold text-yellow-600">${user.scripture_score ?? 0}</span>
                                </div>
                            </div>
                            <div class="text-center bg-blue-50 p-3 rounded-lg border-2 border-blue-200">
                                <div class="flex flex-col items-center">
                                    <i class="fas fa-praying-hands text-blue-600 text-2xl mb-2"></i>
                                    <span class="text-xs text-gray-600 mb-1">기도 점수</span>
                                    <span class="text-2xl font-bold text-blue-600">${user.prayer_score ?? 0}</span>
                                </div>
                            </div>
                            <div class="text-center bg-green-50 p-3 rounded-lg border-2 border-green-200">
                                <div class="flex flex-col items-center">
                                    <i class="fas fa-heart text-green-600 text-2xl mb-2"></i>
                                    <span class="text-xs text-gray-600 mb-1">활동 점수</span>
                                    <span class="text-2xl font-bold text-green-600">${user.activity_score ?? 0}</span>
                                </div>
                            </div>
                            <div class="text-center bg-purple-50 p-3 rounded-lg border-2 border-purple-200">
                                <div class="flex flex-col items-center">
                                    <i class="fas fa-trophy text-purple-600 text-2xl mb-2"></i>
                                    <span class="text-xs text-gray-600 mb-1">종합점수</span>
                                    <span class="text-2xl font-bold text-purple-600">${(user.scripture_score ?? 0) + (user.prayer_score ?? 0) + (user.activity_score ?? 0)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    ` : ''}
                    
                    ${showBasicInfo ? `
                    <div class="bg-blue-50 border-l-4 border-blue-600 p-4 rounded">
                        <h4 class="font-semibold text-blue-800 mb-3">
                            <i class="fas fa-info-circle mr-2"></i>기본 정보
                        </h4>
                        <div class="space-y-2 text-sm text-gray-700">
                            <p><strong>이메일:</strong> ${user.email || '미입력'}</p>
                            <p><strong>성별:</strong> ${user.gender || '미입력'}</p>
                            <p><strong>결혼:</strong> ${user.marital_status === 'single' ? '미혼' : user.marital_status === 'married' ? '기혼' : user.marital_status === 'other' ? '기타' : '미입력'}</p>
                            <p><strong>전화번호:</strong> ${user.phone || '미입력'}</p>
                            <p><strong>주소:</strong> ${user.address || '미입력'}</p>
                        </div>
                    </div>
                    ` : ''}
                    
                    ${showChurchInfo ? `
                    <div class="bg-green-50 border-l-4 border-green-600 p-4 rounded">
                        <h4 class="font-semibold text-green-800 mb-3">
                            <i class="fas fa-church mr-2"></i>교회 정보
                        </h4>
                        <div class="space-y-2 text-sm text-gray-700">
                            <p><strong>소속 교회:</strong> ${user.church || '미입력'}</p>
                            <p><strong>담임목사:</strong> ${user.pastor || '미입력'}</p>
                            <p><strong>교단:</strong> ${user.denomination || '미입력'}</p>
                            <p><strong>교회 위치:</strong> ${user.location || '미입력'}</p>
                            <p><strong>직분:</strong> ${user.position || '미입력'}</p>
                        </div>
                    </div>
                    ` : ''}
                    
                    ${(isOwnProfile || showFaithAnswers) && faithAnswers ? `
                    <div class="bg-yellow-50 border-l-4 border-yellow-600 p-4 rounded">
                        <h4 class="font-semibold text-yellow-800 mb-3">
                            <i class="fas fa-cross mr-2"></i>신앙 고백
                        </h4>
                        <div class="space-y-2 text-sm">
                            <div class="flex items-center justify-between">
                                <span class="text-gray-700">1. 예수님이 창조주 하나님임을 믿습니까?</span>
                                <span class="font-semibold text-gray-800">${faithAnswers.q1 || '-'}</span>
                            </div>
                            <div class="flex items-center justify-between">
                                <span class="text-gray-700">2. 십자가 대속을 믿습니까?</span>
                                <span class="font-semibold text-gray-800">${faithAnswers.q2 || '-'}</span>
                            </div>
                            <div class="flex items-center justify-between">
                                <span class="text-gray-700">3. 예수님의 부활을 믿습니까?</span>
                                <span class="font-semibold text-gray-800">${faithAnswers.q3 || '-'}</span>
                            </div>
                            <div class="flex items-center justify-between">
                                <span class="text-gray-700">4. 예수님을 주님으로 영접했습니까?</span>
                                <span class="font-semibold text-gray-800">${faithAnswers.q4 || '-'}</span>
                            </div>
                            <div class="flex items-center justify-between">
                                <span class="text-gray-700">5. 성령님이 계십니까?</span>
                                <span class="font-semibold text-gray-800">${faithAnswers.q5 || '-'}</span>
                            </div>
                            <div class="flex items-center justify-between">
                                <span class="text-gray-700">6. 천국 갈 것을 확신합니까?</span>
                                <span class="font-semibold text-gray-800">${faithAnswers.q6 || '-'}</span>
                            </div>
                            <div class="flex items-center justify-between">
                                <span class="text-gray-700">7. 성경을 진리로 믿습니까?</span>
                                <span class="font-semibold text-gray-800">${faithAnswers.q7 || '-'}</span>
                            </div>
                            <div class="flex items-center justify-between">
                                <span class="text-gray-700">8. 정기적으로 예배에 참석합니까?</span>
                                <span class="font-semibold text-gray-800">${faithAnswers.q8 || '-'}</span>
                            </div>
                            <div class="flex items-center justify-between">
                                <span class="text-gray-700">9. 정기적으로 기도합니까?</span>
                                <span class="font-semibold text-gray-800">${faithAnswers.q9 || '-'}</span>
                            </div>
                            <div class="flex items-center justify-between">
                                <span class="text-gray-700">10. 가끔 전도합니까?</span>
                                <span class="font-semibold text-gray-800">${faithAnswers.q10 || '-'}</span>
                            </div>
                        </div>
                    </div>
                    ` : ''}
                    
                    ${showCareerInfo && user.careers !== null ? `
                    <div class="bg-purple-50 border-l-4 border-purple-600 p-4 rounded">
                        <h4 class="font-semibold text-purple-800 mb-3">
                            <i class="fas fa-briefcase mr-2"></i>직업 정보 <span class="text-xs text-gray-500 font-normal">(선택사항)</span>
                        </h4>
                        <div class="space-y-3 text-sm text-gray-700">
                            <div>
                                <p class="font-medium text-gray-800 mb-1">경력:</p>
                                ${(() => {
                                    const careers = user.careers ? JSON.parse(user.careers) : [];
                                    if (careers.length === 0) {
                                        return '<p class="ml-2">미입력</p>';
                                    }
                                    return careers.map(career => {
                                        const parts = [];
                                        if (career.company) parts.push(career.company);
                                        if (career.position) parts.push(career.position);
                                        const text = parts.join(' - ');
                                        const period = career.period ? ' (' + career.period + ')' : '';
                                        return '<p class="ml-2">• ' + text + period + '</p>';
                                    }).join('');
                                })()}
                            </div>
                        </div>
                    </div>
                    ` : ''}
                    
                    ${showEducationInfo && (user.elementary_school !== null || user.middle_school !== null || user.high_school !== null || user.universities !== null || user.masters_degrees !== null || user.phd_degrees !== null) ? `
                    <div class="bg-orange-50 border-l-4 border-orange-600 p-4 rounded">
                        <h4 class="font-semibold text-orange-800 mb-3">
                            <i class="fas fa-graduation-cap mr-2"></i>학교 정보 <span class="text-xs text-gray-500 font-normal">(선택사항)</span>
                        </h4>
                        <div class="space-y-3 text-sm text-gray-700">
                            ${user.elementary_school !== null ? `
                            <div>
                                <p class="font-medium text-gray-800 mb-1">초등학교:</p>
                                <p class="ml-2">${user.elementary_school || '미입력'}</p>
                            </div>
                            ` : ''}
                            ${user.middle_school !== null ? `
                            <div>
                                <p class="font-medium text-gray-800 mb-1">중학교:</p>
                                <p class="ml-2">${user.middle_school || '미입력'}</p>
                            </div>
                            ` : ''}
                            ${user.high_school !== null ? `
                            <div>
                                <p class="font-medium text-gray-800 mb-1">고등학교:</p>
                                <p class="ml-2">${user.high_school || '미입력'}</p>
                            </div>
                            ` : ''}
                            ${user.universities !== null ? `
                            <div>
                                <p class="font-medium text-gray-800 mb-1">대학교:</p>
                                ${(() => {
                                    const universities = user.universities ? JSON.parse(user.universities) : [];
                                    // 하위 호환성: 기존 단일 필드 데이터 처리
                                    if (universities.length === 0 && (user.university || user.university_major)) {
                                        universities.push({ school: user.university || '', major: user.university_major || '' });
                                    }
                                    if (universities.length === 0) {
                                        return '<p class="ml-2">미입력</p>';
                                    }
                                    return universities.map(edu => {
                                        const text = edu.school + (edu.major ? ' (' + edu.major + ')' : '');
                                        return '<p class="ml-2">• ' + text + '</p>';
                                    }).join('');
                                })()}
                            </div>
                            ` : ''}
                            ${user.masters_degrees !== null ? `
                            <div>
                                <p class="font-medium text-gray-800 mb-1">석사:</p>
                                ${(() => {
                                    const masters = user.masters_degrees ? JSON.parse(user.masters_degrees) : [];
                                    // 하위 호환성: 기존 단일 필드 데이터 처리
                                    if (masters.length === 0 && (user.masters || user.masters_major)) {
                                        masters.push({ school: user.masters || '', major: user.masters_major || '' });
                                    }
                                    if (masters.length === 0) {
                                        return '<p class="ml-2">미입력</p>';
                                    }
                                    return masters.map(edu => {
                                        const text = edu.school + (edu.major ? ' (' + edu.major + ')' : '');
                                        return '<p class="ml-2">• ' + text + '</p>';
                                    }).join('');
                                })()}
                            </div>
                            ` : ''}
                            ${user.phd_degrees !== null ? `
                            <div>
                                <p class="font-medium text-gray-800 mb-1">박사:</p>
                                ${(() => {
                                    const phds = user.phd_degrees ? JSON.parse(user.phd_degrees) : [];
                                    // 하위 호환성: 기존 단일 필드 데이터 처리
                                    if (phds.length === 0 && (user.phd || user.phd_major)) {
                                        phds.push({ school: user.phd || '', major: user.phd_major || '' });
                                    }
                                    if (phds.length === 0) {
                                        return '<p class="ml-2">미입력</p>';
                                    }
                                    return phds.map(edu => {
                                        const text = edu.school + (edu.major ? ' (' + edu.major + ')' : '');
                                        return '<p class="ml-2">• ' + text + '</p>';
                                    }).join('');
                                })()}
                            </div>
                            ` : ''}
                        </div>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
        
        // Hide posts feed and show profile view
        document.getElementById('postsFeed').classList.add('hidden');
        document.getElementById('newPostCard').classList.add('hidden');
        document.getElementById('profileView').classList.remove('hidden');
        document.getElementById('profileViewContent').innerHTML = content;
        
        // Update profile header with edit button if viewing own profile
        const profileViewHeader = document.querySelector('#profileView .flex.items-center.justify-between');
        console.log('프로필 헤더 업데이트:', { 
            profileViewHeader: !!profileViewHeader, 
            isOwnProfile 
        });
        
        if (profileViewHeader) {
            const h2 = profileViewHeader.querySelector('h2');
            console.log('h2 요소:', { h2: !!h2 });
            
            if (h2) {
                // Reset h2 content to default "프로필"
                h2.innerHTML = '<i class="fas fa-user text-blue-600 mr-2"></i>프로필';
                
                // Add edit button inside h2 if viewing own profile
                if (isOwnProfile) {
                    console.log('수정 버튼 추가 중...');
                    const editBtn = document.createElement('button');
                    editBtn.onclick = function() { showEditProfileModal(); };
                    editBtn.className = 'text-blue-600 hover:text-blue-700 transition ml-3 relative -top-0.5';
                    editBtn.title = '프로필 수정';
                    editBtn.innerHTML = '<i class="fas fa-edit text-lg"></i>';
                    h2.appendChild(editBtn);
                    console.log('수정 버튼 추가 완료!');
                } else {
                    console.log('본인 프로필이 아니므로 수정 버튼 미표시');
                }
            }
        }
        
        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
        console.error('Failed to load user profile:', error);
        alert('프로필을 불러오는데 실패했습니다.');
    }
}

// Hide profile and show posts feed
function hideProfile() {
    document.getElementById('profileView').classList.add('hidden');
    document.getElementById('postsFeed').classList.remove('hidden');
    document.getElementById('newPostCard').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Go to home (main feed)
function goToHome() {
    // Hide profile if it's open
    const profileView = document.getElementById('profileView');
    if (profileView && !profileView.classList.contains('hidden')) {
        hideProfile();
    } else {
        // Already on home, just scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// Career entry management functions
function addCareerEntry() {
    const container = document.getElementById('careersContainer');
    if (!container) return;
    
    const currentEntries = container.querySelectorAll('.career-entry');
    const newIndex = currentEntries.length;
    
    const newEntry = document.createElement('div');
    newEntry.className = 'career-entry border border-gray-200 rounded p-2';
    newEntry.setAttribute('data-index', newIndex);
    newEntry.innerHTML = `
        <div class="flex items-start gap-2">
            <div class="flex-1 space-y-2">
                <input 
                    type="text" 
                    class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                    placeholder="회사/기관명 (예: 삼성전자)"
                    value=""
                    data-field="company" />
                <input 
                    type="text" 
                    class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                    placeholder="직책/직위 (예: 책임연구원)"
                    value=""
                    data-field="position" />
                <input 
                    type="text" 
                    class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                    placeholder="재직기간 (예: 2020-2023 또는 2020-현재)"
                    value=""
                    data-field="period" />
            </div>
            <button 
                type="button"
                onclick="removeCareerEntry(this)"
                class="text-red-500 hover:text-red-700 p-2">
                <i class="fas fa-trash text-sm"></i>
            </button>
        </div>
    `;
    
    container.appendChild(newEntry);
    
    // 항목이 2개 이상이면 첫 번째 항목에도 삭제 버튼 추가
    updateCareerDeleteButtons();
}

function removeCareerEntry(button) {
    const entry = button.closest('.career-entry');
    const container = entry.parentElement;
    
    entry.remove();
    
    // 인덱스 재조정
    const entries = container.querySelectorAll('.career-entry');
    entries.forEach((entry, idx) => {
        entry.setAttribute('data-index', idx);
    });
    
    // 삭제 버튼 업데이트
    updateCareerDeleteButtons();
}

function updateCareerDeleteButtons() {
    const container = document.getElementById('careersContainer');
    if (!container) return;
    
    const entries = container.querySelectorAll('.career-entry');
    
    entries.forEach((entry, idx) => {
        const existingButton = entry.querySelector('.fa-trash')?.closest('button');
        const inputContainer = entry.querySelector('.flex-1');
        const parentDiv = entry.querySelector('.flex.items-start.gap-2');
        
        if (entries.length > 1) {
            // 2개 이상이면 삭제 버튼 보이기/추가
            if (!existingButton) {
                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'text-red-500 hover:text-red-700 p-2';
                deleteBtn.onclick = function() { removeCareerEntry(this); };
                deleteBtn.innerHTML = '<i class="fas fa-trash text-sm"></i>';
                parentDiv.appendChild(deleteBtn);
            }
        } else {
            // 1개만 남으면 삭제 버튼 제거
            if (existingButton) {
                existingButton.remove();
            }
        }
    });
}

// Education entry management functions
function addEducationEntry(type) {
    const containerMap = {
        'university': 'universitiesContainer',
        'masters': 'mastersContainer',
        'phd': 'phdContainer'
    };
    
    const placeholderMap = {
        'university': { school: '예: 서울대학교', major: '전공 (예: 컴퓨터공학)' },
        'masters': { school: '예: 서울대학교 대학원', major: '전공 (예: 신학)' },
        'phd': { school: '예: 하버드대학교', major: '전공 (예: 조직신학)' }
    };
    
    const container = document.getElementById(containerMap[type]);
    if (!container) return;
    
    const currentEntries = container.querySelectorAll('.education-entry');
    const newIndex = currentEntries.length;
    const placeholder = placeholderMap[type];
    
    const newEntry = document.createElement('div');
    newEntry.className = 'education-entry border border-gray-200 rounded p-2';
    newEntry.setAttribute('data-type', type);
    newEntry.setAttribute('data-index', newIndex);
    newEntry.innerHTML = `
        <div class="flex items-start gap-2">
            <div class="flex-1 space-y-2">
                <input 
                    type="text" 
                    class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 text-sm"
                    placeholder="${placeholder.school}"
                    value=""
                    data-field="school" />
                <input 
                    type="text" 
                    class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 text-sm"
                    placeholder="${placeholder.major}"
                    value=""
                    data-field="major" />
            </div>
            <button 
                type="button"
                onclick="removeEducationEntry(this)"
                class="text-red-500 hover:text-red-700 p-2">
                <i class="fas fa-trash text-sm"></i>
            </button>
        </div>
    `;
    
    container.appendChild(newEntry);
    
    // 항목이 2개 이상이면 첫 번째 항목에도 삭제 버튼 추가
    updateDeleteButtons(containerMap[type]);
}

function removeEducationEntry(button) {
    const entry = button.closest('.education-entry');
    const container = entry.parentElement;
    
    entry.remove();
    
    // 인덱스 재조정
    const entries = container.querySelectorAll('.education-entry');
    entries.forEach((entry, idx) => {
        entry.setAttribute('data-index', idx);
    });
    
    // 삭제 버튼 업데이트
    updateDeleteButtons(container.id);
}

function updateDeleteButtons(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const entries = container.querySelectorAll('.education-entry');
    
    entries.forEach((entry, idx) => {
        const existingButton = entry.querySelector('.fa-trash')?.closest('button');
        const inputContainer = entry.querySelector('.flex-1');
        const parentDiv = entry.querySelector('.flex.items-start.gap-2');
        
        if (entries.length > 1) {
            // 2개 이상이면 삭제 버튼 보이기/추가
            if (!existingButton) {
                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'text-red-500 hover:text-red-700 p-2';
                deleteBtn.onclick = function() { removeEducationEntry(this); };
                deleteBtn.innerHTML = '<i class="fas fa-trash text-sm"></i>';
                parentDiv.appendChild(deleteBtn);
            }
        } else {
            // 1개만 남으면 삭제 버튼 제거
            if (existingButton) {
                existingButton.remove();
            }
        }
    });
}

// Initialize
updateAuthUI();
updateEmailDatalist(); // Load email history
autoLogin(); // Auto-login if session exists
