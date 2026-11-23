<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
    <meta name="theme-color" content="#123d3a">
    <meta name="color-scheme" content="light">
    <meta name="description" content="PPMS production forms, review references, traceability and secure offline record entry.">
    <title>PPMS · <?php echo $mode === 'mobile' ? 'Personnel' : 'Administration'; ?></title>
    <link rel="manifest" href="<?php echo html_escape($app_base); ?>/manifest.webmanifest">
    <link rel="icon" type="image/svg+xml" href="<?php echo html_escape($app_base); ?>/assets/ppms/icon-192.svg">
    <link rel="stylesheet" href="<?php echo html_escape($app_base); ?>/assets/ppms/styles.css">
    <script type="module" src="<?php echo html_escape($app_base); ?>/assets/ppms/app.js"></script>
</head>
<body data-mode="<?php echo html_escape($mode); ?>" data-base="<?php echo html_escape($app_base); ?>">
    <a class="skip-link" href="#workspace">Skip to workspace</a>
    <div id="app"><main class="initial-loader"><span class="brand-mark">P</span><h1>PPMS</h1><p>Opening your workspace…</p></main></div>
    <div id="notifications" class="notifications" aria-live="polite" aria-atomic="false"></div>
    <noscript><p class="notice">JavaScript is required for editable forms and offline storage. Enable it to open PPMS.</p></noscript>
</body>
</html>
