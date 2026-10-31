<?php
// GitHub push webhook, served at https://seattlepetanque.org/_hooks/deploy.php.
// Verifies the X-Hub-Signature-256 HMAC, then starts deploy.sh in the background.

const SECRET_FILE = '/home/dh_jsaetx/.deploy-secret';
const DEPLOY_SCRIPT = '/home/dh_jsaetx/site-src/deploy/deploy.sh';
const DEPLOY_LOG = '/home/dh_jsaetx/deploy.log';
const DEPLOY_REF = 'refs/heads/main';

function respond(int $code, string $message): void
{
    http_response_code($code);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message, "\n";
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    respond(405, 'method not allowed');
}

$secret = @file_get_contents(SECRET_FILE);
if ($secret === false || trim($secret) === '') {
    error_log('deploy.php: secret file missing or empty: ' . SECRET_FILE);
    respond(500, 'server not configured');
}
$secret = trim($secret);

$body = file_get_contents('php://input');
$signature = $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '';
$expected = 'sha256=' . hash_hmac('sha256', $body, $secret);
if ($signature === '' || !hash_equals($expected, $signature)) {
    respond(403, 'bad signature');
}

$event = $_SERVER['HTTP_X_GITHUB_EVENT'] ?? '';
if ($event === 'ping') {
    respond(200, 'pong');
}
if ($event !== 'push') {
    respond(200, 'ignored event');
}

$payload = json_decode($body, true);
$ref = is_array($payload) ? ($payload['ref'] ?? null) : null;
if ($ref !== DEPLOY_REF) {
    respond(200, 'ignored ref');
}

// Run the deploy detached so GitHub gets a quick reply. deploy.sh serializes via flock.
exec(DEPLOY_SCRIPT . ' >> ' . DEPLOY_LOG . ' 2>&1 &');
respond(200, 'deploy started');
