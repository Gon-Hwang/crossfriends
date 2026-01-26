
let currentUserId = null;
let currentUser = null;
let selectedBackgroundColor = null; // 선택된 배경색

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
        
        typingScore = data.typing_score || 0;
        videoScore = data.scripture_score || 0;
        prayerScore = data.prayer_score || 0;
        activityScore = data.activity_score || 0;
        
        // Load completed videos
        if (data.completed_videos && Array.isArray(data.completed_videos)) {
            completedVideos = new Set(data.completed_videos);
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
        await axios.post(`/api/users/${currentUserId}/scores/typing`, { score });
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
    
    // Calculate points earned (accuracy percentage = points)
    let pointsEarned = 0;
    let bonusMessage = '';
    
    if (!isAlreadyCompleted) {
        pointsEarned = accuracy;
        // Mark as completed if accuracy is high enough
        if (accuracy >= 90) {
            completedVerses.add(verseId);
        }
    } else {
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
    let resultMessage = '다시 도전해보세요!';
    
    if (accuracy === 100) {
        resultColor = 'text-green-600';
        resultIcon = 'fa-check-circle';
        resultMessage = isAlreadyCompleted ? '완벽합니다! (이미 완료)' : '완벽합니다! 🎉';
    } else if (accuracy >= 90) {
        resultColor = 'text-blue-600';
        resultIcon = 'fa-smile';
        resultMessage = isAlreadyCompleted ? '훌륭합니다! (이미 완료)' : '훌륭합니다! 😊';
    } else if (accuracy >= 70) {
        resultColor = 'text-yellow-600';
        resultIcon = 'fa-meh';
        resultMessage = '좋아요! 조금만 더!';
    }
    
    typingResult.innerHTML = `
        <div class="bg-gray-50 border-2 border-gray-300 rounded-lg p-3 text-center">
            <p class="text-sm text-gray-700">타이핑을 완료하고 엔터를 누르면 <strong class="text-blue-600">100점</strong></p>
        </div>
    `;
    
    // Clear input after a delay
    setTimeout(() => {
        typingInput.value = '';
        typingInput.focus();
    }, 2000);
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
    
    try {
        // Fetch latest user data
        const response = await axios.get('/api/users/' + currentUserId);
        const user = response.data.user;
        
        // Parse faith answers if exists
        let faithAnswers = null;
        if (user.faith_answers) {
            try {
                faithAnswers = JSON.parse(user.faith_answers);
                console.log('Parsed faith answers:', faithAnswers);
            } catch (e) {
                console.error('Failed to parse faith_answers:', e);
            }
        } else {
            console.log('No faith_answers data for user');
        }
        
        const roleColor = user.role === 'admin' ? 'text-red-600 bg-red-50' : user.role === 'moderator' ? 'text-yellow-600 bg-yellow-50' : 'text-gray-600 bg-gray-50';
        const roleName = user.role === 'admin' ? '관리자' : user.role === 'moderator' ? '운영자' : '일반 사용자';
        
        const content = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <!-- Profile Section -->
                <div class="md:col-span-1">
                    <div class="bg-gray-50 rounded-lg p-6 text-center">
                        <div class="w-32 h-32 mx-auto rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white text-4xl mb-4">
                            ${user.avatar_url ? `<img src="${user.avatar_url}" alt="Profile" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=&quot;fas fa-user&quot;></i>'" />` : '<i class="fas fa-user"></i>'}
                        </div>
                        <h3 class="text-xl font-bold text-gray-800 mb-2">${user.name}</h3>
                        <span class="inline-block px-3 py-1 rounded-full text-sm font-semibold ${roleColor}">
                            ${roleName}
                        </span>
                        <div class="mt-4 text-xs text-gray-500">
                            <p>회원 ID: #${user.id}</p>
                            <p>가입일: ${new Date(user.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                            ${user.updated_at && user.updated_at !== user.created_at ? `<p>최근 수정: ${new Date(user.updated_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</p>` : ''}
                        </div>
                    </div>
                </div>
                
                <!-- Details Section -->
                <div class="md:col-span-2 space-y-4">
                    <div class="bg-blue-50 border-l-4 border-blue-600 p-4 rounded">
                        <h4 class="font-semibold text-blue-800 mb-3">
                            <i class="fas fa-info-circle mr-2"></i>기본 정보
                        </h4>
                        <div class="grid grid-cols-2 gap-3 text-sm">
                            <div>
                                <span class="text-gray-600">이메일:</span>
                                <p class="font-medium text-gray-800 break-all">${user.email}</p>
                            </div>
                            <div>
                                <span class="text-gray-600">이름:</span>
                                <p class="font-medium text-gray-800">${user.name}</p>
                            </div>
                            <div>
                                <span class="text-gray-600">성별:</span>
                                <p class="font-medium text-gray-800">${user.gender || '-'}</p>
                            </div>
                            <div>
                                <span class="text-gray-600">역할:</span>
                                <p class="font-medium text-gray-800">${roleName}</p>
                            </div>
                        </div>
                    </div>
                    
                    <div class="bg-green-50 border-l-4 border-green-600 p-4 rounded">
                        <h4 class="font-semibold text-green-800 mb-3">
                            <i class="fas fa-church mr-2"></i>교회 정보
                        </h4>
                        <div class="grid grid-cols-2 gap-3 text-sm">
                            <div>
                                <span class="text-gray-600">소속 교회:</span>
                                <p class="font-medium text-gray-800">${user.church || '-'}</p>
                            </div>
                            <div>
                                <span class="text-gray-600">담임목사:</span>
                                <p class="font-medium text-gray-800">${user.pastor || '-'}</p>
                            </div>
                            <div>
                                <span class="text-gray-600">교단:</span>
                                <p class="font-medium text-gray-800">${user.denomination || '-'}</p>
                            </div>
                            <div>
                                <span class="text-gray-600">교회 직분:</span>
                                <p class="font-medium text-gray-800">${user.position || '-'}</p>
                            </div>
                            <div class="col-span-2">
                                <span class="text-gray-600">교회 위치:</span>
                                <p class="font-medium text-gray-800">${user.location || '-'}</p>
                            </div>
                        </div>
                    </div>
                    
                    ${user.bio ? `
                    <div class="bg-purple-50 border-l-4 border-purple-600 p-4 rounded">
                        <h4 class="font-semibold text-purple-800 mb-2">
                            <i class="fas fa-comment-dots mr-2"></i>소개
                        </h4>
                        <p class="text-sm text-gray-700">${user.bio}</p>
                    </div>
                    ` : ''}
                    
                    ${faithAnswers ? `
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
                </div>
            </div>
        `;
        
        document.getElementById('viewProfileContent').innerHTML = content;
        document.getElementById('viewProfileModal').classList.remove('hidden');
    } catch (error) {
        console.error('Failed to load profile:', error);
        alert('프로필 정보를 불러오는데 실패했습니다.');
    }
}

function hideViewProfileModal() {
    document.getElementById('viewProfileModal').classList.add('hidden');
}

// Edit Profile Modal functions
async function showEditProfileModal() {
    if (!currentUser) return;
    
    try {
        // Fetch latest user data to get faith_answers
        const response = await axios.get('/api/users/' + currentUserId);
        const user = response.data.user;
        
        document.getElementById('editProfileModal').classList.remove('hidden');
        
        // Populate form with current user data
        document.getElementById('editEmail').value = user.email || '';
        document.getElementById('editName').value = user.name || '';
        document.getElementById('editGender').value = user.gender || '';
        document.getElementById('editChurch').value = user.church || '';
        document.getElementById('editPastor').value = user.pastor || '';
        document.getElementById('editPosition').value = user.position || '';
        
        // Parse and populate faith answers
        if (user.faith_answers) {
            try {
                const faithAnswers = JSON.parse(user.faith_answers);
                for (let i = 1; i <= 10; i++) {
                    const element = document.getElementById('edit_faith_q' + i);
                    if (element && faithAnswers['q' + i]) {
                        element.value = faithAnswers['q' + i];
                    }
                }
            } catch (e) {
                console.error('Failed to parse faith_answers:', e);
            }
        }
        
        // Show current avatar
        const editAvatarPreview = document.getElementById('editAvatarPreview');
        const editAvatarButtons = document.getElementById('editAvatarButtons');
        const editAvatarNote = document.getElementById('editAvatarNote');
        
        if (user.role === 'admin') {
            // Admin always shows crown icon
            editAvatarPreview.innerHTML = '<i class="fas fa-crown text-yellow-400 text-2xl"></i>';
            // Hide avatar buttons and note for admin
            if (editAvatarButtons) editAvatarButtons.style.display = 'none';
            if (editAvatarNote) editAvatarNote.style.display = 'none';
        } else if (user.avatar_url) {
            editAvatarPreview.innerHTML = '<img src="' + user.avatar_url + '" class="w-full h-full object-cover" />';
            // Show avatar buttons and note for regular users
            if (editAvatarButtons) editAvatarButtons.style.display = 'flex';
            if (editAvatarNote) editAvatarNote.style.display = 'block';
        } else {
            editAvatarPreview.innerHTML = '<i class="fas fa-user text-gray-400 text-2xl"></i>';
            // Show avatar buttons and note for regular users
            if (editAvatarButtons) editAvatarButtons.style.display = 'flex';
            if (editAvatarNote) editAvatarNote.style.display = 'block';
        }
    } catch (error) {
        console.error('Failed to load user data:', error);
        alert('사용자 정보를 불러오는데 실패했습니다.');
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
            
            // Load user scores from API
            await loadUserScores();
            
            updateAuthUI();
            hideLoginModal();
            loadPosts();
            alert(`환영합니다, ${user.name}님! 😊`);
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

        // 기도 포스팅(중보 기도)일 경우 기도 점수 즉시 업데이트
        if (selectedBackgroundColor === '#FCA5A5') {
            prayerScore += 20;
            updateTypingScoreDisplay();
            showToast('기도 포스팅 작성! 기도 점수 +20점', 'success');
        }
        
        // 일상, 사역, 찬양, 교회, 자유 포스팅일 경우 활동 점수 즉시 업데이트
        const activityPostColors = ['#FED7AA', '#A7F3D0', '#BAE6FD', '#DDD6FE', '#FFFFFF'];
        if (activityPostColors.includes(selectedBackgroundColor)) {
            activityScore += 10;
            updateTypingScoreDisplay();
            showToast('포스팅 작성! 활동 점수 +10점', 'success');
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
            if (backgroundColor === '#FDE68A') {
                // 말씀 포스팅 - 아멘 버튼: 성경 점수 +1점
                await axios.post(`/api/users/${currentUserId}/scores/scripture`, { points: 1 });
                typingScore += 1;
                showToast('아멘! 성경 점수 +1점', 'success');
            } else if (backgroundColor === '#FED7AA') {
                // 일상 포스팅 - 샬롬 버튼: 활동 점수 +1점
                await axios.post(`/api/users/${currentUserId}/scores/activity`, { points: 1 });
                activityScore += 1;
                showToast('샬롬! 활동 점수 +1점', 'success');
            } else if (backgroundColor === '#A7F3D0') {
                // 사역 포스팅 - 하나님 함께하시길: 활동 점수 +1점
                await axios.post(`/api/users/${currentUserId}/scores/activity`, { points: 1 });
                activityScore += 1;
                showToast('하나님 함께하시길! 활동 점수 +1점', 'success');
            } else if (backgroundColor === '#BAE6FD') {
                // 찬양 포스팅 - 할렐루야: 활동 점수 +1점
                await axios.post(`/api/users/${currentUserId}/scores/activity`, { points: 1 });
                activityScore += 1;
                showToast('할렐루야! 활동 점수 +1점', 'success');
            } else if (backgroundColor === '#DDD6FE') {
                // 교회 포스팅 - Body of Christ: 활동 점수 +1점
                await axios.post(`/api/users/${currentUserId}/scores/activity`, { points: 1 });
                activityScore += 1;
                showToast('Body of Christ! 활동 점수 +1점', 'success');
            } else {
                // 자유 포스팅 - 좋아요: 활동 점수 +1점
                await axios.post(`/api/users/${currentUserId}/scores/activity`, { points: 1 });
                activityScore += 1;
                showToast('좋아요! 활동 점수 +1점', 'success');
            }
        } else {
            // Unliked: subtract points
            if (backgroundColor === '#FDE68A') {
                // 말씀 포스팅: 성경 점수 -1점
                await axios.post(`/api/users/${currentUserId}/scores/scripture`, { points: -1 });
                typingScore = Math.max(0, typingScore - 1);
                showToast('취소: 성경 점수 -1점', 'warning');
            } else {
                // 다른 포스팅: 활동 점수 -1점
                await axios.post(`/api/users/${currentUserId}/scores/activity`, { points: -1 });
                activityScore = Math.max(0, activityScore - 1);
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
                            <div class="w-8 h-8 rounded-full overflow-hidden bg-gray-400 flex items-center justify-center text-white text-sm flex-shrink-0">${avatarHtml}</div>
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
            // Prayer added
            const successMsg = document.createElement('div');
            successMsg.className = 'fixed top-20 right-4 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in';
            successMsg.innerHTML = '<i class="fas fa-praying-hands mr-2"></i>기도하셨습니다! +10점';
            document.body.appendChild(successMsg);
            
            setTimeout(() => {
                successMsg.remove();
            }, 2000);
        } else {
            // Prayer cancelled
            const cancelMsg = document.createElement('div');
            cancelMsg.className = 'fixed top-20 right-4 bg-gray-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in';
            cancelMsg.innerHTML = '<i class="fas fa-undo mr-2"></i>취소 -10점';
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

function editPost(postId) {
    // Get post data first
    const postsFeed = document.getElementById('postsFeed');
    const posts = Array.from(postsFeed.children);
    
    // Find the post data from the feed
    fetch(`/api/posts?user_id=${currentUserId}`)
        .then(res => res.json())
        .then(data => {
            const post = data.find(p => p.id === postId);
            if (!post) {
                alert('게시물을 찾을 수 없습니다.');
                return;
            }
            
            // Set current editing post
            currentEditingPostId = postId;
            selectedEditBackgroundColor = post.background_color;
            
            // Fill modal with current data
            document.getElementById('editPostContent').value = post.content || '';
            document.getElementById('editPostVerse').value = post.verse_reference || '';
            
            // Highlight selected background color
            document.querySelectorAll('.edit-color-selector-btn').forEach(btn => {
                btn.classList.remove('ring-4', 'ring-blue-500', 'ring-offset-2');
            });
            
            if (selectedEditBackgroundColor) {
                const colorBtn = document.querySelector(`.edit-color-selector-btn[onclick*="${selectedEditBackgroundColor}"]`);
                if (colorBtn) {
                    colorBtn.classList.add('ring-4', 'ring-blue-500', 'ring-offset-2');
                }
            }
            
            // Show modal
            document.getElementById('editPostModal').classList.remove('hidden');
            togglePostMenu(postId); // Close the post menu
        })
        .catch(error => {
            console.error('Error loading post:', error);
            alert('게시물을 불러오는데 실패했습니다.');
        });
}

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
            verse_reference: document.getElementById('editPostVerse').value.trim() || null,
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
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.id !== currentUserId)) {
        alert('권한이 없습니다.');
        return;
    }

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
        
        // 기도 포스팅(중보 기도)이면 점수 즉시 차감
        if (post.background_color === '#FCA5A5' && post.user_id === currentUserId) {
            prayerScore = Math.max(0, prayerScore - 20);
            updateTypingScoreDisplay();
            showToast('기도 포스팅 삭제! 기도 점수 -20점', 'warning');
        } 
        // 일상, 사역, 찬양, 교회, 자유 포스팅이면 활동 점수 즉시 차감
        else if (['#FED7AA', '#A7F3D0', '#BAE6FD', '#DDD6FE', '#FFFFFF'].includes(post.background_color) && post.user_id === currentUserId) {
            activityScore = Math.max(0, activityScore - 10);
            updateTypingScoreDisplay();
            showToast('포스팅 삭제! 활동 점수 -10점', 'warning');
        } 
        else {
            alert('게시물이 삭제되었습니다.');
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
        
        const verseHtml = post.verse_reference ? `
            <div class="mt-2 bg-blue-50 border-l-4 border-blue-600 p-2 rounded text-xs">
                <p class="text-blue-600 font-semibold">
                    <i class="fas fa-bible mr-1"></i>${post.verse_reference}
                </p>
            </div>
        ` : '';
        
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
                            <div class="w-8 h-8 rounded-full overflow-hidden bg-gray-400 flex items-center justify-center text-white text-sm flex-shrink-0">${avatarHtml}</div>
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
            
            const verseHtml = post.verse_reference ? `
                <div class="mt-3 bg-gray-50 border-l-4 border-blue-600 p-3 rounded">
                    <p class="text-sm text-blue-600 font-semibold">
                        <i class="fas fa-bible mr-2"></i>${post.verse_reference}
                    </p>
                </div>
            ` : '';
            
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
                
                const sharedVerseHtml = post.shared_verse_reference ? `
                    <div class="mt-2 bg-blue-50 border-l-4 border-blue-600 p-2 rounded text-xs">
                        <p class="text-blue-600 font-semibold">
                            <i class="fas fa-bible mr-1"></i>${post.shared_verse_reference}
                        </p>
                    </div>
                ` : '';
                
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
                                <div class="w-10 h-10 rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white flex-shrink-0">
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
                            <div class="w-12 h-12 rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white flex-shrink-0">${avatarHtml}</div>
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
                                ${post.background_color === '#FCA5A5' ? `
                                    <button onclick="togglePray(${post.id})" class="flex items-center space-x-2 ${post.is_prayed > 0 ? 'text-red-600' : 'hover:text-red-600'} transition" title="기도했으면 누르세요">
                                        <i class="fas fa-praying-hands text-lg"></i>
                                        <span class="text-sm">${post.prayer_clicks_count || 0}</span>
                                    </button>
                                ` : post.background_color === '#FDE68A' ? `
                                    <button onclick="toggleLike(${post.id})" class="flex items-center space-x-2 ${isLiked ? 'text-yellow-600' : 'hover:text-yellow-600'} transition" title="아멘">
                                        <i class="fas fa-cross text-lg"></i>
                                        <span class="text-sm">${post.likes_count || 0}</span>
                                    </button>
                                ` : post.background_color === '#A7F3D0' ? `
                                    <button onclick="toggleLike(${post.id})" class="flex items-center space-x-2 ${isLiked ? 'text-green-600' : 'hover:text-green-600'} transition" title="하나님 함께하시길!">
                                        <i class="fas fa-dove text-lg"></i>
                                        <span class="text-sm">${post.likes_count || 0}</span>
                                    </button>
                                ` : post.background_color === '#BAE6FD' ? `
                                    <button onclick="toggleLike(${post.id})" class="flex items-center space-x-2 ${isLiked ? 'text-sky-600' : 'hover:text-sky-600'} transition" title="할렐루야!">
                                        <i class="fas fa-hands-clapping text-lg"></i>
                                        <span class="text-sm">${post.likes_count || 0}</span>
                                    </button>
                                ` : post.background_color === '#DDD6FE' ? `
                                    <button onclick="toggleLike(${post.id})" class="flex items-center space-x-2 ${isLiked ? 'text-violet-600' : 'hover:text-violet-600'} transition" title="Body of Christ!">
                                        <i class="fas fa-church text-lg"></i>
                                        <span class="text-sm">${post.likes_count || 0}</span>
                                    </button>
                                ` : `
                                    <button onclick="toggleLike(${post.id})" class="flex items-center space-x-2 hover:text-blue-600 transition" title="샬롬">
                                        <i class="fas fa-dove ${isLiked ? 'text-blue-600' : ''} text-lg"></i>
                                        <span class="text-sm">${post.likes_count || 0}</span>
                                    </button>
                                `}
                                <button onclick="loadComments(${post.id})" class="flex items-center space-x-2 hover:text-blue-600 transition" title="댓글">
                                    <i class="fas fa-comment text-lg"></i>
                                    <span class="text-sm">${post.comments_count || 0}</span>
                                </button>
                                <button onclick="sharePost(${post.id})" class="flex items-center space-x-2 hover:text-blue-600 transition" title="공유하기">
                                    <i class="fas fa-share text-lg"></i>
                                    <span class="text-sm">공유</span>
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
                
                // Load user scores from API
                await loadUserScores();
                
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

// Initialize
updateAuthUI();
updateEmailDatalist(); // Load email history
autoLogin(); // Auto-login if session exists
