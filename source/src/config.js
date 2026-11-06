// Microsoft Entra(Azure)에 앱을 등록하면 나오는 "애플리케이션(클라이언트) ID"를 넣으세요.
// 비워두면 OneDrive 연결 없이 "파일 직접 열기" 모드로만 동작해요.
export const CLIENT_ID = "c7435244-1831-4d69-9211-4e2aff1da2eb"; // Azure 앱 등록 "목실감" (Default Directory, 개인 계정만)

// 개인 Microsoft 계정(OneDrive 개인) 전용
export const AUTHORITY = "https://login.microsoftonline.com/consumers";
export const SCOPES = ["Files.ReadWrite"];

// OneDrive 안에서의 기본 파일 경로 (앱 설정에서 바꿀 수 있어요)
export const DEFAULT_PATH = "부동산/2026 목실감.xlsx";
