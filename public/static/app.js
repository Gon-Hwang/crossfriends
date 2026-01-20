let currentUserId = null;
let currentUser = null;

// Email History Management
function loadEmailHistory() {
    const history = localStorage.getItem('emailHistory');
    return history ? JSON.parse(history) : [];
}

function saveEmailToHistory(email) {
    let history = loadEmailHistory();
    
    if (!history.includes(email)) {
        history.unshift(email);
        
        if (history.length > 10) {
            history = history.slice(0, 10);
        }
        
        localStorage.setItem('emailHistory', JSON.stringify(history));
    }
    
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
const locationData = {
    '서울특별시': ['강남구', '강동구', '강북구', '강서구', '관악구', '광진구', '구로구', '금천구', '노원구', '도봉구', '동대문구', '동작구', '마포구', '서대문구', '서초구', '성동구', '성북구', '송파구', '양천구', '영등포구', '용산구', '은평구', '종로구', '중구', '중랑구'],
    '부산광역시': ['강서구', '금정구', '기장군', '남구', '동구', '동래구', '부산진구', '북구', '사상구', '사하구', '서구', '수영구', '연제구', '영도구', '중구', '해운대구'],
    '대구광역시': ['남구', '달서구', '달성군', '동구', '북구', '서구', '수성구', '중구'],
    '인천광역시': ['강화군', '계양구', '남동구', '동구', '미추홀구', '부평구', '서구', '연수구', '옹진군', '중구'],
    '광주광역시': ['광산구', '남구', '동구', '북구', '서구'],
    '대전광역시': ['대덕구', '동구', '서구', '유성구', '중구'],
    '울산광역시': ['남구', '동구', '북구', '울주군', '중구'],
    '세종특별자치시': ['세종특별자치시'],
    '경기도': ['가평군', '고양시', '과천시', '광명시', '광주시', '구리시', '군포시', '김포시', '남양주시', '동두천시', '부천시', '성남시', '수원시', '시흥시', '안산시', '안성시', '안양시', '양주시', '양평군', '여주시', '연천군', '오산시', '용인시', '의왕시', '의정부시', '이천시', '파주시', '평택시', '포천시', '하남시', '화성시']
};

function updateCities() {
    const province = document.getElementById('signupProvince').value;
    const citySelect = document.getElementById('signupCity');
    
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
        if (file.size > 5 * 1024 * 1024) {
            alert('파일 크기는 5MB를 초과할 수 없습니다.');
            event.target.value = '';
            return;
        }
        
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
    for (let i = 1; i <= 10; i++) {
        document.getElementById('faith_q' + i).value = '';
    }
    document.getElementById('avatarPreview').innerHTML = '<i class="fas fa-user text-gray-400 text-2xl"></i>';
}

function showLoginModal() {
    document.getElementById('loginModal').classList.remove('hidden');
}

function hideLoginModal() {
    document.getElementById('loginModal').classList.add('hidden');
    document.getElementById('loginEmail').value = '';
}

// Login handler
async function handleLogin() {
    const email = document.getElementById('loginEmail').value;

    if (!email) {
        alert('이메일을 입력해주세요.');
        return;
    }

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
        alert('이메일을 입력해주세요.');
        return;
    }

    console.log('로그인 시도:', trimmedEmail);

    try {
        const response = await axios.get('/api/users');
        console.log('사용자 목록 조회 성공:', response.data.users.length, '명');
        
        const user = response.data.users.find(u => u.email.toLowerCase() === trimmedEmail.toLowerCase());

        if (user) {
            console.log('사용자 찾음:', user);
            currentUserId = user.id;
            currentUser = user;
            
            saveEmailToHistory(trimmedEmail);
            
            updateAuthUI();
            hideLoginModal();
            await loadPosts();
            alert('환영합니다, ' + user.name + '님! 😊');
        } else {
            console.log('사용자를 찾을 수 없음. 입력된 이메일:', trimmedEmail);
            console.log('등록된 이메일 목록:', response.data.users.map(u => u.email));
            alert('가입되지 않은 이메일입니다. 회원가입을 먼저 해주세요.');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('로그인에 실패했습니다. 다시 시도해주세요.');
    }
}

// Initialize
window.addEventListener('DOMContentLoaded', function() {
    updateAuthUI();
    updateEmailDatalist();
    autoLogin();
});
