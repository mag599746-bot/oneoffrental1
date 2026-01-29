# ONEOFF Quote API

## 배포 (Render 기준)
1. Render에서 New Web Service 생성
2. 연결할 GitHub repo 선택
3. Root Directory: `server`
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Environment Variables: `.env.example` 참고하여 설정

## 필수 환경변수
- ADMIN_PASSWORD
- ADMIN_TOKEN_SECRET
- ALLOWED_ORIGINS
- SMTP_HOST
- SMTP_PORT
- SMTP_USER
- SMTP_PASS
- SMTP_FROM
- ADMIN_EMAIL
- SENS_SERVICE_ID
- SENS_ACCESS_KEY
- SENS_SECRET_KEY
- SENS_FROM_NUMBER
- ADMIN_PHONE

## 헬스 체크
- `/health`
