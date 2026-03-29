/** 프로덕션 단일 기준 도메인 — 미러·구 URL의 /api·R2 자산을 여기로 복구 */
const CROSSFRIENDS_ORIGIN = 'https://crossfriends.org';

function isCrossfriendsCanonicalHost() {
    if (typeof location === 'undefined') return true;
    const h = (location.hostname || '').toLowerCase();
    return h === 'crossfriends.org' || h === 'www.crossfriends.org';
}

function isLocalDevHost() {
    if (typeof location === 'undefined') return false;
    const h = (location.hostname || '').toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

function applyCrossfriendsAxiosBase() {
    if (typeof axios === 'undefined') return;
    if (isLocalDevHost()) return;
    if (!isCrossfriendsCanonicalHost()) {
        axios.defaults.baseURL = CROSSFRIENDS_ORIGIN;
    }
}

/**
 * 상대 경로·구 프리뷰 도메인의 앱 자산 URL을 crossfriends.org 기준 절대 URL로 통일
 */
function toCanonicalSiteUrl(url) {
    if (url == null || url === '') return url;
    const s = String(url).trim();
    if (!s) return url;
    if (s.startsWith('data:') || s.startsWith('blob:')) return s;
    if (s.startsWith('//')) return 'https:' + s;
    if (s.startsWith('/')) return (isLocalDevHost() ? '' : CROSSFRIENDS_ORIGIN) + s;
    try {
        const u = new URL(s);
        const path = u.pathname + u.search + u.hash;
        const host = u.hostname.toLowerCase();
        const ourAssetPath = path.startsWith('/api/') || path.startsWith('/static/');
        const ourLikeHost =
            host === 'crossfriends.org' ||
            host === 'www.crossfriends.org' ||
            host.endsWith('.crossfriends.org') ||
            host.endsWith('.pages.dev') ||
            host.endsWith('.workers.dev');
        if (ourAssetPath || ourLikeHost) {
            return (isLocalDevHost() ? '' : CROSSFRIENDS_ORIGIN) + path;
        }
    } catch (e) {
        /* ignore */
    }
    return s;
}

applyCrossfriendsAxiosBase();

let currentUserId = null;
let currentUser = null;
let selectedBackgroundColor = null; // 선택된 배경색
let selectedPostImages = [];
let selectedPostImageSeq = 0;
let filterUserId = null; // 필터링할 사용자 ID

// =====================
// Modal Functions
// =====================

// Show how-to-use modal
function showHowToUse() {
    const modal = document.getElementById('howToUseModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add(...howToUseModalLayoutClasses);
    } else {
        console.error('How-to-use modal not found');
    }
}

// Hide how-to-use modal
function hideHowToUse() {
    const modal = document.getElementById('howToUseModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove(...howToUseModalLayoutClasses);
    }
}

// =====================
// 피드백 요청 모달 → POST /api/feedback (관리자 메신저)
// =====================
let feedbackImageFile = null;
let feedbackVideoFile = null;
let feedbackModalEscapeHandler = null;

function pickFeedbackImage() {
    const el = document.getElementById('feedbackImageInput');
    if (el) el.click();
}

function pickFeedbackVideo() {
    const el = document.getElementById('feedbackVideoInput');
    if (el) el.click();
}

function removeFeedbackAttachment() {
    feedbackImageFile = null;
    feedbackVideoFile = null;
    const imgInput = document.getElementById('feedbackImageInput');
    const vidInput = document.getElementById('feedbackVideoInput');
    const preview = document.getElementById('feedbackAttachmentPreview');
    const imgPrev = document.getElementById('feedbackAttachmentImagePreview');
    const vidPrev = document.getElementById('feedbackAttachmentVideoPreview');
    if (imgInput) imgInput.value = '';
    if (vidInput) vidInput.value = '';
    if (preview) preview.classList.add('hidden');
    if (imgPrev) {
        imgPrev.src = '';
        imgPrev.classList.add('hidden');
    }
    if (vidPrev) {
        vidPrev.src = '';
        vidPrev.classList.add('hidden');
    }
}

function renderFeedbackAttachmentPreview() {
    const preview = document.getElementById('feedbackAttachmentPreview');
    const imgPrev = document.getElementById('feedbackAttachmentImagePreview');
    const vidPrev = document.getElementById('feedbackAttachmentVideoPreview');
    if (!preview || !imgPrev || !vidPrev) return;
    if (feedbackImageFile) {
        imgPrev.src = URL.createObjectURL(feedbackImageFile);
        imgPrev.classList.remove('hidden');
        vidPrev.classList.add('hidden');
        preview.classList.remove('hidden');
        return;
    }
    if (feedbackVideoFile) {
        vidPrev.src = URL.createObjectURL(feedbackVideoFile);
        vidPrev.classList.remove('hidden');
        imgPrev.classList.add('hidden');
        preview.classList.remove('hidden');
    }
}

function setupFeedbackFileInputs() {
    const imgInput = document.getElementById('feedbackImageInput');
    const vidInput = document.getElementById('feedbackVideoInput');
    if (!imgInput || !vidInput || imgInput.dataset.fbSetup === '1') return;
    imgInput.dataset.fbSetup = '1';
    imgInput.addEventListener('change', () => {
        const f = imgInput.files && imgInput.files[0];
        if (!f) return;
        feedbackImageFile = f;
        feedbackVideoFile = null;
        vidInput.value = '';
        renderFeedbackAttachmentPreview();
    });
    vidInput.addEventListener('change', () => {
        const f = vidInput.files && vidInput.files[0];
        if (!f) return;
        feedbackVideoFile = f;
        feedbackImageFile = null;
        imgInput.value = '';
        renderFeedbackAttachmentPreview();
    });
}

function showFeedbackModal() {
    if (!currentUserId) {
        showLoginModal();
        return;
    }
    const modal = document.getElementById('feedbackModal');
    const ta = document.getElementById('feedbackModalText');
    if (!modal) return;
    modal.classList.remove('hidden');
    if (ta) ta.value = '';
    removeFeedbackAttachment();
    setupFeedbackFileInputs();
    if (ta) setTimeout(() => ta.focus(), 50);

    if (feedbackModalEscapeHandler) {
        document.removeEventListener('keydown', feedbackModalEscapeHandler);
    }
    feedbackModalEscapeHandler = (e) => {
        if (e.key === 'Escape') hideFeedbackModal();
    };
    document.addEventListener('keydown', feedbackModalEscapeHandler);
}

function hideFeedbackModal() {
    const modal = document.getElementById('feedbackModal');
    if (modal) modal.classList.add('hidden');
    if (feedbackModalEscapeHandler) {
        document.removeEventListener('keydown', feedbackModalEscapeHandler);
        feedbackModalEscapeHandler = null;
    }
}

async function submitFeedbackToAdmin() {
    if (!currentUserId) return;
    const ta = document.getElementById('feedbackModalText');
    const content = ta ? String(ta.value || '').trim() : '';
    if (!content && !feedbackImageFile && !feedbackVideoFile) {
        showToast('내용을 입력하거나 파일을 첨부해 주세요.', 'error');
        return;
    }
    const btn = document.getElementById('feedbackModalSubmitBtn');
    if (btn) btn.disabled = true;
    try {
        if (feedbackImageFile || feedbackVideoFile) {
            const fd = new FormData();
            fd.append('user_id', String(currentUserId));
            fd.append('content', content || '');
            if (feedbackImageFile) fd.append('image', feedbackImageFile);
            if (feedbackVideoFile) fd.append('video', feedbackVideoFile);
            await axios.post('/api/feedback', fd);
        } else {
            await axios.post('/api/feedback', { user_id: currentUserId, content });
        }
        showToast('관리자에게 전달되었습니다.', 'success');
        hideFeedbackModal();
    } catch (e) {
        console.error(e);
        const msg =
            e.response && e.response.data && e.response.data.error
                ? e.response.data.error
                : '전송에 실패했습니다.';
        showToast(msg, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

window.pickFeedbackImage = pickFeedbackImage;
window.pickFeedbackVideo = pickFeedbackVideo;
window.removeFeedbackAttachment = removeFeedbackAttachment;
window.showFeedbackModal = showFeedbackModal;
window.hideFeedbackModal = hideFeedbackModal;
window.submitFeedbackToAdmin = submitFeedbackToAdmin;

const loginModalLayoutClasses = ['flex', 'items-center', 'justify-center', 'min-h-full', 'p-4'];

const LS_LOGIN_REMEMBER = 'crossfriends_loginRememberCredentials';
const LS_SAVED_LOGIN_EMAIL = 'crossfriends_savedLoginEmail';
const LS_SAVED_LOGIN_PASSWORD = 'crossfriends_savedLoginPassword';

function applySavedLoginCredentials() {
    if (localStorage.getItem(LS_LOGIN_REMEMBER) !== '1') return;
    const savedEmail = localStorage.getItem(LS_SAVED_LOGIN_EMAIL);
    const savedPassword = localStorage.getItem(LS_SAVED_LOGIN_PASSWORD);
    const emailInput = document.getElementById('loginEmail');
    const pwInput = document.getElementById('loginPassword');
    const rememberCb = document.getElementById('loginRememberCredentials');
    if (rememberCb) rememberCb.checked = true;
    if (savedEmail && emailInput) emailInput.value = savedEmail;
    if (savedPassword && pwInput) pwInput.value = savedPassword;
}

function persistLoginCredentialsIfRequested(email, password) {
    const rememberCb = document.getElementById('loginRememberCredentials');
    if (rememberCb && rememberCb.checked) {
        localStorage.setItem(LS_LOGIN_REMEMBER, '1');
        localStorage.setItem(LS_SAVED_LOGIN_EMAIL, email);
        localStorage.setItem(LS_SAVED_LOGIN_PASSWORD, password);
    } else {
        localStorage.removeItem(LS_LOGIN_REMEMBER);
        localStorage.removeItem(LS_SAVED_LOGIN_EMAIL);
        localStorage.removeItem(LS_SAVED_LOGIN_PASSWORD);
    }
}
const howToUseModalLayoutClasses = ['flex', 'items-center', 'justify-center'];

// Show login modal
function showLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add(...loginModalLayoutClasses);
        // 비밀번호 보기 상태 초기화
        const pwInput = document.getElementById('loginPassword');
        const pwIcon = document.getElementById('loginPasswordToggleIcon');
        if (pwInput && pwIcon) {
            pwInput.type = 'password';
            pwIcon.classList.remove('fa-eye-slash');
            pwIcon.classList.add('fa-eye');
            pwIcon.parentElement && pwIcon.parentElement.setAttribute('title', '비밀번호 보기');
        }
        applySavedLoginCredentials();
    } else {
        console.error('Login modal not found');
    }
}

// Toggle login password visibility
function toggleLoginPasswordVisibility() {
    const input = document.getElementById('loginPassword');
    const icon = document.getElementById('loginPasswordToggleIcon');
    if (!input || !icon) return;
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
        icon.parentElement && icon.parentElement.setAttribute('title', '비밀번호 숨기기');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
        icon.parentElement && icon.parentElement.setAttribute('title', '비밀번호 보기');
    }
}

// Hide login modal
function hideLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove(...loginModalLayoutClasses);
    }
    const elEmail = document.getElementById('loginEmail');
    const elPw = document.getElementById('loginPassword');
    if (elEmail) elEmail.value = '';
    if (elPw) elPw.value = '';
}

// Show signup modal
function showSignupModal() {
    // Hide login modal if open
    hideLoginModal();
    
    const modal = document.getElementById('signupModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add(...loginModalLayoutClasses);
    } else {
        console.error('Signup modal not found');
    }
}

// Hide signup modal
function hideSignupModal() {
    const modal = document.getElementById('signupModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove(...loginModalLayoutClasses);
    }
    const ids = [
        'signupEmail', 'signupName', 'signupPhone', 'signupPassword', 'signupPasswordConfirm',
        'signupChurch', 'signupPastor', 'signupDenomination', 'signupProvince', 'signupCity', 'signupGender', 'signupPosition',
        'signupAddress', 'signupMaritalStatus', 'signupAvatar', 'signupCover'
    ];
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el && 'value' in el) el.value = '';
    });
    for (let i = 1; i <= 10; i++) {
        const el = document.getElementById('faith_q' + i);
        if (el) el.value = '';
    }
    const preview = document.getElementById('avatarPreview');
    if (preview) preview.innerHTML = '<i class="fas fa-user text-gray-400 text-2xl"></i>';
    const coverPrev = document.getElementById('signupCoverPreview');
    if (coverPrev) {
        coverPrev.style.backgroundImage = '';
        coverPrev.className =
            'w-full h-20 rounded-lg bg-gradient-to-r from-blue-100 to-purple-100 border border-gray-200 flex items-center justify-center overflow-hidden';
        coverPrev.innerHTML = '<span class="text-gray-500 text-xs">미리보기</span>';
    }
    const rulesDiv = document.getElementById('passwordRules');
    const matchDiv = document.getElementById('passwordMatchMsg');
    if (rulesDiv) rulesDiv.classList.add('hidden');
    if (matchDiv) matchDiv.classList.add('hidden');
}

// 별도 팝업(#editProfileModal)으로 프로필 수정 — 구 경로·일부 버튼용
function openLegacyEditProfileModal() {
    const modal = document.getElementById('editProfileModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
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
let CURRENT_VIDEO_ID = 'u13qcd4AePQ'; // 오늘 API로 교체됨, 폴백용 초기값
/** 리워드1(오늘의 설교) — 프로덕션 UI·crossfriends.org와 동일 (종합점수 μ 기준) */
const SERMON_REWARD1_THRESHOLD = 200;
const SCORE_MILESTONE_REWARD2 = 1000;
const SCORE_MILESTONE_REWARD3 = 1400;
/** 종합 μ 마일스톤 (축하 패널·사이드바 리워드2/3) */
const SCORE_MILESTONE_TIERS = [SERMON_REWARD1_THRESHOLD, SCORE_MILESTONE_REWARD2, SCORE_MILESTONE_REWARD3];
let lastKnownCombinedScore = null;
const scoreMilestoneQueue = [];
let scoreMilestoneModalOpen = false;
let scoreMilestoneEscapeHandler = null;
let completedVideos = new Set();
let lastCheckedTime = 0;

// Load YouTube IFrame API
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

// Called automatically when YouTube API is ready (반드시 전역에 등록)
function onYouTubeIframeAPIReady() {
    // Check if sermon is unlocked before initializing player
    checkSermonReward();
}
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

function isYoutubeIframeApiReady() {
    return typeof window.YT !== 'undefined' && window.YT && typeof window.YT.Player === 'function';
}

/** YT 스크립트가 늦게 로드될 때(loadUserScores → checkSermonReward) ReferenceError 방지 */
function initSermonYoutubePlayer() {
    if (!isYoutubeIframeApiReady()) {
        return false;
    }
    if (player) {
        return true;
    }
    const mount = document.getElementById('sermonPlayer');
    if (!mount) {
        return false;
    }
    try {
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
        return true;
    } catch (e) {
        console.warn('Sermon YouTube player init failed:', e);
        return false;
    }
}

// Check sermon reward status (종합점수 ≥ SERMON_REWARD1_THRESHOLD μ)
function checkSermonReward() {
    if (!currentUserId) {
        // Not logged in - show locked state
        showSermonLocked(0);
        return;
    }
    
    // Get user's total score
    const totalScore = typingScore + videoScore + prayerScore + activityScore;
    
    if (totalScore >= SERMON_REWARD1_THRESHOLD) {
        // Unlocked! Show sermon (loadTodaySermon + initPlayer는 showSermonUnlocked 내부에서 처리)
        showSermonUnlocked(totalScore);
    } else {
        // Locked - show reward screen
        showSermonLocked(totalScore);
    }
}

// Show locked sermon reward
function showSermonLocked(currentScore) {
    const lockedEl = document.getElementById('sermonLocked');
    const unlockedEl = document.getElementById('sermonUnlocked');
    if (lockedEl) lockedEl.classList.remove('hidden');
    if (unlockedEl) unlockedEl.classList.add('hidden');

    const totalEl = document.getElementById('rewardTotalScore');
    if (totalEl) totalEl.textContent = String(currentScore);

    const barEl = document.getElementById('rewardProgressBar');
    if (barEl) {
        const progress = Math.min((currentScore / SERMON_REWARD1_THRESHOLD) * 100, 100);
        barEl.style.width = progress + '%';
    }

    const unlockBtn = document.getElementById('unlockSermonBtn');
    if (!unlockBtn) return;

    if (currentScore >= SERMON_REWARD1_THRESHOLD) {
        unlockBtn.disabled = false;
        unlockBtn.classList.remove('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
        unlockBtn.classList.add('bg-gradient-to-r', 'from-purple-500', 'to-pink-500', 'text-white', 'hover:from-purple-600', 'hover:to-pink-600', 'cursor-pointer', 'animate-pulse');
        unlockBtn.innerHTML = '<i class="fas fa-unlock text-2xl"></i><span>클릭하여 언락!</span>';
        unlockBtn.onclick = function () {
            showSermonUnlocked(currentScore);
            if (!initSermonYoutubePlayer()) {
                showToast('영상 플레이어를 불러오는 중입니다. 잠시 후 다시 눌러주세요.', 'warning');
                return;
            }
        };
    } else {
        unlockBtn.disabled = true;
        unlockBtn.onclick = null;
        unlockBtn.className =
            'w-full py-3 px-4 bg-gray-300 text-gray-600 rounded-xl font-bold font-size-desc cursor-not-allowed flex items-center justify-center gap-2 transition-all';
        unlockBtn.innerHTML = '<i class="fas fa-lock text-base text-gray-500"></i><span>200μ 달성 후 공개 가능</span>';
    }
}

// 오늘의 설교 영상을 API에서 가져오기 (localStorage 하루 캐시)
async function loadTodaySermon() {
    const todayKey = 'sermon_today_' + new Date().toISOString().slice(0, 10);
    const cached = localStorage.getItem(todayKey);
    if (cached) {
        try {
            const data = JSON.parse(cached);
            applySermonData(data);
            return;
        } catch (e) { /* 파싱 실패 시 재fetch */ }
    }
    try {
        const res = await axios.get('/api/sermon/today');
        const data = res.data;
        localStorage.setItem(todayKey, JSON.stringify(data));
        applySermonData(data);
    } catch (e) {
        console.warn('[sermon] API 호출 실패, 기본 영상 사용', e);
    }
}

function applySermonData(data) {
    if (!data || !data.videoId) return;
    CURRENT_VIDEO_ID = data.videoId;
    const titleEl = document.getElementById('sermonTitleText');
    const refEl = document.getElementById('sermonReferenceText');
    const preacherEl = document.getElementById('sermonPreacherText');
    if (titleEl) titleEl.textContent = data.title || '하용조 목사 설교';
    if (refEl) refEl.textContent = data.publishedAt ? new Date(data.publishedAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    if (preacherEl) preacherEl.innerHTML = '<i class="fas fa-user-tie mr-1"></i>' + (data.preacher || '하용조 목사 (온누리교회)');
    // 플레이어가 이미 초기화된 경우 영상 교체
    if (player && player.loadVideoById) {
        player.loadVideoById(CURRENT_VIDEO_ID);
    }
}

// Show unlocked sermon
async function showSermonUnlocked(currentScore) {
    document.getElementById('sermonLocked').classList.add('hidden');
    document.getElementById('sermonUnlocked').classList.remove('hidden');
    if (currentUserId) {
        localStorage.setItem(`sermon_unlocked_${currentUserId}`, 'true');
    }
    await loadTodaySermon();
    initSermonYoutubePlayer();
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
    const PS = (typeof YT !== 'undefined' && YT.PlayerState) ? YT.PlayerState : { PLAYING: 1, PAUSED: 2, ENDED: 0 };
    if (event.data == PS.PLAYING) {
        // Hide unlock banner when video starts playing
        const unlockBanner = document.getElementById('unlockBanner');
        if (unlockBanner) {
            unlockBanner.classList.add('hidden');
        }
        
        // Show progress container when playing
        document.getElementById('videoProgressContainer').classList.remove('hidden');
        
        // Start tracking progress
        startVideoTracking();
    } else if (event.data == PS.PAUSED || event.data == PS.ENDED) {
        // Stop tracking
        stopVideoTracking();
        
        // Check completion on ended
        if (event.data == PS.ENDED) {
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
        
        // Check sermon reward after loading scores
        checkSermonReward();
        
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
    
    // Check sermon reward status whenever score changes
    if (currentUserId) {
        const combinedScore = totalScore + prayerScore + activityScore;
        
        // Update reward display
        const rewardTotalScoreEl = document.getElementById('rewardTotalScore');
        const rewardProgressBarEl = document.getElementById('rewardProgressBar');
        const rewardRemainingScoreEl = document.getElementById('rewardRemainingScore');
        
        if (rewardTotalScoreEl) {
            rewardTotalScoreEl.textContent = combinedScore;
        }
        
        if (rewardProgressBarEl) {
            const progress = Math.min((combinedScore / SERMON_REWARD1_THRESHOLD) * 100, 100);
            rewardProgressBarEl.style.width = progress + '%';
        }
        
        if (rewardRemainingScoreEl) {
            const remaining = Math.max(0, SERMON_REWARD1_THRESHOLD - combinedScore);
            rewardRemainingScoreEl.textContent = remaining > 0 ? `목표까지 ${remaining}μ` : '목표 달성!';
        }
        
        // Check if just unlocked (crossed threshold)
        const wasLocked = document.getElementById('sermonLocked') && !document.getElementById('sermonLocked').classList.contains('hidden');
        
        if (combinedScore >= SERMON_REWARD1_THRESHOLD && wasLocked) {
            // Just unlocked! Enable unlock button
            const unlockBtn = document.getElementById('unlockSermonBtn');
            if (unlockBtn) {
                unlockBtn.disabled = false;
                unlockBtn.classList.remove('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
                unlockBtn.classList.add('bg-gradient-to-r', 'from-purple-500', 'to-pink-500', 'text-white', 'hover:from-purple-600', 'hover:to-pink-600', 'cursor-pointer', 'animate-pulse');
                unlockBtn.innerHTML = '<i class="fas fa-unlock text-2xl"></i><span>클릭하여 언락!</span>';
                unlockBtn.onclick = function() {
                    showSermonUnlocked(combinedScore);
                    if (!initSermonYoutubePlayer()) {
                        showToast('영상 플레이어를 불러오는 중입니다. 잠시 후 다시 눌러주세요.', 'warning');
                        return;
                    }
                };
            }
        }

        syncQtRewardSidebars(combinedScore);
        onCombinedScoreUpdated(combinedScore);
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

// Load edit profile data
async function loadEditProfileData() {
    if (!currentUser) return;
    
    try {
        const response = await axios.get('/api/users/' + currentUserId);
        const user = response.data.user;
        
        // Load cover photo preview (for modal)
        const coverPreview = document.getElementById('editCoverPreview');
        if (coverPreview && user.cover_url) {
            coverPreview.style.backgroundImage = `url(${toCanonicalSiteUrl(user.cover_url)})`;
            coverPreview.style.backgroundSize = 'cover';
            coverPreview.style.backgroundPosition = 'center';
            coverPreview.innerHTML = '';
        }
        
        // Load cover photo preview (for inline)
        const coverPreviewInline = document.getElementById('editCoverPreviewInline');
        if (coverPreviewInline && user.cover_url) {
            coverPreviewInline.style.backgroundImage = `url(${toCanonicalSiteUrl(user.cover_url)})`;
            coverPreviewInline.style.backgroundSize = 'cover';
            coverPreviewInline.style.backgroundPosition = 'center';
            coverPreviewInline.innerHTML = '';
        }
        
        // Load avatar preview
        const avatarPreview = document.getElementById('editAvatarPreview');
        if (avatarPreview && user.avatar_url) {
            avatarPreview.innerHTML = `<img src="${toCanonicalSiteUrl(user.avatar_url)}" alt="Profile" class="w-full h-full object-cover" />`;
        }
        
        // Update current user data
        currentUser = { ...currentUser, ...user };
        
    } catch (error) {
        console.error('Failed to load edit profile data:', error);
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

function previewSignupCover(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
        alert('커버 사진은 10MB를 초과할 수 없습니다.');
        event.target.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = function (e) {
        const preview = document.getElementById('signupCoverPreview');
        if (!preview) return;
        preview.innerHTML = '';
        preview.style.backgroundImage = 'url(' + e.target.result + ')';
        preview.style.backgroundSize = 'cover';
        preview.style.backgroundPosition = 'center';
    };
    reader.readAsDataURL(file);
}

// Profile Menu Toggle
function toggleProfileMenu() {
    const menu = document.getElementById('profileMenu');
    menu.classList.toggle('hidden');
}

// Close profile menu when clicking outside
document.addEventListener('click', function(event) {
    const profileMenu = document.getElementById('profileMenu');
    const userMenuLegacy = document.getElementById('userMenu');
    const userMenuMobile = document.getElementById('userMenuMobile');
    const userMenuRightPC = document.getElementById('userMenuRightPC');
    const insideUserChrome =
        (userMenuLegacy && userMenuLegacy.contains(event.target)) ||
        (userMenuMobile && userMenuMobile.contains(event.target)) ||
        (userMenuRightPC && userMenuRightPC.contains(event.target));

    if (profileMenu && !insideUserChrome) {
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

// 인라인 프로필 수정(profileView 안에 폼 삽입)
async function showEditProfileModal(targetUserId) {
    if (!currentUser) return;
    
    // Use provided targetUserId, or fallback to currentUserId
    const editUserId = targetUserId || currentUserId;
    
    // Check permission: must be own profile or admin
    const isOwnProfile = Number(editUserId) === Number(currentUserId);
    const isAdmin = currentUser.role === 'admin';
    
    if (!isOwnProfile && !isAdmin) {
        alert('프로필 수정 권한이 없습니다.');
        return;
    }
    
    try {
        // Fetch latest user data to get faith_answers and privacy_settings
        const response = await axios.get('/api/users/' + editUserId);
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
                <!-- Hidden field to store the user ID being edited -->
                <input type="hidden" id="editingUserId" value="${user.id}">
                
                <!-- Profile Section -->
                <div class="md:col-span-1">
                    <div class="bg-gray-50 rounded-lg p-6 text-center">
                        <div 
                            class="w-32 h-32 mx-auto rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white text-4xl mb-4 cursor-pointer hover:ring-4 hover:ring-blue-300 transition" 
                            id="editAvatarPreviewInline"
                            onclick="cancelEditProfile()"
                            title="프로필 보기로 돌아가기">
                            ${user.avatar_url
                                ? `<img src="${toCanonicalSiteUrl(user.avatar_url)}" alt="Profile" class="w-full h-full object-cover" />`
                                : user.role === 'admin'
                                  ? '<i class="fas fa-crown text-yellow-400"></i>'
                                  : '<i class="fas fa-user"></i>'}
                        </div>
                        
                        <h3 class="text-xl font-bold text-gray-800 mb-2">${user.name}</h3>
                        <span class="inline-block px-3 py-1 rounded-full text-sm font-semibold ${roleColor}">
                            ${roleName}
                        </span>
                        <div class="mt-3 mb-4 text-xs text-gray-500">
                            <p>회원 ID: #${user.id}</p>
                            <p>가입일: ${new Date(user.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                        </div>
                        
                        <div class="space-y-2 border-t pt-4">
                            <input 
                                type="file" 
                                id="editAvatarInline" 
                                accept="image/*"
                                onchange="previewEditAvatarInline(event)"
                                class="hidden" />
                            <input 
                                type="file" 
                                id="editCoverInline" 
                                accept="image/*"
                                onchange="previewEditCoverInline(event)"
                                class="hidden" />
                            
                            <label 
                                for="editAvatarInline"
                                class="block w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer transition text-sm font-semibold text-center">
                                <i class="fas fa-upload mr-2"></i>프로필 사진 변경
                            </label>
                            <button 
                                type="button"
                                onclick="deleteAvatarInline()"
                                class="block w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm font-semibold">
                                <i class="fas fa-trash mr-2"></i>프로필 사진 삭제
                            </button>
                            
                            <label 
                                for="editCoverInline"
                                class="block w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 cursor-pointer transition text-sm font-semibold text-center">
                                <i class="fas fa-image mr-2"></i>커버 사진 변경
                            </label>
                            <button 
                                type="button"
                                onclick="deleteCoverInline()"
                                class="block w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm font-semibold">
                                <i class="fas fa-trash mr-2"></i>커버 사진 삭제
                            </button>
                            
                            <div id="editCoverPreviewInline" class="w-full h-24 rounded-lg bg-gray-200 flex items-center justify-center overflow-hidden relative border-2 border-gray-300 mt-3">
                                <span class="text-gray-600 text-sm font-semibold"><i class="fas fa-image mr-2"></i>커버 사진</span>
                            </div>
                            
                            <p class="text-xs text-gray-500 mt-2 text-center">프로필: 최대 5MB / 커버: 최대 10MB</p>
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
                                <label class="block text-sm font-medium text-gray-700 mb-1">자기소개</label>
                                <textarea 
                                    id="editBioInline"
                                    rows="3"
                                    placeholder="간단한 자기소개를 입력하세요..."
                                    class="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 text-sm">${user.bio || ''}</textarea>
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
                    
                    ${
                        isOwnProfile
                            ? `
                    <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
                        <h4 class="font-semibold text-gray-800 mb-1">
                            <i class="fas fa-key mr-2 text-blue-600"></i>비밀번호 변경
                        </h4>
                        <p class="text-xs text-gray-500 mb-3">현재 비밀번호 확인 후 새 비밀번호로 변경합니다. (가입 시와 동일 규칙: 소문자 3자 이상·숫자 3자 이상·8자 이상, 대문자·특수문자 불가)</p>
                        <div class="space-y-2 max-w-md">
                            <div>
                                <label class="block text-sm text-gray-700 mb-1" for="editCurrentPasswordInline">현재 비밀번호</label>
                                <input type="password" id="editCurrentPasswordInline" autocomplete="current-password" class="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            </div>
                            <div>
                                <label class="block text-sm text-gray-700 mb-1" for="editNewPasswordInline">새 비밀번호</label>
                                <input type="password" id="editNewPasswordInline" autocomplete="new-password" placeholder="예: abc12345" class="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            </div>
                            <div>
                                <label class="block text-sm text-gray-700 mb-1" for="editNewPasswordConfirmInline">새 비밀번호 확인</label>
                                <input type="password" id="editNewPasswordConfirmInline" autocomplete="new-password" class="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            </div>
                            <button type="button" onclick="submitChangePasswordInline()" class="mt-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition">
                                비밀번호 변경
                            </button>
                        </div>
                    </div>
                    `
                            : ''
                    }
                    
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
        
        // Load current cover photo and avatar
        setTimeout(() => {
            loadEditProfileData();
        }, 100);
        
        // Update header title to "프로필 수정"
        const profileViewHeader = document.querySelector('#profileView .flex.items-center.justify-between h2');
        if (profileViewHeader) {
            profileViewHeader.innerHTML = '<i class="fas fa-user-edit text-blue-600 mr-2"></i>프로필 수정';
        }

        const pv = document.getElementById('profileView');
        if (pv) pv.classList.remove('hidden');
        const lb = document.getElementById('profileViewLogoutBtn');
        if (lb) {
            if (parseInt(String(editUserId), 10) === parseInt(String(currentUserId), 10)) lb.classList.remove('hidden');
            else lb.classList.add('hidden');
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
    const hid = document.getElementById('editingUserId');
    let targetUserId = currentUserId;
    if (hid && hid.value !== '') {
        const n = parseInt(hid.value, 10);
        if (Number.isFinite(n)) targetUserId = n;
    }
    
    if (!confirm('프로필 사진을 삭제하시겠습니까?')) {
        return;
    }
    
    try {
        await axios.delete('/api/users/' + targetUserId + '/avatar');
        
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
        const userResponse = await axios.get('/api/users/' + targetUserId);
        if (targetUserId === currentUserId) {
            currentUser = userResponse.data.user;
            updateAuthUI();
        }
        
        showToast('프로필 사진이 삭제되었습니다.', 'success');
    } catch (error) {
        console.error('Avatar delete error:', error);
        showToast('프로필 사진 삭제에 실패했습니다.', 'error');
    }
}

// Preview cover photo in inline edit
function previewEditCoverInline(event) {
    const file = event.target.files[0];
    if (file) {
        if (file.size > 10 * 1024 * 1024) {
            alert('파일 크기는 10MB를 초과할 수 없습니다.');
            event.target.value = '';
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('editCoverPreviewInline');
            if (preview) {
                preview.style.backgroundImage = 'url(' + e.target.result + ')';
                preview.style.backgroundSize = 'cover';
                preview.style.backgroundPosition = 'center';
                preview.innerHTML = '';
            }
        };
        reader.readAsDataURL(file);
    }
}

// Delete cover photo in inline edit
async function deleteCoverInline() {
    if (!currentUserId) {
        alert('로그인이 필요합니다.');
        return;
    }
    const hid = document.getElementById('editingUserId');
    let targetUserId = currentUserId;
    if (hid && hid.value !== '') {
        const n = parseInt(hid.value, 10);
        if (Number.isFinite(n)) targetUserId = n;
    }
    
    if (!confirm('커버 사진을 삭제하시겠습니까?')) {
        return;
    }
    
    try {
        await axios.delete('/api/users/' + targetUserId + '/cover');
        
        // Update preview to default
        const preview = document.getElementById('editCoverPreviewInline');
        if (preview) {
            preview.style.backgroundImage = '';
            preview.className = 'w-full h-24 rounded-lg bg-gray-200 flex items-center justify-center overflow-hidden relative border-2 border-gray-300 mt-2';
            preview.innerHTML = '<span class="text-gray-600 text-sm font-semibold"><i class="fas fa-image mr-2"></i>커버 사진</span>';
        }
        
        // Clear file input
        const fileInput = document.getElementById('editCoverInline');
        if (fileInput) {
            fileInput.value = '';
        }
        
        // Refresh user data
        const userResponse = await axios.get('/api/users/' + targetUserId);
        if (targetUserId === currentUserId) {
            currentUser = userResponse.data.user;
        }
        
        showToast('커버 사진이 삭제되었습니다.', 'success');
    } catch (error) {
        console.error('Cover delete error:', error);
        showToast('커버 사진 삭제에 실패했습니다.', 'error');
    }
}

// Cancel edit and go back to profile view
function cancelEditProfile() {
    showUserProfileModal(currentUserId);
}

async function submitChangePasswordInline() {
    if (!currentUserId) {
        showToast('로그인이 필요합니다.', 'error');
        return;
    }
    const editingEl = document.getElementById('editingUserId');
    const editingId = editingEl ? parseInt(editingEl.value, 10) : NaN;
    if (Number(editingId) !== Number(currentUserId)) {
        showToast('본인 프로필에서만 비밀번호를 변경할 수 있습니다.', 'error');
        return;
    }
    const cur = (document.getElementById('editCurrentPasswordInline') || {}).value || '';
    const neu = (document.getElementById('editNewPasswordInline') || {}).value || '';
    const confirmPw = (document.getElementById('editNewPasswordConfirmInline') || {}).value || '';
    if (!cur) {
        showToast('현재 비밀번호를 입력해주세요.', 'error');
        return;
    }
    if (!neu) {
        showToast('새 비밀번호를 입력해주세요.', 'error');
        return;
    }
    if (neu !== confirmPw) {
        showToast('새 비밀번호가 일치하지 않습니다.', 'error');
        return;
    }
    const errs = getPasswordErrors(neu);
    if (errs.length) {
        showToast(errs[0], 'error');
        return;
    }
    try {
        const response = await axios.post('/api/users/' + currentUserId + '/change-password', {
            current_password: cur,
            new_password: neu
        });
        showToast(response.data.message || '비밀번호가 변경되었습니다.', 'success');
        ['editCurrentPasswordInline', 'editNewPasswordInline', 'editNewPasswordConfirmInline'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        if (localStorage.getItem(LS_LOGIN_REMEMBER) === '1') {
            localStorage.setItem(LS_SAVED_LOGIN_PASSWORD, neu);
        }
    } catch (error) {
        const msg =
            (error.response && error.response.data && error.response.data.error) || '비밀번호 변경에 실패했습니다.';
        showToast(msg, 'error');
    }
}

async function submitChangePasswordLegacy() {
    if (!currentUserId) {
        showToast('로그인이 필요합니다.', 'error');
        return;
    }
    const cur = (document.getElementById('editPasswordCurrent') || {}).value || '';
    const neu = (document.getElementById('editPasswordNew') || {}).value || '';
    const confirmPw = (document.getElementById('editPasswordConfirm') || {}).value || '';
    if (!cur) {
        showToast('현재 비밀번호를 입력해주세요.', 'error');
        return;
    }
    if (!neu) {
        showToast('새 비밀번호를 입력해주세요.', 'error');
        return;
    }
    if (neu !== confirmPw) {
        showToast('새 비밀번호가 일치하지 않습니다.', 'error');
        return;
    }
    const errs = getPasswordErrors(neu);
    if (errs.length) {
        showToast(errs[0], 'error');
        return;
    }
    try {
        const response = await axios.post('/api/users/' + currentUserId + '/change-password', {
            current_password: cur,
            new_password: neu
        });
        showToast(response.data.message || '비밀번호가 변경되었습니다.', 'success');
        ['editPasswordCurrent', 'editPasswordNew', 'editPasswordConfirm'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        if (localStorage.getItem(LS_LOGIN_REMEMBER) === '1') {
            localStorage.setItem(LS_SAVED_LOGIN_PASSWORD, neu);
        }
    } catch (error) {
        const msg =
            (error.response && error.response.data && error.response.data.error) || '비밀번호 변경에 실패했습니다.';
        showToast(msg, 'error');
    }
}

// Handle edit profile form submit
async function handleEditProfileSubmit(event) {
    event.preventDefault();
    
    // Get the user ID being edited (from hidden field)
    const editingUserId = parseInt(document.getElementById('editingUserId').value, 10);
    if (!Number.isFinite(editingUserId)) {
        showToast('회원 정보를 확인할 수 없습니다.', 'error');
        return;
    }
    
    const name = document.getElementById('editNameInline').value;
    const bio = document.getElementById('editBioInline').value;
    const gender = document.getElementById('editGenderInline').value;
    const church = document.getElementById('editChurchInline').value;
    const pastor = document.getElementById('editPastorInline').value;
    const position = document.getElementById('editPositionInline').value;
    const maritalStatus = document.getElementById('editMaritalStatusInline').value;
    const phone = document.getElementById('editPhoneInline').value;
    const address = document.getElementById('editAddressInline').value;
    const avatarFile = document.getElementById('editAvatarInline')?.files[0];
    const coverFile = document.getElementById('editCoverInline')?.files[0];
    
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
        // Update user info including bio, faith_answers, school info, and privacy_settings
        await axios.put('/api/users/' + editingUserId, {
            name,
            bio,
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
                await axios.post('/api/users/' + editingUserId + '/avatar', formData);
            } catch (uploadError) {
                console.error('Avatar upload error:', uploadError);
                const msg =
                    (uploadError.response && uploadError.response.data && uploadError.response.data.error) ||
                    '프로필 사진 업로드에 실패했습니다.';
                showToast(msg, 'error');
                return;
            }
        }

        // Upload new cover photo if selected
        if (coverFile) {
            const formData = new FormData();
            formData.append('cover', coverFile);
            
            try {
                await axios.post('/api/users/' + editingUserId + '/cover', formData);
            } catch (uploadError) {
                console.error('Cover upload error:', uploadError);
                const msg =
                    (uploadError.response && uploadError.response.data && uploadError.response.data.error) ||
                    '커버 사진 업로드에 실패했습니다.';
                showToast(msg, 'error');
                return;
            }
        }

        // Refresh user data
        const userResponse = await axios.get('/api/users/' + editingUserId);
        
        // Update currentUser if editing own profile (id는 API/로컬에서 숫자·문자 혼용 가능)
        if (Number(editingUserId) === Number(currentUserId)) {
            currentUser = userResponse.data.user;
            updateAuthUI();
        }
        
        showToast('프로필이 수정되었습니다! 👍', 'success');
        
        // Go back to profile view (filterByUser → 커버·상세 패널 최신화)
        showUserProfileModal(editingUserId);
        
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
    const coverFile = document.getElementById('editCover').files[0];
    
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
                await axios.post('/api/users/' + currentUserId + '/avatar', formData);
            } catch (uploadError) {
                console.error('Avatar upload error:', uploadError);
                const msg =
                    (uploadError.response && uploadError.response.data && uploadError.response.data.error) ||
                    '프로필 사진 업로드에 실패했습니다.';
                alert(msg);
                return;
            }
        }

        // Upload new cover photo if selected
        if (coverFile) {
            const formData = new FormData();
            formData.append('cover', coverFile);
            
            try {
                await axios.post('/api/users/' + currentUserId + '/cover', formData);
            } catch (uploadError) {
                console.error('Cover upload error:', uploadError);
                const msg =
                    (uploadError.response && uploadError.response.data && uploadError.response.data.error) ||
                    '커버 사진 업로드에 실패했습니다.';
                alert(msg);
                return;
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
    const password = (document.getElementById('signupPassword') || {}).value;
    const passwordConfirm = (document.getElementById('signupPasswordConfirm') || {}).value;
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
    const coverFile = document.getElementById('signupCover') && document.getElementById('signupCover').files[0];
    
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

    // 필수 항목 확인 (이름, 성별, 이메일, 비밀번호)
    if (!email || !name) {
        alert('이름과 이메일은 필수 항목입니다.');
        return;
    }
    
    if (!gender) {
        alert('성별을 선택해주세요.');
        return;
    }
    
    if (!password) {
        alert('비밀번호를 입력해주세요.');
        return;
    }
    if (password !== passwordConfirm) {
        alert('비밀번호가 일치하지 않습니다.');
        return;
    }
    const pwErrs = getPasswordErrors(password);
    if (pwErrs.length) {
        alert(pwErrs[0]);
        return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        alert('올바른 이메일 형식을 입력해주세요.');
        return;
    }
    
    // Phone validation (optional)
    if (phone) {
        const digits = String(phone).replace(/[^0-9]/g, '');
        if (digits.length < 9 || digits.length > 11) {
            alert('전화번호 형식을 확인해주세요.');
            return;
        }
    }

    // 교회 위치 조합: 도 + 시 (둘 다 있을 경우만)
    const location = (province && city) ? (province + ' ' + city) : '';

    // 아바타를 base64로 변환 (서버에서 인증 후 저장)
    let avatarDataUrl = null;
    if (avatarFile) {
        try {
            avatarDataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(avatarFile);
            });
        } catch (e) {
            console.warn('Avatar read error:', e);
        }
    }

    try {
        await axios.post('/api/signup-request', {
            email,
            name,
            password,
            church,
            pastor,
            denomination,
            location,
            position,
            gender,
            marital_status: maritalStatus,
            address,
            phone,
            faith_answers: JSON.stringify(faithAnswers),
            avatar_data_url: avatarDataUrl,
        });

        saveEmailToHistory(email);
        hideSignupModal();
        alert('인증 이메일을 발송했습니다. 이메일을 확인하여 인증 링크를 클릭해주세요.\n\n(스팸함도 확인해주세요)');
    } catch (error) {
        console.error('Signup error:', error);
        const msg = (error.response && error.response.data && error.response.data.error) || '회원가입에 실패했습니다. 다시 시도해주세요.';
        alert(msg);
    }
}

function getPasswordErrors(pw) {
    const p = String(pw || '');
    const errs = [];
    if (p.length < 8) errs.push('비밀번호는 8자 이상이어야 합니다.');
    const lower = (p.match(/[a-z]/g) || []).length;
    const digit = (p.match(/[0-9]/g) || []).length;
    if (lower < 3) errs.push('비밀번호는 영문 소문자 3개 이상이 포함되어야 합니다.');
    if (digit < 3) errs.push('비밀번호는 숫자 3개 이상이 포함되어야 합니다.');
    if (/[A-Z]/.test(p) || /[^a-z0-9]/.test(p)) errs.push('비밀번호는 대문자·특수문자를 사용할 수 없습니다.');
    return errs;
}

function validatePasswordRealtime() {
    const pwEl = document.getElementById('signupPassword');
    const cfEl = document.getElementById('signupPasswordConfirm');
    const rulesDiv = document.getElementById('passwordRules');
    const matchDiv = document.getElementById('passwordMatchMsg');
    if (!pwEl || !cfEl || !rulesDiv || !matchDiv) return;

    const pw = pwEl.value || '';
    const cf = cfEl.value || '';

    if (pw) rulesDiv.classList.remove('hidden');
    else rulesDiv.classList.add('hidden');

    const setRule = (id, ok) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('text-gray-400', !ok);
        el.classList.toggle('text-green-600', ok);
        const icon = el.querySelector('i');
        if (icon) {
            icon.classList.toggle('fa-circle', !ok);
            icon.classList.toggle('fa-check-circle', ok);
        }
    };
    setRule('rule-length', pw.length >= 8);
    setRule('rule-lower', (pw.match(/[a-z]/g) || []).length >= 3);
    setRule('rule-digit', (pw.match(/[0-9]/g) || []).length >= 3);
    setRule('rule-noUpper', !(/[A-Z]/.test(pw) || /[^a-z0-9]/.test(pw)));

    if (!cf) {
        matchDiv.classList.add('hidden');
    } else {
        matchDiv.classList.remove('hidden');
        matchDiv.innerHTML = (pw === cf)
            ? '<span class="text-green-600"><i class="fas fa-check-circle mr-1"></i>비밀번호가 일치합니다</span>'
            : '<span class="text-red-500"><i class="fas fa-times-circle mr-1"></i>비밀번호가 일치하지 않습니다</span>';
    }
}

// =====================
// Login reward celebration (count-up + progress bar)
// =====================
let loginRewardCelebrationOnEscape = null;

function easeOutCubicLoginReward(t) {
    return 1 - Math.pow(1 - t, 3);
}

function runLoginRewardCountUp(durationMs, onProgress) {
    return new Promise(function (resolve) {
        const t0 = performance.now();
        function frame(now) {
            const raw = Math.min((now - t0) / durationMs, 1);
            onProgress(easeOutCubicLoginReward(raw));
            if (raw < 1) requestAnimationFrame(frame);
            else resolve();
        }
        requestAnimationFrame(frame);
    });
}

function hideLoginRewardCelebrationModal() {
    const m = document.getElementById('loginRewardCelebrationModal');
    if (m) {
        m.classList.add('hidden');
        m.classList.remove('login-reward-celeb-active');
    }
    const glow = document.getElementById('loginRewardCelebrationGlow');
    if (glow) glow.classList.remove('milestone-glow-burst');
    if (loginRewardCelebrationOnEscape) {
        document.removeEventListener('keydown', loginRewardCelebrationOnEscape);
        loginRewardCelebrationOnEscape = null;
    }
}

function loginRewardNextUnlockHint(combined) {
    if (combined >= SCORE_MILESTONE_REWARD3) {
        return '세 가지 리워드를 모두 열었어요. 정말 멋져요!';
    }
    if (combined < SERMON_REWARD1_THRESHOLD) {
        return `리워드1(설교 말씀)까지 약 ${SERMON_REWARD1_THRESHOLD - combined}μ`;
    }
    if (combined < SCORE_MILESTONE_REWARD2) {
        return `리워드2(QT 찬양)까지 약 ${SCORE_MILESTONE_REWARD2 - combined}μ`;
    }
    return `리워드3(QT 알람)까지 약 ${SCORE_MILESTONE_REWARD3 - combined}μ`;
}

function fillLoginRewardUnlockList(combined, listEl) {
    if (!listEl) return;
    listEl.innerHTML = '';
    const tiers = [
        { mu: SERMON_REWARD1_THRESHOLD, label: '리워드1', desc: '오늘의 설교 말씀 영상' },
        { mu: SCORE_MILESTONE_REWARD2, label: '리워드2', desc: 'QT 찬양 듣기' },
        { mu: SCORE_MILESTONE_REWARD3, label: '리워드3', desc: 'QT 예약·알람' }
    ];
    let anyUnlocked = false;
    for (let i = 0; i < tiers.length; i++) {
        const t = tiers[i];
        if (combined < t.mu) continue;
        anyUnlocked = true;
        const li = document.createElement('li');
        li.className = 'flex items-start gap-3 rounded-xl border p-3 bg-emerald-50/95 border-emerald-200';
        li.innerHTML =
            '<span class="shrink-0 mt-0.5 text-lg"><i class="fas fa-check-circle text-emerald-600"></i></span>' +
            '<div class="min-w-0 flex-1">' +
            '<p class="font-semibold text-sm text-gray-900">' +
            t.label +
            ' <span class="text-blue-600">' +
            t.mu +
            'μ</span></p>' +
            '<p class="text-xs text-gray-600 mt-0.5">' +
            t.desc +
            '</p>' +
            '<p class="text-xs text-emerald-800 font-semibold mt-1">언락됨 · 왼쪽 사이드바에서 이용하세요</p>' +
            '</div>';
        listEl.appendChild(li);
    }
    if (!anyUnlocked) {
        const emptyLi = document.createElement('li');
        emptyLi.className = 'text-sm text-gray-500 text-center py-3 px-2 leading-relaxed';
        emptyLi.textContent = '아직 달성한 리워드가 없습니다. 종합 μ를 올려 보세요.';
        listEl.appendChild(emptyLi);
    }
}

function mountLoginRewardRandomFalls(modalEl) {
    if (!modalEl) return;
    const layer = modalEl.querySelector('#loginRewardParticleLayer');
    if (!layer) return;

    const oldFalls = layer.querySelectorAll('.login-reward-fall.dynamic');
    for (let i = 0; i < oldFalls.length; i++) oldFalls[i].remove();

    const palette = ['#fde047', '#93c5fd', '#fca5a5', '#86efac', '#c4b5fd', '#fdba74', '#67e8f9', '#bef264'];
    const pieceCount = 34;

    for (let i = 0; i < pieceCount; i++) {
        const fall = document.createElement('span');
        fall.className = 'login-reward-fall dynamic';
        const left = 3 + Math.random() * 94;
        const top = -28 - Math.random() * 30;
        const delay = Math.random() * 0.95;
        const duration = 1.25 + Math.random() * 1.6;
        const w = 4 + Math.random() * 6;
        const h = 8 + Math.random() * 10;
        const color = palette[Math.floor(Math.random() * palette.length)];
        const rot = -25 + Math.random() * 50;

        fall.style.left = left.toFixed(2) + '%';
        fall.style.top = top.toFixed(2) + 'px';
        fall.style.width = w.toFixed(1) + 'px';
        fall.style.height = h.toFixed(1) + 'px';
        fall.style.background = color;
        fall.style.animationDelay = delay.toFixed(2) + 's';
        fall.style.setProperty('--fall-duration', duration.toFixed(2) + 's');
        // keyframes가 transform을 덮어쓸 수 있어, 회전은 큰 차이는 기대하지 않고 위치/크기 중심으로 랜덤화
        fall.style.transform = 'rotate(' + rot.toFixed(1) + 'deg)';
        layer.appendChild(fall);
    }
}

function mountLoginRewardRandomFireworks(modalEl) {
    if (!modalEl) return;
    const layer = modalEl.querySelector('#loginRewardParticleLayer');
    if (!layer) return;

    const oldFws = layer.querySelectorAll('.login-reward-firework.dynamic-fw');
    for (let i = 0; i < oldFws.length; i++) oldFws[i].remove();

    const count = 8;
    const hueBase = [0, 40, 80, 160, 210, 270];

    for (let i = 0; i < count; i++) {
        const fw = document.createElement('span');
        fw.className = 'login-reward-firework dynamic-fw';

        const left = 10 + Math.random() * 80;
        const top = 10 + Math.random() * 20; // %
        const size = 14 + Math.random() * 18; // px
        const delay = Math.random() * 0.42;
        const hue = hueBase[Math.floor(Math.random() * hueBase.length)] + (Math.random() * 20 - 10);

        fw.style.left = left.toFixed(2) + '%';
        fw.style.top = top.toFixed(2) + '%';
        fw.style.width = size.toFixed(1) + 'px';
        fw.style.height = size.toFixed(1) + 'px';
        fw.style.animationDelay = delay.toFixed(2) + 's';
        fw.style.filter =
            'blur(0.18px) hue-rotate(' + hue.toFixed(1) + 'deg) drop-shadow(0 0 14px rgba(167, 139, 250, 0.75))';

        layer.appendChild(fw);
    }
}

/** 로그인·자동 로그인 후 매번: 달성 μ·리워드 언락을 언급하며 축하 (로그인 문구와 분리) */
async function showLoginRewardCelebrationModal(user) {
    const m = document.getElementById('loginRewardCelebrationModal');
    if (!m || !user) return;

    const titleEl = document.getElementById('loginRewardCelebrationTitle');
    const listEl = document.getElementById('loginRewardUnlockList');
    const totalEl = document.getElementById('loginRewardCelebrationTotal');
    const scrEl = document.getElementById('loginRewardCelebrationScripture');
    const prayEl = document.getElementById('loginRewardCelebrationPrayer');
    const actEl = document.getElementById('loginRewardCelebrationActivity');
    const nextHint = document.getElementById('loginRewardCelebrationNextHint');
    const barS = document.getElementById('loginRewardBarScripture');
    const barP = document.getElementById('loginRewardBarPrayer');
    const barA = document.getElementById('loginRewardBarActivity');
    const glow = document.getElementById('loginRewardCelebrationGlow');

    const scriptureTotal = (typingScore || 0) + (videoScore || 0);
    const prayer = prayerScore || 0;
    const activity = activityScore || 0;
    const combined = scriptureTotal + prayer + activity;
    // 리워드 미달성 상태에서는 로그인 축하 패널을 열지 않음
    if (combined < SERMON_REWARD1_THRESHOLD) return;
    const maxPart = Math.max(scriptureTotal, prayer, activity, 1);
    const pctS = Math.round((scriptureTotal / maxPart) * 100);
    const pctP = Math.round((prayer / maxPart) * 100);
    const pctA = Math.round((activity / maxPart) * 100);

    if (titleEl) {
        titleEl.textContent = `${user.name}님 · μ·리워드`;
    }
    if (nextHint) nextHint.textContent = loginRewardNextUnlockHint(combined);
    fillLoginRewardUnlockList(combined, listEl);
    mountLoginRewardRandomFalls(m);
    mountLoginRewardRandomFireworks(m);

    if (totalEl) totalEl.textContent = '0';
    if (scrEl) scrEl.textContent = '0';
    if (prayEl) prayEl.textContent = '0';
    if (actEl) actEl.textContent = '0';
    if (barS) {
        barS.style.transition = 'none';
        barS.style.height = '0%';
    }
    if (barP) {
        barP.style.transition = 'none';
        barP.style.height = '0%';
    }
    if (barA) {
        barA.style.transition = 'none';
        barA.style.height = '0%';
    }
    if (glow) glow.classList.remove('milestone-glow-burst');

    const celebrationParticles = m.querySelectorAll('.login-reward-spark, .login-reward-firework, .login-reward-fall');
    for (let si = 0; si < celebrationParticles.length; si++) {
        celebrationParticles[si].style.animation = 'none';
        void celebrationParticles[si].offsetWidth;
        celebrationParticles[si].style.removeProperty('animation');
    }

    m.classList.remove('hidden');
    m.classList.remove('login-reward-celeb-active');
    void m.offsetWidth;
    requestAnimationFrame(function () {
        m.classList.add('login-reward-celeb-active');
        if (glow) {
            void glow.offsetWidth;
            glow.classList.add('milestone-glow-burst');
        }
    });

    loginRewardCelebrationOnEscape = function (e) {
        if (e.key === 'Escape') hideLoginRewardCelebrationModal();
    };
    document.addEventListener('keydown', loginRewardCelebrationOnEscape);

    requestAnimationFrame(function () {
        requestAnimationFrame(function () {
            if (barS) {
                barS.style.transition = 'height 2.5s cubic-bezier(0.22, 1, 0.36, 1)';
                barS.style.height = pctS + '%';
            }
            if (barP) {
                barP.style.transition = 'height 2.5s cubic-bezier(0.22, 1, 0.36, 1)';
                barP.style.height = pctP + '%';
            }
            if (barA) {
                barA.style.transition = 'height 2.5s cubic-bezier(0.22, 1, 0.36, 1)';
                barA.style.height = pctA + '%';
            }
        });
    });

    await runLoginRewardCountUp(2500, function (e) {
        if (totalEl) totalEl.textContent = String(Math.round(combined * e));
        if (scrEl) scrEl.textContent = String(Math.round(scriptureTotal * e));
        if (prayEl) prayEl.textContent = String(Math.round(prayer * e));
        if (actEl) actEl.textContent = String(Math.round(activity * e));
    });
}

// =====================
// 종합 μ 200 / 1000 / 1400 마일스톤 축하 (잭팟 스타일)
// =====================
function resetLastKnownCombinedScore() {
    lastKnownCombinedScore = null;
}

function detectCrossedMilestones(prev, next) {
    const crossed = [];
    for (let i = 0; i < SCORE_MILESTONE_TIERS.length; i++) {
        const t = SCORE_MILESTONE_TIERS[i];
        if (prev < t && next >= t) crossed.push(t);
    }
    return crossed;
}

function enqueueScoreMilestoneCelebrations(crossedTiers, combinedAtHit) {
    for (let i = 0; i < crossedTiers.length; i++) {
        scoreMilestoneQueue.push({ tier: crossedTiers[i], combinedAtHit: combinedAtHit });
    }
    processScoreMilestoneQueue();
}

function processScoreMilestoneQueue() {
    if (scoreMilestoneModalOpen || scoreMilestoneQueue.length === 0) return;
    scoreMilestoneModalOpen = true;
    const item = scoreMilestoneQueue.shift();
    openScoreMilestoneCelebrationModal(item.tier, item.combinedAtHit);
}

function hideScoreMilestoneCelebrationModal() {
    const m = document.getElementById('scoreMilestoneCelebrationModal');
    if (m) {
        m.classList.add('hidden');
        m.classList.remove('milestone-modal-active');
    }
    if (scoreMilestoneEscapeHandler) {
        document.removeEventListener('keydown', scoreMilestoneEscapeHandler);
        scoreMilestoneEscapeHandler = null;
    }
    scoreMilestoneModalOpen = false;
    processScoreMilestoneQueue();
}

function openScoreMilestoneCelebrationModal(tier, combinedAtHit) {
    const m = document.getElementById('scoreMilestoneCelebrationModal');
    if (!m) {
        scoreMilestoneModalOpen = false;
        processScoreMilestoneQueue();
        return;
    }

    const titleEl = document.getElementById('milestoneCelebrationTitle');
    const subEl = document.getElementById('milestoneCelebrationSubtitle');
    const hintEl = document.getElementById('milestoneCelebrationRewardHint');
    const headerEl = document.getElementById('milestoneCelebrationHeader');
    const bigEl = document.getElementById('milestoneCelebrationBigMu');
    const barS = document.getElementById('milestoneBarScripture');
    const barP = document.getElementById('milestoneBarPrayer');
    const barA = document.getElementById('milestoneBarActivity');
    const glow = document.getElementById('milestoneJackpotGlow');

    const scriptureTotal = (typingScore || 0) + (videoScore || 0);
    const prayer = prayerScore || 0;
    const activity = activityScore || 0;
    const maxPart = Math.max(scriptureTotal, prayer, activity, 1);
    const pctS = Math.round((scriptureTotal / maxPart) * 100);
    const pctP = Math.round((prayer / maxPart) * 100);
    const pctA = Math.round((activity / maxPart) * 100);

    const themes = {
        200: {
            title: '200μ 달성!',
            sub: '리워드1 · 오늘의 설교 말씀이 열렸습니다',
            hint: '왼쪽 사이드바 「오늘의 설교 말씀」에서 영상을 감상해 보세요.',
            headerClass: 'bg-gradient-to-r from-blue-600 to-indigo-600'
        },
        1000: {
            title: '1000μ 달성!',
            sub: '리워드2 · QT 찬양 기능이 공개되었습니다',
            hint: 'QT 패널 상단의 찬양 버튼으로 찬양을 들을 수 있습니다.',
            headerClass: 'bg-gradient-to-r from-indigo-600 to-purple-600'
        },
        1400: {
            title: '1400μ 달성!',
            sub: '리워드3 · QT 예약(알람)이 공개되었습니다',
            hint: 'QT 패널에서 알람을 설정해 매일 QT를 이어가 보세요.',
            headerClass: 'bg-gradient-to-r from-purple-600 to-violet-700'
        }
    };
    const th = themes[tier] || themes[200];
    if (titleEl) titleEl.textContent = th.title;
    if (subEl) subEl.textContent = th.sub;
    if (hintEl) hintEl.textContent = th.hint;
    if (headerEl) {
        headerEl.className =
            'px-5 py-4 text-white text-center rounded-t-2xl border-b border-white/20 ' + th.headerClass;
    }

    if (bigEl) bigEl.textContent = '0μ';
    if (barS) {
        barS.style.transition = 'none';
        barS.style.height = '0%';
    }
    if (barP) {
        barP.style.transition = 'none';
        barP.style.height = '0%';
    }
    if (barA) {
        barA.style.transition = 'none';
        barA.style.height = '0%';
    }
    if (glow) glow.classList.remove('milestone-glow-burst');

    scoreMilestoneEscapeHandler = function (e) {
        if (e.key === 'Escape') hideScoreMilestoneCelebrationModal();
    };
    document.addEventListener('keydown', scoreMilestoneEscapeHandler);

    m.classList.remove('hidden');
    const sparks = m.querySelectorAll('.milestone-spark');
    for (let si = 0; si < sparks.length; si++) {
        sparks[si].style.animation = 'none';
        void sparks[si].offsetWidth;
        sparks[si].style.removeProperty('animation');
    }
    requestAnimationFrame(function () {
        m.classList.add('milestone-modal-active');
        if (glow) void glow.offsetWidth;
        if (glow) glow.classList.add('milestone-glow-burst');
    });

    requestAnimationFrame(function () {
        requestAnimationFrame(function () {
            if (barS) {
                barS.style.transition = 'height 1s cubic-bezier(0.22, 1, 0.36, 1)';
                barS.style.height = pctS + '%';
            }
            if (barP) {
                barP.style.transition = 'height 1s cubic-bezier(0.22, 1, 0.36, 1)';
                barP.style.height = pctP + '%';
            }
            if (barA) {
                barA.style.transition = 'height 1s cubic-bezier(0.22, 1, 0.36, 1)';
                barA.style.height = pctA + '%';
            }
        });
    });

    void runLoginRewardCountUp(1200, function (e) {
        if (bigEl) bigEl.textContent = String(Math.round(combinedAtHit * e)) + 'μ';
    });
}

function onCombinedScoreUpdated(combinedScore) {
    if (!currentUserId) return;
    if (lastKnownCombinedScore === null) {
        lastKnownCombinedScore = combinedScore;
        return;
    }
    const prev = lastKnownCombinedScore;
    if (prev === combinedScore) return;
    const crossed = detectCrossedMilestones(prev, combinedScore);
    lastKnownCombinedScore = combinedScore;
    if (crossed.length) enqueueScoreMilestoneCelebrations(crossed, combinedScore);
}

function syncQtRewardSidebars(combinedScore) {
    const r2 = document.getElementById('reward2TotalScore');
    const r2bar = document.getElementById('reward2ProgressBar');
    if (r2) r2.textContent = String(combinedScore);
    if (r2bar) r2bar.style.width = Math.min(100, (combinedScore / SCORE_MILESTONE_REWARD2) * 100) + '%';

    const wLocked = document.getElementById('qtWorshipLocked');
    const wUnlocked = document.getElementById('qtWorshipUnlocked');
    const unlockW = document.getElementById('unlockQtWorshipBtn');
    if (combinedScore >= SCORE_MILESTONE_REWARD2) {
        if (wLocked) wLocked.classList.add('hidden');
        if (wUnlocked) wUnlocked.classList.remove('hidden');
    } else {
        if (wLocked) wLocked.classList.remove('hidden');
        if (wUnlocked) wUnlocked.classList.add('hidden');
        if (unlockW) {
            unlockW.disabled = true;
            unlockW.className =
                'w-full py-3 px-4 bg-gray-300 text-gray-500 rounded-lg font-bold font-size-desc cursor-not-allowed flex items-center justify-center space-x-2 transition-all';
            unlockW.innerHTML =
                '<i class="fas fa-lock text-lg"></i><span>1000μ 달성 후 공개 가능</span>';
        }
    }

    const r3 = document.getElementById('reward3TotalScore');
    const r3bar = document.getElementById('reward3ProgressBar');
    if (r3) r3.textContent = String(combinedScore);
    if (r3bar) r3bar.style.width = Math.min(100, (combinedScore / SCORE_MILESTONE_REWARD3) * 100) + '%';

    const aLocked = document.getElementById('qtAlarmLocked');
    const aUnlocked = document.getElementById('qtAlarmUnlocked');
    const unlockA = document.getElementById('unlockQtAlarmBtn');
    if (combinedScore >= SCORE_MILESTONE_REWARD3) {
        if (aLocked) aLocked.classList.add('hidden');
        if (aUnlocked) aUnlocked.classList.remove('hidden');
    } else {
        if (aLocked) aLocked.classList.remove('hidden');
        if (aUnlocked) aUnlocked.classList.add('hidden');
        if (unlockA) {
            unlockA.disabled = true;
            unlockA.className =
                'w-full py-3 px-4 bg-gray-300 text-gray-500 rounded-lg font-bold font-size-desc cursor-not-allowed flex items-center justify-center space-x-2 transition-all';
            unlockA.innerHTML =
                '<i class="fas fa-lock text-lg"></i><span>1400μ 달성 후 공개 가능</span>';
        }
    }

    document.querySelectorAll('.qt-panel-instance [data-qt-field="qtWorshipBtn"]').forEach((btn) => {
        if (combinedScore >= SCORE_MILESTONE_REWARD2) btn.classList.remove('hidden');
        else btn.classList.add('hidden');
    });
    document.querySelectorAll('.qt-panel-instance [data-qt-field="qtAlarmBtn"]').forEach((qtAlarmBtn) => {
        if (combinedScore >= SCORE_MILESTONE_REWARD3) qtAlarmBtn.classList.remove('hidden');
        else qtAlarmBtn.classList.add('hidden');
    });
}

// =====================
// QT Panel Functions (multi-date diary + 서버 로그)
// =====================
/** 날짜 시뮬 헤더 버튼·오프셋 — 다시 쓸 때 true 로 변경 */
const QT_DAY_SIM_UI_ENABLED = false;

let qtLogsByDate = {};

/** 서버·로컬 키 불일치(공백, ISO 접두)로 삭제 후 로그가 되살아나는 것 방지 */
function normalizeQtDateKey(d) {
    const s = String(d == null ? '' : d)
        .trim()
        .replace(/^(\d{4}-\d{2}-\d{2})[\sT].*$/, '$1');
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function panelQtDate(panel) {
    return normalizeQtDateKey(panel && panel.dataset ? panel.dataset.qtDate : '');
}

function qf(panel, field) {
    return panel ? panel.querySelector(`[data-qt-field="${field}"]`) : null;
}

function getQtPanelByDate(qtDate) {
    const stack = document.getElementById('qtPanelsStack');
    const q = normalizeQtDateKey(qtDate);
    if (!stack || !q) return null;
    return stack.querySelector(`.qt-panel-instance[data-qt-date="${q}"]`);
}

function getQtPanelDatesOrdered() {
    const today = normalizeQtDateKey(getTodayQtDateForApi());
    const dateSet = new Set();
    if (today) dateSet.add(today);

    // 묵상 또는 마침기도가 저장된 날짜는 일기처럼 보존
    for (const [date, log] of Object.entries(qtLogsByDate)) {
        const hasContent =
            (log.apply_text && String(log.apply_text).trim()) ||
            (log.closing_prayer_text && String(log.closing_prayer_text).trim());
        if (hasContent) {
            const nk = normalizeQtDateKey(date);
            if (nk) dateSet.add(nk);
        }
    }

    // 최신순 정렬
    return Array.from(dateSet).sort((a, b) => b.localeCompare(a));
}

function mergeQtLogRowIntoCache(row) {
    if (!row || row.qt_date == null) return;
    const nk = normalizeQtDateKey(row.qt_date);
    if (!nk) return;
    qtLogsByDate[nk] = { ...row, qt_date: nk };
}

function purgeQtLogFromClientCache(logId, qtDateRaw) {
    const qd = normalizeQtDateKey(qtDateRaw);
    const drop = new Set();
    Object.keys(qtLogsByDate).forEach((k) => {
        const r = qtLogsByDate[k];
        const nk = normalizeQtDateKey(k);
        if (r && Number(r.id) === Number(logId)) drop.add(k);
        if (qd && nk === qd) drop.add(k);
    });
    drop.forEach((k) => delete qtLogsByDate[k]);
}

async function fetchQtLogsCache() {
    qtLogsByDate = {};
    if (!currentUserId) return;
    try {
        const { data } = await axios.get(`/api/qt/logs?user_id=${encodeURIComponent(String(currentUserId))}`, {
            params: { _: Date.now() },
            headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
        });
        const logs = data.logs || [];
        for (let i = 0; i < logs.length; i++) mergeQtLogRowIntoCache(logs[i]);
    } catch (e) {
        console.warn('QT logs fetch failed', e);
    }
}

function ensureQtPanelsClickDelegate() {
    const wrap = document.getElementById('qtPanelsWrap');
    if (!wrap || wrap.dataset.qtDeleg === '1') return;
    wrap.dataset.qtDeleg = '1';
    wrap.addEventListener('click', onQtPanelsWrapClick);
}

function onQtPanelsWrapClick(e) {
    const t = e.target.closest('[data-qt-act]');
    if (!t) return;
    const panel = t.closest('.qt-panel-instance');
    if (!panel) return;
    const d = panelQtDate(panel);
    if (d) window.__activeQtDate = d;
    const act = t.dataset.qtAct;
    if (act === 'toggle-section') {
        void showQtSectionForPanel(panel, t.getAttribute('data-section'));
        return;
    }
    if (act === 'send-apply') {
        void sendQtApplyPostForPanel(panel);
        return;
    }
    if (act === 'send-prayer') {
        void sendQtPrayerPostForPanel(panel);
        return;
    }
    if (act === 'edit-apply') {
        editQtApplyForPanel(panel);
        return;
    }
    if (act === 'edit-prayer') {
        editQtPrayerForPanel(panel);
        return;
    }
    if (act === 'delete-log') {
        void deleteQtLogForPanel(panel);
        return;
    }
    if (act === 'alarm') {
        showQtAlarmModal();
        return;
    }
    if (act === 'invite') {
        showQtInviteModal();
        return;
    }
    if (act === 'worship') {
        const wrap = qf(panel, 'worshipWrap');
        if (wrap && wrap.classList.contains('hidden')) {
            openQtWorshipForPanel(panel);
        } else {
            closeQtWorshipForPanel(panel);
        }
        return;
    }
    if (act === 'worship-play') {
        toggleQtWorshipPlay();
        return;
    }
    if (act === 'worship-mute') {
        toggleQtWorshipMute();
        return;
    }
}

async function toggleQtPanel() {
    const qtPanelsWrap = document.getElementById('qtPanelsWrap');
    if (!qtPanelsWrap) return;
    ensureQtPanelsClickDelegate();
    const mainFeedPart1 = document.getElementById('mainFeedPart1');
    const newPostCard = document.getElementById('newPostCard');
    const postsFeedWrapper = document.getElementById('postsFeedWrapper');

    if (qtPanelsWrap.classList.contains('hidden')) {
        await fetchQtLogsCache();
        await renderQtPanels();
        qtPanelsWrap.classList.remove('hidden');
        hideAllQtSections();
        resetAllQtSectionButtonStyles();
        setQtHeaderButtonActive(true);

        if (mainFeedPart1) mainFeedPart1.classList.add('hidden');
        if (newPostCard) newPostCard.classList.add('hidden');
        if (postsFeedWrapper) postsFeedWrapper.classList.add('hidden');
    } else {
        qtPanelsWrap.classList.add('hidden');
        hideAllQtSections();
        resetAllQtSectionButtonStyles();
        setQtHeaderButtonActive(false);

        if (mainFeedPart1) mainFeedPart1.classList.remove('hidden');
        if (newPostCard) newPostCard.classList.remove('hidden');
        if (postsFeedWrapper) postsFeedWrapper.classList.remove('hidden');
    }
}

function setQtHeaderButtonActive(active) {
    const ids = ['qtBtn', 'qtBtnMobile'];
    for (let i = 0; i < ids.length; i++) {
        const b = document.getElementById(ids[i]);
        if (!b) continue;
        b.classList.toggle('text-red-600', active);
        b.classList.toggle('border-red-600', active);
        b.classList.toggle('bg-red-50', active);
        b.classList.toggle('text-gray-500', !active);
        b.classList.toggle('border-gray-500', !active);
        b.classList.toggle('bg-transparent', !active);
    }
}

function getQtStorageKey(suffix, qtDate) {
    const uid = currentUserId || 'guest';
    const d = qtDate || getTodayQtDateForApi();
    return `qt_${uid}_${d}_${suffix}`;
}

const qtBibleCache = {};
const QT_SIM_DAY_OFFSET_KEY = 'qt_sim_day_offset';

function getQtSimDayOffset() {
    if (!QT_DAY_SIM_UI_ENABLED) return 0;
    const n = parseInt(localStorage.getItem(QT_SIM_DAY_OFFSET_KEY) || '0', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function setQtSimDayOffset(n) {
    localStorage.setItem(QT_SIM_DAY_OFFSET_KEY, String(Math.max(0, Math.floor(Number(n) || 0))));
}

function clearQtBibleCacheAll() {
    Object.keys(qtBibleCache).forEach((k) => delete qtBibleCache[k]);
}

function syncQtSimButtonTitles() {
    const pc = document.getElementById('qtDaySimBtn');
    const mob = document.getElementById('qtDaySimBtnMobile');
    if (!QT_DAY_SIM_UI_ENABLED) {
        if (pc) pc.classList.add('hidden');
        if (mob) mob.classList.add('hidden');
        return;
    }
    if (pc) pc.classList.remove('hidden');
    if (mob) mob.classList.remove('hidden');
    const off = getQtSimDayOffset();
    const title =
        off > 0
            ? `날짜 시뮬: 실제보다 ${off}일 진행 중. 클릭하면 하루 더 진행 · Shift+클릭하면 초기화`
            : '클릭: 하루 진행(페이크) · Shift+클릭: 초기화 (Duranno 대신 랜덤 WEB 본문)';
    const apply = (btn) => {
        if (!btn) return;
        btn.title = title;
        const badge = btn.querySelector('[data-qt-sim-badge]');
        if (badge) {
            if (off > 0) {
                badge.textContent = `+${off}`;
                badge.classList.remove('hidden');
            } else {
                badge.textContent = '';
                badge.classList.add('hidden');
            }
        }
        btn.classList.toggle('ring-2', off > 0);
        btn.classList.toggle('ring-violet-400', off > 0);
    };
    apply(pc);
    apply(mob);
}

async function advanceQtDaySimulation(ev) {
    if (!QT_DAY_SIM_UI_ENABLED) return;
    if (!currentUserId) {
        showToast('로그인 후 사용할 수 있어요.', 'error');
        return;
    }
    const shift = ev && ev.shiftKey;
    if (shift) {
        setQtSimDayOffset(0);
        clearQtBibleCacheAll();
        showToast('날짜 시뮬을 초기화했어요.', 'success');
    } else {
        const next = getQtSimDayOffset() + 1;
        setQtSimDayOffset(next);
        clearQtBibleCacheAll();
        showToast(`시뮬 하루 진행 (+${next}일) · 오늘: ${getTodayQtDateForApi()}`, 'success');
    }
    syncQtSimButtonTitles();
    await fetchQtLogsCache();
    const wrap = document.getElementById('qtPanelsWrap');
    const open = wrap && !wrap.classList.contains('hidden');
    if (open) await renderQtPanels();
}

window.advanceQtDaySimulation = advanceQtDaySimulation;

function getTodayQtDateForApi() {
    const now = new Date();
    const off = getQtSimDayOffset();
    if (off > 0) {
        now.setDate(now.getDate() + off);
    }
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function qtAutoGrow(el) {
    if (!el) return;
    el.style.height = 'auto';
    const max = 220;
    const next = Math.min(max, el.scrollHeight || 0);
    el.style.height = `${Math.max(44, next)}px`;
}

function setQtSubmittedViewForPanel(panel, kind, submittedText) {
    const isApply = kind === 'apply';
    const composer = qf(panel, isApply ? 'applyComposer' : 'prayerComposer');
    const view = qf(panel, isApply ? 'applySavedView' : 'prayerSavedView');
    const textEl = qf(panel, isApply ? 'applySavedText' : 'prayerSavedText');
    if (!composer || !view || !textEl) return;
    textEl.textContent = String(submittedText || '').trim();
    composer.classList.add('hidden');
    view.classList.remove('hidden');
}

function setQtComposeViewForPanel(panel, kind, initialText) {
    const isApply = kind === 'apply';
    const composer = qf(panel, isApply ? 'applyComposer' : 'prayerComposer');
    const view = qf(panel, isApply ? 'applySavedView' : 'prayerSavedView');
    const input = qf(panel, isApply ? 'applyInput' : 'prayerInput');
    if (!composer || !view || !input) return;
    composer.classList.remove('hidden');
    view.classList.add('hidden');
    if (typeof initialText === 'string') input.value = initialText;
    qtAutoGrow(input);
}

function setQtSectionBtnActive(panel, sectionKey, active) {
    const b = panel.querySelector(`[data-qt-sec-btn="${sectionKey}"]`);
    if (!b) return;
    b.classList.toggle('bg-red-100', active);
    b.classList.toggle('text-red-800', active);
    b.classList.toggle('border-red-300', active);
    b.classList.toggle('bg-gray-100', !active);
    b.classList.toggle('text-gray-700', !active);
    b.classList.toggle('border-gray-300', !active);
}

function resetAllQtSectionButtonStyles() {
    document.querySelectorAll('.qt-panel-instance').forEach((panel) => {
        ['prayer', 'read', 'apply', 'prayer2'].forEach((k) => setQtSectionBtnActive(panel, k, false));
    });
}

/** @deprecated 단일 패널 호환 — 헤더 버튼만 끌 때 사용 */
function setQtButtonActive(sectionKey, active) {
    document.querySelectorAll('.qt-panel-instance').forEach((panel) => setQtSectionBtnActive(panel, sectionKey, active));
}

function hideAllQtSections() {
    document.querySelectorAll('.qt-panel-instance .qt-section').forEach((el) => el.classList.add('hidden'));
}

async function loadQtBibleForDate(qtDate) {
    const sim = getQtSimDayOffset() > 0;
    const cacheKey = sim ? `${qtDate}\0sim` : qtDate;
    if (qtBibleCache[cacheKey]) return qtBibleCache[cacheKey];
    const simQ = sim ? '&sim=1' : '';
    const res = await fetch(`/api/qt/bible?qtDate=${encodeURIComponent(qtDate)}${simQ}`);
    if (!res.ok) throw new Error('QT 성경을 불러오지 못했습니다.');
    const data = await res.json();
    qtBibleCache[cacheKey] = data;
    return data;
}

function toQtPassageShortRef(passageRef) {
    const s = String(passageRef || '').replace(/\s+/g, ' ').trim();
    const m = s.match(/^(.+?)\s+(\d+)\s*:\s*(\d+)(~\d+)?/);
    if (!m) return s || '';
    const book = m[1].trim();
    const chap = m[2];
    const v1 = m[3];
    const tildeRange = m[4];
    if (tildeRange) {
        const end = tildeRange.replace(/^~/, '');
        return `${book} ${chap}장 ${v1}~${end}절`;
    }
    return `${book} ${chap}장 ${v1}절`;
}

function applyQtPassageHeaderFromData(data, panel) {
    const passageRef = (data.passageRef || '').trim();
    const fallbackRef = (data.reference || '').trim();
    const refForHeader = (passageRef || fallbackRef).trim();
    const rawEl = qf(panel, 'verseRefRaw');
    if (rawEl) rawEl.textContent = refForHeader;

    const shortEl = qf(panel, 'passageShort');
    const short = toQtPassageShortRef(passageRef || refForHeader);
    if (shortEl) shortEl.textContent = short && short.length ? short : '-';

    const qtVerseRef = qf(panel, 'verseRef');
    if (qtVerseRef) {
        const line = '──────────';
        const m = refForHeader.match(/^(.+?)\s+\d+\s*:\s*/);
        const bookOnly = m ? m[1].trim() : '';
        const rest =
            bookOnly && short.startsWith(bookOnly) ? short.slice(bookOnly.length).trim() : '';
        if (bookOnly && rest) {
            qtVerseRef.textContent = `${bookOnly}\n${line}\n${rest}`;
        } else if (refForHeader) {
            qtVerseRef.textContent = refForHeader;
        } else {
            qtVerseRef.textContent = '';
        }
    }
}

function setQtPassageHeaderLoading(panel) {
    const shortEl = qf(panel, 'passageShort');
    const qtVerseRef = qf(panel, 'verseRef');
    const rawEl = qf(panel, 'verseRefRaw');
    if (rawEl) rawEl.textContent = '';
    if (shortEl) shortEl.textContent = '불러오는 중';
    const line = '──────────';
    if (qtVerseRef) qtVerseRef.textContent = `오늘의 본문\n${line}\n확인 중…`;
}

async function refreshQtPanelHeaderForDate(panel, qtDate) {
    setQtPassageHeaderLoading(panel);
    try {
        const data = await loadQtBibleForDate(qtDate);
        applyQtPassageHeaderFromData(data, panel);
    } catch (e) {
        const shortEl = qf(panel, 'passageShort');
        const qtVerseRef = qf(panel, 'verseRef');
        const rawEl = qf(panel, 'verseRefRaw');
        if (rawEl) rawEl.textContent = '';
        if (shortEl) shortEl.textContent = '-';
        const line = '──────────';
        if (qtVerseRef) qtVerseRef.textContent = `본문 정보\n${line}\n불러오지 못했습니다`;
    }
}

function getQtVerseReferenceForPanel(panel) {
    const raw = qf(panel, 'verseRefRaw');
    const v = raw && raw.textContent ? String(raw.textContent).trim() : '';
    return v || null;
}

function canDeleteQtLogRow(row) {
    if (!row || !currentUserId) return false;
    const uid = Number(row.user_id);
    const role = currentUser && currentUser.role;
    return uid === Number(currentUserId) || role === 'admin' || role === 'moderator';
}

async function renderQtPanels() {
    const stack = document.getElementById('qtPanelsStack');
    const tpl = document.getElementById('qtPanelTemplate');
    if (!stack || !tpl || !tpl.content || !tpl.content.firstElementChild) return;
    stack.innerHTML = '';
    const dates = getQtPanelDatesOrdered();
    for (let i = 0; i < dates.length; i++) {
        const qtDate = dates[i];
        const node = tpl.content.firstElementChild.cloneNode(true);
        node.dataset.qtDate = qtDate;
        const row = qtLogsByDate[qtDate];
        if (row && row.id) node.dataset.qtLogId = String(row.id);
        else node.dataset.qtLogId = '';

        const dl = qf(node, 'dateLabel');
        if (dl) dl.textContent = qtDate;

        const wwrap = qf(node, 'worshipWrap');
        if (wwrap) wwrap.classList.add('hidden');

        const delBtn = qf(node, 'deleteLogBtn');
        if (delBtn) {
            if (row && row.id && canDeleteQtLogRow(row)) delBtn.classList.remove('hidden');
            else delBtn.classList.add('hidden');
        }

        stack.appendChild(node);
        await refreshQtPanelHeaderForDate(node, qtDate);
        hydrateQtPanelSavedState(node, qtDate);
    }

    const score =
        typeof lastKnownCombinedScore === 'number' && !Number.isNaN(lastKnownCombinedScore)
            ? lastKnownCombinedScore
            : 0;
    syncQtRewardSidebars(score);
}

function hydrateQtPanelSavedState(panel, qtDate) {
    const row = qtLogsByDate[qtDate];
    const applySrv = row && row.apply_text ? String(row.apply_text).trim() : '';
    const closeSrv = row && row.closing_prayer_text ? String(row.closing_prayer_text).trim() : '';

    const applyLocSub = localStorage.getItem(getQtStorageKey('apply_submitted', qtDate)) || '';
    const prayLocSub = localStorage.getItem(getQtStorageKey('prayer_submitted', qtDate)) || '';
    const applyDraft = localStorage.getItem(getQtStorageKey('apply', qtDate)) || '';
    const prayDraft = localStorage.getItem(getQtStorageKey('prayer', qtDate)) || '';

    const applyText = applySrv || applyLocSub;
    if (applyText) setQtSubmittedViewForPanel(panel, 'apply', applyText);
    else setQtComposeViewForPanel(panel, 'apply', applyDraft);

    const prayText = closeSrv || prayLocSub;
    if (prayText) setQtSubmittedViewForPanel(panel, 'prayer', prayText);
    else setQtComposeViewForPanel(panel, 'prayer', prayDraft);
}

async function showQtSectionForPanel(panel, sectionKey) {
    const qtPanelsWrap = document.getElementById('qtPanelsWrap');
    if (qtPanelsWrap) qtPanelsWrap.classList.remove('hidden');
    setQtHeaderButtonActive(true);

    const target = panel.querySelector(`[data-qt-section="${sectionKey}"]`);
    if (!target) return;
    const willOpen = target.classList.contains('hidden');
    target.classList.toggle('hidden', !willOpen);
    setQtSectionBtnActive(panel, sectionKey, willOpen);
    if (!willOpen) return;

    window.__activeQtDate = panelQtDate(panel);

    const qtDate = panelQtDate(panel);
    const scriptureEl = qf(panel, 'scriptureText');

    if (sectionKey === 'read') {
        if (scriptureEl) scriptureEl.textContent = '오늘의 QT 본문을 불러오는 중...';
        try {
            const data = await loadQtBibleForDate(qtDate);
            applyQtPassageHeaderFromData(data, panel);
            if (scriptureEl) scriptureEl.textContent = (data.scripture || '').trim();
        } catch (e) {
            if (scriptureEl) scriptureEl.textContent = '오늘의 QT 본문을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
            showToast('QT 본문 로딩 실패', 'error');
        }
        return;
    }

    if (sectionKey === 'apply') {
        const row = qtLogsByDate[qtDate];
        const srv = row && row.apply_text ? String(row.apply_text).trim() : '';
        const submitted = srv || localStorage.getItem(getQtStorageKey('apply_submitted', qtDate)) || '';
        if (submitted) setQtSubmittedViewForPanel(panel, 'apply', submitted);
        else {
            const saved = localStorage.getItem(getQtStorageKey('apply', qtDate)) || '';
            setQtComposeViewForPanel(panel, 'apply', saved);
        }
    }

    if (sectionKey === 'prayer2' || sectionKey === 'prayer') {
        const row = qtLogsByDate[qtDate];
        const srv = row && row.closing_prayer_text ? String(row.closing_prayer_text).trim() : '';
        const submitted = srv || localStorage.getItem(getQtStorageKey('prayer_submitted', qtDate)) || '';
        if (submitted) setQtSubmittedViewForPanel(panel, 'prayer', submitted);
        else {
            const saved = localStorage.getItem(getQtStorageKey('prayer', qtDate)) || '';
            setQtComposeViewForPanel(panel, 'prayer', saved);
        }
    }
}

async function showQtSection(sectionKey) {
    const d = normalizeQtDateKey(window.__activeQtDate || getTodayQtDateForApi());
    const panel = getQtPanelByDate(d);
    if (panel) await showQtSectionForPanel(panel, sectionKey);
}

async function sendQtApplyPostForPanel(panel) {
    if (!currentUserId) {
        showToast('로그인이 필요합니다.', 'error');
        showLoginModal();
        return;
    }
    const qtDate = panelQtDate(panel);
    const input = qf(panel, 'applyInput');
    const content = (input && input.value ? String(input.value) : '').trim();
    if (!content) {
        showToast('적용 내용을 입력해주세요.', 'error');
        return;
    }

    const verseRef = getQtVerseReferenceForPanel(panel);
    const row = qtLogsByDate[qtDate] || {};
    let applyPostId = row.apply_post_id ? Number(row.apply_post_id) : null;

    try {
        if (applyPostId) {
            await axios.put(`/api/posts/${applyPostId}`, {
                content,
                verse_reference: verseRef,
                background_color: '#FFFFFF'
            });
        } else {
            const pr = await axios.post('/api/posts', {
                user_id: currentUserId,
                content,
                verse_reference: verseRef,
                shared_post_id: null,
                is_prayer_request: 0,
                background_color: '#FFFFFF'
            });
            applyPostId = pr.data && pr.data.id ? Number(pr.data.id) : null;
        }

        const payload = {
            user_id: currentUserId,
            qt_date: qtDate,
            apply_text: content,
            verse_reference_raw: verseRef || (row.verse_reference_raw ? String(row.verse_reference_raw) : ''),
            apply_post_id: applyPostId
        };
        if (row.closing_prayer_text) payload.closing_prayer_text = row.closing_prayer_text;
        if (row.closing_post_id) payload.closing_post_id = row.closing_post_id;

        const up = await axios.post('/api/qt/logs/upsert', payload);
        if (up.data && up.data.log) mergeQtLogRowIntoCache(up.data.log);

        localStorage.setItem(getQtStorageKey('apply', qtDate), '');
        localStorage.setItem(getQtStorageKey('apply_submitted', qtDate), content);
        setQtSubmittedViewForPanel(panel, 'apply', content);

        const delBtn = qf(panel, 'deleteLogBtn');
        if (delBtn && up.data && up.data.log && up.data.log.id && canDeleteQtLogRow(up.data.log)) {
            delBtn.classList.remove('hidden');
            panel.dataset.qtLogId = String(up.data.log.id);
        }

        showToast('QT 적용이 저장·포스팅되었어요.', 'success');
        loadPosts();
    } catch (e) {
        console.error(e);
        showToast('저장에 실패했습니다.', 'error');
    }
}

async function sendQtPrayerPostForPanel(panel) {
    if (!currentUserId) {
        showToast('로그인이 필요합니다.', 'error');
        showLoginModal();
        return;
    }
    const qtDate = panelQtDate(panel);
    const input = qf(panel, 'prayerInput');
    const content = (input && input.value ? String(input.value) : '').trim();
    if (!content) {
        showToast('기도 제목을 입력해주세요.', 'error');
        return;
    }

    const verseRef = getQtVerseReferenceForPanel(panel);
    const row = qtLogsByDate[qtDate] || {};
    let closingPostId = row.closing_post_id ? Number(row.closing_post_id) : null;

    try {
        if (closingPostId) {
            await axios.put(`/api/posts/${closingPostId}`, {
                content,
                verse_reference: verseRef,
                background_color: '#FFFFFF'
            });
        } else {
            const pr = await axios.post('/api/posts', {
                user_id: currentUserId,
                content,
                verse_reference: verseRef,
                shared_post_id: null,
                is_prayer_request: 0,
                background_color: '#FFFFFF'
            });
            closingPostId = pr.data && pr.data.id ? Number(pr.data.id) : null;
        }

        const payload = {
            user_id: currentUserId,
            qt_date: qtDate,
            closing_prayer_text: content,
            verse_reference_raw: verseRef || row.verse_reference_raw || '',
            closing_post_id: closingPostId
        };
        if (row.apply_text) payload.apply_text = row.apply_text;
        if (row.apply_post_id) payload.apply_post_id = row.apply_post_id;

        const up = await axios.post('/api/qt/logs/upsert', payload);
        if (up.data && up.data.log) mergeQtLogRowIntoCache(up.data.log);

        localStorage.setItem(getQtStorageKey('prayer', qtDate), '');
        localStorage.setItem(getQtStorageKey('prayer_submitted', qtDate), content);
        setQtSubmittedViewForPanel(panel, 'prayer', content);

        const delBtn = qf(panel, 'deleteLogBtn');
        if (delBtn && up.data && up.data.log && up.data.log.id && canDeleteQtLogRow(up.data.log)) {
            delBtn.classList.remove('hidden');
            panel.dataset.qtLogId = String(up.data.log.id);
        }

        showToast('QT 마침기도가 저장·포스팅되었어요.', 'success');
        loadPosts();
    } catch (e) {
        console.error(e);
        showToast('저장에 실패했습니다.', 'error');
    }
}

async function sendQtApplyPost() {
    const d = normalizeQtDateKey(window.__activeQtDate || getTodayQtDateForApi());
    const panel = getQtPanelByDate(d);
    if (panel) await sendQtApplyPostForPanel(panel);
}

async function sendQtPrayerPost() {
    const d = normalizeQtDateKey(window.__activeQtDate || getTodayQtDateForApi());
    const panel = getQtPanelByDate(d);
    if (panel) await sendQtPrayerPostForPanel(panel);
}

function editQtApplyForPanel(panel) {
    const qtDate = panelQtDate(panel);
    const row = qtLogsByDate[qtDate] || {};
    const submitted =
        (row.apply_text ? String(row.apply_text) : '') ||
        localStorage.getItem(getQtStorageKey('apply_submitted', qtDate)) ||
        '';
    localStorage.removeItem(getQtStorageKey('apply_submitted', qtDate));
    setQtComposeViewForPanel(panel, 'apply', submitted);
}

function editQtPrayerForPanel(panel) {
    const qtDate = panelQtDate(panel);
    const row = qtLogsByDate[qtDate] || {};
    const submitted =
        (row.closing_prayer_text ? String(row.closing_prayer_text) : '') ||
        localStorage.getItem(getQtStorageKey('prayer_submitted', qtDate)) ||
        '';
    localStorage.removeItem(getQtStorageKey('prayer_submitted', qtDate));
    setQtComposeViewForPanel(panel, 'prayer', submitted);
}

function editQtApply() {
    const d = normalizeQtDateKey(window.__activeQtDate || getTodayQtDateForApi());
    const panel = getQtPanelByDate(d);
    if (panel) editQtApplyForPanel(panel);
}

function editQtPrayer() {
    const d = normalizeQtDateKey(window.__activeQtDate || getTodayQtDateForApi());
    const panel = getQtPanelByDate(d);
    if (panel) editQtPrayerForPanel(panel);
}

async function deleteQtLogForPanel(panel) {
    const id = String(panel.dataset.qtLogId || '').trim();
    const qtDate = panelQtDate(panel);
    if (!id || !currentUserId || !qtDate) return;
    if (!confirm('저장된 QT 로그를 삭제할까요? (다이어리에서 제거됩니다)')) return;
    try {
        await axios.post('/api/qt/logs/remove', {
            id: Number(id),
            actor_user_id: currentUserId
        });
        purgeQtLogFromClientCache(id, qtDate);
        localStorage.removeItem(getQtStorageKey('apply', qtDate));
        localStorage.removeItem(getQtStorageKey('apply_submitted', qtDate));
        localStorage.removeItem(getQtStorageKey('prayer', qtDate));
        localStorage.removeItem(getQtStorageKey('prayer_submitted', qtDate));
        await fetchQtLogsCache();
        showToast('QT 로그를 삭제했습니다.', 'success');
        await renderQtPanels();
    } catch (e) {
        console.error(e);
        showToast('삭제에 실패했습니다.', 'error');
    }
}

// ── QT 찬양 플레이어 ──────────────────────────────────────────────
// YT 플레이어는 전역 div(#qtWorshipYtGlobal)에 한 번만 생성 — iframe DOM 이동 금지.
// 여러 패널이 열려도 플레이어는 하나이고, UI 패널만 한 번에 하나만 열린다.
const WORSHIP_VIDEO_IDS = [
    '5JvEYRcuJNE',  // 첫 번째 찬양
];
let qtWorshipPlayer = null;   // YT.Player (전역 단일 인스턴스)
let qtWorshipPlayerReady = false;
let qtWorshipState = { muted: false, volume: 80, playing: false };

function getWorshipVideoId() {
    return WORSHIP_VIDEO_IDS[0];
}

// 아이콘을 재생 상태에 따라 동기화 (열려 있는 모든 패널)
function syncWorshipPlayIcons() {
    document.querySelectorAll('.qt-panel-instance [data-qt-field="worshipPlayIcon"]').forEach(ic => {
        ic.classList.toggle('fa-play', !qtWorshipState.playing);
        ic.classList.toggle('fa-pause', qtWorshipState.playing);
    });
}

// 전역 마운트에 플레이어를 한 번만 생성
function ensureQtWorshipPlayer() {
    if (qtWorshipPlayer) return;
    if (!isYoutubeIframeApiReady()) return;
    const mount = document.getElementById('qtWorshipYtGlobal');
    if (!mount) return;
    const div = document.createElement('div');
    mount.appendChild(div);
    qtWorshipPlayer = new YT.Player(div, {
        height: '1',
        width: '1',
        videoId: getWorshipVideoId(),
        playerVars: { playsinline: 1, rel: 0, controls: 0, autoplay: 0 },
        events: {
            onReady(e) {
                qtWorshipPlayerReady = true;
                e.target.setVolume(qtWorshipState.volume);
                if (qtWorshipState.muted) e.target.mute();
            },
            onStateChange(e) {
                const PS = (typeof YT !== 'undefined' && YT.PlayerState)
                    ? YT.PlayerState : { PLAYING: 1 };
                qtWorshipState.playing = (e.data === PS.PLAYING);
                syncWorshipPlayIcons();
            }
        }
    });
}

// 다른 모든 패널의 찬양 UI를 닫는다 (단일 UI 원칙)
function closeAllWorshipWraps(exceptPanel) {
    document.querySelectorAll('.qt-panel-instance').forEach(p => {
        if (p === exceptPanel) return;
        const wrap = qf(p, 'worshipWrap');
        if (wrap) wrap.classList.add('hidden');
    });
}

function openQtWorshipForPanel(panel) {
    const wrap = qf(panel, 'worshipWrap');
    if (!wrap) return;
    closeAllWorshipWraps(panel);   // 다른 패널 찬양 UI 닫기
    wrap.classList.remove('hidden');
    ensureQtWorshipPlayer();       // 플레이어가 없으면 생성 (전역 마운트에)
    // 볼륨·음소거 UI를 현재 상태로 동기화
    const volBar = qf(panel, 'worshipVolumeBar');
    if (volBar) volBar.value = qtWorshipState.volume;
    const volLabel = qf(panel, 'worshipVolumeLabel');
    if (volLabel) volLabel.textContent = `${qtWorshipState.volume}%`;
    const muteIc = qf(panel, 'worshipMuteIcon');
    if (muteIc) {
        muteIc.classList.toggle('fa-volume-up', !qtWorshipState.muted);
        muteIc.classList.toggle('fa-volume-mute', qtWorshipState.muted);
    }
    syncWorshipPlayIcons();
}

function closeQtWorshipForPanel(panel) {
    const wrap = qf(panel, 'worshipWrap');
    if (!wrap) return;
    wrap.classList.add('hidden');
    if (qtWorshipPlayer && qtWorshipState.playing) {
        try { qtWorshipPlayer.pauseVideo(); } catch (e) {}
    }
}

function toggleQtWorshipPlay() {
    ensureQtWorshipPlayer();
    if (!qtWorshipPlayer || !qtWorshipPlayerReady) return;
    try {
        if (qtWorshipState.playing) qtWorshipPlayer.pauseVideo();
        else qtWorshipPlayer.playVideo();
    } catch (e) { console.warn('worship play error', e); }
}

function toggleQtWorshipMute() {
    qtWorshipState.muted = !qtWorshipState.muted;
    if (qtWorshipPlayer) {
        try {
            qtWorshipState.muted ? qtWorshipPlayer.mute() : qtWorshipPlayer.unMute();
        } catch (e) {}
    }
    document.querySelectorAll('.qt-panel-instance [data-qt-field="worshipMuteIcon"]').forEach(ic => {
        ic.classList.toggle('fa-volume-up', !qtWorshipState.muted);
        ic.classList.toggle('fa-volume-mute', qtWorshipState.muted);
    });
}

function setQtWorshipVolume(vol) {
    const v = Math.max(0, Math.min(100, Number(vol)));
    qtWorshipState.volume = v;
    if (qtWorshipPlayer) {
        try { qtWorshipPlayer.setVolume(v); } catch (e) {}
        if (v > 0 && qtWorshipState.muted) {
            qtWorshipState.muted = false;
            try { qtWorshipPlayer.unMute(); } catch (e) {}
        }
    }
    document.querySelectorAll('.qt-panel-instance [data-qt-field="worshipVolumeLabel"]').forEach(el => {
        el.textContent = `${v}%`;
    });
    document.querySelectorAll('.qt-panel-instance [data-qt-field="worshipMuteIcon"]').forEach(ic => {
        ic.classList.toggle('fa-volume-up', v > 0);
        ic.classList.toggle('fa-volume-mute', v === 0);
    });
}

function setQtWorshipVolumeFromPanel(el) {
    if (!el) return;
    setQtWorshipVolume(el.value);
}

function showQtAlarmModal() {
    // Alarm modal markup doesn't exist in current HTML snapshot.
    showToast('QT 예약(알람) 기능은 준비 중입니다.', 'info');
}

function showQtInviteModal() {
    const modal = document.getElementById('qtInviteModal');
    if (!modal) { showToast('QT 초대 기능은 준비 중입니다.', 'info'); return; }
    const input = document.getElementById('qtInviteEmail');
    if (input) { input.value = ''; input.focus(); }
    const msg = document.getElementById('qtInviteMsg');
    if (msg) { msg.classList.add('hidden'); msg.textContent = ''; }
    modal.classList.remove('hidden');
}
function hideQtInviteModal() {
    const modal = document.getElementById('qtInviteModal');
    if (modal) modal.classList.add('hidden');
}
async function sendQtInvite() {
    const input = document.getElementById('qtInviteEmail');
    const btn = document.getElementById('qtInviteBtn');
    const msg = document.getElementById('qtInviteMsg');
    const email = (input && input.value || '').trim();
    if (!email) { showToast('이메일을 입력해주세요.', 'error'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('올바른 이메일 주소를 입력해주세요.', 'error'); return; }
    if (!currentUserId) { showToast('로그인 후 이용해주세요.', 'error'); return; }
    if (btn) { btn.disabled = true; btn.textContent = '발송 중...'; }
    if (msg) { msg.classList.add('hidden'); msg.textContent = ''; }
    try {
        const res = await axios.post('/api/qt-invite', { email, inviterUserId: currentUserId });
        if (res.data.success) {
            showToast(res.data.message || '초대 메일을 발송했습니다.', 'success');
            if (input) input.value = '';
            if (msg) { msg.textContent = '초대 메일이 발송되었습니다.'; msg.classList.remove('hidden', 'text-red-600'); msg.classList.add('text-green-600'); }
            hideQtInviteModal();
        } else {
            showToast(res.data.error || '발송에 실패했습니다.', 'error');
            if (msg) { msg.textContent = res.data.error || ''; msg.classList.remove('hidden', 'text-green-600'); msg.classList.add('text-red-600'); }
        }
    } catch (e) {
        const err = e.response?.data?.error || '이메일 발송에 실패했습니다.';
        showToast(err, 'error');
        if (msg) { msg.textContent = err; msg.classList.remove('hidden', 'text-green-600'); msg.classList.add('text-red-600'); }
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '초대 보내기'; }
    }
}

// CROSSfriends 지인 초대 (친구목록 패널)
function showFriendInviteModal() {
    const modal = document.getElementById('friendInviteModal');
    if (!modal) { showToast('지인 초대 기능은 준비 중입니다.', 'info'); return; }
    const input = document.getElementById('friendInviteEmail');
    if (input) { input.value = ''; input.focus(); }
    const msg = document.getElementById('friendInviteMsg');
    if (msg) { msg.classList.add('hidden'); msg.textContent = ''; }
    modal.classList.remove('hidden');
}
function hideFriendInviteModal() {
    const modal = document.getElementById('friendInviteModal');
    if (modal) modal.classList.add('hidden');
}
async function sendFriendInvite() {
    const input = document.getElementById('friendInviteEmail');
    const btn = document.getElementById('friendInviteBtn');
    const msg = document.getElementById('friendInviteMsg');
    const email = (input && input.value || '').trim();
    if (!email) { showToast('이메일을 입력해주세요.', 'error'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('올바른 이메일 주소를 입력해주세요.', 'error'); return; }
    if (!currentUserId) { showToast('로그인 후 이용해주세요.', 'error'); return; }
    if (btn) { btn.disabled = true; btn.textContent = '발송 중...'; }
    if (msg) { msg.classList.add('hidden'); msg.textContent = ''; }
    try {
        const res = await axios.post('/api/invite', { email, inviterUserId: currentUserId });
        if (res.data.success) {
            showToast(res.data.message || '초대 메일을 발송했습니다.', 'success');
            if (input) input.value = '';
            if (msg) { msg.textContent = '초대 메일이 발송되었습니다.'; msg.classList.remove('hidden', 'text-red-600'); msg.classList.add('text-green-600'); }
            hideFriendInviteModal();
        } else {
            showToast(res.data.error || '발송에 실패했습니다.', 'error');
            if (msg) { msg.textContent = res.data.error || ''; msg.classList.remove('hidden', 'text-green-600'); msg.classList.add('text-red-600'); }
        }
    } catch (e) {
        const err = e.response?.data?.error || '이메일 발송에 실패했습니다.';
        showToast(err, 'error');
        if (msg) { msg.textContent = err; msg.classList.remove('hidden', 'text-green-600'); msg.classList.add('text-red-600'); }
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '초대 보내기'; }
    }
}

function saveQtApply() {
    const d = normalizeQtDateKey(window.__activeQtDate || getTodayQtDateForApi());
    const panel = getQtPanelByDate(d);
    const input = panel && qf(panel, 'applyInput');
    if (!input) return;
    const val = input.value.trim();
    if (!val) {
        showToast('적용 내용을 입력해주세요.', 'error');
        return;
    }
    localStorage.setItem(getQtStorageKey('apply', d), val);
    showToast('적용 내용을 저장했어요.', 'success');
}

function saveQtPrayer() {
    const d = normalizeQtDateKey(window.__activeQtDate || getTodayQtDateForApi());
    const panel = getQtPanelByDate(d);
    const input = panel && qf(panel, 'prayerInput');
    if (!input) return;
    const val = input.value.trim();
    if (!val) {
        showToast('기도 제목을 입력해주세요.', 'error');
        return;
    }
    localStorage.setItem(getQtStorageKey('prayer', d), val);
    showToast('마침기도 내용을 저장했어요.', 'success');
}

// Login handler
async function handleLogin() {
    const email = document.getElementById('loginEmail').value;
    const password = (document.getElementById('loginPassword') || {}).value;

    if (!email) {
        alert('이메일을 입력해주세요.');
        return;
    }
    if (!password) {
        alert('비밀번호를 입력해주세요.');
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
        const response = await axios.post('/api/login', {
            email: trimmedEmail,
            password: password
        });
        
        if (response.data.user) {
            const user = response.data.user;
            console.log('로그인 성공:', user);
            
            currentUserId = user.id != null ? Number(user.id) : null;
            currentUser = user;
            resetLastKnownCombinedScore();

            // Save to localStorage
            localStorage.setItem('currentUserId', String(user.id));
            localStorage.setItem('currentUserEmail', user.email);
            persistLoginCredentialsIfRequested(trimmedEmail, password);

            // Save email to history
            saveEmailToHistory(trimmedEmail);
            
            // Load user scores from API
            await loadUserScores();
            
            // Load friends list
            await loadFriendsList();
            
            // Load notifications (don't mark as read yet)
            await loadNotifications(false);
            
            // Start notification polling
            startNotificationPolling();
            
            updateAuthUI();
            hideLoginModal();
            loadPosts();
            await showLoginRewardCelebrationModal(user);
        }
    } catch (error) {
        console.error('Login error:', error);
        
        if (error.response && error.response.status === 404) {
            // User not found - redirect to signup
            alert('가입되지 않은 이메일입니다. 회원가입을 먼저 해주세요.');
        } else if (error.response && error.response.data && error.response.data.error) {
            alert(error.response.data.error);
        } else {
            alert('로그인에 실패했습니다. 다시 시도해주세요.');
        }
    }
}

function showForgotPasswordModal() {
    hideLoginModal();
    const modal = document.getElementById('forgotPasswordModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add(...loginModalLayoutClasses);
    }
}

function hideForgotPasswordModal() {
    const modal = document.getElementById('forgotPasswordModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove(...loginModalLayoutClasses);
    }
}

async function requestPasswordReset() {
    // 프로덕션과 UI는 맞추되, 로컬에서는 별도 메일 발송이 없을 수 있습니다.
    const email = (document.getElementById('forgotPasswordEmail') || {}).value;
    if (!email) {
        alert('이메일을 입력해주세요.');
        return;
    }
    alert('비밀번호 초기화 기능은 준비 중입니다. 관리자에게 문의해주세요.');
}

// Logout
function logout() {
    currentUserId = null;
    currentUser = null;
    resetLastKnownCombinedScore();

    // Reset all scores
    typingScore = 0;
    videoScore = 0;
    prayerScore = 0;
    activityScore = 0;
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
    
    // Stop notification polling
    stopNotificationPolling();
    
    filterUserId = null;

    // Reset UI
    updateAuthUI();
    updateTypingScoreDisplay();

    hideUserProfileCover();
    const profileView = document.getElementById('profileView');
    if (profileView) profileView.classList.add('hidden');

    const newPostCard = document.getElementById('newPostCard');
    if (newPostCard) newPostCard.classList.remove('hidden');

    const qtPanelsWrap = document.getElementById('qtPanelsWrap');
    if (qtPanelsWrap) qtPanelsWrap.classList.add('hidden');

    const postsFeed = document.getElementById('postsFeed');
    if (postsFeed) postsFeed.innerHTML = '';

    if (typeof updatePostIndicators === 'function') {
        updatePostIndicators();
    }

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
}

// Go to admin panel
function goToAdmin() {
    window.location.href = '/admin';
}

// Update UI based on auth state
function updateAuthUI() {
    const authButtons = document.getElementById('authButtons');
    const authButtonsPC = document.getElementById('authButtonsPC');
    const userMenuLegacy = document.getElementById('userMenu');
    const userMenuMobile = document.getElementById('userMenuMobile');
    const userMenuCenterPC = document.getElementById('userMenuCenterPC');
    const userMenuRightPC = document.getElementById('userMenuRightPC');
    const userName = document.getElementById('userName');
    const userNameMobile = document.getElementById('userNameMobile');
    const userAvatarContainer = document.getElementById('userAvatarContainer');
    const userAvatarContainerMobile = document.getElementById('userAvatarContainerMobile');
    const newPostAvatar = document.getElementById('newPostAvatar');
    const adminPanelBtn = document.getElementById('adminPanelBtn');
    const adminPanelBtnMobile = document.getElementById('adminPanelBtnMobile');
    const typingToggleBtn = document.getElementById('typingToggleBtn');
    const typingLoginOverlay = document.getElementById('typingLoginOverlay');
    const videoLoginOverlay = document.getElementById('videoLoginOverlay');

    function setAuthVisible(visible) {
        if (authButtons) {
            authButtons.classList.toggle('hidden', !visible);
        }
        if (authButtonsPC) {
            authButtonsPC.classList.toggle('hidden', !visible);
        }
    }

    function setLoggedInMenusVisible(visible) {
        if (userMenuLegacy) {
            userMenuLegacy.classList.toggle('hidden', !visible);
        }
        if (userMenuMobile) {
            userMenuMobile.classList.toggle('hidden', !visible);
        }
        if (userMenuCenterPC) {
            userMenuCenterPC.classList.toggle('hidden', !visible);
        }
        if (userMenuRightPC) {
            userMenuRightPC.classList.toggle('hidden', !visible);
        }
    }

    if (currentUserId) {
        setAuthVisible(false);
        setLoggedInMenusVisible(true);

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

        // Update user name (PC + mobile)
        if (userName) userName.textContent = currentUser.name;
        if (userNameMobile) userNameMobile.textContent = currentUser.name;

        // Show admin panel button if user is admin
        const isAdmin = currentUser.role === 'admin';
        if (adminPanelBtn) {
            adminPanelBtn.classList.toggle('hidden', !isAdmin);
        }
        if (adminPanelBtnMobile) {
            adminPanelBtnMobile.classList.toggle('hidden', !isAdmin);
        }

        syncQtSimButtonTitles();

        // Save to localStorage for admin panel access
        localStorage.setItem('currentUserId', currentUserId);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));

        const applyAvatarTo = (container) => {
            if (!container) return;
            if (currentUser.role === 'admin') {
                container.innerHTML = '<i class="fas fa-crown text-yellow-400 text-2xl"></i>';
                return;
            }
            if (currentUser.avatar_url) {
                const img = document.createElement('img');
                img.src = toCanonicalSiteUrl(currentUser.avatar_url);
                img.alt = 'Profile';
                img.className = 'w-full h-full object-cover';
                img.onerror = function() {
                    container.innerHTML = '<i class="fas fa-user"></i>';
                };
                container.innerHTML = '';
                container.appendChild(img);
            } else {
                container.innerHTML = '<i class="fas fa-user"></i>';
            }
        };

        applyAvatarTo(userAvatarContainer);
        applyAvatarTo(userAvatarContainerMobile);

        if (newPostAvatar) {
            if (currentUser.role === 'admin') {
                newPostAvatar.innerHTML = '<i class="fas fa-crown text-yellow-400 text-2xl"></i>';
            } else if (currentUser.avatar_url) {
                const postImg = document.createElement('img');
                postImg.src = toCanonicalSiteUrl(currentUser.avatar_url);
                postImg.alt = 'Profile';
                postImg.className = 'w-full h-full object-cover';
                postImg.onerror = function() {
                    newPostAvatar.innerHTML = '<i class="fas fa-user"></i>';
                };
                newPostAvatar.innerHTML = '';
                newPostAvatar.appendChild(postImg);
            } else {
                newPostAvatar.innerHTML = '<i class="fas fa-user"></i>';
            }
        }

        // Add role badge (skip for admin since they have crown icon as avatar)
        if (currentUser.role !== 'admin') {
            if (userAvatarContainer && userAvatarContainer.parentElement) {
                addRoleBadge(userAvatarContainer.parentElement, currentUser.role);
            }
            if (userAvatarContainerMobile && userAvatarContainerMobile.parentElement) {
                addRoleBadge(userAvatarContainerMobile.parentElement, currentUser.role);
            }
            if (newPostAvatar && newPostAvatar.parentElement) {
                addRoleBadge(newPostAvatar.parentElement, currentUser.role);
            }
        }
    } else {
        setAuthVisible(true);
        setLoggedInMenusVisible(false);

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
        if (userAvatarContainerMobile) {
            userAvatarContainerMobile.innerHTML = '<i class="fas fa-user"></i>';
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

        checkSermonReward();
        syncQtRewardSidebars(0);
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

    const contentEl = document.getElementById('newPostContent');
    const imageInputEl = document.getElementById('postImageFile');
    const videoInputEl = document.getElementById('postVideoFile');
    if (!contentEl || !imageInputEl || !videoInputEl) {
        showToast('포스팅 입력 요소를 찾지 못했습니다. 화면을 새로고침해 주세요.', 'error');
        return;
    }

    const content = String(contentEl.value || '').trim();
    const imageFiles = selectedPostImages.length > 0
        ? selectedPostImages
            .slice()
            .sort((a, b) => a.seq - b.seq)
            .map((item) => item.file)
            .slice(0, 4)
        : (imageInputEl.files[0] ? [imageInputEl.files[0]] : []);
    const videoFile = videoInputEl.files[0];
    const visibilityEl = document.getElementById('newPostVisibility');
    const visibilityScope = visibilityEl && visibilityEl.value === 'friends' ? 'friends' : 'public';
    
    // Get shared post ID if exists
    const sharedPostPreview = document.getElementById('sharedPostPreview');
    const sharedPostId = sharedPostPreview.dataset.sharedPostId || null;

    if (!content && imageFiles.length === 0 && !videoFile && !sharedPostId) {
        alert('내용, 사진, 동영상 또는 공유할 포스팅을 입력해주세요.');
        return;
    }

    // Disable post button
    const postBtn = document.getElementById('createPostBtn');
    const originalBtnText = postBtn ? postBtn.innerHTML : '';
    if (postBtn) {
        postBtn.disabled = true;
        postBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>업로드 중...';
        postBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }

    let response;
    try {
        // 1. Create post with shared_post_id and background_color
        response = await axios.post('/api/posts', {
            user_id: currentUserId,
            content: content || '',
            verse_reference: null,
            shared_post_id: sharedPostId,
            is_prayer_request: 0,
            background_color: selectedBackgroundColor,
            visibility_scope: visibilityScope
        });
    } catch (error) {
        console.error('Error creating post (API):', error);
        const message = error?.response?.data?.error || '게시물 작성에 실패했습니다.';
        showToast(message, 'error');
        if (postBtn) {
            postBtn.disabled = false;
            postBtn.innerHTML = originalBtnText;
            postBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
        return;
    }

    try {
        const postId = response.data.id;

        // 백엔드에서 업데이트된 점수를 받아 동기화
        if (response.data.prayer_score !== undefined) {
            prayerScore = response.data.prayer_score;
            updateTypingScoreDisplay();
            showToastWithColor('중보 포스팅 작성! 기도 점수 +10점', selectedBackgroundColor);
        }
        
        if (response.data.scripture_score !== undefined) {
            typingScore = response.data.scripture_score;
            updateTypingScoreDisplay();
            showToastWithColor('말씀 포스팅 작성! 성경 점수 +10점', selectedBackgroundColor);
        }
        
        if (response.data.activity_score !== undefined) {
            activityScore = response.data.activity_score;
            updateTypingScoreDisplay();
            showToastWithColor('포스팅 작성! 활동 점수 +10점', selectedBackgroundColor);
        }

        // 2. Upload images (최대 4장)
        if (imageFiles.length > 0) {
            for (let i = 0; i < imageFiles.length; i++) {
                const formData = new FormData();
                formData.append('image', imageFiles[i]);
                formData.append('order', String(i));
                try {
                    await axios.post('/api/posts/' + postId + '/image', formData);
                } catch (uploadError) {
                    console.error('Image upload error:', uploadError);
                }
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

        contentEl.value = '';
        contentEl.style.height = 'auto';
        removePostImage();
        removePostVideo();
        removeSharedPost(); // Clear shared post preview
        resetBackgroundColor(); // Clear selected background color
        
        // Re-enable button
        if (postBtn) {
            postBtn.disabled = false;
            postBtn.innerHTML = originalBtnText;
            postBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }

        // 포스팅 성공 후에는 항상 노멀 메인 피드에서 즉시 확인되도록 복귀
        if (filterUserId) {
            filterUserId = null;
        }
        const profileView = document.getElementById('profileView');
        if (profileView) profileView.classList.add('hidden');
        const postsFeed = document.getElementById('postsFeed');
        if (postsFeed) postsFeed.classList.remove('hidden');
        const postsFeedWrapper = document.getElementById('postsFeedWrapper');
        if (postsFeedWrapper) postsFeedWrapper.classList.remove('hidden');
        if (typeof setSocialHeaderButtonActive === 'function') setSocialHeaderButtonActive('friends');

        await loadPosts();
        const centerFeedColumn = document.getElementById('centerFeedColumn');
        if (centerFeedColumn) centerFeedColumn.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
        console.error('Post created but post-processing failed:', error);

        // Re-enable button
        if (postBtn) {
            postBtn.disabled = false;
            postBtn.innerHTML = originalBtnText;
            postBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
        try {
            await loadPosts();
        } catch (_) {}
    }
}

// Preview post image
function previewPostImage(event) {
    const files = Array.from((event && event.target && event.target.files) ? event.target.files : []);
    if (!files.length) return;

    const validFiles = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('image/')) {
            showToast('이미지 파일만 업로드할 수 있습니다.', 'error');
            continue;
        }
        if (file.size > 10 * 1024 * 1024) {
            showToast('파일 크기는 10MB를 초과할 수 없습니다.', 'error');
            continue;
        }
        validFiles.push(file);
    }

    const remaining = Math.max(0, 4 - selectedPostImages.length);
    if (remaining <= 0) {
        showToast('사진은 최대 4장까지 첨부할 수 있습니다.', 'warning');
        if (event && event.target) event.target.value = '';
        return;
    }

    const toAdd = validFiles.slice(0, remaining).map((file) => ({
        file,
        seq: ++selectedPostImageSeq
    }));
    selectedPostImages = selectedPostImages.concat(toAdd);
    renderPostImagePreviews();

    if (validFiles.length > remaining) {
        showToast('사진은 최대 4장까지만 첨부됩니다.', 'info');
    }

    if (event && event.target) event.target.value = '';
}

// Remove post image
function removePostImage() {
    const fileEl = document.getElementById('postImageFile');
    const preview = document.getElementById('postImagePreview');
    const container = document.getElementById('postImagePreviewContainer');
    const listEl = document.getElementById('postImagePreviewList');
    const countEl = document.getElementById('postImagePreviewCount');
    selectedPostImages = [];
    selectedPostImageSeq = 0;
    if (fileEl) fileEl.value = '';
    if (preview) preview.src = '';
    if (listEl) listEl.innerHTML = '';
    if (countEl) countEl.textContent = '0/4';
    if (container) container.classList.add('hidden');
}

function removePostImageAt(index) {
    const ordered = selectedPostImages.slice().sort((a, b) => a.seq - b.seq);
    if (index < 0 || index >= ordered.length) return;
    const targetSeq = ordered[index].seq;
    selectedPostImages = selectedPostImages.filter((item) => item.seq !== targetSeq);
    renderPostImagePreviews();
}

function renderPostImagePreviews() {
    const container = document.getElementById('postImagePreviewContainer');
    const listEl = document.getElementById('postImagePreviewList');
    const countEl = document.getElementById('postImagePreviewCount');
    if (!container || !listEl || !countEl) return;

    const ordered = selectedPostImages.slice().sort((a, b) => a.seq - b.seq);
    countEl.textContent = `${ordered.length}/4`;

    if (!ordered.length) {
        listEl.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    listEl.innerHTML = ordered.map((item, idx) => {
        const url = URL.createObjectURL(item.file);
        return `
            <div class="inline-block mr-2 mb-2 relative">
                <img src="${url}" alt="preview-${idx}" class="w-20 h-20 rounded-lg object-cover border border-gray-200" />
                <span class="absolute left-1 top-1 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">${idx + 1}</span>
                <button type="button" onclick="removePostImageAt(${idx})" class="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] hover:bg-red-600 transition">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    }).join('');
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
        
        // API 응답에서 업데이트된 점수를 받아 동기화
        if (response.data.scripture_score !== undefined) {
            typingScore = response.data.scripture_score;
            updateTypingScoreDisplay();
            if (liked) {
                showToast('아멘! 성경 점수 +1점', 'success');
            } else {
                showToast('취소: 성경 점수 -1점', 'warning');
            }
        } else if (response.data.activity_score !== undefined) {
            activityScore = response.data.activity_score;
            updateTypingScoreDisplay();
            if (liked) {
                // 배경색에 따라 다른 메시지 표시
                const messages = {
                    '#F5D4B3': '샬롬! 활동 점수 +1점',
                    '#B3EDD8': '응원합니다! 활동 점수 +1점',
                    '#C4E5F8': '할렐루야! 활동 점수 +1점',
                    '#E2DBFB': '우리는 하나! 활동 점수 +1점',
                    '#FFFFFF': '좋아요! 활동 점수 +1점'
                };
                showToast(messages[backgroundColor] || '좋아요! 활동 점수 +1점', 'success');
            } else {
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
                        ? `<img src="${toCanonicalSiteUrl(comment.user_avatar)}" alt="Profile" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=&quot;fas fa-user&quot;></i>'" />`
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
                                <p class="font-semibold text-sm text-gray-800 cursor-pointer hover:text-blue-600 transition inline-block" onclick="filterByUser(${comment.user_id}, \`${comment.user_name}\`)" title="클릭하여 ${comment.user_name} 님의 포스팅만 보기">${comment.user_name}</p>
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
                    <div class="flex space-x-2 mt-3 items-end">
                        <textarea 
                            id="comment-input-${postId}"
                            rows="1"
                            placeholder="댓글을 작성하세요..."
                            class="flex-1 p-2 border rounded-lg text-sm resize-none overflow-hidden leading-relaxed focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        ></textarea>
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
                commentAutoGrow(inputField);
                inputField.addEventListener('input', () => commentAutoGrow(inputField));
                inputField.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        createComment(postId);
                    }
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
                ? `<img src="${toCanonicalSiteUrl(post.user_avatar)}" alt="Profile" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=&quot;fas fa-user&quot;></i>'" />`
                : '<i class="fas fa-user"></i>';
        
        // Role badge for shared post (skip admin badge since they have crown icon as avatar)
        let roleBadgeHtml = '';
        if (post.user_role === 'moderator') {
            roleBadgeHtml = '<div class="moderator-badge" title="운영자"><i class="fas fa-shield-alt"></i></div>';
        }
        
        // Verse reference removed - not a feature
        const verseHtml = '';
        
        const sharePreviewImageUrls = parsePostImageUrls(post.image_url);
        const imageHtml = renderOrderedImageLayout(sharePreviewImageUrls, 'max-h-48', 'mt-2');
        
        const videoHtml = post.video_url ? `
            <div class="mt-2">
                <video controls class="w-full rounded-lg max-h-48" controlsList="nodownload">
                    <source src="${toCanonicalSiteUrl(post.video_url)}" type="video/mp4">
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
                        ? `<img src="${toCanonicalSiteUrl(comment.user_avatar)}" alt="Profile" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=&quot;fas fa-user&quot;></i>'" />`
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
                                    <p class="font-semibold text-sm text-gray-800 cursor-pointer hover:text-blue-600 transition" onclick="filterByUser(${comment.user_id}, \`${comment.user_name}\`)" title="클릭하여 ${comment.user_name} 님의 포스팅만 보기">${comment.user_name}</p>
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
                    <div class="flex space-x-2 mt-3 items-end">
                        <textarea 
                            id="comment-input-${postId}"
                            rows="1"
                            placeholder="댓글을 작성하세요..."
                            class="flex-1 p-2 border rounded-lg text-sm resize-none overflow-hidden leading-relaxed focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        ></textarea>
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
                commentAutoGrow(inputField);
                inputField.addEventListener('input', () => commentAutoGrow(inputField));
                inputField.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        createComment(postId);
                    }
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
    const content = String((input && input.value) || '').trim();

    if (!content) {
        alert('댓글 내용을 입력해주세요.');
        return;
    }

    try {
        const response = await axios.post(`/api/posts/${postId}/comments`, {
            user_id: currentUserId,
            content
        });
        
        // 댓글 작성 시 점수 업데이트 (카테고리별로 다름)
        if (response.data.updated_scores) {
            const scores = response.data.updated_scores;
            
            // 기도 점수 업데이트
            if (scores.prayer_score !== undefined) {
                prayerScore = scores.prayer_score;
                updateTypingScoreDisplay();
                const inputElement = document.getElementById(`comment-input-${postId}`);
                if (inputElement) {
                    showFloatingScore(inputElement, '+5');
                }
                showToast('댓글 작성! 기도 점수 +5점', 'success');
            }
            // 성경 점수 업데이트
            else if (scores.scripture_score !== undefined) {
                scriptureScore = scores.scripture_score;
                updateTypingScoreDisplay();
                const inputElement = document.getElementById(`comment-input-${postId}`);
                if (inputElement) {
                    showFloatingScore(inputElement, '+5');
                }
                showToast('댓글 작성! 성경 점수 +5점', 'success');
            }
            // 활동 점수 업데이트
            else if (scores.activity_score !== undefined) {
                activityScore = scores.activity_score;
                updateTypingScoreDisplay();
                const inputElement = document.getElementById(`comment-input-${postId}`);
                if (inputElement) {
                    showFloatingScore(inputElement, '+5');
                }
                showToast('댓글 작성! 활동 점수 +5점', 'success');
            }
        }
        
        input.value = '';
        input.style.height = 'auto';
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
        const feed = document.getElementById('postsFeed');
        if (!currentUserId && !filterUserId) {
            if (feed) feed.innerHTML = '';
            return;
        }

        // Build query parameters - ALWAYS use current filterUserId value
        let queryParams = `user_id=${currentUserId || 0}`;
        if (filterUserId) {
            queryParams += `&filter_user_id=${filterUserId}`;
            console.log('🔍 Filtering posts by user ID:', filterUserId);
        } else {
            console.log('🔍 Loading all posts (no filter)');
        }

        console.log('🔍 Full query:', queryParams);
        const response = await axios.get(`/api/posts?${queryParams}`);
        const posts = response.data.posts;
        
        let postsHtml = '';
        posts.forEach(post => {
            console.log('🔍 Post ID:', post.id, 'is_prayer_request:', post.is_prayer_request, 'type:', typeof post.is_prayer_request);
            const isLiked = post.is_liked > 0;
            
            // Avatar HTML - Admin shows crown icon
            const avatarHtml = post.user_role === 'admin'
                ? '<i class="fas fa-crown text-yellow-400 text-2xl"></i>'
                : post.user_avatar 
                    ? `<img src="${toCanonicalSiteUrl(post.user_avatar)}" alt="Profile" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=&quot;fas fa-user&quot;></i>'" />`
                    : '<i class="fas fa-user"></i>';
            
            // Role badge HTML (skip admin badge since they have crown icon as avatar)
            let roleBadgeHtml = '';
            if (post.user_role === 'moderator') {
                roleBadgeHtml = '<div class="moderator-badge" title="운영자"><i class="fas fa-shield-alt"></i></div>';
            }
            
            // Verse reference removed - not a feature
            const verseHtml = '';
            
            const postImageUrls = parsePostImageUrls(post.image_url);
            const imageHtml = renderOrderedImageLayout(postImageUrls, 'max-h-96', 'mt-3');
            
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
                        ? `<img src="${toCanonicalSiteUrl(post.shared_user_avatar)}" alt="Profile" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=&quot;fas fa-user&quot;></i>'" />`
                        : '<i class="fas fa-user"></i>';
                
                let sharedRoleBadgeHtml = '';
                if (post.shared_user_role === 'moderator') {
                    sharedRoleBadgeHtml = '<div class="moderator-badge" title="운영자"><i class="fas fa-shield-alt"></i></div>';
                }
                
                // Shared verse reference removed - not a feature
                const sharedVerseHtml = '';
                
                const sharedImageUrls = parsePostImageUrls(post.shared_image_url);
                const sharedImageHtml = renderOrderedImageLayout(sharedImageUrls, 'max-h-48', 'mt-2', 'max-w-full');
                
                const sharedVideoHtml = post.shared_video_url ? `
                    <div class="mt-2 max-w-full">
                        <video controls class="w-full rounded-lg max-h-48" controlsList="nodownload">
                            <source src="${toCanonicalSiteUrl(post.shared_video_url)}" type="video/mp4">
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
                                    <h4 class="font-bold text-sm text-gray-800 truncate cursor-pointer hover:text-blue-600 transition" onclick="filterByUser(${post.shared_user_id}, \`${post.shared_user_name}\`)" title="클릭하여 ${post.shared_user_name} 님의 포스팅만 보기">${post.shared_user_name}</h4>
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
            const visibilityBadgeHtml = post.visibility_scope === 'friends'
                ? `<span class="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700"><i class="fas fa-user-friends mr-1"></i>친구공개</span>`
                : '';
            
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
                                    <h4 class="font-bold text-gray-800 cursor-pointer hover:text-blue-600 transition" onclick="filterByUser(${post.user_id}, \`${post.user_name}\`)" title="클릭하여 ${post.user_name} 님의 포스팅만 보기">${post.user_name}${visibilityBadgeHtml}</h4>
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
    
    // Set color to blue for all types (unified design)
    toast.classList.add('bg-blue-600');
    
    // Set icon based on type
    if (type === 'success') {
        toast.innerHTML = `<i class="fas fa-check-circle mr-2"></i>${message}`;
    } else if (type === 'error') {
        toast.innerHTML = `<i class="fas fa-exclamation-circle mr-2"></i>${message}`;
    } else if (type === 'warning') {
        toast.innerHTML = `<i class="fas fa-exclamation-triangle mr-2"></i>${message}`;
    } else {
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
async function finishAutoLoginSession(user, { showCelebration = true, logPrefix = '자동 로그인 성공' } = {}) {
    if (!user) return;
    currentUserId = user.id != null ? Number(user.id) : null;
    currentUser = user;
    resetLastKnownCombinedScore();
    localStorage.setItem('currentUserId', String(user.id));
    if (user.email) localStorage.setItem('currentUserEmail', user.email);
    updateAuthUI();
    await loadUserScores();
    await loadFriendsList();
    await loadNotifications(false);
    startNotificationPolling();
    loadPosts();
    console.log(logPrefix + ':', currentUser.name, '(역할:', currentUser.role + ')');
    if (showCelebration) await showLoginRewardCelebrationModal(currentUser);
}

async function autoLogin() {
    const savedUserId = localStorage.getItem('currentUserId');
    const savedEmail = localStorage.getItem('currentUserEmail');

    if (!savedUserId || !savedEmail) return;

    const emailNorm = (s) => String(s || '').trim().toLowerCase();

    try {
        const remember = localStorage.getItem(LS_LOGIN_REMEMBER) === '1';
        const savedPassword = localStorage.getItem(LS_SAVED_LOGIN_PASSWORD);

        if (remember && savedPassword) {
            const response = await axios.post('/api/login', {
                email: savedEmail,
                password: savedPassword
            });
            if (response.data.user) {
                await finishAutoLoginSession(response.data.user, {
                    showCelebration: true,
                    logPrefix: '자동 로그인 성공'
                });
            }
            return;
        }

        // 비밀번호 미저장 시 /api/login 호출 시 400만 유발하므로, 프로필 GET으로 세션만 복원
        const userRes = await axios.get(`/api/users/${encodeURIComponent(savedUserId)}`, {
            params: { current_user_id: savedUserId }
        });
        const user = userRes.data?.user;
        if (!user) return;
        if (emailNorm(user.email) !== emailNorm(savedEmail)) {
            localStorage.removeItem('currentUserId');
            localStorage.removeItem('currentUserEmail');
            localStorage.removeItem('currentUser');
            return;
        }
        await finishAutoLoginSession(user, {
            showCelebration: false,
            logPrefix: '자동 로그인(캐시 복원) 성공'
        });
    } catch (error) {
        console.error('자동 로그인 실패:', error);
        localStorage.removeItem('currentUserId');
        localStorage.removeItem('currentUserEmail');
        localStorage.removeItem('currentUser');
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

// Show any user's profile (avatar tap → cover + detail panel + chronological posts)
async function showUserProfileModal(userId) {
    if (!userId) return;
    try {
        await filterByUser(userId);
    } catch (error) {
        console.error('Failed to open user profile:', error);
        alert('프로필을 불러오는데 실패했습니다.');
    }
}

/**
 * 커버 아래에 표시할 상세 프로필(읽기 전용) HTML — 예전 프로필 모달과 동일한 정보 구역
 */
async function fillProfileViewPanelForUser(user) {
    if (!user || user.id == null) return;

    const userId = user.id;
    let friendCount = 0;
    let isFriend = false;
    let hasPendingRequest = false;
    let hasIncomingPendingRequest = false;
    let pendingRequestId = null;
    try {
        const friendsResponse = await axios.get(`/api/friends/${userId}`);
        friendCount = friendsResponse.data.friends?.length || 0;
        if (currentUserId && currentUserId !== userId) {
            const statusRes = await axios.get('/api/friendship/status', {
                params: {
                    fromUserId: Number(currentUserId),
                    toUserId: Number(userId)
                }
            });
            const relationStatus = String(statusRes.data?.status || 'none');
            const relationDirection = String(statusRes.data?.direction || '');
            pendingRequestId = statusRes.data?.requestId ? Number(statusRes.data.requestId) : null;
            isFriend = relationStatus === 'accepted';
            hasPendingRequest = relationStatus === 'pending' && relationDirection === 'outgoing';
            hasIncomingPendingRequest = relationStatus === 'pending' && relationDirection === 'incoming';
            try {
                const notificationsResponse = await axios.get(`/api/notifications/${userId}`);
                const notifications = notificationsResponse.data.notifications || [];
                if (!hasPendingRequest) {
                    hasPendingRequest = notifications.some(
                    (n) => n.type === 'friend_request' && n.from_user_id === currentUserId
                    );
                }
            } catch (e2) {
                /* ignore */
            }
        }
    } catch (e) {
        console.error('Failed to fetch friend count:', e);
    }

    let faithAnswers = null;
    if (user.faith_answers) {
        try {
            faithAnswers = JSON.parse(user.faith_answers);
        } catch (e) {
            console.error('Failed to parse faith_answers:', e);
        }
    }

    const roleColor =
        user.role === 'admin'
            ? 'text-red-600 bg-red-50'
            : user.role === 'moderator'
              ? 'text-yellow-600 bg-yellow-50'
              : 'text-gray-600 bg-gray-50';
    const roleName =
        user.role === 'admin' ? '관리자' : user.role === 'moderator' ? '운영자' : '일반 사용자';

    const isOwnProfile = currentUserId != null && Number(currentUserId) === Number(user.id);
    let privacySettings = {};
    try {
        privacySettings = user.privacy_settings ? JSON.parse(user.privacy_settings) : {};
    } catch (e) {
        privacySettings = {};
    }
    const showBasicInfo = isOwnProfile || privacySettings.basic_info === true;
    const showChurchInfo = isOwnProfile || privacySettings.church_info === true;
    const showFaithAnswers = isOwnProfile || privacySettings.faith_answers === true;
    const showEducationInfo = isOwnProfile || privacySettings.education_info === true;
    const showCareerInfo = isOwnProfile || privacySettings.career_info === true;
    const showScores = isOwnProfile || privacySettings.scores === true;

    const safeNameForOnclick = String(user.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const av = user.avatar_url ? toCanonicalSiteUrl(user.avatar_url) : '';
    let friendActionHtml = '';
    if (!isOwnProfile && currentUserId) {
        if (isFriend) {
            friendActionHtml = `<button type="button" disabled class="w-full px-4 py-3 bg-gray-200 text-gray-500 rounded-lg cursor-not-allowed font-semibold"><i class="fas fa-user-check mr-2"></i>친구</button>`;
        } else if (hasIncomingPendingRequest && pendingRequestId) {
            friendActionHtml = `
                <div class="w-full rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 shadow-sm">
                    <div class="text-[11px] text-blue-700 font-semibold mb-2"><i class="fas fa-user-clock mr-1"></i>${user.name}님 요청</div>
                    <div class="flex gap-2">
                        <button type="button" onclick="acceptFriendRequest(${pendingRequestId}, null, ${user.id})" class="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-semibold">
                            <i class="fas fa-check mr-1"></i>승인
                        </button>
                        <button type="button" onclick="rejectFriendRequest(${pendingRequestId}, ${user.id})" class="flex-1 px-3 py-2 bg-white text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition text-sm font-semibold">
                            <i class="fas fa-times mr-1"></i>거부
                        </button>
                    </div>
                </div>
            `;
        } else if (hasPendingRequest) {
            friendActionHtml = `<button type="button" disabled class="w-full px-4 py-2 bg-gray-200 text-gray-500 rounded-lg cursor-not-allowed font-semibold leading-tight"><div class="flex flex-col items-center"><div><i class="fas fa-clock mr-1"></i>친구</div><div class="text-sm">승인 대기중</div></div></button>`;
        } else {
            friendActionHtml = `<button type="button" onclick="sendFriendRequest(${user.id}, '${safeNameForOnclick}')" class="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow-md font-semibold leading-tight"><div class="flex flex-col items-center"><div><i class="fas fa-user-plus mr-1"></i>친구</div><div class="text-sm">제안 전송</div></div></button>`;
        }
    }

    const faithQuestions = [
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

    const content = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="md:col-span-1">
                    <div class="bg-gray-50 rounded-lg p-6 text-center">
                        <div class="w-32 h-32 mx-auto rounded-full overflow-hidden bg-blue-600 flex items-center justify-center text-white text-4xl mb-4">
                            ${user.avatar_url
                                ? `<img src="${av}" alt="Profile" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=&quot;fas fa-user&quot;></i>'" />`
                                : user.role === 'admin'
                                  ? '<i class="fas fa-crown text-yellow-400"></i>'
                                  : '<i class="fas fa-user"></i>'}
                        </div>
                        <h3 class="text-xl font-bold text-gray-800 mb-2">${user.name}</h3>
                        ${user.position ? `<p class="text-sm text-gray-600 mb-2"><i class="fas fa-user-tie mr-1"></i>${user.position}</p>` : ''}
                        <span class="inline-block px-3 py-1 rounded-full text-sm font-semibold ${roleColor}">${roleName}</span>
                        ${user.bio ? `<p class="text-sm text-gray-600 mt-3 px-2">${user.bio}</p>` : ''}
                        <div class="mt-4 text-xs text-gray-500 space-y-1">
                            <p>가입일: ${new Date(user.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                            <p><i class="fas fa-user-friends text-pink-500 mr-1"></i>친구 ${friendCount}명</p>
                        </div>
                        ${friendActionHtml ? `<div class="mt-3">${friendActionHtml}</div>` : ''}
                    </div>
                </div>
                <div class="md:col-span-2 space-y-4">
                    ${showScores && (isOwnProfile || user.prayer_score !== null || user.scripture_score !== null || user.activity_score !== null)
                        ? `
                    <div class="bg-purple-50 border-l-4 border-purple-600 p-3 rounded">
                        <h4 class="font-semibold text-purple-800 mb-2 text-sm">
                            <i class="fas fa-trophy mr-2"></i>${isOwnProfile ? '나의 점수' : '점수 정보'}
                        </h4>
                        <div class="flex items-center justify-center space-x-3 text-xs">
                            <i class="fas fa-book-bible text-yellow-600"></i>
                            <span class="font-semibold text-yellow-600">${user.scripture_score ?? 0}</span>
                            <span class="text-gray-300">|</span>
                            <i class="fas fa-praying-hands text-blue-600"></i>
                            <span class="font-semibold text-blue-600">${user.prayer_score ?? 0}</span>
                            <span class="text-gray-300">|</span>
                            <i class="fas fa-heart text-green-600"></i>
                            <span class="font-semibold text-green-600">${user.activity_score ?? 0}</span>
                            <span class="text-gray-300">|</span>
                            <i class="fas fa-trophy text-purple-600"></i>
                            <span class="font-semibold text-purple-600">${(user.scripture_score ?? 0) + (user.prayer_score ?? 0) + (user.activity_score ?? 0)}</span>
                        </div>
                    </div>`
                        : ''}
                    ${(() => {
                        if (!showBasicInfo) return '';
                        let basicItems = '';
                        if (user.email) basicItems += `<p><strong>이메일:</strong> ${user.email}</p>`;
                        if (user.bio) basicItems += `<p><strong>자기소개:</strong> ${user.bio}</p>`;
                        if (user.gender) basicItems += `<p><strong>성별:</strong> ${user.gender}</p>`;
                        if (user.marital_status) {
                            const status =
                                user.marital_status === 'single'
                                    ? '미혼'
                                    : user.marital_status === 'married'
                                      ? '기혼'
                                      : user.marital_status === 'other'
                                        ? '기타'
                                        : user.marital_status;
                            basicItems += `<p><strong>결혼:</strong> ${status}</p>`;
                        }
                        if (user.phone) basicItems += `<p><strong>전화번호:</strong> ${user.phone}</p>`;
                        if (user.address) basicItems += `<p><strong>주소:</strong> ${user.address}</p>`;
                        if (!basicItems) return '';
                        return `
                    <div class="bg-blue-50 border-l-4 border-blue-600 p-4 rounded">
                        <h4 class="font-semibold text-blue-800 mb-3"><i class="fas fa-info-circle mr-2"></i>기본 정보</h4>
                        <div class="space-y-2 text-sm text-gray-700">${basicItems}</div>
                    </div>`;
                    })()}
                    ${(() => {
                        if (!showChurchInfo) return '';
                        let churchItems = '';
                        if (user.church) churchItems += `<p><strong>소속 교회:</strong> ${user.church}</p>`;
                        if (user.pastor) churchItems += `<p><strong>담임목사:</strong> ${user.pastor}</p>`;
                        if (user.denomination) churchItems += `<p><strong>교단:</strong> ${user.denomination}</p>`;
                        if (user.location) churchItems += `<p><strong>교회 위치:</strong> ${user.location}</p>`;
                        if (user.position) churchItems += `<p><strong>직분:</strong> ${user.position}</p>`;
                        if (!churchItems) return '';
                        return `
                    <div class="bg-green-50 border-l-4 border-green-600 p-4 rounded">
                        <h4 class="font-semibold text-green-800 mb-3"><i class="fas fa-church mr-2"></i>교회 정보</h4>
                        <div class="space-y-2 text-sm text-gray-700">${churchItems}</div>
                    </div>`;
                    })()}
                    ${(() => {
                        if (!showFaithAnswers && !isOwnProfile) return '';
                        if (!faithAnswers) return '';
                        const hasAnswers = Object.values(faithAnswers).some(
                            (answer) => answer && answer !== '-' && String(answer).trim() !== ''
                        );
                        if (!hasAnswers) return '';
                        const rows = faithQuestions
                            .map((q, i) => {
                                const k = 'q' + (i + 1);
                                return `<div class="flex items-center justify-between gap-2"><span class="text-gray-700">${q}</span><span class="font-semibold text-gray-800 shrink-0">${faithAnswers[k] || '-'}</span></div>`;
                            })
                            .join('');
                        return `
                    <div class="bg-yellow-50 border-l-4 border-yellow-600 p-4 rounded">
                        <h4 class="font-semibold text-yellow-800 mb-3"><i class="fas fa-cross mr-2"></i>신앙 고백</h4>
                        <div class="space-y-2 text-sm">${rows}</div>
                    </div>`;
                    })()}
                    ${(() => {
                        if (!showCareerInfo || user.careers === null) return '';
                        let careers = [];
                        try {
                            careers = user.careers ? JSON.parse(user.careers) : [];
                        } catch (e) {
                            careers = [];
                        }
                        if (careers.length === 0) return '';
                        const careerItems = careers
                            .map((career) => {
                                const parts = [];
                                if (career.company) parts.push(career.company);
                                if (career.position) parts.push(career.position);
                                const text = parts.join(' - ');
                                const period = career.period ? ' (' + career.period + ')' : '';
                                return '<p class="ml-2">• ' + text + period + '</p>';
                            })
                            .join('');
                        if (!careerItems) return '';
                        return `
                    <div class="bg-purple-50 border-l-4 border-purple-600 p-4 rounded">
                        <h4 class="font-semibold text-purple-800 mb-3"><i class="fas fa-briefcase mr-2"></i>직업 정보</h4>
                        <div class="space-y-3 text-sm text-gray-700"><div><p class="font-medium text-gray-800 mb-1">경력:</p>${careerItems}</div></div>
                    </div>`;
                    })()}
                    ${(() => {
                        if (!showEducationInfo) return '';
                        let educationItems = '';
                        if (user.elementary_school && user.elementary_school.trim()) {
                            educationItems += `<div><p class="font-medium text-gray-800 mb-1">초등학교:</p><p class="ml-2">${user.elementary_school}</p></div>`;
                        }
                        if (user.middle_school && user.middle_school.trim()) {
                            educationItems += `<div><p class="font-medium text-gray-800 mb-1">중학교:</p><p class="ml-2">${user.middle_school}</p></div>`;
                        }
                        if (user.high_school && user.high_school.trim()) {
                            educationItems += `<div><p class="font-medium text-gray-800 mb-1">고등학교:</p><p class="ml-2">${user.high_school}</p></div>`;
                        }
                        if (user.universities !== null) {
                            let universities = [];
                            try {
                                universities = user.universities ? JSON.parse(user.universities) : [];
                            } catch (e) {
                                universities = [];
                            }
                            if (universities.length === 0 && (user.university || user.university_major)) {
                                universities.push({ school: user.university || '', major: user.university_major || '' });
                            }
                            if (universities.length > 0) {
                                const univItems = universities
                                    .map((edu) => {
                                        const text = edu.school + (edu.major ? ' (' + edu.major + ')' : '');
                                        return '<p class="ml-2">• ' + text + '</p>';
                                    })
                                    .join('');
                                if (univItems) {
                                    educationItems += `<div><p class="font-medium text-gray-800 mb-1">대학교:</p>${univItems}</div>`;
                                }
                            }
                        }
                        if (user.masters_degrees !== null) {
                            let masters = [];
                            try {
                                masters = user.masters_degrees ? JSON.parse(user.masters_degrees) : [];
                            } catch (e) {
                                masters = [];
                            }
                            if (masters.length === 0 && (user.masters || user.masters_major)) {
                                masters.push({ school: user.masters || '', major: user.masters_major || '' });
                            }
                            if (masters.length > 0) {
                                const mastersItems = masters
                                    .map((edu) => {
                                        const text = edu.school + (edu.major ? ' (' + edu.major + ')' : '');
                                        return '<p class="ml-2">• ' + text + '</p>';
                                    })
                                    .join('');
                                if (mastersItems) {
                                    educationItems += `<div><p class="font-medium text-gray-800 mb-1">석사:</p>${mastersItems}</div>`;
                                }
                            }
                        }
                        if (user.phd_degrees !== null) {
                            let phds = [];
                            try {
                                phds = user.phd_degrees ? JSON.parse(user.phd_degrees) : [];
                            } catch (e) {
                                phds = [];
                            }
                            if (phds.length === 0 && (user.phd || user.phd_major)) {
                                phds.push({ school: user.phd || '', major: user.phd_major || '' });
                            }
                            if (phds.length > 0) {
                                const phdItems = phds
                                    .map((edu) => {
                                        const text = edu.school + (edu.major ? ' (' + edu.major + ')' : '');
                                        return '<p class="ml-2">• ' + text + '</p>';
                                    })
                                    .join('');
                                if (phdItems) {
                                    educationItems += `<div><p class="font-medium text-gray-800 mb-1">박사:</p>${phdItems}</div>`;
                                }
                            }
                        }
                        if (!educationItems || educationItems.trim() === '') return '';
                        return `
                    <div class="bg-orange-50 border-l-4 border-orange-600 p-4 rounded">
                        <h4 class="font-semibold text-orange-800 mb-3"><i class="fas fa-graduation-cap mr-2"></i>학교 정보</h4>
                        <div class="space-y-3 text-sm text-gray-700">${educationItems}</div>
                    </div>`;
                    })()}
                </div>
            </div>`;

    const pvc = document.getElementById('profileViewContent');
    const pv = document.getElementById('profileView');
    if (!pvc || !pv) return;
    pvc.innerHTML = content;
    pv.classList.remove('hidden');

    const profileViewHeader = document.querySelector('#profileView .flex.items-center.justify-between');
    if (profileViewHeader) {
        const h2 = profileViewHeader.querySelector('h2');
        if (h2) {
            h2.innerHTML = '<i class="fas fa-user text-blue-600 mr-2"></i>프로필';
            const canEditProfile = isOwnProfile || currentUser?.role === 'admin';
            if (canEditProfile) {
                const editBtn = document.createElement('button');
                editBtn.onclick = function () {
                    showEditProfileModal(user.id);
                };
                editBtn.className = 'text-blue-600 hover:text-blue-700 transition ml-3 relative -top-0.5';
                editBtn.title = isOwnProfile ? '프로필 수정' : '프로필 수정 (관리자)';
                editBtn.innerHTML = '<i class="fas fa-edit text-lg"></i>';
                h2.appendChild(editBtn);
            }
        }
    }

    const logoutBtn = document.getElementById('profileViewLogoutBtn');
    if (logoutBtn) {
        if (currentUserId && parseInt(String(currentUserId), 10) === parseInt(String(user.id), 10)) {
            logoutBtn.classList.remove('hidden');
        } else {
            logoutBtn.classList.add('hidden');
        }
    }
}

// Hide profile and show posts feed
function hideProfile() {
    document.getElementById('profileView').classList.add('hidden');
    document.getElementById('postsFeed').classList.remove('hidden');
    const newPostCard = document.getElementById('newPostCard');
    if (newPostCard) {
        if (filterUserId) newPostCard.classList.add('hidden');
        else newPostCard.classList.remove('hidden');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Go to home (main feed)
function goToHome() {
    if (typeof closeFriendMessenger === 'function') closeFriendMessenger();
    if (filterUserId) {
        clearUserFilter(true);
    }

    // Always restore normal main feed view state.
    const qtPanelsWrapHome = document.getElementById('qtPanelsWrap');
    if (qtPanelsWrapHome) qtPanelsWrapHome.classList.add('hidden');
    if (typeof hideAllQtSections === 'function') hideAllQtSections();
    if (typeof setQtHeaderButtonActive === 'function') setQtHeaderButtonActive(false);
    if (typeof setQtButtonActive === 'function') {
        setQtButtonActive('prayer', false);
        setQtButtonActive('read', false);
        setQtButtonActive('apply', false);
        setQtButtonActive('prayer2', false);
    }

    const postFocusOverlay = document.getElementById('postFocusOverlay');
    if (postFocusOverlay) postFocusOverlay.classList.add('hidden');

    const rightSidebar = document.getElementById('rightSidebar');
    if (rightSidebar) rightSidebar.classList.remove('reactors-only', 'mobile-fullscreen-overlay');
    const reactorsTab = document.getElementById('reactorsTabContent');
    if (reactorsTab) reactorsTab.classList.add('hidden');

    const friendsContent = document.getElementById('friendsTabContent');
    const notificationsContent = document.getElementById('notificationsTabContent');
    if (friendsContent) friendsContent.classList.remove('hidden');
    if (notificationsContent) notificationsContent.classList.add('hidden');
    if (typeof setSocialHeaderButtonActive === 'function') setSocialHeaderButtonActive('friends');

    const postsFeed = document.getElementById('postsFeed');
    const postsFeedWrapper = document.getElementById('postsFeedWrapper');
    if (postsFeed) postsFeed.classList.remove('hidden');
    if (postsFeedWrapper) postsFeedWrapper.classList.remove('hidden');
    const newPostCard = document.getElementById('newPostCard');
    if (newPostCard) newPostCard.classList.remove('hidden');

    const profileView = document.getElementById('profileView');
    if (profileView && !profileView.classList.contains('hidden')) {
        hideProfile();
    } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    const centerFeedColumn = document.getElementById('centerFeedColumn');
    if (centerFeedColumn) {
        centerFeedColumn.scrollTo({ top: 0, behavior: 'smooth' });
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
setSocialHeaderButtonActive('friends'); // 기본 노말뷰: 친구 버튼 활성

// =====================
// User Filter Functions
// =====================

async function filterByUser(userId, userName) {
    console.log('🔍 filterByUser called with userId:', userId, 'userName:', userName);
    if (!userId) {
        console.log('❌ No userId provided, returning');
        return;
    }

    // QT 패널이 열려 있으면 닫고 피드 요소 복원 + QT 버튼 비활성화
    const qtPanelsWrap = document.getElementById('qtPanelsWrap');
    if (qtPanelsWrap && !qtPanelsWrap.classList.contains('hidden')) {
        qtPanelsWrap.classList.add('hidden');
        if (typeof setQtHeaderButtonActive === 'function') setQtHeaderButtonActive(false);
        const mainFeedPart1 = document.getElementById('mainFeedPart1');
        if (mainFeedPart1) mainFeedPart1.classList.remove('hidden');
        const postsFeedWrapper = document.getElementById('postsFeedWrapper');
        if (postsFeedWrapper) postsFeedWrapper.classList.remove('hidden');
    }

    filterUserId = userId;
    console.log('✅ Global filterUserId set to:', filterUserId);

    const postsFeed = document.getElementById('postsFeed');
    if (postsFeed) postsFeed.classList.remove('hidden');

    const viewedUser = await showUserProfileCover(userId);
    if (viewedUser) {
        await fillProfileViewPanelForUser(viewedUser);
    }
    loadPosts();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const displayName =
        (userName && String(userName).trim()) ||
        (document.getElementById('profileCoverName') && document.getElementById('profileCoverName').textContent.trim()) ||
        '해당 회원';
    showToast(`${displayName} 님의 포스팅만 표시 중입니다. 로고를 클릭하여 전체 보기로 돌아갈 수 있습니다.`, 'info');
}

// Filter to show only current user's posts (convenience function)
window.filterMyPosts = function() {
    if (!currentUserId || !currentUser) {
        showToast('로그인이 필요합니다.', 'error');
        return;
    }
    void filterByUser(currentUserId, currentUser.name);
};

function clearUserFilter(silent = false) {
    console.log('🔴 clearUserFilter called!');

    const wasFiltered = filterUserId !== null;
    filterUserId = null;
    console.log('✅ Global filterUserId cleared (set to null)');

    const profileView = document.getElementById('profileView');
    if (profileView) profileView.classList.add('hidden');

    hideUserProfileCover();
    loadPosts();

    if (wasFiltered && !silent) {
        showToast('전체 포스팅을 표시합니다.', 'success');
    }
}



async function showUserProfileCover(userId) {
    try {
        // Get user data
        const response = await axios.get(`/api/users/${userId}?current_user_id=${currentUserId || 0}`);
        const user = response.data.user;
        
        // Get user's post count
        const postsResponse = await axios.get('/api/posts');
        const userPostCount = postsResponse.data.posts.filter(p => p.user_id === userId).length;
        
        // Get friend count
        let friendCount = 0;
        try {
            const friendsResponse = await axios.get(`/api/friends/${userId}`);
            friendCount = friendsResponse.data.friends?.length || 0;
        } catch (e) {
            console.error('Failed to fetch friend count:', e);
        }
        
        // Update cover card
        const coverCard = document.getElementById('userProfileCover');
        const newPostCard = document.getElementById('newPostCard');
        
        if (!coverCard || !newPostCard) return null;
        
        // Update cover photo
        const coverPhoto = document.getElementById('profileCoverPhoto');
        if (coverPhoto) {
            if (user.cover_url) {
                coverPhoto.style.backgroundImage = `url(${toCanonicalSiteUrl(user.cover_url)})`;
                coverPhoto.style.backgroundSize = 'cover';
                coverPhoto.style.backgroundPosition = 'center';
            } else {
                coverPhoto.style.backgroundImage = '';
                coverPhoto.style.backgroundColor = '#3B82F6'; // Default blue background
            }
        }
        
        // Update avatar
        const avatar = document.getElementById('profileCoverAvatar');
        if (user.avatar_url) {
            avatar.innerHTML = `<img src="${toCanonicalSiteUrl(user.avatar_url)}" alt="${user.name}" class="w-full h-full object-cover">`;
        } else {
            avatar.innerHTML = '<i class="fas fa-user text-5xl"></i>';
        }
        
        // Add role badge
        const badge = document.getElementById('profileCoverBadge');
        if (user.role === 'admin') {
            badge.innerHTML = '<div class="w-8 h-8 bg-yellow-400 rounded-full flex items-center justify-center border-2 border-white shadow-lg" title="관리자"><i class="fas fa-crown text-white text-sm"></i></div>';
        } else if (user.role === 'moderator') {
            badge.innerHTML = '<div class="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center border-2 border-white shadow-lg" title="운영자"><i class="fas fa-shield-alt text-white text-sm"></i></div>';
        } else {
            badge.innerHTML = '';
        }
        
        // Update user info
        document.getElementById('profileCoverName').textContent = user.name || '사용자';
        
        // Update bio
        const bioContainer = document.getElementById('profileCoverBio');
        if (user.bio || user.introduction) {
            bioContainer.innerHTML = `
                <i class="fas fa-quote-left text-gray-400 mr-1"></i>
                <span>${user.bio || user.introduction || '소개글이 없습니다.'}</span>
                <i class="fas fa-quote-right text-gray-400 ml-1"></i>
            `;
        } else {
            bioContainer.innerHTML = `
                <i class="fas fa-quote-left text-gray-400 mr-1"></i>
                <span class="text-gray-500">아직 소개글이 없습니다.</span>
                <i class="fas fa-quote-right text-gray-400 ml-1"></i>
            `;
        }
        
        // Update stats
        document.getElementById('profileCoverPostCount').textContent = userPostCount;
        document.getElementById('profileCoverFriendCount').textContent = friendCount;
        document.getElementById('profileCoverChurch').textContent = user.church || '교회 정보 없음';
        
        // 교회 직분 정보 추가
        const positionElement = document.getElementById('profileCoverPosition');
        if (positionElement) {
            if (user.position) {
                positionElement.innerHTML = `
                    <div class="flex items-center space-x-2">
                        <i class="fas fa-user-tie text-blue-600"></i>
                        <span class="text-sm text-gray-700">${user.position}</span>
                    </div>
                `;
                positionElement.classList.remove('hidden');
            } else {
                positionElement.classList.add('hidden');
            }
        }
        
        // 지역정보 - 없으면 요소 자체를 숨김
        const locationElement = document.getElementById('profileCoverLocation');
        if (locationElement) {
            if (user.location) {
                locationElement.innerHTML = `
                    <div class="flex items-center space-x-2">
                        <i class="fas fa-map-marker-alt text-green-600"></i>
                        <span class="text-sm text-gray-700">${user.location}</span>
                    </div>
                `;
                locationElement.classList.remove('hidden');
            } else {
                locationElement.classList.add('hidden');
            }
        }
        
        // Update scores (check privacy)
        const scoresDiv = document.getElementById('profileCoverScores');
        if (user.scripture_score !== null && user.prayer_score !== null && user.activity_score !== null) {
            scoresDiv.classList.remove('hidden');
            document.getElementById('profileCoverScriptureScore').textContent = user.scripture_score || 0;
            document.getElementById('profileCoverPrayerScore').textContent = user.prayer_score || 0;
            document.getElementById('profileCoverActivityScore').textContent = user.activity_score || 0;
        } else {
            scoresDiv.classList.add('hidden');
        }
        
        // Show/hide edit cover button (only for own profile)
        const editCoverBtn = document.getElementById('editCoverPhotoBtn');
        if (editCoverBtn) {
            if (currentUserId != null && Number(currentUserId) === Number(userId)) {
                editCoverBtn.classList.remove('hidden');
            } else {
                editCoverBtn.classList.add('hidden');
            }
        }
        
        // Show cover card and hide new post card
        coverCard.classList.remove('hidden');
        newPostCard.classList.add('hidden');

        return user;
    } catch (error) {
        console.error('Failed to load user profile cover:', error);
        showToast('프로필을 불러오는데 실패했습니다.', 'error');
        return null;
    }
}

function hideUserProfileCover() {
    const coverCard = document.getElementById('userProfileCover');
    const newPostCard = document.getElementById('newPostCard');
    
    if (coverCard) {
        coverCard.classList.add('hidden');
    }
    
    if (newPostCard) {
        newPostCard.classList.remove('hidden');
    }
}

// Preview edit cover photo
function previewEditCover(event) {
    const file = event.target.files[0];
    if (file) {
        if (file.size > 10 * 1024 * 1024) {
            alert('파일 크기는 10MB를 초과할 수 없습니다.');
            event.target.value = '';
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('editCoverPreview');
            preview.style.backgroundImage = 'url(' + e.target.result + ')';
            preview.style.backgroundSize = 'cover';
            preview.style.backgroundPosition = 'center';
            preview.innerHTML = '';
        };
        reader.readAsDataURL(file);
    }
}

// Delete cover photo
async function deleteCover() {
    if (!currentUserId) {
        alert('로그인이 필요합니다.');
        return;
    }
    
    if (!confirm('커버 사진을 삭제하시겠습니까?')) {
        return;
    }
    
    try {
        await axios.delete('/api/users/' + currentUserId + '/cover');
        
        // Reset preview to default
        const preview = document.getElementById('editCoverPreview');
        preview.style.backgroundImage = '';
        preview.className = 'w-full h-32 rounded-lg bg-gradient-to-r from-blue-400 to-purple-500 flex items-center justify-center overflow-hidden relative';
        preview.innerHTML = '<span class="text-white text-sm font-medium">커버 사진을 선택하세요</span>';
        
        // Clear file input
        document.getElementById('editCover').value = '';
        
        // Update current user data
        currentUser.cover_url = null;
        
        showToast('커버 사진이 삭제되었습니다.', 'success');
    } catch (error) {
        console.error('Cover delete failed:', error);
        showToast('커버 사진 삭제에 실패했습니다.', 'error');
    }
}

// Upload cover photo
async function uploadCover() {
    const fileInput = document.getElementById('editCover');
    const file = fileInput.files[0];
    
    if (!file) {
        return null; // No file to upload
    }
    
    const formData = new FormData();
    formData.append('cover', file);
    
    try {
        const response = await axios.post('/api/users/' + currentUserId + '/cover', formData);
        
        return response.data.cover_url;
    } catch (error) {
        console.error('Cover upload failed:', error);
        throw error;
    }
}


// =====================
// Friend List Functions
// =====================

// Load friends list
async function loadFriendsList() {
    if (!currentUserId) return;
    
    try {
        const response = await axios.get(`/api/friends/${currentUserId}`);
        friendsList = response.data.friends || [];
        console.log('Friends loaded:', friendsList.length);
        updateSidebarFriendsList();
    } catch (error) {
        console.error('Failed to load friends:', error);
        friendsList = [];
        updateSidebarFriendsList();
    }
}

// Update sidebar friend list UI
function updateSidebarFriendsList() {
    const container = document.getElementById('sidebarFriendsList');
    if (!container) return;
    const friendsContent = document.getElementById('friendsTabContent');
    
    if (!friendsList || friendsList.length === 0) {
        if (friendsContent) friendsContent.classList.add('friends-empty');
        container.innerHTML = `
            <div class="text-center py-8 text-gray-400">
                <i class="fas fa-user-friends text-4xl mb-3 opacity-40"></i>
                <p class="text-sm">친구가 없습니다</p>
            </div>
        `;
        return;
    }
    
    if (friendsContent) friendsContent.classList.remove('friends-empty');
    
    container.innerHTML = friendsList.map(friend => `
        <div class="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50 transition">
            <div class="w-10 h-10 rounded-full overflow-hidden bg-blue-500 flex items-center justify-center text-white flex-shrink-0 cursor-pointer hover:ring-4 hover:ring-blue-300 transition"
                 onclick="showUserProfileModal(${friend.id})"
                 title="${friend.name} 프로필 보기">
                ${friend.avatar_url
                    ? `<img src="${toCanonicalSiteUrl(friend.avatar_url)}" alt="${friend.name}" class="w-full h-full object-cover" />`
                    : `<i class="fas fa-user text-white"></i>`
                }
            </div>
            <div class="flex-1 min-w-0">
                <div class="font-bold text-gray-800 text-sm truncate cursor-pointer hover:text-blue-600 transition"
                     onclick="filterByUser(${friend.id}, \`${friend.name}\`)"
                     title="${friend.name} 님의 포스팅만 보기">
                    ${friend.name}
                </div>
                <div class="text-xs text-gray-500 truncate">
                    ${friend.church || friend.denomination || '교회 정보 없음'}
                </div>
            </div>
            <button
                type="button"
                onclick="openFriendMessenger(${friend.id}, \`${friend.name}\`, \`${friend.avatar_url || ''}\`)"
                class="w-9 h-9 rounded-full bg-blue-100 text-blue-500 flex items-center justify-center flex-shrink-0 hover:bg-blue-200 transition"
                title="${friend.name} 님에게 메시지 보내기">
                <i class="fas fa-comment-dots text-sm"></i>
            </button>
        </div>
    `).join('');
}

// Check if user is a friend
function isFriend(userId) {
    return friendsList.some(friend => friend.id === userId);
}

let friendMessengerTargetId = null;
let friendMessengerPollTimer = null;
let friendMessengerImageFile = null;
let friendMessengerVideoFile = null;
/** 피드백 알림 등으로 연 직후: 이 메시지 id 근처에 스크롤 유지 (폴링 시 맨 아래로 덮어쓰지 않음) */
let friendMessengerAnchorMessageId = null;

function friendMessengerAutoGrow(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    el.style.overflowY = 'hidden';
}

function commentAutoGrow(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    el.style.overflowY = 'hidden';
}

function createPostAutoGrow(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    el.style.overflowY = 'hidden';
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function parsePostImageUrls(imageUrlValue) {
    if (!imageUrlValue) return [];
    const raw = String(imageUrlValue).trim();
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.map((v) => String(v || '').trim()).filter(Boolean);
        }
    } catch (_) {}
    return [raw];
}

function renderOrderedImageLayout(urls, maxHeightClass, marginTopClass = 'mt-3', wrapperExtraClass = '') {
    if (!urls || !urls.length) return '';
    const safeUrls = urls.map((u) => toCanonicalSiteUrl(u));
    const isLarge = String(maxHeightClass || '').includes('96');
    const singleCellH = isLarge ? 'h-[26rem]' : 'h-52';
    const pairCellH = isLarge ? 'h-[14rem]' : 'h-32';
    const topCellH3 = isLarge ? 'h-[18rem]' : 'h-40';
    const bottomCellH3 = isLarge ? 'h-[12rem]' : 'h-28';
    const frame = (u, hClass, extra = '') => `
        <div class="w-full ${hClass} flex items-center justify-center overflow-hidden rounded-lg bg-white ${extra}">
            <img src="${u}" alt="Post image" class="max-w-full max-h-full object-contain" onerror="this.style.display='none'" />
        </div>
    `;

    if (safeUrls.length === 1) {
        return `
            <div class="${marginTopClass} ${wrapperExtraClass}">
                ${frame(safeUrls[0], singleCellH)}
            </div>
        `;
    }

    if (safeUrls.length === 2) {
        return `
            <div class="${marginTopClass} flex items-center gap-2 ${wrapperExtraClass}">
                <div class="w-1/2">${frame(safeUrls[0], pairCellH)}</div>
                <div class="w-1/2">${frame(safeUrls[1], pairCellH)}</div>
            </div>
        `;
    }

    if (safeUrls.length === 3) {
        // 첨부 순서 유지 + 누운 T 레이아웃(상단 1장, 하단 2장)
        // 하단 셀 높이를 고정해 HVH의 우하단 H도 세로 중앙 정렬되도록 함.
        return `
            <div class="${marginTopClass} ${wrapperExtraClass}">
                <div class="w-full mb-2">${frame(safeUrls[0], topCellH3)}</div>
                <div class="grid grid-cols-2 gap-2">
                    <div class="w-full">${frame(safeUrls[1], bottomCellH3)}</div>
                    <div class="w-full">${frame(safeUrls[2], bottomCellH3)}</div>
                </div>
            </div>
        `;
    }

    // 4장 이상(실사용은 최대 4장): 첨부 순서대로 2x2
    return `
        <div class="${marginTopClass} grid grid-cols-2 gap-2 ${wrapperExtraClass}">
            ${safeUrls.slice(0, 4).map((u) => frame(u, pairCellH)).join('')}
        </div>
    `;
}

function formatFriendMessengerTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

function applyFriendMessageHighlightBubble(messageId) {
    const id = Number(messageId);
    if (!Number.isFinite(id) || id <= 0) return;
    document.querySelectorAll('.friend-msg-bubble').forEach((b) => {
        b.classList.remove('ring-2', 'ring-amber-400', 'ring-offset-2', 'shadow-md');
    });
    const el = document.getElementById(`friend-msg-${id}`);
    const bubble = el && el.querySelector('.friend-msg-bubble');
    if (!bubble) return;
    bubble.classList.add('ring-2', 'ring-amber-400', 'ring-offset-2', 'shadow-md');
    setTimeout(() => {
        bubble.classList.remove('ring-2', 'ring-amber-400', 'ring-offset-2', 'shadow-md');
    }, 2200);
}

/** 스크롤 영역 기준 해당 메시지 행을 보이는 상단에 최대한 붙임 */
function snapFriendMessengerScrollToMessageId(messageId, opts) {
    const listEl = document.getElementById('friendMessengerMessages');
    if (!listEl || messageId == null || !Number.isFinite(Number(messageId)) || Number(messageId) <= 0) {
        return false;
    }
    const id = Number(messageId);
    const el = document.getElementById(`friend-msg-${id}`);
    if (!el) return false;
    const pad = opts && typeof opts.pad === 'number' ? opts.pad : 6;
    const delta = el.getBoundingClientRect().top - listEl.getBoundingClientRect().top - pad;
    const nextTop = Math.max(0, listEl.scrollTop + delta);
    if (opts && opts.smooth) {
        listEl.scrollTo({ top: nextTop, behavior: 'smooth' });
    } else {
        listEl.scrollTop = nextTop;
    }
    return true;
}

/** 레이아웃·폰트 로드 후에도 말풍선이 헤더 바로 아래에 오도록 여러 번 보정 */
function scheduleFriendMessengerSnapToMessage(messageId, withHighlight) {
    const id = Number(messageId);
    if (!Number.isFinite(id) || id <= 0) return;
    const delays = [0, 24, 72, 160, 320];
    delays.forEach((ms, i) => {
        setTimeout(() => {
            snapFriendMessengerScrollToMessageId(id, { smooth: false });
            if (withHighlight && i === 1) {
                applyFriendMessageHighlightBubble(id);
            }
        }, ms);
    });
}

function closeFriendMessenger() {
    const modal = document.getElementById('friendMessengerModal');
    if (modal) modal.classList.add('hidden');
    friendMessengerTargetId = null;
    friendMessengerAnchorMessageId = null;
    removeFriendMessengerAttachment();
    if (friendMessengerPollTimer) {
        clearInterval(friendMessengerPollTimer);
        friendMessengerPollTimer = null;
    }
}

function pickFriendMessengerImage() {
    const input = document.getElementById('friendMessengerImageInput');
    if (input) input.click();
}

function pickFriendMessengerVideo() {
    const input = document.getElementById('friendMessengerVideoInput');
    if (input) input.click();
}

function setupFriendMessengerFileInputs() {
    const imgInput = document.getElementById('friendMessengerImageInput');
    const vidInput = document.getElementById('friendMessengerVideoInput');
    const preview = document.getElementById('friendMessengerPreview');
    const imgPreview = document.getElementById('friendMessengerImagePreview');
    const vidPreview = document.getElementById('friendMessengerVideoPreview');
    if (!imgInput || !vidInput || !preview || !imgPreview || !vidPreview) return;

    if (imgInput.dataset.bound === '1') return;
    imgInput.dataset.bound = '1';
    vidInput.dataset.bound = '1';

    imgInput.onchange = function () {
        const f = imgInput.files && imgInput.files[0];
        if (!f) return;
        if (!f.type.startsWith('image/')) {
            showToast('이미지 파일만 전송할 수 있습니다.', 'error');
            imgInput.value = '';
            return;
        }
        if (f.size > 10 * 1024 * 1024) {
            showToast('이미지는 10MB 이하여야 합니다.', 'error');
            imgInput.value = '';
            return;
        }
        friendMessengerVideoFile = null;
        vidInput.value = '';
        friendMessengerImageFile = f;
        vidPreview.src = '';
        vidPreview.classList.add('hidden');
        imgPreview.src = URL.createObjectURL(f);
        imgPreview.classList.remove('hidden');
        preview.classList.remove('hidden');
    };

    vidInput.onchange = function () {
        const f = vidInput.files && vidInput.files[0];
        if (!f) return;
        if (!f.type.startsWith('video/')) {
            showToast('동영상 파일만 전송할 수 있습니다.', 'error');
            vidInput.value = '';
            return;
        }
        if (f.size > 100 * 1024 * 1024) {
            showToast('동영상은 100MB 이하여야 합니다.', 'error');
            vidInput.value = '';
            return;
        }
        friendMessengerImageFile = null;
        imgInput.value = '';
        friendMessengerVideoFile = f;
        imgPreview.src = '';
        imgPreview.classList.add('hidden');
        vidPreview.src = URL.createObjectURL(f);
        vidPreview.classList.remove('hidden');
        preview.classList.remove('hidden');
    };
}

function removeFriendMessengerAttachment() {
    friendMessengerImageFile = null;
    friendMessengerVideoFile = null;
    const imgInput = document.getElementById('friendMessengerImageInput');
    const vidInput = document.getElementById('friendMessengerVideoInput');
    const preview = document.getElementById('friendMessengerPreview');
    const imgPreview = document.getElementById('friendMessengerImagePreview');
    const vidPreview = document.getElementById('friendMessengerVideoPreview');
    if (imgInput) imgInput.value = '';
    if (vidInput) vidInput.value = '';
    if (imgPreview) { imgPreview.src = ''; imgPreview.classList.add('hidden'); }
    if (vidPreview) { vidPreview.src = ''; vidPreview.classList.add('hidden'); }
    if (preview) preview.classList.add('hidden');
}

async function loadFriendMessengerMessages(scrollToMessageId, fromPoll) {
    if (!currentUserId || !friendMessengerTargetId) return;
    const listEl = document.getElementById('friendMessengerMessages');
    if (!listEl) return;
    const isPoll = fromPoll === true;
    const targetId =
        scrollToMessageId != null && Number.isFinite(Number(scrollToMessageId)) ? Number(scrollToMessageId) : null;
    try {
        const res = await axios.get(`/api/messages/${currentUserId}/${friendMessengerTargetId}`);
        const messages = (res.data && res.data.messages) ? res.data.messages : [];
        if (!messages.length) {
            listEl.innerHTML = `<div class="text-center text-gray-400 text-sm py-6">첫 메시지를 보내보세요.</div>`;
            return;
        }
        listEl.innerHTML = messages.map((msg) => {
            const mine = Number(msg.sender_id) === Number(currentUserId);
            const mid = msg.id != null ? Number(msg.id) : 0;
            const rowId = mid ? `friend-msg-${mid}` : '';
            const imageUrl = msg.image_url ? toCanonicalSiteUrl(msg.image_url) : '';
            const videoUrl = msg.video_url ? toCanonicalSiteUrl(msg.video_url) : '';
            const imgHtml = msg.image_url
                ? `<img src="${imageUrl}" alt="사진" class="max-w-full max-h-52 rounded-lg mt-2 border border-gray-200 bg-white object-contain cursor-pointer" onclick="window.open(this.src, '_blank')" />`
                : '';
            const vidHtml = msg.video_url
                ? `<video controls class="max-w-full max-h-52 rounded-lg mt-2 border border-gray-200 bg-white"><source src="${videoUrl}"></video>`
                : '';
            const mediaDownloadHtml = `
                ${msg.image_url ? `
                    <div class="mt-2">
                        <a href="${imageUrl}" download class="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border ${mine ? 'border-blue-200 text-blue-100 hover:bg-blue-500/40' : 'border-blue-200 text-blue-600 hover:bg-blue-50'} transition">
                            <i class="fas fa-download mr-1"></i>사진 다운로드
                        </a>
                    </div>
                ` : ''}
                ${msg.video_url ? `
                    <div class="mt-2">
                        <a href="${videoUrl}" download class="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border ${mine ? 'border-blue-200 text-blue-100 hover:bg-blue-500/40' : 'border-blue-200 text-blue-600 hover:bg-blue-50'} transition">
                            <i class="fas fa-download mr-1"></i>동영상 다운로드
                        </a>
                    </div>
                ` : ''}
            `;
            return `
                <div id="${rowId || ''}" class="flex scroll-mt-2 ${mine ? 'justify-end' : 'justify-start'} friend-msg-row" data-msg-id="${mid || ''}">
                    <div class="max-w-[78%] px-3 py-2 rounded-2xl friend-msg-bubble transition-shadow duration-300 ${mine ? 'bg-blue-600 text-white rounded-br-md' : 'bg-white text-gray-800 border border-gray-200 rounded-bl-md'}">
                        ${msg.content ? `<div class="text-sm leading-snug break-words whitespace-pre-wrap">${escapeHtml(msg.content || '')}</div>` : ''}
                        ${imgHtml}
                        ${vidHtml}
                        ${mediaDownloadHtml}
                        <div class="mt-1 text-[10px] ${mine ? 'text-blue-100' : 'text-gray-400'} text-right">${formatFriendMessengerTime(msg.created_at)}</div>
                    </div>
                </div>
            `;
        }).join('');
        if (targetId) {
            friendMessengerAnchorMessageId = targetId;
            scheduleFriendMessengerSnapToMessage(targetId, true);
        } else if (isPoll && friendMessengerAnchorMessageId) {
            const ok = snapFriendMessengerScrollToMessageId(friendMessengerAnchorMessageId, { smooth: false });
            if (!ok) {
                listEl.scrollTop = listEl.scrollHeight;
            }
        } else {
            listEl.scrollTop = listEl.scrollHeight;
        }
    } catch (error) {
        console.error('Failed to load friend messages:', error);
        listEl.innerHTML = `<div class="text-center text-red-400 text-sm py-6">메시지를 불러오지 못했습니다.</div>`;
    }
}

function openFriendMessenger(friendId, friendName, friendAvatarUrl, scrollToMessageId) {
    if (!currentUserId) {
        showLoginModal();
        return;
    }
    friendMessengerTargetId = Number(friendId);

    const modal = document.getElementById('friendMessengerModal');
    const titleEl = document.getElementById('friendMessengerTitle');
    const avatarEl = document.getElementById('friendMessengerAvatar');
    const inputEl = document.getElementById('friendMessengerInput');

    if (titleEl) titleEl.textContent = `${friendName} 님`;
    if (avatarEl) {
        if (friendAvatarUrl) {
            avatarEl.innerHTML = `<img src="${toCanonicalSiteUrl(friendAvatarUrl)}" alt="${friendName}" class="w-full h-full object-cover" />`;
        } else {
            avatarEl.innerHTML = '<i class="fas fa-user text-xs"></i>';
        }
    }
    if (modal) modal.classList.remove('hidden');
    if (inputEl) {
        inputEl.focus();
        friendMessengerAutoGrow(inputEl);
    }
    setupFriendMessengerFileInputs();
    removeFriendMessengerAttachment();

    const sid =
        scrollToMessageId != null && Number.isFinite(Number(scrollToMessageId)) ? Number(scrollToMessageId) : null;
    friendMessengerAnchorMessageId = sid;
    void loadFriendMessengerMessages(sid, false);
    if (friendMessengerPollTimer) clearInterval(friendMessengerPollTimer);
    friendMessengerPollTimer = setInterval(() => {
        void loadFriendMessengerMessages(null, true);
    }, 4000);
}

async function sendFriendMessage() {
    if (!currentUserId || !friendMessengerTargetId) return;
    const inputEl = document.getElementById('friendMessengerInput');
    if (!inputEl) return;
    const content = String(inputEl.value || '').trim();
    if (!content && !friendMessengerImageFile && !friendMessengerVideoFile) return;
    try {
        if (friendMessengerImageFile || friendMessengerVideoFile) {
            const formData = new FormData();
            formData.append('senderId', String(currentUserId));
            formData.append('receiverId', String(friendMessengerTargetId));
            formData.append('content', content || '');
            if (friendMessengerImageFile) formData.append('image', friendMessengerImageFile);
            if (friendMessengerVideoFile) formData.append('video', friendMessengerVideoFile);
            await axios.post('/api/messages', formData);
            removeFriendMessengerAttachment();
        } else {
            await axios.post('/api/messages', {
                senderId: currentUserId,
                receiverId: friendMessengerTargetId,
                content
            });
        }
        inputEl.value = '';
        inputEl.style.height = 'auto';
        inputEl.style.overflowY = 'hidden';
        friendMessengerAnchorMessageId = null;
        await loadFriendMessengerMessages(null, false);
    } catch (error) {
        console.error('Failed to send friend message:', error);
        showToast('메시지 전송에 실패했습니다.', 'error');
    }
}


// =====================
// Notification Functions
// =====================

let notificationsList = [];
let isNotificationActive = false;

function setSocialHeaderButtonActive(kind) {
    const friendsBtns = [document.getElementById('friendsListBtn'), document.getElementById('friendsListBtnMobile')];
    const notifBtns = [document.getElementById('notificationBtn'), document.getElementById('notificationBtnMobile')];

    const friendsActive = kind === 'friends';
    const notifActive = kind === 'notifications';

    for (let i = 0; i < friendsBtns.length; i++) {
        const b = friendsBtns[i];
        if (!b) continue;
        b.classList.toggle('text-blue-600', friendsActive);
        b.classList.toggle('text-gray-500', !friendsActive);
    }
    for (let i = 0; i < notifBtns.length; i++) {
        const b = notifBtns[i];
        if (!b) continue;
        b.classList.toggle('text-blue-600', notifActive);
        b.classList.toggle('text-gray-500', !notifActive);
    }
}

function toggleFriendsList() {
    const friendsContent = document.getElementById('friendsTabContent');
    const notificationsContent = document.getElementById('notificationsTabContent');
    if (!friendsContent || !notificationsContent) return;

    // Always keep friends active when clicked; do not toggle off on re-click.
    friendsContent.classList.remove('hidden');
    notificationsContent.classList.add('hidden');
    isNotificationActive = false;
    setSocialHeaderButtonActive('friends');
}

// Toggle notifications in header
function toggleNotifications() {
    const friendsContent = document.getElementById('friendsTabContent');
    const notificationsContent = document.getElementById('notificationsTabContent');
    if (!friendsContent || !notificationsContent) return;

    // Always keep notifications active when clicked; do not toggle off on re-click.
    isNotificationActive = true;
    friendsContent.classList.add('hidden');
    notificationsContent.classList.remove('hidden');
    setSocialHeaderButtonActive('notifications');
    loadNotifications(true);
    updatePushButtonState();
}

// ── Push notification toggle ──────────────────────────────────────────────────
let pushSubscription = null;

async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    try {
        const reg = await navigator.serviceWorker.register('/sw.js?v=3', { scope: '/' });
        const requestImmediateActivation = () => {
            if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        };
        if (reg.waiting) requestImmediateActivation();
        reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
                if (installing.state === 'installed') requestImmediateActivation();
            });
        });
        return reg;
    } catch (e) {
        console.warn('Service worker registration failed:', e);
        return null;
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const arr = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i);
    return arr;
}

async function updatePushButtonState() {
    const btn = document.getElementById('pushNotifyBtn');
    if (!btn) return;
    const setOnState = () => {
        btn.classList.remove('border-gray-300', 'text-gray-600', 'bg-white');
        btn.classList.add('border-blue-500', 'text-blue-600', 'bg-blue-100', 'hover:bg-blue-200');
        btn.innerHTML = '<i class="fas fa-bell"></i>';
        btn.title = '푸시 켜짐 (클릭하여 끄기)';
    };
    const setOffState = () => {
        btn.classList.remove('border-blue-500', 'text-blue-600', 'bg-blue-100', 'hover:bg-blue-200');
        btn.classList.add('border-gray-300', 'text-gray-600', 'bg-white');
        btn.innerHTML = '<i class="fas fa-bell-slash"></i>';
        btn.title = '푸시 꺼짐 (클릭하여 켜기)';
    };
    try {
        const sw = await navigator.serviceWorker.ready;
        const sub = await sw.pushManager.getSubscription();
        if (sub) setOnState(); else setOffState();
    } catch (_) { setOffState(); }
}

async function togglePushNotifications() {
    const btn = document.getElementById('pushNotifyBtn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    try {
        if (!currentUserId) { showToast('로그인 후 이용해주세요.', 'warning'); return; }
        if (!('serviceWorker' in navigator)) {
            showToast('이 브라우저는 푸시를 지원하지 않습니다.', 'warning'); return;
        }
        if (!window.isSecureContext) {
            showToast('푸시 알림은 HTTPS에서만 가능합니다.', 'warning'); return;
        }
        if (!('Notification' in window)) { showToast('이 브라우저는 알림을 지원하지 않습니다.', 'warning'); return; }
        if (!('PushManager' in window)) { showToast('푸시를 지원하지 않는 브라우저입니다.', 'warning'); return; }
        let reg = await navigator.serviceWorker.getRegistration();
        if (!reg) reg = await registerServiceWorker();
        if (!reg) { showToast('서비스 워커 등록 실패. 페이지를 새로고침 후 다시 시도해주세요.', 'error'); return; }
        await navigator.serviceWorker.ready;
        await new Promise(r => setTimeout(r, 300));
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
            await sub.unsubscribe();
            await axios.post('/api/push/unsubscribe', { userId: currentUserId, endpoint: sub.endpoint });
            pushSubscription = null;
            showToast('푸시 알림이 꺼졌습니다.', 'success');
            updatePushButtonState();
            return;
        } else {
            const res = await axios.get('/api/push/vapid-public');
            if (!res.data?.publicKey) { showToast('푸시가 설정되지 않았습니다.', 'error'); return; }
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') { showToast('알림 권한이 필요합니다.', 'warning'); return; }
            const newSub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(res.data.publicKey)
            });
            await axios.post('/api/push/subscribe', { userId: currentUserId, subscription: newSub.toJSON() });
            pushSubscription = newSub;
            showToast('푸시 알림이 켜졌습니다!', 'success');
        }
        updatePushButtonState();
    } catch (e) {
        console.error('Push toggle error:', e);
        showToast('푸시 설정에 실패했습니다: ' + (e.message || '알 수 없는 오류'), 'error');
    } finally {
        const b = document.getElementById('pushNotifyBtn');
        if (b) { b.disabled = false; b.style.opacity = ''; }
    }
}

window.togglePushNotifications = togglePushNotifications;

// 푸시 버튼 클릭 - 이벤트 위임
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#pushNotifyBtn');
    if (btn) { e.preventDefault(); e.stopPropagation(); togglePushNotifications(); }
});

// Load notifications
async function loadNotifications(markAsRead = false) {
    if (!currentUserId) return;
    
    try {
        const response = await axios.get(`/api/notifications/${currentUserId}`);
        notificationsList = response.data.notifications || [];
        console.log('Notifications loaded:', notificationsList.length);
        updateSidebarNotificationsList();
        
        // Only mark as read if explicitly requested (when user opens notification panel)
        if (markAsRead && notificationsList.length > 0 && notificationsList.some(n => !n.is_read)) {
            try {
                await axios.post('/api/notifications/mark-read', {
                    userId: currentUserId
                });
                
                // Update local state: mark all as read
                notificationsList = notificationsList.map(n => ({
                    ...n,
                    is_read: true
                }));
                
                console.log('All notifications marked as read');
            } catch (error) {
                console.error('Failed to mark notifications as read:', error);
            }
        }
        
        // Always update badge to reflect current state
        updateNotificationBadge();
    } catch (error) {
        console.error('Failed to load notifications:', error);
        notificationsList = [];
        updateSidebarNotificationsList();
    }
}

function ensureSidebarNotificationsClickDelegation() {
    const container = document.getElementById('sidebarNotificationsList');
    if (!container || container.dataset.ntfClickDeleg === '1') return;
    container.dataset.ntfClickDeleg = '1';
    container.addEventListener('click', (e) => {
        const row = e.target.closest('[data-feedback-notif="1"]');
        if (!row) return;
        e.preventDefault();
        e.stopPropagation();
        const nid = Number(row.getAttribute('data-notification-id'));
        const fid = Number(row.getAttribute('data-from-user-id'));
        let fname = '';
        let favatar = '';
        try {
            fname = decodeURIComponent(row.getAttribute('data-from-name') || '');
        } catch (_) {
            fname = row.getAttribute('data-from-name') || '';
        }
        try {
            favatar = decodeURIComponent(row.getAttribute('data-from-avatar') || '');
        } catch (_) {
            favatar = row.getAttribute('data-from-avatar') || '';
        }
        if (!Number.isFinite(fid) || fid <= 0) {
            showToast('회원 정보가 올바르지 않습니다.', 'error');
            return;
        }
        const fmidRaw = row.getAttribute('data-friend-message-id');
        const fmid =
            fmidRaw && String(fmidRaw).trim() !== '' && Number.isFinite(Number(fmidRaw)) ? Number(fmidRaw) : null;
        void openFeedbackFromNotification(nid, fid, fname, favatar, fmid);
    });
}

// Update sidebar notifications list UI
function updateSidebarNotificationsList() {
    const container = document.getElementById('sidebarNotificationsList');
    if (!container) return;
    ensureSidebarNotificationsClickDelegation();
    const notificationsContent = document.getElementById('notificationsTabContent');
    
    if (!notificationsList || notificationsList.length === 0) {
        if (notificationsContent) notificationsContent.classList.add('notifications-empty');
        container.innerHTML = `
            <div class="text-center py-8 text-gray-400">
                <i class="fas fa-bell text-4xl mb-3 opacity-40"></i>
                <p class="text-sm">알림이 없습니다</p>
            </div>
        `;
        // Hide red dot when no notifications
        updateNotificationBadge();
        return;
    }
    
    if (notificationsContent) notificationsContent.classList.remove('notifications-empty');
    
    container.innerHTML = notificationsList.map(notification => {
        if (notification.type === 'friend_request') {
            return `
                <div class="flex items-start space-x-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
                    <div class="flex-shrink-0">
                        <div class="w-10 h-10 rounded-full overflow-hidden bg-gray-300 flex items-center justify-center">
                            ${notification.from_user_avatar
                                ? `<img src="${toCanonicalSiteUrl(notification.from_user_avatar)}" alt="${notification.from_user_name}" class="w-full h-full object-cover">`
                                : `<i class="fas fa-user text-gray-600"></i>`
                            }
                        </div>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm text-gray-800 font-medium mb-1">
                            <span class="font-bold">${notification.from_user_name}</span>님이 친구 제안을 보냈습니다
                        </p>
                        <p class="text-xs text-gray-500 mb-2">
                            ${formatNotificationTime(notification.created_at)}
                        </p>
                        <div class="flex space-x-2">
                            <button 
                                onclick="acceptFriendRequest(${notification.id})"
                                class="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition font-semibold">
                                수락
                            </button>
                            <button 
                                onclick="rejectFriendRequest(${notification.id})"
                                class="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300 transition font-semibold">
                                삭제
                            </button>
                        </div>
                    </div>
                </div>
            `;
        } else if (notification.type === 'comment') {
            const postPreview = notification.post_content 
                ? (notification.post_content.length > 30 
                    ? notification.post_content.substring(0, 30) + '...' 
                    : notification.post_content)
                : '게시물';
            return `
                <div class="flex items-start space-x-3 p-3 rounded-lg ${notification.is_read ? 'bg-gray-50' : 'bg-green-50 border border-green-200'}">
                    <div class="flex-shrink-0">
                        <div class="w-10 h-10 rounded-full overflow-hidden bg-gray-300 flex items-center justify-center">
                            ${notification.from_user_avatar
                                ? `<img src="${toCanonicalSiteUrl(notification.from_user_avatar)}" alt="${notification.from_user_name}" class="w-full h-full object-cover">`
                                : `<i class="fas fa-user text-gray-600"></i>`
                            }
                        </div>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm text-gray-800 mb-1">
                            <span class="font-bold">${notification.from_user_name}</span>님이 회원님의 게시물에 댓글을 남겼습니다
                        </p>
                        <p class="text-xs text-gray-500 mb-2">
                            "${postPreview}"
                        </p>
                        <p class="text-xs text-gray-400">
                            ${formatNotificationTime(notification.created_at)}
                        </p>
                    </div>
                </div>
            `;
        } else if (notification.type === 'like') {
            const postPreview = notification.post_content 
                ? (notification.post_content.length > 30 
                    ? notification.post_content.substring(0, 30) + '...' 
                    : notification.post_content)
                : '게시물';
            return `
                <div class="flex items-start space-x-3 p-3 rounded-lg ${notification.is_read ? 'bg-gray-50' : 'bg-yellow-50 border border-yellow-200'}">
                    <div class="flex-shrink-0">
                        <div class="w-10 h-10 rounded-full overflow-hidden bg-gray-300 flex items-center justify-center">
                            ${notification.from_user_avatar
                                ? `<img src="${toCanonicalSiteUrl(notification.from_user_avatar)}" alt="${notification.from_user_name}" class="w-full h-full object-cover">`
                                : `<i class="fas fa-user text-gray-600"></i>`
                            }
                        </div>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm text-gray-800 mb-1">
                            <span class="font-bold">${notification.from_user_name}</span>님이 회원님의 게시물을 좋아합니다
                        </p>
                        <p class="text-xs text-gray-500 mb-2">
                            "${postPreview}"
                        </p>
                        <p class="text-xs text-gray-400">
                            ${formatNotificationTime(notification.created_at)}
                        </p>
                    </div>
                </div>
            `;
        } else if (notification.type === 'feedback') {
            const encName = encodeURIComponent(notification.from_user_name || '');
            const encAvatar = encodeURIComponent(notification.from_user_avatar || '');
            const previewRaw = String(notification.preview_text || '').trim();
            const previewBlock = previewRaw
                ? `<p class="text-xs text-gray-600 mt-1.5 line-clamp-3 leading-snug">「${escapeHtml(previewRaw)}」</p>`
                : `<p class="text-xs text-gray-500 mt-1.5 italic">내용 요약 없음 · 메신저에서 확인하세요</p>`;
            const nid = Number(notification.id);
            const fid = Number(notification.from_user_id);
            const fmId =
                notification.friend_message_id != null &&
                Number.isFinite(Number(notification.friend_message_id)) &&
                Number(notification.friend_message_id) > 0
                    ? Number(notification.friend_message_id)
                    : '';
            return `
                <div
                    data-feedback-notif="1"
                    data-notification-id="${nid}"
                    data-from-user-id="${fid}"
                    data-friend-message-id="${fmId}"
                    data-from-name="${encName}"
                    data-from-avatar="${encAvatar}"
                    class="flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition hover:brightness-[0.98] active:scale-[0.99] ${notification.is_read ? 'bg-amber-50/40 border-amber-100' : 'bg-amber-50 border-amber-300 shadow-sm'}"
                    role="button"
                    tabindex="0"
                >
                    <div class="flex-shrink-0">
                        <div class="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center border border-amber-200">
                            <i class="fas fa-lightbulb"></i>
                        </div>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm text-gray-900 font-semibold mb-0.5">
                            피드백 · <span class="font-bold">${escapeHtml(notification.from_user_name || '회원')}</span>
                        </p>
                        ${previewBlock}
                        <p class="text-xs text-amber-800 font-medium mt-1.5">
                            <i class="fas fa-comments mr-0.5"></i>탭하여 메신저에서 전체 보기
                        </p>
                        <p class="text-xs text-gray-400 mt-1">
                            ${formatNotificationTime(notification.created_at)}
                        </p>
                    </div>
                </div>
            `;
        }
        
        return `
            <div class="flex items-start space-x-3 p-3 rounded-lg hover:bg-gray-50 transition ${notification.is_read ? 'opacity-60' : 'bg-blue-50'}">
                <div class="flex-shrink-0">
                    <i class="fas fa-${getNotificationIcon(notification.type)} text-blue-600 text-lg"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm text-gray-800 font-medium">
                        ${notification.message || '새 알림이 있습니다'}
                    </p>
                    <p class="text-xs text-gray-500 mt-1">
                        ${formatNotificationTime(notification.created_at)}
                    </p>
                </div>
            </div>
        `;
    }).join('');
    
    // Show/hide red dot based on unread notifications
    updateNotificationBadge();
}

// Get notification icon based on type
function getNotificationIcon(type) {
    const icons = {
        'friend_request': 'user-plus',
        'friend_accept': 'user-check',
        'comment': 'comment',
        'like': 'heart',
        'post': 'file-alt',
        'mention': 'at',
        feedback: 'lightbulb'
    };
    return icons[type] || 'bell';
}

async function openFeedbackFromNotification(
    notificationId,
    fromUserId,
    fromUserName,
    fromUserAvatar,
    friendMessageId
) {
    if (!currentUserId || !Number.isFinite(fromUserId) || fromUserId <= 0) return;
    const openMsgr =
        typeof window.openFriendMessenger === 'function' ? window.openFriendMessenger : openFriendMessenger;
    const scrollMid =
        friendMessageId != null && Number.isFinite(Number(friendMessageId)) && Number(friendMessageId) > 0
            ? Number(friendMessageId)
            : null;
    openMsgr(fromUserId, fromUserName || '회원', fromUserAvatar || '', scrollMid);
    try {
        if (Number.isFinite(notificationId) && notificationId > 0) {
            await axios.post('/api/notifications/read-one', {
                userId: currentUserId,
                notificationId: Number(notificationId)
            });
        }
    } catch (e) {
        console.warn('mark notification read failed', e);
    }
    const i = notificationsList.findIndex((n) => Number(n.id) === Number(notificationId));
    if (i >= 0) {
        notificationsList[i] = { ...notificationsList[i], is_read: true };
        updateSidebarNotificationsList();
        updateNotificationBadge();
    }
}

window.openFeedbackFromNotification = openFeedbackFromNotification;

// Format notification time
function formatNotificationTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}일 전`;
    if (hours > 0) return `${hours}시간 전`;
    if (minutes > 0) return `${minutes}분 전`;
    return '방금 전';
}

// Update notification badge (red dot)
function updateNotificationBadge() {
    const badge = document.getElementById('notificationDot');
    const badgeMob = document.getElementById('notificationDotMobile');
    const hasUnread = notificationsList && notificationsList.some((n) => !n.is_read);
    if (hasUnread) {
        if (badge) badge.classList.remove('hidden');
        if (badgeMob) badgeMob.classList.remove('hidden');
    } else {
        if (badge) badge.classList.add('hidden');
        if (badgeMob) badgeMob.classList.add('hidden');
    }
}

// Check for new notifications in background (without marking as read)
async function checkNotificationsInBackground() {
    if (!currentUserId) {
        console.log('⏭️ checkNotificationsInBackground: No user logged in');
        return;
    }
    
    console.log('🔍 checkNotificationsInBackground: Checking for user', currentUserId);
    
    try {
        const response = await axios.get(`/api/notifications/${currentUserId}`);
        const newNotifications = response.data.notifications || [];
        
        console.log('📬 Received notifications:', newNotifications.length);
        console.log('📬 Unread:', newNotifications.filter(n => !n.is_read).length);
        
        // Update local list without marking as read
        notificationsList = newNotifications;
        
        // Update badge to show/hide red dot
        updateNotificationBadge();
        
        console.log('✅ Background notification check complete');
    } catch (error) {
        console.error('❌ Failed to check notifications in background:', error);
    }
}

// Start notification polling
let notificationPollingInterval = null;

function startNotificationPolling() {
    // Check immediately
    checkNotificationsInBackground();
    
    // Then check every 30 seconds
    if (notificationPollingInterval) {
        clearInterval(notificationPollingInterval);
    }
    
    notificationPollingInterval = setInterval(() => {
        checkNotificationsInBackground();
    }, 30000); // 30 seconds
    
    console.log('Notification polling started (every 30 seconds)');
}

function stopNotificationPolling() {
    if (notificationPollingInterval) {
        clearInterval(notificationPollingInterval);
        notificationPollingInterval = null;
        console.log('Notification polling stopped');
    }
}

// Send friend request
async function sendFriendRequest(toUserId, toUserName) {
    if (!currentUserId) {
        showToast('로그인이 필요합니다', 'error');
        return;
    }
    const toId = Number(toUserId);
    const fromId = Number(currentUserId);
    if (!Number.isFinite(toId) || !Number.isFinite(fromId)) {
        showToast('대상 사용자 정보가 올바르지 않습니다.', 'error');
        return;
    }
    if (toId === fromId) {
        showToast('본인에게는 친구 제안을 보낼 수 없습니다.', 'error');
        return;
    }
    
    if (!confirm(`${toUserName}님에게 친구 제안을 보내시겠습니까?`)) {
        return;
    }
    
    try {
        const response = await axios.post('/api/friend-request', {
            fromUserId: fromId,
            toUserId: toId
        });
        
        showToast(response.data.message, 'success');
        
        // Refresh profile modal to update button state
        await showUserProfileModal(toId);
    } catch (error) {
        console.error('Failed to send friend request:', error);
        const message = error.response?.data?.error || '친구 제안 전송에 실패했습니다';
        if (message.includes('이미 친구 제안을 보냈습니다')) {
            showToast(message, 'info');
            await showUserProfileModal(toId);
            return;
        }
        if (message.includes('상대방이 먼저 보낸 친구 요청이 있습니다')) {
            showToast('상대가 먼저 보낸 요청이 있습니다. 알림에서 승인/거절해 주세요.', 'info');
            await loadNotifications(false);
            await showUserProfileModal(toId);
            return;
        }
        if (message.includes('대상 가입자를 찾을 수 없습니다')) {
            showToast('대상 계정을 찾을 수 없어 전송할 수 없습니다.', 'error');
            return;
        }
        showToast(message, 'error');
    }
}

// Accept friend request
async function acceptFriendRequest(requestId, fromUserName, refreshProfileUserId) {
    try {
        const response = await axios.post('/api/friend-request/accept', {
            requestId: requestId,
            actionUserId: Number(currentUserId)
        });
        
        showToast(response.data.message, 'success');
        
        // Reload notifications and friends list (don't mark as read)
        await loadNotifications(false);
        await loadFriendsList();
        if (refreshProfileUserId) {
            await showUserProfileModal(refreshProfileUserId);
        }
    } catch (error) {
        console.error('Failed to accept friend request:', error);
        const message = error.response?.data?.error || '친구 제안 승인에 실패했습니다';
        showToast(message, 'error');
    }
}

// Reject friend request
async function rejectFriendRequest(requestId, refreshProfileUserId) {
    try {
        const response = await axios.post('/api/friend-request/reject', {
            requestId: requestId,
            actionUserId: Number(currentUserId)
        });
        
        showToast(response.data.message, 'success');
        
        // Reload notifications (don't mark as read)
        await loadNotifications(false);
        if (refreshProfileUserId) {
            await showUserProfileModal(refreshProfileUserId);
        }
    } catch (error) {
        console.error('Failed to reject friend request:', error);
        const message = error.response?.data?.error || '친구 제안 거절에 실패했습니다';
        showToast(message, 'error');
    }
}

// =====================
// Expose functions to window object for inline onclick handlers
// =====================
window.createPost = createPost;
window.handleLogin = handleLogin;
window.handleSignup = handleSignup;
window.previewSignupCover = previewSignupCover;
window.logout = logout;
window.toggleLike = toggleLike;
window.deletePost = deletePost;
window.sharePost = sharePost;
window.editPost = editPost;
window.loadComments = loadComments;
window.createComment = createComment;
window.toggleCommentLike = toggleCommentLike;
window.loadComments = loadComments;
window.createComment = createComment;
window.toggleCommentLike = toggleCommentLike;
window.filterByUser = filterByUser;
window.clearUserFilter = clearUserFilter;
window.showUserProfileModal = showUserProfileModal;
window.showMyProfile = showViewProfileModal;
window.hideProfile = hideProfile;
window.showEditProfileModal = showEditProfileModal;
window.cancelEditProfile = cancelEditProfile;
window.handleEditProfileSubmit = handleEditProfileSubmit;
window.submitChangePasswordInline = submitChangePasswordInline;
window.submitChangePasswordLegacy = submitChangePasswordLegacy;
window.selectBackgroundColor = selectBackgroundColor;
window.resetBackgroundColor = resetBackgroundColor;
window.previewPostImage = previewPostImage;
window.previewPostVideo = previewPostVideo;
window.removePostImage = removePostImage;
window.removePostImageAt = removePostImageAt;
window.removePostVideo = removePostVideo;
window.removeSharedPost = removeSharedPost;
window.loadPosts = loadPosts;
window.loadFriendsList = loadFriendsList;
window.loadNotifications = loadNotifications;
window.openFriendMessenger = openFriendMessenger;
window.sendFriendMessage = sendFriendMessage;
window.closeFriendMessenger = closeFriendMessenger;
window.friendMessengerAutoGrow = friendMessengerAutoGrow;
window.pickFriendMessengerImage = pickFriendMessengerImage;
window.pickFriendMessengerVideo = pickFriendMessengerVideo;
window.removeFriendMessengerAttachment = removeFriendMessengerAttachment;

window.createPostAutoGrow = createPostAutoGrow;
window.toggleFriendsList = toggleFriendsList;
window.toggleNotifications = toggleNotifications;
window.toggleQtPanel = toggleQtPanel;
window.showQtSection = showQtSection;
window.toggleQtWorshipPlay = toggleQtWorshipPlay;
window.toggleQtWorshipMute = toggleQtWorshipMute;
window.setQtWorshipVolume = setQtWorshipVolume;
window.setQtWorshipVolumeFromPanel = setQtWorshipVolumeFromPanel;
window.showQtAlarmModal = showQtAlarmModal;
window.showQtInviteModal = showQtInviteModal;
window.hideQtInviteModal = hideQtInviteModal;
window.sendQtInvite = sendQtInvite;
window.showFriendInviteModal = showFriendInviteModal;
window.hideFriendInviteModal = hideFriendInviteModal;
window.sendFriendInvite = sendFriendInvite;
window.saveQtApply = saveQtApply;
window.saveQtPrayer = saveQtPrayer;
window.qtAutoGrow = qtAutoGrow;
window.sendQtApplyPost = sendQtApplyPost;
window.sendQtPrayerPost = sendQtPrayerPost;
window.editQtApply = editQtApply;
window.editQtPrayer = editQtPrayer;
window.setQtHeaderButtonActive = setQtHeaderButtonActive;
window.setQtButtonActive = setQtButtonActive;
window.sendFriendRequest = sendFriendRequest;
window.acceptFriendRequest = acceptFriendRequest;
window.rejectFriendRequest = rejectFriendRequest;
window.showHowToUse = showHowToUse;
window.hideHowToUse = hideHowToUse;
window.showLoginModal = showLoginModal;
window.showSignupModal = showSignupModal;
window.showForgotPasswordModal = showForgotPasswordModal;
window.hideForgotPasswordModal = hideForgotPasswordModal;
window.toggleLoginPasswordVisibility = toggleLoginPasswordVisibility;
window.requestPasswordReset = requestPasswordReset;
window.validatePasswordRealtime = validatePasswordRealtime;
window.hideLoginModal = hideLoginModal;
window.hideLoginRewardCelebrationModal = hideLoginRewardCelebrationModal;
window.hideScoreMilestoneCelebrationModal = hideScoreMilestoneCelebrationModal;
window.hideSignupModal = hideSignupModal;
window.hideEditProfileModal = hideEditProfileModal;
window.updateNotificationBadge = updateNotificationBadge;
window.checkNotificationsInBackground = checkNotificationsInBackground;
window.startNotificationPolling = startNotificationPolling;
window.stopNotificationPolling = stopNotificationPolling;

// Mobile posts carousel functionality
let currentPostIndex = 0;
let totalPosts = 0;

function scrollPosts(direction) {
    const postsFeed = document.getElementById('postsFeed');
    if (!postsFeed) return;
    
    const posts = postsFeed.children;
    totalPosts = posts.length;
    
    if (totalPosts === 0) return;
    
    if (direction === 'next') {
        currentPostIndex = (currentPostIndex + 1) % totalPosts;
    } else {
        currentPostIndex = (currentPostIndex - 1 + totalPosts) % totalPosts;
    }
    
    posts[currentPostIndex].scrollIntoView({ 
        behavior: 'smooth', 
        block: 'nearest', 
        inline: 'start' 
    });
    
    updatePostIndicators();
}

function updatePostIndicators() {
    const indicatorsContainer = document.getElementById('postIndicators');
    if (!indicatorsContainer) return;
    
    const postsFeed = document.getElementById('postsFeed');
    if (!postsFeed) return;
    
    totalPosts = postsFeed.children.length;
    
    // Clear existing indicators
    indicatorsContainer.innerHTML = '';
    
    // Create new indicators
    for (let i = 0; i < totalPosts; i++) {
        const indicator = document.createElement('div');
        indicator.className = `w-2 h-2 rounded-full transition-all ${i === currentPostIndex ? 'bg-blue-600 w-6' : 'bg-gray-300'}`;
        indicator.onclick = () => {
            currentPostIndex = i;
            const posts = postsFeed.children;
            posts[i].scrollIntoView({ 
                behavior: 'smooth', 
                block: 'nearest', 
                inline: 'start' 
            });
            updatePostIndicators();
        };
        indicatorsContainer.appendChild(indicator);
    }
}

// Update indicators when posts are loaded
const originalLoadPosts = loadPosts;
loadPosts = async function() {
    await originalLoadPosts();
    setTimeout(() => {
        updatePostIndicators();
    }, 100);
};

window.scrollPosts = scrollPosts;
window.updatePostIndicators = updatePostIndicators;

// 리워드 카드 접기/펼치기 (이벤트 위임 방식 — 가장 안정적)
(function initRewardCardCollapse() {
    const STORAGE_KEY = 'rewardCardCollapsed';

    function getCollapsedSet() {
        try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); }
        catch { return new Set(); }
    }

    function saveCollapsedSet(set) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...set])); } catch {}
    }

    function applyState(card, collapsed) {
        card.classList.toggle('reward-card-collapsed', collapsed);
        const chevron = card.querySelector('.reward-card-chevron');
        if (chevron) {
            chevron.classList.toggle('fa-chevron-up', !collapsed);
            chevron.classList.toggle('fa-chevron-down', collapsed);
        }
    }

    // 저장된 상태 반영 (페이지 로드 시 1회)
    function applyStoredStates() {
        const collapsed = getCollapsedSet();
        document.querySelectorAll('.reward-card-collapsible').forEach(card => {
            const key = card.dataset.rewardKey;
            if (key) applyState(card, collapsed.has(key));
        });
    }

    // body 레벨 이벤트 위임 — 동적 카드도 자동 처리
    document.addEventListener('click', function(e) {
        const header = e.target.closest('.reward-card-header-line');
        if (!header) return;
        const card = header.closest('.reward-card-collapsible');
        if (!card) return;
        const key = card.dataset.rewardKey;
        if (!key) return;
        const newCollapsed = !card.classList.contains('reward-card-collapsed');
        const set = getCollapsedSet();
        newCollapsed ? set.add(key) : set.delete(key);
        saveCollapsedSet(set);
        applyState(card, newCollapsed);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyStoredStates);
    } else {
        applyStoredStates();
    }
    window.reInitRewardCardCollapse = applyStoredStates;
})();

