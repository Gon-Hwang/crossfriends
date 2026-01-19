-- Insert test users
INSERT OR IGNORE INTO users (id, email, name, bio, church, denomination, location) VALUES 
  (1, 'john@example.com', 'John Kim', '주님의 사랑을 전하는 사람', '서울중앙교회', '장로교', '서울'),
  (2, 'sarah@example.com', 'Sarah Park', '말씀으로 살아가는 삶', '은혜교회', '감리교', '부산'),
  (3, 'david@example.com', 'David Lee', '기도의 응답을 경험하는 중', '새생명교회', '침례교', '인천'),
  (4, 'grace@example.com', 'Grace Choi', '찬양과 경배를 사랑합니다', '예수사랑교회', '순복음', '대전');

-- Insert test posts
INSERT OR IGNORE INTO posts (id, user_id, content, verse_reference) VALUES 
  (1, 1, '오늘 새벽 기도 중에 큰 은혜를 받았습니다. 하나님의 사랑이 너무나 크심을 다시금 깨달았어요.', '시편 23:1'),
  (2, 2, '교회에서 봉사하면서 많은 것을 배우고 있습니다. 섬김의 기쁨이 이런 것이군요!', '마가복음 10:45'),
  (3, 1, '성경 읽기 1년 계획을 시작했어요. 함께 하실 분들을 찾습니다!', '시편 119:105'),
  (4, 3, '주일 예배가 너무 은혜로웠습니다. 목사님 말씀이 제 마음에 와닿았어요.', '히브리서 10:25'),
  (5, 4, '오늘 찬양 인도를 맡게 되었습니다. 기도 부탁드려요!', '시편 150:6');

-- Insert test comments
INSERT OR IGNORE INTO comments (post_id, user_id, content) VALUES 
  (1, 2, '아멘! 저도 오늘 은혜 많이 받았어요.'),
  (1, 3, '함께 기도하겠습니다!'),
  (2, 1, '멋지세요! 섬김의 본이 되어주셔서 감사해요.'),
  (3, 4, '저도 동참하고 싶어요!'),
  (4, 2, '할렐루야! 주님께 영광 돌립니다.');

-- Insert test likes
INSERT OR IGNORE INTO likes (post_id, user_id) VALUES 
  (1, 2),
  (1, 3),
  (1, 4),
  (2, 1),
  (2, 3),
  (3, 2),
  (3, 4),
  (4, 1),
  (5, 1),
  (5, 2);

-- Insert test friendships
INSERT OR IGNORE INTO friendships (user_id, friend_id, status) VALUES 
  (1, 2, 'accepted'),
  (1, 3, 'accepted'),
  (2, 3, 'accepted'),
  (1, 4, 'pending'),
  (3, 4, 'accepted');

-- Insert test prayer requests
INSERT OR IGNORE INTO prayer_requests (user_id, title, content, is_anonymous, status) VALUES 
  (1, '가족의 건강을 위한 기도', '부모님께서 편찮으셔서 빠른 회복을 위해 기도 부탁드립니다.', 0, 'active'),
  (2, '새로운 직장을 위한 기도', '하나님의 인도하심을 따라 새로운 일터를 찾고 있습니다.', 0, 'active'),
  (3, '익명의 기도제목', '어려운 결정을 앞두고 있습니다. 지혜를 구합니다.', 1, 'active'),
  (4, '선교 여행을 위한 기도', '다음 달 해외 선교를 떠납니다. 안전과 열매를 위해 기도해주세요.', 0, 'active');

-- Insert test prayer responses
INSERT OR IGNORE INTO prayer_responses (prayer_request_id, user_id, content) VALUES 
  (1, 2, '함께 기도하겠습니다. 하나님의 치유하심이 함께하시길!'),
  (1, 3, '아멘. 빠른 쾌유를 기도합니다.'),
  (2, 1, '주님께서 좋은 길을 예비하실 거예요!'),
  (4, 1, '안전한 여행과 풍성한 열매를 위해 기도합니다!');
