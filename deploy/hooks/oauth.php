<?php
// GitHub OAuth helper for Decap CMS (backend.base_url + auth_endpoint: oauth.php).
// Start step: redirects to GitHub. Callback step: exchanges the code for a token and
// hands it to the Decap opener window via postMessage (origin-checked).
// Config lives outside the docroot: /home/dh_jsaetx/.decap-oauth.ini
declare(strict_types=1);

const CONFIG_FILE = '/home/dh_jsaetx/.decap-oauth.ini';
const REDIRECT_URI = 'https://seattlepetanque.org/_hooks/oauth.php';
const SCOPE = 'public_repo';
const COOKIE_NAME = 'decap_oauth_state';

header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');

function plain_exit(int $status, string $message)
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message;
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET');
    plain_exit(405, 'Method not allowed');
}

$config = is_readable(CONFIG_FILE) ? @parse_ini_file(CONFIG_FILE) : false;
if (!is_array($config)
    || empty($config['client_id']) || empty($config['client_secret'])
    || empty($config['allowed_origins'])) {
    plain_exit(500, 'Server configuration error');
}
$clientId = (string) $config['client_id'];
$clientSecret = (string) $config['client_secret'];
$allowedOrigins = array_values(array_filter(array_map(
    static fn($o) => rtrim(trim($o), '/'),
    explode(',', (string) $config['allowed_origins'])
)));
if (!$allowedOrigins) {
    plain_exit(500, 'Server configuration error');
}

function set_state_cookie(string $value, int $maxAge): void
{
    setcookie(COOKIE_NAME, $value, [
        'expires' => $maxAge > 0 ? time() + $maxAge : time() - 3600,
        'path' => '/_hooks/oauth.php',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

/** Render the popup page that performs the Decap postMessage handshake. */
function render_result(bool $ok, array $payload, array $allowedOrigins, string $humanMessage)
{
    $nonce = base64_encode(random_bytes(16));
    header("Content-Security-Policy: default-src 'none'; script-src 'nonce-$nonce'; style-src 'nonce-$nonce'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    header('Content-Type: text/html; charset=utf-8');
    $flags = JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT;
    $message = ($ok ? 'authorization:github:success:' : 'authorization:github:error:')
        . json_encode($payload, $flags);
    $jsMessage = json_encode($message, $flags);
    $jsOrigins = json_encode($allowedOrigins, $flags);
    $text = htmlspecialchars($humanMessage, ENT_QUOTES, 'UTF-8');
    echo <<<HTML
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Seattle Pétanque login</title>
<style nonce="$nonce">body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem}</style>
</head><body>
<p>$text</p>
<script nonce="$nonce">
(function () {
  var ALLOWED_ORIGINS = $jsOrigins;
  var MESSAGE = $jsMessage;
  var opener = window.opener;
  if (!opener) { return; }
  // Talk to the opener directly instead of waiting for Decap to echo the handshake
  // back: Safari can lose the opener's reference to this popup after it visits
  // github.com. Each postMessage names an exact target origin, so the browser only
  // delivers the token if the opener really is one of our sites.
  ALLOWED_ORIGINS.forEach(function (origin) {
    opener.postMessage("authorizing:github", origin);
    opener.postMessage(MESSAGE, origin);
  });
  // Decap closes this window when it gets the message; close it ourselves as a fallback.
  setTimeout(function () { window.close(); }, 1500);
})();
</script>
</body></html>
HTML;
    exit;
}

function fail(array $allowedOrigins, string $detail)
{
    set_state_cookie('', 0);
    render_result(false, ['message' => $detail], $allowedOrigins, 'Login failed: ' . $detail . ' You can close this window and try again.');
}

// --- Start step ---------------------------------------------------------------
if (!isset($_GET['code']) && !isset($_GET['error'])) {
    $state = bin2hex(random_bytes(16));
    set_state_cookie($state, 600);
    $query = http_build_query([
        'client_id' => $clientId,
        'redirect_uri' => REDIRECT_URI,
        'scope' => SCOPE,
        'state' => $state,
    ], '', '&', PHP_QUERY_RFC3986);
    header('Location: https://github.com/login/oauth/authorize?' . $query, true, 302);
    exit;
}

// --- Callback step ------------------------------------------------------------
$cookieState = $_COOKIE[COOKIE_NAME] ?? '';
$gotState = $_GET['state'] ?? '';
if (!is_string($cookieState) || !is_string($gotState) || $cookieState === '' || !hash_equals($cookieState, $gotState)) {
    fail($allowedOrigins, 'The login session was invalid or expired.');
}
set_state_cookie('', 0);

if (isset($_GET['error'])) {
    fail($allowedOrigins, 'GitHub authorization was denied or failed.');
}
$code = $_GET['code'] ?? '';
if (!is_string($code) || $code === '') {
    fail($allowedOrigins, 'Missing authorization code.');
}

$body = http_build_query([
    'client_id' => $clientId,
    'client_secret' => $clientSecret,
    'code' => $code,
    'redirect_uri' => REDIRECT_URI,
]);
$url = 'https://github.com/login/oauth/access_token';
$response = false;
if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: seattlepetanque-decap-oauth'],
    ]);
    $response = curl_exec($ch);
    curl_close($ch);
} else {
    $ctx = stream_context_create(['http' => [
        'method' => 'POST',
        'header' => "Accept: application/json\r\nContent-Type: application/x-www-form-urlencoded\r\nUser-Agent: seattlepetanque-decap-oauth\r\n",
        'content' => $body,
        'timeout' => 15,
        'ignore_errors' => true,
    ]]);
    $response = @file_get_contents($url, false, $ctx);
}

$data = is_string($response) ? json_decode($response, true) : null;
if (!is_array($data) || empty($data['access_token']) || !is_string($data['access_token'])) {
    fail($allowedOrigins, 'GitHub did not return an access token.');
}

render_result(true, ['token' => $data['access_token'], 'provider' => 'github'], $allowedOrigins, 'Login successful. This window will close.');
