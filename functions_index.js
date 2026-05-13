const functions = require("firebase-functions");
const https     = require("https");

// Claude API 키를 Firebase 환경변수에 저장
// 설정 방법: firebase functions:secrets:set CLAUDE_API_KEY
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || functions.config().claude?.apikey || "";
const CLAUDE_MODEL   = "claude-sonnet-4-20250514";

exports.claudeProxy = functions
  .region("asia-northeast3")   // 서울 리전
  .runWith({ secrets: ["CLAUDE_API_KEY"] })
  .https.onCall(async (data, context) => {

    // ── 인증 확인 (Firebase 로그인 필수) ──
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated", "로그인이 필요합니다."
      );
    }

    const { messages, systemPrompt } = data;
    if (!messages || !Array.isArray(messages)) {
      throw new functions.https.HttpsError(
        "invalid-argument", "messages 배열이 필요합니다."
      );
    }

    const apiKey = process.env.CLAUDE_API_KEY || CLAUDE_API_KEY;
    if (!apiKey) {
      throw new functions.https.HttpsError(
        "failed-precondition", "Claude API 키가 설정되지 않았습니다."
      );
    }

    const requestBody = JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: 2048,
      system:     systemPrompt || "당신은 친절한 포트폴리오 투자 분석 어시스턴트입니다.",
      messages:   messages,
    });

    // Claude API 호출 (Node.js https 모듈 사용)
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.anthropic.com",
          path:     "/v1/messages",
          method:   "POST",
          headers: {
            "Content-Type":      "application/json",
            "x-api-key":         apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Length":    Buffer.byteLength(requestBody),
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(body);
              if (res.statusCode !== 200) {
                reject(new functions.https.HttpsError(
                  "internal",
                  parsed.error?.message || "Claude API 오류"
                ));
              } else {
                resolve({ content: parsed.content?.[0]?.text || "" });
              }
            } catch (e) {
              reject(new functions.https.HttpsError("internal", "응답 파싱 실패"));
            }
          });
        }
      );
      req.on("error", (e) =>
        reject(new functions.https.HttpsError("internal", e.message))
      );
      req.write(requestBody);
      req.end();
    });
  });
