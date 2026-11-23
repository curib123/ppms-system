<?php
defined('BASEPATH') OR exit('No direct script access allowed');
// Error views can render before helpers and controllers are available.
if (!defined('PPMS_ERROR_THEME_LOADED')):
    define('PPMS_ERROR_THEME_LOADED', TRUE);
    $ppmsAssetBase = '';
    if (function_exists('config_item')) {
        $ppmsConfiguredBase = config_item('base_url');
        if (is_string($ppmsConfiguredBase)) {
            $ppmsAssetBase = parse_url($ppmsConfiguredBase, PHP_URL_PATH) ?: '';
        }
    }
    if ($ppmsAssetBase === '') {
        $ppmsAssetBase = dirname(isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : '/index.php');
        if ($ppmsAssetBase === '.' || $ppmsAssetBase === DIRECTORY_SEPARATOR) $ppmsAssetBase = '';
    }
    $ppmsAssetBase = htmlspecialchars(rtrim($ppmsAssetBase, '/'), ENT_QUOTES, 'UTF-8');
?>
<link rel="stylesheet" href="<?php echo $ppmsAssetBase; ?>/assets/ppms/styles.css">
<script type="module" src="<?php echo $ppmsAssetBase; ?>/assets/ppms/theme.js"></script>
<?php endif; ?>
