// 자동 백업 데몬 (Node.js)
const { exec } = require('child_process');
const fs = require('fs');

const BACKUP_INTERVAL = 30 * 60 * 1000; // 30분마다

async function autoBackup() {
    console.log('🔍 백업 확인 중...', new Date().toISOString());
    
    exec('cd /home/user/webapp && bash auto-backup.sh', (error, stdout, stderr) => {
        if (error) {
            console.error('❌ 백업 실패:', error);
            return;
        }
        console.log(stdout);
    });
}

// 즉시 실행
autoBackup();

// 정기적으로 실행
setInterval(autoBackup, BACKUP_INTERVAL);

console.log(`🤖 자동 백업 데몬 시작 (${BACKUP_INTERVAL / 60000}분 간격)`);
