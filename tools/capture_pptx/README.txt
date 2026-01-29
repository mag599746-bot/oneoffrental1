홈페이지 캡처 → PPTX 만들기

1) 이 폴더에서 패키지 설치
   npm init -y
   npm install puppeteer pptxgenjs

2) 실행
   node capture.js

3) 결과 파일
   ../.. /홈페이지new1_캡처.pptx

* 크롬 경로를 지정하려면(다운로드 크롬 대신 내 크롬 사용):
  Windows PowerShell 예시:
  $env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
  node capture.js
