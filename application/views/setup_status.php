<?php defined('BASEPATH') OR exit('No direct script access allowed'); ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PPMS · System setup</title>
    <meta name="color-scheme" content="light dark">
    <link rel="stylesheet" href="<?= html_escape(rtrim($this->config->item('base_url'), '/')) ?>/assets/ppms/styles.css">
    <script type="module" src="<?= html_escape(rtrim($this->config->item('base_url'), '/')) ?>/assets/ppms/theme.js"></script>
</head>
<body data-screen-label="System setup">
<main class="system-main">
    <h1 class="brand"><span class="brand-mark" aria-hidden="true">P</span>PPMS</h1>
    <nav aria-label="Applications"><a href="<?= html_escape($this->config->item('base_url').'admin') ?>">Administration</a> · <a href="<?= html_escape($this->config->item('base_url').'mobile') ?>">Personnel app</a></nav>
    <p class="muted">CodeIgniter 3 · MySQL / MariaDB</p>
    <section class="panel" aria-labelledby="setup-heading">
        <h2 id="setup-heading">System setup</h2>
        <p class="system-status <?= $connected ? 'connected' : '' ?>"><?= $connected ? 'Database connected' : 'Database setup needed' ?></p>
        <?php if ($connected): ?>
            <dl class="system-summary">
                <?php foreach (array('ProductionArea' => 'Areas', 'PpmForm' => 'PPM forms', 'PpmTemplateVersion' => 'Templates', 'PpmTraceConnection' => 'Connections', 'SystemSetting' => 'Settings') as $table => $label): ?>
                    <div><dt><?= html_escape($label) ?></dt><dd><?= (int) $counts[$table] ?></dd></div>
                <?php endforeach; ?>
            </dl>
        <?php else: ?>
            <p>Configure the MySQL / MariaDB connection using the README. For a new, empty database, run <code>php index.php setup install</code> from the project folder.</p>
        <?php endif; ?>
    </section>
    <?php if ($connected): ?>
        <section class="panel" aria-labelledby="forms-heading">
            <h2 id="forms-heading">PPM form register</h2>
            <div class="data-table-scroll">
                <table class="data-table">
                    <caption class="muted">Reference forms in the configured database</caption>
                    <thead><tr><th scope="col">Code</th><th scope="col">Title</th><th scope="col">Status</th></tr></thead>
                    <tbody>
                        <?php foreach ($forms as $form): ?>
                            <tr><td><?= html_escape($form['ppmCode']) ?></td><td><?= html_escape($form['title']) ?></td><td><?= html_escape($form['status']) ?></td></tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        </section>
    <?php endif; ?>
</main>
</body>
</html>
