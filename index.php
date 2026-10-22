<?php
// CLI entry point. Web requests must go through public/index.php.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__.'/public/index.php';
