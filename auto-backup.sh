#!/bin/bash
# 자동 백업 스크립트

cd /home/user/webapp

# 변경사항이 있는지 확인
if [[ -n $(git status -s) ]]; then
    echo "🔄 변경사항 발견! 자동 백업 중..."
    
    # 현재 시간
    TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
    
    # Git 커밋 & 푸시
    git add .
    git commit -m "Auto-backup: $TIMESTAMP"
    git push origin main
    
    echo "✅ 백업 완료: $TIMESTAMP"
else
    echo "✅ 변경사항 없음"
fi
