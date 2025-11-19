// ---- DENO OCR FUNCTION FOR BASE44 ----
// Minimal, stable, and works with Google Vision PDF OCR

// Load environment variables
const PROJECT_ID = Deno.env.get("GOOGLE_CLOUD_PROJECT_ID")!;
const SA_KEY = JSON.parse(Deno.env.get("GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON")!);

// Create a Google OAuth token
async function getAccessToken() {
  const jwtHeader = {
    alg: "RS256",
    typ: "JWT",
  };

  const jwtClaim = {
    iss: SA_KEY.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  };

  const encoder = new TextEncoder();
  const encodedHeader = btoa(JSON.stringify(jwtHeader));
  const encodedClaim = btoa(JSON.stringify(jwtClaim));

  const toSign = `${encodedHeader}.${encodedClaim}`;
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    strToUint8(SA_KEY.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(toSign)
  );

  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

  const jwt = `${toSign}.${signature}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = await resp.json();
  return data.access_token;
}

function strToUint8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

// --- OCR ENDPOINT ---
async function runOCR(pdfBytes: Uint8Array) {
  const accessToken = await getAccessToken();

  const body = {
    requests: [
      {
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        rawDocument: {
          content: btoa(String.fromCharCode(...pdfBytes)),
          mimeType: "application/pdf",
        },
      },
    ],
  };

  const res = await fetch(
    `https://vision.googleapis.com/v1/projects/${PROJECT_ID}/locations/us/operations`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const json = await res.json();
  return json;
}

// --- HTTP SERVER ---
Deno.serve(async (req) => {
  try {
    const input = await req.json();
    if (!input.file_url) {
      return new Response(JSON.stringify({ error: "Missing file_url" }), {
        status: 400,
      });
    }

    // Download PDF
    const pdfResp = await fetch(input.file_url);
    const pdfArrayBuffer = await pdfResp.arrayBuffer();
    const pdfBytes = new Uint8Array(pdfArrayBuffer);

    // Perform OCR
    const ocr = await runOCR(pdfBytes);

    return new Response(JSON.stringify({ ocr }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
    });
  }
});
