# 목실감

OneDrive의 `부동산/2026 목실감.xlsx`를 원본으로 쓰는 폰용 웹앱(PWA)입니다. 앱에서 적으면 엑셀 칸에 바로 저장되고, 서식과 수식은 그대로 남습니다.

**주소: https://warren-booffett.github.io/moksilgam/** (GitHub Pages)

## 기능
- **기록**: 주간 날짜 줄, 원씽·목표별 목표/실제 시간(분 단위, +10분 같은 빠른 입력), 어제 목표 불러오기, 감사일기, 확언·돌아보기
- **올리기**: 여러 날짜를 골라 공유 카드 이미지 만들기, 월부 글 제목 자동 생성, 제목과 이미지를 복사한 뒤 월부 글쓰기 열기, 감사일기 텍스트 복사
- **통계**: 이번 달 투자 시간, 1만 시간 누적, 주차별 달성률
- 오프라인에서도 앱 화면이 열림 (Service Worker, 엑셀 데이터는 캐시하지 않음)

## 동작 방식
- 로그인: Microsoft 개인 계정 (Azure 앱 등록 "목실감", 클라이언트 ID는 `source/src/config.js`)
  - Azure 앱 등록 → 인증 → SPA 리디렉션 URI에 `https://warren-booffett.github.io/moksilgam/` 가 등록되어 있어야 함
- 저장할 때 OneDrive에서 최신 파일을 받아, 바꾼 날짜의 칸만 XML에서 고친 뒤 다시 올림 (`source/src/workbook.js`).
  수식·서식·조건부서식은 건드리지 않고, 엑셀이 열 때 다시 계산하도록 표시함.
- 그사이 파일이 바뀌었으면(eTag 불일치) 다시 받아서 재적용. PC 엑셀이 파일을 잠그고 있으면 저장이 거절될 수 있음.
- 앱을 다시 화면에 띄우면 엑셀을 새로 읽어옴 (저장 안 한 기록이 있으면 건너뜀).

## 폴더 구조
- 루트: 빌드된 배포 파일 (`index.html`, `app.js`, `app.css`, `sw.js` …). GitHub Pages가 이 파일들을 그대로 서비스함
- `source/`: 소스 (`src/`, `public/`, `build.mjs`, `test/`)
- `prototype/capture.html`: 초기 캡처 도구 프로토타입

## 명령어 (`source/` 폴더에서)
```
npm ci                             # 처음 한 번
node build.mjs                     # 저장소 루트에 배포 파일 빌드
node build.mjs --dev <파일.xlsx>   # 로컬 테스트 (http://localhost:5173, 샘플은 source/dev/에만)
node test/roundtrip.mjs <원본.xlsx> <결과.xlsx> <비교.json>   # 엔진 읽기/쓰기 테스트
```

## 배포
Pages 설정: Settings → Pages → Source `Deploy from a branch` → Branch `claude/trusting-planck-5r8ln3` / `(root)`.
빌드한 결과를 이 브랜치에 푸시하면 자동으로 다시 배포됩니다.

**수정 후 재배포할 때는 `source/public/sw.js`의 `CACHE` 버전(`mok-shell-v5` → `v6`)을 올려야** 설치된 앱이 새 버전을 받아옵니다.

## 휴대폰에 설치
- **아이폰**: Safari로 접속 → 공유 버튼 → "홈 화면에 추가"
- **안드로이드**: Chrome으로 접속 → ⋮ 메뉴 → "앱 설치"

## 해마다 바꿀 것
새해 파일을 쓰려면 앱 설정(⚙)에서 OneDrive 파일 경로를 `부동산/2027 목실감.xlsx`처럼 바꾸면 됨.
