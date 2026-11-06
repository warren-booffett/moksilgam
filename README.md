# 목실감

매일의 **목표·실천·감사**를 기록하는 개인용 웹앱(PWA)입니다. 휴대폰 홈 화면에 설치하면 앱처럼 쓸 수 있습니다.

- 서버와 로그인 없이 기록은 **이 기기의 브라우저(localStorage)**에만 저장됩니다
- 자동 저장, 날짜 이동, 연속 기록일(🔥), 지난 기록, 카톡 공유용 텍스트 복사
- 오프라인에서도 동작합니다 (Service Worker)
- 설정 → 백업에서 JSON으로 내보내기와 불러오기를 할 수 있습니다 (폰 교체 전에 꼭 하세요)

## 로컬에서 실행

```bash
python3 -m http.server 8000
```

그 다음 브라우저에서 http://localhost:8000 을 엽니다. 빌드 과정이 없는 순수 HTML/CSS/JS입니다.

## 배포 (무료)

**현재 주소: https://warren-booffett.github.io/moksilgam/** (GitHub Pages)

Pages 설정: Settings → Pages → Source `Deploy from a branch` → Branch `claude/trusting-planck-5r8ln3` / `(root)` → Save.
이후에는 이 브랜치에 푸시할 때마다 자동으로 다시 배포됩니다.

다른 방법:

**Vercel (비공개 저장소여도 무료)**
1. https://vercel.com 에 GitHub 계정으로 로그인합니다
2. Add New → Project → `moksilgam` 저장소를 Import 합니다
3. Framework Preset은 `Other`로 두고 Deploy를 누릅니다. 발급된 `https://….vercel.app` 주소로 접속하면 됩니다

**GitHub Pages (공개 저장소일 때)**
- Settings → Pages → Branch를 `main` / `(root)`로 지정합니다

## 휴대폰에 설치
- **아이폰**: Safari로 접속 → 공유 버튼 → "홈 화면에 추가"
- **안드로이드**: Chrome으로 접속 → ⋮ 메뉴 → "앱 설치"

> ⚠️ iOS Safari는 홈 화면에 추가한 앱이라도 오래 쓰지 않으면 저장 데이터를 정리할 수 있습니다. 한 달에 한 번은 백업해두세요.

## 수정 후 재배포할 때
`sw.js`의 `CACHE` 버전(`moksilgam-v1` → `v2`)을 올려야 설치된 앱이 새 버전을 받아옵니다.
